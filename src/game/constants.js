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
//   wallJumpChance - overrides the default 0.8 jump probability
//   kpSigma        - overrides STAGE_KP_SIGMA (lower = sharper keeper)
//   windMinFrac    - wind always rolls at least this fraction of the cap
export const STAGES = [
  { d: 19.0, gx: 0.0, maxWindKmh: 0, name: "THE OPENER" },
  { d: 20.0, gx: 3.5, maxWindKmh: 2, name: "OFF CENTRE" },
  { d: 21.0, gx: -4.5, maxWindKmh: 3, name: "THE CAT", mods: { kpSigma: 0.55 } },
  { d: 22.0, gx: 6.0, maxWindKmh: 4, name: "THE GREAT WALL", mods: { wallN: 6, wallJumpChance: 0 } },
  { d: 23.0, gx: -7.0, maxWindKmh: 5, name: "THE SIDE ROAD" },
  { d: 24.0, gx: 5.0, maxWindKmh: 6, name: "SWIRLING GALE", mods: { windMinFrac: 0.75 } },
  { d: 25.5, gx: -8.5, maxWindKmh: 7, name: "TIGHT ANGLE" },
  { d: 27.0, gx: 9.0, maxWindKmh: 8, name: "LONG RANGE" },
  { d: 28.5, gx: -10.0, maxWindKmh: 9, name: "THE FORTRESS", mods: { wallN: 5, kpSigma: 0.7 } },
  { d: 30.0, gx: 10.0, maxWindKmh: 10, name: "THE FINAL", mods: { windMinFrac: 0.5, kpSigma: 0.8 } },
];
export const TOTAL_STAGES = STAGES.length;
export const TRIES_PER_STAGE = 5;
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
