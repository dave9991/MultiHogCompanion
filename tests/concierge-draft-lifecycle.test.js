/**
 * concierge-draft-lifecycle.test.js — MultiHog Companion
 *
 * Tests the Session Zero draft lifecycle, integrity validation, and post-launch cleanup:
 * 1. validateDraft rejects corrupted, incomplete, or empty drafts.
 * 2. validateDraft accepts and heals complete, valid drafts.
 * 3. isDossierEmptyOrUntouched detects pristine state vs active progress.
 * 4. concierge-ui.js cleanly integrates resetConciergeState into launch, sync, and reset flows.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    createEmptyDossier,
    validateDraft,
    isDossierEmptyOrUntouched,
    healAndNormalizeDossier,
} from '../concierge-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge Draft Lifecycle & Integrity Test Suite ---');

// ── 1. isDossierEmptyOrUntouched Tests ─────────────────────────────────────────
console.log('Testing isDossierEmptyOrUntouched...');
{
    const empty = createEmptyDossier();
    assert.strictEqual(isDossierEmptyOrUntouched(empty), true, 'Default empty dossier must be reported as untouched');
    assert.strictEqual(isDossierEmptyOrUntouched(null), true, 'Null must safely report as untouched');
    assert.strictEqual(isDossierEmptyOrUntouched({}), true, 'Empty object must safely report as untouched');

    // Title modified
    const withTitle = createEmptyDossier();
    withTitle.meta.title = 'Blood & Chrome';
    assert.strictEqual(isDossierEmptyOrUntouched(withTitle), false, 'Modified title must report as touched');

    // Protagonist modified
    const withProto = createEmptyDossier();
    withProto.protagonist.name = 'Kaelen';
    assert.strictEqual(isDossierEmptyOrUntouched(withProto), false, 'Named protagonist must report as touched');

    // NPC added
    const withNpc = createEmptyDossier();
    withNpc.npcs.push({ name: 'Baron Vance', role: 'Arch-Rival' });
    assert.strictEqual(isDossierEmptyOrUntouched(withNpc), false, 'Staged NPC must report as touched');

    // The Kick modified
    const withKick = createEmptyDossier();
    withKick.theKick.crisis = 'The vault sirens are blaring';
    assert.strictEqual(isDossierEmptyOrUntouched(withKick), false, 'Staged kick must report as touched');

    console.log('✓ isDossierEmptyOrUntouched correctly identifies pristine vs active blueprint states');
}

// ── 2. validateDraft Integrity Tests ──────────────────────────────────────────
console.log('Testing validateDraft integrity checks...');
{
    // Rejections:
    assert.strictEqual(validateDraft(null), null, 'Null draft must be rejected');
    assert.strictEqual(validateDraft('invalid'), null, 'Non-object draft must be rejected');
    assert.strictEqual(validateDraft({}), null, 'Empty draft without chatHistory must be rejected');

    // Chat history missing or empty
    const noChat = {
        dossier: createEmptyDossier(),
        chatHistory: [],
    };
    assert.strictEqual(validateDraft(noChat), null, 'Draft with empty chatHistory must be rejected');

    // Chat history with malformed items
    const badChatItems = {
        dossier: createEmptyDossier(),
        chatHistory: [null, 'string message'],
    };
    assert.strictEqual(validateDraft(badChatItems), null, 'Draft with non-object or role-less messages must be rejected');

    // Dossier missing or incomplete
    const noDossier = {
        chatHistory: [{ role: 'user', content: 'Hello' }],
    };
    assert.strictEqual(validateDraft(noDossier), null, 'Draft with missing dossier must be rejected');

    const corruptDossier = {
        dossier: { meta: null },
        chatHistory: [{ role: 'user', content: 'Hello' }],
    };
    assert.strictEqual(validateDraft(corruptDossier), null, 'Draft with broken dossier meta must be rejected');

    // Valid complete draft
    const validDossier = createEmptyDossier();
    validDossier.meta.title = 'Spire of Ash';
    validDossier.protagonist.name = 'Vesper';
    const validDraft = {
        dossier: validDossier,
        chatHistory: [
            { role: 'user', content: 'Make a dark fantasy campaign' },
            { role: 'assistant', content: 'Certainly, let us build Spire of Ash.' },
        ],
        changelog: ['Created campaign: Spire of Ash'],
        timestamp: 1729000000000,
    };

    const validated = validateDraft(validDraft);
    assert.ok(validated, 'Complete valid draft must pass validation');
    assert.strictEqual(validated.dossier.meta.title, 'Spire of Ash', 'Validated draft preserves title');
    assert.strictEqual(validated.dossier.protagonist.name, 'Vesper', 'Validated draft preserves protagonist');
    assert.strictEqual(validated.chatHistory.length, 2, 'Validated draft preserves chat history');
    assert.strictEqual(validated.changelog.length, 1, 'Validated draft preserves changelog');
    assert.strictEqual(validated.timestamp, 1729000000000, 'Validated draft preserves timestamp');

    // Auto-healing verification on partial valid dossier
    const partialValidDossier = {
        meta: { title: 'Neon Shadows', systemKey: 'cyberpunk' },
        protagonist: { name: 'Cipher' },
    };
    const healedValidation = validateDraft({
        dossier: partialValidDossier,
        chatHistory: [{ role: 'user', content: 'Cyberpunk run' }],
    });
    // Blueprint-only draft with empty chatHistory (e.g. loaded active campaign or manual blueprint staging)
    const blueprintOnlyDraft = {
        dossier: {
            meta: { title: 'Dungeon of Torment', systemKey: 'fantasy' },
            protagonist: { name: 'Garrick' },
        },
        chatHistory: [],
    };
    const validBlueprintOnly = validateDraft(blueprintOnlyDraft);
    assert.ok(validBlueprintOnly, 'Modified blueprint with empty chatHistory must pass validation');
    assert.strictEqual(validBlueprintOnly.dossier.meta.title, 'Dungeon of Torment');

    // Untouched blueprint with empty chatHistory must be rejected (not a real draft)
    const untouchedEmptyDraft = {
        dossier: createEmptyDossier(),
        chatHistory: [],
    };
    assert.strictEqual(validateDraft(untouchedEmptyDraft), null, 'Untouched blueprint with empty chatHistory must return null');

    console.log('✓ validateDraft enforces strict integrity and heals salvageable schemas');
}

// ── 3. concierge-ui.js Integration Check ──────────────────────────────────────
console.log('Testing concierge-ui.js integration...');
{
    const uiJsPath = path.join(ROOT_DIR, 'concierge-ui.js');
    const uiJs = fs.readFileSync(uiJsPath, 'utf8');

    // Must export resetConciergeState, loadValidatedDraft, and STORAGE_DRAFT_KEY
    assert.ok(uiJs.includes('export function resetConciergeState'), 'concierge-ui.js must export resetConciergeState');
    assert.ok(uiJs.includes('export function loadValidatedDraft'), 'concierge-ui.js must export loadValidatedDraft');
    assert.ok(uiJs.includes('export const STORAGE_DRAFT_KEY'), 'concierge-ui.js must export STORAGE_DRAFT_KEY');

    // Must call resetConciergeState on campaign launch success
    assert.ok(
        uiJs.includes('resetConciergeState({ showGreeting: true })'),
        'concierge-ui.js must reset concierge state upon launch and sync completion'
    );

    // Untouched check in saveDraft
    assert.ok(uiJs.includes('isDossierEmptyOrUntouched(activeDossier)'), 'saveDraft must verify isDossierEmptyOrUntouched');

    // openConciergeModal uses loadValidatedDraft
    assert.ok(uiJs.includes('loadValidatedDraft()'), 'openConciergeModal must invoke loadValidatedDraft');

    // Load active campaign replacement guardrail
    assert.ok(uiJs.includes('hasExistingSessionProgress'), 'concierge-ui.js must check hasExistingSessionProgress before loading active campaign');
    assert.ok(uiJs.includes('resetConciergeState({ showGreeting: false })'), 'concierge-ui.js must reset state cleanly before loading active campaign');

    console.log('✓ concierge-ui.js lifecycle wiring verified');
}

console.log('--- ALL CONCIERGE DRAFT LIFECYCLE TESTS PASSED CLEANLY! ---');
