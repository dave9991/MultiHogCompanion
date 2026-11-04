# Freeform Attrition Engine (FAE)

**A Deterministic, Single-Pass RPG Architecture for an LLM Game Master**

*Architectural Context: FAE is designed to run atop [SillyTavern-MultihogDnDFramework](https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework) via a companion adapter layer (`MultiHogCompanion`). Encounter tracking (`X/Y HP` regex parsing for Leverage Layers), scene boundaries, and post-turn state synchronization (recording newly narrated Scars or lost gear tags) are handled by the framework's cartridge and listener architecture, while the FAE resolver handles single-pass `4dF` attrition math, pool transitions, and dynamic tempo tracking.*

---

## 1. Core Design Philosophy

Traditional tabletop RPGs rely on binary pass/fail rolls that either stall solo stories on a failed check or cause wild narrative whiplash on extreme dice swings. **FAE** replaces pass/fail branching with **guaranteed forward momentum measured by resource attrition**:

1. **Single-Pass Resolution:** The player declares their action, the LLM evaluates the fiction and calls a single code-backed function (`resolve_action`), and the LLM narrates the outcome in the same turn. No mid-turn negotiation or meta-currency haggling.
2. **Encounter-Wide Resolution (No Action Economy):** FAE does not use initiative order, combat turns, or individual creature rolls. Threat describes the **entire encounter or situation as a whole**, resolved in a single roll per player turn.
3. **Attrition Over Failure:** Actions always move the story forward. The dice (`4dF`, ranging from $-4$ to $+4$ on a tight bell curve centered on $0$) only determine how much wear-and-tear the character suffers along the way.
4. **Intent vs. Proportional Result:** The player owns the *Task* and the *Intent*; the LLM Narrator owns the *Scale of Result* based on the character's current fictional leverage and the Encounter's remaining Leverage Layers.
5. **Code-Enforced Safety Net:** Characters cannot die or fail from a single bad roll. Reaching `0` in a resource pool triggers a clear warning state and debuff; only taking further attrition *while already at `0`* triggers a terminal overflow consequence.

---

## 2. Guidelines: Pools, Tags, Companions, Heroic Domains, and Genre Knobs

### 2.1 Picking Resource Pools (The Rule of 2 to 3)

Every game configuration uses **2 or 3 pools**, typically sized between **6 and 12 points**.

* **Why 2–3?** A single pool makes all hazards feel identical, while 4+ pools spread attrition too thin and cause the LLM to hesitate over which pool applies.
* **The Golden Triad:**
  1. **Physical Pool:** `Health`, `Grit`, `Body`
  2. **Mental / Social / Heroic Pool:** `Sanity`, `Resolve`, `Nerve`, `Reputation` *(or a bespoke solo class pool like `Mana` or `Daring` when `heroic_tier` is active).*
  3. **Pacing / Environmental Pool:** `Supplies`, `Torchlight`, `Heat`, `Time` *(Often configured with Passive Drain and set to redirect overflow attrition into Pool 1 or 2).*

### 2.2 Pool Narration Semantics: "Strain ($> 0$) vs. Trauma ($== 0$)"

To prevent the LLM from narrating broken bones or crippling wounds on routine point loss when a character still has plenty of pool capacity left, every pool enforces a **Two-Tier Narration Rule**:

* **Above Zero ($\text{Pool} > 0$ = Strain, Stamina & Near-Misses):** Attrition that leaves a pool above `0` **never** inflicts disabling wounds or madness.
  * *Physical Pools:* Narrate parrying shock, bruised muscles, winded breath, sweat, and narrowly dodging a lethal sweep.
  * *Mental / Heroic Pools:* Narrate creeping dread, cold sweat, arcane exertion, spent focus, or rattled composure.
* **Hitting Zero ($\text{Pool} == 0$ = The Breaking Point Wound):** Clamping at `0` is the exact narrative moment the character's guard breaks and they suffer a tangible injury, burnout, or psychological fracture (their `zero_debuff`).

### 2.3 Character Tags & The Trait Qualification Protocol

Characters begin with **3 to 4 Positive Tags** and **0 to 1 Negative Tag (Scar)**.

* **Ideal Scope:** A balanced tag naturally applies to roughly 25–30% of genre situations (e.g., `Ex-Military`, `Calm [under gunfire and shock]`, `Quiet`, `Occult Scholar`, `Shield-Bearer`, `Trap-Wise`).
* **Gear as Tags:** Signature equipment (`Service Revolver`, `Heavy Shield`, `Crowbar`, `Grappling Hook`) acts as a Positive Tag and can be temporarily lost, depleted, or broken as a narrative consequence.
* **Hard Stacking Cap:** The code enforces a strict maximum of **2 Positive Character/Companion Tags** per action ($-1$ Attrition each). An earned `[Advantage]` tag from a prior `stepping_stone` turn stacks on top of this cap for an extra $-1$ (and is only consumed on a non-retreat action).
* **Negative Tags / Scars:** Active debuffs or permanent scars apply $+1$ Attrition each when relevant to the action.

#### 2.3.1 The Trait Qualification Protocol (Handling Broad or God-Tier Tags)

To keep character creation fluid (especially when importing cards or concepts from other RPGs), the Narrator resolves overly broad tags via **Cooperative Qualification rather than hard rejection**:

1. **Tier A — Auto-Qualify Broad Traits (`Trait [context]`):** When a player proposes an overly broad adjective (`Strong`, `Smart`, `Fast`, `Lucky`, `Tough`), the Narrator does not reject it. Instead, it preserves the player's archetype by attaching a bracketed situational qualifier that narrows its applicability to ~25–30%:
   * *"Strong"* $\rightarrow$ `Strong [for lifting, hauling, or breaching doors]`
   * *"Smart"* $\rightarrow$ `Smart [for ancient ciphers and forensic clues]`
   * *"Fast"* $\rightarrow$ `Fast [for dodging traps and ambushes]`
   * *"Lucky"* $\rightarrow$ `Lucky [for narrowly surviving cave-ins and falls]`
   * *"Tough"* $\rightarrow$ `Tough [against harsh poisons and extreme weather]`
2. **Tier B — Remove Only True Omnipotence (With Clear Replacement):** If a proposed tag claims absolute immunity or breaks the attrition engine entirely (`Invincible`, `Never Misses`, `Immortal`, `Omniscient`), the Narrator politely omits it and proposes a grounded alternative fitting FAE's math:
   * *Example:* "I replaced *Invincible* because FAE relies on situational tags to keep 4dF tension alive—would you prefer `Heavy Plate [against blades and arrows]` or `Iron Will [against pain and panic]`?"

### 2.4 Companions, Hirelings, and Adventuring Parties (Zero-Bookkeeping Model)

FAE is protagonist-centered, but genres like OSR dungeon crawls or squad sci-fi frequently involve companions, retainers, or party members. Rather than tracking separate pools or turns for companions, **companions are folded directly into Leverage and Tags**:

1. **Protagonist-Anchored Pools:** The game still tracks only the protagonist's 2–3 core resource pools (representing the collective stamina, morale, and supplies of the group led by the protagonist).
2. **Companions as Fictional Leverage (Primary Role):** The Narrator evaluates **Proportional Leverage** (Section 4) using the party's *combined* fictional presence.
   * *Scope & Scale:* A lone fighter facing an entrenched goblin ambush may only have `stepping_stone` leverage, whereas a fighter backed by an archer and a mage may have the fictional positioning to achieve `full` resolution or neutralize a listed `Pressure` ($-1$ Threat) when coordinating their action.
   * *Unlocking Angles (Avoiding `pivot`):* If an obstacle requires specialized capability the protagonist lacks (e.g., deciphering an arcane ward or banishing a wraith), directing a relevant companion to handle or assist with the task grants valid Leverage so the action is not forced into a `pivot`.
3. **Companions as Positive Tags (Subject to the 2-Tag Cap & Exempt at Zero):** Notable companions or hirelings are recorded with the `Companion:` or `Retainer:` prefix (e.g., `Companion: Brother Marcus (Cleric)`). When they actively assist, the LLM may select them as 1 of the **max 2 Positive Tags** ($-1$ Attrition). **Crucially, uninjured `Companion:` tags remain usable even when the protagonist's pool is at `0`**—allowing a party member to step in and shield or drag a broken leader out of danger!
4. **Companions as Narrative Buffer (At Breaking Point / Overflow):** When a pool clamps at `0`, triggers `scar_and_ko`, or resolves a `GRACE_RETREAT_WITH_SCAR`, the consequence can manifest narratively on a companion—such as a retainer panicking and fleeing, or a companion taking an injury (`Companion Wounded: Marcus`) that disables their tag until `haven_or_specialist` recovery.

### 2.5 Heroic Domains (Pre-Math Leverage Permissions)

When the **`heroic_tier: true`** Genre Knob is enabled, characters gain a **`heroic_domain`** slot formatted as **`Archetype [specific domains]`**—such as `Wizard [illusions and teleportation]`, `Rogue [masterwork locks and shadow-stealth]`, or `Cleric [radiant wards and undead turning]`.

1. **Pure Pre-Math Leverage (Not a Tag):** Unlike companions or gear, a `heroic_domain` **never** counts as a Positive Tag and **never** applies a $-1$ modifier in `resolve_action()`. Its lanes are strictly separated: **Heroic Domains govern *what is possible* (Leverage); Positive Tags govern *what hurts less* (Attrition Mitigation).** (A Rogue who *also* wants $-1$ attrition on stealth rolls takes a separate Positive Tag like `Shadow-Cloak`).
2. **Three Pre-Math Effects of a Heroic Domain:**
   * **Expands `Threat 0` (Brush-Aside):** Mundane obstacles squarely inside the domain (e.g., a standard iron lock for a `Rogue`, or crossing a 30-foot chasm for a `[teleportation]` Wizard) drop to **Threat 0**—resolved effortlessly without a tool call.
   * **Grants Supernatural / Extraordinary Leverage (Avoids `pivot`):** Actions that would force a `pivot` for a normal human (vanishing in plain sight, misty-stepping behind an entrenched shield wall, banishing a spirit) are treated as valid **`stepping_stone`** or **`full`** actions.
   * **Neutralizes Encounter Pressures ($-1$ Threat):** Using a Heroic Domain to directly counter an Encounter's listed `Pressure` (e.g., casting an illusion to blind `High Ground Crossbows`) qualifies for the standard $-1$ Threat tactical modifier.
3. **Pool Routing for Heroic Exertion (Party vs. Solo):** When a character uses their Heroic Domain against a **Threat 1–4** obstacle, the roll still risks attrition:
   * **Party / Shared-Pool Play:** Route Heroic strain into the shared **`Resolve`** pool (representing collective focus, grit, and nerve, so any class archetype shares the same pool).
   * **Solo Specialist Play:** Configure a bespoke class pool in place of Resolve—such as **`Mana`** (for a solo Wizard), **`Daring`** (for a solo Rogue), or **`Conviction`** (for a solo Paladin).

### 2.6 Genre Knobs & The Pacing Triad

FAE controls campaign feel through system-level Genre Knobs, anchored by the **Pacing Triad**: **Endurance** (Pool Max sizes `6` to `12`), **Intensity** (`base_attrition_shift`), and **Tempo** (`action_tempo` + code-tracked `turns_since_last_test`).

| Knob Name | Values | Mechanical Effect |
| :--- | :--- | :--- |
| **`heroic_tier`** | `true` / `false` | Enables the `heroic_domain` character slot (`Archetype [domains]`), granting supernatural/extraordinary pre-math Leverage and expanding the `Threat 0` ceiling within those domains. |
| **`flee_grace_toggle`** | `true` / `false` | If `true`, declaring a full retreat while a pool is at `0` **cannot trigger lethal overflow**; if the retreat roll incurs $\ge 1$ attrition (which would otherwise overflow), it converts into a permanent Scar or lost gear tag (a `0`-attrition roll escapes cleanly). If `false`, taking attrition while fleeing at `0` triggers normal overflow. |
| **`base_attrition_shift`** | `-1`, `0`, `+1` | **Intensity Dial:** Global math modifier added to every roll. `-1` = Pulp/Heroic; `0` = Standard Gritty; `+1` = Brutal Survival. |
| **`action_tempo`** | `action_serial` / `gritty_default` / `slow_burn` / `slice_of_life` | **Tempo Dial:** Sets the target window of `Threat 0` narrative turns between `Threat 1+` pool tests (`0–2`, `1–4`, `3–7`, or `6–12` turns). Backed by a code counter (`turns_since_last_test`) that injects a soft pacing suggestion when the LLM rolls too frequently or goes too long without friction. |
| **`overflow_default`** | `lethal` / `scar_and_ko` / `scene_fail` | Fallback consequence when a primary pool takes attrition while already at `0` (if the pool omits its own `on_overflow` key). |

---

## 3. Pool Mechanics: Zero Clamp, Overflow, Recovery, and Passive Drain

### 3.1 The Two-Stage Zero & Overflow Rule

1. **Stage 1: The Zero Clamp (Warning State):**
   * Whenever an action reduces a pool from $> 0$ to $\le 0$, the code **clamps the pool at `0`** (all excess attrition from that blow is discarded).
   * The pool's `zero_debuff` tag is automatically added to the character's active Negative Tags.
   * **Mechanical Penalty at Zero:** While a pool sits at `0`, **innate personal Positive Tags cannot be applied to reduce attrition targeting that pool**—only external help (`Companion:` / `Retainer:` tags) and hard-won scene setups (`[Advantage]` from a prior `stepping_stone` turn) remain usable. The character is running on raw nerves, and their active `zero_debuff` adds $+1$ Attrition to subsequent rolls on that pool.
2. **Stage 2: Overflow (Taking Attrition While Already at `0`):**
   * If a pool starts the turn (or passive drain event) at `0` and suffers $\ge 1$ attrition after calculation, its `on_overflow` rule triggers:
     * **`redirect:<pool_name>`:** Routes the attrition directly into the target pool (e.g., `torch_and_supplies` overflow drains `resolve`, which in turn can overflow into `health`).
     * **`scar_and_ko`:** The character is knocked out, captured, or carried clear of danger. They wake later with `1` point in the pool, lose `1` Max Pool capacity permanently, and gain a permanent Negative Tag (Scar) synced by the Companion listener.
     * **`scene_fail`:** The character survives, but is forced out of the scene empty-handed as the objective locks down or escapes.
     * **`lethal`:** Character dies or suffers permanent, campaign-ending madness.

### 3.2 Strict Recovery Tiers

Each pool is assigned a specific `recovery` tier. Recovery events only heal pools at or below their tier:

1. **`scene_breather` ($+2$ points, max once per scene):** Taking a few minutes in a momentarily quiet, secured spot to steady nerves or catch your breath (`breather_available` resets on `scene_transition`). Only restores pools explicitly marked `recovery: "scene_breather"` (such as `resolve`). Does not clear a `0` state debuff.
2. **`camp_or_sleep` ($+\max(1, \lfloor\text{Max} / 2\rfloor)$ points):** Making camp or sleeping in a secure room. Restores pools marked `camp_or_sleep` (like `health`) as well as `scene_breather` pools. Clears a `0` state debuff only if agreed by genre rules, and frequently triggers a **Passive Drain** on supplies.
3. **`haven_or_specialist` (Full Restore + Clear Zero Debuff):** Returning to town, visiting a hospital/cleric, or spending a week in therapy/downtime. Restores **all** pools to `max` and clears all `zero_debuff` tags.

### 3.3 Dual / Passive Drain Rules (Upkeep & Environmental Clocks)

In addition to being challenged directly by player actions (e.g., losing `Supplies` when a pack falls into a river, or losing `Sanity` when reading an occult tome), any pool may optionally include a **`passive_drain`** rule that ticks down automatically on specific time or rest triggers:

* **Trigger Types:**
  * **`camp_or_sleep`:** Consumes resources whenever the player camps to heal other pools (e.g., resting at camp heals `+5 Health`, but automatically drains `-1 torch_and_supplies`).
  * **`day_pass`:** Ticks down every in-game day spent in a hazardous region (e.g., `-1 Sanity` per day spent inside the *Caves of Madness*).
  * **`scene_transition`:** Ticks down every time the player moves to a new room or zone (e.g., `-1 Torchlight` or `-1 Oxygen` per room explored).
* **Passive Drain Mechanics:**
  * Passive drain is deterministic (no `4dF` roll) and **cannot be reduced by Positive Character Tags**.
  * Passive drain **still respects the Zero Clamp and Overflow rules**. If a passive drain drops a pool from `1` to `0`, it clamps at `0` and applies the `zero_debuff`. If the pool is *already* at `0` when the passive trigger fires, it immediately triggers `on_overflow` (meaning trying to camp with `0 Supplies` will cascade overflow damage into `Resolve` or `Health`!).

---

## 4. Core Narrator Law: Intent, Ambition, and Proportional Leverage

When a player declares an action, the LLM Narrator separates **Task** (*what the character physically does*) from **Intent** (*what they hope to accomplish*). Every plausible action moves the fiction forward, calibrated by comparing **Ambition & Leverage** against the **Encounter's Remaining Layers**:

### 4.1 The Ambition-to-Leverage Rule (Bypass vs. Total Intent Tradeoff)

* **Bypass / Narrow Intent (Escape, Slip Past, Grab & Run, Delay):** Can achieve **`full` resolution in 1 turn** even against a multi-layer encounter, because the player is leaving the encounter behind rather than dismantling all of its defenses.
  * **The Narrative Tradeoff:** Bypassing an encounter **leaves the threat active behind you** (blocking safe retreat, preventing `scene_breather` or `camp_or_sleep` in the area) and **forfeits any guarded loot, secondary clues, or room control**.
* **Total Intent (Eliminate, Rout, or Completely Solve a Multi-Layer Encounter):** Permanently clears the threat, secures the room for recovery/camping, and claims whatever the encounter was guarding. However, Total Intent can only achieve **`full` resolution** when the Encounter is down to **`1` remaining Layer** (or when the player triggers a massive environmental silver bullet). Against an Encounter with $2+$ Layers remaining, a Total Intent automatically resolves as a **`stepping_stone`**, stripping away `1 Layer` (`-1 HP` on the cartridge Encounter Block) and granting a temporary `[Advantage]` tag for the follow-up turn.

### 4.2 The Four Pacing Scales (`progress_scale`)

| Leverage vs. Obstacle Scale | `progress_scale` Value | How the Narrator Resolves the Turn |
| :--- | :--- | :--- |
| **0. Trivial / Uncontested (Threat 0)**<br>*(Routine action, safe RP, or obstacle far beneath character/Heroic Domain)* | *(No Tool Call Needed)* | **Brush-Aside Success.** Narrate immediate competence or scene progression with `0` attrition and no tool call. |
| **1. Matched Leverage**<br>*(Bypass Intent, OR Total Intent against an Encounter at `1/Y HP` Layer)* | **`"full"`** | **Intent = Result.** The obstacle or stated goal is completely resolved in this single turn (`Encounter HP` drops to `0`). |
| **2. Partial Leverage**<br>*(Total Intent against an Encounter with `2+ HP` Layers remaining)* | **`"stepping_stone"`** | **Intent Becomes Setup (`-1 Layer`).** The character cannot finish the entire encounter in one move. Narrate a decisive partial victory that strips **1 Leverage Layer** (`-1 HP` on the Encounter Block) and grants a temporary **`[Advantage]`** tag ($-1$ Attrition on the follow-up turn). |
| **3. Zero Leverage**<br>*(Tools/tags/Heroic Domain fundamentally cannot harm or solve the target as stated)* | **`"pivot"`** | **Task Connects, Intent Pivots ($+1$ Threat).** The action executes, proves why this approach cannot work (e.g., lead bullets passing through a spirit), reveals what leverage is actually required, and shifts the character into a new tactical position. |

---

## 5. Encounter Blocks, Rolling Rules, and Progression

### 5.1 Native FAE Encounter Blocks (Cartridge Format)

Rather than tracking individual creature stat blocks, FAE represents an entire combat, hazard, or social obstacle as a single **Encounter Block**. To maintain compatibility with existing framework regex parsers, the **`X/Y HP`** field represents **Remaining Leverage Layers (`1/1` to `3/3`)**:

* **`1/1 HP` (Single-Layer Encounter):** Resolvable in a single `"full"` roll.
* **`2/2 HP` (Two-Layer Encounter):** Requires 1 `"stepping_stone"` turn (dropping it to `1/2 HP` and breaking its active barrier) before a Total Intent can achieve `"full"` resolution.
* **`3/3 HP` (Three-Layer Boss / Complex Infiltration):** Requires 2 `"stepping_stone"` turns before the finishing blow.

**Example Cartridge Blocks:**
```text
Goblin Cliff-Ambush: 2/2 HP | Threat: 2 | Pools: Health, Resolve
((PILLS)) Pressures: Crossbow Volleys (Health), Mocking War-Chants (Resolve)
Instinct: To pin intruders in the canyon bottleneck and wear them down from high ground
Status: Entrenched [Barriers: 1. High Ground Crossbows -> 2. Boss Shield-Wall]
```
```text
The Whispering Study: 2/2 HP | Threat: 3 | Pools: Sanity, Health
((PILLS)) Pressures: Shifting Geometric Diagrams (Sanity), Unseen Claws in the Wainscoting (Health)
Instinct: To fracture the investigator's mind before they can decode the ritual location
Status: Locked & Oppressive [Barriers: 1. Ciphered Cult Ledger -> 2. Warded Wall Safe]
```

**Strict Threat Calibration & Pool Selection Guardrails:**
* **Pool Selection Rule (Pressure Dictates Pool):** When an Encounter lists multiple pools, the Narrator selects `pool_at_risk` based on **which active `Pressure` the character is primarily braving or triggering during that turn** (e.g., braving `Crossbow Volleys` targets `Health`; decoding `Shifting Geometric Diagrams` or exerting a `Heroic Domain` targets `Sanity`/`Resolve`).
* **Pinned Base Threat:** The Encounter's `Threat` rating (`1` to `4`) is the baseline for `resolve_action()`.
* **$\pm 1$ Modification Cap:** The Narrator may only adjust the listed `Threat` by **$-1$** if the player's action directly neutralizes a listed `Pressure` (e.g., diving behind boulders or using an illusion against `Crossbow Volleys`), or **$+1$** if the player acts recklessly into the Encounter's `Instinct`.
* **No Pre-Roll Outcome Prediction:** In its pre-roll reasoning, the LLM must only evaluate Intent, Leverage Layers, Pool, Threat, and Tags—never predicting the dice roll or assuming a Breaking Point before `resolve_action()` returns.

### 5.2 Dynamic Tempo Counter (`turns_since_last_test`)

To prevent LLMs from either rolling on every breath ("Relentless Escalation") or forgetting to roll for 20 turns ("Cozy Drift"), the Companion tracks `turns_since_last_test` in state:

* **Increment & Reset:** Every turn that resolves at **Threat 0** (no `resolve_action` call) increments `turns_since_last_test += 1`. Any call to `resolve_action()` resets `turns_since_last_test = 0`.
* **Tempo Windows (`[min_turns, max_turns]`):**
  * `action_serial`: `0 to 2` turns between tests.
  * `gritty_default`: `1 to 4` turns between tests.
  * `slow_burn`: `3 to 7` turns between tests.
  * `slice_of_life`: `6 to 12` turns between tests.
* **Soft Pacing Prompts (Never Forced):**
  * **When `is_opening_turn == True` (Turn 1 / Adventure Start):** Injects a hard opening setup directive: *"[Pacing Directive (OPENING SCENE SETUP): This is the opening scene setup. Do NOT roll dice or test any resource pools this turn — ignore the RNG queue above, establish the starting situation and immediate stakes, and hand the spotlight to {{user}}.] If the opening scene places the party at or inside an unmapped site (dungeon, ruin, building), call CreateAreaMap once before presenting choices."*
  * **When `turns_since_last_test < min` (and no multi-layer Encounter is active):** Injects a cool-down note: *"Last pool test was {N} turn(s) ago. Favor Threat 0 (no roll) and narrative breathing room unless the player forces immediate danger."*
  * **When `turns_since_last_test >= max`:** Injects an escalation note: *"{N} turns since last pool test. If the player is taking risky or proactive action, resolve it as Threat 1+; if they are in safe conversation/downtime, introduce an external hook or complication they can choose to engage with."*

### 5.3 Function Parameters (`resolve_action`)

When the action is **Threat 1–4** (not Threat 0), the LLM calls `resolve_action()` with:

1. **`progress_scale` (`"full"` | `"stepping_stone"` | `"pivot"`):** Determined via Section 4.
2. **`pool_at_risk` (`string`):** The pool threatened by the active Encounter Pressure.
3. **`threat_level` (`int` 1 to 4):** The Encounter's base Threat (modified by at most $\pm 1$). *(Note: Threat 5 is reserved internally by code when `"pivot"` adds $+1$ to a Threat 4 obstacle).*
4. **`matched_positive_tags` (`array` of max 2 strings):** Up to **2** relevant Positive Character/Companion Tags from the character sheet whose bracketed qualifiers match the action.
5. **`matched_negative_tags` (`array` of strings):** Any active Scars or situational debuffs hindering this action.
6. **`is_retreating` (`boolean`):** `true` if the player's primary intent is escaping the scene.
7. **`grant_advantage_name` (`optional string`):** If `progress_scale == "stepping_stone"`, a short descriptive name for the `[Advantage]` created for the next turn (e.g., `"Grounded Dragon"`, `"Decoded Ledger Notes"`).

### 5.4 Character Progression (Advancement Milestones)

After every **3 to 5 completed scenes** (or upon completing a major scenario arc), the player chooses **one** advancement benefit:
* **Heal Permanent Trauma:** Remove **1 permanent Scar** (Negative Tag) OR restore **+1 lost Max Pool** capacity.
* **Grow Hardened:** Increase any pool's `max` capacity by **+1** (up to a hard ceiling of 12).
* **Acquire Experience:** Add **1 new Positive Tag** (qualified per Section 2.3.1) reflecting a skill, contact, companion, or signature item gained during the adventure.

---

## 6. Genre Skeleton Configurations (JSON)

### Skeleton A: 1920s Cosmic Horror (*Caves of Madness* Variant)
```json
{
  "genre": "Cosmic Horror Investigation",
  "knobs": {
    "heroic_tier": false,
    "flee_grace_toggle": true,
    "base_attrition_shift": 0,
    "action_tempo": "slow_burn",
    "overflow_default": "lethal"
  },
  "character": {
    "name": "Arthur Pendelton",
    "heroic_domain": null,
    "positive_tags": [
      "Ex-Military",
      "Calm [under gunfire and shock]",
      "Quiet",
      "Service Revolver"
    ],
    "negative_tags": [],
    "temp_advantage": null
  },
  "state_flags": {
    "breather_available": true,
    "turns_since_last_test": 0
  },
  "pools": {
    "health": {
      "current": 8,
      "max": 8,
      "recovery": "camp_or_sleep",
      "passive_drain": null,
      "zero_debuff": "Crippled & Bleeding",
      "on_overflow": "scar_and_ko"
    },
    "sanity": {
      "current": 8,
      "max": 8,
      "recovery": "haven_or_specialist",
      "passive_drain": { "trigger": "day_pass", "amount": 1 },
      "zero_debuff": "Manic Dissociation",
      "on_overflow": "lethal"
    }
  }
}
```

### Skeleton B: Gritty OSR Dungeon Delve (Party + Heroic Domain)
*Note: In party play, `resolve` acts as the shared pool for both morale and `heroic_domain` strain. For a pure solo specialist, `resolve` can be renamed to `mana` (Wizard) or `daring` (Rogue).*
```json
{
  "genre": "Dark Fantasy Dungeon Crawl",
  "knobs": {
    "heroic_tier": true,
    "flee_grace_toggle": false,
    "base_attrition_shift": 0,
    "action_tempo": "gritty_default",
    "overflow_default": "lethal"
  },
  "character": {
    "name": "Kaelen the Delver",
    "heroic_domain": "Spellblade [short-range blink and arcane ward-breaking]",
    "positive_tags": [
      "Veteran Mercenary",
      "Heavy Shield",
      "Trap-Wise",
      "Companion: Brother Marcus (Cleric)"
    ],
    "negative_tags": [],
    "temp_advantage": null
  },
  "state_flags": {
    "breather_available": true,
    "turns_since_last_test": 0
  },
  "pools": {
    "health": {
      "current": 10,
      "max": 10,
      "recovery": "camp_or_sleep",
      "passive_drain": null,
      "zero_debuff": "Death's Door",
      "on_overflow": "lethal"
    },
    "resolve": {
      "current": 6,
      "max": 6,
      "recovery": "scene_breather",
      "passive_drain": null,
      "zero_debuff": "Rattled & Hesitant",
      "on_overflow": "redirect:health"
    },
    "torch_and_supplies": {
      "current": 6,
      "max": 6,
      "recovery": "haven_or_specialist",
      "passive_drain": { "trigger": "camp_or_sleep", "amount": 1 },
      "zero_debuff": "Pitch Black & Starving",
      "on_overflow": "redirect:resolve"
    }
  }
}
```

---

## 7. Engine Reference Pseudo-Code

```python
import random

TEMPO_WINDOWS = {
    "action_serial":  {"min": 0, "max": 2},
    "gritty_default": {"min": 1, "max": 4},
    "slow_burn":      {"min": 3, "max": 7},
    "slice_of_life":  {"min": 6, "max": 12},
}


def roll_4df() -> int:
    """Rolls 4 Fudge dice (-4 to +4, tight bell curve centered on 0)."""
    return sum(random.choice([-1, 0, 1]) for _ in range(4))


def is_companion_tag(tag: str) -> bool:
    """Companion/Retainer tags remain usable even when the protagonist's pool is at 0."""
    return tag.startswith(("Companion:", "Retainer:"))


def get_pacing_suggestion(state: dict, active_encounter: bool = False, is_opening_turn: bool = False) -> str:
    """Returns a soft pacing hint based on turns_since_last_test vs. action_tempo."""
    if is_opening_turn or state.get("state_flags", {}).get("is_opening_turn", False):
        return (
            "[Pacing Directive (OPENING SCENE SETUP): This is the opening scene setup. "
            "Do NOT roll dice or test any resource pools this turn — ignore the RNG queue above, "
            "establish the starting situation and immediate stakes, and hand the spotlight to {{user}}.] If the opening scene places the party at or inside an unmapped site (dungeon, ruin, building), call CreateAreaMap once before presenting choices."
        )
    tempo = state["knobs"].get("action_tempo", "gritty_default")
    window = TEMPO_WINDOWS[tempo]
    n = state.get("state_flags", {}).get("turns_since_last_test", 0)

    if not active_encounter and n < window["min"]:
        return (
            f"[Pacing Suggestion ({tempo}): Last pool test was {n} turn(s) ago. "
            f"Favor Threat 0 (no roll) and narrative breathing room unless the player forces immediate danger.]"
        )
    if n >= window["max"]:
        return (
            f"[Pacing Suggestion ({tempo}): {n} turns since last pool test. "
            f"If the player is taking risky or proactive action, resolve it as Threat 1+; "
            f"if in safe conversation/downtime, introduce an external hook or complication they can engage with.]"
        )
    return f"[Pacing Status ({tempo}): On rhythm ({n} turns since last test).]"


def apply_pool_loss(state: dict, pool_name: str, attrition: int, is_retreating: bool = False) -> dict:
    """Applies attrition to a pool, enforcing the Zero Clamp and Overflow cascades."""
    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)

    if attrition <= 0:
        return {
            "pool_event": "NONE",
            "pool_impacted": pool_name,
            "pool_remaining": pool["current"],
            "overflow_note": f"0 {pool_name} lost ({pool['current']}/{pool['max']} remaining; Strain only)."
        }

    # Case A: Pool was > 0 and drops to <= 0 (Trigger Zero Clamp)
    if not was_at_zero and (pool["current"] - attrition <= 0):
        pool["current"] = 0
        if pool["zero_debuff"] not in state["character"]["negative_tags"]:
            state["character"]["negative_tags"].append(pool["zero_debuff"])
        return {
            "pool_event": "BREAKING_POINT_ZERO",
            "pool_impacted": pool_name,
            "pool_remaining": 0,
            "overflow_note": (
                f"BREAKING POINT: {pool_name} clamped at 0! Inflict trauma debuff '{pool['zero_debuff']}'. "
                f"Innate personal tags disabled for {pool_name} (Companions & earned [Advantage] still work); "
                f"further loss triggers {pool.get('on_overflow', state['knobs']['overflow_default'])}."
            )
        }

    # Case B: Pool was ALREADY at 0 and takes >= 1 attrition (Trigger Overflow)
    if was_at_zero and attrition > 0:
        if is_retreating and state["knobs"]["flee_grace_toggle"]:
            return {
                "pool_event": "GRACE_RETREAT_WITH_SCAR",
                "pool_impacted": pool_name,
                "pool_remaining": 0,
                "overflow_note": (
                    "Flee Grace active at 0 pool: Escape succeeds without death, "
                    "but inflict 1 permanent Scar (or wound a Companion) or destroy 1 gear tag."
                )
            }
        return handle_overflow(state, pool_name, attrition)

    # Case C: Standard Attrition (Pool stays > 0 -> Narrate as Strain, NOT Wounds)
    pool["current"] -= attrition
    return {
        "pool_event": "STANDARD_STRAIN",
        "pool_impacted": pool_name,
        "pool_remaining": pool["current"],
        "overflow_note": (
            f"Lost {attrition} {pool_name} ({pool['current']}/{pool['max']} left). "
            f"Pool > 0: narrate as STRAIN/NEAR-MISS/FATIGUE only, NOT a disabling wound."
        )
    }


def resolve_action(
    state: dict,
    pool_name: str,
    threat_level: int,
    matched_positive_tags: list[str],
    matched_negative_tags: list[str],
    progress_scale: str = "full",
    is_retreating: bool = False,
    grant_advantage_name: str | None = None
) -> dict:
    # Reset the dynamic tempo counter whenever a pool test occurs
    state.setdefault("state_flags", {})["turns_since_last_test"] = 0

    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)
    neg_tags = list(matched_negative_tags)

    # 1. Enforce Tag Caps & Zero-State Rule (Companions & earned [Advantage] survive Zero!)
    if was_at_zero:
        effective_pos_tags = [t for t in matched_positive_tags[:2] if is_companion_tag(t)]
        if pool["zero_debuff"] not in neg_tags:
            neg_tags.append(pool["zero_debuff"])
    else:
        effective_pos_tags = list(matched_positive_tags[:2])

    # Consume temporary [Advantage] from a prior stepping_stone turn (unless retreating)
    if state["character"].get("temp_advantage") and not is_retreating:
        effective_pos_tags.append(f"[Advantage: {state['character']['temp_advantage']}]")
        state["character"]["temp_advantage"] = None

    # 2. Calculate Attrition: Threat + 4dF - PosTags + NegTags + GenreShift
    dice_roll = roll_4df()
    effective_threat = min(5, threat_level + (1 if progress_scale == "pivot" else 0))

    raw_cost = (
        effective_threat
        + dice_roll
        - len(effective_pos_tags)
        + len(neg_tags)
        + state["knobs"]["base_attrition_shift"]
    )
    attrition = max(0, raw_cost)

    # 3. Grant new [Advantage] if this turn is a Stepping-Stone
    if progress_scale == "stepping_stone":
        state["character"]["temp_advantage"] = grant_advantage_name or "Tactical Opening"

    # 4. Build Scale Directive for the LLM
    scale_directives = {
        "full": "FULL RESOLUTION: Player's stated Intent is completely achieved (Encounter Layers -> 0).",
        "stepping_stone": (
            f"STEPPING-STONE (-1 Encounter HP Layer): Stripped 1 barrier and granted "
            f"[Advantage: {state['character']['temp_advantage']}] (-1 attrition on next action)."
        ),
        "pivot": (
            "FORCED PIVOT: Current approach lacks leverage to finish the target. "
            "Narrate the action connecting, reveal why it cannot finish the job, and shift position."
        )
    }
    scale_note = scale_directives[progress_scale]

    # 5. Apply Pool Loss
    loss_result = apply_pool_loss(state, pool_name, attrition, is_retreating)
    return {
        "outcome": loss_result["pool_event"],
        "progress_scale": progress_scale,
        "dice": dice_roll,
        "attrition": attrition,
        "pool_impacted": loss_result["pool_impacted"],
        "pool_remaining": loss_result["pool_remaining"],
        "directive": f"{scale_note} | {loss_result['overflow_note']} | Credited tags: {effective_pos_tags}."
    }


def trigger_event_or_rest(state: dict, event_type: str) -> list[dict]:
    """
    Handles recovery ('scene_breather', 'camp_or_sleep', 'haven_or_specialist')
    and passive drains ('camp_or_sleep', 'day_pass', 'scene_transition').
    """
    events_log = []
    flags = state.setdefault("state_flags", {"breather_available": True, "turns_since_last_test": 0})

    if event_type == "scene_transition":
        flags["breather_available"] = True

    if event_type == "scene_breather":
        if not flags.get("breather_available", True):
            return [{"event": "BREATHER_DENIED", "note": "A scene_breather has already been used in this scene."}]
        flags["breather_available"] = False

    # 1. Process Recoveries first
    for p_name, pool in state["pools"].items():
        rec = pool["recovery"]
        if event_type == "haven_or_specialist":
            pool["current"] = pool["max"]
            if pool["zero_debuff"] in state["character"]["negative_tags"]:
                state["character"]["negative_tags"].remove(pool["zero_debuff"])
            events_log.append({"pool": p_name, "event": "FULL_RESTORE", "remaining": pool["current"]})
        elif event_type == "camp_or_sleep" and rec in ("camp_or_sleep", "scene_breather"):
            heal = max(1, pool["max"] // 2)
            pool["current"] = min(pool["max"], pool["current"] + heal)
            events_log.append({"pool": p_name, "event": f"HEALED_{heal}", "remaining": pool["current"]})
        elif event_type == "scene_breather" and rec == "scene_breather":
            pool["current"] = min(pool["max"], pool["current"] + 2)
            events_log.append({"pool": p_name, "event": "HEALED_2", "remaining": pool["current"]})

    # 2. Process Passive Drains matching this event_type
    for p_name, pool in state["pools"].items():
        drain_cfg = pool.get("passive_drain")
        if drain_cfg and drain_cfg["trigger"] == event_type:
            drain_res = apply_pool_loss(state, p_name, drain_cfg["amount"], is_retreating=False)
            events_log.append({
                "pool": p_name,
                "event": f"PASSIVE_DRAIN ({event_type})",
                "details": drain_res["overflow_note"]
            })

    return events_log


def handle_overflow(state: dict, pool_name: str, attrition: int) -> dict:
    pool = state["pools"][pool_name]
    rule = pool.get("on_overflow", state["knobs"]["overflow_default"])

    if rule.startswith("redirect:"):
        target_pool = rule.split(":")[1]
        redirect_res = apply_pool_loss(state, target_pool, attrition, is_retreating=False)
        return {
            "pool_event": f"OVERFLOW_REDIRECT_TO_{target_pool.upper()}",
            "pool_impacted": target_pool,
            "pool_remaining": redirect_res["pool_remaining"],
            "overflow_note": f"{pool_name} was at 0 and overflowed {attrition} into {target_pool}! {redirect_res['overflow_note']}"
        }

    if rule == "scar_and_ko":
        pool["max"] = max(1, pool["max"] - 1)
        pool["current"] = 1
        return {
            "pool_event": "OVERFLOW_SCAR_AND_KO",
            "pool_impacted": pool_name,
            "pool_remaining": 1,
            "overflow_note": (
                f"OVERFLOW (SCAR & KO): {pool_name} overflowed! Character is knocked out/captured, "
                f"loses 1 Max {pool_name} (now {pool['max']}), wakes later at 1, and gains a permanent Scar."
            )
        }

    if rule == "scene_fail":
        return {
            "pool_event": "OVERFLOW_SCENE_FAIL",
            "pool_impacted": pool_name,
            "pool_remaining": 0,
            "overflow_note": f"OVERFLOW (SCENE FAIL): {pool_name} overflowed! Action fails and character is forced out."
        }

    return {
        "pool_event": "OVERFLOW_LETHAL",
        "pool_impacted": pool_name,
        "pool_remaining": 0,
        "overflow_note": f"TERMINAL OVERFLOW (LETHAL): {pool_name} took damage while at 0. Narrate character death or permanent madness."
    }
```

---

## 8. Example 3-Turn Exchange (User, LLM, and Code)

**Starting State:** Skeleton A: Cthulhu Investigation (`Sanity: 3/8`, `Health: 8/8`, Tags: `["Ex-Military", "Calm [under gunfire and shock]", "Quiet", "Service Revolver"]`).

---

### Turn 1: Escape from the Crows (Bypass Intent = `"full"` Resolution)
* **Active Encounter Block:** `The Murder of Crows: 1/1 HP | Threat: 2 | Pools: Sanity, Health`
* **User:** `"I swing my shovel around myself in tight arcs while backing steadily toward the car, refusing to panic."`
* **LLM Pre-Roll Evaluation:** Bypass/Escape intent against a `1/1 HP` encounter $\rightarrow$ `progress_scale="full"`. Active Pressure is unnatural swarming dread (`sanity`, `threat_level=2`). Matches `"Calm [under gunfire and shock]"` and `"Ex-Military"` (2 tags).
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat_level=2,
    matched_positive_tags=["Calm [under gunfire and shock]", "Ex-Military"],
    matched_negative_tags=[],
    progress_scale="full", is_retreating=true
  )
  ```
* **Code Execution:**
  * `roll_4df()` rolls `0`.
  * `raw_cost = 2 (threat) + 0 (dice) - 2 (pos_tags) + 0 (neg_tags) = 0`.
  * **Returns to LLM:** `{"outcome": "NONE", "progress_scale": "full", "dice": 0, "attrition": 0, "pool_impacted": "sanity", "pool_remaining": 3, "directive": "FULL RESOLUTION: Player's stated Intent is completely achieved (Encounter Layers -> 0). | 0 sanity lost (3/8 remaining; Strain only). | Credited tags: ['Calm [under gunfire and shock]', 'Ex-Military']."}`
* **LLM Response to User:**
  > Old trench discipline takes over before fear can even register. Keeping your breathing slow and deliberate, you sweep the iron spade in practiced, overlapping arcs. Two crows clip the flat of the blade with dull thuds and tumble into the weeds; the rest wheel back, their eerie, synchronized silence failing to rattle your nerves. You reach the Ford, wrench the door open, and slide behind the wheel without a scratch.
  > `[Sanity: 3/8 | Health: 8/8 — 0 Attrition (Protected by: Calm, Ex-Military) | Encounter Resolved]`

---

### Turn 2: The Cultist's Study (Multi-Layer Total Intent = `"stepping_stone"` & Zero Clamp)
* **Active Encounter Block:** `The Whispering Study: 2/2 HP | Threat: 3 | Pools: Sanity, Health | Barriers: [1. Ciphered Cult Ledger -> 2. Warded Wall Safe]`
* **User:** `"I lock the study door, decode the ciphered ledger on the desk, and crack open the hidden wall safe to grab the ritual artifacts."`
* **LLM Pre-Roll Evaluation:** Total Intent (wants both the ledger AND the warded safe in one turn) against a `2/2 HP` encounter. By Section 4.1, this resolves as `progress_scale="stepping_stone"`, stripping Layer 1 (`Ciphered Cult Ledger`) and granting `[Advantage: Decoded Safe Combination]`. Active Pressure is `Shifting Geometric Diagrams` (`sanity`, `threat_level=3`). Checking tags: `"Calm [under gunfire and shock]"`, `"Ex-Military"`, and `"Quiet"` do not apply to decoding an occult cipher (`matched_positive_tags=[]`). *(Note: LLM does not pre-judge the dice outcome).*
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat_level=3,
    matched_positive_tags=[],
    matched_negative_tags=[],
    progress_scale="stepping_stone", is_retreating=false,
    grant_advantage_name="Decoded Safe Combination"
  )
  ```
* **Code Execution:**
  * `roll_4df()` rolls `+1`.
  * `raw_cost = 3 (threat) + 1 (dice) - 0 (pos_tag) = 4`.
  * `Sanity` was `3`. `3 - 4 = -1` $\rightarrow$ **Triggers Zero Clamp!** `Sanity` clamps at `0`. Adds `"Manic Dissociation"` to negative tags. Grants `[Advantage: Decoded Safe Combination]`.
  * **Returns to LLM:** `{"outcome": "BREAKING_POINT_ZERO", "progress_scale": "stepping_stone", "dice": 1, "attrition": 4, "pool_impacted": "sanity", "pool_remaining": 0, "directive": "STEPPING-STONE (-1 Encounter HP Layer): Stripped 1 barrier and granted [Advantage: Decoded Safe Combination] (-1 attrition on next action). | BREAKING POINT: sanity clamped at 0! Inflict trauma debuff 'Manic Dissociation'. Innate personal tags disabled for sanity (Companions & earned [Advantage] still work); further loss triggers lethal."}`
* **LLM Response to User:**
  > You break the ledger's cipher—revealing both the midnight ritual site at Blackwood Mill and the dial sequence for the iron safe behind the portrait. Yet forcing your eyes to track the ledger's shifting, non-Euclidean diagrams fractures your composure. A cold tremor locks your jaw, and the shadows in the corners of the study seem to detach from the walls and whisper your name. You have the combination in hand and stand right in front of the safe (`1/2 HP` left on the study), but your mind is on a razor's edge.
  > `[Sanity: 0/8 (BREAKING POINT!) | Active Debuff: Manic Dissociation | Gained Setup: [Advantage: Decoded Safe Combination] | Study Layers: 1/2 HP]`

---

### Turn 3: The Grace Retreat (Using Earned `[Advantage]` & Flee Toggle at `0`)
* **User:** `"Hearing claws scrabbling inside the wainscoting, I don't dare open the warded safe. I stuff the decoded ledger notes into my coat, smash through the bay window, and sprint for my car!"`
* **LLM Pre-Roll Evaluation:** Player pivots to a Bypass/Escape intent while `sanity` is at `0`. Threat is `2`. Innate personal tags are disabled at `0`, but their earned `[Advantage: Decoded Safe Combination]` is preserved if they retreat (or they can simply flee). `is_retreating` is `true`.
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat_level=2,
    matched_positive_tags=["Calm [under gunfire and shock]"],
    matched_negative_tags=["Manic Dissociation"],
    progress_scale="full", is_retreating=true
  )
  ```
* **Code Execution:**
  * `was_at_zero` is `True`. Innate personal tag `"Calm [under gunfire and shock]"` is stripped (`effective_pos_tags = []`).
  * `roll_4df()` rolls `-1`.
  * `raw_cost = 2 (threat) - 1 (dice) - 0 (pos) + 1 (neg_tag) = 2`.
  * Pool is at `0` and took `2` attrition, **but** `is_retreating == True` and `flee_grace_toggle == True`.
  * **Returns to LLM:** `{"outcome": "GRACE_RETREAT_WITH_SCAR", "progress_scale": "full", "dice": -1, "attrition": 2, "pool_impacted": "sanity", "pool_remaining": 0, "directive": "FULL RESOLUTION: Player's stated Intent is completely achieved (Encounter Layers -> 0). | Flee Grace active at 0 pool: Escape succeeds without death, but inflict 1 permanent Scar (or wound a Companion) or destroy 1 gear tag."}`
* **LLM Response to User:**
  > As the wainscoting bulges inward with the sound of a hundred chittering claws, you abandon the wall safe and hurl your shoulder through the leaded glass of the bay window. You hit the wet lawn rolling, the decoded ledger clutched tight against your ribs, and scramble into the Ford—dropping your **Service Revolver** in the mud as you peel out down the gravel drive. You make it back to the streetlights of Arkham alive with the Blackwood Mill lead, though every dark alley in your rearview mirror makes you flinch.
  > `[Escape Successful via Flee Grace! | Sanity: 0/8 | Lost Gear Tag: "Service Revolver" | Gained Permanent Scar: "Nyctophobia (Fear of the Dark)"]`