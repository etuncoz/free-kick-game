// goal frame, 1.25x regulation size (7.32 x 2.44 m) - a bit oversized so
// scoring is easier; the keeper's reach was NOT scaled with it, so the
// enlarged corners are his weak spot by design
export const GOAL_HALF = 4.58; // metres, half the goal mouth
export const GOAL_H = 3.05;
export const BALL_R = 0.11;
export const PENALTY_BOX_DEPTH = 16.5; // metres, box edge from the goal line

// ---- Cup Run stage mode -------------------------------------------------
// The kick spot (d = distance to goal line, gx = goal-centre offset) is
// fixed for all tries of a stage; wind re-rolls each try within the stage's
// cap. Difficulty comes only from distance + wind - keeper skill and gauge
// speed stay constant (see STAGE_KP_SIGMA / STAGE_GAUGE_SPEED).
export const STAGES = [
  { d: 19.0, gx: 0.0, maxWindKmh: 0 },
  { d: 20.0, gx: 3.5, maxWindKmh: 2 },
  { d: 21.0, gx: -4.5, maxWindKmh: 3 },
  { d: 22.0, gx: 6.0, maxWindKmh: 4 },
  { d: 23.0, gx: -7.0, maxWindKmh: 5 },
  { d: 24.0, gx: 5.0, maxWindKmh: 6 },
  { d: 25.5, gx: -8.5, maxWindKmh: 7 },
  { d: 27.0, gx: 9.0, maxWindKmh: 8 },
  { d: 28.5, gx: -10.0, maxWindKmh: 9 },
  { d: 30.0, gx: 10.0, maxWindKmh: 10 },
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
