# MultiHog Companion — Feature Catalog (`FEATURES.md`)

> **Purpose:** Comprehensive functional catalog of all additive capabilities and enhancements introduced by MultiHog Companion.
> While [`WORKAROUNDS.md`](./WORKAROUNDS.md) documents fixes for upstream framework bugs, this document records the **user-facing systems, game engines, and quality-of-life tools** that Companion brings to SillyTavern.

---

## 1. Feature Architecture & The 4-Way Reference Web

MultiHog Companion separates **Intent** from **Mechanism** across four synchronized catalogs:

```
┌─────────────────────────────────┬─────────────────────────────────┐
│       WHAT ARE WE DOING?        │       HOW IS IT WIRED?          │
│            (Intent)             │          (Mechanism)            │
├─────────────────────────────────┼─────────────────────────────────┤
│ FEATURES.md (This File)         │ LISTENERS.md                    │
│ • User-facing capabilities      │ • Event Bus (eventSource.on)    │
│ • Ruleset engine (PbtA)         │ • DOM Delegation ($(doc).on)    │
│ • Concierge Session Zero        │ • Debounce & Settlement Timers  │
│ • Relationship Narrative Sync   │ • Coordinator Pipelines         │
├─────────────────────────────────┼─────────────────────────────────┤
│ WORKAROUNDS.md                  │ MONKEYPATCHES.md                │
│ • Upstream defects & hazards    │ • ADRs for runtime hijacking    │
│ • Why upstream is broken/risky  │ • window.fetch interception     │
│ • Blast radius if unmitigated   │ • generateRaw API wrapping      │
│ • Upstream retirement criteria  │ • In-memory settings rewriting  │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## 2. Feature Classification Matrix

| Feature ID | Feature Name | Primary Source Files | Associated Workarounds | Associated Listeners | Associated Monkey Patches |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FEAT-01** | **PbtA Ruleset Cartridge Engine** | [`pbta-ruleset.js`](./pbta-ruleset.js)<br>[`pbta-ruleset-persistence.js`](./pbta-ruleset-persistence.js)<br>[`pbta-companion-bridge.js`](./pbta-companion-bridge.js) | [`WRK-01`](./WORKAROUNDS.md#wrk-01-synthetic-cartridge-ruleset-injection-missing-upstream-plugin-api)<br>[`WRK-03`](./WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled)<br>[`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b)<br>[`EVT-08`](./LISTENERS.md#evt-08-settings_updated-ruleset--state-sync-coordinator) | [`ADR-MP-01`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch)<br>[`ADR-MP-03`](./MONKEYPATCHES.md#adr-mp-03-sillytavern-pipeline-generation-interceptor-generate_interceptor--pbta-2d6-rng-injection)<br>[`ADR-MP-05`](./MONKEYPATCHES.md#adr-mp-05-in-memory-upstream-settings-cleansing-stockprompts-mutation) |
| **FEAT-02** | **Concierge Session Zero & Living World Dossier** | [`concierge-runner.js`](./concierge-runner.js)<br>[`concierge-ui.js`](./concierge-ui.js)<br>[`concierge-parser.js`](./concierge-parser.js)<br>[`concierge-prompt.js`](./concierge-prompt.js) | [`WRK-03`](./WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled) | None (Pure Additive API) |
| **FEAT-03** | **CYOA On-Demand Choice Engine & Instant Auto-Repair** | [`cyoa-generator.js`](./cyoa-generator.js)<br>[`cyoa-safety-net.js`](./cyoa-safety-net.js) | [`WRK-06 (Retired)`](./WORKAROUNDS.md#wrk-06-historical-cyoa-context-poisoning-host-llm-hallucination-trap-retired)<br>[`WRK-07`](./WORKAROUNDS.md#wrk-07-truncated-message-stop-button-choice-injection-host-post-stop-event-hazard)<br>[`WRK-08`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-pause-protocol-shield) | [`EVT-05`](./LISTENERS.md#evt-05-chat_changed-cyoa-state-reset--phase-1-immediate)<br>[`EVT-09`](./LISTENERS.md#evt-09-generation_started-cyoa-foreground-generation-guard)<br>[`EVT-10`](./LISTENERS.md#evt-10-generation_stopped-cyoa-stop-guard--aborted-message-shield)<br>[`EVT-11 (Retired)`](./LISTENERS.md#evt-11-generation_ended-retired-formerly-cyoa-fallback-completion-trigger)<br>[`EVT-12 (Retired)`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-retired-formerly-outgoing-cyoa-prompt-sanitizer)<br>[`DOM-06`](./LISTENERS.md#dom-06)<br>[`DOM-07`](./LISTENERS.md#dom-07) | None (Pure ST Slash & DOM API) |
| **FEAT-04** | **Relationship Narrative Sync** | [`relationship-narrative-sync.js`](./relationship-narrative-sync.js) | [`WRK-05`](./WORKAROUNDS.md#wrk-05-unstarted-chat-premature-sync--llm-triggering-upstream-premature-activation-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled)<br>[`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b) | None (Uses ST Lorebook & Chat API) |
| **FEAT-05** | **Dynamic Campaign Lorebook Sync** | [`campaign-lore-sync.js`](./campaign-lore-sync.js) | [`WRK-04`](./WORKAROUNDS.md#wrk-04-chat-rename-inversion--partition-reset-race-sillytavern--upstream-race-condition) | [`EVT-02`](./LISTENERS.md#evt-02-chat_renamed-adventure-rename-guard)<br>[`EVT-03`](./LISTENERS.md#evt-03-chat_renamed-lorebook-auto-sync) | None (Pure ST World Info API) |
| **FEAT-06** | **NameRAG Diverse Protagonist & NPC Generator** | [`namerag-hooks.js`](./namerag-hooks.js) | [`WRK-02`](./WORKAROUNDS.md#wrk-02-character-creator-macro-poisoning--ast-syntax-errors-upstream-prompt-defect) | [`DOM-02`](./LISTENERS.md#dom-02)<br>[`DOM-03`](./LISTENERS.md#dom-03)<br>[`DOM-04`](./LISTENERS.md#dom-04)<br>[`DOM-05`](./LISTENERS.md#dom-05) | [`ADR-MP-04`](./MONKEYPATCHES.md#adr-mp-04-upstream-dom-event-hijacking-via-stopimmediatepropagation-namerag) |
| **FEAT-07** | **Media, Persona & Portrait Sync Bridge** | [`index.js`](./index.js) (`setupImagineInterceptor`, `runSync`, `uploadImageToPersona`)<br>[`persona-matching.js`](./persona-matching.js) | [`WRK-05`](./WORKAROUNDS.md#wrk-05-unstarted-chat-premature-sync--llm-triggering-upstream-premature-activation-defect) | [`EVT-01`](./LISTENERS.md#evt-01-app_ready)<br>[`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled)<br>[`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b)<br>[`EVT-08`](./LISTENERS.md#evt-08-settings_updated-ruleset--state-sync-coordinator) | [`ADR-MP-02`](./MONKEYPATCHES.md#adr-mp-02-slash-command-callback-wrapping-imagine) |
| **FEAT-08** | **Partition History Integrity Guard** | [`history-integrity-guard.js`](./history-integrity-guard.js) | None | Slash Command `/mhc-history-check` | None (Direct File / Storage Inspection) |
| **FEAT-09** | **D&D 5e & PbtA Unified Subfooter Alignment Engine** | [`dnd-fixes.js`](./dnd-fixes.js)<br>[`pbta-ruleset.js`](./pbta-ruleset.js) | None | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled) | None (Pure MultiHog Settings API) |
| **FEAT-10** | **Autonomous Level-Up Concierge & Class Progression Codex** | [`level-up-runner.js`](./level-up-runner.js)<br>[`level-up-ui.js`](./level-up-ui.js)<br>[`level-up-blueprint.js`](./level-up-blueprint.js)<br>[`level-up-scaffold.js`](./level-up-scaffold.js) | [`WRK-08`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-pause-protocol-shield) | [`DOM-08`](./LISTENERS.md#dom-08)<br>[`DOM-09`](./LISTENERS.md#dom-09) | None (Pure MultiHog Settings & State Memo API) |

---

## 3. Detailed Feature Specifications

### FEAT-01: PbtA Ruleset Cartridge Engine
* **Overview:** Enables table-top roleplaying systems beyond D&D 5e inside the MultiHog framework, specifically Powered by the Apocalypse (PbtA), Blades in the Dark, and custom narrative cartridges.
* **Core Capabilities:**
  * **Dynamic Move Engine:** Evaluates narrative triggers, 2d6 dice formulas, stat modifiers, and hierarchical move tiers (Basic, Peripheral, Battle, Playbook).
  * **Harm & Hold State Tracking:** Replaces D&D HP/Spell slots with customizable Harm tracks (e.g., 0–6 clock or Segmented Harm) and Hold/Token pools.
  * **Cartridge Serialization:** Compiles moves, stats, system guidance, and prompt modules into a unified JSON cartridge that hot-replaces MultiHog's hardcoded D&D reference.
* **Associated Workarounds:**
  * [`WRK-01 (Synthetic Cartridge Injection)`](./WORKAROUNDS.md#wrk-01-synthetic-cartridge-ruleset-injection-missing-upstream-plugin-api) — Intercepts `window.fetch` to inject compiled PbtA rules.
  * [`WRK-03 (Stock D&D Settings Pollution)`](./WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect) — Cleanses stale PbtA prompts when returning to standard D&D chats.
* **Associated Mechanisms:** [`ADR-MP-01`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch), [`ADR-MP-03`](./MONKEYPATCHES.md#adr-mp-03-sillytavern-pipeline-generation-interceptor-generate_interceptor--pbta-2d6-rng-injection), [`ADR-MP-05`](./MONKEYPATCHES.md#adr-mp-05-in-memory-upstream-settings-cleansing-stockprompts-mutation), [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled), [`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b), [`EVT-08`](./LISTENERS.md#evt-08-settings_updated-ruleset--state-sync-coordinator).

---

### FEAT-02: Concierge Session Zero & Living World Dossier
* **Overview:** An interactive AI co-designer that builds, critiques, and evolves living campaign dossiers, factions, locations, NPCs, and quest arcs before or during gameplay.
* **Core Capabilities:**
  * **Contemplative Dossier Builder:** Multi-stage generation utilizing explicit `[CONTEMPLATION]` scratchpads before outputting structured `[UPDATE_DOSSIER]` directives.
  * **Smart-Gated Critic & Judge:** Heuristic gate evaluates mutation scale and routes complex world updates through an adversarial Critic & Refiner pass.
  * **Talker Instruction Notices:** Injects anti-hallucination guardrails and structured state notices into the Concierge interactive conversation drawer.
  * **Diagnostic Inspector:** Real-time visual debugger (`/mhc-history-check`, inspect trace) providing transparent audit logs of every dossier transformation.
* **Associated Mechanisms:** Pure additive API integrated into the MultiHog Companion drawer.

---

### FEAT-03: CYOA On-Demand Choice Engine & Instant Auto-Repair
* **Overview:** Delivers Choose-Your-Own-Adventure (CYOA) interactive buttons and instant choice auto-repair via on-demand user controls (Wand Menu and Slash Commands), eliminating background listener collisions with tool calls and reasoning models.
* **Core Capabilities:**
  * **Deterministic Markdown Auto-Repair:** Local synchronous regex parser extracts numbered markdown option lists (`What do you do? 1. Attack 2. Flee`) and auto-repairs them into native interactive buttons with zero LLM latency and zero tokens.
  * **Wand Menu Interactive Trigger (Fix / Reroll):** Dedicated wand action (`#mhc_wand_cyoa_fix_reroll`) enabling on-demand 1-click choice repair or generation directly on the latest settled narrator message, failing safely if invoked during intermediary toolcall turns.
  * **On-Demand Choice Generator:** When invoked manually via wand or slash commands (`/cyoafix`, `/cyoagen`, `/cyoaretry`), formulates fresh, context-tailored tactical action buttons without altering the story narrative.
  * **Historical Context Sanitizer:** Retired in favor of native upstream MultiHog choice pruning (`cyoaConfig.stripOldChoicesFromPrompt`).
* **Associated Workarounds:**
  * [`WRK-06 (Historical Choice Context Poisoning — Retired)`](./WORKAROUNDS.md#wrk-06-historical-cyoa-context-poisoning-host-llm-hallucination-trap-retired) — Defer to upstream native pruning.
  * [`WRK-07 (Truncated Message Stop Button Leak)`](./WORKAROUNDS.md#wrk-07-truncated-message-stop-button-choice-injection-host-post-stop-event-hazard) — Aborts generation when user clicks Stop.
  * [`WRK-08 (Level-Up & Permadeath Narrative Pause Collision)`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-pause-protocol-shield) — Suppresses CYOA choice generation on pending character milestone or hard protocol pause turns.
* **Associated Mechanisms:** [`EVT-05`](./LISTENERS.md#evt-05-chat_changed-cyoa-state-reset--phase-1-immediate), [`EVT-09`](./LISTENERS.md#evt-09-generation_started-cyoa-foreground-generation-guard), [`EVT-10`](./LISTENERS.md#evt-10-generation_stopped-cyoa-stop-guard--aborted-message-shield), [`EVT-11 (Retired)`](./LISTENERS.md#evt-11-generation_ended-retired-formerly-cyoa-fallback-completion-trigger), [`EVT-12 (Retired)`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-retired-formerly-outgoing-cyoa-prompt-sanitizer), [`DOM-06`](./LISTENERS.md#dom-06), [`DOM-07`](./LISTENERS.md#dom-07).

---

### FEAT-04: Relationship Narrative Sync
* **Overview:** Bridges narrative roleplay prose with MultiHog's numerical NPC relationship gauges (-150 to +150 Friendship & Affection across 13 distinct tiers).
* **Core Capabilities:**
  * **Direction A (Narrative $\to$ Numerical Baseline):** Passively scans recent turns to initialize unrecorded NPCs with context-appropriate starting relationship values without unprompted LLM overhead.
  * **Direction B (Numerical $\to$ Narrative Evolution):** Detects when an NPC crosses an affection or friendship boundary tier and prompts the model to reflect this milestone in the ongoing story.
  * **`[CORE]` Schema Alignment & Surgical Patching:** Surgically updates *only* `Personality` and `Habits/Behaviors` within MultiHog's `[CORE]` block while strictly protecting `Species`, `Body`, `Worn Equipment`, and `Combat Profile` for MultiHog's exclusive ownership.
  * **Append-Only Chronicle Milestones:** Appends formatted relationship milestone bullets with in-game timestamps (`- [Day X] Relationship Milestone: ...`) below `[/CORE]` in `## Narrative Chronicle` without overwriting historical encounter logs.
  * **Dialogue Pair Filtering:** Feeds the model the last 3 genuine user-assistant conversation pairs (filtering out tool calls, system messages, and hidden tracker injection memos).
  * **Reactive Event Coordination:** Awaits upstream MultiHog's Lorebook Agent pass (`rt_lore_agent_step` finish/error) if actively running (`isRouterRunning()`) before executing, eliminating write-race hazards.
  * **Idempotent Sync Ledger:** Prevents re-scanning the same narrative events and locks each milestone to once-ever trigger rules.
* **Associated Workarounds:**
  * [`WRK-05 (Unstarted Chat Premature Sync)`](./WORKAROUNDS.md#wrk-05-unstarted-chat-premature-sync--llm-triggering-upstream-premature-activation-defect) — Suppresses scans on unstarted chats.
* **Associated Mechanisms:** [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled), [`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b).

---

### FEAT-05: Dynamic Campaign Lorebook Sync
* **Overview:** Automatically organizes and partitions SillyTavern World Info (Lorebooks) to match the active MultiHog adventure chat title.
* **Core Capabilities:**
  * **Chat-Linked Partitioning:** Ensures that NPC entries, location lore, and faction codices are bound exclusively to their corresponding adventure chat.
  * **Zero Lore Bleed:** When switching from Campaign A to Campaign B, unlinks stale lorebooks so the LLM context is never poisoned by out-of-world knowledge.
  * **Automatic Migration on Rename:** Listens for chat renames and clones/migrates the linked lorebooks in lockstep.
* **Associated Workarounds:**
  * [`WRK-04 (Chat Rename Inversion Race)`](./WORKAROUNDS.md#wrk-04-chat-rename-inversion--partition-reset-race-sillytavern--upstream-race-condition) — Uses debounce and early proof to prevent partition resets.
* **Associated Mechanisms:** [`EVT-02`](./LISTENERS.md#evt-02-chat_renamed-adventure-rename-guard), [`EVT-03`](./LISTENERS.md#evt-03-chat_renamed-lorebook-auto-sync).

---

### FEAT-06: NameRAG Diverse Protagonist & NPC Generator
* **Overview:** Replaces generic or repetitive character names in MultiHog's Character Creator and QuickStart with culturally rich, fantasy, sci-fi, and historical candidates from a local NameRAG vector database.
* **Core Capabilities:**
  * **Contextual Candidate Scoring:** Generates diverse protagonist names matched to chosen genre, species, and archetype. Inspects active character inputs (QuickStart setup instructions, Character Creator background, appearance, traits, and gender filters) to query specific character vibes rather than generic genre lists.
  * **XML Container Standardization:** Emits GM ad-hoc guidance inside strict `<name_generation>...</name_generation>` containers to conform with MultiHog's system prompt architecture.
  * **Resilient Offline Fallback:** If the local NameRAG service is offline or hangs, falls back to upstream MultiHog's native generator within 4 seconds and warns the user via toast.
* **Associated Workarounds:**
  * [`WRK-02 (Character Creator Macro Poisoning)`](./WORKAROUNDS.md#wrk-02-character-creator-macro-poisoning--ast-syntax-errors-upstream-prompt-defect) — Sanitizes outgoing prompts.
* **Associated Mechanisms:** [`DOM-02`](./LISTENERS.md#dom-02), [`DOM-03`](./LISTENERS.md#dom-03), [`DOM-04`](./LISTENERS.md#dom-04), [`DOM-05`](./LISTENERS.md#dom-05), [`ADR-MP-04`](./MONKEYPATCHES.md#adr-mp-04-upstream-dom-event-hijacking-via-stopimmediatepropagation-namerag).

---

### FEAT-07: Media, Persona & Portrait Sync Bridge
* **Overview:** Automatically binds SillyTavern Personas to active campaign chats, syncs MultiHog character portraits into the Persona avatar with HTTP thumbnail cache busting, and injects dynamic pixel resolutions and aspect ratios for AI image generation.
* **Core Capabilities:**
  * **Persona Auto-Lock (`syncPersonaToChat`):** Matches the active character name (from `playerCharacter`, `pbtaCampaignDossier`, `companionDossier`, or `[CHARACTER]` memo blocks, including `((HP))` / `((BAR...))` marker stripping) against SillyTavern Personas and locks the matched Persona to the chat, including on Turn 0 immediately after Character Creator or Session Zero completion.
  * **Portrait-to-Persona Sync (`syncPortraitToPersona` & `uploadImageToPersona`):** Uploads generated or replaced MultiHog portraits (`customPortraits`, dossier `portraitSrc`, or `playerCharacter.portraitSrc`) to `/api/avatars/upload`, reloads `/thumbnail?type=persona&file=...` via `script.js:getThumbnailUrl`, refreshes `getUserAvatars`, and cache-busts DOM `<img>` elements.
  * **Aspect-Ratio Presets:** Automatically maps portraits to 1:1 / 512x512 / 832x1216 and scenes to 16:9 / 672x384 / 1216x832.
  * **`/imagine` Command Wrapping:** Seamlessly integrates with SillyTavern's `/imagine` command.
* **Associated Mechanisms:** [`EVT-01`](./LISTENERS.md#evt-01-app_ready), [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled), [`EVT-07`](./LISTENERS.md#evt-07-character_message_rendered-relationship--vitality-sync--pipeline-b), [`EVT-08`](./LISTENERS.md#evt-08-settings_updated-ruleset--state-sync-coordinator), [`ADR-MP-02`](./MONKEYPATCHES.md#adr-mp-02-slash-command-callback-wrapping-imagine).

---

### FEAT-08: Partition History Integrity Guard
* **Overview:** Audits and protects MultiHog's offloaded gzip chat histories (`multihog_history_*.json.gz`) to guarantee long-term campaign persistence.
* **Core Capabilities:**
  * **SHA-256 Checksum Verification:** Detects corrupt or zero-byte history pointers before upstream attempts a damaged partition write.
  * **Persistence Quarantine:** If a partition is damaged, displays a quarantine warning and blocks accidental data overwrites until restored.
* **Associated Mechanisms:** `/mhc-history-check` Slash Command and startup health probe.

---

### FEAT-09: D&D 5e & PbtA Unified Subfooter Alignment Engine
* **Overview:** Resolves the architectural deadlock between `<end_of_output_footer>` and `<CYOA_mode>` where both directives demand terminal placement at the end of the narrator's response.
* **Core Capabilities:**
  * **Parent-Child Subfooter Architecture:** Concludes narrative prose with the status footer while explicitly permitting trailing subfooters, and designates `<CYOA_mode>` as `[SUBFOOTER: INTERACTIVE CHOICES]`.
  * **Zero Prompt Leakage:** When CYOA is turned off, the status footer contains zero mentions of "CYOA", "choices", or buttons, preventing hallucinated choice generation during freeform play.
  * **100% Native MultiHog Overrides:** Stored directly in MultiHog's `customSyspromptLibrary` (`unlocked_base`) and `cyoaConfig.customPromptText` with zero monkeypatching.
  * **Transparent Controls:** Dedicated drawer under the Ruleset tab with real-time status (`● Applied` / `○ Stock Default`), enabled toggle, and one-click `[Reapply Fixes]` / `[Revert to Stock]` actions.
* **Associated Mechanisms:** Pure MultiHog Settings API and [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-coordinator--phase-2-reconciled).

---

### FEAT-10: Autonomous Level-Up Concierge & Class Progression Codex
* **Overview:** Replaces upstream MultiHog's prompt-halting level-up protocol with an out-of-band, deterministic advancement engine and 1–20 class progression codex.
* **Core Capabilities:**
  * **Prompt Sanitization:** Disables `syspromptModules.level_up_protocol` across all chats, freeing the storyteller LLM from character sheet accounting and preventing mid-sentence narrative disruption.
  * **Deterministic Detection:** Code-level XP evaluation against thresholds (D&D 5e: 300, 900, 2,700...) or PbtA rollover buckets (`0/5`).
  * **Unobtrusive UI Triggers:** XP bar pulses gold with a clickable `[ ⬆ Level Up Available ]` badge (`DOM-08`), and the Wand menu dynamically alternates between `⬆ Level Up` and `🔄 Respec` (`DOM-09`).
  * **Auto-Scaffolding Dossier Stub:** Instantly generates a campaign record for unconfigured or Instant Action chats without requiring Session Zero.
  * **1–20 Class Progression Codex (D&D Lite):** Employs a streamlined "D&D Lite" single-track archetype model without rigid branching subclass trees. Level 3 grants an iconic Archetype Specialization feature (e.g. Martial Mastery, Primal Instincts, Arcane Savant), while unique thematic flavor (Totem Warrior, Assassin, Eldritch traits) is granted dynamically via Feats and the Leveling Concierge. Completely avoids upstream memo syntax corruption.
  * **Starting Trait Grounding & UI Harmonizer:**
    * **Prompt Grounding:** Passes the character's established starting traits and ad-hoc abilities (from their adventure sheet) directly to the 1–20 LLM generator, guaranteeing the generated codex honors and builds upon what the adventure already granted.
    * **Passive Traits vs Active [ABILITIES] Dual-Block Persistence:** Enforces MultiHog's architectural separation between passive sheet perks (`Traits:` in `[CHARACTER]`) and active resource powers (`[ABILITIES]`). In Stage 2, active abilities with rest trackers (e.g. `1/1 per short rest`) are displayed with dedicated management and saved cleanly into the `[ABILITIES]` block without polluting passive sheet traits.
    * **Concierge Audit & Permission Directives:** The Leveling Concierge is instructed on the golden rule (Passive Traits vs Active Abilities) and granted explicit permission to audit both lists, detect duplicates across blocks (e.g. `Bad Luck Bearer` vs `Misfortune Gambit`), and emit surgical relocation directives (`[MOVE_TO_ABILITIES: ...]`, `[MOVE_TO_FEATURES: ...]`, `[UPDATE_FEATURE: ...]`, `[UPDATE_ABILITY: ...]`, `[ADD_ABILITY: ...]`, `[REMOVE_ABILITY: ...]`, `[ADD_FEATURE: ...]`, `[REMOVE_FEATURE: ...]`).
    * **Smart Title-Based Deduplication & Key Extraction:** Matches features and abilities by canonical title key (`extractFeatureKey`, e.g. text before parentheses or colons) rather than strict whole-string equality. This completely prevents duplicate items when LLMs slightly paraphrase parenthetical descriptions or re-emit existing traits during audits.
    * **Split-Pane Ergonomic Desk Layout:** Stage 2 displays a side-by-side split layout (character progression cards on the left, pinned Concierge desk on the right) within an expanded 1040px dialog, keeping the Concierge chat and action cards visible simultaneously without vertical scrolling or awkward footer gaps. Consecutive whitespace in chat bubbles is automatically collapsed.
    * **UI Harmonizer Controls:** In Stage 2 Respec mode, displays origin badges (`Harmonized`, `Codex`, `Adventure Sheet`) on traits and provides one-click buttons (`Sync from Codex Table`, `Restore Adventure Sheet Traits`) to harmonize or switch between codex and sheet abilities transparently.
    * **Surgical Replacement Commit:** In Respec mode, replaces the sheet's `Features:` line with the exact approved traits rather than appending, preventing trait duplication across repeated respec runs. In Level-Up mode, deduplicates incoming perks against existing sheet abilities.
  * **Two-Stage Progression Architecture (Stage 1 Codex <-> Stage 2 Desk):** Separates macro class architecture from micro level-up advancement:
    * **Stage 1 (Class Definition & 1–20 Codex):** For new or homebrew classes, players first review the complete 1–20 progression roadmap table, edit Hit Dice or class names, and converse with the Class Architect Concierge (`[UPDATE_LEVEL: ...]`, `[SET_HIT_DIE: ...]`) to live-update the table before advancing.
    * **Stage 2 (Level Up / Respec Desk):** Focuses on immediate advancement—HP gain (average vs roll), ASI/Feats, current level perks, party lockstep growth, and active trait tuning.
    * **Seamless Two-Way Navigation:** Established characters go straight to Stage 2, but a prominent header button (`[📜 Class Definition & Roadmap]`) allows toggling back to Stage 1 at any time. Clicking `Proceed to Level Up / Respec ➔` returns smoothly to Stage 2 with all changes synchronized.
  * **Hybrid Review Dossier & Leveling Concierge:** Interactive modal for HP gain (average vs roll), ASI/Feats, class perks, party sync, and an embedded conversational Leveling Guide with dynamic boon granting (`[ADD_FEATURE: ...]`) and surgical State Memo patching.
  * **PbtA Playbook Tuning & Strict Ruleset Isolation:** In PbtA narrative campaigns, the desk dynamically morphs into the **Playbook Tuning Desk** (or **Playbook Advancement Desk**). It displays Harm Capacity (e.g. 0/4) and Armor rather than Hit Points, lists active Playbook Moves rather than D&D features, bans all D20/D&D mechanics (no Hit Dice, no numeric levels, no spell slots, no DC/saving throws), and runs a specialized PbtA Playbook Guide Concierge.
* **Associated Mechanisms:** [`DOM-08`](./LISTENERS.md#dom-08), [`DOM-09`](./LISTENERS.md#dom-09), and [`WRK-08`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-pause-protocol-shield).

