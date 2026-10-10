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

### `profile`: the matchup as data (playbook v2)
Prose tips are read by the player; the **profile** changes what the dashboard decides. Every matchup should have one.

```jsonc
"Darius": {
  "name": "Darius", "difficulty": 3, "summary": "...", /* ...the prose fields above... */
  "profile": {
    // who wins at each stage, from YOUR side: -2 (he wins clearly) ... 0 even ... +2 (you win clearly).
    // short = a quick trade (a combo, then you walk away); extended = a long fight / all-in.
    // Stages: lvl1_3, lvl4_5, post6 (you have your ultimate, no finished item), item1, item2 (your finished items).
    "power": {
      "short":    { "lvl1_3": 0,  "lvl4_5": 0.5, "post6": 0,  "item1": 1, "item2": 1.5 },
      "extended": { "lvl1_3": -1.5, "lvl4_5": -1, "post6": -1.5, "item1": 0, "item2": 1 }
    },
    // what his kit can do to you (flags the rules can read as opp.kit.<flag>)
    "kit": { "pull": true, "dive": "high", "tankyEarly": true, "poke": false, "sustain": "high", "ranged": false },
    // situations where the usual safety advice is wrong. "when" uses the facts below; towerUnsafe: your own
    // tower doesn't protect you (he can pull you out of it or tank it); laneUnsafe: not even standing behind it does.
    "threats": [
      { "id": "pull_out_of_tower",
        "when": "opp.level >= 6 && (lvlD <= -1 || legD <= -1 || itemD <= -700)",
        "towerUnsafe": true,
        "headline": "Darius can pull you out of your tower: stand behind it",
        "why": "His E reaches past the tower's edge and he can tank two shots after 6",
        "do": "Stand behind the tower; last-hit only cannons; recall below half health",
        "voice": "Darius can pull you out of tower. Stand behind it.",
        "note": "Don't stand at the tower's edge while Darius is in lane" }
    ],
    // optional: decisions only against this champion, inserted at the plan anchor (same shape as rules.json modes)
    "rules": [
      { "id": "darius_stacks", "when": "min < 14 && opp.level >= 6 && e < 1", "mode": "safe",
        "headline": "Short trades only vs Darius", "reason": "Long fights let him stack bleed and reset his ultimate",
        "position": "wave", "farm": "safe", "trade": "short", "dont": ["Fighting him after he lands Q"] }
    ]
  }
}
```
Keep `threats` to the 1-3 situations that really change what the player should do, with conditions the facts can
check (levels, items, gold, health, his items or spells). `voice` is spoken once when the threat starts deciding:
under 80 characters. `note` is shown under the decision while the threat holds, also when another rule decides.

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
              "csDown": 15, "csAfter": 300, "lockDeaths": 2, "lockAhead": 150, "lockUntil": 20, "quietSec": 15 } },
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

**Stance (playbook v2)**: a decision also says *how* to play it. Optional; each mode has a default.
- `position`: `forward` · `wave` (with your wave) · `tower` (at your tower) · `behind_tower` · `off_lane` (recall / leave) · `group` · `side`
- `farm`: `all` · `safe` (only minions you can take safely) · `cannons` (cannons and minions next to your tower) · `none` (give the wave up)
- `trade`: `allin` · `short` · `none`
- `do`, `dont`: 0-2 short lines each (templates), shown under the headline.
Defaults: allin forward/all/allin, push forward/all/short, trade wave/all/short, safe wave/safe/none,
retreat tower/safe/none, group group. Say it explicitly whenever the default is wrong for this situation
("Stay under tower" vs a champion who pulls you out of it is wrong: use `behind_tower` + `cannons`).

**Hints** (`rules.json` → `hints`): up to two extra lines shown under the decision, whatever decided it:
`{ "id": "ward_river", "when": "min < 14 && jg && jg.status == 'unknown'", "text": "Ward the river bush before you push" }`.
Personal hints come first, then active matchup threat notes, then the playbook's, then the shared ones.

**Modes** (the dashboard color): `allin` (green, fight now), `push` (violet, shove/take something),
`trade` (blue, trade & farm), `safe` (amber, play safe), `retreat` (red, back off), `group` (teal, objective /
group with the team), `dead`.

**Built-ins** for `use`: `numbers`: when enemies are dead it picks the biggest objective that fits the window
(or says "push towers"); when your team is down numbers it says back off. Returns nothing otherwise.

**Keep these rules, in this order, at the top** (copy them from the Jax example; they are tested safety logic):
`dead`, `numbers`, `opp_dead`, `low_hp`, `lane_jungler_near`, `lane_objective_soon`, `lane_guard`, `objective`,
`late_lock`, then the `plan` anchor. The shared rules `lane_not_safe` and `lane_tower_unsafe` are added before
`lane_guard` automatically: they turn "stay under tower" into "behind your tower, cannons only" or "recall" when the
tower doesn't protect the player (a matchup threat with `towerUnsafe`, or a melee opponent far ahead after 6).
**Personal rules** (learned from this player's games, see the post-game proposal) go before `lane_guard` too;
**matchup rules** (`profile.rules`) go to the `plan` anchor, only against that opponent. Below the anchor put the champion-specific logic: when to all-in, trade,
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
| `e`, `why`, `first`, `reason` | fight score results (modes only). `e` is a long fight / all-in |
| `eShort` | the same fight score for a short trade (modes only): use it for "trade" rules, `e` for "all-in" rules |
| `pw`, `power` | the matchup's power curve at this stage: `pw` (use it in fightScore, see below), `power` `{ stage, short, extended, fromProfile }` |
| `opp.items`, `opp.spells`, `opp.kit` | his item names, his summoner spell names (no cooldowns), his kit flags from the profile (`opp.kit.pull`, ...); `me.items`, `me.spells` too |
| `deathsGame` | your deaths this game `{ total, toOpp, soloToOpp, lastKiller, lastAgo (s), lastSolo }` |
| `myLane`, `tower` | your lane (`top`/`mid`/`bot`); `tower` `{ mine, theirs }`: the first turret still standing in your lane on each side (`outer`/`inner`/`base`/`none`) |
| `towerSafe`, `laneSafe`, `threat`, `threats` | whether your tower protects you now; the deciding matchup threat `{ id, headline, why, do, voice, note }` (or a generic dive check) and the ids of all active threats |
| `plan` | this game's plan (below) or null |

Enemy HP, mana, cooldowns and positions are **not** in the data: don't write rules that need them.

**fightScore in v2**: one term carries the matchup: `{ "id": "matchup", "when": "opp", "add": "pw", "why": "...", "whyWhen": "abs(pw) >= 1" }`.
The app scores twice, once with the profile's `extended` curve (= `e`) and once with `short` (= `eShort`). Without a
profile `pw` is `(3 - difficulty) * 0.5`, as before. Older playbooks are upgraded on load.

---

## Game plan (`out/plan.json`), written by the game-plan and reassess agents

Applied immediately for the current game only. The card shows it; the build and rules change the dashboard.

```jsonc
{
  "headline": "At most 14 words: how THIS game is won from your seat", // required
  "summary": "one sentence, the win condition (game plan only)",
  "bullets": ["2-4 instructions for the next minutes, at most 16 words each"],
  "changes": ["1-2 short items: what changed since the previous plan (reassess only)"],
  "changed": true,   // reassess only: false = same decision, the app keeps the previous headline and bullets
  "build": { "order": ["Remaining legendary items and boots in buy order, exact names"],
             "why": { "Item name": "why, at most 8 words" }, "note": "optional",
             "sell": [{ "item": "Doran's Shield", "when": "when full", "why": "at most 8 words" }] },  // optional, in game
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
everything you'd still buy, boots included if not bought. `build.sell` (in game): items to sell, exact names;
`when` "now" (the dashboard tells the player on their next back) or "when full" (only once the next buy needs the
slot; the dashboard then adds the sell gold to the buy). Extra `rules` are inserted at the `plan` anchor
(or before the rule named in `before`); `{ "id": "x", "disable": "<rule id>" }` switches a rule off for this game.

## Live coach answer (`out/answer.json`), written by the ask agent

The player typed a question in game or champ select. `answer` is shown and read aloud; `plan`, if present, replaces
the game plan at once (the player can undo it); `playbookNote` goes to the post-game review.

```jsonc
{
  "answer": "at most 30 words, what to do now, plain spoken words",   // required
  "bullets": ["0-3 details, at most 16 words each"],
  "plan": { /* optional: a complete game plan in the shape above */ },
  "playbookNote": "optional: lasting feedback for the playbook, one sentence",
  "sources": ["https://..."]
}
```

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

**Matchup profiles**: `"part": "matchups"` with `"patch": { "matchups": { "Darius": { "profile": { "threats": [...] } } } }`
(remember: arrays replace, so send the complete `threats` list).

**Personal rules** (`"part": "personal"`): what this player keeps doing wrong, for every champion they play. Same
shape as rules, with `addRules` / `removeRules` and `addHints` / `removeHints`:
`{ "title": "...", "why": "evidence: games and deaths", "part": "personal", "addRules": [ { "id": "behind_vs_pullers", "when": "min < 14 && opp && opp.kit.pull && lane.label == 'behind'", "mode": "retreat", "headline": "Behind vs a pull: stand behind your tower", "position": "behind_tower", "farm": "cannons", "trade": "none" } ], "addHints": [ { "id": "...", "when": "...", "text": "..." } ] }`
Propose one only when the pattern shows up in several games (the player's history), not from one game. Deaths now
carry `underOwnTower` / `underEnemyTower` (which turret, if it was still standing) and `damageTaken` (who hit them
with which ability, biggest first): that is the evidence for "pulled out of tower" or "dove".
