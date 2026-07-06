# Game Improvements: 50-Stage Cup Run, Regulation Goal, Stage Personalities, Visual Polish

Seven gameplay/UI improvements to Free Kick Legend, developed on `feature/game-improvements`, one local commit per task, PR to `development` at the end.
Decisions were confirmed with Ege on 2026-07-06: 5 laps of the 10 archetypes for stages 11-50, keeper reach scaled down with the regulation goal, all five polish items, and the mobile HUD fix targets the uneven stat-row distribution seen in his screenshot.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on.
When all phases are done, fill in **Final Recap** and **Deployment Plan**.
Key constraints: never add the agent as commit co-author; no em dash anywhere; PR goes to `development`; never push without permission; `npm test` runs vitest.

## Phase 1: Remove the perfect-lock feature (task 1)
Status: Complete

- [x] Delete `PERFECT_BANDS`, `PERFECT_POINTS`, `PURE_STRIKE_POINTS`, `PURE_STRIKE_SPEED_BONUS` from `src/game/constants.js`
- [x] Delete `perfectLock()` from `src/game/physics.js`; drop `g.perfects` / `g.pureStrike` state, the launch speed bonus, and the perfect/pure-strike scoring + `resultDetail` branches
- [x] Remove the gold band overlays, `lockedPerfect` marker/label colouring, and `PERFECT_BANDS` import from `src/game/MagicalKicks.jsx`
- [x] Remove the perfect-lock test suite and perfect-related assertions from `src/game/physics.test.js`
- [x] Commit

### Verification Plan
- `npm test` passes; a case-insensitive grep for `perfect|pure` in `src/` returns nothing

### Phase Summary
Removed the whole system in one pass: constants (PERFECT_BANDS + three bonus constants), physics (perfectLock, g.perfects, g.pureStrike, launch speed bonus, scoring and resultDetail branches), JSX (gold band overlays, lockedPerfect colouring, imports), and the entire "perfect locks and pure strike" test suite.
Verified: 30 tests pass; the only remaining perfect/pure grep hits are unrelated prose comments.
Commit cb02b60.

## Phase 2: Regulation goal + keeper reach scaling (task 2)
Status: Complete

- [x] Set `GOAL_HALF = 3.66`, `GOAL_H = 2.44` in constants.js (regulation 7.32 x 2.44)
- [x] Express keeper reach relative to the goal size in physics.js so corners stay his weak spot: dive reach clamp (was ±3.35), initial position clamp (was ±2.2), and predY clamp (was 2.3) all scale by the goal ratio
- [x] Commit

### Verification Plan
- `npm test` passes (aiming tests derive from GOAL_HALF so they self-adjust)
- Corner-aim shot beats a correctly-guessing keeper in a scripted sim; a central shot is still saved

### Phase Summary
GOAL_HALF 3.66 / GOAL_H 2.44. Keeper coverage now derives from goal size in physics.js: KP_REACH_X = 0.68 * GOAL_HALF, start clamp 0.48 * GOAL_HALF, predY cap 0.75 * GOAL_H.
Important discovery: the diving keeper's body TIP extends ~0.8m beyond the reach clamp, so a naive 0.73 fraction left only a 4% beatable corner strip; a vitest sim sweep found 0.68 restores the ~9% proportion of the old goal (boundary ~3.35m, goal edge 3.61m).
The late-curl misread test was re-aimed to gx - 1.2 (keeper stays standing for both predictions) because dive/clamp interactions at the old -3.0 aim no longer produce an exact misread delta.
Added permanent regression test: corner aim GOAL vs exact-guess keeper, -3.0 SAVED. 31 tests pass. Commit 8f5a403.

## Phase 3: Mobile HUD stat row distribution (task 3)
Status: Complete (visual check deferred to Phase 8)

- [x] In MagicalKicks.jsx, make the two stat groups each span the full width on phones with `justify-between` (SCORE / STAGE / TRIES row and DISTANCE / WIND / mute row), reverting to the grouped single-row layout from `sm` up
- [x] Commit

### Verification Plan
- Vite dev server + Chrome at ~449px width: both stat rows spread edge to edge, no dead right space; desktop width unchanged

### Phase Summary
Both stat group containers got `w-full sm:w-auto justify-between sm:justify-start`: below `sm` each group wraps to its own full-width row and distributes its three stats edge to edge; from `sm` up the original grouped layout is untouched.
Commit 671f4a3.
NOTE: the Chrome extension was not connected during this phase, so the visual check in the Verification Plan is still owed - it is folded into Phase 8's E2E pass.

## Phase 4: 50-stage cup run, a cup every 10 stages (task 5)
Status: Not started

- [x] Restructure constants.js: keep the 10 authored stages as archetypes; add `stageSpec(stage)` returning the effective `{d, gx, maxWindKmh, name, mods, lap}` for stages 1-50 (lap = floor((stage-1)/10); names get II/III/IV/V suffixes; distance +1.5m per lap capped at 35; keeper sigma sharpens ~6% per lap)
- [x] `TOTAL_STAGES = 50`, `STAGES_PER_LAP = 10`, `CUP_EVERY = 10`
- [x] physics.js `newScenario` reads `stageSpec(g.stage)` instead of `STAGES[g.stage-1]`
- [x] Add `advanceOutcome(g)` helper in physics.js returning `"cup" | "next" | "won" | "retry" | "gameover"` so the flow is unit-testable
- [x] MagicalKicks.jsx: `advance()` uses `advanceOutcome`; a `"cup"` outcome shows a cup celebration overlay (cup N of 5) and continues to the next stage; the stage-50 cup ends the run as `won`
- [x] storage.js: persist best cups-in-a-run (`fkl.cups`), keep legacy `cupWon` semantics (any cup ever); menu best line shows cups
- [x] Update tests: stage spec pinning across laps, name suffixes, `advanceOutcome` flow, storage round-trip
- [x] Commit

### Verification Plan
- `npm test` passes with the new suites
- Dev-console sim: set `__game.stage = 10`, score, expect the cup overlay; stage 50 expects the win screen

### Phase Summary
stageSpec(stage) in constants.js derives any of the 50 stages from the 10 authored archetypes (lap suffixes via LAP_SUFFIX, d +1.5/lap capped 35, effective mods.kpSigma = (mod ?? STAGE_KP_SIGMA) * (1 - 0.06 * lap); wind cap intentionally NOT yet scaled - that is Phase 5).
physics.js: newScenario reads stageSpec; advanceOutcome(g) added; g.cups counts cups this run.
MagicalKicks.jsx: advance() switches on advanceOutcome; new "cup" phase with a CUP SECURED ceremony overlay handing to the next stage; won screen is now a five-trophy FREE KICK LEGEND screen; menu/game-over copy updated; STAGE stat shows a 🏆N chip mid-run; hud gained cups/bestCups (cupWon dropped).
storage.js rewritten: fkl.cups (best cups in one run), legacy fkl.cupWon folded in on read; saveRunEnd takes {stage, score, cups}.
Tests: new stageSpec + advanceOutcome suites in physics.test.js, new storage.test.js with a stubbed localStorage. 46 tests pass, production build clean. Commit a261598.
The dev-console cup/win sim is deferred to Phase 8 with the rest of the browser checks (extension offline).

## Phase 5: Wind scaling to 20 km/h (task 4)
Status: Complete

- [x] In `stageSpec`: wind cap scales `base * (1 + 0.25 * lap)` so THE FINAL V hits exactly 20 km/h; windless archetypes (THE OPENER) stay windless on every lap
- [x] Lower random bound rises with lap: effective `windMinFrac = max(stage mod, 0.15 * lap)` capped at 0.6 (the cap only limits the lap floor; an authored mod above it is kept, e.g. SWIRLING GALE 0.75)
- [x] Tests: cap never exceeded across all 50 stages, stage 50 cap is exactly 20, min-fraction floor honoured on late laps
- [x] Commit

### Verification Plan
- `npm test` passes; a multi-hundred-roll sweep over stages 41-50 never rolls below the floor or above the cap

### Phase Summary
Wind scaling landed in stageSpec exactly as planned: cap = base * (1 + 0.25 * lap) (stage 50 = 20 km/h, OPENER stays 0 on all laps), floor = max(authored windMinFrac, min(0.6, 0.15 * lap)).
Tests: 40-roll cap sweep across all 50 stages, 200-roll floor sweep on stage 45 (SIDE ROAD V, floor 0.6), exact-cap and calm-stage assertions, authored-floor preservation (SWIRLING GALE II 0.75). 48 tests pass. Commit eee45c9.

## Phase 6: Stage characteristics (task 7)
Status: Complete (visual FORTRESS check deferred to Phase 8)

- [x] New mods in physics.js: `wallScale` (player size + collision top + per-man width), `kpReach` (reach multiplier), `kpBias` (metres toward the near post, negative = far post), `gaugeSpeed`, `windSwirl` (rad/s wind rotation during flight), `wallJitter`
- [x] render.js draws wall players scaled by `wallScale`
- [x] Stage personalities: OPENER (wall 3, kpSigma 1.2), OFF CENTRE (kpBias -1.2), THE CAT (kpSigma 0.45, kpReach 1.15, wall 3), GREAT WALL (wall 6, no jump, wallScale 1.35), SIDE ROAD (wall 5, wallJitter 0), SWIRLING GALE (windMinFrac 0.85, windSwirl 1.5), TIGHT ANGLE (kpBias 1.8), LONG RANGE (gaugeSpeed 1.35, wall 3), FORTRESS (wall 5, wallScale 2.0, no jump, kpSigma 0.7), THE FINAL (wall 5, wallScale 1.2, jump always, windMinFrac 0.5, kpSigma 0.8)
- [x] Tests per personality (wall size/scale pinning, keeper bias positions, swirl rotates wind, gauge speed override)
- [x] Commit

### Verification Plan
- `npm test` passes; visual spot-check of the FORTRESS double-size wall in the browser

### Phase Summary
All six mods implemented in physics.js newScenario/launch/step; render.js scales the drawn wall (and divides the jump lift back out so the drawn jump equals the physics jump).
kpBias semantics: metres toward the NEAR post (the post closer to the kicker, direction -sign(gx)); the start clamp (0.48 * GOAL_HALF ~ 1.76m) still applies, so TIGHT ANGLE's 1.8 pins him at his limit.
windSwirl rotates the wind acceleration vector per substep (direction of rotation is arbitrary; the test asserts |rotation| = swirl * t and magnitude preservation).
Ten personality tests added, including a FORTRESS collision test (a 2.5m crosser clears stage 1's wall but is WALLed by the 3.72m fortress) and a 30-roll SIDE ROAD jitter-free placement check. 58 tests pass. Commit 33176b9.

## Phase 7: Visual polish, all five items (task 6)
Status: Complete (screenshot review deferred to Phase 8)

- [x] Players: articulated kick swing on the kicker (backswing leg via pose), jersey numbers on wall players, keeper gloves + spread dive pose
- [x] Ball: black pentagon panel pattern rotating with spin, swerve-tinted curved trail, radial-gradient soft shadow
- [x] Stadium: crowd sway animation, camera flashes during goal celebrations, advertising boards at the stand foot, floodlight beams with haze
- [x] Goal: specular highlight pass on posts/crossbar, depth threads on the side nets, net sway with the wind
- [x] Pitch: worn dirt patch at the kick spot, penalty arc, subtle match-night vignette
- [x] Commit

### Verification Plan
- `npm test` still passes (render is presentation-only)
- Browser screenshot review at mobile + desktop widths; no visible frame jank in a ~30s session

### Phase Summary
All five packs landed in render.js only (drawPlayer gained kickSwing/number/gloves options; drawScene gained an ambient clock `t`).
Notable details: the crowd sway doubles in speed/amplitude while celebrating; ad board copy is FREE KICK LEGEND / TOP BINS ONLY / CUP RUN '26 / BEND IT LIKE YOU; the trail tint keys off g.locked.s (amber right, cyan left, white straight); the net sway term scales with height so the mesh top billows more; the kicker's swing profile is wind-up over runP 0-0.75 then a whip through to follow-through at 1.
58 tests pass, build clean. Commit 7d4ce6c. Screenshot/jank review still owed in Phase 8.

## Phase 8: Full verification + PR to development
Status: Complete

- [x] `npm test` green (58 tests), `npm run build` clean
- [x] E2E (mobile 449px + desktop 1280px): full stage-1 playthrough, cup at stage 10 via dev hook, stat rows evenly spread, FORTRESS wall, gauge panel without gold bands
- [x] Push the branch and open the PR to `development` (explicitly requested by Ege; no agent co-author lines)

### Verification Plan
- All of the above, recorded in the Phase Summary

### Phase Summary
The Chrome extension never connected this session, so E2E ran through headless Chrome driven over raw CDP (scratchpad script using Node's built-in WebSocket; screenshots reviewed by the agent).
Verified at 449px: menu copy (50 stages, cups), stat rows spanning 411px of the 435px bar with zero right-edge gap on both rows, zero amber band elements, a full kick cycle (aim -> flight -> result OVER), FORTRESS at stage 9 (wallN 5, wallScale 2, no jump, visibly giant numbered wall), CUP SECURED overlay on clearing stage 10 then stage 11, TIGHT ANGLE keeper at kpStart - gx = +1.76, FREE KICK LEGEND five-trophy screen on clearing stage 50. Desktop 1280px: grouped single-row stats, polish visible (numbered players, pentagon ball, ad boards, beams, vignette). No page errors.
One real bug found and fixed: windless stages could show the wind arrow pointing at the kicker because atan2(0, -0) = 180deg; windDeg is now forced 0 at zero magnitude (commit 69d29e5, with a regression assertion).

## Final Recap
All seven improvements landed on `feature/game-improvements` as per-task commits:
cb02b60 removed the perfect-lock feature end to end; 8f5a403 restored the regulation 7.32 x 2.44 goal with keeper coverage expressed as goal-size fractions (reach fraction 0.68 tuned by sim sweep so the beatable corner strip stays proportional); 671f4a3 distributed the mobile HUD stat rows edge to edge; a261598 turned the run into a 50-stage marathon (5 laps of the 10 archetypes via stageSpec, cup ceremony every 10 stages, LEGEND screen at 50, best-cups persisted in fkl.cups); eee45c9 scaled wind to exactly 20 km/h at stage 50 with a rising per-lap floor; 33176b9 gave every archetype a mechanical personality through six new mods (wallScale, kpReach, kpBias, gaugeSpeed, windSwirl, wallJitter); 7d4ce6c added all five visual polish packs (players, ball, stadium, goal, pitch); 69d29e5 fixed the windless-arrow bug found in E2E.
The suite grew from 30 to 58 tests, all green; production build clean; mobile and desktop E2E verified in headless Chrome.

## Deployment Plan
1. PR #4 (`feature/game-improvements` -> `development`) is open: https://github.com/etuncoz/free-kick-game/pull/4 - Ege reviews and merges it himself (repo rule: PRs only, Ege approves each one).
2. After merge, cut the usual release PR `development` -> `main`; merging to `main` triggers the GitHub Pages deploy workflow (it retries once on transient failures per the Pages runbook).
3. Post-deploy smoke test on the published site: phone-width viewport, confirm the menu says 50 stages with cups, stat rows spread edge to edge, gauges have no gold bands, and stage 1 presents THE OPENER's 3-man wall.
4. Note for players: existing localStorage records carry over; a legacy cupWon flag reads as 1 cup.
