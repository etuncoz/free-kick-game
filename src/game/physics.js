import { BALL_R, GOAL_H, GOAL_HALF, MAX_WIND_KMH, TOTAL_KICKS, clamp, easeOut, lerp, ping, rnd } from "./constants";

/* ------------------------------------------------------------------
   Pure game-state functions: scenario generation, the flight model,
   collision checks and scoring. Nothing in this file touches React,
   the DOM, or audio - it only reads/mutates the plain game object `g`
   and reports what happened via return values, so it can be ported to
   Swift/SpriteKit verbatim (see HANDOVER.md §8).
------------------------------------------------------------------- */

export function createGameState() {
  return {
    phase: "menu",
    score: 0,
    best: 0,
    kick: 1,
    goals: 0,
    streak: 0,
    crowd: null,
    D: 22,
    gx: 0,
    wallZ: 9.15,
    wallX: 0,
    wallN: 4,
    wallHalf: 1.1,
    ball: { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 },
    trail: [],
    locked: { h: null, d: null, s: null },
    gaugeT: 0,
    gaugeSpeed: 1.1,
    kpX: 0,
    kpStart: 0,
    kpTarget: 0,
    kpAngle: 0,
    kpLift: 0,
    wind: 0,
    windAx: 0,
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

export function newScenario(g) {
  const k = g.kick;
  g.D = rnd(17, 26.5); // distance to goal line
  g.gx = rnd(-5.2, 5.2); // goal centre offset (angle of the free kick)
  g.wallZ = Math.min(9.15, g.D * 0.5);
  const n = Math.random() < 0.5 ? 4 : Math.random() < 0.5 ? 3 : 5;
  const nearPostAim = g.gx - Math.sign(g.gx || 1) * 1.7;
  g.wallX = (nearPostAim * g.wallZ) / g.D + rnd(-0.3, 0.3);
  g.wallN = n;
  g.wallHalf = (n * 0.56) / 2;
  g.wallWillJump = Math.random() < 0.8;
  g.wallJumpT = 0;
  g.wallJh = 0;
  // wind ramps up over the session, capped at MAX_WIND_KMH
  const maxWindKmh = MAX_WIND_KMH * (0.4 + 0.6 * (k / TOTAL_KICKS));
  const maxW = maxWindKmh / 26;
  g.wind = rnd(-maxW, maxW);
  g.windAx = g.wind * 3.1;
  // keeper
  g.kpX = g.gx + Math.sign(g.gx || (Math.random() < 0.5 ? 1 : -1)) * 0.45;
  g.kpX = clamp(g.kpX, g.gx - 2.2, g.gx + 2.2);
  g.kpStart = g.kpX;
  g.kpTarget = g.kpX;
  g.kpAngle = 0;
  g.kpLift = 0;
  g.kpSigma = Math.max(0.35, 1.45 - k * 0.11); // prediction error shrinks
  // ball + gauges
  g.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
  g.trail = [];
  g.locked = { h: null, d: null, s: null };
  g.gaugeT = 0;
  g.gaugeSpeed = 1.05 + k * 0.07;
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
    kick: k,
    windKmh: Math.round(Math.abs(g.wind) * 26),
    windDir: g.wind >= 0 ? 1 : -1,
    msg: null,
  };
}

export function launch(g) {
  const { h, d, s } = g.locked;
  const theta = ((3 + h * 32) * Math.PI) / 180; // elevation
  const speed = 20.5 + (1 - h) * 3.5;
  const phi0 = Math.atan2(g.gx, g.D); // baseline: straight at goal centre
  const phi = phi0 + (d * 15 * Math.PI) / 180;
  g.ball.vx = speed * Math.cos(theta) * Math.sin(phi);
  g.ball.vz = speed * Math.cos(theta) * Math.cos(phi);
  g.ball.vy = speed * Math.sin(theta);
  g.curlAx = s * 12.5;
  // schedule the wall jump just before the ball arrives
  const tWall = g.wallZ / g.ball.vz;
  g.wallJumpT = Math.max(0.05, tWall - 0.3);
  // keeper prediction (with human error)
  const T = g.D / g.ball.vz;
  const gauss = (Math.random() + Math.random() + Math.random() - 1.5) * 1.2;
  const predX = g.ball.vx * T + 0.5 * (g.curlAx + g.windAx) * T * T + gauss * g.kpSigma;
  const predY = Math.max(0.2, g.ball.vy * T - 4.905 * T * T);
  g.kpTarget = clamp(predX, g.gx - 3.35, g.gx + 3.35);
  g.kpPredY = clamp(predY, 0.2, 2.3);
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
  if (res === "GOAL") {
    g.netRipple = 1;
    g.netHitX = hitX;
    g.netHitY = hitY;
    g.streak += 1;
    g.goals += 1;
    const corner = Math.abs(hitX - g.gx) > 2.75 || hitY > 1.9;
    const bonus = (g.streak - 1) * 25 + (corner ? 50 : 0);
    g.lastPoints = 100 + bonus;
    g.resultDetail = corner
      ? `Top bin! +${g.lastPoints}`
      : g.streak > 1
      ? `Streak x${g.streak}  +${g.lastPoints}`
      : `+${g.lastPoints}`;
    g.score += g.lastPoints;
  } else {
    g.streak = 0;
    g.lastPoints = 0;
    if (res === "SAVED") g.resultDetail = "The keeper read it";
    else if (res === "WALL") g.resultDetail = "Straight into the wall";
    else if (res === "POST") g.resultDetail = "Off the woodwork!";
    else if (res === "OVER") g.resultDetail = "Row Z";
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
      const ax = (g.curlAx || 0) * (g.phase === "flight" ? 1 : 0) + (g.phase === "flight" ? g.windAx : 0);
      b.vx += ax * h - 0.06 * b.vx * h;
      b.vy += -9.81 * h - 0.04 * b.vy * h;
      b.vz += -0.06 * b.vz * h;
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
        const top = 1.86 + g.wallJh;
        const under = g.wallJh > 0.22 && iy < g.wallJh * 0.85;
        if (Math.abs(ix - g.wallX) < g.wallHalf + BALL_R && iy < top && !under) {
          b.z = g.wallZ - 0.05;
          b.vz = -Math.abs(b.vz) * 0.22;
          b.vx *= 0.25;
          b.vy = Math.min(b.vy, 1.5);
          const name = finishKick(g, "WALL");
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
          // keeper?
          const dx = Math.abs(ix - g.kpX);
          const bodySave = dx < 0.55 && iy < 2.25;
          const diveSave = dx < 1.5 && iy < 2.15 - 0.75 * (dx / 1.5) && iy > 0.05;
          if (bodySave || diveSave) {
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
    // keeper animation
    if (g.flightT > g.kpDelay) {
      const p = clamp((g.flightT - g.kpDelay) / g.kpDur, 0, 1);
      const e = easeOut(p);
      g.kpX = lerp(g.kpStart, g.kpTarget, e);
      const delta = g.kpTarget - g.kpStart;
      if (Math.abs(delta) > 1.0) {
        g.kpAngle = Math.sign(delta) * e * (g.kpPredY < 1.0 ? 1.15 : 0.8);
        g.kpLift = e * (g.kpPredY > 1.2 ? 0.5 : 0.12);
      } else if (g.kpPredY > 1.6) {
        g.kpLift = e * 0.45;
      }
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
