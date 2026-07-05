# Stage-Based Cup Run Mode

Replace the current 10-random-kicks match mode with a 10-stage "Cup Run": each stage is a fixed kick spot with 5 tries, a goal advances immediately, failing all 5 ends the run, and clearing stage 10 wins the cup.
Difficulty grows across stages via distance and wind only; keeper skill and gauge speed become constant mid-difficulty values.

## Confirmed design decisions (from planning session, 2026-07-05)

- The stage mode **replaces** the current match mode; there is no mode picker.
- **Fail rule**: failing all 5 tries on a stage is game over; the next run starts at stage 1.
- **Advance rule**: the first goal in a stage advances immediately; remaining tries are discarded.
- **Per-stage RNG**: the kick spot (distance `D` + angle `gx`) is fixed for all 5 tries of a stage; wind, wall (size/position/jump), and keeper prediction noise re-roll every try within the stage's difficulty band.
- **Stage table**: 10 hand-authored stages in a `STAGES` array (same layout every run), each pinning `D`, `gx`, and a wind cap.
- **Scoring**: points stay on top of pass/fail. A goal scores `100 + triesRemaining * 25` (scoring first try is worth more than fifth try), plus the existing +50 "top bin" bonus and the existing streak bonus (streak now effectively means consecutive first-try clears, since any miss resets it).
- **Difficulty scaling**: only distance and wind scale per stage. Keeper `kpSigma` is fixed at `0.9` and `gaugeSpeed` at `1.4` for the whole run (both mid-range of today's ramps; keep them as named tunable constants).
- **Persistence**: localStorage persists best stage reached, best score, and a cup-won flag. No mid-run resume; reload starts a fresh run.
- **Win**: clearing stage 10 shows a cup/trophy win screen.

## Proposed STAGES table (starting point, tune freely)

| Stage | D (m) | gx (m) | maxWindKmh |
|---|---|---|---|
| 1 | 19.0 | 0.0 | 0 |
| 2 | 20.0 | 2.0 | 2 |
| 3 | 21.0 | -2.5 | 3 |
| 4 | 22.0 | 3.2 | 4 |
| 5 | 23.0 | -3.8 | 5 |
| 6 | 24.0 | 1.5 | 6 |
| 7 | 25.5 | -4.5 | 7 |
| 8 | 27.0 | 4.8 | 8 |
| 9 | 28.5 | -5.2 | 9 |
| 10 | 30.0 | 5.2 | 10 |

Wind per try rolls `rnd(-maxW, maxW)` with `maxW = maxWindKmh / 26`, same unit conversion as today.
Stage 10's `D = 30` exceeds the old max of 28.5; verify the camera still frames the kicker and ball acceptably at that distance (see `project()` warning in HANDOVER.md §4) and pull back to 28.5 if it does not.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on.
When all phases are done, fill in **Final Recap** and **Deployment Plan**.
Read HANDOVER.md first: `physics.js` must stay free of React/DOM/audio imports (it ports to Swift verbatim), and the 60 fps loop must never touch React state.
Update HANDOVER.md (§4 state machine, §5 tuning knobs, §6 known issues, §7 next steps) as part of the final phase, since it is the project's primary design record.

## Phase 1: Stage data + physics/scenario changes
Status: Complete

- [x] Add `STAGES` array (10 entries: `{ d, gx, maxWindKmh }` per the table above) and `TRIES_PER_STAGE = 5`, `STAGE_KP_SIGMA = 0.9`, `STAGE_GAUGE_SPEED = 1.4` to `src/game/constants.js`; remove `TOTAL_KICKS` once nothing references it. *(removal deferred to Phase 2 - `MagicalKicks.jsx` still imports it)*
- [x] In `src/game/physics.js` `createGameState()`: replace `kick` with `stage` (1-based) and `triesLeft`; keep `score`, `goals`, `streak`, `best`.
- [x] Rewrite `newScenario(g)` to read `STAGES[g.stage - 1]`: set `D` and `gx` from the table (no re-roll), roll wind within the stage's cap, keep the existing per-try wall re-roll logic (3-5 players, 80% jump), set `kpSigma = STAGE_KP_SIGMA` and `gaugeSpeed = STAGE_GAUGE_SPEED`; return a HUD patch containing `stage` and `triesLeft` instead of `kick`.
- [x] In `finishKick()` (physics.js): change goal points to `100 + triesRemainingAfterThisKick * 25` plus the existing streak and top-bin bonuses; keep miss handling as is.
- [x] Add `vitest` as a dev dependency with a `test` npm script, and write `src/game/physics.test.js` covering: `newScenario` uses the exact `D`/`gx` from `STAGES` for each stage; wind magnitude never exceeds the stage cap over many rolls; `kpSigma`/`gaugeSpeed` are the fixed constants; goal scoring awards the spare-tries bonus correctly.

### Verification Plan
- `npx vitest run` passes all new physics tests.
- `npm run build` succeeds.

### Phase Summary
Done 2026-07-05.
`constants.js` gained `STAGES` (exact table from this plan), `TOTAL_STAGES`, `TRIES_PER_STAGE`, `STAGE_KP_SIGMA = 0.9`, `STAGE_GAUGE_SPEED = 1.4`, and `WIND_UNIT_KMH = 26` (the previously magic `/26` wind conversion); `MAX_WIND_KMH` was removed (physics was its only consumer).
`physics.js`: game state now carries `stage`/`triesLeft` instead of `kick`; `newScenario` reads the stage table and only re-rolls wind/wall/keeper; **try consumption lives in physics, not the component** - `finishKick` decrements `g.triesLeft` on any miss (goals leave it untouched), so the component only reads it to decide retry vs game over.
Goal points: `100 + (streak-1)*25 + (triesLeft-1)*25 + (corner ? 50 : 0)`.
`resultHudPatch` now includes `triesLeft`.
Verified: `npm test` (vitest, 8/8 pass) and `npm run build` both green.
Interim known-broken state: `MagicalKicks.jsx` still references `g.kick`/`TOTAL_KICKS`, so the app builds but the run flow is wrong until Phase 2 lands.

## Phase 2: Run flow + HUD in MagicalKicks.jsx
Status: Complete

- [x] Replace `nextKick()` with stage-aware flow: on GOAL, `stage += 1` and reset `triesLeft` to 5 (or go to the win state if stage 10 was just cleared); on any miss, `triesLeft -= 1` and retry the same spot, or game over at 0.
- [x] Add a `won` phase to the state machine alongside `gameover` (physics.js `step()` needs no change; the transition happens in the component like `gameover` does today).
- [x] Update the info bar: replace the KICK stat with STAGE (`x/10`) and add TRIES (dots or `y/5`); DISTANCE and WIND keep working via the existing HUD patch.
- [x] Update the result banner copy: goal shows "STAGE x CLEAR" style messaging with points; a non-final miss shows tries remaining ("2 TRIES LEFT").
- [x] Update the menu overlay copy to describe the cup run (10 stages, 5 tries, win the cup) and the game-over overlay to show the stage reached.
- [x] Ensure the ⚽ button aria-labels and prompts ("TAP ⚽ FOR NEXT KICK") reflect retry / next stage / claim cup states.

### Verification Plan
- `npm run build` succeeds.
- Playwright script (HANDOVER.md §10 pattern, scratch not committed): drive `window.__game` to force a GOAL and a 5-miss sequence; assert the HUD shows stage advance after the goal, try decrement after a miss, and the game-over overlay after the fifth miss; screenshot each state.

### Phase Summary
Done 2026-07-05.
`MagicalKicks.jsx`: `nextKick()` replaced by `advance()` (reads `g.result` + `g.triesLeft`; goal -> next stage with tries reset, or `won` after stage 10; miss -> retry, or `gameover` at 0 tries) plus a shared `endRun(phase)` helper; try decrementing stays in physics per Phase 1.
HUD state now carries `stage`/`triesLeft`; the info bar shows STAGE `x/10` and TRIES as 5 dots (amber = remaining, with an aria-label for screen readers).
Result banner gains a "STAGE x CLEAR" kicker on goals and an "n TRIES LEFT" line on non-final misses; the prompt pill is context-aware (FOR STAGE x+1 / TO CLAIM THE CUP / TO RETRY / FULL TIME), as are the ⚽ aria-labels.
Menu copy describes the cup run; game-over overlay says "CUP RUN OVER" + "Knocked out on stage x/10" with stage-based flavor lines.
A minimal `won` overlay (trophy emoji, score, play-again) was added so the state is playable now - **Phase 3 replaces/extends it** with persistence-aware content.
`resultHudPatch` (physics.js) now also includes `stage` so the HUD is fully self-consistent at result time (found via the Playwright run: mutating `window.__game.stage` mid-run desynced the prompt copy; harmless in real play but cheap to make robust).
`TOTAL_KICKS` removed from `constants.js` (Phase 1 leftover); nothing references it or `g.kick` anymore.
Verified: `npm test` 8/8, `npm run build` green, and a 19-check Playwright script (goal advance, same-spot retry, try decrement, 5-miss game over, stage-10 -> won transition, no console errors) all passing with screenshots reviewed.
Note for future Playwright runs: screenshot the result banner >=0.4s after the result phase starts, or you catch frame 0 of the 0.35s popIn animation (opacity 0) and the banner looks missing.

## Phase 3: Cup win screen + localStorage persistence
Status: Complete

- [x] Add a win overlay (rendered when `hud.phase === "won"`): trophy visual (🏆 or simple canvas/DOM art), final score, "CUP WINNER" messaging, and a play-again path via the ⚽ button.
- [x] Add a small `src/game/storage.js` (or inline helpers) reading/writing localStorage keys `fkl.bestStage`, `fkl.bestScore`, `fkl.cupWon`; guard against storage being unavailable (private browsing).
- [x] Load persisted bests on mount into HUD state; save at run end (game over or win) when a best improves; set `fkl.cupWon` on win.
- [x] Surface bests on the menu and game-over/win overlays (best stage reached, best score, a small cup badge if `fkl.cupWon`).

### Verification Plan
- `npm run build` succeeds.
- Playwright: force a win via `window.__game`, screenshot the cup screen; reload the page and assert the menu shows the persisted best stage/score and cup badge (read back via `page.evaluate(() => localStorage.getItem(...))`).

### Phase Summary
Done 2026-07-05.
`src/game/storage.js` added: `loadBests()` / `saveRunEnd({ stage, score, won })` over the three `fkl.*` keys; every localStorage access is inside try/catch so private browsing degrades to no persistence.
`MagicalKicks.jsx`: HUD gains `bestStage`/`cupWon` (and `best` is now the *persisted* best score, not session best); bests load in a one-shot effect **declared after the loop effect** so `G.current` exists; `endRun` calls `saveRunEnd` for both game over and win, so `bestStage` records the stage the run *reached* (win records stage 10 + `cupWon`).
A shared `bestLine` pill ("🏆 Best run: stage x/10 · y pts", trophy only when `cupWon`) renders on menu, game-over, and win overlays; it is hidden entirely until a first run ends (`bestStage > 0`).
The Phase 2 placeholder win overlay became the real trophy screen: glowing 🏆, amber "CUP WINNER" headline, final score, best line, amber play-again pill.
Semantics note: `saveRunEnd` compares against stored values itself and returns the merged bests, so the component never does best-keeping math.
Verified: `npm test` 8/8, `npm run build` green, and a 12-check Playwright script (clean storage -> no best line; lose at stage 2 -> keys `2`/`200`/unset + best line on game over; reload -> menu shows bests, no badge; forced win -> cup screen + keys `10`/`1`; reload -> menu cup badge) all passing, screenshots reviewed.

## Phase 4: Playtest pass + documentation
Status: Complete

- [x] Verify stage 10 (`D = 30`) framing on screenshot; adjust `D` or note a camera follow-up if the kicker/ball are poorly framed.
- [x] Full-run smoke test via Playwright: script a complete winning run (forcing goals) and a losing run, checking no console errors and that score/stage/tries never desync.
- [x] Update HANDOVER.md: rewrite §4 (state machine gains `won`, kick loop becomes stage loop), §5 (new tuning knobs: `STAGES`, `TRIES_PER_STAGE`, `STAGE_KP_SIGMA`, `STAGE_GAUGE_SPEED`), §6/§7 (drop the persistence next-step, note any new rough edges), and the §1 description of the game loop.
- [x] Check the stage difficulty curve at least once by actually playing a few stages in a real browser if available; otherwise record in HANDOVER.md §6 that the curve is untested by a human (same caveat pattern the doc already uses).

### Verification Plan
- `npx vitest run` and `npm run build` both pass on the final state.
- The two Playwright run-through scripts complete without console errors.
- HANDOVER.md contains no remaining references to the old kick-based match mode (`grep -i "TOTAL_KICKS\|10 kicks" HANDOVER.md src/` returns nothing stale).

### Phase Summary
Done 2026-07-05.
**Stage 10 framing verified good** - screenshot at `D = 30` shows kicker, ball, wall, box and goal all comfortably in frame under the elevated camera; no `D` pullback or camera change needed (the plan's fallback to 28.5 was not required).
**Full-run smoke tests** (34 Playwright checks): a 10-stage winning run of first-try goals - per-stage score progression matches the formula exactly (total 3125 = sum of `100 + (stage-1)*25 + 4*25`), tries stay at 5, streak climbs to 10, `fkl.*` keys persist `10`/`3125`/`1`; then a losing run of 5 stage-1 misses - tries tick 4→0 with score 0, and the loss does not lower the persisted bests. Every result screen also cross-checked `window.__game` against the DOM info bar (score text, STAGE x/10, lit tries dots) - no desync anywhere, zero console errors.
**HANDOVER.md rewritten** for the cup run: §1 (mode description), §2 (storage.js row, constants row), §3 (persistence note), §4 (state machine with retry/next-stage/won/gameover + `advance()`/try-consumption split, HUD info-row description, keeper `kpSigma` now constant, scenario generation rewritten around the `STAGES` table including the verified stage-10 framing note, scoring formula), §5 (knob table: `STAGES`, `TRIES_PER_STAGE`, `STAGE_GAUGE_SPEED`, `STAGE_KP_SIGMA`, `WIND_UNIT_KMH`, goal-points row; dropped `gaugeSpeed`/`kpSigma` ramps and `MAX_WIND_KMH`), §6 (added: stage difficulty curve untested by a human; wider info bar worsens small-width crowding risk), §7 (persistence step replaced by playtest-the-curve step), §8 (UserDefaults mirrors storage.js keys), §9 (stale prompt swapped).
No human playtest was possible in this session (automated browser only), so the §6 caveat records that the `STAGES` table is a starting point, not a tuned curve.
Verification: vitest 8/8, `npm run build` green, both run-through scripts clean; the only remaining "10-kick" mention in HANDOVER.md is the intentional one describing what the cup run replaced.

## Final Recap
All four phases complete (2026-07-05); the 10-random-kicks match is fully replaced by the stage-based Cup Run.
**physics.js/constants.js** (Phase 1): hand-authored `STAGES` table (10 × `{ d, gx, maxWindKmh }`, D 19→30 m, wind cap 0→10 km/h), `TRIES_PER_STAGE = 5`, constant `STAGE_KP_SIGMA = 0.9` / `STAGE_GAUGE_SPEED = 1.4`; game state carries `stage`/`triesLeft`; `finishKick` owns try consumption and the new scoring `100 + (streak-1)*25 + spareTries*25 (+50 top bin)`; 8 vitest tests cover the table, wind caps, constants and scoring.
**MagicalKicks.jsx** (Phase 2): `advance()` run flow (goal → next stage or `won`; miss → retry or `gameover`), STAGE + TRIES-dots info bar, context-aware result banners/prompts/aria-labels, cup-run menu and game-over copy.
**storage.js + win screen** (Phase 3): guarded localStorage persistence (`fkl.bestStage`/`fkl.bestScore`/`fkl.cupWon`) saved at run end, trophy win overlay, "Best run" pill with cup badge on menu/game-over/win overlays.
**Docs + smoke tests** (Phase 4): HANDOVER.md rewritten as the design record of the new mode; stage-10 framing verified; ~65 Playwright checks across three scratch scripts all green.
Outstanding (recorded in HANDOVER.md §6/§7): the difficulty curve has never been played by a human - the `STAGES` table is a starting point; small-width info-bar crowding is untested on real phones.

## Deployment Plan
This is a static Vite site with no backend and no migrations; deployment is unchanged from before this work.
1. `npm test` and `npm run build` must both pass (they do on the final state).
2. Commit the working tree (constants/physics/tests from Phase 1, MagicalKicks/storage from Phases 2-3, HANDOVER.md + this plan from Phase 4). Nothing has been committed or pushed yet - get explicit approval before pushing to `https://github.com/etuncoz/free-kick-game.git`.
3. Serve `dist/` from any static host (`npm run build` then upload, or `vite preview` to sanity-check locally first).
4. No data migration concerns: the `fkl.*` localStorage keys are new, so existing visitors simply start with empty records. There is no old persisted state to migrate (the previous build stored nothing).
5. Post-deploy sanity check: load the page, win/lose one run, reload, and confirm the "Best run" pill survives the reload.
