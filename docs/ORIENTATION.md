# MultiHog Companion — Architecture & Agent Orientation

Welcome to the MultiHog Companion extension for SillyTavern.
This document serves as the **master entry point and mental index** for AI agents and developers working on this codebase.

---

## 1. The Three-Tier Architecture

Developing this extension requires understanding the interaction across three distinct layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tier 1: Host Runtime                            │
│                 SillyTavern Core (Browser Client)                      │
│   • Event Bus (eventSource)               • Chat Persistence (chats.js)│
│   • Generation Pipeline & Interceptors    • Extension Drawer & Popups  │
│   • Docs: SillyTavern-Docs/               • Code: st-source/public/    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ mounts & loads
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Tier 2: Upstream Framework                          │
│               SillyTavern-MultihogDnDFramework                         │
│                  ⚠️ STRICTLY READ-ONLY UPSTREAM ⚠️                     │
│   • State Tracker (Memo loop)             • Adventure Companion (4 acts)│
│   • Chat Ownership (pass-affinity)        • Cartridges & Modules       │
│   • Map Architect & Reality Engine        • CYOA Choice Generation     │
│   • Docs: upstream/docs/                  • Code: upstream/*.js        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ intercepted & augmented via
                                    │ listeners, DOM, monkey patching
┌───────────────────────────────────▼────────────────────────────────────┐
│                   Tier 3: MultiHog Companion                           │
│                      (Active Workspace)                                │
│   • Non-invasive runtime monkeypatches    • PbtA Engine & Vitality     │
│   • Deterministic Event Coordinators      • On-Demand CYOA Repair     │
│   • Concierge Dossier Builder & Critic    • Relationship Narrative Sync│
│   • NameRAG Integration & Fallbacks       • Strict Catalog Enforcement │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Navigation Map (Where to Go Based on Your Task)

| Task Domain | Primary Doc to Consult | Host / Upstream Pointer |
| :--- | :--- | :--- |
| **Additive Features & Capabilities** | [FEATURES.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/FEATURES.md) | High-level index of all Companion systems (`FEAT-01` $\dots$ `FEAT-08`) |
| **Upstream Defects & Workarounds** | [WORKAROUNDS.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/WORKAROUNDS.md) | Defect registry, blast radius, and retirement criteria (`WRK-01` $\dots$ `WRK-07`) |
| **Events, Lifecycle, Race Conditions** | [listeners-and-lifecycle.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/listeners-and-lifecycle.md) & [LISTENERS.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/LISTENERS.md) | `SillyTavern-Docs/For_Contributors/Writing-Extensions.md#events`<br>`st-source/public/scripts/events.js` |
| **SillyTavern Host APIs & Contracts** | [host-sillytavern.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/host-sillytavern.md) | `SillyTavern-Docs/For_Contributors/Writing-Extensions.md`<br>`st-source/public/scripts/st-context.js` |
| **MultiHog Upstream State & Turn Loop** | [upstream-multihog.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/upstream-multihog.md) | `extensions/SillyTavern-MultihogDnDFramework/docs/chat-ownership.md`<br>`extensions/SillyTavern-MultihogDnDFramework/docs/multihogDnDdoc.md` |
| **Monkey Patching & DOM Interception** | [MONKEYPATCHES.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/MONKEYPATCHES.md) | Architectural Decision Records (ADRs) and safe wrapping patterns |
| **PbtA Ruleset & Vitality Mechanics** | [PBTA.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/PBTA.md) | `pbta-ruleset.js`, `pbta-vitality-sync.js`, `pbta-companion-bridge.js` |

---

## 3. Core Architectural Rules

1. **Upstream is Read-Only**: Never edit any file inside `extensions/SillyTavern-MultihogDnDFramework/`. `tests/upstream-integrity.test.js` enforces this with git diff checks.
2. **Deterministic Coordinators over Timers**: Never introduce `setTimeout` ladders (e.g. 500ms, 600ms) to resolve timing issues. Always route asynchronous turn steps through deterministic coordinators with invalidation tokens.
3. **Mandatory Catalog Sync & Anchors**: Every registered event listener, DOM delegation, and runtime monkeypatch must have an anchor tag in code (`// [CATALOG: EVT-XX]`, `// [CATALOG: DOM-XX]`, `// [CATALOG: ADR-MP-XX]`) and be documented in `LISTENERS.md` or `MONKEYPATCHES.md`. `tests/catalog-integrity.test.js` verifies this on every test run.
4. **Resilient Fallbacks**: Never allow an external service (NameRAG, local LLM, endpoint) or monkeypatched UI action to stall indefinitely. Wrap asynchronous operations in timeouts (e.g. 4 seconds) and show user-facing `toastr.warning` notices on failure.
5. **Always Run Tests**: Verify that `npm test` passes completely before concluding any turn.
