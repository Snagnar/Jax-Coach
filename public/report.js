// Jax Coach - post-game report.
// Built from Riot's match + timeline data (published a few minutes after the game) plus what the dashboard
// recorded live. Rates all ten players, estimates how much of the result was yours, shows where the game was
// won or lost, what to fix next game, and jumps the League replay to each of your deaths.

const Report = (() => {
  const S = { status: 'idle', list: [], sel: null, R: null, error: null, waiting: null, replay: null, replayMsg: '' };
  let onChange = () => {};
  const changed = () => onChange();

  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ROLE_NAME = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
  const QUEUES = { 420: 'Ranked Solo/Duo', 440: 'Ranked Flex', 400: 'Draft', 430: 'Blind', 490: 'Quickplay' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
  const clock = (s) => Engine.fmtClock(Math.max(0, s));
  const gk = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.abs(Math.round(n))}`;
  // base death timer by level; it grows after 15:00
  const BRW = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];
  const deathTimer = (lvl, t) => Math.round(BRW[clamp(lvl, 1, 18) - 1] * (t > 900 ? 1 + Math.min(0.5, ((t - 900) / 60) * 0.0425) : 1));
  const PIT = { dragon: { x: 9866, y: 4414 }, baron: { x: 5007, y: 10471 } };

  // ---------- ratings: every player vs the other nine, per-role weights ----------
  const WEIGHTS = {
    default: { kda: 0.14, deaths: 0.14, dmg: 0.16, kp: 0.12, gold: 0.12, lane: 0.14, obj: 0.08, vision: 0.04, tank: 0.06 },
    // top laners split push: tower damage counts more, kill participation less
    TOP: { kda: 0.13, deaths: 0.14, dmg: 0.15, kp: 0.08, gold: 0.11, lane: 0.15, obj: 0.14, vision: 0.03, tank: 0.07 },
    JUNGLE: { kda: 0.14, deaths: 0.12, dmg: 0.12, kp: 0.18, gold: 0.10, lane: 0.06, obj: 0.10, vision: 0.08, tank: 0.10 },
    UTILITY: { kda: 0.16, deaths: 0.12, dmg: 0.06, kp: 0.20, gold: 0.02, lane: 0.08, obj: 0.02, vision: 0.22, tank: 0.12 },
  };
  const LABEL = { kda: 'KDA', deaths: 'deaths', dmg: 'damage share', kp: 'kill participation', gold: 'gold income', lane: 'lane (gold @15)', obj: 'objective damage', vision: 'vision', tank: 'damage absorbed' };
  function rate(players, mins) {
    const raw = {
      kda: (p) => Math.log1p((p.k + p.a) / Math.max(1, p.d)),
      deaths: (p) => -p.d / mins,
      dmg: (p) => p.dmgShare,
      kp: (p) => p.kp,
      gold: (p) => p.gold / mins,
      obj: (p) => (p.role === 'JUNGLE' ? p.objShare : p.buildShare),
      vision: (p) => p.vision / mins,
      tank: (p) => p.takenShare,
    };
    const z = {};
    for (const [k, f] of Object.entries(raw)) {
      const xs = players.map(f), m = mean(xs), sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
      z[k] = players.map((p, i) => (sd < 1e-9 ? 0 : clamp((xs[i] - m) / sd, -2.5, 2.5)));
    }
    z.lane = players.map((p) => (p.gd15 == null ? 0 : clamp(p.gd15 / 1200, -2.5, 2.5)));
    players.forEach((p, i) => {
      const w = WEIGHTS[p.role] || WEIGHTS.default;
      const parts = Object.keys(w).map((k) => ({ k, v: w[k] * z[k][i] }));
      const score = sum(parts.map((x) => x.v)) / sum(Object.values(w));
      p.rating = Math.round(clamp(5.5 + 2.2 * score, 0, 10) * 10) / 10;
      p.best = parts.filter((x) => x.v > 0.04).sort((a, b) => b.v - a.v).slice(0, 2).map((x) => LABEL[x.k]);
      p.worst = parts.filter((x) => x.v < -0.04).sort((a, b) => a.v - b.v).slice(0, 2).map((x) => LABEL[x.k]);
    });
  }

  // ---------- build the report ----------
  function build(D, m, tl, puuid, live, T) {
    const info = m.info, P = info.participants;
    const meP = P.find((p) => p.puuid === puuid);
    if (!meP || !tl || !tl.info) return null;
    const dur = info.gameDuration, mins = dur / 60;
    const frames = tl.info.frames, last = frames.length - 1;
    const F = (min, pid) => frames[clamp(min, 0, last)].participantFrames[pid];
    const pos = (p) => p.teamPosition || '';
    const events = frames.flatMap((f) => f.events || []);
    const teamOf = {}; P.forEach((p) => { teamOf[p.participantId] = p.teamId; });
    const byPid = {}; P.forEach((p) => { byPid[p.participantId] = p; });
    const tsum = (team, f) => sum(P.filter((p) => p.teamId === team).map(f));
    const tKills = { 100: tsum(100, (p) => p.kills), 200: tsum(200, (p) => p.kills) };
    const tDmg = { 100: tsum(100, (p) => p.totalDamageDealtToChampions), 200: tsum(200, (p) => p.totalDamageDealtToChampions) };
    const tTaken = { 100: tsum(100, (p) => p.totalDamageTaken + p.damageSelfMitigated), 200: tsum(200, (p) => p.totalDamageTaken + p.damageSelfMitigated) };
    const tBuild = { 100: tsum(100, (p) => p.damageDealtToBuildings), 200: tsum(200, (p) => p.damageDealtToBuildings) };
    const tObj = { 100: tsum(100, (p) => p.damageDealtToObjectives), 200: tsum(200, (p) => p.damageDealtToObjectives) };
    const oppOf = (p) => (pos(p) ? P.find((q) => q.teamId !== p.teamId && pos(q) === pos(p)) : null);

    const players = P.map((p) => {
      const o = oppOf(p);
      const gd = (min) => (o && min <= last ? F(min, p.participantId).totalGold - F(min, o.participantId).totalGold : null);
      return {
        pid: p.participantId, champ: p.championName, role: pos(p), team: p.teamId, isMe: p === meP, win: p.win,
        name: p.riotIdGameName || p.summonerName || '', k: p.kills, d: p.deaths, a: p.assists,
        cs: p.totalMinionsKilled + p.neutralMinionsKilled, gold: p.goldEarned, level: p.champLevel,
        dmg: p.totalDamageDealtToChampions, dmgShare: p.totalDamageDealtToChampions / Math.max(1, tDmg[p.teamId]),
        takenShare: (p.totalDamageTaken + p.damageSelfMitigated) / Math.max(1, tTaken[p.teamId]),
        kp: (p.kills + p.assists) / Math.max(1, tKills[p.teamId]), vision: p.visionScore,
        buildings: p.damageDealtToBuildings, buildShare: p.damageDealtToBuildings / Math.max(1, tBuild[p.teamId]),
        objShare: p.damageDealtToObjectives / Math.max(1, tObj[p.teamId]),
        gd15: gd(15), gdEnd: o ? p.goldEarned - o.goldEarned : null, oppPid: o ? o.participantId : null,
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter(Boolean),
      };
    });
    rate(players, mins);
    const me = players.find((p) => p.isMe);
    const mine = players.filter((p) => p.team === me.team), theirs = players.filter((p) => p.team !== me.team);
    const win = me.win;

    // ---------- whose game was it? ----------
    const matchMean = mean(players.map((p) => p.rating));
    const part = (p) => (win ? Math.max(0, p.rating - matchMean) : Math.max(0, matchMean - p.rating));
    const partSum = sum(mine.map(part));
    mine.forEach((p) => { p.share = partSum > 0 ? part(p) / partSum : 0; });
    const teamRank = 1 + mine.filter((p) => p.rating > me.rating).length;
    const matchRank = 1 + players.filter((p) => p.rating > me.rating).length;
    const mvp = win && matchRank === 1, ace = !win && teamRank === 1 && me.rating >= matchMean;
    let verdict, tone;
    if (win) {
      // with five players an even share is 20%
      if (mvp || me.share >= 0.35) { verdict = mvp ? 'MVP: you carried this one' : 'You carried this one'; tone = 'great'; }
      else if (me.share >= 0.2) { verdict = 'Big part of the win'; tone = 'good'; }
      else if (me.share > 0) { verdict = 'Solid game, your team did more'; tone = 'ok'; }
      else { verdict = 'Your team carried this one'; tone = 'meh'; }
    } else if (ace || me.share === 0) { verdict = ace ? 'ACE: not on you' : 'Not on you'; tone = 'great'; }
    else if (me.share < 0.12) { verdict = 'Mostly not on you'; tone = 'good'; }
    else if (me.share < 0.3) { verdict = 'Shared loss'; tone = 'ok'; }
    else if (me.share < 0.45) { verdict = 'Big part of the loss'; tone = 'meh'; }
    else { verdict = 'This one is mostly on you'; tone = 'bad'; }

    // ---------- the game's story: gold over time, lanes, objectives ----------
    const teamGold = (i, team) => sum(P.filter((p) => p.teamId === team).map((p) => frames[i].participantFrames[p.participantId].totalGold));
    const series = frames.map((f, i) => ({
      t: i * 60, team: teamGold(i, me.team) - teamGold(i, 200 + 100 - me.team),
      lane: me.oppPid ? f.participantFrames[me.pid].totalGold - f.participantFrames[me.oppPid].totalGold : null,
    }));
    if (series.length) series[series.length - 1].t = dur;
    const maxLead = Math.max(...series.map((s) => s.team)), maxDef = Math.min(...series.map((s) => s.team));
    const leadAt = series.find((s) => s.team === maxLead), defAt = series.find((s) => s.team === maxDef);

    const lanes = ROLES.map((r) => ({ role: r, ally: mine.find((p) => p.role === r), enemy: theirs.find((p) => p.role === r) })).filter((l) => l.ally && l.enemy)
      .map((l) => ({ ...l, gd15: l.ally.gd15, gdEnd: l.ally.gdEnd }));

    const objectives = [];
    for (const e of events) {
      const t = e.timestamp / 1000;
      if (e.type === 'ELITE_MONSTER_KILL') {
        const kind = { DRAGON: 'Dragon', BARON_NASHOR: 'Baron', RIFTHERALD: 'Herald', HORDE: 'Voidgrub', ATAKHAN: 'Atakhan' }[e.monsterType] || e.monsterType;
        const sub = e.monsterSubType ? String(e.monsterSubType).replace(/_DRAGON$/, '').toLowerCase() : '';
        objectives.push({ t, kind, sub: sub === 'elder' ? 'Elder' : sub, ours: e.killerTeamId === me.team, x: e.position ? e.position.x : null, y: e.position ? e.position.y : null });
      } else if (e.type === 'BUILDING_KILL') {
        objectives.push({ t, kind: e.buildingType === 'INHIBITOR_BUILDING' ? 'Inhibitor' : 'Tower', lane: String(e.laneType || '').replace('_LANE', '').toLowerCase(), ours: e.teamId !== me.team });
      }
    }
    const count = (kind, ours) => objectives.filter((o) => (Array.isArray(kind) ? kind.includes(o.kind) : o.kind === kind) && o.ours === ours).length;
    const objSummary = ['Dragon', 'Voidgrub', 'Herald', 'Baron', 'Tower'].map((k) => ({ kind: k, ours: count(k, true), theirs: count(k, false) }));

    // ---------- your deaths ----------
    const myEvents = events.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.pid);
    const liveDeaths = (live && live.deaths) || [];
    const deaths = myEvents.map((e) => {
      const t = e.timestamp / 1000, mi = Math.floor(t / 60);
      const inv = [e.killerId, ...(e.assistingParticipantIds || [])].filter((id) => teamOf[id] && teamOf[id] !== me.team);
      const oppIn = inv.includes(me.oppPid);
      const jg = theirs.find((p) => p.role === 'JUNGLE');
      const jgIn = !!(jg && inv.includes(jg.pid));
      let kind;
      if (!inv.length) kind = 'tower';
      else if (inv.length === 1) kind = oppIn ? 'solo' : jgIn ? 'gank' : 'picked';
      else if (jgIn && inv.length <= 3 && t < 1200) kind = 'gank';
      else kind = inv.length >= 3 ? 'teamfight' : 'outnumbered';
      const a = F(mi, me.pid), k = e.killerId && teamOf[e.killerId] !== me.team ? F(mi, e.killerId) : null;
      const behind = !!(a && k && (a.level < k.level || a.totalGold - k.totalGold < -300));
      const p = e.position || {};
      const alliesNear = mine.filter((x) => x.pid !== me.pid).filter((x) => { const q = F(mi, x.pid).position; return Math.hypot(q.x - p.x, q.y - p.y) < 3000; }).length;
      const enemyHalf = p.x != null ? (me.team === 100 ? p.x + p.y > 15400 : p.x + p.y < 14400) : false;
      const lr = liveDeaths.find((x) => Math.abs(x.t - t) < 8);
      return { t, kind, behind, alliesNear, enemyHalf, zone: Review.zoneOf(p), killers: inv.map((id) => byPid[id].championName), level: a ? a.level : me.level, timer: deathTimer(a ? a.level : 10, t), mode: lr ? lr.mode : null };
    });
    const deadAt = (t) => deaths.some((d) => t >= d.t && t <= d.t + d.timer);
    const posAt = (t) => { const f = frames[clamp(Math.round(t / 60), 0, last)].participantFrames[me.pid]; return f && f.position; };

    // big objectives the enemy took while you were alive and far from the pit
    const missed = objectives.filter((o) => !o.ours && ['Dragon', 'Baron', 'Herald', 'Voidgrub'].includes(o.kind) && o.t > 300 && !deadAt(o.t)).filter((o) => {
      const pit = o.kind === 'Dragon' ? PIT.dragon : PIT.baron, q = posAt(o.t);
      return q && Math.hypot(q.x - pit.x, q.y - pit.y) > 6000;
    }).filter((o, i, all) => !(o.kind === 'Voidgrub' && all.slice(0, i).some((x) => x.kind === 'Voidgrub')));

    // ---------- your numbers ----------
    const f10 = F(10, me.pid);
    const cs10 = last >= 10 ? f10.minionsKilled + f10.jungleMinionsKilled : null;
    const legend = events.filter((e) => e.type === 'ITEM_PURCHASED' && e.participantId === me.pid && Engine.isLegendary(D, e.itemId));
    const firstItemAt = legend[0] ? legend[0].timestamp / 1000 : null;
    const plates = events.filter((e) => e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === me.pid).length;
    const soloKills = events.filter((e) => e.type === 'CHAMPION_KILL' && e.killerId === me.pid && e.victimId === me.oppPid && !(e.assistingParticipantIds || []).length).length;
    const cwBought = meP.visionWardsBoughtInGame || 0;
    const early = deaths.filter((d) => d.t < 840);
    const target = T && T.cs10 != null ? clamp(Math.round((T.cs10 + 10) / 5) * 5, 50, 80) : 60;
    const stats = { cs10, csMin: me.cs / mins, gd15: me.gd15, earlyDeaths: early.length, deaths: me.d, kp: me.kp, dmgShare: me.dmgShare, buildings: me.buildings, buildShare: me.buildShare, firstItemAt, cwBought, vision: me.vision, plates, soloKills, target };

    // ---------- what to fix, what went well ----------
    const oppName = me.oppPid ? byPid[me.oppPid].championName : 'your opponent';
    const fix = [];
    const behindSolo = deaths.filter((d) => d.kind === 'solo' && d.behind && d.t < 1200);
    if (behindSolo.length) fix.push({ w: 300 + 350 * behindSolo.length, focus: 'behind_fights', title: `${behindSolo.length} fight${behindSolo.length > 1 ? 's' : ''} taken while behind`, detail: `Solo deaths to ${oppName} at ${behindSolo.map((d) => clock(d.t)).join(', ')} while you were a level down or 300g+ behind.`, tip: 'When the dashboard says "Don\'t fight", last-hit and wait for your item or level. The fight is lost before it starts.' });
    const ganks = early.filter((d) => d.kind === 'gank');
    if (ganks.length) fix.push({ w: 250 * ganks.length + (cwBought ? 0 : 100), focus: 'ganks', title: `${ganks.length} gank death${ganks.length > 1 ? 's' : ''} before 14:00`, detail: `${ganks.map((d) => `${clock(d.t)} (${d.killers.join(' + ')}${d.enemyHalf ? ', past the river' : ''})`).join(', ')}.${cwBought ? '' : ' No Control Ward bought all game.'}`, tip: 'Before stepping past the middle of the lane, check the jungler line. Unknown means ward or stay back.' });
    if (cs10 != null && cs10 < target) fix.push({ w: (target - cs10) * 21, focus: 'cs10', title: `CS at 10: ${cs10} (target ${target})`, detail: `About ${Math.round((target - cs10) * 21)} gold missed in 10 minutes${me.oppPid ? `; ${oppName} had ${F(10, me.oppPid).minionsKilled + F(10, me.oppPid).jungleMinionsKilled}` : ''}. First item at ${firstItemAt ? clock(firstItemAt) : '—'}.`, tip: 'Last hits before trades. Crash the wave before you recall so it doesn\'t die to your turret.' });
    const caught = deaths.filter((d) => d.t >= 1200 && d.alliesNear === 0 && d.kind !== 'solo');
    if (caught.length) fix.push({ w: 450 * caught.length, title: `Caught alone ${caught.length}× after 20:00`, detail: `${caught.map((d) => `${clock(d.t)} by ${d.killers.join(' + ')} (${d.timer}s dead)`).join(', ')}. No teammate within reach.`, tip: 'In a side lane, leave as soon as two enemies (or a fed one) are missing. Late deaths cost the most: long death timers lose objectives.' });
    const ignored = deaths.filter((d) => d.mode === 'retreat' || d.mode === 'safe');
    if (ignored.length) fix.push({ w: 200 * ignored.length, title: `${ignored.length} death${ignored.length > 1 ? 's' : ''} while the dashboard said Play safe / Back off`, detail: ignored.map((d) => clock(d.t)).join(', ') + '.', tip: 'Amber and red mean the numbers say no. Glance at the color before committing.' });
    if (me.gd15 != null && me.gd15 >= 1000 && me.buildShare < 0.25 && me.buildings < 8000) fix.push({ w: 400, title: `Lane lead not turned into towers`, detail: `You were ${gk(me.gd15)} gold up at 15:00 but did ${Math.round(me.buildings / 1000)}k tower damage (${Math.round(me.buildShare * 100)}% of your team).`, tip: 'With a lane lead: take plates before 14:00, then the tower, then push the next lane or join Herald/grubs. Gold only wins games once it becomes map pressure.' });
    if (missed.length) fix.push({ w: 180 * missed.length, title: `${missed.length} enemy objective${missed.length > 1 ? 's' : ''} taken while you were far away`, detail: missed.map((o) => `${o.sub && o.kind === 'Dragon' ? o.sub + ' ' : ''}${o.kind} ${clock(o.t)}`).join(', ') + '.', tip: 'Push your side wave 45-60s before an objective spawns, then walk or Teleport in. Splitting is fine only if it takes a tower in exchange.' });
    if (early.length >= 2) fix.push({ w: 150 * (early.length - 1), focus: 'early_deaths', title: `${early.length} deaths before 14:00`, detail: early.map((d) => `${clock(d.t)} ${d.kind}`).join(', ') + '.', tip: 'After the first death, play the rest of laning for your item, not for kills.' });
    if (!cwBought && mins > 15) fix.push({ w: 120, focus: 'wards', title: 'No Control Ward bought', detail: `Vision score ${me.vision} (${(me.vision / mins).toFixed(1)}/min).`, tip: 'Keep 75g on every back for a Control Ward in the river or tri-brush.' });
    fix.sort((a, b) => b.w - a.w);

    const good = [];
    if (me.gd15 != null && me.gd15 >= 500) good.push({ title: `Won lane: ${gk(me.gd15)} gold at 15:00`, detail: `vs ${oppName}${soloKills ? `, ${soloKills} solo kill${soloKills > 1 ? 's' : ''}` : ''}` });
    if (cs10 != null && cs10 >= target) good.push({ title: `CS at 10: ${cs10}`, detail: `target ${target} reached` });
    if (me.buildShare >= 0.3 && me.buildings >= 5000) good.push({ title: `Tower pressure: ${Math.round(me.buildings / 1000)}k damage`, detail: `${Math.round(me.buildShare * 100)}% of your team's tower damage, ${plates} plate${plates === 1 ? '' : 's'}` });
    if (early.length === 0 && mins > 15) good.push({ title: 'No deaths before 14:00', detail: 'clean laning phase' });
    if (me.kp >= 0.55) good.push({ title: `Kill participation ${Math.round(me.kp * 100)}%`, detail: 'you were where the fights were' });
    if (me.dmgShare >= 0.25) good.push({ title: `Damage share ${Math.round(me.dmgShare * 100)}%`, detail: 'top damage dealer on your team' });
    if (soloKills >= 2 && !(me.gd15 >= 500)) good.push({ title: `${soloKills} solo kills on ${oppName}`, detail: '' });
    if (live && live.focus && live.focus.passed) good.push({ title: `Focus done: ${live.focus.title}`, detail: live.focus.detail });

    // ---------- a sentence on how the game was decided ----------
    const worstLane = lanes.slice().sort((a, b) => (win ? b.gd15 - a.gd15 : a.gd15 - b.gd15))[0];
    const fedEnemy = theirs.filter((p) => p.k - p.d >= 6).sort((a, b) => (b.k - b.d) - (a.k - a.d))[0];
    const fedAlly = mine.filter((p) => p.k - p.d >= 6 && !p.isMe).sort((a, b) => (b.k - b.d) - (a.k - a.d))[0];
    const story = [];
    const t15 = series[Math.min(15, series.length - 1)];
    if (t15) story.push(`Your team was ${gk(t15.team)} gold at 15:00`);
    if (worstLane && worstLane.gd15 != null && Math.abs(worstLane.gd15) >= 700) story.push(`the biggest lane gap was ${ROLE_NAME[worstLane.role].toLowerCase()} (${gk(worstLane.gd15)}${worstLane.ally.isMe ? ', your lane' : ''})`);
    if (!win && fedEnemy) {
      const onMe = events.filter((e) => e.type === 'CHAMPION_KILL' && e.killerId === fedEnemy.pid && e.victimId === me.pid).length;
      story.push(`${fedEnemy.champ} went ${fedEnemy.k}/${fedEnemy.d}/${fedEnemy.a}${onMe >= 2 ? ` (${onMe} of those kills on you)` : ''}`);
      // the ratings are relative to a team that may have been worse; losing the biggest lane or feeding
      // their carry still makes it a shared loss
      if (onMe >= 4 && (tone === 'great' || tone === 'good')) { verdict = 'Shared loss'; tone = 'ok'; }
    }
    if (!win && worstLane && worstLane.ally.isMe && worstLane.gd15 <= -1000 && (tone === 'great' || tone === 'good')) { verdict = 'Shared loss'; tone = 'ok'; }
    if (win && fedAlly) story.push(`${fedAlly.champ} went ${fedAlly.k}/${fedAlly.d}/${fedAlly.a}`);
    if (!win && maxLead >= 2500) story.push(`your team was up ${gk(maxLead)} at ${clock(leadAt.t)} and lost it`);
    if (win && maxDef <= -2500) story.push(`you came back from ${gk(maxDef)} at ${clock(defAt.t)}`);
    const o = (k) => objSummary.find((x) => x.kind === k);
    story.push(`dragons ${o('Dragon').ours}–${o('Dragon').theirs}, barons ${o('Baron').ours}–${o('Baron').theirs}, towers ${o('Tower').ours}–${o('Tower').theirs}`);

    return {
      id: m.metadata.matchId, gameId: info.gameId, win, dur, end: info.gameEndTimestamp, queue: info.queueId,
      me, mine, theirs, players, matchMean, teamRank, matchRank, verdict, tone, lanes, series, objectives, objSummary,
      deaths, missed, stats, fix: fix.slice(0, 3), moreFix: fix.slice(3), good: good.slice(0, 3), story, oppName, live, T,
    };
  }

  // ---------- loading ----------
  async function loadList(D, { fresh = false } = {}) {
    const puuid = await Review.ensurePuuid(D);
    const ids = (await Scout.api('match', `/lol/match/v5/matches/by-puuid/${puuid}/ids?count=12${fresh ? '&jcfresh=1' : ''}`)) || [];
    const out = [];
    for (const id of ids) {
      const m = await Scout.api('match', `/lol/match/v5/matches/${id}`);
      if (!m || !m.info || m.info.mapId !== 11) continue;
      const p = m.info.participants.find((x) => x.puuid === puuid);
      if (!p || p.gameEndedInEarlySurrender) continue;
      const o = m.info.participants.find((x) => x.teamId !== p.teamId && x.teamPosition && x.teamPosition === p.teamPosition);
      out.push({ id, win: p.win, champ: p.championName, opp: o ? o.championName : null, end: m.info.gameEndTimestamp, dur: m.info.gameDuration, queue: m.info.queueId, kda: `${p.kills}/${p.deaths}/${p.assists}` });
      if (out.length >= 10) break;
    }
    S.list = out;
    return out;
  }

  async function open(D, id) {
    S.status = 'loading'; S.sel = id; S.error = null; S.replay = null; S.replayMsg = ''; changed();
    try {
      const puuid = await Review.ensurePuuid(D);
      const [m, tl] = [await Scout.api('match', `/lol/match/v5/matches/${id}`), await Scout.api('match', `/lol/match/v5/matches/${id}/timeline`)];
      if (!m || !tl) throw new Error('Riot has not published this game yet. Try again in a minute.');
      let hist = []; try { hist = await (await fetch('/api/history')).json(); } catch {}
      const me = m.info.participants.find((p) => p.puuid === puuid);
      const live = (hist || []).filter((h) => h.champ === me.championName && Math.abs((h.endedAt || 0) - m.info.gameEndTimestamp) < 15 * 60000).pop() || null;
      const T = Review.state.games.length >= 3 ? Review.trends(Review.state.games) : null;
      S.R = build(D, m, tl, puuid, live, T);
      S.status = 'done';
      replayStatus();
    } catch (e) { S.status = 'error'; S.error = e.message; }
    changed();
  }

  // after a game: wait until Riot publishes it (usually 1-5 minutes), then open it
  async function waitForNew(D, endedAt) {
    if (S.waiting) return;
    S.waiting = { since: Date.now(), endedAt }; changed();
    const known = new Set(S.list.map((x) => x.id));
    for (let i = 0; i < 25 && S.waiting; i++) {
      try {
        const list = await loadList(D, { fresh: true });
        const g = list.find((x) => !known.has(x.id) && Math.abs(x.end - endedAt) < 20 * 60000);
        if (g) { S.waiting = null; await open(D, g.id); return g.id; }
      } catch {}
      await new Promise((r) => setTimeout(r, 60000));
    }
    S.waiting = null; changed();
    return null;
  }

  // ---------- replay (League client + Replay API) ----------
  const REPLAY_STATE = {
    download: ['Replay available', 'Download it to watch your deaths.'], downloading: ['Downloading replay…', ''], checking: ['Checking replay…', ''],
    watch: ['Replay downloaded', 'Open it, then use the Watch buttons next to each death.'], incompatible: ['Replay from an older patch', 'League only plays replays from the current patch.'],
    missingOrExpired: ['Replay expired', 'Riot keeps replays for a limited time.'], lost: ['Replay not available', ''], error: ['Replay error', ''],
  };
  async function replayStatus() {
    if (!S.R) return;
    try {
      const r = await fetch(`/api/lcu/lol-replays/v1/metadata/${S.R.gameId}`);
      S.replay = r.ok ? (await r.json()).state || 'unknown' : r.status === 503 ? 'client_closed' : 'unknown';
    } catch { S.replay = 'unknown'; }
    changed();
    if (S.replay === 'downloading' || S.replay === 'checking') setTimeout(replayStatus, 3000);
  }
  async function replayAction(action) {
    if (!S.R) return;
    const r = await fetch(`/api/lcu/lol-replays/v1/rofls/${S.R.gameId}/${action}`, { method: 'POST' });
    S.replayMsg = r.ok ? (action === 'watch' ? 'Opening the replay… (it loads like a game; in the replay press the number/F-key of your champion to follow yourself)' : 'Download started.') : `The client refused (${r.status}).`;
    changed();
    setTimeout(replayStatus, 1500);
  }
  async function jump(t) {
    const r = await fetch('/api/replay/playback', { method: 'POST', body: JSON.stringify({ time: Math.max(0, t), paused: false, speed: 1 }) });
    if (r.ok) S.replayMsg = `Jumped to ${clock(t)}.`;
    else { let e = ''; try { e = (await r.json()).error; } catch {} S.replayMsg = e === 'replay_not_running' ? 'Open the replay first (Watch replay button), wait until it has loaded, then click again.' : 'REPLAY_API_OFF'; }
    changed();
  }

  return { state: S, build, loadList, open, waitForNew, replayStatus, replayAction, jump, REPLAY_STATE, ROLE_NAME, QUEUES, onChange: (fn) => { onChange = fn; }, gk };
})();
