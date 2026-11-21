# Stage 1 Contract Sheet: Initial Intake & Framing (`🧭 Initial`)

Parent hub: [README.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/README.md) · Cross-cutting spine: [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md)

---

## 1. Entry & Exit Conditions

* **Initial Entry (Default Stage):** Opening the modal in `new-adventure` mode or clicking `#mhc_reset_session_btn` sets `currentAdventureStep = 'initial'`, `unlockedSteps = { initial: true, canon: false, adventure: false, character: false }`, and keeps `#mhc_step_btn_initial` unlocked (`unlockedSteps.initial = true`).
* **3-Bucket Intake Sizing (`concierge-canon.js`):**
  * **Vibe (`bucket: vibe`)**: No large lorebooks or small notes (`≤ ~6,000` tokens). Framing focuses on title, premise, dramatic tone, and focal hook.
  * **Middle (`bucket: middle`)**: Focused imported notes or NPC roster; asks 1–2 clarifying questions around surrounding world context.
  * **Big / Archivist (`bucket: big`)**: Large lorebooks/world bibles (`> ~6,000` tokens, or manually overridden via `#mhc_import_use_vibe_btn`). Triggers attach-time chunking/labeling/dedup in `concierge-canon.js` and keeps Step 2 locked until a specific focal lens (`meta.focalLens`) is set (`CONC-010` ensures Step 3 also waits for `unlockedSteps.canon`).
* **Exit / Step 2 Unlock Condition (`evaluateStepUnlocks()`):**
  * `unlockedSteps.canon` unlocks when `meta.framingComplete === true` OR (`Boolean(meta.premise.trim())` AND `(bucket !== 'big' || Boolean(meta.focalLens.trim()))`).
  * Clicking `#mhc_step_btn_canon` saves `lastSyncedSnapshots.framing` (on first leave) and invokes `setAdventureStep('canon')`.

---

## 2. Code Surface

| Area | File & Symbol(s) | Responsibility |
| :--- | :--- | :--- |
| **Orchestration** | [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js) (`evaluateStepUnlocks`, `setAdventureStep`, `handleUserSend`, `handleCommitImportedLore`) | Step gating, busy locking, intake commit, turn loop |
| **Intake UI Helpers** | [concierge-intake-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-intake-ui.js) (`syncImportCommitBoxDom`, `renderAttachmentTrayDom`, `updateSendButtonStateDom`, `renderStartChipsDom`) | Tray chips, Archivist Commit Box, Send/Commit icon states |
| **File & Format Readers** | [concierge-files.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-files.js), [concierge-card-reader.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-card-reader.js), [concierge-lore-reader.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-lore-reader.js) | Drag/drop txt/md/json/pdf/docx, PNG tEXt/iTXt character cards, ST World Info lorebooks |
| **Stage 1 Prompts** | [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildStage1InitialBuilderPrompt`, `buildStage1InitialTalkerPrompt`) | Strictly ruleset-agnostic framing extraction & intake facilitation |
| **Framing Parser & Diff** | [concierge-parser.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-parser.js) (`applyDossierUpdates`), [concierge-canon.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-canon.js) (`snapshotFraming`, `computeFramingDiff`) | `[FRAMING]` extraction, `ready_for_canon`, snapshot diffing |
| **Deck Card** | [concierge-deck-renderer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-deck-renderer.js) | Updates Overview card (`#mhc_card_initial_framing`, `#mhc_card_initial_sources`) |

---

## 3. LLM Pass Flow

1. **Interactive Step 1 Chat Turn (`handleUserSend`):**
   * `setConciergeBusyState(true)` locks controls immediately and appends `#mhc_typing_indicator`.
   * **Agent 1 (`buildStage1InitialBuilderPrompt`)**: Emits `[UPDATE_DOSSIER] [FRAMING] ... [/FRAMING] [/UPDATE_DOSSIER]` or `[NOOP]`. Retries up to 2x on parse error / missing block.
   * **NameRAG**: Runs `resolveDossierNamePlaceholders()` if any `[[NAME:...]]` appears.
   * **Stage 1b Judge**: **Bypassed** (`isLightweightStage === true` for `initial` and `canon`).
   * **Agent 2 (`buildStage1InitialTalkerPrompt`)**: Receives `[BUILDER_REPORT: ...]` (+ `[APPLIED_BLUEPRINT_CHANGES: ...]`) and responds conversationally; invites clicking **`📚 Canon`** once `framingComplete` is true.
   * `finally`: `setConciergeBusyState(false)`, `evaluateStepUnlocks()`, `updateBlueprintDeck()`, `saveDraft()`.
2. **Archivist Commit Turn (`handleCommitImportedLore`):**
   * When big lore finishes ingesting into `stagedCanonEntries` and `shouldBrief()` is true, user clicks `#mhc_import_commit_btn`.
   * `setConciergeBusyState(true)` locks stepper/Launch/Reset and disables Commit button immediately.
   * Calls `buildArchivistBriefingPrompt()` -> parses `[SUGGESTED_STARTS]` -> renders quick-reply start chips (`renderStartChips`) -> marks briefed (`markBriefed()`).

---

## 4. Prompt ↔ Parser ↔ UI Matrix

| Directive / Key | Prompted in `buildStage1InitialBuilderPrompt`? | Parsed in `concierge-parser.js`? | Mutates State? | Rendered in UI? | Gaps Found |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `[FRAMING] ... [/FRAMING]` | Yes (`title`, `premise`, `focal_lens`, `tone`, `ready_for_canon`) | Yes (`framingBlocks`) | `dossier.meta.*` | Initial Overview card (`#mhc_initial_*`) | `CONC-012`: lacked closing `[/UPDATE_DOSSIER]` & had `true \| false` pipe template (fixed) |
| Top-level `focal_lens:` / `ready_for_canon:` | No (inside `[FRAMING]`) | Yes (fallback on `topLevelRaw`) | `dossier.meta.focalLens`, `framingComplete` | Initial Overview card | None |
| `[DESIGN_GAME_SYSTEM]` / `[PROTAGONIST]` / `[MONSTER]` | Forbidden ("100% ruleset-agnostic") | Parser supports in later steps | N/A | Initial hides Step 3/4 mechanics | None |
| `[NOOP]` | Yes (`[NOOP] summary: ... [/NOOP]`) | Yes (`isNoop: true`) | None | Chat only | None |

---

## 5. Context In & Handoff Out

* **Context In (Builder & Talker):** Current `meta.title`, `meta.premise`, `meta.focalLens`, `meta.tone`, `meta.framingComplete`, plus `extractSourcesStructuralOutline()` (`[ATTACHED_SOURCES_OUTLINE]`). Zero downstream mechanics (`stats`, `pools`, `monsters`) are injected in Step 1.
* **Handoff Out to Step 2 (`canon`):**
  * `dossier.meta` (`title`, `premise`, `focalLens`, `tone`, `framingComplete`).
  * `lastSyncedSnapshots.framing = snapshotFraming(activeDossier)` captured when leaving Step 1.
  * `activeDossier.meta.stageNotes.framing` populated upon entering Step 2 (`premise` + `focalLens`).
  * Any staged Canon entries (`stagedCanonEntries`) or pending small lore/file context carried in `attachedSources` / `stagedCanonEntries`.
  * Later edits in Step 1 trigger `computeFramingDiff()` upon returning to Step 2, passing `[UPSTREAM_FRAMING_DIFF]` into `runStageHarmonizationPass('canon')`.

---

## 6. Invariants & Guardrails

1. **100% Ruleset-Agnostic Intake:** Step 1 prompts forbid discussing D&D/PbtA/FAE stats or character sheets before framing is set.
2. **Sequential Stage Integrity (`CONC-010`):** Importing a lorebook in Step 1 cannot prematurely unlock **Step 3 (`Adventure`)** until `unlockedSteps.canon` is true.
3. **Cancel & Rollback Safety:** Aborting or failing `handleUserSend()` restores `rollback.dossier`, `chatHistory`, `changelog`, `#mhc_chat_input`, and `pendingAttachments` untouched. Aborting `handleCommitImportedLore()` restores `isImportCommitPending = true` and the Commit box.

---

## 7. Audit Findings Log (Stage 1)

| ID | Issue Found | Fix Applied | Regression Test |
| :--- | :--- | :--- | :--- |
| `CONC-010` | Attaching a lorebook in Step 1 unlocked **Step 3 (`3. 🗺️ Adventure`)** while **Step 2 (`2. 📚 Canon`)** was still locked (`hasCanon` ignored `unlockedSteps.canon`) | Gated `unlockedSteps.adventure` on `unlockedSteps.canon` in `evaluateStepUnlocks()` (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-011` | `handleCommitImportedLore()` only disabled `#mhc_import_commit_btn`, leaving stepper/Launch/Reset active during inference; `renderStartChipsDom` / `renderPromoteChipsDom` could fire while `isGenerating === true` | Wired `setConciergeBusyState(true/false)` into `handleCommitImportedLore()` and added `isBusy` guard in `concierge-intake-ui.js` / `concierge-ui.js` | Verified across `tests/concierge-stage-controller.test.js` & full suite |
| `CONC-012` | `buildStage1InitialBuilderPrompt()` omitted closing `[/UPDATE_DOSSIER]` and used literal `ready_for_canon: true \| false` pipe syntax | Added closing `[/UPDATE_DOSSIER]` and concrete `ready_for_canon: true` example in `concierge-prompt.js` | `tests/concierge-stage-scoped.test.js` |

---

## 8. UI Controls, Button Gating & Immediate Pre-Inference Feedback

| Control (`concierge-modal.html` / `concierge-ui.js`) | Enabled When | Locked During Inference? | Immediate Pre-Inference Visual Feedback? | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| `#mhc_send_btn` | `!isGenerating && (text.length > 0 \|\| pendingAttachments.length > 0)` | Yes (`setConciergeBusyState` + `updateSendButtonStateDom`) | Disabled immediately; `#mhc_stop_btn` shown; `#mhc_typing_indicator` appended before `await` | Closed |
| `#mhc_import_commit_btn` | `!isGenerating && activeImports.length === 0 && stagedCanonEntries.length > 0` | Yes (`setConciergeBusyState(true)`) | Disabled immediately with text `⏳ Generating Overview...`; `#mhc_stop_btn` shown | `CONC-011` fixed |
| `#mhc_import_cancel_btn` | Visible while importing or awaiting commit | Acts as **Stop Overview** during overview generation; abort cancels `activeTurn` | Immediate click cancellation / rollback | None |
| `#mhc_import_use_vibe_btn` | Visible after import ready in Archivist Commit box | Hidden during commit inference | Switches mode & syncs Commit box immediately | None |
| `#mhc_step_btn_canon` | Visible when `unlockedSteps.canon === true` | Yes (`setConciergeBusyState` + `isGenerating` guard in `setAdventureStep`) | Dimmed (`opacity: 0.55`, `aria-busy="true"`) while busy; Step 2 shows immediate build bubble on click | `CONC-007` fixed |
| Quick-reply chips (`.mhc-start-chip`) | Rendered beneath Archivist overview (`!isGenerating`) | Ignored when `isBusy()` is true | Fills `#mhc_chat_input`, removes chips, and delegates immediately to `handleUserSend()` | `CONC-011` fixed |
| Attachment remove (`.mhc-chip-remove`) | Visible on attachment tray when idle | Tray hidden/cleared once `handleUserSend()` starts | Removes chip and calls `updateSendButtonState()` immediately | None |

---

## 9. Multi-Turn Refinement (`N`-Turn) Invariants

1. **Arbitrary Step 1 Iterations:** Players can send 0, 1, 2, or N messages in Step 1 before advancing; `applyDossierUpdates()` overwrites only supplied `[FRAMING]` fields (`title`, `premise`, `focalLens`, `tone`) while preserving unchanged fields.
2. **One-Way Readiness Stability:** Once `framingComplete` is `true`, subsequent Step 1 delta turns refine premise/tone/focal lens without accidentally resetting `unlockedSteps.canon` or wiping `stagedCanonEntries`.
3. **Repeated Back-Navigation Cycles (`Step 2 → Step 1 → Step 2`):** Every departure from Step 2 after Step 1 edits compares current `snapshotFraming(activeDossier)` against `lastSyncedSnapshots.framing`, producing a cumulative `[UPSTREAM_FRAMING_DIFF]` for Step 2 harmonization (`lastSyncedSnapshots.framing` is updated only when harmonization completes).
