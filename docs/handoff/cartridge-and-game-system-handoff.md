# Cartridge, Custom Game System & v3 Chat-Setup Handoff Contracts (`HAND-006` – `HAND-008`)

This specification documents **Phase 3 cartridge metadata preservation, upstream v3 Custom Game System catalog registration, and `gameCartridges` payload parity** at the Concierge $\rightarrow$ Upstream MultiHog Framework handoff boundary.

---

## `HAND-006`: Complete `CompanionActiveCartridge` Metadata Across Launch & Sync

### Problem Solved
Step 1 of `launchPbtaCampaign()` (`applyRulesetCartridge()` in [index.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js)) writes rich per-chat metadata (`customGenreSpec`, `stats`, `pools`, `knobs`, `config`, `dossier`) into `CompanionActiveCartridge`. Previously, Step 5 in [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) and `syncPbtaCampaignUpdates()` immediately overwrote `CompanionActiveCartridge` with a slim object (`{ cartridgeId, genre, systemLabel, title, dossier }`), dropping `customGenreSpec`, `stats`, `pools`, `knobs`, and `config`, while `cartridgeOverrides` also carried a duplicate `systemLabel` key.

### Contract
* **`buildCompanionActiveCartridgeRecord(adapter, systemKey, dossier, { title, cartridgeOverrides })`** ([concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js)):
  * Always emits `cartridgeId`, `genre`, `systemLabel`, `title`, and deep-cloned `dossier`.
  * Preserves `customGenreSpec` (from `dossier.meta.customGenreSpec` or `cartridgeOverrides.customGenreSpec`), `stats` (when `>= 3` stats exist), `pools` (when non-empty), `knobs`, and `config`.
  * Used identically in both `launchPbtaCampaign()` Step 5 and `syncPbtaCampaignUpdates()` Step 4.
* Clean single `systemLabel` key in `cartridgeOverrides`.

---

## `HAND-007`: Upstream v3 Custom Game System & Tracker Schema Alignment

### Problem Solved
Previously, Step 5 in `concierge-runner.js` registered `dossier.worldRules.customModule` using an outdated legacy schema (`drivers: driversList` without boolean driver flags, unwrapped GM `content`, missing `scope: 'chat'` / `_chatSetupMember`, and direct array copies on `chatStates[chatId]`), while `syncPbtaCampaignUpdates()` updated only `rpgSettings.customFields` and omitted `gameSystems`, `customSyspromptLibrary`, and v3 global catalog sync.

### Contract (`registerCustomGameSystemInSettings()`)
Both `launchPbtaCampaign()` and `syncPbtaCampaignUpdates()` delegate custom module registration to `registerCustomGameSystemInSettings(rpgSettings, customMod, { chatId, syncChatSetupCatalogs })` ([concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js)), aligning with upstream [game-systems.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/game-systems.js), [sysprompt-content.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/src/state/sysprompt-content.js), and [chat-setup.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/src/state/chat-setup.js):
1. **`rpgSettings.gameSystems`:** Uses boolean flags `driverTime`, `driverGmAnnotation`, `driverStatedFact` (via `toWizardDriverFlags()` in [game-system-bridge.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/game-system-bridge.js)) alongside `drivers`, `scope: 'chat'`, `_chatSetupMember: true`, `customFieldTag`, `syspromptLibraryId`, and `needsTracker`. Uses deterministic ID fallback (`gs_${customTag.toLowerCase()}` when `customMod.id` is unset) so re-syncs update in place instead of creating duplicates.
2. **`rpgSettings.customSyspromptLibrary`:** Sets `tag`, `origin: 'wizard'`, `scope: 'chat'`, `_chatSetupMember: true`, and wraps GM instructions in `<${gmTag}>\n...\n</${gmTag}>` via `wrapGameSystemGmContent()`.
3. **`rpgSettings.customFields`:** Sets `tag: customTag`, `label`, `icon`, `prompt`, `template`, `enabled: true`, `origin: 'wizard'`, `scope: 'chat'`, `_chatSetupMember: true`, and ensures `customTag` is in `rpgSettings.blockOrder`.
4. **Upstream v3 Catalog Sync:** Calls upstream `syncChatSetupCatalogs(rpgSettings)` (with a clean fallback into `gameSystemDatabase`, `syspromptSnippetDatabase`, and `trackerModuleDatabase`) so per-chat activation maps (`setup.gameSystemStates`, `setup.syspromptSnippetStates`, `setup.customFieldStates`) isolate the custom system to the campaign chat across chat switches and reloads.

---

## `HAND-008`: `gameCartridges` Payload Completeness & D&D 5e Handoff Parity

### Problem Solved
1. `buildPbtACartridge()` ([pbta-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset.js)) and `buildFaeCartridge()` ([fae-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-ruleset.js)) omitted `npcRelationshipBars`, `gameSystems`, and `customFields` from their initial `payload`, causing upstream's selective `loadCartridge()` dialog ([game-cartridges.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/game-cartridges.js)) to backfill those groups from stock D&D defaults.
2. Step 1 stored the campaign cartridge in `rpgSettings.gameCartridges` *before* CYOA playstyle flags, `npcRelationshipBars`, `blockOrder`, and `registerCustomGameSystemInSettings()` finished mutating live settings.

### Contract & Ruleset Parity Matrix
* `buildPbtACartridge()` and `buildFaeCartridge()` initialize `npcRelationshipBars`, `gameSystems: []`, and `customFields: []` inside `payload`.
* `syncSavedCartridgePayloadFromLiveSettings(rpgSettings, cartridgeId)` refreshes the saved cartridge inside `rpgSettings.gameCartridges` after Step 5 (Launch) and Step 4 (Living-World Sync) finish mutating live settings, right before `persistPbtaChatState(chatId)`.

| Surface | PbtA (`pbta`) | FAE (`fae`) | D&D 5e (`dnd5e`) |
| :--- | :--- | :--- | :--- |
| **`CompanionActiveCartridge`** | `cartridgeId: 'pbta'` + full stats/customGenreSpec/config | `cartridgeId: 'fae'` + full pools/knobs/customGenreSpec/config | `cartridgeId: 'dnd5e'` + config/dossier via `Dnd5eSystemAdapter` ([concierge-system-dnd5e.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-dnd5e.js)) |
| **Upstream `rpgSettings.gameCartridges`** | Per-campaign cartridge updated by `syncSavedCartridgePayloadFromLiveSettings()` | Per-campaign cartridge updated by `syncSavedCartridgePayloadFromLiveSettings()` | Uses stock native D&D 5e configuration; no synthetic `gameCartridges` entry added |
| **Per-Chat Context & Custom Game System** | `pbta_*` snippets + `registerCustomGameSystemInSettings()` + `persistPbtaChatState()` | `fae_*` snippets + `registerCustomGameSystemInSettings()` + `persistPbtaChatState()` | `dnd5e_campaign_*` / `dnd5e_custom_*` snippets + `registerCustomGameSystemInSettings()` + `persistPbtaChatState()` |
