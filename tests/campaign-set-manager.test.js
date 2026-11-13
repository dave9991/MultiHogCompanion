import assert from 'node:assert';
import {
    sanitizeCampaignPrefix,
    parsePartitionBookName,
    classifyLorebooks,
    classifyCartridges,
    deleteGameCartridges,
    MULTIHOG_PARTITIONS,
} from '../campaign-set-manager.js';

console.log('--- Testing Campaign Set Manager & Classification Engine ---');

// 1. Test sanitizeCampaignPrefix
assert.strictEqual(sanitizeCampaignPrefix('The Sunken Vault'), 'The_Sunken_Vault');
assert.strictEqual(sanitizeCampaignPrefix('Lou - FAE Gritty OSR Dungeon Crawl (Dark Fantasy Delve)'), 'Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve');
assert.strictEqual(sanitizeCampaignPrefix('Donald\'s First Stand'), 'Donald_s_First_Stand');
assert.strictEqual(sanitizeCampaignPrefix('___Triple__Underscore___'), 'Triple_Underscore');
console.log('✓ sanitizeCampaignPrefix tests passed');

// 2. Test parsePartitionBookName
const parsedLocations = parsePartitionBookName('The_Sunken_Vault_Locations');
assert.strictEqual(parsedLocations.isPartition, true);
assert.strictEqual(parsedLocations.prefix, 'The_Sunken_Vault');
assert.strictEqual(parsedLocations.partition, 'locations');

const parsedNPCs = parsePartitionBookName('Mariposa_Mutiny_NPCs');
assert.strictEqual(parsedNPCs.isPartition, true);
assert.strictEqual(parsedNPCs.prefix, 'Mariposa_Mutiny');
assert.strictEqual(parsedNPCs.partition, 'npcs');

const parsedNotPartition = parsePartitionBookName('Eldoria');
assert.strictEqual(parsedNotPartition.isPartition, false);

const parsedCampaignDossier = parsePartitionBookName('Campaign_The Sunken Vault');
assert.strictEqual(parsedCampaignDossier.isPartition, false);
console.log('✓ parsePartitionBookName tests passed');

// 3. Test classifyLorebooks
const mockWorldNames = [
    // The Sunken Vault (Healthy Set)
    'Campaign_The Sunken Vault',
    'The_Sunken_Vault_Locations',
    'The_Sunken_Vault_NPCs',
    'The_Sunken_Vault_Quests',

    // Lou - FAE (Misaligned Set)
    'Campaign_Lou\'s Adventure',
    'Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve_Locations',
    'Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve_NPCs',

    // Mariposa Mutiny (True Orphan Set)
    'Campaign_Mariposa Mutiny',
    'Mariposa_Mutiny_Canon',
    'Mariposa_Mutiny_Locations',
    'Mariposa_Mutiny_NPCs',
    'Mariposa_Mutiny_Quests',
    'Mariposa_Mutiny_Skeleton',

    // Stale Protagonist Dossiers (Orphans)
    'Campaign_Aelion Crown-Guard\'s Adventure',

    // Supergirl Character Book (Protected)
    'Supergirl\'s Lorebook',

    // Standalone Custom World (Protected)
    'Eldoria',
];

const mockGmChats = [
    {
        chatId: 'The Sunken Vault',
        chatTitle: 'The Sunken Vault',
        worldInfo: 'Campaign_The Sunken Vault',
    },
    {
        chatId: 'Lou - FAE Gritty OSR Dungeon Crawl (Dark Fantasy Delve)',
        chatTitle: 'Lou - FAE Gritty OSR Dungeon Crawl (Dark Fantasy Delve)',
        worldInfo: 'Campaign_Lou\'s Adventure', // Mismatched bound dossier
    },
];

const mockCharBoundBooks = [
    'Supergirl\'s Lorebook',
];

const report = classifyLorebooks({
    allWorldNames: mockWorldNames,
    gmChats: mockGmChats,
    characterBoundBooks: mockCharBoundBooks,
    otherCharChats: [],
});

// Verify Active Sets
assert.strictEqual(report.activeSets.length, 1, 'Should find 1 active healthy set');
const sunkenVault = report.activeSets[0];
assert.strictEqual(sunkenVault.chatTitle, 'The Sunken Vault');
assert.strictEqual(sunkenVault.dossierBooks.length, 1);
assert.strictEqual(sunkenVault.partitionBooks.length, 3);

// Verify Misaligned Sets
assert.strictEqual(report.misalignedSets.length, 1, 'Should find 1 misaligned set');
const louChat = report.misalignedSets[0];
assert.strictEqual(louChat.chatTitle, 'Lou - FAE Gritty OSR Dungeon Crawl (Dark Fantasy Delve)');
assert.strictEqual(louChat.isMisaligned, true);
assert.strictEqual(louChat.boundDossier, 'Campaign_Lou\'s Adventure');

// Verify Orphan Sets
const mariposa = report.orphanSets.find(o => o.prefix === 'Mariposa_Mutiny');
assert.ok(mariposa, 'Mariposa Mutiny orphan group must be identified');
assert.strictEqual(mariposa.books.length, 6, 'Mariposa Mutiny must include dossier and all partitions');

const aelion = report.orphanSets.find(o => o.prefix === 'Aelion_Crown_Guard_s_Adventure');
assert.ok(aelion, 'Stale protagonist dossier must be identified as orphan');

// Verify Protected Books
const supergirlProtected = report.protectedBooks.find(b => b.name === 'Supergirl\'s Lorebook');
assert.ok(supergirlProtected, 'Supergirl\'s Lorebook must be marked protected');
assert.strictEqual(supergirlProtected.reason, 'Bound to Character Card');

const eldoriaProtected = report.protectedBooks.find(b => b.name === 'Eldoria');
assert.ok(eldoriaProtected, 'Eldoria must be marked protected as custom world');

console.log('✓ classifyLorebooks correctly grouped active, misaligned, orphaned, and protected books');

// 4. Test classifyCartridges
const mockCartridges = [
    { id: 'pbta_cartridge', name: 'PbtA Narrative Engine (Fantasy (Dungeon World / Fellowship))' },
    { id: 'fae_cartridge', name: 'Freeform Attrition Engine (Gritty OSR Dungeon Crawl (Dark Fantasy Delve))' },
    { id: 'pbta_the_sunken_vault', name: 'PbtA: The Sunken Vault' },
    { id: 'fae_mariposa_mutiny', name: 'FAE: Mariposa Mutiny' },
    { id: 'pbta_concrete_case_files', name: 'PbtA: Concrete & Case Files' },
    { id: 'custom_homebrew_v1', name: 'My Custom Homebrew Pack' },
];

const cartReport = classifyCartridges({
    gameCartridges: mockCartridges,
    gmChats: mockGmChats,
    companionChatCartridges: {},
});

assert.strictEqual(cartReport.totalCartridgeCount, 6);
assert.strictEqual(cartReport.presetCartridges.length, 2, 'Should identify 2 reusable engine presets');
assert.strictEqual(cartReport.activeCartridges.length, 1, 'The Sunken Vault cartridge matches active chat');
assert.strictEqual(cartReport.activeCartridges[0].id, 'pbta_the_sunken_vault');
assert.strictEqual(cartReport.orphanCartridges.length, 2, 'Mariposa Mutiny & Concrete & Case Files have no active chat');
assert.ok(cartReport.orphanCartridges.some(c => c.id === 'fae_mariposa_mutiny'));
assert.ok(cartReport.orphanCartridges.some(c => c.id === 'pbta_concrete_case_files'));
assert.strictEqual(cartReport.customCartridges.length, 1, 'Custom homebrew cartridge must be preserved');
assert.strictEqual(cartReport.customCartridges[0].id, 'custom_homebrew_v1');
console.log('✓ classifyCartridges correctly categorized presets, active, orphaned, and custom cartridges');

// 5. Test deleteGameCartridges
let savedCalled = false;
const mockCtx = {
    extensionSettings: {
        rpg_tracker: {
            gameCartridges: [...mockCartridges],
        },
    },
    saveSettings: async () => { savedCalled = true; },
};

const delRes = await deleteGameCartridges(['fae_mariposa_mutiny', 'pbta_concrete_case_files'], mockCtx);
assert.strictEqual(delRes.deletedCount, 2, 'Should report 2 deleted cartridges');
assert.strictEqual(savedCalled, true, 'Should persist settings after deletion');
assert.strictEqual(mockCtx.extensionSettings.rpg_tracker.gameCartridges.length, 4, '4 cartridges should remain');
assert.ok(!mockCtx.extensionSettings.rpg_tracker.gameCartridges.some(c => c.id === 'fae_mariposa_mutiny'));
console.log('✓ deleteGameCartridges safely removes selected cartridges and persists settings');

console.log('--- ALL CAMPAIGN SET MANAGER TESTS PASSED CLEANLY! ---');
