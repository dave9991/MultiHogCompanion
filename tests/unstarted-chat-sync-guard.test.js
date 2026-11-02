/**
 * unstarted-chat-sync-guard.test.js
 *
 * Verifies that MultiHog Companion's QoL sync features (relationship sync,
 * persona/portrait sync, PbtA ruleset persistence, CYOA Stage 2, and lorebook sync)
 * cleanly NO-OP on unstarted chats (e.g. brand new chats showing the onboarding /
 * "create an adventure" screen) and never produce false-positive tier crossover
 * narrative rewrites or toasts for NPCs from prior chats.
 */

import assert from 'assert';
import { isChatClean, isAdventureActive, ensureCleanAdventureChat } from '../adventure-chat.js';
import { scanAndInitUnsyncedNpcs, checkAndSyncTierCrossovers, getRelationshipSyncLedger } from '../relationship-narrative-sync.js';
import { isPbtAActive, ensureActiveChatRulesetConsistency } from '../pbta-ruleset-persistence.js';
import { purgeCampaignLorebooks } from '../campaign-lore-sync.js';

console.log('--- Running Unstarted Chat & QoL Sync Guard Test Suite ---');

// ── 1. Test isChatClean and isAdventureActive detection ─────────────────────
console.log('Testing isChatClean and isAdventureActive states...');

// State A: Empty chat array (new unstarted chat)
const emptyContext = {
    chat: [],
    chatId: 'new_unstarted_chat_001',
    extensionSettings: {
        rpg_tracker: {
            currentMemo: '',
            chatStates: {},
        },
    },
};
assert.strictEqual(isChatClean(emptyContext), true, 'Empty chat array must be clean');
assert.strictEqual(isAdventureActive(emptyContext.chatId, emptyContext), false, 'Empty chat must NOT be active adventure');

// State B: Only character card greeting (1 non-user message)
const greetingContext = {
    chat: [{ is_user: false, mes: 'Welcome, traveler. What brings you to these lands?' }],
    chatId: 'new_greeting_chat_002',
    extensionSettings: {
        rpg_tracker: {
            currentMemo: '',
            chatStates: {},
        },
    },
};
assert.strictEqual(isChatClean(greetingContext), true, 'Greeting-only chat must be clean');
assert.strictEqual(isAdventureActive(greetingContext.chatId, greetingContext), false, 'Greeting-only chat must NOT be active adventure');

// State C: Active chat with user message and valid MultiHog character memo
const activeContext = {
    chat: [
        { is_user: false, mes: 'Welcome, traveler.' },
        { is_user: true, mes: 'I am Thorne, an elven ranger.' },
    ],
    chatId: 'active_gameplay_chat_003',
    extensionSettings: {
        rpg_tracker: {
            currentMemo: '[CHARACTER]\nThorne: 5/5 HP | Harm: 0/5\n[/CHARACTER]',
            chatStates: {
                'active_gameplay_chat_003': {
                    currentMemo: '[CHARACTER]\nThorne: 5/5 HP | Harm: 0/5\n[/CHARACTER]',
                },
            },
        },
    },
};
assert.strictEqual(isChatClean(activeContext), false, 'Chat with user message must NOT be clean');
assert.strictEqual(isAdventureActive(activeContext.chatId, activeContext), true, 'Chat with user message and character memo MUST be active adventure');

console.log('✓ isChatClean and isAdventureActive state guards verified');

// ── 2. Test Relationship Sync on Unstarted Chat ──────────────────────────────
console.log('Testing Relationship Sync suppression on unstarted chats...');

const mockMetadata = {};
globalThis.SillyTavern = {
    getContext: () => ({
        chat: [{ is_user: false, mes: 'Greeting from card' }],
        chatId: 'new_chat_onboarding',
        getCurrentChatId: () => 'new_chat_onboarding',
        chat_metadata: mockMetadata,
        extensionSettings: {
            rpg_tracker: {
                npcRelationshipBars: true,
                currentMemo: '',
                // Stale values from prior chat sitting on root settings object
                npcRelationshipValues: {
                    'Eldoria_NPCs::1': { friendship: 40, affection: 15 },
                },
                chatStates: {},
            },
            multihog_companion: {
                enableRelationshipNarrativeSync: true,
                showToasts: true,
            },
        },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    }),
};

// Scan on unstarted chat: must immediately NO-OP
const unstartedScan = await scanAndInitUnsyncedNpcs();
assert.strictEqual(unstartedScan.scanned, 0, 'Unstarted chat must NOT scan lorebook NPCs');
assert.strictEqual(unstartedScan.initialized, 0, 'Unstarted chat must NOT initialize NPCs');

// Tier crossover check on unstarted chat: must immediately NO-OP
const unstartedTier = await checkAndSyncTierCrossovers();
assert.strictEqual(unstartedTier.checked, 0, 'Unstarted chat must NOT check tier crossovers');
assert.strictEqual(unstartedTier.updated, 0, 'Unstarted chat must NOT trigger narrative rewrites');

console.log('✓ Relationship Sync completely suppressed on unstarted chat');

// ── 3. Test Prior-Chat NPC Baseline Catchup (No False Positive Crossover) ────
console.log('Testing baseline catchup for unrecorded NPCs in active chats...');

// Now simulate an active chat where Eldoria_NPCs::1 exists in values but not in ledger
const activeMetadata = {};
let worldInfoEditCalled = false;

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [
            { is_user: false, mes: 'Card greeting' },
            { is_user: true, mes: 'First turn action' },
        ],
        chatId: 'active_session_001',
        getCurrentChatId: () => 'active_session_001',
        chat_metadata: activeMetadata,
        extensionSettings: {
            rpg_tracker: {
                npcRelationshipBars: true,
                currentMemo: '[CHARACTER]\nHero: 10/10 HP\n[/CHARACTER]',
                chatStateProjectionOwner: 'active_session_001',
                routerCampaignPrefix: 'Eldoria',
                npcRelationshipValues: {
                    'Eldoria_NPCs::1': { friendship: 35, affection: 10 },
                },
                chatStates: {
                    'active_session_001': {
                        currentMemo: '[CHARACTER]\nHero: 10/10 HP\n[/CHARACTER]',
                        routerCampaignPrefix: 'Eldoria',
                        npcRelationshipValues: {
                            'Eldoria_NPCs::1': { friendship: 35, affection: 10 },
                        },
                    },
                },
            },
            multihog_companion: {
                enableRelationshipNarrativeSync: true,
            },
        },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    }),
};

globalThis.fetch = async (url) => {
    if (url === '/api/worldinfo/edit') {
        worldInfoEditCalled = true;
    }
    return { ok: true, json: async () => ({ entries: {} }) };
};

// First run: NPC has no prior record in ledger.
// Must record baseline into ledger WITHOUT triggering Direction B rewrite (updated = 0)
const crossoverResult = await checkAndSyncTierCrossovers();
assert.strictEqual(crossoverResult.updated, 0, 'Must NOT trigger narrative rewrite for unrecorded NPC');
assert.strictEqual(worldInfoEditCalled, false, 'Must NOT write to World Info API');

const ledger = getRelationshipSyncLedger('active_session_001');
assert.ok(ledger['Eldoria_NPCs::1'], 'Ledger must now contain baseline record for NPC');
assert.strictEqual(ledger['Eldoria_NPCs::1'].initialized, true);
assert.strictEqual(ledger['Eldoria_NPCs::1'].lastSyncedTier.friendship, 'AMICABLE');
assert.strictEqual(ledger['Eldoria_NPCs::1'].initialSource, 'baseline_catchup');

console.log('✓ Baseline catchup successfully recorded without false crossover rewrite');

// ── 4. Test PbtA Ruleset Isolation on Unstarted Chat ────────────────────────
console.log('Testing PbtA Ruleset isolation when switching to unstarted chat...');

const stalePbtASettings = {
    customSyspromptLibrary: [
        { id: 'pbta_base_override_combat', enabled: true, scope: 'chat' },
    ],
    chatStateProjectionOwner: 'prior_pbta_chat',
    chatStates: {
        'prior_pbta_chat': {
            pbtaCampaignDossier: { meta: { title: 'Dungeon World' } },
        },
        'fresh_unstarted_chat': {},
    },
};

// isPbtAActive on fresh_unstarted_chat must NOT inherit PbtA from prior_pbta_chat's owner state
assert.strictEqual(
    isPbtAActive('fresh_unstarted_chat', stalePbtASettings),
    false,
    'Fresh unstarted chat must NOT inherit PbtA from prior chat projection owner'
);

// ensureActiveChatRulesetConsistency on fresh_unstarted_chat must return false
const consistencyResult = await ensureActiveChatRulesetConsistency('fresh_unstarted_chat', stalePbtASettings);
assert.strictEqual(
    consistencyResult,
    false,
    'ensureActiveChatRulesetConsistency must NOT stamp PbtA onto unstarted chat'
);

console.log('✓ PbtA ruleset isolation on unstarted chat verified cleanly');

// ── 5. Test Orphaned Campaign Lorebook & NPC Purge on Fresh Quick Start ─────
console.log('Testing Orphaned Campaign Lorebook & NPC Purge on Fresh Quick Start...');

const adventureTitle = 'Lou - FAE Gritty OSR Dungeon Crawl (Dark Fantasy Delve)';
const expectedStrictPrefix = 'Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve';
const targetNpcBook = `${expectedStrictPrefix}_NPCs`;
const targetLocBook = `${expectedStrictPrefix}_Locations`;
const unrelatedBook = 'Unrelated_Campaign_NPCs';

// Track deleted books and slash commands
const deletedBooksList = [];
const slashCommandsExecuted = [];

const mockFetch = async (url, options) => {
    if (url.includes('/api/worldinfo/delete')) {
        const body = JSON.parse(options?.body || '{}');
        deletedBooksList.push(body.name);
        return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
};
globalThis.fetch = mockFetch;

const mockWIList = [
    targetNpcBook,
    targetLocBook,
    unrelatedBook,
];

const mockWorldInfoCache = new Map([
    [targetNpcBook, { entries: { '1': { comment: 'Rats Vane' } } }],
    [unrelatedBook, { entries: { '1': { comment: 'Archmage' } } }],
]);

const mockSelectedWI = [
    targetNpcBook,
    unrelatedBook,
];

const mockPurgeCtx = {
    getWorldInfoNames: async () => mockWIList,
    executeSlashCommandsWithOptions: async (cmd) => {
        slashCommandsExecuted.push(cmd);
    },
    worldInfoCache: mockWorldInfoCache,
    selected_world_info: mockSelectedWI,
    updateWorldInfoList: async () => {},
};

// Set up live rpgSettings with stale keys referencing the deleted chat / lorebook
globalThis._rpgSettings = {
    activeRouterKeys: [
        `${targetNpcBook}::7`,
        `${expectedStrictPrefix}_NPCs::Rats Vane`,
        'OtherBook::1',
    ],
    activeWorldKeys: [
        `${targetNpcBook}::Rats Vane`,
    ],
    pinnedRouterKeys: [
        `${targetNpcBook}::7`,
    ],
    keywordActivatedKeys: [
        `${targetNpcBook}::Rats Vane`,
    ],
    campaignBooks: [
        targetNpcBook,
        targetLocBook,
        'OtherBook',
    ],
    routerHistory: [
        { chatId: adventureTitle, campaignPrefix: expectedStrictPrefix },
        { chatId: 'Unrelated Chat', campaignPrefix: 'Unrelated' },
    ],
    routerCampaignPrefix: expectedStrictPrefix,
    routerLog: [{ text: 'Stale turn log for Rats Vane' }],
    npcRelationshipValues: {
        [`${targetNpcBook}::Rats Vane`]: { friendship: 30, affection: 0 },
    },
    chatStates: {
        [adventureTitle]: { currentMemo: 'stale' },
    },
};

const purgedCount = await purgeCampaignLorebooks(adventureTitle, mockPurgeCtx);

// 1. Verify target matching & deletion
assert.strictEqual(purgedCount, 2, 'Must match and purge both candidate lorebooks for strict prefix');
assert.ok(deletedBooksList.includes(targetNpcBook), 'Must delete Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve_NPCs');
assert.ok(deletedBooksList.includes(targetLocBook), 'Must delete Lou_FAE_Gritty_OSR_Dungeon_Crawl_Dark_Fantasy_Delve_Locations');
assert.ok(!deletedBooksList.includes(unrelatedBook), 'Must NOT delete unrelated book');

// 2. Verify slash command deactivation
assert.ok(
    slashCommandsExecuted.some(cmd => cmd.includes(targetNpcBook) && cmd.includes('state=off')),
    'Must de-activate purged lorebook via /world state=off'
);

// 3. Verify selected_world_info and worldInfoCache eviction
assert.strictEqual(mockSelectedWI.includes(targetNpcBook), false, 'Must remove target book from selected_world_info');
assert.strictEqual(mockSelectedWI.includes(unrelatedBook), true, 'Must keep unrelated book in selected_world_info');
assert.strictEqual(mockWorldInfoCache.has(targetNpcBook), false, 'Must delete target book from worldInfoCache');
assert.strictEqual(mockWorldInfoCache.has(unrelatedBook), true, 'Must keep unrelated book in worldInfoCache');

// 4. Verify settings eviction
const s = globalThis._rpgSettings;
assert.deepStrictEqual(s.activeRouterKeys, ['OtherBook::1'], 'Must evict all keys matching strictPrefix or deleted books');
assert.deepStrictEqual(s.activeWorldKeys, [], 'Must evict activeWorldKeys');
assert.deepStrictEqual(s.pinnedRouterKeys, [], 'Must evict pinnedRouterKeys');
assert.deepStrictEqual(s.keywordActivatedKeys, [], 'Must evict keywordActivatedKeys');
assert.deepStrictEqual(s.campaignBooks, ['OtherBook'], 'Must filter campaignBooks');
assert.strictEqual(s.routerHistory.length, 1, 'Must remove routerHistory entries matching clean or strict prefix');
assert.strictEqual(s.routerHistory[0].chatId, 'Unrelated Chat');
assert.deepStrictEqual(s.routerLog, [], 'Must clear routerLog when active prefix matches purged prefix');

console.log('✓ Orphaned Campaign Lorebook & NPC Purge verified cleanly');

// ── 6. Test ensureCleanAdventureChat Orphaned State & Lorebook Purge ─────────
console.log('Testing ensureCleanAdventureChat orphaned state & lorebook purge...');

globalThis._rpgSettings = {
    activeRouterKeys: [`${targetNpcBook}::7`],
    activeWorldKeys: [`${targetNpcBook}::Rats Vane`],
    keywordActivatedKeys: [`${targetNpcBook}::Rats Vane`],
    routerLog: [{ text: 'stale' }],
    npcRelationshipValues: { [`${targetNpcBook}::Rats Vane`]: { friendship: 50 } },
    chatStates: { [adventureTitle]: { memo: 'stale' } },
};

let renamedTo = null;
const cleanAdventureCtx = {
    chat: [],
    characterId: 0,
    characters: [{ avatar: 'avatar.png' }],
    chatId: 'Game Master - 2026-11-02@12h00m',
    getCurrentChatId: () => 'Game Master - 2026-11-02@12h00m',
    executeSlashCommandsWithOptions: async (cmd) => {
        if (cmd.startsWith('/renamechat')) {
            renamedTo = cmd.match(/"([^"]+)"/)?.[1];
        }
    },
    getWorldInfoNames: async () => [targetNpcBook],
    updateWorldInfoList: async () => {},
    extensionSettings: {
        rpg_tracker: globalThis._rpgSettings,
        multihog_companion: {},
    },
};
globalThis.SillyTavern = { getContext: () => cleanAdventureCtx };

// Global fetch mock to simulate /api/characters/chats returning NO existing chat with adventureTitle
globalThis.fetch = async (url, options) => {
    if (url.includes('/api/characters/chats')) {
        return { ok: true, json: async () => ([{ file_id: 'Old Other Adventure' }]) };
    }
    if (url.includes('/api/worldinfo/delete')) {
        return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
};

const activeChatIdResult = await ensureCleanAdventureChat({ adventureTitle });
assert.strictEqual(renamedTo, adventureTitle, 'Must rename chat to adventureTitle');
assert.deepStrictEqual(globalThis._rpgSettings.activeRouterKeys, [], 'Must reset activeRouterKeys to empty');
assert.deepStrictEqual(globalThis._rpgSettings.npcRelationshipValues, {}, 'Must reset npcRelationshipValues to empty');
assert.strictEqual(globalThis._rpgSettings.chatStates[adventureTitle], undefined, 'Must purge chatStates[adventureTitle]');

// Scenario B: User already has a saved chat with this exact name and did not ask to wipe it.
// ensureCleanAdventureChat must advance to v2 so existing chat is preserved.
let versionRenamedTo = null;
const existingSavedChatCtx = {
    chat: [],
    characterId: 0,
    characters: [{ avatar: 'avatar.png' }],
    chatId: 'Game Master - 2026-11-02@14h00m',
    getCurrentChatId: () => 'Game Master - 2026-11-02@14h00m',
    executeSlashCommandsWithOptions: async (cmd) => {
        if (cmd.startsWith('/renamechat')) {
            versionRenamedTo = cmd.match(/"([^"]+)"/)?.[1];
        }
    },
    getWorldInfoNames: async () => [],
    updateWorldInfoList: async () => {},
    extensionSettings: {
        rpg_tracker: globalThis._rpgSettings,
        multihog_companion: {},
    },
};
globalThis.SillyTavern = { getContext: () => existingSavedChatCtx };

globalThis.fetch = async (url, options) => {
    if (url.includes('/api/characters/chats')) {
        return { ok: true, json: async () => ([{ file_id: adventureTitle }]) };
    }
    return { ok: true, json: async () => ({}) };
};

await ensureCleanAdventureChat({ adventureTitle });
assert.strictEqual(versionRenamedTo, `${adventureTitle} v2`, 'Must version chat to v2 when prior chat exists');

console.log('✓ ensureCleanAdventureChat fresh quick start purge and versioning verified cleanly');

console.log('--- ALL UNSTARTED CHAT & QOL SYNC GUARD TESTS PASSED CLEANLY! ---');
