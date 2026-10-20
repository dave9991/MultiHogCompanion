# SillyTavern Host APIs & Integration Contracts

This document provides a guide and index to SillyTavern's host contracts. When extending or interacting with SillyTavern runtime features, consult the source and documentation pointers listed here.

---

## 1. Global Context & Entry Point

SillyTavern exposes its runtime context through the global `SillyTavern.getContext()`.

* **Documentation**: [`Writing-Extensions.md § Scripting`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L142)
* **Source Implementation**: [`st-context.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/st-context.js)
* **Key Context Properties**:
  * `eventSource`: The core EventEmitter for lifecycle hooks (`on`, `makeFirst`).
  * `chat`: Array of message objects in the current active conversation.
  * `characters`: List of loaded character cards and metadata.
  * `characterId`: Index/identifier of the active character.
  * `groupId`: Active group identifier (or `null` if single character).
  * `extensionSettings`: Reference to global extension settings dictionary.
  * `saveSettingsDebounced`: Debounced persistence function for user configuration.

---

## 2. Prompt Interception & Injection

Extensions can manipulate prompts before tokenization and submission to the LLM without modifying the chat array or DOM textareas.

* **Documentation**: [`Writing-Extensions.md § Prompt Interceptors`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L624)
* **Source Implementation**: [`instruct-mode.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/instruct-mode.js)
* **API Functions**:
  * `registerPromptInterceptor(name, callback)`: Inserts a synchronous or asynchronous transformer into the prompt assembly pipeline.
  * `addExtensionPrompt(id, promptText, position, depth)`: Injects persistent extension directives at configurable context depths.
* **Why to Use**:
  * MultiHog injects State Tracker memos and reality contexts at this stage.
  * MultiHog Companion injects PbtA move guidelines, ruleset overrides, and tone directives using prompt interceptors.

---

## 3. Background Text Generation

To prompt the LLM for background tasks (e.g. CYOA repair, relationship updates, Concierge critiques) without polluting the main conversation chat stream:

* **Documentation**: [`Writing-Extensions.md § Generating text`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L758)
* **Key APIs**:
  * `generateQuietPrompt(prompt, options)`: Sends a prompt to the active connection API without streaming output to the chat window. Returns the completed text response.
  * `generateRaw(messages, prompt, options)`: Low-level generation directly interfacing with the active backend provider.
* **Safety Pattern**:
  * Background generation passes must handle API timeouts gracefully.
  * Check token usage and clamp maximum response tokens to avoid budget exhaustion.

---

## 4. Slash Commands

Extensions can register modular slash commands callable via chat input, macros, or automated scripts.

* **Documentation**: [`Writing-Extensions.md § Registering slash commands (new way)`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L462)
* **Source Implementation**: [`slash-commands.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/slash-commands.js)
* **Command Runner**: `executeSlashCommandsWithOptions(commandText)` executes a command string programmatically.

---

## 5. User Feedback: Popups & Toasts

Never fail silently when background operations fail or external microservices (like NameRAG) are unavailable. Always inform the user.

* **Documentation**: [`Writing-Extensions.md § Popups and user feedback`](file:///home/dlittle/ai-stack/sillytavern-test/SillyTavern-Docs/For_Contributors/Writing-Extensions.md#L1153)
* **Source Implementation**: [`popup.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/popup.js)
* **Key Utilities**:
  * `toastr.info(msg)`, `toastr.success(msg)`, `toastr.warning(msg)`, `toastr.error(msg)`: Non-blocking notifications in top/bottom corners.
  * `callGenericPopup(content, type, title, options)`: Modal dialogue for confirmations, error traces, or configuration inputs.

---

## 6. World Info & Lorebooks

* **Source Implementation**: [`world-info.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/world-info.js)
* **Key APIs**:
  * `loadWorldInfo(name)`: Loads a lorebook by name.
  * `saveWorldInfo(name, data)`: Persists lorebook entries.
  * Upstream MultiHog synchronizes NPC cards, site maps, and quest entries through `world-info.js`. Companion mirrors relationship narratives and lore distribution here.

---

## 7. Undocumented Core Events: `CHAT_RENAMED`

While omitted from the official `Writing-Extensions.md` documentation, `CHAT_RENAMED` is a crucial lifecycle event defined in [`st-source/public/scripts/events.js#L53`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/events.js#L53) and emitted in [`st-source/public/script.js#L10657`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/script.js#L10657).

* **Trigger**: Fired when a chat file is saved under a new title or renamed via the chat list / API.
* **Payload Structure**:
  ```js
  {
      avatarId: string,    // Character avatar identifier
      groupId: string|null,// Group identifier if group chat
      oldFileName: string, // Previous chat filename (may include .jsonl)
      newFileName: string  // New chat filename (may include .jsonl)
  }
  ```
* **Execution Gotcha (`reloadCurrentChat()`)**:
  In `script.js`, SillyTavern awaits `reloadCurrentChat()` *before* emitting `CHAT_RENAMED`. This means `CHAT_CHANGED` fires first! Extensions reacting to chat switches will see the new ID before rename migrations have occurred. Handlers must sanitize `.jsonl` from filenames and handle inter-extension priority (via `eventSource.makeFirst` or debounce settlement timers).

---

## 8. Canonical Turn Events: `CHARACTER_MESSAGE_RENDERED`

Defined in [`events.js#L49`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/scripts/events.js#L49) and emitted across [`script.js`](file:///home/dlittle/ai-stack/sillytavern-test/st-source/public/script.js#L3741,L6634).

* **Trigger**: Fired when an assistant response has finished rendering and is committed into the DOM.
* **Payload Signature**:
  ```js
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => {
      // messageId: number (0-indexed position in context.chat and DOM mesid)
      // type: string|undefined (e.g. 'first_message', 'command', or undefined)
  });
  ```
* **Why It Beats `MESSAGE_RECEIVED`**:
  `MESSAGE_RECEIVED` fires when the raw network payload returns. DOM nodes, message containers, and buttons do not exist yet. Relying on `MESSAGE_RECEIVED` forces fragile `setTimeout` ladders. `CHARACTER_MESSAGE_RENDERED` guarantees DOM presence and is the canonical hook for buttons, UI decorations, and post-turn analysis.
