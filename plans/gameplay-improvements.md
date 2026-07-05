# Gameplay Improvements: Curl Misread, Ghost Markers, Stage Personalities, Sweet Spots

Implement four confirmed gameplay improvements on top of the cup-run mode: make swerve beat keepers (late-curl misread), turn retries into a learning loop (fading ghost markers of previous tries), give stages authored personalities (names + mechanical gimmicks), and add an execution skill ceiling (visible perfect-lock bands with a PURE STRIKE bonus).
Each phase is committed and pushed on its own once verified (user instruction).

## Confirmed design decisions (user Q&A, 2026-07-05)

- **Curl misread**: keeper under-reads swerve ("60%" option = roughly a 1 m misjudge at full swerve). Implemented as `KP_CURL_MISREAD = 1.0` m: the keeper's predicted arrival shifts `s · KP_CURL_MISREAD` toward the bow side, distance-independent (a raw fraction of the curl term would blow up with T² on far stages). Straight shots unchanged.
- **Ghost markers**: ALL previous tries of the current stage (up to 4), fading with age. A marker records where the try ended - the goal-plane crossing, or the wall-plane impact for blocked shots - and renders as an X at that world position. Cleared when the stage changes (advance or new run).
- **Stage personalities**: stages get short display names (shown in the info bar and the stage-start/result banners) and optional mechanical overrides in the `STAGES` table: `wallN` (fixed wall size), `wallJumpChance`, `kpSigma`, `windMinFrac` (wind always rolls at least this fraction of the cap). Non-gimmick stages just get names.
- **Sweet spots**: visible thin gold bands on the gauges. HEIGHT band ~[0.36, 0.44] (textbook strike). DIRECTION: two corner bands just inside each post (rewards picking a corner, not shooting at the keeper). SWERVE band [0.47, 0.53] (clean straight hit - deliberately in tension with the curl misread: pure striker vs curler are two viable styles). Per perfect lock: +25 points on a goal; all three = PURE STRIKE: additional +100 and +1.2 m/s ball speed. Locks inside a band flash the gauge label gold.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.
Read HANDOVER.md first: `physics.js` must stay free of React/DOM/audio imports (it ports to Swift verbatim), and the 60 fps loop must never touch React state.
Commit and push at the end of EVERY phase (user instruction) - do not batch phases into one commit.
E2E pattern: Playwright scripts in the session scratchpad (HANDOVER.md §10), dev server via `npm run dev` in background, `window.__game` dev hook for rigging; screenshot banners >= 0.4 s after the result phase starts (popIn animation).

## Phase 1: Late-curl keeper misread
Status: Complete

- [x] Add `KP_CURL_MISREAD = 1.0` (metres at full swerve) next to the other keeper constants in `physics.js`; in `launch()`, shift the keeper prediction by `s * KP_CURL_MISREAD` toward the bow side (add to `predX` before clamping).
- [x] Unit tests: with gauss noise mocked to 0, `launch` with `s = 1` produces a keeper target ~1 m bow-side of the true arrival, while `s = 0` stays on it; integration test that a full-swerve shot aimed at a corner beats the keeper where the same unswerved aim gets saved (keeper positioned via the real prediction, wall disabled).
- [x] HANDOVER.md: update §4 keeper AI + swerve sections and the §5 knob table with `KP_CURL_MISREAD`.
- [x] `npm test` + `npm run build` green; commit and push.

### Verification Plan
- `npx vitest run` passes, including the new misread tests.
- `npm run build` succeeds.

### Phase Summary
Done 2026-07-05.
`KP_CURL_MISREAD = 1.0` exported from `physics.js` beside the keeper capsule constants; `launch()` adds `s * KP_CURL_MISREAD` into `predX` before the reachable clamp, so the keeper commits ~1 m toward the bow side of a curled ball while straight shots stay perfectly read.
Chose a constant metre offset over a fractional curl under-read because the curl term grows with T² and a fraction would have handed far stages a much larger edge than near ones.
Two tests added (21 total): with noise mocked to zero, `kpTarget` shifts by exactly the misread between s=0 and s=1 under an identical dive pose; and the same corner aim (arrival gx−3.0) is SAVED straight but GOAL at full swerve.
Note for later phases: the keeper capsule is ~0.6 m thick around a diagonal body, so 1 m of misread beats him on corner arrivals but a dead-centre curled ball can still be edge-saved - that's intended (curl into corners, not at the keeper).
Verified: vitest 21/21, build green.

## Phase 2: Ghost markers of previous tries
Status: Complete

- [x] `physics.js`: add `g.tryMarks = []` to `createGameState`; in `finishKick`, push `{ x, y, z, result }` (goal-plane crossing for WIDE/OVER/POST/SAVED/GOAL at `z = D`; wall impact at `z = wallZ` for WALL) - pass the impact coords through from the WALL branch which currently doesn't; cap the array at `TRIES_PER_STAGE - 1` entries.
- [x] Clear `tryMarks` in `newScenario` ONLY when entering a fresh stage (`triesLeft === TRIES_PER_STAGE`), so retries keep the history.
- [x] `render.js`: draw each mark as a small X at its projected world position, opacity fading with age (newest brightest), during aim/runup phases.
- [x] Unit tests: a miss records a mark with the crossing coords; a second miss appends; marks survive `newScenario` on retry but are cleared on stage advance; WALL records at the wall plane.
- [x] E2E: miss twice at distinct spots, screenshot showing two fading X marks; verify marks gone after advancing a stage.
- [x] HANDOVER.md §4 note; `npm test` + build green; commit and push.

### Verification Plan
- `npx vitest run` passes including tryMarks tests.
- Playwright screenshot shows the X markers during a retry and none after stage advance.

### Phase Summary
Done 2026-07-05.
`g.tryMarks` records each finished try (`{x, y, z, result}`): goal-plane crossings at `z = D`, wall impacts at `z = wallZ` (the WALL branch now passes its impact coords to `finishKick`; the flight-timeout WIDE has no coords and is deliberately skipped via the `hitX != null` guard).
Cleared in `newScenario` only when `triesLeft === TRIES_PER_STAGE` (same fresh-stage condition as the wall-size roll); capped at `TRIES_PER_STAGE − 1`.
`render.js` draws amber X marks with age fading (newest 0.85 alpha, −0.2 per step older), only during `aim1/2/3` + `runup` so a live ball is never cluttered; drawn after the goal frame, before the keeper, so wall/keeper correctly occlude marks behind them.
Also fixed a pre-existing flaky test discovered this phase: `windZ` can be `-0` (zero magnitude × negative cosine) and `toBe(0)` uses Object.is, which rejects `-0` - switched the stage-1 windless assertions to `== 0` comparisons.
Tests 21 → 25; E2E verified two distinct fading marks on retry (screenshot reviewed) and a clean slate after stage advance; build green.

## Phase 3: Stage personalities (names + gimmick overrides)
Status: Not started

- [ ] `constants.js`: extend `STAGES` entries with `name` and optional `mods` (`wallN`, `wallJumpChance`, `kpSigma`, `windMinFrac`); author the 10 names with gimmicks on stages 3 ("THE CAT", kpSigma 0.55), 4 ("THE GREAT WALL", wallN 6 + wallJumpChance 0), 6 ("SWIRLING GALE", windMinFrac 0.75), 9 ("THE FORTRESS", wallN 5 + kpSigma 0.7), 10 ("THE FINAL", windMinFrac 0.5 + kpSigma 0.8); plain names elsewhere.
- [ ] `physics.js` `newScenario`: apply the mods (wall size fixed by `wallN` mod instead of the per-stage roll; jump chance override; kpSigma override; wind magnitude `rnd(windMinFrac * maxW, maxW)`); include `stageName` in the HUD patch.
- [ ] `MagicalKicks.jsx`: show the stage name in the info bar next to STAGE and in the goal banner ("STAGE x - THE CAT - CLEAR"); wall-size support for 6 players (render loop already generic).
- [ ] Unit tests: gimmick stages apply their overrides (wall 6 + never jumps on stage 4; wind >= 0.75 cap over many rolls on stage 6; kpSigma 0.55 on stage 3); non-gimmick stages keep defaults; every stage has a non-empty name; patch carries `stageName`.
- [ ] E2E: screenshot stage 4's six-man wall and the named banner/info bar.
- [ ] HANDOVER.md: §4 scenario generation + §5 STAGES row describe names/mods; `npm test` + build green; commit and push.

### Verification Plan
- `npx vitest run` passes including the stage-mod tests.
- Playwright screenshot shows a 6-man wall on stage 4 and the stage name in the UI.

### Phase Summary
_(write when phase completes)_

## Phase 4: Perfect-lock sweet spots + PURE STRIKE
Status: Not started

- [ ] `constants.js`: add `PERFECT_BANDS` (`h: [0.36, 0.44]`, `d`: corner bands `[0.5 - 0.175, 0.5 - 0.175 + 0.05]` and mirrored right band just inside each post edge, `s: [0.47, 0.53]`) and `PURE_STRIKE_SPEED_BONUS = 1.2`, `PERFECT_POINTS = 25`, `PURE_STRIKE_POINTS = 100`.
- [ ] `physics.js`: a `perfectLock(key, value)` helper evaluating the bands (d checks both corner bands); track `g.perfects = { h, d, s }` set at each lock (populated from the component via a pure function, or computed in `launch()` from `g.locked` - prefer computing all three in `launch()` to keep physics the owner); PURE STRIKE adds `PURE_STRIKE_SPEED_BONUS` to launch speed; `finishKick` GOAL branch adds `PERFECT_POINTS` per perfect + `PURE_STRIKE_POINTS` if all three, appending "Pure strike!" to the result detail.
- [ ] `MagicalKicks.jsx`: draw the gold bands on all three gauge tracks (two slivers on DIRECTION); flash the gauge label gold on a perfect lock (DOM-imperative like the markers, or a brief CSS class toggle on lock - locks happen at React-event time so setState is fine).
- [ ] Unit tests: band membership per gauge (both corner bands on d); goal scoring with 0/1/3 perfects pays the right totals; pure strike raises launch speed; no bonus on a miss.
- [ ] E2E: lock all three inside the bands via `window.__game` (set `locked` directly pre-launch), force the goal-plane crossing, assert the score includes the bonuses and the banner mentions the pure strike; screenshot the gauges showing the gold bands.
- [ ] HANDOVER.md: flight model + scoring + §5 knobs; `npm test` + build green; commit and push.

### Verification Plan
- `npx vitest run` passes including sweet-spot tests.
- Playwright screenshot shows the gold bands; scripted pure-strike goal pays 25·3 + 100 extra points.

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
