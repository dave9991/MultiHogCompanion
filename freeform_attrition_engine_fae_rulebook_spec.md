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

## 2. Guidelines: Pools, Tags, and Genre Knobs

### 2.1 Picking Resource Pools (The Rule of 2 to 3)

Every game configuration uses **2 or 3 pools**, typically sized between **6 and 12 points**.

* **Why 2–3?** A single pool makes all hazards feel identical, while 4+ pools spread attrition too thin and cause the LLM to hesitate over which pool applies.
* **The Golden Triad:**
  1. **Physical Pool:** `Health`, `Grit`, `Body`
  2. **Mental / Social Pool:** `Sanity`, `Resolve`, `Nerve`, `Reputation`
  3. **Pacing / Environmental Pool:** `Supplies`, `Torchlight`, `Heat`, `Time` *(Often configured with Passive Drain and set to redirect overflow attrition into Pool 1 or 2).*

### 2.2 Pool Narration Semantics: "Strain ($> 0$) vs. Trauma ($== 0$)"

To prevent the LLM from narrating broken bones or crippling wounds on routine point loss when a character still has plenty of pool capacity left, every pool enforces a **Two-Tier Narration Rule**:

* **Above Zero ($\text{Pool} > 0$ = Strain, Stamina & Near-Misses):** Attrition that leaves a pool above `0` **never** inflicts disabling wounds or madness.
  * *Physical Pools:* Narrate parrying shock, bruised muscles, winded breath, sweat, and narrowly dodging a lethal sweep.
  * *Mental Pools:* Narrate creeping dread, cold sweat, sensory static, or rattled composure.
* **Hitting Zero ($\text{Pool} == 0$ = The Breaking Point Wound):** Clamping at `0` is the exact narrative moment the character's guard breaks and they suffer a tangible injury or psychological fracture (their `zero_debuff`).

### 2.3 Character Tags (Freeform Descriptors)

Characters begin with **3 to 4 Positive Tags** and **0 to 1 Negative Tag (Scar)**.

* **Scope:** A good tag should apply to roughly 25–30% of situations in the genre (e.g., `Ex-Military`, `Calm`, `Quiet`, `Occult Scholar`, `Shield-Bearer`, `Trap-Wise`).
* **No "God Tags":** Universal adjectives that apply to almost any roll (`Lucky`, `Smart`, `Competent`, `Fast`, `Heroic`) are forbidden.
* **Gear as Tags:** Signature equipment (`Service Revolver`, `Heavy Shield`, `Crowbar`, `Grappling Hook`) acts as a Positive Tag and can be temporarily lost, depleted, or broken as a narrative consequence.
* **Hard Stacking Cap:** The code enforces a strict maximum of **2 Positive Tags** per action ($-1$ Attrition each).
* **Negative Tags / Scars:** Active debuffs or permanent scars apply $+1$ Attrition each when relevant to the action.

### 2.4 Genre Knobs (System-Level Configuration)

| Knob Name | Values | Mechanical Effect |
| :--- | :--- | :--- |
| **`flee_grace_toggle`** | `true` / `false` | If `true`, declaring a full retreat while a pool is at `0` **cannot trigger lethal overflow**; any rolled attrition converts into a permanent Scar or lost gear tag. If `false`, fleeing through hazards at `0` can trigger death/overflow. |
| **`base_attrition_shift`** | `-1`, `0`, `+1` | `-1` = Pulp / Action (breezy). `0` = Standard Gritty. `+1` = Brutal Survival / Horror. |
| **`overflow_default`** | `lethal` / `scar_and_ko` / `scene_fail` | Defines the default consequence when a primary pool takes attrition while already at `0`. |

---

## 3. Pool, Zero-State, Recovery, Passive Drain, and Advancement Rules

### 3.1 The Two-Stage Zero & Overflow Rule

1. **Stage 1: Hitting `0` (The Breaking Point Clamp):**
   * When a pool drops from $> 0$ to $\le 0$, the code **clamps the pool at `0`**, discarding excess damage from that blow.
   * The pool's **`zero_debuff`** tag is automatically added to the character's active Negative Tags, and the LLM narrates the character's first true wound or breakdown.
   * **Zero-State Penalty:** While a pool is at `0`, **Positive Tags cannot be used to reduce attrition targeting that pool** (the character is operating on raw nerves/fumes).
2. **Stage 2: Taking Attrition at `0` (Overflow Trigger):**
   * If a pool is **already at `0`** at the start of the turn (or prior to a passive drain tick) and takes $\ge 1$ attrition, the pool's `on_overflow` rule executes:
     * **`redirect:<pool_name>`:** Routes the attrition directly into another specified pool (e.g., `Torchlight` overflow drains `Resolve`).
     * **`scar_and_ko`:** The character is knocked out, captured, or forced out of the scene, wakes up later at `1` point, loses `1` Max Pool point permanently, and gains a permanent Negative Tag (Scar).
     * **`scene_fail`:** The character survives, but the objective is lost—they are forced to retreat empty-handed.
     * **`lethal`:** The character dies or goes irredeemably mad. The LLM narrates a fitting finale.

### 3.2 Recovery Tiers

Each pool specifies how it can be restored:

* **`scene_breather` ($+2$ points):** Catching your breath, bandaging wounds, or having a stiff drink in a safe spot (max once per scene). Cannot clear a `0` debuff.
* **`camp_or_sleep` ($+\text{Half Max}$):** A full night's rest in a secure location. Clears `zero_debuff` if designated by the pool, **but triggers any `on_camp_rest` passive drains** (such as consuming rations or burning down a day in a cursed zone).
* **`haven_or_specialist` ($\text{Full Restore}$):** Returning to town, visiting a hospital/cleric, or spending downtime in therapy. Clears all `zero_debuff` conditions without triggering wilderness upkeep.

### 3.3 Dual / Passive Drain (Optional Upkeep & Environmental Clocks)

In addition to losing points when directly challenged by an action roll, any pool can be configured with an optional **`passive_drain`** rule that ticks down automatically on specific narrative triggers:

* **Common Passive Drain Triggers:**
  * **`on_camp_rest` (Resource Upkeep):** Whenever the player executes a `camp_or_sleep` recovery to heal `Health`, `Supplies` automatically drains by $-1$ (consuming food/firewood).
  * **`on_day_pass` (Environmental Aura / "Caves of Madness"):** Every day spent inside a cursed zone, haunted expedition, or radiation zone automatically drains `Sanity` (or `Health`) by $-1$, regardless of player tags.
  * **`on_scene_transition` (Torchlight / Oxygen Clock):** Moving to a new room or delve depth automatically drains `Torchlight` or `Oxygen` by $-1$, turning exploration into a tense pacing clock.
* **Interaction with Zero & Overflow:** Passive drain is **unmitigated by character tags**. It **does** obey the **Zero Clamp** (hitting `0` warns you first), and if a pool is *already* at `0` when passive drain ticks, it triggers `on_overflow` (e.g., starving at `0 Supplies` during a rest redirects damage into `Resolve` or `Health`).

### 3.4 Character Advancement

Every **3 to 5 completed scenes** (or at the conclusion of a major chapter/delve), the player chooses one milestone reward:

1. **Heal a Scar:** Permanently remove 1 Negative Tag (Scar) or restore $+1$ lost Max Pool capacity.
2. **New Capability:** Acquire 1 new Positive Tag (or signature gear tag) earned through the fiction.
3. **Hardened Reserve:** Increase any Pool's Max capacity by $+1$ (up to a hard ceiling of 12).

---

## 4. Core Narrator Law: Intent, Scope & Proportional Leverage

To prevent players from one-shotting major encounters (*"I kill all the goblins"*) while avoiding tactical combat bloat, the LLM Narrator governs all actions using **Proportional Leverage** and **Intent Scoping**.

```
[Player Input: Task + Declared Intent] 
       │
       ▼
[Pre-Check: Is Encounter Threat == 0 (Trivial / Beneath Competence)?]
       ├─► YES ──► Threat 0: Do NOT call resolve_action(). Narrate effortless brush-aside.
       │
       └─► NO (Threat 1–4) ──► [Compare Intent Scope & Leverage vs. Encounter Layers (X/Y HP)]
                                  │
                                  ├─► Narrow/Bypass Intent OR 1/Y Layer Left ──► "full" (Resolves in 1 Turn)
                                  ├─► Total Intent vs. 2+/Y Layers Left ───────► "stepping_stone" (-1 Layer + Setup)
                                  └─► Wrong Tools / Zero Leverage ─────────────► "pivot" (+1 Threat, reveals angle)
```

### 4.1 Ambition Governs Leverage (Intent Scoping)

The Narrator evaluates the **scope of the player's declared Intent** against the Encounter's current **Leverage Layers (`X/Y HP`)**:

1. **Narrow / Bypass Intent (Escape, Delay, Slip Past, Grab Clue):** Can achieve **`full` resolution** in 1 turn even if an Encounter has multiple layers remaining (e.g., diving through an archway to escape a goblin ambush leaves the encounter behind in a single roll).
2. **Total Intent (Eliminate / Rout / Completely Solve Encounter):** Only achieves **`full` resolution** when the Encounter has **`1` layer remaining (`1/Y HP`)** or when the player triggers a massive environmental silver bullet. If the Encounter has **`2+` layers remaining (`2/2 HP` or `3/3 HP`)**, a Total Intent automatically resolves as **`stepping_stone`**: the player's action succeeds at stripping `1` layer off the encounter (`2/2 -> 1/2 HP`) and crossing off one of its defenses.

### 4.2 Native FAE Encounter Blocks (Cartridge Format)

In cartridge-backed play, an entire encounter (whether a single boss, a mob with a leader, or a hazardous room) is represented as a single **FAE Encounter Block**. The `X/Y HP` slot tracks **Leverage Layers** rather than individual creature hit points:

#### Example 1: Combat Group Encounter
```text
Goblin Cliff-Ambush: 2/2 HP | Threat: 2 (Standard) | Pools: Health, Resolve
((PILLS)) Pressures: Crossbow Volleys from the Ledge (Health), Warhammer Boss Blocking the Pass (Health), Mocking War-Chants (Resolve)
Leverage Barriers (2 Layers): [1. High Ground Crossbows] [2. Boss's Heavy Shield Wall]
Full-Finish Triggers: Slip past into the cave (1 Turn), OR break a Barrier first to rout the group
Status: Entrenched
```

#### Example 2: Investigation / Horror Encounter
```text
The Whispering Study: 2/2 HP | Threat: 3 (Elite) | Pools: Sanity, Time
((PILLS)) Pressures: Shifting Geometric Diagrams (Sanity), Scratching Inside the Walls (Sanity), Approaching Cultist Patrol (Time)
Leverage Barriers (2 Layers): [1. Ciphered Ritual Ledger] [2. Locked Iron Safe]
Full-Finish Triggers: Grab the ledger and run (1 Turn), OR crack both layers to uncover the ritual's true weakness
Status: Unsearched
```

### 4.3 Encounter Threat Scale (0 to 4) & Strict $\pm 1$ Modifiers

* **Threat 0 (Trivial / Outmatched):** Lone mook or routine task beneath the character's competence. **No tool call, no dice roll, 0 attrition.**
* **Threat 1 (Minor):** Light hazards, simple locks, uncoordinated rabble (`1/1 HP`).
* **Threat 2 (Standard / Veteran):** Capable foes, armed patrols, eerie occult tomes (`1/1` or `2/2 HP`).
* **Threat 3 (Elite / Heavy):** Crushing opposition, entrenched groups, deadly traps (`2/2` or `3/3 HP`).
* **Threat 4 (Apex / Catastrophic):** Overwhelming monsters, mind-shattering entities (`3/3 HP`).

**Guardrail on Threat Modifiers:** The Encounter Block's `Threat` is the locked baseline. The Narrator may only adjust it by $\pm 1$ under two conditions:
* **`+1 Threat`:** The player charges directly into an active `Pressure` with zero preparation, OR attempts a `pivot` action with the wrong tools.
* **`-1 Threat` (Min 1):** The player uses a clever environmental interaction that directly neutralizes one of the listed `Pressures`.

---

## 5. Rolling & Function Parameters

### 5.1 Primary Action Tool: `resolve_action()`

When the encounter is **Threat 1–4**, the LLM evaluates the player's action and calls `resolve_action()` with:

* **`pool_name` (`string`):** The specific pool placed at risk (`"health"`, `"sanity"`, `"resolve"`, `"torch_and_supplies"`).
* **`threat_level` (`integer` 1 to 4):** The Encounter's base Threat ($\pm 1$ if modified by a Pressure interaction). *(Note: Threat 0 is resolved in narration without calling this tool).*
* **`progress_scale` (`"full"` | `"stepping_stone"` | `"pivot"`):**
  * `"full"`: Completes the player's Intent and reduces Encounter Layers to `0/Y HP` (or bypasses the encounter).
  * `"stepping_stone"`: Strips `1` Layer from the Encounter (`X/Y -> X-1/Y HP`), crosses off a `Leverage Barrier`, and grants a temporary `[Advantage]` tag ($-1$ Attrition on the next turn).
  * `"pivot"`: Action connects at $+1$ Threat, proves why current leverage cannot finish the target, and reveals the required angle.
* **`matched_positive_tags` (`array` of strings, max 2):** Up to 2 character tags (plus any active temporary `[Advantage]` tag from a prior stepping-stone turn).
* **`matched_negative_tags` (`array` of strings):** Any active Scars or situational debuffs hindering the action.
* **`is_retreating` (`boolean`):** `true` if the player's primary intent is fleeing/exiting the danger zone.

### 5.2 Time, Rest & Upkeep Tool: `trigger_event_or_rest()`

When the player rests, transitions to a new major delve area, or spends a day in an environmental hazard zone, the LLM invokes `trigger_event_or_rest(event_type)` with:

* **`event_type` (`"scene_breather"` | `"camp_or_sleep"` | `"haven_or_specialist"` | `"day_pass"` | `"scene_transition"`):** Automatically processes both **pool recovery** and any matching **`passive_drain`** rules.

---

## 6. Genre Skeleton Configurations

### 6.1 Skeleton A: 1920s Cthulhu Investigation ("Caves of Madness" Variant)

```json
{
  "genre": "Cosmic Horror Investigation",
  "knobs": {
    "flee_grace_toggle": true,
    "base_attrition_shift": 0,
    "overflow_default": "scar_and_ko"
  },
  "character": {
    "name": "Arthur Pendelton",
    "positive_tags": ["Ex-Military", "Calm", "Quiet", "Service Revolver"],
    "negative_tags": [],
    "temp_advantage": null
  },
  "pools": {
    "health": {
      "current": 8,
      "max": 8,
      "recovery": "camp_or_sleep",
      "passive_drain": null,
      "strain_flavor": "bruised ribs, winded breath, and grazing blows",
      "zero_debuff": "Crippled & Bleeding",
      "on_overflow": "scar_and_ko"
    },
    "sanity": {
      "current": 8,
      "max": 8,
      "recovery": "haven_or_specialist",
      "passive_drain": {
        "trigger": "day_pass",
        "amount": 1,
        "reason": "The oppressive psychic resonance of the Caves of Madness erodes your mind each day."
      },
      "strain_flavor": "creeping dread, cold sweat, and sensory static",
      "zero_debuff": "Manic Dissociation",
      "on_overflow": "lethal"
    }
  }
}
```

### 6.2 Skeleton B: Gritty OSR Dungeon Delve

```json
{
  "genre": "Dark Fantasy Dungeon Crawl",
  "knobs": {
    "flee_grace_toggle": false,
    "base_attrition_shift": 0,
    "overflow_default": "lethal"
  },
  "character": {
    "name": "Kaelen the Delver",
    "positive_tags": ["Veteran Mercenary", "Heavy Shield", "Trap-Wise", "Iron Stomach"],
    "negative_tags": [],
    "temp_advantage": null
  },
  "pools": {
    "health": {
      "current": 10,
      "max": 10,
      "recovery": "camp_or_sleep",
      "passive_drain": null,
      "strain_flavor": "parrying shock, aching muscles, and dented armor",
      "zero_debuff": "Death's Door",
      "on_overflow": "lethal"
    },
    "resolve": {
      "current": 6,
      "max": 6,
      "recovery": "scene_breather",
      "passive_drain": null,
      "strain_flavor": "frayed nerves, hesitation, and pounding heart",
      "zero_debuff": "Rattled & Hesitant",
      "on_overflow": "redirect:health"
    },
    "torch_and_supplies": {
      "current": 6,
      "max": 6,
      "recovery": "haven_or_specialist",
      "passive_drain": {
        "trigger": "camp_or_sleep",
        "amount": 1,
        "reason": "Making camp consumes rations, water, and lantern oil."
      },
      "strain_flavor": "dwindling rations and flickering torchlight",
      "zero_debuff": "Pitch Black & Starving",
      "on_overflow": "redirect:resolve"
    }
  }
}
```

---

## 7. Complete Engine Pseudo-Code

```python
import random

def roll_4df() -> int:
    """Rolls 4 Fudge dice (-1, 0, +1 each). Range: -4 to +4, tight bell curve on 0."""
    return sum(random.choice([-1, 0, 1]) for _ in range(4))


def apply_pool_loss(state: dict, pool_name: str, amount: int, source_note: str = "") -> dict:
    """Shared helper for applying either active roll attrition or passive upkeep drain."""
    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)

    if amount <= 0:
        return {"outcome": "NO_LOSS", "pool": pool_name, "remaining": pool["current"], "note": source_note}

    # Case A: Pool > 0 drops to <= 0 -> Clamp at 0 & Apply Trauma / Zero Debuff
    if not was_at_zero and (pool["current"] - amount <= 0):
        pool["current"] = 0
        if pool["zero_debuff"] not in state["character"]["negative_tags"]:
            state["character"]["negative_tags"].append(pool["zero_debuff"])
        return {
            "outcome": "BREAKING_POINT_CLAMP",
            "pool": pool_name,
            "attrition": amount,
            "remaining": 0,
            "directive": (
                f"{source_note} TRAUMA / BREAKING POINT: {pool_name} drops to 0 and clamps! "
                f"Narrate an actual wound or breakdown ('{pool['zero_debuff']}'). "
                f"Positive tags are now disabled for {pool_name} and any further loss triggers '{pool['on_overflow']}'."
            )
        }

    # Case B: Pool was ALREADY at 0 -> Trigger Overflow
    if was_at_zero:
        return handle_overflow(state, pool_name, amount, source_note)

    # Case C: Standard reduction (stays > 0 -> Narrate as STRAIN, never disabling wounds)
    pool["current"] -= amount
    strain_hint = pool.get("strain_flavor", "minor strain and near-misses")
    return {
        "outcome": "POOL_STRAIN",
        "pool": pool_name,
        "attrition": amount,
        "remaining": pool["current"],
        "directive": (
            f"{source_note} -{amount} {pool_name} ({pool['current']}/{pool['max']} remaining). "
            f"STRAIN ONLY (Pool > 0): Narrate as {strain_hint}—do NOT narrate disabling wounds."
        )
    }


def handle_overflow(state: dict, pool_name: str, attrition: int, source_note: str = "") -> dict:
    """Executes terminal or redirect rules when a pool at 0 takes additional attrition."""
    pool = state["pools"][pool_name]
    rule = pool["on_overflow"]

    # 1. Cascading Redirect (e.g., Supplies -> Resolve -> Health)
    if rule.startswith("redirect:"):
        target_pool = rule.split(":")[1]
        redirect_note = f"{source_note} [{pool_name} at 0 -> Overflow redirected to {target_pool}!] "
        return apply_pool_loss(state, target_pool, attrition, redirect_note)

    # 2. Scar and Knock Out
    if rule == "scar_and_ko":
        pool["max"] = max(1, pool["max"] - 1)
        pool["current"] = 1
        return {
            "outcome": "OVERFLOW_SCAR_AND_KO",
            "attrition": attrition,
            "pool_remaining": 1,
            "directive": (
                f"{source_note} CRITICAL OVERFLOW on {pool_name}! Character is knocked out or forced from the scene. "
                f"They wake up later in a safe/new location at 1 {pool_name} (Max reduced to {pool['max']}). "
                f"Assign 1 permanent Negative Tag (Scar) reflecting this trauma."
            )
        }

    # 3. Scene Failure (Non-lethal ejection)
    if rule == "scene_fail":
        return {
            "outcome": "OVERFLOW_SCENE_FAIL",
            "attrition": attrition,
            "pool_remaining": 0,
            "directive": (
                f"{source_note} CRITICAL OVERFLOW on {pool_name}! The character survives, but their objective fails. "
                f"Narrate a forced retreat or loss of the scene's prize."
            )
        }

    # 4. Lethal / Game Over
    return {
        "outcome": "OVERFLOW_LETHAL",
        "attrition": attrition,
        "pool_remaining": 0,
        "directive": (
            f"{source_note} TERMINAL OVERFLOW on {pool_name}! The character succumbs to death or permanent madness. "
            f"Narrate a dramatic, fitting conclusion to their story."
        )
    }


def trigger_event_or_rest(state: dict, event_type: str) -> dict:
    """Handles recovery tiers AND passive drain triggers (e.g., 'camp_or_sleep', 'day_pass')."""
    logs = []

    # 1. Process Passive Drains First (e.g., eating rations at camp, or losing Sanity each day)
    for p_name, pool in state["pools"].items():
        drain = pool.get("passive_drain")
        if drain and drain["trigger"] == event_type:
            res = apply_pool_loss(state, p_name, drain["amount"], source_note=f"[PASSIVE DRAIN: {drain['reason']}]")
            logs.append(res["directive"])

    # 2. Process Recoveries (if event_type is a rest tier)
    for p_name, pool in state["pools"].items():
        if event_type == "scene_breather" and pool["recovery"] == "scene_breather":
            if pool["current"] > 0:  # Scene breather cannot clear a 0-state debuff
                healed = min(pool["max"] - pool["current"], 2)
                pool["current"] += healed
                logs.append(f"Recovered +{healed} {p_name} ({pool['current']}/{pool['max']}).")

        elif event_type == "camp_or_sleep" and pool["recovery"] in ["scene_breather", "camp_or_sleep"]:
            healed = max(1, pool["max"] // 2)
            pool["current"] = min(pool["max"], pool["current"] + healed)
            if pool["zero_debuff"] in state["character"]["negative_tags"]:
                state["character"]["negative_tags"].remove(pool["zero_debuff"])
            logs.append(f"Camp rest restored {p_name} to {pool['current']}/{pool['max']} and cleared '{pool['zero_debuff']}'.")

        elif event_type == "haven_or_specialist":
            pool["current"] = pool["max"]
            if pool["zero_debuff"] in state["character"]["negative_tags"]:
                state["character"]["negative_tags"].remove(pool["zero_debuff"])
            logs.append(f"Haven recovery fully restored {p_name} ({pool['max']}/{pool['max']}).")

    return {"event": event_type, "summary": " | ".join(logs)}


def resolve_action(
    state: dict,
    pool_name: str,
    threat_level: int,
    progress_scale: str,
    matched_positive_tags: list[str],
    matched_negative_tags: list[str],
    is_retreating: bool = False
) -> dict:
    """Core single-pass resolution function called by the LLM GM for Threat 1-4 Encounters."""

    pool = state["pools"][pool_name]
    was_at_zero = (pool["current"] == 0)

    # 1. Enforce Tag Caps & Zero-State Rule
    if was_at_zero:
        effective_pos_tags = []  # Positive tags disabled when pool is at 0
        if pool["zero_debuff"] not in matched_negative_tags:
            matched_negative_tags.append(pool["zero_debuff"])
    else:
        effective_pos_tags = matched_positive_tags[:2]  # Hard cap at 2 character tags
        if state["character"].get("temp_advantage"):
            effective_pos_tags.append(state["character"]["temp_advantage"])
            state["character"]["temp_advantage"] = None

    # 2. Calculate Attrition: Threat + 4dF - PosTags + NegTags + GenreShift
    dice_roll = roll_4df()
    effective_threat = min(5, max(1, threat_level + (1 if progress_scale == "pivot" else 0)))

    raw_cost = (
        effective_threat
        + dice_roll
        - len(effective_pos_tags)
        + len(matched_negative_tags)
        + state["knobs"]["base_attrition_shift"]
    )
    attrition = max(0, raw_cost)

    # 3. Build Proportional Scale Directive (Updates Cartridge Layers)
    scale_directives = {
        "full": "FULL RESOLUTION: Grant the player's complete Intent and reduce Encounter HP/Layers to 0.",
        "stepping_stone": (
            "STEPPING-STONE PROGRESS: Reduce Encounter HP/Layers by 1, cross off one Leverage Barrier, "
            "and grant a temporary '[Advantage]' tag for the next turn."
        ),
        "pivot": (
            "FORCED PIVOT: Current leverage cannot finish this target. The action connects, proves why "
            "this approach won't work, and reveals the required leverage while keeping the scene moving."
        )
    }
    scale_note = scale_directives.get(progress_scale, scale_directives["full"])

    # 4. Handle Zero-Cost or Grace Retreat before standard pool loss
    if attrition == 0:
        return {
            "outcome": "UNFAZED_PROGRESS",
            "dice": dice_roll,
            "attrition": 0,
            "pool_remaining": pool["current"],
            "directive": f"{scale_note} Cost: 0 {pool_name}. Highlight protection from {effective_pos_tags}."
        }

    if was_at_zero and is_retreating and state["knobs"]["flee_grace_toggle"]:
        return {
            "outcome": "GRACE_RETREAT_WITH_SCAR",
            "dice": dice_roll,
            "attrition": attrition,
            "pool_remaining": 0,
            "directive": (
                "Player retreated at 0 pool with Flee Grace active. Escape succeeds! "
                "Do NOT trigger lethal overflow; instead, destroy a gear tag or inflict a permanent Scar."
            )
        }

    # 5. Apply Pool Loss (Strain vs. Trauma), Zero Clamp, or Overflow
    loss_result = apply_pool_loss(state, pool_name, attrition, source_note=scale_note)
    loss_result["dice"] = dice_roll
    return loss_result
```

---

## 8. Example 3-Turn Exchange (User, LLM, Cartridge & Code)

**Starting State:** Skeleton A — Cthulhu Investigation (`Sanity: 3/8`, `Health: 8/8`, Tags: `["Ex-Military", "Calm", "Quiet", "Service Revolver"]`).
**Active Encounter Block:** `The Whispering Study: 2/2 HP | Threat: 3 (Elite) | Pools: Sanity, Time`

### Turn 1: Escaping the Murder of Crows Outside (`1/1 HP` Encounter, `0` Attrition)

* **User:** `"I swing my shovel around myself in tight arcs while backing steadily toward the car, refusing to panic."`
* **LLM (Internal Evaluation & Tool Call):**
  * *Intent:* Reach the car safely (Narrow/Bypass Intent vs. `1/1 HP` Flock = **`full`**).
  * *Pool & Threat:* `sanity` (eerie, unnatural behavior), `threat_level: 2`. Matches `"Calm"` and `"Ex-Military"`.
  ```python
  resolve_action(
    pool_name="sanity",
    threat_level=2,
    progress_scale="full",
    matched_positive_tags=["Calm", "Ex-Military"],
    matched_negative_tags=[],
    is_retreating=True
  )
  ```
* **Code Execution:**
  * `roll_4df()` $\rightarrow$ `0`.
  * `raw_cost` $= 2\text{ (threat)} + 0\text{ (dice)} - 2\text{ (pos\_tags)} = 0$.
  * **Returns:** `{"outcome": "UNFAZED_PROGRESS", "dice": 0, "attrition": 0, "pool_remaining": 3, "directive": "FULL RESOLUTION: Grant the player's complete Intent and reduce Encounter HP/Layers to 0. Cost: 0 sanity. Highlight protection from ['Calm', 'Ex-Military']."}`
* **LLM Narration:**
  > Old trench discipline takes over before fear can even register. Keeping your breathing slow and deliberate, you sweep the iron spade in practiced, overlapping arcs. Two crows clip the flat of the blade with dull thuds and tumble into the weeds; the rest wheel back into the fog, their eerie, synchronized silence failing to rattle your nerves. You reach the Ford, wrench the door open, and slide behind the wheel untouched.
  > `[Encounter Resolved: 0/1 HP | Sanity: 3/8 | Health: 8/8 — 0 Attrition (Protected by: Calm, Ex-Military)]`

### Turn 2: Searching the Whispering Study (`2/2 -> 1/2 HP`, Hitting the Zero Clamp)

* **User:** `"Once inside the manor study, I lock the oak door and comb through the leather-bound journals on the desk to learn how to stop the summoning ritual."`
* **LLM (Internal Evaluation & Tool Call):**
  * *Intent:* Completely uncover how to stop the ritual (Total Intent against a `2/2 HP` Encounter = **`stepping_stone`**). He will crack Layer 1 (`[1. Ciphered Ritual Ledger]`), reducing the study to `1/2 HP`, while hitting the Breaking Point on Sanity.
  * *Pool & Threat:* `sanity`, `threat_level: 3` (from the Encounter Block). Only `"Calm"` applies (`1` tag).
  ```python
  resolve_action(
    pool_name="sanity",
    threat_level=3,
    progress_scale="stepping_stone",
    matched_positive_tags=["Calm"],
    matched_negative_tags=[],
    is_retreating=False
  )
  ```
* **Code Execution:**
  * `roll_4df()` $\rightarrow$ `+2`.
  * `raw_cost` $= 3\text{ (threat)} + 2\text{ (dice)} - 1\text{ (pos\_tag)} = 4$.
  * `Sanity` ($3 - 4 = -1$) clamps at `0`! Adds `"Manic Dissociation"` to negative tags.
  * **Returns:** `{"outcome": "BREAKING_POINT_CLAMP", "dice": 2, "attrition": 4, "remaining": 0, "directive": "STEPPING-STONE PROGRESS: Reduce Encounter HP/Layers by 1... TRAUMA / BREAKING POINT: sanity drops to 0 and clamps! Narrate an actual wound or breakdown ('Manic Dissociation'). Positive tags are now disabled for sanity and any further loss triggers 'lethal'."}`
* **LLM Narration:**
  > You crack the cipher on the desk ledger—the summoning is set for midnight at the Blackwood Mill, and the final ritual counter-seal is locked inside the study's iron wall safe (`1/2 HP` remaining). Flipping through the ledger's diagrams to find the safe combination, however, exposes geometries that refuse to stay still on the vellum. Your calm demeanor finally fractures (`Manic Dissociation`); a cold tremor locks your jaw, and the shadows in the corners of the study seem to detach from the walls and whisper your name. You have the safe combination in hand (`[Advantage: Safe Combo]`), but your mind is at its absolute limit.
  > `[The Whispering Study: 1/2 HP | Sanity: 0/8 (BREAKING POINT!) | Active Debuff: Manic Dissociation | Gained Setup: [Advantage: Safe Combo] | WARNING: Positive tags disabled for Sanity; any further Sanity loss will trigger permanent madness!]`

### Turn 3: Abandoning the Safe & Fleeing at Zero (`is_retreating: true` with `flee_grace_toggle: true`)

* **User:** `"Hearing wet scratching inside the study walls and knowing my mind can't take opening that safe right now, I stuff the ledger into my trenchcoat, hurl a chair through the bay window, and sprint across the lawn to my car."`
* **LLM (Internal Evaluation & Tool Call):**
  * *Intent:* Escape the manor alive with the ledger (Narrow/Bypass Intent = **`full`** resolution of escape, `is_retreating: true`).
  * *Pool & Threat:* `sanity`, `threat_level: 2` (reduced by $-1$ for bypassing the safe and bolting).
  ```python
  resolve_action(
    pool_name="sanity",
    threat_level=2,
    progress_scale="full",
    matched_positive_tags=["Calm"],
    matched_negative_tags=["Manic Dissociation"],
    is_retreating=True
  )
  ```
* **Code Execution:**
  * `was_at_zero` is `True` $\rightarrow$ `"Calm"` is stripped (`effective_pos_tags = []`).
  * `roll_4df()` $\rightarrow$ `-1`.
  * `raw_cost` $= 2\text{ (threat)} - 1\text{ (dice)} - 0\text{ (pos)} + 1\text{ (neg\_tag)} = 2$.
  * Pool is at `0` and took `2` attrition, **but** `is_retreating` and `flee_grace_toggle` are both `True`.
  * **Returns:** `{"outcome": "GRACE_RETREAT_WITH_SCAR", "dice": -1, "attrition": 2, "pool_remaining": 0, "directive": "Player retreated at 0 pool with Flee Grace active. Escape succeeds! Do NOT trigger lethal overflow; instead, destroy a gear tag or inflict a permanent Scar."}`
* **LLM Narration:**
  > As the wallpaper bulges inward with the sound of a hundred scrabbling claws, you heave a mahogany chair through the leaded bay window and dive out into the rain. You hit the wet turf rolling, the ciphered ledger clutched tight against your ribs, and scramble into the Ford—dropping your **Service Revolver** into the mud as your shaking hands jam the key into the ignition. You fishtail down the gravel drive and make it back to the streetlights of Arkham alive with the mill's location, though the dark outside your headlights now feels alive and hungry.
  > `[Escape Successful via Flee Grace! | Sanity: 0/8 | Lost Gear Tag: "Service Revolver" | Gained Scar: "Nyctophobia (Fear of the Dark)"]`