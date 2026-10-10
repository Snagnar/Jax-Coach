// Jax Coach - UI. Loads the champion playbooks + Data Dragon, polls the live game, renders all views.

const D = { dd: { champs: {}, champByName: {}, keyToId: {}, items: {}, itemByName: {}, version: '' }, shared: {}, meta: null, phases: null, matchups: {}, rules: null, overlayRules: null, playbook: null, plan: null, config: {} };
const S = {
  view: 'live', champ: null, showWhy: false, pbSel: null, pbRule: null, game: null, A: null, demo: false, demoT: 330, demoTimer: null, overrideOpp: null,
  memory: Engine.newMemory(), muSel: null, muFilter: '', planPhase: 'lvl1_3', serverDown: false, liveStatus: 0,
  modeState: { cur: null, pending: null, pendingCount: 0, changedAt: 0 },
  clientPhase: null, cs: null, csOpp: null, meChecked: false, rec: null, reviewStale: true,
};
const MODE_META = {
  allin: { icon: '⚔', name: 'All-in' }, push: { icon: '➤', name: 'Push' }, trade: { icon: '⇄', name: 'Trade & farm' },
  safe: { icon: '⚠', name: 'Play safe' }, retreat: { icon: '⛔', name: 'Back off' }, group: { icon: '◎', name: 'Objective' }, dead: { icon: '✚', name: 'Dead' },
};

// ---------- utils ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const list = (items, cls = '') => (arr(items).length ? `<ul class="${cls}">${arr(items).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
const pct = (v) => (v == null ? '–' : `${(+v).toFixed(1)}%`);
async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
const DD = () => `https://ddragon.leagueoflegends.com/cdn/${D.dd.version}`;

function champImg(id, cls = '') {
  const c = D.dd.champs[id];
  if (!c) return `<span class="ci ${cls}" title="${esc(id)}"></span>`;
  return `<img class="ci ${cls}" src="${DD()}/img/champion/${c.image.full}" alt="" title="${esc(c.name)}">`;
}
const champName = (id) => (D.dd.champs[id] || {}).name || (D.matchups[id] || {}).name || id;
function itemImg(id, cls = '') {
  const it = D.dd.items[id];
  return `<img class="ii ${cls}" src="${DD()}/img/item/${id}.png" alt="" title="${esc(it ? it.name : id)}">`;
}
function itemChip(name, extraTitle = '') {
  const id = D.dd.itemByName[String(name).toLowerCase()];
  if (!id) return `<span class="item-chip missing" title="Not in the current Data Dragon item list (renamed or removed?)">${esc(name)}</span>`;
  return `<span class="item-chip" title="${esc(extraTitle)}">${itemImg(id)}${esc(D.dd.items[id].name)}</span>`;
}
function itemsText(s) {
  // turn an item string like "Doran's Blade + Health Potion" into chips when names are recognisable
  const parts = String(s || '').split(/\s*(?:\+|,|\/|→|->|>)\s*/).filter(Boolean);
  if (parts.length && parts.every((p) => D.dd.itemByName[p.replace(/^\d+\s*x?\s*/i, '').toLowerCase()])) {
    return `<span class="row">${parts.map((p) => itemChip(p.replace(/^\d+\s*x?\s*/i, ''))).join('')}</span>`;
  }
  return esc(s);
}
const wrClass = (wr) => (wr == null ? '' : wr >= 51.5 ? 'wr-good' : wr <= 48.5 ? 'wr-bad' : 'wr-mid');
const diffDots = (d) => (d ? `<span class="diff d${Math.round(d)}" title="Difficulty ${d}/5">${'<i></i>'.repeat(5)}</span>` : '');
const diffLabel = (d) => ['', 'Very easy', 'Easy', 'Skill matchup', 'Hard', 'Very hard'][Math.round(d)] || '';

// ---------- boot ----------
async function boot() {
  const [shared, champs, items, cfg] = await Promise.allSettled([
    getJSON('/data/shared.json'), getJSON('/api/dd/champion'), getJSON('/api/dd/item'), getJSON('/api/config'),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  D.shared = val(shared) || {};
  D.config = val(cfg) || {};
  Voice.setAvailable({ groq: D.config.hasGroq, kokoro: D.config.hasKokoro, kokoroPort: D.config.kokoroPort });
  const ch = val(champs), it = val(items);
  if (ch) {
    D.dd.version = ch.version;
    for (const c of Object.values(ch.data)) {
      D.dd.champs[c.id] = { id: c.id, key: c.key, name: c.name, tags: c.tags, info: c.info, image: c.image, range: c.stats && c.stats.attackrange };
      D.dd.champByName[c.name.toLowerCase()] = c.id;
      D.dd.champByName[c.id.toLowerCase()] = c.id;
      D.dd.keyToId[c.key] = c.id;
    }
  }
  if (it) {
    D.dd.version = D.dd.version || it.version;
    const better = (a, b) => { // prefer Summoner's Rift, purchasable, normal (short) ids
      const score = (id) => { const x = it.data[id]; return (x.maps && x.maps['11'] ? 4 : 0) + (x.gold && x.gold.purchasable ? 2 : 0) + (x.inStore === false ? -3 : 0) + (+id < 10000 ? 1 : 0); };
      return score(a) > score(b) || (score(a) === score(b) && +a < +b);
    };
    for (const [id, x] of Object.entries(it.data)) {
      D.dd.items[id] = x;
      const k = x.name.toLowerCase();
      if (!D.dd.itemByName[k] || better(id, D.dd.itemByName[k])) D.dd.itemByName[k] = id;
    }
  }
  await Promise.allSettled([Playbooks.loadGeneric(), Playbooks.refreshList(), Playbooks.loadPersonal()]);
  let start = 'Jax';
  try { start = localStorage.getItem('jc.champ') || start; } catch {}
  await useChamp(D.dd.champs[start] || start === 'Jax' ? start : 'Jax', { quiet: true });

  await Focus.loadHistory();
  Archive.load().then(renderToday).catch(() => {});
  Agent.onApply(() => { applyPlaybook(); if (S.view === 'live') renderLive(); });
  let agentRender = 0;
  Agent.onChange(() => {
    if (agentRender) return;
    agentRender = setTimeout(() => { agentRender = 0; renderStatus(); if (S.view === 'playbook') renderPlaybook(); if (S.view === 'live' && !S.A) renderLive(); }, 200);
  });
  Playbooks.onChange(() => { if (S.view === 'playbook') renderPlaybook(); });
  Agent.refreshStatus().then(() => Agent.refreshJobs());
  wireUi();
  renderStatic();
  Report.onChange(() => { if (S.view === 'report') renderReport(); else if (S.view === 'live' && !S.game) renderLive(); });
  Moment.onChange(() => { if (S.view === 'report') renderReport(); });
  Review.onChange(() => { if (S.view === 'review') renderReview(); else if (S.view === 'live' && S.cs && Review.state.status === 'done') renderLive(); });
  // the match archive imports in the background, never while you're queued or playing (scouting needs the API budget)
  Archive.setBusy(() => (S.game && !S.demo ? 'you are in a game' : ['Matchmaking', 'ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress'].includes(S.clientPhase) ? 'you are in queue or champ select' : null));
  let archiveTimer = null;
  Archive.onChange(() => {
    if (archiveTimer) return;
    archiveTimer = setTimeout(() => { archiveTimer = null; renderStatus(); if (S.view === 'report' && Report.state.listTried) { Report.refreshList(); renderReport(); } }, 3000);
  });
  poll();
  pollClient();
  loadUpdateInfo().then(() => setTimeout(autoCheckUpdate, 60000));
  // A worker drives the polling: browsers throttle page timers hard when the window is hidden behind the game.
  const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000)'], { type: 'text/javascript' })));
  let tick = 0;
  let busy = false, clientBusy = false;   // never stack requests on the single-threaded server
  ticker.onmessage = async () => {
    tick++;
    if (!S.demo && !busy) { busy = true; try { await poll(); } finally { busy = false; } }
    if (!S.game && !S.demo && (tick % 2 === 0 || S.clientPhase === 'ChampSelect') && !clientBusy) { clientBusy = true; try { await pollClient(); } finally { clientBusy = false; } }
    if (tick % 30 === 5) archiveCheck();
  };
}

// ---------- the active champion's playbook ----------
// S.champ is whose playbook the page shows: your champ select pick, the champion you're playing, or your choice.
async function useChamp(cid, { quiet = false, fresh = false } = {}) {
  if (!cid) return;
  const switching = cid !== S.champ;
  S.champ = cid;
  try { localStorage.setItem('jc.champ', cid); } catch {}
  await Playbooks.load(cid, fresh || switching);
  if (S.champ !== cid) return;                     // another switch happened while loading
  applyPlaybook();
  Review.setChampion(cid);
  if (switching && !quiet) S.muSel = Object.keys(D.matchups).sort()[0] || null;
}
function applyPlaybook() {
  const plan = Agent.planFor(S.champ);
  const e = Playbooks.effective(S.champ, D.dd, plan);
  Object.assign(D, { meta: e.meta, phases: e.phases, rules: e.rules, matchups: e.matchups, overlayRules: e.overlayRules, playbook: e.playbook, plan: plan || null, personal: Playbooks.personal || { rules: [], hints: [] } });
  if (!S.muSel || !D.matchups[S.muSel]) S.muSel = Object.keys(D.matchups).sort()[0] || null;
  const pb = D.playbook;
  $('#champChip').innerHTML = `${champImg(S.champ, 'xs')}<span>${esc(champName(S.champ))}</span>${pb.generic ? '<i class="faint">· no playbook</i>' : pb.draft ? '<i class="faint">· draft</i>' : ''}<span class="caret">▾</span>`;
  $('#patchChip').textContent = `Patch ${D.meta.patch || D.shared.patch || '?'} · ${Object.keys(D.matchups).length} matchups`;
  $('#patchChip').title = `Research data: ${D.meta.lastUpdated || '?'} · Data Dragon ${D.dd.version || 'unavailable'}`;
  renderStatic();
}

// ---------- League client: champ select + who you are ----------
async function pollClient() {
  let phase = null;
  try { const r = await fetch('/api/lcu/lol-gameflow/v1/gameflow-phase'); if (r.ok) phase = await r.json(); } catch {}
  S.clientPhase = phase;
  if (phase && !S.meChecked) {
    S.meChecked = true;
    try { Review.setIdentity(await getJSON('/api/lcu/lol-summoner/v1/current-summoner')); } catch {}
  }
  if (phase === 'ChampSelect') {
    try { S.cs = await getJSON('/api/lcu/lol-champ-select/v1/session'); S.csFetchedAt = Date.now(); } catch { S.cs = null; }
    if (S.cs) {
      const mine = (S.cs.myTeam || []).find((p) => p.cellId === S.cs.localPlayerCellId) || {};
      const pick = D.dd.keyToId[String(mine.championId || mine.championPickIntent || '')];
      if (pick && pick !== S.champ) await useChamp(pick);
      Agent.onChampSelect(S.cs, D);
    }
    // load your history on this champion once in the background (cached on disk) for "your record vs X"
    if (!S.csReviewTried && D.config.hasKey && Review.state.me && !Review.state.games.length && Review.state.status !== 'loading') { S.csReviewTried = true; Review.load(D); }
  }
  else { S.cs = null; S.csOpp = null; }
  renderStatus();
  if (!S.game && !S.demo && S.view === 'live') renderLive();
}

// ---------- polling ----------
async function poll() {
  if (S.demo) S.game = Demo.snapshot(D, S.demoT);
  else {
    try {
      let j = await getJSON('/api/live');
      if (S.demo) return;          // demo started while this request was in flight: drop the stale answer
      if (S.clientPhase === 'WatchInProgress') j = { inGame: false, status: -2 };   // watching a replay, not playing
      S.serverDown = false;
      S.liveStatus = j.status;
      const was = !!S.game;
      S.game = j.activePlayer ? j : null;
      if (!S.game && was) { S.memory = Engine.newMemory(); S.overrideOpp = null; }
    } catch { if (S.demo) return; S.serverDown = true; S.game = null; }
  }
  S.A = S.game ? Engine.analyze(S.game, D, { memory: S.memory, overrideOppId: S.overrideOpp }) : null;
  if (S.A && S.A.champ !== S.champ && D.dd.champs[S.A.champ]) { await useChamp(S.A.champ); S.A = Engine.analyze(S.game, D, { memory: S.memory, overrideOppId: S.overrideOpp }); }
  if (S.A && !S.demo) Agent.onGame(S.A, D);
  Agent.tick(S.demo ? null : S.A, D);
  if (!S.demo) askVoice();
  if (S.A) {
    Voice.setMinGap(S.A.t < 25 * 60 ? 30 : 45);   // seconds of silence after a line ends; less talk late in the game
    gamePlanVoice(S.A);
    handleMode(S.A);
    alertVoice(S.A);
    callouts(S.A);
    warnWatch(S.A);
    respawnVoice(S.A);
    planVoice(S.A);
    if (!S.demo) {
      scoutPlayers();
      record(S.A);
      const ap = S.game.activePlayer;
      if (ap.riotIdGameName && ap.riotIdTagLine) Review.setIdentity({ gameName: ap.riotIdGameName, tagLine: ap.riotIdTagLine });
    }
  } else if (!S.game) {
    if (S.rec) { finishRecording(null); S.rec = null; }
    Agent.endGame();
    S.modeState = { cur: null, pending: null, pendingCount: 0, changedAt: 0 };
    S.warn = null; S.resp = null;
    setWash(false, false);
  }
  document.body.dataset.mode = S.A && S.modeState.cur ? S.modeState.cur.mode : '';
  maybeProfile();
  renderStatus();
  if (S.view === 'live') renderLive();
}

// playbook v2: every playbook whose matchups have no profiles yet gets one profile run, one champion at a time and
// only while nothing else is going on (no game, no champ select). Once per champion and week; the button on the
// Playbook tab runs it any time.
async function maybeProfile() {
  if (S.A || S.cs || S.demo || S.profileBusy || !Agent.ready()) return;
  if (Agent.state.jobs.some((j) => j.status === 'running' && ['profile', 'champion'].includes(j.type))) return;
  S.profileTried = S.profileTried || {};
  const pool = [S.champ, ...Playbooks.list.filter((p) => p.parts && p.parts.matchups).map((p) => p.champion)].filter((c, i, a) => c && a.indexOf(c) === i);
  const cid = pool.find((c) => !S.profileTried[c] && Playbooks.has(c));
  if (!cid) return;
  S.profileTried[cid] = true;
  S.profileBusy = true;
  try {
    await Playbooks.load(cid);
    const mus = Object.values((((Playbooks.raw(cid) || {}).matchups) || {}).matchups || {}).filter((v) => v && typeof v === 'object' && v.name);
    if (mus.length < 5 || mus.filter((v) => v.profile).length >= mus.length / 2) return;
    const k = `jc.profileTried.${cid}`;
    let last = 0; try { last = +localStorage.getItem(k) || 0; } catch {}
    if (Date.now() - last < 7 * 86400000) return;
    try { localStorage.setItem(k, String(Date.now())); } catch {}
    await Agent.profiles(D, cid);
  } finally { S.profileBusy = false; }
}

// ---------- settings: storage per category ----------
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
async function loadStorage(clear) {
  const el = $('#storage');
  let areas;
  try {
    const r = await fetch(clear ? `/api/storage/clear/${clear}` : '/api/storage', { method: clear ? 'POST' : 'GET', cache: 'no-store' });
    areas = await r.json();
    if (!r.ok) throw new Error(areas.error || r.status);
    areas = areas.filter((a) => a.clear || a.size.files);      // e.g. no local voice installed
  } catch (e) { el.innerHTML = `<div class="small warn-t">Couldn't read storage (${esc(e.message)}).</div>`; return; }
  const total = areas.reduce((s, a) => s + a.size.bytes, 0), freeable = areas.filter((a) => a.clear).reduce((s, a) => s + a.size.bytes, 0);
  el.innerHTML = areas.map((a) => `<div class="st-row ${a.clear ? '' : 'kept'}" data-label="${esc(a.label)}" data-size="${esc(fmtBytes(a.size.bytes))}" data-note="${esc(a.note)}">
      <div><b>${esc(a.label)}</b><div class="small muted">${esc(a.note)}</div></div>
      <span class="st-size">${fmtBytes(a.size.bytes)}<br><span class="faint">${a.size.files} file${a.size.files === 1 ? '' : 's'}</span></span>
      ${a.clear ? `<button type="button" class="btn small ghost" data-clear="${esc(a.id)}" ${a.size.bytes ? '' : 'disabled'}>Clear</button>` : '<span class="small faint">kept</span>'}
    </div>`).join('') + `<div class="st-total"><span>Total ${fmtBytes(total)}</span><span>Caches ${fmtBytes(freeable)}</span></div>`;
}

// ---------- play mode (with hysteresis so it doesn't flicker) + voice ----------
function handleMode(A) {
  const m = A.mode, ms = S.modeState;
  // a line that couldn't play (another one was talking) is retried for ~20s while the decision still stands
  // after laning the game announces spawns itself, so "X is up" stays on screen only; from 25:00 the one-minute
  // heads-up only for Baron (Dragon Soul and Elder have their own alerts)
  const quiet = (x) => x.rule === 'objective' && (/ is up\.$/.test(x.voice) || (A.t >= 25 * 60 && !/^Baron/.test(x.voice)));
  const speak = (x) => {
    if (!x.voice || quiet(x)) { ms.unspoken = null; return; }
    const ok = Voice.say(x.voice, { key: x.voiceKey, urgent: x.mode === 'push' || x.mode === 'retreat', repeatAfter: x.voiceKey === x.mode ? 60 : 900 });
    ms.unspoken = ok || Voice.wasSaid(x.voiceKey) ? null : { key: x.voiceKey, until: Date.now() + 20000 };
  };
  if (!ms.cur) { ms.cur = m; ms.changedAt = Date.now(); return; }
  if (m.mode === ms.cur.mode) {
    const newDecision = m.voiceKey !== ms.cur.voiceKey;
    ms.cur = m; ms.pending = null;
    if (newDecision || (ms.unspoken && ms.unspoken.key === m.voiceKey && Date.now() < ms.unspoken.until)) speak(m);
    return;
  }
  // switch immediately for events (kill, death, objective, jungler showing); otherwise require 2 ticks in a row
  const instant = ['push', 'dead', 'group'].includes(m.mode) || ms.cur.mode === 'dead' || /^jg-near/.test(m.voiceKey);
  ms.pendingCount = ms.pending && ms.pending.mode === m.mode ? ms.pendingCount + 1 : 1;
  ms.pending = m;
  if (!instant && ms.pendingCount < 2) return;
  ms.cur = m; ms.pending = null; ms.changedAt = Date.now();
  speak(m);
}
// ---------- spoken game plan: start briefing, phase changes, state flips, item spikes ----------
const MOTIVATION = () => { const m = ((D.rules || {}).text || {}).motivation; return Array.isArray(m) && m.length ? m : ["Play your windows, not your emotions. Let's go.", 'Calm lane, clean waves, big spikes. This one is yours.']; };
// turn guide text into something that sounds right when read aloud (and never contains Orpheus [directions])
function speakable(s, max = 170) {
  let t = String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '')
    .replace(/\s*(?:>|→|->)\s*/g, ', then ').replace(/\blvl\b/gi, 'level').replace(/\bAA\b/g, 'auto attack')
    .replace(/&/g, ' and ').replace(/\bvs\.?\b/gi, 'versus').replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '));
    t = i > 50 ? cut.slice(0, i) : cut.slice(0, cut.lastIndexOf(' '));
  }
  return t && !/[.!?]$/.test(t) ? t + '.' : t;
}
function planLine(A, which) {
  const key = { early: 'lvl1_3', mid: 'midgame', late: 'lategame' }[which];
  const opp = A.P.opp, mu = opp && D.matchups[opp.cid];
  const tip = mu && arr((mu.phases || {})[key])[0];
  if (tip) return tip;
  const ph = arr(D.phases.phases).find((p) => p.id === key);
  return ph ? arr(ph.goals)[0] : '';
}
function briefingLines(A) {
  const opp = A.P.opp, mu = opp && D.matchups[opp.cid];
  const vs = opp ? ` You're up against ${champName(opp.cid)}${mu && mu.difficulty ? `, ${diffLabel(mu.difficulty).toLowerCase()}` : ''}.` : '';
  const F = Focus.current;
  // the late-game plan is announced at 25:00 anyway; the focus matters more at the start
  return [
    `Jax Coach is live.${vs}`,
    F ? `Your one focus this game: ${F.spoken}` : '',
    `Early game: ${speakable(planLine(A, 'early'), 160)}`,
    `Mid game: ${speakable(planLine(A, 'mid'), 160)}`,
    F ? '' : `Late game: ${speakable(planLine(A, 'late'), 160)}`,
    (() => { const m = MOTIVATION(); return m[Math.floor(Math.random() * m.length)]; })(),
  ].filter((l) => l && !/: $/.test(l));
}
const reviewTrends = () => (Review.state.games.length >= 3 ? Review.trends(Review.state.games) : null);
function gamePlanVoice(A) {
  const big = (p) => (p === 'midgame' ? 'mid' : p === 'lategame' ? 'late' : 'laning');
  if (!S.vg || A.t < S.vg.lastT - 5) {
    Focus.start(Focus.choose(reviewTrends()));
    S.focusSay = []; S.jgFarAt = null;
    S.vg = { id: Math.random().toString(36).slice(2), big: big(A.phase), label: A.state.label, pending: null, pendingSince: 0, lastStateCall: -1e9, brief: briefingLines(A) };
    if (A.t < 15 && Voice.enabled) Voice.prefetch(S.vg.brief);
  }
  const vg = S.vg;
  vg.lastT = A.t;
  if (A.P.me.isDead && A.t < 150) return;

  // 1) ~20s in: "I'm on", the plan for early / mid / late, and a line to get going
  if (!vg.briefed && A.t >= 15 && A.t < 150 && Voice.announce(vg.brief, { key: `brief-${vg.id}` })) vg.briefed = true;

  // 2) mid game at 14:00, late game at 25:00: the plan for the new phase
  const bp = big(A.phase);
  if (bp !== vg.big) {
    if (bp !== 'laning') vg.phaseCall = { key: `phase-${bp}-${vg.id}`, until: A.t + 90, lines: [bp === 'mid' ? 'Mid game now.' : 'Late game now.', speakable(planLine(A, bp))] };
    vg.big = bp;
  }
  if (vg.phaseCall && A.t < vg.phaseCall.until && Voice.announce(vg.phaseCall.lines, { key: vg.phaseCall.key })) vg.phaseCall = null;

  // 3) your game flips to ahead / behind and stays there for 40s (at most once every 4 min)
  const lbl = A.state.label;
  if (lbl === vg.label) vg.pending = null;
  else if (vg.pending !== lbl) { vg.pending = lbl; vg.pendingSince = A.t; }
  else if (A.t - vg.pendingSince >= 40 && A.t > 150 && A.t >= 20 * 60) { vg.label = lbl; vg.pending = null; }   // late game: shown, not spoken
  else if (A.t - vg.pendingSince >= 40 && A.t > 150) {
    const ph = arr(D.phases.phases).find((p) => p.id === A.phase) || {};
    const lines = lbl === 'ahead' ? [`You're ahead now${A.state.very ? ', by a lot' : ''}.`, speakable(arr(ph.ifAhead)[0])]
      : lbl === 'behind' ? ["You've fallen behind.", speakable(arr(ph.ifBehind)[0])] : null;
    if (!lines) { vg.label = lbl; vg.pending = null; }                        // back to even: no need to talk
    else if (A.t - vg.lastStateCall >= 240 && Voice.announce(lines, { key: `state-${vg.id}-${lbl}-${Math.round(A.t)}` })) {
      vg.label = lbl; vg.pending = null; vg.lastStateCall = A.t;
    }
  }

  // 4) the build adapts to the enemy comp: say it once per item
  const pr = A.items.priority;
  if (pr && pr.kind === 'adapted' && A.t > 150) Voice.say(`Build change: ${pr.name} next${pr.because ? `, ${pr.because.replace(/\s*\([^)]*\)/g, '')}` : ''}.`, { key: `build-${vg.id}-${pr.name}`, repeatAfter: 99999 });

  // 5) power spikes: an item just finished
  const spike = A.triggers.find((t) => /_items?_done$/.test(t.id));
  if (spike && spike.detail && A.legendaries <= 3) Voice.say(`${spike.detail} done. ${speakable(arr(spike.advice)[0], 150)}`, { key: `spike-${vg.id}-${spike.detail}`, repeatAfter: 99999 });
}

// Dragon Soul point / Elder: an alert tone and one line, 90 s before and at the spawn (also while you're dead:
// plan where to respawn). Retried every tick until it plays, keyed so it plays once.
function alertVoice(A) {
  for (const x of A.alerts || []) if (!Voice.wasSaid(x.key)) { Voice.announce([x.voice], { key: x.key, alert: true, repeatAfter: 99999 }); break; }
}
function alertBanner(A) {
  return (A.alerts || []).map((x) => `<div class="alert-banner ${x.level}" role="alert"><div class="ab-icon" aria-hidden="true">${x.id === 'elder' ? '🜂' : '◆'}</div>
    <div class="grow"><div class="ab-title">${esc(x.title)}</div><div class="small">${esc(x.detail)}</div></div>
    ${x.drakes ? `<div class="ab-drakes" title="Drakes taken (you – them)"><span class="small muted">Drakes</span><b class="num">${x.drakes.ours}–${x.drakes.theirs}</b></div>` : ''}</div>`).join('');
}

// generate this game's most likely lines up front so they play without delay (Groq voices only)
function prefetchLines(A) {
  const { opp } = A.P, jt = A.jungler;
  const key = `${opp ? opp.cid : ''}|${jt ? jt.cid : ''}|${A.P.me.name}`;
  if (!Voice.ready || S.prefetchedFor === key) return;
  S.prefetchedFor = key;
  const lines = [];
  if (jt) lines.push(`${jt.name} showed bot side.`, `${jt.name} is dead.`, `Careful. ${jt.name} showed top side.`);
  lines.push('Dragon in one minute.', 'Voidgrubs in one minute.', 'Baron in one minute.', 'Elder Dragon in one minute.');
  for (const c of A.items.nextCore.slice(0, 2)) lines.push(`You can finish ${String(c.name).toLowerCase()}. Recall on the next crash.`);
  Voice.prefetch(lines);
}

// focus lines (a broken focus, CS check-ins, the final grade) wait up to 30s if another line is playing
function focusVoice(A) {
  const q = S.focusSay || (S.focusSay = []);
  for (const l of Focus.track(A, D)) q.push({ ...l, until: Date.now() + 30000 });
  while (q.length && (Date.now() > q[0].until || Voice.wasSaid(q[0].key))) q.shift();
  if (q.length && Voice.say(q[0].text, { key: q[0].key, repeatAfter: 99999 })) q.shift();
}

function callouts(A) {
  prefetchLines(A);
  const { me } = A.P, jt = A.jungler, b = A.items.buyNow;
  if (me.isDead) { focusVoice(A); return; }
  const r = A.recall;
  // after laning only "you can finish an item" is worth a voice line; the chip still shows every recall window
  const recallVoice = r && r.voice && (A.t < 14 * 60 || /^you can finish/.test(r.reasons[0] || ''));
  if (recallVoice) Voice.say(r.voice, { key: r.voiceKey, repeatAfter: 99999 });
  else if (b && /^Finish /.test(b.text)) Voice.say(`You can ${b.text.toLowerCase()}. Recall on the next crash.`, { key: `finish-${b.text}`, repeatAfter: 1200 });
  focusVoice(A);
  if (jt && A.t < 14 * 60) {
    // at most one "showed bot side" per 2 minutes (one fight = several kills)
    if (jt.status === 'far' && jt.ago < 12 && !(S.jgFarAt && jt.last.t - S.jgFarAt < 120) && Voice.say(`${jt.name} showed ${jt.last.side === 'bot' ? 'bot side' : 'mid'}.`, { key: `jgfar-${jt.last.t}`, repeatAfter: 9999 })) S.jgFarAt = jt.last.t;
    if (jt.status === 'dead') Voice.say(`${jt.name} is dead.`, { key: `jgdead-${jt.last ? jt.last.t : 0}`, repeatAfter: 9999 });
  }
}

// ---------- ignored warnings: losing health while the dashboard says Play safe / Back off ----------
// Riot's live data has no map positions, so walking forward can't be seen, but taking damage can. Losing 12% of
// your max health within 4 s on Back off or a "don't fight" guard (20% on Play safe, where some poke is normal),
// starting 2 s after the warning went up, is a trade you were told not to take: alert tone, "Back. Now.", and
// the whole window flashes red for 6 s. At most once per 20 s.
const isWarning = (A) => { const m = S.modeState.cur; return !A.P.me.isDead && (!!(m && (m.mode === 'retreat' || m.mode === 'safe')) || !!(A.guard && A.guard.strict)); };
function setWash(warn, alarm) {
  document.body.classList.toggle('wash-warn', !!warn && !alarm);
  document.body.classList.toggle('wash-alarm', !!alarm);
  const title = alarm ? '⛔ BACK NOW · Jax Coach' : 'Jax Coach';
  if (document.title !== title) document.title = title;
}
function warnWatch(A) {
  if (!S.warn || A.t < S.warn.lastT - 5) S.warn = { hp: [], since: null, alarmUntil: 0, lastAt: -1e9, ignored: 0 };
  const W = S.warn, st = (A.P.activePlayer || {}).championStats || {};
  W.lastT = A.t;
  const warn = isWarning(A);
  if (!warn) { W.since = null; W.hp = []; }
  else {
    if (W.since == null) W.since = A.t;
    if (st.maxHealth) W.hp.push({ t: A.t, hp: st.currentHealth / st.maxHealth });
    W.hp = W.hp.filter((x) => A.t - x.t <= 4 && x.t >= W.since + 2);
    const peak = Math.max(...W.hp.map((x) => x.hp)), now = W.hp.length ? W.hp[W.hp.length - 1].hp : 1;
    const m = S.modeState.cur, hard = (m && m.mode === 'retreat') || !!(A.guard && A.guard.strict);
    if (W.hp.length >= 2 && peak - now >= (hard ? 0.12 : 0.2) && A.t - W.lastAt >= 20) {
      W.lastAt = A.t; W.ignored++; W.alarmUntil = Date.now() + 6000; W.hp = [];
      if (A.t < 20 * 60) Voice.announce(['Back. Now.'], { key: `ignored-${Math.round(A.t)}`, alert: true });
    }
  }
  // Back off and the farm-only lock tint the whole window; an ignored warning flashes it
  const m = S.modeState.cur;
  setWash(warn && ((m && m.mode === 'retreat') || (A.guard && A.guard.kind === 'lock')), Date.now() < W.alarmUntil);
}

// ---------- death budget: as many deaths as your own wins have ----------
// 1 death before 14:00 (with 2+ early deaths your top games are 44% wins, with none 63%), then one more at 14:00
// and one more per the death pace of your archived top-lane wins after 14:00 (default every 7:30).
function deathBudget() {
  if (S.budgetCfg && Date.now() - S.budgetCfg.at < (S.budgetCfg.n >= 15 ? 3600e3 : 60e3)) return S.budgetCfg;   // retry while the archive loads
  let early = 1, every = 450, n = 0;
  if (!Archive.state.loaded && !S.budgetArchiveTried) { S.budgetArchiveTried = true; Archive.load().catch(() => {}); }
  try {
    const W = Archive.rows().filter((r) => r.role === 'TOP' && r.win && !r.remake && r.detail && r.detail.deaths && r.dur > 1200);
    n = W.length;
    if (n >= 15) {
      const late = W.reduce((s, r) => s + r.detail.deaths.filter((d) => d.t >= 840).length, 0), mins = W.reduce((s, r) => s + (r.dur - 840) / 60, 0);
      if (late) every = Math.min(900, Math.max(240, Math.round((60 * mins) / late / 30) * 30));
    }
  } catch {}
  return (S.budgetCfg = { early, every, n, at: Date.now() });
}
const budgetAt = (B, t) => (t < 840 ? B.early : B.early + 1 + Math.floor((t - 840) / B.every));
const budgetClear = (B, n) => (n <= B.early ? 0 : 840 + (n - B.early - 1) * B.every);   // first moment n deaths fit
function budgetState(A) {
  const B = deathBudget(), d = A.P.me.scores.deaths || 0, allowed = budgetAt(B, A.t);
  const next = budgetClear(B, d + 1);          // until then, the next death breaks the budget
  const level = d > allowed ? 'over' : next > A.t ? 'limit' : 'ok';
  const before = `minute ${Math.ceil(next / 60)}`, far = next - A.t > 600;
  return { B, d, allowed, next, level,
    sub: level === 'ok' ? `${allowed - d} to spare` : level === 'over' && far ? 'No more deaths this game' : `No death before ${Engine.fmtClock(next)}`,
    line: level === 'ok' ? "You're back. Still inside your death budget." : level === 'over' ? `You're back, over your death budget. ${far ? 'Play the rest of this game without dying.' : `Don't die again before ${before}.`}` : `You're back. Don't die again before ${before}.` };
}
function budgetChip(A) {
  const b = budgetState(A), B = b.B;
  const src = B.n >= 15 ? `After 14:00 from the pace of your ${B.n} top-lane wins` : 'Default';
  return `<div class="budget b-${b.level}" title="${esc(`${src}: ${B.early} death${B.early > 1 ? 's' : ''} before 14:00, one more at 14:00, then one more every ${Engine.fmtClock(B.every)}.`)}">
    <div class="small muted">Death budget</div><b class="num">${b.d} / ${b.allowed}</b><div class="small">${esc(b.sub)}</div></div>`;
}

// ---------- respawn: the death budget only when it's news (and the farm-only lock) ----------
// Silent while you're inside the budget. "Don't die before minute X" once per new X, and only before 20:00.
// Going over the budget is said once per game: after that you know, and every respawn reminder is noise.
function respawnVoice(A) {
  const me = A.P.me;
  if (!S.resp || A.t < S.resp.lastT - 5) S.resp = { dead: me.isDead };
  const R = S.resp;
  R.lastT = A.t;
  if (R.dead && !me.isDead && A.t > 60) {
    const b = budgetState(A), lines = [];
    if (b.level === 'over' && !R.saidOver) { lines.push(b.line); R.saidOver = true; }
    else if (b.level === 'limit' && A.t < 20 * 60 && R.saidLimit !== b.next) { lines.push(b.line); R.saidLimit = b.next; }
    if (A.guard && A.guard.kind === 'lock') lines.push(`${A.guard.headline}.`);
    if (lines.length) R.say = { lines, key: `respawn-${me.scores.deaths}-${Math.round(A.t)}`, until: A.t + 20 };
  }
  R.dead = me.isDead;
  if (R.say && A.t < R.say.until && Voice.announce(R.say.lines, { key: R.say.key })) R.say = null;
}

// ---------- a new plan is read out once; a check that changed nothing stays quiet ----------
function planVoice(A) {
  const p = D.plan;
  if (!p || !p.jobId || p.changed === false || p.kind === 'chat' || Date.now() - p.at > 60000) return;
  if (A.t >= 20 * 60 && S.planSaidT != null && A.t - S.planSaidT < 240 && A.t >= S.planSaidT) return;
  if (Voice.say(`${p.kind === 'adapt' ? 'New plan' : 'Game plan'}: ${speakable(p.headline, 140)}`, { key: `plan-${p.jobId}`, repeatAfter: 99999 })) S.planSaidT = A.t;
}

// the coach's answer to your question: the one-line "do this now" is read out once (bullets stay on screen)
function askVoice() {
  const m = Agent.lastAnswer();
  if (!m || m.spoken || Date.now() - m.at > 60000) return;
  if (Voice.announce([speakable(m.text, 220)], { key: `ask-${m.jobId}`, repeatAfter: 99999, answer: true })) m.spoken = true;
}

// ---------- record live games (what the dashboard said) for the Review tab ----------
function record(A) {
  const me = A.P.me;
  if (!S.rec || A.t < S.rec.lastT - 5) S.rec = { startedAt: Date.now(), champ: me.cid, riotId: me.riotId, deaths: [], modeTime: {}, lastT: A.t, saved: false };
  const r = S.rec, cur = S.modeState.cur ? S.modeState.cur.mode : null;
  if (r.lastMode) r.modeTime[r.lastMode] = Math.round((r.modeTime[r.lastMode] || 0) + Math.max(0, Math.min(6, A.t - r.lastT)));
  if (me.isDead && !r.wasDead) {
    const ev = A.events.filter((e) => e.EventName === 'ChampionKill' && Engine.nameIs(me, e.VictimName)).pop();
    r.deaths.push({ t: ev ? ev.EventTime : A.t, mode: r.lastAliveMode || null, warned: !!r.lastAliveWarn, jungler: r.lastJg || null });
  }
  if (!me.isDead && cur && cur !== 'dead') { r.lastAliveMode = cur; r.lastAliveWarn = isWarning(A); r.lastJg = A.jungler ? A.jungler.status : null; }
  r.ignored = S.warn ? S.warn.ignored : 0;
  const b = budgetState(A); r.budget = { deaths: b.d, allowed: b.allowed };
  r.wasDead = me.isDead; r.lastMode = cur; r.lastT = A.t; r.gameTime = A.t;
  if (A.P.opp) r.opp = A.P.opp.cid;
  r.focus = Focus.result(A);
  r.plans = Agent.gameLog();
  r.chat = Agent.chatLog();
  const end = A.events.find((e) => e.EventName === 'GameEnd');
  if (end) finishRecording(end.Result || null);
}
function finishRecording(result) {
  const r = S.rec;
  if (!r || r.saved || (r.gameTime || 0) < 300) return;
  r.saved = true;
  // the live API can come back for a moment on the end screen and start a second record of the same game
  const L = S.lastSaved;
  if (L && L.champ === r.champ && L.opp === r.opp && Math.abs(L.gameTime - r.gameTime) < 120 && Date.now() - L.at < 15 * 60000) return;
  S.lastSaved = { champ: r.champ, opp: r.opp, gameTime: r.gameTime, at: Date.now() };
  const body = { v: 1, endedAt: Date.now(), champ: r.champ, riotId: r.riotId, opp: r.opp, result, gameTime: Math.round(r.gameTime), deaths: r.deaths, modeTime: r.modeTime, focus: r.focus || null, plans: r.plans || [], chat: r.chat || null, ignored: r.ignored || 0, budget: r.budget || null };
  S.lastFocus = r.focus || null;
  if (result === 'Win' || result === 'Lose') S.todayPending = [...(S.todayPending || []), { end: Date.now(), win: result === 'Win', champ: r.champ, opp: r.opp }];
  fetch('/api/history', { method: 'POST', body: JSON.stringify(body) }).then(() => Focus.loadHistory()).catch(() => {});
  // build the game report as soon as Riot publishes the match, and show it if the Live page is idle
  if (D.config.hasKey && Review.state.me) {
    Report.state.listTried = true;
    Report.waitForNew(D, body.endedAt).then((id) => {
      // the review agent reads the finished report, so it starts once Riot has published the match
      Agent.startReview(D, body, id && Report.state.R && Report.state.R.id === id ? Report.state.R : null);
      if (id && S.view === 'live' && !S.game) setView('report');
    });
  } else Agent.startReview(D, body, null);
  S.reviewStale = true;
}

function scoutPlayers() {
  if (!D.config.hasKey || !S.A) return;
  const { opp, enemies } = S.A.P;
  const key = (p) => (D.dd.champs[p.cid] || {}).key;
  if (opp) Scout.request(opp, key(opp), { deep: true, isOpponent: true, priority: true });
  for (const p of enemies) if (p !== opp) Scout.request(p, key(p));
}
let renderQueued = false;
Scout.onUpdate(() => {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; if (S.view === 'live') renderLive(); }, 150);
});

// "af_nicole:70+bf_isabella:30" -> [{ id: 'af_nicole', w: 70 }, { id: 'bf_isabella', w: 30 }] (heaviest first)
function parseMix(spec) {
  const parts = String(spec || 'af_heart').split('+').map((p) => { const [id, w] = p.split(':'); return { id: id.trim(), w: w ? +w : 100 }; }).filter((p) => p.id);
  return (parts.length ? parts : [{ id: 'af_heart', w: 100 }]).sort((a, b) => b.w - a.w);
}

const CLIENT_PHASE = {
  None: ['ok', 'Client open'], Lobby: ['ok', 'Lobby'], Matchmaking: ['warn', 'In queue'], ReadyCheck: ['warn', 'Match found!'],
  ChampSelect: ['live', 'Champ select'], GameStart: ['live', 'Loading…'], InProgress: ['live', 'In game'], Reconnect: ['warn', 'Reconnect'],
  WaitingForStats: ['ok', 'Post-game'], PreEndOfGame: ['ok', 'Post-game'], EndOfGame: ['ok', 'Post-game'], WatchInProgress: ['ok', 'Watching replay'],
};
// import new games (the first time: your whole history) at most every 30 minutes, and only while idle
function archiveCheck() {
  const A = Archive.state;
  if (S.demo || S.game || !D.config.hasKey || !Review.state.me || Archive.running) return;
  if (Date.now() - (A.lastAttempt || 0) < 30 * 60000) return;
  if (Review.state.status === 'done') Archive.sync(D); else if (Review.state.status !== 'loading') Review.load(D);
}

// ---------- today's games in the top bar: wins and losses in order, the game you're in, the score ----------
// A "day" starts at 5:00 so a late session stays one day. Games come from the match archive; a game that just
// ended shows from the live result until Riot publishes it.
function dayStart() { const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1); d.setHours(5, 0, 0, 0); return d.getTime(); }
function renderToday() {
  const el = $('#today');
  if (!el) return;
  const from = dayStart();
  let rows = [];
  try { rows = Archive.rows().filter((r) => r.end >= from); } catch {}
  const games = rows.map((r) => ({ end: r.end, win: r.win, remake: r.remake, champ: r.champ, opp: r.opp, kda: `${r.k}/${r.d}/${r.a}` }));
  // live results Riot hasn't published yet
  S.todayPending = (S.todayPending || []).filter((p) => p.end >= from && !games.some((g) => Math.abs(g.end - p.end) < 15 * 60000));
  games.push(...S.todayPending);
  games.sort((a, b) => a.end - b.end);
  const played = games.filter((g) => !g.remake), w = played.filter((g) => g.win).length, l = played.length - w;
  const now = S.A && !S.demo ? S.A.champ : null;
  if (!games.length && !now) { el.hidden = true; el.innerHTML = ''; S.todayHtml = ''; return; }
  const MAX = 10, shown = games.slice(-MAX).reverse();   // newest first
  const tip = (g) => `${new Date(g.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${champName(g.champ)}${g.opp ? ` vs ${champName(g.opp)}` : ''} · ${g.remake ? 'Remake' : g.win ? 'Win' : 'Loss'}${g.kda ? ` · ${g.kda}` : ''}`;
  const tile = (g) => `<span class="tg ${g.remake ? 'tg-r' : g.win ? 'tg-w' : 'tg-l'}" title="${esc(tip(g))}">${champImg(g.champ, 'sm')}<i>${g.remake ? '–' : g.win ? 'W' : 'L'}</i></span>`;
  // current streak, only when it's worth saying
  let streak = 0; for (let i = played.length - 1; i >= 0 && played[i].win === played[played.length - 1].win; i--) streak++;
  const streakTxt = streak >= 3 ? `<span class="t-streak ${played[played.length - 1].win ? 'good-t' : 'warn-t'}">${streak} ${played[played.length - 1].win ? 'wins' : 'losses'} in a row</span>` : '';
  const html = `<div class="t-score" title="Today (since 5:00): ${w} win${w === 1 ? '' : 's'}, ${l} loss${l === 1 ? '' : 'es'}${played.length ? `, ${Math.round((100 * w) / played.length)}%` : ''}">
      <span class="small muted">Today</span><b class="good-t num">${w}</b><span class="faint">–</span><b class="warn-t num">${l}</b></div>
    <div class="t-games">${now ? `<span class="tg tg-now" title="In game now">${champImg(now, 'sm')}<i>●</i></span>` : ''}${shown.map(tile).join('')}${games.length > MAX ? `<span class="t-more small muted" title="${games.length - MAX} earlier games today">+${games.length - MAX}</span>` : ''}</div>${streakTxt}`;
  if (html !== S.todayHtml) { el.innerHTML = html; S.todayHtml = html; }
  el.hidden = false;
}

// ---------- updates: the latest main branch on GitHub, installed by app\update.ps1 ----------
// Checked in the background at most every 6 hours (never in a game); Settings has the buttons, the top bar a pill.
const shortSha = (s) => (s ? String(s).slice(0, 7) : '?');
async function loadUpdateInfo() {
  try { const r = await getJSON('/api/update'); S.update = { ...(S.update || {}), current: r.current }; } catch {}
  renderUpdate();
}
async function checkUpdate() {
  if (S.update && (S.update.checking || S.update.applying)) return;
  S.update = { ...(S.update || {}), checking: true, status: null }; renderUpdate();
  let r; try { r = await getJSON('/api/update/check'); } catch (e) { r = { error: e.message }; }
  S.update = { ...S.update, ...r, current: r.current || S.update.current, checking: false, at: Date.now() };
  try { localStorage.setItem('jc.updateCheck', String(Date.now())); } catch {}
  renderUpdate(); renderStatus();
}
function autoCheckUpdate() {
  let last = 0; try { last = +localStorage.getItem('jc.updateCheck') || 0; } catch {}
  if (!S.game && !['ChampSelect', 'InProgress', 'GameStart'].includes(S.clientPhase) && Date.now() - last > 6 * 3600e3) checkUpdate();
}
async function applyUpdate() {
  if (S.game && !S.demo) { alert("You're in a game. Update after it."); return; }
  if (!confirm('Update now? Jax Coach closes, installs the new version and starts again (about a minute). Your settings, history and playbooks stay.')) return;
  try { await fetch('/api/update/apply', { method: 'POST', body: '' }); } catch {}
  S.update = { ...S.update, applying: true, status: { state: 'starting', message: 'Starting the update…' } };
  renderUpdate(); renderStatus();
  let wentDown = false;
  const tick = async () => {
    try {
      S.update.status = await getJSON('/api/update/status');
      if (wentDown) { location.reload(); return; }            // Jax Coach is back: load the new version
    } catch { wentDown = true; S.update.status = { state: 'installing', message: 'Installing… this page reloads when Jax Coach is back.' }; }
    if (['failed', 'current'].includes(S.update.status.state)) S.update.applying = false;
    renderUpdate(); renderStatus();
    if (S.update.applying) setTimeout(tick, 2000);
  };
  setTimeout(tick, 1500);
}
function renderUpdate() {
  const el = $('#updates');
  if (!el) return;
  const u = S.update || {}, c = u.current, st = u.status || {};
  const ver = c ? `Version ${esc(c.version)} · ${shortSha(c.commit)}${c.dirty ? ' + local changes' : ''}` : 'Development copy: update it with git pull';
  const note = u.applying ? `<div class="small"><span class="spin"></span> ${esc(st.message || 'Updating…')}</div>`
    : st.state === 'failed' ? `<div class="small warn-t">Update failed: ${esc(st.message)}</div>`
    : st.state === 'current' ? `<div class="small muted">${esc(st.message)}</div>`
    : u.checking ? '<div class="small muted">Asking GitHub…</div>'
    : u.error ? `<div class="small warn-t">${esc(u.error)}</div>`
    : u.available ? `<div class="small">A new version is on GitHub (${shortSha(u.latest)}).</div>`
    : u.at ? `<div class="small good-t">You're up to date.</div>` : '';
  el.innerHTML = `<div class="row"><span class="small muted grow">${ver}</span>
    <button type="button" class="btn small ghost" data-upd="check" ${u.checking || u.applying || !c ? 'disabled' : ''}>Check for updates</button>
    ${u.available && !u.applying ? '<button type="button" class="btn small" data-upd="apply">Update now</button>' : ''}</div>${note}`;
}

function renderStatus() {
  renderToday();
  const pill = (state, label, title) => `<span class="pill ${state}" title="${esc(title)}"><i></i>${esc(label)}</span>`;
  const out = [];
  const U = S.update || {};
  if (U.applying) out.push(`<button class="pill warn upd-pill" data-action="update-open" title="${esc((U.status || {}).message || '')}"><i></i>Updating…</button>`);
  else if (U.available) out.push(`<button class="pill ok upd-pill" data-action="update-open" title="A new version of Jax Coach is on GitHub. Click to update."><i></i>Update available</button>`);
  out.push(S.serverDown ? pill('err', 'App offline', 'The Jax Coach server is not reachable. Start it with "Start Jax Coach.bat".') : pill('ok', 'App', 'Local Jax Coach server is running'));
  if (!S.serverDown) {
    const cp = S.clientPhase ? CLIENT_PHASE[S.clientPhase] || ['ok', S.clientPhase] : null;
    out.push(cp ? pill(cp[0], cp[1], `League client connected (${S.clientPhase})`) : pill('off', 'Client closed', 'League client not detected. Champ select prep starts when it is open.'));
    if (S.demo) out.push(pill('demo', `Demo · ${S.A ? S.A.clock : ''}`, 'Demo game (not a real game)'));
    else if (S.game) out.push(pill('live', `Live · ${S.A.clock}`, 'Receiving live game data every 2 seconds'));
    const kp = Scout.keyProblem();
    const AR = Archive.state;
    if (Archive.running && AR.todo) out.push(pill(AR.pausedFor ? 'off' : 'live', `History ${AR.done}/${AR.todo}`, `Importing your match history into the local archive${AR.pausedFor ? ` (paused: ${AR.pausedFor})` : ''}`));
    out.push(!D.config.hasKey ? pill('off', 'No Riot key', 'Add RIOT_API_KEY=RGAPI-… to ~/.env.txt for rank/mastery scouting and Review')
      : kp === 'invalid_key' ? pill('err', 'Riot key expired', 'Development keys expire every 24h. Paste a new one into ~/.env.txt and restart.')
      : pill('ok', 'Riot API', `Scouting and Review active (key ${D.config.keyHint})`));
    const ast = Agent.state.status, nRun = Agent.state.jobs.filter((j) => j.status === 'running').length;
    out.push(!ast ? '' : !ast.installed ? pill('off', 'AI off', 'Claude Code is not installed: research agents are off (see the Playbook tab)')
      : !ast.loggedIn ? pill('warn', 'AI: sign in', 'Claude Code needs you to sign in (Playbook tab)')
        : pill(nRun ? 'live' : 'ok', nRun ? `AI · ${nRun} running` : 'AI', nRun ? Agent.state.jobs.filter((j) => j.status === 'running').map((j) => j.title).join(' · ') : 'Research agents ready'));
    const eng = Voice.engine(), vc = Voice.config();
    const vName = eng === 'kokoro' ? `${parseMix(vc.kokoroVoice).map((p) => ((Voice.kokoroVoices.find((v) => v.id === p.id) || {}).name || p.id).replace(/ \(.*/, '')).join(' + ')} (local)`
      : eng === 'groq' ? (Voice.groqVoices.find((v) => v.id === vc.groqVoice) || {}).name || 'Groq' : 'system voice';
    out.push(!Voice.enabled ? pill('off', 'Voice off', 'Turn voice on with the button in the banner or on the start page')
      : !Voice.ready ? pill('warn', 'Voice: click page', 'Your browser needs one click on this page before it may play sound')
      : pill('ok', `Voice · ${vName}`, Voice.lastError() ? `Last Groq error: ${Voice.lastError()}` : 'Voice callouts active'));
  }
  $('#status').innerHTML = out.join('');
}

// ---------- LIVE ----------
// the live view is rebuilt on every poll: the coach box keeps its text (S.askDraft), focus and cursor
function renderLive() {
  const inp = document.getElementById('askInput');
  const had = inp && document.activeElement === inp ? { s: inp.selectionStart, e: inp.selectionEnd } : null;
  renderLiveView();
  const n = document.getElementById('askInput');
  if (n && had) { n.focus(); try { n.setSelectionRange(had.s, had.e); } catch {} }
}
function renderLiveView() {
  const el = $('#view-live');
  if (!S.A) { el.innerHTML = S.cs ? champSelectHtml(S.cs) : waitingHtml(); return; }
  const A = S.A, { me, opp, enemies } = A.P;
  const mu = opp ? D.matchups[opp.cid] : null;
  const st = A.state;
  const stateTxt = st.label === 'ahead' ? (st.very ? 'Way ahead' : 'Ahead') : st.label === 'behind' ? (st.very ? 'Far behind' : 'Behind') : 'Even';
  const stateCls = st.label === 'ahead' ? 'good' : st.label === 'behind' ? 'warn' : 'info';

  const gamebar = `
    <div class="gamebar">
      <div class="clock">${A.clock}</div>
      <div class="sep"></div>
      <div><div class="small muted">Phase</div><b>${esc(A.phaseLabel)}</b></div>
      <div class="sep"></div>
      <div><span class="chip big ${stateCls}">${stateTxt}</span><div class="state-reasons">${esc(st.reasons.join(' · '))}</div></div>
      <div class="sep"></div>
      ${budgetChip(A)}
      <div class="sep"></div>
      <div><div class="small muted">Gold</div><b class="num" style="color:var(--gold)">${A.items.gold}g</b>${A.recall ? `<div class="recall-chip ${A.recall.level}" title="${esc([...A.recall.reasons, A.recall.hold].filter(Boolean).join(' · '))}">${A.recall.level === 'now' ? '↩ Back now' : '↩ Back soon'}</div>` : ''}</div>
      ${buildNextHtml(A)}
      <div class="opp-pick" title="Your lane opponent (click to change)">
        <span class="small muted">Lane opponent</span>
        ${enemies.map((p) => `<button data-opp="${esc(p.cid)}" class="${p === opp ? 'on' : ''}">${champImg(p.cid, 'sm')}</button>`).join('')}
      </div>
    </div>`;
  el.innerHTML = `${alertBanner(A)}${modeBanner(A)}${whyPanel(A)}${gamebar}${playbookNotice(me.cid)}
    <div class="grid live-grid">
      <div class="col">${planCard(A)}${nowCard(A)}${matchupPhaseCard(A, mu)}${phasePlanCard(A)}</div>
      <div class="col">${opponentCard(A, mu)}${buildCard(A, mu)}</div>
      <div class="col">${lanesCard(A)}${enemyTeamCard(A)}</div>
    </div>`;
}

function buildNextHtml(A) {
  const me = A.P.me;
  // first moments of the game: what to buy in the fountain
  if (A.t < 90 && !arr(me.items).length) {
    const L = loadoutFor(A.P.opp ? A.P.opp.cid : null, A.P.enemies.map((p) => p.cid));
    return `<div class="sep"></div><div class="buildnext" title="${esc(L.startWhy)}">
      ${L.start.map((i) => (D.dd.itemByName[i.name.toLowerCase()] ? itemImg(D.dd.itemByName[i.name.toLowerCase()], 'md') : '')).join('')}
      <div class="bn-text"><div class="small muted">Buy now · start</div><b>${esc(L.start.map((i) => (i.count > 1 ? `${i.count}× ` : '') + i.name).join(' + '))}</b><div class="bn-why">${esc(L.startWhy)} · first item ${esc(L.first.name)}</div></div></div>`;
  }
  const p = A.items.priority;
  if (!p) return '';
  const label = { core: 'Build next', boots: 'Build next · boots', adapted: 'Build next · adapted', plan: 'Build next · game plan', started: 'Build next · finish it' }[p.kind] || 'Build next';
  return `<div class="sep"></div>
    <div class="buildnext ${p.kind === 'adapted' || p.kind === 'plan' ? 'adapted' : ''}" title="${esc(p.reason)}">
      ${p.id ? itemImg(p.id, 'md') : ''}
      <div class="bn-text"><div class="small muted">${label}</div><b>${esc(p.name)}</b><div class="bn-why">${esc(p.reason)}${p.then ? ` · then ${esc(p.then)}` : ''}</div></div>
    </div>`;
}

function voiceBtn() {
  if (!Voice.supported) return '';
  const st = !Voice.enabled ? 'off' : Voice.ready ? 'on' : 'locked';
  const label = { off: 'Voice off', on: 'Voice on', locked: 'Click to enable voice' }[st];
  return `<button class="voice-btn v-${st}" data-action="voice" data-state="${st}" title="Spoken callouts only when the recommended play changes or for things you can't see at a glance">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>${st === 'off' ? '<path d="m17 9 5 6M22 9l-5 6"/>' : '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'}</svg>${label}</button>`;
}

function modeBanner(A) {
  const m = S.modeState.cur || A.mode;
  const meta = MODE_META[m.mode] || MODE_META.trade;
  const fresh = Date.now() - (S.modeState.changedAt || 0) < 2200;
  const jt = A.jungler;
  const jg = jt ? `<div class="jg jg-${jt.status}">${champImg(jt.cid, 'sm')}<div><div class="small muted">Enemy jungler · lvl ${jt.level}</div><div class="jg-text">${esc(jt.text)}</div></div></div>` : '';
  return `<div class="mode-banner ${fresh ? 'fresh' : ''}" role="status">
      <div class="mode-icon" aria-hidden="true">${meta.icon}</div>
      <div class="mode-main"><div class="mode-name">${esc(meta.name)}</div><div class="mode-head">${esc(m.headline)}</div>${m.reason ? `<div class="mode-reason">${esc(m.reason)}</div>` : ''}${stanceHtml(A, m)}</div>
      ${jg}
      <div class="mode-side">${voiceBtn()}<button class="why-btn ${S.showWhy ? 'on' : ''}" data-action="why" title="Show which rule decided this and why">Why?</button></div>
    </div>`;
}

// v2: how to play the decision: where to stand, what to farm, how to trade, one do / don't, and up to two hints
const STANCE_TXT = {
  position: { forward: 'Stand forward', wave: 'Stand with your wave', tower: 'Stay at your tower', behind_tower: 'Stand behind your tower', off_lane: 'Leave the lane', group: 'Stay with your team', side: 'Side lane' },
  farm: { all: 'Farm everything', safe: 'Only safe minions', cannons: 'Cannons only', none: 'Give up the wave' },
  trade: { allin: 'All-in', short: 'Short trades', none: 'No trades' },
};
function stanceHtml(A, m) {
  const lane = A.t < 14 * 60 || m.stanceSet;
  const chip = (k) => (m[k] && STANCE_TXT[k][m[k]] ? `<span class="stance-chip st-${esc(k)}-${esc(m[k])}">${esc(STANCE_TXT[k][m[k]])}</span>` : '');
  const chips = lane && !['dead', 'group'].includes(m.mode) ? ['position', 'farm', 'trade'].map(chip).join('') : '';
  const lines = [...arr(m.do).slice(0, 1).map((s) => `<div class="stance-do">${esc(s)}</div>`), ...arr(m.dont).slice(0, 1).map((s) => `<div class="stance-dont">${esc(s)}</div>`)].join('');
  const hints = arr(m.hints).map((h) => `<div class="stance-hint">${esc(h.text)}</div>`).join('');
  return chips || lines || hints ? `<div class="stance">${chips ? `<div class="stance-chips">${chips}</div>` : ''}${lines}${hints}</div>` : '';
}

// ---------- loadout: runes, spells, start, first buys for a given opponent (matchup data first, then comp) ----------
const firstOption = (text) => String(text || '').split(/\s+or\s+|;|\. /i)[0].replace(/\([^)]*\)/g, '').replace(/[\s,.;:]+$/, '').trim();
function parseItemList(text) {
  return firstOption(text).split(/\s*\+\s*/).map((s) => {
    const m = s.trim().match(/^(\d+)\s*x?\s*(.+)$/i);
    return { name: (m ? m[2] : s).trim(), count: m ? +m[1] : 1 };
  }).filter((i) => D.dd.itemByName[i.name.toLowerCase()]);
}
const isRanged = (cid) => ((D.dd.champs[cid] || {}).range || 0) > 300;
function earliestMention(text, names) {
  const t = String(text || '').toLowerCase();
  return names.map((n) => ({ n, i: t.indexOf(String(n).toLowerCase()) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.n)[0] || null;
}
function loadoutFor(oppCid, enemyCids) {
  const meta = D.meta || {}, cb = meta.coreBuild || {};
  const mu = oppCid ? D.matchups[oppCid] : null;
  const plan = Engine.planForComp(D, enemyCids, oppCid);
  const oppName = oppCid ? champName(oppCid) : null;

  // starting items
  let start = mu && mu.start ? parseItemList(mu.start) : [];
  let startWhy = mu && mu.start ? `vs ${oppName}: ${mu.start}` : '';
  if (!start.length) {
    const pick = arr(meta.startingItems)[oppCid && isRanged(oppCid) ? 1 : 0] || { items: ["Doran's Blade", 'Health Potion'], when: '' };
    start = pick.items.map((n) => ({ name: n, count: 1 }));
    startWhy = pick.when;
  }
  if (!start.some((i) => /potion/i.test(i.name))) start.push({ name: 'Health Potion', count: 1 });

  // rune page: the keystone the matchup mentions first, else vs-ranged / standard. A page made for ranged lanes
  // only fits a ranged opponent: vs a melee one it's used just for its keystone, named after the matchup.
  const pages = arr(meta.runes);
  const ranged = !!(oppCid && isRanged(oppCid));
  const forRanged = (p) => /ranged/i.test(`${p.id || ''} ${p.name || ''}`);
  const ks = earliestMention(mu && mu.runes, pages.map((p) => (p.primary || {}).keystone).filter(Boolean));
  let page = null;
  if (ks) {
    const withKs = pages.filter((p) => (p.primary || {}).keystone === ks);
    page = withKs.find((p) => forRanged(p) === ranged) || withKs[0];
    if (page && forRanged(page) && !ranged) page = { ...page, name: `${ks} (vs ${oppName})`, when: '' };
  }
  if (!page) page = (ranged && pages.find(forRanged)) || pages.find((p) => !forRanged(p)) || pages[0];

  // summoner spells
  let spells = mu && mu.summoners ? firstOption(mu.summoners).split(/\s*\+\s*/).map((s) => s.trim()).filter(Boolean) : [];
  if (spells.length < 2) spells = (arr(meta.summoners)[0] || {}).spells || ['Flash', 'Ignite'];

  // first item: what the matchup's build notes name first, else vs tanks -> Ruined King, else the default
  const firstOpts = arr(cb.firstItemOptions);
  let firstName = earliestMention(mu && mu.buildNotes, firstOpts.map((o) => o.item));
  if (!firstName && plan.tags.has('vs_tanks')) firstName = (firstOpts.find((o) => /ruined king/i.test(o.item)) || {}).item;
  if (!firstName) firstName = (firstOpts[0] || {}).item || arr(cb.typicalOrder)[0];
  const firstOpt = firstOpts.find((o) => o.item === firstName) || {};
  const bootNames = arr(cb.boots).map((b) => b.item);
  const bootsName = earliestMention(mu && mu.buildNotes, bootNames) || (plan.items.boots && plan.items.boots.name) || bootNames[0];
  const bootsWhy = earliestMention(mu && mu.buildNotes, bootNames) ? `vs ${oppName} (matchup notes)` : (plan.items.boots ? plan.items.boots.why : '');

  return {
    mu, plan, page, pageNote: mu && mu.runes, spells, spellNote: mu && mu.summoners, start, startWhy,
    firstBack: arr(cb.firstBackBuys), first: { name: firstName, why: firstOpt.when || '' },
    boots: { name: bootsName, why: bootsWhy }, skillNotes: mu && mu.skillNotes,
    situational: plan.items.situational.filter((s) => s.matched.some((t) => t.startsWith('vs_'))).slice(0, 4),
  };
}
// ---------- loadout -> League client: rune page, summoner spells, item set (champ select, on your click) ----------
const SPELL_ID = { Flash: 4, Ignite: 14, Teleport: 12, Exhaust: 3, Ghost: 6, Heal: 7, Barrier: 21, Cleanse: 1, Smite: 11 };
// stat shards per row (offense, flex, defense)
const SHARD_ID = [
  { adaptiveforce: 5008, attackspeed: 5005, abilityhaste: 5007 },
  { adaptiveforce: 5008, movespeed: 5010, movementspeed: 5010, healthscaling: 5001, scalinghealth: 5001 },
  { health: 5011, bonushealth: 5011, flathealth: 5011, tenacityandslowresist: 5013, tenacity: 5013, healthscaling: 5001, scalinghealth: 5001 },
];
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
async function clientRunePage(p) {
  if (!D.dd.runes) D.dd.runes = await getJSON('/api/dd/runesReforged');
  const trees = arr(D.dd.runes);
  const tree = (n) => trees.find((t) => normName(t.name) === normName(n) || normName(t.key) === normName(n));
  const perk = (t, n) => { for (const sl of arr(t && t.slots)) for (const r of arr(sl.runes)) if (normName(r.name) === normName(n) || normName(r.key) === normName(n)) return r.id; return null; };
  const pri = p.primary || {}, sec = p.secondary || {};
  const pt = tree(pri.tree), st = tree(sec.tree), bad = [];
  if (!pt) bad.push(`tree "${pri.tree}"`);
  if (!st) bad.push(`tree "${sec.tree}"`);
  const want = [[pt, pri.keystone], ...arr(pri.runes).filter((n) => normName(n) !== normName(pri.keystone)).slice(0, 3).map((n) => [pt, n]), ...arr(sec.runes).slice(0, 2).map((n) => [st, n])];
  const ids = want.map(([t, n]) => { const id = t ? perk(t, n) : null; if (t && !id) bad.push(`"${n}"`); return id; });
  arr(p.shards).slice(0, 3).forEach((n, i) => { const id = SHARD_ID[i][normName(n)]; if (!id) bad.push(`shard "${n}"`); ids.push(id); });
  if (bad.length) throw new Error(`unknown rune names in the playbook: ${bad.join(', ')}`);
  if (ids.length !== 9) throw new Error('the playbook page is incomplete');
  return { primaryStyleId: pt.id, subStyleId: st.id, selectedPerkIds: ids };
}
// Flash stays on the key where you have it (remembered from earlier champ selects; F if never seen)
function clientSpells(names) {
  const ids = arr(names).map((n) => SPELL_ID[Object.keys(SPELL_ID).find((k) => normName(k) === normName(n))]).filter(Boolean);
  if (ids.length < 2 || ids[0] === ids[1]) throw new Error('the loadout has no two summoner spells');
  const mine = ((S.cs && S.cs.myTeam) || []).find((p) => p.cellId === S.cs.localPlayerCellId) || {};
  let slot = mine.spell1Id === 4 ? 1 : mine.spell2Id === 4 ? 2 : 0;
  try { if (slot) localStorage.setItem('jc.flashSlot', slot); else slot = +localStorage.getItem('jc.flashSlot') || 2; } catch { slot = slot || 2; }
  let [a, b] = ids;
  if (a === 4 || b === 4) { const other = a === 4 ? b : a; [a, b] = slot === 1 ? [4, other] : [other, 4]; }
  return { spell1Id: a, spell2Id: b };
}
function clientItemSet(L, champ) {
  const id = (n) => D.dd.itemByName[String(n || '').toLowerCase().trim()];
  const firstItem = (t) => String(t || '').split(/\s+-\s+|[(,;+:]|\bor\b|\bthen\b/i).map(id).find(Boolean);
  const block = (type, ids) => ({ type, items: [...new Set(ids.filter(Boolean))].map((x) => ({ id: x, count: 1 })) });
  const order = D.plan && D.plan.build && arr(D.plan.build.order).length ? D.plan.build.order : arr((D.meta.coreBuild || {}).typicalOrder);
  const start = { type: `Start${L.mu ? ` vs ${L.mu.name}` : ''}`, items: L.start.map((i) => ({ id: id(i.name), count: i.count || 1 })).filter((i) => i.id) };
  const blocks = [start,
    block('First back', arr(L.firstBack).map((b) => firstItem(typeof b === 'string' ? b : b.buy || b.item))),
    block(D.plan && D.plan.build ? 'Build for this game (game plan)' : 'Core build', order.map(id)),
    block('Boots', [id(L.boots.name)]),
    block('Situational for their comp', L.situational.map((s) => id(s.name)))].filter((b) => b.items.length);
  if (!blocks.length) throw new Error('no items to put in the set');
  return { associatedChampions: [+((D.dd.champs[champ] || {}).key || 0)].filter(Boolean), blocks };
}
async function applyLoadout() {
  const X = S.csLoadout;
  if (!X || S.loadoutBusy) return;
  S.loadoutBusy = true; renderLive();
  const body = {}, local = {};
  try { body.runes = await clientRunePage(X.L.page || {}); } catch (e) { local.runes = { ok: false, msg: e.message }; }
  try { body.spells = clientSpells(X.L.spells); } catch (e) { local.spells = { ok: false, msg: e.message }; }
  try { body.items = clientItemSet(X.L, X.champ); } catch (e) { local.items = { ok: false, msg: e.message }; }
  let res;
  try {
    const r = await fetch('/api/loadout/apply', { method: 'POST', body: JSON.stringify(body) });
    res = await r.json().catch(() => ({}));
    if (!r.ok) res = { error: res.error === 'client_not_running' ? 'The League client was not found.' : `Couldn't reach the client (${res.error || r.status}).` };
  } catch (e) { res = { error: `Couldn't reach Jax Coach (${e.message}).` }; }
  S.loadoutRes = { ...res, ...local, at: Date.now(), key: X.key };
  S.loadoutBusy = false; renderLive();
}
function loadoutApplyRow() {
  if (!S.cs || S.A || S.demo) return '';
  const R = S.loadoutRes && S.loadoutRes.key.split('|')[0] === String(S.cs.gameId) ? S.loadoutRes : null;
  const stale = R && S.csLoadout && R.key !== S.csLoadout.key;
  const parts = [['runes', 'Rune page'], ['spells', 'Spells'], ['items', 'Item set']].filter(([k]) => R && R[k]);
  const notes = parts.map(([k]) => R[k]).filter((x) => !x.ok || /replaced/.test(x.msg)).map((x) => x.msg);
  return `<div class="apply-row small">
      <button class="btn small" data-action="loadout-apply" ${S.loadoutBusy ? 'disabled' : ''} title="Sets this rune page (as 'Jax Coach'), the summoner spells and a 'Jax Coach' item set in the League client">${S.loadoutBusy ? 'Setting…' : R && !stale ? 'Apply again' : 'Apply to client'}</button>
      ${!R ? '<span class="faint">sets these runes, spells and items in the League client</span>'
        : R.error ? `<span class="warn-t">${esc(R.error)}</span>`
        : `${parts.map(([k, l]) => `<span class="${R[k].ok ? 'good-t' : 'warn-t'}" title="${esc(R[k].msg)}">${R[k].ok ? '✓' : '✗'} ${l}</span>`).join('')}<span class="faint">${stale ? 'the loadout changed since: apply again' : `${ago(R.at)} ago`}</span>`}
    </div>${notes.length ? `<div class="small muted">${notes.map(esc).join(' · ')}</div>` : ''}`;
}
const SPELL_IMG = { Flash: 'SummonerFlash', Ignite: 'SummonerDot', Teleport: 'SummonerTeleport', Exhaust: 'SummonerExhaust', Ghost: 'SummonerHaste', Heal: 'SummonerHeal', Barrier: 'SummonerBarrier', Cleanse: 'SummonerBoost', Smite: 'SummonerSmite' };
const spellChip = (s) => `<span class="item-chip">${SPELL_IMG[s] ? `<img class="ii" src="${DD()}/img/spell/${SPELL_IMG[s]}.png" alt="">` : ''}${esc(s)}</span>`;
const itemCountChip = (i) => `${itemChip(i.name)}${i.count > 1 ? `<span class="small muted">×${i.count}</span>` : ''}`;

function loadoutHtml(L) {
  const p = L.page || {};
  const so = D.meta.skillOrder || {};
  const seq = so.first3 && so.max ? skillSeq(so.first3, so.max) : null;
  const skillRow = seq ? `<div class="skill-mini">${seq.slice(0, 9).map((k, i) => `<span class="${k === 'R' ? 'r' : ''}" title="Level ${i + 1}">${k}</span>`).join('')}<span class="faint">… max ${esc((so.max || []).join(' › '))}</span></div>` : '';
  const step = (label, content, why) => `<div class="bp-step"><div class="bp-l">${label}</div><div class="bp-c">${content}${why ? `<div class="small muted">${esc(why)}</div>` : ''}</div></div>`;
  return `<div class="card">
    <header><h2>Loadout</h2>${L.mu ? `<span class="chip">for ${esc(L.mu.name)}</span>` : '<span class="chip">standard</span>'}</header>
    ${loadoutApplyRow()}
    <div class="sub rune-card">
      <div class="row"><h3>Runes</h3><b>${esc(p.name || '')}</b></div>
      <div><span class="muted">${esc((p.primary || {}).tree)}</span> · <span class="keystone">${esc((p.primary || {}).keystone)}</span> · ${esc(arr((p.primary || {}).runes).join(' · '))}</div>
      <div><span class="muted">${esc((p.secondary || {}).tree)}</span> · ${esc(arr((p.secondary || {}).runes).join(' · '))}</div>
      <div class="small muted">Shards: ${esc(arr(p.shards).join(' · '))}</div>
      ${L.pageNote ? `<div class="small">Matchup note: ${esc(L.pageNote)}</div>` : ''}
    </div>
    <div class="two tight">
      <div><h3>Summoner spells</h3><div class="row" style="margin-top:6px">${L.spells.map(spellChip).join('')}</div>${L.spellNote ? `<div class="small muted" style="margin-top:4px">${esc(L.spellNote)}</div>` : ''}</div>
      <div><h3>Skills</h3>${skillRow}${L.skillNotes ? `<div class="small muted" style="margin-top:4px">${esc(L.skillNotes)}</div>` : ''}</div>
    </div>
    <div><h3>Buy plan</h3>
      <div class="buyplan">
        ${step('Start', `<div class="row">${L.start.map(itemCountChip).join('')}</div>`, L.startWhy)}
        ${L.firstBack.length ? step('First back', `<div class="row">${L.firstBack.map((f) => `${itemChip(f.buy.split(/\s*[-–(]/)[0].trim())}<span class="small muted">${esc(f.gold)}g</span>`).join('<span class="arrow">or</span>')}</div>`, (L.firstBack[0] || {}).buy) : ''}
        ${step('First item', itemChip(L.first.name), L.first.why)}
        ${L.boots.name ? step('Boots', itemChip(L.boots.name), L.boots.why) : ''}
      </div>
    </div>
    ${L.situational.length ? `<div><h3>Plan for their comp</h3><table><tbody>${L.situational.map((s) => `<tr><td>${itemChip(s.name)}</td><td class="small">${esc(s.why)}<div>${s.matched.filter((t) => t.startsWith('vs_')).map((t) => `<span class="tag on">${esc(t.replace(/_/g, ' '))}</span>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

// ---------- champ select ----------
function champSelectHtml(cs) {
  const idOf = (key) => (key ? D.dd.keyToId[String(key)] : null);
  const mine = (cs.myTeam || []).find((p) => p.cellId === cs.localPlayerCellId) || {};
  const myChamp = idOf(mine.championId || mine.championPickIntent);
  const myLocked = !!mine.championId;
  const enemies = (cs.theirTeam || []).map((p) => idOf(p.championId)).filter(Boolean);
  // your lane opponent: the one you picked, else the enemy assigned to your lane (when the client shows positions)
  const myPos = String(mine.assignedPosition || '').toLowerCase();
  const posOpp = myPos ? idOf(((cs.theirTeam || []).find((p) => p.championId && String(p.assignedPosition || '').toLowerCase() === myPos) || {}).championId) : null;
  let opp = S.csOpp && enemies.includes(S.csOpp) ? S.csOpp : posOpp;
  if (!opp) opp = enemies.find((id) => D.matchups[id] && !['Marksman', 'Support'].includes(((D.dd.champs[id] || {}).tags || [])[0])) || enemies.find((id) => D.matchups[id])
    || enemies.find((id) => ['Fighter', 'Tank'].includes(((D.dd.champs[id] || {}).tags || [])[0])) || enemies[0] || null;
  const mu = opp ? D.matchups[opp] : null;
  const POS = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'Bot', utility: 'Support' };

  // timer
  const tm = cs.timer || {};
  const left = tm.adjustedTimeLeftInPhase != null ? Math.max(0, Math.round((tm.adjustedTimeLeftInPhase - (Date.now() - (S.csFetchedAt || Date.now()))) / 1000)) : null;
  const phaseName = { PLANNING: 'Planning', BAN_PICK: 'Picks & bans', FINALIZATION: 'Finalize: runes & spells', GAME_STARTING: 'Game starting' }[tm.phase] || 'Champ select';

  // bans
  const banIds = [...new Set([...(cs.actions || []).flat().filter((a) => a.type === 'ban' && a.completed && a.championId).map((a) => a.championId),
    ...arr((cs.bans || {}).myTeamBans), ...arr((cs.bans || {}).theirTeamBans)])].map(idOf).filter(Boolean);

  const slot = (p, enemy) => {
    const id = idOf(p.championId || (!enemy && p.championPickIntent));
    const m = enemy && id ? D.matchups[id] : null;
    const isMe = !enemy && p.cellId === cs.localPlayerCellId;
    const inner = `${id ? champImg(id) : '<span class="ci empty-slot"></span>'}
      <span class="small ${isMe ? '' : 'muted'}">${id ? esc(champName(id)) : 'picking…'}${!enemy && p.championPickIntent && !p.championId ? ' <i class="faint">(hover)</i>' : ''}</span>
      ${enemy ? (m && m.winRate != null ? `<span class="small ${wrClass(m.winRate)}" title="${esc(champName(S.champ))}'s win rate in this matchup">${(+m.winRate).toFixed(1)}%</span>` : '<span class="small faint">&nbsp;</span>') : `<span class="small faint">${esc(POS[String(p.assignedPosition || '').toLowerCase()] || '')}${isMe ? ' · you' : ''}</span>`}`;
    return enemy && id ? `<button class="cs-slot ${id === opp ? 'on' : ''}" data-csopp="${esc(id)}" title="Set as your lane opponent">${inner}</button>` : `<div class="cs-slot ${isMe ? 'me' : ''}">${inner}</div>`;
  };
  const banSuggest = Object.values(D.matchups).filter((m) => m.winRate != null).sort((a, b) => a.winRate - b.winRate).slice(0, 5);

  const L = loadoutFor(opp, enemies);
  S.csLoadout = { L, champ: S.champ, key: [cs.gameId, S.champ, opp, (L.page || {}).name, L.spells.join('+'), D.plan ? D.plan.at : 0].join('|') };
  const hist = opp ? (Review.state.all || []).filter((g) => g.opp && D.dd.champByName[g.opp.toLowerCase()] === opp) : [];
  const histHtml = hist.length ? (() => {
    const w = hist.filter((g) => g.win).length, early = hist.flatMap((g) => g.deaths.filter((d) => d.t < 840));
    const kinds = {}; early.forEach((d) => { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
    const top = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0];
    return `<div class="notice ${w < hist.length - w ? 'warn' : ''}"><b>Your record vs ${esc(champName(opp))}: ${w}W ${hist.length - w}L</b> · ${(early.length / hist.length).toFixed(1)} deaths before 14:00 per game${top ? `, mostly ${esc(top[0])}` : ''}.</div>`;
  })() : '';
  const T = L.plan.comp, apP = Math.round(T.apShare * 100);
  const compHtml = enemies.length >= 2 ? `<div class="cs-comp"><div class="dmgbar"><div class="ad" style="width:${100 - apP}%"></div><div class="ap" style="width:${apP}%"></div></div>
      <div class="legend"><span><i style="background:var(--ad)"></i>Physical ${100 - apP}%</span><span><i style="background:var(--ap)"></i>Magic ${apP}%</span>
      ${T.strongHeal.length ? `<span class="warn-t">Healing: ${esc(T.strongHeal.join(', '))}</span>` : ''}${T.tanks.length ? `<span>Tanks: ${esc(T.tanks.join(', '))}</span>` : ''}${T.cc.length >= 2 ? `<span>Hard CC: ${T.cc.length}</span>` : ''}</div></div>` : '';

  const matchup = mu ? `<div class="card">
      <div class="opp-head">${champImg(opp, 'lg')}<div class="grow"><div class="name">${esc(champName(S.champ))} vs ${esc(mu.name || champName(opp))}</div>
        <div class="row small" style="margin-top:4px">${diffDots(mu.difficulty)} <span class="muted">${diffLabel(mu.difficulty)}</span>${mu.winRate != null ? `<span class="chip ${wrClass(mu.winRate)}" title="${esc(mu.winRateSource || '')}">WR ${pct(mu.winRate)}</span>` : ''}</div></div></div>
      ${histHtml}
      <div>${esc(mu.summary)}</div>
      <div class="phase-cols">
        ${[['lvl1_3', 'Levels 1-3'], ['lvl4_5', 'Levels 4-5'], ['post6', 'After 6']].filter(([k]) => arr((mu.phases || {})[k]).length).map(([k, l]) => `<div class="sub"><h3>${l}</h3>${list(mu.phases[k])}</div>`).join('')}
      </div>
      <div class="two tight">
        ${arr(mu.threats).length ? `<div><h3 class="warn-t">Respect</h3>${list(mu.threats)}</div>` : ''}
        ${arr(mu.killWindows).length ? `<div><h3 class="good-t">Kill windows</h3>${list(mu.killWindows)}</div>` : ''}
      </div>
      <button class="btn small ghost" data-mu-open="${esc(opp)}">Full matchup page</button>
    </div>`
    : `<div class="card"><header><h2>${opp ? `Vs ${esc(champName(opp))}` : 'Waiting for enemy picks'}</h2></header>
      <div class="muted">${opp ? 'No specific matchup research for this champion yet. The loadout shows the standard setup adjusted for their range and team.' : 'Enemy champions appear as they lock in. Your matchup prep opens here automatically.'}</div>
      ${banSuggest.length ? `<div class="small muted">${esc(champName(S.champ))}'s worst matchups right now (ban candidates): ${banSuggest.map((m) => `${esc(m.name)} ${(+m.winRate).toFixed(1)}%`).join(' · ')}</div>` : ''}</div>`;

  return `
    <div class="card cs-head">
      <header><h2>${phaseName}</h2>${left != null ? `<span class="chip gold num">${Engine.fmtClock(left)}</span>` : ''}
        ${myChamp ? `<span class="chip">${myLocked ? 'Locked' : 'Hovering'}: ${esc(champName(myChamp))}</span>` : ''}${myChamp && !Playbooks.has(myChamp) ? '<span class="chip warn">No playbook yet: general tips</span>' : ''}</header>
      <div class="cs-teams">
        <div><h3>Your team</h3><div class="cs-row">${(cs.myTeam || []).map((p) => slot(p, false)).join('')}</div></div>
        <div><h3>Enemy team <span class="faint" style="text-transform:none;letter-spacing:0">· click your lane opponent</span></h3><div class="cs-row">${(cs.theirTeam || []).map((p) => slot(p, true)).join('')}</div>${compHtml}</div>
      </div>
      ${banIds.length ? `<div class="row small"><span class="muted">Bans</span>${banIds.map((id) => `<span class="ban">${champImg(id, 'sm')}</span>`).join('')}</div>` : ''}
    </div>
    ${playbookNotice(myChamp)}${planCard(null)}
    ${focusCardHtml()}
    <div class="grid cs-grid">${matchup}${loadoutHtml(L)}</div>`;
}

function phaseHero() {
  switch (S.clientPhase) {
    case 'Matchmaking': return ['In queue…', 'Champ select prep opens automatically when your match is found.'];
    case 'ReadyCheck': return ['Match found!', 'Accept it in the League client.'];
    case 'ChampSelect': return ['Champ select', 'Loading picks… the matchup prep appears here in a moment.'];
    case 'GameStart': case 'InProgress': case 'Reconnect':
      return ['Loading into the game…', 'Live coaching starts as soon as the game is running. The voice briefing comes about 20 seconds in.'];
    case 'WaitingForStats': case 'PreEndOfGame': case 'EndOfGame':
      return ['Game over: GG', Report.state.waiting ? 'Your game report opens here as soon as Riot publishes the match (usually 1–5 minutes).' : 'Your game report is on the Game report tab.'];
    case 'WatchInProgress': return ['Watching a replay', 'Use the Watch buttons on the Game report tab to jump to your deaths.'];
    default: return ['Waiting for your next game', 'Load into any game (ranked, normal, practice tool or custom). This page switches to live coaching automatically. Use a second monitor, or alt-tab (borderless window mode makes that instant).'];
  }
}

function waitingHtml() {
  const key = D.config.hasKey
    ? `<li class="good-t">Scouting is on: Riot API key ${esc(D.config.keyHint)} loaded${D.config.keySource ? ` from ${esc(D.config.keySource.replace(/^.*[\\/]/, '~\\'))}` : ''} · server ${esc((D.config.platform || '').toUpperCase())}</li>`
    : `<li class="warn-t">Scouting is off. Add <code>RIOT_API_KEY=RGAPI-…</code> to <code>~\\.env</code> and restart, or use Settings.</li>`;
  return `
    <div class="hero">
      <div class="pulse"></div>
      <h1>${S.serverDown ? 'Can\'t reach the Jax Coach server' : phaseHero()[0]}</h1>
      <p>${S.serverDown ? 'Is the Jax Coach window still open? Start it again with "Start Jax Coach.bat".' : phaseHero()[1]}</p>
      ${S.lastFocus ? `<div class="focus-line f-${S.lastFocus.passed ? 'done' : 'broken'}">${FOCUS_ICON}<div class="grow"><div class="small muted">Last game's focus</div><b>${esc(S.lastFocus.title)}</b></div><div class="f-status"><span class="f-mark">${S.lastFocus.passed ? 'Done' : 'Missed'}</span><span class="small">${esc(S.lastFocus.detail)}</span></div></div>` : ''}
      <ul class="checklist">
        <li>Live game data: Riot's official Live Client Data API, updated every 2 seconds</li>
        ${key}
        <li>Research data: patch ${esc(D.meta.patch || '?')}, collected ${esc(D.meta.lastUpdated || '?')} · ${Object.keys(D.matchups).length} matchups</li>
        <li>${S.clientPhase ? `League client connected (${esc(S.clientPhase)}): champ select prep opens automatically` : 'League client not detected: champ select prep starts when it\'s open'}</li>
      </ul>
      <div class="row">
        ${voiceBtn()}
        ${D.config.hasKey ? '<button class="btn" data-action="open-report">Last game report</button>' : ''}
        <button class="btn ghost" data-action="demo">Try the demo game</button>
        <button class="btn ghost" data-goto="matchups">Prep a matchup</button>
      </div>
    </div>`;
}

function nowCard(A) {
  const r = A.recall;
  const recall = r ? `
    <div class="trigger ${r.level === 'now' ? 'good' : 'info'}">
      <span class="t">↩ ${esc(r.headline)}</span><span class="d">${esc(r.reasons.join(' · '))}</span>
      <ul>${r.hold ? `<li>Wait: ${esc(r.hold)}.</li>` : '<li>Crash your wave into their turret first, then recall so you don\'t lose farm.</li>'}${r.buy ? `<li>Buy: ${esc(r.buy)}.</li>` : ''}</ul>
    </div>` : '';
  const items = recall + A.triggers.map((t) => `
    <div class="trigger ${t.level}">
      <span class="t">${esc(t.title)}</span>${t.detail ? `<span class="d">${esc(t.detail)}</span>` : ''}
      ${list(t.advice)}
    </div>`).join('');
  return `<div class="card"><header><h2>Right now</h2></header>${focusLine(A)}${items || '<div class="empty">Nothing urgent. Follow the plan below.</div>'}</div>`;
}
const FOCUS_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';
function focusLine(A) {
  const F = Focus.current, st = F && Focus.status(A);
  if (!F || !st) return '';
  const mark = { ok: 'On track', warn: 'Careful', broken: 'Missed', done: 'Done', unknown: '' }[st.state];
  return `<div class="focus-line f-${st.state}" title="${esc(F.goal + ' ' + F.how)}">${FOCUS_ICON}<div class="grow"><div class="small muted">Your focus this game</div><b>${esc(F.title)}</b></div>
    <div class="f-status">${mark ? `<span class="f-mark">${mark}</span>` : ''}<span class="small">${esc(st.text)}</span></div></div>`;
}
// champ select: the focus for the coming game, why it was picked, recent results, and a way to change it
function focusCardHtml() {
  const F = Focus.choose(reviewTrends());
  const recent = Focus.recentResults().slice(0, 8);
  const mine = recent.filter((h) => h.focus.id === F.id);
  return `<div class="card focus-card">
    <header>${FOCUS_ICON}<h2>Your focus this game</h2>${F.picked ? '<span class="chip">your pick</span>' : ''}</header>
    <div class="focus-title">${esc(F.title)}</div>
    <div class="small">${esc(F.goal)}</div>
    ${F.why ? `<div class="small muted">Why: ${esc(F.why)}</div>` : '<div class="small muted">Why: the biggest leak in your recent games (load the Review tab for a pick based on your own data).</div>'}
    <div class="small">→ ${esc(F.how)}</div>
    ${mine.length ? `<div class="small muted">Last results: ${mine.slice(0, 5).map((h) => `<span class="f-res ${h.focus.passed ? 'pass' : 'fail'}" title="${esc(h.focus.detail || '')}">${h.focus.passed ? 'passed' : 'missed'}</span>`).join(' ')}</div>` : ''}
    <div class="focus-opts"><span class="small muted">Change:</span>${F.options.map((o) => `<button class="btn small ${o.id === F.id ? '' : 'ghost'}" data-focus="${o.id}" title="${o.learned ? 'Passed 3 games in a row' : ''}">${esc(o.title)}${o.learned ? ' ✓' : ''}</button>`).join('')}</div>
  </div>`;
}

function matchupPhaseCard(A, mu) {
  const opp = A.P.opp;
  if (!opp) return '';
  if (!mu) {
    const tags = (D.dd.champs[opp.cid] || {}).tags || [];
    return `<div class="card"><header><h2>Vs ${esc(champName(opp.cid))}</h2><span class="chip">no matchup data</span></header>
      <div class="muted small">No specific research for this champion yet (${esc(tags.join(' / ') || 'unknown class')}). Use the general phase plan below${tags.includes('Marksman') || ((D.dd.champs[opp.cid] || {}).range || 0) > 300 ? '. Ranged laner: take your time, farm safely and look for all-ins when their key spell is down' : ''}.</div></div>`;
  }
  const tips = (mu.phases || {})[A.matchupPhase] || [];
  const laning = ['lvl1_3', 'lvl4_5', 'post6'].includes(A.matchupPhase);
  return `<div class="card">
    <header>${champImg(opp.cid, 'sm')}<h2>Vs ${esc(mu.name || champName(opp.cid))} · ${esc(A.phaseLabel)}</h2></header>
    ${list(tips) || '<div class="empty">No phase-specific notes.</div>'}
    ${laning && arr(mu.killWindows).length ? `<div class="sub"><h3>Kill windows</h3>${list(mu.killWindows)}</div>` : ''}
  </div>`;
}

function phasePlanCard(A) {
  const ph = arr(D.phases.phases).find((p) => p.id === A.phase);
  if (!ph) return '';
  const key = A.state.label === 'ahead' ? 'ifAhead' : A.state.label === 'behind' ? 'ifBehind' : 'ifEven';
  const label = { ifAhead: 'Because you are ahead', ifBehind: 'Because you are behind', ifEven: 'Even game' }[key];
  return `<div class="card">
    <header><h2>Game plan · ${esc(ph.label || A.phaseLabel)}</h2>${ph.timeHint ? `<span class="chip">${esc(ph.timeHint)}</span>` : ''}</header>
    ${arr(ph[key]).length ? `<div class="sub"><h3>${label}</h3>${list(ph[key])}</div>` : ''}
    ${arr(ph.goals).length ? `<div><h3>Goals</h3>${list(ph.goals)}</div>` : ''}
    ${arr(ph.do).length ? `<div><h3 class="good-t">Do</h3>${list(ph.do)}</div>` : ''}
    ${arr(ph.dont).length ? `<div><h3 class="warn-t">Don't</h3>${list(ph.dont)}</div>` : ''}
  </div>`;
}

function scoutHtml(p, full) {
  if (S.demo) return full ? '<div class="small faint">Player scouting is off in the demo (the demo players don\'t exist).</div>' : '';
  if (!D.config.hasKey) return full ? '<div class="small faint">Add a Riot API key (Settings) to see rank, mastery and recent games.</div>' : '';
  const r = Scout.get(p);
  if (!r || r.status === 'queued' || r.status === 'loading') return `<div class="small faint">Scouting…</div>`;
  if (r.status === 'bot') return `<span class="chip">Bot</span>`;
  if (r.status === 'error') {
    const kp = Scout.keyProblem();
    return `<div class="small warn-t">${esc(kp === 'invalid_key' ? 'Riot API key invalid or expired (dev keys last 24h)' : r.error)}</div>`;
  }
  const s = r.solo, m = r.mastery;
  const rank = s ? `<span class="chip gold">${esc(s.text)}</span> <span class="small muted">${s.winRate}% WR · ${s.games} games</span>` : '<span class="chip">Unranked</span>';
  const mast = m ? `<span class="chip">${m.points ? `M${m.level} · ${m.points >= 1e6 ? (m.points / 1e6).toFixed(1) + 'M' : Math.round(m.points / 1000) + 'k'} pts` : 'No mastery'}</span>${full && m.daysSince != null ? ` <span class="small muted">last played ${m.daysSince === 0 ? 'today' : m.daysSince + 'd ago'}</span>` : ''}` : '';
  const flags = arr(r.flags).map((f) => `<span class="chip ${f.k}">${esc(f.t)}</span>`).join('');
  if (!full) return `<div class="row">${rank}${mast}</div>${flags ? `<div class="flags" style="margin-top:4px">${flags}</div>` : ''}`;
  let recent = '';
  if (r.recentLoading && !r.recent) recent = '<div class="small faint">Loading recent ranked games…</div>';
  else if (r.recent) {
    const x = r.recent;
    const kda = x.onChamp ? ((x.k + x.a) / Math.max(1, x.d)).toFixed(1) : null;
    recent = `<div class="small">${x.onChamp}/${x.games} recent ranked games on this champ${x.onChamp ? ` · ${x.winsOnChamp}W ${x.onChamp - x.winsOnChamp}L · KDA ${kda}` : ''}${r.recentLoading ? ' <span class="faint">(loading…)</span>' : ''}</div>`;
    if (x.topChamps && x.topChamps.length) recent += `<div class="small muted">Recently plays: ${x.topChamps.map(([n, c]) => `${esc(n)} (${c})`).join(', ')}${x.mainRole ? ` · mostly ${esc(x.mainRole.toLowerCase())}` : ''}</div>`;
  }
  return `<div class="row">${rank}</div><div class="row">${mast}</div>${recent}${flags ? `<div class="flags">${flags}</div>` : ''}${playerRead(r)}`;
}

function playerRead(r) {
  const m = r.mastery || {}, x = r.recent;
  const one = x && x.games >= 8 && x.onChamp / x.games >= 0.6;
  if (m.points >= 150000 || one) return `<div class="notice warn">Expect a player who knows this matchup well. Respect their level 1-3 trades and don't count on them misusing their main cooldown. Win through wave control and your scaling.</div>`;
  if (m.points != null && m.points < 20000) return `<div class="notice">Little experience on this champion. Bait their key ability early and punish the mistakes. They're likely to misjudge your trades.</div>`;
  return '';
}

function opponentCard(A, mu) {
  const opp = A.P.opp;
  if (!opp) return '';
  const head = `<div class="opp-head">${champImg(opp.cid, 'lg')}
      <div class="grow"><div class="name">${esc(champName(opp.cid))}</div>
      <div class="small muted">${esc(opp.name)} · lvl ${opp.level} · ${opp.scores.kills}/${opp.scores.deaths}/${opp.scores.assists} · ${Engine.csText(opp)} CS (you ${A.P.me.scores.creepScore || 0})</div>
      ${mu ? `<div class="row small" style="margin-top:4px">${diffDots(mu.difficulty)} <span class="muted">${diffLabel(mu.difficulty)}</span>${mu.winRate != null ? `<span class="chip ${wrClass(mu.winRate)}" title="${esc(mu.winRateSource || '')}">WR ${pct(mu.winRate)}</span>` : ''}</div>` : ''}
      </div></div>`;
  return `<div class="card">
    <header><h2>Lane opponent</h2></header>
    ${head}
    <div class="sub">${scoutHtml(opp, true)}</div>
    ${mu ? `<div>${esc(mu.summary)}</div>
      ${arr(mu.threats).length ? `<div><h3 class="warn-t">Respect</h3>${list(mu.threats)}</div>` : ''}
      ${arr(mu.avoid).length ? `<div><h3>Avoid</h3>${list(mu.avoid)}</div>` : ''}
      <dl class="kv">
        ${mu.runes ? `<dt>Runes</dt><dd>${esc(mu.runes)}</dd>` : ''}
        ${mu.summoners ? `<dt>Spells</dt><dd>${esc(mu.summoners)}</dd>` : ''}
        ${mu.skillNotes ? `<dt>Skills</dt><dd>${esc(mu.skillNotes)}</dd>` : ''}
      </dl>` : ''}
  </div>`;
}

function buildCard(A, mu) {
  const it = A.items;
  const buy = it.buyNow ? `<div class="sub"><h3>Next back · ${it.gold}g</h3><div class="row" style="margin-top:6px">${it.buyNow.ids.map((id) => itemImg(id, 'md')).join('')}<span>${esc(it.buyNow.text)}</span></div></div>` : '';
  const core = it.nextCore.length ? `<div><h3>Next core items</h3><div class="row" style="margin-top:6px">${it.nextCore.map((c) => itemChip(c.name)).join('<span class="arrow">›</span>')}</div></div>` : '';
  const boots = it.boots ? `<div><h3>Boots</h3><div class="row" style="margin-top:6px">${itemChip(it.boots.name)}<span class="small muted">${esc(it.boots.why)}</span></div></div>` : '';
  const sit = it.situational.length ? `<div><h3>Situational for this game</h3>
      <table><tbody>${it.situational.map((s) => `<tr><td>${itemChip(s.name)}</td><td><div>${esc(s.why)}</div><div>${s.matched.map((t) => `<span class="tag on">${esc(t.replace(/_/g, ' '))}</span>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>` : '';
  const muNote = mu && mu.buildNotes ? `<div class="notice"><b>Vs ${esc(mu.name)}:</b> ${esc(mu.buildNotes)}</div>` : '';
  let start = '';
  if (A.t < 150) {
    const L = loadoutFor(A.P.opp ? A.P.opp.cid : null, A.P.enemies.map((p) => p.cid));
    start = `<div class="sub"><h3>Opening buys</h3><div class="buyplan" style="margin-top:6px">
      <div class="bp-step"><div class="bp-l">Start</div><div class="bp-c"><div class="row">${L.start.map(itemCountChip).join('')}</div><div class="small muted">${esc(L.startWhy)}</div></div></div>
      ${L.firstBack.length ? `<div class="bp-step"><div class="bp-l">First back</div><div class="bp-c"><div class="row">${L.firstBack.map((f) => `${itemChip(f.buy.split(/\s*[-–(]/)[0].trim())}<span class="small muted">${esc(f.gold)}g</span>`).join('<span class="arrow">or</span>')}</div></div></div>` : ''}
      <div class="bp-step"><div class="bp-l">First item</div><div class="bp-c">${itemChip(L.first.name)}<div class="small muted">${esc(L.first.why)}</div></div></div>
    </div></div>`;
  }
  return `<div class="card"><header><h2>Build</h2></header>${start}${buy}${core}${boots}${muNote}${sit}</div>`;
}

// drakes with the Dragon Soul state (soul point / who has soul)
function soulChip(A) {
  const dr = A.objs.find((o) => o.key === 'dragon');
  if (!dr || !(dr.soul || dr.soulPoint)) return '';
  const txt = dr.soul ? (dr.soul === 'ours' ? 'You have Dragon Soul' : 'They have Dragon Soul') : dr.soulPoint === 'both' ? 'Both on soul point' : dr.soulPoint === 'ours' ? 'Your soul point' : 'Their soul point';
  return `<span class="chip ${(dr.soul || dr.soulPoint) === 'ours' ? 'good' : 'warn'}">Drakes ${dr.drakes.ours}–${dr.drakes.theirs} · ${txt}</span>`;
}
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
function lanesCard(A) {
  const Ln = A.lanes, T = A.team;
  if (!Ln || !Ln.rows.length) return '';
  const scale = Math.max(1500, ...Ln.rows.map((r) => Math.abs(r.diff)));
  const k = (v) => (Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(Math.round(v)));
  const g = Ln.itemGoldDiff;
  const rows = Ln.rows.map((r) => {
    const w = Math.round((Math.abs(r.diff) / scale) * 50);
    const cls = r.verdict === 'Even' ? 'even' : r.diff > 0 ? 'up' : 'down';
    const who = r.diff > 0 ? 'your side' : 'their side';
    return `<div class="lane ${r.isMe ? 'me' : ''}" title="${esc(`${champName(r.ally.cid)} vs ${champName(r.enemy.cid)}: about ${Math.abs(r.diff)}g ahead for ${who}`)}">
      <span class="lr">${ROLE_LABEL[r.role]}</span>
      <span class="lc">${champImg(r.ally.cid, 'sm')}${r.allyFed ? '<i class="fed" title="Fed">fed</i>' : ''}</span>
      <span class="lbar"><i class="${r.diff >= 0 ? 'l' : 'r'}" style="width:${w}%"></i></span>
      <span class="lc">${champImg(r.enemy.cid, 'sm')}${r.enemyFed ? '<i class="fed" title="Fed">fed</i>' : ''}</span>
      <span class="lv ${cls}">${r.verdict === 'Even' ? 'Even' : `${r.diff > 0 ? '+' : '−'}${k(r.diff)}`}<small>${r.verdict === 'Even' ? '' : esc(r.verdict)}</small></span>
    </div>`;
  }).join('');
  const ob = (label, c) => (c.mine + c.theirs ? `<span class="chip">${label} ${c.mine}–${c.theirs}</span>` : '');
  return `<div class="card"><header><h2>Lanes</h2><span class="chip ${g > 1000 ? 'good' : g < -1000 ? 'warn' : ''}">Team ${g >= 0 ? '+' : '−'}${k(g)} item gold</span></header>
    <div class="flags"><span class="chip">Kills ${T.kills}–${T.ekills}</span><span class="chip">Towers ${T.towers}–${T.etowers}</span>${soulChip(A) || ob('Drakes', Ln.dragons)}${ob('Grubs', Ln.grubs)}${ob('Herald', Ln.heralds)}${ob('Baron', Ln.barons)}</div>
    <div class="lanes"><div class="lane lh"><span></span><span class="small muted">You</span><span class="small faint" style="text-align:center">bar grows toward the side that's ahead</span><span class="small muted">Them</span><span></span></div>${rows}</div>
    <div class="small faint">Lead estimated from CS, kills, assists, levels and items on the scoreboard (unspent enemy gold isn't visible).</div></div>`;
}

// one enemy's damage: magic share and share of their team's damage
function dmgNote(c, p) {
  const x = arr(c.dmg).find((d) => d.cid === p.cid);
  if (!x) return '';
  const m = Math.round(x.magic * 100);
  const kind = m >= 65 ? `${m}% magic` : m <= 35 ? `${100 - m}% physical` : `mixed (${m}% magic)`;
  return ` · <span class="dmg-note" title="${esc(`About ${Math.round(x.share * 100)}% of their team's damage${x.byItems ? ', judged from their items' : ''}`)}"><i class="dot" style="background:${m >= 50 ? 'var(--ap)' : 'var(--ad)'}"></i>${kind}${x.byItems ? ' (items)' : ''}</span>`;
}
function enemyTeamCard(A) {
  const c = A.comp;
  const apP = Math.round(c.apShare * 100);
  const flags = [
    c.strongHeal.length ? `<span class="chip warn" title="${esc(c.heal.join(', '))}">Healing: ${esc(c.strongHeal.join(', '))}</span>` : '',
    c.tanks.length ? `<span class="chip">Tanks: ${esc(c.tanks.join(', '))}</span>` : '',
    c.cc.length >= 2 ? `<span class="chip">Hard CC: ${c.cc.length}</span>` : '',
    c.burst.length ? `<span class="chip">Burst: ${esc(c.burst.join(', '))}</span>` : '',
    c.crit.length ? `<span class="chip">Crit: ${esc(c.crit.join(', '))}</span>` : '',
  ].join('');
  const T = (D.phases && D.phases.triggers) || {};
  const compAdvice = [...A.tags].map((t) => ({ vs_healing: 'enemy_has_heavy_healing', vs_heavy_ap: 'enemy_heavy_ap', vs_heavy_ad: 'enemy_heavy_ad', vs_tanks: 'enemy_many_tanks', vs_cc_heavy: 'enemy_heavy_cc' }[t]))
    .filter(Boolean).map((id) => arr(T[id])[0]).filter(Boolean);
  const rows = A.P.enemies.map((p) => `
    <div class="prow ${p.isDead ? 'dead' : ''}">
      ${champImg(p.cid)}
      <div>
        <div class="top"><b>${esc(champName(p.cid))}</b><span class="pn muted small">${esc(p.name)}</span>${p.isDead ? `<span class="chip warn">dead ${Math.ceil(p.respawnTimer)}s</span>` : ''}${p === A.P.opp ? '<span class="chip gold">lane</span>' : ''}</div>
        <div class="meta num">lvl ${p.level} · ${p.scores.kills}/${p.scores.deaths}/${p.scores.assists} · ${Engine.csText(p)} CS${dmgNote(c, p)}</div>
        <div class="items" style="margin:4px 0">${arr(p.items).filter((i) => i.itemID < 3340 || i.itemID > 3364).map((i) => itemImg(i.itemID)).join('')}</div>
        ${scoutHtml(p, false)}
      </div>
    </div>`).join('');
  return `<div class="card"><header><h2>Enemy team</h2></header>
    <div class="dmgbar"><div class="ad" style="width:${100 - apP}%"></div><div class="ap" style="width:${apP}%"></div></div>
    <div class="legend"><span><i style="background:var(--ad)"></i>Physical ${100 - apP}%</span><span><i style="background:var(--ap)"></i>Magic ${apP}%</span></div>
    <div class="small faint">Each champion's usual damage, moved by what they actually build and weighted by their gold. Updates as they buy items.</div>
    ${flags ? `<div class="flags">${flags}</div>` : ''}
    ${compAdvice.length ? list(compAdvice, 'small') : ''}
    <div class="plist">${rows}</div></div>`;
}

// ---------- playbooks + research agents on the dashboard ----------
const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
const TOOL_VERB = { WebSearch: 'Searching', WebFetch: 'Reading', Agent: 'Sub-agent', Task: 'Sub-agent', Write: 'Writing', Edit: 'Editing', Read: 'Reading file', Glob: 'Looking at files', Grep: 'Searching files' };
function jobActivity(j) {
  const a = j && j.activity && j.activity.recent;
  const last = a && a[a.length - 1];
  if (!last) return j && j.status === 'running' ? 'starting…' : '';
  const arg = last.tool === 'WebFetch' ? hostOf(last.arg) : last.arg;
  return `${TOOL_VERB[last.tool] || last.tool}: ${arg.length > 80 ? arg.slice(0, 77) + '…' : arg}`;
}
const JOB_KIND = { champion: 'Full research', quick: 'Quick build', gameplan: 'Game plan', adapt: 'Reassess', review: 'Post-game review' };
function playbookNotice(cid) {
  if (!cid) return '';
  const name = champName(cid), has = Playbooks.has(cid), draft = Playbooks.isDraft(cid);
  const full = Agent.running(`champion-${cid}`), quick = Agent.running(`quick-${cid}`);
  if (has && !draft && !full) return '';
  const st = Agent.state.status;
  if (!has && !full && !quick) {
    const why = !st ? '' : !st.installed ? 'Install Claude Code to let a research agent build one (see the Playbook tab).' : !st.loggedIn ? 'Sign in to Claude Code on the Playbook tab and a research agent builds one automatically.' : 'Research starts automatically.';
    return `<div class="notice warn pb-notice">No playbook for ${esc(name)} yet: general top-lane advice for now. ${esc(why)} <button class="btn small ghost" data-action="goto-playbook" data-champ="${esc(cid)}">Playbook</button></div>`;
  }
  const jobs = [quick, full].filter(Boolean);
  const line = jobs.map((j) => `<div class="small"><b>${JOB_KIND[j.type]}</b> · ${ago(j.created)} · <span class="muted">${esc(jobActivity(j))}</span></div>`).join('');
  const lead = !has ? `Researching ${esc(name)}… general top-lane advice until the first results arrive (about 1–2 minutes for the build).`
    : draft ? `${esc(name)}: draft playbook from the quick research. The full research is still running and replaces it part by part.`
      : `Refreshing the ${esc(name)} playbook in the background. The current version stays active until it's done.`;
  return `<div class="notice pb-notice"><div>${lead}</div>${line}</div>`;
}
function planCard(A) {
  const st = Agent.state.status;
  if (!st || !st.installed || !st.loggedIn) return '';
  const G = Agent.state.game;
  const plan = D.plan;
  const job = G && G.jobId ? Agent.state.jobs.find((j) => j.id === G.jobId) : (!A && Agent.state.csPlanJob ? Agent.state.jobs.find((j) => j.id === Agent.state.csPlanJob.id && j.status === 'running') : null);
  const chat = askBox(A);
  if (!plan && !job) return A ? `<div class="card plan-card"><header><h2>Game plan</h2><span class="chip">AI</span></header><div class="small muted">A plan for this game is being prepared.</div>${chat}</div>`
    : chat ? `<div class="card plan-card"><header><h2>Coach</h2><span class="chip">AI</span></header><div class="small muted">Ask about this draft: the matchup, runes, what to build. The game plan follows once the lane opponent is known.</div>${chat}</div>` : '';
  const thinking = job && job.status === 'running' ? `<div class="plan-thinking"><span class="spin"></span><div><b>${esc(G && G.jobReason ? `Reassessing: ${G.jobReason}` : 'Preparing the game plan')}</b> · ${ago(job.created)}<div class="small muted">${esc(jobActivity(job))}</div></div></div>` : '';
  if (!plan) return `<div class="card plan-card"><header><h2>Game plan</h2><span class="chip">AI</span></header>${thinking}${chat}</div>`;
  // in game the build shows what's still to buy: owned items drop out, half-built ones show the gold still missing
  const inv = A ? Engine.inventory(D, A.P.me, arr(plan.build && plan.build.order)) : null;
  const owned = (n) => !!inv && inv.items.some((o) => o.name.toLowerCase() === String(n || '').toLowerCase());
  const half = (n) => inv && inv.halfBuilt.find((x) => x.name.toLowerCase() === String(n || '').toLowerCase());
  const b = arr(plan.build && plan.build.order).filter((n) => !owned(n));
  const sells = arr(plan.build && plan.build.sell).filter((s) => s && s.item && (!inv || owned(s.item)));
  const when = `${plan.kind === 'adapt' ? `updated ${ago(plan.at)} ago` : plan.kind === 'chat' ? `changed ${ago(plan.at)} ago` : `made ${ago(plan.at)} ago`}${plan.checkedAt ? ` · checked ${ago(plan.checkedAt)} ago` : ''}`;
  const C = Agent.state.chat;
  const undo = plan.kind === 'chat' && C && C.undo && C.undo.jobId === plan.jobId;
  const fresh = plan.changed !== false && Date.now() - plan.at < 12000;
  return `<div class="card plan-card ${fresh ? 'fresh' : ''}">
    <header><h2>Game plan</h2><span class="chip">AI · ${esc(when)}</span><span class="grow"></span>${A && !S.demo ? '<button class="btn small ghost" data-action="reassess" title="Ask the agent to look at the game again now">Reassess</button>' : ''}</header>
    ${plan.kind === 'chat' ? `<div class="plan-from-chat small">Changed after your question${undo ? ' <button class="btn small ghost" data-action="chat-undo" title="Go back to the plan before your question">Undo</button>' : ''}</div>` : ''}
    <div class="plan-head">${esc(plan.headline)}</div>
    ${list(plan.bullets)}
    ${plan.summary || arr(plan.changes).length ? `<details class="small muted"><summary>${arr(plan.changes).length ? 'What changed' : 'Why'}</summary>${plan.summary ? `<div>${esc(plan.summary)}</div>` : ''}${list(plan.changes, 'small')}</details>` : ''}
    ${b.length ? `<div><h3>Build for this game${inv ? ' · still to buy' : ''}</h3><div class="row" style="margin-top:6px">${b.map((n) => { const h = half(n); return `<span title="${esc((plan.build.why || {})[n] || '')}${h ? ` · you have ${esc(h.parts.join(' + '))}` : ''}">${itemChip(n)}${h ? `<span class="small muted"> ${h.left}g left</span>` : ''}</span>`; }).join('<span class="arrow">›</span>')}</div>${plan.build.note ? `<div class="small muted">${esc(plan.build.note)}</div>` : ''}</div>` : ''}
    ${sells.length ? `<div class="small">${sells.map((s) => `<div><b>Sell ${esc(s.item)}</b>${s.when ? ` <span class="muted">${esc(/full|slot|room/i.test(s.when) ? 'when you need the slot' : s.when)}</span>` : ''}${s.why ? ` · ${esc(s.why)}` : ''}</div>`).join('')}</div>` : ''}
    ${!A && (plan.runes || plan.summoners) ? `<dl class="kv">${plan.runes ? `<dt>Runes</dt><dd>${esc(plan.runes)}</dd>` : ''}${plan.summoners ? `<dt>Spells</dt><dd>${esc(plan.summoners)}</dd>` : ''}</dl>` : ''}
    ${arr(plan.rules).length ? `<div class="small muted">Dashboard rules for this game: ${arr(plan.rules).map((r) => esc(r.headline || r.id)).join(' · ')}</div>` : ''}
    ${thinking}${chat}
  </div>`;
}
// "Ask the coach": the latest question and answer stay open, older ones fold away
function askBox(A) {
  if (S.demo || !Agent.ready()) return '';
  const C = Agent.chatFor(A, A ? null : S.cs, false);
  const msgs = C ? C.msgs : [];
  let s = msgs.length;
  while (s > 0 && msgs[s - 1].who === 'you') s--;                    // waiting for an answer
  if (s > 0 && msgs[s - 1].who === 'coach') { s--; while (s > 0 && msgs[s - 1].who === 'you') s--; }   // the last answer and its question
  const link = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? `<a href="${esc(x.href)}" target="_blank" rel="noopener noreferrer">${esc(x.hostname.replace(/^www\./, ''))}</a>` : ''; } catch { return ''; } };
  const msg = (m) => m.who === 'you' ? `<div class="ask-you">${esc(m.text)}</div>`
    : `<div class="ask-coach ${m.error ? 'err' : ''}"><div>${esc(m.text)}</div>${arr(m.bullets).length ? list(m.bullets, 'small') : ''}
        ${m.planChanged || m.note || arr(m.sources).length ? `<div class="ask-meta small faint">${m.planChanged ? `<span class="chip ${m.undone ? '' : 'info'}">${m.undone ? 'plan change undone' : 'plan updated'}</span>` : ''}${m.note ? '<span title="' + esc(m.note) + '">noted for the post-game review</span>' : ''}${arr(m.sources).map(link).filter(Boolean).join(' ')}</div>` : ''}</div>`;
  const job = C && C.job ? Agent.state.jobs.find((j) => j.id === C.job) : null;
  const busy = C && (C.job || C.sending);
  const thinking = busy ? `<div class="plan-thinking"><span class="spin"></span><div><b>Coach is thinking</b>${job ? ` · ${ago(job.created)}` : ''}<div class="small muted">${esc(job ? jobActivity(job) : 'starting')}</div></div></div>` : '';
  const older = msgs.slice(0, s);
  return `<div class="ask">
    ${older.length ? `<details class="ask-older"><summary class="small muted">${older.filter((m) => m.who === 'you').length} earlier question${older.filter((m) => m.who === 'you').length === 1 ? '' : 's'}</summary>${older.map(msg).join('')}</details>` : ''}
    ${msgs.slice(s).map(msg).join('')}${thinking}
    <form id="askForm" class="ask-form" autocomplete="off"><input id="askInput" maxlength="400" placeholder="${A ? 'Ask the coach about this game…' : 'Ask the coach about this draft…'}" value="${esc(S.askDraft || '')}"><button class="btn small" type="submit">${busy ? 'Queue' : 'Ask'}</button></form>
    ${busy ? '<div class="small faint">Anything you send now goes out with the next question.</div>' : ''}
  </div>`;
}
function whyPanel(A) {
  if (!S.showWhy || !A.trace) return '';
  const T = A.trace, m = A.mode;
  const terms = T.terms.filter((x) => x.on || x.error).map((x) => `<tr><td><code>${esc(x.id)}</code></td><td class="num">${x.add > 0 ? '+' : ''}${x.add}</td><td class="small muted">${esc(x.why || '')}${x.error ? ` <span class="warn-t">${esc(x.error)}</span>` : ''}</td></tr>`).join('');
  const rules = T.rules.map((r) => `<span class="rchk ${r.decided ? 'hit' : r.on ? 'on' : ''} ${r.error ? 'err' : ''}" title="${esc(r.error || (r.used ? `built-in: ${r.used}` : ''))}">${r.decided ? '✓' : r.error ? '!' : '✗'} ${esc(r.id)}</span>`).join('');
  const pb = D.playbook || {};
  return `<div class="card why">
    <header><h2>Why "${esc((MODE_META[m.mode] || {}).name || m.mode)}"?</h2><span class="chip">rule ${esc(m.rule || '–')}</span>${String(m.rule || '').startsWith('plan:') ? '<span class="chip info">from the game plan</span>' : ''}<span class="chip" title="Long fight / all-in">fight score ${T.score}</span>${T.scoreShort != null && T.scoreShort !== T.score ? `<span class="chip" title="Short trade">short trade ${T.scoreShort}</span>` : ''}${T.safety ? `<span class="chip ${T.safety.towerSafe ? '' : 'warn'}" title="${esc(T.safety.threat ? T.safety.threat.why || T.safety.threat.id : '')}">tower ${T.safety.towerSafe ? 'safe' : 'not safe'}${T.safety.threats.length ? `: ${esc(T.safety.threats.join(', '))}` : ''}</span>` : ''}${T.ctx && T.ctx.power && T.ctx.power.fromProfile ? `<span class="chip" title="Matchup power curve at this stage (short / extended)">${esc(T.ctx.power.stage)} ${T.ctx.power.short} / ${T.ctx.power.extended}</span>` : ''}<span class="grow"></span><span class="small faint">playbook: ${esc(champName(pb.champion))}${pb.generic ? ' (generic)' : pb.version ? ` v${pb.version}` : ' (built-in)'}</span></header>
    <div class="two tight"><div><h3>Fight score (you vs your lane opponent)</h3><table><tbody>${terms || '<tr><td class="muted small">no terms apply</td></tr>'}</tbody></table></div>
    <div><h3>Rules checked, in order</h3><div class="rchks">${rules}</div><div class="small faint" style="margin-top:6px">The first rule whose condition holds decides. The Playbook tab shows every rule.</div></div></div>
  </div>`;
}

// ---------- PLAYBOOK ----------
function renderPlaybook() {
  const el = $('#view-playbook');
  if (!el) return;
  const cid = S.pbSel || S.champ;
  if (!Playbooks.raw(cid) && Playbooks.has(cid) && S.pbLoading !== cid) { S.pbLoading = cid; Playbooks.load(cid).then(() => { S.pbLoading = null; if (S.view === 'playbook') renderPlaybook(); }); }
  const st = Agent.state.status;
  const info = Playbooks.info(cid);
  const pool = [...new Set([cid, S.champ, ...Playbooks.list.map((p) => p.champion), ...arr(Agent.state.jobs).filter((j) => j.champion && ['champion', 'quick'].includes(j.type)).map((j) => j.champion)])].filter((c) => D.dd.champs[c]).sort((a, b) => champName(a).localeCompare(champName(b)));
  const pill = (c) => {
    const i = Playbooks.info(c), run = Agent.running(`champion-${c}`) || Agent.running(`quick-${c}`);
    const tag = run ? '<span class="chip info">researching</span>' : i && i.draft ? '<span class="chip">draft</span>' : i && i.active ? `<span class="chip">v${i.active}</span>` : i && i.shipped ? '<span class="chip">built-in</span>' : '<span class="chip warn">none</span>';
    return `<button class="pb-champ ${c === cid ? 'on' : ''}" data-pbsel="${esc(c)}">${champImg(c, 'sm')}<span class="grow">${esc(champName(c))}${c === S.champ ? ' <i class="faint">· on dashboard</i>' : ''}</span>${tag}</button>`;
  };
  const allChamps = Object.values(D.dd.champs).sort((a, b) => a.name.localeCompare(b.name));
  const agentBox = !st ? '<div class="small muted">Checking Claude Code…</div>'
    : !st.installed ? '<div class="notice warn">Claude Code isn\'t installed. The research agents run through it. Install it once (PowerShell):<pre>irm https://claude.ai/install.ps1 | iex</pre>then sign in and click Check again. <button class="btn small ghost" data-action="agent-check">Check again</button></div>'
      : !st.loggedIn ? '<div class="notice warn">Claude Code is installed but not signed in. <button class="btn small" data-action="agent-login">Sign in</button> opens a window: follow the link, sign in, and paste the code back into that window. Then <button class="btn small ghost" data-action="agent-check">Check again</button></div>'
        : `<div class="small good-t">Claude Code is ready · new champions: ${esc(st.models.deep)} · everything else and all sub-agents: ${esc(st.models.fast)}</div>`;
  const jobs = arr(Agent.state.jobs);
  const jobRow = (j) => `<div class="job j-${j.status}">
      <div class="row"><b>${esc(JOB_KIND[j.type] || j.type)}</b>${j.champion ? `<span class="row" style="gap:4px">${champImg(j.champion, 'xs')}<span class="small">${esc(champName(j.champion))}</span></span>` : ''}<span class="chip ${j.status === 'done' ? 'good' : j.status === 'failed' ? 'warn' : j.status === 'running' ? 'info' : ''}">${esc(j.status)}</span>
        <span class="small faint">${ago(j.created)} ago${j.durationSec ? ` · took ${Math.round(j.durationSec / 6) / 10} min` : ''}</span><span class="grow"></span>${j.status === 'running' ? `<button class="btn small ghost" data-cancel="${esc(j.id)}">Stop</button>` : ''}</div>
      <div class="small muted">${esc(j.title || '')}</div>
      ${j.status === 'running' ? `<div class="small">${esc(jobActivity(j))} <span class="faint">(${(j.activity || {}).count || 0} steps)</span></div>` : ''}
      ${j.error ? `<div class="small warn-t">${esc(j.error)}</div>` : ''}${arr(j.warnings).length ? `<div class="small warn-t">${esc(arr(j.warnings).join(' · '))}</div>` : ''}
    </div>`;
  const mine = jobs.filter((j) => j.champion === cid).slice(0, 8);
  const others = jobs.filter((j) => j.champion !== cid).slice(0, 6);

  // post-game review proposals: only the changes still to decide, newest review first
  const props = Agent.state.proposals.filter((p) => p.champ === cid && openChanges(p).length).sort((a, b) => b.at - a.at);
  const propHtml = props.map((p) => `<div class="sub">
      <div class="row"><b>Review from ${ago(p.at)} ago</b><span class="grow"></span><button class="btn small ghost" data-dismiss="${esc(p.jobId)}">Dismiss</button></div>
      ${p.proposal.summary ? `<div class="small">${esc(p.proposal.summary)}</div>` : ''}
      ${arr(p.proposal.lessons).length ? list(p.proposal.lessons, 'small') : ''}
      ${openChanges(p).map(({ c, i }) => `<div class="proposal"><div class="grow"><b>${esc(c.title || 'Change')}</b> <span class="chip">${esc(c.part || 'rules')}</span><div class="small muted">${esc(c.why || '')}</div></div>
        <button class="btn small" data-apply="${esc(p.jobId)}" data-idx="${i}">Apply</button><button class="btn small ghost" data-skip="${esc(p.jobId)}" data-idx="${i}">Skip</button></div>`).join('')}
    </div>`).join('');

  // rules explorer
  const raw = Playbooks.raw(cid) || {};
  const R = cid === S.champ ? D.rules : (raw.rules || {});
  const problems = Rules.check(R);
  const modes = Engine.modesFor(D, R, cid === S.champ ? D.overlayRules : null);
  const ruleRow = (r) => (r.anchor ? `<div class="rule anchor"><b>▸ ${esc(r.id)}</b> <span class="small muted">${esc(r.note || '')}</span></div>`
    : `<details class="rule ${r.source === 'plan' || String(r.id).startsWith('plan:') ? 'from-plan' : ''} ${r.source === 'shared' ? 'from-shared' : ''} ${r.disabled ? 'off' : ''}"><summary><code>${esc(r.id)}</code>${r.source === 'shared' ? ' <span class="chip">all champions</span>' : ''} <span class="muted">${r.use ? `built-in: ${esc(r.use)}` : `→ ${esc(r.mode)}`}</span> <span class="small">${esc(r.headline || '')}</span></summary>
        <dl class="kv small"><dt>when</dt><dd><code>${esc(r.when || 'always')}</code></dd>${r.reason ? `<dt>reason</dt><dd>${esc(r.reason)}</dd>` : ''}${r.voice ? `<dt>voice</dt><dd>${esc(r.voice)}</dd>` : ''}${r.note ? `<dt>note</dt><dd>${esc(r.note)}</dd>` : ''}</dl></details>`);
  const scoreRow = (x) => `<tr><td><code>${esc(x.id)}</code>${x.group ? ` <span class="faint small">${esc(x.group)}</span>` : ''}</td><td><code class="small">${esc(x.when)}</code></td><td class="num"><code>${esc(x.add)}</code></td><td class="small muted">${esc(x.why || '')}</td></tr>`;
  const versions = info ? arr(info.versions).slice().reverse() : [];
  const src = raw.source || {};
  const muList = Object.entries(((raw.matchups || {}).matchups) || {}).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object');
  const muTotal = muList.length, muProfiled = muList.filter(([, v]) => v.profile).length;

  el.innerHTML = `<div class="pb-layout">
    <div class="col">
      <div class="card"><header><h2>Champions</h2></header>
        <div class="pb-list">${pool.map(pill).join('')}</div>
        <label class="small muted">Add a champion (starts research)
          <select id="pbAdd"><option value="">Choose…</option>${allChamps.filter((c) => !pool.includes(c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="card"><header><h2>Research agents</h2></header>${agentBox}
        ${others.length ? `<h3>Other recent runs</h3>${others.map(jobRow).join('')}` : ''}</div>
    </div>
    <div class="col">
      <div class="card">
        <header>${champImg(cid, 'lg')}<div class="grow"><h2>${esc(champName(cid))} playbook</h2>
          <div class="small muted">${info ? `${info.active ? `version ${info.active}${info.draft ? ' (draft)' : ''}` : 'built-in version'} · patch ${esc(info.patch || '?')} · build: ${esc(src.meta || '–')} · plan: ${esc(src.phases || '–')} · matchups: ${esc(src.matchups || '–')} · rules: ${esc(src.rules || '–')}` : 'no playbook yet'}</div></div>
          ${cid !== S.champ ? `<button class="btn small" data-usechamp="${esc(cid)}">Show on dashboard</button>` : ''}
          ${Agent.ready() ? `<button class="btn small ghost" data-research="${esc(cid)}" ${Agent.running(`champion-${cid}`) ? 'disabled' : ''}>${Playbooks.has(cid) ? 'Refresh research' : 'Research now'}</button>` : ''}
          ${Agent.ready() && muTotal ? `<button class="btn small ghost" data-profiles="${esc(cid)}" ${Agent.running(`profile-${cid}`) ? 'disabled' : ''} title="Turns the matchup texts into data the dashboard decides with: who wins short trades and all-ins at each stage, and when your tower isn't safe">${Agent.running(`profile-${cid}`) ? 'Profiling matchups…' : `Matchup profiles ${muProfiled}/${muTotal}`}</button>` : ''}
        </header>
        ${playbookNotice(cid)}
        ${versions.length ? `<div class="row small"><span class="muted">Versions:</span>${versions.map((v) => `<button class="btn small ${v.v === info.active ? '' : 'ghost'}" data-activate="${esc(cid)}" data-v="${v.v}" title="${esc(`${v.created} · ${v.source} · ${v.note || ''}`)}">v${v.v}</button>`).join('')}${info.shipped ? `<button class="btn small ${info.active ? 'ghost' : ''}" data-activate="${esc(cid)}" data-v="0" title="The version that ships with the app">built-in</button>` : ''}</div>` : ''}
        ${mine.length ? `<h3>Research runs</h3>${mine.map(jobRow).join('')}` : ''}
      </div>
      ${personalCard()}
      ${propHtml ? `<div class="card"><header><h2>Suggested changes after your games</h2></header><div class="small muted">A review agent compared what the playbook said with what happened. Applying a change saves a new playbook version (you can switch back any time).</div>${propHtml}</div>` : ''}
      <div class="card"><header><h2>Decision rules</h2><span class="chip">${arr(R.modes).length} rules · ${arr(R.fightScore).length} score terms</span>${problems.length ? `<span class="chip warn">${problems.length} broken</span>` : ''}</header>
        ${R.notes ? `<div class="small muted">${esc(R.notes)}</div>` : ''}
        ${problems.length ? `<div class="notice warn small">${problems.map((p) => `${esc(p.where)}: ${esc(p.error)}`).join('<br>')}</div>` : ''}
        <div class="small muted">Every two seconds the dashboard computes a <b>fight score</b> (how good a fight with your lane opponent is right now) and then checks the rules from top to bottom: the first one that holds sets the play mode, the text and the voice line. Rules from this game's plan are inserted at <b>plan</b>.</div>
        <h3>Fight score</h3><div class="table-wrap"><table><tbody>${arr(R.fightScore).map(scoreRow).join('')}</tbody></table></div>
        <h3>Rules, in order</h3><div class="rules">${modes.map(ruleRow).join('')}</div>
        ${R.params ? `<h3>Parameters</h3><pre class="small">${esc(JSON.stringify(R.params, null, 1))}</pre>` : ''}
      </div>
    </div>
  </div>`;
}
// A review's changes you haven't decided yet. A change already saved as a playbook version (this review or an
// earlier one suggesting the same thing) counts as applied, even if this browser forgot it.
const reviewNote = (c) => `Review: ${c.title || 'change'}`;
// your personal rules and hints: one file for every champion (history\personal.json). c: { addRules, removeRules, addHints, removeHints }
// Returns how many rules/hints were added (invalid ones are left out).
async function savePersonalChange(c, source, note) {
  const cur = Playbooks.personal || { rules: [], hints: [] };
  let rules = arr(cur.rules).filter((r) => !arr(c.removeRules).includes(r.id)), hints = arr(cur.hints).filter((h) => !arr(c.removeHints).includes(h.id));
  let added = 0;
  for (const r of arr(c.addRules)) { if (!r || !r.id || !Rules.clean([r], 'me').length) continue; rules = [...rules.filter((x) => x.id !== r.id), { ...r, from: source }]; added++; }
  for (const h of arr(c.addHints)) { if (!h || !h.id || !h.text || Rules.check({ hints: [h] }).length) continue; hints = [...hints.filter((x) => x.id !== h.id), { ...h, from: source }]; added++; }
  await Playbooks.savePersonal({ rules, hints, log: [...arr(cur.log), { at: new Date().toISOString(), note, source }].slice(-50) }, note);
  applyPlaybook();
  return added;
}
function openChanges(p) {
  const notes = new Set(arr((Playbooks.info(p.champ) || {}).versions).map((v) => String(v.note || '').trim().toLowerCase()));
  return arr(p.proposal.changes).map((c, i) => ({ c, i })).filter(({ c, i }) => !p.done[i] && !notes.has(reviewNote(c).trim().toLowerCase()));
}
function decideProposal(jobId, idx, state) {
  Agent.markProposal(jobId, idx, state);
  const p = Agent.state.proposals.find((x) => x.jobId === jobId);
  if (p && !openChanges(p).length) Agent.dismissProposal(jobId);   // the rest was applied from another review
}
async function applyProposal(jobId, idx) {
  const p = Agent.state.proposals.find((x) => x.jobId === jobId);
  const c = p && arr(p.proposal.changes)[idx];
  if (!c || !openChanges(p).some((o) => o.i === idx)) return;
  const champ = p.champ, part = c.part || 'rules';
  if (part === 'personal') {
    try { await savePersonalChange(c, `review:${jobId}`, reviewNote(c)); decideProposal(jobId, idx, 'applied'); } catch (e) { alert(`Couldn't save: ${e.message}`); }
    renderPlaybook();
    return;
  }
  await Playbooks.load(champ, true);
  const eff = Playbooks.effective(champ, D.dd, null);
  const base = (Playbooks.raw(champ) || {})[part] || (part === 'matchups' ? { champion: champ, matchups: {} } : part === 'meta' ? eff.meta : part === 'phases' ? eff.phases : eff.rules);
  const next = c.patch ? Rules.merge(base, c.patch) : { ...base };
  if (part === 'rules') {
    let modes = arr(next.modes).slice();
    for (const id of arr(c.removeRules)) modes = modes.filter((r) => r.id !== id);
    for (const r of arr(c.replaceRules)) { const i = modes.findIndex((x) => x.id === r.id); if (i >= 0) modes[i] = r; }
    for (const r of arr(c.addRules)) {
      if (!r || !r.id || Rules.check({ modes: [r] }).length) continue;
      modes = modes.filter((x) => x.id !== r.id);
      let i = r.before ? modes.findIndex((x) => x.id === r.before) : -1;
      if (i < 0) i = modes.findIndex((x) => x.anchor && x.id === 'plan');
      const { before, ...rule } = r;
      modes.splice(i < 0 ? modes.length : i, 0, rule);
    }
    next.modes = modes;
    const bad = Rules.check(next);
    if (bad.length) { alert(`This change has broken rules and wasn't applied:\n${bad.map((b) => `${b.where}: ${b.error}`).join('\n')}`); return; }
  }
  try {
    await Playbooks.saveVersion(champ, { [part]: next }, reviewNote(c), `review:${jobId}`);
    decideProposal(jobId, idx, 'applied');
    if (champ === S.champ) await useChamp(champ, { fresh: true });
  } catch (e) { alert(`Couldn't save: ${e.message}`); }
  renderPlaybook();
}

// what the coach learned about you (personal rules and hints, for every champion), with a way to remove each
function personalCard() {
  const P = Playbooks.personal || {};
  const rules = arr(P.rules), hints = arr(P.hints);
  if (!rules.length && !hints.length) return '';
  const row = (kind, x) => `<div class="row small" style="justify-content:space-between"><div><b>${esc(x.headline || x.text || x.id)}</b>${x.when ? `<div class="faint"><code>${esc(x.when)}</code></div>` : ''}</div><button class="btn small ghost" data-personal-remove="${kind}:${esc(x.id)}">Remove</button></div>`;
  return `<div class="card"><header><h2>What the coach learned about you</h2><span class="chip">all champions</span></header>
    <div class="small muted">Rules from the reviews of your games. They come before the general lane advice on the dashboard.</div>
    ${rules.map((r) => row('rules', r)).join('')}${hints.map((h) => row('hints', h)).join('')}</div>`;
}

// ---------- MATCHUPS ----------
function renderMatchups() {
  const el = $('#view-matchups');
  const ids = Object.keys(D.matchups).sort((a, b) => champName(a).localeCompare(champName(b)));
  if (!ids.length) { el.innerHTML = '<div class="notice">Matchup data is still missing. Check the data folder.</div>'; return; }
  const f = S.muFilter.toLowerCase();
  const tiles = ids.filter((id) => !f || champName(id).toLowerCase().includes(f)).map((id) => {
    const m = D.matchups[id];
    return `<button class="mu-tile ${id === S.muSel ? 'on' : ''}" data-mu="${esc(id)}">${champImg(id)}<span class="nm">${esc(champName(id))}</span><span class="wr ${wrClass(m.winRate)}">${m.winRate != null ? (+m.winRate).toFixed(1) + '%' : '–'}</span></button>`;
  }).join('');
  el.innerHTML = `<div class="mu-layout">
    <div class="card"><input class="search" id="muSearch" placeholder="Search champion…" value="${esc(S.muFilter)}">
      <div class="small faint">Percentages are ${esc(champName(S.champ))}'s win rate in the matchup.</div>
      <div class="mu-list">${tiles}</div></div>
    <div id="muDetail">${matchupDetail(S.muSel)}</div></div>`;
}
function matchupDetail(id) {
  const m = D.matchups[id];
  if (!m) return '';
  const ph = m.phases || {};
  const cols = [['lvl1_3', 'Levels 1-3'], ['lvl4_5', 'Levels 4-5'], ['post6', 'After 6'], ['midgame', 'Mid game'], ['lategame', 'Late game']]
    .filter(([k]) => arr(ph[k]).length).map(([k, l]) => `<div class="sub"><h3>${l}</h3>${list(ph[k])}</div>`).join('');
  return `<div class="card">
    <div class="opp-head">${champImg(id, 'lg')}<div class="grow">
      <div class="name">${esc(champName(S.champ))} vs ${esc(m.name || champName(id))}</div>
      <div class="row small" style="margin-top:4px">${diffDots(m.difficulty)} <span class="muted">${diffLabel(m.difficulty)}</span>
        ${m.winRate != null ? `<span class="chip ${wrClass(m.winRate)}">${esc(champName(S.champ))} win rate ${pct(m.winRate)}</span>` : ''}
        ${m.winRateSource ? `<span class="faint">${esc(m.winRateSource)}</span>` : ''}</div></div></div>
    <div>${esc(m.summary)}</div>
    <dl class="kv">
      ${m.runes ? `<dt>Runes</dt><dd>${esc(m.runes)}</dd>` : ''}
      ${m.summoners ? `<dt>Spells</dt><dd>${esc(m.summoners)}</dd>` : ''}
      ${m.start ? `<dt>Start</dt><dd>${itemsText(m.start)}</dd>` : ''}
      ${m.skillNotes ? `<dt>Skills</dt><dd>${esc(m.skillNotes)}</dd>` : ''}
      ${m.buildNotes ? `<dt>Build</dt><dd>${esc(m.buildNotes)}</dd>` : ''}
    </dl>
    <div class="phase-cols">${cols}</div>
    <div class="two">
      ${arr(m.threats).length ? `<div><h3 class="warn-t">Respect</h3>${list(m.threats)}</div>` : ''}
      ${arr(m.killWindows).length ? `<div><h3 class="good-t">Kill windows</h3>${list(m.killWindows)}</div>` : ''}
      ${arr(m.avoid).length ? `<div><h3>Avoid</h3>${list(m.avoid)}</div>` : ''}
    </div>
    ${arr(m.sources).length ? `<div class="small faint">Sources: ${arr(m.sources).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(hostOf(u))}</a>`).join(' · ')}</div>` : ''}
  </div>`;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// ---------- BUILD ----------
function skillSeq(first3, max) {
  const pts = { Q: 0, W: 0, E: 0, R: 0 }, seq = [];
  for (let lvl = 1; lvl <= 18; lvl++) {
    let k = null;
    if (lvl <= 3 && first3[lvl - 1] && pts[first3[lvl - 1]] + 1 <= Math.ceil(lvl / 2)) k = first3[lvl - 1];
    else if ([6, 11, 16].includes(lvl)) k = 'R';
    if (!k) k = max.find((s) => pts[s] < 5 && pts[s] + 1 <= Math.ceil(lvl / 2)) || max.find((s) => pts[s] < 5);
    pts[k]++; seq.push(k);
  }
  return seq;
}
function renderBuild() {
  const el = $('#view-build');
  const m = D.meta || {};
  if (!m.patch) { el.innerHTML = '<div class="notice">Build data (data/meta.json) isn\'t there yet.</div>'; return; }
  const o = m.overview || {};
  const activeTags = S.A ? S.A.tags : new Set();
  const so = m.skillOrder || {};
  const seq = so.first3 && so.max ? skillSeq(so.first3, so.max) : null;
  const skillGrid = seq ? `<div class="skill-order">${['Q', 'W', 'E', 'R'].map((k) => `<div class="lbl">${k}</div>${seq.map((s, i) => `<div class="${s === k ? 'on' : 'off'}">${s === k ? i + 1 : ''}</div>`).join('')}`).join('')}</div>` : '';
  const cb = m.coreBuild || {};
  el.innerHTML = `
  <div class="grid" style="gap:14px">
    ${playbookNotice(S.champ)}<div class="card"><header><h2>${esc(champName(S.champ))} top · patch ${esc(m.patch || '?')}</h2>
      ${o.tier ? `<span class="chip gold">Tier ${esc(o.tier)}</span>` : ''}
      ${o.winRate != null ? `<span class="chip ${wrClass(o.winRate)}">WR ${pct(o.winRate)}</span>` : ''}
      ${o.pickRate != null ? `<span class="chip">Pick ${pct(o.pickRate)}</span>` : ''}
      ${o.banRate != null ? `<span class="chip">Ban ${pct(o.banRate)}</span>` : ''}
      ${o.rankFilter ? `<span class="chip">${esc(o.rankFilter)}</span>` : ''}</header>
      <div>${esc(o.playstyle)}</div>
      ${arr(m.seasonNotes).length ? `<div class="sub"><h3>What's new this season</h3>${list(m.seasonNotes)}</div>` : ''}
    </div>
    <div class="two">
      <div class="card"><header><h2>Runes</h2></header>
        ${arr(m.runes).map((r) => `<div class="rune-page">
          <div class="row"><b>${esc(r.name)}</b>${r.winRate != null ? `<span class="chip ${wrClass(r.winRate)}">${pct(r.winRate)}</span>` : ''}${r.pickRate != null ? `<span class="chip">pick ${pct(r.pickRate)}</span>` : ''}</div>
          <div class="small muted">${esc(r.when)}</div>
          <div><span class="muted">${esc((r.primary || {}).tree)}:</span> <span class="keystone">${esc((r.primary || {}).keystone)}</span> · ${esc(arr((r.primary || {}).runes).join(' · '))}</div>
          <div><span class="muted">${esc((r.secondary || {}).tree)}:</span> ${esc(arr((r.secondary || {}).runes).join(' · '))}</div>
          <div class="small muted">Shards: ${esc(arr(r.shards).join(' · '))}</div></div>`).join('')}
        <h3>Summoner spells</h3>
        ${arr(m.summoners).map((s) => `<div><b>${esc(arr(s.spells).join(' + '))}</b> <span class="muted">${esc(s.when)}</span></div>`).join('')}
      </div>
      <div class="card"><header><h2>Skill order</h2>${so.max ? `<span class="chip">Max ${esc(so.max.join(' › '))}</span>` : ''}</header>
        ${skillGrid}<div class="small muted">${esc(so.notes)}</div>
        <h3>Starting items</h3>
        ${arr(m.startingItems).map((s) => `<div class="row">${arr(s.items).map((n) => itemChip(n)).join('')}<span class="small muted">${esc(s.when)}</span></div>`).join('')}
        <h3>First item</h3>
        ${arr(cb.firstItemOptions).map((f) => `<div class="row">${itemChip(f.item)}${f.winRate != null ? `<span class="chip ${wrClass(f.winRate)}">${pct(f.winRate)}</span>` : ''}<span class="small muted">${esc(f.when)}</span></div>`).join('')}
        <h3>Typical order</h3>
        <div class="row">${arr(cb.typicalOrder).map((n) => itemChip(n)).join('<span class="arrow">›</span>')}</div>
        <h3>Boots</h3>
        ${arr(cb.boots).map((b) => `<div class="row">${itemChip(b.item)}<span class="small muted">${esc(b.when)}</span></div>`).join('')}
        ${arr(cb.firstBackBuys).length ? `<h3>First back</h3><table><tbody>${arr(cb.firstBackBuys).map((f) => `<tr><td class="num">${esc(f.gold)}g</td><td>${esc(f.buy)}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>
    </div>
    <div class="card"><header><h2>Items & when to build them</h2>${S.A ? '<span class="chip info">highlighted = true in your current game</span>' : ''}</header>
      <table><thead><tr><th>Item</th><th>Role</th><th>Build when</th><th>Why</th></tr></thead><tbody>
      ${arr(m.items).map((it) => `<tr><td>${itemChip(it.name)}</td><td class="muted">${esc(it.role)}</td><td>${arr(it.buildWhen).map((t) => `<span class="tag ${activeTags.has(t) ? 'on' : ''}">${esc(t.replace(/_/g, ' '))}</span>`).join('')}</td><td>${esc(it.why)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="two">
      <div class="card"><header><h2>Abilities</h2></header>
        ${arr(m.abilities).map((a) => `<div><b><span class="chip gold">${esc(a.key)}</span> ${esc(a.name)}</b><div class="muted small">${esc(a.summary)}</div>${list(a.tips, 'small')}</div>`).join('')}</div>
      <div class="col">
        <div class="card"><header><h2>Combos</h2></header>
          <table><tbody>${arr(m.combos).map((c) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.when)}</div></td><td class="num">${esc(c.input)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><header><h2>Power spikes</h2></header>
          <table><tbody>${arr(m.powerSpikes).map((p) => `<tr><td><b>${esc(p.when)}</b></td><td>${esc(p.what)}</td></tr>`).join('')}</tbody></table></div>
        ${m.jungle ? `<div class="card"><header><h2>Jungle ${esc(champName(S.champ))}</h2>${m.jungle.playRate != null ? `<span class="chip">${pct(m.jungle.playRate)} of games</span>` : ''}</header>
          <dl class="kv"><dt>Runes</dt><dd>${esc(m.jungle.runes)}</dd><dt>Build</dt><dd>${esc(m.jungle.build)}</dd><dt>Clear</dt><dd>${esc(m.jungle.clear)}</dd></dl><div class="small muted">${esc(m.jungle.notes)}</div></div>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------- PLAN ----------
function renderPlan() {
  const el = $('#view-plan');
  const P = D.phases || {};
  if (!arr(P.phases).length) { el.innerHTML = '<div class="notice">Game plan data (data/phases.json) isn\'t there yet.</div>'; return; }
  const ph = P.phases.find((p) => p.id === S.planPhase) || P.phases[0];
  const sec = (title, items) => (arr(items).length ? `<div><h3>${title}</h3>${list(items)}</div>` : '');
  const sp = P.splitPush || {}, tf = P.teamfight || {};
  const timers = (D.meta || {}).objectiveTimers || {};
  el.innerHTML = `<div class="grid" style="gap:14px">
    <div class="card">
      <div class="phase-tabs">${P.phases.map((p) => `<button data-phase="${esc(p.id)}" class="${p === ph ? 'on' : ''}">${esc(p.label)}</button>`).join('')}</div>
      <header><h2>${esc(ph.label)}</h2>${ph.timeHint ? `<span class="chip">${esc(ph.timeHint)}</span>` : ''}</header>
      <div class="two">
        <div class="col">${sec('Goals', ph.goals)}${sec('<span class="good-t">Do</span>', ph.do)}${sec('<span class="warn-t">Don\'t</span>', ph.dont)}</div>
        <div class="col">${sec('If you are ahead', ph.ifAhead)}${sec('If it is even', ph.ifEven)}${sec('If you are behind', ph.ifBehind)}</div>
      </div>
    </div>
    <div class="two">
      <div class="card"><header><h2>Trading</h2></header>${list(P.trading)}</div>
      <div class="card"><header><h2>Wave management</h2></header>${list(P.waveManagement)}</div>
      <div class="card"><header><h2>Split pushing</h2></header>${sec('When', sp.when)}${sec('Rules', sp.rules)}${sec('Teleport', sp.tpUsage)}</div>
      <div class="card"><header><h2>Teamfights</h2></header>${tf.role ? `<div>${esc(tf.role)}</div>` : ''}${sec('Rules', tf.rules)}${sec('Target priority', tf.targetPriority)}</div>
      <div class="card"><header><h2>Objectives</h2></header>${list(P.objectives)}
        ${Object.keys(timers).length ? `<table><tbody>${Object.entries(timers).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => `<tr><td><b>${esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))}</b></td><td class="num">${v.spawn ? 'spawns ' + esc(v.spawn) : ''}${v.respawn ? ' · respawn ' + esc(v.respawn) : ''}</td><td class="small muted">${esc(v.notes || '')}</td></tr>`).join('')}</tbody></table>` : ''}</div>
      <div class="card"><header><h2>Mechanics</h2></header>${list(P.mechanics)}</div>
      <div class="card"><header><h2>Recall timings</h2></header>
        <table><tbody>${arr(P.recallTimings).map((r) => `<tr><td class="num"><b>${esc(r.gold)}g</b></td><td>${esc(r.buy)}<div class="small muted">${esc(r.note || '')}</div></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><header><h2>Common mistakes</h2></header>${list(P.commonMistakes)}</div>
    </div></div>`;
}

// ---------- SOURCES ----------
function renderSources() {
  const el = $('#view-sources');
  const rows = [];
  for (const s of arr((D.meta || {}).sources)) rows.push({ name: s.name, url: s.url, what: s.usedFor || 'build / runes / stats' });
  for (const s of arr((D.phases || {}).sources)) rows.push({ name: s.name, url: s.url, what: 'game plan' });
  const muSrc = {};
  for (const m of Object.values(D.matchups)) for (const u of arr(m.sources)) { const h = hostOf(u); muSrc[h] = (muSrc[h] || 0) + 1; }
  el.innerHTML = `<div class="grid" style="gap:14px">
    <div class="card"><header><h2>Data freshness</h2></header>
      <dl class="kv">
        <dt>Build / runes</dt><dd>patch ${esc((D.meta || {}).patch || '?')} · collected ${esc((D.meta || {}).lastUpdated || '?')}</dd>
        <dt>Game plan</dt><dd>collected ${esc((D.phases || {}).lastUpdated || '?')}</dd>
        <dt>Matchups</dt><dd>${Object.keys(D.matchups).length} champions</dd>
        <dt>Item / champion data</dt><dd>Data Dragon ${esc(D.dd.version || 'unavailable')}, fetched live from Riot</dd>
      </dl>
      <div class="small muted">To refresh the research, use <b>Refresh research</b> on the Playbook tab: a research agent collects the new patch data and saves it as a new playbook version (the old one stays available). Item names that no longer exist show with a dashed border.</div>
    </div>
    <div class="card"><header><h2>Build, runes & game plan sources</h2></header>
      <table><thead><tr><th>Source</th><th>Used for</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name || hostOf(r.url))}</a></td><td class="muted">${esc(r.what)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><header><h2>Matchup sources</h2></header>
      <div class="flags">${Object.entries(muSrc).sort((a, b) => b[1] - a[1]).map(([h, n]) => `<span class="chip">${esc(h)} · ${n}</span>`).join('')}</div>
      <div class="small muted">Each matchup lists its own links on the Matchups tab.</div></div>
  </div>`;
}

// ---------- REVIEW ----------
const fmtT = (s) => (s == null ? '–' : Engine.fmtClock(s));
const signed = (v, unit = '') => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}${unit}`);

function gdChart(games) {
  const gs = games.filter((g) => g.at15 && g.at15.goldDiff != null).slice().reverse();   // oldest -> newest
  if (gs.length < 2) return '';
  const W = 640, H = 210, L = 52, Rr = 8, T = 10, B = 30;
  const nice = Math.max(500, Math.ceil(Math.max(...gs.map((g) => Math.abs(g.at15.goldDiff))) / 500) * 500);
  const y = (v) => T + ((H - T - B) / 2) * (1 - v / nice);
  const bw = (W - L - Rr) / gs.length, y0 = y(0);
  const bars = gs.map((g, i) => {
    const v = g.at15.goldDiff, x = L + i * bw, w = Math.max(4, bw * 0.56), cx = x + (bw - w) / 2;
    const top = Math.min(y0, y(v)), h = Math.max(1.5, Math.abs(y(v) - y0));
    const tip = `${new Date(g.end).toLocaleDateString()} · vs ${g.opp || '?'} · ${g.win ? 'Win' : 'Loss'}<br>Gold diff @15: <b>${signed(v, 'g')}</b> · CS diff: ${signed(g.at15.csDiff)}`;
    return `<rect x="${cx}" y="${top}" width="${w}" height="${h}" rx="2" fill="var(--${v >= 0 ? 'pos' : 'neg'})"/>
      <text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" class="ax ${g.win ? 'w' : ''}">${g.win ? 'W' : 'L'}</text>
      <rect x="${x}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');
  const grid = [nice, 0, -nice].map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'base' : 'grid'}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v === 0 ? '0' : signed(v, 'g')}</text>`).join('');
  return `<figure class="chart"><figcaption><b>Gold difference at 15:00 vs your lane opponent</b><span class="legend"><span><i style="background:var(--pos)"></i>Ahead</span><span><i style="background:var(--neg)"></i>Behind</span><span class="faint">oldest → newest · W/L below</span></span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gold difference at 15 minutes per game">${grid}${bars}</svg></figure>`;
}
function csChart(games) {
  const gs = games.filter((g) => g.at10).slice().reverse();
  if (gs.length < 2) return '';
  const W = 640, H = 190, L = 40, Rr = 8, T = 12, B = 22;
  const max = Math.max(80, Math.ceil(Math.max(...gs.map((g) => g.at10.cs)) / 20) * 20);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const bw = (W - L - Rr) / gs.length;
  const mean = gs.reduce((a, g) => a + g.at10.cs, 0) / gs.length;
  const bars = gs.map((g, i) => {
    const x = L + i * bw, w = Math.max(4, bw * 0.56), cx = x + (bw - w) / 2;
    const tip = `${new Date(g.end).toLocaleDateString()} · vs ${g.opp || '?'} · ${g.win ? 'Win' : 'Loss'}<br>CS at 10: <b>${g.at10.cs}</b>${g.at10.csDiff != null ? ` (${signed(g.at10.csDiff)} vs opponent)` : ''}`;
    return `<rect x="${cx}" y="${y(g.at10.cs)}" width="${w}" height="${y(0) - y(g.at10.cs)}" rx="2" fill="var(--pos)"/>
      <rect x="${x}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }).join('');
  const grid = [0, max / 2, max].map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'base' : 'grid'}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('');
  return `<figure class="chart"><figcaption><b>CS at 10:00</b><span class="legend faint">oldest → newest · dashed line = your average (${Math.round(mean)})</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="CS at 10 minutes per game">${grid}${bars}<line x1="${L}" x2="${W - Rr}" y1="${y(mean)}" y2="${y(mean)}" class="avg"/></svg></figure>`;
}

function renderReview() {
  const el = $('#view-review');
  const R = Review.state;
  if (!D.config.hasKey) { el.innerHTML = '<div class="notice warn">Review needs a Riot API key (see Settings).</div>'; return; }
  const idForm = `<form class="row" id="idForm"><input class="search" style="max-width:260px" name="rid" placeholder="Your Riot ID, e.g. Name#EUW" value="${R.me ? esc(R.me.gameName + '#' + R.me.tagLine) : ''}"><button class="btn small">Use this Riot ID</button></form>`;
  let status = archiveStatus();
  if (R.status === 'loading') status = '<div class="small muted">Opening your match archive…</div>';
  else if (R.status === 'error') status = `<div class="notice warn">${esc(R.error)}</div>`;
  else if (R.status === 'needs_identity' || !R.me) status = '<div class="small muted">Open the League client (detected automatically) or enter your Riot ID.</div>';
  const head = `<div class="card"><header><h2>Your ${esc(champName(S.champ))} games</h2>${R.me ? `<span class="chip">${esc(R.me.gameName)}#${esc(R.me.tagLine)}</span>` : ''}<span class="grow"></span>
      ${R.all.length > 30 ? `<div class="seg" role="group" aria-label="Games to look at">${[['30', 'Last 30'], ['100', 'Last 100'], ['all', `All ${R.all.length}`]].filter(([v]) => v === 'all' || +v < R.all.length).map(([v, l]) => `<button class="${R.range === v ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}</div>` : ''}
      ${R.me && R.status !== 'loading' && !Archive.running ? `<button class="btn small" data-action="review-load">${R.all.length ? 'Check for new games' : 'Load my games'}</button>` : ''}</header>
      ${!R.me || R.status === 'needs_identity' ? idForm : ''}${status}
      <div class="small faint">Solo/Duo, Flex, Draft and Quickplay games on ${esc(champName(S.champ))} from your match archive: every game Riot still has (about two years), kept on this PC for good. Games played with Jax Coach open also record what the dashboard said when you died.</div></div>`;
  const games = R.games;
  const hist = historyHtml();
  if (!games.length) { el.innerHTML = `<div class="grid" style="gap:14px">${head}${R.status === 'done' && !Archive.running ? `<div class="notice">No ${esc(champName(S.champ))} games in your archive yet.</div>` : ''}${hist}</div>`; return; }

  const T = Review.trends(games), ins = Review.insights(T, games);
  const tile = (label, value, sub) => `<div class="tile"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const tiles = `<div class="tiles">
    ${tile('Win rate', `${T.wr}%`, `${T.wins}W ${T.n - T.wins}L · ${R.range === 'all' || T.n >= R.all.length ? `all ${T.n} games` : `last ${T.n} of ${R.all.length}`}`)}
    ${tile('CS at 10', T.cs10 != null ? Math.round(T.cs10) : '–', T.csDiff10 != null ? `${signed(T.csDiff10)} vs lane opponent` : '')}
    ${tile('Gold diff at 15', signed(T.gd15, 'g'), 'vs lane opponent')}
    ${tile('First item', fmtT(T.firstItem), 'average completion')}
    ${tile('Deaths before 14:00', T.earlyDeathsPerGame != null ? T.earlyDeathsPerGame.toFixed(1) : '–', `per game · ${T.earlyGanks.length} of ${T.early.length} were ganks`)}
  </div>`;
  const insHtml = ins.length ? `<div class="card"><header><h2>What to work on</h2></header>${ins.map((i) => `
      <div class="trigger ${i.k}"><span class="t">${esc(i.title)}</span><div class="small">${esc(i.text)}</div>${i.tip ? `<div class="small muted" style="margin-top:3px">→ ${esc(i.tip)}</div>` : ''}${i.mu && D.dd.champByName[i.mu.toLowerCase()] ? `<button class="btn small ghost" style="margin-top:6px" data-mu-open="${esc(D.dd.champByName[i.mu.toLowerCase()])}">Open matchup</button>` : ''}</div>`).join('')}</div>` : '';
  const deathTable = `<div class="card"><header><h2>When and how you die</h2></header>
    <table><thead><tr><th>Time</th><th class="num">Deaths</th><th class="num">Gank</th><th class="num">Solo vs laner</th><th class="num">Teamfight</th><th class="num">Other</th></tr></thead><tbody>
    ${T.buckets.map((b) => `<tr><td>${b.label}</td><td class="num">${b.total}</td><td class="num">${b.gank}</td><td class="num">${b.solo}</td><td class="num">${b.fight}</td><td class="num">${b.other}</td></tr>`).join('')}
    </tbody></table><div class="small faint">Gank = enemy jungler involved with 3 or fewer enemies before 20:00. Solo = killed by your lane opponent alone.</div></div>`;
  const fr = Focus.recentResults().slice(0, 10);
  const focusHtml = fr.length ? `<div class="card"><header>${FOCUS_ICON}<h2>Focus results</h2><span class="small faint">games played with Jax Coach open</span></header>
    <table><tbody>${fr.map((h) => `<tr><td class="small muted">${new Date(h.endedAt).toLocaleDateString()}</td><td>${h.opp ? `<span class="row">${champImg(h.opp, 'sm')}</span>` : ''}</td><td>${esc(h.focus.title)}</td><td><span class="f-res ${h.focus.passed ? 'pass' : 'fail'}">${h.focus.passed ? 'passed' : 'missed'}</span></td><td class="small muted">${esc(h.focus.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : '';
  const muRows = Object.entries(T.byOpp).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));
  const muAvg = (name, f) => { const v = games.filter((g) => g.opp === name).map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const muTable = `<div class="card"><header><h2>By opponent</h2><span class="small faint">${muRows.length} champions</span></header><div class="table-wrap" style="max-height:420px"><table><thead><tr><th></th><th class="num">You</th><th class="num">Win rate</th><th class="num">GD@15</th><th class="num">Deaths &lt;14:00</th><th class="num">Everyone</th></tr></thead><tbody>
    ${muRows.map(([name, o]) => {
      const id = D.dd.champByName[name.toLowerCase()] || name, n = o.w + o.l, gd = muAvg(name, (g) => g.at15 && g.at15.goldDiff), ed = muAvg(name, (g) => g.deaths.filter((d) => d.t < 840).length);
      return `<tr><td><span class="row">${champImg(id, 'sm')}${esc(champName(id))}</span></td><td class="num">${o.w}W ${o.l}L</td><td class="num">${n >= 3 ? `<span class="${o.w / n >= 0.55 ? 'good-t' : o.w / n <= 0.45 ? 'warn-t' : ''}">${Math.round((o.w / n) * 100)}%</span>` : '<span class="faint">–</span>'}</td>
        <td class="num">${gd != null ? signed(gd, 'g') : '–'}</td><td class="num">${ed != null ? ed.toFixed(1) : '–'}</td>
        <td class="num">${D.matchups[id] && D.matchups[id].winRate != null ? `<span class="${wrClass(D.matchups[id].winRate)}">${(+D.matchups[id].winRate).toFixed(1)}%</span>` : ''}</td></tr>`;
    }).join('')}
    </tbody></table></div><div class="small faint">Win rate from 3 games up. "Everyone" = this matchup's average win rate from the playbook.</div></div>`;
  const shown = S.reviewAllRows ? games : games.slice(0, 40);
  const rows = shown.map((g) => {
    const open = R.open === g.id;
    const ganks = g.deaths.filter((d) => d.kind === 'gank').length;
    const oppId = g.opp ? D.dd.champByName[g.opp.toLowerCase()] || g.opp : null;
    const detail = open ? `<tr class="detail"><td colspan="8">
        <div class="two"><div><h3>Deaths</h3>${g.deaths.length ? `<table><tbody>${g.deaths.map((d) => `<tr><td class="num">${fmtT(d.t)}</td><td><span class="chip ${d.kind === 'gank' || d.kind === 'solo' ? 'warn' : ''}">${esc(d.kind)}</span>${d.kind === 'solo' && d.behind ? ' <span class="small warn-t">while behind</span>' : ''}</td><td>${esc(d.zone)}${d.enemyHalf ? ' <span class="small warn-t">past the river</span>' : ''}</td><td class="small muted">${d.killers} enemies · ${esc(d.killer)}${d.mode ? ` · dashboard said <b>${esc((MODE_META[d.mode] || {}).name || d.mode)}</b>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No deaths.</div>'}</div>
        <div><h3>Items</h3>${g.items.map((it) => `<div class="row small">${D.dd.items[it.id] ? itemImg(it.id) : ''}${esc(it.name)} <span class="muted">${fmtT(it.t)}</span></div>`).join('') || '<div class="empty">No completed items.</div>'}
        <h3 style="margin-top:10px">Other</h3><div class="small">${g.wardsBefore14} wards before 14:00 · ${g.controlWards} control wards · ${g.plates} plates · ${g.soloKills} solo kills on your opponent</div></div></div></td></tr>` : '';
    return `<tr class="game ${open ? 'open' : ''}" data-game="${esc(g.id)}"><td><span class="chip ${g.win ? 'good' : 'warn'}">${g.win ? 'Win' : 'Loss'}</span></td>
      <td class="small muted">${new Date(g.end).toLocaleDateString()}<br>${Review.QUEUE_NAME[g.queue] || g.queue}</td>
      <td>${oppId ? `<span class="row">${champImg(oppId, 'sm')}${esc(champName(oppId))}</span>` : '–'}</td>
      <td class="num">${g.k}/${g.d}/${g.a}</td><td class="num">${g.at10 ? g.at10.cs : '–'}${g.at10 && g.at10.csDiff != null ? ` <span class="small muted">(${signed(g.at10.csDiff)})</span>` : ''}</td>
      <td class="num">${g.at15 && g.at15.goldDiff != null ? signed(g.at15.goldDiff, 'g') : '–'}</td><td class="num">${fmtT(g.firstItemAt)}</td>
      <td class="num">${g.deaths.filter((d) => d.t < 840).length}${ganks ? ` <span class="small warn-t">(${ganks} gank${ganks > 1 ? 's' : ''})</span>` : ''}</td></tr>${detail}`;
  }).join('');
  const list = `<div class="card"><header><h2>Games</h2><span class="small faint">click a game for details</span></header><div class="table-wrap"><table class="games"><thead><tr><th></th><th>Date</th><th>Vs</th><th class="num">KDA</th><th class="num">CS@10</th><th class="num">GD@15</th><th class="num">1st item</th><th class="num">Deaths &lt;14:00</th></tr></thead><tbody>${rows}</tbody></table></div>${games.length > shown.length ? `<button class="btn small ghost" data-action="review-all-rows">Show all ${games.length} games</button>` : ''}</div>`;
  const recent = games.slice(0, 40);
  el.innerHTML = `<div class="grid" style="gap:14px">${head}${tiles}${focusHtml}<div class="two">${insHtml}<div class="col"><div class="card">${gdChart(recent)}${csChart(recent)}${games.length > recent.length ? `<div class="small faint">Charts show your last ${recent.length} games.</div>` : ''}</div></div></div><div class="two">${deathTable}${muTable}</div>${list}${hist}</div>`;
}

// ---------- your match archive: import status and stats over every game ----------
function archiveStatus() {
  const A = Archive.state;
  if (Archive.running) {
    const prog = A.todo ? `${A.done} of ${A.todo} games downloaded` : `listing your games… ${A.listed} found so far`;
    return `<div class="small muted">Importing your match history: ${prog}${A.pausedFor ? ` · <b>paused while ${esc(A.pausedFor)}</b>` : ''}. It runs in the background (20–40 games a minute, gentle on your API key) and continues next time if you close the app.</div>${A.todo ? `<div class="progress"><i style="width:${Math.round((A.done / A.todo) * 100)}%"></i></div>` : ''}`;
  }
  if (A.status === 'error') return `<div class="small warn-t">The import stopped: ${esc(A.error)}. It tries again in 30 minutes.</div>`;
  const n = Archive.rows().length;
  return n ? `<div class="small faint">${n} games in your archive${A.lastSync ? ` · checked for new games ${ago(A.lastSync)} ago` : ''}.</div>` : '';
}

// a line over games (oldest -> newest): e.g. a rolling win rate. One axis, a reference line, a tooltip per point.
function trendChart({ title, note, pts, yMin, yMax, ref, fmt, label }) {
  if (pts.length < 2) return '';
  const W = 640, H = 170, L = 40, Rr = 10, T = 10, B = 24;
  const x = (i) => L + ((W - L - Rr) * i) / (pts.length - 1), y = (v) => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const grid = [yMin, (yMin + yMax) / 2, yMax].map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmt(v)}</text>`).join('');
  const refLine = ref != null ? `<line x1="${L}" x2="${W - Rr}" y1="${y(ref)}" y2="${y(ref)}" class="avg"/>` : '';
  const years = []; let lastLabel = '';
  pts.forEach((p, i) => { const l = new Date(p.t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); if (l !== lastLabel && (i === 0 || i - (years.length ? years[years.length - 1].i : -99) > pts.length / 7)) { years.push({ i, l }); lastLabel = l; } });
  const ticks = years.map((t) => `<text x="${x(t.i)}" y="${H - 6}" text-anchor="${t.i === 0 ? 'start' : 'middle'}" class="ax">${t.l}</text>`).join('');
  const bw = (W - L - Rr) / pts.length;
  const hits = pts.map((p, i) => `<rect x="${x(i) - bw / 2}" y="${T}" width="${Math.max(2, bw)}" height="${H - T - B}" fill="transparent" data-tip="${esc(p.tip)}"/>`).join('');
  const last = pts[pts.length - 1];
  return `<figure class="chart"><figcaption><b>${esc(title)}</b><span class="legend faint">${esc(note)}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${refLine}${ticks}<path d="${path}" class="ln ln-you"/><circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="4" fill="var(--s-you)"/><text x="${x(pts.length - 1) - 6}" y="${y(last.v) - 8}" text-anchor="end" class="ax lbl-you">${esc(label(last.v))}</text>${hits}</svg></figure>`;
}
// rolling average over the previous n games (starts once n games exist)
function rolling(rows, n, f) {
  const out = [];
  for (let i = n - 1; i < rows.length; i++) {
    const win = rows.slice(i - n + 1, i + 1).map(f).filter((v) => v != null);
    if (win.length >= Math.ceil(n / 2)) out.push({ t: rows[i].end, v: win.reduce((a, b) => a + b, 0) / win.length, row: rows[i] });
  }
  return out;
}
function wrBar(label, g, base) {
  if (!g.n) return '';
  const w = g.wr, cls = g.n < 8 ? '' : w >= base + 5 ? 'up' : w <= base - 5 ? 'down' : '';
  return `<div class="wrbar ${cls}" title="${g.n} games"><span class="l">${esc(label)}</span><span class="b"><i style="width:${w}%"></i><em style="left:${base}%"></em></span><span class="v num">${w}%</span><span class="n small faint">${g.n}</span></div>`;
}
function historyHtml() {
  const rows = Archive.rows().filter((r) => !r.remake);
  if (rows.length < 10) return '';
  const X = Archive.stats(rows);
  const asc = rows.slice().reverse();
  const top = rows.filter((r) => r.role === 'TOP'), topWr = top.length ? Math.round((top.filter((r) => r.win).length / top.length) * 100) : null;
  const tile = (label, value, sub) => `<div class="tile"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const n = Math.min(20, Math.max(5, Math.floor(rows.length / 6)));
  const wrPts = rolling(asc, n, (r) => (r.win ? 100 : 0)).map((p) => ({ ...p, tip: `${new Date(p.t).toLocaleDateString()} · ${Math.round(p.v)}% over your ${n} games up to here` }));
  const champRows = asc.filter((r) => r.champ === S.champ && r.detail && r.detail.at10);
  const cn = Math.min(10, Math.max(3, Math.floor(champRows.length / 5)));
  const csPts = rolling(champRows, cn, (r) => r.detail.at10.cs).map((p) => ({ ...p, tip: `${new Date(p.t).toLocaleDateString()} · CS at 10: ${Math.round(p.v)} average over ${cn} games` }));
  const csMax = csPts.length ? Math.max(80, Math.ceil(Math.max(...csPts.map((p) => p.v)) / 20) * 20) : 100;
  const champTable = `<table><thead><tr><th>Champion</th><th class="num">Games</th><th class="num">Win rate</th><th class="num">KDA</th><th class="num">CS/min</th><th>Role</th><th class="num">Last</th></tr></thead><tbody>
    ${X.champs.slice(0, 12).map((c) => `<tr><td><span class="row">${champImg(c.champ, 'sm')}${esc(champName(c.champ))}</span></td><td class="num">${c.n}</td><td class="num"><span class="${c.n >= 5 ? (c.wr >= 55 ? 'good-t' : c.wr <= 45 ? 'warn-t' : '') : ''}">${c.wr}%</span></td><td class="num">${c.kda.toFixed(1)}</td><td class="num">${c.csm.toFixed(1)}</td><td class="small muted">${esc(ROLE_LABEL[c.role] || '–')}</td><td class="num small muted">${new Date(c.last).toLocaleDateString()}</td></tr>`).join('')}
    </tbody></table>${X.champs.length > 12 ? `<div class="small faint">and ${X.champs.length - 12} more champions</div>` : ''}`;
  const tl = X.tilt, base = X.wr;
  const champPatches = Archive.stats(rows.filter((r) => r.champ === S.champ)).patches.slice(0, 8);
  return `<div class="card"><header><h2>All your games</h2><span class="small faint">every champion and role in your archive</span></header>
    <div class="tiles">
      ${tile('Games', X.n, X.first ? `since ${new Date(X.first).toLocaleDateString()}` : '')}
      ${tile('Win rate', `${X.wr}%`, `${rows.filter((r) => r.win).length}W ${rows.filter((r) => !r.win).length}L`)}
      ${tile('Top lane', topWr != null ? `${topWr}%` : '–', `${top.length} games in top`)}
      ${tile('Sessions', X.sessions, X.perSession ? `${X.perSession.toFixed(1)} games per session` : '')}
    </div>
    <div class="two" style="margin-top:12px">
      <div>${trendChart({ title: 'Win rate over time', note: `rolling over ${n} games, all champions · dashed line = 50%`, pts: wrPts, yMin: 0, yMax: 100, ref: 50, fmt: (v) => `${v}%`, label: (v) => `${Math.round(v)}%` })}
        ${trendChart({ title: `CS at 10:00 on ${champName(S.champ)}`, note: `rolling over ${cn} games`, pts: csPts, yMin: 0, yMax: csMax, ref: null, fmt: (v) => String(Math.round(v)), label: (v) => String(Math.round(v)) })}</div>
      <div>
        <h3>Streaks and sessions</h3>
        <div class="small faint" style="margin-bottom:6px">Win rate by situation; the mark is your overall ${base}%. A session = games less than 45 minutes apart.</div>
        <div class="wrbars">${wrBar('After a win', tl.afterWin, base)}${wrBar('After a loss', tl.afterLoss, base)}${wrBar('After two losses', tl.afterTwoLosses, base)}
          ${tl.byGameNo.map((g) => wrBar(`${g.label} of a session`, g, base)).join('')}</div>
        ${tl.afterTwoLosses.n >= 8 && tl.afterTwoLosses.wr <= base - 8 ? `<div class="notice warn small" style="margin-top:8px">After two losses in a row you win ${tl.afterTwoLosses.wr}% (${tl.afterTwoLosses.n} games). A break after the second loss is worth trying.</div>` : ''}
        ${champPatches.length >= 2 ? `<h3 style="margin-top:12px">${esc(champName(S.champ))} by patch</h3><div class="wrbars">${champPatches.map((p) => wrBar(`Patch ${p.patch}`, p, base)).join('')}</div>` : ''}
      </div>
    </div>
    <h3 style="margin-top:12px">Champions</h3>${champTable}</div>`;
}

// ---------- GAME REPORT ----------
const gk = (n) => (n == null ? '–' : Report.gk(n));
const TONE = { great: 'good', good: 'good', ok: 'info', meh: 'warn', bad: 'warn' };
const DEATH_KIND = { solo: 'Solo vs laner', gank: 'Gank', picked: 'Picked off', outnumbered: 'Outnumbered', teamfight: 'Teamfight', tower: 'Tower / minions' };

function ensureReportList() {
  const RS = Report.state;
  if (RS.listTried || !D.config.hasKey || !Review.state.me) return;
  RS.listTried = true;
  // your averages (for "vs your usual" and the CS target); cached on disk after the first import
  if (!Review.state.games.length && Review.state.status === 'idle') Review.load(D).then(() => { if (RS.sel && S.view === 'report') Report.open(D, RS.sel); });
  Report.loadList(D, { fresh: true }).then((l) => { if (!RS.sel && l.length) Report.open(D, l[0].id); else renderReport(); })
    .catch((e) => { RS.status = 'error'; RS.error = e.message; renderReport(); });
}

function reportGoldChart(R) {
  const s = R.series;
  if (s.length < 3) return '';
  const W = 640, H = 230, L = 50, Rr = 60, T = 22, B = 34;
  const vals = s.flatMap((p) => [p.team, p.lane]).filter((v) => v != null);
  const nice = Math.max(1000, Math.ceil(Math.max(...vals.map(Math.abs)) / 1000) * 1000);
  const tMax = s[s.length - 1].t;
  const x = (t) => L + ((W - L - Rr) * t) / tMax, y = (v) => T + ((H - T - B) / 2) * (1 - v / nice);
  const path = (k) => s.filter((p) => p[k] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const grid = [nice, nice / 2, 0, -nice / 2, -nice].map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'base' : 'grid'}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v === 0 ? '0' : gk(v)}</text>`).join('');
  const ticks = []; for (let m = 0; m * 60 <= tMax; m += 5) ticks.push(`<text x="${x(m * 60)}" y="${H - B + 16}" text-anchor="middle" class="ax">${m}:00</text>`);
  const lastT = s[s.length - 1], lastLane = s.filter((p) => p.lane != null).pop();
  const labels = `<text x="${W - Rr + 6}" y="${y(lastT.team) + 4}" class="ax lbl-team">Team ${gk(lastT.team)}</text>${lastLane ? `<text x="${W - Rr + 6}" y="${y(lastLane.lane) + (Math.abs(y(lastLane.lane) - y(lastT.team)) < 12 ? 16 : 4)}" class="ax lbl-you">You ${gk(lastLane.lane)}</text>` : ''}`;
  const OBJ_LETTER = { Dragon: 'D', Baron: 'B', Herald: 'H', Voidgrub: 'G', Atakhan: 'A' };
  const objs = R.objectives.filter((o) => OBJ_LETTER[o.kind]).filter((o, i, all) => !(o.kind === 'Voidgrub' && all.slice(0, i).some((p) => p.kind === 'Voidgrub' && p.ours === o.ours && Math.abs(p.t - o.t) < 90)));
  const objMarks = objs.map((o) => `<g data-tip="${esc(`${Engine.fmtClock(o.t)} · ${o.ours ? 'Your team' : 'Enemy'} took ${o.sub && o.kind === 'Dragon' ? o.sub + ' ' : ''}${o.kind}`)}"><circle cx="${x(o.t)}" cy="${T - 11}" r="7" fill="var(--${o.ours ? 'pos' : 'neg'})"/><text x="${x(o.t)}" y="${T - 7.5}" text-anchor="middle" class="obj-l">${OBJ_LETTER[o.kind]}</text></g>`).join('');
  const deathMarks = R.deaths.map((d) => `<g data-tip="${esc(`${Engine.fmtClock(d.t)} · you died (${DEATH_KIND[d.kind] || d.kind}) · ${d.killers.join(' + ') || 'tower'} · ${d.timer}s dead`)}"><path d="M${x(d.t) - 4},${H - B - 10}l8,8M${x(d.t) + 4},${H - B - 10}l-8,8" class="death-x"/></g>`).join('');
  const cols = s.map((p, i) => {
    const w = i < s.length - 1 ? x(s[i + 1].t) - x(p.t) : 8;
    return `<rect x="${x(p.t) - w / 2}" y="${T}" width="${Math.max(4, w)}" height="${H - T - B}" fill="transparent" data-tip="${esc(`${Engine.fmtClock(p.t)} · Team ${gk(p.team)}${p.lane != null ? ` · You vs ${R.oppName} ${gk(p.lane)}` : ''}`)}"/>`;
  }).join('');
  return `<figure class="chart"><figcaption><b>Gold difference over the game</b><span class="legend"><span><i style="background:var(--s-team)"></i>Your team vs theirs</span><span><i style="background:var(--s-you)"></i>You vs ${esc(R.oppName)}</span><span><i style="background:var(--pos)"></i>/<i style="background:var(--neg)"></i> objective (yours / theirs)</span><span>✕ your deaths</span></span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team and lane gold difference over time">${grid}${ticks.join('')}${cols}
      <path d="${path('team')}" class="ln ln-team"/><path d="${path('lane')}" class="ln ln-you"/>${labels}${objMarks}${deathMarks}</svg></figure>`;
}

// how well you followed the coach: deaths while it warned you, warnings ignored, the death budget, and the trend
function coachScore(R) {
  const live = R.live;
  if (!live || !arr(live.deaths).length && live.budget == null) return '';
  const warnedOf = (h) => arr(h.deaths).filter((d) => (d.warned != null ? d.warned : d.mode === 'retreat' || d.mode === 'safe')).length;
  const warned = warnedOf(live), b = live.budget;
  const trend = arr(Report.state.hist).filter((h) => h.deaths && (h.endedAt || 0) <= live.endedAt).sort((x, y) => x.endedAt - y.endedAt).slice(-10).map(warnedOf);
  return `<div class="coach-score">
    <div><div class="small muted">Deaths while the coach said no</div><b class="num ${warned ? 'warn-t' : 'good-t'}">${warned}</b> <span class="small muted">of ${arr(live.deaths).length}</span></div>
    ${live.ignored != null ? `<div><div class="small muted">Warnings ignored</div><b class="num ${live.ignored ? 'warn-t' : 'good-t'}">${live.ignored}</b> <span class="small muted">lost health on Back off / Play safe</span></div>` : ''}
    ${b ? `<div><div class="small muted">Death budget</div><b class="num ${b.deaths > b.allowed ? 'warn-t' : 'good-t'}">${b.deaths} / ${b.allowed}</b> <span class="small muted">${b.deaths > b.allowed ? 'broken' : 'kept'}</span></div>` : ''}
    ${trend.length >= 3 ? `<div><div class="small muted">Deaths while the coach said no, last ${trend.length} games</div><span class="num">${trend.join(' · ')}</span></div>` : ''}
  </div>`;
}
function renderReport() {
  const el = $('#view-report');
  if (!el) return;
  const act = document.activeElement, focusId = act && el.contains(act) && ['momentQ', 'momentAt'].includes(act.id) ? act.id : null;
  const sel = focusId ? [act.selectionStart, act.selectionEnd] : null;
  const RS = Report.state, R = RS.R;
  if (!D.config.hasKey) { el.innerHTML = '<div class="notice warn">The game report needs a Riot API key (see Settings).</div>'; return; }
  if (!Review.state.me) { el.innerHTML = '<div class="notice">Open the League client (you are detected automatically) or set your Riot ID on the Review tab.</div>'; return; }
  ensureReportList();
  const games = RS.list.slice(0, RS.listLimit).map((g) => `<button class="rep-game ${g.id === RS.sel ? 'on' : ''}" data-report="${esc(g.id)}" title="${esc(`${Report.QUEUES[g.queue] || 'Game'} · ${g.kda}`)}">
      <span class="chip ${g.win ? 'good' : 'warn'}">${g.win ? 'W' : 'L'}</span><span class="row" style="gap:2px">${champImg(g.champ, 'sm')}${g.opp ? `<span class="faint small">vs</span>${champImg(g.opp, 'sm')}` : ''}</span><span class="small">${g.opp ? esc(champName(g.opp)) : esc(champName(g.champ))}</span>
      <span class="small faint">${new Date(g.end).toLocaleDateString(undefined, { weekday: 'short' })} ${new Date(g.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></button>`).join('');
  const waiting = RS.waiting ? `<div class="notice">Waiting for Riot to publish your last game (usually 1–5 minutes)… this page opens it automatically.</div>` : '';
  // the review agent's suggestions for the playbook (approve them on the Playbook tab)
  const pend = Agent.state.proposals.filter((p) => openChanges(p).length).sort((a, b) => b.at - a.at);
  const reviewing = Agent.state.jobs.find((j) => j.type === 'review' && j.status === 'running');
  const agentNote = pend.length ? `<div class="notice"><b>${pend.reduce((n, p) => n + openChanges(p).length, 0)} suggested playbook changes</b> from the post-game review${pend[0].proposal.summary ? `: ${esc(pend[0].proposal.summary)}` : ''} <button class="btn small ghost" data-action="goto-playbook" data-champ="${esc(pend[0].champ)}">Review changes</button></div>`
    : reviewing ? `<div class="notice small">A review agent is comparing what the playbook said with how this game went (${ago(reviewing.created)}).</div>` : '';
  const head = `<div class="card"><header><h2>Game report</h2><span class="grow"></span><button class="btn small ghost" data-action="report-refresh">Refresh list</button></header>
    <div class="rep-games">${games || (RS.listTried ? '<span class="small muted">Loading your recent games…</span>' : '')}${RS.list.length > RS.listLimit ? `<button class="rep-game more" data-action="report-more">${RS.list.length - RS.listLimit} older…</button>` : ''}</div>${waiting}${agentNote}</div>`;
  if (RS.status === 'loading' && !R) { el.innerHTML = head + '<div class="empty">Building the report…</div>'; return; }
  if (RS.status === 'error') { el.innerHTML = head + `<div class="notice warn">${esc(RS.error)}</div>`; return; }
  if (!R) { el.innerHTML = head; return; }

  const me = R.me, st = R.stats, T = R.T;
  const loss = !R.win;
  // verdict + share of the result
  const shareBar = `<div class="sharebar">${R.mine.slice().sort((a, b) => b.share - a.share).map((p) => p.share > 0 ? `<i class="${p.isMe ? 'me' : ''}" style="flex:${p.share}" data-tip="${esc(`${champName(p.champ)}${p.isMe ? ' (you)' : ''}: ${Math.round(p.share * 100)}% · rating ${p.rating}`)}"></i>` : '').join('')}</div>
    <div class="sharelegend">${R.mine.slice().sort((a, b) => b.share - a.share).map((p) => `<span class="${p.isMe ? 'me' : ''}">${champImg(p.champ, 'sm')}${Math.round(p.share * 100)}%</span>`).join('')}</div>`;
  const verdict = `<div class="card verdict v-${R.tone}">
    <div class="v-top">
      <div class="grow">
        <div class="row"><span class="chip ${R.win ? 'good' : 'warn'}">${R.win ? 'Victory' : 'Defeat'}</span><span class="small muted">${esc(champName(me.champ))} vs ${esc(champName(R.oppName))} · ${Engine.fmtClock(R.dur)} · ${esc(Report.QUEUES[R.queue] || '')} · ${new Date(R.end).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="v-title">${esc(R.verdict)}</div>
        <div class="v-story">${esc(R.story.join('; '))}.</div>
      </div>
      <div class="v-rating"><div class="r-num">${me.rating.toFixed(1)}</div><div class="small muted">rating / 10</div><div class="small">${ordinal(R.teamRank)} of 5 on your team<br>${ordinal(R.matchRank)} of 10 in the game</div></div>
    </div>
    <div class="v-share">
      <div class="row"><b>Your part of the ${R.win ? 'win' : 'loss'}: ${Math.round(me.share * 100)}%</b><span class="small muted">${R.win ? 'share of your team\'s above-average play' : 'share of your team\'s below-average play'}</span></div>
      ${shareBar}
      <div class="small">${me.best.length ? `Strongest: ${esc(me.best.join(', '))}` : ''}${me.best.length && me.worst.length ? ' · ' : ''}${me.worst.length ? `Weakest: ${esc(me.worst.join(', '))}` : ''}</div>
    </div>
    ${coachScore(R)}
    <details class="small muted"><summary>How is this estimated?</summary>Every player is compared with the other nine on KDA, deaths per minute, damage share, kill participation, gold income, gold vs their lane opponent at 15:00, tower/objective damage, vision and damage absorbed, weighted by role (supports by vision and participation, junglers by objectives). 5.5 is an average game. "Your part" splits the ${R.win ? 'above' : 'below'}-average play on your team between the five of you. It can't see good calls, roams or wave management, so treat it as an estimate.</details>
  </div>`;

  const fixHtml = `<div class="card"><header><h2>Improve next game</h2></header>
    ${R.fix.length ? R.fix.map((f, i) => `<div class="fix"><div class="fix-n">${i + 1}</div><div class="grow"><b>${esc(f.title)}</b><div class="small">${esc(f.detail)}</div><div class="small muted">→ ${esc(f.tip)}</div>
      ${f.focus ? `<button class="btn small ghost" data-nextfocus="${f.focus}">${Focus.getPick() === f.focus ? '✓ Next game\'s focus' : 'Make this my next focus'}</button>` : ''}</div></div>`).join('') : '<div class="empty">Nothing big stood out. Keep doing what you did.</div>'}
    ${R.moreFix.length ? `<details class="small"><summary>${R.moreFix.length} more</summary>${R.moreFix.map((f) => `<div style="margin-top:6px"><b>${esc(f.title)}</b> · ${esc(f.detail)}</div>`).join('')}</details>` : ''}
    ${R.good.length ? `<h3 class="good-t" style="margin-top:6px">What went well</h3>${R.good.map((g) => `<div class="small"><b>${esc(g.title)}</b>${g.detail ? ` · <span class="muted">${esc(g.detail)}</span>` : ''}</div>`).join('')}` : ''}
  </div>`;

  // lanes: role vs role
  const pcell = (p) => `<span class="row nowrap">${champImg(p.champ, 'sm')}<span><span class="small">${esc(champName(p.champ))}${p.isMe ? ' <b>(you)</b>' : ''}</span><br><span class="small muted">${p.k}/${p.d}/${p.a} · ${p.cs} CS</span></span></span>`;
  const rchip = (p) => `<span class="rchip ${p.rating >= 6.5 ? 'hi' : p.rating <= 4.5 ? 'lo' : ''}">${p.rating.toFixed(1)}</span>`;
  const maxGd = Math.max(1500, ...R.lanes.map((l) => Math.abs(l.gd15 || 0)));
  const lanesHtml = `<div class="card"><header><h2>Role vs role</h2><span class="small faint">gold difference at 15:00 · rating / 10</span></header>
    <table class="lanes-t"><tbody>${R.lanes.map((l) => `<tr class="${l.ally.isMe ? 'me' : ''}"><td class="small muted">${Report.ROLE_NAME[l.role]}</td><td>${pcell(l.ally)}</td><td class="num">${rchip(l.ally)}</td>
      <td class="gdcell"><div class="lbar" data-tip="${esc(`${Report.ROLE_NAME[l.role]} at 15:00: ${gk(l.gd15)} · end of game: ${gk(l.gdEnd)}`)}">${l.gd15 > 0 ? `<i class="l" style="width:${(50 * l.gd15) / maxGd}%"></i>` : l.gd15 < 0 ? `<i class="r" style="width:${(50 * -l.gd15) / maxGd}%"></i>` : ''}</div><div class="small num center">${gk(l.gd15)}</div></td>
      <td class="num">${rchip(l.enemy)}</td><td>${pcell(l.enemy)}</td></tr>`).join('')}</tbody></table>
    <div class="small faint">Bars: blue = your side ahead, red = behind.</div></div>`;

  // your numbers vs your usual
  const cmp = (v, avg, better = 'high', fmt = (n) => Math.round(n)) => (v == null || avg == null ? '' : `<span class="${(better === 'high' ? v >= avg : v <= avg) ? 'good-t' : 'warn-t'}">your avg ${fmt(avg)}</span>`);
  const tile = (label, value, sub) => `<div class="tile"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const tiles = `<div class="tiles">
    ${tile('CS at 10', st.cs10 ?? '–', [`target ${st.target}`, cmp(st.cs10, T && T.cs10)].filter(Boolean).join(' · '))}
    ${tile('Gold vs opponent @15', gk(st.gd15), cmp(st.gd15, T && T.gd15, 'high', gk))}
    ${tile('Deaths before 14:00', st.earlyDeaths, cmp(st.earlyDeaths, T && T.earlyDeathsPerGame, 'low', (n) => n.toFixed(1)))}
    ${tile('Kill participation', `${Math.round(st.kp * 100)}%`, `damage share ${Math.round(st.dmgShare * 100)}%`)}
    ${tile('Tower damage', `${(st.buildings / 1000).toFixed(1)}k`, `${Math.round(st.buildShare * 100)}% of team · ${st.plates} plates`)}
    ${tile('First item', st.firstItemAt ? Engine.fmtClock(st.firstItemAt) : '–', cmp(st.firstItemAt, T && T.firstItem, 'low', (n) => Engine.fmtClock(n)))}
    ${tile('Vision', st.vision, `${st.cwBought} Control Ward${st.cwBought === 1 ? '' : 's'} bought`)}
  </div>`;

  // deaths + replay jumps
  const rs = Report.REPLAY_STATE[RS.replay] || null;
  const coachBtn = (t, label) => { const a = Moment.answerFor(Moment.keyOf(R.gameId, t)); return `<button class="btn small ${a ? 'ghost' : ''}" data-moment="${Math.round(t)}" data-label="${esc(label)}" title="The replay coach: what went wrong here, second by second">${a ? 'Answer' : 'Coach'}</button>`; };
  const jumpBtn = (t, label = 'Watch') => `<button class="btn small ghost" data-jump="${Math.max(0, Math.round(t - 15))}" title="Jump the replay to 15 seconds before">${label}</button>`;
  const deathsHtml = `<div class="card"><header><h2>Your deaths</h2><span class="small faint">Watch jumps the replay to 15 seconds before</span></header>
    ${R.deaths.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>What</th><th>By</th><th>Where</th><th>Dashboard said</th><th class="num">Dead</th><th></th></tr></thead><tbody>
    ${R.deaths.map((d) => `<tr><td class="num">${Engine.fmtClock(d.t)}</td><td><span class="chip ${['solo', 'gank', 'picked'].includes(d.kind) ? 'warn' : ''}">${esc(DEATH_KIND[d.kind] || d.kind)}</span>${d.behind && d.kind === 'solo' ? ' <span class="small warn-t">while behind</span>' : ''}${d.alliesNear === 0 && d.t >= 1200 ? ' <span class="small warn-t">alone</span>' : ''}</td>
      <td class="small">${esc(d.killers.join(' + ') || 'tower/minions')}</td><td class="small muted">${esc(d.zone)}${d.enemyHalf ? ' · past the river' : ''}</td>
      <td class="small">${d.mode ? esc((MODE_META[d.mode] || {}).name || d.mode) : '<span class="faint">not recorded</span>'}</td><td class="num small">${d.timer}s</td><td class="row" style="gap:4px;flex-wrap:nowrap">${jumpBtn(d.t)}${coachBtn(d.t, `${DEATH_KIND[d.kind] || d.kind}${d.killers.length ? ` · ${d.killers.join(' + ')}` : ''}`)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">You didn\'t die. Nice.</div>'}
    <div class="row small" style="gap:6px">Any other moment: <input id="momentAt" class="input" placeholder="12:34" size="6" style="width:70px"> <button class="btn small ghost" data-moment="custom">Coach it</button></div>
    ${R.missed.length ? `<div class="small muted">Objectives the enemy took while you were far away: ${R.missed.map((o) => `${o.kind} ${Engine.fmtClock(o.t)} ${jumpBtn(o.t, '▶')}`).join(' · ')}</div>` : ''}
  </div>`;
  const cfg = RS.replayCfg;
  const apiOff = RS.replayMsg === 'REPLAY_API_OFF' || (cfg && cfg.found && !cfg.enabled);
  const replayHtml = `<div class="card"><header><h2>Replay</h2>${rs ? `<span class="chip">${esc(rs[0])}</span>` : ''}</header>
    <div class="small">${RS.replay === 'client_closed' ? 'Open the League client to download or watch the replay.' : rs ? esc(rs[1]) : 'Checking the replay…'}</div>
    <div class="row">${['download', 'retryDownload'].includes(RS.replay) ? '<button class="btn small" data-replay="download">Download replay</button>' : ''}${RS.replay === 'watch' ? '<button class="btn small" data-replay="watch">Watch replay</button>' : ''}</div>
    ${RS.replayMsg && RS.replayMsg !== 'REPLAY_API_OFF' ? `<div class="small">${esc(RS.replayMsg)}</div>` : ''}
    ${apiOff ? `<div class="notice warn small">Jumping to a moment and the replay coach's pictures need League's Replay API, which is off. ${cfg && cfg.found
      ? `<button class="btn small" data-action="replay-enable">Turn on the Replay API</button> adds the line <code>EnableReplayApi=1</code> to <code>${esc(cfg.path)}</code> (a copy of the old file is kept next to it). Reopen the replay afterwards.`
      : `One-time setup: close League, open <code>C:\\Riot Games\\League of Legends\\Config\\game.cfg</code> and add the line <code>EnableReplayApi=1</code> under <code>[General]</code>. (With the League client open, Jax Coach can do it for you.)`} Without it you can still watch the replay and skip to the times listed here.</div>` : cfg && cfg.enabled ? '<div class="small good-t">Replay API is on: the Watch buttons jump straight to the moment, and the replay coach can look at it.</div>' : ''}
  </div>`;

  el.innerHTML = `<div class="grid" style="gap:14px">${head}${verdict}
    <div class="two">${fixHtml}<div class="card">${reportGoldChart(R)}</div></div>
    ${tiles}
    <div class="two">${lanesHtml}<div class="col">${deathsHtml}${replayHtml}</div></div>
    ${momentCard(R, cfg)}
  </div>`;
  if (focusId) { const n = document.getElementById(focusId); if (n) { n.focus(); try { n.setSelectionRange(sel[0], sel[1]); } catch {} } }
}

// ---------- the replay coach: one moment, second by second ----------
function momentCard(R, cfg) {
  const M = Moment.state, C = M.cur;
  if (!C || C.gameId !== R.gameId) return '';
  const F = C.facts, a = Moment.answerFor(C.key), pend = M.pending[C.key];
  const fmt = Engine.fmtClock;
  const rmsg = Report.state.replayMsg === 'REPLAY_API_OFF' ? 'The Replay API is off: see the Replay card above.' : Report.state.replayMsg;
  const seek = (sec, label) => (sec == null ? '' : `<button class="btn small ghost" data-seek="${sec}" title="Jump the replay to this second, paused">${label || `⏸ ${fmt(sec)}`}</button>`);
  const facts = `<div class="small muted">What the data shows</div><ul class="moment-facts small">${F.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <details class="small"><summary>Everything in the two minutes before (${F.events.length} events)</summary><div class="moment-events">${F.events.map((e) => `<div><span class="num faint">${esc(e.t)}</span> ${esc(e.text)}</div>`).join('') || '<span class="faint">nothing recorded</span>'}</div></details>`;
  const busy = M.cap ? `<div class="notice small">Capturing the replay ${M.cap.step}/${M.cap.total}… (League may come to the front; don't touch the replay until this is done)</div>`
    : pend ? `<div class="notice small">The coach is looking at this moment (started ${ago(new Date(pend.at).toISOString())} ago). Usually under two minutes.</div>` : '';
  const ask = Agent.ready() ? `<textarea id="momentQ" class="input" rows="2" placeholder="Optional: what do you want to know? e.g. Was I safe under my tower here? Should I have backed?">${esc(M.q || '')}</textarea>
    <div class="row">
      <button class="btn" data-moment-ask="replay" ${M.cap || pend ? 'disabled' : ''} title="Opens nothing by itself: start the replay first (Watch replay). The coach pauses it at 6 points before the moment and takes pictures of it.">Look at the replay and coach me</button>
      <button class="btn ghost" data-moment-ask="data" ${M.cap || pend ? 'disabled' : ''}>Coach me from the data only</button>
      ${seek(Math.max(0, C.t - 20), `▶ Watch from ${fmt(Math.max(0, C.t - 20))}`)}
    </div>
    <div class="small faint">With the replay the coach also sees the minion waves, health bars and where everyone stood${cfg && !cfg.enabled ? ' (needs the Replay API, see the Replay card)' : ''}.</div>`
    : '<div class="notice small">The replay coach needs Claude Code (see the Playbook tab).</div>';
  const ans = a ? (() => {
    const P = a.personal && (arr(a.personal.addRules).length || arr(a.personal.addHints).length) ? a.personal : null;
    return `<div class="moment-answer">
      ${a.question ? `<div class="small muted">You asked: ${esc(a.question)}</div>` : ''}
      ${a.headline ? `<div class="moment-head">${esc(a.headline)}</div>` : ''}
      ${a.mistakeAt != null ? `<div class="row small">It went wrong at <b class="num">${fmt(a.mistakeAt)}</b> ${seek(a.mistakeAt, '⏸ Show me')}</div>` : ''}
      ${a.steps.length ? `<ol class="moment-steps">${a.steps.map((s) => `<li><div class="row" style="gap:6px">${s.sec != null ? `<b class="num">${fmt(s.sec)}</b>${seek(s.sec, '⏸')}` : ''}<span>${esc(s.what)}</span></div>${s.instead ? `<div class="moment-instead"><b>Instead:</b> ${esc(s.instead)}</div>` : ''}</li>`).join('')}</ol>` : ''}
      ${a.answer ? `<div class="small">${esc(a.answer)}</div>` : ''}
      ${a.lesson ? `<div class="notice good small"><b>Remember:</b> ${esc(a.lesson)}</div>` : ''}
      ${a.watchFor ? `<div class="small"><b>See it coming:</b> ${esc(a.watchFor)}</div>` : ''}
      ${a.confidence ? `<div class="small faint">${esc(a.confidence)}</div>` : ''}
      ${P ? `<div class="notice small"><b>Suggested rule for the dashboard:</b> ${esc(P.title || [...arr(P.addRules).map((r) => r.headline || r.id), ...arr(P.addHints).map((h) => h.text)].join(' · '))}${P.why ? `<div class="faint">${esc(P.why)}</div>` : ''}
        ${a.personalDone ? `<div class="small good-t">${a.personalDone === 'added' ? 'Added to your rules (Playbook tab → What the coach learned about you).' : 'Skipped.'}</div>` : `<div class="row"><button class="btn small" data-moment-rule="add">Add to my rules</button><button class="btn small ghost" data-moment-rule="skip">No thanks</button></div>`}</div>` : ''}
      ${a.shots && a.shots.length ? `<details class="small"><summary>The pictures the coach looked at (${a.shots.length})</summary><div class="moment-shots">${a.shots.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.url)}" alt="replay at ${esc(s.clock)}" loading="lazy"><span>${esc(s.clock)}${s.fog ? ' · fog on' : ''}</span></a>`).join('')}</div></details>` : ''}
    </div>`;
  })() : '';
  return `<div class="card moment" id="momentCard"><header><h2>Replay coach</h2><span class="chip">${fmt(C.t)}${C.label ? ` · ${esc(C.label)}` : ''}</span><span class="grow"></span><button class="btn small ghost" data-action="moment-close">Close</button></header>
    <div class="two"><div>${facts}</div><div class="col">${busy}${M.msg ? `<div class="notice warn small">${esc(M.msg)}</div>` : ''}${ask}${rmsg ? `<div class="small">${esc(rmsg)}</div>` : ''}</div></div>
    ${ans}
  </div>`;
}
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

function renderStatic() { renderMatchups(); renderBuild(); renderPlan(); renderSources(); renderPlaybook(); }

// ---------- wiring ----------
function setView(v) {
  S.view = v;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === `view-${v}`));
  if (v === 'live') renderLive();
  if (v === 'build') renderBuild();
  if (v === 'playbook') { renderPlaybook(); Agent.refreshJobs(); Playbooks.refreshList(); }
  if (v === 'report') {
    renderReport();
    fetch('/api/replay/config').then((r) => r.json()).then((c) => { Report.state.replayCfg = c; if (S.view === 'report') renderReport(); }).catch(() => {});
    if (Report.state.R) Report.replayStatus();
  }
  if (v === 'review') {
    renderReview();
    if (S.reviewStale && Review.state.me && D.config.hasKey && Review.state.status !== 'loading') { S.reviewStale = false; Review.load(D); }
  }
  window.scrollTo(0, 0);
}
function startDemo() {
  S.demo = true; S.memory = Engine.newMemory(); S.overrideOpp = null; S.modeState = { cur: null, pending: null, pendingCount: 0, changedAt: 0 };
  $('#demoBar').hidden = false; setView('live'); poll();
}
function stopDemo() {
  S.demo = false; clearInterval(S.demoTimer); S.demoTimer = null; $('#demoPlay').textContent = 'Play';
  $('#demoBar').hidden = true; S.memory = Engine.newMemory(); S.game = null; S.A = null; poll();
}
function wireUi() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
  document.body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-opp],[data-mu],[data-phase],[data-goto],[data-action],[data-csopp],[data-game],[data-mu-open],[data-focus],[data-report],[data-jump],[data-replay],[data-moment],[data-moment-ask],[data-seek],[data-moment-rule],[data-nextfocus],[data-pbsel],[data-usechamp],[data-research],[data-activate],[data-cancel],[data-apply],[data-skip],[data-dismiss],[data-range]');
    if (!t) return;
    if (t.dataset.range) { Review.setRange(t.dataset.range); return; }
    // playbooks + research agents
    if (t.dataset.action === 'update-open') { $('#settingsBtn').click(); return; }
    if (t.dataset.action === 'why') { S.showWhy = !S.showWhy; renderLive(); return; }
    if (t.dataset.action === 'reassess') { Agent.reassessNow(S.A, D); renderLive(); return; }
    if (t.dataset.action === 'chat-undo') { Agent.undoChatPlan(); renderLive(); return; }
    if (t.dataset.action === 'loadout-apply') { applyLoadout(); return; }
    if (t.dataset.action === 'goto-playbook') { S.pbSel = t.dataset.champ || S.champ; setView('playbook'); return; }
    if (t.dataset.action === 'agent-login') { Agent.login(); return; }
    if (t.dataset.action === 'agent-check') { Agent.refreshStatus(true).then(() => { renderPlaybook(); renderLive(); }); return; }
    if (t.dataset.pbsel) { S.pbSel = t.dataset.pbsel; Playbooks.load(S.pbSel, true).then(renderPlaybook); renderPlaybook(); return; }
    if (t.dataset.usechamp) { useChamp(t.dataset.usechamp).then(() => { renderPlaybook(); renderLive(); }); return; }
    if (t.dataset.profiles) { S.profileTried = S.profileTried || {}; S.profileTried[t.dataset.profiles] = true; Agent.profiles(D, t.dataset.profiles).then(renderPlaybook); return; }
    if (t.dataset.personalRemove) {
      const [kind, id] = t.dataset.personalRemove.split(':');
      const cur = Playbooks.personal || {};
      Playbooks.savePersonal({ ...cur, [kind]: arr(cur[kind]).filter((x) => x.id !== id), log: [...arr(cur.log), { at: new Date().toISOString(), note: `removed ${kind} ${id}` }].slice(-50) })
        .then(() => { applyPlaybook(); renderPlaybook(); }).catch((e) => alert(`Couldn't save: ${e.message}`));
      return;
    }
    if (t.dataset.research) { Agent.research(D, t.dataset.research, Playbooks.has(t.dataset.research) ? 'refresh' : 'new').then(renderPlaybook); return; }
    if (t.dataset.activate) { Playbooks.activate(t.dataset.activate, +t.dataset.v).then(() => (t.dataset.activate === S.champ ? useChamp(S.champ, { fresh: true }) : null)).then(renderPlaybook).catch((err) => alert(err.message)); return; }
    if (t.dataset.cancel) { Agent.cancel(t.dataset.cancel); return; }
    if (t.dataset.apply) { applyProposal(t.dataset.apply, +t.dataset.idx); return; }
    if (t.dataset.skip) { decideProposal(t.dataset.skip, +t.dataset.idx, 'skipped'); renderPlaybook(); return; }
    if (t.dataset.dismiss) { Agent.dismissProposal(t.dataset.dismiss); renderPlaybook(); return; }
    if (t.dataset.focus) { Focus.setPick(t.dataset.focus); renderLive(); return; }
    if (t.dataset.report) { Moment.close(); Report.open(D, t.dataset.report); return; }
    if (t.dataset.moment) {
      const RS = Report.state;
      if (!RS.R || !RS.raw) return;
      let sec = +t.dataset.moment, label = t.dataset.label || '';
      if (t.dataset.moment === 'custom') {
        const m = String(($('#momentAt') || {}).value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m || +m[2] > 59) { alert('Type the game time as minutes:seconds, e.g. 12:34'); return; }
        sec = +m[1] * 60 + +m[2];
        if (sec > RS.R.dur) { alert(`The game was only ${Engine.fmtClock(RS.R.dur)} long.`); return; }
      }
      Moment.open(D, RS.R, RS.raw, sec, label);
      setTimeout(() => { const c = $('#momentCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
      return;
    }
    if (t.dataset.momentAsk) { const q = $('#momentQ'); if (q) Moment.state.q = q.value; Moment.ask(D, Report.state.R, t.dataset.momentAsk === 'replay'); return; }
    if (t.dataset.seek) { Report.jump(+t.dataset.seek, true); return; }
    if (t.dataset.momentRule) {
      const C = Moment.state.cur, a = C && Moment.answerFor(C.key);
      if (!a || !a.personal) return;
      if (t.dataset.momentRule === 'skip') { Moment.markPersonal(C.key, 'skipped'); return; }
      savePersonalChange(a.personal, `replay:${a.jobId}`, `Replay coach: ${a.personal.title || a.headline || Engine.fmtClock(C.t)}`)
        .then((n) => { if (n) Moment.markPersonal(C.key, 'added'); else alert("The suggested rule doesn't fit the playbook format, so it wasn't added."); })
        .catch((e) => alert(`Couldn't save: ${e.message}`));
      return;
    }
    if (t.dataset.jump) { Report.jump(+t.dataset.jump); return; }
    if (t.dataset.replay) { Report.replayAction(t.dataset.replay); return; }
    if (t.dataset.nextfocus) { Focus.setPick(t.dataset.nextfocus); renderReport(); return; }
    if (t.dataset.action === 'moment-close') { Moment.close(); return; }
    if (t.dataset.action === 'replay-enable') {
      fetch('/api/replay/config', { method: 'POST', body: JSON.stringify({ enable: true }) }).then((r) => r.json())
        .then((c) => { Report.state.replayCfg = c; if (c.enabled) Report.state.replayMsg = 'Replay API is on. If a replay is open, close it and open it again.'; else if (c.error) alert(`Couldn't change game.cfg: ${c.error}`); renderReport(); })
        .catch((e) => alert(`Couldn't change game.cfg: ${e.message}`));
      return;
    }
    if (t.dataset.action === 'report-refresh') { Report.loadList(D, { fresh: true }).then(renderReport).catch(() => {}); return; }
    if (t.dataset.action === 'open-report') { setView('report'); return; }
    if (t.dataset.action === 'voice') {
      if (t.dataset.state === 'locked') Voice.say('Voice callouts on.', { key: 'unlock', urgent: true, repeatAfter: 1 });
      else Voice.setEnabled(t.dataset.state === 'off');
      renderLive(); renderStatus(); return;
    }
    if (t.dataset.action === 'review-load') { if (Review.state.status === 'done') Archive.sync(D, { fresh: true }); else Review.load(D); renderReview(); return; }
    if (t.dataset.action === 'review-all-rows') { S.reviewAllRows = true; renderReview(); return; }
    if (t.dataset.action === 'report-more') { Report.state.listLimit += 20; renderReport(); return; }
    if (t.dataset.csopp) { S.csOpp = t.dataset.csopp; renderLive(); return; }
    if (t.dataset.game) { Review.state.open = Review.state.open === t.dataset.game ? null : t.dataset.game; renderReview(); return; }
    if (t.dataset.muOpen) { S.muSel = t.dataset.muOpen; renderMatchups(); setView('matchups'); return; }
    if (t.dataset.opp) { S.overrideOpp = t.dataset.opp; S.muSel = t.dataset.opp; poll(); }
    else if (t.dataset.mu) { S.muSel = t.dataset.mu; renderMatchups(); }
    else if (t.dataset.phase) { S.planPhase = t.dataset.phase; renderPlan(); }
    else if (t.dataset.goto) { if (S.A && S.A.P.opp && D.matchups[S.A.P.opp.cid]) S.muSel = S.A.P.opp.cid; renderMatchups(); setView(t.dataset.goto); }
    else if (t.dataset.action === 'demo') startDemo();
  });
  document.body.addEventListener('change', (e) => {
    if (e.target.id !== 'pbAdd' || !e.target.value) return;
    const cid = e.target.value;
    S.pbSel = cid;
    if (Agent.ready()) Agent.research(D, cid, 'new').then(renderPlaybook); else renderPlaybook();
  });
  $('#champChip').addEventListener('click', () => { S.pbSel = S.champ; setView('playbook'); });
  document.body.addEventListener('input', (e) => {
    if (e.target.id === 'askInput') S.askDraft = e.target.value;
    if (e.target.id === 'momentQ') Moment.state.q = e.target.value;
    if (e.target.id === 'muSearch') {
      S.muFilter = e.target.value; const pos = e.target.selectionStart; renderMatchups();
      const s = $('#muSearch'); s.focus(); s.setSelectionRange(pos, pos);
    }
  });
  document.body.addEventListener('submit', (e) => {
    if (e.target.id === 'askForm') {
      e.preventDefault();
      if (Agent.ask(S.askDraft, S.demo ? null : S.A, D, S.A ? null : S.cs)) { S.askDraft = ''; renderLive(); const n = $('#askInput'); if (n) n.focus(); }
      return;
    }
    if (e.target.id !== 'idForm') return;
    e.preventDefault();
    const [gameName, tagLine] = String(new FormData(e.target).get('rid') || '').split('#').map((s) => s.trim());
    if (!gameName || !tagLine) return;
    Review.state.me = null; Review.setIdentity({ gameName, tagLine }); Review.load(D);
  });
  // chart tooltips
  document.body.addEventListener('mousemove', (e) => {
    const tip = $('#tip');
    if (!tip) return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 14}px`;
  });

  const slider = $('#demoSlider');
  const setDemoT = (t) => { S.demoT = Math.min(2400, t); slider.value = S.demoT; $('#demoClock').textContent = Engine.fmtClock(S.demoT); };
  slider.addEventListener('input', () => { if (+slider.value < S.demoT) S.memory = Engine.newMemory(); setDemoT(+slider.value); poll(); });
  $('#demoPlay').addEventListener('click', () => {
    if (S.demoTimer) { clearInterval(S.demoTimer); S.demoTimer = null; $('#demoPlay').textContent = 'Play'; return; }
    $('#demoPlay').textContent = 'Pause';
    S.demoTimer = setInterval(() => { setDemoT(S.demoT + 5); poll(); if (S.demoT >= 2400) $('#demoPlay').click(); }, 500);
  });
  $('#demoExit').addEventListener('click', stopDemo);
  setDemoT(S.demoT);

  const dlg = $('#settings');
  const fillVoice = () => {
    const c = Voice.config(), groq = D.config.hasGroq, kokoro = D.config.hasKokoro;
    const opts = [];
    if (kokoro) {
      opts.push('<optgroup label="Local voice (Kokoro, on this PC, no limits)">');
      for (const v of Voice.kokoroVoices) opts.push(`<option value="kokoro:${v.id}">${v.name} (${v.female ? 'female' : 'male'})</option>`);
      opts.push('</optgroup>');
    }
    if (groq) {
      opts.push('<optgroup label="Natural voices (Groq)">');
      for (const v of Voice.groqVoices) opts.push(`<option value="groq:${v.id}">${v.name} (${v.female ? 'female' : 'male'})</option>`);
      opts.push('</optgroup>');
    }
    opts.push('<optgroup label="System voices">');
    for (const v of Voice.browserVoices()) opts.push(`<option value="sys:${esc(v.uri)}">${esc(v.name)}</option>`);
    opts.push('</optgroup>');
    $('#vVoice').innerHTML = opts.join('');
    const eng = Voice.engine();
    // a local voice can be a mix: "af_nicole:70+bf_isabella:30" -> main voice + second voice with its share
    const mix = parseMix(c.kokoroVoice);
    $('#vVoice').value = eng === 'kokoro' ? `kokoro:${mix[0].id}` : eng === 'groq' ? `groq:${c.groqVoice}` : `sys:${c.browserVoice || (Voice.browserVoices()[0] || {}).uri || ''}`;
    $('#vMix').innerHTML = '<option value="">No mix</option>' + Voice.kokoroVoices.map((v) => `<option value="${v.id}">${v.name}</option>`).join('');
    $('#vMix').value = mix[1] ? mix[1].id : '';
    $('#vMixAmt').value = mix[1] ? mix[1].w : 30;
    $('#vStyle').innerHTML = Voice.styles.map((s) => `<option value="${s}">${s ? s[0].toUpperCase() + s.slice(1) : 'Natural (no direction)'}</option>`).join('');
    $('#vStyle').value = c.style || '';
    $('#vSpeed').value = String(c.kokoroSpeed || 1.05);
    $('#vVolume').value = c.volume;
    $('#vChime').checked = c.chime;
    const syncExtras = () => {
      const v = $('#vVoice').value, k = v.startsWith('kokoro:');
      $('#vStyleWrap').hidden = !v.startsWith('groq:'); $('#vSpeedWrap').hidden = !k; $('#vMixWrap').hidden = !k;
      $('#vMixAmt').disabled = !$('#vMix').value;
      const main = (Voice.kokoroVoices.find((x) => `kokoro:${x.id}` === v) || {}).name || '', other = (Voice.kokoroVoices.find((x) => x.id === $('#vMix').value) || {}).name;
      $('#vMixAmtTxt').textContent = other ? `${100 - +$('#vMixAmt').value}% ${main.replace(/ \(.*/, '')} · ${$('#vMixAmt').value}% ${other.replace(/ \(.*/, '')}` : '';
    };
    $('#vVoice').onchange = syncExtras; $('#vMix').onchange = syncExtras; $('#vMixAmt').oninput = syncExtras; syncExtras();
    $('#voiceInfo').textContent = kokoro
      ? `Local voices run on this PC (CPU only, low priority, so the game always comes first). No limits: names and numbers are fine. Each sentence is made once (about 1–2 s) and cached.${groq ? ' Groq voices are limited to 10 new lines a minute and 100 a day on the free tier; the local voice fills in when that runs out.' : ''}`
      : groq ? 'Natural voices come from Groq (Orpheus): 10 new lines a minute, 100 a day on the free tier. Each line is cached, so repeats are free.'
        : 'Using your system voices.';
    $('#vTestNote').textContent = '';
  };
  const voiceFromForm = () => {
    const v = $('#vVoice').value;
    const c = { style: $('#vStyle').value, volume: +$('#vVolume').value, chime: $('#vChime').checked, kokoroSpeed: +$('#vSpeed').value };
    if (v.startsWith('kokoro:')) {
      const main = v.slice(7), other = $('#vMix').value, amt = +$('#vMixAmt').value;
      Object.assign(c, { engine: 'kokoro', kokoroVoice: other && other !== main ? `${main}:${100 - amt}+${other}:${amt}` : main });
    }
    else if (v.startsWith('groq:')) Object.assign(c, { engine: 'groq', groqVoice: v.slice(5) });
    else Object.assign(c, { engine: 'browser', browserVoice: v.slice(4) });
    return c;
  };
  $('#vTest').addEventListener('click', () => {
    const v = $('#vVoice').value;
    Voice.test(undefined, voiceFromForm());
    $('#vTestNote').textContent = v.startsWith('kokoro:') ? 'The first time takes a second or two (made on this PC), then it\'s cached.' : v.startsWith('groq:') ? 'The first time takes a second (generating), then it\'s cached.' : '';
    setTimeout(() => { if (Voice.lastError()) $('#vTestNote').textContent = `Voice failed: ${Voice.lastError()} (used a fallback voice)`; }, 6000);
  });
  $('#settingsBtn').addEventListener('click', () => {
    $('#platform').value = D.config.platform || 'euw1';
    $('#apiKey').value = '';
    $('#keyHint').textContent = D.config.hasKey ? `A key is set (${D.config.keyHint}${D.config.keySource ? ', from ' + D.config.keySource.replace(/^.*[\\/]/, '') : ''}). Leave the field empty to keep it.` : 'No key set.';
    fillVoice();
    dlg.showModal();
    loadStorage();
    if (!S.update || !S.update.current) loadUpdateInfo(); else renderUpdate();
  });
  $('#updates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-upd]');
    if (b && b.dataset.upd === 'check') checkUpdate();
    if (b && b.dataset.upd === 'apply') applyUpdate();
  });
  $('#storage').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    const row = b.closest('.st-row');
    if (!confirm(`Clear "${row.dataset.label}" (${row.dataset.size})? ${row.dataset.note}`)) return;
    b.disabled = true; b.textContent = 'Clearing…';
    loadStorage(b.dataset.clear);
  });
  $('#settingsForm').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value !== 'save') return;
    Voice.setConfig(voiceFromForm());
    const body = { platform: $('#platform').value };
    const k = $('#apiKey').value.trim();
    if (k) body.riotApiKey = k;
    try { D.config = await (await fetch('/api/config', { method: 'POST', body: JSON.stringify(body) })).json(); } catch {}
    Voice.setAvailable({ groq: D.config.hasGroq, kokoro: D.config.hasKokoro, kokoroPort: D.config.kokoroPort });
    Scout.reset(); poll();
  });
}

boot();
