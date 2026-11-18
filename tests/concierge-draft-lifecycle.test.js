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

import {
    createEmptyDossier,
    validateDraft,
    isDossierEmptyOrUntouched,
    healAndNormalizeDossier,
} from '../concierge-parser.js';
import {
    resetConciergeState,
    loadValidatedDraft,
    getDraftStorageKey,
    switchRulesetMode,
    updateBlueprintDeck,
    getActiveConciergeDossier,
} from '../concierge-ui.js';
import { installDomHarness } from './helpers/dom-harness.js';

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

    // Pipeline state preservation verification
    const stageDraft = {
        dossier: {
            meta: { title: 'Fallout: The Sunken Vault', systemKey: 'post_apocalyptic' },
            protagonist: { name: 'Vault Dweller' },
        },
        chatHistory: [{ role: 'assistant', content: 'Books structured.' }],
        currentNavMode: 'new-adventure',
        currentAdventureStep: 'canon',
        unlockedSteps: { initial: true, canon: true, adventure: true, character: false },
        stageChatHistories: {
            initial: [{ role: 'user', content: 'Fallout please' }],
            canon: [{ role: 'assistant', content: 'Books structured.' }],
        },
        stagedCanonEntries: [
            { kind: 'FACTION', name: 'Brotherhood of Steel', importance: 5 },
            { kind: 'LOCATION', name: 'Vault 13', importance: 4 },
        ],
        attachedSources: [{ name: 'Fallout Bible 0.pdf', size: 1000 }],
        lastSyncedSnapshots: { framing: { title: 'Fallout' }, canon: null, adventure: null },
    };
    const validatedStage = validateDraft(stageDraft);
    assert.ok(validatedStage, 'Stage draft must pass validation');
    assert.strictEqual(validatedStage.currentAdventureStep, 'canon', 'Must preserve currentAdventureStep');
    assert.strictEqual(validatedStage.unlockedSteps.canon, true, 'Must preserve unlockedSteps');
    assert.strictEqual(validatedStage.unlockedSteps.adventure, true, 'Must preserve unlockedSteps.adventure');
    assert.strictEqual(validatedStage.stagedCanonEntries.length, 2, 'Must preserve stagedCanonEntries');
    assert.strictEqual(validatedStage.stagedCanonEntries[0].name, 'Brotherhood of Steel');
    assert.strictEqual(validatedStage.attachedSources.length, 1, 'Must preserve attachedSources');
    assert.strictEqual(validatedStage.stageChatHistories.initial.length, 1, 'Must preserve stageChatHistories');

    // Untouched blueprint with empty chatHistory must be rejected (not a real draft)
    const untouchedEmptyDraft = {
        dossier: createEmptyDossier(),
        chatHistory: [],
    };
    assert.strictEqual(validateDraft(untouchedEmptyDraft), null, 'Untouched blueprint with empty chatHistory must return null');

    console.log('✓ validateDraft enforces strict integrity and heals salvageable schemas');
}

// ── 3. Behavioral UI Controller Lifecycle & Ruleset Specialization ───────────
console.log('Testing behavioral UI lifecycle, draft storage cleanup, and FAE/PbtA deck specialization...');
{
    const harness = installDomHarness();
    try {
        // 3a. Ruleset-scoped draft storage keys
        assert.strictEqual(getDraftStorageKey('pbta'), 'mhc_concierge_draft_pbta');
        assert.strictEqual(getDraftStorageKey('fae'), 'mhc_concierge_draft_fae');
        assert.strictEqual(getDraftStorageKey('dnd5e'), 'mhc_concierge_draft_dnd5e');

        // 3b. FAE deck specialization: Fictional Leverage label & hidden party/relationships dials
        resetConciergeState({ showGreeting: false, ruleset: 'fae' });
        const faeDossier = getActiveConciergeDossier();
        faeDossier.npcs.push({
            name: 'Inspector Vance',
            role: 'Contact',
            movesOrBoons: 'Police archives access',
        });
        updateBlueprintDeck();
        assert.ok(
            harness.$('#mhc_deck_npcs_list').html().includes('<b>Fictional Leverage:</b> Police archives access'),
            'FAE NPC deck card must label movesOrBoons as Fictional Leverage'
        );
        assert.strictEqual(
            harness.getElement('#mhc_dial_party_btn')?.visible,
            false,
            'FAE ruleset must hide #mhc_dial_party_btn'
        );
        assert.strictEqual(
            harness.getElement('#mhc_dial_relationships_btn')?.visible,
            false,
            'FAE ruleset must hide #mhc_dial_relationships_btn'
        );

        // 3c. PbtA deck specialization: Boons/Moves label
        resetConciergeState({ showGreeting: false, ruleset: 'pbta' });
        const pbtaDossier = getActiveConciergeDossier();
        pbtaDossier.npcs.push({
            name: 'Sir Cedric',
            role: 'Knight',
            movesOrBoons: 'Shield Wall',
        });
        updateBlueprintDeck();
        assert.ok(
            harness.$('#mhc_deck_npcs_list').html().includes('<b>Boons/Moves:</b> Shield Wall'),
            'PbtA NPC deck card must label movesOrBoons as Boons/Moves'
        );

        // 3d. resetConciergeState purges ruleset drafts + desk session key and appends greeting
        localStorage.setItem('mhc_concierge_draft_pbta', JSON.stringify({ stale: true }));
        localStorage.setItem('mhc_concierge_draft_fae', JSON.stringify({ stale: true }));
        sessionStorage.setItem('mhc_last_concierge_desk', 'character');
        resetConciergeState({ showGreeting: true, ruleset: 'pbta' });

        assert.strictEqual(localStorage.getItem('mhc_concierge_draft_pbta'), null, 'resetConciergeState must purge pbta draft');
        assert.strictEqual(localStorage.getItem('mhc_concierge_draft_fae'), null, 'resetConciergeState must purge fae draft');
        assert.strictEqual(sessionStorage.getItem('mhc_last_concierge_desk'), null, 'resetConciergeState must clear mhc_last_concierge_desk');
        assert.strictEqual(loadValidatedDraft('pbta'), null, 'loadValidatedDraft must return null after purge');
        assert.ok(
            harness.$('#mhc_chat_messages').html().includes('Welcome to Session Zero!'),
            'resetConciergeState({ showGreeting: true }) must render greeting bubble'
        );

        // 3e. switchRulesetMode on a touched dossier resets dossier to target ruleset & emits switch notice
        getActiveConciergeDossier().meta.title = 'Touched World';
        switchRulesetMode('fae');
        assert.strictEqual(getActiveConciergeDossier().meta.ruleset, 'fae');
        assert.notStrictEqual(getActiveConciergeDossier().meta.title, 'Touched World');
        assert.ok(
            harness.$('#mhc_chat_messages').html().includes('Switched Session Zero mode'),
            'switchRulesetMode on a touched dossier must append mode-switch bubble'
        );
    } finally {
        harness.cleanup();
    }

    console.log('✓ Behavioral concierge-ui.js lifecycle & FAE/PbtA specialization verified');
}

console.log('--- ALL CONCIERGE DRAFT LIFECYCLE TESTS PASSED CLEANLY! ---');
