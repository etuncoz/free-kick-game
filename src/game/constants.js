export const GOAL_HALF = 3.66; // metres
export const GOAL_H = 2.44;
export const BALL_R = 0.11;
export const PENALTY_BOX_DEPTH = 16.5; // metres, box edge from the goal line

// ---- Cup Run stage mode -------------------------------------------------
// The kick spot (d = distance to goal line, gx = goal-centre offset) is
// fixed for all tries of a stage; wind re-rolls each try within the stage's
// cap. Difficulty comes only from distance + wind - keeper skill and gauge
// speed stay constant (see STAGE_KP_SIGMA / STAGE_GAUGE_SPEED).
export const STAGES = [
  { d: 19.0, gx: 0.0, maxWindKmh: 0 },
  { d: 20.0, gx: 2.0, maxWindKmh: 2 },
  { d: 21.0, gx: -2.5, maxWindKmh: 3 },
  { d: 22.0, gx: 3.2, maxWindKmh: 4 },
  { d: 23.0, gx: -3.8, maxWindKmh: 5 },
  { d: 24.0, gx: 1.5, maxWindKmh: 6 },
  { d: 25.5, gx: -4.5, maxWindKmh: 7 },
  { d: 27.0, gx: 4.8, maxWindKmh: 8 },
  { d: 28.5, gx: -5.2, maxWindKmh: 9 },
  { d: 30.0, gx: 5.2, maxWindKmh: 10 },
];
export const TOTAL_STAGES = STAGES.length;
export const TRIES_PER_STAGE = 5;
export const STAGE_KP_SIGMA = 0.9; // keeper prediction noise, constant all run
export const STAGE_GAUGE_SPEED = 1.4; // gauge oscillation speed, constant all run
export const WIND_UNIT_KMH = 26; // 1 internal wind unit shown as 26 km/h

export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// triangle ping-pong 0..1..0
export const ping = (t) => 1 - Math.abs(1 - (t % 2));
