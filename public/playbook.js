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

  // playbook v2 upgrade for rules written before it, applied on load (no new version needed):
  // - the fight-score term built on the fixed matchup difficulty uses the matchup's power curve (pw) instead;
  //   pw is (3 - difficulty) * 0.5 when a matchup has no curve, so old matchups score exactly as before
  // - the lane "trade" rule uses the short-trade score (eShort); the all-in rule keeps the long-fight score (e)
  function upgradeRules(rules) {
    if (!rules || !Array.isArray(rules.fightScore) || rules.fightScore.some((t) => /\bpw\b/.test(String(t.add)))) return rules;
    const fightScore = rules.fightScore.map((t) => (/matchup\.difficulty/.test(String(t.add))
      ? { ...t, add: String(t.add).replace(/\(\s*3\s*-\s*\(\s*matchup\.difficulty\s*\|\|\s*3\s*\)\s*\)/g, '(pw * 2)'), why: t.why || "{pw > 0 ? 'you win this stage of the matchup' : oppName + ' wins this stage of the matchup'}", whyWhen: t.whyWhen || 'abs(pw) >= 1' } : t));
    const modes = (rules.modes || []).map((r) => (r.id === 'lane_trade' && /\be\s*>=/.test(String(r.when)) ? { ...r, when: String(r.when).replace(/\be\s*>=/, 'eShort >=') } : r));
    return { ...rules, fightScore, modes };
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
    let rules = upgradeRules(pb.rules || gen.rules || {});
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
  // agent-written game-plan rules: checked like every agent rule (Rules.clean); "disable" keeps its plain id
  const cleanRules = (rs) => Rules.clean(rs, 'plan').map((r) => (r.disable ? { id: r.id.replace(/^plan:/, ''), disable: r.disable } : r));

  // your personal rules and hints (learned from your games), shared by all champions: history\personal.json
  let personal = null;
  async function loadPersonal() { try { personal = await getJSON('/api/personal'); } catch { personal = personal || { rules: [], hints: [] }; } return personal; }
  async function savePersonal(next, note) {
    const r = await fetch('/api/personal', { method: 'POST', body: JSON.stringify({ ...next, updated: new Date().toISOString(), note: note || '' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    personal = j;
    return j;
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

  return { load, loadGeneric, refreshList, info, has, isDraft, raw, effective, cleanRules, saveVersion, activate, loadPersonal, savePersonal, get personal() { return personal; }, onChange: (f) => listeners.push(f), get list() { return list; } };
})();
