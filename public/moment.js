// Jax Coach - replay coach.
// One moment of a finished game (one of your deaths, or any second you pick) reviewed by an agent: the timeline
// around it (positions, health, levels, items, every event of the last two minutes, what did the damage) plus
// pictures from League's replay at fixed seconds before it. The answer is second-precise: where it went wrong,
// what to do instead, and the cue to see it coming next time.

const Moment = (() => {
  const S = { cur: null, q: '', cap: null, msg: '', answers: {}, pending: {} };
  let onChange = () => {};
  const changed = () => onChange();
  const KEY = 'jc.moments';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clock = (s) => Engine.fmtClock(Math.max(0, s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyOf = (gameId, t) => `${gameId}:${Math.round(t)}`;

  try { S.answers = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { S.answers = {}; }
  // questions still being answered survive a reload of the page (the job keeps running on the PC)
  try { S.pending = JSON.parse(localStorage.getItem(`${KEY}.pending`) || '{}') || {}; } catch { S.pending = {}; }
  const savePending = () => { try { localStorage.setItem(`${KEY}.pending`, JSON.stringify(S.pending)); } catch {} };
  function save() {
    const keep = Object.entries(S.answers).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 40);
    S.answers = Object.fromEntries(keep);
    try { localStorage.setItem(KEY, JSON.stringify(S.answers)); } catch {}
  }

  // ---------- what the data says about a moment ----------
  // finer than Review.zoneOf: which side of the map, whose jungle
  function where(p, team) {
    if (!p) return '?';
    const z0 = Review.zoneOf(p), z = z0 === 'blue base' || z0 === 'red base' ? ((z0 === 'blue base') === (team === 100) ? 'your base' : 'their base') : z0;
    const half = p.y > p.x ? 'top side' : 'bot side';
    if (z === 'jungle') return `${(p.x + p.y < 14900) === (team === 100) ? 'your' : 'their'} jungle, ${half}`;
    if (z === 'river') return `river, ${half}`;
    if (z === 'top lane' || z === 'bot lane' || z === 'mid lane') {
      const d = p.x + p.y - 14900;   // < 0: blue half of the lane
      const mine = team === 100 ? d < -1500 : d > 1500, theirs = team === 100 ? d > 1500 : d < -1500;
      return `${z}, ${mine ? 'your half' : theirs ? 'their half' : 'middle'}`;
    }
    return z;
  }
  const TURRET_NAME = (k) => (k ? k.replace('-', ' ') : null);

  function facts(D, raw, t, R) {
    const info = raw.m.info, P = info.participants, frames = raw.tl.info.frames, last = frames.length - 1;
    const me = P.find((p) => p.puuid === raw.puuid);
    if (!me) return null;
    const byPid = {}; P.forEach((p) => { byPid[p.participantId] = p; });
    const role = (p) => p.teamPosition || '';
    const opp = role(me) ? P.find((q) => q.teamId !== me.teamId && role(q) === role(me)) : null;
    const ejg = P.find((q) => q.teamId !== me.teamId && role(q) === 'JUNGLE');
    const ajg = P.find((q) => q.teamId === me.teamId && role(q) === 'JUNGLE' && q !== me);
    const enemyTeam = me.teamId === 100 ? 200 : 100;
    const events = frames.flatMap((f) => f.events || []);
    const buildingKills = events.filter((e) => e.type === 'BUILDING_KILL' && e.position);
    const who = (pid) => {
      const p = byPid[pid];
      if (!p) return 'turret/minions';
      return p === me ? 'you' : `${p.championName} (${p.teamId === me.teamId ? 'ally' : 'enemy'}${role(p) ? ' ' + role(p).toLowerCase().replace('utility', 'support').replace('middle', 'mid').replace('bottom', 'adc') : ''})`;
    };
    const itemName = (id) => (D.dd.items[id] ? D.dd.items[id].name : `item ${id}`);

    // per-minute snapshots on both sides of the moment (Riot records positions and health once a minute)
    const snapOf = (mi, p) => {
      const f = frames[mi] && frames[mi].participantFrames[p.participantId];
      if (!f) return null;
      const cs = f.championStats || {};
      const o = { level: f.level, gold: f.totalGold, unspent: f.currentGold, cs: f.minionsKilled + f.jungleMinionsKilled,
        hp: cs.healthMax ? `${cs.health}/${cs.healthMax}` : null, where: where(f.position, me.teamId), pos: f.position ? [f.position.x, f.position.y] : null };
      if (p === me) {
        const own = Review.nearestTurret(me.teamId, f.position, mi * 60, buildingKills);
        if (own) o.nearestOwnTurret = `${TURRET_NAME(own.key)}, ${own.dist} units away (its range is about 750)`;
      }
      return o;
    };
    const dist = (a, b) => (a && b && a.pos && b.pos ? Math.round(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])) : null);
    const m0 = clamp(Math.floor(t / 60), 0, last);
    const snapshots = [m0 - 1, m0, m0 + 1].filter((mi) => mi >= 0 && mi <= last).map((mi) => {
      const s = { at: clock(mi * 60), sec: mi * 60, you: snapOf(mi, me) };
      if (opp) s.opponent = snapOf(mi, opp);
      if (ejg) s.enemyJungler = snapOf(mi, ejg);
      if (ajg) s.allyJungler = snapOf(mi, ajg);
      s.distanceYouToOpponent = dist(s.you, s.opponent);
      s.distanceYouToEnemyJungler = dist(s.you, s.enemyJungler);
      return s;
    });

    // what each of you carried at that second (purchases, sales, undos, items used up or combined)
    const inventory = (pid) => {
      let bag = [];
      for (const e of events) {
        if (e.timestamp / 1000 > t || e.participantId !== pid) continue;
        if (e.type === 'ITEM_PURCHASED') bag.push(e.itemId);
        else if (e.type === 'ITEM_SOLD' || e.type === 'ITEM_DESTROYED') { const i = bag.indexOf(e.itemId); if (i >= 0) bag.splice(i, 1); }
        else if (e.type === 'ITEM_UNDO') {
          if (e.beforeId && !e.afterId) { const i = bag.lastIndexOf(e.beforeId); if (i >= 0) bag.splice(i, 1); }
          else if (e.afterId && !e.beforeId) bag.push(e.afterId);
        }
      }
      return bag.map(itemName);
    };

    // everything that happened in the two minutes before (plus a few seconds after)
    const lines = [];
    const LANE = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' };
    const close = (e) => {
      if (!e.position) return true;
      const f = frames[clamp(Math.round(e.timestamp / 60000), 0, last)].participantFrames[me.participantId];
      return !f || !f.position || Math.hypot(f.position.x - e.position.x, f.position.y - e.position.y) < 5000;
    };
    const relevant = new Set([me.participantId, opp && opp.participantId, ejg && ejg.participantId, ajg && ajg.participantId].filter(Boolean));
    for (const e of events) {
      const s = e.timestamp / 1000;
      if (s < t - 120 || s > t + 8) continue;
      let text = null;
      if (e.type === 'CHAMPION_KILL') {
        const ass = (e.assistingParticipantIds || []).map(who);
        text = `${who(e.killerId)} killed ${who(e.victimId)}${ass.length ? ` (with ${ass.join(', ')})` : ''} at ${where(e.position, me.teamId)}${e.shutdownBounty ? `, shutdown ${e.shutdownBounty}g` : ''}`;
      } else if (e.type === 'LEVEL_UP' && relevant.has(e.participantId)) text = `${who(e.participantId)} reached level ${e.level}`;
      else if (e.type === 'ITEM_PURCHASED' && relevant.has(e.participantId)) text = `${who(e.participantId)} bought ${itemName(e.itemId)}`;
      else if (e.type === 'ITEM_SOLD' && e.participantId === me.participantId) text = `you sold ${itemName(e.itemId)}`;
      else if (e.type === 'WARD_PLACED' && ['YELLOW_TRINKET', 'SIGHT_WARD', 'CONTROL_WARD', 'BLUE_TRINKET'].includes(e.wardType) && byPid[e.creatorId] && byPid[e.creatorId].teamId === me.teamId && (e.creatorId === me.participantId || s > t - 60))
        text = `${who(e.creatorId)} placed a ${e.wardType.toLowerCase().replace(/_/g, ' ')}`;
      else if (e.type === 'WARD_KILL' && (e.killerId === me.participantId || relevant.has(e.killerId))) text = `${who(e.killerId)} destroyed a ${String(e.wardType || 'ward').toLowerCase().replace(/_/g, ' ')}`;
      else if (e.type === 'BUILDING_KILL') text = `${e.teamId === me.teamId ? 'your' : 'their'} ${LANE[e.laneType] || ''} ${String(e.towerType || e.buildingType).toLowerCase().replace(/_/g, ' ')} destroyed`;
      else if (e.type === 'TURRET_PLATE_DESTROYED' && close(e)) text = `a plate of ${e.teamId === me.teamId ? 'your' : 'their'} ${LANE[e.laneType] || ''} turret fell`;
      else if (e.type === 'ELITE_MONSTER_KILL') text = `${byPid[e.killerId] && byPid[e.killerId].teamId === me.teamId ? 'your team' : 'their team'} took ${String(e.monsterSubType || e.monsterType).toLowerCase().replace(/_/g, ' ')}`;
      else if (e.type === 'SKILL_LEVEL_UP' && e.skillSlot === 4 && relevant.has(e.participantId) && e.participantId !== me.participantId) text = `${who(e.participantId)} learned his ultimate (R)`;
      if (text) lines.push({ t: clock(s), sec: Math.round(s), text });
    }

    const death = events.find((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.participantId && Math.abs(e.timestamp / 1000 - t) < 4);
    let deathInfo = null;
    if (death) {
      const p = death.position;
      deathInfo = {
        killer: who(death.killerId), assists: (death.assistingParticipantIds || []).map(who), where: where(p, me.teamId), pos: p ? [p.x, p.y] : null,
        underYourTurret: TURRET_NAME(Review.turretAt(me.teamId, p, t, buildingKills)), underTheirTurret: TURRET_NAME(Review.turretAt(enemyTeam, p, t, buildingKills)),
        damageThatKilledYou: Review.damageTaken(death, byPid).map((d) => `${d.from}: ${d.what} ${d.dmg}`),
        bountyGiven: death.bounty || null, shutdownGiven: death.shutdownBounty || null,
      };
    }
    const rd = R && R.deaths ? R.deaths.find((d) => Math.abs(d.t - t) < 4) : null;
    const earlier = events.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.participantId && e.timestamp / 1000 < t - 4).map((e) => `${clock(e.timestamp / 1000)} by ${who(e.killerId)}`);
    const kills = events.filter((e) => e.type === 'CHAMPION_KILL' && e.killerId === me.participantId && e.timestamp / 1000 < t - 4).length;

    const out = {
      game: { matchId: raw.m.metadata.matchId, patch: String(info.gameVersion || '').split('.').slice(0, 2).join('.'), yourSide: me.teamId === 100 ? 'blue (bottom-left base)' : 'red (top-right base)', length: clock(info.gameDuration), result: me.win ? 'win' : 'loss' },
      you: { champion: me.championName, role: role(me).toLowerCase() || '?', killsBefore: kills, deathsBefore: earlier },
      opponent: opp ? opp.championName : null, enemyJungler: ejg ? ejg.championName : null, allyJungler: ajg ? ajg.championName : null,
      moment: { sec: Math.round(t), clock: clock(t), kind: death ? 'death' : 'moment' },
      death: deathInfo, dashboardSaid: rd && rd.mode ? rd.mode : null,
      inventory: { you: inventory(me.participantId), opponent: opp ? inventory(opp.participantId) : [] },
      snapshots, events: lines,
      notes: 'Positions and health come from once-a-minute snapshots (they can be up to 59 seconds off the moment). Jungler positions are where he really was, not what you could see. Minion waves, enemy health and cooldowns are not in the data: look at the screenshots.',
    };
    out.summary = summary(out);
    return out;
  }

  // a few readable lines for the page
  function summary(F) {
    const s = [];
    const snap = F.snapshots.filter((x) => x.sec <= F.moment.sec).pop() || F.snapshots[0];
    if (F.death) {
      s.push(`Killed by ${F.death.killer}${F.death.assists.length ? ` with ${F.death.assists.join(', ')}` : ''} at ${F.death.where}${F.death.underYourTurret ? `, under your ${F.death.underYourTurret} turret` : ''}${F.death.underTheirTurret ? `, under their ${F.death.underTheirTurret} turret` : ''}.`);
      if (F.death.damageThatKilledYou.length) s.push(`Damage: ${F.death.damageThatKilledYou.join(' · ')}`);
    }
    if (snap && snap.you) {
      const y = snap.you, o = snap.opponent;
      s.push(`At ${snap.at}: you level ${y.level}${o ? ` vs ${F.opponent} ${o.level}` : ''}, gold ${o ? `${y.gold - o.gold >= 0 ? '+' : '−'}${Math.abs(y.gold - o.gold)} vs him` : y.gold}, ${y.unspent}g unspent${y.hp ? `, health ${y.hp}` : ''}.`);
      if (snap.enemyJungler) s.push(`${F.enemyJungler} (their jungler) was at ${snap.enemyJungler.where} at ${snap.at}.`);
    }
    const lv = F.events.filter((e) => /reached level (6|11|16)|learned his ultimate/.test(e.text) && !e.text.startsWith('you '));
    for (const e of lv.slice(-2)) s.push(`${e.t}: ${e.text}.`);
    if (F.you.deathsBefore.length) s.push(`Earlier deaths: ${F.you.deathsBefore.join(', ')}.`);
    return s;
  }

  // ---------- pictures from the replay ----------
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  async function waitSeek(sec) {
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      try {
        const p = await (await fetch('/api/replay/playback', { cache: 'no-store' })).json();
        if (!p.seeking && Math.abs((p.currentTime || 0) - sec) < 2) { await sleep(700); return true; }
      } catch {}
    }
    return false;
  }
  // seconds before the moment, and whether fog of war is on (what one team could see) or off (everything)
  const PLAN = [[25, false], [12, true], [12, false], [5, true], [5, false], [1, false]];
  async function capture(R, t) {
    const dir = `${R.gameId}-${Math.round(t)}`, list = [];
    let failed = null;
    S.cap = { step: 0, total: PLAN.length }; S.msg = ''; changed();
    try {
      await post('/api/replay/playback', { paused: true });
      // follow your own champion (your name only; League may ignore it, then the camera stays where it was)
      try { await post('/api/replay/render', { selectionName: R.me.name, cameraAttached: true }); } catch {}
      let at = null;
      for (const [before, fog] of PLAN) {
        const sec = Math.max(0, Math.round(t - before));
        if (sec !== at) { await post('/api/replay/playback', { time: sec, paused: true }); await waitSeek(sec); at = sec; }
        await post('/api/replay/render', { fogOfWar: fog }); await sleep(500);
        const name = `${before}s-before${fog ? '-fog' : ''}`;
        try { await post('/api/replay/shot', { dir, name }); list.push({ file: `shots/${name}.jpg`, url: `/api/replay/shots/${dir}/${name}.jpg`, sec, clock: clock(sec), fog }); }
        catch (e) { if (e.message === 'minimized') throw new Error('The replay window is minimized. Bring it back, then try again.'); failed = e.message; }
        S.cap.step++; changed();
      }
      try { await post('/api/replay/render', { fogOfWar: false }); } catch {}
      await post('/api/replay/playback', { time: Math.max(0, t - 20), paused: true });
    } catch (e) {
      S.cap = null;
      S.msg = e.message === 'replay_not_running' ? 'Open the replay first (Watch replay), wait until it has loaded, then try again.'
        : e.message === 'replay_api_off' ? 'The Replay API is off: switch it on in the Replay card, then reopen the replay.' : `Couldn't capture the replay: ${e.message}`;
      changed();
      return null;
    }
    S.cap = null;
    if (!list.length) S.msg = failed === 'blank'
      ? 'The pictures of the replay came out black (League in exclusive fullscreen). Switch League to Borderless in its video settings, or use "Coach me from the data only".'
      : `Couldn't take pictures of the replay${failed ? ` (${failed})` : ''}. "Coach me from the data only" still works.`;
    changed();
    return list.length ? { dir, list } : null;
  }

  // ---------- asking the coach ----------
  function open(D, R, raw, t, label) {
    const F = facts(D, raw, t, R);
    if (!F) return;
    S.cur = { key: keyOf(R.gameId, t), gameId: R.gameId, t: Math.round(t), label, facts: F };
    S.msg = '';
    changed();
  }
  function close() { S.cur = null; S.msg = ''; changed(); }
  async function ask(D, R, withReplay) {
    const C = S.cur;
    if (!C || S.cap || S.pending[C.key]) return;
    if (!Agent.ready()) { S.msg = 'The coach needs Claude Code (see the Playbook tab).'; changed(); return; }
    const shots = withReplay ? await capture(R, C.t) : null;
    if (withReplay && !shots) return;
    const q = String(S.q || '').trim().slice(0, 600);
    const job = await Agent.start('moment', {
      champion: R.me.champ, championName: R.me.champ, key: `moment-${C.key}`, title: `Replay coach: ${clock(C.t)}${C.facts.opponent ? ` vs ${C.facts.opponent}` : ''}`,
      patch: C.facts.game.patch, question: q || null, facts: C.facts, shots: shots ? shots.dir : null, pictures: shots ? shots.list.map(({ file, sec, clock: c, fog }) => ({ file, sec, clock: c, fog })) : [],
    });
    if (!job) { S.msg = `Couldn't start the coach${Agent.state.lastError ? `: ${Agent.state.lastError}` : ''}.`; changed(); return; }
    S.pending[C.key] = { jobId: job.id, at: Date.now(), shots, q };
    savePending();
    S.q = '';
    changed();
  }
  const str = (x, n = 400) => (x == null ? '' : String(x).slice(0, n));
  // a question whose job dropped out of the job list (many newer jobs, or the app was closed for a while):
  // read its answer directly; give up after 10 minutes (the job is stopped after 6)
  async function recover() {
    for (const [k, p] of Object.entries(S.pending)) {
      if (Date.now() - p.at < 10 * 60000) continue;
      let ok = false;
      try { ok = (await fetch(`/api/agent/jobs/${p.jobId}/out/answer.json`, { cache: 'no-store' })).ok; } catch {}
      if (ok) await finished({ id: p.jobId, status: 'done' });
      else { delete S.pending[k]; savePending(); if (S.cur && S.cur.key === k) S.msg = "The coach didn't finish this one. Try again?"; changed(); }
    }
  }
  setTimeout(recover, 5000); setInterval(recover, 60000);
  async function finished(j) {
    const k = Object.keys(S.pending).find((x) => S.pending[x].jobId === j.id);
    const p = k ? S.pending[k] : null;
    if (!p) return;
    delete S.pending[k];
    savePending();
    let a = null;
    if (j.status === 'done') { try { const r = await fetch(`/api/agent/jobs/${j.id}/out/answer.json`, { cache: 'no-store' }); if (r.ok) a = await r.json(); } catch {} }
    if (!a || !(a.headline || a.answer)) {
      S.msg = j.status === 'done' ? "The coach didn't write an answer. Try again?" : `The coach couldn't finish${j.error ? `: ${String(j.error).slice(0, 120)}` : ''}.`;
      changed(); return;
    }
    const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 6).map((s) => ({ sec: Number.isFinite(+s.sec) ? Math.round(+s.sec) : null, what: str(s.what, 300), instead: str(s.instead, 300) })).filter((s) => s.what || s.instead);
    S.answers[k] = {
      at: Date.now(), jobId: j.id, question: p.q || null, headline: str(a.headline, 200), mistakeAt: Number.isFinite(+a.mistakeAt) ? Math.round(+a.mistakeAt) : null,
      steps, lesson: str(a.lesson, 300), watchFor: str(a.watchFor, 300), answer: str(a.answer, 1500), confidence: str(a.confidence, 200),
      personal: a.personal && typeof a.personal === 'object' ? a.personal : null, shots: p.shots ? p.shots.list : [],
    };
    save();
    changed();
  }

  return {
    state: S, open, close, ask, finished, facts, capture, keyOf,
    answerFor: (k) => S.answers[k] || null,
    markPersonal: (k, how) => { if (S.answers[k]) { S.answers[k].personalDone = how; save(); changed(); } },
    onChange: (fn) => { onChange = fn; },
  };
})();
