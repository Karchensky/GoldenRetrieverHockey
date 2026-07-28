/**
 * The pond's sound.
 *
 * Four recorded beds held at fixed levels, plus sparse one-shots — the ice
 * cracking, a stick calling for the puck, a far skater digging in. There is no
 * scroll here to mix against, so the mix is static and the movement comes from
 * somewhere else: every bed is a different length, each starts at its own
 * offset, and each rides a slow drift on its own period. Nothing in the sum
 * repeats on a cycle a listener can learn.
 *
 * Replaces the scroll-mixed journey bed. Kept from it: the loading, the gesture
 * gate, and the velocity-mapped one-shot.
 *
 * Licences for every file are in docs/AUDIO-SOURCES.md.
 *
 * THREE THINGS HERE ARE LOAD-BEARING.
 *
 *  1. NOTHING AUTOPLAYS AND NOTHING IS FETCHED UNTIL IT DOES. The context is
 *     not constructed and not one byte of audio is requested until start() is
 *     called from a real gesture. A visitor who never asks for sound pays zero.
 *
 *  2. `ice-crack.ogg` IS NOT A BED AND MUST NOT BE LOOPED. It is a 7.0 s
 *     one-shot with a 150 ms out-fade — measured, its last 250 ms sits 17.4 dB
 *     under its first. Looped, that fade is an audible pulse every seven
 *     seconds, which is the exact failure a seamless loop exists to avoid. It
 *     is fired at intervals instead.
 *
 *  3. The synthesized layer starts INSTANTLY and the recorded beds arrive under
 *     it. Even the first pair is 454 KB, which is a real wait on a phone, and a
 *     control that says "on" over silence is a control that lies.
 */

import { prefersReducedMotion } from "../quality";

type BedName = "wind" | "rink" | "ice" | "blades";

const FILES: Record<BedName, string> = {
  wind: "/audio/wind-snow.ogg",
  rink: "/audio/rink-distant.ogg",
  ice: "/audio/ice-groan.ogg",
  blades: "/audio/blades.ogg",
};

const CRACK_FILE = "/audio/ice-crack.ogg";

/**
 * THE MIX. A frozen lake at dawn with a game somewhere across it.
 *
 * All four beds were mastered to within 0.6 LU of each other (−23.3 to −23.9
 * LUFS, measured), so these are pure ratios and no file needs a trim.
 *
 * `wind` is the ground and the only steady one (1.5 LU range). `ice` is sparse
 * — 15.1 LU — so it sits higher than it sounds; the number buys presence when
 * it groans, not a constant. `rink` is the voices, and `blades` is the sticks
 * and pucks, both far enough off to be a rumour rather than a subject.
 *
 * `drift` is a slow sine on the bed's gain, each on its own period. On `blades`
 * it is deep on purpose: play heard across open ice comes and goes with the
 * wind, and a bed that swells and recedes never reads as a file on repeat.
 */
const MIX: Record<BedName, { gain: number; period: number; drift: number }> = {
  /* Set by the captain on 2026-07-27, after listening — these are his numbers,
     not a computed balance. He pulled the wind right down and brought the
     sticks up from 0.18 to 0.50, which turns the mix from a storm with a game
     somewhere behind it into a game with weather around it. That is the place
     the page is supposed to be standing in. */
  wind: { gain: 0.10, period: 41, drift: 0.18 },
  rink: { gain: 0.15, period: 67, drift: 0.25 },
  ice: { gain: 0.20, period: 53, drift: 0.20 },
  blades: { gain: 0.50, period: 31, drift: 0.42 },
};

/** Loaded in this order and heard as they land; the first pair is the place. */
const WAVES: BedName[][] = [["wind", "rink"], ["ice", "blades"]];

const MASTER = 0.50;
/** Reduced motion asks for less, so it gets less — and none of the events. */
/* Held at the same ratio to MASTER as before the captain's numbers landed
   (0.44/0.62), so reduced-motion stays about 3 dB under the standard mix
   rather than becoming a fixed level that drifts as MASTER is tuned. */
const MASTER_CALM = 0.35;

export type AmbientBed = {
  /**
   * Must be called synchronously inside a gesture handler — Safari will not
   * resume a context constructed after an await. Resolves once the four beds
   * have landed; false only when the browser has no Web Audio at all.
   */
  start: () => Promise<boolean>;
  stop: () => void;
  /** 0..1 — how hard the reader just moved through the world. */
  poke: (strength: number) => void;
  isRunning: () => boolean;
  dispose: () => void;
};

export function createAmbientBed(): AmbientBed {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let synth: GainNode | null = null;
  let crackBuffer: AudioBuffer | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPoke = 0;
  let generation = 0;
  let calm = false;
  let onVisibility: (() => void) | null = null;

  function running(): boolean {
    return ctx !== null;
  }

  /** Level the mix is meant to sit at, before the tab-hidden duck. */
  function level(): number {
    return calm ? MASTER_CALM : MASTER;
  }

  /**
   * The instant layer. Brown noise under a low pass — no bytes, no wait. It
   * covers the fetch and then gets out of the way as the recorded wind arrives.
   */
  function startSynth(c: AudioContext, out: GainNode): GainNode {
    const length = c.sampleRate * 4;
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const channel = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.035) / 1.018;
      channel[i] = brown * 2.7;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 430;
    filter.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.linearRampToValueAtTime(0.075, c.currentTime + 0.35);
    src.connect(filter).connect(gain).connect(out);
    src.start();
    return gain;
  }

  /** A bed: looped, held at its level, riding its own slow drift. */
  function mountBed(c: AudioContext, out: GainNode, name: BedName, buffer: AudioBuffer, index: number) {
    const spec = MIX[name];
    const src = c.createBufferSource();
    src.buffer = buffer;

    // DO NOT SET loopEnd, and this is measured, not assumed.
    //
    // Chromium's decodeAudioData does not honour Vorbis granulepos trimming: it
    // returns whole packets, so wind-snow.ogg comes back 336 samples (7.6 ms)
    // longer than the 28.000 s it was cut to. The obvious fix — pin loopEnd to
    // the whole second the loop was built at — makes the seam WORSE. Measured
    // in Chromium, |x[0] − x[last]| at the decoded end is 1.9e−3 against 5.0e−3
    // at the nominal cut for wind, 2.0e−3 against 2.2e−2 for rink, 3.7e−3
    // against 2.4e−2 for ice. The tail is not padding, it is the encoder's own
    // overlap continuing the crossfade the file was wrapped with, and every one
    // of those steps sits under the tenth percentile of the file's own
    // sample-to-sample deltas. A decoder that DOES trim exactly (the file plays
    // 28.000 s) lands on the second number, which is still 5–30x under each
    // file's p99.9 delta. Both wraps are inaudible; the default is the better
    // of the two.
    src.loop = true;

    const gain = c.createGain();
    const now = c.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(spec.gain, now + 2.4);
    src.connect(gain).connect(out);

    // Drift runs in the audio thread: an oscillator summed into the gain param,
    // which costs the main thread nothing and needs no frame loop.
    if (!calm && spec.drift > 0) {
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 1 / spec.period;
      const depth = c.createGain();
      depth.gain.value = spec.gain * spec.drift;
      lfo.connect(depth).connect(gain.gain);
      lfo.start(now + (index * 7.3) % spec.period);
    }

    // Each bed enters at its own point in its own file, so four loops of four
    // different lengths never line up into one audible period.
    src.start(now, (index * 5.9) % buffer.duration);
  }

  async function decode(c: AudioContext, url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return await c.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      // A missing bed must never take the page down with it. The visuals are
      // the experience; this is a layer over them.
      console.warn(`[audio] bed unavailable: ${url}`, err);
      return null;
    }
  }

  // ---- one-shots -----------------------------------------------------------

  /** Close ice, from the recording. Never looped — see the note at the top. */
  function crack(c: AudioContext, out: GainNode) {
    if (!crackBuffer) return;
    const now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = crackBuffer;
    const gain = c.createGain();
    gain.gain.value = 0.18 + Math.random() * 0.10;
    const pan = c.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.55;
    src.connect(gain).connect(pan).connect(out);
    src.start(now);
  }

  /** The pond settling: a low sine bending down under a closing filter. */
  function creak(c: AudioContext, out: GainNode, strength: number) {
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(170 + Math.random() * 110, now);
    osc.frequency.exponentialRampToValueAtTime(34 + Math.random() * 25, now + 1.2);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 180, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 1.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055 * strength, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 1.3);
  }

  /** A far skater digging in — filtered noise swept up and back, panned wide. */
  function carve(c: AudioContext, out: GainNode) {
    const now = c.currentTime;
    const dur = 0.5 + Math.random() * 0.5;
    const length = Math.ceil(c.sampleRate * dur);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(900 + Math.random() * 500, now);
    filter.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 900, now + dur * 0.6);
    filter.frequency.exponentialRampToValueAtTime(700, now + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.016 + Math.random() * 0.012, now + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const pan = c.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.8;
    src.connect(filter).connect(gain).connect(pan).connect(out);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  /** A stick tap — or two, the way they call for a pass. */
  function tap(c: AudioContext, out: GainNode) {
    const taps = Math.random() < 0.4 ? 2 : 1;
    for (let k = 0; k < taps; k++) {
      const now = c.currentTime + k * (0.16 + Math.random() * 0.05);
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1150 + Math.random() * 700, now);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.012, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      const pan = c.createStereoPanner();
      pan.pan.value = (Math.random() * 2 - 1) * 0.7;
      osc.connect(gain).connect(pan).connect(out);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }

  function schedule() {
    const c = ctx, out = master;
    if (!c || !out || calm) return;
    timer = setTimeout(() => {
      if (ctx !== c) return;
      const r = Math.random();
      if (r < 0.34) creak(c, out, 0.18 + Math.random() * 0.22);
      else if (r < 0.58) tap(c, out);
      else if (r < 0.78) carve(c, out);
      else crack(c, out);
      schedule();
    }, 9000 + Math.random() * 16000);
  }

  /**
   * A synthesized hit scaled by how hard the reader moved.
   *
   * Deliberately not a sample: the same gesture at two speeds should not make
   * the same sound, and a fixed file cannot do that.
   */
  function poke(strength: number) {
    const c = ctx, out = master;
    if (!c || !out || calm) return;
    const now = c.currentTime;
    if (now - lastPoke < 0.045) return;       // a sweep is not a machine gun
    lastPoke = now;
    const s = Math.max(0, Math.min(1, strength));
    if (s < 0.04) return;

    const dur = 0.10 + s * 0.22;
    const n = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, n, c.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const src = c.createBufferSource();
    src.buffer = buffer;

    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9 + s * 1.6;
    bp.frequency.setValueAtTime(700 + s * 2600, now);
    bp.frequency.exponentialRampToValueAtTime(240 + s * 380, now + dur);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04 + s * 0.12, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const pan = c.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.5;

    src.connect(bp).connect(gain).connect(pan).connect(out);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  // ---- gate ----------------------------------------------------------------

  /**
   * True once a context exists and something is audible; false only when this
   * browser has no Web Audio at all. Resolves when the recorded beds have
   * finished arriving, which is what the control waits on before it stops
   * showing itself as still assembling.
   */
  async function start(): Promise<boolean> {
    if (ctx) return true;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;

    calm = prefersReducedMotion();

    // Everything down to resume() is synchronous, because this runs inside the
    // click and Safari will not start a context that waited on a promise.
    const c = new Ctor();
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, c.currentTime);
    out.gain.linearRampToValueAtTime(level(), c.currentTime + 1.6);
    out.connect(c.destination);
    ctx = c;
    master = out;
    void c.resume();
    synth = startSynth(c, out);

    const gen = ++generation;

    // Small screens and touch devices are asked about before anything is
    // fetched, because what gets fetched depends on the answer.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const narrow = Math.min(window.innerWidth, window.innerHeight) < 700;

    // A pond playing to nobody in a background tab is a nuisance and a battery
    // cost. The control stays on; the level does not.
    onVisibility = () => {
      if (ctx !== c) return;
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(document.hidden ? 0.0001 : level(), t + 0.6);
    };
    document.addEventListener("visibilitychange", onVisibility);

    let index = 0;
    for (const wave of WAVES) {
      const buffers = await Promise.all(wave.map((name) => decode(c, FILES[name])));
      if (ctx !== c || generation !== gen) return false;   // stopped mid-load
      wave.forEach((name, i) => {
        const buffer = buffers[i];
        if (!buffer) return;
        mountBed(c, out, name, buffer, index + i);
        // The synthesized cover steps aside once the real wind is under it. If
        // wind never arrives it stays, and the control is still telling the
        // truth: there is sound.
        if (name === "wind" && synth) {
          const g = synth.gain;
          g.cancelScheduledValues(c.currentTime);
          g.setValueAtTime(g.value, c.currentTime);
          g.linearRampToValueAtTime(0.0001, c.currentTime + 4);
        }
      });
      index += wave.length;
    }

    // The crackle is not a bed and nothing waits on it — it fires at intervals
    // measured in tens of seconds, so it can land whenever it lands. Small
    // screens and touch devices skip it: it is the quietest thing in the mix
    // through a phone speaker, and 73 KB is 73 KB.
    if (!calm && !(coarse || narrow)) {
      void decode(c, CRACK_FILE).then((buffer) => {
        if (ctx === c && generation === gen) crackBuffer = buffer;
      });
    }

    schedule();
    return true;
  }

  function stop() {
    const c = ctx, out = master;
    generation++;
    ctx = null;
    master = null;
    synth = null;
    crackBuffer = null;
    if (timer) { clearTimeout(timer); timer = null; }
    if (onVisibility) {
      document.removeEventListener("visibilitychange", onVisibility);
      onVisibility = null;
    }
    if (!c || !out) return;
    const now = c.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0.0001, now + 0.5);
    window.setTimeout(() => { void c.close(); }, 700);
  }

  return {
    start,
    stop,
    poke,
    isRunning: running,
    dispose: () => { if (ctx) stop(); },
  };
}
