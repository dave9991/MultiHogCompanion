# Listeners, Lifecycles, and Race Condition Mitigation

Handling events across SillyTavern and the MultiHog Framework requires strict discipline. This guide outlines the turn execution timeline, the anatomy of race conditions in this architecture, and the required coordinator patterns.

---

## 0. The App Startup Lifecycle

Before any chat turn occurs, SillyTavern progresses through a 3-stage initialization phase:

```
[ HTML / DOM Parsing ]
          │
          ▼
   jQuery ready / activate hook
   ↳ Extension entry scripts evaluate (e.g. jQuery(async () => { ... }))
   ↳ Initialize local extension state, register basic slash commands
          │
          ▼
   APP_INITIALIZED (Event)
   ↳ All extensions and UI modules loaded; loader overlay still visible
   ↳ Use for pre-render UI transforms to avoid layout shifts or flickering
          │
          ▼
   APP_READY (Event)  <── CANONICAL POST-INIT HOOK
   ↳ Loader dismissed; SillyTavern is interactive
   ↳ ALL core and third-party slash commands and modules registered
   ↳ Safe target for late-binding monkeypatches and command wrapping
```

### The `autoFireAfterEmit` Guarantee
In [`st-source/public/scripts/events.js#L113`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/events.js#L113) and [`st-source/public/lib/eventemitter.js#L31`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/lib/eventemitter.js#L31), `APP_READY` and `APP_INITIALIZED` are the only events constructed with `autoFireAfterEmit`.
* **Implication**: If an extension registers an `APP_READY` listener *after* the event has already fired, the EventEmitter immediately and synchronously invokes the listener with cached arguments. It is impossible to "miss" the event.
* **Idempotency Rule**: Handlers attached to `APP_READY` (such as `setupImagineInterceptor()`) that are also called during initial evaluation must be idempotent (guard with `if (cmd._mhcIntercepted) return;`).

---

## 1. The SillyTavern Turn Lifecycle

A complete message turn in SillyTavern with MultiHog & Companion follows this deterministic order:

```
[ User Input / Action Submitted ]
              │
              ▼
    MESSAGE_SENT (Event)
              │
              ▼
    GENERATE_BEFORE_COMBINE_PROMPTS (Event / Interceptors)
    ↳ State Tracker injects current memo / live context
    ↳ Companion injects PbtA mechanics / cartridge directives
              │
              ▼
    [ LLM Generation & Token Streaming ]
              │
              ▼
    MESSAGE_RECEIVED (Event)
    ↳ Server payload received; raw text ready, but DOM may not be fully painted
              │
              ▼
    CHARACTER_MESSAGE_RENDERED (Event)  <── CANONICAL POST-TURN HOOK
    ↳ Message block attached and rendered in DOM
    ↳ MultiHog State Tracker executes pass (HP, inventory, reality updates)
    ↳ Companion triggers coordinateCyoaForMessage & relationship sync
              │
              ▼
    [ Turn Complete & Idle ]
```

### Why `CHARACTER_MESSAGE_RENDERED` over `MESSAGE_RECEIVED`
`MESSAGE_RECEIVED` fires when the raw JSON response arrives from the server. However, DOM elements (message bubbles, action buttons, CYOA containers) may not yet be attached or painted. Attempting to query or attach elements during `MESSAGE_RECEIVED` leads to missing DOM nodes and `setTimeout` workarounds (which upstream MultiHog attempted with `scheduleCyoaBind(50)`). 

**Rule**: Always use `CHARACTER_MESSAGE_RENDERED` for DOM updates, button attachments, and post-turn analysis.

### The Post-Turn Dual Pipeline
When `CHARACTER_MESSAGE_RENDERED(messageId, type)` fires, Companion executes two independent, decoupled pipelines:

```
[ CHARACTER_MESSAGE_RENDERED(messageId, type) ]
                        │
    ┌───────────────────┴───────────────────┐
    ▼                                       ▼
[ Pipeline A: Narrative Choices ]       [ Pipeline B: Mechanical & Relationship Sync ]
  • EVT-06 (cyoa-safety-net.js)           • EVT-07 (index.js)
  • coordinateCyoaForMessage(messageId)   • if (type === 'first_message') return;
  • Guards active token streaming         • if (!isAdventureActive()) return;
  • Deduplicates msg/swipe ID             • T+400ms: scheduleSync('CHARACTER_MESSAGE_RENDERED')
  • Happy Path: choices exist (0 cost)      ↳ Syncs persona & player portrait
  • Local Repair: regex formats to        • T+600ms: checkAndSyncTierCrossovers()
    buttons with 0 LLM calls                ↳ Checks NPC affinity scores against tier thresholds
  • Fallback: quiet prompt choice repair    ↳ Evolves narrative relationship text in lorebook
```

---

## 2. Race Conditions & The Hazard Matrix

Because SillyTavern is a single-page application with asynchronous operations, multiple events can fire concurrently or out of expected sequence.

| Hazard / Race Condition | Mechanism / Trigger | Required Companion Antidote |
| :--- | :--- | :--- |
| **Rapid Chat Switching** | The user switches from Chat A to Chat B while an async task for Chat A is awaiting an LLM or network response. When Chat A resolves, it mutates Chat B's state. | **Token Invalidation**: Use `runChatChangedCoordinator(activeChatId, token)`. If `token !== _activeChatSwitchToken`, abort the continuation immediately before writing state. |
| **Concurrent Generation Passes** | Fast swipes, dual listener registrations (`MESSAGE_RECEIVED` + `CHARACTER_MESSAGE_RENDERED`), or rapid inputs trigger multiple passes on the same message. | **Deduplication Set & Swipe Tracking**: Track `_processedMessageIds` set and verify `activeSwipeId` before initiating generation. Route all CYOA passes through `coordinateCyoaForMessage`. |
| **Settings Recursion Loop** | Handler on `SETTINGS_UPDATED` persists an extension configuration via `saveSettingsDebounced()`, which triggers another `SETTINGS_UPDATED` event in SillyTavern. | **Execution Mutex**: Shield settings handlers with `if (_isSettingsSyncActive) return;` and toggle the flag in a `try...finally` block. |
| **UI Freeze on Hangs** | An intercepted button or action calls `event.stopImmediatePropagation()` and awaits an external service (e.g. NameRAG or local endpoint) that hangs or times out. | **Timeout Promise Race**: Always wrap async interception in `Promise.race([work, timeoutPromise(4000)])`. If it times out, fall back to stock behavior and emit a `toastr.warning()`. |
| **DOM Mount Timing** | Attempting to bind click handlers or inspect settings elements before SillyTavern has mounted the extension drawer. | Use delegated event listeners on persistent roots (e.g. `$(document).on('click', '.selector', ...)`) or listen for `EXTENSION_SETTINGS_LOADED`. |
| **Chat Rename Ordering** | SillyTavern calls `reloadCurrentChat()` *before* emitting `CHAT_RENAMED`. Upstream sees an unmigrated partition on `CHAT_CHANGED` and risks resetting state unless proof is re-armed *before* upstream's rename migration runs. | **`eventSource.makeFirst` Priority + Debounce**: `EVT-02` uses `makeFirst` to run synchronously at T+0ms and re-arm the partition proof. `EVT-03` uses standard FIFO + 150ms debounce to let upstream disk writes settle before lorebooks are scanned and cloned. |

---

## 3. Coordinator Architecture in MultiHog Companion

### A. Dual-Phase Chat Switch Coordination
Chat switching is divided into two distinct execution phases:

#### Phase 1: Immediate State Severance (T+0ms)
* **Location**: [`cyoa-safety-net.js` (`EVT-05`)](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/cyoa-safety-net.js) & [`index.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js)
* **Action**: Runs synchronously with zero delay.
  1. Calls `abortCyoaGeneration('chat_changed')` to instantly trigger the `AbortController` on any background quiet prompt or LLM stream running for the departing chat.
  2. Resets message tracking registers (`_lastAttemptedMessageId`, `_lastAttemptedSwipeId`).
  3. Invokes `refreshConciergeActiveContext()` to clear or sync active session metadata.
* **Why**: Without immediate severance, a background CYOA repair initiated in Chat A will complete seconds later and erroneously inject buttons into Chat B's DOM.

#### Phase 2: Deterministic Reconciliation Coordinator (T+500ms)
* **Location**: [`index.js` (`EVT-04` / `runChatChangedCoordinator`)](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js)
* **Action**: Arms a 500ms settlement window and increments an integer `_activeChatChangedToken`.
  1. **Settlement**: Allows upstream MultiHog's debounced partition loading (`syncCampaignPrefixAndWorldsForChat`) to fully hydrate and write to disk.
  2. **Step 1 — Integrity Check**: Calls `checkTrackerProjectionIntegrity()`. If the partition is damaged or from a mismatched campaign, mounts the quarantine banner and halts.
  3. **Step 2 — Ruleset Enforcement**: Calls `ensureActiveChatRulesetConsistency()`. Cleanses D&D 5e prompts for standard campaigns, or rehydrates PbtA cartridges for PbtA campaigns.
  4. **Step 3 — Persona & UI Sync**: Synchronizes persona/portrait assets via `runSync('CHAT_CHANGED')` and refreshes badges and Lorebook Sync UI.
  5. **Step 4 — Background Scans**: Runs `syncNameRagAdhocSysprompt()` and passive relationship scans.
  6. **Continuation Guard**: Every asynchronous step explicitly checks `if (token !== _activeChatChangedToken) return;`. Rapid consecutive switches cancel stale intermediate continuations.

### B. CYOA Dispatch Coordinator (`coordinateCyoaForMessage`)
* **Location**: [`cyoa-generator.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/cyoa-generator.js)
* **Problem**: When a message renders, both upstream MultiHog CYOA buttons and Companion safety nets may attempt to parse or generate options, causing duplicate buttons or conflicting prompt requests.
* **Solution**: `coordinateCyoaForMessage` enforces a single pipeline:
  1. Inspect existing message text for valid CYOA choices.
  2. If missing or malformed and safety net is enabled, initiate repair pass.
  3. Lock the message ID in `_processedCyoaMessageIds` to prevent re-entry.

### C. Chat Rename Coordination (`makeFirst` + Settlement Window)
* **Location**: [`adventure-chat.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/adventure-chat.js) & [`index.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js)
* **Problem**: SillyTavern emits `CHAT_RENAMED` after reloading the chat. Both upstream MultiHog (which copies partition files) and Companion (which updates campaign lorebooks) listen to this event. If lorebook sync runs concurrently with upstream's async partition migration, lorebooks migrate against an incomplete or unproven partition state.
* **Solution**:
  1. `adventure-chat.js` hooks `CHAT_RENAMED` via `eventSource.makeFirst` (T+0ms) to re-arm `runtimeState.pendingUnseenChatReset` *before* upstream's listener executes.
  2. Upstream's `onChatRenamedMigrate` executes second, reading the proof and migrating partition files.
  3. `index.js` hooks `CHAT_RENAMED` via standard `eventSource.on` and arms a 150ms debounce timer, allowing upstream async disk writes to settle before `syncCampaignLorebooks({ isAuto: true, chatId: targetChatId })` runs.

### D. Settings Update Coordination (The Two-Tier Anti-Recursion Shield)
* **Location**: [`index.js` (`EVT-08` / `runSettingsUpdatedCoordinator`)](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js) & [`pbta-ruleset-persistence.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js)
* **Problem**: SillyTavern emits `SETTINGS_UPDATED` globally whenever any extension saves settings via `saveSettingsDebounced()`. If an event handler on `SETTINGS_UPDATED` saves settings in response, it causes an infinite recursive cascade loop.
* **Solution**:
  1. **Shield 1 (Self-Inflicted Write Consumption)**: Before processing `SETTINGS_UPDATED`, Companion checks `isPersistingPbtaChatState()`. If true, Companion itself initiated the write during PbtA persistence; the event is silently consumed and aborted (`clearPersistingPbtaChatState(); return;`).
  2. **Shield 2 (Re-Entrancy Mutex Gate)**: User-initiated settings modifications are debounced by 600ms and wrapped in an atomic execution lock (`_isSettingsSyncActive`). Any secondary events fired while the coordinator runs are immediately dropped.

---

## 4. Key Pointers & Upstream References

* **SillyTavern Event Types & Bus**:
  * *Docs*: [`Writing-Extensions.md § Events`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L518)
  * *Source*: [`events.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/events.js) — complete enumeration of `event_types`.
* **Chat Switching & Asynchronous Safety**:
  * *Upstream Guide*: [`chat-ownership.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/docs/chat-ownership.md) — upstream MultiHog documentation on `createChatCommitGuard` and `pass-affinity.js`.
  * *ST Chats Source*: [`chats.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/chats.js) — chat loading and switching internals.
* **MultiHog Companion Listener Catalog**:
  * Consult [`LISTENERS.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/LISTENERS.md) for the active list of registered listeners (`EVT-01` through `EVT-05`) and DOM delegations (`DOM-01` through `DOM-06`).
