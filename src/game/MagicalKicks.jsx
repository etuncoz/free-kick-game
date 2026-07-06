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

// Press Start 2P ships a single weight; font-synthesis is disabled globally
// (index.css) so bold utilities never smear the pixel glyphs
const DISPLAY_FONT = { fontFamily: "'Press Start 2P', monospace" };
const STAT_LABEL_CLS = "text-[7px] sm:text-[8px] tracking-[0.15em] text-blue-300/80 font-semibold";
const STAT_VALUE_CLS = "text-xs sm:text-sm font-bold tabular-nums";

const GAUGE_PHASE = { h: "aim1", d: "aim2", s: "aim3" };
const GAUGES = [
  { key: "h", num: "1", label: "HEIGHT" },
  { key: "d", num: "2", label: "DIRECTION" },
  { key: "s", num: "3", label: "SWERVE" },
];
// segmented retro tracks: each gauge is a row of discrete cells; the marker
// itself still glides continuously so precision reading is unchanged
const TRACK_CELLS = 20;

export default function MagicalKicks() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const G = useRef(null);
  const audioRef = useRef(null);
  const gaugeMarkerRefs = useRef({});
  const gaugeLabelRefs = useRef({});
  const gaugeBadgeRefs = useRef({});
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
    g.testRun = false; // a fresh run from the menu counts for records again
    audioRef.current.sfx("whistle");
    newScenario(g);
    syncHud({ score: 0, goals: 0, streak: 0, cups: 0 });
  }, [newScenario, syncHud]);

  const endRun = useCallback(
    (phase) => {
      const g = G.current;
      g.phase = phase;
      // a test run (dev-panel stage jump) never touches the persisted records
      const bests = g.testRun
        ? loadBests()
        : saveRunEnd({ stage: g.stage, score: g.score, cups: g.cups });
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

  // dev-only (admin panel): restart the run at a chosen stage for testing -
  // fresh try budget, zeroed score, and the run is marked as a test run so
  // it never writes records. The full try budget makes newScenario re-roll
  // the wall and clear the ghost try marks, exactly like a fresh stage.
  const jumpToStage = useCallback(
    (stage) => {
      const g = G.current;
      g.testRun = true;
      g.score = 0;
      g.goals = 0;
      g.streak = 0;
      g.cups = 0;
      g.stage = stage;
      g.triesLeft = TRIES_PER_STAGE;
      newScenario(g);
      syncHud({ score: 0, goals: 0, streak: 0, cups: 0 });
    },
    [newScenario, syncHud]
  );

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
      const badge = gaugeBadgeRefs.current[key];
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
        marker.style.background = active ? "#fbbf24" : "#e2e8f0";
        marker.style.boxShadow = active ? "0 0 8px rgba(251,191,36,0.9)" : "0 0 4px rgba(226,232,240,0.6)";
      }
      if (label) label.style.color = active ? "#93c5fd" : "rgba(148,163,184,0.85)";
      if (badge) {
        badge.style.background = active ? "#fbbf24" : "#1e293b";
        badge.style.color = active ? "#0f172a" : "#94a3b8";
        badge.style.borderColor = active ? "#fbbf24" : "rgba(100,116,139,0.6)";
      }
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
      // the dev-only stage select is keyboard-operable with Space/Enter -
      // those presses must not also fire a game action
      if (e.target && e.target.tagName === "SELECT") return;
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
      <div className="mt-3 text-[8px] sm:text-[9px] leading-relaxed text-slate-300 bg-slate-900/70 border border-slate-600/50 rounded-full px-4 py-1.5 font-semibold">
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
        fontFamily: "'Press Start 2P', ui-monospace, monospace",
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
            className={`anim absolute z-20 bottom-3 right-3 sm:bottom-4 sm:right-4 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-blue-500 shadow-lg shadow-blue-900/60 ring-2 ring-white/50 flex items-center justify-center text-3xl sm:text-4xl transition-all duration-200 ${
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
                className={`anim px-8 py-3 rounded-xl border-2 bg-slate-950/90 ${
                  hud.msg.tone === "goal"
                    ? "border-emerald-300 text-emerald-200"
                    : "border-rose-300/80 text-rose-200"
                }`}
                style={{ animation: "popIn .35s ease-out both" }}
              >
                {hud.msg.tone === "goal" && (
                  <div className="text-center text-[8px] tracking-[0.25em] font-bold opacity-90 mb-1.5">
                    STAGE {hud.stage} · {hud.stageName} · CLEAR
                  </div>
                )}
                <div
                  className="text-2xl sm:text-4xl text-center"
                  style={{ ...DISPLAY_FONT, textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
                >
                  {hud.msg.title}
                </div>
                <div className="text-center text-[10px] sm:text-xs leading-relaxed font-semibold mt-2 opacity-90">{hud.msg.sub}</div>
                {hud.msg.tone === "miss" && hud.triesLeft > 0 && (
                  <div className="text-center text-[8px] tracking-[0.25em] font-bold opacity-90 mt-2">
                    {hud.triesLeft} {hud.triesLeft === 1 ? "TRY" : "TRIES"} LEFT
                  </div>
                )}
              </div>
              <div className="mt-4 text-slate-200/80 text-[8px] sm:text-[9px] font-semibold tracking-widest bg-slate-950/60 rounded-full px-4 py-1.5">
                {resultPrompt}
              </div>
            </div>
          )}

          {/* menu - full-screen on phones (the short 16/10 canvas would clip
              it), confined to the pitch view from `sm` up. Still inside the
              wrapper, so tapping anywhere starts the game. */}
          {hud.phase === "menu" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/85 sm:bg-slate-950/70 flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[8px] tracking-[0.3em] text-amber-400 mb-2">A TRIBUTE TO THE CLASSIC</div>
              <h1 className="text-2xl sm:text-4xl text-white leading-snug" style={DISPLAY_FONT}>
                FREE KICK
                <br />
                <span className="text-blue-400">LEGEND</span>
              </h1>
              <p className="mt-4 max-w-md text-slate-300 text-[9px] sm:text-[11px] leading-relaxed">
                A cup marathon of <b className="text-amber-300">{TOTAL_STAGES} stages</b>, {TRIES_PER_STAGE} tries
                each: score to advance, miss them all and the run is over. Every{" "}
                <b className="text-amber-300">{CUP_EVERY}th stage</b> crowns a cup - claim all {LAPS} to become a
                legend. Lock the <b className="text-blue-300">height</b>, the{" "}
                <b className="text-blue-300">direction</b>, then the <b className="text-blue-300">swerve</b> - and mind
                the wind, the wall and the keeper.
              </p>
              {bestLine}
              <div
                className="mt-6 anim bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-xs sm:text-sm shadow-lg shadow-blue-500/30"
                style={{ animation: "floaty 2.4s ease-in-out infinite" }}
              >
                TAP ⚽ TO KICK OFF
              </div>
              <div className="mt-3 text-[8px] leading-relaxed text-slate-500">
                Space or Enter works too · a cup every {CUP_EVERY} stages, {LAPS} cups to win it all
              </div>
            </div>
          )}

          {/* game over - same full-screen-on-phones treatment as the menu */}
          {hud.phase === "gameover" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/80 flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[8px] tracking-[0.3em] text-amber-400 mb-2">CUP RUN OVER</div>
              <div className="text-3xl sm:text-4xl text-white" style={DISPLAY_FONT}>
                {hud.score}
              </div>
              <div className="text-slate-300 text-[9px] sm:text-[10px] leading-relaxed mt-2 font-semibold">
                Knocked out on stage {hud.stage}/{TOTAL_STAGES}
                {hud.cups > 0 && (
                  <span className="ml-2 text-amber-300">
                    🏆{hud.cups > 1 ? `x${hud.cups}` : ""} claimed
                  </span>
                )}
              </div>
              {bestLine}
              <div className="mt-2 text-[9px] sm:text-[10px] leading-relaxed text-blue-200 font-semibold">
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
              <div className="mt-6 bg-blue-500 hover:bg-blue-400 transition-colors text-white font-bold rounded-full px-8 py-3 text-xs sm:text-sm shadow-lg shadow-blue-500/30">
                TAP ⚽ TO PLAY AGAIN
              </div>
            </div>
          )}

          {/* cup ceremony - every CUP_EVERY-th stage cleared mid-run; the
              run continues, so this hands over to the next stage */}
          {hud.phase === "cup" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/85 flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[8px] tracking-[0.3em] text-amber-400 mb-2">
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
                className="mt-3 text-2xl sm:text-3xl text-amber-300 leading-snug"
                style={{ ...DISPLAY_FONT, textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
              >
                CUP SECURED
              </h2>
              <div className="mt-3 text-slate-300 text-[9px] sm:text-[10px] leading-relaxed font-semibold">
                Cup <span className="text-amber-300 font-bold">{hud.cups}</span> of {LAPS} · score{" "}
                <span className="text-white text-sm font-bold align-middle" style={DISPLAY_FONT}>
                  {hud.score}
                </span>
              </div>
              <div className="mt-6 anim bg-amber-500 hover:bg-amber-400 transition-colors text-slate-950 font-bold rounded-full px-8 py-3 text-[10px] sm:text-xs shadow-lg shadow-amber-500/40">
                TAP ⚽ FOR STAGE {hud.stage + 1} · {nextStageName}
              </div>
            </div>
          )}

          {/* all cups won - same full-screen-on-phones treatment as the menu */}
          {hud.phase === "won" && (
            <div className="fixed sm:absolute inset-0 z-30 sm:z-auto overflow-y-auto bg-slate-950/90 sm:bg-slate-950/85 flex flex-col items-center justify-center text-center px-6 py-8">
              <div className="text-[8px] tracking-[0.3em] text-amber-400 mb-2">ALL {TOTAL_STAGES} STAGES CLEARED</div>
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
                className="mt-3 text-lg sm:text-3xl text-amber-300 leading-snug"
                style={{ ...DISPLAY_FONT, textShadow: "0 4px 24px rgba(0,0,0,.6)" }}
              >
                FREE KICK LEGEND
              </h2>
              <div className="mt-3 text-slate-300 text-[9px] sm:text-[10px] leading-relaxed font-semibold">
                All {LAPS} cups claimed · final score{" "}
                <span className="text-white text-lg font-bold align-middle ml-1" style={DISPLAY_FONT}>
                  {hud.score}
                </span>
              </div>
              {bestLine}
              <div className="mt-6 anim bg-amber-500 hover:bg-amber-400 transition-colors text-slate-950 font-bold rounded-full px-8 py-3 text-xs sm:text-sm shadow-lg shadow-amber-500/40">
                TAP ⚽ TO PLAY AGAIN
              </div>
            </div>
          )}

          {/* dev-only admin panel: jump the run to any stage for testing.
              Gated on import.meta.env.DEV so it is dead-code-eliminated from
              production builds (same pattern as window.__game). Rendered
              last at z-40 so it stays clickable above every overlay, and it
              swallows pointerdown so opening it never fires a game action.
              Below `sm` it pins to the viewport corner (like the phone
              overlays do) so it never covers the overlay titles or the
              stadium - the wrapper corner is mid-screen on a phone. */}
          {import.meta.env.DEV && (
            <div
              className="fixed sm:absolute top-2 right-2 z-40 flex items-center gap-1.5 bg-slate-950/80 border border-amber-400/40 rounded-lg px-2 py-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="text-[9px] tracking-[0.2em] text-amber-400 font-bold">ADMIN · STAGE</span>
              <select
                value={hud.stage}
                onChange={(e) => {
                  jumpToStage(Number(e.target.value));
                  e.target.blur();
                }}
                className="bg-slate-900 text-slate-200 text-xs font-semibold border border-slate-600/60 rounded px-1 py-0.5 cursor-pointer"
                aria-label="Admin: jump to a stage (test run, records are not saved)"
              >
                {Array.from({ length: TOTAL_STAGES }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} · {stageSpec(n).name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* info panel - lives below the canvas (always mounted, even outside
            the aim phases, so the layout never shifts) so it never covers the
            kicker or the ball */}
        <div className="mt-1.5 sm:mt-3 bg-slate-900/80 border border-blue-500/30 rounded-xl text-slate-200">
          {/* below `sm` this wraps into two full-width rows (scores, then
              pitch conditions), each spreading its three stats edge to edge
              instead of crowding six stats onto one 360px line */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 sm:px-6 py-2 sm:py-2.5">
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 sm:gap-6">
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>SCORE</span>
                <span className={`${STAT_VALUE_CLS} text-amber-300`} style={DISPLAY_FONT}>
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
                <span className={STAT_VALUE_CLS} style={DISPLAY_FONT}>
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
                      className={`w-2 h-2 rounded-full ${
                        i < hud.triesLeft
                          ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.85)]"
                          : "bg-slate-700"
                      }`}
                    />
                  ))}
                </span>
              </div>
            </div>
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 sm:gap-6">
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>DIST</span>
                <span className={STAT_VALUE_CLS} style={DISPLAY_FONT}>
                  {hud.distance != null ? hud.distance : "—"}
                  {hud.distance != null && <span className="text-slate-500 text-xs">m</span>}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={STAT_LABEL_CLS}>WIND</span>
                <span className={STAT_VALUE_CLS} style={DISPLAY_FONT}>
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
                className={`transition-colors text-sm ${
                  hud.muted ? "text-slate-600 line-through" : "text-slate-300 hover:text-white"
                }`}
                aria-label={hud.muted ? "Unmute sound" : "Mute sound"}
              >
                ♪
              </button>
            </div>
          </div>
        </div>

        {/* gauge cards - one per click of the three-click mechanic, each
            with a numbered badge that lights gold while its gauge runs */}
        <div className="mt-1.5 sm:mt-2 grid grid-cols-3 gap-1.5 sm:gap-3 text-slate-200">
          {GAUGES.map(({ key, num, label }) => (
            <div
              key={key}
              className="bg-slate-900/80 border border-blue-500/30 rounded-xl px-2 sm:px-4 py-2 sm:py-3 flex flex-col items-center"
            >
              <div className="flex items-center gap-1.5 sm:gap-2 mb-2">
                <span
                  ref={(el) => (gaugeBadgeRefs.current[key] = el)}
                  className="w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center text-[7px] sm:text-[8px] border rounded-[3px] bg-slate-800 text-slate-400 border-slate-600/60"
                  aria-hidden="true"
                >
                  {num}
                </span>
                <span
                  ref={(el) => (gaugeLabelRefs.current[key] = el)}
                  className="text-[8px] sm:text-[9px] font-bold tracking-wide text-slate-400"
                >
                  {label}
                </span>
              </div>
              <div className="relative w-full h-3.5">
                {/* segmented cells. HEIGHT is a fixed green-to-red ramp; the
                    DIRECTION gold cells are the goal-mouth window - the part
                    of the (far wider) sweep that actually hits the frame,
                    the same fixed centred span on every stage (the physics
                    scales the cone instead). */}
                <div className="absolute inset-0 flex gap-[2px]" aria-hidden="true">
                  {Array.from({ length: TRACK_CELLS }, (_, i) => {
                    if (key === "h") {
                      const hue = 120 - (i * 120) / (TRACK_CELLS - 1);
                      return (
                        <span
                          key={i}
                          className="flex-1 rounded-[1px]"
                          style={{ background: `hsl(${hue} 65% 40%)` }}
                        />
                      );
                    }
                    const mid = (i + 0.5) / TRACK_CELLS;
                    const inWindow = key === "d" && Math.abs(mid - 0.5) <= DIR_GOAL_WINDOW / 2;
                    return (
                      <span
                        key={i}
                        className={`flex-1 rounded-[1px] ${inWindow ? "bg-amber-400/80" : "bg-slate-800"}`}
                      />
                    );
                  })}
                </div>
                {key === "s" && (
                  <div className="absolute left-1/2 -top-1 -bottom-1 w-[2px] bg-slate-400/70 -translate-x-1/2" />
                )}
                <div
                  ref={(el) => (gaugeMarkerRefs.current[key] = el)}
                  className="absolute -top-1.5 -bottom-1.5 w-[6px] rounded-[1px] -translate-x-1/2"
                  style={{ left: "0%", opacity: 0 }}
                />
              </div>
              <div className="w-full flex justify-between mt-1 text-[7px] sm:text-[8px] font-semibold text-slate-500">
                <span>{key === "h" ? "LOW" : key === "s" ? "↷ LEFT" : "LEFT"}</span>
                <span>{key === "h" ? "HIGH" : key === "s" ? "RIGHT ↶" : "RIGHT"}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 hidden sm:block text-center text-[8px] text-slate-500">
          Prototype of the three-click free kick mechanic · React + Canvas · tuned for touch and mouse
        </div>
      </div>
    </div>
  );
}
