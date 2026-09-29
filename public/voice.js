// Jax Coach - voice callouts.
// Engine "kokoro": a natural voice generated on this PC (voice\kokoro_server.py, CPU, low priority), no limits.
//   Lines are split into sentences so the first one plays while the next is generated; every sentence is cached
//   on disk, so repeats are instant.
// Engine "groq": Groq's Orpheus voices via the local server (free tier: 10 new lines/minute, 100/day).
// Engine "browser": the system voices, the last fallback.
// Deliberately quiet: each decision key speaks once per `repeatAfter`, and nothing within the minimum gap
// of the last line unless it's urgent.

const Voice = (() => {
  const LS_ON = 'jc_voice', LS_CFG = 'jc_voice_cfg';
  const hasSpeech = 'speechSynthesis' in window;
  let enabled = false;
  const cfg = { engine: 'auto', kokoroVoice: 'af_heart', kokoroSpeed: 1.05, groqVoice: 'hannah', style: '', volume: 0.9, chime: true, browserVoice: '', rate: 1.0 };
  try { enabled = localStorage.getItem(LS_ON) === '1'; Object.assign(cfg, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch {}
  const avail = { groq: false, kokoro: false, kokoroPort: 8788 };
  const failed = { groq: 0, kokoro: 0 };   // consecutive failures -> skip that engine for the session after 3
  let unlocked = false;                    // browsers only allow sound after a click on the page
  let lastAt = 0, playing = null;
  let minGap = 8000;                       // quiet time between non-urgent lines; the app raises it later in the game
  const spoken = new Map();

  const KOKORO_VOICES = [
    { id: 'af_heart', name: 'Heart', female: true }, { id: 'af_bella', name: 'Bella', female: true },
    { id: 'af_nicole', name: 'Nicole (soft)', female: true }, { id: 'af_sarah', name: 'Sarah', female: true },
    { id: 'af_nova', name: 'Nova', female: true }, { id: 'af_sky', name: 'Sky', female: true },
    { id: 'af_aoede', name: 'Aoede', female: true }, { id: 'af_kore', name: 'Kore', female: true },
    { id: 'bf_emma', name: 'Emma (British)', female: true }, { id: 'bf_isabella', name: 'Isabella (British)', female: true },
    { id: 'bf_lily', name: 'Lily (British)', female: true }, { id: 'bf_alice', name: 'Alice (British)', female: true },
    { id: 'am_michael', name: 'Michael', female: false }, { id: 'am_fenrir', name: 'Fenrir', female: false },
    { id: 'bm_george', name: 'George (British)', female: false }, { id: 'bm_fable', name: 'Fable (British)', female: false },
  ];
  const GROQ_VOICES = [
    { id: 'hannah', name: 'Hannah', female: true }, { id: 'autumn', name: 'Autumn', female: true }, { id: 'diana', name: 'Diana', female: true },
    { id: 'austin', name: 'Austin', female: false }, { id: 'daniel', name: 'Daniel', female: false }, { id: 'troy', name: 'Troy', female: false },
  ];
  const STYLES = ['', 'calm', 'friendly', 'cheerful', 'professionally'];

  // browser voices: female English first
  const FEMALE = ['Ava', 'Aria', 'Jenny', 'Emma', 'Michelle', 'Libby', 'Sonia', 'Google US English', 'Google UK English Female', 'Samantha', 'Zira', 'Hazel', 'Susan'];
  let sysVoices = [];
  function loadVoices() {
    const score = (v) => { const i = FEMALE.findIndex((n) => v.name.includes(n)); return (i >= 0 ? 100 - i : 0) + (/natural|online/i.test(v.name) ? 200 : 0); };
    sysVoices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
  }
  if (hasSpeech) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  const sysVoice = (c) => sysVoices.find((v) => v.voiceURI === c.browserVoice) || sysVoices[0] || null;

  // the engine to try first for a given config
  function engineFor(c) {
    if (c.engine === 'browser') return 'browser';
    const ok = (e) => avail[e] && failed[e] < 3;
    if (c.engine === 'groq' && ok('groq')) return 'groq';
    if (ok('kokoro')) return 'kokoro';
    if (ok('groq')) return 'groq';
    return 'browser';
  }
  const engine = () => engineFor(cfg);

  // a soft two-note chime so a callout never starts out of nowhere
  let actx = null;
  function chime(c) {
    if (!c.chime) return Promise.resolve();
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + 0.02;
      [[659.25, 0], [880, 0.11]].forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + d);
        g.gain.linearRampToValueAtTime(0.1 * c.volume, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.35);
        o.connect(g).connect(actx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.4);
      });
    } catch {}
    return new Promise((r) => setTimeout(r, 300));
  }
  document.addEventListener('pointerdown', () => { unlocked = true; if (actx && actx.state === 'suspended') actx.resume(); }, { capture: true });

  // ---------- audio generation (in-memory promise cache on top of the disk caches) ----------
  const audioCache = new Map();    // key -> Promise<blob url>
  const readErr = async (r) => { let e = ''; try { e = (await r.json()).error; } catch {} return e || `error ${r.status}`; };
  function audio(eng, text, c, { low = false } = {}) {
    const key = eng === 'kokoro' ? `k|${c.kokoroVoice}|${c.kokoroSpeed}|${text}` : `g|${c.groqVoice}|${c.style}|${text}`;
    if (!audioCache.has(key)) {
      const req = eng === 'kokoro'
        ? fetch(`http://127.0.0.1:${avail.kokoroPort}/tts`, { method: 'POST', body: JSON.stringify({ text, voice: c.kokoroVoice, speed: c.kokoroSpeed, priority: low ? 'low' : 'high' }) })
        : fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text, voice: c.groqVoice, style: c.style }) });
      const p = req.then(async (r) => {
        if (!r.ok) { const e = await readErr(r); throw Object.assign(new Error(e), { limit: r.status === 429 }); }
        failed[eng] = 0;
        return URL.createObjectURL(await r.blob());
      });
      p.catch(() => audioCache.delete(key));
      audioCache.set(key, p);
    }
    return audioCache.get(key);
  }
  // Kokoro: one sentence per request, so the first sentence is ready (and playing) while the rest is made
  const sentences = (text) => (String(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text]).map((s) => s.trim()).filter(Boolean);
  // request sentences one after another (the helper makes one at a time; this keeps them in order)
  let chain = Promise.resolve();
  function queueKokoro(parts, c, low) {
    return parts.map((s) => { const p = chain.then(() => audio('kokoro', s, c, { low })); chain = p.catch(() => {}); return p; });
  }

  // Every utterance resolves when it has finished, so lines can be chained. `seq` cancels whatever is running.
  let seq = 0, sequencing = false;
  function stop() {
    seq++; sequencing = false;
    if (playing) { try { playing.pause(); } catch {} playing = null; }
    if (hasSpeech) speechSynthesis.cancel();
  }
  function browserSpeak(text, c) {
    return new Promise((res) => {
      if (!hasSpeech) return res();
      const u = new SpeechSynthesisUtterance(text);
      const v = sysVoice(c);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.rate = c.rate; u.volume = c.volume;
      u.onend = res; u.onerror = res;
      speechSynthesis.speak(u);
    });
  }
  function playUrl(url, c) {
    return new Promise((res, rej) => {
      const a = new Audio(url);
      a.volume = c.volume;
      playing = a;
      a.onended = () => { if (playing === a) playing = null; res(); };
      a.onerror = () => { if (playing === a) playing = null; rej(new Error('audio playback failed')); };
      a.onpause = () => { if (playing !== a) res(); };      // stopped by stop()
      a.play().catch(rej);
    });
  }
  let lastError = '';
  const note = (eng, e) => {
    if (!e.limit) failed[eng]++;        // hitting Groq's free limit isn't a failure, just skip it for this line
    lastError = `${eng}: ${e.message || e}`;
    console.warn(`Voice (${eng}) failed, falling back:`, lastError);
  };
  // one line: the chosen engine, then the others as fallbacks
  async function speakLine(text, c, my) {
    const first = engineFor(c);
    const order = [first, ...['kokoro', 'groq'].filter((e) => e !== first && avail[e] && failed[e] < 3 && c.engine !== 'browser')];
    for (const eng of order) {
      if (eng === 'browser') break;
      try {
        if (eng === 'kokoro') {
          const parts = queueKokoro(sentences(text), c, false);
          for (const p of parts) { const url = await p; if (my !== seq) return; await playUrl(url, c); }
        } else {
          await playUrl(await audio('groq', text, c), c);
        }
        lastError = '';
        return;
      } catch (e) { if (my !== seq) return; note(eng, e); }
    }
    await browserSpeak(text, c);
  }
  async function speakLines(lines, c = { ...cfg }) {
    const my = ++seq;
    sequencing = true;
    const eng = engineFor(c);
    if (eng === 'kokoro') queueKokoro(lines.flatMap(sentences), c, false);   // generate while the chime plays
    else if (eng === 'groq') lines.forEach((l) => audio('groq', l, c).catch(() => {}));
    await chime(c);
    for (let i = 0; i < lines.length && my === seq; i++) {
      await speakLine(lines[i], c, my);
      if (i < lines.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    if (my === seq) sequencing = false;
  }
  const speakNow = (text) => speakLines([text]);
  const busy = () => sequencing || !!playing || (hasSpeech && speechSynthesis.speaking);

  function say(text, { key = text, urgent = false, repeatAfter = 90 } = {}) {
    if (!enabled || !unlocked || !text) return false;
    const now = Date.now();
    if (spoken.has(key) && now - spoken.get(key) < repeatAfter * 1000) return false;
    if (!urgent && (now - lastAt < minGap || busy())) return false;
    if (urgent) stop();
    speakNow(text);
    lastAt = now; spoken.set(key, now);
    return true;
  }

  // several lines in a row (briefings). Not spoken while something else plays; the caller simply retries on
  // its next tick until it goes through (it's keyed, so it plays exactly once).
  function announce(lines, { key, repeatAfter = 3600 } = {}) {
    lines = lines.filter(Boolean);
    if (!enabled || !unlocked || !lines.length || busy()) return false;
    const now = Date.now();
    if (key && spoken.has(key) && now - spoken.get(key) < repeatAfter * 1000) return false;
    speakLines(lines);
    lastAt = now; if (key) spoken.set(key, now);
    return true;
  }

  const saveCfg = () => { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch {} };

  return {
    say,
    announce,
    wasSaid: (key) => spoken.has(key),
    supported: true,
    get enabled() { return enabled; },
    get ready() { return enabled && unlocked; },
    setEnabled(v) {
      enabled = !!v; unlocked = true;
      try { localStorage.setItem(LS_ON, enabled ? '1' : '0'); } catch {}
      if (enabled) speakNow('Voice callouts on.'); else stop();
    },
    setAvailable({ groq, kokoro, kokoroPort } = {}) { avail.groq = !!groq; avail.kokoro = !!kokoro; if (kokoroPort) avail.kokoroPort = kokoroPort; },
    setGroqAvailable(v) { avail.groq = !!v; },
    setMinGap(seconds) { minGap = seconds * 1000; },
    // warm the cache for lines that are likely this game: local voice only (Groq's free tier is too small),
    // at low priority so a live callout always goes first
    prefetch(lines) { if (engine() === 'kokoro') queueKokoro(lines.flatMap(sentences), { ...cfg }, true).forEach((p) => p.catch(() => {})); },
    engine, available: () => ({ ...avail }), lastError: () => lastError,
    kokoroVoices: KOKORO_VOICES, groqVoices: GROQ_VOICES, styles: STYLES,
    browserVoices: () => sysVoices.map((v) => ({ uri: v.voiceURI, name: v.name.replace(/^Microsoft /, '').replace(/ - English.*/, '') })),
    config: () => ({ ...cfg }),
    setConfig(c) { Object.assign(cfg, c); failed.groq = 0; failed.kokoro = 0; saveCfg(); },
    // plays with the given settings (e.g. the ones picked in the Settings dialog) without saving them
    test(text = 'Darius is dead for 25 seconds. Crash the wave, then recall.', c = null) {
      unlocked = true; stop(); failed.groq = 0; failed.kokoro = 0; speakLines([text], { ...cfg, ...(c || {}) });
    },
  };
})();
