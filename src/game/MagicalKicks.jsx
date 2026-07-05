import { useRef, useEffect, useState, useCallback } from "react";
import { createGameState, newScenario as physicsNewScenario, step as physicsStep, gaugePos } from "./physics";
import { drawScene, initCrowd, resize as resizeCanvas } from "./render";
import { createAudioController } from "./audio";
import { TOTAL_KICKS } from "./constants";

/* ------------------------------------------------------------------
   FREE KICK LEGEND — a playable HTML prototype of the classic
   "Magical Kicks" three-click free kick mechanic.
   Height → Direction → Swerve, with wind, a jumping wall and a diving keeper.

   This component is the React shell + HUD only: game state lives in
   physics.js, canvas drawing lives in render.js, sound in audio.js.
------------------------------------------------------------------- */

const GAUGE_PHASE = { h: "aim1", d: "aim2", s: "aim3" };
const GAUGES = [
  { key: "h", label: "1 · HEIGHT" },
  { key: "d", label: "2 · DIRECTION" },
  { key: "s", label: "3 · SWERVE" },
];

export default function MagicalKicks() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const G = useRef(null);
  const audioRef = useRef(null);
  const gaugeMarkerRefs = useRef({});
  const gaugeLabelRefs = useRef({});
  if (!audioRef.current) audioRef.current = createAudioController();

  const [hud, setHud] = useState({
    phase: "menu",
    score: 0,
    best: 0,
    kick: 1,
    goals: 0,
    streak: 0,
    distance: null,
    windKmh: 0,
    windDir: 1,
    msg: null,
    muted: false,
  });

  const syncHud = useCallback((patch) => setHud((h) => ({ ...h, ...patch })), []);

  const newScenario = useCallback(
    (g) => {
      syncHud(physicsNewScenario(g));
    },
    [syncHud]
  );

  const startGame = useCallback(() => {
    const g = G.current;
    g.score = 0;
    g.goals = 0;
    g.streak = 0;
    g.kick = 1;
    audioRef.current.sfx("whistle");
    newScenario(g);
    syncHud({ score: 0, goals: 0, streak: 0 });
  }, [newScenario, syncHud]);

  const nextKick = useCallback(() => {
    const g = G.current;
    if (g.kick >= TOTAL_KICKS) {
      g.phase = "gameover";
      g.best = Math.max(g.best || 0, g.score);
      audioRef.current.sfx("whistle");
      syncHud({ phase: "gameover", best: g.best, msg: null });
    } else {
      g.kick += 1;
      newScenario(g);
    }
  }, [newScenario, syncHud]);

  /* --------------------------- interaction ------------------------- */
  const onAction = useCallback(() => {
    const g = G.current;
    if (!g) return;
    audioRef.current.ensureAudio();
    switch (g.phase) {
      case "menu":
        startGame();
        break;
      case "aim1":
        g.locked.h = gaugePos(g, "h");
        g.gaugeT = 0;
        g.phase = "aim2";
        audioRef.current.sfx("lock");
        syncHud({ phase: "aim2" });
        break;
      case "aim2":
        g.locked.d = gaugePos(g, "d") * 2 - 1;
        g.gaugeT = 0;
        g.phase = "aim3";
        audioRef.current.sfx("lock");
        syncHud({ phase: "aim3" });
        break;
      case "aim3":
        g.locked.s = gaugePos(g, "s") * 2 - 1;
        g.phase = "runup";
        g.runT = 0;
        audioRef.current.sfx("lock");
        syncHud({ phase: "flight" });
        break;
      case "result":
        nextKick();
        break;
      case "gameover":
        startGame();
        break;
      default:
        break;
    }
  }, [nextKick, startGame, syncHud]);

  // driven every animation frame (not through React state) so the marker
  // glides smoothly while a gauge is oscillating, without a 60fps re-render
  const updateGaugeDom = useCallback((g) => {
    for (const { key } of GAUGES) {
      const marker = gaugeMarkerRefs.current[key];
      const label = gaugeLabelRefs.current[key];
      if (!marker) continue;
      const active = g.phase === GAUGE_PHASE[key];
      let v = null;
      if (active) v = gaugePos(g, key);
      else if (g.locked[key] != null) v = key === "h" ? g.locked[key] : (g.locked[key] + 1) / 2;
      if (v == null) {
        marker.style.opacity = "0";
      } else {
        marker.style.opacity = "1";
        marker.style.left = `${v * 100}%`;
        marker.style.background = active ? "#fbbf24" : "#60a5fa";
      }
      if (label) label.style.color = active ? "#93c5fd" : "rgba(148,163,184,0.85)";
    }
  }, []);

  /* ------------------------------ loop ----------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!G.current) G.current = createGameState();
    const g = G.current;
    initCrowd(g);
    if (import.meta.env.DEV) window.__game = g;

    let raf = 0;
    let last = performance.now();

    const doResize = () => resizeCanvas(canvas, wrapRef.current, g);
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(wrapRef.current);

    const frame = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const events = physicsStep(g, dt);
      for (const ev of events) {
        if (ev.type === "sfx") audioRef.current.sfx(ev.name);
        else if (ev.type === "hud") syncHud(ev.patch);
      }
      drawScene(ctx, g);
      updateGaugeDom(g);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const key = (e) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        onAction();
      }
    };
    window.addEventListener("keydown", key);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", key);
    };
  }, [onAction, syncHud]);

  /* ------------------------------- ui ------------------------------ */
  // the ball button is the sole trigger for every phase transition; it's
  // only live while there's actually something for onAction to do
  const ballLive = ["menu", "aim1", "aim2", "aim3", "result", "gameover"].includes(hud.phase);

  const toggleMute = (e) => {
    e.stopPropagation();
    const next = !hud.muted;
    audioRef.current.setMuted(next);
    syncHud({ muted: next });
  };

  return (
    <div
      className="min-h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-3 select-none"
      style={{ fontFamily: "'Space Grotesk', ui-sans-serif, system-ui" }}
    >
      <style>{`
        @keyframes popIn { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @media (prefers-reduced-motion: reduce) { .anim { animation: none !important } }
      `}</style>

      <div className="w-full max-w-4xl">
        {/* game canvas */}
        <div
          ref={wrapRef}
          className="relative w-full aspect-[16/10] rounded-xl overflow-hidden ring-1 ring-blue-500/30 shadow-2xl shadow-blue-900/40"
          aria-label="Free kick pitch view"
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {/* the ball button: sole trigger for locking height/direction/swerve
              and for advancing every other phase transition */}
          <button
            onClick={onAction}
            aria-label={
              hud.phase === "aim1"
                ? "Lock height"
                : hud.phase === "aim2"
                ? "Lock direction"
                : hud.phase === "aim3"
                ? "Lock swerve and strike"
                : hud.phase === "result"
                ? "Next kick"
                : hud.phase === "gameover"
                ? "Play again"
                : "Kick off"
            }
            className={`anim absolute z-20 bottom-3 right-3 sm:bottom-4 sm:right-4 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 shadow-lg shadow-blue-900/60 ring-2 ring-white/40 flex items-center justify-center text-3xl sm:text-4xl transition-all duration-200 ${
              ballLive ? "opacity-100 hover:scale-105 active:scale-95" : "opacity-0 pointer-events-none"
            }`}
            style={{ animation: ballLive ? "floaty 2s ease-in-out infinite" : "none" }}
          >
            ⚽
          </button>

          {/* result banner */}
          {hud.msg && hud.phase === "result" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div
                className={`anim px-8 py-3 rounded-2xl border-2 backdrop-blur-sm ${
                  hud.msg.tone === "goal"
                    ? "bg-emerald-500/20 border-emerald-300 text-emerald-200"
                    : "bg-rose-500/15 border-rose-300/70 text-rose-200"
                }`}
                style={{ animation: "popIn .35s ease-out both" }}
              >
                <div
                  className="text-4xl sm:text-6xl text-center"
                  style={{ fontFamily: "'Archivo Black', sans-serif", textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
                >
                  {hud.msg.title}
                </div>
                <div className="text-center text-sm sm:text-base font-semibold mt-1 opacity-90">{hud.msg.sub}</div>
              </div>
              <div className="mt-4 text-slate-200/80 text-xs font-semibold tracking-widest bg-slate-950/60 rounded-full px-4 py-1.5">
                TAP ⚽ FOR NEXT KICK
              </div>
            </div>
          )}

          {/* menu */}
          {hud.phase === "menu" && (
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">A TRIBUTE TO THE CLASSIC</div>
              <h1 className="text-4xl sm:text-6xl text-white leading-none" style={{ fontFamily: "'Archivo Black', sans-serif" }}>
                FREE KICK
                <br />
                <span className="text-blue-400">LEGEND</span>
              </h1>
              <p className="mt-4 max-w-md text-slate-300 text-sm sm:text-base">
                Three taps, one magical kick. Lock the <b className="text-blue-300">height</b>, the{" "}
                <b className="text-blue-300">direction</b>, then the <b className="text-blue-300">swerve</b> — and mind
                the wind, the wall and the keeper.
              </p>
              <div
                className="mt-6 anim bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-blue-500/30"
                style={{ animation: "floaty 2.4s ease-in-out infinite" }}
              >
                TAP ⚽ TO KICK OFF
              </div>
              <div className="mt-3 text-[11px] text-slate-500">Space or Enter works too · {TOTAL_KICKS} free kicks per match</div>
            </div>
          )}

          {/* game over */}
          {hud.phase === "gameover" && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">FULL TIME</div>
              <div className="text-5xl sm:text-6xl text-white" style={{ fontFamily: "'Archivo Black', sans-serif" }}>
                {hud.score}
              </div>
              <div className="text-slate-300 text-sm mt-1 font-semibold">
                {hud.goals}/{TOTAL_KICKS} kicks scored
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Session best: <span className="text-amber-300 font-bold">{hud.best}</span>
              </div>
              <div className="mt-2 text-sm text-blue-200 font-semibold">
                {hud.goals >= 8
                  ? "Divine. The number 10 shirt is yours."
                  : hud.goals >= 5
                  ? "A proper dead-ball specialist."
                  : hud.goals >= 3
                  ? "Keep practising those curlers."
                  : "The wall sends its regards."}
              </div>
              <div className="mt-6 bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-blue-500/30">
                TAP ⚽ TO PLAY AGAIN
              </div>
            </div>
          )}
        </div>

        {/* info + gauge panel - lives below the canvas (always mounted, even
            outside the aim phases, so the layout never shifts) so it never
            covers the kicker or the ball, and keeps stats + gauges in one
            place the player only has to glance at once */}
        <div className="mt-3 bg-slate-900/80 border border-blue-500/30 rounded-xl overflow-hidden text-slate-200">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-b border-blue-500/20">
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] sm:text-[10px] tracking-[0.2em] text-blue-300/80 font-semibold">
                  SCORE
                </span>
                <span
                  className="text-base sm:text-lg font-bold tabular-nums"
                  style={{ fontFamily: "'Archivo Black', sans-serif" }}
                >
                  {hud.score}
                </span>
                {hud.streak > 1 && (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1.5 py-0.5">
                    x{hud.streak}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] sm:text-[10px] tracking-[0.2em] text-blue-300/80 font-semibold">
                  KICK
                </span>
                <span
                  className="text-base sm:text-lg font-bold tabular-nums"
                  style={{ fontFamily: "'Archivo Black', sans-serif" }}
                >
                  {hud.kick}
                  <span className="text-slate-500 text-xs">/{TOTAL_KICKS}</span>
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="text-[10px] tracking-[0.2em] text-blue-300/80 font-semibold">DISTANCE</span>
                <span className="text-base sm:text-lg font-bold tabular-nums">
                  {hud.distance != null ? `${hud.distance}m` : "—"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] sm:text-[10px] tracking-[0.2em] text-blue-300/80 font-semibold">
                  WIND
                </span>
                <span className="text-sm sm:text-base font-bold text-cyan-300">
                  {hud.windDir > 0 ? "→" : "←"}
                </span>
                <span className="text-xs sm:text-sm font-semibold tabular-nums">{hud.windKmh} km/h</span>
              </div>
              <button
                onClick={toggleMute}
                className="text-slate-300 hover:text-white transition-colors text-base"
                aria-label={hud.muted ? "Unmute sound" : "Mute sound"}
              >
                {hud.muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:gap-6 px-4 sm:px-6 py-3">
          {GAUGES.map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center">
              <div
                ref={(el) => (gaugeLabelRefs.current[key] = el)}
                className="text-[10px] sm:text-xs font-bold tracking-wide mb-2 text-slate-400"
              >
                {label}
              </div>
              <div
                className="relative w-full h-3.5 rounded bg-slate-800 border border-slate-500/50"
                style={
                  key === "h"
                    ? { background: "linear-gradient(to right, rgba(34,197,94,.35), rgba(239,68,68,.35))" }
                    : undefined
                }
              >
                {key !== "h" && (
                  <div className="absolute left-1/2 -top-1 -bottom-1 w-[2px] bg-slate-400/60 -translate-x-1/2" />
                )}
                <div
                  ref={(el) => (gaugeMarkerRefs.current[key] = el)}
                  className="absolute -top-1.5 -bottom-1.5 w-[5px] rounded -translate-x-1/2"
                  style={{ left: "0%", opacity: 0 }}
                />
              </div>
              <div className="w-full flex justify-between mt-1 text-[9px] sm:text-[10px] font-semibold text-slate-500">
                <span>{key === "h" ? "LOW" : "◀"}</span>
                <span>{key === "h" ? "HIGH" : "▶"}</span>
              </div>
            </div>
          ))}
          </div>
        </div>

        <div className="mt-2 text-center text-[11px] text-slate-500">
          Prototype of the three-click free kick mechanic · React + Canvas · tuned for touch and mouse
        </div>
      </div>
    </div>
  );
}
