// Jax Coach - champion playbooks on the page.
// A playbook = meta (build, runes, items), phases (game plan), matchups, rules (the in-game decisions).
// The server resolves each part: your local version (research agents, approved changes) > the shipped one.
// Missing parts fall back to the generic top-lane playbook. A game plan from a research agent is an overlay
// on top: it can reorder the build, change rule parameters and add decision rules for this game only.

const Playbooks = (() => {
  const cache = {};            // champion id -> raw playbook from /api/playbook/<id>
  let generic = null;
  let list = [];               // /api/playbooks: what exists (shipped / local versions / drafts)
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

  async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
  async function loadGeneric() { if (!generic) generic = await getJSON('/api/playbook/_generic'); return generic; }
  async function load(champ, fresh = false) {
    if (!champ) return null;
    if (!fresh && cache[champ]) return cache[champ];
    try { cache[champ] = await getJSON(`/api/playbook/${encodeURIComponent(champ)}`); } catch { cache[champ] = cache[champ] || null; }
    return cache[champ];
  }
  async function refreshList() {
    try { list = await getJSON('/api/playbooks'); } catch { /* server without playbooks */ }
    changed();
    return list;
  }
  const info = (champ) => list.find((p) => p.champion === champ) || null;
  const has = (champ) => { const i = info(champ); return !!(i && (i.parts.meta || i.parts.rules)); };
  const isDraft = (champ) => { const i = info(champ); return !!(i && i.draft); };
  const raw = (champ) => cache[champ] || null;

  // normalise matchup keys to Data Dragon ids ("Wukong" -> MonkeyKing)
  function normMatchups(obj, dd) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (k.startsWith('_') || !v || typeof v !== 'object') continue;
      const id = dd.champs[k] ? k : dd.champByName[String(v.name || k).toLowerCase()] || k;
      if (v.winRate == null && v.jaxWinRate != null) v.winRate = v.jaxWinRate;
      out[id] = { ...v, id };
    }
    return out;
  }

  // the playbook as the engine and views use it, for one champion, with an optional game-plan overlay
  function effective(champ, dd, overlay) {
    const pb = cache[champ] || {};
    const gen = generic || {};
    const cls = ((dd.champs[champ] || {}).tags || [])[0] || 'Fighter';
    let meta = pb.meta;
    if (!meta) {
      const gm = gen.meta || {};
      const bc = (gm.byClass || {})[cls] || (gm.byClass || {}).Fighter || {};
      meta = { ...gm, champion: champ, items: bc.items || [], coreBuild: { ...(gm.coreBuild || {}), boots: bc.boots || [] } };
    }
    let phases = pb.phases || gen.phases || {};
    let rules = pb.rules || gen.rules || {};
    const matchups = normMatchups((pb.matchups || {}).matchups, dd);
    let overlayRules = null;
    if (overlay) {
      if (overlay.build && Array.isArray(overlay.build.order) && overlay.build.order.length) {
        meta = Rules.merge(meta, { coreBuild: { typicalOrder: overlay.build.order, why: overlay.build.why || {}, sell: Array.isArray(overlay.build.sell) ? overlay.build.sell : [], source: 'plan' } });
      }
      if (overlay.params) rules = Rules.merge(rules, { params: overlay.params });
      if (overlay.phaseNotes) {
        phases = { ...phases, phases: (phases.phases || []).map((p) => (overlay.phaseNotes[p.id] ? { ...p, plan: overlay.phaseNotes[p.id] } : p)) };
      }
      if (Array.isArray(overlay.rules)) overlayRules = cleanRules(overlay.rules);
    }
    return {
      meta, phases, rules, matchups, overlayRules,
      playbook: {
        champion: champ, generic: !pb.meta && !pb.rules, draft: !!pb.draft, version: pb.activeVersion || 0,
        source: pb.source || {}, partsMissing: ['meta', 'phases', 'matchups', 'rules'].filter((p) => !pb[p]),
      },
    };
  }
  const MODES = ['allin', 'push', 'trade', 'safe', 'retreat', 'group'];
  // agent-written rules are data, but still checked: known modes only, expressions must parse
  function cleanRules(rs) {
    const out = [];
    for (const r of rs || []) {
      if (!r || !r.id || r.use || r.anchor) continue;
      if (r.disable) { out.push({ id: String(r.id), disable: String(r.disable) }); continue; }
      const bad = Rules.check({ modes: [r] });
      if (bad.length) { console.warn('Plan rule skipped', r.id, bad); continue; }
      if (!/\{/.test(String(r.mode)) && !MODES.includes(r.mode)) { console.warn('Plan rule skipped (mode)', r.id, r.mode); continue; }
      out.push({ ...r, id: `plan:${String(r.id).replace(/^plan:/, '')}` });
    }
    return out;
  }
  async function saveVersion(champ, parts, note, source) {
    const body = { parts: {}, note, source };
    for (const [k, v] of Object.entries(parts)) body.parts[k] = JSON.stringify(v, null, 2);
    const r = await fetch(`/api/playbook/${encodeURIComponent(champ)}/version`, { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    cache[champ] = j;
    await refreshList();
    return j;
  }
  async function activate(champ, version) {
    const r = await fetch(`/api/playbook/${encodeURIComponent(champ)}/activate`, { method: 'POST', body: JSON.stringify({ version }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    cache[champ] = j;
    await refreshList();
    return j;
  }

  return { load, loadGeneric, refreshList, info, has, isDraft, raw, effective, cleanRules, saveVersion, activate, onChange: (f) => listeners.push(f), get list() { return list; } };
})();
