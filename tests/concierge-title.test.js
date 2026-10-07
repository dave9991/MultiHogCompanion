import assert from 'node:assert';
import { createEmptyDossier, applyDossierUpdates } from '../concierge-parser.js';
import { buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running Concierge Title & Naming Test Suite ---');

// 1. Verify system prompt includes title directive & guidance
const prompt = buildConciergeSystemPrompt();
assert.ok(prompt.includes('title: Punchy 2-3 word evocative campaign title'), 'Prompt missing title directive example');
assert.ok(prompt.includes('Campaign Title:'), 'Prompt missing Campaign Title guideline in Session Zero flow');
assert.ok(prompt.includes('title:'), 'Prompt missing title in update tags list');
console.log('✓ Concierge prompt includes clear 2-3 word title instructions');

// 2. Initial directive with title and premise
const dossier = createEmptyDossier();
assert.strictEqual(dossier.meta.title, 'Untitled PbtA Campaign');

const initialUpdate = `[UPDATE_DOSSIER]
title: Vance: Cold Iron
system: fantasy
premise: Silas Vance investigates dark omens in the frozen borderlands.
[PROTAGONIST]
name: Silas Vance
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

const result1 = applyDossierUpdates(initialUpdate, dossier);
assert.strictEqual(result1.updatedDossier.meta.title, 'Vance: Cold Iron', 'Title was not correctly parsed from directive');
assert.strictEqual(result1.updatedDossier.meta.premise, 'Silas Vance investigates dark omens in the frozen borderlands.');
assert.ok(result1.changes.some(c => c.includes('Campaign title set to "Vance: Cold Iron"')));
console.log('✓ Initial update correctly parses title and prevents premise-slicing fallback');

// 3. User asks to change title (follow-up edit)
const followUpUpdate = `[UPDATE_DOSSIER]
title: The Ash Wendigo
[/UPDATE_DOSSIER]`;

const result2 = applyDossierUpdates(followUpUpdate, result1.updatedDossier);
assert.strictEqual(result2.updatedDossier.meta.title, 'The Ash Wendigo', 'Title was not updated in follow-up');
assert.strictEqual(result2.updatedDossier.meta.premise, 'Silas Vance investigates dark omens in the frozen borderlands.', 'Premise should be preserved');
assert.ok(result2.changes.some(c => c.includes('Campaign title set to "The Ash Wendigo"')));
console.log('✓ Follow-up title edit properly updates dossier and preserves existing fields');

// 4. Quotation marks and markdown wrappers are cleaned
const dirtyUpdate = `[UPDATE_DOSSIER]
title: **"The Frost Boundary"**
[/UPDATE_DOSSIER]`;

const result3 = applyDossierUpdates(dirtyUpdate, result2.updatedDossier);
assert.strictEqual(result3.updatedDossier.meta.title, 'The Frost Boundary');
console.log('✓ Markdown formatting and quotes are cleaned from campaign title');

// 5. Fallback behavior when title is omitted in legacy/unprompted output
const legacyDossier = createEmptyDossier();
const legacyUpdate = `[UPDATE_DOSSIER]
system: modern
premise: A hardboiled detective investigates a murder in downtown Chicago.
[/UPDATE_DOSSIER]`;

const resultLegacy = applyDossierUpdates(legacyUpdate, legacyDossier);
assert.strictEqual(resultLegacy.updatedDossier.meta.title, 'A hardboiled detective investigates a mu...');
console.log('✓ Legacy fallback safely functions when title is absent');

console.log('--- ALL CONCIERGE TITLE TESTS PASSED CLEANLY! ---');
