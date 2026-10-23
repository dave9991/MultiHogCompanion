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
| **FEAT-01** | **PbtA Ruleset Cartridge Engine** | [`pbta-ruleset.js`](./pbta-ruleset.js)<br>[`pbta-ruleset-persistence.js`](./pbta-ruleset-persistence.js)<br>[`pbta-companion-bridge.js`](./pbta-companion-bridge.js) | [`WRK-01`](./WORKAROUNDS.md#wrk-01-synthetic-cartridge-ruleset-injection-missing-upstream-plugin-api)<br>[`WRK-03`](./WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator)<br>[`EVT-07`](./LISTENERS.md#evt-07-settings_updated-self-inflicted-write-shield)<br>[`EVT-08`](./LISTENERS.md#evt-08-settings_updated-reconciliation-coordinator) | [`ADR-MP-01`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch)<br>[`ADR-MP-05`](./MONKEYPATCHES.md#adr-mp-05-in-memory-upstream-settings-cleansing-stockprompts-mutation) |
| **FEAT-02** | **Concierge Session Zero & Living World Dossier** | [`concierge-runner.js`](./concierge-runner.js)<br>[`concierge-ui.js`](./concierge-ui.js)<br>[`concierge-dossier-builder.js`](./concierge-dossier-builder.js)<br>[`concierge-dossier-judge.js`](./concierge-dossier-judge.js) | [`WRK-03`](./WORKAROUNDS.md#wrk-03-stock-dd-settings-pollution--prompt-bleed-upstream-shared-state-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator) | None (Pure Additive API) |
| **FEAT-03** | **CYOA On-Demand Choice Engine & Instant Auto-Repair** | [`cyoa-generator.js`](./cyoa-generator.js)<br>[`cyoa-safety-net.js`](./cyoa-safety-net.js) | [`WRK-06`](./WORKAROUNDS.md#wrk-06-historical-cyoa-context-poisoning-host-llm-hallucination-trap)<br>[`WRK-07`](./WORKAROUNDS.md#wrk-07-truncated-message-stop-button-choice-injection-host-post-stop-event-hazard)<br>[`WRK-08`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-narrative-pause-collision) | [`EVT-05`](./LISTENERS.md#evt-05-chat_changed-immediate-cyoa-abort-t0ms)<br>[`EVT-09`](./LISTENERS.md#evt-09-generation_started-abort-hook-for-background-cyoa)<br>[`EVT-10`](./LISTENERS.md#evt-10-generation_stopped-abort-hook-for-background-cyoa)<br>[`EVT-11`](./LISTENERS.md#evt-11-generation_ended-retired-formerly-cyoa-fallback-completion-trigger)<br>[`EVT-12`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-outgoing-cyoa-prompt-sanitizer)<br>[`DOM-06`](./LISTENERS.md#dom-06)<br>[`DOM-07`](./LISTENERS.md#dom-07) | [`ADR-MP-03`](./MONKEYPATCHES.md#adr-mp-03-sillytavern-pipeline-generation-interceptor-generate_interceptor) |
| **FEAT-04** | **Relationship Narrative Sync** | [`relationship-narrative-sync.js`](./relationship-narrative-sync.js) | [`WRK-05`](./WORKAROUNDS.md#wrk-05-unstarted-chat-premature-sync--llm-triggering-upstream-premature-activation-defect) | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator)<br>[`EVT-06`](./LISTENERS.md#evt-06-character_message_rendered-canonical-post-generation-hook) | None (Uses ST Lorebook & Chat API) |
| **FEAT-05** | **Dynamic Campaign Lorebook Sync** | [`campaign-lorebook-sync.js`](./campaign-lorebook-sync.js) | [`WRK-04`](./WORKAROUNDS.md#wrk-04-chat-rename-inversion--partition-reset-race-sillytavern--upstream-race-condition) | [`EVT-02`](./LISTENERS.md#evt-02-chat_renamed-early-hook-priority-partition-proof-re-arm)<br>[`EVT-03`](./LISTENERS.md#evt-03-chat_renamed-debounced-campaign-lorebook-sync) | None (Pure ST World Info API) |
| **FEAT-06** | **NameRAG Diverse Protagonist & NPC Generator** | [`namerag-hooks.js`](./namerag-hooks.js) | [`WRK-02`](./WORKAROUNDS.md#wrk-02-character-creator-macro-poisoning--ast-syntax-errors-upstream-prompt-defect) | [`DOM-02`](./LISTENERS.md#dom-02)<br>[`DOM-03`](./LISTENERS.md#dom-03)<br>[`DOM-04`](./LISTENERS.md#dom-04)<br>[`DOM-05`](./LISTENERS.md#dom-05) | [`ADR-MP-04`](./MONKEYPATCHES.md#adr-mp-04-dom-stopimmediatepropagation-hijacking-namerag-injection) |
| **FEAT-07** | **Media & Aspect-Ratio Bridge** | [`aspect-ratio-bridge.js`](./aspect-ratio-bridge.js) | None | [`EVT-01`](./LISTENERS.md#evt-01-app_ready) | [`ADR-MP-02`](./MONKEYPATCHES.md#adr-mp-02-imagine-slash-command-callback-wrapping) |
| **FEAT-08** | **Partition History Integrity Guard** | [`history-integrity-guard.js`](./history-integrity-guard.js) | None | Slash Command `/mhc-history-check` | None (Direct File / Storage Inspection) |
| **FEAT-09** | **D&D 5e & PbtA Unified Subfooter Alignment Engine** | [`dnd-fixes.js`](./dnd-fixes.js)<br>[`pbta-ruleset.js`](./pbta-ruleset.js) | None | [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator) | None (Pure MultiHog Settings API) |

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
* **Associated Mechanisms:** [`ADR-MP-01`](./MONKEYPATCHES.md#adr-mp-01-synthetic-pbta-ruleset-injection-via-windowfetch), [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator), [`EVT-07`](./LISTENERS.md#evt-07-settings_updated-self-inflicted-write-shield), [`EVT-08`](./LISTENERS.md#evt-08-settings_updated-reconciliation-coordinator).

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
  * **Historical Context Sanitizer:** Scrubs older choice buttons from outgoing prompt history (`CHAT_COMPLETION_PROMPT_READY`) to preserve prompt purity.
* **Associated Workarounds:**
  * [`WRK-06 (Historical Choice Context Poisoning)`](./WORKAROUNDS.md#wrk-06-historical-cyoa-context-poisoning-host-llm-hallucination-trap) — Scrubs older choices from prompt context.
  * [`WRK-07 (Truncated Message Stop Button Leak)`](./WORKAROUNDS.md#wrk-07-truncated-message-stop-button-choice-injection-host-post-stop-event-hazard) — Aborts generation when user clicks Stop.
  * [`WRK-08 (Level-Up & Permadeath Narrative Pause Collision)`](./WORKAROUNDS.md#wrk-08-level-up--permadeath-narrative-pause-collision) — Suppresses CYOA choice generation on pending character milestone or hard protocol pause turns.
* **Associated Mechanisms:** [`EVT-05`](./LISTENERS.md#evt-05-chat_changed-immediate-cyoa-abort-t0ms), [`EVT-09`](./LISTENERS.md#evt-09-generation_started-abort-hook-for-background-cyoa), [`EVT-10`](./LISTENERS.md#evt-10-generation_stopped-abort-hook-for-background-cyoa), [`EVT-11`](./LISTENERS.md#evt-11-generation_ended-retired-formerly-cyoa-fallback-completion-trigger), [`EVT-12`](./LISTENERS.md#evt-12-chat_completion_prompt_ready-outgoing-cyoa-prompt-sanitizer), [`DOM-06`](./LISTENERS.md#dom-06), [`DOM-07`](./LISTENERS.md#dom-07), [`ADR-MP-03`](./MONKEYPATCHES.md#adr-mp-03-sillytavern-pipeline-generation-interceptor-generate_interceptor).

---

### FEAT-04: Relationship Narrative Sync
* **Overview:** Bridges narrative roleplay prose with MultiHog's numerical NPC relationship gauges (-150 to +150 Friendship & Affection across 13 distinct tiers).
* **Core Capabilities:**
  * **Direction A (Narrative $\to$ Numerical Baseline):** Passively scans recent turns to initialize unrecorded NPCs with context-appropriate starting relationship values without unprompted LLM overhead.
  * **Direction B (Numerical $\to$ Narrative Evolution):** Detects when an NPC crosses an affection or friendship boundary tier and prompts the model to reflect this milestone in the ongoing story.
  * **Idempotent Sync Ledger:** Prevents re-scanning the same narrative events and locks each milestone to once-ever trigger rules.
* **Associated Workarounds:**
  * [`WRK-05 (Unstarted Chat Premature Sync)`](./WORKAROUNDS.md#wrk-05-unstarted-chat-premature-sync--llm-triggering-upstream-premature-activation-defect) — Suppresses scans on unstarted chats.
* **Associated Mechanisms:** [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator), [`EVT-06`](./LISTENERS.md#evt-06-character_message_rendered-canonical-post-generation-hook).

---

### FEAT-05: Dynamic Campaign Lorebook Sync
* **Overview:** Automatically organizes and partitions SillyTavern World Info (Lorebooks) to match the active MultiHog adventure chat title.
* **Core Capabilities:**
  * **Chat-Linked Partitioning:** Ensures that NPC entries, location lore, and faction codices are bound exclusively to their corresponding adventure chat.
  * **Zero Lore Bleed:** When switching from Campaign A to Campaign B, unlinks stale lorebooks so the LLM context is never poisoned by out-of-world knowledge.
  * **Automatic Migration on Rename:** Listens for chat renames and clones/migrates the linked lorebooks in lockstep.
* **Associated Workarounds:**
  * [`WRK-04 (Chat Rename Inversion Race)`](./WORKAROUNDS.md#wrk-04-chat-rename-inversion--partition-reset-race-sillytavern--upstream-race-condition) — Uses debounce and early proof to prevent partition resets.
* **Associated Mechanisms:** [`EVT-02`](./LISTENERS.md#evt-02-chat_renamed-early-hook-priority-partition-proof-re-arm), [`EVT-03`](./LISTENERS.md#evt-03-chat_renamed-debounced-campaign-lorebook-sync).

---

### FEAT-06: NameRAG Diverse Protagonist & NPC Generator
* **Overview:** Replaces generic or repetitive character names in MultiHog's Character Creator and QuickStart with culturally rich, fantasy, sci-fi, and historical candidates from a local NameRAG vector database.
* **Core Capabilities:**
  * **Contextual Candidate Scoring:** Generates diverse protagonist names matched to chosen genre, species, and archetype.
  * **Resilient Offline Fallback:** If the local NameRAG service is offline or hangs, falls back to upstream MultiHog's native generator within 4 seconds and warns the user via toast.
* **Associated Workarounds:**
  * [`WRK-02 (Character Creator Macro Poisoning)`](./WORKAROUNDS.md#wrk-02-character-creator-macro-poisoning--ast-syntax-errors-upstream-prompt-defect) — Sanitizes outgoing prompts.
* **Associated Mechanisms:** [`DOM-02`](./LISTENERS.md#dom-02), [`DOM-03`](./LISTENERS.md#dom-03), [`DOM-04`](./LISTENERS.md#dom-04), [`DOM-05`](./LISTENERS.md#dom-05), [`ADR-MP-04`](./MONKEYPATCHES.md#adr-mp-04-dom-stopimmediatepropagation-hijacking-namerag-injection).

---

### FEAT-07: Media & Aspect-Ratio Bridge
* **Overview:** Automatically calculates and injects correct pixel resolutions and aspect ratios for AI image generation (Stable Diffusion 1.5, SDXL, Flux, DALL-E) based on whether an image is a Portrait or a Scene.
* **Core Capabilities:**
  * **Aspect-Ratio Presets:** Automatically maps portraits to 1:1 / 512x512 / 832x1216 and scenes to 16:9 / 672x384 / 1216x832.
  * **`/imagine` Command Wrapping:** Seamlessly integrates with SillyTavern's `/imagine` command.
* **Associated Mechanisms:** [`EVT-01`](./LISTENERS.md#evt-01-app_ready), [`ADR-MP-02`](./MONKEYPATCHES.md#adr-mp-02-imagine-slash-command-callback-wrapping).

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
* **Associated Mechanisms:** Pure MultiHog Settings API and [`EVT-04`](./LISTENERS.md#evt-04-chat_changed-primary-reconciliation-coordinator).
