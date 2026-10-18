// Jax Coach - one focus per game.
// Picks the single habit that costs you the most (from your Review data), says it in the start briefing,
// tracks it live from the scoreboard + kill feed, and grades it when the game ends. Results are saved with
// the game record, so a focus you've passed three games in a row makes room for the next one.

const Focus = (() => {
  const LS_PICK = 'jc_focus_pick';
  const CW = '2055';                                  // Control Ward
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let history = [];

  const DEFS = {
    behind_fights: {
      title: () => 'No 1v1s while behind',
      goal: () => 'Zero solo deaths while you are a level down, behind in gold, or the coach says "Don\'t fight".',
      how: 'Level down, gold down or farm down means last-hit only. Trade back only if they commit first, and wait for your item or level.',
      spoken: () => "no one versus ones while you're behind. When I say don't fight, farm and wait for your window.",
      score: (T) => (T.behindSoloPerGame == null ? null : T.behindSoloPerGame * 1.2),
      why: (T) => `${T.behindSoloPerGame.toFixed(1)} solo deaths per game came while you were a level down or 300g+ behind.`,
    },
    cs10: {
      title: (tg) => `${tg} CS at 10:00`,
      goal: (tg) => `At least ${tg} CS when the clock hits 10:00.`,
      how: 'Last-hit first, trade second. When you have to leave lane, crash the wave first so it isn\'t lost to the turret.',
      spoken: (tg) => `${tg} CS at ten minutes. Every last hit counts more than a trade.`,
      score: (T) => (T.cs10 == null ? null : Math.max(0, 70 - T.cs10) / 20),
      why: (T) => `You average ${Math.round(T.cs10)} CS at 10${T.csDiff10 != null ? ` (${T.csDiff10 >= 0 ? '+' : ''}${T.csDiff10.toFixed(0)} vs your opponent)` : ''}. 70+ is a good goal in lane.`,
    },
    early_deaths: {
      title: () => 'Max 1 death before 14:00',
      goal: () => 'At most one death before 14:00.',
      how: 'After your first death, play the rest of laning for your item, not for kills.',
      spoken: () => 'at most one death before fourteen minutes. After the first one, play for your item.',
      score: (T) => (T.earlyDeathsPerGame == null ? null : Math.max(0, T.earlyDeathsPerGame - 1) * 0.6),
      why: (T) => `You die ${T.earlyDeathsPerGame.toFixed(1)} times before 14:00 on average.`,
    },
    ganks: {
      title: () => 'No deaths to ganks',
      goal: () => 'No deaths with the enemy jungler involved before 14:00.',
      how: 'Before you step past the middle of the lane, check the jungler line. Unknown means ward first or stay back.',
      spoken: () => 'no deaths to ganks. Before you step up, check where their jungler is.',
      score: (T) => (T.n ? T.earlyGanks.length / T.n : null),
      why: (T) => `${T.earlyGanks.length} gank deaths before 14:00 in your last ${T.n} games.`,
    },
    wards: {
      title: () => 'Control Ward every back',
      goal: () => 'Buy a Control Ward on (almost) every back.',
      how: 'Keep 75g for it on every back and place it in the river bush or your tri-brush.',
      spoken: () => 'buy a Control Ward every time you back. It stops the ganks before they happen.',
      score: (T) => (T.controlWards == null ? null : T.controlWards < 1 ? 0.7 : T.controlWards < 2 ? 0.3 : 0),
      why: (T) => `${T.controlWards.toFixed(1)} Control Wards per game.`,
    },
  };
  const IDS = Object.keys(DEFS);

  async function loadHistory() {
    try {
      const h = await (await fetch('/api/history')).json();
      // one entry per game (older versions could save the same game twice)
      history = (Array.isArray(h) ? h : []).sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0))
        .filter((r, i, all) => !all.slice(i + 1).some((x) => x.champ === r.champ && x.opp === r.opp && Math.abs((x.gameTime || 0) - (r.gameTime || 0)) < 120 && (x.endedAt || 0) - (r.endedAt || 0) < 15 * 60000));
    } catch {}
  }
  const recentResults = (id) => history.filter((h) => h.focus && (!id || h.focus.id === id)).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

  function cs10Target(T) { return T && T.cs10 != null ? clamp(Math.round((T.cs10 + 10) / 5) * 5, 50, 80) : 60; }

  function getPick() { try { const p = JSON.parse(localStorage.getItem(LS_PICK) || 'null'); return p && Date.now() - p.at < 3 * 3600e3 && DEFS[p.id] ? p.id : null; } catch { return null; } }
  function setPick(id) { try { localStorage.setItem(LS_PICK, JSON.stringify({ id, at: Date.now() })); } catch {} }

  // ranked candidates from your stats; a focus passed in each of its last 3 games counts as learned
  function ranked(T) {
    const out = [];
    for (const id of IDS) {
      const d = DEFS[id];
      const s = T && T.n >= 3 ? d.score(T) : null;
      const last3 = recentResults(id).slice(0, 3);
      const learned = last3.length === 3 && last3.every((r) => r.focus.passed);
      out.push({ id, score: s == null ? (id === 'behind_fights' ? 0.5 : 0.1) : s, why: s == null ? '' : d.why(T), learned });
    }
    return out.sort((a, b) => (a.learned - b.learned) || b.score - a.score);
  }

  // the focus for the coming game
  function choose(T) {
    const r = ranked(T);
    const picked = getPick();
    const c = (picked && r.find((x) => x.id === picked)) || r[0];
    const tg = cs10Target(T);
    const d = DEFS[c.id];
    return { id: c.id, target: tg, title: d.title(tg), goal: d.goal(tg), how: d.how, spoken: d.spoken(tg), why: c.why, picked: c.id === picked, options: r.map((x) => ({ id: x.id, title: DEFS[x.id].title(tg), learned: x.learned })) };
  }

  // ---------- live tracking ----------
  let G = null;
  const itemValue = (D, p) => (p.items || []).reduce((s, i) => s + (((D.dd.items[String(i.itemID)] || {}).gold || {}).total || 0) * (i.count || 1), 0);
  const cwCount = (p) => (p.items || []).filter((i) => String(i.itemID) === CW).reduce((s, i) => s + (i.count || 1), 0);

  function start(F) { G = { F, lastT: -1, deaths: [], seen: new Set(), snap: null, cs10: null, cs5: null, sawEarly: false, cw: 0, prevCw: null, trips: 0, prevIv: null, first: true, saidEnd: false }; }

  // call every tick; returns lines to say (at most one per tick)
  function track(A, D) {
    if (!G || A.t < G.lastT - 5) return [];
    G.lastT = A.t;
    const { me, opp, enemies, enemyJungler } = A.P;
    const t = A.t, say = [];
    const F = G.F;

    // deaths (kill feed); the snapshot from the last tick you were alive tells whether you were behind
    for (const e of A.events) {
      if (e.EventName !== 'ChampionKill' || !Engine.nameIs(me, e.VictimName) || G.seen.has(e.EventTime)) continue;
      G.seen.add(e.EventTime);
      const inv = enemies.filter((p) => Engine.nameIs(p, e.KillerName) || (e.Assisters || []).some((n) => Engine.nameIs(p, n)));
      const solo = inv.length === 1 && opp && inv[0] === opp;
      const gank = e.EventTime < 840 && (inv.length >= 2 || (enemyJungler && inv.includes(enemyJungler) && enemyJungler !== opp));
      const s = G.first ? null : G.snap;     // deaths from before the app was opened have no snapshot
      const behind = !!(s && (s.dontFight || s.lvlD < 0 || s.est < -500));
      const d = { t: e.EventTime, solo, gank, behind, why: s ? s.why : '' };
      G.deaths.push(d);
      if (G.first) continue;
      if (F.id === 'behind_fights' && solo && behind) say.push({ text: `That fight broke your focus: you were ${d.why}. Next time, farm and wait for your window.`, key: `focus-bf-${e.EventTime}` });
      if (F.id === 'early_deaths' && e.EventTime < 840) {
        const n = G.deaths.filter((x) => x.t < 840).length;
        if (n === 1) say.push({ text: 'That was your one death. Play the rest of laning for your item.', key: `focus-ed-${e.EventTime}` });
        if (n === 2) say.push({ text: 'Second death before fourteen minutes: focus missed. Now play safe until your item.', key: `focus-ed-${e.EventTime}` });
      }
      if (F.id === 'ganks' && gank) say.push({ text: 'Gank death: focus missed. Check the jungler line before you step up.', key: `focus-gk-${e.EventTime}` });
    }
    G.first = false;
    if (!me.isDead) {
      const g = A.guard, lvlD = opp ? me.level - opp.level : 0;
      const dontFight = !!(g && A.mode && A.mode.headline === g.headline);
      const why = g && dontFight ? { lock: 'in farm-only mode', level: 'a level down', gold: 'behind in gold', cs: 'down in farm' }[g.kind] : lvlD < 0 ? 'a level down' : 'behind in gold';
      G.snap = { t, dontFight, lvlD, est: A.state.est, why };
    }

    // CS at 5:00 / 10:00 (only if we saw the game before then)
    const cs = (me.scores || {}).creepScore || 0;
    if (t < 590) G.sawEarly = true;
    if (G.sawEarly && G.cs5 == null && t >= 300) { G.cs5 = cs; if (F.id === 'cs10') say.push({ text: `Five minutes: ${cs} CS. You need about ${paceAt(300)} to be on track.`, key: `focus-cs5-${F.id}` }); }
    if (G.sawEarly && G.cs10 == null && t >= 600) {
      G.cs10 = cs;
      if (F.id === 'cs10') say.push({ text: `Ten minutes: ${cs} CS, target ${F.target}. ${cs >= F.target ? 'Focus done, well played.' : 'Focus missed, keep last-hitting.'}`, key: `focus-cs10-${F.id}` });
    }

    // Control Wards bought vs shopping trips
    const c = cwCount(me), iv = itemValue(D, me);
    if (G.prevCw != null && c > G.prevCw) G.cw += c - G.prevCw;
    if (G.prevIv != null && iv - G.prevIv >= 250) G.trips++;
    G.prevCw = c; G.prevIv = iv;

    // game end: the grade
    const end = A.events.find((e) => e.EventName === 'GameEnd');
    if (end && !G.saidEnd) { G.saidEnd = true; const r = result(A); if (r) say.push({ text: `Focus ${r.passed ? 'done' : 'missed'}: ${r.title}. ${r.detail}.`, key: `focus-end-${F.id}` }); }
    return say.slice(0, 1);
  }
  const paceAt = (t) => (G ? Math.round(G.F.target * clamp((t - 65) / (600 - 65), 0, 1)) : 0);

  // live status for the dashboard: { state: ok | warn | broken | done | unknown, text }
  function status(A) {
    if (!G) return null;
    const F = G.F, t = A.t, early = G.deaths.filter((d) => d.t < 840);
    const clock = (s) => Engine.fmtClock(s);
    switch (F.id) {
      case 'behind_fights': {
        const bad = G.deaths.filter((d) => d.solo && d.behind);
        return bad.length ? { state: 'broken', text: `Broken ${bad.length}× (${bad.map((d) => clock(d.t)).join(', ')})` } : { state: 'ok', text: A.guard ? 'Now: don\'t fight' : 'Clean so far' };
      }
      case 'cs10': {
        const cs = (A.P.me.scores || {}).creepScore || 0;
        if (G.cs10 != null) return { state: G.cs10 >= F.target ? 'done' : 'broken', text: `${G.cs10} / ${F.target} at 10:00` };
        if (!G.sawEarly) return { state: 'unknown', text: 'App opened after 10:00' };
        const need = paceAt(t);
        return { state: cs >= need - 3 ? 'ok' : 'warn', text: `${cs} CS · on track needs ${need}` };
      }
      case 'early_deaths':
        return { state: early.length >= 2 ? 'broken' : t >= 840 ? 'done' : early.length === 1 ? 'warn' : 'ok', text: `${early.length} death${early.length === 1 ? '' : 's'} before 14:00${early.length === 1 && t < 840 ? ' · no more' : ''}` };
      case 'ganks': {
        const g = G.deaths.filter((d) => d.gank);
        return { state: g.length ? 'broken' : t >= 840 ? 'done' : 'ok', text: g.length ? `${g.length} gank death${g.length > 1 ? 's' : ''}` : 'No gank deaths' };
      }
      case 'wards':
        return { state: G.cw >= Math.max(1, G.trips - 1) ? 'ok' : 'warn', text: `${G.cw} Control Ward${G.cw === 1 ? '' : 's'} · ${G.trips} back${G.trips === 1 ? '' : 's'}` };
      default: return null;
    }
  }

  // final grade for the game record
  function result(A) {
    if (!G) return null;
    const F = G.F, st = status(A);
    if (!st || st.state === 'unknown') return null;
    const passed = F.id === 'wards' ? st.state === 'ok' : F.id === 'cs10' ? st.state === 'done' : st.state !== 'broken';
    const detail = F.id === 'behind_fights' && passed ? 'No fights taken while behind' : st.text;
    return { id: F.id, title: F.title, target: F.target, passed, detail };
  }

  return { choose, start, track, status, result, loadHistory, setPick, getPick, recentResults, get current() { return G ? G.F : null; }, DEFS };
})();
