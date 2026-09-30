// Jax Coach - research agents on the page: when to ask, what to send, what to do with the answer.
//
//  champion  a champion without a playbook (champ select hover/lock, or in game): a quick run (build, runes, the
//            lane opponent, ~1-2 min) plus a full research run (everything, ~10-30 min). Parts go live as they arrive.
//  gameplan  once picks are locked (or at game start): how this exact game is won, the build for it, extra rules.
//  adapt     in game, at moments that change the plan: your death, an item spike, big gold swings, fed enemies,
//            new threats, Baron/Soul/inhibitors, 14:00/20:00/28:00, or the Reassess button. At most one at a time.
//  review    after the game: what the playbook got wrong, as changes you can approve on the Playbook tab.
// Plans apply directly (build order, rule parameters, extra rules); playbook changes need your approval.

const Agent = (() => {
  const S = {
    status: null,           // { installed, loggedIn, models }
    jobs: [],               // recent jobs (server)
    handled: {},            // job id -> true once its result was used
    game: null,             // this game: { key, champ, plan, history, lastAdaptAt, lastSnap, marks, pending, jobId }
    csPlan: null,           // plan made in champ select, adopted at game start: { champ, plan, at, jobId }
    csKey: null, csPlanJob: null,
    proposals: [],          // post-game review proposals: { jobId, champ, proposal, at, done: {} }
    lastError: null,
  };
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const MIN_GAP = 120;      // seconds of game time between automatic reassessments
  let applyHook = () => {};

  try { S.proposals = JSON.parse(localStorage.getItem('jc.proposals') || '[]'); } catch {}
  const saveProposals = () => { try { localStorage.setItem('jc.proposals', JSON.stringify(S.proposals.slice(-20))); } catch {} };

  const ready = () => !!(S.status && S.status.installed && S.status.loggedIn);
  async function getJSON(url, opts) { const r = await fetch(url, { cache: 'no-store', ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; }
  async function refreshStatus(force = false) {
    try { S.status = await getJSON(`/api/agent/status${force ? '?refresh=1' : ''}`); } catch { S.status = { installed: false, loggedIn: false }; }
    changed();
    return S.status;
  }
  async function login() { await fetch('/api/agent/login', { method: 'POST' }); }

  const running = (key) => S.jobs.find((j) => j.status === 'running' && j.key === key);
  // a job with this key already ran (done, stopped by you, or failed in the last 30 minutes): don't start it again
  const settled = (key) => S.jobs.some((j) => j.key === key && (j.status === 'done' || j.status === 'cancelled' || (j.status === 'failed' && Date.now() - new Date(j.created).getTime() < 30 * 60000)));
  async function start(type, fields) {
    if (!ready()) return null;
    // test switch: record what would be started instead of starting it (Agent.state.dryRun = [])
    if (Array.isArray(S.dryRun)) { const job = { id: `dry-${S.dryRun.length}`, type, key: fields.key, status: 'running', created: new Date().toISOString(), ...fields }; S.dryRun.push(job); return job; }
    try {
      const job = await getJSON('/api/agent/jobs', { method: 'POST', body: JSON.stringify({ type, role: 'top', ...fields }) });
      S.jobs = [job, ...S.jobs.filter((j) => j.id !== job.id)];
      changed();
      return job;
    } catch (e) { S.lastError = e.message; changed(); return null; }
  }
  async function cancel(id) { try { await getJSON(`/api/agent/jobs/${id}/cancel`, { method: 'POST' }); } catch {} refreshJobs(); }
  async function refreshJobs() {
    try { S.jobs = await getJSON('/api/agent/jobs'); } catch { return; }
    for (const j of S.jobs) if (j.status !== 'running' && !S.handled[j.id]) await finished(j);
    changed();
  }

  // ---------- champion research ----------
  const patchLabel = (D) => {
    const m = String(D.dd.version || '').match(/^(\d+)\.(\d+)/);
    return m ? `${+m[1] + 10}.${m[2]}` : (D.shared.patch || '');   // Data Dragon 16.19 = patch 26.19
  };
  function ensureChampion(D, cid, oppCid, full = true) {
    if (!cid || !ready() || Playbooks.has(cid) && !Playbooks.isDraft(cid)) return;
    const name = (D.dd.champs[cid] || {}).name || cid;
    const opp = oppCid ? { id: oppCid, name: (D.dd.champs[oppCid] || {}).name || oppCid } : null;
    if (!Playbooks.has(cid) && !running(`quick-${cid}`) && !settled(`quick-${cid}`)) {
      start('quick', { champion: cid, championName: name, key: `quick-${cid}`, patch: patchLabel(D), title: `Quick build for ${name}`, opponent: opp, classTags: (D.dd.champs[cid] || {}).tags || [] });
    }
    if (full && !running(`champion-${cid}`) && !settled(`champion-${cid}`)) research(D, cid);
  }
  function research(D, cid, mode = 'new') {
    const name = (D.dd.champs[cid] || {}).name || cid;
    const topLaners = Object.values(D.dd.champs).filter((c) => (c.tags || []).some((t) => ['Fighter', 'Tank'].includes(t))).map((c) => c.id);
    return start('champion', { champion: cid, championName: name, key: `champion-${cid}`, patch: patchLabel(D), mode, title: `${mode === 'refresh' ? 'Refresh' : 'Research'} ${name}`, classTags: (D.dd.champs[cid] || {}).tags || [], candidateOpponents: topLaners });
  }

  // ---------- game facts for the agents (champions only: no player names) ----------
  function snapshot(A, D) {
    const nameOf = {};
    const all = [A.P.me, ...A.P.allies, ...A.P.enemies];
    for (const p of all) { const c = Engine.champ(D, p.cid).name; for (const n of [p.riotIdGameName, p.summonerName, p.riotId, p.name]) if (n) nameOf[String(n).split('#')[0]] = c; }
    const who = (n) => nameOf[String(n || '').split('#')[0]] || (/turret/i.test(n || '') ? 'a turret' : /minion/i.test(n || '') ? 'minions' : n || '?');
    const items = (p) => (p.items || []).map((i) => (Engine.itemData(D, i.itemID) || {}).name || i.displayName).filter(Boolean);
    const row = (p) => ({ champ: Engine.champ(D, p.cid).name, role: p.position || '', level: p.level, kda: `${p.scores.kills}/${p.scores.deaths}/${p.scores.assists}`, cs: p.scores.creepScore, items: items(p), dead: !!p.isDead });
    const ev = [];
    for (const e of A.events.slice(-40)) {
      const t = Engine.fmtClock(e.EventTime);
      if (e.EventName === 'ChampionKill') ev.push(`${t} ${who(e.KillerName)} killed ${who(e.VictimName)}${(e.Assisters || []).length ? ` (with ${(e.Assisters || []).map(who).join(', ')})` : ''}`);
      else if (/^(Dragon|Herald|Baron|Horde)Kill$/.test(e.EventName)) ev.push(`${t} ${who(e.KillerName)} took ${e.EventName.replace('Kill', '')}${e.DragonType ? ` (${e.DragonType})` : ''}`);
      else if (e.EventName === 'TurretKilled') ev.push(`${t} turret ${e.TurretKilled} destroyed`);
      else if (e.EventName === 'InhibKilled') ev.push(`${t} inhibitor ${e.InhibKilled} destroyed`);
    }
    const m = S.game && S.game.plan;
    return {
      clock: A.clock, minutes: Math.round(A.t / 6) / 10, phase: A.phaseLabel,
      dashboard: A.mode ? { mode: A.mode.mode, headline: A.mode.headline, reason: A.mode.reason, rule: A.mode.rule } : null,
      laneState: { label: A.state.label, reasons: A.state.reasons }, me: { ...row(A.P.me), gold: A.items.gold, hp: A.trace && A.trace.ctx ? Math.round(A.trace.ctx.me.hp * 100) : null },
      laneOpponent: A.P.opp ? row(A.P.opp) : null, allies: A.P.allies.map(row), enemies: A.P.enemies.map(row),
      dragonSoul: (() => { const dr = A.objs.find((o) => o.key === 'dragon'); return dr ? { drakes: `${dr.drakes.ours}-${dr.drakes.theirs}`, soulPoint: dr.soulPoint, soul: dr.soul } : null; })(),
      team: { itemGoldDiff: A.lanes.itemGoldDiff, kills: `${A.team.kills}-${A.team.ekills}`, towers: `${A.team.towers}-${A.team.etowers}`, dragons: `${A.lanes.dragons.mine}-${A.lanes.dragons.theirs}`, grubs: `${A.lanes.grubs.mine}-${A.lanes.grubs.theirs}`, heralds: `${A.lanes.heralds.mine}-${A.lanes.heralds.theirs}`, barons: `${A.lanes.barons.mine}-${A.lanes.barons.theirs}` },
      lanes: A.lanes.rows.map((r) => ({ role: r.role, ally: Engine.champ(D, r.ally.cid).name, enemy: Engine.champ(D, r.enemy.cid).name, verdict: r.verdict, goldDiff: r.diff })),
      enemyComp: { magicDamageShare: Math.round(A.comp.apShare * 100), perEnemy: (A.comp.dmg || []).map((x) => ({ champion: x.name, magicShare: Math.round(x.magic * 100), shareOfTeamDamage: Math.round(x.share * 100) })), tags: [...A.tags].filter((t) => t.startsWith('vs_')), healers: A.comp.strongHeal, tanks: A.comp.tanks },
      objectives: A.objs.map((o) => ({ name: o.label, status: o.status, in: o.status === 'upcoming' ? Engine.fmtClock(o.in) : null })),
      enemyJungler: A.jungler ? A.jungler.text : null, nextItem: A.items.priority ? A.items.priority.name : null,
      events: ev, currentPlan: m ? { headline: m.headline, build: m.build ? m.build.order : null, bullets: m.bullets } : null,
    };
  }
  function champSelectFacts(cs, D) {
    const idOf = (key) => (key ? D.dd.keyToId[String(key)] : null);
    const nm = (id) => (D.dd.champs[id] || {}).name || id;
    const POS = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'bot', utility: 'support' };
    const mine = (cs.myTeam || []).find((p) => p.cellId === cs.localPlayerCellId) || {};
    return {
      me: nm(idOf(mine.championId)), myPosition: POS[String(mine.assignedPosition || '').toLowerCase()] || 'top',
      allies: (cs.myTeam || []).filter((p) => p !== mine).map((p) => ({ champ: nm(idOf(p.championId || p.championPickIntent)), role: POS[String(p.assignedPosition || '').toLowerCase()] || '' })).filter((p) => p.champ),
      enemies: (cs.theirTeam || []).map((p) => ({ champ: nm(idOf(p.championId)), role: POS[String(p.assignedPosition || '').toLowerCase()] || '' })).filter((p) => p.champ),
    };
  }
  function playerProfile() {
    try {
      const T = Review.state.games.length >= 3 ? Review.trends(Review.state.games) : null;
      if (!T) return null;
      return { games: T.n, winRate: T.wr, cs10: T.cs10 != null ? Math.round(T.cs10) : null, goldDiff15: T.gd15 != null ? Math.round(T.gd15) : null, deathsBefore14PerGame: T.earlyDeathsPerGame, earlyDeathsThatWereGanks: `${T.earlyGanks.length}/${T.early.length}`, focus: Focus.current ? Focus.current.title : null };
    } catch { return null; }
  }

  // ---------- champ select ----------
  function onChampSelect(cs, D) {
    if (!cs) return;
    const idOf = (key) => (key ? D.dd.keyToId[String(key)] : null);
    const mine = (cs.myTeam || []).find((p) => p.cellId === cs.localPlayerCellId) || {};
    const myChamp = idOf(mine.championId || mine.championPickIntent);
    const enemies = (cs.theirTeam || []).map((p) => idOf(p.championId)).filter(Boolean);
    const oppGuess = enemies.find((id) => ((D.dd.champs[id] || {}).tags || []).some((t) => ['Fighter', 'Tank'].includes(t))) || null;
    // hovering only starts the quick build; the full research starts on lock-in or after 15s on the same champion
    if (myChamp !== S.hover) { S.hover = myChamp; S.hoverSince = Date.now(); }
    if (myChamp && ready()) ensureChampion(D, myChamp, oppGuess, !!mine.championId || Date.now() - S.hoverSince > 15000);
    // the game plan, once you're locked in and the enemy team is known
    const key = `${cs.gameId || ''}|${mine.championId || ''}`;
    if (!mine.championId || !ready()) return;
    const enoughPicks = enemies.length >= 5 || ((cs.timer || {}).phase === 'FINALIZATION' && enemies.length >= 3);
    if (!enoughPicks || S.csKey === key) return;
    S.csKey = key;
    const facts = champSelectFacts(cs, D);
    start('gameplan', {
      champion: myChamp, championName: facts.me, key: `gameplan-${key}`, patch: patchLabel(D), title: `Game plan: ${facts.me} vs ${facts.enemies.map((e) => e.champ).join(', ')}`,
      when: 'champ select', lineup: facts, player: playerProfile(),
    }).then((job) => { if (job) S.csPlanJob = { id: job.id, champ: myChamp }; });
  }

  // ---------- in game ----------
  function onGame(A, D) {
    if (!A) return;
    const g = S.game;
    // a missed poll or two doesn't end the game: only a clock that went back, another champion or 90s without data
    if (!g || A.t < g.lastT - 5 || g.champ !== A.champ || (g.ended && Date.now() - g.ended > 90000)) newGame(A, D);
    const G = S.game;
    G.lastT = A.t; G.ended = null;
    if (!ready()) return;
    ensureChampion(D, A.champ, A.P.opp ? A.P.opp.cid : null);
    if (A.t < 20) return;
    if (!G.plan && !G.jobId && !G.startedPlan && !(S.csPlanJob && S.csPlanJob.champ === A.champ && running(`gameplan-${S.csKey}`))) {
      G.startedPlan = true;
      runPlanJob(A, D, 'gameplan', 'Game start: no plan from champ select');
      return;
    }
    const reason = checkpoint(A, G);
    if (reason) request(A, D, reason.text, reason.urgent);
  }
  function newGame(A, D) {
    const me = A.P.me;
    // things that already happened before the app saw the game don't trigger a reassessment
    const marks = { deaths: (me.scores.deaths || 0) - (me.isDead ? 1 : 0), legs: A.legendaries, m14: A.t >= 840, m20: A.t >= 1200, m28: A.t >= 1680 };
    S.game = { key: `${A.champ}-${Math.round((Date.now() - A.t * 1000) / 60000)}`, champ: A.champ, plan: null, history: [], lastAdaptAt: -1e9, lastT: A.t, startedAt: Date.now(), marks, pending: null, jobId: null, lastSnap: null };
    const cp = S.csPlan;
    if (cp && cp.champ === A.champ && Date.now() - cp.at < 20 * 60000) { S.game.plan = cp.plan; S.game.history.push({ t: 0, kind: 'gameplan', headline: cp.plan.headline, jobId: cp.jobId }); S.csPlan = null; applyHook(); }
    changed();
  }
  // which moments deserve a fresh look at the plan
  function checkpoint(A, G) {
    const M = G.marks, me = A.P.me;
    const snap = { deaths: me.scores.deaths || 0, legs: A.legendaries, gold: A.team.goldDiff, tags: [...A.tags].filter((t) => t.startsWith('vs_')).sort().join(','),
      fed: A.P.enemies.filter((p) => (p.scores.kills || 0) >= 4 && (p.scores.kills || 0) - (p.scores.deaths || 0) >= 3).length,
      big: A.lanes.barons.mine + A.lanes.barons.theirs + (A.objs.find((o) => o.soulTeam) ? 1 : 0) + A.events.filter((e) => e.EventName === 'InhibKilled').length };
    const last = G.lastSnap || snap;
    if (!G.lastSnap) G.lastSnap = snap;
    // item gold jumps when someone shops: a swing has to hold for 20 seconds
    if (Math.abs(snap.gold - last.gold) >= 2500) { if (M.goldSince == null) M.goldSince = A.t; } else M.goldSince = null;
    const min = A.t / 60;
    let r = null;
    if (me.isDead && snap.deaths > (M.deaths || 0) && (me.respawnTimer || 0) >= 12) { M.deaths = snap.deaths; r = { text: `You died (death ${snap.deaths}, ${Math.ceil(me.respawnTimer)}s to respawn)`, urgent: true }; }
    else if (snap.legs > (M.legs || 0)) { M.legs = snap.legs; r = { text: `You finished item ${snap.legs}` }; }
    else if (!M.m14 && min >= 14) { M.m14 = true; r = { text: 'Laning phase is over (14:00)' }; }
    else if (!M.m20 && min >= 20) { M.m20 = true; r = { text: '20:00: Baron is up' }; }
    else if (!M.m28 && min >= 28) { M.m28 = true; r = { text: '28:00: late game' }; }
    else if (Math.abs(snap.gold - last.gold) >= 2500 && M.goldSince != null && A.t - M.goldSince >= 20) r = { text: `Team gold swung by ${Math.round((snap.gold - last.gold) / 100) / 10}k since the last plan` };
    else if (snap.tags !== last.tags && snap.tags.length > last.tags.length) r = { text: `New enemy threat: ${snap.tags}` };
    else if (snap.fed > last.fed) r = { text: `${snap.fed} enemies are fed now` };
    else if (snap.big > last.big) r = { text: 'Baron, Dragon Soul or an inhibitor changed hands' };
    else if (min >= 14 && A.t - G.lastAdaptAt >= 420) r = { text: 'Regular check-in' };
    if (r) G.nextSnap = snap;
    return r;
  }
  function request(A, D, reason, urgent) {
    const G = S.game;
    const gap = A.t - G.lastAdaptAt;
    const queue = () => { if (!String(G.pending || '').includes(reason)) G.pending = G.pending ? `${G.pending}; ${reason}` : reason; };
    if (G.jobId || running(`adapt-${G.key}`) || running(`gameplan-${G.key}`)) { queue(); return; }
    if (gap < (urgent ? 60 : MIN_GAP)) { queue(); return; }
    if (G.pending) reason = `${G.pending}; ${reason}`;
    runPlanJob(A, D, 'adapt', reason);
  }
  async function runPlanJob(A, D, type, reason) {
    const G = S.game;
    G.lastAdaptAt = A.t; G.pending = null; G.marks.goldSince = null;
    if (G.nextSnap) { G.lastSnap = G.nextSnap; G.nextSnap = null; }
    const name = Engine.champ(D, A.champ).name;
    const job = await start(type, {
      champion: A.champ, championName: name, key: `${type}-${G.key}`, patch: patchLabel(D), title: `${type === 'gameplan' ? 'Game plan' : 'Reassess'} at ${A.clock}: ${reason}`,
      when: 'in game', reason, game: snapshot(A, D), history: G.history.map((h) => ({ at: Engine.fmtClock(h.t), headline: h.headline, changes: h.changes || [] })), player: type === 'gameplan' ? playerProfile() : undefined,
    });
    if (job) { G.jobId = job.id; G.jobReason = reason; G.jobT = A.t; }
    changed();
  }
  function reassessNow(A, D) { if (S.game && A) { S.game.lastAdaptAt = -1e9; S.game.jobId = null; runPlanJob(A, D, S.game.plan ? 'adapt' : 'gameplan', 'You asked for a fresh look'); } }
  // try the queued reason once the running job is done (called every tick)
  function drain(A, D) {
    const G = S.game;
    if (!G || !G.pending || G.jobId || !A) return;
    if (A.t - G.lastAdaptAt >= 60) runPlanJob(A, D, 'adapt', G.pending);
  }

  // ---------- results ----------
  function validPlan(p) {
    if (!p || typeof p !== 'object' || !p.headline) return null;
    const out = { ...p };
    if (out.build && !Array.isArray(out.build.order)) delete out.build;
    if (out.rules && !Array.isArray(out.rules)) delete out.rules;
    out.bullets = Array.isArray(out.bullets) ? out.bullets.slice(0, 6) : [];
    return out;
  }
  async function finished(j) {
    S.handled[j.id] = true;
    if (j.status !== 'done' && !['champion', 'quick'].includes(j.type)) {
      if (S.game && S.game.jobId === j.id) { S.game.jobId = null; S.game.lastError = j.error; }
      return;
    }
    if (['champion', 'quick'].includes(j.type)) {
      await Playbooks.refreshList();
      if (j.champion) { await Playbooks.load(j.champion, true); applyHook(); }
      return;
    }
    if (j.type === 'gameplan' || j.type === 'adapt') {
      let plan = null;
      try { plan = validPlan(await getJSON(`/api/agent/jobs/${j.id}/out/plan.json`)); } catch {}
      const G = S.game;
      if (G && G.jobId === j.id) G.jobId = null;
      if (!plan) return;
      plan.at = Date.now(); plan.jobId = j.id; plan.kind = j.type;
      if (G && G.champ === j.champion && (j.key || '').endsWith(G.key)) {
        G.plan = plan;
        G.history.push({ t: G.jobT || G.lastT, kind: j.type, headline: plan.headline, changes: plan.changes || [], jobId: j.id });
        applyHook();
      } else if (S.csPlanJob && S.csPlanJob.id === j.id) {
        S.csPlan = { champ: j.champion, plan, at: Date.now(), jobId: j.id };
        if (G && G.champ === j.champion && !G.plan && Date.now() - G.startedAt < 15 * 60000) { G.plan = plan; G.history.push({ t: G.lastT, kind: 'gameplan', headline: plan.headline, jobId: j.id }); S.csPlan = null; }
        applyHook();
      }
      return;
    }
    if (j.type === 'review') {
      try {
        const proposal = await getJSON(`/api/agent/jobs/${j.id}/out/proposal.json`);
        if (proposal && Array.isArray(proposal.changes)) { S.proposals = [...S.proposals.filter((p) => p.jobId !== j.id), { jobId: j.id, champ: j.champion, proposal, at: Date.now(), done: {} }]; saveProposals(); }
      } catch {}
    }
  }

  // ---------- after the game ----------
  function startReview(D, record, report) {
    if (!ready() || !record || !record.champ) return;
    const name = Engine.champ(D, record.champ).name;
    const R = report || null;
    start('review', {
      champion: record.champ, championName: name, key: `review-${record.champ}-${record.endedAt}`, patch: patchLabel(D), title: `Review: ${name} vs ${record.opp ? Engine.champ(D, record.opp).name : '?'}`,
      game: {
        result: record.result, minutes: Math.round(record.gameTime / 6) / 10, opponent: record.opp ? Engine.champ(D, record.opp).name : null,
        deaths: record.deaths, dashboardTimeByMode: record.modeTime, focus: record.focus, plans: record.plans || [],
        report: R ? { verdict: R.verdict, rating: R.me && R.me.rating, story: R.story, fix: R.fix, moreFix: R.moreFix, good: R.good, stats: R.stats,
          deaths: (R.deaths || []).map((d) => ({ at: Engine.fmtClock(d.t), kind: d.kind, killers: d.killers, zone: d.zone, dashboardSaid: d.mode })) } : null,
      },
      player: playerProfile(),
    });
  }
  function markProposal(jobId, idx, state) {
    const p = S.proposals.find((x) => x.jobId === jobId);
    if (p) { p.done[idx] = state; saveProposals(); changed(); }
  }
  function dismissProposal(jobId) { S.proposals = S.proposals.filter((x) => x.jobId !== jobId); saveProposals(); changed(); }

  // ---------- loop ----------
  let tickN = 0;
  async function tick(A, D) {
    tickN++;
    const anyRunning = S.jobs.some((j) => j.status === 'running');
    if (tickN % (anyRunning ? 2 : 15) === 0) await refreshJobs();
    // research that fills a draft playbook: pick up new parts as they arrive
    if (tickN % 5 === 0) {
      const drafting = [...new Set(S.jobs.filter((j) => j.status === 'running' && ['champion', 'quick'].includes(j.type) && j.newChampion && j.champion).map((j) => j.champion))];
      if (drafting.length) {
        await Playbooks.refreshList();
        for (const c of drafting) {
          const before = JSON.stringify((Playbooks.raw(c) || {}).source || null) + ((Playbooks.raw(c) || {}).activeVersion || 0);
          await Playbooks.load(c, true);
          const after = JSON.stringify((Playbooks.raw(c) || {}).source || null) + ((Playbooks.raw(c) || {}).activeVersion || 0);
          if (before !== after || (Playbooks.raw(c) || {}).draft) applyHook();
        }
      }
    }
    if (tickN % 150 === 0) refreshStatus(false);
    if (tickN % 300 === 5 && !A) refreshForPatch(D);
    if (A) drain(A, D);
  }
  // a new patch: refresh each playbook once, outside games (the old version stays active until the new one is done)
  function refreshForPatch(D) {
    if (!ready() || !D.dd.version) return;
    const patch = patchLabel(D);
    const num = (p) => { const m = String(p || '').match(/(\d+)\.(\d+)/); return m ? +m[1] * 100 + +m[2] : 0; };
    for (const pb of Playbooks.list) {
      if (!pb.parts.meta || pb.draft || num(pb.patch) >= num(patch)) continue;
      let done = null; try { done = localStorage.getItem(`jc.refreshed.${pb.champion}`); } catch {}
      if (done === patch || running(`champion-${pb.champion}`)) continue;
      try { localStorage.setItem(`jc.refreshed.${pb.champion}`, patch); } catch {}
      research(D, pb.champion, 'refresh');
    }
  }
  function planFor(champ) {
    const live = S.game && !(S.game.ended && Date.now() - S.game.ended > 90000);
    if (live && S.game.champ === champ && S.game.plan) return S.game.plan;
    if (!live && S.csPlan && S.csPlan.champ === champ) return S.csPlan.plan;
    return null;
  }
  function gameLog() { return S.game ? S.game.history.map((h) => ({ t: Math.round(h.t), kind: h.kind, headline: h.headline, changes: h.changes || [] })) : []; }
  function endGame() { if (S.game && !S.game.ended) { S.game.ended = Date.now(); changed(); } }

  return {
    state: S, ready, refreshStatus, refreshJobs, login, start, cancel, research, ensureChampion, onChampSelect, onGame, reassessNow, tick,
    planFor, gameLog, endGame, startReview, markProposal, dismissProposal, running, snapshot,
    onChange: (f) => listeners.push(f), onApply: (f) => { applyHook = f; },
  };
})();
