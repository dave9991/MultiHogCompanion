# MultiHog Companion — AI Development & Architecture Rules

This workspace contains the MultiHog Companion extension for SillyTavern.
Because this extension augments the upstream MultiHog DnD Framework via event listening, DOM delegation, and runtime monkey patching without modifying upstream files, strict architectural discipline is required.

---

## 0. Agent Orientation & Architecture Knowledge Base
Before modifying code, designing features, or debugging async timing:
* **Master Orientation Hub**: Consult [docs/ORIENTATION.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/ORIENTATION.md) for the three-tier architecture overview and reading map.
* **Turn Lifecycle & Race Conditions**: Consult [docs/listeners-and-lifecycle.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/listeners-and-lifecycle.md) for event order, race conditions, and coordinator patterns.
* **SillyTavern Host Contracts**: Consult [docs/host-sillytavern.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/host-sillytavern.md) for pointers to `SillyTavern-Docs` and `st-source`.
* **Upstream MultiHog Framework**: Consult [docs/upstream-multihog.md](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/docs/upstream-multihog.md) for pointers to upstream design docs, memo loops, and cartridges.

---

## 1. Architectural Catalogs Are Mandatory
MultiHog Companion maintains a 4-quadrant catalog separating Intent from Mechanism:
1. **Consult `FEATURES.md`**: Review additive systems and user capabilities (`FEAT-01` through `FEAT-08`).
2. **Consult `WORKAROUNDS.md`**: Review upstream defect shims, host hazards, blast radii, and retirement criteria (`WRK-01` through `WRK-07`).
3. **Consult `LISTENERS.md`**: Review event bus triggers, execution priority, and DOM delegations (`EVT-01` through `EVT-12`, `DOM-01` through `DOM-06`).
4. **Consult `MONKEYPATCHES.md`**: Review Architecture Decision Records (`ADR-MP-01` through `ADR-MP-07`) for host surface, blast radius, and safety fallbacks.
5. **Keep All 4 Catalogs Synchronized**: Whenever you touch a feature, workaround, event, or patch, update both the code and the corresponding `.md` catalog entries.
6. **Use Anchor Tags**: Every listener and monkey patch in code MUST have a corresponding tag comment:
   * `// [CATALOG: EVT-XX] See LISTENERS.md — Description`
   * `// [CATALOG: DOM-XX] See LISTENERS.md — Description`
   * `// [CATALOG: ADR-MP-XX] See MONKEYPATCHES.md — Description`

---

## 2. Event Coordinator Patterns
* **No `setTimeout` Ladders**: Never introduce staggered `setTimeout` chains (e.g. 500ms, 550ms, 600ms) to dodge async timing issues. Use deterministic sequential coordinators.
* **Chat Switching**: Route all chat change logic through `runChatChangedCoordinator(activeChatId, token)` with active token invalidation to cancel stale work during rapid chat switches.
* **Assistant Message Turns**: Use `CHARACTER_MESSAGE_RENDERED` as the canonical post-generation message event (once the message is committed to DOM). Do not add parallel duplicate listeners to `MESSAGE_RECEIVED`.
* **CYOA Dispatching**: Route all CYOA generation and repair through `coordinateCyoaForMessage` to prevent duplicate concurrent LLM generation passes.
* **Settings Update Protection**: Shield `SETTINGS_UPDATED` handlers with an execution mutex (e.g. `_isSettingsSyncActive`) to prevent cascade loops when setting changes trigger further events.

---

## 3. DOM & Monkey Patch Hardening
* **Resilient Fallbacks**: If monkey patching or intercepting upstream UI (e.g. `stopImmediatePropagation`), ALWAYS wrap asynchronous queries in a timeout promise (e.g. 4 seconds) and provide a graceful fallback so buttons never freeze or remain permanently disabled.
* **Inform the User**: When an external service (like NameRAG) fails or times out, fall back gracefully AND display a non-intrusive warning toast to notify the user.
* **Keyboard Accessibility**: Ensure pre-flight sanitizers intercept keyboard events (`keydown: Enter`) as well as mouse clicks on input fields.

---

## 4. Verification & Testing
* Always run `npm test` before concluding your turn.
* `tests/catalog-integrity.test.js` programmatically enforces that every registered event, DOM delegation, and ADR in the codebase matches `LISTENERS.md` and `MONKEYPATCHES.md`.
* `tests/upstream-integrity.test.js` guarantees that `extensions/SillyTavern-MultihogDnDFramework/` remains 100% clean and untouched.
