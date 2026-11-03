# Freeform Attrition Engine (FAE)

**A Deterministic, Single-Pass RPG Architecture for an LLM Game Master**

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
* **Hard Stacking Cap:** The code enforces a strict maximum of **2 Positive Character/Companion Tags** per action ($-1$ Attrition each). An earned `[Advantage]` tag from a prior `stepping_stone` turn stacks on top of this cap for an extra $-1$.
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
3. **Companions as Positive Tags (Subject to the 2-Tag Cap):** Notable companions or hirelings can be recorded as Positive Tags (e.g., `Companion: Brother Marcus (Cleric)` or `Retainer: Torchbearer`). When they actively assist in the declared action, the LLM may select them as 1 of the **max 2 Positive Tags** ($-1$ Attrition). Because the 2-tag ceiling never changes, adding companions never breaks the attrition math.
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

### 2.6 Genre Knobs (System-Level Configuration)

| Knob Name | Values | Mechanical Effect |
| :--- | :--- | :--- |
| **`heroic_tier`** | `true` / `false` | Enables the `heroic_domain` character slot (`Archetype [domains]`), granting supernatural/extraordinary pre-math Leverage and expanding the `Threat 0` ceiling within those domains. |
| **`flee_grace_toggle`** | `true` / `false` | If `true`, declaring a full retreat while a pool is at `0` **cannot trigger lethal overflow**; if the retreat roll incurs $\ge 1$ attrition (which would otherwise overflow), it converts into a permanent Scar or lost gear tag (a `0`-attrition roll escapes cleanly). If `false`, taking attrition while fleeing at `0` triggers normal overflow. |
| **`base_attrition_shift`** | `-1`, `0`, `+1` | Global math modifier added to every roll. `-1` = Pulp/Heroic; `0` = Standard Gritty; `+1` = Brutal Survival. |
| **`overflow_default`** | `lethal` / `scar_and_ko` / `scene_fail` | Fallback consequence when a primary pool takes attrition while already at `0` (if the pool omits its own `on_overflow` key). |

---

## 3. Pool Mechanics: Zero Clamp, Overflow, Recovery, and Passive Drain

### 3.1 The Two-Stage Zero & Overflow Rule

1. **Stage 1: The Zero Clamp (Warning State):**
   * Whenever an action reduces a pool from $> 0$ to $\le 0$, the code **clamps the pool at `0`** (all excess attrition from that blow is discarded).
   * The pool's `zero_debuff` tag is automatically added to the character's active Negative Tags.
   * **Mechanical Penalty at Zero:** While a pool sits at `0`, **Positive Tags cannot be applied to reduce attrition targeting that pool.** The character is running on raw nerves, and their active `zero_debuff` adds $+1$ Attrition to subsequent rolls on that pool.
2. **Stage 2: Overflow (Taking Attrition While Already at `0`):**
   * If a pool starts the turn (or passive drain event) at `0` and suffers $\ge 1$ attrition after calculation, its `on_overflow` rule triggers:
     * **`redirect:<pool_name>`:** Routes the attrition directly into the target pool (e.g., `torch_and_supplies` overflow drains `resolve`, which in turn can overflow into `health`).
     * **`scar_and_ko`:** The character is knocked out, captured, or carried clear of danger. They wake later with `1` point in the pool, lose `1` Max Pool capacity permanently, and gain a permanent Negative Tag (Scar).
     * **`scene_fail`:** The character survives, but is forced out of the scene empty-handed as the objective locks down or escapes.
     * **`lethal`:** Character dies or suffers permanent, campaign-ending madness.

### 3.2 Strict Recovery Tiers

Each pool is assigned a specific `recovery` tier. Recovery events only heal pools at or below their tier:

1. **`scene_breather` ($+2$ points, max once per scene):** Taking a few minutes in a momentarily quiet spot to steady nerves or catch your breath. Only restores pools explicitly marked `recovery: "scene_breather"` (such as `resolve`). Does not clear a `0` state debuff.
2. **`camp_or_sleep` ($+\lfloor\text{Max} / 2\rfloor$ points):** Making camp or sleeping in a secure room. Restores pools marked `camp_or_sleep` (like `health`) as well as `scene_breather` pools. Clears a `0` state debuff only if agreed by genre rules, and frequently triggers a **Passive Drain** on supplies.
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

### 4.1 The Ambition-to-Leverage Rule

* **Bypass / Narrow Intent (Escape, Slip Past, Grab & Run, Delay):** Can achieve **`full` resolution in 1 turn** even against a multi-layer encounter, because the player is leaving the encounter behind rather than dismantling all of its defenses.
* **Total Intent (Eliminate, Rout, or Completely Solve a Multi-Layer Encounter):** Can only achieve **`full` resolution** when the Encounter is down to **`1` remaining Layer** (or when the player triggers a massive environmental silver bullet). Against an Encounter with $2+$ Layers remaining, a Total Intent automatically resolves as a **`stepping_stone`**, stripping away `1 Layer` (`-1 HP` on the Encounter Block) and granting a temporary `[Advantage]` tag for the follow-up turn.

### 4.2 Proportional Leverage Tiers

| Leverage vs. Obstacle State | `progress_scale` Parameter | How the Narrator Translates Intent into Result |
| :--- | :--- | :--- |
| **0. Beneath Notice**<br>*(Outmatched obstacle or mundane task inside `heroic_domain`)* | **No Tool Call (`Threat 0`)** | **Brush-Aside Success.** Do not call `resolve_action()`. Narrate immediate, effortless success with `0` attrition. |
| **1. Matched Leverage**<br>*(Encounter has `1` Layer left, OR player declares a Narrow/Bypass Intent)* | **`"full"`** | **Intent = Result.** The obstacle or declared goal is completely resolved in this single turn (`0/Y HP`). |
| **2. Partial Leverage**<br>*(Total Intent against an Encounter with $2+$ Layers remaining)* | **`"stepping_stone"`** | **Intent Becomes a Setup.** The character strips away `1 Layer` of the obstacle (`-1 HP` on the Encounter block), permanently weakens the threat, and gains a temporary **`[Advantage]`** tag ($-1$ Attrition on the follow-up turn). |
| **3. Mismatched Leverage**<br>*(Tools/tags/companions/heroic domain cannot solve the target as stated)* | **`"pivot"`** *(+$1$ Threat)* | **Task Connects, Intent Pivots.** The action executes, proves why this approach cannot finish the job, costs attrition as the character survives the exchange, and reveals the exact angle or tool required next. |

---

## 5. Native FAE Encounter Blocks & Threat Calibration

### 5.1 Encounter-Level Threat Scale (0 to 4) & $\pm 1$ Guardrails

Before calling `resolve_action()`, the Narrator determines the Threat rating of the **overall encounter** (never rolling separately for individual mooks) and selects the relevant tags. **Critical Rule:** The Narrator must never pre-decide the dice roll or attrition outcome during pre-roll evaluation.

* **Threat 0 (Trivial / Brush-Aside):** Lone nuisance vs. a veteran, routine tasks, or mundane tasks within a character's `heroic_domain`. **No tool call.**
* **Threat 1 (Minor):** Light guards, simple locks, unsettling clues, minor terrain hazards.
* **Threat 2 (Standard):** Competent opposition, goblin boss with an entourage, dangerous occult tomes.
* **Threat 3 (Elite):** Entrenched squads, heavy monsters, mind-fracturing rituals, deadly traps.
* **Threat 4 (Apex):** Lair bosses, overwhelming hordes, direct contact with cosmic entities.
* **Threat 5 (Catastrophic):** Reserved automatically by code when a `"pivot"` occurs against a Threat 4 hazard.

**Strict $\pm 1$ Threat Modifier Rule:** When using a pre-generated Encounter Block, the LLM must use the block's listed `Threat` as its baseline, modifying it by at most $\pm 1$:
* **`-1 Threat`:** The player uses clever positioning, environment, a Companion, or a `heroic_domain` to directly neutralize one of the Encounter's listed `Pressures`.
* **`+1 Threat`:** The player charges recklessly into an active `Pressure` with zero preparation, or forces a `"pivot"`.

### 5.2 Native FAE Encounter Block Format (Cartridge Template)

Cartridges and scene generators represent entire encounters as a single block, repurposing the framework's `X/Y HP` regex slot to track **Leverage Layers**:

```text
Goblin Cliff-Ambush: 2/2 HP | Threat: 2 (Standard) | Pools: Health, Resolve
((PILLS)) Pressures: Crossbow Volleys from the Ledge (Health), Warhammer Boss Blocking the Pass (Health), Mocking War-Chants (Resolve)
Leverage Barriers (2 Layers): [1. High Ground Crossbows] [2. Boss's Heavy Shield Wall]
Full-Finish Triggers: Slip past into the cave (1 Turn), OR break a Barrier first (1/2 HP) to rout the group
Status: Entrenched
```

---

## 6. Genre Skeleton Configurations

### 6.1 Skeleton A: 1920s Cthulhu Investigation (*Caves of Madness* Variant)

```json
{
  "genre": "Cosmic Horror Investigation",
  "knobs": {
    "heroic_tier": false,
    "flee_grace_toggle": true,
    "base_attrition_shift": 0,
    "overflow_default": "scar_and_ko"
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

### 6.2 Skeleton B: Gritty OSR Dungeon Delve (With Party Companion & Heroic Domain)

*(Note: In party play, `resolve` acts as the shared mental/heroic pool. For a pure solo specialist, `resolve` can be renamed to a bespoke pool like `mana` or `daring`.)*

```json
{
  "genre": "Dark Fantasy Dungeon Crawl",
  "knobs": {
    "heroic_tier": true,
    "flee_grace_toggle": false,
    "base_attrition_shift": 0,
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

## 7. Engine Reference Implementation (Python Pseudo-Code)

```python
import random

def roll_4df() -> int:
    """Rolls 4 Fudge dice (-4 to +4, tight bell curve centered on 0)."""
    return sum(random.choice([-1, 0, 1]) for _ in range(4))


def apply_pool_loss(
    state: dict,
    pool_name: str,
    attrition: int,
    is_retreating: bool = False,
    source_label: str = "action",
) -> dict:
    """Applies attrition to a pool, enforcing Zero Clamp, Flee Grace, and Cascading Overflow."""
    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)

    if attrition <= 0:
        return {
            "pool_affected": pool_name,
            "attrition": 0,
            "pool_remaining": pool["current"],
            "status": "UNFAZED",
            "note": f"0 {pool_name} lost.",
        }

    # Case A: Pool was > 0 and drops to <= 0 (Trigger Zero Clamp & Breaking Point Wound)
    if not was_at_zero and (pool["current"] - attrition <= 0):
        pool["current"] = 0
        if pool["zero_debuff"] not in state["character"]["negative_tags"]:
            state["character"]["negative_tags"].append(pool["zero_debuff"])
        return {
            "pool_affected": pool_name,
            "attrition": attrition,
            "pool_remaining": 0,
            "status": "BREAKING_POINT_ZERO",
            "note": (
                f"{pool_name} hits 0 ({source_label})! Clamped at 0. "
                f"Narrate tangible Breaking Point trauma: '{pool['zero_debuff']}'. "
                f"Positive tags are now disabled for {pool_name}; any further loss triggers overflow!"
            ),
        }

    # Case B: Pool was ALREADY at 0 and takes >= 1 attrition (Trigger Overflow)
    if was_at_zero and attrition > 0:
        if is_retreating and state["knobs"].get("flee_grace_toggle", False):
            return {
                "pool_affected": pool_name,
                "attrition": attrition,
                "pool_remaining": 0,
                "status": "GRACE_RETREAT_WITH_SCAR",
                "note": (
                    "Player retreated at 0 pool with Flee Grace active. Escape succeeds! "
                    "Do NOT kill them, but inflict a permanent Scar or sideline a gear/companion tag."
                ),
            }
        return handle_overflow(state, pool_name, attrition)

    # Case C: Standard Attrition (Pool remains > 0 -> Narrate Strain/Near-Misses Only)
    pool["current"] -= attrition
    return {
        "pool_affected": pool_name,
        "attrition": attrition,
        "pool_remaining": pool["current"],
        "status": "STRAIN_ONLY",
        "note": (
            f"Lost {attrition} {pool_name} ({pool['current']}/{pool['max']} left). "
            f"Pool is still > 0: narrate stamina strain, near-misses, or creeping dread ONLY—no crippling wounds."
        ),
    }


def resolve_action(
    state: dict,
    pool_name: str,
    threat: int,
    matched_positive_tags: list[str],
    matched_negative_tags: list[str],
    progress_scale: str = "full",
    is_retreating: bool = False,
    created_advantage_tag: str | None = None,
) -> dict:
    """
    Single-pass resolution for Threat 1-4 actions.
    (Note: Threat 0 actions are resolved directly by the Narrator without calling this tool.)
    """
    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)
    neg_tags = list(matched_negative_tags)

    # 1. Enforce Tag Caps (Max 2 Character/Companion Tags) & Zero-State Rule
    if was_at_zero:
        effective_pos_tags = []  # Positive tags disabled while pool is at 0
        if pool["zero_debuff"] not in neg_tags:
            neg_tags.append(pool["zero_debuff"])
    else:
        effective_pos_tags = list(matched_positive_tags[:2])
        # Stack prior Stepping-Stone [Advantage] on top of the 2-tag limit if present
        if state["character"].get("temp_advantage"):
            effective_pos_tags.append(state["character"]["temp_advantage"])
            state["character"]["temp_advantage"] = None  # Consume advantage

    # 2. Pivot Penalty (+1 Threat when tools/leverage mismatch the target)
    effective_threat = threat + (1 if progress_scale == "pivot" else 0)

    # 3. Calculate Attrition: Threat + 4dF - PosTags + NegTags + GenreShift
    dice_roll = roll_4df()
    raw_cost = (
        effective_threat
        + dice_roll
        - len(effective_pos_tags)
        + len(neg_tags)
        + state["knobs"].get("base_attrition_shift", 0)
    )
    attrition = max(0, raw_cost)

    # 4. Grant New Temporary Advantage on a Stepping-Stone Turn
    if progress_scale == "stepping_stone" and created_advantage_tag:
        state["character"]["temp_advantage"] = created_advantage_tag

    # 5. Apply Pool Loss & Build Narrator Directive
    loss_result = apply_pool_loss(state, pool_name, attrition, is_retreating, "action")

    scale_directives = {
        "full": "Intent is fully achieved; obstacle is resolved (0/Y HP).",
        "stepping_stone": (
            f"Stepping-Stone Victory: Strip 1 Barrier Layer (-1 HP on Encounter) and grant "
            f"Advantage '{created_advantage_tag}' (-1 Attrition on next roll)."
        ),
        "pivot": (
            "Action executes but lacks leverage to finish the target. Reveal what tool/angle "
            "is needed and shift the character into a new position."
        ),
    }

    return {
        "outcome": loss_result["status"],
        "progress_scale": progress_scale,
        "dice": dice_roll,
        "attrition": loss_result["attrition"],
        "pool_remaining": loss_result["pool_remaining"],
        "directive": f"{scale_directives[progress_scale]} {loss_result['note']} Credited tags: {effective_pos_tags}.",
    }


def handle_overflow(state: dict, pool_name: str, overflow_amount: int) -> dict:
    """Handles consequences when a pool already at 0 takes >= 1 attrition."""
    pool = state["pools"][pool_name]
    rule = pool.get("on_overflow") or state["knobs"].get("overflow_default", "scar_and_ko")

    if rule.startswith("redirect:"):
        target_pool = rule.split(":")[1]
        cascade = apply_pool_loss(state, target_pool, overflow_amount, False, f"overflow from {pool_name}")
        return {
            "pool_affected": target_pool,
            "attrition": overflow_amount,
            "pool_remaining": cascade["pool_remaining"],
            "status": f"OVERFLOW_REDIRECT_TO_{target_pool.upper()}_{cascade['status']}",
            "note": f"{pool_name} overflowed by {overflow_amount} into {target_pool}! {cascade['note']}",
        }

    if rule == "scar_and_ko":
        pool["max"] = max(1, pool["max"] - 1)
        pool["current"] = 1
        return {
            "pool_affected": pool_name,
            "attrition": overflow_amount,
            "pool_remaining": 1,
            "status": "OVERFLOW_SCAR_AND_KO",
            "note": (
                f"{pool_name} overflowed! Character is knocked out or extracted, waking later at "
                f"1/{pool['max']} {pool_name} with a new permanent Negative Tag (Scar)."
            ),
        }

    return {
        "pool_affected": pool_name,
        "attrition": overflow_amount,
        "pool_remaining": 0,
        "status": "OVERFLOW_TERMINAL",
        "note": f"CRITICAL OVERFLOW ({rule}): Narrate definitive defeat, madness, or death.",
    }


def trigger_event_or_rest(state: dict, event_type: str) -> list[dict]:
    """
    Processes Passive Drains first, then applies strict-tier Recovery for:
    'scene_breather', 'camp_or_sleep', 'haven_or_specialist', 'day_pass', or 'scene_transition'.
    """
    events_log = []

    # 1. Process Passive Drains matching this trigger
    for p_name, pool in state["pools"].items():
        drain = pool.get("passive_drain")
        if drain and drain["trigger"] == event_type:
            res = apply_pool_loss(state, p_name, drain["amount"], False, f"passive drain ({event_type})")
            events_log.append(res)

    # 2. Process Recoveries matching this tier
    for p_name, pool in state["pools"].items():
        rec_tier = pool["recovery"]
        if event_type == "haven_or_specialist":
            pool["current"] = pool["max"]
            if pool["zero_debuff"] in state["character"]["negative_tags"]:
                state["character"]["negative_tags"].remove(pool["zero_debuff"])
            events_log.append({"pool": p_name, "restored_to": pool["current"], "note": "Full restore & debuff cleared."})
        elif event_type == "camp_or_sleep" and rec_tier in ("camp_or_sleep", "scene_breather"):
            heal = max(1, pool["max"] // 2)
            pool["current"] = min(pool["max"], pool["current"] + heal)
            events_log.append({"pool": p_name, "restored_to": pool["current"], "note": f"Restored +{heal} on camp rest."})
        elif event_type == "scene_breather" and rec_tier == "scene_breather":
            pool["current"] = min(pool["max"], pool["current"] + 2)
            events_log.append({"pool": p_name, "restored_to": pool["current"], "note": "Restored +2 on scene breather."})

    return events_log
```

---

## 8. Example 3-Turn Exchange (User, LLM, and Code)

**Starting State:** 1920s Cthulhu Investigation (`Sanity: 3/8`, `Health: 8/8`, Tags: `["Ex-Military", "Calm [under gunfire and shock]", "Quiet", "Service Revolver"]`).

### Turn 1: Escape from the Crows (Narrow Intent -> Full Resolution)

* **User:** `"I swing my shovel around myself in tight arcs while backing steadily toward the car, refusing to panic."`
* **LLM (Pre-Roll Evaluation & Tool Call):**
  * *Intent Scope:* Escape the flock to reach the car (Narrow/Bypass intent $\rightarrow$ `progress_scale="full"`).
  * *Pool & Threat:* `sanity` at `Threat 2` (unnaturally aggressive flock).
  * *Matched Tags:* `"Calm [under gunfire and shock]"` and `"Ex-Military"` (2 tags).
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat=2,
    matched_positive_tags=["Calm [under gunfire and shock]", "Ex-Military"],
    matched_negative_tags=[],
    progress_scale="full", is_retreating=true
  )
  ```
* **Code Execution:**
  * `roll_4df()` rolls `0`.
  * `raw_cost = 2 (threat) + 0 (dice) - 2 (pos_tags) = 0`.
  * **Returns:** `{"outcome": "UNFAZED", "progress_scale": "full", "dice": 0, "attrition": 0, "pool_remaining": 3, "directive": "Intent is fully achieved; obstacle is resolved (0/Y HP). 0 sanity lost. Credited tags: ['Calm [under gunfire and shock]', 'Ex-Military']."}`
* **LLM Narration:**
  > Old trench discipline takes over before fear can even register. Keeping your breathing slow and deliberate, you sweep the iron spade in practiced, overlapping arcs. Two crows clip the flat of the blade with dull thuds and tumble into the weeds; the rest wheel back, their eerie silence failing to rattle your nerves. You reach the Ford, wrench the door open, and slide behind the wheel without a scratch.
  > `[Sanity: 3/8 | Health: 8/8 — 0 Attrition (Protected by: Calm, Ex-Military)]`

### Turn 2: Searching the Whispering Study (`2/2 HP` Encounter -> Stepping-Stone)

* **Active Encounter Block:** `The Whispering Study: 2/2 HP | Threat: 3 | Pools: Sanity, Time | Barriers: [1. Ciphered Ritual Ledger] [2. Locked Iron Safe]`
* **User:** `"I lock the study door and comb through the ciphered ritual ledger on the desk to uncover the cult's weakness."`
* **LLM (Pre-Roll Evaluation & Tool Call):**
  * *Intent Scope:* Uncover the cult's weakness in a `2/2 HP` Encounter. Because the Encounter has 2 Layers, this resolves as `progress_scale="stepping_stone"` (stripping Layer 1 and creating Advantage `"Decoded Ledger Notes"`).
  * *Pool & Threat:* `sanity` at `Threat 3`.
  * *Matched Tags:* `"Calm [under gunfire and shock]"` (1 tag; `"Ex-Military"` and `"Quiet"` do not help decode occult ciphers).
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat=3,
    matched_positive_tags=["Calm [under gunfire and shock]"],
    matched_negative_tags=[],
    progress_scale="stepping_stone", is_retreating=false,
    created_advantage_tag="Decoded Ledger Notes"
  )
  ```
* **Code Execution:**
  * `roll_4df()` rolls `+2`.
  * `raw_cost = 3 (threat) + 2 (dice) - 1 (pos_tag) = 4`.
  * `Sanity` (`3`) drops by `4` $\rightarrow$ **Clamped at `0`!** Adds `"Manic Dissociation"` to `negative_tags`. Grants `temp_advantage = "Decoded Ledger Notes"`.
  * **Returns:** `{"outcome": "BREAKING_POINT_ZERO", "progress_scale": "stepping_stone", "dice": 2, "attrition": 4, "pool_remaining": 0, "directive": "Stepping-Stone Victory: Strip 1 Barrier Layer (-1 HP on Encounter) and grant Advantage 'Decoded Ledger Notes' (-1 Attrition on next roll). sanity hits 0 (action)! Clamped at 0. Narrate tangible Breaking Point trauma: 'Manic Dissociation'."}`
* **LLM Narration:**
  > You crack the ledger's cipher, discovering the safe's combination hidden inside the margins—and stripping away the first layer of the mystery. Flipping through those pages, however, exposes geometries that refuse to stay still on the vellum. Your composure finally fractures; a cold tremor locks your jaw, and the shadows in the corners of the study seem to detach from the walls and whisper your name. You have the combination in hand, but your mind has reached its breaking point.
  > `[Encounter: 1/2 HP | Gained Advantage: "Decoded Ledger Notes" | Sanity: 0/8 (BREAKING POINT!) | Active Debuff: Manic Dissociation]`

### Turn 3: Retreating at Zero with Flee Grace

* **User:** `"Hearing scratching inside the walls, I don't push my luck with the safe. I stuff the ledger into my coat, smash through the bay window, and sprint for my car!"`
* **LLM (Pre-Roll Evaluation & Tool Call):**
  * *Intent Scope:* Abandon the safe and escape the manor (`is_retreating=true`, `progress_scale="full"`).
  * *Pool & Threat:* `sanity` at `Threat 2`. Even if `"Calm [under gunfire and shock]"` is passed, the code strips positive tags because `sanity == 0`.
  ```json
  TOOL_CALL: resolve_action(
    pool_name="sanity", threat=2,
    matched_positive_tags=["Calm [under gunfire and shock]"],
    matched_negative_tags=["Manic Dissociation"],
    progress_scale="full", is_retreating=true
  )
  ```
* **Code Execution:**
  * `was_at_zero` is `True` (positive tags disabled).
  * `roll_4df()` rolls `-1`.
  * `raw_cost = 2 (threat) - 1 (dice) + 1 (neg_tag) = 2`.
  * `Sanity` is at `0` and took `2` attrition, **but** `is_retreating=True` and `flee_grace_toggle=True`.
  * **Returns:** `{"outcome": "GRACE_RETREAT_WITH_SCAR", "progress_scale": "full", "dice": -1, "attrition": 2, "pool_remaining": 0, "directive": "Intent is fully achieved; obstacle is resolved (0/Y HP). Player retreated at 0 pool with Flee Grace active. Escape succeeds! Do NOT kill them, but inflict a permanent Scar or sideline a gear/companion tag."}`
* **LLM Narration:**
  > As the wallpaper bulges inward with the sound of scrabbling claws, you throw your shoulder through the leaded glass of the bay window. You hit the wet lawn rolling, the ledger clutched tight against your ribs, and scramble into the Ford—losing your **Service Revolver** in the mud as you peel out down the gravel drive. You make it back to the streetlights of Arkham alive and with the ledger, though every shadow makes you flinch.
  > `[Escape Successful via Flee Grace! | Sanity: 0/8 | Lost Tag: "Service Revolver" | Gained Scar: "Nyctophobia (Fear of the Dark)"]`