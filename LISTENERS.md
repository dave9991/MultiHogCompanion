# MultiHog Companion — Event Catalog & Listener Registry

> **Purpose:** Document every SillyTavern app event, DOM event delegation, and lifecycle hook registered by `MultiHogCompanion`.
> Because event listeners decouple trigger from reaction, this document serves as the central map of triggers, execution order, shared event overlaps, blast radius, and code smells / race conditions.

---

## 0. The 4-Way Reference Web

MultiHog Companion separates **Intent** from **Mechanism** across four synchronized catalogs:

```
┌─────────────────────────────────┬─────────────────────────────────┐
│       WHAT ARE WE DOING?        │       HOW IS IT WIRED?          │
│            (Intent)             │          (Mechanism)            │
├─────────────────────────────────┼─────────────────────────────────┤
│ FEATURES.md                     │ LISTENERS.md (This File)        │
│ • User-facing capabilities      │ • Event Bus (eventSource.on)    │
│ • Ruleset engine (PbtA)         │ • DOM Delegation ($(doc).on)    │
│ • Concierge Session Zero        │ • Debounce & Settlement Timers  │
│ • Relationship Narrative Sync   │ • Coordinator Pipelines         │
├─────────────────────────────────┼─────────────────────────────────┤
│ WORKAROUNDS.md                  │ MONKEYPATCHES.md                │
│ • Upstream defects & hazards    │ • ADRs for runtime hijacking    │
│ • Why upstream is broken/risky  │ • window.fetch interception     │
│ • Blast radius if unmitigated   │ • generateRaw API wrapping      │
│ • Upstream retirement criteria  │ • In-memory settings rewriting  │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## 1. Shared Event Overlap & Execution Timeline Matrix

The following matrix highlights events where **multiple files or upstream MultiHog** listen to the exact same event. Phase 2 resolved the primary race condition hotspots by replacing arbitrary `setTimeout` ladders with deterministic coordinators and deduplicating redundant listeners.

| Event Type | Participating Files / Handlers | Execution Priority / Order | Status / Risk Rating |
| :--- | :--- | :--- | :--- |
| **`CHAT_CHANGED`** | • `cyoa-safety-net.js`<br>• `index.js` (`runChatChangedCoordinator`)<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (EVT-05 sync abort)<br>2. Upstream `onChatChanged` (async state reload)<br>3. `index.js` (Debounced 500ms settlement window -> deterministic sequential coordinator with token invalidation) | 🟢 **RESOLVED**: Arbitrary `setTimeout` ladder eliminated; token invalidation prevents stale cross-chat overwrites. |
| **`CHAT_RENAMED`** | • `adventure-chat.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `adventure-chat.js` (`eventSource.makeFirst`)<br>2. Upstream `onChatRenamedMigrate`<br>3. `index.js` (150ms debounce) | 🟡 **MODERATE**: Relies on `eventSource.makeFirst` monkey patch to beat upstream migration. |
| **`CHARACTER_MESSAGE_RENDERED`** | • `index.js` (canonical assistant turn listener)<br>• *Upstream MultiHog* | 1. `index.js` (schedules tier crossover check)<br>2. *(CYOA auto-dispatch retired in favor of DOM-07 Wand action)* | 🟢 **RESOLVED**: Canonical assistant turn trigger for Relationship Sync. Automated CYOA background trigger retired. |
| **`MESSAGE_RECEIVED`** | • *Upstream MultiHog* | 1. Upstream `onMapArchitectAssistantMessage` | 🟢 **REMOVED**: Redundant Companion listener removed; consolidated into `CHARACTER_MESSAGE_RENDERED`. |
| **`SETTINGS_UPDATED`** | • `index.js` (`runSettingsUpdatedCoordinator`)<br>• *Upstream MultiHog* | 1. `index.js` (Debounced 600ms settlement window with `_isSettingsSyncActive` mutex gate) | 🟢 **RESOLVED**: Re-entrancy loop eliminated; 4 nested timeouts collapsed into single atomic pass. |
| **`GENERATION_STARTED`** | • `cyoa-safety-net.js`<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (aborts in-flight on-demand CYOA generation) | 🟢 **LOW**: Clean state-reset hook. |
| **`GENERATION_STOPPED`** | • `cyoa-safety-net.js`<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (aborts in-flight on-demand CYOA generation) | 🟢 **LOW**: Clean abort handler. |
| **`GENERATION_ENDED`** | • *Upstream MultiHog* | *(Companion CYOA auto-dispatch retired in favor of DOM-07 Wand action)* | 🟢 **RETIRED (Companion)**: Automated background trigger replaced with deterministic on-demand Wand/Slash execution. |
| **`CHAT_COMPLETION_PROMPT_READY`** | • *Upstream MultiHog* | *(Companion CYOA prompt stripping retired in favor of native upstream pruning)* | 🟢 **RETIRED (Companion)**: Decommissioned to defer to upstream MultiHog's native choice pruning and avoid fragile regex parsing of story prose. |
| **`APP_READY`** | • `index.js` (`setupImagineInterceptor`)<br>• *Upstream MultiHog* | 1. Companion wraps `/imagine` callback | 🟢 **LOW**: Run-once initialization. |

---

## 2. Shared Event Timelines & Architecture

### Timeline: `CHAT_CHANGED` (Coordinated Lifecycle)
When the user switches chats or reloads a chat, multiple asynchronous systems interact with `extensionSettings.rpg_tracker` and the chat metadata. Phase 2 replaced the arbitrary `setTimeout` ladder with a token-invalidated, sequential coordinator:

```
T+0ms:    [cyoa-safety-net.js] Abort any in-flight on-demand CYOA generation immediately.
T+0ms:    [Upstream MultiHog] onChatChanged begins reading chat metadata and initializing partitions.
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
SillyTavern emits `CHAT_RENAMED` when a chat is saved with a new title.
⚠️ **Critical Order of Operations**: In SillyTavern's `renameChat()` (`script.js`), it executes `await reloadCurrentChat()` *before* emitting `CHAT_RENAMED`. This means `CHAT_CHANGED` fires *first*, momentarily presenting an unmigrated partition to upstream MultiHog.

```
T+0ms (pre): SillyTavern calls reloadCurrentChat() -> CHAT_CHANGED fires first.
             Upstream MultiHog notes an unfamiliar partition key.
─────────────────────────────────────────────────────────────────────────────
T+0ms:       SillyTavern emits CHAT_RENAMED with payload: { avatarId, groupId, oldFileName, newFileName }
             │
             ├── [adventure-chat.js] (EVT-02 via eventSource.makeFirst)
             │   ↳ Fires BEFORE upstream MultiHog!
             │   ↳ Re-arms runtimeState.pendingUnseenChatReset = { oldId, newId }
             │   ↳ Guarantees the pending restart proof is active.
             │
             ├── [Upstream MultiHog] (onChatRenamedMigrate via standard eventSource.on)
             │   ↳ Fires SECOND.
             │   ↳ Sees the armed proof and successfully migrates partition files on disk.
             │
             └── [index.js] (EVT-03 via standard eventSource.on)
                 ↳ Fires THIRD.
                 ↳ Captures detail.newFileName and arms a 150ms debounced settlement timer.
─────────────────────────────────────────────────────────────────────────────
T+150ms:     [index.js] Debounce timer fires after upstream async file writes settle:
             syncCampaignLorebooks({ isAuto: true, chatId: targetChatId })
             updateLorebookSyncUI().
```

---

### Timeline: `CHARACTER_MESSAGE_RENDERED` (Post-Turn)
This is the only post-generation assistant-turn listener. Automated CYOA dispatch (formerly on `CHARACTER_MESSAGE_RENDERED` / `GENERATION_ENDED`) was retired; CYOA now runs only on demand via the Wand menu (`DOM-07`) and `/cyoafix`, `/cyoagen`, `/cyoaretry`.

```
Streaming finishes ->
T+0ms:    [index.js] CHARACTER_MESSAGE_RENDERED fires (EVT-07):
          Ignores type === 'first_message'; aborts if !isAdventureActive().
          scheduleSync('CHARACTER_MESSAGE_RENDERED', 400)   -> persona / portrait / memo sync.
          coordinateTierSyncAfterTurn():
            awaits MultiHog Lorebook Agent (rt_lore_agent_step finish/error) if isRouterRunning(),
            then checkAndSyncTierCrossovers() & updateRelationshipSyncUI().
(No CYOA listener fires here. If the user later taps the Wand action, DOM-07 evaluates the latest settled message.)
```

---

### Timeline: `SETTINGS_UPDATED` (Re-entrancy Protected)
SillyTavern emits `SETTINGS_UPDATED` anytime `saveSettingsDebounced()` is called.

```
T+0ms:    [index.js] SETTINGS_UPDATED fires:
          Early Guard: if (isPersistingPbtaChatState()) { clearPersistingPbtaChatState(); scheduleSync('SETTINGS_UPDATED', 600); return; }
          Re-entrancy Mutex: if (_isSettingsSyncActive) { _pendingSettingsUpdatedSync = true; return; }
          Arms 600ms debounced timer.
T+600ms:  [index.js] runSettingsUpdatedCoordinator() executes under _isSettingsSyncActive mutex:
          ensureActiveChatRulesetConsistency()
          updateRulesetBadge()
          updateLorebookSyncUI()
          updateRelationshipSyncUI()
          runSync('SETTINGS_UPDATED')
          (If _pendingSettingsUpdatedSync was flagged during execution, schedules a trailing 350ms sync.)
```

---

## 3. Comprehensive Event Catalog

### EVT-01: `APP_READY`
* **Trigger:** SillyTavern UI and all core/third-party extensions have finished loading and the loader overlay is dismissed.
* **Registered In:** `index.js` (`initialize`, after `initCyoaSafetyNet`)
* **Handler:** `setupImagineInterceptor()`
* **Purpose:** Hijacks `/imagine` slash command callback to inject dynamic aspect ratios for image generation.
* **Auto-Fire Guarantee:** In `events.js`, `APP_READY` is configured with `autoFireAfterEmit`. If this listener attaches after `APP_READY` has already fired, `eventSource.on` synchronously executes `setupImagineInterceptor()` immediately.
* **Idempotency Guard:** `setupImagineInterceptor()` is invoked during both root `jQuery` evaluation and `APP_READY`. It guards against multiple wrappings via `if (imagineCmd._mhcIntercepted) return;`.
* **Blast Radius:** If removed, `/imagine` will use stock square aspect ratios instead of matching the active scene/portrait dimensions.
* **Status:** Clean single-shot initialization.

---

### EVT-02: `CHAT_RENAMED` (Adventure Rename Guard)
* **Trigger:** Active chat is renamed (`renameChat` in `script.js`).
* **Registered In:** `adventure-chat.js` (`initAdventureChatRenameGuard`)
* **Registration Method:** `eventSource.makeFirst` (falls back to `eventSource.on`)
* **Execution Priority:** Guaranteed 1st (`makeFirst` unshifts before upstream MultiHog's listener).
* **Payload Structure:** `{ avatarId, groupId, oldFileName, newFileName }`
* **Purpose:** Synchronizes MultiHog restart proof metadata (`runtimeState.pendingUnseenChatReset = { oldId, newId }`) so that new chats created by Adventure Start or Concierge Campaign Launch migrate cleanly without losing partition links when upstream's `onChatRenamedMigrate` fires.
* **Blast Radius:** Upstream MultiHog's native rename handler will treat the chat as an unknown partition, causing partition reset and loss of campaign state.
* **Status:** Clean early-hook synchronization.

---

### EVT-03: `CHAT_RENAMED` (Lorebook Auto-Sync)
* **Trigger:** Active chat is renamed.
* **Registered In:** `index.js` (CHAT_RENAMED block, 150ms debounce)
* **Execution Priority:** Standard FIFO (`eventSource.on`, debounced 150ms).
* **Handler:** Captures `detail.newFileName` and debounces 150ms before calling `syncCampaignLorebooks({ isAuto: true, chatId: targetChatId })`.
* **Purpose:** Automatically renames and migrates bound campaign lorebook stacks to match the new chat title after upstream disk migration finishes.
* **Precondition:** `s.enableLorebookSync && s.autoSyncOnRename`
* **Debounce Window:** 150ms delay allows upstream asynchronous file system operations to settle before Companion scans and clones lorebooks.
* **Blast Radius:** Lorebooks retain old chat title and become detached from the renamed campaign.
* **Status:** Active, deterministic with targetChatId parameter.

---

### EVT-04: `CHAT_CHANGED` (Coordinator — Phase 2 Reconciled)
* **Trigger:** User switches active chat or current chat is reloaded. Emitted by SillyTavern with `(getCurrentChatId())`.
* **Registered In:** `index.js` (`runChatChangedCoordinator`)
* **Handler:** Captures `chatId`, arms a 500ms settlement timer, increments `_activeChatChangedToken`, and invokes `runChatChangedCoordinator(activeChatId, token)`.
* **Purpose (Phase 2 Reconciliation):**
  1. Awaits 500ms so upstream MultiHog's debounced partition loading settles.
  2. Verifies projection integrity via `checkTrackerProjectionIntegrity` (quarantines damaged partitions if foreign state leaks).
  3. Enforces ruleset consistency via `ensureActiveChatRulesetConsistency` (cleanses D&D 5e prompts if stock chat, or hydrates PbtA cartridge if PbtA campaign).
  4. Synchronizes live persona and portrait to current chat via `runSync('CHAT_CHANGED')`.
  5. Updates UI badges, Lorebook Sync UI, NameRAG adhoc prompt, and relationship sync.
* **Cancellation Guard:** Token checked on every continuation (`if (token !== _activeChatChangedToken) return;`). If the user rapidly switches chats again, pending work instantly aborts.
* **Blast Radius:** Switching between D&D and PbtA campaigns will contaminate prompts; damaged partitions will not be quarantined; relationship tiers will not display.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Staggered `setTimeout` ladder eliminated; token invalidation prevents stale cross-chat overwrites.

---

### EVT-05: `CHAT_CHANGED` (CYOA State Reset — Phase 1 Immediate)
* **Trigger:** User switches active chat or current chat is reloaded.
* **Registered In:** `cyoa-safety-net.js` (`initCyoaSafetyNet`)
* **Execution Priority:** Synchronous T+0ms (runs immediately without delay).
* **Handler:** Resets `_wasGenerationStopped` and the attempted message/swipe registers, then aborts any in-flight on-demand CYOA generation via `abortCyoaGeneration('chat_changed')`.
* **Purpose (Phase 1 Immediate Severance):** Instantly severs the AbortController for any in-flight background CYOA LLM generation or quiet prompt belonging to the *departing* chat.
* **Blast Radius:** If removed or delayed, a CYOA generation initiated in Chat A will finish seconds later and append button choices into Chat B's DOM.
* **Status:** Clean state reset.

---

### EVT-06: `CHARACTER_MESSAGE_RENDERED` [RETIRED] (Formerly CYOA Safety Net Dispatcher)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM.
* **Status:** 🔴 **RETIRED (CYOA)**. The automated CYOA dispatcher in `cyoa-safety-net.js` was decommissioned in favor of [`DOM-07`](#dom-07) (Wand Menu & Slash Commands), eliminating race conditions with tool-calling and reasoning models.
* **Successor:** Relationship Narrative Sync and persona alignment on this event are documented under [`EVT-07`](#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b), the sole active `CHARACTER_MESSAGE_RENDERED` listener.
* **Anchor Preserved:** `[CATALOG: EVT-06]` preserved in `cyoa-safety-net.js` for architectural traceability.

---

### EVT-07: `CHARACTER_MESSAGE_RENDERED` (Relationship & Vitality Sync — Pipeline B)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM.
* **Registered In:** `index.js` (`coordinateTierSyncAfterTurn` listener)
* **Payload Structure:** `(messageId: number, type?: string)`
* **Handler:** Canonical assistant turn event:
  1. **Greeting Guard:** Ignores `type === 'first_message'`.
  2. **Clean Chat Guard:** Aborts if `!isAdventureActive()` to prevent polluting unstarted chats.
  3. **T+400ms Persona Sync:** Calls `scheduleSync('CHARACTER_MESSAGE_RENDERED', 400)` to synchronize persona/player portrait and memo state.
  4. **Reactive Relationship Coordinator (`coordinateTierSyncAfterTurn`):** Inspects MultiHog's `isRouterRunning()`. If MultiHog's Lorebook Agent is actively running on this turn, yields and awaits the completion event `rt_lore_agent_step` (`finish`/`error`). Once MultiHog is done (or immediately if Lorebook Agent is inactive), executes `checkAndSyncTierCrossovers()` to evaluate whether NPC friendship/affection crossed a tier threshold, surgically updating `[CORE]` / appending milestones in the lorebook without clobbering MultiHog's updates.
* **Precondition:** `isAdventureActive()`
* **Blast Radius:** Relationship tier progression and health synchronization will not update after LLM turns.
* **Optimization Status:** **CANONICAL (Phase 2 & 4)**. Single message-turn listener; `setTimeout` ladder retired in favor of reactive event coordinator.

---

### EVT-08: `SETTINGS_UPDATED` (Ruleset & State Sync Coordinator)
* **Trigger:** Emitted globally by SillyTavern whenever core or any extension persists settings (`saveSettingsDebounced`).
* **Registered In:** `index.js` (`runSettingsUpdatedCoordinator`)
* **Handler:** Debounces 600ms and executes `runSettingsUpdatedCoordinator()` protected by the Two-Tier Shield.
* **The Two-Tier Anti-Recursion Shield:**
  1. **Shield 1 (Self-Inflicted Write Consumption):** `if (isPersistingPbtaChatState()) { clearPersistingPbtaChatState(); scheduleSync('SETTINGS_UPDATED', 600); return; }`. Consumes self-triggered ruleset persistence writes while preserving trailing Persona/Portrait sync checks.
  2. **Shield 2 (Re-Entrancy Mutex Gate):** `if (_isSettingsSyncActive) { _pendingSettingsUpdatedSync = true; return; }`. Ensures all settings reactions run inside an active lock (`_isSettingsSyncActive = true`), dropping re-entrant ruleset cascades while queueing a trailing `scheduleSync` if external settings updates (such as portrait saves) arrive mid-execution.
* **Execution Flow (Settlement Window T+600ms):**
  1. `ensureActiveChatRulesetConsistency()`
  2. `updateRulesetBadge()`
  3. `updateLorebookSyncUI()`
  4. `updateRelationshipSyncUI()`
  5. `runSync('SETTINGS_UPDATED')`
* **Blast Radius:** If the mutex is missing, settings updates trigger infinite recursion loops freezing the UI; if removed, settings changes will not update badges or sync states.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Four nested timeouts collapsed into single mutex-shielded pass.

---

### EVT-09: `GENERATION_STARTED` (CYOA Foreground Generation Guard)
* **Trigger:** Emitted when SillyTavern begins generation for Send, Regenerate, Swipe, Continue, or Impersonate.
* **Registered In:** `cyoa-safety-net.js` (`initCyoaSafetyNet`)
* **Payload Structure:** `(type: string, params: object, dryRun: boolean)`
* **Handler:**
  1. **Dry-Run Guard:** Ignores token calculation passes (`if (dryRun) return;`).
  2. **Quiet Prompt Guard:** Ignores background API calls from other extensions (`if (type === 'quiet') return;`).
  3. **Immediate Abort:** Calls `abortCyoaGeneration('generation_started')` to abort the `AbortController` of any in-flight on-demand CYOA LLM request.
  4. **State Reset:** Resets `_wasGenerationStopped = false`, `_lastAttemptedMessageId = -1`, `_lastAttemptedSwipeId = -1`.
* **The "Ghost Swipe" Collision Hazard:** If a user receives a turn without buttons and quickly clicks Swipe or Regenerate, an in-flight on-demand choice generation pass would otherwise finish seconds later and inject buttons meant for the previous abandoned swipe into the new swipe.
* **Status:** Clean abort handler with dryRun and quiet filters.

---

### EVT-10: `GENERATION_STOPPED` (CYOA Stop Guard & Aborted Message Shield)
* **Trigger:** User clicks the Stop generation button in SillyTavern UI (`stopGeneration()` in `script.js`).
* **Registered In:** `cyoa-safety-net.js` (`initCyoaSafetyNet`)
* **Execution Priority:** Synchronous T+0ms upon stop emission.
* **Handler:**
  1. Sets `_wasGenerationStopped = true`.
  2. Resets `_lastAttemptedMessageId = -1` and `_lastAttemptedSwipeId = -1`.
  3. Aborts any in-flight on-demand CYOA request via `abortCyoaGeneration('generation_stopped')`.
* **The "Truncated Message Choice Leak" Hazard:** When a user stops generation mid-turn, SillyTavern preserves the partial truncated message and still emits `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED`. Without the `_wasGenerationStopped` shield, a non-forced `coordinateCyoaForMessage` call would interpret the truncated text as "missing choices" and start an unwanted choice generation pass on an abandoned turn. An explicit forced Wand/slash invocation clears the flag and proceeds.
* **Dual-Layer Stop Defense:** `EVT-10` handles stops during host narrative streaming, while [`DOM-06`](#dom-06) intercepts stop/cancel clicks while an on-demand CYOA generation is in flight.
* **Blast Radius:** Clicking Stop would abort text streaming but allow an in-flight CYOA generation to continue and erroneously inject buttons into incomplete messages.
* **Status:** Clean abort handler with aborted message shielding.

---

### EVT-11: `GENERATION_ENDED` [RETIRED] (Formerly CYOA Fallback Completion Trigger)
* **Trigger:** Generation and token streaming conclude (`hideStopButton()` called by `activateSendButtons()` in `script.js`).
* **Status:** 🔴 **RETIRED**. The automated background CYOA fallback completion hook was decommissioned to eliminate collisions with multi-turn tool calling and reasoning models. CYOA formatting and choice formulation are now driven on-demand via the Wand Menu (`DOM-07`) and slash commands (`/cyoafix`, `/cyoagen`).
* **Anchor Preserved:** `[CATALOG: EVT-11]` preserved in codebase for architectural traceability.

---

### EVT-12: `CHAT_COMPLETION_PROMPT_READY` [RETIRED] (Formerly Outgoing CYOA Prompt Sanitizer)
* **Trigger:** SillyTavern constructs the prompt payload and completes token budgeting right before dispatching the HTTP request to the Chat Completion API (`openai.js:1610` and `script.js:3978`).
* **Status:** 🔴 **RETIRED**. Decommissioned along with ADR-MP-03's CYOA stripping to defer to upstream MultiHog's native choice pruning (`cyoaConfig.stripOldChoicesFromPrompt`). Eliminates fragile regular expression parsing of natural language story prose and aligns with the on-demand Wand/Slash CYOA model (`DOM-07`).
* **Anchor Preserved:** `[CATALOG: EVT-12]` preserved in codebase for architectural traceability.

---

## 4. DOM Event Delegation Registry (`$(document).on`)

| Handler ID | Event Namespace & Target Selector | File | Mechanism / Action | Hardening Status |
| :--- | :--- | :--- | :--- | :--- |
| <a id="dom-01a"></a>**DOM-01a** | `click.mhc_quickstart_sanitizer`<br>`#rt-quickstart-begin`, `#rt-cr-generate-btn`, `.rt-quickstart-genre-btn` | `index.js` | **Pre-flight Sanitizer (Click):** Before character generation starts, checks if active chat is standard D&D and purges stale PbtA prompts from `stockPrompts`. Halts upstream click asynchronously until cleansing completes. | 🟢 **ACTIVE (Hardened)**: Blocks upstream race condition on generation start. |
| <a id="dom-01b"></a>**DOM-01b** | `keydown.mhc_quickstart_sanitizer`<br>`#rt-quickstart-name`, `#rt-cr-name` | `index.js` | **Pre-flight Sanitizer (Enter Key):** Catches keyboard submissions when user presses Enter inside name input fields. | 🟢 **ACTIVE (Phase 3)**: Guarantees prompt sanitization even when user bypasses mouse clicks. |
| <a id="dom-02"></a>**DOM-02** | `click.mhc_namerag_qs`<br>`#rt-quickstart-roll-name` | `namerag-hooks.js` | **Hijack with Context-Aware Query:** Calls `e.stopImmediatePropagation()`. Extracts `#rt-quickstart-instructions` and gender clues to query NameRAG with 4s timeout. Falls back to offline character generator and emits warning toast on failure. | 🟢 **HARDENED (Context-Aware)**: Timeout added; offline fallback; user notified via toast if NameRAG unavailable. |
| <a id="dom-03"></a>**DOM-03** | `click.mhc_namerag_cr`<br>`#rt-cr-random-name` | `namerag-hooks.js` | **Hijack with Context-Aware Query:** Extracts Character Creator background, appearance, traits, class, and gender to query specific NameRAG candidates with 4s timeout. | 🟢 **HARDENED (Context-Aware)**: Re-enables button on error; emits warning toast. |
| <a id="dom-04"></a>**DOM-04** | `click.mhc_namerag_ob`<br>`#rt-ob-roll-name` | `namerag-hooks.js` | **Hijack with Context-Aware Query:** Same resilient fallback and context query as DOM-02. | 🟢 **HARDENED (Context-Aware)**: Re-enables button on error; emits warning toast. |
| <a id="dom-05"></a>**DOM-05** | `click.mhc_namerag_begin`<br>`#rt-quickstart-begin` | `namerag-hooks.js` | **Pre-fill Observer:** If name field is empty, rolls context-aware NameRAG candidate to seed character creation. | 🟢 **HARDENED (Context-Aware)**: Wrapped in try/catch; falls back gracefully. |
| <a id="dom-06"></a>**DOM-06** | Native Capture Phase Click<br>`.mes_stop, #mes_stop, .rt-cyoa-cancel-btn` | `cyoa-safety-net.js` | **Native `document.addEventListener('click', ..., true)` (Capture Phase):** Catches user clicking Stop anywhere in the UI to immediately abort any in-flight on-demand CYOA generation. | 🟢 **CLEAN**: Uses capture phase (`true`). |
| <a id="dom-07"></a>**DOM-07** | `click.mhc_wand_cyoa`<br>`#mhc_wand_cyoa_fix_reroll`, `#extensionsMenuButton` | `index.js` | **Wand Menu CYOA Fix/Reroll Trigger:** Executes `handleWandCyoaFixOrReroll`. Strictly evaluates latest message in chat (`chat[chat.length - 1]`). If plain numbered markdown choices exist, auto-repairs them into interactive buttons (0 tokens). If missing or already present, triggers choice generator to formulate fresh choices. Fails safely on toolcall system cards or incomplete turns without mutating history. | 🟢 **ACTIVE (Hardened)**: Guarded against toolcall collisions and empty narrator turns. |
| <a id="dom-08"></a>**DOM-08** | `click.mhc_level_up_xp`<br>`.mhc-xp-level-up-ready` | `index.js` | **XP Bar Level-Up Trigger:** Launches the Level-Up Concierge modal when clicking an illuminated/glowing XP progress bar. | 🟢 **ACTIVE (FEAT-10)**: Bound via delegated handler; triggers hybrid advancement review screen. |
| <a id="dom-09"></a>**DOM-09** | `click.mhc_wand_level_up`<br>`#mhc_wand_level_up_respec` | `index.js` | **Wand Menu Level-Up / Respec Trigger:** Evaluates character eligibility to either trigger level advancement (if milestone reached) or character respec and build tuning (if normal). | 🟢 **ACTIVE (FEAT-10)**: Dual-mode dynamic action in SillyTavern extensions menu. |
| <a id="dom-10"></a>**DOM-10** | `click.mhc_loc_reroll`<br>`.menu_button, button, [id*="rt-loc-image"]` | `index.js` | **Location Image Reroll Interception:** Captures user clicks on "🤖 AI Generate" inside the "Set Location Image" modal and "🔄 Regenerate" inside generated location preview modals. Arms an active location reroll lease (`_activeLocationReroll`) so [`ADR-MP-02`](./MONKEYPATCHES.md#adr-mp-02-slash-command-callback-wrapping-imagine) injects 16:9 widescreen dimensions into `/imagine` regardless of LLM prompt wording. | 🟢 **ACTIVE (Hardened)**: Bridges manual modal location rerolls with the Aspect-Ratio Bridge. |


