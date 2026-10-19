# MultiHog Companion — Monkey Patch Architecture Decision Records (ADRs)

> **Purpose:** Document every runtime monkey patch, API hijack, DOM interception, and state mutation executed against upstream MultiHog or SillyTavern.
> Because monkey patches are fragile workarounds necessitated by missing extension APIs, this document explains **why each patch exists, how it works, what breaks if it is removed (blast radius), and how it can eventually be retired**.

---

## 1. Monkey Patch Classification Matrix

| ADR ID | Target / Mechanism | Host Surface | Location | Fragility Rating |
| :--- | :--- | :--- | :--- | :--- |
| **ADR-MP-01** | `window.fetch` Interception | Network API | `pbta-companion-bridge.js:165` | 🔴 **HIGH**: Global network interceptor. |
| **ADR-MP-02** | `/imagine` Slash Command Callback Wrapping | Command Parser | `index.js:1070` | 🟡 **MODERATE**: Wrapped object property. |
| **ADR-MP-03** | SillyTavern `generate_interceptor` | LLM Prompt Pipeline | `index.js:1854` | 🟢 **LOW**: Official SillyTavern manifest hook. |
| **ADR-MP-04** | DOM `stopImmediatePropagation` Hijacking | UI Event Bus | `namerag-hooks.js:426` | 🔴 **HIGH**: Silently suppresses upstream listeners. |
| **ADR-MP-05** | In-Memory `stockPrompts` Mutation | Upstream Settings Object | `character-creator-sanitizer.js:25` | 🟡 **MODERATE**: In-place settings rewriting. |
| **ADR-MP-06** | `window._mhcPendingFreshRestart` Global Flag | Window Global State | `adventure-chat.js:391` | 🟡 **MODERATE**: Cross-tick global semaphore. |

---

## 2. Architectural Decision Records (ADRs)

### ADR-MP-01: Synthetic PbtA Ruleset Injection via `window.fetch`

* **Status:** Active / Fragile
* **Location:** [`pbta-companion-bridge.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-companion-bridge.js#L165-L208) (`installCompanionDocBridge`)
* **Patch Type:** Global Runtime API Overwrite (`window.fetch = interceptedFetch`)

#### Context & Justification
Upstream MultiHog hardcodes an HTTP `fetch('.../multihogDnDdoc.md')` to load its core D&D 5e rulebook and system prompt. Upstream provides **no plugin architecture, cartridge interface, or settings option** to supply custom tabletop systems (such as Powered by the Apocalypse, Blades in the Dark, or custom narrative rulesets). 
To make MultiHog support PbtA without touching upstream files (which is strictly forbidden), Companion must intercept the network request and serve the active PbtA ruleset in place of `multihogDnDdoc.md`.

#### Mechanism
1. Preserves `_originalFetch = window.fetch`.
2. Replaces `window.fetch` with `interceptedFetch`.
3. Marks the function with `__mhcDocBridgeInstalled = true` to prevent double-wrapping.
4. When `input` contains `multihogDnDdoc.md`:
   - Checks if PbtA is currently active for the chat.
   - If active, compiles the PbtA cartridge (stats, moves, harm tracks, principles, agendas) into markdown text.
   - Returns a synthetic `new Response(pbtaDocText, { status: 200, headers: { 'Content-Type': 'text/markdown' } })`.
5. If PbtA is inactive or URL is anything else:
   - Forwards transparently: `return _originalFetch.apply(this, arguments);`.

#### Blast Radius (What Breaks If Removed)
* MultiHog will always load the stock D&D 5e rulebook.
* PbtA moves, harm levels, and 2d6 resolution instructions will **never** be injected into the system prompt.
* PbtA campaigns will behave as standard D&D 5e games with broken mechanics.

#### Fragility & Code Smell Analysis
* If another SillyTavern extension also overwrites `window.fetch` without chaining, one extension will clobber the other.
* If upstream MultiHog renames `multihogDnDdoc.md` to anything else (e.g. `system_prompt.md`), the regex match will silently fail and stock behavior will return.

#### Retirement Criteria
Upstream MultiHog implements an official hook (e.g., `setRulesetProvider(() => rulesetMarkdown)` or a configurable system prompt document path).

---

### ADR-MP-02: Slash Command Callback Wrapping (`/imagine`)

* **Status:** Active
* **Location:** [`index.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js#L1059-L1105) (`setupImagineInterceptor`)
* **Patch Type:** Object Method Hijack (`imagineCmd.callback = wrapper`)

#### Context & Justification
SillyTavern's built-in `/imagine` slash command generates images using fixed default dimensions (typically 1:1 square). In RPG campaigns, scene backgrounds require wide landscape ratios (e.g. 16:9 or 832×480), whereas NPC portraits require vertical portrait ratios (e.g. 9:16 or 480×832). 
SillyTavern provides no dynamic aspect ratio callback for `/imagine`.

#### Mechanism
1. On `APP_READY`, resolves `SlashCommandParser.commands['imagine']`.
2. Preserves `originalCallback = imagineCmd.callback`.
3. Wraps `imagineCmd.callback`:
   - Inspects the command args and prompt text.
   - If Companion's Aspect Ratio Bridge is enabled and the user did not supply explicit `--width`/`--height` parameters:
     - Detects whether the generation is a character portrait or a scene background.
     - Appends the configured resolution arguments to the command argument string.
   - Delegates to `originalCallback.call(this, modifiedArgs, modifiedValue)`.

#### Blast Radius (What Breaks If Removed)
* The Smart Aspect-Ratio & Crop Bridge will stop working; all `/imagine` generations will revert to SillyTavern's global default resolution.

#### Fragility & Code Smell Analysis
* Safe and well-contained, but relies on `SlashCommandParser.commands['imagine']` internal structure remaining unchanged.

#### Retirement Criteria
SillyTavern adds native support for contextual resolution hooks in slash commands or image generation presets.

---

### ADR-MP-03: SillyTavern Pipeline Generation Interceptor (`generate_interceptor`)

* **Status:** Active / Clean
* **Location:** [`index.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/index.js#L1796-L1855) (`mhcGenerationInterceptor`)
* **Patch Type:** SillyTavern Pipeline Hook (Registered via `manifest.json` and `globalThis`)

#### Context & Justification
Upstream MultiHog uses a `generate_interceptor` to inject its RPG state prompt before generation. Companion requires a secondary pass to:
1. Strip stale CYOA button markdown and conversational "What do you do?" lists from older chat turns so the LLM context remains clean.
2. In Safety Net mode (recommended), preserve the active turn's `<CYOA_mode>` block so the narrator generates single-stage choices directly without extra latency.
3. In Two-Stage mode, strip `<CYOA_mode>` across all turns to enforce dedicated choice generation.

#### Mechanism
1. Registered in `manifest.json`: `"generate_interceptor": "mhcGenerationInterceptor"`.
2. Exported to `globalThis.mhcGenerationInterceptor`.
3. SillyTavern calls this function with the outgoing `chat` array before prompt compilation.
4. Executes `stripCyoaFromOutgoingChat(chat, { stripActiveCyoa })` according to `cyoaMode` and passes the sanitized chat to the generator.

#### Blast Radius (What Breaks If Removed)
* Stale CYOA markdown buttons (`[1] Attack [2] Flee`) and previous "What do you do?" lists remain in chat history context sent to the LLM, causing the LLM to hallucinate synthetic button syntax or repeat conversational questions in prose.
* Dynamic CYOA steering instructions are not delivered to the narrator model.

#### Fragility & Code Smell Analysis
* Uses SillyTavern's official extension contract. Very low fragility.

#### Retirement Criteria
Upstream MultiHog's CYOA subsystem natively strips past choices from outgoing prompt context.

---

### ADR-MP-04: Upstream DOM Event Hijacking via `stopImmediatePropagation` (NameRAG)

* **Status:** Active / Hardened (Phase 2)
* **Location:** [`namerag-hooks.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/namerag-hooks.js#L440-L545) (`setupMultiHogRollHooks`)
* **Patch Type:** DOM Event Suppression & Replacement via jQuery Delegation

#### Context & Justification
Upstream MultiHog includes roll buttons in its Character Creator (`#rt-cr-random-name`), Quick Start modal (`#rt-quickstart-roll-name`), and Onboarding drawer (`#rt-ob-roll-name`). These buttons roll names from a hardcoded, static fantasy name array. 
The user wanted dynamic, genre-aware names generated via the local NameRAG service (PbtA, Cyberpunk, Sci-Fi, Gothic, etc.). Upstream provides no callback to register custom name generators.

#### Mechanism
1. Binds delegated jQuery listeners to `$(document)` on `click.mhc_namerag_qs`, `click.mhc_namerag_cr`, and `click.mhc_namerag_ob`.
2. When a button is clicked and NameRAG is enabled in Companion settings:
   - Calls `e.stopImmediatePropagation()` and `e.preventDefault()`.
   - Disables the button and renders a spinner (`<i class="fa-solid fa-spinner fa-spin"></i>`).
   - Queries NameRAG API with the active genre wrapped in a 4-second timeout promise (`timeoutMs: 4000`).
   - If NameRAG succeeds: populates the candidate name into the input field and triggers `input`.
   - If NameRAG times out, is offline, or returns empty: gracefully invokes the local offline genre name generator, populates the input, and displays a non-intrusive warning toast: *"NameRAG service unavailable; rolled standard name"*.
   - In the `finally` block: always restores the button's original HTML and re-enables it.
3. If NameRAG is disabled:
   - Returns early without stopping propagation, allowing MultiHog's native click listener to handle the click.

#### Blast Radius (What Breaks If Removed)
* Rolling names in MultiHog's QuickStart or Character Creator will use stock D&D names rather than NameRAG genre-specific names.

#### Fragility & Hardening Status
* 🟢 **Hardened in Phase 2:** Previously, if NameRAG hung or threw an unhandled exception, the button froze in a disabled state. Now, with strict 4s timeouts, offline fallbacks, and user warning toasts, the UI cannot be permanently trapped even if the local NameRAG service crashes.
* Relies on specific DOM IDs (`#rt-quickstart-roll-name`, `#rt-cr-name`, etc.). If upstream renames elements, the hijack silently falls back to stock behavior.

#### Retirement Criteria
Upstream MultiHog provides a pluggable name generator interface (e.g., `registerNameRollProvider(fn)`).

---

### ADR-MP-05: In-Memory Upstream Settings Cleansing (`stockPrompts` Mutation)

* **Status:** Active / Moderate Risk
* **Location:** [`character-creator-sanitizer.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/character-creator-sanitizer.js#L20-L50) & [`pbta-ruleset-persistence.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js)
* **Patch Type:** Direct Upstream Settings Object Mutation

#### Context & Justification
Upstream MultiHog stores its system prompts in a single shared object: `extensionSettings.rpg_tracker.stockPrompts`. 
When playing a PbtA campaign, Companion writes PbtA system prompts into this object. If the user later switches to a standard D&D 5e chat or opens the Character Creator to make a D&D character, the stale PbtA instructions remain in `stockPrompts` and contaminate D&D gameplay and character creation.

#### Mechanism
1. Companion intercepts `#rt-quickstart-begin, #rt-cr-generate-btn` clicks and monitors `CHAT_CHANGED`.
2. Inspects `s.stockPrompts` for PbtA markers (e.g. `Harm:`, `PbtA Core Principles`, `Moves:`).
3. If active chat is NOT PbtA, Companion directly mutates `stockPrompts`, stripping PbtA directives and restoring stock D&D 5e templates.

#### Blast Radius (What Breaks If Removed)
* Switching from a PbtA campaign to a D&D campaign causes the D&D campaign to inherit PbtA mechanics (2d6 rolls, Harm tracks, PbtA move prompts), corrupting character sheets and gameplay.

#### Fragility & Code Smell Analysis
* Directly mutates upstream's in-memory settings object instead of upstream maintaining per-ruleset partition templates.

#### Retirement Criteria
Upstream MultiHog scopes `stockPrompts` per campaign partition rather than using a single shared global object.

---

### ADR-MP-06: Cross-Tick Campaign Restart Coordination Flag

* **Status:** Active
* **Location:** [`adventure-chat.js`](file:///home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/adventure-chat.js#L391) (`window._mhcPendingFreshRestart`)
* **Patch Type:** Global Window Semaphore

#### Context & Justification
When launching a new campaign from the Concierge Builder, SillyTavern creates a fresh chat, renames it, and triggers chat reload. Upstream MultiHog interprets the intermediate reload as an unstarted, dirty chat and schedules a partition wipe. 
Companion needs a cross-tick signaling mechanism to inform upstream listeners that the incoming chat rename is an intentional campaign launch.

#### Mechanism
1. When starting an adventure chat, Companion sets:
   ```javascript
   window._mhcPendingFreshRestart = { oldId, newId, targetName };
   ```
2. The early `CHAT_RENAMED` listener (registered with `eventSource.makeFirst`) inspects `window._mhcPendingFreshRestart`.
3. If matched, it claims the rename, migrates the campaign dossier, and clears the global flag.
4. Includes a timeout/unmount fail-safe that clears the flag if the rename does not occur within 10 seconds.

#### Blast Radius (What Breaks If Removed)
* Fresh campaign launches will have their dossiers wiped during chat creation, resulting in empty character sheets and lost campaign lore.

#### Fragility & Code Smell Analysis
* Using `window._mhcPendingFreshRestart` as a global variable risks stale state if an unhandled error aborts the launch sequence.

#### Retirement Criteria
SillyTavern introduces an atomic Chat Fork & Launch API that does not fire disjointed `CHAT_DELETED` and `CHAT_CHANGED` events during setup.

---

## 3. Impact & Dependency Matrix

The following matrix illustrates how each monkey patch connects to events and features in `MultiHogCompanion`:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MONKEY PATCH DEPENDENCIES                       │
└────────────────────────────────────────────────────────────────────────┘

  [ADR-MP-01: window.fetch] ──► Intercepts multihogDnDdoc.md
                                 └─► Feeds compiled PbtA rules to MultiHog

  [ADR-MP-02: /imagine]     ──► Wraps SlashCommandParser
                                 └─► Intercepts image dimension flags

  [ADR-MP-03: gen_intercep] ──► Registered via manifest.json
                                 └─► Strips CYOA prompt noise before LLM

  [ADR-MP-04: NameRAG DOM]  ──► Hijacks #rt-quickstart-roll-name
                                 └─► Prevents native roll; queries NameRAG

  [ADR-MP-05: stockPrompts] ──► Purges PbtA markers on CHAT_CHANGED
                                 └─► Prevents cross-campaign ruleset bleed

  [ADR-MP-06: Restart Flag] ──► Coordinates window._mhcPendingFreshRestart
                                 └─► Prevents partition wipe on adventure launch
```
