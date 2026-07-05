# Mobile-Friendly Game UI

Make Free Kick Legend comfortably playable on phones: the whole game fits one portrait screen at >= 360 px wide with no scrolling, the entire pitch view is a tap target, and the info/gauge panel stops crowding at narrow widths. Delivered as a PR from a feature branch into `development` (PR-only workflow; Ege reviews personally).

## Confirmed design decisions (user Q&A, 2026-07-05)

- **Tap target**: the whole canvas becomes a tap trigger for every phase action, in addition to the ⚽ button. Guard against double-firing (the button sits inside the canvas wrapper).
- **One-screen portrait fit**: pitch + info bar + gauges all visible with no scrolling on a ~360×640 phone. Keep the canvas 16/10 aspect (the camera composition is tuned to it); win the space by compacting the panel instead.
- **Landscape**: portrait-first; landscape must merely not break (scrolling allowed, no horizontal overflow, nothing clipped).
- **Minimum width**: 360 px. The info bar wraps into two rows below `sm`; the stage name stays `md+`-only.

## Implementation decisions (documented, not user-blocking)

- `index.html` viewport meta gains `viewport-fit=cover`; page container uses `min-h-dvh` (not `100vh` - iOS URL-bar bug) and safe-area bottom padding.
- `touch-action: manipulation` on the page root to kill the double-tap-zoom delay on the rapid triple tap.
- Double-fire guard: the ⚽ button stops `pointerdown` propagation and keeps its `onClick`; the wrapper handles `pointerdown` for everything else. Desktop keyboard (Space/Enter) unchanged.
- The footer tagline hides below `sm` to buy vertical space.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done, set its status to `Complete` and write its **Phase Summary**; run the phase's **Verification Plan** and record the result before moving on. When all phases are done, fill in **Final Recap** and **Deployment Plan**.
Read HANDOVER.md first (§3 "Branching, CI & deployment": PR-only workflow - never push to `development`/`main`; open the PR, arm auto-merge, and stop for Ege's review).
The 60 fps loop must never touch React state; `physics.js` stays free of React/DOM imports (untouched by this work).
E2E pattern: Playwright in the session scratchpad (HANDOVER.md §10), `npm run dev` background server, `window.__game` hook.

## Phase 1: Portrait layout fit at 360 px
Status: Complete

- [x] `index.html`: extend the viewport meta with `viewport-fit=cover`.
- [x] `MagicalKicks.jsx` page container: `min-h-screen` → `min-h-dvh`, add `touch-action: manipulation` and safe-area-inset bottom padding; reduce the outer padding below `sm`.
- [x] Info bar: allow the stat row to wrap into two lines below `sm` (left group SCORE/STAGE/TRIES, right group DISTANCE/WIND/mute), with tightened gaps; verify no horizontal overflow at 360 px.
- [x] Gauge panel: tighten paddings/gaps below `sm` (three columns stay side by side).
- [x] Hide the footer tagline below `sm`.
- [x] Verify one-screen fit: at 360×640 and 390×844 the page has no vertical or horizontal scrolling in menu, aim, and result phases.

### Verification Plan
- Playwright at 360×640 and 390×844: `document.documentElement.scrollHeight <= window.innerHeight` and `scrollWidth <= innerWidth` across menu/aim/result; screenshots reviewed.
- `npm test` and `npm run build` pass (no logic touched, but always gate).

### Phase Summary
Done 2026-07-05.
All planned items landed as written (flex-wrap two-row info bar, `min-h-dvh`, `touch-action: manipulation` inline style, `max(0.375rem, env(safe-area-inset-bottom))` bottom padding, tightened sub-`sm` paddings, footer hidden).
One item the plan missed, caught by screenshot review: the **menu/game-over/won overlays were clipped by the short 16/10 canvas** at phone sizes (title and CTA cut off) - the no-scroll assertions couldn't see it because the clipped content doesn't create scroll. Fixed by making those three overlays `fixed inset-0 z-30` (full-screen, `overflow-y-auto`, slightly more opaque backdrop) below `sm`, `absolute` as before from `sm` up. They stay inside the wrapper DOM so tap-anywhere still advances.
Lesson recorded for future verification: pair geometric assertions with element-visibility checks (`boundingBox` inside viewport) - the suite now asserts the menu headline and CTA are fully on screen.

## Phase 2: Whole-canvas touch trigger
Status: Complete

- [x] Canvas wrapper div gets `onPointerDown={onAction}` (restoring the original whole-surface trigger, now alongside the button); wrapper gets `cursor-pointer` and a `role="button"`/aria-label for the active phase.
- [x] ⚽ button: `onPointerDown` stops propagation so a button tap fires exactly one action; keyboard path untouched.
- [x] Confirm overlays: menu/game-over/won overlays sit inside the wrapper so tapping them starts the game (intended); the result banner stays `pointer-events-none`.
- [x] E2E with a touch context (`hasTouch`): play a full kick (three gauge locks + advance) using only canvas taps at 360×640; assert exactly one lock per tap (no double-fire when tapping the ⚽ button itself).

### Verification Plan
- Playwright touch-emulation script: canvas taps drive menu→aim1→aim2→aim3→flight and result→next; tapping the ⚽ button advances exactly one phase per tap.
- `npm test` + `npm run build` green.

### Phase Summary
Done 2026-07-05.
Exactly as planned: wrapper `onPointerDown={onAction}` + `cursor-pointer` + `role="button"` with a tap-oriented aria-label; the ⚽ button's `onPointerDown` stops propagation (its `onClick` remains the single action source), so a button tap fires once. Canvas taps during `runup`/`flight`/`settle` hit `onAction`'s default branch harmlessly.
Verified at both portrait viewports with touch contexts: full kick driven by canvas taps only, and a forced-`aim1` button tap advanced exactly one phase (`aim1 → aim2`, not `aim3`).
Playwright note for future scripts: the ⚽ button's perpetual `floaty` animation never passes tap-stability checks - use `tap({ force: true })`.

## Phase 3: Landscape sanity, regression, PR
Status: Complete

- [x] Landscape 640×360 + 844×390: no horizontal overflow, nothing clipped; scrolling allowed; screenshot reviewed.
- [x] Desktop regression: 1000×800 screenshot visually unchanged; full-run smoke suite (verify-stage4 pattern, keyboard-driven) still passes.
- [x] HANDOVER.md: update §4 "HUD & interaction model" (canvas-wide trigger returns, double-fire guard, mobile layout paragraph) and §6 (crowding caveat replaced with an emulator-verified-not-device-verified note).
- [x] Open the PR from the feature branch to `development`, arm auto-merge, stop for Ege's review.

### Verification Plan
- All Playwright checks green; `npm test` (35) + `npm run build` pass on the final state.
- `gh pr checks` green on the PR; auto-merge armed.

### Phase Summary
Done 2026-07-05.
Landscape at 640×360 and 844×390 shows no horizontal overflow (vertical scroll allowed by design; at exactly 640 wide the `sm` breakpoint applies, so overlays render in-canvas there). Desktop 1000×800 renders identically to before and the keyboard path is untouched; the 34-check full-run smoke suite passes. 23-check mobile suite green. HANDOVER §4/§6 updated. PR opened per the PR-only workflow.

## Final Recap
The game is now phone-playable (2026-07-05), delivered as PR #2 (`feature/mobile-ui` → `development`):
- **One-screen portrait fit from 360 px**: `min-h-dvh` root, `viewport-fit=cover`, safe-area bottom padding, two-row wrapping info bar below `sm`, tightened panel spacing, hidden footer tagline. No scrolling in menu/aim/result at 360×640 and 390×844.
- **Full-screen phone overlays**: menu/game-over/won switch from in-canvas `absolute` to `fixed z-30` below `sm` - fixes a real clipped-content bug the plan hadn't anticipated (the 16/10 canvas is only ~217 px tall at 360 wide).
- **Whole-canvas tap trigger** alongside the ⚽ button, with a pointerdown-propagation guard so button taps fire exactly once; `touch-action: manipulation` kills double-tap zoom on the rapid triple tap.
- **Verified**: 23 mobile checks (fit, overlay visibility, touch-only kick flow, single-fire, landscape overflow, desktop keyboard), 34-check desktop regression suite, 35 unit tests, production build - all green. Real-device feel remains unverified (HANDOVER §6 notes it).
No physics/game-logic files were touched - `MagicalKicks.jsx`, `index.html`, docs, and this plan only.

## Deployment Plan
Nothing deployment-specific in this change; it rides the standard pipeline:
1. Ege approves PR #2 (auto-merge is armed; it lands on `development` by itself and CI re-runs on the push).
2. Release to GitHub Pages whenever desired by opening a deploy PR `development` → `main`; merging it triggers the Pages workflow.
3. Post-deploy: open the live site on an actual phone - the first real-device playtest - and sanity-check the one-screen fit and triple-tap feel.
