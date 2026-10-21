# agenda

Planner pessoal: prazos do Moodle UFSC + compromissos do Google Agenda num site só.

- `scripts/sync.py` puxa os dados e gera `public/data.enc.json`, criptografado com AES-GCM e uma senha derivada por PBKDF2.
- `.github/workflows/sync.yml` roda isso a cada 3 h, compila o site com Vite e publica no GitHub Pages.
- `src/` é o site, que pede a senha e decifra os dados no próprio navegador.

Secrets do repositório: `MOODLE_URL`, `MOODLE_TOKEN`, `AGENDA_SENHA` e `GCAL_ICS` (opcional, endereço secreto iCal; vários separados por espaço).

## Visual

O visual é o mesmo do [netsy](https://github.com/hcubasd/netsy), o visualizador de emissões da Nicolle e do Henrique: fundo animado, vidro e Comfortaa. `src/engine/`, `scripts/tables.js`, `src/viewport.ts` e o gatinho vêm de lá. As cores vêm do [nicrainha](https://github.com/hcubasd/nicrainha) (MIT, ver `LICENSES/`).

```sh
npm ci
npm run dev
```
