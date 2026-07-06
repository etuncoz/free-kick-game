import { useRef, useEffect, useState, useCallback } from "react";
import {
  advanceOutcome,
  createGameState,
  newScenario as physicsNewScenario,
  step as physicsStep,
  gaugePos,
} from "./physics";
import { drawScene, initCrowd, resize as resizeCanvas } from "./render";
import { createAudioController } from "./audio";
import { loadBests, saveRunEnd } from "./storage";
import { CUP_EVERY, DIR_GOAL_WINDOW, LAPS, TOTAL_STAGES, TRIES_PER_STAGE, stageSpec } from "./constants";

/* ------------------------------------------------------------------
   FREE KICK LEGEND — a playable HTML prototype of the classic
   "Magical Kicks" three-click free kick mechanic.
   Height → Direction → Swerve, with wind, a jumping wall and a diving keeper.

   This component is the React shell + HUD only: game state lives in
   physics.js, canvas drawing lives in render.js, sound in audio.js.
------------------------------------------------------------------- */

const ARCHIVO = { fontFamily: "'Archivo Black', sans-serif" };
const STAT_LABEL_CLS = "text-[9px] sm:text-[10px] tracking-[0.2em] text-blue-300/80 font-semibold";
const STAT_VALUE_CLS = "text-base sm:text-lg font-bold tabular-nums";

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
    bestStage: 0,
    cups: 0, // claimed this run
    bestCups: 0, // most cups ever claimed in one run
    stage: 1,
    stageName: stageSpec(1).name,
    triesLeft: TRIES_PER_STAGE,
    goals: 0,
    streak: 0,
    distance: null,
    windKmh: 0,
    windDeg: 0,
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
    g.cups = 0;
    g.stage = 1;
    g.triesLeft = TRIES_PER_STAGE;
    audioRef.current.sfx("whistle");
    newScenario(g);
    syncHud({ score: 0, goals: 0, streak: 0, cups: 0 });
  }, [newScenario, syncHud]);

  const endRun = useCallback(
    (phase) => {
      const g = G.current;
      g.phase = phase;
      const bests = saveRunEnd({ stage: g.stage, score: g.score, cups: g.cups });
      g.best = bests.bestScore;
      audioRef.current.sfx("whistle");
      syncHud({
        phase,
        best: bests.bestScore,
        bestStage: bests.bestStage,
        bestCups: bests.cups,
        cups: g.cups,
        msg: null,
      });
    },
    [syncHud]
  );

  // moves to the next stage, resetting the try budget
  const nextStage = useCallback(() => {
    const g = G.current;
    g.stage += 1;
    g.triesLeft = TRIES_PER_STAGE;
    newScenario(g);
  }, [newScenario]);

  // advances past a result: a goal moves on (via the cup ceremony on every
  // CUP_EVERY-th stage, or the win screen after the last one); a miss
  // retries the same spot until the tries run out. triesLeft itself is
  // decremented by physics.js's finishKick, not here.
  const advance = useCallback(() => {
    const g = G.current;
    switch (advanceOutcome(g)) {
      case "won":
        g.cups += 1; // the stage-50 cup is presented on the win screen
        endRun("won");
        break;
      case "cup":
        g.cups += 1;
        g.phase = "cup";
        audioRef.current.sfx("whistle");
        syncHud({ phase: "cup", cups: g.cups, msg: null });
        break;
      case "next":
        nextStage();
        break;
      case "gameover":
        endRun("gameover");
        break;
      default:
        newScenario(g); // retry
    }
  }, [endRun, newScenario, nextStage, syncHud]);

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
        advance();
        break;
      case "cup":
        nextStage();
        break;
      case "gameover":
      case "won":
        startGame();
        break;
      default:
        break;
    }
  }, [advance, nextStage, startGame, syncHud]);

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

  // persisted run records (best stage/score, cup won) load once on mount;
  // declared after the loop effect so G.current exists by the time it runs
  useEffect(() => {
    const bests = loadBests();
    G.current.best = bests.bestScore;
    syncHud({ best: bests.bestScore, bestStage: bests.bestStage, bestCups: bests.cups });
  }, [syncHud]);

  /* ------------------------------- ui ------------------------------ */
  // the ball button is the sole trigger for every phase transition; it's
  // only live while there's actually something for onAction to do
  const ballLive = ["menu", "aim1", "aim2", "aim3", "result", "cup", "gameover", "won"].includes(hud.phase);

  // persisted-record line shared by the menu / game-over / win overlays
  const bestLine =
    hud.bestStage > 0 ? (
      <div className="mt-3 text-xs text-slate-300 bg-slate-900/70 border border-slate-600/50 rounded-full px-4 py-1.5 font-semibold">
        {hud.bestCups > 0 && (
          <span role="img" aria-label={`${hud.bestCups} cups won`} className="mr-1.5">
            🏆{hud.bestCups > 1 ? `x${hud.bestCups}` : ""}
          </span>
        )}
        Best run: stage <span className="text-amber-300 font-bold">{hud.bestStage}/{TOTAL_STAGES}</span> ·{" "}
        <span className="text-amber-300 font-bold">{hud.best}</span> pts
      </div>
    ) : null;

  // what tapping ⚽ on the result banner will do next; a cleared stage
  // telegraphs the next stage's name so gimmicks announce themselves. Every
  // CUP_EVERY-th stage hands over to the cup ceremony instead.
  const clearedFinalStage = hud.msg?.tone === "goal" && hud.stage >= TOTAL_STAGES;
  const clearedCupStage = hud.msg?.tone === "goal" && hud.stage % CUP_EVERY === 0;
  const nextStageName = hud.stage < TOTAL_STAGES ? stageSpec(hud.stage + 1).name : "";
  const resultPrompt =
    hud.msg?.tone === "goal"
      ? clearedFinalStage
        ? "TAP ⚽ TO CLAIM THE FINAL CUP"
        : clearedCupStage
        ? "TAP ⚽ TO CLAIM THE CUP"
        : `TAP ⚽ FOR STAGE ${hud.stage + 1} · ${nextStageName}`
      : hud.triesLeft > 0
      ? "TAP ⚽ TO RETRY"
      : "TAP ⚽ · FULL TIME";

  const toggleMute = (e) => {
    e.stopPropagation();
    const next = !hud.muted;
    audioRef.current.setMuted(next);
    syncHud({ muted: next });
  };

  return (
    <div
      className="min-h-dvh w-full bg-slate-950 flex flex-col items-center justify-center p-1.5 sm:p-3 select-none"
      style={{
        fontFamily: "'Space Grotesk', ui-sans-serif, system-ui",
        // one tap = one action, never a double-tap zoom, on the rapid
        // HEIGHT/DIRECTION/SWERVE triple tap
        touchAction: "manipulation",
        paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))",
      }}
    >
      <style>{`
        @keyframes popIn { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @media (prefers-reduced-motion: reduce) { .anim { animation: none !important } }
      `}</style>

      <div className="w-full max-w-4xl">
        {/* game canvas */}
        {/* the whole pitch view is a tap target (essential on touch, where
            hitting the small ⚽ three times in rhythm is fiddly); the button
            below stops pointer propagation so its own taps fire exactly once */}
        <div
          ref={wrapRef}
          onPointerDown={onAction}
          role="button"
          className="relative w-full aspect-[16/10] rounded-xl overflow-hidden ring-1 ring-blue-500/30 shadow-2xl shadow-blue-900/40 cursor-pointer"
          aria-label="Free kick pitch view - tap to lock gauges and kick"
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {/* the ball button: sole trigger for locking height/direction/swerve
              and for advancing every other phase transition */}
          <button
            onClick={onAction}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={
              hud.phase === "aim1"
                ? "Lock height"
                : hud.phase === "aim2"
                ? "Lock direction"
                : hud.phase === "aim3"
                ? "Lock swerve and strike"
                : hud.phase === "result"
                ? hud.msg?.tone === "goal"
                  ? clearedCupStage
                    ? "Claim the cup"
                    : "Start next stage"
                  : hud.triesLeft > 0
                  ? "Retry this stage"
                  : "See final result"
                : hud.phase === "cup"
                ? "Continue the run"
                : hud.phase === "gameover" || hud.phase === "won"
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
                {hud.msg.tone === "goal" && (
                  <div className="text-center text-[10px] tracking-[0.4em] font-bold opacity-90 mb-1">
                    STAGE {hud.stage} · {hud.stageName} · CLEAR
                  </div>
                )}
                <div
                  className="text-4xl sm:text-6xl text-center"
                  style={{ fontFamily: "'Archivo Black', sans-serif", textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
                >
                  {hud.msg.title}
                </div>
                <div className="text-center text-sm sm:text-base font-semibold mt-1 opacity-90">{hud.msg.sub}</div>
                {hud.msg.tone === "miss" && hud.triesLeft > 0 && (
                  <div className="text-center text-[10px] tracking-[0.4em] font-bold opacity-90 mt-1.5">
                    {hud.triesLeft} {hud.triesLeft === 1 ? "TRY" : "TRIES"} LEFT
                  </div>
                )}
              </div>
              <div className="mt-4 text-slate-200/80 text-xs font-semibold tracking-widest bg-slate-950/60 rounded-full px-4 py-1.5">
                {resultPrompt}
              </div>
            </div>
          )}

          {/* menu - full-screen on phones (the short 16/10 canvas would clip
              it), confined to the pitch view from `sm` up. Still inside the
              wrapper, so tapping anywhere starts the game. */}
          {hud.phase === "menu" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/85 sm:bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">A TRIBUTE TO THE CLASSIC</div>
              <h1 className="text-4xl sm:text-6xl text-white leading-none" style={{ fontFamily: "'Archivo Black', sans-serif" }}>
                FREE KICK
                <br />
                <span className="text-blue-400">LEGEND</span>
              </h1>
              <p className="mt-4 max-w-md text-slate-300 text-sm sm:text-base">
                A cup marathon of <b className="text-amber-300">{TOTAL_STAGES} stages</b>, {TRIES_PER_STAGE} tries
                each: score to advance, miss them all and the run is over. Every{" "}
                <b className="text-amber-300">{CUP_EVERY}th stage</b> crowns a cup - claim all {LAPS} to become a
                legend. Lock the <b className="text-blue-300">height</b>, the{" "}
                <b className="text-blue-300">direction</b>, then the <b className="text-blue-300">swerve</b> - and mind
                the wind, the wall and the keeper.
              </p>
              {bestLine}
              <div
                className="mt-6 anim bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-blue-500/30"
                style={{ animation: "floaty 2.4s ease-in-out infinite" }}
              >
                TAP ⚽ TO KICK OFF
              </div>
              <div className="mt-3 text-[11px] text-slate-500">
                Space or Enter works too · a cup every {CUP_EVERY} stages, {LAPS} cups to win it all
              </div>
            </div>
          )}

          {/* game over - same full-screen-on-phones treatment as the menu */}
          {hud.phase === "gameover" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">CUP RUN OVER</div>
              <div className="text-5xl sm:text-6xl text-white" style={{ fontFamily: "'Archivo Black', sans-serif" }}>
                {hud.score}
              </div>
              <div className="text-slate-300 text-sm mt-1 font-semibold">
                Knocked out on stage {hud.stage}/{TOTAL_STAGES}
                {hud.cups > 0 && (
                  <span className="ml-2 text-amber-300">
                    🏆{hud.cups > 1 ? `x${hud.cups}` : ""} claimed
                  </span>
                )}
              </div>
              {bestLine}
              <div className="mt-2 text-sm text-blue-200 font-semibold">
                {hud.stage > 40
                  ? "One cup from immortality."
                  : hud.stage > 20
                  ? "A proper dead-ball specialist."
                  : hud.stage > 10
                  ? "Keep practising those curlers."
                  : hud.stage >= 6
                  ? "A solid first lap."
                  : "The wall sends its regards."}
              </div>
              <div className="mt-6 bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-blue-500/30">
                TAP ⚽ TO PLAY AGAIN
              </div>
            </div>
          )}

          {/* cup ceremony - every CUP_EVERY-th stage cleared mid-run; the
              run continues, so this hands over to the next stage */}
          {hud.phase === "cup" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">
                STAGE {hud.stage} · {hud.stageName} · CLEARED
              </div>
              <div
                className="text-7xl sm:text-8xl anim"
                style={{
                  animation: "floaty 2.4s ease-in-out infinite",
                  filter: "drop-shadow(0 0 24px rgba(251,191,36,.55))",
                }}
              >
                🏆
              </div>
              <h2
                className="mt-3 text-4xl sm:text-5xl text-amber-300 leading-none"
                style={{ fontFamily: "'Archivo Black', sans-serif", textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
              >
                CUP SECURED
              </h2>
              <div className="mt-3 text-slate-300 text-sm font-semibold">
                Cup <span className="text-amber-300 font-bold">{hud.cups}</span> of {LAPS} · score{" "}
                <span className="text-white text-lg font-bold align-middle" style={ARCHIVO}>
                  {hud.score}
                </span>
              </div>
              <div className="mt-6 anim bg-amber-500 hover:bg-amber-400 transition-colors text-slate-950 font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-amber-500/40">
                TAP ⚽ FOR STAGE {hud.stage + 1} · {nextStageName}
              </div>
            </div>
          )}

          {/* all cups won - same full-screen-on-phones treatment as the menu */}
          {hud.phase === "won" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[10px] tracking-[0.5em] text-amber-400 mb-2">ALL {TOTAL_STAGES} STAGES CLEARED</div>
              <div
                className="text-5xl sm:text-6xl anim tracking-tight"
                style={{
                  animation: "floaty 2.4s ease-in-out infinite",
                  filter: "drop-shadow(0 0 24px rgba(251,191,36,.55))",
                }}
                role="img"
                aria-label={`${LAPS} cups won`}
              >
                {"🏆".repeat(LAPS)}
              </div>
              <h2
                className="mt-3 text-4xl sm:text-6xl text-amber-300 leading-none"
                style={{ fontFamily: "'Archivo Black', sans-serif", textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
              >
                FREE KICK LEGEND
              </h2>
              <div className="mt-3 text-slate-300 text-sm font-semibold">
                All {LAPS} cups claimed · final score{" "}
                <span className="text-white text-2xl font-bold align-middle ml-1" style={ARCHIVO}>
                  {hud.score}
                </span>
              </div>
              {bestLine}
              <div className="mt-6 anim bg-amber-500 hover:bg-amber-400 transition-colors text-slate-950 font-bold rounded-full px-8 py-3 text-lg shadow-lg shadow-amber-500/40">
                TAP ⚽ TO PLAY AGAIN
              </div>
            </div>
          )}
        </div>

        {/* info + gauge panel - lives below the canvas (always mounted, even
            outside the aim phases, so the layout never shifts) so it never
            covers the kicker or the ball, and keeps stats + gauges in one
            place the player only has to glance at once */}
        <div className="mt-1.5 sm:mt-3 bg-slate-900/80 border border-blue-500/30 rounded-xl overflow-hidden text-slate-200">
          {/* below `sm` this wraps into two full-width rows (scores, then
              pitch conditions), each spreading its three stats edge to edge
              instead of crowding six stats onto one 360px line */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 sm:px-6 py-2 sm:py-2.5 border-b border-blue-500/20">
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 sm:gap-6">
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>SCORE</span>
                <span className={STAT_VALUE_CLS} style={ARCHIVO}>
                  {hud.score}
                </span>
                {hud.streak > 1 && (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1.5 py-0.5">
                    x{hud.streak}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>STAGE</span>
                <span className={STAT_VALUE_CLS} style={ARCHIVO}>
                  {hud.stage}
                  <span className="text-slate-500 text-xs">/{TOTAL_STAGES}</span>
                </span>
                {hud.cups > 0 && (
                  <span
                    className="text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1.5 py-0.5"
                    role="img"
                    aria-label={`${hud.cups} cups claimed this run`}
                  >
                    🏆{hud.cups}
                  </span>
                )}
                <span className="hidden md:inline text-[9px] font-bold tracking-[0.15em] text-amber-300/90">
                  {hud.stageName}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>TRIES</span>
                <span
                  className="flex items-center gap-1"
                  role="img"
                  aria-label={`${hud.triesLeft} of ${TRIES_PER_STAGE} tries left`}
                >
                  {Array.from({ length: TRIES_PER_STAGE }, (_, i) => (
                    <span
                      key={i}
                      className={`w-2 h-2 rounded-full ${i < hud.triesLeft ? "bg-amber-400" : "bg-slate-700"}`}
                    />
                  ))}
                </span>
              </div>
            </div>
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 sm:gap-6">
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>DISTANCE</span>
                <span className={STAT_VALUE_CLS} style={ARCHIVO}>
                  {hud.distance != null ? hud.distance : "—"}
                  {hud.distance != null && <span className="text-slate-500 text-xs">m</span>}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>WIND</span>
                <span className={STAT_VALUE_CLS} style={ARCHIVO}>
                  {/* compass arrow: up = blowing toward the goal, right =
                      blowing right across the pitch, down = into your face */}
                  <span
                    className="inline-block text-cyan-300"
                    style={{ transform: `rotate(${hud.windDeg}deg)` }}
                    role="img"
                    aria-label={`Wind bearing ${hud.windDeg} degrees`}
                  >
                    ↑
                  </span>{" "}
                  {hud.windKmh}
                  <span className="text-slate-500 text-xs">km/h</span>
                </span>
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
          <div className="grid grid-cols-3 gap-2.5 sm:gap-6 px-3 sm:px-6 py-2 sm:py-3">
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
                {/* the direction gauge sweeps far wider than the goal; this
                    goal-mouth window is the part of the sweep that actually
                    hits the frame. It is the same fixed, centred window on
                    every stage (the physics scales the cone instead). */}
                {key === "d" && (
                  <div
                    className="absolute -top-[5px] bottom-[2px] border-l-2 border-r-2 border-t-2 border-white/90 rounded-t-[3px] bg-emerald-300/25"
                    style={{
                      left: `${(0.5 - DIR_GOAL_WINDOW / 2) * 100}%`,
                      width: `${DIR_GOAL_WINDOW * 100}%`,
                    }}
                    aria-hidden="true"
                  />
                )}
                {key === "s" && (
                  <div className="absolute left-1/2 -top-1 -bottom-1 w-[2px] bg-slate-400/60 -translate-x-1/2" />
                )}
                <div
                  ref={(el) => (gaugeMarkerRefs.current[key] = el)}
                  className="absolute -top-1.5 -bottom-1.5 w-[5px] rounded -translate-x-1/2"
                  style={{ left: "0%", opacity: 0 }}
                />
              </div>
              <div className="w-full flex justify-between mt-1 text-[9px] sm:text-[10px] font-semibold text-slate-500">
                <span>{key === "h" ? "LOW" : key === "s" ? "↷ LEFT" : "LEFT"}</span>
                <span>{key === "h" ? "HIGH" : key === "s" ? "RIGHT ↶" : "RIGHT"}</span>
              </div>
            </div>
          ))}
          </div>
        </div>

        <div className="mt-2 hidden sm:block text-center text-[11px] text-slate-500">
          Prototype of the three-click free kick mechanic · React + Canvas · tuned for touch and mouse
        </div>
      </div>
    </div>
  );
}
