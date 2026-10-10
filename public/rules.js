// Jax Coach - playbook rules: a small, safe expression language plus the rule runner.
// Playbooks (data/champions/<Champ>/rules.json) describe the in-game decisions as data, so they can be read,
// explored, swapped per champion and rewritten by the research agents without touching code.
//
// Expressions are a JavaScript subset, evaluated without eval():
//   literals 12, 0.5, 'text', "text", true, false, null · names and paths me.level, opp.name, tags.vs_tanks
//   unary ! - · * / % + - · < <= > >= == != · && || · a ? b : c · (...) · calls to the functions in FN
// Missing names evaluate to undefined (never an error), so "opp.level" is safe when there is no opponent.
// Templates: "text {expr} text". A template that is exactly one {expr} returns the raw value (can be null).

const Rules = (() => {
  const FN = {
    abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    clock: (s) => { s = Math.max(0, Math.round(+s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; },
    has: (list, x) => (Array.isArray(list) ? list.includes(x) : !!(list && typeof list === 'object' && list[x])),
    count: (list) => (Array.isArray(list) ? list.length : 0),
    join: (list, sep) => (Array.isArray(list) ? list.join(sep == null ? ', ' : sep) : ''),
    upper: (s) => String(s == null ? '' : s).toUpperCase(),
    lower: (s) => String(s == null ? '' : s).toLowerCase(),
    cap: (s) => { s = String(s == null ? '' : s); return s ? s[0].toUpperCase() + s.slice(1) : s; },
    num: (n) => ['zero', 'one', 'two', 'three', 'four', 'five'][n] || String(n),
    plural: (n, one, many) => (n === 1 ? one : many),
    pct: (v) => `${Math.round((+v || 0) * 100)}%`,
    signed: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`,
  };

  // ---------- tokenizer ----------
  function tokenize(src) {
    const out = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1]))) {
        let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        out.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i; while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
        const w = s.slice(i, j);
        if (w === 'true' || w === 'false') out.push({ t: 'lit', v: w === 'true' });
        else if (w === 'null') out.push({ t: 'lit', v: null });
        else if (w === 'undefined') out.push({ t: 'lit', v: undefined });
        else out.push({ t: 'id', v: w });
        i = j; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, str = '';
        while (j < s.length && s[j] !== c) { if (s[j] === '\\' && j + 1 < s.length) { j++; str += s[j] === 'n' ? '\n' : s[j]; } else str += s[j]; j++; }
        if (j >= s.length) throw new Error('unterminated string');
        out.push({ t: 'str', v: str }); i = j + 1; continue;
      }
      const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
      if (three === '===' || three === '!==') { out.push({ t: 'op', v: three.slice(0, 2) }); i += 3; continue; }
      if (['==', '!=', '<=', '>=', '&&', '||', '??'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%<>!?:.(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error(`unexpected character "${c}"`);
    }
    return out;
  }

  // ---------- parser (precedence climbing) -> tiny AST ----------
  const BIN = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
  function parse(src) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p], next = () => tk[p++];
    const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error(`expected "${v}"`); p++; };
    function primary() {
      const t = next();
      if (!t) throw new Error('unexpected end');
      if (t.t === 'num' || t.t === 'str' || t.t === 'lit') return { k: 'lit', v: t.v };
      if (t.t === 'op' && t.v === '(') { const e = ternary(); expect(')'); return e; }
      if (t.t === 'op' && (t.v === '!' || t.v === '-')) return { k: 'un', op: t.v, a: unary() };
      if (t.t === 'id') {
        if (isOp('(')) {
          p++;
          if (!FN[t.v]) throw new Error(`unknown function ${t.v}()`);
          const args = [];
          if (!isOp(')')) { do { args.push(ternary()); } while (isOp(',') && ++p); }
          expect(')');
          return { k: 'call', f: t.v, args };
        }
        let node = { k: 'id', path: [t.v] };
        while (isOp('.')) { p++; const n = next(); if (!n || n.t !== 'id') throw new Error('expected a name after "."'); node.path.push(n.v); }
        return node;
      }
      throw new Error(`unexpected "${t.v}"`);
    }
    function unary() { return primary(); }
    function binary(minPrec) {
      let left = unary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== 'op' || !BIN[t.v] || BIN[t.v] < minPrec) return left;
        p++;
        const right = binary(BIN[t.v] + 1);
        left = { k: 'bin', op: t.v, a: left, b: right };
      }
    }
    function ternary() {
      const c = binary(1);
      if (!isOp('?')) return c;
      p++; const a = ternary(); expect(':'); const b = ternary();
      return { k: 'tern', c, a, b };
    }
    const ast = ternary();
    if (p < tk.length) throw new Error(`unexpected "${tk[p].v}"`);
    return ast;
  }

  function ev(n, ctx) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'id': { let v = ctx; for (const k of n.path) { if (v == null) return undefined; v = v[k]; } return v; }
      case 'un': { const a = ev(n.a, ctx); return n.op === '!' ? !a : -a; }
      case 'call': return FN[n.f](...n.args.map((x) => ev(x, ctx)));
      case 'tern': return ev(n.c, ctx) ? ev(n.a, ctx) : ev(n.b, ctx);
      case 'bin': {
        if (n.op === '&&') { const a = ev(n.a, ctx); return a ? ev(n.b, ctx) : a; }
        if (n.op === '||') { const a = ev(n.a, ctx); return a ? a : ev(n.b, ctx); }
        if (n.op === '??') { const a = ev(n.a, ctx); return a != null ? a : ev(n.b, ctx); }
        const a = ev(n.a, ctx), b = ev(n.b, ctx);
        switch (n.op) {
          case '+': return (typeof a === 'string' || typeof b === 'string') ? `${a == null ? '' : a}${b == null ? '' : b}` : (a || 0) + (b || 0);
          case '-': return a - b; case '*': return a * b; case '/': return b ? a / b : 0; case '%': return b ? a % b : 0;
          case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
          case '==': return a === b || (a == null && b == null); case '!=': return !(a === b || (a == null && b == null));
        }
      }
    }
    return undefined;
  }

  // parsed expressions are cached; a broken expression is remembered with its error
  const cache = new Map();
  function compile(src) {
    const key = String(src);
    if (!cache.has(key)) {
      try { cache.set(key, { ast: parse(key) }); } catch (e) { cache.set(key, { error: e.message }); }
    }
    return cache.get(key);
  }
  function evaluate(src, ctx) {
    if (src === true || src === false || typeof src === 'number') return src;
    if (src == null || src === '') return true;
    const c = compile(src);
    if (c.error) throw new Error(`${c.error} in: ${src}`);
    return ev(c.ast, ctx);
  }
  const whole = /^\{([^{}]*)\}$/;
  function template(str, ctx) {
    if (str == null) return str;
    if (typeof str !== 'string') return str;
    const m = str.match(whole);
    if (m) return evaluate(m[1], ctx);
    return str.replace(/\{([^{}]*)\}/g, (_, e) => { const v = evaluate(e, ctx); return v == null ? '' : String(v); });
  }
  // check every expression in a rules file up front (used when loading a playbook and by the Playbook view)
  function check(rules) {
    const problems = [];
    const exprs = (s) => (typeof s === 'string' ? (s.match(/\{([^{}]*)\}/g) || []).map((x) => x.slice(1, -1)) : []);
    const test = (where, src) => { const c = compile(src); if (c.error) problems.push({ where, error: c.error, src }); };
    for (const r of (rules && rules.fightScore) || []) {
      if (r.when) test(`fightScore.${r.id}.when`, r.when);
      if (typeof r.add === 'string') test(`fightScore.${r.id}.add`, r.add);
      for (const e of exprs(r.why)) test(`fightScore.${r.id}.why`, e);
      if (r.whyWhen) test(`fightScore.${r.id}.whyWhen`, r.whyWhen);
    }
    for (const r of (rules && rules.modes) || []) {
      if (r.when) test(`modes.${r.id}.when`, r.when);
      for (const f of ['mode', 'headline', 'reason', 'voice', 'voiceKey', 'position', 'farm', 'trade']) for (const e of exprs(r[f])) test(`modes.${r.id}.${f}`, e);
      for (const f of ['do', 'dont']) for (const s of [].concat(r[f] || [])) for (const e of exprs(s)) test(`modes.${r.id}.${f}`, e);
    }
    for (const h of (rules && rules.hints) || []) {
      if (h.when) test(`hints.${h.id}.when`, h.when);
      for (const e of exprs(h.text)) test(`hints.${h.id}.text`, e);
    }
    return problems;
  }
  // rules written by agents (game plans, matchup profiles, personal rules) are data, but still checked: known
  // modes and stance values only, every expression must parse. Ids get a prefix so they can't replace core rules.
  const MODES = ['allin', 'push', 'trade', 'safe', 'retreat', 'group'];
  const STANCE_VALUES = { position: ['forward', 'wave', 'tower', 'behind_tower', 'off_lane', 'group', 'side'], farm: ['all', 'safe', 'cannons', 'none'], trade: ['allin', 'short', 'none'] };
  function clean(rs, prefix) {
    const out = [];
    for (const r of rs || []) {
      if (!r || !r.id || r.use || r.anchor) continue;
      const id = `${prefix}:${String(r.id).replace(/^[a-z]+:/, '')}`;
      if (r.disable) { out.push({ id, disable: String(r.disable) }); continue; }
      const bad = check({ modes: [r] });
      if (bad.length) { console.warn(`Rule skipped (${prefix})`, r.id, bad); continue; }
      if (!/\{/.test(String(r.mode)) && !MODES.includes(r.mode)) { console.warn(`Rule skipped (${prefix}, mode)`, r.id, r.mode); continue; }
      const rule = { ...r, id };
      for (const [k, ok] of Object.entries(STANCE_VALUES)) if (rule[k] && !/\{/.test(String(rule[k])) && !ok.includes(rule[k])) delete rule[k];
      out.push(rule);
    }
    return out;
  }

  // ---------- rule runners ----------
  // fightScore: terms summed into one number. Terms that share a "group" are exclusive (first match wins).
  function score(terms, ctx) {
    let total = 0;
    const why = [], trace = [], used = new Set();
    for (const r of terms || []) {
      if (r.group && used.has(r.group)) continue;
      let on = false, add = 0, err = null;
      try {
        on = !!evaluate(r.when, ctx);
        if (on) { add = typeof r.add === 'string' ? +evaluate(r.add, { ...ctx, e: total }) || 0 : +r.add || 0; }
      } catch (e) { err = e.message; }
      if (on && r.group) used.add(r.group);
      if (on) total += add;
      let text = null;
      if (on && r.why) {
        try { if (!r.whyWhen || evaluate(r.whyWhen, ctx)) text = template(r.why, ctx); } catch (e) { err = err || e.message; }
        if (text) { if (r.first) why.unshift(text); else why.push(text); }
      }
      trace.push({ id: r.id, on, add: Math.round(add * 100) / 100, why: text, error: err });
    }
    return { total, why, trace };
  }

  // modes: ordered list, the first rule whose "when" holds decides. A rule can hand the decision to a
  // built-in analyzer ("use": "numbers") that returns a full decision or nothing (then the next rule is tried).
  function decide(modes, ctx, builtins) {
    const trace = [];
    for (const r of modes || []) {
      if (r.anchor || r.disabled) continue;
      let on = false;
      try { on = !!evaluate(r.when, ctx); } catch (e) { trace.push({ id: r.id, on: false, error: e.message }); continue; }
      if (!on) { trace.push({ id: r.id, on: false }); continue; }
      if (r.use) {
        const fn = builtins && builtins[r.use];
        const out = fn ? fn(ctx, r) : null;
        trace.push({ id: r.id, on: true, used: r.use, decided: !!out });
        if (out) return { decision: { ...out, rule: r.id, source: r.source || null }, trace };
        continue;
      }
      try {
        const list = (x) => [].concat(x || []).map((s) => template(s, ctx)).filter((s) => s != null && String(s).trim());
        const d = {
          mode: template(r.mode, ctx), headline: template(r.headline, ctx), reason: template(r.reason, ctx) || '',
          voice: r.voice ? template(r.voice, ctx) : null, voiceKey: r.voiceKey ? template(r.voiceKey, ctx) : null,
          rule: r.id, source: r.source || null,
          // v2: where to stand, what to farm, how to trade, and short do / don't lines
          position: r.position ? template(r.position, ctx) : null, farm: r.farm ? template(r.farm, ctx) : null, trade: r.trade ? template(r.trade, ctx) : null,
          stanceSet: !!(r.position || r.farm || r.trade), do: list(r.do), dont: list(r.dont),
        };
        if (!d.voiceKey) d.voiceKey = d.mode;
        if (d.voice === '') d.voice = null;
        trace.push({ id: r.id, on: true, decided: true });
        return { decision: d, trace };
      } catch (e) { trace.push({ id: r.id, on: true, error: e.message }); }
    }
    return { decision: null, trace };
  }

  // a game-plan overlay can add rules ("before" a rule id, or at the "plan" anchor), replace or disable rules
  function withOverlay(modes, overlayRules) {
    let out = (modes || []).map((r) => ({ ...r }));
    for (const o of overlayRules || []) {
      if (!o || !o.id) continue;
      if (o.disable) { out.forEach((r) => { if (r.id === o.disable) r.disabled = true; }); continue; }
      const rule = { ...o, source: o.source || 'plan' };
      if (o.replace) { const i = out.findIndex((r) => r.id === o.replace); if (i >= 0) { out[i] = rule; continue; } }
      out = out.filter((r) => r.id !== o.id);
      let i = o.before ? out.findIndex((r) => r.id === o.before) : -1;
      if (i < 0) i = out.findIndex((r) => r.anchor && r.id === 'plan');
      if (i < 0) i = out.length;
      out.splice(i, 0, rule);
    }
    return out;
  }

  // deep merge for playbook patches: objects merge, arrays and values replace, null deletes
  function merge(base, patch) {
    if (patch === undefined) return base;
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch) || base === null || typeof base !== 'object' || Array.isArray(base)) return patch;
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete out[k];
      else out[k] = merge(base[k], v);
    }
    return out;
  }

  return { evaluate, template, compile, check, clean, score, decide, withOverlay, merge, FN, STANCE_VALUES };
})();
if (typeof module !== 'undefined') module.exports = Rules;
