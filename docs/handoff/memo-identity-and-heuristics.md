# Turn-0 Memo, Entity Identity & Heuristic Contracts (`MEMO-001` – `MEMO-005`)

This specification documents the contracts and remediations from the **Turn-0 Memo, Entity Identity & Heuristic Audit** governing `[CHARACTER]` memo identity formatting, FAE `Status:` determinism, lossless memo round-tripping, and the removal of brittle regex heuristics across `MultiHogCompanion`.

---

## `MEMO-001`: Entity Name/Archetype Splitting & Parenthetical Flattening

### Problem Solved
When Stage 4 or a manual edit placed a nested parenthetical role inside `protagonist.name` (e.g., `Jon (Frontier Magistrate (Old World Paladin))`) with an empty `archetype:`/`playbook:` field:
1. `concierge-parser.js` stored the unsplit `name` verbatim while leaving `archetype`/`playbook` empty.
2. Downstream system adapters (`concierge-system-fae.js`) fell back to `genre.archetypes[0]` (e.g. `The Sellsword` for `post_apocalyptic`).
3. Initial memo builders blindly interpolated `${name} (${archetype}): ...`, producing double/triple parenthetical headers (`Jon (Frontier Magistrate (Old World Paladin)) (The Sellsword): ...`) that broke upstream regex extractors and regex-based pill/name cleaners (`[^)]*`).

### Canonical Helpers & Contract
1. **`flattenArchetypeParens(raw)`** ([character-creator-sanitizer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/character-creator-sanitizer.js)):
   * Strips balanced wrapping parentheses repeatedly and replaces inner/adjacent parenthetical groups with ` — ` segments so archetype/playbook/class labels never contain nested parentheses.
2. **`splitNameAndEmbeddedArchetype(rawName)`** ([character-creator-sanitizer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/character-creator-sanitizer.js)):
   * Uses a depth-balanced parenthesis scanner (no `[^)]*` regex) to peel trailing parenthetical groups from `rawName`, returning `{ cleanName, embeddedArchetype }` with `embeddedArchetype` passed through `flattenArchetypeParens()`.
   * Guards NameRAG tokens (`[[NAME:...]]`, `[NAME: ..., RESOLVED TO: ...]`), returning them intact when present.
   * `stripMarkdownNameArtifacts()` delegates trailing parenthetical stripping to `splitNameAndEmbeddedArchetype()`.
3. **Parse/Heal & Multi-Engine Formatting Integration:**
   * [concierge-parser.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-parser.js) (`applyDossierUpdates()` and `healAndNormalizeDossier()`): splits embedded parentheticals out of `protagonist.name`, promotes them into empty/generic `archetype`/`playbook` fields, and flattens `archetype`/`playbook`/`class`.
   * [fae-state-sync.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-state-sync.js) (`formatFaeCharacterMemoBlock()`, `formatInitialFaeMemo()`, `mergeDossierIntoLiveFaeMemo()`), [pbta-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset.js) (`formatInitialPbtaMemo()`), and [concierge-system-dnd5e.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-system-dnd5e.js) (`Dnd5eSystemAdapter.formatInitialMemo()`) defensively sanitize identity headers through the same helpers.
   * [concierge-prompt.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-prompt.js) (`buildStage4CharacterBuilderPrompt()`): instructs Stage 4 to keep `name:` plain (no parenthetical class/title) and `archetype:`/`playbook:`/`class:` flat without nested parentheses.

---

## `MEMO-002`: FAE `Status:` Determinism

### Problem Solved
`formatFaeCharacterMemoBlock()` ([fae-state-sync.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-state-sync.js)) previously inferred `Status: (-) Strained & Injured` whenever `rawNegTags.length > 0`, even when every Resource Pool was at full capacity (`10/10`) and the negative tags were Session Zero character flaws (`(-) Unyielding Code`, `(-) Dust-Blind`).

### Contract
`formatFaeCharacterMemoBlock()` computes `Status:` strictly in this deterministic order:
1. Primary pool `current === 0` $\rightarrow$ `` `(-) ${primaryPool.zero_debuff} (Breaking Point)` ``.
2. Any secondary pool `current === 0` $\rightarrow$ `` `(-) ${zeroPool.zero_debuff}` ``.
3. Explicit persisted `char.status` (non-empty trimmed string) $\rightarrow$ `char.status.trim()`.
4. Default $\rightarrow$ `'Healthy'`.

Session Zero character flaws in `((PILLS)) Scars & Debuffs:` never fabricate an active injury status on their own.

---

## `MEMO-003`: Lossless `parseFaeStateFromMemo()` Round-Trip

### Contract ([fae-state-sync.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-state-sync.js))
1. **Balanced Line-1 Parsing:** Line 1 `Name (Archetype): cur/max HP` is parsed via `/^\s*[-*+•–—]?\s*(.+?):\s*([+-]?\d+)\/(\d+)\s*HP\b/i` and `splitNameAndEmbeddedArchetype()`, removing the fragile `[^)]+` paren regex that broke on nested or duplicated parentheticals.
2. **Status Persistence:** `parseFaeStateFromMemo()` parses the `Status:` line into `character.status` so GM-authored or persisted statuses (e.g. `(-) Poisoned`, `Fatigued`, `Healthy`) round-trip through `formatFaeCharacterMemoBlock()` and `mergeDossierIntoLiveFaeMemo()` instead of being discarded.
3. **Explicit Empty / `None` Positive Tags:** When a `Positive Tags:` line exists in the memo (including `Positive Tags: None` or empty), `parseFaeStateFromMemo()` preserves `positiveTags = []` without backfilling `fallbackGenre.defaultPositiveTags`. Genre defaults are only supplied when the `Positive Tags:` line is completely absent from `[CHARACTER]`.

---

## `MEMO-004`: Sibling Brittle Regex Remediation

A sweep across `MultiHogCompanion` uncovered and fixed three sibling brittle regex patterns:
1. **Line-1 Scoping in `sanitizeCharacterHeaderInMemo()` & `rectifyMemoCharacterName()`** ([character-creator-sanitizer.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/character-creator-sanitizer.js)):
   * Replaced the cross-line `/(\[CHARACTER\][\s\S]*?)(?:...|User|Player|...)(\s*[\(:])/gi` regex with Line-1-isolated header processing anchored to the leading identity slot before `:`/`(`, guaranteeing tags and pills on subsequent lines (e.g. containing `User (` or `Player (`) are never mutated.
2. **Balanced Trailing Paren Handling in `normalizeFaePill()`** ([fae-state-sync.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-state-sync.js)):
   * Replaced `/\([^)]+\)$/` with a depth-balanced trailing parenthesis scanner so nested parentheses inside hover-toast descriptions are converted cleanly to `[...]` (`Multihog` pill syntax compliance).
3. **Negation-Aware `isAlliedCompanionRole(role)`** ([pbta-ruleset.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/pbta-ruleset.js), [concierge-runner.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/concierge-runner.js), [fae-state-sync.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/fae-state-sync.js)):
   * Replaced raw `/companion|party|mentor|patron|ally/i` substring checks with `isAlliedCompanionRole()`, which rejects adversarial/negated qualifiers (`former`, `ex-`, `rival`, `enemy`, `hostile`, `betrayed`, `nemesis`, `antagonist`, `traitor`, `turned enemy`) so NPCs like `"Former ally turned enemy"` or `"Betrayed the party"` are never promoted into `[PARTY]` or Turn-1 `activeRouterKeys`.

---

## `MEMO-005`: Regression Verification

Covered deterministically in [tests/memo-upstream-contract.test.js](file:///var/home/dlittle/ai-stack/sillytavern-test/extensions/MultiHogCompanion/tests/memo-upstream-contract.test.js):
* Exact `Jon (Frontier Magistrate (Old World Paladin))` + starting FAE `negativeTags` reproduction (`Jon (Frontier Magistrate — Old World Paladin): 10/10 HP ...` + `Status: Healthy`, no `(The Sellsword)`, no `(-) Strained & Injured`).
* Lossless `parseFaeStateFromMemo()` $\rightarrow$ `formatFaeCharacterMemoBlock()` round-trip for custom `Status:`, flattened nested archetypes, and explicit `Positive Tags: None`.
* `normalizeFaePill()` nested parenthetical conversion.
* PbtA & D&D 5e Turn-0 identity flattening.
* Line-1 scoping of `rectifyMemoCharacterName()` / `sanitizeCharacterHeaderInMemo()` preserving downstream pill lines containing `User (` / `Player (`.
* `isAlliedCompanionRole()` positive vs. negated/adversarial cases.
* NameRAG token preservation in `splitNameAndEmbeddedArchetype()`.
