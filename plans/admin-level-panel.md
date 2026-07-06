# Admin Level Panel

A dev-only stage selector dropdown in the top-right corner of the pitch view, so the game's owner can jump straight to any of the 50 stages to test it.
Gated by `import.meta.env.DEV` (same pattern as `window.__game`), so it is stripped from production builds and invisible to players on GitHub Pages.

Scope decisions confirmed with Ege (2026-07-06):

- **Gating**: dev-only (`import.meta.env.DEV`). Not shipped in the production bundle at all - no URL param, no localStorage flag.
- **Jump behavior**: selecting a stage immediately loads it fresh - 5 tries, score/streak/cups reset to 0, any in-progress kick aborted (`newScenario` already fully resets phase/ball/gauges).
- **Records**: a run that used the jump is marked as a test run and never writes `fkl.bestStage` / `fkl.bestScore` / `fkl.cups` at run end. Starting a fresh run from the menu clears the mark.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done,
set its status to `Complete` and write its **Phase Summary** (what was done, key
decisions, anything needed to continue with zero context); run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

Branch: `feature/admin-level-panel`, off `development` at 43d44ed. Lands via PR into `development` (PR-only workflow, Ege approves).

## Phase 1: Test-run game state
Status: Complete

- [x] Add `testRun: false` to `createGameState()` in `src/game/physics.js` (with a comment: set when the dev panel jumps stages; suppresses record saving).
- [x] In `MagicalKicks.jsx`, reset `g.testRun = false` in `startGame` (an honest run after testing counts again).
- [x] In `endRun`, skip `saveRunEnd(...)` when `g.testRun` is true - call `loadBests()` instead so the HUD still shows the (unchanged) records.
- [x] Add a `jumpToStage(stage)` callback in `MagicalKicks.jsx`: set `g.testRun = true`, reset `score/goals/streak/cups` to 0, set `g.stage = stage`, `g.triesLeft = TRIES_PER_STAGE` (this makes `newScenario` re-roll the wall and clear ghost try marks), call `newScenario(g)`, and sync the HUD (`score/goals/streak/cups` zeroed, `msg: null`).

### Verification Plan
- `npm run test` - existing vitest suite still passes (physics/storage tests).
- Grep check: `saveRunEnd` in `MagicalKicks.jsx` is reachable only behind a `!g.testRun` guard.

### Phase Summary
Done as planned; no surprises.
`testRun` lives on the physics game state (documented in `createGameState`), but all reads/writes of it are in `MagicalKicks.jsx` (`startGame`, `endRun`, `jumpToStage`) - physics itself never branches on it.
`jumpToStage` deliberately reuses `newScenario`'s existing full-reset behaviour (phase → `aim1`, ball/gauges/keeper zeroed) instead of duplicating any reset logic; setting `triesLeft = TRIES_PER_STAGE` before the call is what makes `newScenario` treat it as a fresh stage (wall re-roll + ghost-mark clear).
Verification: `npm run test` green (58/58); the only `saveRunEnd` call site sits behind the `g.testRun ? loadBests() : saveRunEnd(...)` ternary.

## Phase 2: Dev-only dropdown UI
Status: Complete

- [x] Render an admin panel in the canvas wrapper (`MagicalKicks.jsx`), gated as `{import.meta.env.DEV && (...)}` so Vite dead-code-eliminates it from production builds.
- [x] Position: top-right at `z-40` so it stays clickable above the full-screen phone overlays (`z-30`) and the result banner; rendered as the last child of the wrapper so it also wins over `z-auto` siblings on desktop.
- [x] Content: a small labelled `<select>` ("ADMIN · STAGE") listing all `TOTAL_STAGES` (50) stages as `N · <stageSpec(N).name>`; controlled by `hud.stage`; `onChange` calls `jumpToStage(Number(value))` and blurs the select.
- [x] Stop `pointerdown` propagation on the panel (the wrapper's `onPointerDown` fires `onAction` - a click on the dropdown must not also lock a gauge).
- [x] Guard the window `keydown` handler: ignore Space/Enter when `e.target` is a `SELECT` (otherwise opening the dropdown with the keyboard would also kick).
- [x] Style it to read as a dev tool, not game UI (small, dark slate/amber, "ADMIN" label), consistent with the existing Tailwind idiom.

### Verification Plan
- `npm run build` succeeds; `grep -i "admin" dist/assets/*.js` finds nothing (panel stripped from production, same check as the documented `__game` verification).
- `npm run dev` + headless Chrome (raw CDP / Playwright pattern from HANDOVER.md §10): the select is visible top-right; choosing stage 7 sets `window.__game.stage === 7`, `triesLeft === 5`, `score === 0`, `testRun === true`, `phase === "aim1"`.
- Same harness: after jumping, force a game over via `window.__game` and confirm `localStorage["fkl.bestStage"]` is unchanged; restart from the menu and confirm `testRun` is false again.
- Screenshot: dropdown does not collide with the result banner, menu overlay, or the ⚽ button at desktop and 360px-wide mobile emulation.

### Phase Summary
Done, with one positioning change found by screenshot: `absolute top-2 right-2` put the panel over the "FREE KICK" title on the phone-sized menu overlay (which is full-screen `fixed` below `sm`), so the panel is now `fixed sm:absolute top-2 right-2` - the same below-`sm` viewport-pinning trick the overlays themselves use. On phones it sits in the empty strip above the canvas; from `sm` up it sits in the wrapper corner over the crowd.
Verification results (all green):
- Production stripping: `npm run build` then case-insensitive grep of `dist/assets/*.js` finds no "admin" (and no `__game`), so the panel is fully dead-code-eliminated.
- E2E over raw CDP (Node 24 built-in WebSocket + headless Chrome, no deps - scripts were scratch tooling, not committed): 16/16 assertions pass, covering the 50 labelled options, the Space-on-focused-select guard, the stage-7 jump (stage/tries/score/testRun/phase all correct, HUD shows 7/50), records untouched after a test-run game over (pre-seeded `fkl.bestStage=3` survives a stage-7 knockout), and `testRun` clearing on menu restart.
- Z-order re-test against the *real* rendered menu overlay (the first hit-test had mutated `g.phase` without a React re-render, so the overlay wasn't actually up): `elementFromPoint` over the select returns the select, and a real CDP mouse click on it does not start the game.
- Screenshots at 1280x900 (gameplay + menu) and 360x640 mobile emulation (gameplay + menu): no collisions with the ⚽ button, HUD, result banner, or overlay titles.

## Phase 3: Documentation
Status: Complete

- [x] HANDOVER.md: document the admin stage selector next to the `window.__game` note in §3 (dev-only, what it resets, that test runs never save records).

### Verification Plan
- `npm run test` and `npm run build` still green on the final tree.

### Phase Summary
Added a bullet in HANDOVER.md §3 right under the `window.__game` note: what the selector is, where it sits (viewport-pinned on phones), the DEV gating and bundle-grep verification, the fresh-jump semantics, and the `testRun` record suppression.
Final tree: `npm run test` 58/58 and `npm run build` green, stripping grep still clean.

## Final Recap
Implemented on branch `feature/admin-level-panel` (off `development` at 43d44ed), one commit.
The owner-only level selector is a dev-only panel: an "ADMIN · STAGE" `<select>` of all 50 stages in the top-right of the pitch view, gated on `import.meta.env.DEV` so the deployed GitHub Pages bundle contains no trace of it (grep-verified) - that is what makes it "only visible to me": it exists only in local `npm run dev`.
Selecting a stage jumps the run there fresh (5 tries, score/streak/cups zeroed, in-progress kick aborted via the existing `newScenario` reset) and flags `g.testRun`, which makes `endRun` skip `saveRunEnd` so test runs never pollute the persisted bests; a fresh menu run clears the flag.
Supporting details: the panel swallows `pointerdown` (the whole canvas is a tap target), the global Space/Enter handler ignores events targeting a `<select>`, and below `sm` the panel pins to the viewport corner so it never covers the phone overlays' titles.
Verified by vitest (58/58), production-bundle stripping grep, a 16-assertion raw-CDP E2E run, a dedicated z-order/click test against the real menu overlay, and screenshots at desktop and 360px mobile.

## Deployment Plan
Nothing player-facing ships: the panel is dev-only and the production bundle is unchanged in behaviour (grep-verified stripped).

1. Push `feature/admin-level-panel` and open a PR into `development`; merge when CI is green (Ege approves - PR-only workflow).
   Done: https://github.com/etuncoz/free-kick-game/pull/6 (also carries the corner-line/jersey-number fixes and the Cascadia Code font swap).
2. No deploy PR to `main` is needed for this feature alone, since it adds nothing to production. It will reach `main` incidentally with the next regular deploy PR from `development`.
3. To use the panel: `npm run dev`, open the local URL, pick a stage from the ADMIN · STAGE dropdown top-right. Records are not written for that run until you start a fresh one from the menu.
