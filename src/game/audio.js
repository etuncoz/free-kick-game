/* ------------------------------------------------------------------
   WebAudio sound effects, synthesized (no asset files). The
   AudioContext is created lazily on first user gesture, as browsers
   require.
------------------------------------------------------------------- */

export function createAudioController() {
  const state = { ctx: null, muted: false };

  const ensureAudio = () => {
    if (!state.ctx) {
      try {
        state.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        state.ctx = null;
      }
    }
    if (state.ctx && state.ctx.state === "suspended") state.ctx.resume();
  };

  const setMuted = (muted) => {
    state.muted = muted;
  };

  const sfx = (kind) => {
    if (!state.ctx || state.muted) return;
    const ctx = state.ctx;
    const t0 = ctx.currentTime;
    const tone = (f, dt, dur, type = "square", g = 0.07) => {
      const o = ctx.createOscillator();
      const ga = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      ga.gain.setValueAtTime(g, t0 + dt);
      ga.gain.exponentialRampToValueAtTime(0.0008, t0 + dt + dur);
      o.connect(ga);
      ga.connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + dur + 0.03);
    };
    const roar = (dur = 0.9, g = 0.09) => {
      const n = ctx.sampleRate * dur;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      const ga = ctx.createGain();
      ga.gain.value = g;
      src.connect(f);
      f.connect(ga);
      ga.connect(ctx.destination);
      src.start(t0);
    };
    if (kind === "lock") tone(720, 0, 0.05, "square", 0.045);
    if (kind === "kick") {
      tone(82, 0, 0.09, "triangle", 0.28);
      tone(160, 0, 0.05, "sine", 0.12);
    }
    if (kind === "goal") {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.16, "square", 0.06));
      roar(1.1, 0.1);
    }
    if (kind === "save") {
      tone(170, 0, 0.22, "sawtooth", 0.1);
      roar(0.4, 0.04);
    }
    if (kind === "post") {
      tone(1180, 0, 0.18, "triangle", 0.12);
      tone(690, 0.02, 0.22, "triangle", 0.08);
    }
    if (kind === "wall") tone(120, 0, 0.12, "triangle", 0.18);
    if (kind === "miss") tone(240, 0, 0.25, "sawtooth", 0.05);
    if (kind === "whistle") {
      tone(2350, 0, 0.28, "square", 0.05);
      tone(2350, 0.32, 0.14, "square", 0.045);
    }
  };

  return { ensureAudio, sfx, setMuted };
}
