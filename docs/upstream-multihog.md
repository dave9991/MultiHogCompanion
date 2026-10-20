# Upstream MultiHog DnD Framework Architecture

The upstream framework (`extensions/SillyTavern-MultihogDnDFramework/`) is a simulation-focused tabletop RPG engine for SillyTavern. This document details its core architectural concepts and points to its internal documentation and source modules.

---

## 1. 🛑 Strictly Read-Only Upstream Rule

**NEVER modify any file inside `extensions/SillyTavern-MultihogDnDFramework/`.**
* **Enforcement**: Programmatically enforced by [`tests/upstream-integrity.test.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/tests/upstream-integrity.test.js) via git status.
* **Mechanism**: MultiHog Companion augments upstream solely through event listening, DOM delegation, prompt interception, and non-destructive runtime monkeypatching.
* **Catalog**: Every monkeypatch must be recorded in [`MONKEYPATCHES.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/MONKEYPATCHES.md) with an Architecture Decision Record (ADR).

---

## 2. Upstream Documentation Index

The upstream framework contains extensive design documentation in its `docs/` folder:

| Document | Primary Focus | Key Takeaways for Companion |
| :--- | :--- | :--- |
| [`chat-ownership.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/docs/chat-ownership.md) | **Chat Ownership Across Async Work** | `getSettings()` is a single mutable live projection. Loading another chat replaces its story fields while keeping the same object. Explains `pass-affinity.js` and `createChatCommitGuard`. |
| [`multihogDnDdoc.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/docs/multihogDnDdoc.md) | **Framework Overview & Rules** | Explains the turn loop, the 4 hard actions of the Adventure Companion (State Tracker, Lorebook, Map Updater, Act for Player), Full Review vs. Delta memo updates, and the cartridge system. |
| [`dungeon-reality-mapping-design.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/docs/dungeon-reality-mapping-design.md) | **Spatial Engine & Mapping** | Explains site graphs, asset occupancy, building structures, and how spatial reality synchronizes with story text. |

---

## 3. Core Subsystems & Key Modules

When inspecting upstream behavior, look in these modules:

### A. The Turn Loop & Message Routing
* **Source**: [`router.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/router.js) & [`renderer.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/renderer.js)
* **Behavior**: Orchestrates prompt dispatch, captures response chunks, updates the state tracker memo, and renders CYOA choice buttons into the message footer.

### B. State Tracker & Live Memo Loop
* **Source**: [`state-manager.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/state-manager.js) & [`memo-processor.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/memo-processor.js)
* **Behavior**: Manages the persistent campaign memo (HP, inventory, active location, quests, party members). Evaluates delta updates or full reviews and writes updates to the active chat's metadata.

### C. Adventure Companion (Floating Assistant)
* **Source**: [`adventure-companion.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/adventure-companion.js)
* **Behavior**: A draggable, resizable chat panel with its own connection endpoint profile. Constrained to exactly four actions:
  1. Direct command to **State Tracker** (update mechanical campaign state).
  2. Direct command to **Lorebook Agent** (create/update NPCs, factions, quests).
  3. Direct command to **Map Updater** (fix site map occupancy/assets).
  4. **Act for the player** (submit next turn).

### D. Cartridges & System Prompts
* **Source**: [`game-cartridges.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/game-cartridges.js) & [`game-systems.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/game-systems.js)
* **Behavior**: Houses system prompt templates, module definitions, and cartridge presets (e.g. D&D 5e / 3.5e hybrid). Companion hooks here to inject PbtA cartridges and vitality rules.

### E. Character Creator
* **Source**: [`character-creator.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/character-creator.js)
* **Companion Hook**: Companion intercepts character creation with [`character-creator-sanitizer.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/character-creator-sanitizer.js) to scrub macro tags (`{{char}}`, `<BOT>`) and ensure clean protagonist names.

### F. Chat Switch Dynamics & The `_rpgCurrentChatId()` Lag Hazard
* **Source**: [`index.js` (`onChatChanged`)](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/index.js#L2703) & [`immersion.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/immersion.js#L64)
* **Behavior & Trap**:
  * On `CHAT_CHANGED`, upstream runs an internal debounce timer (`_prefixDeriveTimer`) before updating campaign world info via `syncCampaignPrefixAndWorldsForChat`.
  * If upstream's chat switch encounters an error during history hydration, `runtimeState.currentChatId` (exposed via `_rpgCurrentChatId()`) can remain stuck on the *departing* chat ID even though SillyTavern has already switched `ctx.chatId` to the *arriving* chat.
  * Companion avoids this pitfall with [`resolveAuthoritativeChatId()`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/history-integrity-guard.js#L38), which queries SillyTavern's context first and uses `_rpgCurrentChatId()` only as a fallback.

---

## 4. How MultiHog Companion Augments Upstream

1. **Custom Rulesets (PbtA)**: MultiHog Companion provides alternative cartridges and vitality mechanics that plug into the upstream memo processor without breaking standard D&D campaign isolation.
2. **CYOA Safety Net**: Upstream CYOA button generation can sometimes produce unparseable markdown or drop choices. Companion runs a verification pass and repairs missing choices via quiet prompt generations.
3. **Concierge Dossier Builder & Critic**: Enhances the session-zero onboarding process by analyzing user intent, formulating structured world dossiers, running self-critique loops, and generating custom lorebooks.
4. **NameRAG Interception**: Hooks into character creator name generation buttons to provide semantic name suggestions from local name embedding datasets, with immediate fallback to upstream stock names if NameRAG is unavailable.
