# MultiHog Companion — Event Catalog & Listener Registry

> **Purpose:** Document every SillyTavern app event, DOM event delegation, and lifecycle hook registered by `MultiHogCompanion`.
> Because event listeners decouple trigger from reaction, this document serves as the central map of triggers, execution order, shared event overlaps, blast radius, and code smells / race conditions.

---

## 1. Shared Event Overlap & Execution Timeline Matrix

The following matrix highlights events where **multiple files or upstream MultiHog** listen to the exact same event. These are the primary hotspots for race conditions and temporal coupling.

| Event Type | Participating Files / Handlers | Execution Priority / Order | Code Smell / Race Risk Rating |
| :--- | :--- | :--- | :--- |
| **`CHAT_CHANGED`** | • `cyoa-guardian.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian` (sync abort)<br>2. Upstream `onChatChanged` (async state reload)<br>3. `index.js` (`setTimeout` ladder 500ms–800ms) | 🔴 **CRITICAL**: Staggered `setTimeout` ladder dodging upstream async initialization. |
| **`CHAT_RENAMED`** | • `adventure-chat.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `adventure-chat.js` (`eventSource.makeFirst`)<br>2. Upstream `onChatRenamedMigrate`<br>3. `index.js` (`setTimeout` 200ms) | 🟡 **MODERATE**: Relies on `eventSource.makeFirst` monkey patch to beat upstream migration. |
| **`CHARACTER_MESSAGE_RENDERED`** | • `cyoa-guardian.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (fires Stage 2 CYOA pass)<br>2. `index.js` (schedules tier crossover check) | 🟡 **MODERATE**: Duplicates work with `GENERATION_ENDED` and `MESSAGE_RECEIVED`. |
| **`MESSAGE_RECEIVED`** | • `index.js`<br>• *Upstream MultiHog* | 1. Upstream `onMapArchitectAssistantMessage`<br>2. `index.js` (schedules tier crossover check) | 🟡 **MODERATE**: Overlaps with `CHARACTER_MESSAGE_RENDERED` for the same crossover logic. |
| **`SETTINGS_UPDATED`** | • `index.js`<br>• *Upstream MultiHog* | 1. `index.js` (`setTimeout` ladder 600ms–800ms) | 🔴 **CRITICAL**: Re-entrancy risk; updates can trigger another `SETTINGS_UPDATED` event. |
| **`GENERATION_STARTED`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean state-reset hook. |
| **`GENERATION_STOPPED`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean abort handler. |
| **`GENERATION_ENDED`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. `cyoa-guardian.js` (fail-safe backup for Stage 2) | 🟡 **MODERATE**: Fallback redundancy with `CHARACTER_MESSAGE_RENDERED`. |
| **`CHAT_COMPLETION_PROMPT_READY`** | • `cyoa-guardian.js`<br>• *Upstream MultiHog* | 1. Upstream prompt injection<br>2. `cyoa-guardian.js` (prompt CYOA stripping) | 🟢 **LOW**: Pure synchronous array transform. |
| **`APP_READY`** | • `index.js` (`setupImagineInterceptor`)<br>• *Upstream MultiHog* | 1. Companion wraps `/imagine` callback | 🟢 **LOW**: Run-once initialization. |

---

## 2. Shared Event Timelines & Race Condition Hotspots

### Timeline: `CHAT_CHANGED` (The "Ladder of Timeouts")
When the user switches chats or reloads a chat, multiple asynchronous systems race to read and mutate `extensionSettings.rpg_tracker` and the chat metadata.

```
T+0ms:    [cyoa-guardian.js] Abort any active Stage 2 CYOA pass immediately.
T+0ms:    [Upstream MultiHog] onChatChanged begins reading chat metadata and initializing partitions.
T+0ms:    [index.js] scheduleSync('CHAT_CHANGED', 500) debounced worker armed.
T+0ms:    [index.js] refreshConciergeActiveContext() triggered (unawaited).
─────────────────────────────────────────────────────────────────────────────
T+500ms:  [index.js] scheduleSync callback executes (syncs vitality & memo).
T+550ms:  [index.js] setTimeout: checkTrackerProjectionIntegrity() -> quarantines or repairs partitions.
          [index.js] setTimeout: ensureActiveChatRulesetConsistency() -> sanitizes stock D&D vs PbtA.
          [index.js] setTimeout: updateRulesetBadge().
T+600ms:  [index.js] setTimeout: updateRulesetBadge() (second pass).
T+650ms:  [index.js] setTimeout: updateLorebookSyncUI().
T+700ms:  [index.js] setTimeout: checkHistoryPersistenceBlocked() -> syncNameRagAdhocSysprompt().
T+800ms:  [index.js] setTimeout: updateRelationshipSyncUI() -> scanAndInitUnsyncedNpcs().
```

> ⚠️ **Code Smell / Race Risk [CS-EVT-01]**:
> * **Arbitrary `setTimeout` Laddering:** The 550ms, 600ms, 650ms, 700ms, 800ms offsets are arbitrary buffer guesses designed to execute *after* upstream MultiHog finishes loading partition data. On slower machines or remote servers with high network latency, upstream may take longer than 550ms, causing Companion to run integrity checks on half-hydrated data.
> * **Double Badge Rendering:** `updateRulesetBadge()` is called twice (550ms and 600ms) to counteract upstream overwriting the UI banner.
> * **Better Targeting Opportunity:** Replace the entire `setTimeout` ladder with an event-driven promise coordinator or wait on upstream's partition readiness state rather than guessing milliseconds.

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

> ⚠️ **Code Smell / Race Risk [CS-EVT-02]**:
> * **Dependency on `eventSource.makeFirst`:** Companion had to hijack the event bus using `makeFirst` (if available) because if upstream's `CHAT_RENAMED` runs first, SillyTavern's `reloadCurrentChat()` fires `CHAT_CHANGED` prematurely, resetting pending restart state.
> * **200ms Lorebook Delay:** Lorebook sync uses a hardcoded 200ms timeout to avoid colliding with SillyTavern's chat reload.

---

### Timeline: `CHARACTER_MESSAGE_RENDERED` vs `GENERATION_ENDED` vs `MESSAGE_RECEIVED`
These three events fire in rapid succession during message completion.

```
Streaming finishes ->
T+0ms:    [cyoa-guardian.js] CHARACTER_MESSAGE_RENDERED fires:
          Checks if narrator is still streaming. If complete, immediately launches Decoupled Stage 2 CYOA.
          Locks send button UI and inserts loading indicator.
T+0ms:    [index.js] CHARACTER_MESSAGE_RENDERED fires:
          scheduleSync('CHARACTER_MESSAGE_RENDERED', 400).
          setTimeout(600ms): checkAndSyncTierCrossovers() & updateRelationshipSyncUI().
T+20ms:   [index.js] MESSAGE_RECEIVED fires:
          scheduleSync('MESSAGE_RECEIVED', 400).
          setTimeout(600ms): checkAndSyncTierCrossovers() & updateRelationshipSyncUI().
T+30ms:   [cyoa-guardian.js] GENERATION_ENDED fires:
          Checks if Stage 2 CYOA was already started by CHARACTER_MESSAGE_RENDERED.
          If not, acts as fail-safe backup to launch Stage 2 CYOA.
```

> ⚠️ **Code Smell / Race Risk [CS-EVT-03]**:
> * **Redundant Event Listening:** Both `CHARACTER_MESSAGE_RENDERED` and `MESSAGE_RECEIVED` trigger the exact same `checkAndSyncTierCrossovers` logic with identical debounced schedules (400ms schedule + 600ms timeout). One of these listeners is completely redundant for tier crossovers.
> * **Two-Stage CYOA Dual Entry Point:** Having both `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED` trigger Stage 2 generation requires defensive guardrails (`_lastStage2AttemptedMessageId`, `_lastStage2AttemptedSwipeId`, `isStage2CyoaRunning()`) to prevent generating choices twice.

---

### Timeline: `SETTINGS_UPDATED` (Re-entrancy Cascade)
SillyTavern emits `SETTINGS_UPDATED` anytime `saveSettingsDebounced()` is called—by core, by upstream MultiHog, or by Companion.

```
T+0ms:    [index.js] SETTINGS_UPDATED fires:
          Early Guard: if (isPersistingPbtaChatState()) { clearPersistingPbtaChatState(); return; }
          scheduleSync('SETTINGS_UPDATED', 600).
T+650ms:  [index.js] setTimeout: ensureActiveChatRulesetConsistency()
T+700ms:  [index.js] setTimeout: updateRulesetBadge()
T+750ms:  [index.js] setTimeout: updateLorebookSyncUI()
T+800ms:  [index.js] setTimeout: updateRelationshipSyncUI()
```

> ⚠️ **Code Smell / Race Risk [CS-EVT-04]**:
> * **Infinite Loop Hazard:** If `ensureActiveChatRulesetConsistency()` detects an inconsistency and calls `saveSettingsDebounced()`, it triggers a new `SETTINGS_UPDATED` event. While the `isPersistingPbtaChatState()` flag protects the chat partition save, general settings updates rely purely on debouncing to avoid runaway cascade loops.

---

## 3. Comprehensive Event Catalog

### EVT-01: `APP_READY`
* **Trigger:** SillyTavern UI and all extensions have finished loading.
* **Registered In:** `index.js` (line 2007)
* **Handler:** `setupImagineInterceptor()`
* **Purpose:** Hijacks `/imagine` slash command callback to inject dynamic aspect ratios for image generation.
* **Blast Radius:** If removed, `/imagine` will use stock square aspect ratios instead of matching the active scene/portrait dimensions.
* **Smell / Risk:** Low risk. Clean single-shot initialization.

---

### EVT-02: `CHAT_RENAMED` (Adventure Rename Guard)
* **Trigger:** Active chat is renamed.
* **Registered In:** `adventure-chat.js` (line 466)
* **Registration Method:** `eventSource.makeFirst` (falls back to `eventSource.on`)
* **Purpose:** Synchronizes MultiHog restart proof metadata so that new chats created by Adventure Start or Concierge Campaign Launch migrate cleanly without losing partition links.
* **Blast Radius:** MultiHog's native rename handler will treat the chat as an unknown partition, causing partition reset and loss of campaign state.
* **Smell / Risk:** Uses `eventSource.makeFirst` to ensure priority over upstream.

---

### EVT-03: `CHAT_RENAMED` (Lorebook Auto-Sync)
* **Trigger:** Active chat is renamed.
* **Registered In:** `index.js` (line 2036)
* **Handler:** Async callback calling `syncCampaignLorebooks({ isAuto: true })`
* **Purpose:** Automatically renames bound campaign lorebooks when chat name changes.
* **Precondition:** `s.enableLorebookSync && s.autoSyncOnRename`
* **Blast Radius:** Lorebooks retain old chat title and become detached.
* **Smell / Risk:** Uses hardcoded `setTimeout(200ms)`.

---

### EVT-04: `CHAT_CHANGED` (Coordinator)
* **Trigger:** User switches active chat or current chat is reloaded.
* **Registered In:** `index.js` (line 2046)
* **Handler:** Multi-step staggered coordinator
* **Purpose:** 
  1. Synchronizes vitality and memo state (`scheduleSync`)
  2. Updates Concierge context
  3. Checks partition projection integrity (quarantine guard)
  4. Enforces ruleset consistency (PbtA vs D&D 5e stock prompt sanitization)
  5. Updates UI badges, Lorebook UI, NameRAG adhoc prompt, and relationship sync
* **Blast Radius:** Switching between D&D and PbtA campaigns will contaminate prompts; damaged partitions will not be quarantined; relationship tiers will not display.
* **Smell / Risk:** **High (CS-EVT-01)**. 5 staggered `setTimeout` calls (550ms, 600ms, 650ms, 700ms, 800ms).

---

### EVT-05: `CHAT_CHANGED` (CYOA State Reset)
* **Trigger:** User switches active chat or reloads.
* **Registered In:** `cyoa-guardian.js` (line 393)
* **Handler:** Resets retry tracker, clears pending reminders, aborts active Stage 2 CYOA pass.
* **Blast Radius:** CYOA generation from the previous chat could finish and append choices onto the *new* chat!
* **Smell / Risk:** Low risk. Necessary boundary guard.

---

### EVT-06: `CHARACTER_MESSAGE_RENDERED` (Decoupled CYOA Stage 2)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM.
* **Registered In:** `cyoa-guardian.js` (line 430)
* **Handler:** Checks if narrator streaming is complete; if so, immediately triggers `runDecoupledCyoaStage2()`, locks send button, and shows loading indicator.
* **Preconditions:** `enableDecoupledCyoa !== false`, not message 0, adventure active, CYOA expected, message does not already contain choices.
* **Blast Radius:** CYOA buttons will not generate automatically; user must click manual regenerate.
* **Smell / Risk:** Overlaps with `GENERATION_ENDED` fail-safe.

---

### EVT-07: `CHARACTER_MESSAGE_RENDERED` (Relationship & Vitality Sync)
* **Trigger:** SillyTavern renders character message.
* **Registered In:** `index.js` (line 2079)
* **Handler:** Calls `scheduleSync('CHARACTER_MESSAGE_RENDERED', 400)` and `setTimeout(600ms, checkAndSyncTierCrossovers)`.
* **Precondition:** `isAdventureActive()`
* **Blast Radius:** Relationship tier progression and health synchronization will not update after LLM turns.
* **Smell / Risk:** Overlaps with `MESSAGE_RECEIVED` (CS-EVT-03).

---

### EVT-08: `MESSAGE_RECEIVED` (Relationship & Vitality Sync)
* **Trigger:** SillyTavern receives message payload from backend.
* **Registered In:** `index.js` (line 2087)
* **Handler:** Identical to EVT-07.
* **Precondition:** `isAdventureActive()`
* **Blast Radius:** Redundant with EVT-07.
* **Smell / Risk:** **High redundancy**. Calling the exact same debounced logic on both `MESSAGE_RECEIVED` and `CHARACTER_MESSAGE_RENDERED`.

---

### EVT-09: `SETTINGS_UPDATED` (Ruleset & State Sync)
* **Trigger:** Any extension or core writes settings.
* **Registered In:** `index.js` (line 2095)
* **Handler:** Staggered coordinator (650ms, 700ms, 750ms, 800ms) to re-verify ruleset consistency and update UI badges.
* **Guards:** `if (isPersistingPbtaChatState()) return;`
* **Blast Radius:** Settings changes (e.g. toggling PbtA or Lorebook Sync) will not immediately update the UI.
* **Smell / Risk:** Re-entrancy hazard (CS-EVT-04).

---

### EVT-10: `GENERATION_STARTED` (CYOA Guard)
* **Trigger:** User clicks Send, Regenerate, or Swipe.
* **Registered In:** `cyoa-guardian.js` (line 371)
* **Handler:** Aborts in-flight Stage 2 CYOA pass; resets stop flags and tracking pointers.
* **Blast Radius:** Swiping a message would leave previous Stage 2 generation running in the background, overwriting the new swipe.
* **Smell / Risk:** Low risk. Clean abort handler.

---

### EVT-11: `GENERATION_STOPPED` (CYOA Stop Guard)
* **Trigger:** User clicks the Stop generation button in SillyTavern.
* **Registered In:** `cyoa-guardian.js` (line 385)
* **Handler:** Sets `_wasGenerationStopped = true`, aborts Stage 2 CYOA pass immediately.
* **Blast Radius:** Clicking Stop would stop the narrative text but allow Stage 2 to continue running.
* **Smell / Risk:** Low risk. Clean abort handler.

---

### EVT-12: `GENERATION_ENDED` (CYOA Backup Trigger)
* **Trigger:** Generation pipeline concludes.
* **Registered In:** `cyoa-guardian.js` (line 514)
* **Handler:** Fail-safe backup. If `CHARACTER_MESSAGE_RENDERED` did not trigger Stage 2 (or was skipped because streaming was ongoing), triggers `runDecoupledCyoaStage2()`.
* **Blast Radius:** Messages generated without triggering message-rendered events would lack CYOA choices.
* **Smell / Risk:** Redundancy with EVT-06.

---

### EVT-13: `CHAT_COMPLETION_PROMPT_READY` (CYOA Prompt Sanitizer)
* **Trigger:** SillyTavern constructs prompt payload right before sending to LLM.
* **Registered In:** `cyoa-guardian.js` (line 420)
* **Handler:** `stripCyoaFromOutgoingChat(eventData.chat)` removes synthetic CYOA buttons and tags from past context so the LLM doesn't mimic button syntax.
* **Blast Radius:** LLM starts generating its own malformed pseudo-buttons and breaks character prose.
* **Smell / Risk:** Low risk. Synchronous and purely scoped.

---

## 4. DOM Event Delegation Registry (`$(document).on`)

In addition to `eventSource`, Companion uses jQuery global event delegation on `document` to intercept upstream MultiHog clicks before MultiHog's native handlers run:

| Handler ID | Target Selector | File & Line | Mechanism / Action | Code Smell / Fragility Risk |
| :--- | :--- | :--- | :--- | :--- |
| **DOM-01** | `#rt-quickstart-begin`<br>`#rt-cr-generate-btn` | `index.js:2016` | **Pre-flight Sanitizer:** Before character generation starts, checks if active chat is standard D&D and purges any stale PbtA prompts from `stockPrompts`. | 🟡 **MODERATE**: Runs on click instead of form submit; assumes button IDs never change upstream. |
| **DOM-02** | `#rt-quickstart-roll-name` | `namerag-hooks.js:426` | **Hijack:** Calls `e.stopImmediatePropagation()`. Cancels MultiHog's native random name roll and calls NameRAG API instead. | 🔴 **HIGH**: Silently suppresses upstream listener. If NameRAG fails or hangs, button appears broken to user. |
| **DOM-03** | `#rt-cr-random-name` | `namerag-hooks.js:449` | **Hijack:** Calls `e.stopImmediatePropagation()`. Cancels MultiHog's Character Creator random name roll and queries NameRAG. | 🔴 **HIGH**: Same as DOM-02. |
| **DOM-04** | `#rt-ob-roll-name` | `namerag-hooks.js:472` | **Hijack:** Calls `e.stopImmediatePropagation()`. Cancels Onboarding roll button and queries NameRAG. | 🔴 **HIGH**: Same as DOM-02. |
| **DOM-05** | `#rt-quickstart-begin` | `namerag-hooks.js:495` | **Passive Listener:** Captures selected name and caches it for NameRAG tracking. Does NOT stop propagation. | 🟢 **LOW**: Passive observer. |
| **DOM-06** | `.mes_stop, #mes_stop, .rt-cyoa-cancel-btn` | `cyoa-guardian.js:410` | **Native `document.addEventListener('click', ..., true)` (Capture Phase):** Catches user clicking Stop anywhere in the UI to immediately abort in-flight Stage 2 CYOA. | 🟢 **CLEAN**: Uses capture phase (`true`) so it aborts even if other handlers stop bubble propagation. |

---

## 5. Summary of Recommended Phase 2/3 Optimizations

1. **Eliminate the `setTimeout` Cascade (EVT-04):**
   * Replace the 550ms–800ms staggered ladder with a single `onChatChangedCoordinator()` async sequence. A single sequence can verify partitions, cleanse rulesets, and refresh UI in deterministic order without arbitrary millisecond delays.
2. **Deduplicate `CHARACTER_MESSAGE_RENDERED` vs `MESSAGE_RECEIVED` (EVT-07 & EVT-08):**
   * Both call the exact same debounced sync schedule for tier crossovers. Consolidate to `CHARACTER_MESSAGE_RENDERED` only.
3. **Consolidate CYOA Stage 2 Triggering (EVT-06 & EVT-12):**
   * Unify the triggering pipeline so `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED` call a single idempotent dispatcher that clearly documents when each takes precedence.
4. **NameRAG Fallback Resilience (DOM-02 to DOM-04):**
   * If NameRAG service is offline or throws an error, catch the error and fall back to triggering upstream MultiHog's native roll handler instead of leaving the input empty.
