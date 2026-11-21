# Stage 3 Contract Sheet: Adventure Stage Set & Ruleset Engine (`🗺️ Adventure`)

Parent hub: [README.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/README.md) · Cross-cutting spine: [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md) · Upstream: [stage-2-canon.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/stage-2-canon.md) · Downstream: [stage-4-character.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/stage-4-character.md)

---

## 1. Entry & Exit Conditions

* **Unlock Gate (`evaluateStepUnlocks()` in [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):** Unlocks only after `unlockedSteps.canon === true` AND `(stagedCanonEntries.length > 0 || worldRules.axioms.length > 0)` (`CONC-010`).
* **Entry Paths in `setAdventureStep('adventure')` ([concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):**
  1. **Ruleset Unconfirmed (`!activeDossier.meta.rulesetConfirmed`):** Shows the Ruleset Picker (`#mhc_header_ruleset_toggle`: **D&D Lite**, **PbtA**, **FAE**) inside `.mhc-card-system` and restores `stageChatHistories.adventure` (without firing an LLM call until a ruleset card/button is clicked).
  2. **First Ruleset Selection (Case A in `.mhc-ruleset-card / .mhc-ruleset-btn` click):** Locks modal via `setConciergeBusyState(true)`, sets `meta.ruleset` + `meta.rulesetConfirmed = true` + adapter defaults, reveals `.mhc-chat-column`, appends `#mhc_typing_indicator`, calls `runRulesetArchitect()` + `applyRulesetArchitectResult()`, and runs `runStageAutoPass('adventure', ...)` to seed Episode 1 (`[KICK]`, `[MAP]`, `[MONSTER]`, `[NPC]`, `[FACTION]`, `[CONFIG]`).
  3. **Confirmed Ruleset Switch (Case B in `.mhc-ruleset-card / .mhc-ruleset-btn` click):** Prompts `showConciergeConfirm()` (`🔄 Switch Ruleset Engine?`), extracts ruleset-agnostic state via `extractAgnosticAdventureBones()` (preserving framing `meta`, `stageNotes`, `worldRules`, `theKick`, `maps`, `npcs`, `monsters`, and `factions` — `CONC-018`), creates fresh target ruleset dossier, runs `runRulesetArchitect()`, and calls `runStageAutoPass('adventure', ..., { agnosticBones })`.
  4. **Canon Diff Return (`rulesetConfirmed && canonDiff?.hasChanges && !opts.skipHarmonization`):** Calls `runStageHarmonizationPass('adventure', { upstreamDiff: canonDiff.block })` to reconcile Episode 1 entities with updated Step 2 Canon or World Rules, then syncs `lastSyncedSnapshots.canon`.
  5. **Subsequent Return (No Canon Diff):** Restores `stageChatHistories.adventure`.
* **Exit / Step 4 Unlock:** `unlockedSteps.character` unlocks when `meta.rulesetConfirmed === true` AND Episode 1 content exists (`theKick.crisis`, `theKick.startingLocation`, `maps.length`, `monsters.length`, or `npcs.length`).

---

## 2. Code Surface

| Area | File & Symbol(s) | Responsibility |
| :--- | :--- | :--- |
| **Step 3 Controller & Flows** | [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js) (`setAdventureStep`, `runStageAutoPass`, `runStageHarmonizationPass`, `refreshAdventureStageNote`, `setConciergeBusyState`, ruleset card & `DOM-13` `⚙️ Tune Ruleset` handlers) | Ruleset gate, auto-pass, harmonization, manual `⚙️ Tune Ruleset`, busy locking, calibration dial clicks |
| **Ruleset Architect** | [concierge-ruleset-architect.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ruleset-architect.js) (`runRulesetArchitect`, `buildRulesetArchitectPrompt`, `parseRulesetArchitectOutput`, `inferFallbackGenreFromContext`) | Selects preset or generates `customGenreSpec` (stats/pools, archetypes, signature moves, `maxHarmFate`) |
| **System Adapters** | [concierge-system-pbta.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-pbta.js), [concierge-system-fae.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-fae.js), [concierge-system-dnd5e.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-dnd5e.js), [concierge-system-registry.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-registry.js) | Per-ruleset defaults, deck dials rendering, Critic instructions |
| **Stage 3 Prompts** | [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildStage3AdventureBuilderPrompt`, `buildStage3AdventureTalkerPrompt`, `buildConciergeCriticContext`, `buildConciergeRefinerContext`) | Ruleset-scoped `[MONSTER]`/`[MAP]`/`[KICK]`/`[CONFIG]` directives & removals |
| **Parser & Snapshots** | [concierge-parser.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-parser.js), [concierge-canon.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-canon.js) (`snapshotAdventure`, `computeAdventureDiff`, `extractAgnosticAdventureBones`), [concierge-markdown-codec.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-markdown-codec.js) | Entity & removal parsing, map `threat:`/`danger:` normalization, Stage 1b Judge gating |
| **Blueprint Deck UI** | [concierge-deck-renderer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-deck-renderer.js), [concierge-modal.html](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-modal.html) | Ruleset picker, engine summary, dial pills, NPC/Monster/Map/Faction/Kick cards |

---

## 3. LLM Pass Flow

1. **Initial / Switch Auto-Pass (`runRulesetArchitect` → `runStageAutoPass('adventure')`):**
   * `runRulesetArchitect()` calibrates `systemKey`, `systemLabel`, and optional `customGenreSpec`.
   * Builder Pass (`buildStage3AdventureBuilderPrompt`) scaffolds `[CONFIG]`, `[KICK]`, `[MAP]`, `[MONSTER]`, `[NPC]`, `[FACTION]` → NameRAG resolution → `applyDossierUpdates()` → `refreshAdventureStageNote()`.
   * Talker Pass (`buildStage3AdventureTalkerPrompt` + `buildTalkerInstructionNotice`) summarizes Episode 1 setup.
2. **Interactive Step 3 Refinement Turn (`handleUserSend`):**
   * `setConciergeBusyState(true)` + `#mhc_typing_indicator` + `#mhc_stop_btn` shown immediately.
   * **Agent 1 (`buildStage3AdventureBuilderPrompt`, max 2 attempts):** Emits `[UPDATE_DOSSIER] ... [/UPDATE_DOSSIER]` or `[NOOP]`.
   * **NameRAG (`resolveDossierNamePlaceholders`):** Resolves `[[NAME: ...]]` placeholders for newly invented unnamed characters while keeping Canon NPC names verbatim.
   * **`applyDossierUpdates()` + `refreshAdventureStageNote()`:** Applies additions, partial patches, removals, and dial changes (`CONC-001`–`CONC-003`, `CONC-017`, `CONC-019`).
   * **Stage 1a-bis (`[RECALIBRATE_RULESET]`, max 1×/turn):** If present (and non-sentinel `CONC-002`), runs `runRulesetArchitect({ tweakRequest })`, applies result, and re-runs Builder + NameRAG + `applyDossierUpdates()` with `[RULESET_ARCHITECT_UPDATED: ...]`.
   * **Stage 1b Judge & Pass 2 Refiner (`shouldRunContemplativeJudgePass`):** Triggered on initial scaffold, attachments, or `>= 3` touched categories (`CONC-009` counts `FAE Encounter`). If Critic `shouldRevise` is true, runs Pass 2 Refiner + NameRAG + `applyDossierUpdates()`.
   * **Agent 2 (`buildStage3AdventureTalkerPrompt`):** Receives `[APPLIED_BLUEPRINT_CHANGES: ...]` (`CONC-008`) and replies in-characterless facilitator voice.
3. **Manual Recalibration (`DOM-13` `⚙️ Tune Ruleset`):** Prompts for optional `tweakRequest`, runs `runRulesetArchitect()` directly, updates `activeDossier.meta`, deck, and draft (next visit to Step 4 picks up `systemKey`/`systemLabel` change via `CONC-018` `computeAdventureDiff()`).

---

## 4. Prompt ↔ Parser ↔ UI Matrix

| Directive / Tag | Prompted in `buildStage3AdventureBuilderPrompt`? | Parsed in `concierge-parser.js`? | Mutates State? | Rendered in UI? | Gaps Found |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `[CONFIG]` | Yes (D&D/FAE/PbtA concrete values) | Yes (filters pipe templates `CONC-002`) | `dossier.config` & `knobs` | Calibration Dials card & pills | Closed |
| `[KICK]` | Yes (`starting_location`, `crisis`, `opening_prompt`) | Yes | `dossier.theKick` + `meta.stageNotes.adventure` (`CONC-019`) | ⚡ The Kick card | Closed |
| `[MAP: Site]` | Yes (`kind:` + `threat:` after `CONC-017`) | Yes (`threat \|\| danger` + synonym normalization) | `dossier.maps[]` | 🗺️ Queued Maps card | `CONC-017`: `danger:` vs `threat:` fixed |
| `[MONSTER: Name]` | Yes (ruleset-specific stats: HP/AC/CR, Threat/Layers, Harm/Armor) | Yes | `dossier.monsters[]` (routed to `_Bestiary`) | 👹 Queued Adversaries card | `CONC-009`: Judge now counts `FAE Encounter` |
| `[NPC: Name]` | Yes | Yes | `dossier.npcs[]` (clean/NameRAG match) | 👥 Allies & Supporting NPCs card + sliders | Closed (`CONC-006` heals dupes) |
| `[FACTION: Name]` | Yes | Yes | `dossier.factions[]` (`agenda`, `standing`, `notes`) | 🚩 Factions card | `CONC-018`: preserved across switch & diff |
| `[CYOA]` | Yes (optional) | Yes | `dossier.cyoaExamples[]` | Passed to Launch opening Turn 1 | None |
| `[REMOVE_MONSTER/NPC/MAP/FACTION]` / `[CLEAR_MONSTERS/NPCS/MAPS/FACTIONS]` | Yes (`CONC-001`) | Yes (block, inline, `action: remove`) | Filters target array in place | Removes card immediately | Closed (`CONC-001`) |
| `[RECALIBRATE_RULESET: desc]` | Yes (when user requests genre/stat tweak) | Yes (ignores sentinels `none`/`n/a` `CONC-002`) | Triggers Ruleset Architect sub-agent | Updates engine badge & specs summary | Closed (`CONC-002`, `CONC-004`) |
| `[PROTAGONIST]` | Forbidden ("NEVER emit `[PROTAGONIST]` here") | Supported globally | Guarded by Stage 3 prompt boundary | Protagonist card stays hidden in Step 3 | None |

---

## 5. Context In & Handoff Out

* **Context In:** `formatStageContinuityBrief({ stage: 'adventure' })` injects Campaign Foundation (title, premise, focal lens, tone, active ruleset + `Active Stats` / `Available Archetypes`), `stageNotes.framing` & `stageNotes.canon`, active + deferred Canon entries, World Axioms, current Episode 1 elements, plus optional `[UPSTREAM_CANON_DIFF]` and `[AGNOSTIC_ADVENTURE_BONES]`.
* **Handoff Out to Step 4 (`👤 Character`):**
  * Confirmed ruleset (`meta.ruleset`, `systemKey`, `systemLabel`, `customGenreSpec`) and calibration dials (`config`).
  * Staged Episode 1 cast/locations/crisis (`theKick`, `maps`, `monsters`, `npcs`, `factions`) and `meta.stageNotes.adventure`.
  * `lastSyncedSnapshots.adventure = snapshotAdventure(activeDossier)` (now including `systemKey`, `systemLabel`, and `factions` per `CONC-018`) so any Step 3 back-edits trigger Step 4 harmonization cleanly.

---

## 6. Invariants & Guardrails

1. **Adversary vs. NPC Separation:** `[MONSTER]` entities stay in `dossier.monsters[]` (routed to `{prefix}_Bestiary` and Map Architect threat briefs), never polluting `dossier.npcs[]`.
2. **Non-Destructive Header Badge (`CONC-015`):** Clicking `#mhc_header_system_badge` during Session Zero never calls destructive `switchRulesetMode()`; ruleset changes always go through Step 3's confirmed `.mhc-ruleset-card / .mhc-ruleset-btn` workflow.
3. **Talker Truth Grounding (`CONC-008`):** After Builder mutations, `buildTalkerInstructionNotice()` passes `[APPLIED_BLUEPRINT_CHANGES: ...]` so Talker only announces entities/removals verified by `applyDossierUpdates()`.

---

## 7. Audit Findings Log (Stage 3)

| ID | Issue Found | Fix Applied | Regression Test |
| :--- | :--- | :--- | :--- |
| `CONC-001`–`CONC-004`, `CONC-008`, `CONC-009` | Missing removal syntax, sentinel `[RECALIBRATE_RULESET: none]` triggers, split `[UPDATE_DOSSIER]` drops, `Attempt 3/2` debug counter, Talker ungrounded claims, Judge missing `FAE Encounter` | Fixed in Phase 0 & Phase 1 (documented in [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md)) | `tests/concierge-stage-scoped.test.js`, `tests/concierge-debug-inspector.test.js` |
| `CONC-015` | `#mhc_header_system_badge` silently called destructive `switchRulesetMode()` in Steps 3–4; badge, ST pickers, and `.mhc-dial-pill` were not locked by `setConciergeBusyState()` | Made badge non-destructive toast in `new-adventure` mode; added badge, ST pickers, and dial pills to `setConciergeBusyState()` (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-016` | `#mhc_launch_campaign_btn` unlocked as soon as `unlockedSteps.character` became true in Step 3 | Gated launch button on `unlockedSteps.character && Boolean(protagonist.name)` (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-017` | Stage 3 `[MAP]` examples emitted `danger: Medium / Tense / High`, which parser ignored | Emitted canonical `kind:` + `threat:` in `concierge-prompt.js`; accepted `threat \|\| danger` + synonyms in `concierge-parser.js` | `tests/concierge-stage-scoped.test.js` |
| `CONC-018` | Ruleset switch dropped `stageNotes` and `factions`; `snapshotAdventure()` omitted `systemKey`/`factions` | Preserved `stageNotes` + `factions` (`agenda`/`standing`) on ruleset switch and in `extractAgnosticAdventureBones()`; added calibration & factions to `snapshotAdventure()` / `computeAdventureDiff()` | `tests/concierge-stage-controller.test.js` |
| `CONC-019` | Step 3 Turns 2..N never refreshed `stageNotes.adventure`; `runStageHarmonizationPass()` lacked typing indicator & Debug trace | Added `refreshAdventureStageNote()` in Step 3 `handleUserSend()`, harmonization, and auto-pass; added `#mhc_typing_indicator`, Debug trace, `designGameSystem`, and `saveDraft()` to `runStageHarmonizationPass()` | Verified in code & full test suite |

---

## 8. UI Controls, Button Gating & Immediate Pre-Inference Feedback

| Control (`concierge-modal.html` / `concierge-ui.js`) | Enabled When | Locked During Inference? | Immediate Pre-Inference Visual Feedback? | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| `.mhc-ruleset-card`, `.mhc-ruleset-btn` | Always in Step 3 (`new-adventure`) | Yes (`setConciergeBusyState` + `isGenerating` guard) | Case B shows `showConciergeConfirm` first; immediately dims controls & appends `#mhc_typing_indicator` (`Ruleset Architect...`) before `await` | Closed (`CONC-007`) |
| `#mhc_deck_tune_ruleset_btn` (`⚙️ Tune Ruleset`, `DOM-13`) | Visible & enabled when `rulesetConfirmed === true` in Step 3 | Yes (`setConciergeBusyState` + `isGenerating` guard) | Prompts optional tweak; immediately dims controls & appends `#mhc_typing_indicator` before `runRulesetArchitect()` | Closed (`CONC-007`) |
| `#mhc_header_system_badge` | Visible when `rulesetConfirmed === true` (hidden before Step 3 pick) | Yes (`setConciergeBusyState` + `isGenerating` guard) | Shows safe info toast in `new-adventure` Steps 3–4 (non-destructive) | Closed (`CONC-015`) |
| `.mhc-dial-pill` & `#mhc_deck_dial_playstyle` | Visible in Step 3 (ruleset-specific dials shown once confirmed) | Yes (`setConciergeBusyState` dims & disables pointer events) | Synchronous state update, changelog, deck re-render & `saveDraft()` | Closed (`CONC-015`) |
| `#mhc_step_btn_character` | Visible once `rulesetConfirmed && hasEpisode1Content` | Yes (`setConciergeBusyState` + `isGenerating` guard) | Dimmed during Step 3 builds/recalibrations | Closed |
| `#mhc_send_btn` | `!isGenerating && rulesetConfirmed && (text \|\| attachments)` | Yes | Replaced/paired with `#mhc_stop_btn` and immediate `#mhc_typing_indicator` | Closed |
| `#mhc_launch_campaign_btn` | Disabled in Step 3 unless `unlockedSteps.character && protagonist.name` | Yes (`setConciergeBusyState` + click guard) | Opacity `0.5`, `pointer-events: none`, and explanatory disabled tooltip | Closed (`CONC-016`) |

---

## 9. Multi-Turn Refinement (`N`-Turn) Invariants

1. **Unbounded Step 3 Revisions:** Players can send **0, 1, 2, or N** consecutive refinement prompts (add NPCs, remove adversaries, switch `[MAP]` threat, alter `[KICK]`, toggle dials, or invoke `[RECALIBRATE_RULESET]`) without triggering duplicate entities or losing existing cast (`CONC-001`, `CONC-003`, `CONC-006`).
2. **Every `[KICK]` Revision Keeps Handoff Notes Current (`CONC-019`):** Turning 2..N revisions to `[KICK]` update `meta.stageNotes.adventure` via `refreshAdventureStageNote()` so Step 4's Continuity Brief always sees the latest opening crisis.
3. **Recalibration Re-Syncs Step 4 (`CONC-018`):** Using either mid-chat `[RECALIBRATE_RULESET: ...]` or `⚙️ Tune Ruleset` updates `systemKey`/`systemLabel` in `snapshotAdventure()`, guaranteeing Step 4 harmonization triggers automatically when returning to Step 4.
