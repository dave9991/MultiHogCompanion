# Powered by the Apocalypse (PbtA) Narrative Engine

MultiHog Companion includes a built-in **PbtA Narrative Engine** that replaces the default D&D 3.5/5e mechanics in MultiHog with a fiction-first, rules-light conversational roleplaying system.

---

## 🎲 Core Mechanics

### 1. The 2d6 Roll
Whenever your character triggers a Move in the narrative, the Ref (LLM) resolves the outcome using **2d6 + Stat Modifier** (-1 to +2):

| Roll Total | Outcome Tier | Narrative Consequence |
| :--- | :--- | :--- |
| **10+** | **Strong Hit** (Full Success) | You achieve your goal cleanly without cost or complications. |
| **7–9** | **Weak Hit** (Mixed Success) | You succeed, but at a cost, complication, compromise, or counter-attack. |
| **6-** | **Miss** (Trouble / Complication) | Failure or major complication. The Ref makes a GM Move and you mark **+1 XP**. |

### 2. Zero-Touch Dice
**You never roll dice manually or pause the story.** SillyTavern secretly feeds pre-rolled random dice from its `[RNG_QUEUE]` to the Ref behind the scenes. When a move triggers, the Ref automatically pulls the dice, checks your sheet, and weaves the outcome directly into the prose.

### 3. Fiction-First Combat
* **No Initiative Order:** Combat is a fluid conversation rather than round-by-round tactical math.
* **No Enemy Rolls:** Enemies do not roll attack bonuses or saving throws; their actions unfold when you roll a 7–9 or 6-, or when you hesitate in the fiction.
* **Harm Clock (0–5):** Instead of bloated HP pools, characters and enemies track Harm (1–5). Armor directly reduces incoming Harm (e.g., Armor 1 turns 2 Harm into 1 Harm).

### 4. PbtA CYOA & Party Mechanics
* **Move-Triggered Choices:** In CYOA mode, rollable options represent dramatic fictional Moves (`— [Move Name (+Stat)]`) rather than D&D skill checks against target DCs or ACs.
* **Companion Bench Resolution:** Off-screen ally tasks resolve with 2d6 + Companion Stat against PbtA tiers (10+ clean return, 7–9 mixed success, 6- trouble/injury), completely removing d20 and DC checks.

### 5. MultiHog State Tracker & Interactive Pills
* **Tandem Vitality Bar:** MultiHog visualizes PbtA character health as a descending vitality bar ($HP = \text{maxHarm} - \text{curHarm}$). When your character takes Harm, the visual health bar updates in tandem.
* **Interactive Move & Gear Pills:** Playbook Moves and equipped Gear render as sleek badge pills (`[ Hack & Slash • ]`, `[ Vibro-Blade • ]`). Hovering over a pill reveals a tooltip bubble detailing its fictional trigger, damage tags, or armor bonuses.
* **Companion Bonds:** Companion ties and allegiances render as interactive `((PILLS)) Bonds:` pills, cleanly displaying debts or oaths on hover.
* **Buffs & Debuffs:** Character conditions automatically tint in the tracker UI—beneficial effects with `(+)` glow emerald green, while injuries or debuffs with `(-)` render crimson red.
* **Adversary Attacks:** In combat, monster attacks display as hoverable pills with damage tags like `(close, 2 Harm)` revealed on mouse-over.

---

## 🎭 Genre Stat Presets

Each genre uses a standard modifier array: **+2, +1, +1, 0, -1** (one primary strength, two secondary proficiencies, one average trait, and one mandatory flaw/weakness).

### ⚔️ Fantasy (Dungeon World / Fellowship)
* **Stats:**
  * `Might`: Brute force, melee weapons, feat of strength.
  * `Agility`: Reflexes, acrobatics, stealth, ranged attacks.
  * `Wits`: Investigation, lore, monster weaknesses, perception.
  * `Heart`: Courage, charm, persuasion, morale.
  * `Arcana`: Spellcasting, magical artifacts, supernatural lore.
* **Key Moves:** *Hack & Slash (+Might)*, *Volley (+Agility)*, *Defy Danger (+Attribute)*, *Cast a Spell (+Arcana)*, *Discern Realities (+Wits)*, *Parley (+Heart)*.

### 🚀 Sci-Fi / Cyberpunk (The Sprawl / Scum & Villainy)
* **Stats:**
  * `Cool`: Composure under fire, infiltration, nerves of steel.
  * `Edge`: Combat reflexes, pilot maneuvering, close-quarters speed.
  * `Hard`: Physical violence, heavy ordnance, intimidation.
  * `Mind`: Hacking, technical repair, tactical systems analysis.
  * `Synth`: Street cred, black market connections, digital diplomacy.
* **Key Moves:** *Act Under Pressure (+Cool)*, *Engage Hostiles (+Hard/Edge)*, *Jack In / Hack (+Mind)*, *Fast-Talk (+Synth)*, *Assess Situation (+Mind)*.

### ✨ Anime / Shonen (Masks / Heroic Action)
* **Stats:**
  * `Danger`: Reckless offensive power, aggressive force.
  * `Freak`: Supernatural aura, inhuman transformations, alien powers.
  * `Savior`: Defending allies, selflessness, absorbing blows.
  * `Superior`: Tactical intellect, outsmarting rivals, arrogance.
  * `Mundane`: Human empathy, friendship, grounding emotional bonds.
* **Key Moves:** *Directly Engage (+Danger)*, *Unleash Powers (+Freak)*, *Take a Blow (+Savior)*, *Provoke (+Superior)*, *Pierce the Mask (+Mundane)*.

### 🩸 Modern / Monster Hunter (Monster of the Week)
* **Stats:**
  * `Cool`: Staying calm facing the unexplainable, driving, stealth.
  * `Hard`: Physical grit, firearms, hand-to-hand brawling.
  * `Hot`: Social charm, manipulation, dealing with authorities.
  * `Sharp`: Forensic investigation, tracking clues, reading danger.
  * `Weird`: Psychic phenomena, occult rituals, eldritch instinct.
* **Key Moves:** *Kick Some Ass (+Hard)*, *Investigate a Mystery (+Sharp)*, *Act Under Fire (+Cool)*, *Manipulate Someone (+Hot)*, *Use Magic (+Weird)*.

### 🤠 Western / Weird West (Deadlands / Dust)
* **Stats:**
  * `Grit`: Tenacity, enduring desert heat and pain, staring down threats.
  * `Quick`: Lightning-fast draw, reflexes, saddle maneuvering.
  * `Iron`: Firearm lethality, dynamite, brutal intimidation.
  * `Instinct`: Trail tracking, wilderness survival, spotting ambushes.
  * `Savvy`: Gambling, bartering, silver-tongue deception, street smarts.
* **Key Moves:** *Quick Draw (+Quick)*, *Fan the Hammer (+Iron)*, *Standoff (+Grit)*, *Read the Trail (+Instinct)*, *Silver Tongue (+Savvy)*.

### 🏴‍☠️ Swashbuckling / High Seas (7th Sea / Pirate World)
* **Stats:**
  * `Panache`: Flamboyance, cutlass dueling, swinging across rigging.
  * `Brawn`: Heavy sailing, deck brawling, cannon hauling, swimming.
  * `Daring`: Bold gambles, boarding actions, steering into typhoons.
  * `Wits`: Navigation, charting uncharted reefs, tactical trickery.
  * `Charm`: Pirate parley, sea shanties, carousing, mutiny morale.
* **Key Moves:** *Cross Swords (+Panache)*, *Boarding Action (+Daring)*, *Man the Broadside (+Brawn)*, *Chart the Unknown (+Wits)*, *Pirate Parley (+Charm)*.

### 🤖 Giant Mecha (Beam Saber / Lancer)
* **Stats:**
  * `Frame`: Armor plating, kinetic impact, structural hull integrity.
  * `Sync`: Neural interface with the mech, cockpit reflexes, high-G turns.
  * `Systems`: Targeting sensors, electronic warfare, missile locks, hacking.
  * `Heat`: Reactor overdrive, beam cannons, plasma dissipation.
  * `Pilot`: Unmounted survival, sidearm combat, personal grit, leadership.
* **Key Moves:** *Full Salvo (+Systems)*, *High-G Burn (+Sync)*, *Overclock Reactor (+Heat)*, *Crushing Blow (+Frame)*, *Bail / Eject (+Pilot)*.

### 🐙 Cosmic / Eldritch Horror (Call of Cthulhu / Tremulus)
* **Stats:**
  * `Sanity`: Mental fortitude, scientific logic, resisting cosmic madness.
  * `Insight`: Forensic deduction, deciphering forbidden texts, spotting anomalies.
  * `Grit`: Enduring paralyzing dread, sheer willpower, staying conscious.
  * `Flesh`: Hand-to-hand desperation, sprinting, physical self-preservation.
  * `Forbidden`: Chanting ancient rites, communing with the void, alien relics.
* **Key Moves:** *Cling to Sanity (+Sanity)*, *Decipher the Obscure (+Insight)*, *Stand Fast (+Grit)*, *Desperate Flight (+Flesh)*, *Invoke the Rites (+Forbidden)*.

### 🪓 Survival / Slasher Horror (Resident Evil / Final Girl)
* **Stats:**
  * `Nerve`: Suppressing screams and panic, stealth, keeping composure.
  * `Brawn`: Fighting back with improvised weapons (axes, pipes, shotguns).
  * `Scavenge`: Searching rooms for keys, batteries, ammunition, medical gauze.
  * `Agility`: Vaulting windows, squeezing through vents, sprinting from killers.
  * `Heart`: Rallying terrified survivors, sacrifice, keeping hope alive.
* **Key Moves:** *Hold Your Breath (+Nerve)*, *Fight for Your Life (+Brawn)*, *Scavenge Supplies (+Scavenge)*, *Sprint for Cover (+Agility)*, *Protect Another (+Heart)*.

### ☣️ Post-Apocalyptic / Wasteland (Apocalypse World / Fallout)
* **Stats:**
  * `Cool`: Composure behind the wheel, driving in dust storms, nerves.
  * `Hard`: Violence, wasteland intimidation, brute physical force.
  * `Sharp`: Threat evaluation, spotting snipers, tracking across ruins.
  * `Scrap`: Jury-rigging weapons, vehicles, salvage, and filtration.
  * `Weird`: Psychic static, sensing radiation storms, strange mutations.
* **Key Moves:** *Act Under Fire (+Cool)*, *Go Aggro (+Hard)*, *Read a Sitch (+Sharp)*, *Jury-Rig (+Scrap)*, *Open Your Brain (+Weird)*.

### 🕵️ Victorian / Gothic Heist (Blades in the Dark / Dishonored)
* **Stats:**
  * `Prowl`: Rooftop running, gymnastics, high-speed evasion.
  * `Finesse`: Pickpocketing, lockpicking, delicate sleight of hand.
  * `Skulk`: Shadows, blending into fog, silent ambushes.
  * `Sway`: Cons, aristocrat impersonation, charm, blackmail.
  * `Attune`: Siphoning electroplasmic tech, communing with ghosts.
* **Key Moves:** *Slip Through the Shadows (+Skulk)*, *Pick a Pocket or Lock (+Finesse)*, *Leap the Rooftops (+Prowl)*, *Work the Mark (+Sway)*, *Attune to the Veil (+Attune)*.

---

## 🌍 World Simulation Architecture & PbtA Fronts

MultiHog Companion integrates deeply with MultiHog's background simulation engines (World Skeleton, World Progression, and Map Evolution) while keeping per-turn prompt overhead near zero.

### 1. Token-Optimized Modular Lorebooks
Instead of pinning thousands of tokens to every single turn, Session Zero splits your setting into 4 lean campaign lorebooks:
* **`{prefix}_NPCs`**: Supporting characters and adversaries formatted with clean `[CORE]` summaries.
* **`{prefix}_Factions`**: Global powers, allegiances, and agendas.
* **`{prefix}_Locations`**: District-scale settlements and adventure sites with trigger keywords.
* **`{prefix}_Quests`**: The opening crisis and active quest hooks.

The full raw Campaign Dossier is recorded in World Info as a dormant background artifact (`constant: false`), activated only when specific deep lore is referenced.

### 2. Day 0 World Skeleton Seeding
At campaign launch, the Concierge seeds macro premises into `{prefix}_Skeleton`:
* **Factions (`FAC`)**: Global powers operating off-screen.
* **Locations (`LOC`)**: High-level geographic districts and wilderness hubs.
* **Conflicts (`EVENT`)**: Active regional tensions and Impending Dooms.

This gives MultiHog's World Progression engine deterministic fuel to evolve the world without hallucination.

### 3. PbtA Fronts & Impending Doom via World Progression
In tabletop PbtA, Fronts and Grim Portents represent looming catastrophes that advance when protagonists falter.
* **Automated Grim Portents:** Every 24 in-world hours, MultiHog advances off-screen Fronts based on adversary countdown tracks.
* **Narrator Fuel on 6- and 7–9 Rolls:** When the protagonist rolls a Miss (6-) or Weak Hit (7–9), the Ref is instructed to consult the latest World Progression reports and Map Evolution threads (`[Recent site activity]`) to deliver dramatic, fiction-first GM Moves instead of repetitive combat harm.

### 4. World Simulation Depth Calibration
During Session Zero (or via the Campaign Calibration Dials), players choose between three simulation depths:
* **Active Fronts (Recommended):** World Progression advances every 24 in-world hours, tracking Grim Portents and faction moves without heavy background token churn.
* **Living World (Deepest):** Combines 24-hour macro Fronts with automated 8-hour Map Evolution across all mapped sites, tracking site ecology, open causal threads, and scavengers.
* **Static Solo (Narrative Only):** Disables background simulation agents for pure lightweight, lorebook-driven solo play.

---

## ⚡ How to Use

1. Open **Extensions Settings** $\rightarrow$ **MultiHog Companion**.
2. Select your **Genre Preset** (choose from 11 tailored genres).
3. Choose an action:
   * **🎩 PbtA Concierge (Session Zero):** Conversational campaign builder with live blueprint deck and simulation dials.
   * **⚡ Quick Start PbtA:** Applies the ruleset, generates a full character sheet with PbtA stats and moves, locks your persona, and sends the opening story turn.
   * **🎮 Load PbtA Cartridge:** Applies the PbtA prompt ruleset to an existing chat session without recreating the character.
   * **📦 Restore Stock D&D 5e:** Reverts the current chat back to factory default D&D 5e rules and prompts.

### Slash Commands
* `/mhc-pbta [genre]` — Instantly load PbtA ruleset (e.g. `pirate`, `western`, `mecha`, `scifi`, `fantasy`, `cosmic_horror`, `survival_horror`, `post_apocalyptic`, `gothic_heist`, `anime`, `horror`).
* `/mhc-dnd` — Restore default D&D 5e ruleset.
