# Phase 4 Contract Sheet: Campaign Launch Pipeline & Living World Mode

Parent hub: [README.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/README.md) · Cross-cutting spine: [cross-cutting-syntax.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/cross-cutting-syntax.md) · Upstream: [stage-4-character.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/concierge/stage-4-character.md)

---

## 1. Entry & Exit Conditions

* **Campaign Launch (`🚀 Finalize & Launch Campaign`, `#mhc_launch_campaign_btn` in [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):**
  * **Entry Gate (`CONC-016`):** Enabled in `new-adventure` mode only when `!isGenerating && unlockedSteps.character && Boolean(activeDossier?.protagonist?.name?.trim())`.
  * **Pre-Flight Checks:**
    1. If both `dossier.npcs` and `dossier.monsters` are empty, prompts `showConciergeConfirm()` (`🚀 Launch Without Staged Cast?`).
    2. Checks `getExistingAdventureNames()` via `checkAdventureNameExists(candidateTitle, existingNames)`; if colliding, opens `#mhc_launch_conflict_overlay` offering **Rename & Launch** (`findNextAdventureVersionName`), **Wipe Existing & Launch Fresh** (`wipeOldTitle`), or **Cancel**.
  * **Exit / Settlement:** Calls `executeCampaignLaunch()`, locking modal controls via `setConciergeBusyState(true)`, showing `#mhc_launch_progress_overlay`, running `launchPbtaCampaign()`, resetting the Session Zero sandbox on success, closing `#mhc_concierge_modal`, and restoring controls/hiding overlay inside `finally` (`CONC-023`).
* **Living World Mode (`switchToTrack('living-world')` in [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js)):**
  * **Entry Gate:** Available when the active chat has a genuine Concierge-created campaign (`loadActiveCampaignDossier(chatId)` checks `CompanionActiveCartridge`, partition `chatStates[cid]`, and `Campaign_*` World Info fallback; excludes auto-scaffolded stubs via `isConciergeCreatedDossier()`).
  * **Track Isolation (`concierge-state-store.js`):** Snapshots any in-progress `sessionZeroTrack` draft before switching, then hydrates `livingWorldTrack` from the active chat's dossier without mutating Session Zero.
  * **Sync Back (`🔄 Sync to Active Game`, `#mhc_sync_active_campaign_btn`):** Shown via `updateSyncButtonState()` only when in `living-world` mode (or matching loaded origin chat) and active chat matches `loadedCampaignOriginChatId` / campaign title. Runs `syncPbtaCampaignUpdates()`, snapshots updated state back to `livingWorldTrack`, and leaves any Session Zero draft intact (`CONC-023`).
  * **Fork to Session Zero (`🍴 Fork as New Campaign`, `#mhc_fork_campaign_btn`):** Confirms overwrite if Session Zero progress exists, clones `livingWorldTrack.dossier` into `sessionZeroTrack` via `conciergeStore.forkToSessionZero()` (resetting `rulesetConfirmed = false`, stripping `_originChatId`/`meta.chatId`, appending `(Fork)`), and transitions to `new-adventure` Step 1.

---

## 2. Code Surface

| Area | File & Symbol(s) | Responsibility |
| :--- | :--- | :--- |
| **Launch & Sync Pipeline** | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) (`launchPbtaCampaign`, `syncPbtaCampaignUpdates`, `injectDossierEntitiesIntoCampaignLorebooks`, `injectCanonBook`, `injectWorldSkeleton`, `upsertWorldInfoBook`, `injectDossierIntoWorldInfo`, `reconstituteDossierWithAi`) | End-to-end 7-step campaign creation, in-place live synchronization, World Info/partition injection, Day 0 World Skeleton, Turn 0 trigger |
| **Lorebook & Threat Builders** | [concierge-lore-distributor.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-lore-distributor.js) (`prepareCampaignLorebookDistributions`, `buildMapThreatBrief`, `buildFactionEntry`, `buildLocationEntry`, `buildStartingQuestEntry`, `buildWorldRuleEntry`, `buildCustomModuleLoreEntry`, `buildDossierWorldInfoEntry`, `buildWorldSkeletonEntries`) | Splits NPCs vs Bestiary, builds `[CORE]` partition entries, sets `constant: false` on Dossier WI entry, builds Map threat briefs & World Skeleton |
| **PC & NPC Card Formatters** | [concierge-pc-format.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-pc-format.js) (`buildPlayerCardBio`, `loadMainPcSectionNames`), [concierge-npc-format.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-npc-format.js) (`buildNpcEntryContent`, `buildMonsterEntryContent`, `buildNpcKeys`, `loadMainNpcSectionNames`) | Matches MultiHog's `DEFAULT_PC_SECTIONS` / NPC section schema across PbtA, FAE, and D&D 5e |
| **System Adapters & Persistence** | [concierge-system-pbta.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-pbta.js), [concierge-system-fae.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-fae.js), [concierge-system-dnd5e.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-dnd5e.js), [pbta-ruleset-persistence.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js) | Installs cartridges per ruleset, merges live memos on sync, persists `CompanionActiveCartridge` & partition state |
| **Track UI, Conflict & Sync Handlers** | [concierge-ui.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-ui.js) (`executeCampaignLaunch`, `showAdventureConflictDialog`, `switchToTrack`, `forkActiveCampaignToSessionZero`, `loadActiveCampaignDossier`, `updateSyncButtonState`), [concierge-state-store.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-state-store.js), [concierge-modal.html](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-modal.html) | Track switching, conflict resolution, launch/sync progress overlay, non-destructive Living World badge |
| **Living World Prompts** | [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildConciergeBuilderContext`, `buildConciergeTalkerContext`) | Full-blueprint Builder/Talker editing when `currentNavMode === 'living-world'` |

---

## 3. Execution Flows (Launch Pipeline & Living World Sync)

### A. `launchPbtaCampaign()` 7-Stage Pipeline
1. **Pre-Launch Sweeps & Healing:** Resolves any lingering `[[NAME:...]]` placeholders, calls `healAndNormalizeDossier()`, strips `[NAME: ..., RESOLVED TO: ...]` tokens cleanly from `protagonist`, `npcs`, `monsters`, and `factions` (`CONC-022`), stamps `conciergeCreated: true` / `isStub: false`, and resolves fallback `adventureTitle`.
2. **Step 0 / 0b (Purge & Clean Chat):** If `wipeOldTitle`, purges prior campaign lorebooks (`purgeCampaignLorebooks`), `chatStates[wipeOldTitle]`, and `Campaign_${wipeOldTitle}`; calls `ensureCleanAdventureChat()`.
3. **Step 1 (Cartridge & CYOA Installation):** Builds `cartridgeOverrides` (`stats`, `pools`, `positive_tags`, `negative_tags`, `startingMoves`, `factions`, `worldRules`, `customGenreSpec`, `dossier`), installs via `adapter.installCartridge(systemKey, cartridgeOverrides, { ...options, ctx, chatId })`, and applies CYOA config (`CYOA_mode`, `playstyle`).
4. **Step 2 (Player Persona & PC Lorebook Card):** Activates/creates SillyTavern persona (`activateSillyTavernPersona`), writes structured PC card (`addPlayerCardToLorebookAgent` with `buildPlayerCardBio`), syncs portrait if present (`uploadImageToPersona`), and binds persona (`syncPersonaToChat`).
5. **Step 3 (Staggered Primary Map Architect + Bestiary Pre-Seed):** Pre-upserts `{prefix}_Bestiary` if monsters exist (so Map Architect avoids duplicating bestiary entries into `{prefix}_Locations`), builds `buildMapThreatBrief(dossier)` + axiom `architecturalNotes`, and runs `mapArch.runMapArchitect()` for `primaryMap` only (secondary sites defer cleanly to `{prefix}_Locations`).
6. **Step 4 / 4b (NPC Library, Modular Partitions, Canon & Skeleton):** If `npcs.length > 0`, registers named NPCs in MultiHog's `npc-library.js` (never monsters). Always calls `injectDossierEntitiesIntoCampaignLorebooks()`, `injectCanonBook()` (`{prefix}_Canon`), and `injectWorldSkeleton()` (`{prefix}_Skeleton`) even when cast arrays are empty (`CONC-022`).
7. **Step 5–7 (World Info Dossier, Runtime Settings, UI & Turn 0):** Writes `[CAMPAIGN_DOSSIER]` (`constant: false`), generates `initialMemo`, initializes `npcRelationshipValues` + activates allies in `activeRouterKeys`, configures `simulationDepth`, registers `campaignBooks` (including `_Bestiary` per `CONC-022`), registers `customModule` across `gameSystems` / `customSyspromptLibrary` / `customFields` / `blockOrder`, saves `CompanionActiveCartridge` with `adapter.id` (`CONC-022`), runs `autoApplySysprompt(true)`, sends `openingText` (Turn 0), and kicks `refreshAgentManifestNow()` + `runRouterPass()`.

### B. Living World Editing & `syncPbtaCampaignUpdates()`
1. **Interactive Turns (`currentNavMode === 'living-world'`):** `handleUserSend()` builds `buildConciergeBuilderContext()` (with `[CURRENT_LIVE_BLUEPRINT]`) + Stage 1b Judge (`shouldRunContemplativeJudgePass`) + `buildConciergeTalkerContext()`.
2. **In-Place Sync (`🔄 Sync to Active Game`):** Accepts `(rawDossier, onProgress, options = {})` (`CONC-021`), heals dossier + strips resolved NameRAG tokens, re-inscribes `[CAMPAIGN_DOSSIER]` World Info, updates all modular partition lorebooks and PC Lorebook Agent bio, re-installs ruleset cartridge with `{ ...options, ctx, chatId }` + `customGenreSpec` + `dossier`, merges live memo (`adapter.mergeLiveMemo()`), updates `customFields` & partition vitality (`adapter.syncVitality()`), refreshes MultiHog tracker view (`forceRenderTrackerView`), persists `CompanionActiveCartridge` with `adapter.id`, and returns a ruleset-accurate confirmation message.

---

## 4. Partition & Output Matrix

| Artifact / Target | Producer | Contents & Routing Rules | Partition / Storage Key | Gaps Found |
| :--- | :--- | :--- | :--- | :--- |
| **Supporting NPCs** | `prepareCampaignLorebookDistributions()` + `npcLib.saveNpcToLibrary()` | Human allies/rivals (`buildNpcEntryContent`), zero monsters | `{prefix}_NPCs` + MultiHog NPC Library | Closed (`CONC-006`) |
| **Bestiary / Hazards** | `prepareCampaignLorebookDistributions()` (`buildMonsterEntryContent`) | Creatures, packs, drones, FAE encounters, hazards; also pre-seeded before Map Architect (`lorebookNames`) | `{prefix}_Bestiary` | `CONC-022`: added `'Bestiary'` to `standardSuffixes` purge/tracking list |
| **Factions** | `buildFactionEntry()` | Faction `[CORE]` (`Standing`, `Agenda`, `Notes`), clean NameRAG names | `{prefix}_Factions` | `CONC-021`/`CONC-022`: strips `[NAME: ..., RESOLVED TO: ...]` tokens before launch/sync |
| **Locations / Maps** | `buildLocationEntry()` + `mapArch.runMapArchitect()` | Primary site generated eagerly with `buildMapThreatBrief()`; secondary sites queued cleanly with `[CORE]` | `{prefix}_Locations` | `CONC-022`: runs even if no cast is staged |
| **Starting Crisis** | `buildStartingQuestEntry()` | `ID: starting_crisis`, `TYPE: emergent`, `STATUS: ACTIVE` | `{prefix}_Quests` | `CONC-022`: runs even on solo/empty-cast launches |
| **World Laws & Custom HUD** | `buildWorldRuleEntry()` + `buildCustomModuleLoreEntry()` + `gameSystems` | Axioms (`substitutions`, `negativeConstraints`, `architecturalNotes`) and bespoke `customModule` (`drivers`, `syspromptLibrary`, `customFields`) | `{prefix}_Rules` + `rpgSettings.gameSystems` | `CONC-021`: `syncPbtaCampaignUpdates` now passes `customGenreSpec` & `dossier` |
| **Series Bible** | `injectCanonBook()` (`writeStagedCanon`) | Staged Archivist/Vibe canon entries (`active` + `disabled` metadata) | `{prefix}_Canon` | `CONC-022`: no longer skipped on empty cast |
| **World Skeleton & Dossier** | `injectWorldSkeleton()` + `buildDossierWorldInfoEntry()` | Day 0 progression prompts + `constant: false` full Markdown dossier backup | `{prefix}_Skeleton` & `Campaign_{chatId}` WI | Closed |
| **Active Cartridge Record** | `setCompanionActiveCartridge()` | `cartridgeId: adapter.id` (`pbta` / `fae` / `dnd5e`), `genre`, `systemLabel`, `dossier` | Chat `.jsonl` metadata via `pbta-ruleset-persistence.js` | `CONC-021`/`CONC-022`: uses `adapter.id` instead of hardcoding `'pbta'` for D&D 5e |

---

## 5. Context In & Handoff Out

* **Session Zero -> Launch:** Receives `activeDossier` (validated via `CONC-016` to have named protagonist), `stagedCanonEntries` in `concierge-canon.js`, and optional `wipeOldTitle` / renamed `meta.title` from the conflict modal.
* **Live Chat -> Living World:** `loadActiveCampaignDossier()` resolves priority `CompanionActiveCartridge` -> `chatStates[cid]` partition dossier -> `Campaign_*` World Info `CAMPAIGN_DOSSIER` entry, filtering out non-Concierge stubs via `isConciergeCreatedDossier()`.
* **Living World -> Active Chat (`syncPbtaCampaignUpdates`):** Preserves existing chat history & live `[WORLD]`/`[LOCATION]`/`[CALENDAR]` memo state via `adapter.mergeLiveMemo()`, updating only modified `[PROTAGONIST]`, `[CONFIG]` dials, `[WORLD_RULES]`, `customFields`, lorebooks, and cartridge setup in place.
* **Living World -> Fork (`forkActiveCampaignToSessionZero`):** Produces an independent `sessionZeroTrack` clone (`(Fork)` title, cleared origin chat IDs, `rulesetConfirmed: false`) so players can safely switch rulesets or iterate on a new branch without altering the live game.

---

## 6. Invariants & Guardrails

1. **`constant: false` World Info Dossier:** `buildDossierWorldInfoEntry()` keeps the full campaign dossier lookup-triggered rather than constant-injected, preventing permanent context bloat.
2. **`[CORE]`-Only Refresh on Re-Sync (`upsertWorldInfoBook`):** Re-launching or syncing an active campaign updates only the `[CORE]...[/CORE]` block inside existing modular lorebook entries, preserving chronicle text appended later by MultiHog's Router.
3. **Track Separation (`concierge-state-store.js` & `CONC-023`):** Switching to/from Living World or clicking `🔄 Sync to Active Game` never overwrites or resets an unrelated Session Zero draft (`sessionZeroTrack`), except when the user explicitly confirms **🍴 Fork as New Campaign**.
4. **D&D 5e Cartridge Identity (`CONC-021`, `CONC-022`):** Both Launch and Sync record `cartridgeId: adapter.id` (`dnd5e`, `fae`, `pbta`) rather than collapsing D&D 5e into `'pbta'`.
5. **Solo / Castless Campaign Completeness (`CONC-022`):** Even when launching with zero NPCs, zero monsters, and zero factions, `_Locations`, `_Quests`, `_Rules`, `_Canon`, and `_Skeleton` are still written.

---

## 7. Audit Findings Log (Phase 4)

| ID | Issue Found | Fix Applied | Regression Test |
| :--- | :--- | :--- | :--- |
| `CONC-021` | `syncPbtaCampaignUpdates()` threw `ReferenceError: options is not defined` on `installCartridge()`, omitted `chatId`/`customGenreSpec`/`dossier`, left `[NAME: ..., RESOLVED TO: ...]` tokens, and saved `cartridgeId: 'pbta'` for D&D 5e | Added `options = {}` parameter, passed `{ ...options, ctx, chatId }`, included `customGenreSpec`/`dossier`, stripped NameRAG tokens, and used `adapter.id`/`adapter.label` (`concierge-runner.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-022` | `launchPbtaCampaign()` skipped all lorebook/Canon/Skeleton writes when cast & factions were empty, omitted `'Bestiary'` from `standardSuffixes`, left raw NameRAG tokens on `factions`, and saved `cartridgeId: 'pbta'` for D&D 5e | Decoupled lorebook/Canon/Skeleton writes from `if (npcs.length \|\| monsters.length \|\| factions.length)`, added `'Bestiary'` to `standardSuffixes`, stripped faction NameRAG tokens, and used `adapter.id`/`adapter.label` (`concierge-runner.js`) | `tests/concierge-stage-controller.test.js` |
| `CONC-023` | `#mhc_sync_active_campaign_btn` wiped Session Zero drafts via `resetConciergeState()`, lacked busy locking & `try/finally` around `#mhc_launch_progress_overlay`; `executeCampaignLaunch()` read `activeDossier.meta.ruleset` after resetting it | Captured ruleset label pre-reset in `executeCampaignLaunch()`, replaced `resetConciergeState()` on sync with `snapshotToLivingWorld()`, and wrapped both in `setConciergeBusyState()` + `try/finally` (`concierge-ui.js`) | Verified in code & full test suite |
| `CONC-024` | Clicking `#mhc_header_system_badge` in `living-world` mode still called destructive `switchRulesetMode()`; sync & fork buttons lacked busy locks | Blocked `switchRulesetMode()` in `living-world` mode with an info toast nudging Fork, added `#mhc_sync_active_campaign_btn` & `#mhc_fork_campaign_btn` to `setConciergeBusyState()`, and added `isGenerating` guards (`concierge-ui.js`) | `tests/concierge-stage-controller.test.js` |

---

## 8. UI Controls, Button Gating & Immediate Pre-Inference Feedback

| Control (`concierge-modal.html` / `concierge-ui.js`) | Enabled When | Locked During Inference? | Immediate Pre-Inference Visual Feedback? | Gaps |
| :--- | :--- | :--- | :--- | :--- |
| `#mhc_launch_campaign_btn` (`🚀 Finalize & Launch Campaign`) | `new-adventure` mode, `!isGenerating`, `unlockedSteps.character && Boolean(protagonist.name)` | Yes (`setConciergeBusyState` + `isGenerating` guard) | Disabled with explanatory tooltip until ready; opens conflict dialog or `#mhc_launch_progress_overlay` immediately (`try/finally` hides on settle) | Closed (`CONC-016`, `CONC-023`) |
| Conflict modal (`#mhc_conflict_wipe_btn`, `#mhc_conflict_rename_btn`, `#mhc_conflict_cancel_btn`) | Shown when `checkAdventureNameExists()` detects collision | Rename button dynamically disabled on empty or duplicate title | Real-time `#mhc_conflict_rename_feedback` validation; hides overlay before invoking `executeCampaignLaunch()` | Closed |
| `#mhc_sync_active_campaign_btn` (`🔄 Sync to Active Game`) | Visible & enabled in `living-world` (when `updateSyncButtonState()` confirms chat affinity) and `!isGenerating` | Yes (`setConciergeBusyState` + `isGenerating` guard `CONC-024`) | Shows `#mhc_launch_progress_overlay` immediately and cleans up via `try/finally`; preserves Session Zero draft | Closed (`CONC-023`, `CONC-024`) |
| `#mhc_fork_campaign_btn` (`🍴 Fork as New Campaign`) | Visible in `living-world` when `!isGenerating` | Yes (`setConciergeBusyState` + `isGenerating` guard `CONC-024`) | Confirms overwrite if Session Zero draft exists, then switches cleanly to `new-adventure` Step 1 | Closed (`CONC-024`) |
| `#mhc_header_system_badge` | Shown when active campaign / ruleset established | Yes (`setConciergeBusyState` + `isGenerating` guard) | Non-destructive toast in `living-world` (and `new-adventure`) explaining how to safely fork or change rulesets | Closed (`CONC-024`) |

---

## 9. Multi-Turn Refinement (`N`-Turn) Invariants

1. **Multi-Turn Living World Editing:** Players can conduct **0, 1, 2, or N** conversational edits inside `living-world` mode (refining NPCs, dials, world rules, or protagonist) before clicking `🔄 Sync to Active Game`, without disturbing Session Zero drafts (`CONC-023`).
2. **Idempotent Repeated Syncs:** Clicking `🔄 Sync to Active Game` multiple times across turns refreshes `[CORE]` lorebook blocks without duplicating entries (`upsertWorldInfoBook`), merges existing chat memo state without overwriting runtime turns, and updates `CompanionActiveCartridge` cleanly (`CONC-021`).
3. **Repeat Launches & Versioned Re-Runs:** Launching a colliding title offers idempotent overwrite (`wipeOldTitle`) or incremental `v2` / `v3` renaming (`findNextAdventureVersionName`), cleanly purging `_Bestiary` alongside `_NPCs` / `_Locations` / `_Canon` (`CONC-022`).
