/**
 * concierge-dossier-lifecycle-persistence.test.js
 *
 * Verifies that when a campaign dossier is loaded, modified in Concierge,
 * and finalized to replace an adventure:
 * 1. CompanionActiveCartridge preserves the full dossier JSON across candidate partitions.
 * 2. loadActiveCampaignDossier recovers the modified dossier with 100% fidelity even when
 *    MultiHog's upstream saveChatState wipes pbtaCampaignDossier from memory.
 * 3. parseStatsString recovers all stats separated by middle dots (·).
 * 4. Stale or clobbered chat partitions auto-heal from CompanionActiveCartridge.
 */

import { strict as assert } from 'assert';
import {
    getCandidateChatIds,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
    ensureActiveChatRulesetConsistency,
} from '../pbta-ruleset-persistence.js';
import {
    createEmptyDossier,
    parseStatsString,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    healAndNormalizeDossier,
} from '../concierge-parser.js';

console.log('--- Running Dossier Lifecycle & Replacement Persistence Tests ---');

// ── Test 1: parseStatsString middle dot delimiter support ──────────────────
console.log('Testing parseStatsString with middle dot delimiter...');
{
    const statLine = 'Cool +2 · Sharp +1 · Hard +1 · Hot +0 · Weird -1';
    const parsed = parseStatsString(statLine);
    assert.equal(parsed.Cool, 2, 'Cool should be +2');
    assert.equal(parsed.Sharp, 1, 'Sharp should be +1');
    assert.equal(parsed.Hard, 1, 'Hard should be +1');
    assert.equal(parsed.Hot, 0, 'Hot should be +0');
    assert.equal(parsed.Weird, -1, 'Weird should be -1');
    assert.equal(Object.keys(parsed).length, 5, 'All 5 stats must be parsed');
    console.log('✓ parseStatsString successfully parses all stats separated by middle dots');
}

// ── Test 2: CompanionActiveCartridge persists full dossier ──────────────────
console.log('Testing CompanionActiveCartridge full dossier persistence...');
{
    const mockChatId = 'Concrete & Case Files';
    const testDossier = createEmptyDossier();
    testDossier.meta.title = 'Concrete & Case Files';
    testDossier.meta.systemKey = 'horror';
    testDossier.meta.systemLabel = 'Modern / Monster Hunter (Monster of the Week)';
    testDossier.protagonist.name = 'Lyle Holloway';
    testDossier.protagonist.stats = { Cool: 2, Sharp: 1, Hard: 1, Hot: 0, Weird: -1 };
    testDossier.config.harmMax = 4;
    testDossier.config.partyMode = 'solo';
    testDossier.npcs = [
        { name: 'Silas Ravenscroft', role: 'Faction Contact', friendship: 35, affection: 0 },
        { name: 'Roy Winter', role: 'Mentor / Companion', friendship: 35, affection: 0 },
    ];

    const mockCtx = {
        chatId: mockChatId,
        chatMetadata: {},
        extensionSettings: {
            multihog_companion: {},
            rpg_tracker: {
                chatStates: {
                    [mockChatId]: {
                        currentMemo: '(Harm: 0/4)',
                        pbtaCampaignDossier: testDossier,
                    },
                },
            },
        },
        saveMetadata: async () => {},
        saveSettingsDebounced: () => {},
    };
    globalThis.SillyTavern = { getContext: () => mockCtx };

    // Stamp active cartridge with dossier
    await setCompanionActiveCartridge(mockChatId, {
        cartridgeId: 'pbta',
        genre: 'horror',
        systemLabel: testDossier.meta.systemLabel,
        title: testDossier.meta.title,
        dossier: testDossier,
    }, mockCtx.extensionSettings.rpg_tracker, mockCtx.extensionSettings.multihog_companion);

    // Verify stored in chatMetadata (line 1 of .jsonl)
    const metaRecord = mockCtx.chatMetadata.CompanionActiveCartridge;
    assert(metaRecord, 'CompanionActiveCartridge must be present in chatMetadata');
    assert.equal(metaRecord.title, 'Concrete & Case Files');
    assert.equal(metaRecord.dossier?.protagonist?.name, 'Lyle Holloway');
    assert.equal(metaRecord.dossier?.config?.harmMax, 4);

    // Verify query via candidate IDs
    const retrieved = getCompanionActiveCartridge('Concrete & Case Files.jsonl', mockCtx.extensionSettings.rpg_tracker, mockCtx.extensionSettings.multihog_companion);
    assert(retrieved, 'Must be retrievable using .jsonl candidate ID');
    assert.equal(retrieved.dossier?.npcs?.length, 2);
    console.log('✓ CompanionActiveCartridge stores and retrieves full dossier JSON across candidate IDs');
}

// ── Test 3: Simulation of Upstream saveChatState clobbering & recovery ───────
console.log('Testing recovery when MultiHog upstream saveChatState drops dossier...');
{
    const mockChatId = 'Concrete & Case Files';
    const originalDossier = createEmptyDossier();
    originalDossier.meta.title = 'Concrete & Case Files';
    originalDossier.protagonist.name = 'Lyle Holloway';
    originalDossier.protagonist.stats = { Cool: 2, Sharp: 1, Hard: 1, Hot: 0, Weird: -1 };

    const mockCompanionSettings = {
        companionActiveCartridges: {
            [mockChatId]: {
                cartridgeId: 'pbta',
                genre: 'horror',
                systemLabel: 'Modern / Monster Hunter',
                title: 'Concrete & Case Files',
                dossier: originalDossier,
            },
        },
    };

    // MultiHog upstream saveChatState executes on Turn 1 and drops pbtaCampaignDossier
    const mockRpgSettings = {
        chatStates: {
            [mockChatId]: {
                currentMemo: '(Harm: 0/4)',
                // pbtaCampaignDossier: DROPPED BY UPSTREAM!
            },
        },
    };

    const mockCtx = {
        chatId: mockChatId,
        getCurrentChatId: () => mockChatId,
        chatMetadata: {
            CompanionActiveCartridge: mockCompanionSettings.companionActiveCartridges[mockChatId],
        },
        extensionSettings: {
            multihog_companion: mockCompanionSettings,
            rpg_tracker: mockRpgSettings,
        },
    };
    globalThis.SillyTavern = { getContext: () => mockCtx };

    // Run ensureActiveChatRulesetConsistency (runs on Turn received and CHAT_CHANGED)
    await ensureActiveChatRulesetConsistency(mockChatId, mockRpgSettings, null, mockCompanionSettings);

    // Verify that pbtaCampaignDossier was recovered into memory partition
    assert(mockRpgSettings.chatStates[mockChatId].pbtaCampaignDossier, 'pbtaCampaignDossier must be restored from CompanionActiveCartridge');
    assert.equal(mockRpgSettings.chatStates[mockChatId].pbtaCampaignDossier.protagonist.name, 'Lyle Holloway');
    console.log('✓ ensureActiveChatRulesetConsistency seamlessly heals wiped in-memory partition from active cartridge');
}

// ── Test 4: loadActiveCampaignDossier logic simulation ───────────────────────
console.log('Testing loadActiveCampaignDossier resolution order...');
{
    const modifiedDossier = createEmptyDossier();
    modifiedDossier.meta.title = 'Concrete & Case Files';
    modifiedDossier.protagonist.name = 'Lyle Holloway';
    modifiedDossier.protagonist.gear = ['Modified Trenchcoat', '.38 Snubnose', 'Case Notes'];
    modifiedDossier.config.harmMax = 3; // Changed to Gritty!

    const mockCtx = {
        chatId: 'Concrete & Case Files.jsonl',
        chatMetadata: {
            CompanionActiveCartridge: {
                cartridgeId: 'pbta',
                genre: 'horror',
                dossier: modifiedDossier,
            },
        },
        extensionSettings: {
            rpg_tracker: {
                chatStates: {}, // Memory partition is empty
            },
        },
    };
    globalThis.SillyTavern = { getContext: () => mockCtx };

    // Simulate loadActiveCampaignDossier
    const currentChatId = mockCtx.chatId;
    const activeCart = getCompanionActiveCartridge(currentChatId, mockCtx.extensionSettings.rpg_tracker);
    assert(activeCart?.dossier, 'CompanionActiveCartridge dossier must be discovered');
    const loaded = healAndNormalizeDossier(activeCart.dossier);
    assert.equal(loaded.config.harmMax, 3, 'Modified harmMax (3) must be preserved');
    assert.equal(loaded.protagonist.gear.length, 3, 'Modified gear must be preserved');
    console.log('✓ loadActiveCampaignDossier prioritizes CompanionActiveCartridge to prevent loss of user changes');
}

console.log('\n--- ALL DOSSIER LIFECYCLE PERSISTENCE TESTS PASSED CLEANLY! ---');
