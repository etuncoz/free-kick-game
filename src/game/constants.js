// goal frame, regulation size (7.32 x 2.44 m). The keeper's coverage is
// expressed as fractions of these in physics.js so the corners stay his
// designed weak spot at any goal size.
export const GOAL_HALF = 3.66; // metres, half the goal mouth
export const GOAL_H = 2.44;
export const BALL_R = 0.11;
export const PENALTY_BOX_DEPTH = 16.5; // metres, box edge from the goal line

// ---- Cup Run stage mode -------------------------------------------------
// The kick spot (d = distance to goal line, gx = goal-centre offset) is
// fixed for all tries of a stage; wind re-rolls each try within the stage's
// cap. Difficulty comes only from distance + wind - keeper skill and gauge
// speed stay constant (see STAGE_KP_SIGMA / STAGE_GAUGE_SPEED).
// Optional per-stage `mods` give stages a personality beyond distance/angle:
//   wallN          - fixed wall size (skips the per-stage 3-5 roll)
//   wallScale      - wall player size multiplier (height, width and reach)
//   wallJumpChance - overrides the default 0.8 jump probability
//   wallJitter     - wall placement jitter amplitude in metres (default 0.3;
//                    0 parks the wall dead on the near-post line)
//   kpSigma        - overrides STAGE_KP_SIGMA (lower = sharper keeper)
//   kpReach        - keeper dive reach multiplier
//   kpBias         - keeper's starting spot, metres toward the NEAR post
//                    (negative = cheats toward the far post)
//   gaugeSpeed     - overrides STAGE_GAUGE_SPEED for this stage
//   windMinFrac    - wind always rolls at least this fraction of the cap
//   windSwirl      - rad/s the wind direction rotates mid-flight
// These ten are the authored ARCHETYPES; the full 50-stage run revisits
// them lap after lap via stageSpec() below. Each has one clear identity:
export const STAGES = [
  // the gentle handshake: small wall, drowsy keeper, no wind
  { d: 19.0, gx: 0.0, maxWindKmh: 0, name: "THE OPENER", mods: { wallN: 3, kpSigma: 1.2 } },
  // the angle lesson: keeper cheats toward the far post, near post open
  { d: 20.0, gx: 3.5, maxWindKmh: 4, name: "OFF CENTRE", mods: { kpBias: -1.2 } },
  // the keeper duel: razor-sharp cat with extra reach, token wall
  { d: 21.0, gx: -4.5, maxWindKmh: 6, name: "THE CAT", mods: { kpSigma: 0.45, kpReach: 1.15, wallN: 3 } },
  // can't go over it: six tall men who never jump
  { d: 22.0, gx: 6.0, maxWindKmh: 8, name: "THE GREAT WALL", mods: { wallN: 6, wallJumpChance: 0, wallScale: 1.35 } },
  // the near-post lane is sealed shut: five men parked dead on the line
  { d: 23.0, gx: -7.0, maxWindKmh: 10, name: "THE SIDE ROAD", mods: { wallN: 5, wallJitter: 0 } },
  // the wind stage: always strong, and it turns while the ball is up
  { d: 24.0, gx: 5.0, maxWindKmh: 12, name: "SWIRLING GALE", mods: { windMinFrac: 0.85, windSwirl: 1.5 } },
  // keeper hugs the near post; the far corner is open but a long carry
  { d: 25.5, gx: -8.5, maxWindKmh: 14, name: "TIGHT ANGLE", mods: { kpBias: 1.8 } },
  // the pressure kick: distance does the work, the gauge races
  { d: 27.0, gx: 9.0, maxWindKmh: 16, name: "LONG RANGE", mods: { gaugeSpeed: 1.35, wallN: 3 } },
  // a wall twice the size of men: over is impossible, curl around it
  { d: 28.5, gx: -10.0, maxWindKmh: 18, name: "THE FORTRESS", mods: { wallN: 5, wallScale: 2.0, wallJumpChance: 0, kpSigma: 0.7 } },
  // everything at once
  { d: 30.0, gx: 10.0, maxWindKmh: 20, name: "THE FINAL", mods: { windMinFrac: 0.5, kpSigma: 0.8, wallN: 5, wallScale: 1.2, wallJumpChance: 1 } },
];
export const STAGES_PER_LAP = STAGES.length;
export const LAPS = 5;
export const TOTAL_STAGES = STAGES_PER_LAP * LAPS; // a 50-stage marathon
export const CUP_EVERY = STAGES_PER_LAP; // clearing every 10th stage wins a cup
export const TRIES_PER_STAGE = 5;

const LAP_SUFFIX = ["", " II", " III", " IV", " V"];

// hardest wind the game ever asks a player to fight, at any stage
export const WIND_MAX_KMH = 20;

// The effective spec for any stage of the run. Lap 0 is the authored table
// verbatim; each later lap revisits the same ten kicks harder: further out
// (+1.5 m per lap, capped at a still-kickable 35 m), a sharper keeper
// (-6% prediction noise per lap), and windier - the cap grows 25% of the
// authored value per lap but never past WIND_MAX_KMH (the authored table
// already peaks there at THE FINAL), and a rising floor (15% of the cap
// per lap, at most 60%) stops late stages from ever rolling a calm day.
// Windless archetypes stay windless.
export function stageSpec(stage) {
  const lap = Math.floor((stage - 1) / STAGES_PER_LAP);
  const base = STAGES[(stage - 1) % STAGES_PER_LAP];
  const mods = { ...(base.mods || {}) };
  mods.kpSigma = (mods.kpSigma ?? STAGE_KP_SIGMA) * (1 - 0.06 * lap);
  mods.windMinFrac = Math.max(mods.windMinFrac ?? 0, Math.min(0.6, 0.15 * lap));
  return {
    d: Math.min(35, base.d + lap * 1.5),
    gx: base.gx,
    maxWindKmh: Math.min(WIND_MAX_KMH, base.maxWindKmh * (1 + 0.25 * lap)),
    name: base.name + LAP_SUFFIX[lap],
    lap,
    mods,
  };
}
export const STAGE_KP_SIGMA = 0.9; // keeper prediction noise, constant all run
// gauge oscillation speed, constant all run - eased from the original 1.4
// (mid-range of the old per-kick ramp) after playtesting found it too fast
export const STAGE_GAUGE_SPEED = 1.2;
export const WIND_UNIT_KMH = 26; // 1 internal wind unit shown as 26 km/h

// the goal occupies this fixed fraction of the DIRECTION gauge, centred,
// identical on every stage - the sweep cone is derived from it per stage
// (cone = atan(GOAL_HALF/D) / DIR_GOAL_WINDOW, anchored at goal centre), so
// the gauge picture never moves while full deflection still sprays far wide.
export const DIR_GOAL_WINDOW = 0.35;
// lateral curl acceleration at full swerve. The launch compensates the
// initial direction so a swerved ball bows OUT toward the chosen side and
// curls back to land on the aimed line - the classic banana.
export const CURL_ACCEL = 12.5;

export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// triangle ping-pong 0..1..0
export const ping = (t) => 1 - Math.abs(1 - (t % 2));
