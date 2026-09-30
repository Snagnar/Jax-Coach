// Jax Coach - game analysis engine.
// Turns a Live Client Data snapshot (/liveclientdata/allgamedata) into: phase, lane state,
// situation triggers, enemy comp analysis, objective timers and item recommendations.
// Everything here only uses information you can also see in game (scoreboard, kill feed, clock).

const Engine = (() => {
  // ---------- static champion traits (design facts, not patch-dependent) ----------
  const HEALERS = new Set(['Aatrox', 'Soraka', 'Yuumi', 'Sona', 'Nami', 'Seraphine', 'Milio', 'Vladimir', 'Sylas', 'Swain', 'Warwick', 'DrMundo', 'Fiddlesticks', 'Illaoi', 'Olaf', 'Briar', 'Gwen', 'Trundle', 'Volibear', 'Udyr', 'Nasus', 'Renekton', 'Kayn', 'Ambessa', 'Maokai', 'Zac', 'Taric', 'Alistar', 'Bard', 'Nidalee', 'Samira', 'Viego', 'Irelia', 'Yorick', 'Sett', 'Darius', 'Aurora']);
  const STRONG_HEALERS = new Set(['Aatrox', 'Soraka', 'Yuumi', 'Vladimir', 'Sylas', 'Swain', 'Warwick', 'DrMundo', 'Illaoi', 'Briar', 'Gwen', 'Trundle', 'Volibear', 'Nasus', 'Olaf', 'Sona', 'Nami', 'Milio', 'Seraphine', 'Maokai', 'Zac', 'Ambessa']);
  const HARD_CC = new Set(['Leona', 'Nautilus', 'Thresh', 'Alistar', 'Rell', 'Amumu', 'Malphite', 'Sejuani', 'Lissandra', 'Ashe', 'Morgana', 'Lux', 'Vi', 'Warwick', 'Rammus', 'Maokai', 'Ornn', 'Sion', 'Zac', 'Nunu', 'Poppy', 'Blitzcrank', 'Pyke', 'Braum', 'Taric', 'Galio', 'Annie', 'Veigar', 'Neeko', 'Seraphine', 'Zyra', 'Skarner', 'JarvanIV', 'Kennen', 'MonkeyKing', 'Diana', 'Cassiopeia', 'Syndra', 'Chogath', 'Fiddlesticks', 'Hecarim', 'Rakan', 'Nami', 'Janna', 'Swain', 'TwistedFate', 'LeeSin', 'XinZhao', 'Pantheon', 'Camille', 'KSante', 'Shen', 'TahmKench', 'Gragas', 'Vex', 'Renekton', 'Rengar', 'Mordekaiser', 'Urgot', 'Aatrox', 'Volibear', 'Jhin', 'Lillia', 'Bard', 'Elise', 'Leblanc', 'Riven', 'Sett', 'Gnar', 'Jayce', 'Aurora', 'Mel', 'Nilah', 'Ambessa', 'Briar', 'Galio', 'Zilean', 'Ivern', 'Karma', 'Lulu', 'Milio']);
  const POKE = new Set(['Jayce', 'Xerath', 'Ziggs', 'Varus', 'Ezreal', 'Zoe', 'Velkoz', 'Lux', 'Nidalee', 'Teemo', 'Hwei', 'Mel', 'KogMaw', 'Caitlyn', 'Heimerdinger', 'Kennen', 'Quinn', 'Gnar', 'Smolder', 'Karma', 'Seraphine', 'Brand', 'Zyra', 'Syndra', 'Corki', 'Jhin', 'Kayle', 'Vayne']);

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const parseClock = (s) => {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    const m = String(s).match(/(\d+):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  const fmtClock = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  const pname = (p) => p.riotIdGameName || String(p.riotId || p.summonerName || '').split('#')[0];
  const nameIs = (p, n) => {
    if (!p || !n) return false;
    const base = String(n).split('#')[0];
    return [p.riotIdGameName, p.summonerName, p.riotId, p.championName]
      .filter(Boolean).some((x) => x === n || String(x).split('#')[0] === base);
  };
  function champIdOf(p, D) {
    const raw = p.rawChampionName || '';
    const m = raw.match(/game_character_displayname_(.+)$/);
    if (m && D.dd.champs[m[1]]) return m[1];
    const byName = D.dd.champByName[String(p.championName || '').toLowerCase()];
    return byName || (m ? m[1] : p.championName);
  }
  function champ(D, id) { return D.dd.champs[id] || { id, name: id, tags: [], info: {}, range: 125 }; }
  function itemData(D, id) { return D.dd.items[String(id)]; }
  function isLegendary(D, id) {
    const it = itemData(D, id);
    if (!it) return false;
    const tags = it.tags || [];
    return it.gold && it.gold.total >= 2200 && (!it.into || it.into.length === 0) && !tags.includes('Boots') && !tags.includes('Consumable');
  }
  function isTier2Boots(D, id) {
    const it = itemData(D, id);
    return it && (it.tags || []).includes('Boots') && it.gold && it.gold.total > 300;
  }
  const itemValue = (D, p) => (p.items || []).reduce((s, i) => {
    const it = itemData(D, i.itemID);
    return s + (it && it.gold ? it.gold.total * (i.count || 1) : (i.price || 0));
  }, 0);
  const legendaryCount = (D, p) => (p.items || []).filter((i) => isLegendary(D, i.itemID)).length;
  const hasSpell = (p, re) => ['summonerSpellOne', 'summonerSpellTwo'].some((k) => re.test(((p.summonerSpells || {})[k] || {}).displayName || ''));

  // ---------- damage profile: how much of a champion's damage is magic ----------
  // data/shared.json "damageProfiles": a number (magic share with the usual build) or [full AD build, full AP build,
  // usual build] for champions that go either way. What they actually buy moves them inside that range.
  function profile(D, id) {
    const p = ((D.shared || {}).damageProfiles || {})[id];
    if (typeof p === 'number') return { lo: p, hi: p, def: p };
    if (Array.isArray(p) && p.length >= 2) return { lo: p[0], hi: p[1], def: p[2] != null ? p[2] : p[0] };
    const c = champ(D, id), tag = (c.tags || [])[0], info = c.info || {};
    const m = tag === 'Mage' ? 0.95 : tag === 'Marksman' ? 0.1 : (info.magic || 0) > (info.attack || 0) ? 0.85 : 0.15;
    return { lo: m, hi: m, def: m };
  }
  // what an inventory's offensive stats are worth in gold: magic (AP) vs physical (AD, attack speed, crit)
  function offense(D, p) {
    let ap = 0, ad = 0, gold = 0;
    for (const i of p.items || []) {
      const it = itemData(D, i.itemID), s = (it && it.stats) || {};
      const a = (s.FlatMagicDamageMod || 0) * 20;
      const d = (s.FlatPhysicalDamageMod || 0) * 35 + (s.PercentAttackSpeedMod || 0) * 2500 + (s.FlatCritChanceMod || 0) * 4000;
      ap += a; ad += d;
      if (a + d > 0 && it.gold) gold += it.gold.total * (i.count || 1);
    }
    return { ap, ad, gold };
  }
  // one enemy's damage: the magic share (champion profile, moved by their items once they have ~2500g of damage
  // items) and a weight for how much of their team's damage they deal (gold and levels; tanks and enchanters less
  // unless they build damage)
  function damageOf(D, p, support) {
    const pr = profile(D, p.cid), o = offense(D, p);
    const built = o.ap + o.ad > 0 ? pr.lo + (pr.hi - pr.lo) * (o.ap / (o.ap + o.ad)) : pr.def;
    const magic = pr.def + (built - pr.def) * clamp(o.gold / 2500, 0, 1);
    const tag = (champ(D, p.cid).tags || [])[0];
    const items = itemValue(D, p);
    let role = 1;
    if (tag === 'Support') role = 0.35;
    else if (tag === 'Tank' || support) { const base = 0.6; role = base + (1 - base) * (items > 0 ? clamp(o.gold / items, 0, 1) : 0); }
    return { magic, role, gold: items + (p.level || 1) * 200, damageItemGold: o.gold, flexible: pr.hi - pr.lo >= 0.2 };
  }
  const dmgType = (D, id) => (profile(D, id).def >= 0.5 ? 'AP' : 'AD');
  const isSupportChamp = (D, p, id) => p.position === 'UTILITY' || (!p.position && (champ(D, id).tags || [])[0] === 'Support');

  // ---------- players ----------
  function players(game, D, overrideOppId) {
    const ap = game.activePlayer || {};
    const all = (game.allPlayers || []).map((p) => ({ ...p, cid: champIdOf(p, D), name: pname(p) }));
    let me = all.find((p) => (ap.riotId && p.riotId === ap.riotId) || (ap.summonerName && p.summonerName === ap.summonerName) || (ap.riotIdGameName && p.riotIdGameName === ap.riotIdGameName));
    if (!me) me = all[0];
    const allies = all.filter((p) => p.team === me.team && p !== me);
    const enemies = all.filter((p) => p.team !== me.team);
    const enemyJungler = enemies.find((p) => p.position === 'JUNGLE') || enemies.find((p) => hasSpell(p, /smite/i));
    let opp = null;
    if (overrideOppId) opp = enemies.find((p) => p.cid === overrideOppId);
    if (!opp) opp = enemies.find((p) => p.position === 'TOP');
    if (!opp) {
      // no positions (normals/customs): best guess = enemy with a matchup entry, no Smite, not a support/marksman
      const cands = enemies.filter((p) => p !== enemyJungler && !isSupportChamp(D, p, p.cid) && (champ(D, p.cid).tags || [])[0] !== 'Marksman');
      opp = cands.find((p) => D.matchups[p.cid] && hasSpell(p, /teleport/i)) || cands.find((p) => D.matchups[p.cid]) || cands[0] || enemies[0];
    }
    return { me, allies, enemies, opp, enemyJungler, activePlayer: ap };
  }

  // ---------- phase ----------
  const PHASE_LABEL = { lvl1_3: 'Levels 1-3', lvl4_5: 'Levels 4-5', lvl6_first_item: 'Level 6 -> first item', first_item_to_14: 'First item -> 14:00', midgame: 'Mid game', lategame: 'Late game' };
  const MATCHUP_PHASE = { lvl1_3: 'lvl1_3', lvl4_5: 'lvl4_5', lvl6_first_item: 'post6', first_item_to_14: 'post6', midgame: 'midgame', lategame: 'lategame' };
  function phaseOf(t, level, legendaries) {
    const m = t / 60;
    if (m >= 25) return 'lategame';
    if (m >= 14) return 'midgame';
    if (level <= 3) return 'lvl1_3';
    if (level <= 5) return 'lvl4_5';
    return legendaries === 0 ? 'lvl6_first_item' : 'first_item_to_14';
  }

  // ---------- state: ahead / even / behind ----------
  function laneState(D, me, opp, t, team) {
    const s = me.scores || {}, o = (opp && opp.scores) || {};
    const csD = (s.creepScore || 0) - (o.creepScore || 0);
    const lvlD = me.level - (opp ? opp.level : me.level);
    const killGold = ((s.kills || 0) - (o.kills || 0)) * 300 + ((s.assists || 0) - (o.assists || 0)) * 120;
    const itemD = itemValue(D, me) - (opp ? itemValue(D, opp) : 0);
    const earnedD = csD * 21 + killGold;
    let est = earnedD * 0.6 + itemD * 0.4 + lvlD * 250;
    const min = t / 60;
    // after laning, the team situation matters more than your lane
    if (min >= 14) est = est * 0.5 + team.goldDiff * 0.25;
    const thr = 400 + 25 * min;
    let label = 'even';
    if (est > thr) label = 'ahead';
    if (est < -thr) label = 'behind';
    if ((s.deaths || 0) >= (s.kills || 0) + 3 && label !== 'behind' && est < thr) label = 'behind';
    const very = Math.abs(est) > thr * 2.5;
    const reasons = [];
    if (opp) {
      reasons.push(`${csD >= 0 ? '+' : ''}${csD} CS`);
      if (lvlD) reasons.push(`${lvlD > 0 ? '+' : ''}${lvlD} lvl`);
      reasons.push(`${s.kills || 0}/${s.deaths || 0}/${s.assists || 0} vs ${o.kills || 0}/${o.deaths || 0}/${o.assists || 0}`);
      reasons.push(`items ${itemD >= 0 ? '+' : ''}${Math.round(itemD)}g`);
    }
    if (min >= 14) reasons.push(`team ${team.goldDiff >= 0 ? '+' : ''}${Math.round(team.goldDiff)}g`);
    return { label, very, est: Math.round(est), csD, lvlD, itemD, reasons };
  }
  function teamState(D, allies, me, enemies, events, myTeam) {
    const mine = [me, ...allies];
    const sum = (arr, f) => arr.reduce((a, p) => a + f(p), 0);
    const kills = sum(mine, (p) => p.scores.kills || 0), ekills = sum(enemies, (p) => p.scores.kills || 0);
    const gold = sum(mine, (p) => itemValue(D, p)), egold = sum(enemies, (p) => itemValue(D, p));
    let towers = 0, etowers = 0;
    for (const e of events) {
      if (e.EventName !== 'TurretKilled') continue;
      const owner = /_T1_/.test(e.TurretKilled || '') ? 'ORDER' : /_T2_/.test(e.TurretKilled || '') ? 'CHAOS' : null;
      if (owner === myTeam) etowers++; else if (owner) towers++;
    }
    return { kills, ekills, goldDiff: gold - egold, towers, etowers };
  }

  // ---------- enemy composition ----------
  function composition(D, enemies, t) {
    let ap = 0, ad = 0;
    const heal = [], strongHeal = [], tanks = [], cc = [], burst = [], poke = [], crit = [], squishy = [], dmg = [];
    let armorTeam = 0, maxArmor = 0, mrTeam = 0;
    const dd = enemies.map((p) => damageOf(D, p, isSupportChamp(D, p, p.cid)));
    const avgGold = dd.reduce((s, x) => s + x.gold, 0) / Math.max(1, dd.length);
    enemies.forEach((p, i) => {
      const x = dd[i];
      // a fed champion deals more of the damage: weight by gold (items + levels) relative to their team
      const w = x.role * (0.5 + 0.5 * clamp(x.gold / Math.max(1, avgGold), 0.3, 2.5));
      ap += w * x.magic; ad += w * (1 - x.magic);
      dmg.push({ cid: p.cid, name: champ(D, p.cid).name, magic: x.magic, w, byItems: x.damageItemGold >= 1000 && x.flexible });
    });
    const wSum = dmg.reduce((s, x) => s + x.w, 0) || 1;
    for (const x of dmg) x.share = x.w / wSum;
    for (const p of enemies) {
      const c = champ(D, p.cid), tags = c.tags || [];
      if (HEALERS.has(p.cid)) heal.push(c.name);
      if (STRONG_HEALERS.has(p.cid)) strongHeal.push(c.name);
      if (tags[0] === 'Tank' && !isSupportChamp(D, p, p.cid)) tanks.push(c.name);
      if (HARD_CC.has(p.cid)) cc.push(c.name);
      if (tags[0] === 'Assassin') burst.push(c.name);
      if (POKE.has(p.cid)) poke.push(c.name);
      if (['Mage', 'Marksman', 'Assassin'].includes(tags[0])) squishy.push(c.name);
      let armor = 0, critItems = 0;
      for (const i of p.items || []) {
        const it = itemData(D, i.itemID);
        if (!it || !it.stats) continue;
        armor += it.stats.FlatArmorMod || 0;
        mrTeam += it.stats.FlatSpellBlockMod || 0;
        if (it.stats.FlatCritChanceMod) critItems++;
      }
      if (critItems >= 1 || (tags[0] === 'Marksman' && t > 15 * 60)) crit.push(c.name);
      armorTeam += armor; maxArmor = Math.max(maxArmor, armor);
    }
    const apShare = ap + ad ? ap / (ap + ad) : 0.5;
    return { ap, ad, apShare, dmg, heal, strongHeal, tanks, cc, burst, poke, crit, squishy, armorTeam, maxArmor, mrTeam };
  }
  // prev: last tick's tags, so a damage split hovering at a threshold doesn't flip the build back and forth
  function activeTags(comp, state, t, opp, prev) {
    const tags = new Set();
    const min = t / 60;
    const had = (x) => !!(prev && prev.has(x));
    if (comp.apShare >= (had('vs_heavy_ap') ? 0.56 : 0.6)) tags.add('vs_heavy_ap');
    if (comp.apShare <= (had('vs_heavy_ad') ? 0.34 : 0.3)) tags.add('vs_heavy_ad');
    if (comp.strongHeal.length >= 2 || comp.heal.length >= 3 || (opp && STRONG_HEALERS.has(opp.cid))) tags.add('vs_healing');
    if (comp.tanks.length >= 2) tags.add('vs_tanks');
    if (comp.maxArmor >= 100 || comp.armorTeam >= 250) tags.add('vs_armor_stacking');
    if (comp.cc.length >= 3) tags.add('vs_cc_heavy');
    if (comp.squishy.length >= 3) tags.add('vs_squishies');
    if (comp.burst.length >= 2) tags.add('vs_burst');
    if (comp.poke.length >= 2) tags.add('vs_poke');
    if (comp.crit.length >= 1) tags.add('vs_crit_ad');
    if (state.label === 'ahead') tags.add('ahead');
    if (state.label === 'behind') tags.add('behind');
    if (min >= 14) tags.add('splitpush');
    if (min >= 20) tags.add('teamfight');
    if (min < 15) tags.add('early_game');
    if (min >= 28) tags.add('late_game');
    return tags;
  }

  // ---------- objectives ----------
  const OBJECTIVES = [
    { key: 'voidgrubs', label: 'Voidgrubs', re: /horde|grub/i, repeat: false, trigger: 'grubs_soon' },
    { key: 'dragon', label: 'Dragon', re: /dragon/i, repeat: true, trigger: 'dragon_up_soon' },
    { key: 'riftHerald', label: 'Rift Herald', re: /herald/i, repeat: false, trigger: 'herald_soon' },
    { key: 'atakhan', label: 'Atakhan', re: /atakhan/i, repeat: false, trigger: 'atakhan_soon' },
    { key: 'baron', label: 'Baron', re: /baron/i, repeat: true, trigger: 'baron_up_soon' },
  ];
  const DEFAULT_TIMERS = { voidgrubs: { spawn: '8:00' }, dragon: { spawn: '5:00', respawn: '5:00' }, riftHerald: { spawn: '15:00' }, atakhan: { spawn: '20:00' }, baron: { spawn: '25:00', respawn: '6:00' } };
  // one-time camps leave the map if nobody takes them
  const DESPAWN = { voidgrubs: 14 * 60 + 45, riftHerald: 19 * 60 + 45 };
  function objectives(D, events, t, teamOf) {
    const timers = (D.shared && D.shared.objectiveTimers) || (D.meta && D.meta.objectiveTimers) || DEFAULT_TIMERS;
    const out = [];
    for (const o of OBJECTIVES) {
      const cfg = timers[o.key];
      if (!cfg) continue;
      const spawn = parseClock(cfg.spawn), respawn = parseClock(cfg.respawn);
      if (spawn == null) continue;
      const kills = events.filter((e) => /Kill$/.test(e.EventName || '') && o.re.test(e.EventName) && e.EventName !== 'ChampionKill');
      const last = kills[kills.length - 1];
      let next = spawn, status = 'upcoming', label = o.label, gone = false;
      if (o.key === 'dragon') {
        // Dragon Soul: once a team has 4 drakes, only the Elder Dragon comes back, 6:00 later (and 6:00 after each Elder)
        const count = {}; let soulAt = null, soulTeam = null, lastElder = null;
        for (const e of kills) {
          if (/elder/i.test(e.DragonType || '')) { lastElder = e; continue; }
          const k = (teamOf && teamOf(e.KillerName)) || 'unknown';
          count[k] = (count[k] || 0) + 1;
          if (soulAt == null && k !== 'unknown' && count[k] >= 4) { soulAt = e.EventTime; soulTeam = k; }
        }
        if (soulAt != null) {
          label = 'Elder Dragon';
          next = Math.max(soulAt + 360, lastElder ? lastElder.EventTime + 360 : 0);
        } else if (last) next = Math.max(spawn, last.EventTime + respawn);
        // soul point: a team with 3 drakes gets Dragon Soul from the next one
        const ours = count.mine || 0, theirs = count.theirs || 0;
        const soulPoint = soulAt != null ? null : ours >= 3 && theirs >= 3 ? 'both' : ours >= 3 ? 'ours' : theirs >= 3 ? 'theirs' : null;
        const soul = soulTeam === 'mine' ? 'ours' : soulTeam === 'theirs' ? 'theirs' : null;
        out.push({ ...o, label, next, status: t >= next ? 'up' : 'upcoming', in: next - t, killed: kills.length, lastKiller: last ? last.KillerName : null,
          soulTeam, soul, soulPoint, drakes: { ours, theirs }, stakes: soulAt != null ? 'elder' : soulPoint ? 'soul' : null, notes: cfg.notes || '' });
        continue;
      }
      if (last) {
        if (o.repeat && respawn) next = Math.max(spawn, last.EventTime + respawn);
        else status = 'taken';
      }
      if (status !== 'taken' && DESPAWN[o.key] && t >= DESPAWN[o.key]) { status = 'taken'; gone = true; }
      if (status !== 'taken' && t >= next) status = 'up';
      const killer = last ? last.KillerName : null;
      out.push({ ...o, label, next, status, gone, in: next - t, killed: kills.length, lastKiller: killer, notes: cfg.notes || '' });
    }
    return out;
  }

  // ---------- item recommendations ----------
  function recommendItems(D, me, ap, tags, comp) {
    const meta = D.meta || {};
    const core = (meta.coreBuild && meta.coreBuild.typicalOrder) || [];
    const ownedIds = new Set((me.items || []).map((i) => String(i.itemID)));
    const ownedNames = new Set((me.items || []).map((i) => (itemData(D, i.itemID) || {}).name || i.displayName).filter(Boolean).map((n) => n.toLowerCase()));
    const owns = (name) => ownedNames.has(String(name).toLowerCase());
    const idOf = (name) => D.dd.itemByName[String(name).toLowerCase()];

    const isBootsName = (n) => { const id = idOf(n); return id ? ((itemData(D, id) || {}).tags || []).includes('Boots') : /boots|treads|steelcaps|greaves/i.test(n); };
    const nextCore = core.filter((n) => !owns(n) && !isBootsName(n)).slice(0, 3).map((n) => ({ name: n, id: idOf(n) }));
    const inNext = new Set(nextCore.map((c) => c.name.toLowerCase()));

    // an item is "situational for this game" when an enemy-comp tag (vs_*) fits it; timing tags only break ties
    const situational = (meta.items || [])
      .filter((it) => !owns(it.name) && !inNext.has(it.name.toLowerCase()) && !isBootsName(it.name))
      .map((it) => {
        const matched = (it.buildWhen || []).filter((w) => tags.has(w));
        const vs = matched.filter((w) => w.startsWith('vs_')).length;
        return { ...it, matched, id: idOf(it.name), score: vs * 2 + (matched.length - vs) * 0.5 };
      })
      .filter((it) => it.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const hasBoots = (me.items || []).some((i) => isTier2Boots(D, i.itemID));
    let boots = null;
    const bootOpts = (meta.coreBuild && meta.coreBuild.boots) || [];
    if (!hasBoots && bootOpts.length) {
      const find = (re) => bootOpts.find((b) => re.test(b.item));
      let pick = null, why = '';
      const planBoots = meta.coreBuild.source === 'plan' ? core.find(isBootsName) : null;
      if (planBoots) { pick = bootOpts.find((b) => b.item === planBoots) || { item: planBoots }; why = (meta.coreBuild.why || {})[planBoots] || 'game plan'; }
      else if (tags.has('vs_heavy_ap') || (tags.has('vs_cc_heavy') && comp.apShare >= 0.45)) { pick = find(/mercury/i); why = `${Math.round(comp.apShare * 100)}% of enemy damage is magic` + (comp.cc.length >= 3 ? `, ${comp.cc.length} hard-CC champs` : ''); }
      else if (tags.has('vs_heavy_ad') || comp.crit.length >= 2) { pick = find(/steelcaps/i); why = `${Math.round((1 - comp.apShare) * 100)}% of enemy damage is physical`; }
      if (!pick) { pick = bootOpts[0]; why = pick.when || 'default'; }
      boots = { name: pick.item, id: idOf(pick.item), why };
    }

    // the single most important next item, and why: first item spike > boots > a counter item the enemy comp
    // clearly demands > next core item
    const legs = legendaryCount(D, me);
    const TAGTXT = {
      vs_tanks: `they have ${comp.tanks.length} tanks`, vs_armor_stacking: 'they are stacking armor',
      vs_heavy_ap: `${Math.round(comp.apShare * 100)}% of their damage is magic`, vs_heavy_ad: `${Math.round((1 - comp.apShare) * 100)}% of their damage is physical`,
      vs_healing: `heavy healing (${(comp.strongHeal.length ? comp.strongHeal : comp.heal).join(', ')})`, vs_cc_heavy: `${comp.cc.length} champions with hard CC`,
      vs_squishies: 'their carries are squishy', vs_burst: `burst threats (${comp.burst.join(', ')})`, vs_poke: 'a poke-heavy team', vs_crit_ad: `crit damage (${comp.crit.join(', ')})`,
    };
    // a game plan (research agent) can reorder the build and say why per item: meta.coreBuild.source = 'plan', .why = { item: reason }
    const planWhy = (meta.coreBuild && meta.coreBuild.why) || {};
    const fromPlan = !!(meta.coreBuild && meta.coreBuild.source === 'plan');
    const metaWhy = (name) => planWhy[name] || ((meta.items || []).find((i) => i.name.toLowerCase() === String(name).toLowerCase()) || {}).why || '';
    const urgent = situational.find((s) => s.score >= 4
      || (s.matched.includes('vs_healing') && comp.strongHeal.length >= 2)
      || (s.matched.includes('vs_heavy_ap') && comp.apShare >= 0.7)
      || (s.matched.includes('vs_heavy_ad') && comp.apShare <= 0.2));
    let priority = null;
    if (legs === 0 && nextCore[0]) priority = { ...nextCore[0], kind: fromPlan ? 'plan' : 'core', reason: metaWhy(nextCore[0].name) || 'Your first big power spike' };
    else if (boots && legs >= 1) priority = { name: boots.name, id: boots.id, kind: 'boots', reason: `Boots before your next item: ${boots.why}` };
    else if (urgent && !fromPlan) {   // a game plan already weighed the enemy comp
      const because = urgent.matched.filter((t) => t.startsWith('vs_')).map((t) => TAGTXT[t]).filter(Boolean).join(' and ');
      priority = { name: urgent.name, id: urgent.id, kind: 'adapted', because, reason: because ? `${because[0].toUpperCase()}${because.slice(1)}: ${urgent.why}` : urgent.why };
    } else if (nextCore[0]) priority = { ...nextCore[0], kind: fromPlan ? 'plan' : 'core', reason: metaWhy(nextCore[0].name) || 'Next core item' };
    else if (situational[0]) priority = { name: situational[0].name, id: situational[0].id, kind: 'adapted', reason: situational[0].why };
    if (priority) {
      const after = [...nextCore, ...situational].find((x) => x.name !== priority.name);
      priority.then = after ? after.name : null;
    }

    // what to buy with the gold you have right now (only known for yourself)
    const gold = Math.floor(ap.currentGold || 0);
    const target = priority || nextCore[0] || situational[0];
    let buyNow = null;
    if (target && target.id) {
      const tIt = itemData(D, target.id);
      const recipeIds = new Set();
      (function walk(id) { const it = itemData(D, id); if (!it) return; for (const f of it.from || []) { recipeIds.add(String(f)); walk(f); } })(target.id);
      const ownedValue = [...ownedIds].filter((id) => recipeIds.has(id)).reduce((s, id) => s + ((itemData(D, id) || {}).gold || {}).total || 0, 0);
      const remaining = Math.max(0, tIt.gold.total - ownedValue);
      if (gold >= remaining) buyNow = { text: `Finish ${tIt.name}`, ids: [target.id], cost: remaining };
      else {
        // components in the researched first-back order first (e.g. Sheen before Phage), then the most expensive
        const prefer = ((meta.coreBuild && meta.coreBuild.firstBackBuys) || []).map((f) => String(f.buy).split(/\s*[-–(]/)[0].trim().toLowerCase());
        const rank = (c) => { const i = prefer.indexOf(c.it.name.toLowerCase()); return i < 0 ? 99 : i; };
        const comps = (tIt.from || []).map(String).filter((id) => !ownedIds.has(id)).map((id) => ({ id, it: itemData(D, id) })).filter((c) => c.it)
          .sort((a, b) => rank(a) - rank(b) || b.it.gold.total - a.it.gold.total);
        let left = gold; const picks = [];
        for (const c of comps) if (c.it.gold.total <= left) { picks.push(c); left -= c.it.gold.total; }
        // every back: a Control Ward if there's 75g spare and none in the inventory
        const cw = D.itemByNameCache || (D.itemByNameCache = Object.keys(D.dd.items).find((id) => D.dd.items[id].name === 'Control Ward' && (D.dd.items[id].maps || {})['11']));
        if (picks.length && cw && left >= 75 && !(me.items || []).some((i) => String(i.itemID) === cw)) { picks.push({ id: cw, it: itemData(D, cw) }); left -= 75; }
        if (picks.length) buyNow = { text: `Components for ${tIt.name}: ${picks.map((p) => p.it.name).join(' + ')}`, ids: picks.map((p) => p.id), cost: gold - left };
        else buyNow = { text: `Save up: ${tIt.name} needs ${remaining - gold}g more (or ${comps.length ? Math.min(...comps.map((c) => c.it.gold.total)) : '?'}g for the cheapest component)`, ids: [], cost: 0 };
      }
    }
    return { nextCore, situational, boots, buyNow, gold, priority };
  }

  // ---------- triggers ----------
  function newMemory() { return { lastT: -1, prevLevel: null, legendaries: null, legendaryAt: [], level6At: null }; }
  function triggers(D, ctx, mem, P, t, events, state, objs) {
    const out = [];
    const T = (D.phases && D.phases.triggers) || {};
    const ST = (D.shared && D.shared.triggers) || {};       // defaults when the playbook has no tip for a trigger
    const add = (id, level, title, detail) => out.push({ id, level, title, detail, advice: T[id] || ST[id] || [] });
    const { me, opp, enemies, allies, enemyJungler } = P;
    const min = t / 60;

    // death analysis from the kill feed
    const kills = events.filter((e) => e.EventName === 'ChampionKill');
    const myDeaths = kills.filter((e) => nameIs(me, e.VictimName));
    const lastDeath = myDeaths[myDeaths.length - 1];
    const involvedEnemies = (e) => enemies.filter((p) => nameIs(p, e.KillerName) || (e.Assisters || []).some((a) => nameIs(p, a)));
    const junglerDeaths = myDeaths.filter((e) => enemyJungler && involvedEnemies(e).includes(enemyJungler) && e.EventTime > t - 600);

    if (opp && opp.isDead) add('enemy_laner_dead', 'good', `${champ(D, opp.cid).name} is dead`, `Respawns in ${Math.ceil(opp.respawnTimer || 0)}s`);
    if (lastDeath && t - lastDeath.EventTime < 50) {
      const inv = involvedEnemies(lastDeath);
      if (inv.length >= 2 || (enemyJungler && inv.includes(enemyJungler) && enemyJungler !== opp)) add('you_died_to_gank', 'warn', 'You died to a gank', `Killed by ${inv.map((p) => champ(D, p.cid).name).join(' + ') || lastDeath.KillerName}`);
      else if (opp && nameIs(opp, lastDeath.KillerName)) add('you_died_solo', 'warn', `${champ(D, opp.cid).name} solo killed you`, 'Reset your approach, see below');
    }
    if (junglerDeaths.length >= 2 && min < 20) add('enemy_jungler_ganked_top_repeatedly', 'warn', `${champ(D, enemyJungler.cid).name} keeps ganking top`, `${junglerDeaths.length} deaths with the jungler involved in the last 10 min`);

    if (opp && min < 14) {
      if (min < 3.5 && me.level >= 2 && opp.level < 2) add('you_hit_level_2_first', 'good', 'You hit level 2 first', 'Short power window');
      if (opp.level > me.level) add('opp_level_lead', 'warn', `${champ(D, opp.cid).name} is a level ahead`, `You ${me.level} vs ${opp.level}`);
      else if (me.level > opp.level) add('you_level_lead', 'good', 'You are a level ahead', `You ${me.level} vs ${opp.level}`);
    }
    const TXT = (D.rules && D.rules.text) || {};
    if (me.level >= 6 && mem.level6At != null && t - mem.level6At < 75) add('you_hit_6', 'good', TXT.level6 || 'Level 6: your ultimate is online', opp && opp.level < 6 ? `${champ(D, opp.cid).name} is still level ${opp.level}` : '');

    const lg = legendaryCount(D, me);
    const lastLeg = mem.legendaryAt[mem.legendaryAt.length - 1];
    if (lastLeg && t - lastLeg.t < 100) {
      const id = lg >= 3 ? 'three_items_done' : lg === 2 ? 'second_item_done' : 'first_item_done';
      add(id, 'good', `${['', 'First', 'Second', 'Third'][Math.min(lg, 3)] || lg + 'th'} item completed`, lastLeg.name || '');
    }

    if (state.label === 'ahead' && state.very) add('you_are_fed', 'good', 'You are fed', state.reasons.join(' · '));
    if (state.label === 'behind') add('you_are_behind', 'warn', 'You are behind', state.reasons.join(' · '));
    if (opp && (opp.scores.kills || 0) >= 3 && (opp.scores.kills || 0) - (opp.scores.deaths || 0) >= 3) add('enemy_laner_fed', 'warn', `${champ(D, opp.cid).name} is fed`, `${opp.scores.kills}/${opp.scores.deaths}/${opp.scores.assists}`);

    const eDead = enemies.filter((p) => p.isDead).length, aDead = [me, ...allies].filter((p) => p.isDead).length;
    if (eDead - aDead >= 2) add('enemy_team_numbers_down', 'good', `${eDead} enemies dead`, enemies.filter((p) => p.isDead).map((p) => `${champ(D, p.cid).name} ${Math.ceil(p.respawnTimer)}s`).join(', '));
    if (aDead - eDead >= 2) add('your_team_numbers_down', 'warn', `${aDead} allies dead`, 'Your team is down numbers');

    for (const o of objs) if (o.status === 'upcoming' && o.in > 0 && o.in <= 60 && !o.stakes) add(o.trigger, 'info', `${o.label} in ${fmtClock(o.in)}`, o.notes || '');
    // the soul-point dragon and the Elder: their own triggers, so a playbook can say what this champion does there
    const dr = objs.find((o) => o.key === 'dragon');
    if (dr && dr.stakes && (dr.status === 'up' || dr.in <= 90)) {
      const when = dr.status === 'up' ? 'up now' : `in ${fmtClock(dr.in)}`;
      if (dr.stakes === 'soul') add('dragon_soul_point', dr.soulPoint === 'ours' ? 'good' : 'warn', `Soul point dragon ${when}`, `Drakes ${dr.drakes.ours}–${dr.drakes.theirs}`);
      else add('elder_dragon', 'warn', `Elder Dragon ${when}`, dr.soul ? `${dr.soul === 'ours' ? 'You have' : 'They have'} Dragon Soul` : '');
    }
    if (min >= 30) add('long_death_timers', 'info', 'Death timers are long', 'A death now can lose the game');

    for (const e of events) {
      if (e.EventName !== 'TurretKilled' || t - e.EventTime > 45) continue;
      const owner = /_T1_/.test(e.TurretKilled || '') ? 'ORDER' : /_T2_/.test(e.TurretKilled || '') ? 'CHAOS' : null;
      const lane = /_L_/.test(e.TurretKilled) ? 'top' : /_C_/.test(e.TurretKilled) ? 'mid' : /_R_/.test(e.TurretKilled) ? 'bot' : '';
      if (owner === me.team) add('turret_lost', 'warn', `You lost a ${lane} turret`, '');
      else if (owner) add('enemy_turret_taken', 'good', `Your team took a ${lane} turret`, '');
    }
    const order = { warn: 0, good: 1, info: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  // ---------- enemy jungler: last seen (kill feed + objective kills only, never predicted) ----------
  const SIDE = { TOP: 'top', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'bot' };
  function roleOf(D, P, p) {
    if (p.position) return p.position;
    if (hasSpell(p, /smite/i)) return 'JUNGLE';
    if (p === P.opp || p === P.me) return 'TOP';
    const tag = (champ(D, p.cid).tags || [])[0];
    return tag === 'Support' ? 'UTILITY' : tag === 'Marksman' ? 'BOTTOM' : 'MIDDLE';
  }
  function junglerTrack(D, P, events, t) {
    const J = P.enemyJungler;
    if (!J) return null;
    const name = champ(D, J.cid).name;
    const everyone = [P.me, ...P.allies, ...P.enemies];
    const sightings = [];
    for (const e of events) {
      if (e.EventName === 'ChampionKill') {
        const names = [e.KillerName, e.VictimName, ...(e.Assisters || [])];
        if (!names.some((n) => nameIs(J, n))) continue;
        const others = names.filter((n) => !nameIs(J, n)).map((n) => everyone.find((p) => nameIs(p, n))).filter(Boolean);
        const votes = {};
        for (const o of others) { const s = SIDE[roleOf(D, P, o)]; if (s) votes[s] = (votes[s] || 0) + 1; }
        const side = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [])[0] || 'jungle';
        const victim = everyone.find((p) => nameIs(p, e.VictimName));
        const what = nameIs(J, e.VictimName) ? 'died' : `killed ${victim ? champ(D, victim.cid).name : '?'}`;
        sightings.push({ t: e.EventTime, side, what, withMe: names.some((n) => nameIs(P.me, n)) });
      } else if (/^(Dragon|Herald|Baron|Horde)Kill$/.test(e.EventName)) {
        const killer = everyone.find((p) => nameIs(p, e.KillerName));
        if (!killer || killer.team !== J.team) continue;   // their team took it: the jungler was almost surely there
        const label = { DragonKill: 'Dragon', HeraldKill: 'Herald', BaronKill: 'Baron', HordeKill: 'Voidgrubs' }[e.EventName];
        sightings.push({ t: e.EventTime, side: e.EventName === 'DragonKill' ? 'bot' : 'top', what: `took ${label}` });
      } else if (e.EventName === 'TurretKilled' && [e.KillerName, ...(e.Assisters || [])].some((n) => nameIs(J, n))) {
        const side = /_L_/.test(e.TurretKilled) ? 'top' : /_C_/.test(e.TurretKilled) ? 'mid' : 'bot';
        sightings.push({ t: e.EventTime, side, what: 'took a turret' });
      }
    }
    const last = sightings[sightings.length - 1] || null;
    const ago = last ? t - last.t : null;
    const sideTxt = (s) => ({ top: 'top side', mid: 'mid', bot: 'bot side', jungle: 'in the jungle' }[s] || s);
    let status = 'unknown', text, safeFor = 0;
    if (J.isDead) { status = 'dead'; safeFor = Math.ceil(J.respawnTimer || 0) + 30; text = `${name} is dead (${Math.ceil(J.respawnTimer || 0)}s): top is safe`; }
    else if (!last) {
      if (t < 200) { status = 'clearing'; text = `${name} is on the first clear. A full clear usually ends around 3:15–3:45`; }
      else text = `${name} hasn't shown yet: assume he could be near`;
    } else if (last.side === 'top' && ago <= 45) { status = 'near'; text = `${name} ${last.what} top side ${fmtClock(ago)} ago`; }
    else if ((last.side === 'bot' && ago <= 40) || (last.side === 'mid' && ago <= 20)) {
      status = 'far'; safeFor = (last.side === 'bot' ? 40 : 20) - ago;
      text = `${name} ${last.what} ${sideTxt(last.side)} ${fmtClock(ago)} ago: ~${Math.round(safeFor)}s to push safely`;
    } else text = `${name} last seen ${sideTxt(last.side)} ${fmtClock(ago)} ago (${last.what})`;
    return { cid: J.cid, name, level: J.level, status, text, safeFor, last, ago, sightings };
  }

  // ---------- role vs role: who is winning each lane (scoreboard info only) ----------
  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  function assignRoles(D, P, team) {
    const out = {}, left = [...team];
    for (const r of ROLES) { const i = left.findIndex((p) => p.position === r); if (i >= 0) out[r] = left.splice(i, 1)[0]; }
    for (const r of ROLES) if (!out[r]) { const i = left.findIndex((p) => roleOf(D, P, p) === r); if (i >= 0) out[r] = left.splice(i, 1)[0]; }
    for (const r of ROLES) if (!out[r] && left.length) out[r] = left.shift();
    return out;
  }
  // estimated gold lead of a over b: earned gold from CS/kills/assists, blended with visible item value and levels
  function pairDiff(D, a, b) {
    const s = a.scores || {}, o = b.scores || {};
    const earned = ((s.creepScore || 0) - (o.creepScore || 0)) * 21 + ((s.kills || 0) - (o.kills || 0)) * 300 + ((s.assists || 0) - (o.assists || 0)) * 120;
    return Math.round(earned * 0.6 + (itemValue(D, a) - itemValue(D, b)) * 0.4 + (a.level - b.level) * 250);
  }
  const isFed = (p) => (p.scores.kills || 0) >= 4 && (p.scores.kills || 0) - (p.scores.deaths || 0) >= 3;
  function lanes(D, P, t, events) {
    const mine = assignRoles(D, P, [P.me, ...P.allies]), theirs = assignRoles(D, P, P.enemies);
    const thr = 300 + 20 * (t / 60);
    const rows = ROLES.filter((r) => mine[r] && theirs[r]).map((r) => {
      const a = mine[r], b = theirs[r], diff = pairDiff(D, a, b);
      const verdict = diff > thr * 2.5 ? 'Stomping' : diff > thr ? 'Winning' : diff < -thr * 2.5 ? 'Getting stomped' : diff < -thr ? 'Losing' : 'Even';
      return { role: r, ally: a, enemy: b, diff, verdict, isMe: a === P.me, allyFed: isFed(a), enemyFed: isFed(b) };
    });
    const sum = (arr, f) => arr.reduce((s, p) => s + f(p), 0);
    const myTeam = [P.me, ...P.allies];
    const teamOf = (name) => (myTeam.some((p) => nameIs(p, name)) ? 'mine' : P.enemies.some((p) => nameIs(p, name)) ? 'theirs' : null);
    const count = (re) => { const c = { mine: 0, theirs: 0 }; for (const e of events) if (re.test(e.EventName)) { const k = teamOf(e.KillerName); if (k) c[k]++; } return c; };
    return {
      rows,
      itemGoldDiff: Math.round(sum(myTeam, (p) => itemValue(D, p)) - sum(P.enemies, (p) => itemValue(D, p))),
      dragons: count(/^DragonKill$/), grubs: count(/^HordeKill$/), heralds: count(/^HeraldKill$/), barons: count(/^BaronKill$/),
    };
  }

  // ---------- when to go back (minion waves aren't in the live data, so: "crash your wave, then back") ----------
  function recallAdvice(D, a, mem) {
    const { P, t, items, objs } = a;
    const me = P.me;
    if (me.isDead || t < 150) return null;
    const st = a.activeStats || {};
    const hp = st.maxHealth ? st.currentHealth / st.maxHealth : 1;
    const mana = st.resourceMax && /mana/i.test(st.resourceType || 'MANA') ? st.resourceValue / st.resourceMax : 1;
    const gold = items.gold, b = items.buyNow, min = t / 60;
    const buyTxt = b && b.cost > 0 ? b.text.replace(/^Components for [^:]+: /, '').replace(/^Finish /, '') : '';
    const relevant = (o) => o.status !== 'taken' && (min >= 14 || o.key === 'voidgrubs' || o.key === 'riftHerald');
    const reasons = [];
    let why = null;
    if (b && /^Finish /.test(b.text)) { why = 'item'; reasons.push(`you can finish ${buyTxt}`); }
    else if (b && b.cost >= 850) { why = 'item'; reasons.push(`you can buy ${buyTxt}`); }
    if (gold >= 1500) { why = why || 'gold'; if (!reasons.length) reasons.push(`you're holding ${gold} gold`); }
    if (hp < 0.35 && gold >= 500) { why = why || 'hp'; reasons.push(`low HP (${Math.round(hp * 100)}%)`); }
    if (mana < 0.2 && gold >= 500) { why = why || 'mana'; reasons.push('low mana'); }
    const upcoming = objs.find((o) => relevant(o) && o.in > 45 && o.in <= 150);
    if (upcoming && gold >= 900) { why = why || 'objective'; reasons.push(`be back with items for ${upcoming.label} (${fmtClock(upcoming.in)})`); }
    if (!why) return null;

    const eDead = P.enemies.filter((p) => p.isDead).length, aDead = [me, ...P.allies].filter((p) => p.isDead).length;
    const soon = objs.find((o) => relevant(o) && o.in > 0 && o.in <= 45 && (o.key === 'voidgrubs' || o.key === 'riftHerald'));
    let hold = null;
    if (hp >= 0.3) {
      if (P.opp && P.opp.isDead) hold = `${champ(D, P.opp.cid).name} is dead: shove and take plates first`;
      else if (soon) hold = `${soon.label} in ${fmtClock(soon.in)}: back after it`;
      else if (eDead - aDead >= 2) hold = 'enemies are down: take an objective first';
    }
    return {
      level: hold ? 'hold' : 'now', why, reasons, hold, buy: buyTxt,
      headline: hold ? 'Back soon' : 'Good time to back',
      voice: hold ? null : `Crash your wave and back. ${reasons[0][0].toUpperCase()}${reasons[0].slice(1).replace(/\s*\([^)]*\)/, '').replace(/ \+ /g, ' and ')}.`,
      voiceKey: `recall-${mem.shopWindow || 0}-${Math.floor(gold / 800)}`,
    };
  }

  // ---------- "don't fight" guard: the numbers already say no ----------
  // From the player's own history: almost every 1v1 death came while a level down, behind in gold or down
  // in farm. The guard turns those situations into an explicit "don't fight", and after two solo deaths
  // locks the lane to farm-only until the next item is finished.
  // thresholds come from the playbook (rules.params.guard); these defaults are the tested Jax values
  const GUARD_DEFAULTS = { enabled: true, until: 14, levelDownAfter: 90, goldDown: 500, goldAfter: 150, csDown: 15, csAfter: 300, lockDeaths: 2, lockUntil: 20, quietSec: 15 };
  function fightGuard(D, a, mem) {
    const { P, t, events, state, items } = a;
    const { me, opp } = P;
    const G = { ...GUARD_DEFAULTS, ...(((D.rules || {}).params || {}).guard || {}) };
    if (!G.enabled) return null;
    const min = t / 60;
    const lg = legendaryCount(D, me);
    // release the lock when the next item is done (or at 20:00 at the latest)
    if (mem.lock && (lg > mem.lock.leg || min >= G.lockUntil)) { mem.lockBase = mem.soloDeaths || 0; mem.lock = null; }
    if (!opp) return null;
    const oppName = champ(D, opp.cid).name;
    const solo = events.filter((e) => e.EventName === 'ChampionKill' && nameIs(me, e.VictimName) && nameIs(opp, e.KillerName)
      && !(e.Assisters || []).some((n) => P.enemies.some((p) => nameIs(p, n))));
    mem.soloDeaths = solo.length;
    if (!mem.lock && min < G.until && G.lockDeaths > 0 && solo.length - (mem.lockBase || 0) >= G.lockDeaths) mem.lock = { at: t, leg: lg };
    // how long each deficit has lasted, so a level-2 race doesn't make the voice talk
    const since = (k, on) => { if (!on) { mem[k] = null; return null; } if (mem[k] == null) mem[k] = t; return mem[k]; };
    const lvlD = me.level - opp.level;
    const lvlSince = since('lvlDownSince', G.levelDownAfter != null && lvlD < 0 && t >= G.levelDownAfter && min < G.until);
    const goldSince = since('goldDownSince', G.goldDown != null && state.est < -G.goldDown && t >= G.goldAfter && min < G.until);
    const csSince = since('csDownSince', G.csDown != null && state.csD <= -G.csDown && t >= G.csAfter && min < G.until);
    const quiet = (s, key) => (t - s < G.quietSec ? `${key}-q-${Math.round(s)}` : `${key}-${Math.round(s)}`);   // spoken after a few seconds
    const next = items.priority ? items.priority.name : (items.nextCore[0] || {}).name || 'next item';
    if (me.isDead) return null;
    if (mem.lock) {
      return { kind: 'lock', strict: true, headline: `Farm only until ${next}`,
        reason: `${solo.length} solo deaths to ${oppName}. Last-hit, give up contested waves, trade back only if they commit`,
        voice: `That's ${solo.length === 2 ? 'two' : solo.length} solo deaths. Farm only until your ${next}. Don't fight ${oppName}.`, voiceKey: `lock-${Math.round(mem.lock.at)}` };
    }
    if (lvlSince != null) {
      const k = quiet(lvlSince, 'lvl');
      return { kind: 'level', strict: true, headline: `Don't fight: ${oppName} is ${-lvlD > 1 ? `${-lvlD} levels` : 'a level'} up`,
        reason: `Level ${me.level} vs ${opp.level}. Farm and wait until you catch up`,
        voice: /-q-/.test(k) ? null : `${oppName} is ${-lvlD > 1 ? `${-lvlD} levels` : 'a level'} up. Don't trade until you catch up.`, voiceKey: k };
    }
    if (goldSince != null) {
      const k = quiet(goldSince, 'gold');
      return { kind: 'gold', strict: true, headline: `Don't fight: you're ~${Math.abs(Math.round(state.est / 100) * 100)}g behind`,
        reason: `${state.reasons.join(' · ')}. Even fights are lost fights now: farm to your item`,
        voice: /-q-/.test(k) ? null : `You're behind ${oppName} in gold. Don't take even fights, farm to your item.`, voiceKey: k };
    }
    if (csSince != null) {
      const k = quiet(csSince, `cs${Math.min(3, Math.floor(-state.csD / 15))}`);
      return { kind: 'cs', strict: false, headline: `${-state.csD} CS down: stop trading, just last-hit`,
        reason: `You ${me.scores.creepScore || 0} vs ${opp.scores.creepScore || 0} CS. Every missed wave delays your item`,
        voice: /-q-/.test(k) ? null : `You're ${-state.csD} CS down. Stop trading, just last-hit.`, voiceKey: k };
    }
    return null;
  }

  // ---------- numbers advantage: which objective, and for how long ----------
  // Respawn timers are on the scoreboard. The advantage lasts until enough of them are back that you are no
  // longer 2 up. The best objective is the biggest one that is up and fits in that window.
  const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five'];
  const OBJ_NEED = [ // seconds needed to take it with the enemy unable to contest; order = priority
    { key: 'baron', need: 35, minDown: 3, what: 'take Baron' },
    { key: 'dragon', elder: true, need: 30, minDown: 2, what: 'take Elder' },
    { key: 'dragon', need: 25, minDown: 2, what: 'take Dragon' },
    { key: 'riftHerald', need: 25, minDown: 2, what: 'take Herald' },
    { key: 'voidgrubs', need: 30, minDown: 2, what: 'take the grubs' },
  ];
  function numbersCall(D, a) {
    const { P, t, objs } = a;
    const mine = [P.me, ...P.allies];
    const eDeadP = P.enemies.filter((p) => p.isDead), aDeadP = mine.filter((p) => p.isDead);
    const J = P.enemyJungler, jgDead = !!(J && J.isDead && (J.respawnTimer || 0) >= 25);
    const adv = eDeadP.length - aDeadP.length;
    const R = (mode, headline, reason, voice, voiceKey) => ({ mode, headline, reason, voice, voiceKey: voiceKey || mode });
    const nm = (p) => champ(D, p.cid).name;
    const deadList = (ps) => ps.slice().sort((x, y) => (y.respawnTimer || 0) - (x.respawnTimer || 0)).map((p) => `${nm(p)} ${Math.ceil(p.respawnTimer || 0)}s`).join(', ');

    if (adv >= 2 || (jgDead && adv >= 1)) {
      // how long you stay 2 up: until the (adv-1)-th enemy respawns (earliest first)
      const times = eDeadP.map((p) => p.respawnTimer || 0).sort((x, y) => x - y);
      const window = Math.round(adv >= 2 ? times[adv - 2] : J.respawnTimer || 0);
      if (window < 15) return null;
      const up = (o) => objs.find((x) => x.key === o.key && x.status === 'up' && (o.key !== 'dragon' || !!o.elder === (x.label === 'Elder Dragon')));
      const smiteSafe = jgDead ? 1 : 0;                      // no enemy jungler = nobody can steal
      let pick = null;
      for (const o of OBJ_NEED) {
        if (!up(o) || window < o.need) continue;
        if (eDeadP.length + smiteSafe < o.minDown) continue;
        pick = o; break;
      }
      const n = NUM_WORD[eDeadP.length] || String(eDeadP.length);
      const lead = jgDead && adv < 2 ? `Their jungler is dead for ${window} seconds` : `${n[0].toUpperCase()}${n.slice(1)} enemies dead for ${window} seconds`;
      const head = jgDead && adv < 2 ? `${nm(J)} dead · ${window}s` : `${eDeadP.length} enemies dead · ${window}s`;
      const key = `adv-${eDeadP.map((p) => p.cid).sort().join('-')}-${pick ? pick.key : 'towers'}`;
      if (pick) {
        const label = up(pick).label;
        return R('push', `${head}: ${pick.what}`, `Dead: ${deadList(eDeadP)}. ${label} is up and they can't contest it${jgDead ? ' (no enemy Smite)' : ''}`,
          `${lead}. ${label} is up, take it.`, key);
      }
      if (adv >= 2) {
        // nothing big is up: towers, or set up for what spawns inside the window
        const soon = objs.find((o) => o.status === 'upcoming' && o.in > 0 && o.in < window - 20 && ['baron', 'dragon', 'riftHerald'].includes(o.key));
        if (soon) return R('push', `${head}: ${soon.label} spawns in ${Math.round(soon.in)}s`, `Dead: ${deadList(eDeadP)}. Shove waves and stand on ${soon.label} as it spawns`,
          `${lead}. ${soon.label} spawns in ${Math.round(soon.in / 5) * 5} seconds: set up on it.`, key);
        return R('push', `${head}: take towers`, `Dead: ${deadList(eDeadP)}. No big objective up: push the lane with the most minions and hit towers`,
          `${lead}. Push towers.`, key);
      }
      return null;
    }
    if (-adv >= 2) {
      const times = aDeadP.map((p) => p.respawnTimer || 0).sort((x, y) => x - y);
      const window = Math.round(times[-adv - 2]);
      if (window < 12) return null;
      const threat = OBJ_NEED.map((o) => objs.find((x) => x.key === o.key && x.status === 'up')).find(Boolean);
      const meDead = P.me.isDead;
      return R('retreat', `Your team is ${-adv} down · ${window}s`, `${threat ? `${threat.label} is up: expect them to start it. ` : ''}Don't fight until they respawn; ${meDead ? 'plan where to join' : 'farm safe waves, don\'t face-check'}`,
        meDead ? null : `${(NUM_WORD[aDeadP.length] || String(aDeadP.length)).replace(/^./, (c) => c.toUpperCase())} of your team dead for ${window} seconds.${threat ? ` ${threat.label} is up, don't contest alone.` : ' Play safe.'}`,
        `down-${aDeadP.map((p) => p.cid).sort().join('-')}`);
    }
    return null;
  }

  // ---------- play mode: one recommendation that colors the dashboard ----------
  // Enemy HP and cooldowns are not in the live data, so this weighs levels, items, the matchup, your HP, the
  // enemy jungler's last sighting, dead players and objectives. The weighing ("fightScore") and the decision
  // order ("modes") come from the champion's playbook (rules.json); this code only computes the facts they read.
  const MODES = new Set(['allin', 'push', 'trade', 'safe', 'retreat', 'group', 'dead']);
  const capSentences = (s) => (s ? String(s).replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase()) : s);
  const orList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  // the facts a rule can read (documented in agents/playbook-format.md)
  function ruleContext(D, a) {
    const { P, t, objs, items, jungler: jt, state, team, comp, tags } = a;
    const { me, opp, enemies, allies } = P;
    const min = t / 60;
    const st = a.activeStats || {};
    const hp = st.maxHealth ? st.currentHealth / st.maxHealth : 1;
    const mana = st.resourceMax && /mana/i.test(st.resourceType || 'MANA') ? st.resourceValue / st.resourceMax : 1;
    const person = (p) => (p ? {
      champ: p.cid, name: champ(D, p.cid).name, level: p.level, dead: !!p.isDead, respawn: p.respawnTimer || 0,
      kills: p.scores.kills || 0, deaths: p.scores.deaths || 0, assists: p.scores.assists || 0, cs: p.scores.creepScore || 0,
      legendaries: legendaryCount(D, p), itemGold: itemValue(D, p), fed: isFed(p), class: (champ(D, p.cid).tags || [])[0] || '',
      ranged: (champ(D, p.cid).range || 0) > 300, damage: dmgType(D, p.cid),
      magic: Math.round((((comp.dmg || []).find((x) => x.cid === p.cid) || {}).magic ?? profile(D, p.cid).def) * 100) / 100,
    } : null);
    const mu = opp ? D.matchups[opp.cid] : null;
    const eDead = enemies.filter((p) => p.isDead).length, aDead = [me, ...allies].filter((p) => p.isDead).length;
    const fedP = enemies.filter((p) => p !== opp && !p.isDead && isFed(p));
    const fedNames = fedP.slice(0, 2).map((p) => champ(D, p.cid).name);
    const b = items.buyNow;
    const recall = b && b.cost >= 850 ? { stay: false, text: `Crash the wave, then recall: ${b.text.replace(/^Components for [^:]+: /, 'buy ')}` }
      : hp < 0.45 ? { stay: false, text: 'Crash the wave, then recall to heal up' }
        : { stay: true, text: `Stay: shove the wave and hit the turret (only ${items.gold}g, not worth a back yet)` };
    const soon = objs.find((o) => o.status !== 'taken' && ((o.in > 0 && o.in <= 60) || (o.status === 'up' && min >= 14 && o.key !== 'riftHerald' && t - o.next < 90)));
    const dragon = objs.find((o) => o.key === 'dragon');
    const big = dragon && dragon.stakes && (dragon.status === 'up' || dragon.in <= 90) ? dragon : null;
    const meF = { ...person(me), hp, mana, gold: items.gold };
    const oppF = person(opp);
    const tagObj = {}; for (const x of tags) tagObj[x] = true;
    return {
      t, min, clock: fmtClock(t), phase: a.phase,
      me: meF, opp: oppF, oppName: oppF ? oppF.name : 'your opponent',
      lvlD: oppF ? me.level - opp.level : 0, legD: oppF ? meF.legendaries - oppF.legendaries : 0,
      itemD: oppF ? meF.itemGold - oppF.itemGold : 0, csD: state.csD || 0,
      matchup: mu ? { difficulty: mu.difficulty, winRate: mu.winRate != null ? mu.winRate : mu.jaxWinRate } : { difficulty: null, winRate: null },
      lane: { label: state.label, very: state.very, est: state.est, reasons: state.reasons },
      team: { goldDiff: team.goldDiff, kills: team.kills, ekills: team.ekills, towers: team.towers, etowers: team.etowers },
      eDead, aDead, adv: eDead - aDead,
      jg: jt ? { status: jt.status, name: jt.name, ago: jt.ago, side: jt.last ? jt.last.side : null, withMe: !!(jt.last && jt.last.withMe), safeFor: jt.safeFor, key: jt.nearKey } : null,
      jgNote: jt && jt.status === 'unknown' && min >= 3 && min < 20 ? `${jt.name}'s position unknown: check the map` : '',
      soon: soon ? { key: soon.key, label: soon.label, in: soon.in, status: soon.status, next: soon.next, stakes: soon.stakes || null } : null,
      drakes: dragon ? { ours: dragon.drakes.ours, theirs: dragon.drakes.theirs, point: dragon.soulPoint, soul: dragon.soul } : { ours: 0, theirs: 0, point: null, soul: null },
      bigDragon: big ? { label: big.label, stakes: big.stakes, point: big.soulPoint, status: big.status, in: big.in, next: big.next } : null,
      guard: a.guard || null, recall, buyNow: b ? b.text : '', hpReason: hp < 0.5,
      fed: { count: fedP.length, names: orList(fedNames), verb: fedP.length > 1 ? 'are' : 'is', key: fedNames.join('-') },
      tags: tagObj, comp: { apShare: comp.apShare, tanks: comp.tanks.length, healers: comp.strongHeal.length, cc: comp.cc.length, burst: comp.burst.length, poke: comp.poke.length },
      plan: D.plan || null,
    };
  }
  // the decision order: the playbook's rules, plus the shared rules every champion gets (data/shared.json "rules",
  // skipped when the playbook has a rule with the same id), plus the game plan's rules
  function modesFor(D, R = D.rules || {}, overlay = D.overlayRules) {
    const own = new Set((R.modes || []).map((r) => r.id));
    const shared = ((D.shared || {}).rules || []).filter((r) => r && r.id && !own.has(r.id)).map((r) => ({ ...r, source: 'shared' }));
    return Rules.withOverlay(Rules.withOverlay(R.modes, shared), overlay);
  }
  function playMode(D, a) {
    const R = D.rules || {};
    const ctx = ruleContext(D, a);
    const sc = Rules.score(R.fightScore, ctx);
    ctx.e = sc.total; ctx.why = sc.why; ctx.first = sc.why[0] || '';
    ctx.reason = [sc.why.slice(0, 3).join(', '), ctx.jgNote].filter(Boolean).join(' · ');
    const modes = modesFor(D, R);
    const { decision, trace } = Rules.decide(modes, ctx, { numbers: () => numbersCall(D, a) });
    a.trace = { score: Math.round(sc.total * 100) / 100, terms: sc.trace, rules: trace, ctx };
    const d = decision || { mode: 'trade', headline: 'Trade & farm', reason: ctx.reason, voice: null, voiceKey: 'trade', rule: null };
    if (!MODES.has(d.mode)) d.mode = 'trade';
    d.voice = capSentences(d.voice) || null;
    if (!d.voiceKey) d.voiceKey = d.mode;
    return d;
  }

  // ---------- main ----------
  function analyze(game, D, opts) {
    const mem = opts.memory;
    const t = (game.gameData && game.gameData.gameTime) || 0;
    if (t < mem.lastT - 5) { for (const k of Object.keys(mem)) delete mem[k]; Object.assign(mem, newMemory()); }   // new game
    mem.lastT = t;
    const events = ((game.events && game.events.Events) || []).slice().sort((a, b) => a.EventTime - b.EventTime);
    // the loading screen / a replay can deliver data without a player list: nothing to analyze yet
    if (!(game.allPlayers || []).length) return null;
    const P = players(game, D, opts.overrideOppId);
    const { me, opp } = P;
    if (!me) return null;

    // only react to changes we actually saw happen (the app may be opened mid-game)
    if (mem.prevLevel != null && mem.prevLevel < 6 && me.level >= 6) mem.level6At = t;
    mem.prevLevel = me.level;
    const lg = legendaryCount(D, me);
    if (mem.legendaries != null && lg > mem.legendaries) {
      const newest = (me.items || []).filter((i) => isLegendary(D, i.itemID)).map((i) => itemData(D, i.itemID).name);
      mem.legendaryAt.push({ t, name: newest[newest.length - 1] });
    }
    mem.legendaries = lg;

    const team = teamState(D, P.allies, me, P.enemies, events, me.team);
    const state = laneState(D, me, opp, t, team);
    const phase = phaseOf(t, me.level, lg);
    const comp = composition(D, P.enemies, t);
    const tags = activeTags(comp, state, t, opp, mem.tags);
    mem.tags = tags;
    const myTeam = [me, ...P.allies];
    const teamOf = (name) => (myTeam.some((p) => nameIs(p, name)) ? 'mine' : P.enemies.some((p) => nameIs(p, name)) ? 'theirs' : null);
    const objs = objectives(D, events, t, teamOf);
    const trig = triggers(D, opts, mem, P, t, events, state, objs);
    const items = recommendItems(D, me, P.activePlayer, tags, comp);
    const a = {
      t, clock: fmtClock(t), P, phase, phaseLabel: PHASE_LABEL[phase], matchupPhase: MATCHUP_PHASE[phase],
      state, team, comp, tags, objs, triggers: trig, items, legendaries: lg, events,
      champ: me.cid, hasPlaybook: !!(D.playbook && D.playbook.champion === me.cid), gameMode: (game.gameData || {}).gameMode,
      activeStats: (game.activePlayer || {}).championStats || {},
      jungler: junglerTrack(D, P, events, t),
      lanes: lanes(D, P, t, events),
    };
    // "jungler showed top": one voice key per 150s, however many kills a gank produces
    const jt = a.jungler;
    if (jt && jt.last) {
      if (jt.status === 'near' && (mem.jgNearT == null || jt.last.t - mem.jgNearT > 150)) mem.jgNearT = jt.last.t;
      jt.nearKey = `jg-near-${Math.round(mem.jgNearT || 0)}`;
    }
    a.guard = fightGuard(D, a, mem);
    a.mode = playMode(D, a);
    // a shopping trip (item value jumps) opens a new recall window, so the next recall callout can play
    const iv = itemValue(D, me);
    if (mem.prevItemValue != null && iv - mem.prevItemValue >= 250) mem.shopWindow = (mem.shopWindow || 0) + 1;
    mem.prevItemValue = iv;
    a.recall = recallAdvice(D, a, mem);
    a.alerts = alerts(a);
    return a;
  }

  // ---------- alerts: the few moments that decide games, announced distinctly (not a play mode) ----------
  // Dragon Soul point and the Elder Dragon: 90 s before the spawn and when it's up
  function alerts(a) {
    const out = [];
    const dr = a.objs.find((o) => o.key === 'dragon');
    if (!dr || !dr.stakes || !(dr.status === 'up' || dr.in <= 90)) return out;
    const up = dr.status === 'up';
    const spokenIn = (sec) => (sec > 65 ? 'a minute and a half' : sec > 40 ? 'one minute' : `${Math.max(10, Math.round(sec / 10) * 10)} seconds`);
    const when = up ? 'is up' : `in ${fmtClock(dr.in)}`;
    if (dr.stakes === 'soul') {
      const p = dr.soulPoint;
      const who = p === 'theirs' ? 'Their soul point' : p === 'ours' ? 'Our soul point' : 'Soul point for both teams';
      const stake = p === 'theirs' ? 'If they take this dragon they get Dragon Soul.' : p === 'ours' ? 'This dragon gives your team Dragon Soul.' : 'Whoever takes this dragon gets Dragon Soul.';
      const act = up ? (p === 'theirs' ? 'Be at the pit with your team or trade something big across the map. Never let them take it for free.' : 'Be at the pit with your team. Do not get picked on the way.')
        : 'Push your wave, reset if you need to, and move down with your team before it spawns.';
      out.push({ id: 'soul', level: p === 'ours' ? 'good' : 'warn', title: `${who}: Dragon ${when}`, detail: `${stake} ${act}`, drakes: dr.drakes,
        voice: up ? `Soul dragon is up. ${p === 'theirs' ? 'Contest it.' : 'Group for it.'}` : `${p === 'theirs' ? 'Their soul point.' : p === 'ours' ? 'Our soul point.' : 'Soul point for both teams.'} Dragon in ${spokenIn(dr.in)}${p === 'theirs' ? ': they get Dragon Soul if they take it' : ''}. Push and group.`,
        key: `soul-${Math.round(dr.next)}${up ? '-up' : ''}` });
    } else {
      const mine = dr.soul === 'ours';
      out.push({ id: 'elder', level: 'warn', title: `Elder Dragon ${when}`, detail: `The team with Elder executes low-health enemies. ${up ? 'Fight for it together, or make them pay across the map.' : 'Push your wave and group before it spawns.'}${mine ? ' You have Dragon Soul.' : dr.soul ? ' They have Dragon Soul.' : ''}`,
        voice: up ? 'Elder Dragon is up. Group.' : `Elder Dragon in ${spokenIn(dr.in)}. Push and group.`,
        key: `elder-${Math.round(dr.next)}${up ? '-up' : ''}` });
    }
    return out;
  }

  // champ select: plan items from the enemy picks alone (no items or scores yet)
  function planForComp(D, enemyCids, oppCid) {
    const enemies = enemyCids.map((cid) => ({ cid, items: [], position: '', scores: {} }));
    const comp = composition(D, enemies, 0);
    const tags = activeTags(comp, { label: 'even' }, 0, oppCid ? { cid: oppCid } : null);
    const items = recommendItems(D, { items: [] }, { currentGold: 0 }, tags, comp);
    return { comp, tags, items };
  }

  return { analyze, newMemory, planForComp, modesFor, profile, fmtClock, parseClock, champ, champIdOf, itemData, isLegendary, legendaryCount, dmgType, nameIs, PHASE_LABEL, MATCHUP_PHASE, STRONG_HEALERS };
})();
