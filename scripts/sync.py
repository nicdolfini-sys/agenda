"""Puxa prazos do Moodle UFSC + eventos do Google Agenda e gera site/data.enc.json (criptografado).

Variáveis de ambiente:
  MOODLE_URL    ex.: https://presencial.moodle.ufsc.br
  MOODLE_TOKEN  token do serviço moodle_mobile_app
  AGENDA_SENHA  senha que abre o site
  GCAL_ICS      (opcional) endereço secreto iCal do Google Agenda; vários separados por espaço
"""
import base64
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone, date
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASE = os.environ["MOODLE_URL"].rstrip("/")
TOKEN = os.environ["MOODLE_TOKEN"]
SENHA = os.environ["AGENDA_SENHA"]
GCAL = os.environ.get("GCAL_ICS", "").split()
OUT = Path(__file__).resolve().parent.parent / "public" / "data.enc.json"
PBKDF2_ITER = 250_000

NOW = int(time.time())
DE = NOW - 60 * 86400
ATE = NOW + 200 * 86400


def ws(fn, **params):
    flat = {}
    for k, v in params.items():
        if isinstance(v, list):
            for i, x in enumerate(v):
                flat[f"{k}[{i}]"] = x
        else:
            flat[k] = v
    # O Moodle da UFSC às vezes não responde para os servidores do GitHub: tenta algumas vezes
    for tentativa in range(5):
        try:
            r = requests.post(
                f"{BASE}/webservice/rest/server.php",
                params={"moodlewsrestformat": "json", "wsfunction": fn, "wstoken": TOKEN},
                data=flat,
                timeout=(20, 60),
            )
            r.raise_for_status()
            break
        except (requests.ConnectionError, requests.Timeout) as e:
            if tentativa == 4:
                raise
            print(f"Moodle não respondeu ({e.__class__.__name__}), tentando de novo…", file=sys.stderr)
            time.sleep(15 * (tentativa + 1))
    d = r.json()
    if isinstance(d, dict) and d.get("exception"):
        raise RuntimeError(f"{fn}: {d.get('errorcode')} {d.get('message')}")
    return d


def nome_curto(fullname):
    return fullname.split(" - ", 1)[-1].strip()


def disciplinas_atuais(userid):
    cursos = ws("core_enrol_get_users_courses", userid=userid)
    semestres = [m.group(1) for c in cursos if (m := re.search(r"\((20\d{3})\)", c["fullname"]))]
    atual = max(semestres) if semestres else None
    return [c for c in cursos if atual and f"({atual})" in c["fullname"]]


def moodle():
    info = ws("core_webservice_get_site_info")
    cursos = disciplinas_atuais(info["userid"])
    ids = [c["id"] for c in cursos]
    nomes = {c["id"]: nome_curto(c["fullname"]) for c in cursos}
    itens = {}

    def add(chave, **item):
        itens.setdefault(chave, {"origem": "moodle", **item})

    for c in ws("mod_assign_get_assignments", courseids=ids)["courses"]:
        for a in c["assignments"]:
            entregue = False
            try:
                st = ws("mod_assign_get_submission_status", assignid=a["id"])
                sub = (st.get("lastattempt") or {}).get("submission") or {}
                entregue = sub.get("status") == "submitted"
            except Exception as e:
                print("aviso status tarefa", a["id"], e, file=sys.stderr)
            add(
                f"assign-{a['id']}",
                tipo="tarefa",
                titulo=a["name"],
                disciplina=nomes[c["id"]],
                quando=a["duedate"] or None,
                entregue=entregue,
                link=f"{BASE}/mod/assign/view.php?id={a['cmid']}",
            )

    for q in ws("mod_quiz_get_quizzes_by_courses", courseids=ids).get("quizzes", []):
        feito = False
        try:
            tent = ws("mod_quiz_get_user_attempts", quizid=q["id"], status="finished")
            feito = bool(tent.get("attempts"))
        except Exception as e:
            print("aviso tentativas quiz", q["id"], e, file=sys.stderr)
        add(
            f"quiz-{q['id']}",
            tipo="questionário",
            titulo=q["name"],
            disciplina=nomes.get(q["course"], ""),
            quando=q["timeclose"] or None,
            entregue=feito,
            link=f"{BASE}/mod/quiz/view.php?id={q['coursemodule']}",
        )

    # Eventos do calendário (provas marcadas pelo professor, fóruns, eventos pessoais do Moodle...)
    ev = ws(
        "core_calendar_get_calendar_events",
        **{"events[courseids]": ids},
        **{"options[timestart]": DE, "options[timeend]": ATE, "options[userevents]": 1, "options[siteevents]": 1},
    )
    for e in ev.get("events", []):
        if e.get("modulename") in ("assign", "quiz"):
            continue  # já vieram acima, com status de entrega
        add(
            f"ev-{e['id']}",
            tipo="evento" if not e.get("modulename") else e["modulename"],
            titulo=re.sub(r"\s+está marcado\(a\) para esta data$", "", e["name"]),
            disciplina=nomes.get(e.get("courseid"), ""),
            quando=e["timestart"],
            fim=e["timestart"] + e["timeduration"] if e.get("timeduration") else None,
            entregue=False,
            link=e.get("url") or f"{BASE}/calendar/view.php?view=day&time={e['timestart']}",
        )

    return info["fullname"], [{"nome": n} for n in nomes.values()], list(itens.values())


def google():
    if not GCAL:
        return []
    import icalendar
    import recurring_ical_events

    ini = datetime.fromtimestamp(DE, timezone.utc)
    fim = datetime.fromtimestamp(ATE, timezone.utc)
    out = []
    for n, url in enumerate(GCAL):
        try:
            cal = icalendar.Calendar.from_ical(requests.get(url, timeout=60).content)
        except Exception as e:
            print("aviso Google Agenda", n, e, file=sys.stderr)
            continue
        for e in recurring_ical_events.of(cal).between(ini, fim):
            s, f = e.get("DTSTART").dt, e.get("DTEND").dt if e.get("DTEND") else None
            dia_todo = not isinstance(s, datetime)

            def ts(x):
                if x is None:
                    return None
                if not isinstance(x, datetime):
                    return x.isoformat()  # data pura: o navegador trata como dia inteiro
                if x.tzinfo is None:
                    x = x.replace(tzinfo=timezone(timedelta(hours=-3)))
                return int(x.timestamp())

            out.append(
                {
                    "origem": "google",
                    "tipo": "pessoal",
                    "titulo": str(e.get("SUMMARY", "(sem título)")),
                    "local": str(e.get("LOCATION", "")) or None,
                    "quando": ts(s),
                    "fim": ts(f),
                    "diaTodo": dia_todo,
                }
            )
    return out


def cifrar(obj):
    sal, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    chave = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=sal, iterations=PBKDF2_ITER).derive(SENHA.encode())
    ct = AESGCM(chave).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "iter": PBKDF2_ITER, "sal": b(sal), "iv": b(iv), "dados": b(ct)}


def main():
    if len(SENHA) < 8:
        # Sem senha decente, não publica dado nenhum (o site fica só com o cadeado).
        OUT.unlink(missing_ok=True)
        print("AGENDA_SENHA ausente ou curta demais: nada foi publicado", file=sys.stderr)
        return
    try:
        nome, disciplinas, itens = moodle()
    except (requests.ConnectionError, requests.Timeout) as e:
        # Moodle fora do ar ou bloqueando o GitHub: republica os dados que já estão no site
        anterior = os.environ.get("SITE_URL", "").rstrip("/")
        print(f"Moodle inacessível ({e.__class__.__name__}); mantendo os dados publicados", file=sys.stderr)
        if not anterior:
            raise
        r = requests.get(f"{anterior}/data.enc.json", params={"t": NOW}, timeout=30)
        r.raise_for_status()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_bytes(r.content)
        print("::warning::Moodle não respondeu; o site continua com os dados da última leitura")
        return
    itens += google()
    dados = {"nome": nome, "atualizado": NOW, "moodle": BASE, "disciplinas": disciplinas, "itens": itens}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cifrar(dados)))
    if os.environ.get("AGENDA_DEBUG"):
        print(json.dumps(dados, ensure_ascii=False, indent=1))
    print(f"ok: {len(itens)} itens ({sum(i['origem'] == 'google' for i in itens)} do Google)")


if __name__ == "__main__":
    main()
