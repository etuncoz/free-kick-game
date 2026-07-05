# Free Kick Legend — Handover Document

A playable web prototype of the classic *"Roberto Baggio's Magical Kicks"* three-click free
kick game, rebuilt in **React + Canvas 2D + Tailwind + Vite**.
This document is the handover for continuing development locally (e.g. with Claude Code), and eventually porting the mechanic to a native iOS app.

There is no git repository in this folder yet.
That means this document is currently the *only* persistent record of what changed and why — treat it as such, and consider running `git init` early next session so future handovers can rely on commit history too.

---

## 1. What this project is

The original game (https://magical-kicks.netlify.app/ — a port of the Flash-era classic) is a
free kick game built entirely around a **three-stage timing gauge**:

1. **Tap 1 — HEIGHT**: an oscillating marker sets launch elevation (and slightly, power).
2. **Tap 2 — DIRECTION** (was called "AIM"): sets horizontal direction relative to the goal.
3. **Tap 3 — SWERVE** (was called "CURL"): sets lateral swerve, and this tap triggers the kick.

Layered on top: per-kick **wind**, a **defensive wall** that jumps, a **goalkeeper** with an
imperfect prediction of where the shot will land, varying kick positions/angles, and a
score/streak system across a 10-kick match.

This prototype implements all of the above. The eventual target is an iOS app (SpriteKit was
recommended); this web build exists to validate and tune the *feel* first, because the tuned
constants transfer directly.

## 2. Files

This is now a real scaffolded Vite app, not a single artifact component.

| File | Purpose |
|---|---|
| `index.html`, `vite.config.js`, `package.json` | Standard Vite + React + Tailwind (v4, via `@tailwindcss/vite`) scaffold. |
| `src/main.jsx`, `src/App.jsx`, `src/index.css` | App entry point. `App.jsx` just renders `MagicalKicks`. |
| `src/game/MagicalKicks.jsx` | React shell: state, refs, the `requestAnimationFrame` loop, JSX/HUD overlay. No physics or drawing logic lives here directly — it wires the modules below together. |
| `src/game/physics.js` | Pure game-state functions: `newScenario`, `launch`, `step` (integration + collisions + scoring), `gaugePos`. No React/DOM/audio imports — this is the file that ports to Swift verbatim (see §8). `step()` returns an event list (`{type:'sfx',name}` / `{type:'hud',patch}`) instead of calling side effects directly. |
| `src/game/render.js` | Canvas drawing: the tilted-camera projection, sprites, pitch/goal/net, gauge HUD panel. Reads `g` but never mutates game-logic fields. |
| `src/game/audio.js` | WebAudio sfx synth, exposed as `createAudioController()` returning `{ ensureAudio, sfx, setMuted }`. |
| `src/game/constants.js` | Shared math helpers (`rnd`, `clamp`, `lerp`, `easeOut`, `ping`) and tunables (`GOAL_HALF`, `BALL_R`, `TOTAL_KICKS`, `MAX_WIND_KMH`). |
| `magical-kicks.jsx` (repo root) | **Superseded** — the original single-file artifact component, kept only as a diff reference. Everything in it now lives in `src/game/*`. Safe to delete once you've confirmed the split version behaves the same; nobody imports it. |
| `HANDOVER.md` | This document. |

## 3. Running it locally

Already scaffolded — no more manual Vite setup needed.

```bash
npm install
npm run dev      # http://localhost:5173 (or next free port)
npm run build    # production build, outputs to dist/
```

Notes:
- Fonts (`Archivo Black`, `Space Grotesk`) load via a `<link>` in `index.html` (moved out of the component's inline `<style>` for production).
- Audio is synthesized with WebAudio (no asset files). The `AudioContext` is created lazily on the first user gesture, as browsers require.
- No persistence yet — "session best" resets on reload. Still a good first improvement (see §7).
- A dev-only debug hook exists: `window.__game` is set to the live mutable game state, but only when `import.meta.env.DEV` is true. It's stripped from production builds (verified by grepping the built bundle for `__game`). Useful for forcing specific game states (e.g. `window.__game.result = "GOAL"`) when testing visuals without waiting on stochastic physics — see the Playwright scripts pattern used this session, described in §10.

## 4. Architecture

Two worlds, deliberately separated, now split across files instead of one component:

- **React state (`hud`)**, in `MagicalKicks.jsx` — only what the DOM overlay needs: phase, score, kick number, wind
  display, result message, mute. Updated *sparingly* via `syncHud()` at state transitions,
  never per-frame.
- **Mutable game state (`G.current`)**, created by `physics.js`'s `createGameState()` — everything the 60fps loop touches: ball kinematics,
  gauge timer, keeper/wall animation state, scenario parameters. Lives in a ref so the
  `requestAnimationFrame` loop never re-renders React.

Each frame, `MagicalKicks.jsx`'s loop calls `physics.step(g, dt)`, which returns an array of events; the component drains that array and calls `audio.sfx()` / `syncHud()` as needed.
This is what keeps `physics.js` free of React and audio dependencies.

### State machine (`g.phase`)

```
menu → aim1 → aim2 → aim3 → runup → flight → settle → result → (next kick | gameover)
                                                                  ↑ tap advances
```

- `aim1/2/3`: gauge oscillates (`ping()` triangle wave × `gaugeSpeed`); a tap samples it via
  `gaugePos(g, key)` into `g.locked.{h,d,s}` and advances. `gaugePos` is the single place the CURL/SWERVE ×1.15 speed multiplier lives now (previously duplicated between the input handler and the renderer — fixed during the split).
- `runup` (0.38 s): the kicker sprite lerps to the ball; then `launch()` fires.
- `flight`: physics integration + collision checks each frame.
- `settle` (1.05 s): result already decided; ball deflects/nets, ripple plays, then the banner.
- `result`: waits for a tap → `nextKick()` or `gameover`.

### Coordinate system & projection (rewritten this session — was a naive height-offset hack, now a proper tilted camera)

World coordinates in **metres**: ball starts at origin, `x` lateral, `y` up, `z` toward goal.
The goal centre sits at `(g.gx, 0, g.D)`.

The camera now sits elevated and pitched downward, for a bird's-eye broadcast-camera look instead of a player's-eye view:

```js
CAM = { x: 0, y: 8, z: -14 };       // render.js
TILT_DEG = 32;                      // downward pitch, degrees
```

Projection in `project(g, wx, wy, wz)` (`render.js`):

```
dx = wx - CAM.x;  dy = wy - CAM.y;  dz = wz - CAM.z;
depth = max(0.6, dz·cos(TILT) - dy·sin(TILT));   // depth along the camera's tilted look axis, not raw world-z
s = f / depth;
sx = W/2 + dx·s;
sy = horizon - (dy / cos(TILT))·s;
```

The old formula (`s = f/(wz-camZ)`, `sy = horizon + (camY-wy)·s`) broke down as soon as the camera was raised: near-camera ground points would compute an enormous scale and get pushed off-screen.
Tilting the depth calculation itself (instead of just offsetting height by scale) fixes that — verify the math in `project()` before changing `CAM`/`TILT_DEG` again, it's not just "bigger numbers = higher camera".

`f = 0.8 · canvasWidth`, `horizon = 0.2 · canvasHeight`. Ball sprite radius = `0.11 · s`,
which is what produces the fake-3D "ball shrinks as it flies" effect; the ground-shadow at
`(x, 0, z)` sells the height.

**Pitch bounds / out-of-bounds shading**: `PITCH_HALF_WIDTH = 32` (metres) in `render.js` defines real touchlines.
The grass + mowing stripes are clipped (via `ctx.clip()`) to a trapezoid between the touchlines; everything outside that trapezoid renders as a brown "running track" fill (`#5b4a36`) instead of more green, so the in-bounds pitch reads as a distinct region rather than a flat, undifferentiated green field.
If you change `PITCH_HALF_WIDTH`, keep it comfortably above the widest possible penalty-box edge (`|gx|_max + 20.15 ≈ 25.35`), or the box will get visually clipped.

### Flight model (hand-tuned parametric, NOT a physics engine)

Set in `launch()` (`physics.js`) from the three locked gauge values, then integrated per frame (2 substeps):

```
θ  = 3° + h·32°                      // elevation from HEIGHT gauge (h ∈ [0,1])
v  = 20.5 + (1−h)·3.5                // low shots are slightly faster
φ  = atan2(gx, D) + d·15°            // DIRECTION gauge (d ∈ [−1,1]), baseline = goal centre
curl accel  = s·12.5 m/s²  (lateral) // SWERVE gauge (s ∈ [−1,1])
wind accel  = wind·3.1 m/s² (lateral)
gravity 9.81, light per-axis drag (0.04–0.06 · v)
ground bounce: restitution 0.45 (daisy-cutters are possible and intended)
```

**Ground clamp bug fixed this session**: the ground-bounce clamp used to be skipped entirely once `g.phase !== "flight"` (i.e. during `settle`), so a ball that was still falling when the result was decided (e.g. an "OVER" that arcs back down) could sink visibly below the pitch with nothing stopping it.
The clamp now runs in both `flight` and `settle`; only the wall/goal collision-plane checks stay `flight`-only.
See `step()` in `physics.js` — the `if (g.phase !== "flight") continue;` line was moved to *after* the ground-bounce block, not before it.

### Collision planes (checked via prev/current z crossing + lerp interpolation)

- **Wall plane** (`z = wallZ`, ≈ 9.15 m): blocked if within wall span and below
  `1.86 + jumpHeight` — *unless* the wall has jumped ≥ 0.22 m and the ball is under
  `0.85 × jumpHeight` (you can slide it underneath a jumping wall).
- **Goal plane** (`z = D`): checks post/bar (ball-radius band around frame) → `POST`;
  inside frame → keeper save check → `SAVED`/`GOAL`; otherwise `OVER`/`WIDE`.

### Keeper AI

At `launch()` the keeper computes the analytic arrival point
`x = vx·T + ½(curl+wind)·T²` with `T = D / vz`, adds Gaussian-ish noise
(`kpSigma`, shrinking each kick: `max(0.35, 1.45 − 0.11·kick)`), clamps to reachable range,
then after a 0.24 s reaction delay eases toward it (dive rotation + lift if the shot is high).
Save zones at ball arrival: body `|dx| < 0.55 ∧ y < 2.25`; dive `|dx| < 1.5 ∧ y < 2.15 − 0.75·(dx/1.5)`.
Corners beat him when his prediction noise pulls him off — that's the intended skill ceiling.

### Scenario generation (`newScenario`)

Per kick: distance `D ∈ [17, 26.5]` m, angle `gx ∈ [−5.2, 5.2]` m, wall of 3–5 players placed
on the ball→near-post line at `min(9.15, D/2)`, 80 % chance the wall jumps (timed to arrive
0.3 s before the ball).

**Wind is now capped this session** — previously it grew unbounded with kick number (up to ~35 km/h displayed by kick 10, which felt absurd).
It now ramps `4.6 → 10 km/h` linearly across the 10 kicks and never exceeds `MAX_WIND_KMH = 10` (`constants.js`):

```js
maxWindKmh = MAX_WIND_KMH * (0.4 + 0.6 * (k / TOTAL_KICKS));
maxW = maxWindKmh / 26;   // back to the internal "wind" unit
g.wind = rnd(-maxW, maxW);
```

### Scoring

Goal = 100, + `(streak−1)·25`, + 50 "top bin" bonus if `|x−gx| > 2.75` or `y > 1.9`.
Any non-goal resets the streak. 10 kicks per match; session best kept in memory.

### Goal-scoring visual feedback (new this session)

With the elevated camera, the goal net is physically small on screen, so a ball crossing the line was easy to miss.
On `GOAL` (and only on `GOAL`), `render.js` now draws, at the exact net-impact point (`g.netHitX`/`g.netHitY`, set in `physics.js`'s `finishKick`):

- A bright gold/white radial flash whose radius grows and fades with `g.netRipple` (already-existing decay timer, ~0.7s).
- An expanding white "shockwave" ring stroke.
- The net's dark backing quad flashes toward white/gold instead of staying dark.

None of this fires for `SAVED`/`WALL`/`POST`/`OVER`/`WIDE` — verified by screenshot.

## 5. The tuning knobs (the actual game design)

These numbers ARE the game feel — most of the remaining design work is here, and the physics ones port 1:1 to
the iOS build. Camera/render numbers do not port (iOS will have its own camera).

| Constant | Where | Current | Effect |
|---|---|---|---|
| `gaugeSpeed` | `newScenario` (physics.js) | `1.05 + 0.07·kick` | Difficulty of the timing itself |
| SWERVE gauge speed ×1.15 | `gaugePos` (physics.js) | 1.15 | Third tap is slightly harder. Single source of truth now — no longer duplicated. |
| Elevation range | `launch` | 3°–35° | Shot arc envelope |
| Base speed | `launch` | 20.5–24 m/s | Flight time (~1.1–1.4 s to goal) |
| Aim cone | `launch` | ±15° | How far off-target you can spray |
| `curlAx` | `launch` | `s · 12.5` | How much you can bend it |
| `windAx` | `newScenario` | `wind · 3.1` | Wind influence |
| `MAX_WIND_KMH` | `constants.js` | `10` | Wind display/effect ceiling, new this session |
| `kpSigma` | `newScenario` | `1.45 − 0.11·kick` | Keeper skill curve |
| `kpDelay` | `launch` | 0.24 s | Keeper reaction time |
| Save zones | goal-plane check | see §4 | How generous the keeper is |
| Wall jump | `step` | `2.7t − 3.6t²` (peak ≈ 0.5 m) | Jump height/timing |
| `CAM` (camera position) | `render.js` | `{x:0, y:8, z:-14}` | Where the "broadcast camera" sits, new this session |
| `TILT_DEG` | `render.js` | `32` | Downward camera pitch, new this session |
| `PITCH_HALF_WIDTH` | `render.js` | `32` m | Touchline distance from centre, new this session |

## 6. Known issues / rough edges

- **Kicker sprite gets overlapped by the gauge HUD panel** during `aim1/2/3` in the new camera framing — his feet sit right around where the panel's bottom edge is. Not broken, just tight; worth revisiting if you touch the HUD panel layout or camera again.
- **Keeper never saves and holds** — every save deflects; parries into the box could allow a
  rebound mechanic later.
- **Post hits always go out**; the original occasionally let them bounce in. Easy add:
  random small chance the deflection crosses the line.
- **Kicker animation is minimal** (a lerp + lean, no leg swing frames).
- **No pause/visibility handling**: `dt` is clamped to 33 ms so tab-switching won't explode
  the physics, but a proper pause on `visibilitychange` would be cleaner.
- **No git repository** — see the note at the top of this document. Consider `git init` + an initial commit next session before making further changes, so there's a real diff history.
- **`magical-kicks.jsx` at the repo root is dead code** — nothing imports it, it's only kept as a reference for diffing against the split version. Safe to delete whenever you're comfortable.
- Playtest before trusting any feel judgment baked into the constants — this session's changes were verified visually via automated screenshots (see §10), not by a human playing it.

## 7. Suggested next steps (web prototype)

1. Add `localStorage` high-score persistence.
2. Add a debug panel (dat.gui or plain sliders) bound to the §5 constants for live tuning.
3. Difficulty/mode design: practice mode (no kick limit), sudden-death streak mode.
4. Haptics stub: `navigator.vibrate(10)` on gauge locks — previews the iOS haptic design.
5. Optional: replace rect-figures with sprite sheets once art direction is decided.
6. Revisit the gauge-panel/kicker overlap noted in §6 if it bothers you in practice.
7. Consider `git init` so future sessions get real commit history instead of relying solely on this document.

## 8. iOS port plan (the actual goal)

- **Engine**: SpriteKit + Swift. Do **not** use SpriteKit's physics engine for the ball —
  port the parametric integration from `physics.js` verbatim (it's a small, self-contained module by design).
  The camera projection in `render.js` is presentation-only and iOS-specific — do not port `CAM`/`TILT_DEG` as-is, redesign the camera for whatever iOS presentation style you pick (2.5-D `SKNode` layers vs true 3D via SceneKit/RealityKit).
- **1:1 mappings**: `requestAnimationFrame` → `SKScene.update(_:)`; canvas layers → `SKNode`
  hierarchy; taps → `touchesBegan`; the state machine → a Swift `enum Phase`.
- **Gauges**: rebuild as an `SKNode` lower-third; add `UIImpactFeedbackGenerator` (.light on
  lock 1–2, .medium on the strike) — this is where native will immediately feel better than web.
- **Persistence/social**: `UserDefaults` for best score, Game Center leaderboard for the 10-kick match score.
- **⚠ Legal**: ship with original art, generic branding ("Free Kick Legend"), and **no use of
  Roberto Baggio's name or likeness** — right-of-publicity risk. Game *mechanics* are not
  protectable; names/likenesses/art are.

## 9. Useful Claude Code starter prompts

- "Read HANDOVER.md §6 and pick off one of the known issues."
- "Add a collapsible debug panel with sliders for every constant in HANDOVER.md §5, live-bound
  to the game state."
- "Extract the flight model and collision checks into unit tests: a straight 15° shot from 20 m must cross the goal plane between y=1.0 and y=2.2."
- "Port physics.js to Swift as FlightModel.swift per §8, preserving all constants."
- "Add localStorage persistence for session best per §7."

## 10. How visual changes were verified this session (no browser extension available)

The Claude-in-Chrome browser extension was not connected in this environment, so visual changes were verified with a small local Playwright harness instead of manual clicking.
The pattern, if you need to repeat it:

1. `npx playwright install chromium` once (downloads a local headless Chromium, ~300MB).
2. Run `npm run dev` in the background.
3. A Node script using `playwright`'s `chromium.launch()` + `page.goto(...)` + `page.keyboard.press("Space")` drives the game through its phases and calls `page.screenshot()` at each one.
4. For states that are hard to reach via normal play (e.g. forcing a `GOAL` to check the net flash), the dev-only `window.__game` hook (see §3) was mutated directly via `page.evaluate()`, then a frame was allowed to render before screenshotting.

None of the Playwright scripts or the downloaded Chromium are part of this repo — they were scratch tooling in a temp directory, not committed here.
