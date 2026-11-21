# Stage 2 Contract Sheet: Canon Series Bible & World Laws (`📚 Canon`)

Parent hub: [README.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/README.md) · Cross-cutting spine: [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md)

---

## 1. Entry & Exit Conditions

* **Unlock Gate (`evaluateStepUnlocks()`):** Unlocks when `meta.framingComplete === true` OR (`Boolean(meta.premise.trim())` AND `(bucket !== 'big' || Boolean(meta.focalLens.trim()))`).
* **Entry Paths in `setAdventureStep('canon')` ([concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):**
  1. **Scratch / Unpopulated (`stagedCanonEntries.length === 0 && !opts.skipCanonBuild`):** Locks modal via `setConciergeBusyState(true)`, calls `buildCanonFromFraming()` (Bridge / Expansion / Sketch synthesis in `concierge-canon.js`), initializes `lastSyncedSnapshots.framing`, `lastSyncedSnapshots.canon`, `unlockedSteps.adventure = true`, `stageNotes.framing`, `refreshCanonStageNote()`, and prints `📚 Series Bible Canon Generated!`.
  2. **Framing Diff Return (`framingDiff?.hasChanges && !opts.skipHarmonization`):** Calls `runStageHarmonizationPass('canon', { upstreamDiff: framingDiff.block })` to update Canon cleanly when Step 1 framing changed.
  3. **Pre-Imported First Entry (`!stageChatHistories.canon?.length && stagedCanonEntries.length > 0 && !opts.skipCanonBuild`, fixed in `CONC-014`):** Initializes Step 2 baseline snapshots, `unlockedSteps.adventure = true`, `stageNotes.framing`, `refreshCanonStageNote()`, and renders `📚 Series Bible Canon Ready!` summary instead of a blank chat pane.
  4. **Subsequent Return (No Framing Diff):** Restores `stageChatHistories.canon`.
* **Exit / Step 3 Unlock (`CONC-010`):** `unlockedSteps.adventure` unlocks only after `unlockedSteps.canon` is true AND `(stagedCanonEntries.length > 0 || worldRules.axioms.length > 0)`.

---

## 2. Code Surface

| Area | File & Symbol(s) | Responsibility |
| :--- | :--- | :--- |
| **Canon Pipeline & Store** | [concierge-canon.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-canon.js) (`buildCanonFromFraming`, `upsertCanonEntry`, `toggleCanonEntryDisabled`, `removeCanonEntry`, `canonEntryMatchesTarget`, `snapshotCanon`, `computeCanonDiff`) | Chunking, labeling, LLM dedup, Bridge/Expansion/Sketch synthesis, in-memory store, clean-name mutations, snapshotting |
| **Stage 2 Prompts** | [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildStage2CanonBuilderPrompt`, `buildStage2CanonTalkerPrompt`) | Canon entry + World Rule builder/talker prompts |
| **Parser & Mutations** | [concierge-parser.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-parser.js) (`canonEntryBlocks`, `[DISABLE/ENABLE/REMOVE_CANON]`, `[WORLD_RULES]`, `[REMOVE_WORLD_RULE]`, `[DESIGN_GAME_SYSTEM]`) | Produces `canonMutations[]` and `worldRules` updates |
| **NameRAG Protection** | [namerag-hooks.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/namerag-hooks.js) (`resolveDossierNamePlaceholders`) | Non-person guard (Factions/Locations/Rules/Events/Lore never get person names); Canon name preservation |
| **UI & Deck** | [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js) (`applyCanonMutationsToStore`, `refreshCanonStageNote`), [concierge-deck-renderer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-deck-renderer.js) | Applies store mutations, renders collapsible Series Bible cards & Active/Disabled toggles |

---

## 3. LLM Pass Flow

1. **Initial Step 2 Build (`buildCanonFromFraming`):**
   * Runs Bridge synthesis (`hasStagedSources`) + Middle Expansion (`middle` bucket) OR Foundational Sketch (scratch campaign, 8–12 entries).
   * Routes synthesized JSON replies through `resolveDossierNamePlaceholders(..., { returnDetails: true })` (respecting Non-Person Entity Guard on `FACTION`, `LOCATION`, `RULE`, `EVENT`, `LORE`).
2. **Interactive Step 2 Refinement Turn (`handleUserSend`):**
   * `setConciergeBusyState(true)` locks controls immediately.
   * **Agent 1 (`buildStage2CanonBuilderPrompt`)**: Emits `[UPDATE_DOSSIER]` with `[CANON_ENTRY]`, `[DISABLE/ENABLE/REMOVE_CANON]`, `[WORLD_RULES]`, `[REMOVE_WORLD_RULE]`, or optional `[DESIGN_GAME_SYSTEM]`.
   * **NameRAG (`resolveDossierNamePlaceholders`)**: Resolves `[[NAME:...]]` for *newly invented unnamed* characters only, preserving existing Canon names verbatim.
   * **`applyDossierUpdates()` + `applyCanonMutationsToStore()`**: Updates `worldRules` and `_sources` staged Canon store (`upsertCanonEntry`, `toggleCanonEntryDisabled`, `removeCanonEntry`), refreshing `meta.stageNotes.canon`.
   * **Game System Wizard (if `[DESIGN_GAME_SYSTEM]` present)**: Calls `runDelegatedGameSystemDesign()` to build bespoke `worldRules.customModule`.
   * **Stage 1b Judge**: **Bypassed** (`isLightweightStage === true` in Step 2).
   * **Agent 2 (`buildStage2CanonTalkerPrompt`)**: Sees latest Canon deck + `[BUILDER_REPORT]` (+ `[APPLIED_BLUEPRINT_CHANGES]`) and summarizes changes out-of-character.

---

## 4. Prompt ↔ Parser ↔ UI Matrix

| Directive / Tag | Prompted in `buildStage2CanonBuilderPrompt`? | Parsed in `concierge-parser.js`? | Mutates State? | Rendered in UI? | Gaps Found |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `[CANON_ENTRY]` / `[UPSERT_CANON_ENTRY]` / `[CANON_UPDATE]` | Yes (`[CANON_ENTRY]`) | Yes (all 3 variants after `CONC-013`) | `canonMutations` -> `upsertCanonEntry()` | Series Bible card + badge | `CONC-012` / `CONC-013`: added missing `[/UPDATE_DOSSIER]`, replaced pipe templates, wired `[UPSERT_CANON_ENTRY]` & clean-name matching |
| `[DISABLE_CANON: Name]` / `[ENABLE_CANON: Name]` / `[REMOVE_CANON: Name]` | Yes | Yes (inline or `action:` inside block) | `toggleCanonEntryDisabled()` / `removeCanonEntry()` | Active/Disabled badge & filter counts | `CONC-013`: now matches clean NameRAG names (`Sheridan Vance`) |
| `[WORLD_RULES] ... [/WORLD_RULES]` | Yes | Yes (`ruleBlocks`) | `dossier.worldRules.axioms` | World Axioms & Laws card | `CONC-012`: replaced pipe `category:` list with single concrete value |
| `[REMOVE_WORLD_RULE: Title]` | Yes (added in `CONC-012`) | Yes | Removes matching axiom from `worldRules.axioms` | Removes Axiom card | Fixed in `CONC-012` |
| `[DESIGN_GAME_SYSTEM: <desc>]` | Yes (optional) | Yes (`report.designGameSystem`) | Invokes `generateBlueprintGameSystemViaWizard()` | Custom Tracker card | Sentinel filter (`none`/`n/a`) prevents false runs (`CONC-002`) |
| `[PROTAGONIST]` / `[MONSTER]` / `[MAP]` / `[KICK]` | Strictly forbidden ("belong in Step 3 & Step 4") | Supported in later steps | Avoided by Stage 2 prompt | Hidden / Step 3–4 | None |

---

## 5. Context In & Handoff Out

* **Context In:** `formatStage2FramingAndKickContext(dossier)` (Framing + current Episode 1 `[KICK]` if back-editing from Step 3), `formatCanonEntriesForContext(canonEntries)` (with `[NAME: ..., RESOLVED TO: ...]` unwrapped to `<Name> [concept: <concept>]`), `formatAxiomsForContext(axioms)`, `RESOLVED_NAME_FORMAT_GUIDANCE`, and optional `[UPSTREAM_DIFF]`.
* **Handoff Out to Steps 3 & 4:**
  * `stagedCanonEntries` (both `active` entries injected in full/focus and `disabled` background entries listed as deferred names).
  * `dossier.worldRules` (`axioms` and optional `customModule`).
  * `dossier.meta.stageNotes.canon` (active factions + latest Canon summary).
  * `lastSyncedSnapshots.canon = snapshotCanon(...)` used by `computeCanonDiff()` when advancing to Step 3/4 after editing Canon so `[UPSTREAM_CANON_DIFF]` triggers `runStageHarmonizationPass('adventure' | 'character')`.

---

## 6. Invariants & Guardrails

1. **Non-Person Canon Protection:** Factions, Locations, Rules, Events, and Lore never receive personal NameRAG names (`isNonPersonEntity` guard in `namerag-hooks.js`), while named individual leaders/NPCs do.
2. **Existing Canon Name Preservation:** Characters already named in imported lore or Series Bible keep their exact name verbatim across refills, refines, and Step 2 → Step 3 handoffs.
3. **Clean-Name Mutation Parity (`CONC-013`):** `[DISABLE_CANON]`, `[ENABLE_CANON]`, `[REMOVE_CANON]`, and `[CANON_ENTRY]` upserts match NameRAG-resolved entries cleanly by `cleanName` without stripping `[NAME: ..., RESOLVED TO: ...]` UI badges or creating duplicates.

---

## 7. Audit Findings Log (Stage 2)

| ID | Issue Found | Fix Applied | Regression Test |
| :--- | :--- | :--- | :--- |
| `CONC-012` | `buildStage2CanonBuilderPrompt()` lacked closing `[/UPDATE_DOSSIER]`, used pipe templates in `kind:`/`category:`, and omitted `[REMOVE_WORLD_RULE: Title]` | Updated `concierge-prompt.js` with concrete example values, `[REMOVE_WORLD_RULE: Title]`, and `[/UPDATE_DOSSIER]` | `tests/concierge-stage-scoped.test.js` |
| `CONC-013` | `upsertCanonEntry`, `toggleCanonEntryDisabled`, and `removeCanonEntry` didn't match `[NAME: ..., RESOLVED TO: Name]` entries by clean name (or stripped badges on clean upserts); `concierge-parser.js` didn't match `[UPSERT_CANON_ENTRY]` | Added `canonEntryMatchesTarget()` + badge preservation in `concierge-canon.js`, and added `UPSERT_CANON_ENTRY` to `concierge-parser.js` | `tests/concierge-stage-scoped.test.js` |
| `CONC-014` | Pre-imported lorebook entries entering Step 2 for the first time hit the `else` branch with an empty `stageChatHistories.canon` and left the chat pane blank without initializing Canon snapshots or `unlockedSteps.adventure` | Added dedicated pre-imported Step 2 initialization branch in `setAdventureStep('canon')` (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |

---

## 8. UI Controls, Button Gating & Immediate Pre-Inference Feedback

| Control (`concierge-modal.html` / `concierge-ui.js`) | Enabled When | Locked During Inference? | Immediate Pre-Inference Visual Feedback? | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| `#mhc_send_btn` | `!isGenerating && (text.length > 0 \|\| pendingAttachments.length > 0)` | Yes (`setConciergeBusyState`) | Disabled immediately; `#mhc_stop_btn` shown; typing bubble appended before `await` | Closed |
| `#mhc_step_btn_initial` | Always visible (`unlockedSteps.initial = true`) | Yes (`setConciergeBusyState` + `isGenerating` early-return in `setAdventureStep`) | Dimmed while busy so back-navigation cannot interrupt an active Canon edit | Closed (`CONC-007`) |
| `#mhc_step_btn_adventure` | Visible when `unlockedSteps.canon && (stagedCanonEntries.length > 0 \|\| worldRules.axioms.length > 0)` | Yes (`setConciergeBusyState` + `isGenerating` guard) | Disabled/dimmed immediately during Step 2 inference; enabled once mutations settle | Closed (`CONC-010`) |
| Series Bible filter pills & Active/Disabled toggle buttons | Whenever Step 2 Canon Deck renders | Visual deck re-renders synchronously on `applyCanonMutationsToStore()` | Instant local toggle state + `saveDraft()` (no LLM wait needed) | Note: manual toggles mark diff for Step 3 via `computeCanonDiff()` |

---

## 9. Multi-Turn Refinement (`N`-Turn) Invariants

1. **Arbitrary Consecutive Step 2 Turns:** Users can refine, disable, enable, add, or remove Canon entries and World Axioms across 0, 1, 2, or N consecutive turns without resetting framing or duplicating entries.
2. **Idempotent NameRAG Badge Preservation:** Patching a NameRAG-resolved NPC Canon entry (`Sheridan Vance`) across 2+ refinement turns (`[CANON_ENTRY]` / `[DISABLE_CANON]` / `[ENABLE_CANON]`) matches in-place via `canonEntryMatchesTarget()` and preserves the `[NAME: concept, RESOLVED TO: Sheridan Vance]` badge token.
3. **Cumulative Upstream Diff to Steps 3 & 4:** Because `lastSyncedSnapshots.canon` captures the baseline from when Canon last synced with downstream Adventure/Character stages, making 3 separate Canon edits in Step 2 accumulates into one clean `[UPSTREAM_CANON_DIFF]` when advancing to Step 3 or Step 4.
