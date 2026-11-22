# Prefix Ordering & Map Architect Interop Contracts (`HAND-004` – `HAND-005`)

This specification documents **Phase 2 launch-ordering, campaign-prefix, and Map Architect interoperability contracts** between [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) and upstream `SillyTavern-MultihogDnDFramework` ([map-architect.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/map-architect.js), [router.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/router.js), and [dungeon-reality.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/dungeon-reality.js)).

---

## `HAND-004`: Canonical Campaign Prefix Resolution & Early Stamping

### Problem Solved
Previously in `launchPbtaCampaign()`:
1. Steps 3 (`{prefix}_Bestiary`), 4 (`injectDossierEntitiesIntoCampaignLorebooks`, `injectCanonBook`), and 4b (`injectWorldSkeleton`) each independently read `stateMgr.getEffectiveRouterCampaignPrefix(chatId)`.
2. Step 5 later recomputed `const cleanPrefix = (chatId || '').replace(...)` unconditionally and overwrote `rpgSettings.chatStates[chatId].renamedCampaignPrefix`, risking prefix drift whenever `ensureCleanAdventureChat()` / `alignCampaignPrefixForChat()` had pinned a descriptive prefix, or whenever `.jsonl` / title punctuation differed from `chatId`.
3. Step 0 (`wipeOldTitle`) only deleted `Campaign_${wipeOldTitle}`, potentially leaving `Campaign_${sanitizedPrefix}` behind on fresh restarts.

### Contract
* **Early Canonical Resolution:** Immediately after Step 0b (`ensureCleanAdventureChat()`), `launchPbtaCampaign()` computes `campaignPrefix = resolveCanonicalCampaignPrefix(chatId, { adventureTitle, rpgSettings: rpgEarly, stateMgr: stateMgrEarly })` and calls `stampCanonicalCampaignPrefix(chatId, campaignPrefix, rpgEarly)` **before** Step 3 executes.
* **Priority Order in `resolveCanonicalCampaignPrefix()`:**
  1. Existing `renamedCampaignPrefix` pin on `rpgSettings.chatStates[chatId]`, stripped-`.jsonl` `cleanChatId`, or `${cleanChatId}.jsonl`.
  2. Upstream `stateMgr.getEffectiveRouterCampaignPrefix(cleanChatId || chatId)`.
  3. Sanitized `cleanChatId` or `adventureTitle` via `sanitizePrefixFallback()`.
* **Single Prefix Propagation:** The exact same resolved `campaignPrefix` is passed explicitly into Step 3 (`bestiaryBookName`), Step 4 (`injectDossierEntitiesIntoCampaignLorebooks`, `injectCanonBook`), Step 4b (`injectWorldSkeleton`), and Step 5 (`stampCanonicalCampaignPrefix`), as well as Step 2 of `syncPbtaCampaignUpdates()`.
* **Complete `campaignBooks` Registration:** `stampCanonicalCampaignPrefix()` registers all 9 `STANDARD_CAMPAIGN_BOOK_SUFFIXES` (`NPCs`, `Bestiary`, `Locations`, `Quests`, `Factions`, `Rules`, `Skeleton`, `Canon`, `World`) on `chatStates[chatId].campaignBooks`.
* **Wipe Hygiene:** Step 0 purges both `Campaign_${oldClean}` and `Campaign_${oldSanitized}` (plus cache entries) when `wipeOldTitle` is supplied.

---

## `HAND-005`: Map Architect Prompt/Brief Separation & `{prefix}_Locations` `[CORE]` Preservation

### Problem Solved
1. Step 3 previously appended `threatContext` (`"Staged Threats & Hazards (seed as CREATURE, GROUP, or HAZARD assets...)"`) to `brief_description` inside `mapArch.runMapArchitect(...)`. Upstream `runMapArchitectOnce()` copies `brief_description` directly into `persistArchitectDungeonMap(..., { locationCore: args.briefDescription })`, leaking private GM generation instructions into the Location `[CORE]` entry.
2. Step 3 did not pass a structured `locationCore`, so `persistArchitectDungeonMap()` wrote an unstructured `[CORE]` missing `Kind:`, `Threat:`, and `Entrance:`.
3. Step 4 `upsertWorldInfoBook(locBookName, dist.locations)` previously ran `.replace(/\[CORE\][\s\S]*?\[\/CORE\]/i, () => item.core)` blindly, which could strip upstream `Host Site:` / `Host Brief:` lines or disturb mapped site root `disable: true` semantics.

### Contract
* **Private vs. Public Separation in `runMapArchitect()`:**
  * `prompt` carries `${primaryMap.prompt || primaryMap.briefDescription}${archContext}${threatContext}` so the private Map Architect generator receives both Living Architecture & Infrastructure constraints and Bestiary asset seeding guidance.
  * `brief_description` omits `threatContext` (`${primaryMap.briefDescription || primaryMap.prompt || ''}${archContext}`.trim()).
  * `locationCore` passes `buildLocationEntry(primaryMap).core` directly so upstream creates the primary Location `[CORE]` in canonical Concierge format on creation.
* **Host-Preserving Upsert (`mergePreservingMappedLocationCore()`):**
  * When `upsertWorldInfoBook()` updates `[CORE]...[/CORE]` on an existing entry, it extracts any `Host Site:` / `Host Brief:` lines from the existing `[CORE]` block and preserves them at the bottom of the new `[CORE]` block, matching upstream `applyMappedSiteLocationCore()` (`dungeon-reality.js`).
  * Any `[MAP]...[/MAP]` section and post-`[/CORE]` chronicle text remain untouched.
  * Entries carrying a `[MAP]...[/MAP]` block or `extensions.dungeonMap` always keep `disable: true` so incidental keyword mentions never bypass upstream's current-location hierarchy.
