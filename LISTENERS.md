# MultiHog Companion — Event Catalog & Listener Registry

> **Purpose:** Document every SillyTavern app event, DOM event delegation, and lifecycle hook registered by `MultiHogCompanion`.
> Because event listeners decouple trigger from reaction, this document serves as the central map of triggers, execution order, shared event overlaps, blast radius, and code smells / race conditions.

---

## 1. Shared Event Overlap & Execution Timeline Matrix

The following matrix highlights events where **multiple files or upstream MultiHog** listen to the exact same event. Phase 2 resolved the primary race condition hotspots by replacing arbitrary `setTimeout` ladders with deterministic coordinators and deduplicating redundant listeners.

| Event Type | Participating Files / Handlers | Execution Priority / Order | Status / Risk Rating |
| :--- | :--- | :--- | :--- |
| **`CHAT_CHANGED`** | • `cyoa-guardian.js`<br>• `index.js` (`runChatChangedCoordinator`)<br>• *Upstream MultiHog* | 1. `cyoa-guardian` (sync abort)<br>2. Upstream `onChatChanged` (async state reload)<br>3. `index.js` (Debounced 500ms settlement window -> deterministic sequential coordinator with token invalidation) | 🟢 **RESOLVED**: Arbitrary `setTimeout` ladder eliminated; token invalidation prevents stale cross-chat overwrites. |
| **`CHAT_RENAMED`** | • `adventure-chat.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `adventure-chat.js` (`eventSource.makeFirst`)<br>2. Upstream `onChatRenamedMigrate`<br>3. `index.js` (`setTimeout` 200ms) | 🟡 **MODERATE**: Relies on `eventSource.makeFirst` monkey patch to beat upstream migration. |
| **`CHARACTER_MESSAGE_RENDERED`** | • `cyoa-guardian.js` (`triggerDecoupledCyoaForMessage`)<br>• `index.js` (canonical assistant turn listener)<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (unified Stage 2 CYOA dispatcher)<br>2. `index.js` (schedules tier crossover check) | 🟢 **RESOLVED**: Canonical assistant turn trigger. Deduplicated against `GENERATION_ENDED`. |
| **`MESSAGE_RECEIVED`** | • *Upstream MultiHog* | 1. Upstream `onMapArchitectAssistantMessage` | 🟢 **REMOVED**: Redundant Companion listener removed; consolidated into `CHARACTER_MESSAGE_RENDERED`. |
| **`SETTINGS_UPDATED`** | • `index.js` (`runSettingsUpdatedCoordinator`)<br>• *Upstream MultiHog* | 1. `index.js` (Debounced 600ms settlement window with `_isSettingsSyncActive` mutex gate) | 🟢 **RESOLVED**: Re-entrancy loop eliminated; 4 nested timeouts collapsed into single atomic pass. |
| **`GENERATION_STARTED`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean state-reset hook. |
| **`GENERATION_STOPPED`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean abort handler. |
| **`GENERATION_ENDED`** | • `cyoa-guardian.js` (`triggerDecoupledCyoaForMessage`)<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (fail-safe completion trigger) | 🟢 **RESOLVED**: Unified dispatcher ensures Stage 2 runs only once per message turn. |
| **`CHAT_COMPLETION_PROMPT_READY`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. Upstream prompt injection<br>2. `cyoa-guardian.js` (prompt CYOA stripping) | 🟢 **LOW**: Pure synchronous array transform. |
| **`APP_READY`** | • `index.js` (`setupImagineInterceptor`)<br>• *Upstream MultiHog* | 1. Companion wraps `/imagine` callback | 🟢 **LOW**: Run-once initialization. |

---

## 2. Shared Event Timelines & Architecture

### Timeline: `CHAT_CHANGED` (Coordinated Lifecycle)
When the user switches chats or reloads a chat, multiple asynchronous systems interact with `extensionSettings.rpg_tracker` and the chat metadata. Phase 2 replaced the arbitrary `setTimeout` ladder with a token-invalidated, sequential coordinator:

```
T+0ms:    [cyoa-guardian.js] Abort any active Stage 2 CYOA pass immediately.
T+0ms:    [Upstream MultiHog] onChatChanged begins reading chat metadata and initializing partitions.
T+0ms:    [index.js] scheduleSync('CHAT_CHANGED', 500) debounced worker armed.
T+0ms:    [index.js] refreshConciergeActiveContext() triggered.
T+0ms:    [index.js] token = ++_activeChatChangedToken; arms 500ms settlement timer.
─────────────────────────────────────────────────────────────────────────────
T+500ms:  [index.js] runChatChangedCoordinator(targetChatId, token) executes:
          Step 1: checkTrackerProjectionIntegrity() -> if damaged, renders quarantine banner & stops.
          Step 2: ensureActiveChatRulesetConsistency() -> sanitizes stock D&D vs hydrates PbtA.
          Step 3: updateRulesetBadge() & updateLorebookSyncUI() in a single atomic UI refresh.
          Step 4: checkHistoryPersistenceBlocked() -> syncNameRagAdhocSysprompt().
          Step 5: updateRelationshipSyncUI() -> scanAndInitUnsyncedNpcs().
          * Cancellation Guard: Any new chat switch immediately increments token, aborting in-flight work.
```

---

### Timeline: `CHAT_RENAMED` (The Early Hook Race)
SillyTavern fires `CHAT_RENAMED` when a chat is saved with a new title. In upstream MultiHog, `onChatRenamedMigrate` immediately copies partition files from the old chat filename to the new chat filename.

```
T+0ms:    [adventure-chat.js] eventSource.makeFirst handler fires BEFORE upstream MultiHog!
          Verifies window._mhcPendingFreshRestart proof.
          Sets up rename tracking so old partitions aren't orphaned.
T+5ms:    [Upstream MultiHog] onChatRenamedMigrate fires and migrates partition files.
T+200ms:  [index.js] setTimeout fires:
          syncCampaignLorebooks({ isAuto: true }) -> automatically renames bound lorebook.
          updateLorebookSyncUI().
```

---

### Timeline: `CHARACTER_MESSAGE_RENDERED` vs `GENERATION_ENDED`
These events handle post-generation updates. In Phase 2, redundant listeners were eliminated and CYOA generation was unified under a single dispatcher:

```
Streaming finishes ->
T+0ms:    [cyoa-guardian.js] CHARACTER_MESSAGE_RENDERED fires:
          Calls triggerDecoupledCyoaForMessage().
          If narrator was streaming, defers to GENERATION_ENDED.
          If narrator finished (or non-streaming), triggers Stage 2 CYOA and records messageId/swipeId.
T+0ms:    [index.js] CHARACTER_MESSAGE_RENDERED fires:
          Canonical assistant turn event: scheduleSync('CHARACTER_MESSAGE_RENDERED', 400).
          setTimeout(600ms): checkAndSyncTierCrossovers() & updateRelationshipSyncUI().
T+30ms:   [cyoa-guardian.js] GENERATION_ENDED fires:
          Calls triggerDecoupledCyoaForMessage().
          If already triggered by CHARACTER_MESSAGE_RENDERED, exits immediately.
          Otherwise, executes Stage 2 CYOA with complete narrative prose.
```

---

### Timeline: `SETTINGS_UPDATED` (Re-entrancy Protected)
SillyTavern emits `SETTINGS_UPDATED` anytime `saveSettingsDebounced()` is called.

```
T+0ms:    [index.js] SETTINGS_UPDATED fires:
          Early Guard: if (isPersistingPbtaChatState()) return;
          Re-entrancy Mutex: if (_isSettingsSyncActive) return;
          Arms 600ms debounced timer.
T+600ms:  [index.js] runSettingsUpdatedCoordinator() executes under _isSettingsSyncActive mutex:
          ensureActiveChatRulesetConsistency()
          updateRulesetBadge()
          updateLorebookSyncUI()
          updateRelationshipSyncUI()
```

---

## 3. Comprehensive Event Catalog

### EVT-01: `APP_READY`
* **Trigger:** SillyTavern UI and all extensions have finished loading.
* **Registered In:** `index.js` (line 2007)
* **Handler:** `setupImagineInterceptor()`
* **Purpose:** Hijacks `/imagine` slash command callback to inject dynamic aspect ratios for image generation.
* **Blast Radius:** If removed, `/imagine` will use stock square aspect ratios instead of matching the active scene/portrait dimensions.
* **Status:** Clean single-shot initialization.

---

### EVT-02: `CHAT_RENAMED` (Adventure Rename Guard)
* **Trigger:** Active chat is renamed.
* **Registered In:** `adventure-chat.js` (line 466)
* **Registration Method:** `eventSource.makeFirst` (falls back to `eventSource.on`)
* **Purpose:** Synchronizes MultiHog restart proof metadata so that new chats created by Adventure Start or Concierge Campaign Launch migrate cleanly without losing partition links.
* **Blast Radius:** MultiHog's native rename handler will treat the chat as an unknown partition, causing partition reset and loss of campaign state.
* **Status:** Stable with `eventSource.makeFirst`.

---

### EVT-03: `CHAT_RENAMED` (Lorebook Auto-Sync)
* **Trigger:** Active chat is renamed.
* **Registered In:** `index.js` (line 2036)
* **Handler:** Async callback calling `syncCampaignLorebooks({ isAuto: true })`
* **Purpose:** Automatically renames bound campaign lorebooks when chat name changes.
* **Precondition:** `s.enableLorebookSync && s.autoSyncOnRename`
* **Blast Radius:** Lorebooks retain old chat title and become detached.
* **Status:** Active.

---

### EVT-04: `CHAT_CHANGED` (Coordinator)
* **Trigger:** User switches active chat or current chat is reloaded.
* **Registered In:** `index.js` (lines 1888-1938, 2122-2135)
* **Handler:** `runChatChangedCoordinator(activeChatId, token)`
* **Purpose:** 
  1. Synchronizes vitality and memo state (`scheduleSync`)
  2. Updates Concierge context
  3. Verifies projection integrity (quarantine damaged partitions)
  4. Enforces ruleset consistency (PbtA vs D&D 5e stock prompt sanitization)
  5. Updates UI badges, Lorebook UI, NameRAG adhoc prompt, and relationship sync
* **Blast Radius:** Switching between D&D and PbtA campaigns will contaminate prompts; damaged partitions will not be quarantined; relationship tiers will not display.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. 5 arbitrary `setTimeout` calls replaced with a single deterministic sequence and token invalidation.

---

### EVT-05: `CHAT_CHANGED` (CYOA State Reset)
* **Trigger:** User switches active chat or reloads.
* **Registered In:** `cyoa-guardian.js` (line 393)
* **Handler:** Resets retry tracker, clears pending reminders, aborts active Stage 2 CYOA pass.
* **Blast Radius:** CYOA generation from the previous chat could finish and append choices onto the *new* chat.
* **Status:** Clean state reset.

---

### EVT-06: `CHARACTER_MESSAGE_RENDERED` (Decoupled CYOA Stage 2 Dispatcher)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM.
* **Registered In:** `cyoa-guardian.js` (lines 369-420)
* **Handler:** Routes through `triggerDecoupledCyoaForMessage`. If not streaming, immediately launches Stage 2 CYOA, locks send button, and shows loading indicator.
* **Preconditions:** `enableDecoupledCyoa !== false`, not message 0, adventure active, CYOA expected, message does not already contain choices.
* **Blast Radius:** CYOA buttons will not generate automatically; user must click manual regenerate.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Unified with `GENERATION_ENDED` via shared idempotent dispatcher.

---

### EVT-07: `CHARACTER_MESSAGE_RENDERED` (Relationship & Vitality Sync)
* **Trigger:** SillyTavern renders character message.
* **Registered In:** `index.js` (line 2137)
* **Handler:** Canonical assistant turn event: calls `scheduleSync('CHARACTER_MESSAGE_RENDERED', 400)` and `checkAndSyncTierCrossovers`.
* **Precondition:** `isAdventureActive()`
* **Blast Radius:** Relationship tier progression and health synchronization will not update after LLM turns.
* **Optimization Status:** **CANONICAL (Phase 2)**. Single message-turn listener; duplicate `MESSAGE_RECEIVED` removed.

---

### EVT-08: `SETTINGS_UPDATED` (Ruleset & State Sync Coordinator)
* **Trigger:** Any extension or core writes settings.
* **Registered In:** `index.js` (lines 1944-1959, 2146-2159)
* **Handler:** `runSettingsUpdatedCoordinator()` with `_isSettingsSyncActive` mutex gate.
* **Guards:** `if (isPersistingPbtaChatState()) return; if (_isSettingsSyncActive) return;`
* **Blast Radius:** Settings changes will not immediately update the UI.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Four nested timeouts collapsed into single mutex-shielded pass.

---

### EVT-09: `GENERATION_STARTED` (CYOA Guard)
* **Trigger:** User clicks Send, Regenerate, or Swipe.
* **Registered In:** `cyoa-guardian.js`
* **Handler:** Aborts in-flight Stage 2 CYOA pass; resets stop flags and tracking pointers.
* **Blast Radius:** Swiping a message would leave previous Stage 2 generation running in the background.
* **Status:** Clean abort handler.

---

### EVT-10: `GENERATION_STOPPED` (CYOA Stop Guard)
* **Trigger:** User clicks the Stop generation button in SillyTavern.
* **Registered In:** `cyoa-guardian.js`
* **Handler:** Sets `_wasGenerationStopped = true`, aborts Stage 2 CYOA pass immediately.
* **Blast Radius:** Clicking Stop would stop narrative text but allow Stage 2 to continue running.
* **Status:** Clean abort handler.

---

### EVT-11: `GENERATION_ENDED` (CYOA Completion Trigger)
* **Trigger:** Generation pipeline concludes.
* **Registered In:** `cyoa-guardian.js`
* **Handler:** Routes through `triggerDecoupledCyoaForMessage`. If `CHARACTER_MESSAGE_RENDERED` deferred due to active streaming, executes Stage 2 with complete narrative text.
* **Blast Radius:** Messages generated with streaming enabled would lack CYOA choices.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Deduplicated against `CHARACTER_MESSAGE_RENDERED`.

---

### EVT-12: `CHAT_COMPLETION_PROMPT_READY` (CYOA Prompt Sanitizer)
* **Trigger:** SillyTavern constructs prompt payload right before sending to LLM.
* **Registered In:** `cyoa-guardian.js`
* **Handler:** `stripCyoaFromOutgoingChat(eventData.chat)` removes synthetic CYOA buttons and tags from past context.
* **Blast Radius:** LLM starts generating its own malformed pseudo-buttons and breaks character prose.
* **Status:** Clean synchronous transform.

---

## 4. DOM Event Delegation Registry (`$(document).on`)

| Handler ID | Event Namespace & Target Selector | File & Line | Mechanism / Action | Hardening Status |
| :--- | :--- | :--- | :--- | :--- |
| **DOM-01a** | `click.mhc_quickstart_sanitizer`<br>`#rt-quickstart-begin`, `#rt-cr-generate-btn` | `index.js:2120` | **Pre-flight Sanitizer (Click):** Before character generation starts, checks if active chat is standard D&D and purges stale PbtA prompts from `stockPrompts`. | 🟢 **ACTIVE**: Prevents prompt bleed on generation start. |
| **DOM-01b** | `keydown.mhc_quickstart_sanitizer`<br>`#rt-quickstart-name`, `#rt-cr-name` | `index.js:2126` | **Pre-flight Sanitizer (Enter Key):** Catches keyboard submissions when user presses Enter inside name input fields. | 🟢 **ACTIVE (Phase 3)**: Guarantees prompt sanitization even when user bypasses mouse clicks. |
| **DOM-02** | `click.mhc_namerag_qs`<br>`#rt-quickstart-roll-name` | `namerag-hooks.js:446` | **Hijack with Resilient Fallback:** Calls `e.stopImmediatePropagation()`. Queries NameRAG with 4s timeout. On failure, falls back to offline character generator and emits warning toast. | 🟢 **HARDENED (Phase 2)**: Timeout added; offline fallback; user notified via toast if NameRAG unavailable. |
| **DOM-03** | `click.mhc_namerag_cr`<br>`#rt-cr-random-name` | `namerag-hooks.js:478` | **Hijack with Resilient Fallback:** Same resilient fallback and warning toast as DOM-02. | 🟢 **HARDENED (Phase 2)**: Re-enables button on error; emits warning toast. |
| **DOM-04** | `click.mhc_namerag_ob`<br>`#rt-ob-roll-name` | `namerag-hooks.js:509` | **Hijack with Resilient Fallback:** Same resilient fallback and warning toast as DOM-02. | 🟢 **HARDENED (Phase 2)**: Re-enables button on error; emits warning toast. |
| **DOM-05** | `click.mhc_namerag_begin`<br>`#rt-quickstart-begin` | `namerag-hooks.js:538` | **Pre-fill Observer:** If name field is empty, rolls NameRAG candidate to seed character creation. | 🟢 **HARDENED (Phase 2)**: Wrapped in try/catch; falls back gracefully. |
| **DOM-06** | Native Capture Phase Click<br>`.mes_stop, #mes_stop, .rt-cyoa-cancel-btn` | `cyoa-guardian.js:410` | **Native `document.addEventListener('click', ..., true)` (Capture Phase):** Catches user clicking Stop anywhere in the UI to immediately abort in-flight Stage 2 CYOA. | 🟢 **CLEAN**: Uses capture phase (`true`). |

