# Concierge to Framework Handoff — Architecture & Audit Hub

This folder documents the **handoff contracts and boundary guarantees** between the **Session Zero Concierge** (`MultiHogCompanion`) and the read-only upstream **`SillyTavern-MultihogDnDFramework`**.

While [docs/concierge/README.md](../concierge/README.md) covers Steps 1–4 inside the Session Zero workbench, this subsystem governs everything that happens **at and after Launch / Living-World Sync**: dossier sanitization, World Info / Canon / Bestiary / Location / Skeleton serialization, SillyTavern book registration, prefix derivation, Map Architect interop, and v3 Game System / Cartridge persistence.

---

## 1. Handoff Pipeline Overview

```mermaid
flowchart TD
    D["Session Zero Dossier & Staged Canon"] --> S["HAND-001: Placeholder Sweep + Recursive NameRAG Token Strip"]
    S --> C["Step 1: Ruleset Cartridge + Chat Setup"]
    C --> P["Step 2: Protagonist Persona & PC Card (concierge-pc-format.js)"]
    P --> M["Step 3: Pre-Seed Bestiary + Primary Map Architect (map-architect.js)"]
    M --> L["Step 4: Modular Lorebooks + Canon + World Skeleton"]
    L --> I["Step 5: Campaign Dossier WI + Custom Game System + Memo + Cartridge State"]
    I --> T["Step 6–7: Opening Scene + Refresh Agent Manifest + First Router Pass"]
```

---

## 2. Documents in This Folder

* **[sanitization-and-lorebooks.md](./sanitization-and-lorebooks.md)** — Contracts for `HAND-001` (Universal Recursive NameRAG Token Sanitization), `HAND-002` (Canon Format, `[CORE]` Wrapping & Keyring Isolation), and `HAND-003` (Bestiary Format & SillyTavern World Info Registry / Activation).

---

## 3. Active Audit & Remediation Tracker (`HAND-001` – `HAND-008`)

| ID | Phase | Finding / Contract Gap | Status | Target Files |
| :--- | :---: | :--- | :---: | :--- |
| **`HAND-001`** | **Phase 1** | Universal recursive stripping of `[NAME: ..., RESOLVED TO: ...]`, `[REALNAME: ...]`, `[concept: ...]`, and `[[NAME:...]]` across every dossier field, PC card, entity formatter, skeleton, and both Launch & Living-World Sync paths | **FIXED & VERIFIED** | [namerag-hooks.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/namerag-hooks.js), [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js), [concierge-lore-distributor.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-lore-distributor.js), [concierge-npc-format.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-npc-format.js), [concierge-pc-format.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-pc-format.js) |
| **`HAND-002`** | **Phase 1** | `{prefix}_Canon` handoff contract: strip NameRAG tokens without mutating staged Session Zero badges, wrap bodies in `[CORE]...[/CORE]` for Router protection, and isolate disabled entries (`key: []`, `vectorized: false`, `canonKeys` backup) so upstream `scanAssistantOutputForKeywords()` never auto-activates excluded Canon | **FIXED & VERIFIED** | [concierge-canon.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-canon.js) |
| **`HAND-003`** | **Phase 1** | Normalize string vs. array `attacks` & `impendingDoom` in `buildMonsterEntryContent()`, and register/activate newly written World Info books in SillyTavern (`saveWorldInfo`, `updateWorldInfoList`, `/world state=on silent=true`) immediately so `loadWorldInfo()` & Turn 1 see `{prefix}_Bestiary` and sibling books without F5 | **FIXED & VERIFIED** | [concierge-npc-format.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-npc-format.js), [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) |
| **`HAND-004`** | **Phase 2** | Campaign prefix ordering (`renamedCampaignPrefix` vs. Steps 3/4/4b reads of `getEffectiveRouterCampaignPrefix`) & clean boundaries between `Campaign_{chatId}` and `{prefix}_*` books | *Planned (Phase 2)* | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) |
| **`HAND-005`** | **Phase 2** | Prevent Step 4 `{prefix}_Locations` upsert from clobbering Step 3 Map Architect `[CORE]` (`Host Site:` / `Host Brief:` / mapped-site description) | *Planned (Phase 2)* | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) |
| **`HAND-006`** | **Phase 3** | Preserve `customGenreSpec`, `stats`, `pools`, `knobs`, and `config` when stamping `CompanionActiveCartridge` in Step 5 & Living-World Sync | *Planned (Phase 3)* | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js), [pbta-ruleset-persistence.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset-persistence.js) |
| **`HAND-007`** | **Phase 3** | Register Concierge Custom Game Systems via upstream v3 catalogs (`gameSystemDatabase`, `syspromptSnippetDatabase`, `trackerModuleDatabase`, `<tag>...</tag>` snippet wrapping, boolean driver flags, `syncChatSetupCatalogs`) and update in Living-World Sync | *Planned (Phase 3)* | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js) |
| **`HAND-008`** | **Phase 3** | Align `gameCartridges` payload completeness and ordering with upstream `CARTRIDGE_PAYLOAD_GROUPS` & `applyChatSetup` across PbtA, FAE, and D&D 5e | *Planned (Phase 3)* | [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js), [pbta-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset.js), [fae-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-ruleset.js) |
