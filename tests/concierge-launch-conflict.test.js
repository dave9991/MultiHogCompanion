/**
 * concierge-launch-conflict.test.js
 *
 * Test suite for adventure name conflict resolution & version incrementing in MultiHog Companion:
 * 1. checkAdventureNameExists detects collisions case-insensitively and handles edge cases.
 * 2. findNextAdventureVersionName computes the next available version ("<Title> v2", "<Title> v3", etc.).
 * 3. purgeCampaignLorebooks targets all standard and dynamic campaign lorebooks.
 * 4. ensureCleanAdventureChat accepts wipeOldTitle for fresh restarts.
 */

import assert from 'node:assert';
import {
    checkAdventureNameExists,
    findNextAdventureVersionName,
    escapeRegex,
} from '../adventure-chat.js';
import { purgeCampaignLorebooks } from '../campaign-lore-sync.js';

console.log('--- Running Adventure Launch Conflict & Version Incrementing Tests ---');

// ── 1. checkAdventureNameExists Tests ─────────────────────────────────────────
console.log('Testing checkAdventureNameExists...');

const existingList = [
    'Shadows of the Citadel',
    'Shadows of the Citadel v2',
    'Curse of the Sunken Isles',
    'Lost Mines',
];

assert.strictEqual(
    checkAdventureNameExists('Shadows of the Citadel', existingList),
    true,
    'Exact match must detect conflict'
);

assert.strictEqual(
    checkAdventureNameExists('shadows of the citadel', existingList),
    true,
    'Case-insensitive match must detect conflict'
);

assert.strictEqual(
    checkAdventureNameExists('  Shadows of the Citadel  ', existingList),
    true,
    'Trimmed match must detect conflict'
);

assert.strictEqual(
    checkAdventureNameExists('Shadows of the Citadel v2', existingList),
    true,
    'Existing v2 must detect conflict'
);

assert.strictEqual(
    checkAdventureNameExists('Shadows of the Citadel v3', existingList),
    false,
    'Non-existing v3 must NOT report conflict'
);

assert.strictEqual(
    checkAdventureNameExists('A Brand New Tale', existingList),
    false,
    'Brand new title must NOT report conflict'
);

assert.strictEqual(
    checkAdventureNameExists('', existingList),
    false,
    'Empty title must safely return false'
);

assert.strictEqual(
    checkAdventureNameExists(null, existingList),
    false,
    'Null title must safely return false'
);

console.log('✓ checkAdventureNameExists passed all collision detection tests');

// ── 2. findNextAdventureVersionName Tests ─────────────────────────────────────
console.log('Testing findNextAdventureVersionName...');

// 2a. Simple single conflict -> v2
const nextA = findNextAdventureVersionName('Shadows of the Citadel', ['Shadows of the Citadel']);
assert.strictEqual(nextA, 'Shadows of the Citadel v2', 'Should produce v2 when base title exists');

// 2b. Conflict with both base and v2 -> v3
const nextB = findNextAdventureVersionName('Shadows of the Citadel', [
    'Shadows of the Citadel',
    'Shadows of the Citadel v2',
]);
assert.strictEqual(nextB, 'Shadows of the Citadel v3', 'Should produce v3 when v2 exists');

// 2c. Input is already versioned (e.g. user editing "Shadows of the Citadel v2") -> root is preserved
const nextC = findNextAdventureVersionName('Shadows of the Citadel v2', [
    'Shadows of the Citadel',
    'Shadows of the Citadel v2',
]);
assert.strictEqual(nextC, 'Shadows of the Citadel v3', 'Should correctly increment from a previously versioned name');

// 2d. Gap in versions: e.g. v2 and v4 exist -> increments to v5
const nextD = findNextAdventureVersionName('Shadows of the Citadel', [
    'Shadows of the Citadel',
    'Shadows of the Citadel v2',
    'Shadows of the Citadel v4',
]);
assert.strictEqual(nextD, 'Shadows of the Citadel v5', 'Should jump past highest existing version');

// 2e. Non-conflicting names in list -> only matching root counted
const nextE = findNextAdventureVersionName('Shadows of the Citadel', [
    'Curse of Strahd',
    'Curse of Strahd v2',
    'Shadows of the Citadel',
]);
assert.strictEqual(nextE, 'Shadows of the Citadel v2', 'Should not be influenced by versions of other titles');

// 2f. Special regex characters in title (parentheses, brackets, colons)
const nextF = findNextAdventureVersionName('Cyberpunk (Night City): 2077', [
    'Cyberpunk (Night City): 2077',
]);
assert.strictEqual(nextF, 'Cyberpunk (Night City): 2077 v2', 'Must safely escape regex special chars');

// 2g. Empty / fallback input
const nextG = findNextAdventureVersionName('', []);
assert.strictEqual(nextG, 'Adventure v2', 'Must provide a valid fallback if empty title provided');

console.log('✓ findNextAdventureVersionName passed all incrementation scenarios');

// ── 3. purgeCampaignLorebooks Target Identification Tests ─────────────────────
console.log('Testing purgeCampaignLorebooks target identification...');

// Mock SillyTavern context with known world names
const mockCtx = {
    getWorldInfoNames: async () => [
        'Shadows_of_the_Citadel_NPCs',
        'Shadows_of_the_Citadel_Factions',
        'Shadows_of_the_Citadel_Locations',
        'Shadows_of_the_Citadel_Quests',
        'Shadows_of_the_Citadel_Rules',
        'Shadows_of_the_Citadel_Skeleton',
        'Unrelated_Book',
        'Another_Campaign_NPCs',
    ],
    updateWorldInfoList: async () => {},
};

// Global fetch mock to observe deleted books
const deletedBooks = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (url.includes('/api/worldinfo/delete')) {
        const body = JSON.parse(options.body || '{}');
        deletedBooks.push(body.name);
        return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
};

try {
    const deletedCount = await purgeCampaignLorebooks('Shadows of the Citadel', mockCtx);
    assert.strictEqual(deletedCount, 6, 'Must target and delete exactly the 6 campaign lorebooks');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_NPCs'), 'Must delete NPCs book');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_Factions'), 'Must delete Factions book');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_Locations'), 'Must delete Locations book');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_Quests'), 'Must delete Quests book');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_Rules'), 'Must delete Rules book');
    assert.ok(deletedBooks.includes('Shadows_of_the_Citadel_Skeleton'), 'Must delete Skeleton book');
    assert.ok(!deletedBooks.includes('Unrelated_Book'), 'Must NOT touch unrelated books');
    assert.ok(!deletedBooks.includes('Another_Campaign_NPCs'), 'Must NOT touch other campaigns');
    console.log('✓ purgeCampaignLorebooks correctly targeted and cleaned all 6 campaign books');
} finally {
    globalThis.fetch = originalFetch;
}

console.log('--- ALL ADVENTURE LAUNCH CONFLICT TESTS PASSED CLEANLY! ---');
