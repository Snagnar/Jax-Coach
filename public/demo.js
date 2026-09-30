// Jax Coach - demo game generator. Produces a fake /liveclientdata/allgamedata snapshot for any minute,
// so the whole UI can be tried without being in a game. Jax (you) vs Darius top.

const Demo = (() => {
  const LEVEL_AT = [[0, 1], [1.6, 2], [3, 3], [4.3, 4], [5.6, 5], [7.2, 6], [8.6, 7], [10, 8], [11.6, 9], [13.4, 10], [15.5, 11], [17.8, 12], [20, 13], [22.5, 14], [25, 15], [27.8, 16], [31, 17], [34.5, 18]];
  const levelAt = (m, bonus = 0) => {
    let l = 1;
    for (const [mm, lv] of LEVEL_AT) if (m >= mm) l = lv;
    return Math.max(1, Math.min(18, l + bonus));
  };

  const ROSTER = [
    { name: 'You', champ: 'Jax', team: 'ORDER', pos: 'TOP', spells: ['Flash', 'Teleport'], lvlBonus: 0,
      items: [[0, "Doran's Blade"], [0, 'Health Potion'], [0, 'Stealth Ward'], [9, 'Plated Steelcaps'], [13, '#core0'], [21, '#core1'], [28, '#core2'], [34, '#core3']] },
    { name: 'Blindmonk', champ: 'LeeSin', team: 'ORDER', pos: 'JUNGLE', spells: ['Flash', 'Smite'], lvlBonus: 0, items: [[11, 'Eclipse'], [19, "Sterak's Gage"], [27, 'Black Cleaver']] },
    { name: 'Foxfire', champ: 'Ahri', team: 'ORDER', pos: 'MIDDLE', spells: ['Flash', 'Ignite'], lvlBonus: 0, items: [[0, "Doran's Ring"], [11, "Luden's Companion"], [20, 'Shadowflame'], [28, "Rabadon's Deathcap"]] },
    { name: 'Getexcited', champ: 'Jinx', team: 'ORDER', pos: 'BOTTOM', spells: ['Flash', 'Heal'], lvlBonus: -1, items: [[0, "Doran's Blade"], [13, 'Yun Tal Wildarrows'], [22, 'Infinity Edge'], [30, "Lord Dominik's Regards"]] },
    { name: 'Lanterns', champ: 'Thresh', team: 'ORDER', pos: 'UTILITY', spells: ['Flash', 'Ignite'], lvlBonus: -2, items: [[14, 'Locket of the Iron Solari'], [26, "Knight's Vow"]] },
    { name: 'Noxianmight', champ: 'Darius', team: 'CHAOS', pos: 'TOP', spells: ['Flash', 'Ghost'], lvlBonus: 0,
      items: [[0, "Doran's Blade"], [0, 'Health Potion'], [8, 'Plated Steelcaps'], [14, 'Stridebreaker'], [22, "Sterak's Gage"], [29, "Dead Man's Plate"]] },
    { name: 'Piltoverfist', champ: 'Vi', team: 'CHAOS', pos: 'JUNGLE', spells: ['Flash', 'Smite'], lvlBonus: 0, items: [[11, 'Trinity Force'], [20, 'Black Cleaver'], [28, "Death's Dance"]] },
    { name: 'Darksov', champ: 'Syndra', team: 'CHAOS', pos: 'MIDDLE', spells: ['Flash', 'Teleport'], lvlBonus: 0, items: [[0, "Doran's Ring"], [12, "Luden's Companion"], [21, 'Shadowflame'], [29, "Rabadon's Deathcap"]] },
    { name: 'Voidborn', champ: 'Kaisa', team: 'CHAOS', pos: 'BOTTOM', spells: ['Flash', 'Heal'], lvlBonus: -1, items: [[0, "Doran's Blade"], [13, 'Kraken Slayer'], [22, "Nashor's Tooth"], [30, "Guinsoo's Rageblade"]] },
    { name: 'Starchild', champ: 'Soraka', team: 'CHAOS', pos: 'UTILITY', spells: ['Flash', 'Exhaust'], lvlBonus: -2, items: [[14, 'Moonstone Renewer'], [24, 'Redemption']] },
  ];

  // scripted kill feed / objectives
  const EVENTS = [
    { EventName: 'GameStart', EventTime: 0 },
    { EventName: 'ChampionKill', EventTime: 222, KillerName: 'You', VictimName: 'Noxianmight', Assisters: [] },
    { EventName: 'ChampionKill', EventTime: 318, KillerName: 'Piltoverfist', VictimName: 'Getexcited', Assisters: ['Starchild'] },
    { EventName: 'ChampionKill', EventTime: 700, KillerName: 'Voidborn', VictimName: 'Lanterns', Assisters: ['Starchild'] },
    { EventName: 'ChampionKill', EventTime: 704, KillerName: 'Getexcited', VictimName: 'Voidborn', Assisters: [] },
    { EventName: 'DragonKill', EventTime: 395, KillerName: 'Blindmonk', DragonType: 'Fire' },
    { EventName: 'HordeKill', EventTime: 495, KillerName: 'Piltoverfist' },
    { EventName: 'ChampionKill', EventTime: 560, KillerName: 'Noxianmight', VictimName: 'You', Assisters: ['Piltoverfist'] },
    { EventName: 'ChampionKill', EventTime: 772, KillerName: 'You', VictimName: 'Noxianmight', Assisters: [] },
    { EventName: 'ChampionKill', EventTime: 905, KillerName: 'You', VictimName: 'Piltoverfist', Assisters: ['Blindmonk'] },
    { EventName: 'TurretKilled', EventTime: 925, KillerName: 'You', TurretKilled: 'Turret_T2_L_03_A', Assisters: [] },
    { EventName: 'HeraldKill', EventTime: 960, KillerName: 'Blindmonk' },
    { EventName: 'DragonKill', EventTime: 1010, KillerName: 'Piltoverfist', DragonType: 'Water' },
    { EventName: 'ChampionKill', EventTime: 1180, KillerName: 'Darksov', VictimName: 'Getexcited', Assisters: ['Starchild'] },
    { EventName: 'ChampionKill', EventTime: 1190, KillerName: 'You', VictimName: 'Darksov', Assisters: [] },
    { EventName: 'ChampionKill', EventTime: 1500, KillerName: 'You', VictimName: 'Voidborn', Assisters: ['Foxfire'] },
    { EventName: 'ChampionKill', EventTime: 1506, KillerName: 'Foxfire', VictimName: 'Starchild', Assisters: ['You'] },
    { EventName: 'TurretKilled', EventTime: 1530, KillerName: 'Noxianmight', TurretKilled: 'Turret_T1_L_02_A', Assisters: [] },
    { EventName: 'BaronKill', EventTime: 1560, KillerName: 'Blindmonk' },
    { EventName: 'DragonKill', EventTime: 1325, KillerName: 'Piltoverfist', DragonType: 'Earth' },
    { EventName: 'DragonKill', EventTime: 1640, KillerName: 'Piltoverfist', DragonType: 'Hextech' },
    { EventName: 'ChampionKill', EventTime: 1830, KillerName: 'Noxianmight', VictimName: 'You', Assisters: ['Piltoverfist', 'Darksov'] },
  ];

  function resolveItem(D, name) {
    if (name.startsWith('#core')) {
      const core = ((D.meta && D.meta.coreBuild && D.meta.coreBuild.typicalOrder) || [])
        .filter((n) => { const id = D.dd.itemByName[n.toLowerCase()]; return !(id && (D.dd.items[id].tags || []).includes('Boots')); });
      name = core[+name.slice(5)];
      if (!name) return null;
    }
    const id = D.dd.itemByName[name.toLowerCase()];
    if (!id) return null;
    const it = D.dd.items[id];
    return { itemID: +id, displayName: it.name, count: 1, price: it.gold.total, consumable: (it.tags || []).includes('Consumable') };
  }

  function snapshot(D, sec) {
    const m = sec / 60;
    const ev = EVENTS.filter((e) => e.EventTime <= sec).map((e, i) => ({ EventID: i, ...e }));
    const allPlayers = ROSTER.map((r, idx) => {
      const lvlBonus = r.name === 'You' && m > 4 && m < 14 ? 1 : r.lvlBonus;
      const level = levelAt(m, lvlBonus);
      const kills = ev.filter((e) => e.EventName === 'ChampionKill' && e.KillerName === r.name).length;
      const deaths = ev.filter((e) => e.EventName === 'ChampionKill' && e.VictimName === r.name);
      const assists = ev.filter((e) => e.EventName === 'ChampionKill' && (e.Assisters || []).includes(r.name)).length;
      const lastDeath = deaths[deaths.length - 1];
      const respawn = lastDeath ? 6 + level * 2.6 + (m > 25 ? 12 : 0) : 0;
      const deadFor = lastDeath ? sec - lastDeath.EventTime : 1e9;
      const csRate = r.pos === 'UTILITY' ? 1.1 : r.pos === 'JUNGLE' ? 5.6 : r.name === 'You' ? 7.6 : 6.8;
      // late-game item slots get replaced by the full build
      let owned = r.items.filter(([mm]) => m >= mm).map(([, n]) => n);
      if (owned.filter((n) => !/Potion|Ward|Doran/.test(n)).length >= 3) owned = owned.filter((n) => !/Potion|Doran/.test(n));
      const items = owned.map((n) => resolveItem(D, n)).filter(Boolean).slice(0, 6).map((it, slot) => ({ ...it, slot }));
      const champ = D.dd.champs[r.champ] || { name: r.champ };
      return {
        championName: champ.name, rawChampionName: `game_character_displayname_${r.champ}`,
        isBot: false, isDead: deadFor < respawn, respawnTimer: deadFor < respawn ? respawn - deadFor : 0,
        items, level, position: r.pos,
        riotId: `${r.name}#DEMO`, riotIdGameName: r.name, riotIdTagLine: 'DEMO', summonerName: `${r.name}#DEMO`,
        scores: { kills, deaths: deaths.length, assists, creepScore: Math.floor(Math.max(0, m - 1.4) * csRate / 10) * 10, wardScore: Math.floor(m * 0.8) },
        summonerSpells: { summonerSpellOne: { displayName: r.spells[0] }, summonerSpellTwo: { displayName: r.spells[1] } },
        team: r.team, skinID: 0,
      };
    });
    const me = allPlayers[0];
    return {
      activePlayer: {
        riotId: me.riotId, riotIdGameName: me.riotIdGameName, summonerName: me.summonerName, level: me.level,
        currentGold: Math.round(((sec * 7.3) % 1400) + 150),
        championStats: { maxHealth: 620 + me.level * 100, currentHealth: Math.round((620 + me.level * 100) * (0.62 + 0.38 * Math.sin(sec / 23))) },
      },
      allPlayers,
      events: { Events: ev },
      gameData: { gameMode: 'CLASSIC', gameTime: sec, mapName: 'Map11', mapNumber: 11 },
      demo: true,
    };
  }

  return { snapshot };
})();
