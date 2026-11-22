# Contract Sheet: Two-Stage Level-Up / Respec Modal UI & In-Drawer Progression Architect

> **Phase:** 3 — Modal Template Builders, Stage Switching, Live Directive Chat, Confirm & Apply Commit & In-Drawer Progression View  
> **Primary Code:** [level-up-stage-renderers.js](../../level-up-stage-renderers.js), [level-up-ui.js](../../level-up-ui.js), [progression-architect-ui.js](../../progression-architect-ui.js)  
> **Related Catalog Entries:** `FEAT-02`, `FEAT-10`, `WRK-08`, `WRK-10`, `DOM-08`, `DOM-09`

---

## 1. Subsystem Purpose & Ownership Boundary

Phase 3 owns the user-facing interactive surfaces across both the standalone Level-Up / Respec Modal Desk and the Session Zero Step 4 Progression Architect panel:

* **Pure HTML Stage Template Builders (`level-up-stage-renderers.js`):** Constructs escaped HTML fragments for Stage 1 (Class Definition & 1–20 Progression Codex table), Stage 2 D&D 5e Vitality/ASI/Party Sync, PbtA Playbook Advance Picker (`buildPbtaAdvanceSectionHtml()`), FAE Milestone Picker & Knob Tuning (`buildFaeMilestoneAndTuningHtml()`), and full split-pane dialog layout (`buildLevelUpModalHtml()`), plus `normalizeFaeOverflowRule()` (`LVL-006`).
* **Two-Stage Modal Controller (`level-up-ui.js`):** Mounts and tears down `#mhc-level-up-modal` (`openLevelUpModal()`, `closeLevelUpModal()`), streams async homebrew codex generation behind a non-blocking shimmer (`#mhc-blueprint-shimmer`), manages bidirectional Stage 1 $\leftrightarrow$ Stage 2 transitions (`switchStage()`), wires manual Perk/Ability/Tag CRUD + Harmonizer buttons, dispatches Stage 1 & Stage 2 Concierge LLM chat messages (`sendConciergeRequest()`), applies live directives (`ADD_TAG`, `SET_KNOB`, `UPDATE_LEVEL`, `SET_STAT`, `MOVE_TO_ABILITIES`, etc.), and invokes `applyLevelUpCommit()` + `persistCompanionDossier()` on Confirm & Apply.
* **In-Drawer Polymorphic Progression Architect (`progression-architect-ui.js`):** Renders inside the Session Zero / Living World drawer's Progression view across D&D 5e (`renderDndProgression()`), PbtA (`renderPbtaProgression()`), and FAE (`renderFaeProgression()`), delegating ruleset detection to `systemRegistry.detectRuleset()` and custom genre/pacing resolution to Phase 1/2 helpers (`LVL-007`).

**Upstream Boundary (Read-Only):**
* Upstream `SillyTavern-MultihogDnDFramework/` never opens `#mhc-level-up-modal` or imports these files. Companion mounts overlays into `document.body` (triggered via `DOM-08` XP bar badges or `DOM-09` Wand Menu) and writes approved state back through `applyLevelUpCommit()` and `persistCompanionDossier()`.

---

## 2. Data Model & Modal State Contract

* **`openLevelUpModal()` Parameters:** `{ chatId, dossier, blueprint, blueprintPromise = null, targetLevel, isRespec = false, initialStage = null, rpgSettings = null, onComplete = null }`.
* **Initial Stage Routing:**
  * PbtA & FAE always open on **Stage 2** (`currentStage = 2`) with `.mhc-btn-stage-switch` suppressed.
  * D&D 5e honors explicit `initialStage`; otherwise opens **Stage 2** when `activeBlueprint` exists or **Stage 1** when `blueprint` is absent / generating asynchronously (`isLoadingBlueprint = true`).
* **State Tracking Inside Modal Lifecycle:**
  * `proposal`: Initialized via `formulateLevelUpProposal(dossier, activeBlueprint, targetLevel, { isRespec, isPbta, isFae, currentMemo })`, with `[ABILITIES]` seeded from `parsedCurrentSheet.abilities` if omitted.
  * `lastSyncedBlueprintSig`: `blueprintSignature(activeBlueprint)` JSON digest (`[className, hitDie, levels]`) preventing `switchStage(2)` from overwriting Stage 2 user edits unless Stage 1's blueprint actually changed.
  * `expandedTiers` (Modal Stage 1 uses `0..3` for Levels `1–4`, `5–10`, `11–16`, `17–20`; In-Drawer D&D Architect uses `start` keys `1`, `5`, `9`, `13`, `17` across 5 tiers).

---

## 3. HTML Rendering & XSS Escaping Contract (`LVL-006`)

All template builders in [level-up-stage-renderers.js](../../level-up-stage-renderers.js) escape dynamic strings (`characterName`, `className`, `playbookName`, tag pills, feature strings, custom stats, feat names, party companion names) via `escapeHtml()` from `mhc-utils.js`.

* **Trait vs. Ability Badges (`buildBlueprintTableHtml()`):** Uses `classifyFeatureKind()` to tag each 1–20 row entry with `.mhc-kind-trait` (`Trait`) or `.mhc-kind-ability` (`⚡ Ability`), plus Milestone badges (`Archetype Specialization` at Level 3 / `subclass: true`, `ASI or Feat`, `Capstone` at Level 20).
* **FAE Attrition Shift & Overflow Labels (`LVL-006`):**
  * `#mhc_fae_shift_select` displays accurate polarity matching `Attrition = max(0, Threat + 4dF - PosTags + NegTags + GenreShift)`:
    * `-1` $\rightarrow$ `-1 (Pulp / Forgiving Attrition)`
    * `0` $\rightarrow$ `0 (Gritty / Standard)`
    * `+1` $\rightarrow$ `+1 (Brutal / Heavy Attrition)`
  * `#mhc_fae_overflow_select` presents only canonical `handleOverflow()` outcomes: `'scar_and_ko'`, `'scene_fail'`, and `'lethal'` (passing `proposal.knobs.overflow_default` through `normalizeFaeOverflowRule()` so legacy `'gear_loss'` / `'narrative_fail'` map to `'scene_fail'` instead of triggering `OVERFLOW_LETHAL`).
  * `#mhc_fae_flee_grace_chk` describes FAE's zero-pool retreat mechanic (`Escape at 0 Pool with a Scar or gear loss instead of Overflow`).
* **Respec Harmonization Controls:** `.mhc-harmonize-bar` (`#mhc-sync-codex-traits-btn`, `#mhc-restore-sheet-traits-btn`) and `.mhc-trait-origin-badge` (`Harmonized`, `Codex`, `Adventure Sheet`) appear exclusively in D&D 5e Respec mode.

---

## 4. Interactive Concierge Chat & Live Directive Contract

1. **Stage 1 Class Architect (`sendStage1ConciergeMessage()`):**
   * Injects character stats, `hitDie`, `initialSheetFeatures`, `proposal.activeAbilities`, and `formatBlueprintSummary(activeBlueprint, { includeTags: true })`.
   * Executes full JSON code-block replacement via `parseBlueprintFromResponse()` or individual bracket-safe directives (`[UPDATE_LEVEL: ...]`, `[SET_HIT_DIE: ...]`, `[SET_CLASS_NAME: ...]`) via `applyBlueprintDirectivesFromReply()`, then re-renders `#mhc-blueprint-table-container` and persists via `persistCompanionDossier()`.
2. **Stage 2 Guide Concierge (`sendStage2ConciergeMessage()`):**
   * **FAE Mode:** Prompt built by `buildFaeMilestonePrompt(proposal, dossier)`; executes `ADD_TAG`, `REMOVE_TAG`, `ADD_SCAR`, `REMOVE_SCAR`, `SET_POOL` (updating current/max inputs bounded `[1..12]`), and `SET_KNOB` (normalizing `overflow` via `normalizeFaeOverflowRule()`, clamping `shift` to `[-1..1]`, and toggling `#mhc_fae_flee_grace_chk`).
   * **PbtA Mode:** Enforces pure PbtA terminology, executes `ADD_FEATURE` / `UPDATE_FEATURE` (via `formatMoveAsPill()`), `REMOVE_FEATURE`, and `SET_STAT` (clamped `[-2..3]`).
   * **D&D 5e Mode:** Enforces Golden Rule dual-block routing and executes `ADD_FEATURE`, `UPDATE_FEATURE`, `REMOVE_FEATURE`, `ADD_ABILITY`, `UPDATE_ABILITY`, `REMOVE_ABILITY`, `MOVE_TO_ABILITIES`, `MOVE_TO_FEATURES`, plus Stage 1 roadmap overrides via `applyBlueprintDirectivesFromReply()`.

---

## 5. In-Drawer Polymorphic Progression Architect Contract (`LVL-007`)

Implemented in [progression-architect-ui.js](../../progression-architect-ui.js) (`renderProgressionArchitect(container, { dossier, ruleset, onUpdate })`):

* **D&D 5e (`renderDndProgression()`):**
  * Resolves character state across `dossier.protagonist` and `dossier.character`; preserves compatible custom/variant `dossier.progressionBlueprint` objects via `!blueprintMatchesClass(bp, className)` instead of exact string inequality (`LVL-007`).
  * Supports interactive 5-tier accordion toggle, `#mhc_prog_dnd_hitdie` HP recalculation (`hitDieSides + conMod + (lvl - 1) * avgGain`, clamped `>= 1`), and `#mhc_prog_seed_srd_btn` fallback seeding.
* **PbtA (`renderPbtaProgression()`):**
  * Resolves `genreKey = resolvePbtaGenreKey(dossier)` and `genreObj = resolveEffectivePbtaGenre(genreKey, dossier)`.
  * Renders canonical stats via `getCanonicalPbtaStats(..., dossier)` (honoring `customGenreSpec.stats`), active/starting/genre moves across `protagonist` and `dossier.character`, `Harm Track: harmCur/harmMax`, `Armor: armor`, and custom `dossier.config.pacingXp` (`Every N XP` / `XP N/N`) (`LVL-007`).
* **FAE (`renderFaeProgression()`):**
  * Resolves `genreKey = resolveFaeGenreKey(dossier)` and `genreObj = resolveEffectiveFaeGenre(genreKey, dossier)`.
  * Reads Turn-0 `dossier.character` fields (`archetype`, `pools`, `positive_tags`, `negative_tags`, `heroic_domain`, `scenes_target`), normalizes config pools via `normalizeCustomFaePools()`, displays custom `scenesTarget` pacing (`N Scenes / Milestone`), and renders Heroic Domain, Positive Tags, and `(-)` Scars/Debuffs (`LVL-007`).

---

## 6. Confirm & Apply Commit & Mode-Switcher Contract

1. **Header Mode Switcher (`.mhc-mode-nav-btn`):**
   * `living-world` button visibility is hydrated asynchronously from `loadActiveCampaignDossier(chatId)`.
   * Clicking `living-world` or `new-adventure` stores `mhc_last_concierge_desk` in `sessionStorage`, closes `#mhc-level-up-modal`, and opens `openConciergeModal({ ruleset, navMode })` with a `300ms` double-click guard (`_isLevelUpNavigating`).
2. **Confirm & Apply Handler (`#mhc-confirm-apply-btn`):**
   * Reads active UI selections (FAE milestone radio + scar/pool/tag inputs, PbtA advance radio + stat/move inputs, D&D ASI/Feat radio + `#mhc_party_sync_chk`, HP gain).
   * Calls `applyLevelUpCommit({ chatId, currentMemo, proposal, isRespec, rpgSettings })`.
   * On `success`: conditionally calls `applyDossierCommitUpdate(dossier, proposal, { isRespec, currentHpGain })` **only** if `!commitResult._syncedDossiers?.has(dossier)` (`LVL-005`), persists via `persistCompanionDossier(chatId, dossier)`, emits `toastr.success()`, closes the modal, and invokes `onComplete(commitResult)`.

---

## 7. Async Blueprint Shimmer & UI Gating Contract

* **Instant Modal Mount:** When `blueprintPromise` is pending on a homebrew D&D class, Stage 1 mounts immediately with `#mhc-blueprint-shimmer`, `stage1Input.disabled = true`, `stage1SendBtn.disabled = true`, and `#mhc-stage1-typing` visible.
* **Settled Promise Guard:** Resolves/catches check `if (!_activeModalElement || _activeModalElement !== modal) return;` before touching DOM nodes so closing or reopening the modal never mutates an orphaned instance.
* **Send Lock & Fallback:** Both Stage 1 and Stage 2 chat senders disable inputs/buttons during `await sendConciergeRequest(messages)` and re-enable cleanly inside both `try` and `catch`, appending a non-blocking fallback notice on error.

---

## 8. Failure Modes, Guardrails & Audit Fixes (`LVL-006`, `LVL-007`)

| Failure Mode / Audit ID | Guardrail / Remediation Applied |
| :--- | :--- |
| Inverted FAE Shift labels & invalid `gear_loss`/`narrative_fail` overflow modes (`LVL-006`) | Fixed `-1 (Pulp / Forgiving Attrition)` vs `+1 (Brutal / Heavy Attrition)` polarity and Flee Grace description in `level-up-stage-renderers.js`; replaced invalid overflow options with `scene_fail`, and shared `normalizeFaeOverflowRule()` between renderer and `level-up-ui.js` `SET_KNOB` handler. |
| In-drawer Progression Architect ignores `customGenreSpec`, `dossier.character`, `pacingXp`, `scenesTarget`, and `blueprintMatchesClass()` (`LVL-007`) | Updated `progression-architect-ui.js` to check `blueprintMatchesClass()`, delegate PbtA/FAE resolution to `resolveEffectivePbtaGenre()`, `resolveEffectiveFaeGenre()`, `normalizeCustomFaePools()`, and `getCanonicalPbtaStats()`, read Turn-0 `dossier.character` fields, and display custom pacing triggers. |
| Concierge modal left open on reload or reopened repeatedly | `openLevelUpModal()` always calls `closeLevelUpModal()` first to tear down any prior backdrop instance before mounting to `document.body`. |
| Uninitialized `dossier` or missing `dossier.protagonist` when Confirm runs | `level-up-ui.js` delegates directly to `applyDossierCommitUpdate(dossier, proposal, ...)` whenever `dossier` was not already updated via `commitResult._syncedDossiers`. |

---

## 9. Code Anchors & Test Coverage

* **Primary Implementation:**
  * [level-up-stage-renderers.js](../../level-up-stage-renderers.js): `normalizeFaeOverflowRule`, `buildPbtaAdvanceSectionHtml`, `buildDndAsiAndPartyHtml`, `buildFaeMilestoneAndTuningHtml`, `buildLevelUpModalHtml`, `buildBlueprintTableHtml`.
  * [level-up-ui.js](../../level-up-ui.js): `closeLevelUpModal`, `openLevelUpModal` (plus re-exports of the 5 renderer builders).
  * [progression-architect-ui.js](../../progression-architect-ui.js): `renderProgressionArchitect` (`renderDndProgression`, `renderPbtaProgression`, `renderFaeProgression`).
* **Catalog Anchors:** [FEATURES.md#feat-10](../../FEATURES.md#feat-10-autonomous-level-up-concierge--class-progression-codex), [FEATURES.md#feat-02](../../FEATURES.md#feat-02-concierge-session-zero--living-world-dossier)
* **Regression Suites:**
  * [tests/level-up-system.test.js](../../tests/level-up-system.test.js) — Async shimmer, two-stage transitions, `[ABILITIES]` sync, renderer XSS/HTML builders, and Phase 3 `LVL-006` knob/overflow verification.
  * [tests/concierge-progression-codex.test.js](../../tests/concierge-progression-codex.test.js) — D&D 5e CON boundary hardening, PbtA/FAE in-drawer cards, and Phase 3 `LVL-007` custom genre / `dossier.character` / pacing tests.
  * [tests/fae-milestone-desk.test.js](../../tests/fae-milestone-desk.test.js) — Full `openLevelUpModal()` FAE isolation verification.
