/**
 * lorebook-select-cascade-guard.test.js — MultiHog Companion
 *
 * Verifies that:
 * 1. listAllWorldNames() is purely query-based and NEVER calls ctx.updateWorldInfoList()
 *    (preventing the destruction of Select2 option nodes in the Lorebooks tab).
 * 2. syncNameRagAdhocSysprompt() is idempotent and does not invoke saveSettingsDebounced()
 *    when sysprompt states and content are already up to date.
 * 3. ensureActiveChatRulesetConsistency() detects syspromptSnippetStates in partition setup
 *    and does not trigger repeated persistPbtaChatState() calls.
 */

import assert from 'node:assert';
import { listAllWorldNames } from '../campaign-lore-sync.js';
import { syncNameRagAdhocSysprompt } from '../namerag-hooks.js';
import { ensureActiveChatRulesetConsistency } from '../pbta-ruleset-persistence.js';

console.log('--- Running Lorebook Selection & Cascade Guard Test Suite ---');

// ── 1. listAllWorldNames must never mutate DOM via updateWorldInfoList ────────
console.log('Testing listAllWorldNames query safety...');
let updateWorldInfoListCalled = false;
const mockCtx = {
    world_names: ['Campaign_Fable_Lullaby', 'Fable_s_Lullaby_NPCs', 'Fable_s_Lullaby_Factions'],
    getWorldInfoNames: async () => ['Campaign_Fable_Lullaby', 'Fable_s_Lullaby_NPCs', 'Fable_s_Lullaby_Factions'],
    updateWorldInfoList: async () => {
        updateWorldInfoListCalled = true;
    },
};

const names = await listAllWorldNames(mockCtx);
assert.strictEqual(updateWorldInfoListCalled, false, 'listAllWorldNames must NEVER invoke ctx.updateWorldInfoList()');
assert.strictEqual(names.length, 3, 'Must return all 3 world names');
assert.ok(names.includes('Campaign_Fable_Lullaby'));
console.log('✓ listAllWorldNames operates purely as a passive query without mutating the World Info DOM');

// ── 2. syncNameRagAdhocSysprompt idempotency check ────────────────────────────
console.log('Testing syncNameRagAdhocSysprompt idempotency...');
let debouncedSaveCount = 0;
const mockSaveCtx = {
    saveSettingsDebounced: () => {
        debouncedSaveCount++;
    },
    extensionSettings: {
        rpg_tracker: {
            customSyspromptLibrary: [],
            syspromptSnippetDatabase: [],
        },
    },
};

// First call: should apply change and save once
await syncNameRagAdhocSysprompt(true, mockSaveCtx);
assert.strictEqual(debouncedSaveCount, 1, 'Initial sync must apply changes and schedule a debounced save');

// Second call with same state: must be a no-op and NOT save again
await syncNameRagAdhocSysprompt(true, mockSaveCtx);
assert.strictEqual(debouncedSaveCount, 1, 'Subsequent sync with identical state must NOT schedule a save');

// Third call disabling: should apply change and save
await syncNameRagAdhocSysprompt(false, mockSaveCtx);
assert.strictEqual(debouncedSaveCount, 2, 'Disabling must apply change and schedule save');

// Fourth call disabling again: must be a no-op and NOT save again
await syncNameRagAdhocSysprompt(false, mockSaveCtx);
assert.strictEqual(debouncedSaveCount, 2, 'Subsequent disable with identical state must NOT schedule a save');
console.log('✓ syncNameRagAdhocSysprompt is fully idempotent and eliminates save feedback loops');

// ── 3. ensureActiveChatRulesetConsistency partition snapshot stability ────────
console.log('Testing ensureActiveChatRulesetConsistency snapshot check...');
const chatId = 'chat_test_cascade_01';
const mockRpgSettings = {
    customSyspromptLibrary: [
        { id: 'pbta_base_override_combat', enabled: true, scope: 'chat', _chatSetupMember: true },
    ],
    chatStates: {
        [chatId]: {
            pbtaCampaignDossier: {
                meta: { title: 'Test World', systemKey: 'fantasy', systemLabel: 'Dungeon World' },
            },
            setup: {
                version: 3,
                syspromptSnippetStates: {
                    pbta_base_override_combat: true,
                },
            },
        },
    },
};

let persistCalled = false;
globalThis.SillyTavern = {
    getContext: () => ({
        saveSettingsDebounced: () => {
            persistCalled = true;
        },
        extensionSettings: {
            rpg_tracker: mockRpgSettings,
        },
    }),
};

await ensureActiveChatRulesetConsistency(chatId, mockRpgSettings);
assert.strictEqual(persistCalled, false, 'ensureActiveChatRulesetConsistency must not persist when setup already contains PbtA snippet states');
console.log('✓ ensureActiveChatRulesetConsistency recognizes existing syspromptSnippetStates and avoids save cascades');

console.log('--- ALL LOREBOOK SELECTION CASCADE GUARD TESTS PASSED CLEANLY! ---');
