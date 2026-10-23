# MultiHog Companion — Upstream Defect & Workaround Registry (`WORKAROUNDS.md`)

> **Purpose:** Document every defect, race condition, architectural omission, or hazard in upstream MultiHog DnD (or SillyTavern) that MultiHog Companion must safely work around.
> Because upstream MultiHog DnD is strictly read-only, Companion implements **prosthetic shims, preflight sanitizers, and interceptors** to ensure campaign stability.
> This catalog tracks **why each workaround exists, what breaks if it is removed, and what upstream would need to change for it to be retired**.

---

## 1. Workaround Architecture & The 4-Way Reference Web

```
┌─────────────────────────────────┬─────────────────────────────────┐
│       WHAT ARE WE DOING?        │       HOW IS IT WIRED?          │
│            (Intent)             │          (Mechanism)            │
├─────────────────────────────────┼─────────────────────────────────┤
│ FEATURES.md                     │ LISTENERS.md                    │
│ • User-facing capabilities      │ • Event Bus (eventSource.on)    │
│ • Ruleset engine (PbtA)         │ • DOM Delegation ($(doc).on)    │
│ • Concierge Session Zero        │ • Debounce & Settlement Timers  │
│ • Relationship Narrative Sync   │ • Coordinator Pipelines         │
├─────────────────────────────────┼─────────────────────────────────┤
│ WORKAROUNDS.md (This File)      │ MONKEYPATCHES.md                │
│ • Upstream defects & hazards    │ • ADRs for runtime hijacking    │
│ • Why upstream is broken/risky  │ • window.fetch interception     │
│ • Blast radius if unmitigated   │ • generateRaw API wrapping      │
│ • Upstream retirement criteria  │ • In-memory settings rewriting  │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## 2. Workaround Summary Matrix

| Workaround ID | Title / Target Defect | Severity / Risk | Associated Feature | Associated Mechanism | Retirement Feasibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **WRK-01** | **Synthetic Cartridge Ruleset Injection** | 🔴 **HIGH**: Upstream lacks any cartridge/ruleset plugin interface. | [`FEAT-01 (PbtA Cartridge)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine) | [`ADR-MP-01 (window.fetch)`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch) | Medium (Requires upstream plugin loader). |
| **WRK-02** | **Character Creator Macro Poisoning & AST Syntax Errors** | 🟡 **MODERATE**: Upstream prompt contains literal `{{char}}`, `{{user}}`, `{{...}}`. | [`FEAT-06 (NameRAG)`](./FEATURES.md#feat-06-namerag-diverse-protagonist--npc-generator)<br>QuickStart / Card Gen | [`ADR-MP-07 (generateRaw)`](./MONKEYPATCHES.md#adr-mp-07-outgoing-prompt-macro-syntax-sanitizer-generateraw-interception)<br>[`DOM-01a / DOM-01b`](./LISTENERS.md#dom-01a) | High (Upstream escapes its prompt strings). |
| **WRK-03** | **Stock D&D Settings Pollution & Prompt Bleed** | 🟡 **MODERATE**: Upstream shares single global `stockPrompts` object. | [`FEAT-01 (PbtA Cartridge)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine)<br>Standard D&D Play | [`ADR-MP-05 (stockPrompts)`](./MONKEYPATCHES.md#adr-mp-05-in-memory-upstream-settings-cleansing-stockprompts-mutation)<br>[`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator)<br>[`DOM-01a / DOM-01b`](./LISTENERS.md#dom-01a) | High (Upstream scopes prompts by chat). |
| **WRK-04** | **Chat Rename Inversion & Partition Reset Race** | 🔴 **CRITICAL**: ST reloads chat before firing `CHAT_RENAMED`. | [`FEAT-05 (Lorebook Sync)`](./FEATURES.md#feat-05-dynamic-campaign-lorebook-sync) | [`ADR-MP-06 (Restart Flag)`](./MONKEYPATCHES.md#adr-mp-06-window_mhcpendingfreshrestart-cross-tick-launch-semaphore)<br>[`EVT-02 (makeFirst)`](./LISTENERS.md#evt-02-chat_renamed-early-hook-priority-partition-proof-re-arm)<br>[`EVT-03 (Debounce)`](./LISTENERS.md#evt-03-chat_renamed-debounced-campaign-lorebook-sync) | Low (Core ST event ordering contract). |
| **WRK-05** | **Unstarted Chat Premature Sync & LLM Triggering** | 🟡 **MODERATE**: Upstream runs background passes on blank chats. | [`FEAT-04 (Rel Sync)`](./FEATURES.md#feat-04-relationship-narrative-sync)<br>[`FEAT-01 (PbtA Cartridge)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine) | [`unstarted-chat-sync-guard.js`](./unstarted-chat-sync-guard.js)<br>[`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator) | High (Upstream adds `isAdventureActive()` check). |
| **WRK-06** | **Historical CYOA Context Poisoning [RETIRED]** | ⚪ **RETIRED**: Defer to upstream MultiHog's native `stripOldChoicesFromPrompt`. | [`FEAT-03 (CYOA On-Demand Engine)`](./FEATURES.md#feat-03-cyoa-on-demand-choice-engine--instant-auto-repair) | Retired ([`EVT-12`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-retired-formerly-outgoing-cyoa-prompt-sanitizer)) | Retired (Upstream native feature). |
| **WRK-07** | **Truncated Message Stop Button Choice Injection** | 🟡 **MODERATE**: ST emits message rendered on user stop click. | [`FEAT-03 (CYOA Pipeline)`](./FEATURES.md#feat-03-cyoa-fast-single-stage-pipeline-with-safety-net-fallback) | [`EVT-10 (GENERATION_STOPPED)`](./LISTENERS.md#evt-10-generation_stopped-abort-hook-for-background-cyoa)<br>[`DOM-06 (Capture Stop)`](./LISTENERS.md#dom-06) | Low (SillyTavern event design choice). |
| **WRK-08** | **Level-Up & Permadeath Pause Protocol Shield** | 🟡 **MODERATE**: Upstream protocol commands narrative pause without choices. | [`FEAT-03 (CYOA Pipeline)`](./FEATURES.md#feat-03-cyoa-fast-single-stage-pipeline-with-safety-net-fallback) | [`cyoa-safety-net.js`](./cyoa-safety-net.js) (`isLevelUpPending`, `isProtagonistDead`) | Medium (Upstream includes explicit turn pause flag). |

---

## 3. Comprehensive Workaround Specifications

### WRK-01: Synthetic Cartridge Ruleset Injection (Missing Upstream Plugin API)

* **Target Surface:** Upstream MultiHog Rulebook Loader (`pbta-companion-bridge.js`)
* **Associated Feature:** [`FEAT-01 (PbtA Cartridge Engine)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine)
* **Associated Mechanisms:** [`ADR-MP-01 (window.fetch Interception)`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch)

#### The Upstream Defect
Upstream MultiHog hardcodes an HTTP `fetch('.../multihogDnDdoc.md')` to load its core ruleset, moves, and prompts. Upstream provides **no plugin architecture, cartridge interface, or settings option** to supply custom tabletop systems (such as Powered by the Apocalypse, Blades in the Dark, or custom narrative rulesets).

#### Companion Mitigation
Companion intercepts `window.fetch`. When a request matches `multihogDnDdoc.md` and the active chat has an active PbtA cartridge, Companion synthesizes a dynamic markdown document compiling PbtA moves, Harm/Hold mechanics, and system guidance, and returns it inside a synthetic `Response` object.

#### Blast Radius If Removed
PbtA campaigns will revert to standard D&D 5e mechanics: character sheets will demand HP/D&D stats, narrative moves will stop resolving, and dice rolls will expect d20 instead of 2d6.

#### Retirement Criteria
Upstream MultiHog provides an official Cartridge / System Provider API (e.g., `registerRulesetProvider(fn)`).

---

### WRK-02: Character Creator Macro Poisoning & AST Syntax Errors (Upstream Prompt Defect)

* **Target Surface:** Upstream `character-creator.js` (lines 855, 1347, 1475, 1478, 1521)
* **Associated Feature:** QuickStart, Character Creator, [`FEAT-06 (NameRAG)`](./FEATURES.md#feat-06-namerag-diverse-protagonist--npc-generator)
* **Associated Mechanisms:** [`ADR-MP-07 (generateRaw Wrapper)`](./MONKEYPATCHES.md#adr-mp-07-outgoing-prompt-macro-syntax-sanitizer-generateraw-interception), [`DOM-01a / DOM-01b`](./LISTENERS.md#dom-01a)

#### The Upstream Defect
In `character-creator.js`, upstream embeds negative prompt instructions for the LLM:
`- CRITICAL: Never output template macro strings such as {{char}}, {{user}}, or any other {{...}} placeholders. Always replace them with the actual character's name or a fitting proper name.`
When upstream calls `sendStateRequest`, SillyTavern routes the prompt through `generateRaw` $\to$ `createRawPrompt()` $\to$ `substituteParams()`.
1. **MacroEngine Crash / Warning**: SillyTavern's Chevrotain parser treats `{{...}}` as invalid macro syntax, logging `MacroDiagnostics.js:198 [Macro] Warning: Parsing errors detected` on every QuickStart run.
2. **Prompt Corruption**: `substituteParams()` expands `{{char}}` and `{{user}}` into the current character and player names, accidentally instructing the LLM never to output the character's or player's real name!

#### Companion Mitigation
Companion wraps `globalThis.SillyTavern.getContext().generateRaw` (`ADR-MP-07`). Outgoing system and prompt strings are inspected: `{{...}}`, `{{char}}`, and `{{user}}` inside meta-instruction contexts are neutralized with a zero-width space (`{\u200B{`), preventing Chevrotain parser errors and unintended expansion while remaining 100% invisible to the downstream LLM.

#### Blast Radius If Removed
* Console flooded with `MacroDiagnostics.js:198` parsing warnings during QuickStart and Character Creator runs.
* LLMs receive corrupted negative instructions forbidding real protagonist names in generated bios.

#### Retirement Criteria
Upstream MultiHog escapes its instruction literals or SillyTavern provides a `raw: true` prompt bypass.

---

### WRK-03: Stock D&D Settings Pollution & Prompt Bleed (Upstream Shared State Defect)

* **Target Surface:** Upstream Shared Settings (`extensionSettings.rpg_tracker.stockPrompts`)
* **Associated Feature:** [`FEAT-01 (PbtA Cartridge Engine)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine)
* **Associated Mechanisms:** [`ADR-MP-05 (stockPrompts Mutation)`](./MONKEYPATCHES.md#adr-mp-05-in-memory-upstream-settings-cleansing-stockprompts-mutation), [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator), [`DOM-01a / DOM-01b`](./LISTENERS.md#dom-01a)

#### The Upstream Defect
Upstream MultiHog stores all system prompts in a single shared object: `extensionSettings.rpg_tracker.stockPrompts`. When running a PbtA campaign, Companion writes PbtA system prompts into this object. When the user later switches to a standard D&D 5e chat or opens the QuickStart drawer, stale PbtA instructions remain in `stockPrompts` and contaminate D&D gameplay and character creation.

#### Companion Mitigation
Companion executes deterministic preflight cleansing:
1. `EVT-04` (`runChatChangedCoordinator`) sanitizes `stockPrompts` on chat switch.
2. `DOM-01a` and `DOM-01b` intercept QuickStart and Character Creator buttons to purge stale PbtA prompts before character generation commences.

#### Blast Radius If Removed
Standard D&D campaigns will intermittently receive PbtA move directives, causing narrator hallucinations, broken character creation, and stat mismatches.

#### Retirement Criteria
Upstream MultiHog scopes its `stockPrompts` per chat partition rather than globally.

---

### WRK-04: Chat Rename Inversion & Partition Reset Race (SillyTavern / Upstream Race Condition)

* **Target Surface:** SillyTavern Chat Switch vs Upstream Partition Migration (`script.js:renameChat`)
* **Associated Feature:** [`FEAT-05 (Dynamic Lorebook Sync)`](./FEATURES.md#feat-05-dynamic-campaign-lorebook-sync)
* **Associated Mechanisms:** [`ADR-MP-06 (_mhcPendingFreshRestart Flag)`](./MONKEYPATCHES.md#adr-mp-06-window_mhcpendingfreshrestart-cross-tick-launch-semaphore), [`EVT-02 (makeFirst Priority)`](./LISTENERS.md#evt-02-chat_renamed-early-hook-priority-partition-proof-re-arm), [`EVT-03 (150ms Settlement Window)`](./LISTENERS.md#evt-03-chat_renamed-debounced-campaign-lorebook-sync)

#### The Upstream Defect
In SillyTavern's `renameChat()` (`script.js`), it executes `await reloadCurrentChat()` *before* emitting `CHAT_RENAMED`. This means `CHAT_CHANGED` fires *first*, momentarily presenting an unmigrated partition to upstream MultiHog. Upstream risks seeing an unfamiliar key and initializing a blank partition, wiping campaign state.

#### Companion Mitigation
1. `adventure-chat.js` hooks `CHAT_RENAMED` using `eventSource.makeFirst` (`EVT-02`) at T+0ms to re-arm the partition proof (`runtimeState.pendingUnseenChatReset = { oldId, newId }`) *before* upstream's listener runs.
2. `index.js` listens to `CHAT_RENAMED` via standard FIFO (`EVT-03`) with a 150ms debounce, allowing upstream file writes to settle before scanning and cloning lorebooks.

#### Blast Radius If Removed
Renaming an adventure chat will intermittently wipe the campaign partition or cause Lorebook Sync to clone against a half-written partition file on disk.

#### Retirement Criteria
SillyTavern emits `CHAT_RENAMED` *before* reloading the chat DOM, or exposes an atomic chat rename lifecycle hook.

---

### WRK-05: Unstarted Chat Premature Sync & LLM Triggering (Upstream Premature Activation Defect)

* **Target Surface:** MultiHog Background Workers on New Chats (`unstarted-chat-sync-guard.js`)
* **Associated Feature:** [`FEAT-04 (Relationship Sync)`](./FEATURES.md#feat-04-relationship-narrative-sync), [`FEAT-01 (PbtA Cartridge Engine)`](./FEATURES.md#feat-01-pbta-ruleset-cartridge-engine)
* **Associated Mechanisms:** [`unstarted-chat-sync-guard.js`](./unstarted-chat-sync-guard.js), [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator)

#### The Upstream Defect
When a user opens a brand new, empty chat before generating Turn 1, background listeners and auto-sync systems in MultiHog and extensions attempt to evaluate party rosters, relationship meters, and auto-apply prompts against an empty message array. This triggers unnecessary LLM calls and writes default state into unstarted sessions.

#### Companion Mitigation
Companion provides `unstarted-chat-sync-guard.js` with `isChatClean()` and `isAdventureActive()` guards. Relationship scans, PbtA setup assertions, and background LLM passes are strictly suppressed until the user has sent their first turn.

#### Blast Radius If Removed
Switching to an empty chat triggers ghost LLM requests, consumes user token budget, and generates unrequested relationship metadata before the story begins.

#### Retirement Criteria
Upstream MultiHog explicitly checks `isAdventureActive()` before triggering background passes.

---

### WRK-06: Historical CYOA Context Poisoning (Host LLM Hallucination Trap) [RETIRED]

* **Target Surface:** SillyTavern Chat History Context Window
* **Status:** 🔴 **RETIRED**.
* **Associated Feature:** [`FEAT-03 (CYOA On-Demand Choice Engine & Instant Auto-Repair)`](./FEATURES.md#feat-03-cyoa-on-demand-choice-engine--instant-auto-repair)
* **Associated Mechanisms:** Retired ([`EVT-12`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-retired-formerly-outgoing-cyoa-prompt-sanitizer), formerly part of `ADR-MP-03`).

#### Upstream Resolution & Retirement
Upstream MultiHog provides built-in context pruning via `cyoaConfig.stripOldChoicesFromPrompt` ([`cyoa-prompt-history.js`](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/SillyTavern-MultihogDnDFramework/src/features/cyoa-prompt-history.js)). Furthermore, MultiHog Companion's CYOA subsystem transitioned to a purely on-demand architecture (Wand Menu `DOM-07` and slash commands `/cyoafix` / `/cyoagen`), eliminating automated background multi-stage pipelines. 

Companion retired its runtime regex prompt-stripping interceptors to:
1. Defer to upstream MultiHog's native handling of CYOA prompt history.
2. Eliminate fragile regular expressions matching conversational prose (`What do you do?`) that risked mutilating legitimate story narrative and dialogue.
3. Keep Companion strictly adhering to the architectural principle of **only making necessary changes to the host framework**.

---

### WRK-07: Truncated Message Stop Button Choice Injection (Host Post-Stop Event Hazard)

* **Target Surface:** SillyTavern Post-Stop Event Bus (`script.js:stopGeneration`)
* **Associated Feature:** [`FEAT-03 (CYOA Fast Single-Stage Pipeline)`](./FEATURES.md#feat-03-cyoa-fast-single-stage-pipeline-with-safety-net-fallback)
* **Associated Mechanisms:** [`EVT-10 (GENERATION_STOPPED)`](./LISTENERS.md#evt-10-generation_stopped-abort-hook-for-background-cyoa), [`DOM-06 (Capture Phase Stop Listener)`](./LISTENERS.md#dom-06)

#### The Host Event Hazard
When a user clicks Stop mid-turn, SillyTavern halts streaming and commits the truncated partial message to the chat DOM. **Crucially, SillyTavern then proceeds to emit `CHARACTER_MESSAGE_RENDERED` and `GENERATION_ENDED` for that partial message!** Downstream choice generators interpret the absence of choices as a failure and fire an unwanted LLM call to append buttons to an aborted, incomplete sentence.

#### Companion Mitigation
1. `EVT-10` (`GENERATION_STOPPED`) sets `_wasGenerationStopped = true` at T+0ms and aborts background quiet prompts.
2. `DOM-06` uses native capture-phase event listening on `.mes_stop` to instantly sever in-flight CYOA controllers before upstream's click handlers run.
3. The CYOA coordinator checks `_wasGenerationStopped` and drops choice processing on stopped turns.

#### Blast Radius If Removed
Clicking Stop aborts the narrator streaming text, but seconds later a background choice generator completes and injects interactive buttons onto an abandoned, half-formed sentence.

#### Retirement Criteria
SillyTavern suppresses post-generation message events when generation is terminated via `stopGeneration()`.

---

### WRK-08: Level-Up & Permadeath Pause Protocol Shield

* **Target Surface:** Upstream `<level_up_protocol>` (`constants.js#L515`) and Deceased Character States
* **Associated Feature:** [`FEAT-03 (CYOA Fast Single-Stage Pipeline)`](./FEATURES.md#feat-03-cyoa-fast-single-stage-pipeline-with-safety-net-fallback)
* **Associated Mechanisms:** [`cyoa-safety-net.js`](./cyoa-safety-net.js) (`isLevelUpPending`, `isProtagonistDead`)

#### The Upstream Defect / Protocol Collision
Upstream MultiHog's `<level_up_protocol>` commands the narrator to immediately halt story progression when an XP milestone is crossed mid-output:
1. *"Finish the current sentence only — do not continue the narrative."*
2. *"Insert: `--- \n ⬆ LEVEL UP — Now Level [X]... → Awaiting your choice before the story continues. \n ---`"*
3. *"Output nothing after this block; pause until the player responds."*
4. *"Never auto-resolve or narrate past a pending level-up."*

Because the narrator obeys protocol and outputs zero `<choices>` markup, Companion's CYOA Safety Net (`FEAT-03`) erroneously misinterprets the turn as a failed generation. It automatically invokes Stage 2 fallback and appends standard story actions (e.g. `<button>⚔️ Press on into the crypt</button>`), tempting players to click a story action and narrate past the pending level-up without applying stat/feat advancements. A similar collision occurs when a character suffers permanent death (`Status: Dead`), where the safety net generates death saving throw choices for an already deceased character.

#### Companion Mitigation
`coordinateCyoaForMessage` inspects message prose and state memo before evaluating choice generation:
1. **Level-Up Guard (`isLevelUpPending`)**: Detects `⬆ LEVEL UP`, `Awaiting your choice before the story continues`, or PbtA `Level Up! Choose an Advance:`. If detected, CYOA generation is safely paused, returning `false` with zero LLM overhead.
2. **Permadeath Guard (`isProtagonistDead`)**: Scans `[CHARACTER]` for `Status: Dead/Deceased/Slain/Killed`. If true, button generation is completely suppressed, preserving the final ending narrative.

#### Blast Radius If Removed
* Level-up screens receive unwanted narrative buttons, prompting players to skip level advancements and corrupting character stat progression.
* Deceased characters receive survival or combat buttons on final death scenes.

#### Retirement Criteria
Upstream MultiHog or SillyTavern provides explicit turn pause metadata in `chat[idx]` indicating that a message is awaiting structured system input rather than story choices.

