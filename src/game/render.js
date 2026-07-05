import { BALL_R, GOAL_H, GOAL_HALF, clamp, easeOut, lerp } from "./constants";

/* ------------------------------------------------------------------
   Canvas 2D rendering: the pinhole projection, sprites, and pitch/
   goal/net. The gauge HUD lives in the DOM below the canvas (see
   MagicalKicks.jsx) so it never covers the kicker or ball. Pure
   presentation - reads `g` but never mutates game logic fields (it
   does own the `crowd` dot field and the `W`/`H`/`f`/`horizon`
   viewport fields, which are rendering state set by `resize`/
   `initCrowd` below).
------------------------------------------------------------------- */

export const CAM = { x: 0, y: 8, z: -14 };
// half-width of the actual playing surface - wide enough to always clear the
// penalty box even at the extreme free-kick angles (gx up to ±5.2, box half
// 20.15), so the box never gets clipped by the touchline.
const PITCH_HALF_WIDTH = 32;
// downward pitch of the camera, in degrees - this is what gives the
// elevated "birds-eye" broadcast-camera look instead of a player-eye view.
const TILT_DEG = 32;
const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);
const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);

export function initCrowd(g) {
  if (g.crowd) return;
  g.crowd = [];
  for (let i = 0; i < 900; i++) g.crowd.push([Math.random(), Math.random(), Math.random()]);
}

export function resize(canvas, wrap, g) {
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.W = r.width;
  g.H = r.height;
  g.f = r.width * 0.8;
  g.horizon = r.height * 0.2;
}

function project(g, wx, wy, wz) {
  const dx = wx - CAM.x;
  const dy = wy - CAM.y;
  const dz = wz - CAM.z;
  // depth along the camera's tilted look direction, not raw world z
  const depth = Math.max(0.6, dz * TILT_COS - dy * TILT_SIN);
  const s = g.f / depth;
  return { x: g.W / 2 + dx * s, y: g.horizon - (dy / TILT_COS) * s, s };
}

function drawPlayer(ctx, feet, s, o) {
  // chunky retro figure. feet = screen point, s = px per metre
  ctx.save();
  ctx.translate(feet.x, feet.y - (o.lift || 0) * s);
  if (o.angle) ctx.rotate(o.angle);
  const h = 1.84 * s;
  const w = 0.52 * s;
  // legs
  ctx.fillStyle = o.skin || "#c98d5e";
  ctx.fillRect(-w * 0.32, -h * 0.42, w * 0.24, h * 0.42);
  ctx.fillRect(w * 0.08, -h * 0.42, w * 0.24, h * 0.42);
  // socks
  ctx.fillStyle = o.sock || o.shorts || "#111";
  ctx.fillRect(-w * 0.34, -h * 0.2, w * 0.28, h * 0.2);
  ctx.fillRect(w * 0.06, -h * 0.2, w * 0.28, h * 0.2);
  // shorts
  ctx.fillStyle = o.shorts || "#fff";
  ctx.fillRect(-w * 0.42, -h * 0.55, w * 0.84, h * 0.16);
  // torso
  ctx.fillStyle = o.jersey || "#1d4ed8";
  ctx.fillRect(-w * 0.46, -h * 0.88, w * 0.92, h * 0.35);
  // arms
  if (o.armsUp) {
    ctx.fillRect(-w * 0.68, -h * 1.06, w * 0.2, h * 0.5);
    ctx.fillRect(w * 0.48, -h * 1.06, w * 0.2, h * 0.5);
  } else if (o.armsWide) {
    ctx.fillRect(-w * 1.0, -h * 0.86, w * 0.55, h * 0.16);
    ctx.fillRect(w * 0.45, -h * 0.86, w * 0.55, h * 0.16);
  } else {
    // crossed over chest (wall pose)
    ctx.fillRect(-w * 0.6, -h * 0.8, w * 1.2, h * 0.14);
  }
  // head
  ctx.fillStyle = o.skin || "#c98d5e";
  const hr = 0.13 * s;
  ctx.beginPath();
  ctx.arc(0, -h * 0.88 - hr * 1.1, hr, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = "#20160e";
  ctx.beginPath();
  ctx.arc(0, -h * 0.88 - hr * 1.3, hr * 0.92, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawScene(ctx, g) {
  const P = (wx, wy, wz) => project(g, wx, wy, wz);
  const W = g.W, H = g.H;
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, g.horizon);
  sky.addColorStop(0, "#0a1030");
  sky.addColorStop(1, "#1c2f66");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, g.horizon);
  // floodlight glows
  for (const fx of [0.08, 0.92]) {
    const gr = ctx.createRadialGradient(W * fx, 4, 2, W * fx, 4, W * 0.3);
    gr.addColorStop(0, "rgba(255,250,220,0.5)");
    gr.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, g.horizon);
    ctx.fillStyle = "#e8ecf5";
    ctx.fillRect(W * fx - 14, 2, 28, 7);
    ctx.fillStyle = "#374a7a";
    ctx.fillRect(W * fx - 2, 9, 4, g.horizon * 0.5);
  }
  // stands + crowd
  const standTop = g.horizon * 0.28;
  ctx.fillStyle = "#141d3f";
  ctx.fillRect(0, standTop, W, g.horizon - standTop);
  for (const [cx, cy, cc] of g.crowd) {
    const y = standTop + cy * (g.horizon - standTop - 4);
    ctx.fillStyle = cc < 0.15 ? "#facc15" : cc < 0.3 ? "#60a5fa" : cc < 0.42 ? "#f87171" : "#2b3a6b";
    ctx.fillRect(cx * W, y, 2.4, 2.4);
  }
  ctx.fillStyle = "rgba(6,10,26,0.55)";
  ctx.fillRect(0, g.horizon - 10, W, 10);

  // pitch surroundings (running track) - fills the whole lower half so the
  // in-bounds pitch clipped below reads as a distinct region, not a flat
  // continuation of the same green out to the edges of the screen
  ctx.fillStyle = "#5b4a36";
  ctx.fillRect(0, g.horizon, W, H - g.horizon);

  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  // in-bounds pitch, clipped to the touchlines. farZ is pushed out very far
  // so its projection hugs the horizon instead of cutting a visible band
  // behind the goal - only the left/right touchlines should read as edges.
  const nearZ = -4;
  const farZ = 260;
  const tlNearL = P(-PITCH_HALF_WIDTH, 0, nearZ);
  const tlNearR = P(PITCH_HALF_WIDTH, 0, nearZ);
  const tlFarR = P(PITCH_HALF_WIDTH, 0, farZ);
  const tlFarL = P(-PITCH_HALF_WIDTH, 0, farZ);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tlNearL.x, tlNearL.y);
  ctx.lineTo(tlNearR.x, tlNearR.y);
  ctx.lineTo(tlFarR.x, tlFarR.y);
  ctx.lineTo(tlFarL.x, tlFarL.y);
  ctx.closePath();
  ctx.clip();

  const grass = ctx.createLinearGradient(0, g.horizon, 0, H);
  grass.addColorStop(0, "#1a7a3d");
  grass.addColorStop(1, "#0f5f2d");
  ctx.fillStyle = grass;
  ctx.fillRect(0, g.horizon, W, H - g.horizon);
  // mowing stripes (bands in z)
  for (let i = 0; i < 16; i++) {
    const z0 = CAM.z + 1.2 + i * 3.2;
    const z1 = z0 + 3.2;
    const yFar = P(0, 0, z1).y;
    const yNear = P(0, 0, z0).y;
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, yFar, W, Math.max(0, yNear - yFar));
    }
  }
  ctx.restore();

  // touchlines - the actual boundary between the pitch and the surrounds
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(1, (g.f / (g.D + 8)) * 0.06);
  line(tlNearL, tlFarL);
  line(tlNearR, tlFarR);

  // pitch lines
  line(P(g.gx - 26, 0, g.D), P(g.gx + 26, 0, g.D)); // goal line
  // penalty box
  const bz = g.D - 16.5;
  if (bz > 1) {
    line(P(g.gx - 20.15, 0, bz), P(g.gx + 20.15, 0, bz));
    line(P(g.gx - 20.15, 0, bz), P(g.gx - 20.15, 0, g.D));
    line(P(g.gx + 20.15, 0, bz), P(g.gx + 20.15, 0, g.D));
  }
  const sz = g.D - 5.5;
  line(P(g.gx - 9.16, 0, sz), P(g.gx + 9.16, 0, sz));
  line(P(g.gx - 9.16, 0, sz), P(g.gx - 9.16, 0, g.D));
  line(P(g.gx + 9.16, 0, sz), P(g.gx + 9.16, 0, g.D));

  /* ---- goal + net ---- */
  const netZ = g.D + 1.7;
  const scored = g.result === "GOAL" && (g.phase === "flight" || g.phase === "settle");
  const ripple = g.netRipple > 0 ? Math.sin(g.netRipple * 18) * g.netRipple * (scored ? 0.6 : 0.35) : 0;

  // dark backing so the net threads read clearly against the pitch/crowd -
  // it flashes bright gold across the whole goal mouth on a GOAL, since the
  // net itself is too small on screen from this elevated camera to notice.
  const bl = P(g.gx - GOAL_HALF, 0, netZ);
  const br = P(g.gx + GOAL_HALF, 0, netZ);
  const trC = P(g.gx + GOAL_HALF, GOAL_H, netZ);
  const tlC = P(g.gx - GOAL_HALF, GOAL_H, netZ);
  const flashAmt = scored ? g.netRipple : 0;
  ctx.fillStyle =
    flashAmt > 0
      ? `rgba(${Math.round(4 + 245 * flashAmt)},${Math.round(12 + 210 * flashAmt)},${Math.round(10 + 90 * flashAmt)},${0.4 + flashAmt * 0.5})`
      : "rgba(4,12,10,0.4)";
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(trC.x, trC.y);
  ctx.lineTo(tlC.x, tlC.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(240,245,255,0.55)";
  ctx.lineWidth = 1.2;
  // back net grid
  for (let x = -GOAL_HALF; x <= GOAL_HALF + 0.01; x += 0.42) {
    const wobble = ripple * Math.exp(-Math.abs(x + g.gx - g.netHitX));
    const a = P(g.gx + x, 0, netZ + wobble);
    const b = P(g.gx + x, GOAL_H - 0.1, netZ + wobble);
    line(a, b);
  }
  for (let y = 0; y <= GOAL_H - 0.05; y += 0.4) {
    line(P(g.gx - GOAL_HALF, y, netZ + ripple * 0.4), P(g.gx + GOAL_HALF, y, netZ + ripple * 0.4));
  }
  // side nets
  for (let y = 0.2; y <= GOAL_H; y += 0.55) {
    line(P(g.gx - GOAL_HALF, y, g.D), P(g.gx - GOAL_HALF, Math.max(0, y - 0.35), netZ));
    line(P(g.gx + GOAL_HALF, y, g.D), P(g.gx + GOAL_HALF, Math.max(0, y - 0.35), netZ));
  }

  // goal flash - a big, unmissable burst + expanding ring at the moment the
  // ball hits the net, since the net itself is small on screen from this
  // elevated camera.
  if (scored && g.netRipple > 0) {
    const hitY = g.netHitY ?? GOAL_H * 0.5;
    const flashPt = P(g.netHitX, clamp(hitY, 0, GOAL_H), netZ);
    const grow = 1 - g.netRipple; // 0 at impact -> 1 as it fades
    const radius = 55 + grow * 190;
    const alpha = g.netRipple;
    const burst = ctx.createRadialGradient(flashPt.x, flashPt.y, 0, flashPt.x, flashPt.y, radius);
    burst.addColorStop(0, `rgba(255,255,255,${alpha})`);
    burst.addColorStop(0.35, `rgba(255,247,214,${alpha * 0.8})`);
    burst.addColorStop(0.7, `rgba(253,224,71,${alpha * 0.35})`);
    burst.addColorStop(1, "rgba(253,224,71,0)");
    ctx.fillStyle = burst;
    ctx.beginPath();
    ctx.arc(flashPt.x, flashPt.y, radius, 0, Math.PI * 2);
    ctx.fill();
    // expanding shockwave ring - reads even when the fill is tiny/faded
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(flashPt.x, flashPt.y, 18 + grow * 150, 0, Math.PI * 2);
    ctx.stroke();
  }

  // frame
  const pw = Math.max(2.5, 0.09 * P(0, 0, g.D).s);
  ctx.strokeStyle = "#f8fafc";
  ctx.lineCap = "round";
  ctx.lineWidth = pw;
  const pl = P(g.gx - GOAL_HALF, 0, g.D);
  const plt = P(g.gx - GOAL_HALF, GOAL_H, g.D);
  const pr = P(g.gx + GOAL_HALF, 0, g.D);
  const prt = P(g.gx + GOAL_HALF, GOAL_H, g.D);
  line(pl, plt);
  line(pr, prt);
  line(plt, prt);
  ctx.lineCap = "butt";

  /* ---- keeper ---- */
  const kp = P(g.kpX, 0, g.D - 0.25);
  drawPlayer(ctx, kp, kp.s, {
    jersey: "#facc15",
    shorts: "#111827",
    sock: "#111827",
    armsUp: g.phase === "flight" || g.phase === "settle" ? g.kpPredY > 1.3 : false,
    armsWide: !(g.phase === "flight" || g.phase === "settle"),
    angle: g.kpAngle,
    lift: g.kpLift,
  });

  /* ---- ball + wall, painter's order by depth ---- */
  const drawWall = () => {
    for (let i = 0; i < g.wallN; i++) {
      const wx = g.wallX - g.wallHalf + 0.28 + i * 0.56;
      const wp = P(wx, 0, g.wallZ);
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(wp.x, wp.y, 0.34 * wp.s, 0.1 * wp.s, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPlayer(ctx, wp, wp.s, {
        jersey: i % 2 ? "#b91c1c" : "#991b1b",
        shorts: "#f3f4f6",
        sock: "#b91c1c",
        lift: g.wallJh,
      });
    }
  };

  const drawBall = () => {
    const b = g.ball;
    // trail
    for (let i = 0; i < g.trail.length; i++) {
      const tr = g.trail[i];
      const a = i / g.trail.length;
      ctx.fillStyle = `rgba(255,255,255,${0.05 + a * 0.14})`;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.r * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    // shadow
    const sh = P(b.x, 0, b.z);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 0.16 * sh.s, 0.055 * sh.s, 0, 0, Math.PI * 2);
    ctx.fill();
    const bp = P(b.x, b.y, b.z);
    const r = Math.max(2.2, BALL_R * bp.s);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 4) {
      ctx.strokeStyle = "rgba(20,25,40,0.65)";
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, r * 0.55, b.spin, b.spin + 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, r * 0.55, b.spin + Math.PI, b.spin + Math.PI + 1.6);
      ctx.stroke();
      ctx.strokeStyle = "rgba(20,25,40,0.25)";
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (g.trail.length > 26) g.trail.shift();
    if (g.phase === "flight" || g.phase === "settle") g.trail.push({ x: bp.x, y: bp.y, r });
  };

  if (g.ball.z > g.wallZ) {
    drawWall();
    drawBall();
  } else {
    drawBall();
    drawWall();
  }

  /* ---- kicker ---- */
  const runP =
    g.phase === "runup"
      ? easeOut(Math.min(1, g.runT / 0.38))
      : g.phase === "flight" || g.phase === "settle"
      ? 1
      : 0;
  const kx = lerp(0.95, 0.18, runP);
  const kz = lerp(-1.6, -0.2, runP);
  const kfoot = P(kx, 0, kz);
  drawPlayer(ctx, kfoot, kfoot.s * 0.98, {
    jersey: "#1d4ed8",
    shorts: "#ffffff",
    sock: "#1d4ed8",
    angle: runP === 1 ? -0.28 : runP > 0 ? -0.12 : 0,
  });
}
