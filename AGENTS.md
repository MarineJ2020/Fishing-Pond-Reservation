# Project instructions for Codex

## Git commits
- Do **not** include a `Co-Authored-By` trailer in commit messages.

## Build & deploy
- **Always deploy `hosting` and `functions` together** (never `--only hosting`
  alone). `/`, `/book`, `/live`, `/confirmed` are rendered by the `seoRender`
  Cloud Function from a bundled `functions/src/template.html` that carries the
  build's hashed asset names. A hosting-only deploy leaves that template pointing
  at a JS bundle hosting has replaced → `/` goes blank with a `MIME type
  "text/html"` module error. `firebase` skips unchanged functions, so this is cheap.
- Preferred command: `firebase deploy --only "hosting,functions" --project kolamkelisayang`
  (add `,firestore,storage` when rules changed). If the CLI fails, retry with
  `npx firebase deploy ...`. The repo-root **`build and deploy.bat`** does the full
  build + combined deploy in one step.
