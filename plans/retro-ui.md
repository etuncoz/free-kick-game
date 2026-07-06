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
Status: Complete

- [x] Replace the Cascadia Code Google Fonts `<link>` in `index.html` with Press Start 2P (weight 400 only; the face has no other weights).
- [x] Switch `DISPLAY_FONT` and the root container `fontFamily` in `MagicalKicks.jsx` to `'Press Start 2P', monospace`, dropping `fontWeight: 700` (the face is single-weight; bold synthesizes badly).
- [x] Switch the two canvas `ctx.font` strings in `render.js` (jersey numbers at ~line 125, ad boards at ~line 306) to `'Press Start 2P'`.
- [x] Retune font sizes across the HUD and overlays so the wide face fits: stat values, gauge labels, menu title, result title, prompts. Target no overflow at 360px CSS width.

### Verification Plan
- `npx vitest run` passes (no rendering tests exist; this guards against accidental logic edits).
- Start `npm run dev`, screenshot via headless Chrome CDP at 1280x800 and 390x844 on the menu and (via `__game`) an aim phase; confirm the pixel font renders (not a fallback) and nothing overflows or wraps out of its card.

### Phase Summary
Done 2026-07-06.
Press Start 2P loaded from Google Fonts, applied to the root container, `DISPLAY_FONT`, and both canvas `ctx.font` uses (jersey numbers dropped their `bold` prefix, ad boards use `boardH * 0.45` since the face runs wide).
Added `font-synthesis: none` in `src/index.css` so the leftover `font-bold` / `font-semibold` utilities never synthesize a fake bold over the single-weight pixel face.
All text sizes came down 1-2 Tailwind steps with `leading-relaxed`/`leading-snug` on multi-line runs; the widest string (win screen "FREE KICK LEGEND") sits at `text-lg sm:text-3xl`.
Verified: vitest 58/58 green; Playwright screenshots (harness `shoot.mjs` in the session scratchpad, dev server on port 5175, pattern from HANDOVER.md §Playwright) at 1280x800 and 390x844 across menu/aim1/aim2 show the pixel font rendering with no overflow; phone stats wrap into two rows as designed.
Note: Playwright is installed in the session scratchpad, not the repo; `npx playwright install chromium` browsers are cached machine-wide.

## Phase 2: Canvas scene flat restyle
Status: Complete

All in `src/game/render.js`.

- [x] Crowd: replace the random dot field with a grid-ordered dot matrix (rows/columns with slight per-dot color variation) in the SS palette: orange/red/yellow/cyan dots on deep navy. Keep the sway, goal-celebration bounce, camera flashes, and tier walkways.
- [x] Sky and floodlights: flat navy sky band (no gradient), flat polygonal floodlight beams with hard edges, simple flat fixture rectangles. Remove the radial glow gradients.
- [x] Pitch: flat saturated green, vertical mowing stripes (alternating light/dark bands across x in world space), no vertical gradient. Keep touchlines, goal line, penalty box, arc, and the six-yard box as-is.
- [x] Worn dirt at the kick spot: flat ellipse (one or two flat tones), no radial gradient.
- [x] Goal frame: chunky uniform white strokes with squared ends (`lineCap: butt`), drop the dark offset pass and the specular highlight pass. Keep the net grid, deformation, ripple, and side netting.
- [x] Goal flash: replace the radial-gradient burst with a flat expanding ring plus a short flat starburst; keep the net-backing gold flash fill.
- [x] Players (`drawPlayer`): square heads (fillRect, hair as a flat cap rectangle), keep the kick-swing and pose logic. Kicker gets a blue disc behind the "10" like the SS; wall and keeper numbers stay plain.
- [x] Ball: flat white circle with a simple dark patch (one flat pentagon or dot), no rim shading. Contact shadow becomes a flat semi-transparent ellipse, no gradient. Keep the swerve-tinted trail but render it as flat squares/rects for the pixel feel.
- [x] Remove the match-night vignette at the end of `drawScene`.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome screenshots at 1280x800: menu backdrop, aim phase, and (driving `__game` state) a scored result with the flash visible. Visually confirm against the SS: grid crowd, vertical stripes, chunky goal, square-head sprites, no gradients or vignette.

### Phase Summary
Done 2026-07-06.
Every gradient left `render.js` (`createLinearGradient`/`createRadialGradient` grep is clean): flat navy sky, flat `#15803d` pitch with world-x vertical mowing bands, two-tone flat dirt ellipse, flat double-polygon floodlight beams, flat ball shadow, no vignette.
Crowd is a 110x22 normalized grid of two-pixel people (warm head pixel over a `crowdColor(cc)` body: gold/orange/red/blue/dim-navy) with the old sway kept on x and a hop added while celebrating.
Goal frame is one chunky miter-joined white path (`0.11 * s`, min 3px); the goal flash is now white + gold flat rings plus an eight-ray starburst.
Sprites got square heads with a flat hair cap; `drawPlayer` gained an `o.badge` disc option used by the kicker, whose kit switched to the SS look (white shirt, blue "10" disc, blue socks).
Ball keeps one rotating flat pentagon; trail renders as flat squares.
Ad-board text is now all-gold (`#fbbf24`/`#fcd34d`).
Verified: vitest 58/58; screenshots `p2-aim1/p2-flight/p2-goalflash` in the scratchpad match the SS language (forced GOAL state via `__game` per the HANDOVER pattern).

## Phase 3: HUD panel restyle
Status: Complete

All in `src/game/MagicalKicks.jsx`.

- [x] Stats bar: keep the content and responsive wrapping, restyle to the SS: pixel-font labels, "DIST" instead of "DISTANCE", gold value accents, TRIES dots get a soft gold glow (box-shadow), mute toggle becomes a flat ♪ / muted-♪ glyph.
- [x] Split the single gauge card into three separate rounded navy cards in a 3-column grid (stacking to one column only if 360px demands it).
- [x] Add the numbered square badge to each card ("1"/"2"/"3" + label): gold background with dark number when that gauge is active, dark navy with light number otherwise. Wire it into `updateGaugeDom` alongside the existing label color toggle.
- [x] Segmented tracks: render each track as ~24 discrete cells with 1-2px gaps. HEIGHT: green-to-red gradient across the cells (always lit, as in the SS). DIRECTION: dark cells with the `DIR_GOAL_WINDOW` span as gold cells (replaces the bracket overlay). SWERVE: dark cells with a center notch cell.
- [x] Marker: keep the smooth-gliding DOM marker on top of the cells; restyle it as a chunky light block with a subtle glow. Keep the active/locked color switch in `updateGaugeDom`.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome screenshots at 1280x800 and 390x844 in each aim phase (drive `__game.phase` and locked values): confirm three cards, badge highlight follows the active gauge, goal-window cells sit centered at 35% width, and the marker glides (two frames apart show it moved).

### Phase Summary
Done 2026-07-07.
Stats bar is its own card (the old shared card + `border-b` split into two elements); SCORE value is gold, "DIST" label, TRIES dots glow via an arbitrary Tailwind box-shadow, mute is a ♪ glyph that dims + strikes through when muted.
Gauges are three `bg-slate-900/80` cards in a 3-column grid at all widths (three cards fit fine at 390px, verified).
`TRACK_CELLS = 20` flex cells per track (20, not 24, so cells stay >=4px on phones); HEIGHT ramps `hsl(120..0 65% 40%)`, DIRECTION lights the `DIR_GOAL_WINDOW` span as `bg-amber-400/80` cells (the old white bracket overlay is gone), SWERVE keeps the center-notch div.
Badges are `gaugeBadgeRefs`-driven spans restyled inside `updateGaugeDom` (gold bg + dark number when active); the marker is a 6px block, gold + gold glow while active, light `#e2e8f0` + soft glow when locked.
Verified: marker sampled two frames apart moved 47.96% -> 63.96% (desktop) and 42% -> 58% (phone), so the glide survived; screenshots `p3-aim1/2/3-{desktop,phone}` in the scratchpad match the SS card layout; vitest 58/58.

## Phase 4: Overlays and ball button
Status: Complete

All in `src/game/MagicalKicks.jsx`.

- [x] Result banner: flat navy panel with a 2px border (emerald for goal, rose for miss), pixel font sizes tuned (the current 6xl title is too wide in Press Start 2P), keep popIn animation and the tries-left line.
- [x] Menu overlay: pixel-font title lockup, flat panel styling, retuned paragraph size/leading for readability in the pixel face, keep the best-run line and the floaty CTA.
- [x] Cup ceremony, game over, and win overlays: same flat-panel + pixel-font treatment, gold accents kept.
- [x] Ball button: flat blue disc (no gradient), squared-off ring, keep the floaty animation, hover/active scaling, and all aria labels.
- [x] Sweep for leftover Cascadia references and gradient utility classes (`bg-gradient-to-b`) that no longer fit the flat language.

### Verification Plan
- `npx vitest run` passes.
- Headless Chrome walkthrough at 390x844 and 1280x800: menu -> aim -> result (goal and miss via `__game`) -> cup -> gameover -> won, screenshot each; confirm consistent flat pixel styling, no text overflow, no leftover gradients.
- `grep -ri "cascadia" src index.html` returns nothing.

### Phase Summary
Done 2026-07-07.
Result banner sits on a solid `bg-slate-950/90` panel with a 2px emerald/rose border (no backdrop blur); all four fullscreen overlays dropped their `backdrop-blur-[2px]`; the ball button lost its `bg-gradient-to-b` for flat `bg-blue-500`.
The overlay font-size retunes had already landed in Phase 1, so this phase was mostly de-gradienting; the Cascadia/gradient/blur sweep greps are clean (only prose comments mention "gradient").
Verified with `shoot4.mjs` (scratchpad): a scripted walkthrough that forces outcomes by teleporting `__game.ball` mid-flight (goal: into the top corner; miss: wide right) and reaches cup/gameover/won via the dev admin stage selector (stage 10 goal -> cup, one-try miss -> gameover, stage 50 goal -> won).
All ten captures (5 states x 2 sizes) look consistent, nothing overflows at 390px; vitest 58/58; `npm run build` succeeds.

## Final Recap
The whole game now wears the "Twilight Pixel" look from Ege's design mock, as a pure presentation change - physics, storage, audio, and game flow untouched (vitest suite unchanged and green throughout).
The four commits on `feature/retro-ui`:

1. `index.html` + `index.css` + font plumbing: Press Start 2P everywhere (DOM and canvas), `font-synthesis: none`, all type sizes retuned for the wide face.
2. `render.js`: gradient-free flat scene - grid dot-matrix crowd of two-pixel people with sway/hop, flat navy sky, flat polygonal floodlight beams, flat green pitch with vertical world-x mowing stripes, flat dirt patch, chunky single-path goal frame, flat ring + starburst goal flash, square-headed sprites (kicker in the SS white kit with the blue "10" disc), flat ball with one rotating pentagon, square trail pixels, no vignette.
3. `MagicalKicks.jsx` HUD: standalone stats card (gold SCORE, DIST, glowing tries dots, ♪ mute) and three gauge cards with numbered badges (gold when active, driven by `updateGaugeDom`) over 20-cell segmented tracks (HEIGHT hsl ramp, DIRECTION gold goal-window cells, SWERVE center notch); the marker still glides continuously.
4. `MagicalKicks.jsx` overlays: flat solid result banner, no backdrop blurs, flat ball button.

Verification tooling: Playwright (installed in the session scratchpad, chromium cached machine-wide) driving the dev server; outcomes forced via `window.__game` ball teleports; stage jumps via the dev-only admin selector.

## Deployment Plan
1. Push `feature/retro-ui` to origin (needs Ege's go-ahead; never push unasked).
2. Open a PR into `development` titled "Retro UI: Twilight Pixel restyle". Note in the description that it branches off `feature/admin-level-panel`, so that PR must merge first (or this PR will show its commits until rebased).
3. Ege reviews and merges (he approves every PR himself).
4. Deploy follows the existing GitHub Pages runbook (`plans/github-pages-deploy.md`): merge `development` into `main` via PR; the Pages workflow ships `dist/` (it has a built-in retry for the transient first-attempt failure).
5. Post-deploy smoke check on the published URL: menu renders in Press Start 2P, crowd is the dot-matrix grid, gauges are segmented cards.
