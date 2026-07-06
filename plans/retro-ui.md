# Retro UI: Twilight Pixel restyle

Restyle the whole game to the "Twilight Pixel" retro look from Ege's design screenshot: flat colors, pixel font, dot-matrix crowd, chunky goal, pixel sprites, segmented gauges.
Presentation only: physics, storage, audio, and game flow are untouched.

## Design reference

The target is the "Twilight Pixel" mock (deep navy dusk, warm floodlights, gold accent).
Decisions confirmed with Ege on 2026-07-06:

- Flat restyle at native canvas resolution (no low-res upscale). Crisp lines, pixel-art sprites, all gradients removed.
- Press Start 2P everywhere (DOM and canvas text), loaded from Google Fonts like Cascadia was. Sizes tuned down since it runs wide.
- Full scope: canvas scene, stats bar, gauges, all overlays (menu, result, cup, game over, win), and the ball button.
- Gauge tracks become segmented cells but the marker still glides smoothly. Gameplay feel unchanged.
- Palette stays in the current family, flattened: deep navy `#0a1030`-ish, gold `#fbbf24` accent.
- Rounded card corners stay. No CRT effects (no scanlines, no bloom).

## Branch and dependency

Work happens on `feature/retro-ui`, branched off `feature/admin-level-panel` (PR open at the time) because the retro work edits the same files.
Merge order: admin-level-panel PR first, then this branch's PR into `development`.

## For Future Agents
As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done, set its status to `Complete` and write its **Phase Summary** (what was done, key decisions, anything needed to continue with zero context); run the phase's **Verification Plan** and record the result before moving on.
When all phases are done, fill in **Final Recap** and **Deployment Plan**.

E2E verification setup for this repo: the Chrome extension does not connect here.
Use headless Chrome over raw CDP against `npm run dev`, drive game phases through the `window.__game` dev hook, and read screenshots.
Module-level checks run through vitest (`npx vitest run`).

## Phase 1: Pixel font foundation
Status: Not started

- [ ] Replace the Cascadia Code Google Fonts `<link>` in `index.html` with Press Start 2P (weight 400 only; the face has no other weights).
- [ ] Switch `DISPLAY_FONT` and the root container `fontFamily` in `MagicalKicks.jsx` to `'Press Start 2P', monospace`, dropping `fontWeight: 700` (the face is single-weight; bold synthesizes badly).
- [ ] Switch the two canvas `ctx.font` strings in `render.js` (jersey numbers at ~line 125, ad boards at ~line 306) to `'Press Start 2P'`.
- [ ] Retune font sizes across the HUD and overlays so the wide face fits: stat values, gauge labels, menu title, result title, prompts. Target no overflow at 360px CSS width.

### Verification Plan
- `npx vitest run` passes (no rendering tests exist; this guards against accidental logic edits).
- Start `npm run dev`, screenshot via headless Chrome CDP at 1280x800 and 390x844 on the menu and (via `__game`) an aim phase; confirm the pixel font renders (not a fallback) and nothing overflows or wraps out of its card.

### Phase Summary
_(write when phase completes)_

## Phase 2: Canvas scene flat restyle
Status: Not started

All in `src/game/render.js`.

- [ ] Crowd: replace the random dot field with a grid-ordered dot matrix (rows/columns with slight per-dot color variation) in the SS palette: orange/red/yellow/cyan dots on deep navy. Keep the sway, goal-celebration bounce, camera flashes, and tier walkways.
- [ ] Sky and floodlights: flat navy sky band (no gradient), flat polygonal floodlight beams with hard edges, simple flat fixture rectangles. Remove the radial glow gradients.
- [ ] Pitch: flat saturated green, vertical mowing stripes (alternating light/dark bands across x in world space), no vertical gradient. Keep touchlines, goal line, penalty box, arc, and the six-yard box as-is.
- [ ] Worn dirt at the kick spot: flat ellipse (one or two flat tones), no radial gradient.
- [ ] Goal frame: chunky uniform white strokes with squared ends (`lineCap: butt`), drop the dark offset pass and the specular highlight pass. Keep the net grid, deformation, ripple, and side netting.
- [ ] Goal flash: replace the radial-gradient burst with a flat expanding ring plus a short flat starburst; keep the net-backing gold flash fill.
- [ ] Players (`drawPlayer`): square heads (fillRect, hair as a flat cap rectangle), keep the kick-swing and pose logic. Kicker gets a blue disc behind the "10" like the SS; wall and keeper numbers stay plain.
- [ ] Ball: flat white circle with a simple dark patch (one flat pentagon or dot), no rim shading. Contact shadow becomes a flat semi-transparent ellipse, no gradient. Keep the swerve-tinted trail but render it as flat squares/rects for the pixel feel.
- [ ] Remove the match-night vignette at the end of `drawScene`.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome screenshots at 1280x800: menu backdrop, aim phase, and (driving `__game` state) a scored result with the flash visible. Visually confirm against the SS: grid crowd, vertical stripes, chunky goal, square-head sprites, no gradients or vignette.

### Phase Summary
_(write when phase completes)_

## Phase 3: HUD panel restyle
Status: Not started

All in `src/game/MagicalKicks.jsx`.

- [ ] Stats bar: keep the content and responsive wrapping, restyle to the SS: pixel-font labels, "DIST" instead of "DISTANCE", gold value accents, TRIES dots get a soft gold glow (box-shadow), mute toggle becomes a flat ♪ / muted-♪ glyph.
- [ ] Split the single gauge card into three separate rounded navy cards in a 3-column grid (stacking to one column only if 360px demands it).
- [ ] Add the numbered square badge to each card ("1"/"2"/"3" + label): gold background with dark number when that gauge is active, dark navy with light number otherwise. Wire it into `updateGaugeDom` alongside the existing label color toggle.
- [ ] Segmented tracks: render each track as ~24 discrete cells with 1-2px gaps. HEIGHT: green-to-red gradient across the cells (always lit, as in the SS). DIRECTION: dark cells with the `DIR_GOAL_WINDOW` span as gold cells (replaces the bracket overlay). SWERVE: dark cells with a center notch cell.
- [ ] Marker: keep the smooth-gliding DOM marker on top of the cells; restyle it as a chunky light block with a subtle glow. Keep the active/locked color switch in `updateGaugeDom`.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome screenshots at 1280x800 and 390x844 in each aim phase (drive `__game.phase` and locked values): confirm three cards, badge highlight follows the active gauge, goal-window cells sit centered at 35% width, and the marker glides (two frames apart show it moved).

### Phase Summary
_(write when phase completes)_

## Phase 4: Overlays and ball button
Status: Not started

All in `src/game/MagicalKicks.jsx`.

- [ ] Result banner: flat navy panel with a 2px border (emerald for goal, rose for miss), pixel font sizes tuned (the current 6xl title is too wide in Press Start 2P), keep popIn animation and the tries-left line.
- [ ] Menu overlay: pixel-font title lockup, flat panel styling, retuned paragraph size/leading for readability in the pixel face, keep the best-run line and the floaty CTA.
- [ ] Cup ceremony, game over, and win overlays: same flat-panel + pixel-font treatment, gold accents kept.
- [ ] Ball button: flat blue disc (no gradient), squared-off ring, keep the floaty animation, hover/active scaling, and all aria labels.
- [ ] Sweep for leftover Cascadia references and gradient utility classes (`bg-gradient-to-b`) that no longer fit the flat language.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome walkthrough at 390x844 and 1280x800: menu -> aim -> result (goal and miss via `__game`) -> cup -> gameover -> won, screenshot each; confirm consistent flat pixel styling, no text overflow, no leftover gradients.
- `grep -ri "cascadia" src index.html` returns nothing.

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
