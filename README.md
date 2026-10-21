# 🌷 agenda

Planner pessoal: prazos do Moodle UFSC + compromissos do Google Agenda num site só.

- `scripts/sync.py` puxa os dados e gera `site/data.enc.json`, criptografado com AES-GCM e uma senha derivada por PBKDF2.
- `.github/workflows/sync.yml` roda isso a cada 3 h e publica no GitHub Pages.
- `site/index.html` pede a senha e decifra os dados no próprio navegador.

Secrets do repositório: `MOODLE_URL`, `MOODLE_TOKEN`, `AGENDA_SENHA` e `GCAL_ICS` (opcional, endereço secreto iCal).
