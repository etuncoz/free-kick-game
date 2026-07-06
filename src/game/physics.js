import {
  BALL_R,
  CURL_ACCEL,
  DIR_GOAL_WINDOW,
  CUP_EVERY,
  GOAL_H,
  GOAL_HALF,
  STAGE_GAUGE_SPEED,
  STAGE_KP_SIGMA,
  TOTAL_STAGES,
  TRIES_PER_STAGE,
  stageSpec,
  WIND_UNIT_KMH,
  clamp,
  easeOut,
  lerp,
  ping,
  rnd,
} from "./constants";

/* ------------------------------------------------------------------
   Pure game-state functions: scenario generation, the flight model,
   collision checks and scoring. Nothing in this file touches React,
   the DOM, or audio - it only reads/mutates the plain game object `g`
   and reports what happened via return values, so it can be ported to
   Swift/SpriteKit verbatim (see HANDOVER.md §8).
------------------------------------------------------------------- */

// the keeper's body, as far as saves are concerned, is a capsule that
// matches the drawn sprite: a segment of this length from his feet along
// his (possibly dive-rotated, lifted) body, padded by this radius - which
// also covers his spread arms when standing.
export const KP_BODY_LEN = 1.95;
export const KP_SAVE_RADIUS = 0.5;
// how far (metres, at full swerve) the keeper misjudges a curled ball: he
// commits toward the bow side, and the late break brings the ball back
// inside him. This is what makes bending it a weapon against the keeper
// and not just a way around the wall - straight shots are read perfectly
// (minus kpSigma noise). Distance-independent on purpose: a fractional
// under-read of the curl term would grow with T² and hand far stages an
// enormous curl edge.
export const KP_CURL_MISREAD = 1.0;
// keeper coverage as fractions of the goal size, so corners stay his weak
// spot however big the goal is. The reach fraction is lower than the old
// 3.35/4.58 because his outstretched body tip covers ~0.8m beyond the
// clamp when diving - 0.68 keeps the beatable low-corner strip at ~9% of
// the goal mouth, matching the 1.25x-goal tuning (verified by sim sweep).
export const KP_REACH_X = GOAL_HALF * 0.68; // furthest his dive can cover
const KP_START_CLAMP = GOAL_HALF * 0.48; // how far off centre he starts
const KP_PREDY_MAX = GOAL_H * 0.75; // highest point he plans to meet

export function createGameState() {
  return {
    phase: "menu",
    score: 0,
    best: 0,
    stage: 1,
    triesLeft: TRIES_PER_STAGE,
    goals: 0,
    streak: 0,
    cups: 0, // cups claimed this run, one per CUP_EVERY stages cleared
    // set when the dev-only admin panel jumps the run to a chosen stage; a
    // test run never writes best-stage/best-score/cup records at run end
    testRun: false,
    crowd: null,
    D: 22,
    gx: 0,
    wallZ: 9.15,
    wallX: 0,
    wallN: 4,
    stageWallN: 4,
    wallHalf: 1.1,
    wallScale: 1,
    windSwirl: 0,
    ball: { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 },
    trail: [],
    tryMarks: [], // where earlier tries of this stage ended (ghost X marks)
    locked: { h: null, d: null, s: null },
    gaugeT: 0,
    gaugeSpeed: 1.1,
    kpX: 0,
    kpStart: 0,
    kpTarget: 0,
    kpAngle: 0,
    kpLift: 0,
    kpDiveAngle: 0,
    kpDiveLift: 0,
    windX: 0,
    windZ: 0,
    windAx: 0,
    windAz: 0,
    netRipple: 0,
    netHitX: 0,
    netHitY: 0,
  };
}

// the gauge's live 0..1 position - shared by input locking (onAction) and
// the HUD marker (render.js) so the CURL x1.15 speed multiplier only
// lives in one place.
export function gaugePos(g, key) {
  const mult = key === "s" ? 1.15 : 1;
  return ping(g.gaugeT * g.gaugeSpeed * mult);
}

// what tapping through a result banner should lead to. Kept here (pure,
// reads only the game object) so the whole 50-stage run flow - cups every
// CUP_EVERY stages, the final win, retries and knockouts - is unit-testable
// without the React shell.
export function advanceOutcome(g) {
  if (g.result === "GOAL") {
    if (g.stage >= TOTAL_STAGES) return "won";
    if (g.stage % CUP_EVERY === 0) return "cup";
    return "next";
  }
  return g.triesLeft > 0 ? "retry" : "gameover";
}

export function newScenario(g) {
  // the kick spot is pinned by the stage spec - all tries of a stage are
  // taken from the exact same place; only wind/wall/keeper noise re-roll
  const st = stageSpec(g.stage);
  g.D = st.d;
  g.gx = st.gx;
  g.wallZ = Math.min(9.15, g.D * 0.5);
  // the wall's player count is part of the stage, not the try: roll it on
  // the first try (a fresh stage always enters with a full try budget) and
  // keep it for every retry; position jitter and the jump still re-roll.
  const mods = st.mods || {};
  if (g.triesLeft === TRIES_PER_STAGE) {
    // gimmick stages pin their wall size; the rest roll 3-5 per stage
    g.stageWallN = mods.wallN ?? (Math.random() < 0.5 ? 4 : Math.random() < 0.5 ? 3 : 5);
    // the ghost marks of earlier tries only make sense within one stage -
    // a fresh stage (full try budget) starts with a clean slate; retries
    // deliberately keep them so the player can walk their aim in
    g.tryMarks = [];
  }
  const n = g.stageWallN;
  const nearPostAim = g.gx - Math.sign(g.gx || 1) * 1.7;
  const jitter = mods.wallJitter ?? 0.3;
  g.wallX = (nearPostAim * g.wallZ) / g.D + rnd(-jitter, jitter);
  g.wallN = n;
  g.wallScale = mods.wallScale ?? 1;
  g.wallHalf = (n * 0.56 * g.wallScale) / 2;
  g.wallWillJump = Math.random() < (mods.wallJumpChance ?? 0.8);
  g.wallJumpT = 0;
  g.wallJh = 0;
  // wind re-rolls each try, capped by the stage's difficulty band. It blows
  // from any compass direction: the x component pushes the ball sideways,
  // the z component is head/tailwind (0 rad = blowing toward the goal).
  const maxW = st.maxWindKmh / WIND_UNIT_KMH;
  const windMag = rnd((mods.windMinFrac ?? 0) * maxW, maxW);
  const windAng = rnd(0, Math.PI * 2);
  g.windX = windMag * Math.sin(windAng);
  g.windZ = windMag * Math.cos(windAng);
  g.windAx = g.windX * 3.1;
  g.windAz = g.windZ * 3.1;
  g.windSwirl = mods.windSwirl ?? 0;
  // keeper: by default he shades slightly toward the far post; a kpBias
  // stage pins him a set distance toward the near post (negative = far)
  const nearDir = -Math.sign(g.gx || (Math.random() < 0.5 ? 1 : -1));
  g.kpX =
    mods.kpBias != null
      ? g.gx + nearDir * mods.kpBias
      : g.gx - nearDir * 0.45;
  g.kpX = clamp(g.kpX, g.gx - KP_START_CLAMP, g.gx + KP_START_CLAMP);
  g.kpStart = g.kpX;
  g.kpTarget = g.kpX;
  g.kpAngle = 0;
  g.kpLift = 0;
  g.kpSigma = mods.kpSigma ?? STAGE_KP_SIGMA;
  g.kpReach = KP_REACH_X * (mods.kpReach ?? 1);
  // ball + gauges
  g.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
  g.trail = [];
  g.locked = { h: null, d: null, s: null };
  g.gaugeT = 0;
  g.gaugeSpeed = mods.gaugeSpeed ?? STAGE_GAUGE_SPEED;
  g.t = 0;
  g.runT = 0;
  g.settleT = 0;
  g.result = null;
  g.resultDetail = "";
  g.netRipple = 0;
  g.netHitX = g.gx;
  g.bounced = false;
  g.phase = "aim1";
  return {
    phase: "aim1",
    stage: g.stage,
    stageName: st.name,
    triesLeft: g.triesLeft,
    distance: Math.round(g.D),
    windKmh: Math.round(Math.hypot(g.windX, g.windZ) * WIND_UNIT_KMH),
    // compass bearing for the HUD arrow: 0° blows toward the goal (up on
    // screen), 90° blows right, 180° back at the kicker. Guarded because a
    // windless roll can produce -0 components and atan2(0, -0) is 180° -
    // the arrow on a calm day must not point at the kicker's face.
    windDeg: windMag === 0 ? 0 : Math.round((Math.atan2(g.windX, g.windZ) * 180) / Math.PI),
    msg: null,
  };
}

export function launch(g) {
  const { h, d, s } = g.locked;
  const theta = ((3 + h * 32) * Math.PI) / 180; // elevation
  const speed = 20.5 + (1 - h) * 3.5;
  // DIRECTION sweeps a cone around the goal centre, sized so the goal mouth
  // always covers the same fixed fraction of the gauge (DIR_GOAL_WINDOW) -
  // the gauge picture never changes between stages, while full deflection
  // still sprays far wide of the frame
  const cone = Math.atan(GOAL_HALF / g.D) / DIR_GOAL_WINDOW;
  const phi = Math.atan2(g.gx, g.D) + d * cone;
  g.ball.vx = speed * Math.cos(theta) * Math.sin(phi);
  g.ball.vz = speed * Math.cos(theta) * Math.cos(phi);
  g.ball.vy = speed * Math.sin(theta);
  const T = g.D / g.ball.vz;
  // SWERVE is a banana, not a drift: the ball leaves offset TOWARD the
  // chosen side while the curl pulls the other way, bowing out around the
  // wall and returning to the aimed line at the goal plane (v0 = a·T/2
  // cancels the ½aT² curl displacement exactly, before drag).
  g.curlAx = -s * CURL_ACCEL;
  g.ball.vx += s * CURL_ACCEL * (T / 2);
  // schedule the wall jump just before the ball arrives
  const tWall = g.wallZ / g.ball.vz;
  g.wallJumpT = Math.max(0.05, tWall - 0.3);
  // keeper prediction (with human error)
  const gauss = (Math.random() + Math.random() + Math.random() - 1.5) * 1.2;
  const predX =
    g.ball.vx * T +
    0.5 * (g.curlAx + g.windAx) * T * T +
    s * KP_CURL_MISREAD + // he buys the bow and misses the late break back
    gauss * g.kpSigma;
  const predY = Math.max(0.2, g.ball.vy * T - 4.905 * T * T);
  const reachX = clamp(predX, g.gx - (g.kpReach ?? KP_REACH_X), g.gx + (g.kpReach ?? KP_REACH_X));
  g.kpPredY = clamp(predY, 0.2, KP_PREDY_MAX);
  // decide the final pose now (the animation in step() just eases into it):
  // a long way to cover means a dive, flatter for low balls; short shuffles
  // stay upright, with a straight jump for high balls.
  const deltaRaw = reachX - g.kpStart;
  if (Math.abs(deltaRaw) > 1.0) {
    g.kpDiveAngle = Math.sign(deltaRaw) * (g.kpPredY < 1.0 ? 1.15 : 0.8);
    g.kpDiveLift = g.kpPredY > 1.2 ? 0.5 : 0.12;
  } else {
    g.kpDiveAngle = 0;
    g.kpDiveLift = g.kpPredY > 1.6 ? 0.45 : 0;
  }
  // aim the FEET so the rotated body lands on the predicted point - a diver
  // meets the ball with his torso/hands, not his feet. Without this offset
  // the body overshoots the prediction and the ball sails behind his legs.
  const tBody = clamp((g.kpPredY - g.kpDiveLift) / Math.cos(g.kpDiveAngle), 0, KP_BODY_LEN);
  g.kpTarget = reachX - Math.sin(g.kpDiveAngle) * tBody;
  g.kpDelay = 0.24;
  g.kpDur = Math.max(0.3, T - g.kpDelay - 0.05);
  g.flightT = 0;
  g.phase = "flight";
}

const RESULT_TITLES = {
  GOAL: "GOAL!",
  SAVED: "SAVED",
  WALL: "BLOCKED",
  POST: "POST!",
  OVER: "OVER",
  WIDE: "WIDE",
};

function finishKick(g, res, hitX, hitY) {
  g.result = res;
  g.phase = "settle";
  g.settleT = 0;
  // remember where this try ended for the retry ghost markers - at the
  // goal plane, or at the wall plane for blocked shots. The safety
  // timeout calls in without coords; there is nothing meaningful to mark.
  if (hitX != null) {
    g.tryMarks.push({ x: hitX, y: hitY, z: res === "WALL" ? g.wallZ : g.D, result: res });
    if (g.tryMarks.length > TRIES_PER_STAGE - 1) g.tryMarks.shift();
  }
  if (res === "GOAL") {
    g.netRipple = 1;
    g.netHitX = hitX;
    g.netHitY = hitY;
    g.streak += 1;
    g.goals += 1;
    const spareTries = g.triesLeft - 1; // this try was used
    // "top bin": the outer ~quarter of the frame, scaled with the goal size
    const corner = Math.abs(hitX - g.gx) > GOAL_HALF * 0.75 || hitY > GOAL_H * 0.78;
    const bonus = (g.streak - 1) * 25 + spareTries * 25 + (corner ? 50 : 0);
    g.lastPoints = 100 + bonus;
    g.resultDetail = corner
      ? `Top bin! +${g.lastPoints}`
      : g.streak > 1
      ? `Streak x${g.streak}  +${g.lastPoints}`
      : `+${g.lastPoints}`;
    g.score += g.lastPoints;
  } else {
    g.triesLeft -= 1;
    g.streak = 0;
    g.lastPoints = 0;
    if (res === "SAVED") g.resultDetail = "The keeper read it";
    else if (res === "WALL") g.resultDetail = "Straight into the wall";
    else if (res === "POST") g.resultDetail = "Off the woodwork!";
    else if (res === "OVER") g.resultDetail = "Off the mark!";
    else g.resultDetail = "Wide of the mark";
  }
  const sfxByResult = { GOAL: "goal", SAVED: "save", WALL: "wall", POST: "post", OVER: "miss", WIDE: "miss" };
  return sfxByResult[res];
}

function resultHudPatch(g) {
  return {
    phase: "result",
    score: g.score,
    goals: g.goals,
    streak: g.streak,
    stage: g.stage,
    triesLeft: g.triesLeft,
    msg: { title: RESULT_TITLES[g.result], sub: g.resultDetail, tone: g.result === "GOAL" ? "goal" : "miss" },
  };
}

// Advances the simulation by `dt` seconds and returns a list of events the
// caller (the React component) should react to - playing a sound effect or
// pushing a HUD patch - since this module has no side effects of its own.
export function step(g, dt) {
  const events = [];

  if (["aim1", "aim2", "aim3"].includes(g.phase)) {
    g.gaugeT += dt;
    // keeper idle sway
    g.kpX = g.kpStart + Math.sin(performance.now() / 700) * 0.12;
  }

  if (g.phase === "runup") {
    g.runT += dt;
    if (g.runT >= 0.38) {
      launch(g);
      events.push({ type: "sfx", name: "kick" });
    }
  }

  if (g.phase === "flight" || g.phase === "settle") {
    if (g.phase === "flight") g.flightT += dt;
    if (g.phase === "settle") g.settleT += dt;
    const b = g.ball;
    const sub = 2;
    for (let i = 0; i < sub; i++) {
      const h = dt / sub;
      const prevX = b.x;
      const prevY = b.y;
      const prevZ = b.z;
      const inFlight = g.phase === "flight";
      // a swirl stage's wind direction keeps turning while the ball is up
      if (inFlight && g.windSwirl) {
        const rot = g.windSwirl * h;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const ax0 = g.windAx;
        const az0 = g.windAz;
        g.windAx = ax0 * cr - az0 * sr;
        g.windAz = ax0 * sr + az0 * cr;
      }
      const ax = (inFlight ? g.curlAx || 0 : 0) + (inFlight ? g.windAx : 0);
      const az = inFlight ? g.windAz : 0; // head/tailwind
      b.vx += ax * h - 0.06 * b.vx * h;
      b.vy += -9.81 * h - 0.04 * b.vy * h;
      b.vz += az * h - 0.06 * b.vz * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;
      b.spin += b.vz * h * 1.6;

      // ground clamp always applies - even once the result is decided and
      // we're just settling, the ball must never visually sink below the
      // pitch surface.
      if (b.y < BALL_R && b.vy < 0) {
        b.y = BALL_R;
        b.vy = -b.vy * 0.45;
        b.vx *= 0.85;
        b.vz *= 0.88;
      }

      if (g.phase !== "flight") continue;

      // wall plane
      if (prevZ < g.wallZ && b.z >= g.wallZ) {
        const t = (g.wallZ - prevZ) / (b.z - prevZ);
        const ix = lerp(prevX, b.x, t);
        const iy = lerp(prevY, b.y, t);
        const top = 1.86 * (g.wallScale || 1) + g.wallJh;
        const under = g.wallJh > 0.22 && iy < g.wallJh * 0.85;
        if (Math.abs(ix - g.wallX) < g.wallHalf + BALL_R && iy < top && !under) {
          b.z = g.wallZ - 0.05;
          b.vz = -Math.abs(b.vz) * 0.22;
          b.vx *= 0.25;
          b.vy = Math.min(b.vy, 1.5);
          const name = finishKick(g, "WALL", ix, iy);
          events.push({ type: "sfx", name });
          break;
        }
      }

      // goal plane
      if (prevZ < g.D && b.z >= g.D) {
        const t = (g.D - prevZ) / (b.z - prevZ);
        const ix = lerp(prevX, b.x, t);
        const iy = lerp(prevY, b.y, t);
        const relX = ix - g.gx;
        const postHit =
          (Math.abs(Math.abs(relX) - GOAL_HALF) < BALL_R + 0.05 && iy < GOAL_H + 0.05) ||
          (Math.abs(iy - GOAL_H) < BALL_R + 0.04 && Math.abs(relX) < GOAL_HALF);
        const inFrame = Math.abs(relX) < GOAL_HALF - 0.05 && iy < GOAL_H - 0.04;
        if (postHit && !inFrame) {
          b.z = g.D - 0.05;
          b.vz = -Math.abs(b.vz) * 0.35;
          b.vx = -b.vx * 0.3 + rnd(-1, 1);
          const name = finishKick(g, "POST", ix, iy);
          events.push({ type: "sfx", name });
          break;
        }
        if (inFrame) {
          // keeper? a save is the ball touching his drawn body - the capsule
          // from his feet along his current (rotated, lifted) pose - so what
          // the player sees and what the physics decides can never disagree.
          const sinA = Math.sin(g.kpAngle);
          const cosA = Math.cos(g.kpAngle);
          const rx = ix - g.kpX;
          const ry = iy - g.kpLift;
          const tSeg = clamp(rx * sinA + ry * cosA, 0, KP_BODY_LEN);
          const distToBody = Math.hypot(rx - sinA * tSeg, ry - cosA * tSeg);
          if (distToBody < KP_SAVE_RADIUS + BALL_R) {
            b.z = g.D - 0.15;
            b.vz = -Math.abs(b.vz) * 0.2;
            b.vx *= 0.2;
            b.vy = Math.min(b.vy, 0.5);
            const name = finishKick(g, "SAVED", ix, iy);
            events.push({ type: "sfx", name });
            break;
          }
          const name = finishKick(g, "GOAL", ix, iy);
          events.push({ type: "sfx", name });
          break;
        }
        // miss
        const name = finishKick(g, iy >= GOAL_H ? "OVER" : "WIDE", ix, iy);
        events.push({ type: "sfx", name });
        break;
      }

      // safety: sailed way past
      if (b.z > g.D + 14 || g.flightT > 4.5) {
        const name = finishKick(g, "WIDE");
        events.push({ type: "sfx", name });
        break;
      }
    }

    // wall jump animation
    if (g.wallWillJump && g.flightT > g.wallJumpT) {
      const jp = g.flightT - g.wallJumpT;
      g.wallJh = Math.max(0, 2.7 * jp - 3.6 * jp * jp);
    }
    // keeper animation - eases into the pose decided at launch()
    if (g.flightT > g.kpDelay) {
      const p = clamp((g.flightT - g.kpDelay) / g.kpDur, 0, 1);
      const e = easeOut(p);
      g.kpX = lerp(g.kpStart, g.kpTarget, e);
      g.kpAngle = e * g.kpDiveAngle;
      g.kpLift = e * g.kpDiveLift;
    }
    // net ball drag on goal
    if (g.phase === "settle" && g.result === "GOAL") {
      const b2 = g.ball;
      if (b2.z > g.D + 1.55) {
        b2.vz *= 0.6;
        b2.vx *= 0.6;
        if (b2.z > g.D + 1.7) {
          b2.z = g.D + 1.7;
          b2.vz = 0;
        }
      }
    }
    if (g.netRipple > 0) g.netRipple = Math.max(0, g.netRipple - dt * 1.4);

    if (g.phase === "settle" && g.settleT > 1.05) {
      g.phase = "result";
      events.push({ type: "hud", patch: resultHudPatch(g) });
    }
  }

  return events;
}
