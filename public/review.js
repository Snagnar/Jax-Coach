// Jax Coach - post-game review & trends.
// Your games on the active champion (from the match archive, see archive.js): analyses each one and finds patterns.
// Games recorded live by this app add what the dashboard said when you died.

const Review = (() => {
  const QUEUES = [420, 440, 400, 490];               // solo/duo, flex, draft, quickplay
  const QUEUE_NAME = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Draft', 490: 'Quickplay' };
  const S = { status: 'idle', me: null, champ: 'Jax', games: [], all: [], range: '30', error: null, history: [], open: null };
  let onChange = () => {};
  const changed = () => onChange();

  // ---------- identity ----------
  // The Web API's PUUIDs are encrypted per API key, so the League client's PUUID can't be used:
  // we always resolve the Riot ID through account-v1 and remember which key that PUUID belongs to.
  function loadMe() { try { return JSON.parse(localStorage.getItem('jc_me') || 'null'); } catch { return null; } }
  function saveMe(me) { try { localStorage.setItem('jc_me', JSON.stringify(me)); } catch {} }
  S.me = loadMe();
  function setIdentity(me) {
    if (!me || !me.gameName || !me.tagLine) return;
    if (S.me && S.me.gameName === me.gameName && S.me.tagLine === me.tagLine) return;
    S.me = { gameName: me.gameName, tagLine: me.tagLine, puuid: null, keyHint: null };
    saveMe(S.me); changed();
  }

  // ---------- map geometry (Summoner's Rift, 0..~14900, blue base bottom-left) ----------
  function zoneOf(p) {
    if (!p) return '?';
    const { x, y } = p;
    if (x < 4200 && y < 4200) return 'blue base';
    if (x > 10700 && y > 10700) return 'red base';
    if ((x < 2300 && y > 4000) || (y > 12600 && x < 11000)) return 'top lane';
    if ((y < 2300 && x > 4000) || (x > 12600 && y < 11000)) return 'bot lane';
    if (Math.abs(x - y) < 1400) return 'mid lane';
    if (Math.abs(x + y - 14900) < 1300) return 'river';
    return 'jungle';
  }

  // Summoner's Rift turrets, measured from Riot's match timelines (every kill of a turret has the same position)
  const TURRETS = {
    100: { 'top-outer': [981, 10441], 'top-inner': [1512, 6699], 'top-base': [1169, 4287], 'mid-outer': [5846, 6396], 'mid-inner': [5048, 4812], 'mid-base': [3651, 3696],
      'bot-outer': [10504, 1029], 'bot-inner': [6919, 1483], 'bot-base': [4281, 1253], 'nexus-a': [1748, 2270], 'nexus-b': [2177, 1807] },
    200: { 'top-outer': [4318, 13875], 'top-inner': [7943, 13411], 'top-base': [10481, 13650], 'mid-outer': [8955, 8510], 'mid-inner': [9767, 10113], 'mid-base': [11134, 11207],
      'bot-outer': [13866, 4505], 'bot-inner': [13327, 8226], 'bot-base': [13624, 10572], 'nexus-a': [12611, 13084], 'nexus-b': [13052, 12612] },
  };
  const TURRET_REACH = 900;   // turret range 750 + champion size and a step: "under the tower"
  const SLOT = ['Q', 'W', 'E', 'R'];
  // which turret (if any) a death happened under, for one team, counting only turrets still standing at that time
  function turretAt(teamId, p, t, buildingKills) {
    if (!p) return null;
    for (const [key, [x, y]] of Object.entries(TURRETS[teamId] || {})) {
      if (Math.hypot(p.x - x, p.y - y) > TURRET_REACH) continue;
      const [lane, tier] = key.split('-');
      const dead = buildingKills.some((b) => b.teamId === teamId && b.timestamp / 1000 < t && b.buildingType === 'TOWER_BUILDING'
        && (lane === 'nexus' ? b.towerType === 'NEXUS_TURRET' && Math.hypot(b.position.x - x, b.position.y - y) < 200
          : b.laneType === `${lane.toUpperCase()}_LANE` && b.towerType === `${tier.toUpperCase()}_TURRET`));
      if (!dead) return key;
    }
    return null;
  }
  // who hit you with what in the seconds before a death (Riot's damage breakdown), biggest first
  function damageTaken(e, byPid) {
    const sum = {};
    for (const d of e.victimDamageReceived || []) {
      const who = d.participantId && byPid[d.participantId] ? byPid[d.participantId].championName : d.type === 'TOWER' ? 'Turret' : d.type === 'MINION' ? 'Minions' : d.name || '?';
      const SUMM = { summonerdot: 'Ignite', summonerexhaust: 'Exhaust', summonersmite: 'Smite', summonerhaste: 'Ghost' };
      const sp = String(d.spellName || '');
      const what = d.basic ? 'basic attacks' : SUMM[sp.toLowerCase()] || (d.spellSlot >= 0 && d.spellSlot <= 3 && d.type === 'OTHER' ? `${SLOT[d.spellSlot]}${sp ? ` (${sp})` : ''}` : sp || d.type || '?');
      const k = `${who}|${what}`;
      sum[k] = (sum[k] || 0) + (d.physicalDamage || 0) + (d.magicDamage || 0) + (d.trueDamage || 0);
    }
    return Object.entries(sum).map(([k, dmg]) => { const [from, what] = k.split('|'); return { from, what, dmg: Math.round(dmg) }; })
      .sort((a, b) => b.dmg - a.dmg).slice(0, 4);
  }

  // ---------- one game ----------
  function analyzeGame(D, m, tl, puuid) {
    const info = m.info;
    const byPid = {};
    for (const p of info.participants) byPid[p.participantId] = p;
    const me = info.participants.find((p) => p.puuid === puuid);
    const pos = me.teamPosition || 'TOP';
    const opp = info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === pos) || null;
    const ej = info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === 'JUNGLE') || null;
    const frames = (tl && tl.info && tl.info.frames) || [];
    const frameAt = (min, pid) => (frames[min] && frames[min].participantFrames[pid]) || null;
    const snap = (min) => {
      const a = frameAt(min, me.participantId);
      if (!a) return null;
      const b = opp ? frameAt(min, opp.participantId) : null;
      return {
        cs: a.minionsKilled + a.jungleMinionsKilled, gold: a.totalGold, level: a.level,
        csDiff: b ? a.minionsKilled + a.jungleMinionsKilled - (b.minionsKilled + b.jungleMinionsKilled) : null,
        goldDiff: b ? a.totalGold - b.totalGold : null,
      };
    };
    const events = frames.flatMap((f) => f.events || []);
    const enemyIds = new Set(info.participants.filter((p) => p.teamId !== me.teamId).map((p) => p.participantId));
    const buildingKills = events.filter((e) => e.type === 'BUILDING_KILL' && e.position);

    const deaths = events.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.participantId).map((e) => {
      const involved = [e.killerId, ...(e.assistingParticipantIds || [])].filter((id) => enemyIds.has(id));
      const jg = !!(ej && involved.includes(ej.participantId));
      const byOpp = !!(opp && involved.includes(opp.participantId));
      const t = e.timestamp / 1000;
      let kind;
      if (involved.length === 0) kind = 'tower';
      else if (involved.length === 1) kind = byOpp ? 'solo' : jg ? 'gank' : 'picked';
      else if (jg && involved.length <= 3 && t < 20 * 60) kind = 'gank';
      else kind = 'fight';
      const p = e.position;
      const enemyHalf = p ? (me.teamId === 100 ? p.x + p.y > 15400 : p.x + p.y < 14400) : false;
      const killer = byPid[e.killerId];
      // were you behind the killer when you took the fight? (level down or 300g+ behind, last full minute)
      const a = frameAt(Math.floor(t / 60), me.participantId), b = killer && enemyIds.has(e.killerId) ? frameAt(Math.floor(t / 60), e.killerId) : null;
      const behind = !!(a && b && (a.level < b.level || a.totalGold - b.totalGold < -300));
      // v2: under your own turret (it was still standing), under theirs (a dive), and what did the damage
      const ownTurret = turretAt(me.teamId, p, t, buildingKills), theirTurret = turretAt(me.teamId === 100 ? 200 : 100, p, t, buildingKills);
      return { t, kind, behind, jungler: jg, enemyHalf, zone: zoneOf(p), killers: involved.length, killer: killer ? killer.championName : 'Turret/minions',
        underOwnTower: ownTurret, underEnemyTower: theirTurret, pos: p ? [p.x, p.y] : null, hits: damageTaken(e, byPid) };
    });

    const legendaryBuys = events.filter((e) => e.type === 'ITEM_PURCHASED' && e.participantId === me.participantId && Engine.isLegendary(D, e.itemId))
      .map((e) => ({ t: e.timestamp / 1000, id: e.itemId, name: (Engine.itemData(D, e.itemId) || {}).name || e.itemId }));
    // only real wards: some champions (Warwick) log hundreds of UNDEFINED "ward" events from their abilities
    const wards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId === me.participantId && /^(YELLOW_TRINKET|SIGHT_WARD|CONTROL_WARD|BLUE_TRINKET)$/.test(e.wardType));
    const plates = events.filter((e) => e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === me.participantId).length;
    const soloKills = events.filter((e) => e.type === 'CHAMPION_KILL' && e.killerId === me.participantId && opp && e.victimId === opp.participantId && !(e.assistingParticipantIds || []).length).length;

    return {
      id: m.metadata.matchId, win: me.win, remake: me.gameEndedInEarlySurrender, queue: info.queueId,
      end: info.gameEndTimestamp || info.gameStartTimestamp + info.gameDuration * 1000, duration: info.gameDuration,
      position: pos, opp: opp ? opp.championName : null, oppKey: opp ? opp.championId : null,
      k: me.kills, d: me.deaths, a: me.assists, cs: me.totalMinionsKilled + me.neutralMinionsKilled,
      at10: snap(10), at15: snap(15), deaths, items: legendaryBuys,
      firstItemAt: legendaryBuys[0] ? legendaryBuys[0].t : null, secondItemAt: legendaryBuys[1] ? legendaryBuys[1].t : null,
      wardsBefore14: wards.filter((w) => w.timestamp < 14 * 60000).length, controlWards: wards.filter((w) => w.wardType === 'CONTROL_WARD').length,
      plates, soloKills,
    };
  }

  // PUUIDs are encrypted per API key: resolve yours through account-v1 with the current key
  async function ensurePuuid(D) {
    if (!S.me) throw new Error('no_identity');
    const keyHint = D.config.keyHint || '';
    if (!S.me.puuid || S.me.keyHint !== keyHint) {
      const acc = await Scout.api('account', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(S.me.gameName)}/${encodeURIComponent(S.me.tagLine)}`);
      if (!acc) throw new Error(`Riot ID ${S.me.gameName}#${S.me.tagLine} not found on this region`);
      S.me.puuid = acc.puuid; S.me.keyHint = keyHint; saveMe(S.me);
    }
    return S.me.puuid;
  }

  // ---------- games: from your match archive (archive.js imports them in the background) ----------
  // range: how many of your most recent games on this champion the review looks at ('all' = every archived one)
  function refresh() {
    S.all = Archive.rows().filter((r) => r.detail && r.champ === S.champ && !r.remake).map((r) => r.detail);
    S.games = S.range === 'all' ? S.all : S.all.slice(0, +S.range);
    attachLiveRecords();
  }
  async function load(D) {
    if (S.status === 'loading') return;
    S.status = 'loading'; S.error = null; changed();
    try {
      try { S.history = await (await fetch('/api/history')).json(); } catch { S.history = []; }
      await ensurePuuid(D);
      await Archive.load();
      refresh();
      S.status = 'done';
      Archive.sync(D);                 // new games (and on the first run: everything Riot still has) arrive in the background
    } catch (e) {
      S.status = 'error';
      S.error = e.message === 'no_identity' ? null : e.message;
      if (e.message === 'no_identity') S.status = 'needs_identity';
    }
    changed();
  }
  // follow the archive while it imports (at most every 3 s: the review re-renders on each change)
  let refreshTimer = null;
  Archive.onChange(() => {
    if (S.status !== 'done' || refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; const n = S.all.length; refresh(); if (S.all.length !== n || !Archive.running) changed(); }, 3000);
  });

  function attachLiveRecords() {
    for (const g of S.games) {
      const rec = S.history.find((h) => h.champ === S.champ && Math.abs((h.endedAt || 0) - g.end) < 15 * 60000);
      if (!rec) continue;
      g.live = rec;
      // match each timeline death to the dashboard mode recorded at that moment (same game clock)
      for (const d of g.deaths) {
        const r = (rec.deaths || []).find((x) => Math.abs(x.t - d.t) < 8);
        if (r) { d.mode = r.mode; d.junglerStatus = r.jungler; }
      }
    }
  }

  // ---------- trends ----------
  const avg = (xs) => { const v = xs.filter((x) => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  function trends(games) {
    const n = games.length;
    const wins = games.filter((g) => g.win).length;
    const early = games.flatMap((g) => g.deaths.filter((d) => d.t < 14 * 60).map((d) => ({ ...d, game: g })));
    const earlyGanks = early.filter((d) => d.kind === 'gank');
    const withOpp = games.filter((g) => g.at15 && g.at15.goldDiff != null);
    const ahead = withOpp.filter((g) => g.at15.goldDiff > 500), behind = withOpp.filter((g) => g.at15.goldDiff < -500);
    const wr = (gs) => (gs.length ? Math.round((gs.filter((g) => g.win).length / gs.length) * 100) : null);
    const byOpp = {};
    for (const g of games) if (g.opp) { const o = byOpp[g.opp] = byOpp[g.opp] || { w: 0, l: 0, key: g.oppKey }; g.win ? o.w++ : o.l++; }
    const buckets = [[0, 4], [4, 8], [8, 14], [14, 25], [25, 99]].map(([a, b]) => {
      const ds = games.flatMap((g) => g.deaths).filter((d) => d.t >= a * 60 && d.t < b * 60);
      const count = (k) => ds.filter((d) => d.kind === k).length;
      return { label: b === 99 ? `${a}+ min` : `${a}–${b} min`, total: ds.length, gank: count('gank'), solo: count('solo'), fight: count('fight'), other: count('picked') + count('tower') };
    });
    const liveDeaths = games.flatMap((g) => g.deaths.filter((d) => d.mode));
    return {
      n, wins, wr: n ? Math.round((wins / n) * 100) : null,
      cs10: avg(games.map((g) => g.at10 && g.at10.cs)), csDiff10: avg(games.map((g) => g.at10 && g.at10.csDiff)),
      gd15: avg(withOpp.map((g) => g.at15.goldDiff)),
      firstItem: avg(games.map((g) => g.firstItemAt)),
      earlyDeathsPerGame: n ? early.length / n : null, earlyGanks, early,
      gankGames: new Set(earlyGanks.map((d) => d.game.id)).size,
      gankEnemyHalf: earlyGanks.filter((d) => d.enemyHalf).length,
      soloDeathsPerGame: n ? games.flatMap((g) => g.deaths.filter((d) => d.kind === 'solo' && d.t < 20 * 60)).length / n : null,
      behindSoloPerGame: n ? games.flatMap((g) => g.deaths.filter((d) => d.kind === 'solo' && d.behind && d.t < 20 * 60)).length / n : null,
      controlWards: avg(games.map((g) => g.controlWards)),
      // v2: deaths before 14:00 under your own (still standing) turret, and dives under theirs
      underTower: early.filter((d) => d.underOwnTower), underEnemyTower: early.filter((d) => d.underEnemyTower),
      ahead, behind, wrAhead: wr(ahead), wrBehind: wr(behind),
      wardsBefore14: avg(games.map((g) => g.wardsBefore14)),
      byOpp, buckets, liveDeaths,
      warnedDeaths: liveDeaths.filter((d) => d.mode === 'safe' || d.mode === 'retreat').length,
    };
  }

  function insights(T, games) {
    const out = [];
    const fmt = Engine.fmtClock;
    if (T.n < 3) return out;
    // warnings carry a score = share of your early deaths they explain, so the biggest leak comes first
    const earlyN = Math.max(1, T.early.length);
    if (T.earlyGanks.length && T.gankGames / T.n >= 0.35) {
      const avgT = avg(T.earlyGanks.map((d) => d.t));
      out.push({ k: 'warn', score: T.earlyGanks.length / earlyN, title: `Early ganks: ${T.gankGames} of ${T.n} games`, text: `${T.earlyGanks.length} of your ${T.early.length} deaths before 14:00 were ganks, on average at ${fmt(avgT)}. ${T.gankEnemyHalf} happened past the river.`, tip: 'When the Jungler line on the Live tab says the position is unknown, don\'t walk past the river without a ward. Push when the jungler showed bot side or is dead.' });
    }
    if (T.wardsBefore14 != null && T.wardsBefore14 < 4 && T.earlyGanks.length) {
      out.push({ k: 'warn', score: (T.earlyGanks.length / earlyN) * 0.5, title: `Few early wards: ${T.wardsBefore14.toFixed(1)} per game before 14:00`, text: 'Combined with the gank deaths, this is the cheapest thing to fix.', tip: 'Ward the river bush or tri-brush on each back, and buy a Control Ward whenever you have 75g spare.' });
    }
    const soloEarly = T.early.filter((d) => d.kind === 'solo');
    if (T.soloDeathsPerGame != null && T.soloDeathsPerGame >= 0.7) {
      const avgT = avg(soloEarly.map((d) => d.t));
      const behindN = soloEarly.filter((d) => d.behind).length;
      out.push({ k: 'warn', score: soloEarly.length / earlyN, title: `Losing 1v1s: ${T.soloDeathsPerGame.toFixed(1)} solo deaths per game before 20:00`, text: `${soloEarly.length} of your ${T.early.length} deaths before 14:00 were to your lane opponent alone${avgT ? `, on average at ${fmt(avgT)}` : ''}. ${behindN} of them came while you were a level down or 300g+ behind.`, tip: 'When the dashboard says "Don\'t fight", don\'t: last-hit and wait for your item or level. Only all-in when it turns green.' });
    }
    if (T.underTower && T.underTower.length >= 3 && T.underTower.length / earlyN >= 0.15) {
      const killers = {}; for (const d of T.underTower) killers[d.killer] = (killers[d.killer] || 0) + 1;
      const top = Object.entries(killers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}×`).join(', ');
      out.push({ k: 'warn', score: T.underTower.length / earlyN, title: `Dying under your own tower: ${T.underTower.length} of ${T.early.length} early deaths`, text: `Your turret was still standing and didn't save you. Most often: ${top}.`, tip: 'Against champions who pull or dive (Darius, Mordekaiser, Sett…) stand behind the tower, not at its edge, and give up minions when you are behind. The dashboard now says when the tower isn\'t safe.' });
    }
    if (T.underEnemyTower && T.underEnemyTower.length >= 3 && T.underEnemyTower.length / earlyN >= 0.15) {
      out.push({ k: 'warn', score: (T.underEnemyTower.length / earlyN) * 0.8, title: `Dying under their tower: ${T.underEnemyTower.length} early deaths`, text: 'Dives before 14:00 that cost you your life.', tip: 'Only dive with a clear kill and the tower aggro on someone else (minions or an ally).' });
    }
    if (T.ahead.length >= 3 && T.wrAhead != null && T.wrAhead < 60) {
      out.push({ k: 'warn', title: `Leads not converting: ${T.wrAhead}% win rate when ahead at 15`, text: `You were 500g+ ahead of your lane opponent at 15:00 in ${T.ahead.length} games and won ${T.ahead.filter((g) => g.win).length}.`, tip: 'After laning, split push opposite objectives and join through Teleport; don\'t trade your lead in random mid-lane fights.' });
    } else if (T.ahead.length >= 3 && T.wrAhead >= 70) {
      out.push({ k: 'good', title: `You close out leads: ${T.wrAhead}% when ahead at 15`, text: `The work is getting ahead: you were ahead at 15 in ${T.ahead.length} of ${T.n} games.`, tip: '' });
    }
    if (T.cs10 != null) {
      const recent = avg(games.slice(0, 5).map((g) => g.at10 && g.at10.cs)), older = avg(games.slice(5).map((g) => g.at10 && g.at10.cs));
      const trend = recent != null && older != null ? ` (last 5 games: ${Math.round(recent)}, before: ${Math.round(older)})` : '';
      out.push({ k: T.cs10 >= 70 ? 'good' : 'info', title: `CS at 10: ${Math.round(T.cs10)} on average${trend}`, text: T.csDiff10 != null ? `${T.csDiff10 >= 0 ? '+' : ''}${T.csDiff10.toFixed(1)} vs your lane opponent.` : '', tip: T.cs10 < 70 ? 'Around 70+ at 10 minutes is a common goal for top lane.' : '' });
    }
    if (T.firstItem != null) {
      const fast = games.filter((g) => g.firstItemAt && g.firstItemAt <= T.firstItem), slow = games.filter((g) => g.firstItemAt && g.firstItemAt > T.firstItem);
      const wf = fast.length ? Math.round((fast.filter((g) => g.win).length / fast.length) * 100) : null, ws = slow.length ? Math.round((slow.filter((g) => g.win).length / slow.length) * 100) : null;
      out.push({ k: 'info', title: `First item at ${fmt(T.firstItem)} on average`, text: wf != null && ws != null ? `Win rate when it's faster than that: ${wf}% (${fast.length} games), slower: ${ws}% (${slow.length} games).` : '', tip: T.firstItem > 15 * 60 ? 'Faster items come from CS: every wave you miss delays your first item.' : '' });
    }
    const worst = Object.entries(T.byOpp).filter(([, o]) => o.l >= 2 && o.l > o.w).sort((a, b) => b[1].l - a[1].l)[0];
    if (worst) out.push({ k: 'warn', title: `Trouble matchup: ${worst[0]} (${worst[1].w}W ${worst[1].l}L)`, text: 'Read the matchup page before your next game against this champion.', tip: '', mu: worst[0] });
    if (T.liveDeaths.length >= 3) out.push({ k: T.warnedDeaths / T.liveDeaths.length > 0.4 ? 'warn' : 'info', title: `${T.warnedDeaths} of ${T.liveDeaths.length} recorded deaths came while the dashboard said Play safe / Back off`, text: 'From games where Jax Coach was running.', tip: '' });
    const order = { warn: 0, good: 1, info: 2 };
    return out.sort((a, b) => order[a.k] - order[b.k] || (b.score || 0) - (a.score || 0));
  }

  return {
    state: S, load, refresh, trends, insights, setIdentity, zoneOf, analyzeGame, QUEUE_NAME, ensurePuuid, turretAt, damageTaken,
    setRange: (r) => { S.range = r; refresh(); changed(); },
    onChange: (fn) => { onChange = fn; },
    reset: () => { S.games = []; S.all = []; S.status = 'idle'; },
    // the Review follows the active champion
    setChampion: (cid) => { if (!cid || cid === S.champ) return; S.champ = cid; S.open = null; if (S.status === 'done') refresh(); changed(); },
  };
})();
