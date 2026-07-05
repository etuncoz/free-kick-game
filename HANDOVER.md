# Free Kick Legend — Handover Document

A playable web prototype of the classic *"Roberto Baggio's Magical Kicks"* three-click free
kick game, rebuilt in **React + Canvas 2D + Tailwind + Vite**.
This document is the handover for continuing development locally (e.g. with Claude Code), and eventually porting the mechanic to a native iOS app.

The project now lives in a git repository, pushed to `https://github.com/etuncoz/free-kick-game.git` (branch `main`).
Commit history is the primary record of *what* changed from here on — this document is for the *why* behind decisions and design details that don't show up in a diff.

---

## 1. What this project is

The original game (https://magical-kicks.netlify.app/ — a port of the Flash-era classic) is a
free kick game built entirely around a **three-stage timing gauge**:

1. **Tap 1 — HEIGHT**: an oscillating marker sets launch elevation (and slightly, power).
2. **Tap 2 — DIRECTION** (was called "AIM"): sets horizontal direction relative to the goal.
3. **Tap 3 — SWERVE** (was called "CURL"): sets lateral swerve, and this tap triggers the kick.

Layered on top: per-kick **wind**, a **defensive wall** that jumps, a **goalkeeper** with an
imperfect prediction of where the shot will land, varying kick positions/angles, and a
score/streak system.

This prototype implements all of those mechanics, but replaces the original's 10-kick match with a **10-stage "Cup Run"**.
Each stage is a fixed kick spot with 5 tries: a goal advances immediately (spare tries are discarded), failing all 5 ends the run, and clearing stage 10 wins the cup.
Difficulty grows across stages via distance and wind only; keeper skill and gauge speed are constant (see §4 "Scenario generation" and §5).
The eventual target is an iOS app (SpriteKit was
recommended); this web build exists to validate and tune the *feel* first, because the tuned
constants transfer directly.

## 2. Files

This is now a real scaffolded Vite app, not a single artifact component.

| File | Purpose |
|---|---|
| `index.html`, `vite.config.js`, `package.json` | Standard Vite + React + Tailwind (v4, via `@tailwindcss/vite`) scaffold. |
| `src/main.jsx`, `src/App.jsx`, `src/index.css` | App entry point. `App.jsx` just renders `MagicalKicks`. |
| `src/game/MagicalKicks.jsx` | React shell: state, refs, the `requestAnimationFrame` loop, JSX/HUD overlay. Also owns the DOM-based info + gauge panel below the canvas (see §4 "HUD & interaction model") and the single ⚽ button that drives every phase transition. No physics or drawing logic lives here directly — it wires the modules below together. |
| `src/game/physics.js` | Pure game-state functions: `newScenario`, `launch`, `step` (integration + collisions + scoring), `gaugePos`. No React/DOM/audio imports — this is the file that ports to Swift verbatim (see §8). `step()` returns an event list (`{type:'sfx',name}` / `{type:'hud',patch}`) instead of calling side effects directly. |
| `src/game/render.js` | Canvas drawing: the tilted-camera projection, sprites, pitch/goal/net. Reads `g` but never mutates game-logic fields. The gauge HUD used to be drawn here too (see §4) — it no longer is. |
| `src/game/audio.js` | WebAudio sfx synth, exposed as `createAudioController()` returning `{ ensureAudio, sfx, setMuted }`. |
| `src/game/storage.js` | localStorage persistence of run records (keys `fkl.bestStage`, `fkl.bestScore`, `fkl.cupWon`) via `loadBests()` / `saveRunEnd()`. Every access is guarded, so private browsing just means nothing persists. |
| `src/game/constants.js` | Shared math helpers (`rnd`, `clamp`, `lerp`, `easeOut`, `ping`) and tunables (`GOAL_HALF`, `BALL_R`, `PENALTY_BOX_DEPTH`, the `STAGES` table, `TRIES_PER_STAGE`, `STAGE_KP_SIGMA`, `STAGE_GAUGE_SPEED`, `WIND_UNIT_KMH`). |
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
- Run records (best stage reached, best score, cup won) persist across reloads via localStorage (`src/game/storage.js`).
  There is deliberately no mid-run resume: reloading starts a fresh run at stage 1.
- A dev-only debug hook exists: `window.__game` is set to the live mutable game state, but only when `import.meta.env.DEV` is true. It's stripped from production builds (verified by grepping the built bundle for `__game`). Useful for forcing specific game states (e.g. `window.__game.result = "GOAL"`) when testing visuals without waiting on stochastic physics — see the Playwright scripts pattern used this session, described in §10.

## 4. Architecture

Two worlds, deliberately separated, now split across files instead of one component:

- **React state (`hud`)**, in `MagicalKicks.jsx` — only what the DOM overlay needs: phase, score, stage, tries left, distance
  to goal, wind display, result message, persisted bests, mute. Updated *sparingly* via `syncHud()` at state transitions,
  never per-frame. (The gauge markers themselves are the exception — see "HUD & interaction model" below.)
- **Mutable game state (`G.current`)**, created by `physics.js`'s `createGameState()` — everything the 60fps loop touches: ball kinematics,
  gauge timer, keeper/wall animation state, scenario parameters. Lives in a ref so the
  `requestAnimationFrame` loop never re-renders React.

Each frame, `MagicalKicks.jsx`'s loop calls `physics.step(g, dt)`, which returns an array of events; the component drains that array and calls `audio.sfx()` / `syncHud()` as needed.
This is what keeps `physics.js` free of React and audio dependencies.

### State machine (`g.phase`)

```
menu → aim1 → aim2 → aim3 → runup → flight → settle → result → (retry | next stage | gameover | won)
                                                                  ↑ ⚽ button (or Space/Enter) advances
```

- `aim1/2/3`: gauge oscillates (`ping()` triangle wave × `gaugeSpeed`); pressing the ⚽ button (or Space/Enter) samples it via
  `gaugePos(g, key)` into `g.locked.{h,d,s}` and advances. `gaugePos` is the single place the CURL/SWERVE ×1.15 speed multiplier lives now (previously duplicated between the input handler and the renderer — fixed during the split).
- `runup` (0.38 s): the kicker sprite lerps to the ball; then `launch()` fires.
- `flight`: physics integration + collision checks each frame.
- `settle` (1.05 s): result already decided; ball deflects/nets, ripple plays, then the banner.
- `result`: waits for the ⚽ button → `advance()` in `MagicalKicks.jsx`: a GOAL moves to the next stage with 5 fresh tries
  (or to `won` if stage 10 was just cleared); a miss retries the exact same spot, or goes to `gameover` when the tries hit 0.
  **Try consumption lives in physics** (`finishKick` decrements `triesLeft` on any miss; goals leave it untouched) — the
  component only reads the counter.
- `won` / `gameover`: terminal overlays; `endRun()` persists any improved records via `storage.js` on entry.
  The ⚽ button restarts a fresh run at stage 1 from either.

### HUD & interaction model (reworked in a later session)

The gauge panel (HEIGHT/DIRECTION/SWERVE) used to be drawn on the canvas itself, in a fixed
strip pinned to the bottom of the frame (`drawGauges` in `render.js`).
With the elevated broadcast camera, the kicker and the ball both render very low in that same
frame, so the panel sat directly on top of them — you could barely see either during `aim1/2/3`.
That's the "kicker sprite gets overlapped by the gauge HUD panel" issue this document used to
list under Known Issues (§6); it's now fixed by moving the whole HUD out of the canvas.

The panel is now plain DOM/Tailwind markup in `MagicalKicks.jsx`, rendered in one card below the
canvas that combines two rows:

1. An info row — SCORE, STAGE (`x/10`) and TRIES (five dots, amber = remaining) grouped on the left,
   DISTANCE and WIND (plus the mute button) on the right — all sharing the same label/value text
   classes (`STAT_LABEL_CLS`/`STAT_VALUE_CLS`) so the stats read as one consistent set instead of
   differently-sized boxes.
2. The HEIGHT/DIRECTION/SWERVE gauge row, unchanged in behaviour from the canvas version.

This card is **always mounted**, even outside `aim1/2/3` — only the gauge markers' `opacity`
toggles per-key inside it. It used to be conditionally rendered only during the aim phases, which
meant the whole page reflowed (grew/shrank) every time a kick started or ended; keeping it mounted
permanently fixed that.

Because the gauge markers still need to glide smoothly while a gauge is oscillating (60 fps), they
are **not** driven through React state/re-render. `MagicalKicks.jsx` keeps `gaugeMarkerRefs` /
`gaugeLabelRefs` (plain DOM refs, one per gauge key) and an `updateGaugeDom(g)` function that's
called directly from the `requestAnimationFrame` loop, right after `drawScene`, and sets
`style.left` / `style.opacity` / `style.background` imperatively. This is the same
performance trade-off the mutable `G.current` game state already makes elsewhere (§4 intro) — the
60 fps path never touches `setState`.

The interaction model changed to match: the whole canvas used to be one big tap target
(`onPointerDown` on the wrapping div called `onAction`). It's now a single dedicated ⚽ button,
absolutely positioned bottom-right over the canvas (`z-20`, above the menu/result/game-over
overlays), which is the sole trigger for every phase transition — locking each gauge, kicking off,
advancing past a result, and playing again. It fades out and stops intercepting clicks
(`opacity-0 pointer-events-none`) during `runup`/`flight`/`settle`, when there's nothing for it to
do. Space/Enter still work everywhere, unchanged.

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
φ  = atan2(gx,D) + d·cone            // DIRECTION gauge; cone = atan(GOAL_HALF/D)/DIR_GOAL_WINDOW
curl accel  = −s·CURL_ACCEL (12.5)   // SWERVE gauge (s ∈ [−1,1]) - see below, it's a banana
v0x        += s·CURL_ACCEL·T/2       // launch compensation: bows out, returns to the aim line
wind accel  = wind·3.1 m/s² (lateral)
gravity 9.81, light per-axis drag (0.04–0.06 · v)
ground bounce: restitution 0.45 (daisy-cutters are possible and intended)
```

**Direction sweeps far wider than the goal** (matched to the original game, then refined):
the cone is anchored at the goal centre and sized per stage as
`cone = atan(GOAL_HALF/D) / DIR_GOAL_WINDOW`, so the goal mouth always occupies the same fixed,
centred fraction (`DIR_GOAL_WINDOW = 0.35`) of the gauge — the white goal-mouth box drawn on the
DIRECTION track is static and identical on every stage, while full deflection still sprays 12 m+
wide of the frame.
"Aim at the goal" is literally catching the marker inside that box; the horizontal variety
between stages shows up on the pitch view (the goal shifts sideways with `gx`), not on the gauge.

**Swerve is a banana, not a drift** (also matched to the original): choosing RIGHT launches the
ball offset to the right (`v0x += s·CURL_ACCEL·T/2`) while the curl accelerates it left
(`−s·CURL_ACCEL`), so the path bows out around the wall and returns to the aimed line exactly at
the goal plane (before drag).
Peak bow ≈ `CURL_ACCEL·T²/8` ≈ 1.2–2.6 m — enough to clear the wall's half-width.
The keeper's analytic prediction includes both terms, so they cancel there too: he reads the
*endpoint*, which is correct and intended.

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
(`kpSigma`, fixed at `STAGE_KP_SIGMA = 0.9` for the whole run) and clamps to reachable range.
The final pose is decided at launch too (`kpDiveAngle`/`kpDiveLift`: a dive if he has more than
1 m to cover, flatter for low balls, an upright jump for high close ones), and after a 0.24 s
reaction delay `step()` just eases position and pose toward it.
Because a diver meets the ball with his torso/hands rather than his feet, `launch()` aims the
**feet** short of the predicted point by the body offset along the rotated pose — so the drawn
body lands on the prediction instead of overshooting past it.

**A save is literally "the ball touched the drawn body"**: at the goal plane the ball's crossing
point is tested against a capsule of length `KP_BODY_LEN = 1.95` from the feet along the current
(rotated, lifted) pose, with radius `KP_SAVE_RADIUS = 0.5` (+ ball radius).
Physics and sprite can never disagree, by construction.
This replaced two earlier zone-based checks (a ±1.5 m dive band, then a directional variant) that
both produced *phantom saves* — SAVED announced while the ball visibly passed through empty
space near a diving keeper's feet.
If the sprite's proportions or the dive rotation/lift values change, keep `KP_BODY_LEN` /
`KP_SAVE_RADIUS` and the launch-time pose math in sync.
Corners beat him when his prediction noise pulls him off — that's the intended skill ceiling.

### Scenario generation (`newScenario`)

The kick spot is **not random anymore** — `D` and `gx` come straight from the hand-authored
`STAGES` table in `constants.js` (10 entries of `{ d, gx, maxWindKmh }`; `D` ramps 19 → 30 m,
`|gx|` up to 10 m so the kick spot swings visibly across the pitch, wind cap 0 → 10 km/h).
The spot is identical for all 5 tries of a stage, and so is the wall's player count (3–5, rolled
once on a stage's first try); only wind, the wall's position jitter and jump (80 % chance, timed
to arrive 0.3 s before the ball) and the keeper's prediction noise re-roll per try.
The wall sits on the ball→near-post line at `min(9.15, D/2)`, which always resolves to the 9.15 m
cap (10 yards) since every stage has `D ≥ 19`.

All stage distances keep clear of the 16.5 m penalty box edge (`PENALTY_BOX_DEPTH`) — a free kick
from on/inside the box would read as a penalty, which is why the old random range was floored at
19 m in the first place.
Stage 10's `D = 30` exceeds the old random cap of 28.5 m; the framing at that distance was
verified by screenshot (kicker, ball, wall and goal all comfortably in frame — the elevated
camera handles it without changes).

The DISTANCE stat shown in the HUD (see "HUD & interaction model" above) is this same `D`, rounded
and set once per try via `newScenario`'s returned patch — it is *not* a live read of the ball's
current distance from the goal during flight.

Wind rolls per try within the stage's cap, converted to the internal unit via `WIND_UNIT_KMH = 26`
(1 internal wind unit displays as 26 km/h):

```js
maxW = st.maxWindKmh / WIND_UNIT_KMH;
g.wind = rnd(-maxW, maxW);
```

### Scoring

Goal = `100 + (streak−1)·25 + spareTries·25 (+ 50 "top bin" bonus if |x−gx| > 0.75·GOAL_HALF or y > 0.78·GOAL_H)`,
where `spareTries` is the tries that would have remained after the scoring one — first-try goals
are worth 100 more than fifth-try goals.
Any non-goal resets the streak, so the streak bonus effectively rewards consecutive first-try clears.
Points sit on top of pass/fail: they never decide advancement, only the record.
Best score and best stage reached persist via `storage.js`.

### Goal-scoring visual feedback (new this session)

With the elevated camera, the goal net is physically small on screen, so a ball crossing the line was easy to miss.
On `GOAL` (and only on `GOAL`), `render.js` now draws, at the exact net-impact point (`g.netHitX`/`g.netHitY`, set in `physics.js`'s `finishKick`):

- A bright gold/white radial flash whose radius grows and fades with `g.netRipple` (already-existing decay timer, ~0.7s).
- An expanding white "shockwave" ring stroke.
- The net's dark backing quad flashes toward white/gold instead of staying dark.
- The net mesh itself deforms with the ball (added in a later session): while the ball is behind
  the goal line, every thread gets a gaussian depth bulge centred on the ball's x/y, scaled by how
  deep it is — the net visibly catches and follows the ball. The goal frame also gained back
  stanchions, a ground bar and a shaded double-stroke on the posts.

**Stands placement** (same session): the crowd wall is no longer a thin strip at the horizon — it
is drawn *after* the pitch, from the sky band down to the ground point 6 m behind the goal
(`P(0, 0, D+6).y`), so the audience starts directly behind the net and covers the far pitch and
the out-of-bounds brown. Tier walkway lines and near-row dot scaling keep it reading as stands.

None of this fires for `SAVED`/`WALL`/`POST`/`OVER`/`WIDE` — verified by screenshot.

## 5. The tuning knobs (the actual game design)

These numbers ARE the game feel — most of the remaining design work is here, and the physics ones port 1:1 to
the iOS build. Camera/render numbers do not port (iOS will have its own camera).

| Constant | Where | Current | Effect |
|---|---|---|---|
| `STAGES` | `constants.js` | 10 × `{ d, gx, maxWindKmh }` | THE difficulty curve: kick spot + wind cap per stage (`d` 19→30, `maxWindKmh` 0→10) |
| `TRIES_PER_STAGE` | `constants.js` | `5` | Attempts per stage before game over |
| `STAGE_GAUGE_SPEED` | `constants.js` | `1.2` | Gauge oscillation speed, constant all run (eased from 1.4 after playtesting found it too fast) |
| `STAGE_KP_SIGMA` | `constants.js` | `0.9` | Keeper prediction noise, constant all run (mid-range of the old per-kick ramp) |
| SWERVE gauge speed ×1.15 | `gaugePos` (physics.js) | 1.15 | Third tap is slightly harder. Single source of truth now — no longer duplicated. |
| Elevation range | `launch` | 3°–35° | Shot arc envelope |
| Base speed | `launch` | 20.5–24 m/s | Flight time (~1.1–1.4 s to goal) |
| `DIR_GOAL_WINDOW` | `constants.js` | 0.35 | Fraction of the DIRECTION gauge the goal occupies (static, centred); the sweep cone rescales per stage around it |
| `CURL_ACCEL` | `constants.js` | 12.5 | Banana strength: curl accel one way + launch offset the other, returning to the aim line |
| `windAx` | `newScenario` | `wind · 3.1` | Wind influence |
| `WIND_UNIT_KMH` | `constants.js` | `26` | Display conversion: 1 internal wind unit = 26 km/h |
| Goal points | `finishKick` | `100 + (streak−1)·25 + spareTries·25 (+50 top bin)` | Reward shape: first-try clears and streaks pay most |
| `kpDelay` | `launch` | 0.24 s | Keeper reaction time |
| `KP_BODY_LEN` / `KP_SAVE_RADIUS` | `physics.js` | 1.95 m / 0.5 m | The save capsule = the keeper's drawn body (see §4) — how generous the keeper is |
| `GOAL_HALF` / `GOAL_H` | `constants.js` | 4.58 / 3.05 m | Goal frame, deliberately 1.25× regulation so scoring is easier; the keeper's reach is NOT scaled with it, so the corners are open by design |
| Wall jump | `step` | `2.7t − 3.6t²` (peak ≈ 0.5 m) | Jump height/timing |
| `CAM` (camera position) | `render.js` | `{x:0, y:8, z:-14}` | Where the "broadcast camera" sits, new this session |
| `TILT_DEG` | `render.js` | `32` | Downward camera pitch, new this session |
| `PITCH_HALF_WIDTH` | `render.js` | `32` m | Touchline distance from centre, new this session |

## 6. Known issues / rough edges

- **Keeper never saves and holds** — every save deflects; parries into the box could allow a
  rebound mechanic later.
- **Post hits always go out**; the original occasionally let them bounce in. Easy add:
  random small chance the deflection crosses the line.
- **Kicker animation is minimal** (a lerp + lean, no leg swing frames).
- **No pause/visibility handling**: `dt` is clamped to 33 ms so tab-switching won't explode
  the physics, but a proper pause on `visibilitychange` would be cleaner.
- **DISTANCE stat always renders in the info row now** (see §4) — it used to be hidden below the `sm` breakpoint; that hiding was removed for consistency with the other stats, but it hasn't been checked on an actual small phone yet, so watch for crowding on the narrowest supported widths. The cup-run rework made the left stat group wider still (SCORE + STAGE + TRIES dots), so small-width crowding is now *more* likely, not less.
- Playtest before trusting any feel judgment baked into the constants.
  The original HUD/camera rework was verified visually via automated Playwright screenshots (see §10), not by a human playing it.
  The later HUD-relocation, ⚽-button, and penalty-box-distance changes were verified only via `npm run build` succeeding. A real playtest of those changes is still outstanding.
- **The stage difficulty curve is untested by a human** (same caveat pattern as above). The whole cup-run mode was verified via automated Playwright runs with rigged ball trajectories — nobody has yet played stages 1→10 honestly to judge whether the distance/wind ramp feels fair, whether `STAGE_KP_SIGMA = 0.9` makes the keeper too strong on near stages or too weak on far ones, or whether 5 tries is the right budget. The `STAGES` table in `constants.js` is a starting point, not a tuned curve.

## 7. Suggested next steps (web prototype)

1. Human playtest of the stage curve (see §6) and tune the `STAGES` table accordingly.
2. Add a debug panel (dat.gui or plain sliders) bound to the §5 constants for live tuning.
3. Difficulty/mode design: practice mode (free play on any spot), endless mode past stage 10.
4. Haptics stub: `navigator.vibrate(10)` on gauge locks — previews the iOS haptic design.
5. Optional: replace rect-figures with sprite sheets once art direction is decided.
6. Playtest the HUD relocation and ⚽ button on a real device/browser (see §6) — they've only been verified via automated screenshots, not by hand.

## 8. iOS port plan (the actual goal)

- **Engine**: SpriteKit + Swift. Do **not** use SpriteKit's physics engine for the ball —
  port the parametric integration from `physics.js` verbatim (it's a small, self-contained module by design).
  The camera projection in `render.js` is presentation-only and iOS-specific — do not port `CAM`/`TILT_DEG` as-is, redesign the camera for whatever iOS presentation style you pick (2.5-D `SKNode` layers vs true 3D via SceneKit/RealityKit).
- **1:1 mappings**: `requestAnimationFrame` → `SKScene.update(_:)`; canvas layers → `SKNode`
  hierarchy; taps → `touchesBegan`; the state machine → a Swift `enum Phase`.
- **Gauges**: rebuild as an `SKNode` lower-third; add `UIImpactFeedbackGenerator` (.light on
  lock 1–2, .medium on the strike) — this is where native will immediately feel better than web.
- **Persistence/social**: `UserDefaults` for the run records (mirror `storage.js`'s three keys), Game Center leaderboard for best cup-run score.
- **⚠ Legal**: ship with original art, generic branding ("Free Kick Legend"), and **no use of
  Roberto Baggio's name or likeness** — right-of-publicity risk. Game *mechanics* are not
  protectable; names/likenesses/art are.

## 9. Useful Claude Code starter prompts

- "Read HANDOVER.md §6 and pick off one of the known issues."
- "Add a collapsible debug panel with sliders for every constant in HANDOVER.md §5, live-bound
  to the game state."
- "Extract the flight model and collision checks into unit tests: a straight 15° shot from 20 m must cross the goal plane between y=1.0 and y=2.2."
- "Port physics.js to Swift as FlightModel.swift per §8, preserving all constants."
- "Playtest stages 1–10 and retune the STAGES table per §6/§7."

## 10. How visual changes were verified this session (no browser extension available)

The Claude-in-Chrome browser extension was not connected in this environment, so visual changes were verified with a small local Playwright harness instead of manual clicking.
The pattern, if you need to repeat it:

1. `npx playwright install chromium` once (downloads a local headless Chromium, ~300MB).
2. Run `npm run dev` in the background.
3. A Node script using `playwright`'s `chromium.launch()` + `page.goto(...)` + `page.keyboard.press("Space")` drives the game through its phases and calls `page.screenshot()` at each one.
4. For states that are hard to reach via normal play (e.g. forcing a `GOAL` to check the net flash), the dev-only `window.__game` hook (see §3) was mutated directly via `page.evaluate()`, then a frame was allowed to render before screenshotting.

None of the Playwright scripts or the downloaded Chromium are part of this repo — they were scratch tooling in a temp directory, not committed here.
