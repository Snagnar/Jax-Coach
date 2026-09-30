// Jax Coach - post-game review & trends.
// Imports your recent games on the active champion from match-v5 (+ timelines), analyses each one, and finds patterns.
// Games recorded live by this app add what the dashboard said when you died.

const Review = (() => {
  const QUEUES = [420, 440, 400, 490];               // solo/duo, flex, draft, quickplay
  const QUEUE_NAME = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Draft', 490: 'Quickplay' };
  const S = { status: 'idle', me: null, champ: 'Jax', games: [], scanned: 0, toScan: 0, error: null, history: [], open: null };
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
      return { t, kind, behind, jungler: jg, enemyHalf, zone: zoneOf(p), killers: involved.length, killer: killer ? killer.championName : 'Turret/minions' };
    });

    const legendaryBuys = events.filter((e) => e.type === 'ITEM_PURCHASED' && e.participantId === me.participantId && Engine.isLegendary(D, e.itemId))
      .map((e) => ({ t: e.timestamp / 1000, id: e.itemId, name: (Engine.itemData(D, e.itemId) || {}).name || e.itemId }));
    const wards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId === me.participantId);
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

  // ---------- import ----------
  async function load(D, { want = 20, scanMax = 80 } = {}) {
    if (S.status === 'loading') return;
    S.status = 'loading'; S.error = null; changed();
    try {
      try { S.history = await (await fetch('/api/history')).json(); } catch { S.history = []; }
      await ensurePuuid(D);
      const lists = [];
      for (const q of QUEUES) lists.push(...((await Scout.api('match', `/lol/match/v5/matches/by-puuid/${S.me.puuid}/ids?queue=${q}&count=50`)) || []));
      const ids = [...new Set(lists)].sort((a, b) => +b.split('_')[1] - +a.split('_')[1]).slice(0, scanMax);
      S.toScan = ids.length; S.scanned = 0;
      const games = [];
      for (const id of ids) {
        const m = await Scout.api('match', `/lol/match/v5/matches/${id}`);
        S.scanned++;
        if (m && m.info) {
          const p = m.info.participants.find((x) => x.puuid === S.me.puuid);
          if (p && p.championName === S.champ && !p.gameEndedInEarlySurrender) {
            const tl = await Scout.api('match', `/lol/match/v5/matches/${id}/timeline`);
            games.push(analyzeGame(D, m, tl, S.me.puuid));
            S.games = games.slice(); changed();
            if (games.length >= want) break;
          }
        }
        if (S.scanned % 5 === 0) changed();
      }
      S.games = games;
      attachLiveRecords();
      S.status = 'done';
    } catch (e) {
      S.status = 'error';
      S.error = e.message === 'no_identity' ? null : e.message;
      if (e.message === 'no_identity') S.status = 'needs_identity';
    }
    changed();
  }

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
    state: S, load, trends, insights, setIdentity, zoneOf, QUEUE_NAME, ensurePuuid,
    onChange: (fn) => { onChange = fn; },
    reset: () => { S.games = []; S.status = 'idle'; },
    // the Review follows the active champion; switching clears the imported games
    setChampion: (cid) => { if (!cid || cid === S.champ) return; S.champ = cid; S.games = []; S.status = 'idle'; S.open = null; changed(); },
  };
})();
