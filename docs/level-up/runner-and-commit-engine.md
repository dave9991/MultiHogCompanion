# Contract Sheet: Multi-Engine Advancement Runner & Surgical Commit Engine

> **Phase:** 2 — Eligibility Evaluation, Multi-Engine Proposals, Concierge Directives & Surgical Memo Commits  
> **Primary Code:** [level-up-runner.js](../../level-up-runner.js), [level-up-ui.js](../../level-up-ui.js) (Confirm & Apply handoff)  
> **Related Catalog Entries:** `FEAT-10`, `WRK-08`, `WRK-10`, `DOM-08`

---

## 1. Subsystem Purpose & Ownership Boundary

Phase 2 owns the deterministic game-math, proposal construction, natural-language directive parsing, and surgical state-memo commit pipeline inside [level-up-runner.js](../../level-up-runner.js):

* **Deterministic Advancement Eligibility (`evaluateLevelUpEligibility()`):** Evaluates whether a protagonist is eligible for level advancement, PbtA advance, or FAE milestone without invoking an LLM call, honoring configurable `pacingXp`, `pacingScenes`, and D&D 5e Level-20 hard caps (`MAX_CHARACTER_LEVEL`).
* **Multi-Engine Proposal Formulation (`formulateLevelUpProposal()`):** Produces normalized advancement/respec proposals across all three supported rulesets — D&D 5e Lite, Powered by the Apocalypse (`PbtA`), and Freeform Attrition Engine (`FAE`) — including Ruleset Architect `customGenreSpec` overlays (`LVL-003`, `LVL-004`).
* **Advancement Pickers & Directive Scanner (`buildPbtaAdvanceOptions()`, `applyPbtaAdvanceSelection()`, `buildFaeMilestoneOptions()`, `applyFaeMilestoneSelection()`, `extractConciergeDirectives()`):** Enforces usage caps, Trait Qualification Protocol rules (`buildFaeMilestonePrompt()`), and bracket-safe parsing for 18 Stage 1 & Stage 2 Concierge directives.
* **Surgical State-Memo & Partition Commit (`applyLevelUpCommit()`, `applyDossierCommitUpdate()`, `applySpellSlotGrowth()`):** Patches `[CHARACTER]`, `[ABILITIES]`, `[SPELLS]`, `[XP]`, and `[PARTY]` blocks in place while synchronizing partition caches via `setPartitionDossier()` under `WRK-10` key sanitization (`LVL-005`).
* **Tracker Bar Decoration (`decorateXpBarsForLevelUp()`):** Applies golden readiness glow and `.mhc-xp-level-up-badge` interactive triggers on upstream `.rt-xp-row` DOM elements.

**Upstream Boundary (Read-Only):**
* Upstream `SillyTavern-MultihogDnDFramework/` never calls `applyLevelUpCommit()` or mutates Companion dossiers. MultiHog upstream reads the resulting `rpgSettings.currentMemo`, fires `_rpgUpdateUIMemo()`, and re-renders `.rt-xp-row` progress bars which `decorateXpBarsForLevelUp()` decorates via DOM delegation (`DOM-08`).

---

## 2. Data Model & Schema Contract

### 2.1 `evaluateLevelUpEligibility()` Return Schema

| Field | D&D 5e (`'dnd5e'`) | PbtA (`'pbta'`) | FAE (`'fae'`) |
| :--- | :--- | :--- | :--- |
| `ruleset` | `'dnd5e'` | `'pbta'` | `'fae'` |
| `eligible` | `currentXp >= maxThreshold && maxThreshold > 0 && currentLevel < 20` | `cur >= max && max > 0` | `cur >= max && max > 0` |
| `currentXp` | Parsed from `Total: X / Y XP` or `XP: X/Y` | Parsed `XP: X/Y` (`0` default) | Parsed `Scenes: X/Y` (or `XP: X/Y` fallback) |
| `maxThreshold` | Parsed denominator or `XP_LEVEL_THRESHOLDS[currentLevel]` | Denominator or `options.pacingXp` (default `5`) | Denominator or `options.pacingScenes \|\| options.pacingXp` (default `4`) |
| `currentLevel` / `nextLevel` | `currentLevel`, `currentLevel + 1` | `1` / `2` (unused; advances replace levels) | `1` / `2` (unused; milestones replace levels) |
| `surplusXp` | `Math.max(0, currentXp - maxThreshold)` | `Math.max(0, cur - max)` | `Math.max(0, cur - max)` |

### 2.2 Multi-Engine Proposal Payloads & Catalogs

* **`PBTA_ADVANCE_CATALOG` (PbtA):**
  * `stat_boost` (`maxTimes: 2`, stat cap `+3`)
  * `playbook_move` (`maxTimes: 4`, seeded from `resolveEffectivePbtaGenre()` moves + archetype fallbacks)
  * `cross_playbook_move` (`maxTimes: 2`, sampled from sibling `PBTA_GENRES`)
  * `harm_capacity` (`maxTimes: 1`, cap `8`)
  * `armor_training` (`maxTimes: 1`, cap `3`)
* **`FAE_MILESTONE_CATALOG` (FAE):**
  * `heal_scar` (remove 1 scar or restore `+1` reduced pool max toward baseline)
  * `new_capability` (acquire 1 qualified Positive Tag normalized via `normalizeFaePill()`, rejecting blank tags with `rejected: true`)
  * `hardened_reserve` (increase any Pool Max by `+1` up to hard ceiling `12`, advancing current by `+1`)
* **D&D 5e Proposal:** Carries `targetLevel`, `currentLevel`, `hitDie`, `hpChange: { oldMax, gain, newMax, mode }`, `newFeatures` (passive `[CHARACTER]` traits), `activeAbilities` (`[ABILITIES]`), `spellSlots`, `isAsi`, `asiOptions`, and `partyChanges`.

---

## 3. Feature Normalization, Key Extraction & In-Place Scaling

1. **Identity Keys (`extractFeatureKey()`, `matchesFeatureRemovalTarget()`):**
   * Strips leading bullets and extracts lowercase text before `(`, `:`, or `[` (`"Sneak Attack (2d6)"` $\rightarrow$ `"sneak attack"`).
   * `matchesFeatureRemovalTarget()` checks exact key identity so removing `"Rage"` never removes `"Enrage"` or `"Mindless Rage"`.
2. **In-Place Upgrades & Deduplication (`deduplicateFeatures()`, `mergeUpgradedFeatures()`, `collapseCodexProgression()`):**
   * `deduplicateFeatures()` preserves the first description per canonical key (sheet customization wins on respec).
   * `mergeUpgradedFeatures(baseList, upgradeList)` updates matching canonical keys in place (`Sneak Attack (1d6)` $\rightarrow$ `Sneak Attack (2d6)`) while appending genuinely new keys.
   * `collapseCodexProgression(blueprint, upToLevel)` folds Levels `1..upToLevel` through `mergeUpgradedFeatures()` so Stage 1 $\rightarrow$ Stage 2 respec starts with clean current-tier scaling traits.
3. **Move Template Expansion (`expandGenreMoveTemplate()`):**
   * Expands `"Move Name (+Stat) — trigger"` templates into full `Name (+Stat): When you trigger, roll +Stat. On a 10+ ... On a 7-9 ...` pills normalized via `formatMoveAsPill()` and remaps stat tags when custom stat names differ.

---

## 4. Prompt & Directive Parsing Contract

1. **FAE Milestone Prompt (`buildFaeMilestonePrompt(proposal, dossier)`):**
   * Injects active pools, FAE knobs, positive tags, scars, and the **Trait Qualification Protocol**:
     * **Tier A:** Broad adjectives (`Strong`, `Smart`, `Fast`, `Lucky`, `Tough`) are never rejected; they are qualified with `~25–30%` situational `[context]` brackets.
     * **Tier B:** Only true omnipotence (`Invincible`, `Immortal`) is replaced with a grounded `Trait [context]` alternative.
   * Documents `[ADD_TAG:]`, `[REMOVE_TAG:]`, `[ADD_SCAR:]`, `[REMOVE_SCAR:]`, `[SET_POOL:]`, and `[SET_KNOB:]` directives.
2. **Bracket-Depth Directive Scanner (`extractConciergeDirectives()`, `splitTopLevelDirectives()`):**
   * Scans all `18` known directive tags (`UPDATE_LEVEL`, `SET_HIT_DIE`, `SET_CLASS_NAME`, `ADD_FEATURE`, `UPDATE_FEATURE`, `REMOVE_FEATURE`, `ADD_ABILITY`, `UPDATE_ABILITY`, `REMOVE_ABILITY`, `MOVE_TO_ABILITIES`, `MOVE_TO_FEATURES`, `SET_STAT`, `ADD_TAG`, `REMOVE_TAG`, `ADD_SCAR`, `REMOVE_SCAR`, `SET_POOL`, `SET_KNOB`).
   * Tracks nested `[` / `]` bracket depth so inner tags like `[Trait]` or `[⚡ Ability]` never truncate a directive payload, strips ```` ```json ... "levels" ... ``` ```` code blocks from chat text, and uses `splitTopLevelDirectives()` to avoid splitting `;` inside parenthetical descriptions.

---

## 5. Multi-Engine Resolution & Ruleset Architect Integration (`LVL-003`, `LVL-004`)

1. **PbtA Custom Genre Resolution (`LVL-003` — `resolvePbtaGenreKey()`, `getCanonicalPbtaStats()`, `buildPbtaAdvanceOptions()`):**
   * Checks `PBTA_GENRES` first; if `meta.genre` / `meta.systemKey` is `'custom'` or `dossier.meta.customGenreSpec` is present, returns `'custom'` instead of falling back to `'fantasy'`.
   * Both `getCanonicalPbtaStats()` and `buildPbtaAdvanceOptions()` delegate to `resolveEffectivePbtaGenre(genreKey, overrides)` so Ruleset Architect `customGenreSpec.stats` and `customGenreSpec.moves` drive stat normalization and playbook advance suggestions.
2. **FAE Custom Genre, Turn-0 `dossier.character` & `scenesTarget` (`LVL-004` — `resolveFaeGenreKey()`, `buildFaeMilestoneOptions()`, `formulateLevelUpProposal()`):**
   * `resolveFaeGenreKey()` recognizes `'custom'` / `customGenreSpec` and inspects pools across `protagonist.pools`, `character.pools`, `dossier.pools`, and `dossier.config.pools` (dict or array).
   * `buildFaeMilestoneOptions()` uses `resolveEffectiveFaeGenre()` + `normalizeCustomFaePools()` so baseline pool restoration and suggested tags match custom FAE settings.
   * `formulateLevelUpProposal()` resolves character state across both `dossier.protagonist` and Turn-0 `dossier.character`, guards PbtA genres that share IDs with `FAE_GENRES` (`cosmic_horror`, `survival_horror`, `post_apocalyptic`), reads `scenesTarget` / `scenes_target` / `pacingScenes`, and forwards `customGenreSpec` onto proposals.

---

## 6. Surgical Memo Commit & `WRK-10` Partition Synchronization (`LVL-005`)

Executed by `applyLevelUpCommit()` and shared `applyDossierCommitUpdate()`:

1. **FAE Commit Branch:**
   * Applies unapplied `proposal.faeMilestone`, writes `state.pools`, `state.knobs`, `positive_tags`, `negative_tags`, and `state.character.scenes_target = Number(proposal.pacingScenes) || state.character.scenes_target || 4`.
   * On milestone completion (`!isRespec`), decrements `scenes_completed` by `scenes_target` (clamped at `>= 0`).
   * Re-renders `[CHARACTER]` via `formatFaeCharacterMemoBlock(state)`.
2. **PbtA Commit Branch:**
   * Applies unapplied `proposal.pbtaAdvance`, updates `Stats:` using `getCanonicalPbtaStats(..., { customGenreSpec: proposal.customGenreSpec })`, commits comma-separated pill-formatted `((PILLS)) Moves:`, updates `Harm: cur/max` + tandem descending `curHp/maxHp HP`, updates or appends `Armor: N` (`LVL-005`), and rolls over `XP: cur/max` on advance (`!isRespec`).
   * Syncs both `protagonist.moves` AND `protagonist.startingMoves`, plus `protagonist.harm`, `protagonist.armor`, `protagonist.stats`, and `protagonist.advancesTaken` (`LVL-005`).
3. **D&D 5e Commit Branch:**
   * Updates `Level`, `X/Y HP`, deterministic `HD: die (targetLevel/targetLevel)`, and party companion HP in `[PARTY]`.
   * **Modifier-Aware ASI Application (`applyAsiStatBump()`, `applyAsiToStatsMap()` — `LVL-005`):** Increments both bare scores (`STR 16` $\rightarrow$ `STR 18`) and scores with parenthetical modifiers (`STR 16 (+3)` $\rightarrow$ `STR 18 (+4)`), recalculating `Math.floor((nextScore - 10) / 2)`.
   * Routes passive traits to `[CHARACTER] Traits:` (via `mergeUpgradedFeatures()` on level-up or clean replacement on respec), active powers to `[ABILITIES]`, and slot growth to `[SPELLS]` via `applySpellSlotGrowth()`, updating `[XP]` to the next threshold in `XP_LEVEL_THRESHOLDS`.
4. **Canonical Partition Synchronization & Double-Apply Guard:**
   * `resolveChatPartition()` resolves `cleanId` (stripped `.jsonl` per [WORKAROUNDS.md#wrk-10](../../WORKAROUNDS.md#wrk-10-empty-character-directory-chat-listing-exception-upstream-cleandeletedchatrecords-abort)) first.
   * `syncPartitionDossiers()` updates every attached dossier via `applyDossierCommitUpdate()` and re-links all slots (`companionDossier`, `campaignDossier`, and ruleset partition key) via `setPartitionDossier()`.
   * Returns `_syncedDossiers` so `level-up-ui.js` skips redundant delta mutations when the partition already held `dossier`, preventing double-application of HP or ASI increments.

---

## 7. UI Orchestration & XP Bar Decoration

* `decorateXpBarsForLevelUp()` scans `.rt-xp-row` elements in the RPG tracker panel, adding `.mhc-xp-level-up-ready` and inserting `<span class="mhc-xp-level-up-badge">` whenever `dataset.xpMax > 0 && dataset.xpCurrent >= dataset.xpMax` (triggered on `DOM-08`).
* `level-up-ui.js` Stage 2 Confirm & Apply calls `applyLevelUpCommit()`, conditionally invokes `applyDossierCommitUpdate()` if `dossier` was not already in `_syncedDossiers`, and finishes with `persistCompanionDossier(chatId, dossier)`.

---

## 8. Failure Modes, Guardrails & Audit Fixes (`LVL-003` – `LVL-005`)

| Failure Mode / Audit ID | Guardrail / Remediation Applied |
| :--- | :--- |
| PbtA custom `customGenreSpec` stats & moves ignored in `level-up-runner.js` (`LVL-003`) | Updated `resolvePbtaGenreKey()`, `getCanonicalPbtaStats()`, `buildPbtaAdvanceOptions()`, and `formulateLevelUpProposal()` to return `'custom'` when appropriate and overlay `customGenreSpec` via `resolveEffectivePbtaGenre()`. |
| FAE `customGenreSpec` pools/tags, Turn-0 `dossier.character`, and `scenesTarget` ignored (`LVL-004`) | Routed `resolveFaeGenreKey()`, `buildFaeMilestoneOptions()`, and `formulateLevelUpProposal()` through `resolveEffectiveFaeGenre()` / `normalizeCustomFaePools()`, added `dossier.character` & `scenesTarget` fallbacks, and prevented bare PbtA `cosmic_horror`/`survival_horror`/`post_apocalyptic` memos from misrouting to FAE. |
| PbtA `startingMoves`/`armor` stale & D&D 5e ASI modifiers/dossier stats desynced on commit (`LVL-005`) | Extracted `applyAsiStatBump()`, `applyAsiToStatsMap()`, and shared `applyDossierCommitUpdate()`; synced PbtA `startingMoves` + `armor`, recalculated parenthetical ASI modifiers in `[CHARACTER]`, synced D&D 5e partition dossiers via `setPartitionDossier()`, and prevented double-apply between `applyLevelUpCommit()` and `level-up-ui.js`. |
| Missing `Moves:` or empty `Moves:` line in PbtA `[CHARACTER]` block | `applyLevelUpCommit()` populates empty `Moves:` lines in place and synthesizes `((PILLS)) Moves:` after `Stats:` when missing. |
| Empty or whitespace FAE `new_capability` tag submitted | `applyFaeMilestoneSelection()` sets `rejected: true` and `applied: false` without adding blank pills. |

---

## 9. Code Anchors & Test Coverage

* **Primary Implementation:**
  * [level-up-runner.js](../../level-up-runner.js): `extractFeatureKey`, `deduplicateFeatures`, `mergeUpgradedFeatures`, `collapseCodexProgression`, `ensureNamedFeature`, `splitTopLevelDirectives`, `extractConciergeDirectives`, `matchesFeatureRemovalTarget`, `PBTA_ADVANCE_CATALOG`, `resolvePbtaGenreKey`, `getCanonicalPbtaStats`, `buildPbtaAdvanceOptions`, `applyPbtaAdvanceSelection`, `FAE_MILESTONE_CATALOG`, `resolveFaeGenreKey`, `buildFaeMilestoneOptions`, `applyFaeMilestoneSelection`, `buildFaeMilestonePrompt`, `evaluateLevelUpEligibility`, `formulateLevelUpProposal`, `applyAsiToStatsMap`, `applyDossierCommitUpdate`, `applyLevelUpCommit`, `applySpellSlotGrowth`, `decorateXpBarsForLevelUp`.
  * [level-up-ui.js](../../level-up-ui.js): Stage 2 Confirm & Apply handler delegating to `applyLevelUpCommit()` and `applyDossierCommitUpdate()`.
* **Catalog Anchor:** [FEATURES.md#feat-10](../../FEATURES.md#feat-10-autonomous-level-up-concierge--class-progression-codex)
* **Regression Suites:**
  * [tests/level-up-system.test.js](../../tests/level-up-system.test.js) — Multi-engine eligibility, proposals, dual-block `[CHARACTER]`/`[ABILITIES]`/`[SPELLS]` commits, partition sync, plus Phase 2 regressions for `LVL-003`, `LVL-004`, and `LVL-005`.
  * [tests/fae-milestone-desk.test.js](../../tests/fae-milestone-desk.test.js) — FAE eligibility, all 3 milestone rewards, `extractConciergeDirectives()`, and Trait Qualification Protocol prompt checks.
