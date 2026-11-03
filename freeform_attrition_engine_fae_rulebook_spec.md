# Freeform Attrition Engine (FAE)

**A Deterministic, Single-Pass RPG Architecture for an LLM Game Master**

## 1. Core Design Philosophy

Traditional tabletop RPGs rely on binary pass/fail rolls that either stall solo stories on a failed check or cause wild narrative whiplash on extreme dice swings. **FAE** replaces pass/fail branching with **guaranteed forward momentum measured by resource attrition**:

1. **Single-Pass Resolution:** The player declares their action, the LLM evaluates the fiction and calls a single code-backed function (`resolve_action`), and the LLM narrates the outcome in the same turn. No mid-turn negotiation or meta-currency haggling.

2. **Encounter-Wide Resolution (No Action Economy):** FAE does not use initiative order, combat turns, or individual creature rolls. Threat describes the **entire encounter or situation as a whole**, resolved in a single roll per player turn.

3. **Attrition Over Failure:** Actions always move the story forward. The dice (`4dF`, ranging from $-4$ to $+4$ on a tight bell curve centered on $0$) only determine how much wear-and-tear the character suffers along the way.

4. **Intent vs. Proportional Result:** The player owns the *Task* and the *Intent*; the LLM Narrator owns the *Scale of Result* based on the character's current fictional leverage and the Encounter's remaining Leverage Layers.

5. **Code-Enforced Safety Net:** Characters cannot die or fail from a single bad roll. Reaching `0` in a resource pool triggers a clear warning state and debuff; only taking further attrition *while already at `0`* triggers a terminal overflow consequence.

## 2. Guidelines: Pools, Tags, Companions, Heroic Domains, and Genre Knobs

### 2.1 Picking Resource Pools (The Rule of 2 to 3)

Every game configuration uses **2 or 3 pools**, typically sized between **6 and 12 points**.

* **Why 2–3?** A single pool makes all hazards feel identical, while 4+ pools spread attrition too thin and cause the LLM to hesitate over which pool applies.

* **The Golden Triad:**

  1. **Physical Pool:** `Health`, `Grit`, `Body`

  2. **Mental / Social / Heroic Pool:** `Sanity`, `Resolve`, `Nerve`, `Reputation` *(or a bespoke solo class pool like `Mana` or `Daring` when `heroic_tier` is active).*

  3. **Pacing / Environmental Pool:** `Supplies`, `Torchlight`, `Heat`, `Time` *(Often* configured with Passive Drain and set *to redirect overflow attrition into Pool 1 or 2).*

### 2.2 Pool Narration Semantics: "Strain ($> 0$) vs. Trauma ($== 0$)"

To prevent the LLM from narrating broken bones or crippling wounds on routine point loss when a character still has plenty of pool capacity left, every pool enforces a **Two-Tier Narration Rule**:

* **Above Zero (**$\text{Pool} > 0$ **= Strain, Stamina & Near-Misses):** Attrition that leaves a pool above `0` **never** inflicts disabling wounds or madness.

  * *Physical Pools:* Narrate parrying shock, bruised muscles, winded breath, sweat, and narrowly dodging a lethal sweep.

  * *Mental / Heroic Pools:* Narrate creeping dread, cold sweat, arcane exertion, spent focus, or rattled composure.

* **Hitting Zero (**$\text{Pool} == 0$ **= The Breaking Point Wound):** Clamping at `0` is the exact narrative moment the character's guard breaks and they suffer a tangible injury, burnout, or psychological fracture (their `zero_debuff`).

### 2.3 Character Tags & The Trait Qualification Protocol

Characters begin with **3 to 4 Positive Tags** and **0 to 1 Negative Tag (Scar)**.

* **Ideal Scope:** A balanced tag naturally applies to roughly 25–30% of genre situations (e.g., `Ex-Military`, `Calm`, `Quiet`, `Occult Scholar`, `Shield-Bearer`, `Trap-Wise`).

* **Gear as Tags:** Signature equipment (`Service Revolver`, `Heavy Shield`, `Crowbar`, `Grappling Hook`) acts as a Positive Tag and can be temporarily lost, depleted, or broken as a narrative consequence.

* **Hard Stacking Cap:** The code enforces a strict maximum of **2 Positive Character/Companion Tags** per action ($-1$ Attrition each). An earned `[Advantage]` tag from a prior `stepping_stone` turn stacks on top of this cap for an extra $-1$.

* **Negative Tags / Scars:** Active debuffs or permanent scars apply $+1$ Attrition each when relevant to the action.

#### 2.3.1 The Trait Qualification Protocol (Handling Broad or God-Tier Tags)

To keep character creation fluid (especially when importing cards or concepts from other RPGs), the Narrator resolves overly broad tags via **Cooperative Qualification rather than hard rejection**:

1. **Tier A — Auto-Qualify Broad Traits (`Trait [context]`):** When a player proposes an overly broad adjective (`Strong`, `Smart`, `Fast`, `Lucky`, `Tough`), the Narrator does not reject it. Instead, it preserves the player's archetype by attaching a bracketed situational qualifier that narrows its applicability to \~25–30%:

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

3. **Companions as Positive Tags (Subject to the 2-Tag Cap):** Notable companions or hirelings can be recorded as Positive Tags (e.g., `Companion: Sister Valeria (Cleric)` or `Retainer: Torchbearer`). When they actively assist in the declared action, the LLM may select them as 1 of the **max 2 Positive Tags** ($-1$ Attrition). Because the 2-tag ceiling never changes, adding companions never breaks the attrition math.

4. **Companions as Narrative Buffer (At Breaking Point / Overflow):** When a pool clamps at `0`, triggers `scar_and_ko`, or resolves a `GRACE_RETREAT_WITH_SCAR`, the consequence can manifest narratively on a companion—such as a retainer panicking and fleeing, or a companion taking an injury (`Companion Wounded: Valeria`) that disables their tag until `haven_or_specialist` recovery.

### 2.5 Heroic Domains (Pre-Math Leverage Permissions)

When the **`heroic_tier: true`** Genre Knob is enabled, characters gain a **`heroic_domain`** slot formatted as **`Archetype [specific domains]`**—such as `Wizard [illusions and teleportation]`, `Rogue [masterwork locks and shadow-stealth]`, or `Cleric [radiant wards and undead turning]`.

1. **Pure Pre-Math Leverage (Not a Tag):** Unlike companions or gear, a `heroic_domain` **never** counts as a Positive Tag and **never** applies a $-1$ modifier in `resolve_action()`. Its lanes are strictly separated: **Heroic Domains govern *what is possible* (Leverage); Positive Tags govern *what hurts less* (Attrition Mitigation).** (A Rogue who *also* wants $-1$ attrition on stealth rolls takes a separate Positive Tag like `Shadow-Cloak`).

2. **Three Pre-Math Effects of a Heroic Domain:**

   * **Expands `Threat 0` (Brush-Aside):** Mundane obstacles squarely inside the domain (e.g., a standard iron lock for a `Rogue`, or crossing a 30-foot chasm for a `[teleportation]` Wizard) drop to **Threat 0**—resolved effortlessly without a tool call.

   * **Grants Supernatural / Extraordinary Leverage (Avoids `pivot`):** Actions that would force a `pivot` for a normal human (vanishing in plain sight, misty-stepping behind an entrenched shield wall, banishing a spirit) are treated as valid **`stepping_stone`** or **`full`** actions.

   * **Neutralizes Encounter Pressures (**$-1$ **Threat):** Using a Heroic Domain to directly counter an Encounter's listed `Pressure` (e.g., casting an illusion to blind `High Ground Crossbows`) qualifies for the standard $-1$ Threat tactical modifier.

3. **Pool Routing for Heroic Exertion (Party vs. Solo):** When a character uses their Heroic Domain against a **Threat 1–4** obstacle, the roll still risks attrition:

   * **Party / Shared-Pool Play:** Route Heroic strain into the shared **`Resolve`** pool (representing collective focus, grit, and nerve, so any class archetype shares the same pool).

   * **Solo Specialist Play:** Configure a bespoke class pool in place of Resolve—such as **`Mana`** (for a solo Wizard), **`Daring`** (for a solo Rogue), or **`Conviction`** (for a solo Paladin).

### 2.6 Genre Knobs (System-Level Configuration)

| Knob Name | Values | Mechanical Effect | 
| ----- | ----- | ----- | 
| **`heroic_tier`** | `true` / |  | 
