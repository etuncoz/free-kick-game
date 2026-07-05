# Deploy to GitHub Pages

Serve the built game at `https://etuncoz.github.io/free-kick-game/` via a GitHub Actions workflow, with the correct Vite `base` path so assets resolve under the project-page subpath.

## Confirmed design decisions

- **Deploy method**: GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`), not a committed `gh-pages` branch.
  Avoids polluting git history with build artifacts and needing a separate deploy tool.
- **Base path**: `/free-kick-game/` in `vite.config.js`, since this is a project page, not a user/org root page.
- **No SPA fallback needed**: no client-side router is present (no react-router in `src/`), so a `404.html` rewrite trick is unnecessary.
- **`dist/` stays gitignored**: the Action builds fresh on every push; nothing build-related is committed.

## Phase 1: Vite base path

Status: Complete

- [x] Set `base: "/free-kick-game/"` in `vite.config.js`.
- [x] `npm run build` and `npm run preview` locally; confirm the page loads with no 404s on JS/CSS/font assets in the browser console.

### Verification Plan
- `npm run build` succeeds.
- Local preview under the `/free-kick-game/` base serves the page and all assets load (check DevTools Network tab for 404s).

### Phase Summary
Done 2026-07-05.
`base: "/free-kick-game/"` added to `vite.config.js`.
Verified with a Playwright load of `http://localhost:4173/free-kick-game/` against `vite preview`: page title renders, the menu appears, zero failed requests / 4xx responses.
Note: the production build strips `window.__game`, so browser checks against built output must wait on visible DOM (e.g. the "FREE KICK" heading), not the dev hook.

## Phase 2: GitHub Actions workflow

Status: Complete

- [x] Add `.github/workflows/deploy.yml`: trigger on push to `main`; steps: checkout, setup Node, install, `npm test`, `npm run build`, `actions/upload-pages-artifact` on `dist/`, `actions/deploy-pages` in a `github-pages` environment job with `id-token: write` / `pages: write` permissions.
- [x] Set the repo's Pages source to "GitHub Actions" (done via `gh api repos/etuncoz/free-kick-game/pages -X POST -f build_type=workflow` - no manual settings visit needed).
- [x] Push to `main` and confirm the workflow run succeeds and the Pages deployment goes live.

### Verification Plan
- Workflow run is green in the Actions tab.
- `https://etuncoz.github.io/free-kick-game/` loads the game and it's playable (manual check).

### Phase Summary
Done 2026-07-05, after two real-world snags worth knowing about:
1. **`npm ci` fails cross-platform with this dependency tree.** The wasm32-wasi fallback packages (`@rolldown/binding-wasm32-wasi`, `@tailwindcss/oxide-wasm32-wasi`, pulled in via vitest's rolldown-vite) pin `@emnapi/*` versions that npm's lock validation reports as "Missing from lock file" when the lock was generated on Windows and validated on Linux - an npm/cli#7902-class bug. Regenerating the lock from scratch and matching CI's Node major (24) to the local generator did NOT fix it. The workflow therefore runs `npm install --no-audit --no-fund` instead of `npm ci` (still resolves from the committed lock; `npm test` still gates the deploy). If the wasm fallback packages ever leave the tree, switching back to `npm ci` is preferable.
2. **First `deploy-pages` attempt failed transiently** ("Deployment failed, try again later", right after the Pages environment was created); the rerun succeeded immediately.
Also: the lock file was regenerated from scratch along the way (fresh `node_modules` + `package-lock.json`), which is why `ad173f7` trims 102 lines from the lock.

## Final Recap
The game deploys automatically to `https://etuncoz.github.io/free-kick-game/` on every push to `main`.
Commits: `061a6f2` (base path + workflow), `ebc1500`/`ad173f7` (lock file repair attempts), `4452965` (the actual CI fix: `npm install` instead of `npm ci`).
Pipeline: checkout → Node 24 → `npm install` → `npm test` (35 tests gate the deploy) → `vite build` → upload `dist/` → `deploy-pages`, with `concurrency: pages` so rapid pushes don't race.
Live site verified by an automated browser load: correct title, menu renders, zero failed asset requests.

## Deployment Plan
Deployment is now fully automatic:
1. Push (or merge) to `main`.
2. The "Deploy to GitHub Pages" workflow builds, tests, and publishes; watch it with `gh run watch` or in the Actions tab.
3. If the deploy job fails with "Deployment failed, try again later", rerun the failed job (`gh run rerun <id> --failed`) - observed to be transient.
4. Sanity check `https://etuncoz.github.io/free-kick-game/` afterwards (hard refresh; assets are content-hashed so stale caches resolve themselves).
