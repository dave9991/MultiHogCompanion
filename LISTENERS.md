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
| **`CHAT_CHANGED`** | • `cyoa-safety-net.js`<br>• `index.js` (`runChatChangedCoordinator`)<br>• *Upstream MultiHog* | 1. `cyoa-guardian` (sync abort)<br>2. Upstream `onChatChanged` (async state reload)<br>3. `index.js` (Debounced 500ms settlement window -> deterministic sequential coordinator with token invalidation) | 🟢 **RESOLVED**: Arbitrary `setTimeout` ladder eliminated; token invalidation prevents stale cross-chat overwrites. |
| **`CHAT_RENAMED`** | • `adventure-chat.js`<br>• `index.js`<br>• *Upstream MultiHog* | 1. `adventure-chat.js` (`eventSource.makeFirst`)<br>2. Upstream `onChatRenamedMigrate`<br>3. `index.js` (`setTimeout` 200ms) | 🟡 **MODERATE**: Relies on `eventSource.makeFirst` monkey patch to beat upstream migration. |
| **`CHARACTER_MESSAGE_RENDERED`** | • `cyoa-safety-net.js` (`coordinateCyoaForMessage`)<br>• `index.js` (canonical assistant turn listener)<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (unified Stage 2 CYOA dispatcher)<br>2. `index.js` (schedules tier crossover check) | 🟢 **RESOLVED**: Canonical assistant turn trigger. Deduplicated against `GENERATION_ENDED`. |
| **`MESSAGE_RECEIVED`** | • *Upstream MultiHog* | 1. Upstream `onMapArchitectAssistantMessage` | 🟢 **REMOVED**: Redundant Companion listener removed; consolidated into `CHARACTER_MESSAGE_RENDERED`. |
| **`SETTINGS_UPDATED`** | • `index.js` (`runSettingsUpdatedCoordinator`)<br>• *Upstream MultiHog* | 1. `index.js` (Debounced 600ms settlement window with `_isSettingsSyncActive` mutex gate) | 🟢 **RESOLVED**: Re-entrancy loop eliminated; 4 nested timeouts collapsed into single atomic pass. |
| **`GENERATION_STARTED`** | • `cyoa-safety-net.js`<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean state-reset hook. |
| **`GENERATION_STOPPED`** | • `cyoa-safety-net.js`<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (aborts Stage 2 pass) | 🟢 **LOW**: Clean abort handler. |
| **`GENERATION_ENDED`** | • `cyoa-safety-net.js` (`coordinateCyoaForMessage`)<br>• *Upstream MultiHog* | 1. `cyoa-safety-net.js` (fail-safe completion trigger) | 🟢 **RESOLVED**: Unified dispatcher ensures Stage 2 runs only once per message turn. |
| **`CHAT_COMPLETION_PROMPT_READY`** | • `cyoa-safety-net.js`<br>• *Upstream MultiHog* | 1. Upstream prompt injection<br>2. `cyoa-safety-net.js` (prompt CYOA stripping) | 🟢 **LOW**: Pure synchronous array transform. |
| **`APP_READY`** | • `index.js` (`setupImagineInterceptor`)<br>• *Upstream MultiHog* | 1. Companion wraps `/imagine` callback | 🟢 **LOW**: Run-once initialization. |

---

## 2. Shared Event Timelines & Architecture

### Timeline: `CHAT_CHANGED` (Coordinated Lifecycle)
When the user switches chats or reloads a chat, multiple asynchronous systems interact with `extensionSettings.rpg_tracker` and the chat metadata. Phase 2 replaced the arbitrary `setTimeout` ladder with a token-invalidated, sequential coordinator:

```
T+0ms:    [cyoa-safety-net.js] Abort any active Stage 2 CYOA pass immediately.
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

### Timeline: `CHARACTER_MESSAGE_RENDERED` vs `GENERATION_ENDED`
These events handle post-generation updates. In Phase 2, redundant listeners were eliminated and CYOA generation was unified under a single dispatcher:

```
Streaming finishes ->
T+0ms:    [cyoa-safety-net.js] CHARACTER_MESSAGE_RENDERED fires:
          Calls coordinateCyoaForMessage().
          If narrator was streaming, defers to GENERATION_ENDED.
          If narrator finished (or non-streaming), triggers Stage 2 CYOA and records messageId/swipeId.
T+0ms:    [index.js] CHARACTER_MESSAGE_RENDERED fires:
          Canonical assistant turn event: scheduleSync('CHARACTER_MESSAGE_RENDERED', 400).
          setTimeout(600ms): checkAndSyncTierCrossovers() & updateRelationshipSyncUI().
T+30ms:   [cyoa-safety-net.js] GENERATION_ENDED fires:
          Calls coordinateCyoaForMessage().
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
* **Trigger:** SillyTavern UI and all core/third-party extensions have finished loading and the loader overlay is dismissed.
* **Registered In:** `index.js` (line 2182)
* **Handler:** `setupImagineInterceptor()`
* **Purpose:** Hijacks `/imagine` slash command callback to inject dynamic aspect ratios for image generation.
* **Auto-Fire Guarantee:** In `events.js`, `APP_READY` is configured with `autoFireAfterEmit`. If this listener attaches after `APP_READY` has already fired, `eventSource.on` synchronously executes `setupImagineInterceptor()` immediately.
* **Idempotency Guard:** `setupImagineInterceptor()` is invoked during both root `jQuery` evaluation and `APP_READY`. It guards against multiple wrappings via `if (imagineCmd._mhcIntercepted) return;`.
* **Blast Radius:** If removed, `/imagine` will use stock square aspect ratios instead of matching the active scene/portrait dimensions.
* **Status:** Clean single-shot initialization.

---

### EVT-02: `CHAT_RENAMED` (Adventure Rename Guard)
* **Trigger:** Active chat is renamed (`renameChat` in `script.js`).
* **Registered In:** `adventure-chat.js` (line 466)
* **Registration Method:** `eventSource.makeFirst` (falls back to `eventSource.on`)
* **Execution Priority:** Guaranteed 1st (`makeFirst` unshifts before upstream MultiHog's listener).
* **Payload Structure:** `{ avatarId, groupId, oldFileName, newFileName }`
* **Purpose:** Synchronizes MultiHog restart proof metadata (`runtimeState.pendingUnseenChatReset = { oldId, newId }`) so that new chats created by Adventure Start or Concierge Campaign Launch migrate cleanly without losing partition links when upstream's `onChatRenamedMigrate` fires.
* **Blast Radius:** Upstream MultiHog's native rename handler will treat the chat as an unknown partition, causing partition reset and loss of campaign state.
* **Status:** Clean early-hook synchronization.

---

### EVT-03: `CHAT_RENAMED` (Lorebook Auto-Sync)
* **Trigger:** Active chat is renamed.
* **Registered In:** `index.js` (line 2255)
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
* **Registered In:** `index.js` (line 2271; coordinator defined at line 1960)
* **Handler:** Captures `chatId`, arms a 500ms settlement window, increments `_activeChatChangedToken`, and invokes `runChatChangedCoordinator(activeChatId, token)`.
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
* **Registered In:** `cyoa-safety-net.js` (line 516)
* **Execution Priority:** Synchronous T+0ms (runs immediately without delay).
* **Handler:** Resets retry tracker, clears pending reminders, aborts active Stage 2 CYOA pass via `abortCyoaGeneration('chat_changed')`.
* **Purpose (Phase 1 Immediate Severance):** Instantly severs the AbortController for any in-flight background CYOA LLM generation or quiet prompt belonging to the *departing* chat.
* **Blast Radius:** If removed or delayed, a background CYOA generation initiated in Chat A will finish seconds later and append button choices into Chat B's DOM.
* **Status:** Clean state reset.

---

### EVT-06: `CHARACTER_MESSAGE_RENDERED` (CYOA Safety Net & Auto-Repair Dispatcher — Pipeline A)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM. Emitted as `(messageId, type)`.
* **Registered In:** `cyoa-safety-net.js` (line 555)
* **Payload Structure:** `(messageId: number, type?: string)`
* **Handler:** Routes through `coordinateCyoaForMessage(messageId)`. Evaluates the settled assistant message:
  1. **Streaming Guard:** If narrator is still actively streaming tokens, defers execution.
  2. **Deduplication:** Prevents multiple passes on the same message index and swipe ID.
  3. **Happy Path:** If `<choices><button>...</button></choices>` already exist and character is healthy, exits immediately (0 LLM overhead, 1-pass fast generation).
  4. **Local Regex Repair:** If plain numbered markdown choices exist (`1. ... 2. ...`), automatically formats them into buttons via `tryRepairMarkdownChoices` with zero LLM calls.
  5. **Fallback Generation:** If choices were completely skipped or truncated (or if downed without crisis options), launches Stage 2 fallback repair runner via quiet prompt.
* **Preconditions:** `cyoaMode !== 'disabled'`, not message 0, adventure active, CYOA expected, not a tool-call or smallsys message (`extra.isSmallSys`, `tool_invocations`).
* **Blast Radius:** Omitted or plain markdown choices will not be automatically converted into interactive buttons; user must click manual repair.
* **Optimization Status:** **OPTIMIZED (Phase 3)**. Unified reactive safety net with tool-message guarding and zero-cost local regex repairs.

---

### EVT-07: `CHARACTER_MESSAGE_RENDERED` (Relationship & Vitality Sync — Pipeline B)
* **Trigger:** SillyTavern finishes rendering an assistant/character message in the DOM.
* **Registered In:** `index.js` (line 2287)
* **Payload Structure:** `(messageId: number, type?: string)`
* **Handler:** Canonical assistant turn event:
  1. **Greeting Guard:** Ignores `type === 'first_message'`.
  2. **Clean Chat Guard:** Aborts if `!isAdventureActive()` to prevent polluting unstarted chats.
  3. **T+400ms Sync:** Calls `scheduleSync('CHARACTER_MESSAGE_RENDERED', 400)` to synchronize persona/player portrait and memo state.
  4. **T+600ms Relationship Evolution:** Calls `checkAndSyncTierCrossovers()`, scanning if the narrator's turn altered NPC friendship/affection beyond tier thresholds (-150..+150), triggering narrative evolution in the lorebook and refreshing UI badges.
* **Precondition:** `isAdventureActive()`
* **Blast Radius:** Relationship tier progression and health synchronization will not update after LLM turns.
* **Optimization Status:** **CANONICAL (Phase 2)**. Single message-turn listener; duplicate `MESSAGE_RECEIVED` removed.

---

### EVT-08: `SETTINGS_UPDATED` (Ruleset & State Sync Coordinator)
* **Trigger:** Emitted globally by SillyTavern whenever core or any extension persists settings (`saveSettingsDebounced`).
* **Registered In:** `index.js` (line 2297; coordinator defined at line 2013)
* **Handler:** Debounces 600ms and executes `runSettingsUpdatedCoordinator()` protected by the Two-Tier Shield.
* **The Two-Tier Anti-Recursion Shield:**
  1. **Shield 1 (Self-Inflicted Write Consumption):** `if (isPersistingPbtaChatState()) { clearPersistingPbtaChatState(); return; }`. Consumes and absorbs events generated by Companion's own PbtA state persistence.
  2. **Shield 2 (Re-Entrancy Mutex Gate):** `if (_isSettingsSyncActive) return;`. Ensures all settings reactions run inside an active lock (`_isSettingsSyncActive = true`), dropping re-entrant cascade events.
* **Execution Flow (Settlement Window T+600ms):**
  1. `scheduleSync('SETTINGS_UPDATED', 600)`
  2. `ensureActiveChatRulesetConsistency()`
  3. `updateRulesetBadge()`
  4. `updateLorebookSyncUI()`
  5. `updateRelationshipSyncUI()`
* **Blast Radius:** If the mutex is missing, settings updates trigger infinite recursion loops freezing the UI; if removed, settings changes will not update badges or sync states.
* **Optimization Status:** **OPTIMIZED (Phase 2)**. Four nested timeouts collapsed into single mutex-shielded pass.

---

### EVT-09: `GENERATION_STARTED` (CYOA Foreground Generation Guard)
* **Trigger:** Emitted when SillyTavern begins generation for Send, Regenerate, Swipe, Continue, or Impersonate.
* **Registered In:** `cyoa-safety-net.js` (line 496)
* **Payload Structure:** `(type: string, params: object, dryRun: boolean)`
* **Handler:**
  1. **Dry-Run Guard:** Ignores token calculation passes (`if (dryRun) return;`).
  2. **Quiet Prompt Guard:** Ignores background API calls from other extensions (`if (type === 'quiet') return;`).
  3. **Immediate Abort:** Calls `abortCyoaGeneration('generation_started')` to abort the `AbortController` of any in-flight background CYOA LLM request.
  4. **State Reset:** Resets `_wasGenerationStopped = false`, `_lastAttemptedMessageId = -1`, `_lastAttemptedSwipeId = -1`.
* **The "Ghost Swipe" Collision Hazard:** If a user receives a turn without buttons and quickly clicks Swipe or Regenerate, an in-flight background choice generation pass would otherwise finish seconds later and inject buttons meant for the previous abandoned swipe into the new swipe.
* **Status:** Clean abort handler with dryRun and quiet filters.

---

### EVT-10: `GENERATION_STOPPED` (CYOA Stop Guard & Aborted Message Shield)
* **Trigger:** User clicks the Stop generation button in SillyTavern UI (`stopGeneration()` in `script.js`).
* **Registered In:** `cyoa-safety-net.js` (line 508)
* **Execution Priority:** Synchronous T+0ms upon stop emission.
* **Handler:**
  1. Sets `_wasGenerationStopped = true`.
  2. Resets `_lastAttemptedMessageId = -1` and `_lastAttemptedSwipeId = -1`.
  3. Aborts active background Stage 2 CYOA requests via `abortCyoaGeneration('generation_stopped')`.
* **The "Truncated Message Choice Leak" Hazard:** When a user stops generation mid-turn, SillyTavern preserves the partial truncated message and still emits `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED`. Without the `_wasGenerationStopped` shield, the safety net would interpret the truncated text as "missing choices" and start an unwanted choice generation pass on an abandoned turn.
* **Dual-Layer Stop Defense:** `EVT-10` handles stops during host narrative streaming (Stage 1), while [`DOM-06`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/cyoa-safety-net.js#L526) intercepts stop/cancel clicks during background CYOA generation (Stage 2).
* **Blast Radius:** Clicking Stop would abort text streaming but allow background Stage 2 CYOA generation to continue and erroneously inject buttons into incomplete messages.
* **Status:** Clean abort handler with aborted message shielding.

---

### EVT-11: `GENERATION_ENDED` (CYOA Fallback Completion Trigger)
* **Trigger:** Generation and token streaming conclude (`hideStopButton()` called by `activateSendButtons()` in `script.js`).
* **Registered In:** `cyoa-safety-net.js` (line 570)
* **Payload Structure:** `(chatLength: number)`
* **Handler:** Routes through `coordinateCyoaForMessage({ triggerSource: 'GENERATION_ENDED' })`.
* **The Streaming Hand-off Protocol:**
  1. **Streaming Hand-off:** When token streaming is active, `EVT-06` (`CHARACTER_MESSAGE_RENDERED`) fires early while `isNarratorGenerating()` is still `true`, causing it to defer execution. When streaming finally completes, `EVT-11` (`GENERATION_ENDED`) fires, evaluating the completely settled prose.
  2. **Batch Deduplication:** In non-streaming batch mode, `EVT-06` evaluates the message first and records `_lastAttemptedMessageId = idx` and `_lastAttemptedSwipeId = swipeId`. When `EVT-11` fires milliseconds later, the deduplication guard detects the matching registers and exits immediately (0 duplicate work).
  3. **Stop Guard:** If the user stopped generation, `EVT-10` sets `_wasGenerationStopped = true`, causing `EVT-11` to abort without injecting choices into truncated text.
* **Blast Radius:** If removed, streaming responses will never receive CYOA buttons because `CHARACTER_MESSAGE_RENDERED` deferral would have no follow-up trigger.
* **Optimization Status:** **OPTIMIZED (Phase 3)**. Tool-call guarded and deduplicated against `CHARACTER_MESSAGE_RENDERED`.

---

### EVT-12: `CHAT_COMPLETION_PROMPT_READY` (Outgoing CYOA Prompt Sanitizer)
* **Trigger:** SillyTavern constructs the prompt payload and completes token budgeting right before dispatching the HTTP request to the Chat Completion API (`openai.js:1610` and `script.js:3978`).
* **Registered In:** [`cyoa-safety-net.js:544`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/cyoa-safety-net.js#L544)
* **Payload Structure:**
  ```js
  eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
      // eventData: { chat: Array<Message>, dryRun: boolean }
      // chat: mutable array of message objects: [{ role, content/mes, ... }]
      // dryRun: boolean (true when ST is calculating tokens without invoking LLM)
  });
  ```
* **Handler:** Routes through `stripCyoaFromOutgoingChat(eventData.chat, { stripActiveCyoa })`.
* **The "Context Poisoning" Hazard & Dual-Zone Sanitizer**:
  1. **Historical Turn Sanitization ($1 \dots N-1$)**: When generating turn $N$, previous assistant turns in chat history often contain `<choices><button>...</button></choices>` blocks or markdown option lists (`What do you do? 1. Attack 2. Flee`). If left uncleaned in the context window, the LLM suffers severe context poisoning: it echoes stale choices verbatim, hallucinates broken HTML/XML tags mid-sentence, or gets trapped in repetitive decision loops. `EVT-12` cleans all historical choice markup from past turns.
  2. **Active Turn Preservation ($N$)**: In MultiHog Companion's default single-stage fast pipeline (`safety_net` mode), the active user turn's `<CYOA_mode>` XML instructions are strictly **preserved** (`stripActiveCyoa: false`). This instructs the narrator model to output fresh choices directly on Stage 1. Only the legacy/experimental decoupled mode (`two_stage` / `always_decoupled`) strips `<CYOA_mode>` on the active turn.
* **Blast Radius:** If unhandled, older interactive buttons and numbered lists remain in chat context, causing high prompt drift, hallucinated tags, and degraded narrator responses across ongoing campaigns.
* **Optimization Status:** **OPTIMIZED (Phase 3)**. In-place synchronous array mutation; guards against `dryRun` and disabled CYOA; protects active prompt while scrubbing history.

---

## 4. DOM Event Delegation Registry (`$(document).on`)

| Handler ID | Event Namespace & Target Selector | File & Line | Mechanism / Action | Hardening Status |
| :--- | :--- | :--- | :--- | :--- |
| **DOM-01a** | `click.mhc_quickstart_sanitizer`<br>`#rt-quickstart-begin`, `#rt-cr-generate-btn`, `.rt-quickstart-genre-btn` | `index.js:2201` | **Pre-flight Sanitizer (Click):** Before character generation starts, checks if active chat is standard D&D and purges stale PbtA prompts from `stockPrompts`. Halts upstream click asynchronously until cleansing completes. | 🟢 **ACTIVE (Hardened)**: Blocks upstream race condition on generation start. |
| **DOM-01b** | `keydown.mhc_quickstart_sanitizer`<br>`#rt-quickstart-name`, `#rt-cr-name` | `index.js:2126` | **Pre-flight Sanitizer (Enter Key):** Catches keyboard submissions when user presses Enter inside name input fields. | 🟢 **ACTIVE (Phase 3)**: Guarantees prompt sanitization even when user bypasses mouse clicks. |
| **DOM-02** | `click.mhc_namerag_qs`<br>`#rt-quickstart-roll-name` | `namerag-hooks.js:446` | **Hijack with Resilient Fallback:** Calls `e.stopImmediatePropagation()`. Queries NameRAG with 4s timeout. On failure, falls back to offline character generator and emits warning toast. | 🟢 **HARDENED (Phase 2)**: Timeout added; offline fallback; user notified via toast if NameRAG unavailable. |
| **DOM-03** | `click.mhc_namerag_cr`<br>`#rt-cr-random-name` | `namerag-hooks.js:478` | **Hijack with Resilient Fallback:** Same resilient fallback and warning toast as DOM-02. | 🟢 **HARDENED (Phase 2)**: Re-enables button on error; emits warning toast. |
| **DOM-04** | `click.mhc_namerag_ob`<br>`#rt-ob-roll-name` | `namerag-hooks.js:509` | **Hijack with Resilient Fallback:** Same resilient fallback and warning toast as DOM-02. | 🟢 **HARDENED (Phase 2)**: Re-enables button on error; emits warning toast. |
| **DOM-05** | `click.mhc_namerag_begin`<br>`#rt-quickstart-begin` | `namerag-hooks.js:538` | **Pre-fill Observer:** If name field is empty, rolls NameRAG candidate to seed character creation. | 🟢 **HARDENED (Phase 2)**: Wrapped in try/catch; falls back gracefully. |
| **DOM-06** | Native Capture Phase Click<br>`.mes_stop, #mes_stop, .rt-cyoa-cancel-btn` | `cyoa-safety-net.js:410` | **Native `document.addEventListener('click', ..., true)` (Capture Phase):** Catches user clicking Stop anywhere in the UI to immediately abort in-flight Stage 2 CYOA. | 🟢 **CLEAN**: Uses capture phase (`true`). |

