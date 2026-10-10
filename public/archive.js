// Jax Coach - your match archive.
// Imports every Summoner's Rift game Riot still has for you (about two years back) while you're not playing, paced
// well under the API key's limit. The server keeps each match for good (history\matches), so your history outlives
// Riot's. One summary row per game (history\games) feeds Review, the game report list, your stats and the agents.

const Archive = (() => {
  const ROW_V = 3;                 // bump when the row format changes: rows are rebuilt from the archive (no Riot calls)
  const QUEUES = [420, 440, 400, 490];                // solo/duo, flex, draft, quickplay
  const PACE_MS = 1500;            // ~80 Riot calls per 2 minutes (a development key allows 100), leaves room for scouting
  const S = {
    status: 'idle', rows: [], byId: new Map(), have: { m: new Set(), t: new Set() }, meta: {}, loaded: false,
    listed: 0, todo: 0, done: 0, error: null, pausedFor: null, lastSync: 0,
  };
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch {} });
  let busy = () => null;           // the app tells us when to hold off (in game, champ select): returns a reason or null
  let lastRiot = 0, running = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJSON(url, opts) { const r = await fetch(url, { cache: 'no-store', ...opts }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function load(force = false) {
    if (S.loaded && !force) return;
    const [a, rows] = await Promise.all([getJSON('/api/archive'), getJSON('/api/archive/rows')]);
    S.meta = a.meta || {};
    S.have = { m: new Set(a.matches || []), t: new Set(a.timelines || []) };
    S.rows = rows || [];
    S.byId = new Map(S.rows.map((r) => [r.id, r]));
    S.loaded = true;
    changed();
  }
  async function saveRow(row) {
    await post(`/api/archive/rows/${row.id}`, row);
    if (!S.byId.has(row.id)) S.rows.push(row); else S.rows[S.rows.indexOf(S.byId.get(row.id))] = row;
    S.byId.set(row.id, row);
  }

  const whoOf = (me) => (me && me.gameName ? `${me.gameName}#${me.tagLine}`.toLowerCase() : null);
  const who = () => whoOf(Review.state.me);
  // your games (newest first); rows of another Riot ID on this PC are ignored
  const mine = () => { const w = who(); return S.rows.filter((r) => r.who === w).sort((a, b) => b.end - a.end); };

  // PUUIDs are encrypted per API key, so a match archived with an older key may carry a different one: fall back to
  // the Riot ID that match-v5 also lists
  function findMe(m, puuid) {
    const ps = (m && m.info && m.info.participants) || [];
    const me = Review.state.me || {};
    return ps.find((p) => p.puuid === puuid)
      || ps.find((p) => p.riotIdGameName && me.gameName && p.riotIdGameName.toLowerCase() === me.gameName.toLowerCase() && String(p.riotIdTagline || '').toLowerCase() === String(me.tagLine || '').toLowerCase())
      || null;
  }

  // ---------- one game -> one row ----------
  function buildRow(D, id, m, tl, puuid) {
    const info = m.info, me = findMe(m, puuid);
    if (!me) return null;
    const cid = (p) => D.dd.keyToId[String(p.championId)] || p.championName;
    const team = info.participants.filter((p) => p.teamId === me.teamId), foes = info.participants.filter((p) => p.teamId !== me.teamId);
    const pos = me.teamPosition || '';
    const opp = pos ? foes.find((p) => p.teamPosition === pos) : null;
    const teamKills = team.reduce((s, p) => s + p.kills, 0), teamDmg = team.reduce((s, p) => s + (p.totalDamageDealtToChampions || 0), 0);
    const [maj, min] = String(info.gameVersion || '').split('.');
    const row = {
      id, v: ROW_V, who: who(), end: info.gameEndTimestamp || info.gameStartTimestamp + info.gameDuration * 1000, dur: info.gameDuration,
      queue: info.queueId, patch: maj ? `${+maj + 10}.${min}` : '', champ: cid(me), role: pos, win: !!me.win, remake: !!me.gameEndedInEarlySurrender,
      k: me.kills, d: me.deaths, a: me.assists, cs: me.totalMinionsKilled + me.neutralMinionsKilled, gold: me.goldEarned,
      dmgShare: teamDmg ? Math.round((me.totalDamageDealtToChampions / teamDmg) * 1000) / 1000 : null,
      kp: teamKills ? Math.round(((me.kills + me.assists) / teamKills) * 1000) / 1000 : null, vision: me.visionScore,
      opp: opp ? cid(opp) : null, allies: team.filter((p) => p !== me).map(cid), enemies: foes.map(cid), detail: null,
    };
    if (tl && !row.remake) { try { row.detail = Review.analyzeGame(D, m, tl, me.puuid); } catch (e) { console.warn('archive: analysis failed', id, e); } }
    return row;
  }
  // timelines (minute-by-minute) only where the review uses them: top lane and your playbook champions
  function wantDetail(r, pool) { return !r.remake && r.dur >= 600 && (r.role === 'TOP' || pool.has(r.champ)); }
  const poolSet = () => new Set([...Playbooks.list.map((p) => p.champion), Review.state.champ].filter((c) => c && c !== '_generic'));

  // ---------- Riot calls: archived ones are free, new ones wait their turn ----------
  async function turn(real) {
    for (let why = busy(); why; why = busy()) { if (S.pausedFor !== why) { S.pausedFor = why; changed(); } await sleep(5000); }
    if (S.pausedFor) { S.pausedFor = null; changed(); }
    if (real) { const w = lastRiot + PACE_MS - Date.now(); if (w > 0) await sleep(w); lastRiot = Date.now(); }
  }
  async function fetchMatch(id) { await turn(!S.have.m.has(id)); const m = await Scout.api('match', `/lol/match/v5/matches/${id}`); if (m) S.have.m.add(id); return m; }
  async function fetchTimeline(id) { await turn(!S.have.t.has(id)); const t = await Scout.api('match', `/lol/match/v5/matches/${id}/timeline`); if (t) S.have.t.add(id); return t; }

  async function addGame(D, id, puuid) {
    const m = await fetchMatch(id);
    if (!m || !m.info || m.info.mapId !== 11) return null;
    let row = buildRow(D, id, m, null, puuid);
    if (row && wantDetail(row, poolSet())) {
      const tl = await fetchTimeline(id);
      row = buildRow(D, id, m, tl, puuid);
      if (row && !tl) row.noTimeline = true;           // Riot no longer has it: don't ask again
    }
    if (row) await saveRow(row);
    return row;
  }

  // ---------- the import ----------
  // Lists your games per queue (100 per call) until it reaches games it already has, then downloads what's new,
  // newest first. A first import walks back as far as Riot goes; it resumes where it stopped if interrupted.
  function sync(D, { fresh = false } = {}) {
    if (running) return running;
    running = (async () => {
      try {
        S.lastAttempt = Date.now();
        await load();
        const puuid = await Review.ensurePuuid(D);
        const w = who();
        S.status = 'running'; S.error = null; S.listed = 0; S.todo = 0; S.done = 0; changed();
        const meta = S.meta[w] || (S.meta[w] = { complete: {} });
        const ids = [];
        for (const q of QUEUES) {
          for (let start = 0; ; start += 100) {
            await turn(true);
            const page = (await Scout.api('match', `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${q}&start=${start}&count=100${fresh && start === 0 ? '&jcfresh=1' : ''}`)) || [];
            ids.push(...page); S.listed = ids.length; changed();
            if (page.length < 100) { meta.complete[q] = true; break; }
            if (meta.complete[q] && page.every((id) => S.byId.has(id))) break;
          }
        }
        meta.lastList = Date.now();
        await post('/api/archive/meta', S.meta);
        const pool = poolSet();
        const stale = (r) => r.v < ROW_V || (!r.detail && !r.noTimeline && wantDetail(r, pool));
        const todo = [...new Set([...ids, ...mine().filter(stale).map((r) => r.id)])]
          .filter((id) => { const r = S.byId.get(id); return !r || stale(r); })
          .sort((a, b) => +b.split('_')[1] - +a.split('_')[1]);
        S.todo = todo.length; changed();
        for (const id of todo) {
          try { await addGame(D, id, puuid); } catch (e) { if (e.status === 401 || e.status === 403) throw e; console.warn('archive: skipped', id, e.message); }
          S.done++; changed();
        }
        S.status = 'done'; S.lastSync = Date.now();
      } catch (e) {
        S.status = e.message === 'no_identity' ? 'idle' : 'error';
        S.error = e.message === 'no_identity' ? null : e.message;
      } finally { running = null; changed(); }
    })();
    return running;
  }

  // ---------- stats over rows ----------
  const pctOf = (xs) => (xs.length ? Math.round((xs.filter((r) => r.win).length / xs.length) * 100) : null);
  const mean = (xs) => { const v = xs.filter((x) => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // a session = games less than 45 minutes apart
  function sessions(rows) {
    const asc = rows.slice().sort((a, b) => a.end - b.end), out = [];
    let cur = [];
    for (const r of asc) {
      if (cur.length && (r.end - r.dur * 1000) - cur[cur.length - 1].end > 45 * 60000) { out.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function stats(rows) {
    rows = rows.filter((r) => !r.remake);
    const byChamp = {};
    for (const r of rows) {
      const c = byChamp[r.champ] = byChamp[r.champ] || { champ: r.champ, games: [], roles: {} };
      c.games.push(r); c.roles[r.role] = (c.roles[r.role] || 0) + 1;
    }
    const champs = Object.values(byChamp).map((c) => ({
      champ: c.champ, n: c.games.length, wr: pctOf(c.games), last: Math.max(...c.games.map((g) => g.end)),
      kda: mean(c.games.map((g) => (g.k + g.a) / Math.max(1, g.d))), csm: mean(c.games.map((g) => g.cs / (g.dur / 60))),
      role: Object.entries(c.roles).sort((a, b) => b[1] - a[1])[0][0],
    })).sort((a, b) => b.n - a.n);
    // after a win / after a loss, and by game number within a session
    const ss = sessions(rows);
    const afterW = [], afterL = [], afterLL = [], byNo = [[], [], [], []];
    for (const s of ss) s.forEach((r, i) => {
      byNo[Math.min(i, 3)].push(r);
      if (i >= 1) (s[i - 1].win ? afterW : afterL).push(r);
      if (i >= 2 && !s[i - 1].win && !s[i - 2].win) afterLL.push(r);
    });
    const byPatch = {};
    for (const r of rows) (byPatch[r.patch] = byPatch[r.patch] || []).push(r);
    return {
      n: rows.length, wr: pctOf(rows), first: rows.length ? Math.min(...rows.map((r) => r.end)) : null,
      champs, sessions: ss.length, perSession: ss.length ? rows.length / ss.length : null,
      tilt: { afterWin: { n: afterW.length, wr: pctOf(afterW) }, afterLoss: { n: afterL.length, wr: pctOf(afterL) }, afterTwoLosses: { n: afterLL.length, wr: pctOf(afterLL) },
        byGameNo: byNo.map((g, i) => ({ label: i < 3 ? `Game ${i + 1}` : 'Game 4+', n: g.length, wr: pctOf(g) })) },
      patches: Object.entries(byPatch).map(([p, g]) => ({ patch: p, n: g.length, wr: pctOf(g) })).sort((a, b) => b.patch.localeCompare(a.patch, undefined, { numeric: true })),
    };
  }
  // your record on a champion against one opponent (for champ select and the agents)
  function vs(champ, opp) {
    const g = mine().filter((r) => r.champ === champ && r.opp === opp && !r.remake);
    if (!g.length) return null;
    const d = g.map((r) => r.detail).filter(Boolean);
    return {
      games: g.length, wins: g.filter((r) => r.win).length,
      goldDiff15: mean(d.map((x) => x.at15 && x.at15.goldDiff)), deathsBefore14: d.length ? mean(d.map((x) => x.deaths.filter((y) => y.t < 840).length)) : null,
      soloDeathsBefore14: d.length ? mean(d.map((x) => x.deaths.filter((y) => y.t < 840 && y.kind === 'solo').length)) : null,
      underOwnTowerBefore14: d.length ? mean(d.map((x) => x.deaths.filter((y) => y.t < 840 && y.underOwnTower).length)) : null,
    };
  }

  return {
    state: S, load, sync, addGame, findMe, stats, vs, sessions, QUEUES,
    rows: mine, row: (id) => S.byId.get(id) || null,
    get running() { return !!running; },
    setBusy: (fn) => { busy = fn; },
    onChange: (fn) => listeners.push(fn),
  };
})();
