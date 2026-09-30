# Jax Coach playbook format

A **playbook** is everything Jax Coach knows about playing one champion in one role (top lane for now). It is
four JSON files. The app reads them; research agents write them. Everything is data: no code.

| File | What it holds | Used for |
|---|---|---|
| `meta.json` | build, runes, spells, skill order, items with "build when" tags, abilities, power spikes | champ select loadout, the Build tab, "build next" in game |
| `phases.json` | the plan per game phase, trading, waves, split push, teamfight, advice per trigger | game plan cards, voice briefings |
| `matchups.json` | notes per lane opponent: difficulty, win rate, phase tips, threats, kill windows | matchup cards, the fight score |
| `rules.json` | the in-game decisions: a fight score and an ordered list of rules | the colored play mode, its text and voice line |

The complete example is the Jax playbook (`example-Jax/` in your reference folder). **Copy its shape exactly.**
Keys the app doesn't know are ignored, and missing optional keys are fine. Write valid JSON (UTF-8, double quotes,
no comments, no trailing commas).

General rules for all text:
- Write for a player in the middle of a game: short, concrete, imperative. "Trade when his Q is down" beats
  "It may be advisable to consider trading windows".
- Use real item, rune and champion names exactly as the game (Data Dragon) spells them, e.g. "Sunfire Aegis",
  "Plated Steelcaps", "Grasp of the Undying", "Dr. Mundo".
- Never suggest tracking enemy summoner spell or ultimate cooldowns with timers. Say "after he used his ultimate",
  never "his Flash is down for 4:30".
- Never look up, name or guess anything about the enemy *players* (names, ranks, profiles). Only champions.

---

## meta.json

```jsonc
{
  "champion": "Malphite",            // Data Dragon id (e.g. "DrMundo", "MonkeyKing")
  "role": "top",
  "patch": "26.19",                  // the patch this data is for
  "lastUpdated": "2026-09-30",
  "sources": [ { "name": "...", "url": "https://...", "usedFor": "..." } ],
  "overview": { "tier": "...", "winRate": 51.2, "pickRate": 4.1, "banRate": 3.0, "rankFilter": "Emerald+ ...",
                "playstyle": "2-4 sentences: how this champion wins games from top lane." },
  "seasonNotes": [ "recent changes that matter for this champion" ],
  "abilities": [ { "key": "P|Q|W|E|R", "name": "...", "summary": "...", "tips": ["..."] } ],
  "combos": [ { "name": "...", "input": "E > Q > AA", "when": "..." } ],
  "runes": [                          // first page = the default. Include a page for ranged/poke lanes if it differs.
    { "id": "standard", "name": "...", "when": "...",
      "primary": { "tree": "Resolve", "keystone": "Grasp of the Undying", "runes": ["Demolish", "Second Wind", "Overgrowth"] },
      "secondary": { "tree": "Inspiration", "runes": ["Magical Footwear", "Cosmic Insight"] },
      "shards": ["...", "...", "..."], "winRate": null, "pickRate": null }
  ],
  "summoners": [ { "spells": ["Flash", "Teleport"], "when": "..." } ],   // first = default
  "skillOrder": { "first3": ["Q", "E", "W"], "max": ["Q", "E", "W"], "notes": "..." },
  "startingItems": [ { "items": ["Doran's Shield", "Health Potion"], "when": "..." } ],   // [0] default, [1] vs ranged
  "coreBuild": {
    "firstItemOptions": [ { "item": "Sunfire Aegis", "when": "...", "winRate": null } ],
    "typicalOrder": ["Sunfire Aegis", "Plated Steelcaps", "Thornmail", "..."],   // full legendary order incl. boots
    "boots": [ { "item": "Plated Steelcaps", "when": "..." }, { "item": "Mercury's Treads", "when": "..." } ],
    "firstBackBuys": [ { "gold": 900, "buy": "Bami's Cinder - why" } ]
  },
  "items": [                          // 12-25 items: core + situational, each with tags that say when to build it
    { "name": "Thornmail", "role": "core|damage|defensive|antiheal|situational",
      "buildWhen": ["vs_healing", "vs_heavy_ad"], "why": "one sentence" }
  ],
  "powerSpikes": [ { "when": "Level 6", "what": "..." } ]
}
```

`buildWhen` tags the app understands (only these):
`vs_heavy_ap` (60%+ enemy magic damage), `vs_heavy_ad` (70%+ physical), `vs_healing`, `vs_tanks` (2+ tanks),
`vs_armor_stacking`, `vs_cc_heavy` (3+ hard CC), `vs_squishies`, `vs_burst`, `vs_poke`, `vs_crit_ad`,
`ahead`, `behind`, `early_game`, `splitpush` (14:00+), `teamfight` (20:00+), `late_game` (28:00+).
An item is suggested for the current game when one of its `vs_*` tags is active.

## phases.json

```jsonc
{
  "champion": "Malphite", "role": "top", "patch": "26.19", "lastUpdated": "2026-09-30", "sources": [ ... ],
  "phases": [   // exactly these six ids, in this order
    { "id": "lvl1_3", "label": "Levels 1-3", "timeHint": "0:00-~4:00",
      "goals": [..], "do": [..], "dont": [..], "ifAhead": [..], "ifEven": [..], "ifBehind": [..] },
    { "id": "lvl4_5", ... }, { "id": "lvl6_first_item", ... }, { "id": "first_item_to_14", ... },
    { "id": "midgame", ... }, { "id": "lategame", ... }
  ],
  "trading": [..], "waveManagement": [..],
  "splitPush": { "when": [..], "rules": [..], "tpUsage": [..] },
  "teamfight": { "role": "...", "rules": [..], "targetPriority": [..] },
  "objectives": [..], "mechanics": [..],
  "recallTimings": [ { "gold": 1100, "buy": "...", "note": "..." } ],
  "commonMistakes": [..],
  "triggers": { "<trigger id>": ["1-2 short tips shown when it happens"] }
}
```
The first entry of `goals`, `ifAhead`, `ifBehind` is also spoken aloud: keep those under 150 characters.
Trigger ids: `enemy_laner_dead, you_died_to_gank, you_died_solo, opp_level_lead, you_level_lead,
you_hit_level_2_first, you_hit_6, first_item_done, second_item_done, three_items_done, you_are_fed, you_are_behind,
enemy_laner_fed, enemy_team_numbers_down, your_team_numbers_down, baron_up_soon, dragon_up_soon, grubs_soon,
herald_soon, enemy_jungler_ganked_top_repeatedly, long_death_timers, enemy_has_heavy_healing, enemy_heavy_ap,
enemy_heavy_ad, enemy_many_tanks, enemy_heavy_cc, turret_lost, enemy_turret_taken, dragon_soul_point` (a team is on
3 drakes and the next dragon is up or within 90 s), `elder_dragon` (Elder up or within 90 s). Triggers without a tip
in the playbook use the defaults in `reference/shared.json` → `triggers`.

## matchups.json

```jsonc
{
  "champion": "Malphite", "role": "top",
  "_notes": { "note": "where the win rates come from", "sources": ["..."] },
  "matchups": {
    "Darius": {                       // key = Data Dragon id of the OPPONENT
      "name": "Darius",
      "difficulty": 3,                // 1 very easy ... 5 very hard, from YOUR champion's point of view
      "winRate": 51.3,                // YOUR champion's win rate in this matchup (null if unknown)
      "winRateSource": "site, rank filter, patch, sample size",
      "summary": "2-3 sentences",
      "runes": "...", "summoners": "Flash + ...", "start": "Doran's Shield + Health Potion",
      "buildNotes": "item order for this matchup (name items exactly)", "skillNotes": "...",
      "phases": { "lvl1_3": [..], "lvl4_5": [..], "post6": [..], "midgame": [..], "lategame": [..] },
      "threats": [..], "killWindows": [..], "avoid": [..],
      "sources": ["https://..."]
    }
  }
}
```
`difficulty` feeds the fight score (`matchup.difficulty` below), so be honest about it.

## rules.json: the in-game decisions

Every two seconds the app computes facts about the game (below), then:
1. **fightScore**: sums the `add` of every term whose `when` holds. The total is `e`: how good a fight with your
   lane opponent is right now (roughly: +2 clearly winning, 0 even, -2 clearly losing). Terms that share a `group`
   are exclusive: the first matching one in the group counts. `why` texts of matching terms become `why` /
   `first` / `reason` (the top three joined).
2. **modes**: checks the rules top to bottom. The first rule whose `when` holds sets the play mode, a headline, a
   reason and optionally a voice line.

```jsonc
{
  "champion": "Malphite", "role": "top", "version": 1, "lastUpdated": "...",
  "notes": "why the rules look like this (for humans)",
  "text": { "level6": "Level 6: Unstoppable Force online", "motivation": ["short pre-game lines", "..."] },
  "params": { "guard": { "enabled": true, "until": 14, "levelDownAfter": 90, "goldDown": 500, "goldAfter": 150,
              "csDown": 15, "csAfter": 300, "lockDeaths": 2, "lockUntil": 20, "quietSec": 15 } },
  "fightScore": [
    { "id": "ult_up", "group": "level", "when": "opp && me.level >= 6 && opp.level < 6", "add": 2, "why": "you have R, {oppName} doesn't" },
    { "id": "item_gold", "when": "opp", "add": "clamp(itemD / 900, -2, 2)", "why": "...", "whyWhen": "abs(itemD) >= 700" },
    { "id": "jungler_near", "when": "jg && jg.status == 'near'", "add": -2, "why": "{jg.name} showed top side", "first": true }
  ],
  "modes": [
    { "id": "dead", "when": "me.dead", "mode": "dead", "headline": "Dead: plan your next move", "reason": "{buyNow}" },
    { "id": "numbers", "when": "min >= 8", "use": "numbers" },
    { "id": "plan", "anchor": true },
    { "id": "lane_allin", "when": "min < 14 && e >= 2", "mode": "allin", "headline": "All-in on {oppName}", "reason": "{reason}", "voice": "All in window. {first}." }
  ]
}
```

Rule fields: `id` (unique), `when` (expression; omitted = always), `mode`, `headline`, `reason`, `voice`
(optional, spoken once per new `voiceKey`), `voiceKey` (optional; default = the mode), `note` (for humans),
`use` (hand the decision to a built-in), `anchor` (a named insertion point, no decision).

**Modes** (the dashboard color): `allin` (green, fight now), `push` (violet, shove/take something),
`trade` (blue, trade & farm), `safe` (amber, play safe), `retreat` (red, back off), `group` (teal, objective /
group with the team), `dead`.

**Built-ins** for `use`: `numbers`: when enemies are dead it picks the biggest objective that fits the window
(or says "push towers"); when your team is down numbers it says back off. Returns nothing otherwise.

**Keep these rules, in this order, at the top** (copy them from the Jax example; they are tested safety logic):
`dead`, `numbers`, `opp_dead`, `low_hp`, `lane_jungler_near`, `lane_objective_soon`, `lane_guard`, `objective`,
`late_lock`, then the `plan` anchor. Below the anchor put the champion-specific logic: when to all-in, trade,
play safe in lane; what to do after laning (split, group, peel, dive, farm, scale). The last rule should have no
`when` (a fallback).

**Shared rules**: `soul_point` and `elder_dragon` (in `reference/shared.json` → `rules`) are added to every
playbook before `objective`. The app announces soul point and Elder itself with an alert tone, so these rules have
no voice. To change them for one champion, add a rule with the same id to rules.json.

**Voice lines**: the app already talks a lot. Give `voice` only to rules that mean a real change of plan, keep it
under 90 characters, and use `voiceKey`s that don't change every second (a key per decision, not per tick).

### Expressions
A JavaScript subset: numbers, `'strings'`, `true false null`, paths like `me.level`, `opp.name`,
`tags.vs_tanks`; operators `! - * / % + < <= > >= == != && || ??`, `cond ? a : b`, parentheses; and only these
functions: `abs min max round floor ceil clamp(v,a,b) clock(sec) has(list,x) count(list) join(list,sep) upper
lower cap num(n) plural(n,one,many) pct(x) signed(x)`. A missing value is `undefined` (never an error), so
`opp && opp.level` is safe. `+` joins strings.

**Templates** (`headline`, `reason`, `voice`, `voiceKey`, `mode`, `why`): text with `{expression}` parts.
A template that is exactly one `{...}` returns the value itself (so `"voice": "{jg.withMe ? null : 'Careful.'}"`
can be null = silent).

### Facts a rule can read
| Name | Meaning |
|---|---|
| `t`, `min`, `clock` | game time in seconds, minutes, "12:34" |
| `phase` | `lvl1_3`, `lvl4_5`, `lvl6_first_item`, `first_item_to_14`, `midgame`, `lategame` |
| `me` | `{ champ, name, level, dead, respawn, kills, deaths, assists, cs, legendaries, itemGold, fed, class, ranged, damage ('AD'/'AP'), magic (0-1, share of their damage that is magic, from champion and items), hp (0-1), mana (0-1), gold }` |
| `opp` | your lane opponent, same fields without hp/mana/gold (or null) · `oppName` |
| `lvlD`, `legD`, `itemD`, `csD` | you minus opponent: levels, finished legendary items, item gold, CS |
| `matchup` | `{ difficulty, winRate }` from matchups.json |
| `lane` | `{ label: 'ahead'/'even'/'behind', very, est, reasons }` |
| `team` | `{ goldDiff, kills, ekills, towers, etowers }` (goldDiff = item gold, yours minus theirs) |
| `eDead`, `aDead`, `adv` | dead enemies, dead allies, eDead - aDead |
| `jg` | enemy jungler `{ status: 'near'/'far'/'dead'/'clearing'/'unknown', name, ago, side, withMe, safeFor, key }` or null · `jgNote` |
| `soon` | the objective that matters now `{ key: 'dragon'/'voidgrubs'/'riftHerald'/'baron', label, in, status: 'upcoming'/'up', next, stakes: 'soul'/'elder'/null }` or null |
| `drakes` | `{ ours, theirs, point: 'ours'/'theirs'/'both'/null (a team on 3 drakes = soul point), soul: 'ours'/'theirs'/null }` |
| `bigDragon` | the soul-point dragon or the Elder Dragon when it's up or spawns within 90 s: `{ label, stakes: 'soul'/'elder', point, status, in, next }`, else null |
| `guard` | the fight guard (a level down / gold down / CS down / farm-only lock) `{ kind: 'level'/'gold'/'cs'/'lock', strict, headline, reason, voice, voiceKey }` or null |
| `recall` | `{ stay, text }` · `buyNow` (text) · `hpReason` (hp < 50%) |
| `fed` | fed enemies other than your opponent: `{ count, names, verb ('is'/'are'), key }` |
| `tags` | active tags as booleans, e.g. `tags.vs_healing`, `tags.ahead` (list under meta.json) |
| `comp` | enemy team `{ apShare, tanks, healers, cc, burst, poke }` (counts). `apShare` is live: each enemy's usual damage, moved by the items they actually buy, weighted by their gold |
| `e`, `why`, `first`, `reason` | fight score results (modes only) |
| `plan` | this game's plan (below) or null |

Enemy HP, mana, cooldowns and positions are **not** in the data: don't write rules that need them.

---

## Game plan (`out/plan.json`), written by the game-plan and reassess agents

Applied immediately for the current game only. The card shows it; the build and rules change the dashboard.

```jsonc
{
  "headline": "At most 14 words: how THIS game is won from your seat", // required
  "summary": "one sentence, the win condition (game plan only)",
  "bullets": ["2-4 instructions for the next minutes, at most 16 words each"],
  "changes": ["1-2 short items: what changed since the previous plan (reassess only)"],
  "build": { "order": ["Remaining legendary items and boots in buy order, exact names"],
             "why": { "Item name": "why, at most 8 words" }, "note": "optional" },
  "runes": "rune page for this game (champ select only)", "summoners": "Flash + ...",
  "params": { "guard": { "goldDown": 700 } },        // optional: overrides rules.params for this game
  "rules": [                                          // optional: extra decisions for this game (see rules above)
    { "id": "stay_grouped", "when": "min >= 20 && !soon && team.goldDiff < 0", "mode": "group",
      "headline": "Stay with your team", "reason": "Your team wins 5v5 fights; don't split alone", "before": "duel_careful" }
  ],
  "phaseNotes": { "midgame": ["plan lines for this game, shown in the phase card"] },
  "sources": ["https://..."]
}
```
`build.order` replaces the whole remaining build (items you already own are skipped automatically), so list
everything you'd still buy, boots included if not bought. Extra `rules` are inserted at the `plan` anchor
(or before the rule named in `before`); `{ "id": "x", "disable": "<rule id>" }` switches a rule off for this game.

## Post-game proposal (`out/proposal.json`), written by the review agent

Nothing is applied until the player clicks Apply on a change.

```jsonc
{
  "summary": "at most 2 sentences: what the playbook got right and wrong in this game",
  "lessons": ["1-3 items, at most 20 words: what the player takes into the next game (not playbook changes)"],
  "changes": [
    { "title": "short name", "why": "evidence from this game (and the player's history)", "part": "rules",
      "addRules": [ { ...rule, "before": "rule id" } ], "replaceRules": [ { ...rule } ], "removeRules": ["id"],
      "patch": { "params": { "guard": { "csDown": 12 } } } },
    { "title": "...", "why": "...", "part": "matchups",
      "patch": { "matchups": { "Darius": { "difficulty": 4, "summary": "..." } } } },
    { "title": "...", "why": "...", "part": "meta", "patch": { "coreBuild": { "typicalOrder": ["..."] } } }
  ]
}
```
`patch` is merged into that file: objects merge, arrays and values replace, `null` deletes a key.
