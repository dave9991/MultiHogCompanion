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
* **Rendering Reference**: See [`multihog-rendering-reference.md`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/multihog-rendering-reference.md) for the complete catalog of `((MARKER))` tokens, pill hover-toast syntax (`Name (desc)` vs `Name [desc]`), color/gradient modifiers, and implicit `STOCK_FIELD_RULES`.

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
* **Upstream Schema & Behavior**:
  * A **Game Cartridge** (`format: 'multihog-game-cartridge'`, `version: 1`) is a global configuration snapshot stored in `extensionSettings.rpg_tracker.gameCartridges`.
  * Its `payload` bundles keys defined by `CARTRIDGE_PAYLOAD_GROUPS`: `customSyspromptLibrary`, `syspromptModules`, `stockPrompts`, `blockOrder`, `modules`, `cyoaConfig`, `rngQueueD20`, and `diceFunctionTool`.
  * Upstream has **no per-chat cartridge affinity**: clicking **Load** in MultiHog's *Manage Game Cartridges* modal overwrites live settings globally across all chats.
* **How Companion Uses Cartridges**:
  * **Concierge (Session Zero)**: [`concierge-runner.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) invokes the active system adapter's `installCartridge()`, which calls `buildPbtACartridge` / `buildFaeCartridge` with campaign-specific overrides (tone, factions, world rules, custom pools/harm). It registers a campaign-named cartridge (`pbta_<slug>` / `fae_<slug>`) in `gameCartridges` and binds the chat via `setCompanionActiveCartridge()` in [`pbta-ruleset-persistence.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js).
  * **Manual Presets & Quick Start**: Selecting a genre preset in Companion settings builds a reusable engine cartridge (`pbta_cartridge` or `fae_cartridge`). **Load Cartridge** applies it to the current chat; **Quick Start** creates a new chat, applies the cartridge, injects character creation mandates, locks the persona, and triggers the opening turn.
  * **Chat Isolation (`EVT-04`)**: On `CHAT_CHANGED`, `ensureActiveChatRulesetConsistency()` cleanses PbtA/FAE overrides when entering a standard D&D chat ([`WRK-03`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect)) and rehydrates the chat's bound cartridge when entering a PbtA/FAE chat.
* **Troubleshooting Cartridges**:
  * **Upstream Modal Collision**: Manually loading a cartridge from MultiHog's *Manage Game Cartridges* modal applies its payload globally without updating Companion's per-chat affinity. Switching chats will trigger `ensureActiveChatRulesetConsistency()` to restore the target chat's actual ruleset. Prefer Companion's preset buttons or chat switcher.
  * **Cartridge Bloat & Cleanup**: Every Concierge adventure registers a named cartridge in `gameCartridges`. Use **Campaign Set Manager** ([`campaign-set-manager.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/campaign-set-manager.js)) to audit and delete orphaned campaign cartridges whose chats no longer exist. Deleting a cartridge entry does not delete chat history or local memos.
* **Extending Cartridges (New Genres or Engines)**:
  1. **Genre Preset**: Add the genre definition to `PBTA_GENRES` in [`pbta-ruleset.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset.js) or `FAE_GENRES` in [`fae-ruleset.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-ruleset.js) and expose it in [`settings.html`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/settings.html).
  2. **Cartridge Builder**: Ensure `build*Cartridge()` outputs valid `CARTRIDGE_PAYLOAD_GROUPS` keys and prefixes custom snippet IDs cleanly so `cleanseStockDndSettings()` can strip them.
  3. **Concierge Adapter**: Subclass `ConciergeSystemAdapter` ([`concierge-system-base.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-base.js)) and register it in [`concierge-system-registry.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-registry.js).
  4. **Persistence & Fetch Hook**: Wire chat-affinity detection in [`pbta-ruleset-persistence.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js) and synthetic doc compilation in `ADR-MP-01` if replacing `multihogDnDdoc.md`.

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
2. **On-Demand CYOA Repair**: Upstream CYOA button generation can sometimes produce unparseable markdown or drop choices. Companion offers a Wand menu action (`DOM-07`) and `/cyoafix`, `/cyoagen`, `/cyoaretry` slash commands that repair numbered markdown into buttons locally or generate fresh choices. There is no automatic background verification pass.
3. **Concierge Dossier Builder & Critic**: Enhances the session-zero onboarding process by analyzing user intent, formulating structured world dossiers, running self-critique loops, and generating custom lorebooks.
4. **NameRAG Interception**: Hooks into character creator name generation buttons to provide semantic name suggestions from local name embedding datasets, with immediate fallback to upstream stock names if NameRAG is unavailable.
