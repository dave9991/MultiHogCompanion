# MultiHog Companion — Data Migrations, String Patches & State Sanitizers (`DATA_MIGRATIONS.md`)

> **Purpose:** Document every "on-the-fly" string replacement, regex patch, data-migration-on-read hack, and fallback text override active in `MultiHogCompanion` and upstream `MultiHog`.
> This catalog tracks **what is matched, where it executes, why it exists, and the conditions under which it can be safely removed or isolated**.

---

## 1. Architectural Architecture & The 5-Quadrant Reference Web

```
┌─────────────────────────────────┬─────────────────────────────────┐
│       WHAT ARE WE DOING?        │       HOW IS IT WIRED?          │
│            (Intent)             │          (Mechanism)            │
├─────────────────────────────────┼─────────────────────────────────┤
│ FEATURES.md                     │ LISTENERS.md                    │
│ • User-facing capabilities      │ • Event Bus (eventSource.on)    │
│ • Ruleset engines (PbtA, FAE)   │ • DOM Delegation ($(doc).on)    │
│ • Concierge Session Zero        │ • Debounce & Settlement Timers  │
│ • Relationship Narrative Sync   │ • Coordinator Pipelines         │
├─────────────────────────────────┼─────────────────────────────────┤
│ WORKAROUNDS.md                  │ MONKEYPATCHES.md                │
│ • Upstream defects & hazards    │ • ADRs for runtime hijacking    │
│ • Blast radius if unmitigated   │ • window.fetch interception     │
│ • Retirement criteria           │ • generateRaw API wrapping      │
├─────────────────────────────────┴─────────────────────────────────┤
│ DATA_MIGRATIONS.md (This File)                                    │
│ • Storage migrations on read (localStorage schema upgrades)       │
│ • On-the-fly string sanitizers and regex cleansing                │
│ • UI presentation layer filters vs. data layer cleansing          │
│ • Upstream MultiHog read-only string & storage reference          │
└───────────────────────────────────────────────────────────────────┘
```

---

## Section 1: MultiHogCompanion (Active & Editable)

### 1.1 Summary Matrix

| Migration ID | Title / Mechanism | File & Function | Target String / Regex Pattern | Replacement | Why It Exists | Safe to Remove When |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **MIG-01** | **Concierge Assistant Persona Cleansing [RETIRED]** | `concierge-ui.js`<br>• `loadValidatedDraft`<br>• `renderChatHistoryFromState`<br>• `appendChatBubble` | `/I'm your (?:PbtA\|Session Zero)\s+Concierge/gi` | `"I'm your Concierge"` | Legacy Session Zero drafts contained hardcoded "PbtA Concierge" greetings that leaked into multi-ruleset (FAE, D&D 5e) sessions. | ⚪ **RETIRED** via Option B clean sweep. Cleansed drafts and removed regex filters from presentation layer and load pipeline. |
| **MIG-02** | **Concierge Draft Storage Key Migration** | `concierge-ui.js`<br>• `loadValidatedDraft`<br>• `saveConciergeDraft`<br>• `clearConciergeDraft` | Key `mhc_pbta_concierge_draft` (`STORAGE_DRAFT_KEY`) | Re-keyed to `mhc_concierge_draft_pbta` (`adapter.getDraftStorageKey()`) | Migrated single global draft storage key to ruleset-isolated keys to prevent cross-ruleset draft overwrite. | Safe to delete once all user profiles have loaded post-Phase 3 drafts or on localStorage reset. |
| **MIG-03** | **Concierge State Block Stripping** | `concierge-parser.js`<br>• `stripConciergeStateBlocks`<br>`concierge-ui.js`<br>• `renderChatHistoryFromState`<br>• `processStreamingReply` | `[UPDATE_DOSSIER]`, `[CONCIERGE_STATE]`, `[FRAMING]`, `[CANON_...]`, `[PROTAGONIST]`, etc. | `""` (Stripped from visible bubble text) | Strips internal architectural protocol blocks from assistant streaming chunks and chat history so only conversation displays. | **Permanent**. Core protocol display filter for Concierge chat stream. |
| **MIG-04** | **Character Creator Macro Sanitizer** | `character-creator-sanitizer.js`<br>• `sanitizeCharacterStockPrompt`<br>`index.js`<br>• QuickStart click handlers | `\{\{user\}\}(\s*[\(:])`<br>`\{\{user\}\}`<br>`\bCharacter Name\b(\s*[\(:])` | Protagonist name (or "the Adventurer" / "the protagonist") | Upstream stock prompts hardcode `{{user}}`, which ST macro expansion resolves to the human player persona instead of the RPG character. | Keep active until upstream MultiHog scopes character creator templates without `{{user}}`. |
| **MIG-05** | **Live Memo Character Header Sanitizer** | `character-creator-sanitizer.js`<br>• `sanitizeCharacterHeaderInMemo`<br>• `stripMarkdownNameArtifacts` | `[*_\`~]`, `<[^>]+>`, repeated parentheticals `(\s*\((.*?)\))\s*\(\2\)`, and pool debuff `\(\(BAR...\)\)` | Clean unformatted name without duplicate tags | LLMs frequently wrap names in markdown (`**Name**`) or append duplicate archetypes, breaking upstream MultiHog header regexes. | **Permanent**. Necessary defense against LLM markdown variance. |
| **MIG-06** | **Outgoing Macro AST Sanitizer** | `character-creator-sanitizer.js`<br>• `sanitizeInstructionMacroLiterals`<br>• `ADR-MP-07` (`generateRaw`) | `\{\{user\}\}`, `\{\{char\}\}`, `<USER>`, `</USER>` | Safe escaped / stripped text | Upstream templates pass unescaped macro tokens to `generateRaw`, causing SillyTavern's macro parser to throw fatal syntax errors. | Keep active until upstream escapes prompt strings before `generateRaw`. |
| **MIG-07** | **Stock D&D Settings Pollution Scrubber** | `pbta-ruleset-persistence.js`<br>• `cleanseStockDndSettings`<br>`index.js`<br>• Chat changed coordinator | In-memory `settings.stockPrompts`, `modules`, `blockOrder` | Restored D&D 5e factory defaults or cleansed custom blocks | Upstream shares a single global settings object; switching between PbtA and 5e chats contaminates standard 5e prompts. | Keep active until upstream scopes settings by chat or campaign. |
| **MIG-08** | **Ruleset System Label Prefix Normalization** | `pbta-ruleset-persistence.js`<br>• `reconcileCustomRuleset` | `/^FAE:\s*/i`, `/^PbtA:\s*/i` | `""` | Legacy presets prepended `PbtA:` or `FAE:` to `systemLabel`, creating redundant labels (`FAE: FAE: Cyberpunk`). | Keep active for backward compatibility with legacy custom presets. |
| **MIG-09** | **MultiHog HUD Syntax Pill Adapter** | `pbta-ruleset.js`<br>• Move, gear, bond formatting | `/\(/g` and `/\)/g` inside stat/move details | `[` and `]` | Upstream MultiHog HUD parser treats `(...)` as hover tooltip triggers; parens in descriptions break pill layout or truncate text. | Keep active until upstream HUD supports nested parentheses. |
| **MIG-10** | **CYOA Prompt & Choice Block Normalizer** | `cyoa-generator.js`<br>• `generateCYOAChoices`<br>`cyoa-safety-net.js`<br>• Choice block repair | Code fences (```` ``` ````), `<button>`, `[button]`, `<choices>` spacing `([^\r\n])\n([ \t]*<choices\b)` | Stripped wrapper tags and double-spaced `<choices>` blocks | LLMs wrap choices in code blocks; ST markdown crashes or collapses footers when `<choices>` is not separated by a blank line. | **Permanent**. Core CYOA parsing and UI render guard. |
| **MIG-11** | **Relationship Milestone Core Echo Cleanser** | `relationship-narrative-sync.js`<br>• `sanitizeCoreFieldUpdate` | `/^(?:\*{1,3}\|_{1,3})?\s*(?:Personality\|Habits...)\s*[:\-—–]?\s*/i` | `""` | LLMs repeat the field header inside JSON milestone responses, causing self-compounding headers like `Personality: Personality: ...`. | **Permanent**. Defense against LLM key echoing. |
| **MIG-12** | **Filesystem & Lorebook Prefix Sanitization** | `adventure-chat.js`<br>`campaign-lore-sync.js`<br>`campaign-set-manager.js` | `/\.jsonl$/i`, `/[\\/:*?"<>\|]/g`, `/[^a-zA-Z0-9]+/g` | Safe title / prefix with underscores | SillyTavern chat filenames end in `.jsonl` and may contain spaces/special characters; lorebooks and partition keys require alphanumeric names. | **Permanent**. Core filesystem and state partitioning utility. |

---

### 1.2 Deep Dive: Detailed Item Specifications

#### MIG-01: Concierge Assistant Persona Cleansing [RETIRED]
* **Status:** ⚪ **RETIRED** (Clean Sweep Option B executed)
* **Historical Locations:**
  * `concierge-ui.js` -> `loadValidatedDraft(targetRuleset)`
  * `concierge-ui.js` -> `renderChatHistoryFromState()`
  * `concierge-ui.js` -> `appendChatBubble(role, text, ...)`
* **Target Pattern:** `/I'm your (?:PbtA|Session Zero)\s+Concierge/gi`
* **Replacement:** `"I'm your Concierge"`
* **Why It Existed:**
  In Phase 1, the Session Zero assistant introduction was hardcoded in prompt strings and greetings as `"I'm your PbtA Concierge"` or `"I'm your Session Zero Concierge"`. When Phase 3 generalized the architecture to support FAE, D&D 5e, and custom rulesets, drafts saved in `localStorage` still contained the old greeting. If a user loaded an old draft while in FAE mode, the assistant bubble displayed "I'm your PbtA Concierge". The regex replacement was added to `loadValidatedDraft`, but was also defensively copied into `renderChatHistoryFromState` and `appendChatBubble`.
* **Retirement Rationale:**
  With modern greetings in `concierge-ui.js` natively adopting the ruleset-neutral greeting `"Welcome to Session Zero! I'm your Concierge..."`, all new drafts are clean by default. In accordance with Option B (Clean Sweep), the redundant regex filters were completely eliminated from `appendChatBubble()`, `renderChatHistoryFromState()`, and `loadValidatedDraft()`, restoring pure presentation rendering without runtime regex overhead. User drafts containing legacy intros are cleared on draft reset.

#### MIG-02: Concierge Draft Storage Key Migration
* **Files & Functions:**
  * `concierge-ui.js` -> `loadValidatedDraft(targetRuleset)` (lines 340-349)
  * `concierge-ui.js` -> `saveConciergeDraft()` (line 303)
  * `concierge-ui.js` -> `clearConciergeDraft()` (line 478)
* **Target Pattern:** Storage key `'mhc_pbta_concierge_draft'`
* **Replacement:** Scoped key `'mhc_concierge_draft_pbta'` via `adapter.getDraftStorageKey()`
* **Why It Exists:**
  Initial versions used a single global key `mhc_pbta_concierge_draft`. When FAE support was introduced, drafts between PbtA and FAE would overwrite each other. `loadValidatedDraft` checks if the scoped key exists; if missing and the requested ruleset is PbtA, it copies from `mhc_pbta_concierge_draft` into `mhc_concierge_draft_pbta` and deletes the old key via `localStorage.removeItem(STORAGE_DRAFT_KEY)`.
* **Safe to Remove When:**
  When existing browser profiles have loaded and migrated their old draft, or if the user performs a draft reset.

#### MIG-03: Concierge State Block Stripping
* **Files & Functions:**
  * `concierge-parser.js` -> `stripConciergeStateBlocks(text)` (line 307)
  * `concierge-ui.js` -> `renderChatHistoryFromState()` (line 578)
  * `concierge-ui.js` -> `processStreamingReply()` (lines 734, 786)
* **Target Pattern:**
  * `[UPDATE_DOSSIER][\s\S]*?(?:[/UPDATE_DOSSIER]|$)`
  * `[CONCIERGE_STATE][\s\S]*?(?:[/CONCIERGE_STATE]|$)`
  * `[CONTEMPLATION][\s\S]*?(?:[/CONTEMPLATION]|$)`
  * `[FRAMING][\s\S]*?(?:[/FRAMING]|$)`
  * `[CANON_ENTRY][\s\S]*?(?:[/CANON_ENTRY]|$)`
  * `[DOSSIER_CRITIQUE][\s\S]*?(?:[/DOSSIER_CRITIQUE]|$)`
  * `[PROTAGONIST]`, `[NPC]`, `[MONSTER]`, `[MAP]`, `[FACTION]`, `[KICK]`, `[CYOA]`, `[CONFIG]`, `[WORLD_RULES]`, `[BUILDER_REPORT]`, `[PROMOTE_CANON]`
* **Replacement:** `""` (Empty string)
* **Why It Exists:**
  The Concierge LLM produces unified turn output containing structured architectural updates alongside conversational narration. To avoid displaying JSON-like XML markup to the user in the chat UI, these blocks are stripped during rendering and streaming, while `applyDossierUpdates` parses their contents into the internal dossier state.
* **Safe to Remove When:**
  **Permanent architectural requirement.** Cannot be removed.

#### MIG-04: Character Creator Macro Sanitizer
* **Files & Functions:**
  * `character-creator-sanitizer.js` -> `sanitizeCharacterStockPrompt(stockPrompts, targetName)` (lines 125, 128, 132)
  * `index.js` -> QuickStart click delegations
* **Target Pattern:**
  * `/\{\{user\}\}(\s*[\(:])/gi` -> `${replacement}$1`
  * `/\{\{user\}\}/gi` -> `replacement`
  * `/\bCharacter Name\b(\s*[\(:])/gi` -> `${replacement}$1`
* **Why It Exists:**
  Upstream MultiHog's bundled character creation prompt uses `{{user}}` to denote the character being rolled. SillyTavern's macro engine resolves `{{user}}` to the player's active persona name (e.g. "Dave") before the LLM sees it. This caused characters to be named after the human user rather than the protagonist chosen in Session Zero.
* **Safe to Remove When:**
  Safe to remove only if upstream MultiHog refactors its character creator prompt templates to accept explicit protagonist name parameters rather than relying on `{{user}}`.

#### MIG-05: Live Memo Character Header Sanitizer
* **Files & Functions:**
  * `character-creator-sanitizer.js` -> `sanitizeCharacterHeaderInMemo(memo, fallbackName)` (lines 152-215)
  * `character-creator-sanitizer.js` -> `stripMarkdownNameArtifacts(raw)` (line 33)
* **Target Pattern:**
  * Markdown wrappers: `/[*_`~]/g` -> `""`
  * HTML tags: `/<[^>]+>/g` -> `""`
  * Leading bullet / prompt tokens: `/^[-*•–—#>\s]+/` -> `""`
  * Duplicate parentheticals: `/(\s*\(\s*([^)]+?)\s*\))\s*\(\s*\2\s*\)/gi` -> `"$1"`
  * Second-bar pool & zero-debuff leaks: `/\(\(BAR(?::\s*([a-zA-Z]+)|([a-zA-Z]+)|\s*-\s*([a-zA-Z]+))\)\)/gi` -> `""` and `/\s*\(Zero Debuff:.*\)\s*$/i` -> `""`
* **Why It Exists:**
  LLMs frequently format character names as `**Character Name** (Class) (Class)` or inject bar macros into the first line of `[CHARACTER]`. Upstream MultiHog's parser (`memo-processor.js` and `state-manager.js`) uses strict regexes that fail to match character names if markdown asterisks or double parentheses are present, causing the character sheet to appear blank in the HUD.
* **Safe to Remove When:**
  **Permanent runtime defense.** Required whenever LLMs produce markdown-formatted state memos.

#### MIG-06: Outgoing Macro AST Sanitizer
* **Files & Functions:**
  * `character-creator-sanitizer.js` -> `sanitizeInstructionMacroLiterals(str)` (lines 323-345)
  * `character-creator-sanitizer.js` -> `installMacroSyntaxSanitizer()` (`ADR-MP-07`)
* **Target Pattern:** `\{\{user\}\}`, `\{\{char\}\}`, `<USER>`, `</USER>` inside outgoing prompt strings sent to `generateRaw`
* **Why It Exists:**
  When upstream MultiHog runs character generation or portrait prompt generation, it passes raw instructional templates containing literal macro syntax directly to `SillyTavern.getContext().generateRaw()`. SillyTavern's macro engine attempts to evaluate these as live template tags and throws an unhandled AST syntax exception, aborting generation.
* **Safe to Remove When:**
  When upstream MultiHog sanitizes prompt templates before dispatching to `generateRaw`.

#### MIG-07: Stock D&D Settings Pollution Scrubber
* **Files & Functions:**
  * `pbta-ruleset-persistence.js` -> `cleanseStockDndSettings(s, options)` (lines 776-930)
  * `index.js` -> `ensureActiveChatRulesetConsistency()`
* **Target Pattern:**
  * Foreign PbtA / FAE prompts in `settings.stockPrompts`
  * Inactive custom system prompt modules in `settings.modules`
  * Corrupted module ordering in `settings.blockOrder`
* **Why It Exists:**
  Upstream MultiHog maintains a single shared in-memory settings object (`rpg_tracker_settings`). Opening a PbtA campaign mutates `stockPrompts` with PbtA instructions. If the user subsequently switches to a standard D&D 5e chat, upstream continues using the PbtA stock prompts, causing 5e adventures to roll 2d6 and request PbtA moves. `cleanseStockDndSettings` detects ruleset boundaries and purges cross-engine pollution.
* **Safe to Remove When:**
  When upstream MultiHog scopes settings and stock prompts per chat partition.

#### MIG-08: Ruleset System Label Prefix Normalization
* **Files & Functions:**
  * `pbta-ruleset-persistence.js` (lines 443, 469, 471)
* **Target Pattern:** `dossier.meta.systemLabel.replace(/^FAE:\s*/i, '').trim()` and `replace(/^PbtA:\s*/i, '').trim()`
* **Why It Exists:**
  Older cartridges and early draft templates prepended `PbtA:` or `FAE:` directly to the `systemLabel` field (e.g. `PbtA: Fantasy Adventure`). When rendered in the ruleset badge or settings dropdown, this caused doubled prefixes like `PbtA: PbtA: Fantasy Adventure`.
* **Safe to Remove When:**
  Safe to keep as a cheap guard, or migrate existing custom cartridge JSON files.

#### MIG-09: MultiHog HUD Syntax Pill Adapter
* **Files & Functions:**
  * `pbta-ruleset.js` (lines 1454, 1481, 1512, 1676)
* **Target Pattern:** `text.replace(/\(/g, '[').replace(/\)/g, ']')`
* **Why It Exists:**
  Upstream MultiHog's HUD renderer (`renderer.js`) parses `((PILL))` tokens. Any text enclosed in parentheses `(...)` is parsed as a hover-toast tooltip, while text in brackets `[...]` renders as inline secondary badge text. If a move description or bond uses parentheses, the upstream parser splits the pill unexpectedly or creates broken hover toasts.
* **Safe to Remove When:**
  When upstream MultiHog's renderer supports escaped parentheses in pill tokens.

#### MIG-10: CYOA Prompt & Choice Block Normalizer
* **Files & Functions:**
  * `cyoa-generator.js` (lines 337, 381-384, 811)
  * `cyoa-safety-net.js` (lines 131-143, 262, 801)
* **Target Pattern:**
  * Code blocks: `text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '')`
  * Button tags: `l.replace(/^<(?:button|choice|option)\b[^>]*>\s*/i, '').replace(/<\/(?:button|choice|option)\s*>$/i, '')`
  * Paragraph separation: `text.replace(/([^\r\n])\r?\n([ \t]*<choices\b)/gi, '$1\n\n$2')`
  * Historical choices: `.replace(/<choices\b[^>]*>[\s\S]*?<\/choices\s*>/gi, '')`
* **Why It Exists:**
  LLMs frequently wrap CYOA choices in markdown backticks or XML tags. If `<choices>` is not separated from preceding narrative text by two newlines, SillyTavern's markdown parser fuses the choices into an inline paragraph, collapsing button layouts to 0px height. Historical choices in previous turns must also be stripped before sending prompts to the LLM to avoid context bloat.
* **Safe to Remove When:**
  **Permanent runtime defense.** Core requirement for CYOA reliability.

#### MIG-11: Relationship Milestone Core Echo Cleanser
* **Files & Functions:**
  * `relationship-narrative-sync.js` -> `sanitizeCoreFieldUpdate` (lines 74-105, 581)
* **Target Pattern:**
  * Header prefix: `/^(?:\*{1,3}|_{1,3})?\s*(?:Personality|Habits(?:\s*\/\s*Behaviors)?)\s*(?:\*{1,3}|_{1,3})?[:\-—–]?\s*/i`
  * Markdown fences: `/^```(?:json|markdown|text)?\s*\n?/i`
* **Why It Exists:**
  When the milestone parser prompts the LLM to update an NPC's `Personality` or `Habits/Behaviors` field, the model frequently outputs `Personality: Cynical` or `**Personality:** Cynical`. If not stripped, repeatedly updating an NPC results in self-compounding header prefixes in lorebook records.
* **Safe to Remove When:**
  **Permanent runtime defense.** Core requirement for lorebook integrity.

#### MIG-12: Filesystem & Lorebook Prefix Sanitization
* **Files & Functions:**
  * `adventure-chat.js` (lines 51, 70, 244, 277, 422, 457)
  * `campaign-lore-sync.js` (lines 114, 201, 382)
  * `campaign-set-manager.js` (lines 35, 81, 105, 235, 302, 421)
* **Target Pattern:**
  * Stripping `.jsonl`: `.replace(/\.jsonl$/i, '')`
  * Removing invalid filename chars: `.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()`
  * Generating strict alphanumeric prefixes: `.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')`
* **Why It Exists:**
  SillyTavern chat identifiers end with `.jsonl` and can include spaces or punctuation. Lorebook names, partition keys in settings, and campaign tags require deterministic alphanumeric formats to avoid filesystem errors on Linux/Windows and prevent corrupted lookup keys.
* **Safe to Remove When:**
  **Permanent architectural utility.**

---

## Section 2: Upstream MultiHog Framework (Read-Only Reference)

The following string replacements, data migrations, and fallback sanitizers occur natively inside `extensions/SillyTavern-MultihogDnDFramework`. This section serves as a technical reference for diagnosing unexpected behavior or upstream conflicts.

| Upstream ID | Module & Function | Target String / Pattern | Replacement | Mechanism & Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **UP-MIG-01** | `adventure-companion.js`<br>`loadPrefs()` | `localStorage` keys `rpg_tracker_tutorial_chat` and `rpg_tracker_tutorial_lookback` | Migrated into `rpg_tracker_chat_prefs_v1` (`PREFS_STORAGE_KEY`) | One-time migration of legacy tutorial-only history into unified per-chat companion preferences. Calls `localStorage.removeItem()` on legacy keys. |
| **UP-MIG-02** | `portrait-storage.js`<br>`migrateAllEmbeddedPortraits()` | Embedded `data:image/...;base64,...` in `settings.customPortraits` | Written to disk as `user/images/rpg_tracker_portraits/<name>.png` | Migrates bulky base64 data URLs out of `settings.json` to reduce settings file size and prevent browser `localStorage` quota crashes. |
| **UP-MIG-03** | `portrait-storage.js`<br>`migrateLegacyPortraitMapsToChat()` | Global `settings.customPortraits` | Scoped to `settings.chatStates[chatId].customPortraits` | Scopes portraits to individual chat partitions on boot so images do not bleed across unrelated campaigns. |
| **UP-MIG-04** | `index.js`<br>Settings upgrade pass | `settings.stockPrompts.quests_legacy` containing `OBJ_ACTIVE` | Overwrites `settings.stockPrompts.quests`; deletes `quests_legacy` and `questLegacyMode` | Upgrades legacy quest prompts to modern XML object format. |
| **UP-MIG-05** | `src/features/chat/local-chat-map.js`<br>`moveLocalChatMapEntry()` | Key `oldId` in `rpg_tracker_companion_by_chat_v1` and `rpg_tracker_memo_recovery_v1` | Re-keyed to `newId` | On `CHAT_RENAMED`, moves companion history and memo recovery WAL to the new chat title so data is not orphaned. |
| **UP-MIG-06** | `index.js`<br>Quest prompt builder | `prompt.replace(/  DEADLINE:.*\n/g, '')`<br>`prompt.replace(/  FRUSTRATION_COEFF:.*\n/g, '')` | `""` (Stripped) | On-the-fly prompt tailoring: strips deadline and frustration coefficient rules from stock prompts when quests have no time limits. |
| **UP-MIG-07** | `memo-processor.js`<br>`index.js`<br>`character-creator.js` | `rawMemo.replace(/<\/?memo>/gi, '')`<br>`raw.replace(/<state_memo>[\s\S]*?<\/state_memo>/gi, '')` | `""` (Stripped) | Strips outer XML memo wrappers during delta calculation, HUD rendering, and character creation. |
| **UP-MIG-08** | `dungeon-reality.js`<br>Location parser | `</div hidden>` (malformed tag) and `INTERIOR` asset synonym | Normalized to proper hidden closing tags and modern map tokens | Tolerates malformed markup emitted by historical LLM versions in old chat logs. |
| **UP-MIG-09** | `index.js`<br>CYOA choice wrapper | Duplicate choice block wraps | Re-flattened to a single `<div class="rt-cyoa-choices">` | Fixes DOM re-render glitches where SillyTavern re-wraps existing choice buttons on message edits. |
| **UP-MIG-10** | `index.js`<br>`applyFactoryReset()` | `rpg_tracker_*` keys in `localStorage` | `localStorage.removeItem(key)` | Emergency UI reset: wipes all layout and geometry keys (`_agent_detached`, `_visible`, `_collapsed`) while preserving core settings. |

---

## Section 3: Proposed Cleanup Plan for MultiHogCompanion

### 3.1 Problem Diagnosis: Leaky UI Sanitization
In `concierge-ui.js`, regex cleansing of legacy assistant introductions (`/I'm your (?:PbtA|Session Zero)\s+Concierge/gi`) is currently executed in three distinct locations:
1. **On Load:** In `loadValidatedDraft()` across `draft.chatHistory` and `draft.stageChatHistories`.
2. **On History Re-render:** In `renderChatHistoryFromState()` right before passing to `appendChatBubble()`.
3. **On Every Bubble Append:** In `appendChatBubble()`, firing on every assistant message (streaming, button response, history replay).

Executing regex replacements inside UI rendering functions violates architectural separation of concerns:
* **Redundant Work:** `renderChatHistoryFromState()` replaces the string, and then immediately calls `appendChatBubble()`, which runs the exact same regex replacement on the exact same string a second time.
* **Leaky Abstraction:** The UI layer is burdened with historical draft migration logic rather than receiving already-sanitized state.

---

### 3.2 Two Cleanup Options

#### Option A: Isolate to `migrateLegacyState()` on Storage Ingestion (Non-Destructive)
If we want to preserve existing `localStorage` drafts without data loss:
1. **Create `migrateLegacyDraft(rawDraft)`:**
   * Place in `concierge-parser.js` or alongside `loadValidatedDraft` in `concierge-ui.js`.
   * Performs all schema upgrades and legacy text rewrites once:
     * Cleanses `chatHistory` and `stageChatHistories` of legacy assistant introductions.
     * Sanitizes legacy ruleset keys or missing origin metadata.
2. **Purge UI Layer Filters:**
   * Remove `text.replace(/I'm your (?:PbtA|Session Zero)\s+Concierge/gi, ...)` from `renderChatHistoryFromState()`.
   * Remove `text.replace(/I'm your (?:PbtA|Session Zero)\s+Concierge/gi, ...)` from `appendChatBubble()`.
3. **Result:**
   * UI functions receive clean, pre-sanitized state. Zero regex overhead during message streaming or bubble rendering.

#### Option B: Clean Sweep (Immediate Removal via Draft Wipe)
If you are willing to clear your current `localStorage` Session Zero draft:
1. **Wipe Draft Storage:**
   * Run `localStorage.removeItem('mhc_concierge_draft_pbta')`, `localStorage.removeItem('mhc_concierge_draft_fae')`, and `localStorage.removeItem('mhc_pbta_concierge_draft')`.
2. **Flat-Out Delete:**
   * **Delete MIG-01 entirely:**
     * Remove from `appendChatBubble()`.
     * Remove from `renderChatHistoryFromState()`.
     * Remove from `loadValidatedDraft()`.
   * **Delete MIG-02 entirely:**
     * Remove the legacy `STORAGE_DRAFT_KEY` (`mhc_pbta_concierge_draft`) fallback check from `loadValidatedDraft()`, `saveConciergeDraft()`, and `clearConciergeDraft()`.
3. **Result:**
   * Completely eliminates legacy compatibility shims, reducing code complexity and removing ~40 lines of backward-compatibility debt.
