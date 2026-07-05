# Deploy to GitHub Pages

Serve the built game at `https://etuncoz.github.io/free-kick-game/` via a GitHub Actions workflow, with the correct Vite `base` path so assets resolve under the project-page subpath.

## Confirmed design decisions

- **Deploy method**: GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`), not a committed `gh-pages` branch.
  Avoids polluting git history with build artifacts and needing a separate deploy tool.
- **Base path**: `/free-kick-game/` in `vite.config.js`, since this is a project page, not a user/org root page.
- **No SPA fallback needed**: no client-side router is present (no react-router in `src/`), so a `404.html` rewrite trick is unnecessary.
- **`dist/` stays gitignored**: the Action builds fresh on every push; nothing build-related is committed.

## Phase 1: Vite base path

Status: Not started

- [ ] Set `base: "/free-kick-game/"` in `vite.config.js`.
- [ ] `npm run build` and `npm run preview -- --base=/free-kick-game/` locally; confirm the page loads with no 404s on JS/CSS/font assets in the browser console.

### Verification Plan
- `npm run build` succeeds.
- Local preview under the `/free-kick-game/` base serves the page and all assets load (check DevTools Network tab for 404s).

## Phase 2: GitHub Actions workflow

Status: Not started

- [ ] Add `.github/workflows/deploy.yml`: trigger on push to `main`; steps: checkout, setup Node, `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact` on `dist/`, `actions/deploy-pages` in a `github-pages` environment job with `id-token: write` / `pages: write` permissions.
- [ ] In the GitHub repo settings, set Settings -> Pages -> Source -> "GitHub Actions".
- [ ] Push to `main` and confirm the workflow run succeeds and the Pages deployment goes live.

### Verification Plan
- Workflow run is green in the Actions tab.
- `https://etuncoz.github.io/free-kick-game/` loads the game and it's playable (manual check).

## Final Recap
(fill in once both phases are complete)

## Deployment Plan
(fill in once both phases are complete)
