import { BALL_R, GOAL_H, GOAL_HALF, PENALTY_BOX_DEPTH, clamp, easeOut, lerp } from "./constants";

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
// penalty box even at the extreme free-kick angles (gx up to ±10, box half
// 20.15 -> 30.15), so the box never gets clipped by the touchline.
const PITCH_HALF_WIDTH = 32;
// downward pitch of the camera, in degrees - this is what gives the
// elevated "birds-eye" broadcast-camera look instead of a player-eye view.
const TILT_DEG = 32;
const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);
const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);

export function initCrowd(g) {
  if (g.crowd) return;
  g.crowd = [];
  // the stand wall reaches from the sky band down to just behind the goal,
  // so it needs a denser dot field than the old thin strip did
  for (let i = 0; i < 2600; i++) g.crowd.push([Math.random(), Math.random(), Math.random()]);
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
  const legW = w * 0.24;
  const legH = h * 0.42;
  // legs
  ctx.fillStyle = o.skin || "#c98d5e";
  if (o.kickSwing) {
    // the standing leg is planted; the kicking leg pivots at the hip -
    // wound back through most of the run-up, whipped through at the end
    ctx.fillRect(-w * 0.32, -legH, legW, legH);
    ctx.fillStyle = o.sock || o.shorts || "#111";
    ctx.fillRect(-w * 0.34, -h * 0.2, w * 0.28, h * 0.2);
    const sw = o.kickSwing;
    const ang = sw < 0.75 ? (sw / 0.75) * 0.9 : 0.9 - ((sw - 0.75) / 0.25) * 1.6;
    ctx.save();
    ctx.translate(w * 0.2, -legH);
    ctx.rotate(ang);
    ctx.fillStyle = o.skin || "#c98d5e";
    ctx.fillRect(-legW / 2, 0, legW, legH * 0.82);
    ctx.fillStyle = o.sock || "#111";
    ctx.fillRect(-legW / 2 - w * 0.02, legH * 0.55, legW + w * 0.04, legH * 0.38);
    ctx.restore();
  } else {
    ctx.fillRect(-w * 0.32, -legH, legW, legH);
    ctx.fillRect(w * 0.08, -legH, legW, legH);
    // socks
    ctx.fillStyle = o.sock || o.shorts || "#111";
    ctx.fillRect(-w * 0.34, -h * 0.2, w * 0.28, h * 0.2);
    ctx.fillRect(w * 0.06, -h * 0.2, w * 0.28, h * 0.2);
  }
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
    if (o.gloves) {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(-w * 0.7, -h * 1.14, w * 0.24, h * 0.09);
      ctx.fillRect(w * 0.46, -h * 1.14, w * 0.24, h * 0.09);
    }
  } else if (o.armsWide) {
    ctx.fillRect(-w * 1.0, -h * 0.86, w * 0.55, h * 0.16);
    ctx.fillRect(w * 0.45, -h * 0.86, w * 0.55, h * 0.16);
    if (o.gloves) {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(-w * 1.12, -h * 0.87, w * 0.14, h * 0.18);
      ctx.fillRect(w * 0.98, -h * 0.87, w * 0.14, h * 0.18);
    }
  } else {
    // crossed over chest (wall pose)
    ctx.fillRect(-w * 0.6, -h * 0.8, w * 1.2, h * 0.14);
  }
  // jersey number, once the figure is big enough on screen to carry it -
  // the threshold must admit phone-sized canvases (wall s ≈ 14, kicker
  // s ≈ 23 at 360px wide), where the DPR backing store keeps the 6px
  // minimum font legible
  if (o.number != null && s > 10) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `${Math.max(6, Math.round(h * 0.16))}px 'Press Start 2P', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(o.number), 0, -h * 0.71);
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
  const t = performance.now() / 1000; // ambient animation clock
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
  // goal line - spans the full pitch width so it always meets the
  // touchlines at the corners (a goal-centred span ended visibly short of
  // the corner once far stages brought more of the pitch into frame)
  line(P(-PITCH_HALF_WIDTH, 0, g.D), P(PITCH_HALF_WIDTH, 0, g.D));
  // penalty box
  const bz = g.D - PENALTY_BOX_DEPTH;
  if (bz > 1) {
    line(P(g.gx - 20.15, 0, bz), P(g.gx + 20.15, 0, bz));
    line(P(g.gx - 20.15, 0, bz), P(g.gx - 20.15, 0, g.D));
    line(P(g.gx + 20.15, 0, bz), P(g.gx + 20.15, 0, g.D));
  }
  // penalty arc - the "D" on the edge of the box, the part of the 9.15m
  // circle around the penalty spot that lies outside the box
  if (bz > 1) {
    const spotZ = g.D - 11;
    const aMax = Math.acos(5.5 / 9.15);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = -aMax + (2 * aMax * i) / 24;
      const pt = P(g.gx + Math.sin(a) * 9.15, 0, spotZ - Math.cos(a) * 9.15);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
  const sz = g.D - 5.5;
  line(P(g.gx - 9.16, 0, sz), P(g.gx + 9.16, 0, sz));
  line(P(g.gx - 9.16, 0, sz), P(g.gx - 9.16, 0, g.D));
  line(P(g.gx + 9.16, 0, sz), P(g.gx + 9.16, 0, g.D));

  // worn dirt around the kick spot - dead-ball specialists ruin the turf
  const spot = P(0, 0, 0);
  ctx.save();
  ctx.translate(spot.x, spot.y);
  ctx.scale(1, 0.38);
  const worn = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.15 * spot.s);
  worn.addColorStop(0, "rgba(116,82,45,0.45)");
  worn.addColorStop(0.6, "rgba(116,82,45,0.2)");
  worn.addColorStop(1, "rgba(116,82,45,0)");
  ctx.fillStyle = worn;
  ctx.beginPath();
  ctx.arc(0, 0, 1.15 * spot.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ---- stands + crowd: the audience wall starts right behind the goal,
     not up at the horizon - it covers the far pitch and out-of-bounds area
     from the sky band down to a few metres past the goal line ---- */
  const standTop = g.horizon * 0.28;
  const standBottom = Math.max(g.horizon, P(0, 0, g.D + 6).y);
  const standH = standBottom - standTop;
  const standBg = ctx.createLinearGradient(0, standTop, 0, standBottom);
  standBg.addColorStop(0, "#10173a");
  standBg.addColorStop(1, "#1d2a55");
  ctx.fillStyle = standBg;
  ctx.fillRect(0, standTop, W, standH);
  const celebrating = g.result === "GOAL" && (g.phase === "settle" || g.phase === "result");
  for (const [cx, cy, cc] of g.crowd) {
    const y = standTop + cy * (standH - 4);
    const size = 1.8 + cy * 1.6; // nearer (lower) rows read slightly bigger
    // the crowd sways gently, and bounces harder while celebrating a goal
    const sway = Math.sin(t * (celebrating ? 5.2 : 1.7) + cx * 31 + cy * 17) * (celebrating ? 2.2 : 1.1);
    ctx.fillStyle = cc < 0.15 ? "#facc15" : cc < 0.3 ? "#60a5fa" : cc < 0.42 ? "#f87171" : "#2b3a6b";
    ctx.fillRect(cx * W + sway, y, size, size);
  }
  // tier walkways so the wall reads as stands, not a starfield
  ctx.fillStyle = "rgba(4,8,24,0.5)";
  const tiers = 5;
  for (let i = 1; i < tiers; i++) ctx.fillRect(0, standTop + (standH * i) / tiers, W, 2.5);
  // camera flashes pepper the stands while a goal is being celebrated
  if (celebrating) {
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`;
      const fs = 1.5 + Math.random() * 2.5;
      ctx.fillRect(Math.random() * W, standTop + Math.random() * (standH - 6), fs, fs);
    }
  }
  // advertising boards along the foot of the stands
  const boardH = Math.max(10, Math.min(16, standH * 0.1));
  const boardY = standBottom - boardH;
  const ads = ["FREE KICK LEGEND", "TOP BINS ONLY", "CUP RUN '26", "BEND IT LIKE YOU"];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(boardH * 0.45)}px 'Press Start 2P', monospace`;
  const panelW = W / ads.length;
  for (let i = 0; i < ads.length; i++) {
    ctx.fillStyle = i % 2 ? "#0e1c42" : "#0a1533";
    ctx.fillRect(panelW * i, boardY, panelW, boardH);
    ctx.fillStyle = i % 2 ? "#93c5fd" : "#fbbf24";
    ctx.fillText(ads[i], panelW * i + panelW / 2, boardY + boardH / 2 + 0.5);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, boardY, W, 1);
  // floodlight beams with a little night haze, angled in over the pitch
  for (const fx of [0.08, 0.92]) {
    const bx = W * fx;
    const dir = fx < 0.5 ? 1 : -1;
    const beamBottom = g.horizon + (H - g.horizon) * 0.4;
    const haze = ctx.createLinearGradient(0, 6, 0, beamBottom);
    haze.addColorStop(0, "rgba(255,250,220,0.14)");
    haze.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.moveTo(bx - 12, 6);
    ctx.lineTo(bx + 12, 6);
    ctx.lineTo(bx + dir * W * 0.4, beamBottom);
    ctx.lineTo(bx + dir * W * 0.12, beamBottom);
    ctx.closePath();
    ctx.fill();
  }

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

  // net deformation: the mesh follows the ball as it drives into the net -
  // a gaussian bulge (in x and y) centred on the ball, depth-scaled by how
  // far past the goal line it is, layered on the decaying ripple wobble.
  const ballInNet = scored && g.ball.z > g.D;
  const netDz = (wx, wy) => {
    let dz = ripple * 0.4 * Math.exp(-Math.abs(wx - g.netHitX));
    // the loose mesh breathes with the crosswind, more the higher up it is
    dz += g.windX * 0.09 * (0.3 + 0.7 * (wy / GOAL_H)) * Math.sin(t * 2.1 + wy * 2 + wx * 0.7);
    if (ballInNet) {
      const p = Math.min(1, (g.ball.z - g.D) / (netZ - g.D));
      const fx = Math.exp(-(((wx - g.ball.x) / 1.1) ** 2));
      const fy = Math.exp(-(((wy - g.ball.y) / 1.0) ** 2));
      dz += p * 1.15 * fx * fy;
    }
    return dz;
  };
  const netPath = (points) => {
    ctx.beginPath();
    points.forEach(({ x: wx, y: wy }, i) => {
      const pt = P(wx, wy, netZ + netDz(wx, wy));
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  };

  ctx.strokeStyle = "rgba(240,245,255,0.55)";
  ctx.lineWidth = 1.2;
  // back net grid, sampled so the bulge bends the threads smoothly
  for (let x = -GOAL_HALF; x <= GOAL_HALF + 0.01; x += 0.42) {
    const pts = [];
    for (let y = 0; y <= GOAL_H - 0.1 + 0.001; y += (GOAL_H - 0.1) / 8) pts.push({ x: g.gx + x, y });
    netPath(pts);
  }
  for (let y = 0; y <= GOAL_H - 0.05; y += 0.4) {
    const pts = [];
    for (let x = -GOAL_HALF; x <= GOAL_HALF + 0.001; x += GOAL_HALF / 8) pts.push({ x: g.gx + x, y });
    netPath(pts);
  }
  // side nets
  for (let y = 0.2; y <= GOAL_H; y += 0.55) {
    line(P(g.gx - GOAL_HALF, y, g.D), P(g.gx - GOAL_HALF, Math.max(0, y - 0.35), netZ));
    line(P(g.gx + GOAL_HALF, y, g.D), P(g.gx + GOAL_HALF, Math.max(0, y - 0.35), netZ));
  }
  // depth threads across the side netting give the pocket its 3D read
  for (const side of [-1, 1]) {
    const sx = g.gx + side * GOAL_HALF;
    for (const f of [0.3, 0.6]) {
      const zf = lerp(g.D, netZ, f);
      line(P(sx, GOAL_H * (1 - f * 0.45), zf), P(sx, 0, zf));
    }
  }
  // back-frame stanchions: top corners angle down to the net's ground line,
  // giving the goal its box shape
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = Math.max(1.5, 0.05 * P(0, 0, g.D).s);
  for (const side of [-1, 1]) {
    const sx = g.gx + side * GOAL_HALF;
    line(P(sx, GOAL_H, g.D), P(sx, GOAL_H * 0.5, netZ));
    line(P(sx, GOAL_H * 0.5, netZ), P(sx, 0, netZ));
  }
  line(P(g.gx - GOAL_HALF, 0, netZ), P(g.gx + GOAL_HALF, 0, netZ));

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

  // frame - a dark offset pass under the white gives the posts a hint of
  // roundness/depth instead of reading as flat strokes
  const pw = Math.max(2.5, 0.09 * P(0, 0, g.D).s);
  const pl = P(g.gx - GOAL_HALF, 0, g.D);
  const plt = P(g.gx - GOAL_HALF, GOAL_H, g.D);
  const pr = P(g.gx + GOAL_HALF, 0, g.D);
  const prt = P(g.gx + GOAL_HALF, GOAL_H, g.D);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(71,85,105,0.9)";
  ctx.lineWidth = pw;
  ctx.save();
  ctx.translate(pw * 0.22, pw * 0.22);
  line(pl, plt);
  line(pr, prt);
  line(plt, prt);
  ctx.restore();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = pw;
  line(pl, plt);
  line(pr, prt);
  line(plt, prt);
  // a thin bright core off-centre reads as a specular highlight, turning
  // the flat strokes into round aluminium posts
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = pw * 0.35;
  ctx.save();
  ctx.translate(-pw * 0.18, -pw * 0.18);
  line(pl, plt);
  line(pr, prt);
  line(plt, prt);
  ctx.restore();
  ctx.lineCap = "butt";

  /* ---- ghost marks: where the earlier tries of this stage ended ----
     drawn only while lining up the next try (aim/runup) so they read as
     "walk your aim in" feedback and never distract from a live ball */
  if (["aim1", "aim2", "aim3", "runup"].includes(g.phase) && g.tryMarks?.length) {
    const n = g.tryMarks.length;
    g.tryMarks.forEach((m, i) => {
      const pt = P(m.x, m.y, m.z);
      const r = Math.max(4, 0.14 * pt.s);
      const alpha = 0.85 - (n - 1 - i) * 0.2; // newest brightest
      ctx.strokeStyle = `rgba(251,191,36,${alpha})`;
      ctx.lineWidth = Math.max(1.5, r * 0.35);
      ctx.beginPath();
      ctx.moveTo(pt.x - r, pt.y - r);
      ctx.lineTo(pt.x + r, pt.y + r);
      ctx.moveTo(pt.x + r, pt.y - r);
      ctx.lineTo(pt.x - r, pt.y + r);
      ctx.stroke();
    });
  }

  /* ---- keeper ---- */
  const kp = P(g.kpX, 0, g.D - 0.25);
  const kpFlight = g.phase === "flight" || g.phase === "settle";
  const kpDiving = Math.abs(g.kpAngle) > 0.15;
  drawPlayer(ctx, kp, kp.s, {
    jersey: "#facc15",
    shorts: "#111827",
    sock: "#111827",
    gloves: true,
    number: 1,
    // arms spread wide in a dive, straight up for a standing jump
    armsUp: kpFlight && !kpDiving && g.kpPredY > 1.3,
    armsWide: !kpFlight || kpDiving,
    angle: g.kpAngle,
    lift: g.kpLift,
  });

  /* ---- ball + wall, painter's order by depth ---- */
  const drawWall = () => {
    // gimmick stages field bigger men: the drawn size tracks the same
    // wallScale the collision check uses, so what blocks is what you see
    const scale = g.wallScale || 1;
    for (let i = 0; i < g.wallN; i++) {
      const wx = g.wallX - g.wallHalf + (0.28 + i * 0.56) * scale;
      const wp = P(wx, 0, g.wallZ);
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(wp.x, wp.y, 0.34 * wp.s * scale, 0.1 * wp.s * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPlayer(ctx, wp, wp.s * scale, {
        jersey: i % 2 ? "#b91c1c" : "#991b1b",
        shorts: "#f3f4f6",
        sock: "#b91c1c",
        number: 2 + i,
        // drawPlayer scales lift by its size param; wallJh is in metres,
        // so undo the wall scale to keep the drawn jump = the physics jump
        lift: g.wallJh / scale,
      });
    }
  };

  const drawBall = () => {
    const b = g.ball;
    // trail, tinted by the swerve so a banana reads as one at a glance
    // (amber curling right, cyan curling left, plain white when straight)
    const sw = g.locked?.s ?? 0;
    const tint = sw > 0.15 ? "251,191,36" : sw < -0.15 ? "34,211,238" : "255,255,255";
    for (let i = 0; i < g.trail.length; i++) {
      const tr = g.trail[i];
      const a = i / g.trail.length;
      ctx.fillStyle = `rgba(${tint},${0.05 + a * 0.14})`;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.r * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    // soft contact shadow that fades as the ball climbs
    const sh = P(b.x, 0, b.z);
    const shR = 0.2 * sh.s;
    const shA = Math.max(0.14, 0.38 - b.y * 0.03);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.scale(1, 0.34);
    const shGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, shR);
    shGrad.addColorStop(0, `rgba(0,0,0,${shA})`);
    shGrad.addColorStop(0.7, `rgba(0,0,0,${shA * 0.5})`);
    shGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.arc(0, 0, shR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const bp = P(b.x, b.y, b.z);
    const r = Math.max(2.2, BALL_R * bp.s);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 4) {
      // classic black pentagon panels, rolling with the ball's spin
      ctx.save();
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(20,25,40,0.85)";
      const pent = (px, py, pr, rot) => {
        ctx.beginPath();
        for (let v = 0; v < 5; v++) {
          const va = rot + (v * Math.PI * 2) / 5;
          const vx = px + Math.cos(va) * pr;
          const vy = py + Math.sin(va) * pr;
          if (v === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.fill();
      };
      pent(bp.x, bp.y, r * 0.3, b.spin);
      for (let k = 0; k < 3; k++) {
        const a = b.spin * 0.9 + (k * Math.PI * 2) / 3;
        pent(bp.x + Math.cos(a) * r * 0.82, bp.y + Math.sin(a) * r * 0.82, r * 0.3, a);
      }
      ctx.restore();
      // rim shading keeps it a sphere, not a sticker
      ctx.strokeStyle = "rgba(20,25,40,0.25)";
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, r * 0.94, 0, Math.PI * 2);
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
    number: 10,
    kickSwing: runP,
    angle: runP === 1 ? -0.28 : runP > 0 ? -0.12 : 0,
  });

  // match-night vignette pulls the eye to the pitch centre
  const vig = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.5, Math.max(W, H) * 0.8);
  vig.addColorStop(0, "rgba(2,6,20,0)");
  vig.addColorStop(1, "rgba(2,6,20,0.34)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}
