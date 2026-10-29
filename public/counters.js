// Jax Coach - "Best picks vs X" in champ select: which champion to pick against an enemy champion in your lane.
// The numbers come from lolalytics (via the local server, cached 12 hours): every champion's win rate against X in
// your lane over the last 30 days, for one rank tier. Your own games on that champion against X pull the score
// toward your record, more the more games you have.

const Counters = (() => {
  const mem = new Map();          // "lane|tier|champ" -> { status, at, data, error }
  let listener = () => {};

  const TIERS = [['all', 'All ranks'], ['iron', 'Iron'], ['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['platinum', 'Platinum'],
    ['emerald', 'Emerald'], ['gold_plus', 'Gold+'], ['platinum_plus', 'Platinum+'], ['emerald_plus', 'Emerald+'], ['diamond_plus', 'Diamond+']];
  const TIER_OF = { IRON: 'iron', BRONZE: 'bronze', SILVER: 'silver', GOLD: 'gold', PLATINUM: 'platinum', EMERALD: 'emerald',
    DIAMOND: 'diamond_plus', MASTER: 'diamond_plus', GRANDMASTER: 'diamond_plus', CHALLENGER: 'diamond_plus' };
  const LANE = { top: 'top', mid: 'middle' };
  // lolalytics names champions by their name in lowercase letters ("drmundo", "wukong"), with two short ones
  const SLUG_FIX = { nunuwillump: 'nunu', renataglasc: 'renata' };
  const slug = (D, cid) => { const s = String(((D.dd.champs[cid] || {}).name) || cid).toLowerCase().replace(/[^a-z]/g, ''); return SLUG_FIX[s] || s; };

  // your rank tier from the League client (read once); the tier list on the panel can change it
  let myTier = null;
  async function loadMyTier() {
    if (myTier !== null) return myTier;
    myTier = '';
    try {
      const r = await fetch('/api/lcu/lol-ranked/v1/current-ranked-stats');
      if (r.ok) { const j = await r.json(); myTier = TIER_OF[String(((j.queueMap || {}).RANKED_SOLO_5x5 || {}).tier || '').toUpperCase()] || ''; }
    } catch {}
    listener();
    return myTier;
  }
  function tier() {
    try { const t = localStorage.getItem('jc.counterTier'); if (t && TIERS.some(([k]) => k === t)) return t; } catch {}
    return myTier || 'all';
  }
  // the tier buttons: all ranks, your own tier, and the usual groups above it
  const shownTiers = () => TIERS.filter(([k]) => ['all', 'gold_plus', 'emerald_plus', 'diamond_plus', myTier, tier()].includes(k));
  function setTier(t) { try { localStorage.setItem('jc.counterTier', t); } catch {} listener(); }

  function get(D, enemy, role) {
    const lane = LANE[role] || 'top', t = tier(), key = `${lane}|${t}|${enemy}`;
    let e = mem.get(key);
    if (e && (e.status !== 'error' || Date.now() - e.tried < 30000)) return e;
    e = { status: 'loading', tried: Date.now() };
    mem.set(key, e);
    fetch(`/api/counters/${lane}/${t}/${slug(D, enemy)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.data) throw new Error(j.error || `stats unavailable (${r.status})`);
      Object.assign(e, { status: 'done', at: j.at, data: j.data });
    }).catch((err) => Object.assign(e, { status: 'error', error: err.message })).finally(() => listener());
    return e;
  }

  // the champions you'd pick: playbooks in this role, and champions with 5+ games in this role in your archive
  function pool(role) {
    const out = new Set(Playbooks.list.map((p) => Playbooks.parse(p.champion)).filter((p) => p.role === role).map((p) => p.cid));
    const n = {};
    for (const r of Archive.rows()) if (!r.remake && Archive.inRole(r, role)) n[r.champ] = (n[r.champ] || 0) + 1;
    for (const [c, k] of Object.entries(n)) if (k >= 5) out.add(c);
    return { set: out, games: n };
  }

  // rows for every champion lolalytics has against the enemy: their win rate vs the enemy (shrunk toward their usual
  // win rate when the matchup has few games), your record, and the blended score the list is sorted by
  function rank(D, e, enemy, role) {
    if (!e || e.status !== 'done') return null;
    const data = e.data, P = pool(role);
    const list = arr(data.counters);
    const total = list.reduce((s, x) => s + (x.n || 0), 0);
    const rows = [];
    for (const x of list) {
      const cid = D.dd.keyToId[String(x.cid)];
      if (!cid || cid === enemy) continue;
      const wr = 100 - x.vsWr;                     // vsWr: the enemy's win rate against this champion
      const base = 100 - x.allWr;                  // allWr: 100 - this champion's usual win rate
      const adj = (x.n * wr + 300 * base) / (x.n + 300);
      const me = Archive.vs(cid, enemy, role);
      const g = me ? me.games : 0, myWr = g ? (me.wins / g) * 100 : null;
      const w = g >= 3 ? g / (g + 12) : 0;
      rows.push({ cid, wr, n: x.n, delta: wr - base, adj, my: me ? { games: g, wins: me.wins } : null, myWr, w,
        score: (1 - w) * adj + w * (myWr == null ? adj : myWr), inPool: P.set.has(cid), played: P.games[cid] || 0,
        common: x.n >= Math.max(150, total * 0.004) });
    }
    rows.sort((a, b) => b.score - a.score);
    const missing = [...P.set].filter((c) => c !== enemy && !rows.some((r) => r.cid === c));
    return { rows, total, missing, lane: data.stats && data.stats.lane, enemyWr: data.stats ? +data.stats.wr : null };
  }

  const arr = (x) => (Array.isArray(x) ? x : []);
  return { TIERS, shownTiers, get, rank, tier, setTier, loadMyTier, myTier: () => myTier, onUpdate: (fn) => { listener = fn; } };
})();
