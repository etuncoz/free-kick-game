export const GOAL_HALF = 3.66; // metres
export const GOAL_H = 2.44;
export const BALL_R = 0.11;
export const TOTAL_KICKS = 10;
export const MAX_WIND_KMH = 10;

export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// triangle ping-pong 0..1..0
export const ping = (t) => 1 - Math.abs(1 - (t % 2));
