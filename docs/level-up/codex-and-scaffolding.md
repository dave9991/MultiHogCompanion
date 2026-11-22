# Contract Sheet: 1–20 Progression Codex, Blueprint Compiler & Auto-Scaffold Engine

> **Phase:** 1 — Progression Blueprint Tables, Feature Partitioning, Turn-0 Scaffolding & Partition Persistence  
> **Primary Code:** [level-up-blueprint.js](../../level-up-blueprint.js), [level-up-scaffold.js](../../level-up-scaffold.js), [index.js](../../index.js) (`launchLevelUpOrRespecDesk`)  
> **Related Catalog Entries:** `FEAT-01`, `FEAT-02`, `FEAT-10`, `WRK-08`, `WRK-10`, `DOM-08`, `DOM-09`

---

## 1. Subsystem Purpose & Ownership Boundary

`FEAT-10` replaces upstream MultiHog's narrative-halting level-up prompt (`level_up_protocol: false`) with an interactive, zero-story-token Level-Up & Respec system. Phase 1 owns the foundational data structures:

* **1–20 Class Progression Codex & Classifier (`level-up-blueprint.js`):** Houses `XP_LEVEL_THRESHOLDS`, the 12 core D&D 5e SRD classes (`CORE_DND_PROGRESSIONS`), deterministic pill syntax normalization (`formatTraitAsPill()`), active-vs-passive ability partitioning (`classifyFeatureKind()`, `partitionFeaturesAndAbilities()`), and autonomous homebrew 1–20 table generation (`generateProgressionBlueprintViaConcierge()`).
* **Multi-Engine Memo Parser & Scaffold Engine (`level-up-scaffold.js`):** Parses live state memos across D&D 5e, PbtA, and FAE (`parseCharacterBlockFromMemo()`), auto-scaffolds clean dossier stubs when players skip Session Zero (`scaffoldDossierStubForChat()`, `ensureChatDossier()`), persists blueprints across chat metadata, extension partitions, and World Info lorebooks (`persistCompanionDossier()`, `syncDossierToWorldInfoBook()`, `buildDossierWorldInfoMarkdown()`).
* **Desk Launcher (`launchLevelUpOrRespecDesk()` in `index.js`):** Invoked by golden XP bar badge clicks (`DOM-08`) or Wand Menu clicks (`DOM-09`), resolving active ruleset (`fae`, `pbta`, `dnd5e`), computing advancement eligibility, seeding/generating the D&D blueprint when needed, and mounting Stage 1 or Stage 2 of the modal UI.

**Upstream Boundary (Read-Only):**
* Upstream `SillyTavern-MultihogDnDFramework/` never calls into `level-up-blueprint.js` or `level-up-scaffold.js`. Upstream simply sees `syspromptModules.level_up_protocol = false` (`cleanseStockDndSettings()`, `applyPbtACartridge()`, `Dnd5eSystemAdapter.installCartridge()`) and renders Companion's updated state memo blocks and interactive `.rt-xp-row` bars (`decorateXpBarsForLevelUp()`).

---

## 2. 1–20 Progression Codex Schema & Core SRD Tables

Implemented in [level-up-blueprint.js](../../level-up-blueprint.js):

* **XP Curve:** `XP_LEVEL_THRESHOLDS` spans Levels 1–20 (`0, 300, 900, 2700, ..., 355000`); `MAX_CHARACTER_LEVEL = 20`.
* **Canonical Classes (`CORE_DND_PROGRESSIONS`):** Zero-latency SRD tables for all 12 core classes (`fighter`, `rogue`, `wizard`, `cleric`, `barbarian`, `paladin`, `bard`, `druid`, `monk`, `ranger`, `sorcerer`, `warlock`).
  * Uses single-track **D&D Lite** progressions with named Level 3 (or Level 1/2 for caster domains/traditions) **Archetype Specializations** (`subclass: true`) instead of branching subclass trees.
  * Matched case-insensitively with word boundaries by `getCanonicalDndProgression(className)` (e.g. `"Shadow Rogue"` matches `rogue`, while `"Bombardier"` does not false-match `bard`).
* **Class Affinity & Normalization (`blueprintMatchesClass()`, `normalizeBlueprint()`, `normalizeLevelEntry()`):**
  * `normalizeBlueprint()` normalizes Hit Die strings (`"1d8"` -> `"d8"`), keys `levels` `"1"` through `"20"`, computes proficiency bonus (`Math.floor((level - 1) / 4) + 2`), promotes ASI/Spell-Slot bookkeeping rows into `entry.asi` / `entry.spellSlots`, and strips bookkeeping noise from `entry.features`.
  * `blueprintMatchesClass()` tolerates casing/punctuation and descriptive prefixes (`"Shadow Rogue"` matches `"Rogue"`) while triggering blueprint invalidation & regeneration when a character re-classes.

---

## 3. Feature Sanitation, Pill Formatting & Dual-Block Partitioning

1. **Roadmap Bookkeeping Noise Filtering (`classifyFeatureNoise()`, `sanitizeFeatureList()`):**
   * Drops HP gain lines (`+1d10 HP`), proficiency bonus rows (`Proficiency Bonus +3`), ASI placeholder lines, bare `Cantrips learned` labels, and spell slot rows from `features` arrays so engine-computed columns are never duplicated as character traits.
2. **MultiHog Hover-Pill Normalization (`formatTraitAsPill()`):**
   * Preserves and strips `[TRAIT]` / `[ABILITY]` classification prefixes while recording explicit kind hints in `EXPLICIT_FEATURE_KINDS`.
   * Rewrites `Name: description` or `Name — description` into MultiHog's interactive `Name (description)` pill syntax, replaces nested parentheses inside descriptions with `[brackets]` so MultiHog's parenthesis-depth splitter never breaks, merges `(1/1 per rest): effect` into `Name (effect; 1/1 per rest)`, and preserves short category prefixes (`Feat: Sentinel`).
3. **Dual-Block Routing (`classifyFeatureKind()`, `partitionFeaturesAndAbilities()`):**
   * **Active Abilities (`'ability'` $\rightarrow$ `[ABILITIES]`):** Explicit `[ABILITY]` prefix, rest/day usage counters (`X/Y per short rest`, `1/long rest`, `CHA/day`), resource expenditures (`Spend 1 Ki`), or canonical active actions in `ACTIVE_ABILITY_NAME_PATTERN` (`Second Wind`, `Action Surge`, `Rage`, `Wild Shape`, `Metamagic`, etc.).
   * **Passive Traits (`'trait'` $\rightarrow$ `[CHARACTER] Traits:`):** Passive bonuses, expertise, resistances, and constant perks without rest-tracked charges.

---

## 4. Autonomous Homebrew Blueprint Generation & Fallback Contract

1. **Concierge Prompt & Parser (`buildBlueprintPrompt()`, `parseBlueprintFromResponse()`):**
   * Grounds prompt generation in the character's `stats`, `hitDie`, campaign `genre`/`worldRules`, and **established starting sheet traits** so custom classes keep features already granted during play.
   * Extracts JSON from ```` ```json ```` code fences or `{..."levels"...}` blocks and runs `normalizeBlueprint()`.
2. **Tier Perk Extraction (`getTierPerks(blueprint, targetLevel, conModifier)`):**
   * Computes `averageHpGain = Math.max(1, Math.floor(dieMax / 2) + 1 + conModifier)` and returns `{ level, features, traits, abilities, isAsi, isSubclass, spellSlots, profBonus, hitDie, averageHpGain }`.
3. **Resilient Fallback (`generateProgressionBlueprintViaConcierge()`):**
   * Requests a structured 1–20 table via `sendConciergeRequest()`. If the endpoint fails or returns invalid JSON, displays a non-intrusive `toastr.warning` (`Class Codex Fallback`) and returns a balanced 1–20 fallback codex so the Stage 1 modal never hangs or crashes.

---

## 5. Multi-Engine Memo Parsing & Stub Scaffolding (`LVL-002`)

Implemented in [level-up-scaffold.js](../../level-up-scaffold.js):

* **Ruleset Detection:** `parseCharacterBlockFromMemo()` and `scaffoldDossierStubForChat()` classify live memos via `systemRegistry.detectRulesetFromMemo(memoText)` across three engines:
  1. **FAE (`'fae'`):** Parsed via `parseFaeStateFromMemo(memoText)` (populates `isFae: true`, `isPbta: false`, `level: null`, `hitDie: null`, `archetype`, `pools`, `positiveTags`, `negativeTags`, `knobs`, `scenesCompleted`, `scenesTarget`, `genreKey`). `scaffoldDossierStubForChat()` sets `meta.ruleset = 'fae'` and preserves `genreKey` (`'cosmic_horror'`, `'osr_dungeon'`, etc.).
  2. **PbtA (`'pbta'`):** Parses `harm` clock, `armor`, `((PILLS)) Moves:`, `((PILLS)) Conditions:`, `((PILLS)) Gear:`, `Stats:`, and `status` (`level: null`, `hitDie: null`).
  3. **D&D 5e (`'dnd5e'`):** Parses `Name (Class): cur/max HP`, `[XP]` Level, `HD:`, `Traits:`/`Features:`/`Abilities:`, 6 ability scores, and `[ABILITIES]` block (`parseAbilitiesBlockFromMemo()`).
* **Non-D&D Codex Isolation:** `ensureChatDossier()` clears any accidental `progressionBlueprint` on FAE/PbtA dossiers and gates `getCanonicalDndProgression()` attachment behind `if (!pbtaMode && !faeMode)`, ensuring FAE characters with archetypes like `"Ranger"` or `"Rogue"` are never coerced into D&D 5e blueprints (`LVL-002`).

---

## 6. Persistence & `WRK-10` Key Sanitization Contract (`LVL-008`)

* **Dossier Lookup Resolution Order (`ensureChatDossier()`):**
  1. Caller-supplied `companionSettings.chatStates[cid]` (checked across `getCandidateChatIds(chatId)` via `getPartitionDossier()`).
  2. Active SillyTavern `ctx.chatMetadata.mhc_dossier` (or `chat_metadata.mhc_dossier`).
  3. `SillyTavern.getContext()?.extensionSettings` and global `extension_settings` (`multihog_companion`, then `rpg_tracker`).
  4. Auto-scaffold fallback (`scaffoldDossierStubForChat()`), saved immediately into `companionSettings.chatStates[cleanPartId]` and `chatMetadata.mhc_dossier`.
* **`WRK-10` Partition Key Sanitization & Dual-Tier Sync (`persistCompanionDossier()`):**
  * **Strict `.jsonl` Stripping:** Always keys writes under `cleanId = String(chatId || '').replace(/\.jsonl$/i, '').trim()` (`WORKAROUNDS.md#wrk-10-empty-character-directory-chat-listing-exception-upstream-cleandeletedchatrecords-abort`) so `.jsonl` duplicate partitions never pollute `chatStates`.
  * Calls `setPartitionDossier(store.chatStates[cleanId], dossier, rulesetHint)` on both `multihog_companion` and `rpg_tracker` stores (resolving both `SillyTavern.getContext()?.extensionSettings` and `extension_settings` / `globalThis.extension_settings`) so `companionDossier`, `campaignDossier`, and ruleset-specific keys (`faeCampaignDossier` / `pbtaCampaignDossier`) stay synchronized (`LVL-008`).
* **Lorebook Sync (`buildDossierWorldInfoMarkdown()` & `syncDossierToWorldInfoBook()`):**
  * Formats ruleset-appropriate Markdown into `Campaign_<Title>` (`LVL-002`): FAE outputs Archetype, Resource Pools, Positive Tags, Scars & Debuffs, and FAE Knobs; PbtA outputs Playbook, Harm Track, Armor, Stats, and Moves; D&D 5e outputs Class, Level, Hit Points, Hit Die, Attributes, and the 1–20 Progression Blueprint.

---

## 7. Desk Launcher Orchestration (`LVL-001`)

`launchLevelUpOrRespecDesk({ isRespec })` in [index.js](../../index.js):
1. Resolves active `chatId`, `rpgSettings`, `currentMemo`, and `dossier = ensureChatDossier(chatId, s, { memo: currentMemo })`.
2. Evaluates ruleset (`isFae`, `isPbta`) and calls `evaluateLevelUpEligibility(currentMemo, rulesetKey, { pacingXp, pacingScenes })`.
3. For FAE (`LVL-001`): clears `progressionBlueprint`, sets `dossier.meta.ruleset = 'fae'`, and **preserves valid FAE genre keys in `dossier.meta.systemKey`** (only falling back to `detectActiveFaeGenre()` when `systemKey` is unset or still `'dnd5e'`/`'pbta'`/`'fae'`).
4. For D&D 5e: links `getCanonicalDndProgression()` immediately if present; otherwise kicks off non-blocking `blueprintPromise = generateProgressionBlueprintViaConcierge(...)` while opening Stage 1 immediately with a loading shimmer (`initialStage = 1`).
5. Computes `effectiveIsRespec = isRespec || !eligibility.eligible` so players without enough XP/Scenes still enter Respec/Tuning mode cleanly rather than getting an unearned level bump.

---

## 8. Failure Modes, Guardrails & Audit Fixes (`LVL-001`, `LVL-002`, `LVL-008`)

| Failure Mode / Audit ID | Guardrail / Remediation Applied |
| :--- | :--- |
| FAE `dossier.meta.systemKey` overwritten with `'fae'` in `launchLevelUpOrRespecDesk()` (`LVL-001`) | Preserved valid FAE genre keys (`'osr_dungeon'`, `'custom'`, etc.) in `index.js`, defaulting via `detectActiveFaeGenre()` only when unset/generic, and passed `pacingScenes` to eligibility check. |
| FAE quick-start chats parsed/scaffolded as D&D 5e or given D&D lorebook `Level`/`Hit Die` lines (`LVL-002`) | Added `isDossierFae()`, FAE memo parsing (`parseFaeStateFromMemo()`), FAE stub scaffolding, `!faeMode` codex guards, and `buildDossierWorldInfoMarkdown()` per-engine formatting in `level-up-scaffold.js`. |
| Stale `.jsonl` duplicate partitions vs partial `companionDossier` writes (`WRK-10`, `LVL-008`) | Retained `cleanId` `.jsonl` stripping (`WRK-10`) while upgrading `ensureChatDossier()` and `persistCompanionDossier()` to read/write `SillyTavern.getContext()?.extensionSettings` and `setPartitionDossier()`. |
| Custom homebrew blueprint LLM request times out or returns malformed JSON | `generateProgressionBlueprintViaConcierge()` catches errors, displays `toastr.warning`, and supplies a full 1–20 balanced fallback table. |

---

## 9. Code Anchors & Test Coverage

* **Primary Implementation:**
  * `level-up-blueprint.js`: `XP_LEVEL_THRESHOLDS`, `MAX_CHARACTER_LEVEL`, `CORE_DND_PROGRESSIONS`, `classifyFeatureNoise`, `formatTraitAsPill`, `classifyFeatureKind`, `partitionFeaturesAndAbilities`, `sanitizeFeatureList`, `normalizeLevelEntry`, `normalizeBlueprint`, `hasProgressionBlueprint`, `blueprintMatchesClass`, `getCanonicalDndProgression`, `buildBlueprintPrompt`, `parseBlueprintFromResponse`, `getTierPerks`, `formatBlueprintSummary`, `generateProgressionBlueprintViaConcierge`.
  * `level-up-scaffold.js`: `deriveHitDieForClass`, `parseCharacterBlockFromMemo`, `parseAbilitiesBlockFromMemo`, `isDossierPbta`, `isDossierFae`, `scaffoldDossierStubForChat`, `ensureChatDossier`, `persistCompanionDossier`, `buildDossierWorldInfoMarkdown`, `syncDossierToWorldInfoBook`.
  * `index.js`: `launchLevelUpOrRespecDesk`.
* **Regression Suites:**
  * `tests/level-up-system.test.js` — Memo parsing, stub scaffolding, `CORE_DND_PROGRESSIONS`, `formatTraitAsPill`, `classifyFeatureKind`, `WRK-10` + `LVL-002` + `LVL-008` + `LVL-001` regression coverage.
  * `tests/concierge-progression-codex.test.js` — Turn-0 Rogue blueprint auto-linking and boundary hardening.
  * `tests/fae-milestone-desk.test.js` — FAE milestone pacing and eligibility checks.
  * `tests/history-integrity-guard.test.js` — `WRK-10` `.jsonl` duplicate cleanup and partition integrity.
