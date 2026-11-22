# Sanitization, Canon, Bestiary & World Info Registration Contracts (`HAND-001` – `HAND-003`)

This specification locks down the **Phase 1 data-sanitization and World Info formatting contracts** at the Concierge $\rightarrow$ Upstream MultiHog Framework handoff boundary.

---

## `HAND-001`: Universal Recursive NameRAG Token Sanitization

### Problem Solved
During Session Zero, `namerag-hooks.js` and `concierge-canon.js` intentionally allow NameRAG evolution tokens (`[NAME: tag, RESOLVED TO: Name]`, `[REALNAME: Name, NAME: tag]`, `Name [concept: tag]`) and unresolved placeholders (`[[NAME: tag]]`) so the Builder UI can display evolution badges and preserve user intent across revisions. Previously, `launchPbtaCampaign()` and `syncPbtaCampaignUpdates()` in `concierge-runner.js` only stripped `.name` on `protagonist`, `npcs[]`, `monsters[]`, and `factions[]`, leaking raw tokens into `maps[]`, `theKick`, `meta`, `worldRules.axioms`, NPC/monster prose, PC cards, `{prefix}_Skeleton`, and `{prefix}_Canon`. Additionally, `syncPbtaCampaignUpdates()` skipped the pre-handoff `[[NAME:...]]` sweep.

### Canonical Functions & Contract
1. **`stripResolvedNameTokensInText(text)`** ([namerag-hooks.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/namerag-hooks.js)):
   * Skips empty values and `data:` URIs.
   * Strips inline and standalone occurrences across 4 formats:
     * `[NAME: tag, RESOLVED TO: Name]` and `[[NAME: tag, RESOLVED TO: Name]]` (including chained `, RESOLVED TO:` segments) $\rightarrow$ clean resolved name.
     * `[REALNAME: Name, NAME: tag]` / `[REALNAME: Name, TAG: tag]` $\rightarrow$ `Name`.
     * `Name [concept: tag]` $\rightarrow$ `Name`.
     * Lingering `[[NAME: tag]]` / `[[NAME]]` $\rightarrow$ trimmed `tag` or `'Unnamed'`.
2. **`sanitizeDossierResolvedNameTokens(value)`** ([namerag-hooks.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/namerag-hooks.js)):
   * Recursively sanitizes strings, arrays, and plain objects in place using `WeakSet` cycle protection while skipping `portraitSrc` and `data:` URIs.
3. **`prepareSanitizedDossierForFramework(rawDossier, deps)`** ([concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js)):
   * Shared by both `launchPbtaCampaign()` and `syncPbtaCampaignUpdates()`:
     1. Runs `resolveDossierNamePlaceholders()` if `[[NAME` appears anywhere in the serialized dossier.
     2. Runs `healAndNormalizeDossier()`.
     3. Runs `sanitizeDossierResolvedNameTokens(dossier)` recursively across the full dossier graph.
     4. Strips any remaining outer quotes on entity `.name` fields via `parseResolvedNameToken()`.
4. **Defensive Formatter Guarantees:**
   * `buildPlayerCardBio()` (`concierge-pc-format.js`), `buildNpcEntryContent()` / `buildMonsterEntryContent()` / `buildNpcKeys()` (`concierge-npc-format.js`), and `buildFactionEntry()` / `buildLocationEntry()` / `buildStartingQuestEntry()` / `buildWorldRuleEntry()` / `buildCustomModuleLoreEntry()` / `buildMapThreatBrief()` / `buildWorldSkeletonEntries()` (`concierge-lore-distributor.js`) also sanitize their inputs/outputs directly so standalone callers never emit NameRAG syntax.
   * `extractCleanKeywords()` strips NameRAG tokens *before* stripping bracketed metadata so resolved names become searchable World Info trigger keys rather than being discarded.

---

## `HAND-002`: Canon (`{prefix}_Canon`) Format, `[CORE]` Wrapping & Keyring Isolation

### Problem Solved & Upstream Interaction
1. **`writeStagedCanon()`** in [concierge-canon.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-canon.js) previously wrote staged `comment`, `keys`, and `content` verbatim, leaking Session Zero `[NAME: ..., RESOLVED TO: ...]` tokens into `{prefix}_Canon`.
2. Canon entries had no `[CORE]...[/CORE]` block, meaning upstream `router.js` could overwrite or condense them instead of treating Canon facts as immutable core lore.
3. Upstream `scanAssistantOutputForKeywords()` (`router.js`) activates every campaign lorebook entry with `entry.key.length > 0` regardless of `entry.disable`, because MultiHog's Keyring Attention Model sets `entry.disable = true` on all inactive managed entries. Setting `disable: true` alone on out-of-scope Archivist entries did **not** prevent keyword activation into `activeRouterKeys`.

### Contract
* **Session Zero In-Memory Purity:** `writeStagedCanon()` NEVER mutates the in-memory `getStagedCanonEntries()` objects, preserving badge tokens for Session Zero revisions.
* **`[CORE]` Wrapping (`wrapCanonCoreContent()`):** Strips NameRAG tokens and wraps Canon body text inside `[CORE]\n...\n[/CORE]` (unless already wrapped). On updates to existing entries that already have `[CORE]...[/CORE]`, only the `[CORE]` block is replaced so any live chronicle text appended below `[/CORE]` is preserved.
* **Out-of-Scope Isolation (`e.disabled === true`):**
  * When `disabled === true`: writes `disable: true`, `vectorized: false`, `key: []`, and backs up sanitized keys in `extensions.canonKeys`. Because `key.length === 0`, upstream `scanAssistantOutputForKeywords()` skips the entry cleanly.
  * When `disabled === false` (or toggled back on): writes `disable: false`, `vectorized: true`, and restores `key` from sanitized `e.keys` or `extensions.canonKeys`.
  * **Residual upstream keyring note:** Upstream `buildKeyringText()` (`lorebook-keyring.js`) still lists all `{prefix}_Canon` entries regardless of `disable`; clearing `key: []` prevents unsolicited Turn 1–N keyword activation and vector ingestion until toggled active.

---

## `HAND-003`: Bestiary (`{prefix}_Bestiary`) Normalization & SillyTavern World Info Registration

### Bestiary Entry Contract (`concierge-npc-format.js`)
* `buildMonsterEntryContent()` guarantees clean stripped `Name: cur/max HP | ...` header lines compatible with upstream `COMBATANT_HP_RX` (`combat-persistence.js`) across D&D 5e, FAE, and PbtA.
* String-typed `monster.attacks` / `actions` and `monster.impendingDoom` are normalized via `normalizeMonsterListField()` (splitting comma/semicolon lists with `splitTopLevelCommas`, and `→`/`->` progressions for `impendingDoom`) rather than being silently dropped when non-array strings are supplied.

### Immediate ST World Info Registry & Activation (`concierge-runner.js`)
Previously, `upsertWorldInfoBook()`, `injectCanonBook()`, `injectWorldSkeleton()`, and `injectDossierIntoWorldInfo()` saved via `/api/worldinfo/edit`, `router.updateWorldInfoCache()`, and `router.rememberCampaignBook()`, but omitted SillyTavern's own in-memory registry and chat activation calls (unlike upstream `router.js`).

All four writers now finish by calling `registerAndActivateWorldInfoBook(bookName, bookData, { ctx, router, activateOnChat: true })`:
1. `router.updateWorldInfoCache(bookName, bookData)` & `router.rememberCampaignBook(bookName)` (when `router` is passed for `{prefix}_*` campaign books).
2. `ctx.saveWorldInfo(bookName, bookData)` — populates ST's in-memory registry immediately so Step 3 `runMapArchitect({ lorebookNames: [bestiaryBookName] })` can read `{prefix}_Bestiary` via `ctx.loadWorldInfo()`.
3. `ctx.updateWorldInfoList()` — refreshes ST's World Info dropdown/list without an F5 reload.
4. `ctx.executeSlashCommandsWithOptions('/world state=on silent=true "<bookName>"')` — binds the book as active for Turn 1 keyword/vector evaluation.
