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

### 🩸 Modern / Horror (Monster of the Week)
* **Stats:**
  * `Cool`: Staying calm facing the unexplainable, driving, stealth.
  * `Hard`: Physical grit, firearms, hand-to-hand brawling.
  * `Hot`: Social charm, manipulation, dealing with authorities.
  * `Sharp`: Forensic investigation, tracking clues, reading danger.
  * `Weird`: Psychic phenomena, occult rituals, eldritch instinct.
* **Key Moves:** *Kick Some Ass (+Hard)*, *Investigate a Mystery (+Sharp)*, *Act Under Fire (+Cool)*, *Manipulate Someone (+Hot)*, *Use Magic (+Weird)*.

---

## ⚡ How to Use

1. Open **Extensions Settings** $\rightarrow$ **MultiHog Companion**.
2. Select your **Genre Preset**.
3. Choose an action:
   * **⚡ Quick Start PbtA:** Applies the ruleset, generates a full character sheet with PbtA stats and moves, locks your persona, and sends the opening story turn.
   * **🎮 Load PbtA Cartridge:** Applies the PbtA prompt ruleset to an existing chat session without recreating the character.
   * **📦 Restore Stock D&D 5e:** Reverts MultiHog back to factory default D&D 5e rules and prompts anytime.

### Slash Commands
* `/mhc-pbta [fantasy|scifi|anime|horror]` — Instantly load PbtA ruleset into MultiHog.
* `/mhc-dnd` — Restore default D&D 5e ruleset.
