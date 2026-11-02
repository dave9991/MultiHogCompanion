# Freeform Attrition Engine (FAE)

MultiHog Companion includes the **Freeform Attrition Engine (FAE)**, an attrition-based, rules-light conversational roleplaying engine that replaces D&D 3.5/5e and PbtA mechanics with resource pools, 4dF attrition curves, and proportional leverage.

---

## 🎲 Core Philosophy & Mechanics

### 1. Guaranteed Forward Momentum
FAE completely eliminates binary pass/fail skill checks and tactical grid bloat:
* **The Task Always Succeeds (or Meaningfully Advances):** If your declared action is plausible within the fiction, your character accomplishes the objective or makes tangible progress.
* **Dice Only Measure Attrition:** The dice roll does **not** determine whether you pick the lock, leap the chasm, or strike the beast; it strictly measures the **wear, tear, strain, and resource cost** inflicted upon your character during the effort.

### 2. The 4dF Attrition Curve
FAE uses four Fudge / Fate dice ($4\text{dF}$), rolling four dice with faces $\{-1, 0, +1\}$.
The outcome curve ranges from $-4$ to $+4$, centered symmetrically on $0$:

$$\text{Attrition} = \max(0, \text{Threat} + 4\text{dF} - \text{PosTags} + \text{NegTags} + \text{GenreShift})$$

| 4dF Total | Probability | Fiction Interpretation |
| :---: | :---: | :--- |
| **+3 or +4** | ~5% | Brutal Complication / Costly Effort |
| **+1 or +2** | ~33% | Minor Complication / Moderate Attrition |
| **0** | ~23% | Steady Execution / Exact Threat Baseline |
| **-1 or -2** | ~33% | Clean Effort / Effortless Advantage |
| **-3 or -4** | ~5% | Triumphant Flourish / Minimal Cost |

### 3. Intent Scoping & Proportional Leverage
Before rolling, the Referee scopes the player's declared action against the active encounter's Leverage Barriers:
* **Full Resolution (`full`):** Narrow tasks or single-layer obstacles (Threat 1–2). The obstacle is completely overcome in one turn.
* **Stepping-Stone (`stepping_stone`):** Multi-layered or elite obstacles (Threat 3–4). The player chips away one barrier layer, secures leverage, and gains a temporary `(+) Advantage` tag reducing attrition by $-1$ on the next turn.
* **Pivot (`pivot`):** Ineffective tactics or using the wrong tools for the obstacle. Threat escalates by $+1$ for this turn, but the failure reveals the adversary's true weakness or opening.

### 4. Two-Stage Zero & Overflow Rules
Characters track finite Resource Pools (e.g., *Health*, *Sanity*, *Supplies*). FAE strictly enforces a two-stage death and crisis boundary:
* **Stage 1 — Breaking Point Clamp:** When a pool drops from $>0$ to $\le 0$, it clamps strictly at **0**. It inflicts the pool's designated **Zero Debuff** (e.g. *Crippled & Bleeding*, *Manic Dissociation*) and disables all positive tags that rely on that resource. The character is NOT dead or unconscious yet.
* **Stage 2 — Terminal Overflow:** If a pool is **already at 0** and suffers additional attrition on a subsequent turn, the pool cannot absorb the loss and triggers its designated terminal overflow rule:
  - `scar_and_ko`: Protagonist is knocked unconscious or incapacitated. Pool maximum is permanently reduced by $-1$ and a permanent Trauma Scar is branded onto the character sheet.
  - `redirect:<pool>`: Loss overflows into a secondary pool (e.g., losing Armor redirects excess attrition directly into Health).
  - `scene_fail`: The active scene or mission ends in catastrophic failure (captured, objective destroyed, party forced to flee).
  - `lethal`: Fatal trauma or permanent, irreversible madness.
* **Flee Grace (`flee_grace_toggle`):** When enabled, if a character is at 0 in their primary pool and chooses to turn tail and run (`[Narrow Escape]`), they escape with a minor narrative scar instead of suffering terminal overflow or death.

### 5. Strain vs. Trauma Narration
To maintain high-stakes grit without cartoonish gore:
* **Pool > 0 (Strain):** Attrition is narrated purely as close shaves, bruised muscles, ragged breathing, frayed nerves, or sensory static. The Referee must **never** narrate broken bones, severed limbs, or mortal wounds while a pool remains above zero.
* **Pool == 0 or Overflow (Trauma):** Only when the Breaking Point is reached or overflow occurs does the narrative inflict tangible bodily trauma, panic, or gear destruction.

---

## ⚔️ Native FAE Encounter Blocks

Encounter blocks represent whole situations and environmental hazards rather than turn-by-turn combat rounds:

```text
[COMBAT]
The Whispering Study: 2/2 HP | Threat: 3 (Elite) | Pools: Sanity, Time
((PILLS)) Pressures: Shifting Geometric Diagrams (Sanity), Approaching Patrol (Time)
Leverage Barriers (2 Layers): [1. Ciphered Ritual Ledger] [2. Locked Iron Safe]
Full-Finish Triggers: Grab the ledger and run (1 Turn), OR crack both layers to uncover ritual's weakness
Status: Unsearched
[/COMBAT]
```

* **Threat Level (1 to 4):**
  - `Threat 1 (Minor / Skirmish)`: Routine obstacles, isolated thugs, locked standard doors.
  - `Threat 2 (Standard / Perilous)`: Dangerous predators, rival investigators, collapsing floors.
  - `Threat 3 (Elite / Nemesis)`: Supernatural entities, mastermind traps, multiple armed guards.
  - `Threat 4 (Epic / Apex)`: Cosmic horrors, dragon avatars, reactor meltdown sequences.
* **Pressures:** Environmental hazards that drain specific pools if ignored.
* **Leverage Barriers:** The sequential steps required to defeat complex encounters.

---

## 🏕️ Recovery Tiers & Passive Drains

Resources are managed and regained through clear fictional recovery tiers:

### Recovery Tiers
* **Scene Breather (`scene_breather`):** Short pause in a safe corner (drinking water, binding a cut). Restores $+2$ to fast-recovery pools (e.g. *Grit*, *Edge*) if the pool is $>0$. Cannot clear a Zero Debuff.
* **Camp or Sleep (`camp_or_sleep`):** A full night's rest in a secured campsite. Restores $50\%$ of maximum capacity to standard pools and clears standard Zero Debuffs.
* **Haven or Specialist (`haven_or_specialist`):** Return to civilization, a sanatorium, hospital, or high-tech medbay. Fully restores pools to $100\%$ maximum and treats deep psychological trauma.

### Passive Drains
Adverse environments exert passive wear over time:
* `day_pass`: Triggered when an in-game day passes (e.g. unyielding eldritch radiation draining Sanity each day, or consuming rations).
* `scene_transition`: Triggered when venturing into harsh terrain (e.g. toxic wasteland clouds, vacuum decompression).

---

## 🏆 Character Advancement & Milestone Desk

FAE characters evolve through fictional experience rather than numeric stat inflation:
* **Scene Milestone Track (`Scenes: X/Y` & `XP: X/Y`):** Surviving 3 to 5 dramatic scenes fills the milestone bar.
* **Milestone Desk (`FEAT-10`):** When the milestone threshold is reached, the Wand Menu highlights **🏆 FAE Milestone Available**, opening the Milestone Concierge:
  - **Expand Resource Capacity:** Increase a pool's maximum by $+1$ (up to $+3$ cap).
  - **Acquire a New Positive Tag:** Forge a new signature item, learn a specialized survival skill, or secure an influential faction contact.
  - **Attune Signature Gear:** Upgrade signature equipment with active boons.
  - **Heal a Trauma Scar:** Undergo intensive downtime therapy or physical surgery to remove a persistent debuff.

---

## 🎭 The 7 FAE Genre Skeletons

FAE features 7 fine-tuned genre skeletons with custom resource pools, recovery profiles, and positive tags:

### 1. 🐙 Cosmic Horror Investigation (`cosmic_horror`)
* **Tone:** 1920s Call of Cthulhu / Caves of Madness.
* **Resource Pools:**
  - `Health (8/8)`: Physical fortitude, recovery via `camp_or_sleep`.
  - `Sanity (8/8)`: Mental resilience against cosmic truth, recovery via `haven_or_specialist`. Passive drain: $-1$ on `day_pass`.
* **Knobs:** Flee Grace: `ON`, Shift: `0`, Overflow: `scar_and_ko`.
* **Archetypes:** The Antiquarian, The Alienist, The Private Investigator, The Occult Scholar, The Reluctant Heir.

### 2. 🗝️ OSR Dungeon Crawl (`osr_dungeon`)
* **Tone:** Classic Old-School Renaissance dungeon survival.
* **Resource Pools:**
  - `Grit (10/10)`: Stamina and blood, recovery via `camp_or_sleep`.
  - `Torches (6/6)`: Illumination and fuel, recovery via `haven_or_specialist`. Passive drain: $-1$ on `scene_transition`.
  - `Armor (4/4)`: Shield and plate durability, recovery via `camp_or_sleep`. Overflow redirects to `Grit`.
* **Knobs:** Flee Grace: `ON`, Shift: `0`, Overflow: `scar_and_ko`.
* **Archetypes:** The Torchbearer, The Sellsword, The Hedge Wizard, The Dungeoneer, The Tomb Robber.

### 3. 🪓 Survival Horror / Slasher (`survival_horror`)
* **Tone:** Resident Evil / Silent Hill / Isolated slasher.
* **Resource Pools:**
  - `Grit (8/8)`: Physical toughness, recovery via `camp_or_sleep`.
  - `Panic (6/6)`: Composure under terror, recovery via `scene_breather`.
  - `Ammunition (4/4)`: Munitions and shells, recovery via `haven_or_specialist`.
* **Knobs:** Flee Grace: `ON`, Shift: `+1` (Brutal), Overflow: `scar_and_ko`.
* **Archetypes:** The Survivor, The Deputy, The Field Medic, The Drifter, The Outcast.

### 4. ☣️ Post-Apocalyptic Wasteland (`post_apocalyptic`)
* **Tone:** Fallout / Mad Max / Stalker.
* **Resource Pools:**
  - `Health (8/8)`: Physical condition, recovery via `camp_or_sleep`.
  - `Rads (6/6)`: Radiation tolerance, recovery via `haven_or_specialist`.
  - `Scrap (6/6)`: Spare parts and barter currency, recovery via `camp_or_sleep`.
* **Knobs:** Flee Grace: `ON`, Shift: `0`, Overflow: `scar_and_ko`.
* **Archetypes:** The Scavenger, The Road Warrior, The Mutated Nomad, The Tinkerer, The Vault Outcast.

### 5. 🕶️ Cyberpunk Noir (`cyberpunk_noir`)
* **Tone:** Neuromancer / Blade Runner / Shadowrun.
* **Resource Pools:**
  - `Edge (8/8)`: Combat reaction and reflexes, recovery via `scene_breather`.
  - `Chrome (8/8)`: Cyberware stability and neural tolerance, recovery via `haven_or_specialist`.
  - `Cred (6/6)`: Corporate scrip and street favors, recovery via `haven_or_specialist`.
* **Knobs:** Flee Grace: `OFF`, Shift: `0`, Overflow: `scar_and_ko`.
* **Archetypes:** The Street Samurai, The Netrunner, The Fixer, The Techie, The Disgraced Corp.

### 6. 🚀 Deep Space Survival (`deep_space`)
* **Tone:** Alien / The Expanse / Dead Space.
* **Resource Pools:**
  - `Oxygen (6/6)`: Life support reserves, recovery via `haven_or_specialist`. Passive drain: $-1$ on `scene_transition`.
  - `Hull (8/8)`: Suit integrity and physical shielding, recovery via `camp_or_sleep`.
  - `Power (6/6)`: Battery and generator cells, recovery via `camp_or_sleep`.
* **Knobs:** Flee Grace: `ON`, Shift: `+1` (Brutal), Overflow: `lethal`.
* **Archetypes:** The Systems Engineer, The Pilot, The Astrobiologist, The Heavy Loader, The Synthetic.

### 7. 🤠 Weird West / Occult Frontier (`weird_west`)
* **Tone:** Deadlands / Dark Tower / Occult frontier.
* **Resource Pools:**
  - `Grit (8/8)`: Tenacity and gunfighting endurance, recovery via `camp_or_sleep`.
  - `Iron (6/6)`: Heavy munitions and cartridges, recovery via `haven_or_specialist`.
  - `Hex (6/6)`: Eldritch luck and card magic, recovery via `scene_breather`.
* **Knobs:** Flee Grace: `ON`, Shift: `0`, Overflow: `scar_and_ko`.
* **Archetypes:** The Gunslinger, The Huckster, The Deserter, The Preacher, The Bounty Hunter.

---

## ⚡ How to Use

1. Open **Extensions Settings** $\rightarrow$ **MultiHog Companion** $\rightarrow$ **Ruleset Engine**.
2. Set **Ruleset Engine Mode** to **🕯️ Freeform Attrition Engine (FAE)**.
3. Choose your **FAE Genre Skeleton** and adjust knobs:
   - **Flee Grace:** Protects characters with narrow escapes when at 0 pool.
   - **Attrition Shift:** `-1` (Pulp / Breezy), `0` (Standard Gritty), or `+1` (Brutal Survival).
   - **Zero Overflow Default:** `scar_and_ko`, `lethal`, or `scene_fail`.
4. Choose an action:
   - **🎩 Launch Concierge (Session Zero):** Builds custom FAE campaigns with tailored pools, threats, and lorebooks.
   - **⚡ Quick Start FAE:** Immediately creates a clean adventure chat, loads the cartridge, builds the character sheet, and starts the story.
   - **🕯️ Load FAE Cartridge:** Configures the current chat with FAE prompts without resetting the character.
   - **📦 Restore Stock D&D 5e:** Reverts prompts and modules back to factory D&D 5e.

### Slash Commands
* `/mhc-fae [genre]` — Instantly loads the FAE ruleset cartridge into the active chat (e.g. `/mhc-fae cosmic_horror`).
* `/mhc-fae-rest [type]` — Executes an in-world rest or passive drain event, updates the character sheet memo, and refreshes the MultiHog tracker UI. Supported types:
  - `scene_breather`
  - `camp_or_sleep`
  - `haven_or_specialist`
  - `day_pass`
  - `scene_transition`
