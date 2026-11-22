# Stage 4 Contract Sheet: Protagonist & Progression Codex (`👤 Character`)

Parent hub: [README.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/README.md) · Cross-cutting spine: [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md) · Upstream: [stage-3-adventure.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/stage-3-adventure.md)

---

## 1. Entry & Exit Conditions

* **Unlock Gate (`evaluateStepUnlocks()` in [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):** Unlocks when `activeDossier.meta.rulesetConfirmed === true` AND Episode 1 has content (`theKick.crisis`, `theKick.startingLocation`, `maps.length`, `monsters.length`, or `npcs.length`).
* **Entry Paths in `setAdventureStep('character')` ([concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):**
  1. **First Visit (`!stageChatHistories.character?.length`):** Captures baseline `lastSyncedSnapshots.adventure` and `lastSyncedSnapshots.canon`, clears chat, renders Step 4 welcome greeting referencing `meta.title` and `theKick.startingLocation`, and invites the player to describe a concept, pick an ST persona/character card, or customize `📜 Progression Codex`.
  2. **Re-Visit with Upstream Changes (`(canonDiff.hasChanges || advDiff.hasChanges) && !opts.skipHarmonization`):** Concatenates `[UPSTREAM_CANON_DIFF]` and `[UPSTREAM_ADVENTURE_DIFF]`, runs `runStageHarmonizationPass('character', { upstreamDiff: combinedDiff })` (now showing `#mhc_typing_indicator` and saving diagnostics/draft per `CONC-019`), and updates baseline snapshots.
  3. **Re-Visit with No Upstream Diff:** Restores `stageChatHistories.character`.
* **Exit Gate (Campaign Launch Readiness — `CONC-016`):** `#mhc_launch_campaign_btn` (`🚀 Finalize & Launch Campaign`) enables only when `!isGenerating && unlockedSteps.character && Boolean(activeDossier?.protagonist?.name?.trim())` in `new-adventure` mode.

---

## 2. Code Surface

| Area | File & Symbol(s) | Responsibility |
| :--- | :--- | :--- |
| **Step 4 Controller & Intake** | [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js) (`setAdventureStep`, `runStageHarmonizationPass`, `runStageAutoPass`, `runDelegatedGameSystemDesign`, `attachCharacterCardToSession`, `evaluateStepUnlocks`, launch & wizard click handlers) | Step 4 lifecycle, combined harmonization, ST card/image intake, Game System Wizard delegation, Launch gate |
| **Stage 4 Prompts** | [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildStage4CharacterBuilderPrompt`, `buildStage4CharacterTalkerPrompt`, `DESIGN_GAME_SYSTEM_DIRECTIVE`, `CUSTOM_MODULE_SCHEMA`, `formatStageContinuityBrief`) | PbtA / FAE / D&D 5e protagonist schemas, custom tracker delegation, cross-tab back-edit nudges |
| **Protagonist & Module Parser** | [concierge-parser.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-parser.js) (`protagonistBlocks`, `customModuleBlocks`, `[DESIGN_GAME_SYSTEM]`, `[REMOVE_CUSTOM_MODULE]`) | Parses stats, moves, features, abilities, gear, FAE tags/pools/heroicDomain, and custom tracker requests |
| **Game System Wizard Bridge** | [game-system-bridge.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/game-system-bridge.js) (`generateBlueprintGameSystemViaWizard`, `mapWizardDraftToCustomModule`, `openBlueprintGameSystemInWizard`) | Delegates `[DESIGN_GAME_SYSTEM]` to MultiHog's native Game System Wizard and supports in-drawer Wizard editing (`DOM-12`) |
| **Progression & Deck UI** | [progression-architect-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/progression-architect-ui.js) (`renderProgressionArchitect`), [concierge-deck-renderer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-deck-renderer.js), [concierge-modal.html](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-modal.html) | Renders Protagonist card, Custom HUD Tracker card, `📜 Progression Codex` tab, and Launch footer |

---

## 3. LLM Pass Flow

1. **Interactive Step 4 Turn (`handleUserSend`):**
   * `setConciergeBusyState(true)` dims stepper/header/toolbar controls and shows `#mhc_typing_indicator` + `#mhc_stop_btn` before calling LLM.
   * Attachments allowed in Step 4 include portraits (`image` -> sets `protagonist.portraitSrc` + vision payload) and ST character cards (`attachCharacterCardToSession` -> injects `formatCharacterInspirationBlock`).
   * **Agent 1 (`buildStage4CharacterBuilderPrompt`, max 2 attempts):** Emits `[UPDATE_DOSSIER] ... [/UPDATE_DOSSIER]` with `[PROTAGONIST] ... [/PROTAGONIST]` and optional `[DESIGN_GAME_SYSTEM: <concept>]` / `[REMOVE_CUSTOM_MODULE]`, or `[NOOP]`.
   * **NameRAG (`resolveDossierNamePlaceholders`):** Resolves `[[NAME: ...]]` when the player did not specify an exact protagonist name.
   * **`applyDossierUpdates()`:** Patches only supplied protagonist subfields (preserving unchanged moves/gear/stats across partial turns) and validates `worldRules.customModule` updates/removals.
   * **Stage 1a-ter (`runDelegatedGameSystemDesign`, max 1×/turn):** If `builderReport.designGameSystem` is non-empty (and non-sentinel `CONC-002`), invokes MultiHog's Game System Wizard sub-agent and saves `worldRules.customModule`.
   * **Stage 1b Judge (`shouldRunContemplativeJudgePass`):** Active in Step 4; evaluates initial protagonist creation, attachments, or `>= 3`-category turns and triggers Pass 2 Refiner when `shouldRevise === true`.
   * **Agent 2 (`buildStage4CharacterTalkerPrompt`):** Receives `[APPLIED_BLUEPRINT_CHANGES: ...]` (`CONC-008`), refers to Protagonist by exact established name, and reminds player when ready that `#mhc_launch_campaign_btn` (`🚀 Finalize & Launch Campaign`) is available.
2. **Harmonization Turn (`runStageHarmonizationPass('character')`):** Runs when re-entering Step 4 after editing Step 2 or Step 3; shows `#mhc_typing_indicator`, invokes Step 4 Builder + NameRAG + `applyDossierUpdates()` + optional `runDelegatedGameSystemDesign()`, logs Debug transaction, and refreshes deck + draft (`CONC-019`).

---

## 4. Prompt ↔ Parser ↔ UI Matrix

| Directive / Tag | Prompted in `buildStage4CharacterBuilderPrompt`? | Parsed in `concierge-parser.js`? | Mutates State? | Rendered in UI? | Gaps Found |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `[PROTAGONIST] ... [/PROTAGONIST]` (PbtA) | Yes (`name`, `playbook`, `species`, `gender`, `stats`, `starting_moves`, `gear`, `harm`) | Yes (`protagonistBlocks`) | `dossier.protagonist` | 👤 Protagonist card + Codex tab | `CONC-020`: added closing `[/PROTAGONIST]` & `[/UPDATE_DOSSIER]` |
| `[PROTAGONIST] ... [/PROTAGONIST]` (FAE) | Yes (`name`, `archetype`, `positive_tags`, `negative_tags`, `heroic_domain`, `pools`) | Yes (`sanitizeFaePositiveTags`, pool parser) | `dossier.protagonist` & `pools` | 👤 Protagonist card (tags/pools/domain badges) | `CONC-020`: aligned schema example |
| `[PROTAGONIST] ... [/PROTAGONIST]` (D&D 5e) | Yes (`name`, `class`, `species`, `hp`, `ac`, `hitDie`, `stats`, `features`, `abilities`, `equipment`) | Yes | `dossier.protagonist` | 👤 Protagonist card (HP/AC/stats/gear) | `CONC-020`: aligned schema example |
| `[DESIGN_GAME_SYSTEM: <concept>]` | Yes (single delegation protocol) | Yes (`report.designGameSystem`, filtered `CONC-002`) | `runDelegatedGameSystemDesign()` -> `worldRules.customModule` | 📟 Custom HUD Tracker card | `CONC-020`: removed conflicting `Optional [CUSTOM_MODULE]` wording |
| `[REMOVE_CUSTOM_MODULE]` / `[REMOVE_GAME_SYSTEM]` | Yes (`DESIGN_GAME_SYSTEM_DIRECTIVE`) | Yes | Sets `worldRules.customModule = null` | Hides `#mhc_deck_custom_module_card` | Closed |
| `[CUSTOM_MODULE]` (legacy fallback) | Not primary (delegated via Wizard) | Yes (supported for backward compatibility & raw imports) | `worldRules.customModule` | 📟 Custom HUD Tracker card | Documented compatibility |
| `[MAP]` / `[MONSTER]` / `[NPC]` / `[FACTION]` / `[KICK]` | Strictly forbidden ("Do NOT re-emit or alter") | Parsed globally if emitted | Avoided by Step 4 prompt boundaries | Previous cards hidden in Step 4 UI | Closed (`CONC-020`) |

---

## 5. Context In & Handoff Out

* **Context In (`formatStageContinuityBrief({ stage: 'character' })`):** Injects Campaign Foundation (including `Active Stats` and `Available Archetypes / Playbooks` from Step 3 `Ruleset Architect`), all three `stageNotes` memos (`framing`, `canon`, `adventure`), Series Bible + World Axioms, Episode 1 Adventure state (`theKick`, maps, monsters, npcs, factions), current `Protagonist` sheet (marked `AUTHORITATIVE GROUND TRUTH`), active `Custom Tracker Module`, and any `[UPSTREAM_DIFF]`.
* **Handoff Out to Campaign Launch (`concierge-runner.js`):**
  * Complete `activeDossier` (`meta`, `config`, `worldRules` incl. `customModule`, `progressionBlueprint` edited in Codex tab, `protagonist`, `theKick`, `maps`, `monsters`, `npcs`, `factions`) + `getStagedCanonEntries()`.
  * Verified via `CONC-016` launch gate that `protagonist.name` is non-empty before `🚀 Finalize & Launch Campaign` enables.

---

## 6. Invariants & Guardrails

1. **Stage 4 Isolation (`[PROTAGONIST]`-Only Edits):** Prompt strictly forbids modifying `[KICK]`, `[MAP]`, `[MONSTER]`, `[NPC]`, or `[FACTION]`, instructing Talker to direct players back to `🗺️ Adventure` or `📚 Canon` for world/crisis changes.
2. **Additive/Partial Protagonist Patching:** Tweaking one field (e.g., renaming the protagonist or changing one move/gear item) updates only those keys on `dossier.protagonist` instead of wiping stats, pools, or progression blueprints.
3. **Progression Codex Sync:** Opening `📜 Progression Codex` (`renderProgressionArchitect`) edits `activeDossier.progressionBlueprint` live without disrupting ongoing conversation state.
4. **Launch Safety Guard (`CONC-016`):** Clicking `#mhc_launch_campaign_btn` while `isGenerating`, outside Step 4 unlock, or without a named protagonist is blocked both visually (`disabled`) and programmatically inside the click handler.

---

## 7. Audit Findings Log (Stage 4)

| ID | Issue Found | Fix Applied | Regression Test |
| :--- | :--- | :--- | :--- |
| `CONC-002`, `CONC-005`, `CONC-008` | Sentinel `none` on `[DESIGN_GAME_SYSTEM]`, missing `[GAME_SYSTEM]`/`[REMOVE_CUSTOM_MODULE]` in lexer, Talker ungrounded claims | Fixed in Phase 0 & Phase 1 (documented in [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md)) | `tests/concierge-stage-scoped.test.js` |
| `CONC-015` | `#mhc_header_system_badge` silently called `switchRulesetMode()` in Step 4, wiping protagonist & campaign without confirmation; ST pickers unlocked while generating | Badge now shows safe info toast in `new-adventure`; badge & ST pickers added to `setConciergeBusyState()` (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-016` | `#mhc_launch_campaign_btn` enabled immediately on Step 4 entry even with `protagonist.name === ''` | Gated `#mhc_launch_campaign_btn` on `unlockedSteps.character && Boolean(protagonist.name)` + explanatory tooltip (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-019` | `runStageHarmonizationPass('character')` showed no `#mhc_typing_indicator`, ignored `designGameSystem`, skipped Debug trace & `saveDraft()`; `runStageAutoPass('character')` hardcoded Step 3 text | Made both helpers stage-aware with `#mhc_typing_indicator`, diagnostics, `designGameSystem`, and `saveDraft()` (`concierge-ui.js`) | Verified in code & full test suite |
| `CONC-020` | `buildStage4CharacterBuilderPrompt()` contradicted `DESIGN_GAME_SYSTEM_DIRECTIVE` (`Optional [CUSTOM_MODULE]` vs `[DESIGN_GAME_SYSTEM]`) and omitted closing `[/UPDATE_DOSSIER]` & `[/PROTAGONIST]` tags | Updated all three ruleset examples and protocol bullets in `concierge-prompt.js` | `tests/concierge-stage-scoped.test.js` |
| `CONC-025`, `CONC-026` | Pass 2 Refiner (`buildConciergeRefinerContext`) in Step 4 used legacy `buildConciergeBuilderContext()` without `stagedCanonEntries`, and both Critic & Refiner lacked a `stage === 'character'` scope boundary preventing edits to Step 3 `[NPC]`/`[MONSTER]`/`[MAP]`/`[KICK]` | Routed Step 4 Pass 2 Refiner through `buildStage4CharacterBuilderPrompt(activeDossier, canonEntries)`, added `STEP 4: CHARACTER STAGE SCOPE BOUNDARY` to Critic & `STRICT STAGE 4 BOUNDARY` to Refiner, and wired Pass 2 `designGameSystem` delegation (`concierge-prompt.js`, `concierge-ui.js`) | `tests/concierge-stage-scoped.test.js` |

---

## 8. UI Controls, Button Gating & Immediate Pre-Inference Feedback

| Control (`concierge-modal.html` / `concierge-ui.js`) | Enabled When | Locked During Inference? | Immediate Pre-Inference Visual Feedback? | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| `#mhc_step_btn_initial`, `#mhc_step_btn_canon`, `#mhc_step_btn_adventure` | Unlocked (`initial`/`canon`/`adventure` already unlocked before reaching Step 4) | Yes (`setConciergeBusyState` + `isGenerating` guard) | Dimmed during Step 4 generation & Wizard runs | Closed (`CONC-007`) |
| `#mhc_pick_st_char_btn`, `#mhc_pick_st_lore_btn` | Enabled when idle (`!isGenerating`) | Yes (`setConciergeBusyState` + `isGenerating` guard `CONC-015`) | Toggles picker dropdown; import progress overlay shown during card/lore processing | Closed (`CONC-015`) |
| `#mhc_header_system_badge` | Visible when `rulesetConfirmed === true` | Yes (`setConciergeBusyState` + `isGenerating` guard) | Non-destructive toast directing users back to Step 3 to switch engines safely | Closed (`CONC-015`) |
| `#mhc_tab_progression_btn`, `#mhc_open_codex_tab_btn` | Shown in Step 4 (`concierge-deck-renderer.js`) | Safe tab switch (client-side Codex UI) | Switches immediately to `#mhc_tab_progression` and renders `renderProgressionArchitect()` | None |
| `#mhc_deck_edit_wizard_btn` (`DOM-12`), `#mhc_deck_remove_custom_mod_btn` | Shown when `worldRules.customModule` exists | Wizard opens native modal async | Immediate Wizard modal or synchronous card removal + `saveDraft()` | None |
| `#mhc_send_btn` | `!isGenerating && (text \|\| attachments)` | Yes | Shows `#mhc_stop_btn` and `#mhc_typing_indicator` (plus Wizard sub-stage status if triggered) | Closed |
| `#mhc_launch_campaign_btn` (`🚀 Finalize & Launch Campaign`) | `!isGenerating && unlockedSteps.character && Boolean(protagonist.name)` | Yes (`setConciergeBusyState` + `isGenerating` guard) | Disabled with tooltip (`Complete Step 4 (Character) with a named protagonist to launch.`) until ready; opens empty-cast/conflict modal or Launch Progress Overlay immediately on click | Closed (`CONC-016`) |

---

## 9. Multi-Turn Refinement (`N`-Turn) Invariants

1. **Unbounded Character Iteration:** Players can spend **0, 1, 2, or N** turns revising backstory, swapping gear, tuning moves/tags/pools, attaching a portrait, or refining `customModule` without resetting Episode 1 state.
2. **Idempotent Custom Tracker Lifecycle:** Across multiple turns, a `[DESIGN_GAME_SYSTEM]` tracker can be created, edited manually via `#mhc_deck_edit_wizard_btn` (`DOM-12`), replaced by a new `[DESIGN_GAME_SYSTEM]`, or removed via `[REMOVE_CUSTOM_MODULE]` / `#mhc_deck_remove_custom_mod_btn`.
3. **Round-Trip Back-Edit Harmonization (`Step 4 -> Step 3 -> Step 4`):** Navigating back to Step 3, tuning the ruleset or modifying `[KICK]`/`[MONSTER]`/`[FACTION]`, and returning to Step 4 computes an accurate `computeAdventureDiff()` (`CONC-018`) and executes `runStageHarmonizationPass('character')` cleanly with visible feedback (`CONC-019`), preserving prior Step 4 conversation integrity once harmonized.
