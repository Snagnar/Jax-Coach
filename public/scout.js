// Jax Coach - player scouting through the Riot Web API (via the local server, which adds your key).
// Rank (league-v4), champion mastery (champion-mastery-v4) and recent ranked games (match-v5).

const Scout = (() => {
  const results = new Map();      // riotId -> result object (mutated as data arrives)
  const queue = [];
  let running = false;
  let listener = () => {};
  let keyProblem = null;          // 'no_api_key' | 'invalid_key' | null

  async function api(route, path) {
    const r = await fetch(`/api/riot/${route}${path}`);
    if (r.status === 404) return null;
    if (r.status === 401) { keyProblem = 'no_api_key'; throw Object.assign(new Error('No Riot API key set'), { status: 401 }); }
    if (r.status === 403) { keyProblem = 'invalid_key'; throw Object.assign(new Error('Riot API key invalid or expired'), { status: 403 }); }
    if (r.status === 429) {
      const wait = (+r.headers.get('Retry-After') || 5) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      return api(route, path);
    }
    if (!r.ok) throw Object.assign(new Error(`Riot API error ${r.status}`), { status: r.status });
    keyProblem = null;
    return r.json();
  }

  const enc = encodeURIComponent;
  const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

  function fmtRank(e) {
    if (!e) return null;
    const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier);
    const games = e.wins + e.losses;
    return {
      tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses, games,
      winRate: games ? Math.round((e.wins / games) * 100) : null, hotStreak: e.hotStreak,
      tierIndex: TIER_ORDER.indexOf(e.tier),
      text: `${e.tier[0]}${e.tier.slice(1).toLowerCase()}${apex ? '' : ' ' + e.rank} · ${e.leaguePoints} LP`,
    };
  }

  function deriveFlags(res) {
    const f = [];
    const m = res.mastery;
    if (m) {
      if (m.points === 0) f.push({ t: 'First game on this champ', k: 'good' });
      else if (m.points < 20000) f.push({ t: 'Low experience on champ', k: 'good' });
      else if (m.points >= 500000) f.push({ t: 'Champion main', k: 'warn' });
      else if (m.points >= 150000) f.push({ t: 'Experienced on champ', k: 'warn' });
      if (m.daysSince != null && m.daysSince > 45 && m.points > 0) f.push({ t: `Rusty: last played ${m.daysSince}d ago`, k: 'good' });
    }
    const r = res.recent;
    if (r && r.games >= 8) {
      if (r.onChamp / r.games >= 0.6) f.push({ t: 'One-trick', k: 'warn' });
      if (r.onChamp >= 3) {
        const wr = Math.round((r.winsOnChamp / r.onChamp) * 100);
        if (wr >= 65) f.push({ t: `${wr}% WR recently on champ`, k: 'warn' });
        if (wr <= 35) f.push({ t: `${wr}% WR recently on champ`, k: 'good' });
      }
      if (r.mainRole && res.isOpponent && r.mainRole !== (res.lanePos || 'TOP')) f.push({ t: `Usually plays ${({ MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'support' }[r.mainRole] || r.mainRole.toLowerCase())}`, k: 'good' });
    }
    const s = res.solo;
    if (s && s.hotStreak) f.push({ t: 'Hot streak', k: 'warn' });
    if (s && s.games >= 30 && s.winRate >= 58) f.push({ t: `${s.winRate}% WR this split`, k: 'warn' });
    if (!s && res.status === 'done') f.push({ t: 'Unranked in Solo/Duo', k: 'info' });
    return f;
  }

  async function run(job) {
    const { res, player, champKey, deep } = job;
    try {
      res.status = 'loading'; listener();
      const gameName = player.riotIdGameName || String(player.riotId || '').split('#')[0];
      const tag = player.riotIdTagLine || String(player.riotId || '').split('#')[1];
      if (!gameName || !tag || player.isBot) { res.status = 'bot'; listener(); return; }
      if (!res.puuid) {
        const acc = await api('account', `/riot/account/v1/accounts/by-riot-id/${enc(gameName)}/${enc(tag)}`);
        if (!acc) { res.status = 'error'; res.error = 'Account not found (wrong region in settings?)'; listener(); return; }
        res.puuid = acc.puuid;
      }
      const entries = (await api('platform', `/lol/league/v4/entries/by-puuid/${res.puuid}`)) || [];
      res.solo = fmtRank(entries.find((e) => e.queueType === 'RANKED_SOLO_5x5'));
      res.flex = fmtRank(entries.find((e) => e.queueType === 'RANKED_FLEX_SR'));
      if (champKey) {
        const m = await api('platform', `/lol/champion-mastery/v4/champion-masteries/by-puuid/${res.puuid}/by-champion/${champKey}`);
        res.mastery = m ? {
          level: m.championLevel, points: m.championPoints, lastPlayTime: m.lastPlayTime,
          daysSince: m.lastPlayTime ? Math.floor((Date.now() - m.lastPlayTime) / 86400000) : null,
        } : { level: 0, points: 0, daysSince: null };
      }
      res.status = 'done'; res.flags = deriveFlags(res); listener();
      if (deep && !res.recent) await deepScout(res, champKey);
    } catch (e) {
      res.status = 'error'; res.error = e.message; listener();
    }
  }

  async function deepScout(res, champKey) {
    res.recentLoading = true; listener();
    const ids = (await api('match', `/lol/match/v5/matches/by-puuid/${res.puuid}/ids?queue=420&count=20`)) || [];
    const r = { games: 0, onChamp: 0, winsOnChamp: 0, k: 0, d: 0, a: 0, roles: {}, champs: {}, lastGames: [] };
    for (const id of ids) {
      const m = await api('match', `/lol/match/v5/matches/${id}`);
      if (!m || !m.info) continue;
      const p = m.info.participants.find((x) => x.puuid === res.puuid);
      if (!p) continue;
      r.games++;
      r.roles[p.teamPosition] = (r.roles[p.teamPosition] || 0) + 1;
      r.champs[p.championName] = (r.champs[p.championName] || 0) + 1;
      if (String(p.championId) === String(champKey)) {
        r.onChamp++; if (p.win) r.winsOnChamp++;
        r.k += p.kills; r.d += p.deaths; r.a += p.assists;
        r.lastGames.push({ win: p.win, k: p.kills, d: p.deaths, a: p.assists, when: m.info.gameEndTimestamp });
      }
      res.recent = { ...r }; listener();
    }
    r.mainRole = Object.entries(r.roles).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null;
    r.topChamps = Object.entries(r.champs).sort((a, b) => b[1] - a[1]).slice(0, 3);
    res.recent = r; res.recentLoading = false; res.flags = deriveFlags(res); listener();
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) await run(queue.shift());
    running = false;
  }

  // lanePos: your role (TOP/MIDDLE): an opponent who usually plays another role is flagged
  function request(player, champKey, { deep = false, isOpponent = false, priority = false, lanePos = null } = {}) {
    const key = player.riotId || player.summonerName;
    let res = results.get(key);
    if (res && lanePos) res.lanePos = lanePos;
    if (res && res.champKey === champKey && (res.status !== 'error' || res.retried)) {
      if (deep && res.status === 'done' && !res.recent && !res.recentLoading) { res.recentLoading = true; queue.unshift({ res, player, champKey, deep: true, again: true }); pump(); }
      return res;
    }
    if (res && res.status === 'error') res.retried = true;
    res = res && res.champKey === champKey ? res : { status: 'queued', champKey, isOpponent, lanePos, flags: [] };
    res.isOpponent = isOpponent;
    results.set(key, res);
    (priority ? queue.unshift.bind(queue) : queue.push.bind(queue))({ res, player, champKey, deep });
    pump();
    return res;
  }

  return {
    api,
    request,
    get: (player) => results.get(player.riotId || player.summonerName),
    onUpdate: (fn) => { listener = fn; },
    keyProblem: () => keyProblem,
    reset: () => { results.clear(); queue.length = 0; keyProblem = null; },
  };
})();
