/**
 * pbta-ruleset-persistence.test.js
 *
 * Verifies that PbtA ruleset configuration survives page reloads (F5),
 * chat setup snapshotting, and chat switches, and that MultiHog's Chat Setup Link
 * does not revert PbtA games to factory D&D 5e.
 */

import assert from 'assert';
import {
    isPbtAActive,
    isPbtaChat,
    formatRulesetBadge,
    persistPbtaChatState,
    ensureActiveChatRulesetConsistency,
    logRulesetEvent,
    collectRulesetDiagnostics,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
} from '../pbta-ruleset-persistence.js';
import {
    applyChatSetup,
    snapshotChatSetup,
    syncChatSetupCatalogs,
} from '../../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js';
import { buildDefaultSettings } from '../../SillyTavern-MultihogDnDFramework/src/state/defaults.js';
import { buildPbtACartridge } from '../pbta-ruleset.js';

console.log('--- Running PbtA Ruleset & Reload Persistence Test Suite ---');

// Mock SillyTavern environment
let mockChatId = 'test_chat_pbta_001';
let mockSettings = {};
let mockCompSettings = {};

globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: {
            rpg_tracker: mockSettings,
            multihog_companion: mockCompSettings,
        },
        getCurrentChatId: () => mockChatId,
        chatId: mockChatId,
    }),
};

// ── 1. Test isPbtAActive & isPbtaChat detection layers ─────────────────────────
console.log('Testing isPbtAActive detection across multiple layers...');

// Scenario A: Fresh factory D&D settings
mockSettings = buildDefaultSettings();
mockSettings.chatStates = {};
mockChatId = 'chat_dnd_stock';

assert.strictEqual(isPbtAActive(mockChatId), false, 'Stock D&D must NOT be detected as PbtA');
assert.strictEqual(isPbtaChat(mockChatId), false, 'Stock D&D must NOT be detected as PbtA chat');

// Scenario B: PbtA snippets present in customSyspromptLibrary
mockSettings.customSyspromptLibrary = [
    { id: 'pbta_base_override_combat', enabled: true, scope: 'chat' },
];
assert.strictEqual(isPbtAActive(mockChatId), true, 'Live pbta_ snippet should trigger isPbtAActive');

// Scenario C: Live snippets reset to D&D (simulate MultiHog reset), but chat partition has pbtaCampaignDossier
mockSettings.customSyspromptLibrary = []; // Wiped!
mockChatId = 'chat_dungeon_world_01';
mockSettings.chatStates[mockChatId] = {
    pbtaCampaignDossier: {
        meta: { title: 'The Gloom Keep', systemKey: 'fantasy', systemLabel: 'Dungeon World' },
        protagonist: { name: 'Thorne', stats: { STR: '+1', DEX: '+2' } },
        config: { harmMax: 6 },
    },
};

assert.strictEqual(isPbtAActive(mockChatId), true, 'Partition pbtaCampaignDossier must identify as PbtA even if live library was wiped');
assert.strictEqual(isPbtaChat(mockChatId), true, 'Partition pbtaCampaignDossier must identify as PbtA chat');

// Scenario D: Partition setup has pbta snippet states
mockSettings.chatStates['chat_pbta_setup_only'] = {
    setup: {
        version: 3,
        syspromptSnippetStates: { pbta_base_override_combat: true },
    },
};
assert.strictEqual(isPbtAActive('chat_pbta_setup_only'), true, 'Partition setup syspromptSnippetStates must identify as PbtA');

// Scenario E: Memo vitality indicator
mockSettings.chatStates['chat_memo_only'] = {
    currentMemo: '[CHARACTER]\nThorne: 4/6 HP | Harm: 2/6\n[/CHARACTER]',
};
assert.strictEqual(isPbtAActive('chat_memo_only'), true, 'Memo Harm: X/Y format must identify as PbtA');

console.log('✓ isPbtAActive multi-layer detection verified across all 5 fallback layers');

// ── 2. Test persistPbtaChatState & Chat Setup Snapshotting ────────────────────
console.log('Testing persistPbtaChatState & Chat Setup snapshot persistence...');

const chatId = 'chat_dw_persist';
mockChatId = chatId;
mockSettings = buildDefaultSettings();
mockSettings.chatStates = {
    [chatId]: {
        pbtaCampaignDossier: {
            meta: { title: 'Shadows of the Deep', systemKey: 'fantasy', systemLabel: 'Dungeon World' },
            config: { harmMax: 6 },
        },
    },
};

// Install PbtA cartridge items into mockSettings
const cart = buildPbtACartridge('fantasy', { config: { harmMax: 6 } });
mockSettings.customSyspromptLibrary = cart.payload.customSyspromptLibrary.map(s => ({
    ...s,
    enabled: true,
    scope: 'chat',
    _chatSetupMember: true,
}));

// Run persistPbtaChatState
await persistPbtaChatState(chatId);

// Assert catalog database received the pbta snippets
assert.ok(Array.isArray(mockSettings.syspromptSnippetDatabase), 'syspromptSnippetDatabase must be an array');
const catalogCombatSnippet = mockSettings.syspromptSnippetDatabase.find(s => s.id === 'pbta_base_override_combat');
assert.ok(catalogCombatSnippet, 'PbtA combat override must be merged into syspromptSnippetDatabase');

// Assert per-chat setup was snapshotted
const savedSetup = mockSettings.chatStates[chatId].setup;
assert.ok(savedSetup, 'Chat partition must have a setup snapshot');
assert.strictEqual(savedSetup.syspromptSnippetStates?.['pbta_base_override_combat'], true, 'PbtA combat snippet state must be true in saved.setup');
assert.strictEqual(savedSetup.syspromptSnippetStates?.['pbta_base_override_role'], true, 'PbtA role snippet state must be true in saved.setup');

console.log('✓ persistPbtaChatState successfully wrote catalog entries and partition setup snapshot');

// ── 3. Simulate F5 Page Reload with MultiHog applyChatSetup ───────────────────
console.log('Testing simulation of F5 reload with MultiHog applyChatSetup...');

// On F5 reload:
// 1. Settings are loaded from storage (catalog and partition setup are intact).
// 2. MultiHog core boots and runs loadChatState(chatId).
// 3. MultiHog's chat-state-loader executes: applyChatSetup(s, saved.setup).
const reloadedSettings = {
    chatSetupCatalogVersion: 3,
    chatSetupLinkEnabled: true,
    syspromptSnippetDatabase: JSON.parse(JSON.stringify(mockSettings.syspromptSnippetDatabase)),
    trackerModuleDatabase: [],
    gameSystemDatabase: [],
    customSyspromptLibrary: [], // Fresh boot state
    chatStates: JSON.parse(JSON.stringify(mockSettings.chatStates)),
};

// Apply saved setup as MultiHog does on boot
const ok = applyChatSetup(reloadedSettings, reloadedSettings.chatStates[chatId].setup);
assert.ok(ok, 'applyChatSetup must return true on valid snapshot');

// Verify that reloadedSettings.customSyspromptLibrary hydrated the PbtA snippets WITH enabled: true
const hydratedCombat = reloadedSettings.customSyspromptLibrary.find(s => s.id === 'pbta_base_override_combat');
assert.ok(hydratedCombat, 'PbtA combat snippet must exist in rehydrated customSyspromptLibrary');
assert.strictEqual(hydratedCombat.enabled, true, 'PbtA combat snippet MUST remain enabled after applyChatSetup!');

console.log('✓ MultiHog applyChatSetup successfully retains active PbtA overrides on simulated F5 reload');

// ── 4. Test ensureActiveChatRulesetConsistency Rehydration Guard ───────────────
console.log('Testing ensureActiveChatRulesetConsistency automatic recovery guard...');

// Simulate a worst-case scenario: a chat partition with a PbtA dossier whose
// customSyspromptLibrary was completely wiped or reverted by stock reset.
mockSettings = buildDefaultSettings();
mockChatId = 'chat_rehydrate_guard';
mockSettings.chatStates = {
    [mockChatId]: {
        pbtaCampaignDossier: {
            meta: { title: 'Frozen Wastes', systemKey: 'scifi', systemLabel: 'Scifi Survival' },
            config: { harmMax: 5 },
            protagonist: { name: 'Kael', stats: { COOL: '+2', STEEL: '+1' } },
        },
    },
};
// live library is purely stock D&D (no pbta_ items)
mockSettings.customSyspromptLibrary = [];

const recovered = await ensureActiveChatRulesetConsistency(mockChatId);
assert.strictEqual(recovered, true, 'ensureActiveChatRulesetConsistency should report rehydration occurred');

// Verify that customSyspromptLibrary now has pbta_ overrides enabled
assert.ok(
    mockSettings.customSyspromptLibrary.some(p => p.id.startsWith('pbta_') && p.enabled),
    'ensureActiveChatRulesetConsistency must rehydrate active PbtA overrides into live library'
);
assert.strictEqual(isPbtAActive(mockChatId), true, 'Chat must now be active PbtA');

console.log('✓ ensureActiveChatRulesetConsistency cleanly restores cartridge when live settings are wiped');

// ── 5. Test formatRulesetBadge Formatting & System Labels ─────────────────────
console.log('Testing formatRulesetBadge badge text formatting...');

// Dungeon World explicit systemLabel
mockSettings = buildDefaultSettings();
mockChatId = 'chat_dw_badge';
mockSettings.chatStates = {
    [mockChatId]: {
        pbtaCampaignDossier: {
            meta: { title: 'Dungeon Run', systemKey: 'fantasy', systemLabel: 'Dungeon World' },
        },
    },
};
const dwBadge = formatRulesetBadge(mockChatId, mockSettings);
assert.strictEqual(dwBadge.isActive, true);
assert.strictEqual(dwBadge.badgeText, '🎲 PbtA (Dungeon World)');
assert.ok(dwBadge.summaryHtml.includes('Dungeon World'));

// Fantasy default (should cleanly extract Dungeon World from Fantasy (Dungeon World / Fellowship))
mockSettings.chatStates['chat_fantasy_default'] = {
    pbtaCampaignDossier: {
        meta: { title: 'Classic Fantasy', systemKey: 'fantasy' },
    },
};
const defaultBadge = formatRulesetBadge('chat_fantasy_default', mockSettings);
assert.strictEqual(defaultBadge.isActive, true);
assert.strictEqual(defaultBadge.badgeText, '🎲 PbtA (Dungeon World)');

// Stock D&D badge
mockSettings.customSyspromptLibrary = [];
mockChatId = 'chat_dnd';
mockSettings.chatStates['chat_dnd'] = {};
const dndBadge = formatRulesetBadge('chat_dnd', mockSettings);
assert.strictEqual(dndBadge.isActive, false);
assert.strictEqual(dndBadge.badgeText, '⚔️ D&D 5e Active');
assert.strictEqual(dndBadge.summaryHtml, 'MultiHog running factory D&D 5e ruleset');

console.log('✓ formatRulesetBadge produces accurate badge text and labels for Dungeon World and D&D');

// ── 6. Test Memo Vitality Sync & Setup Persistence Pipeline ──────────────────
console.log('Testing memo vitality sync and partition persistence pipeline...');
import { normalizePbtaMemo, syncLivePbtaMemoVitality } from '../pbta-vitality-sync.js';

mockChatId = 'chat_sync_test';
mockSettings = buildDefaultSettings();
mockSettings.chatStates = {
    [mockChatId]: {
        currentMemo: '[CHARACTER]\nKael: 5/5 HP | Harm: 1/6\n[/CHARACTER]',
    },
};
mockSettings.currentMemo = mockSettings.chatStates[mockChatId].currentMemo;

// 1. Normalize line with updated harm capacity 6
const normalized = normalizePbtaMemo(mockSettings.currentMemo);
assert.ok(normalized.includes('5/6 HP | Harm: 1/6'), 'Tandem HP must recalculate to 5/6 HP for Harm 1/6');

// 2. Sync live settings and partition
const didSync = syncLivePbtaMemoVitality(mockSettings, mockChatId);
assert.strictEqual(didSync, true, 'syncLivePbtaMemoVitality must report update applied');
assert.ok(mockSettings.currentMemo.includes('5/6 HP | Harm: 1/6'), 'Live currentMemo must be updated');
assert.ok(mockSettings.chatStates[mockChatId].currentMemo.includes('5/6 HP | Harm: 1/6'), 'Partition currentMemo must be updated');

// 3. Persist PbtA setup snapshot
mockSettings.customSyspromptLibrary = [
    { id: 'pbta_base_override_combat', enabled: true, scope: 'chat', _chatSetupMember: true },
];
await persistPbtaChatState(mockChatId, mockSettings);
assert.strictEqual(mockSettings.chatStates[mockChatId].setup?.syspromptSnippetStates?.['pbta_base_override_combat'], true);
console.log('✓ Memo vitality normalization and partition setup persistence pipeline verified');

// ── 7. Test Diagnostic Event Logging & Markdown Report Collection ────────────
console.log('Testing diagnostic event logging and collectRulesetDiagnostics report...');

logRulesetEvent('TEST_BOOT', { activeChatId: 'chat_diag_test' });
assert.ok(Array.isArray(globalThis._mhcRulesetEventLog));
assert.ok(globalThis._mhcRulesetEventLog.some(e => e.event === 'TEST_BOOT'));

mockChatId = 'chat_diag_test';
mockSettings = buildDefaultSettings();
mockSettings.chatStates = {
    [mockChatId]: {
        pbtaCampaignDossier: {
            meta: { title: 'Diagnostic Campaign', systemKey: 'fantasy', systemLabel: 'Dungeon World' },
            protagonist: { name: 'DiagHero', stats: { might: 1 } },
            config: { harmLimit: 6 },
        },
        setup: {
            version: 3,
            syspromptSnippetStates: { pbta_core: true },
        },
        currentMemo: '[CHARACTER]\nDiagHero: 5/6 HP | Harm: 1/6\n[/CHARACTER]',
    },
};

const diagReport = collectRulesetDiagnostics(mockChatId, mockSettings, { lastGenre: 'fantasy', enableRulesetDebug: true });
assert.ok(typeof diagReport === 'string');
assert.ok(diagReport.includes('MultiHog Companion — Ruleset & State Diagnostics'));
assert.ok(diagReport.includes('1. Chat Identification & Candidates'));
assert.ok(diagReport.includes('2. Ruleset Status & Detection Layers'));
assert.ok(diagReport.includes('3. MultiHog Framework Settings'));
assert.ok(diagReport.includes('4. MultiHog Partition Storage (chatStates)'));
assert.ok(diagReport.includes('5. Live MultiHog Control Room & Catalogs'));
assert.ok(diagReport.includes('6. MultiHog Companion Settings'));
assert.ok(diagReport.includes('7. Recent Ruleset & Reload Event Log'));
assert.ok(diagReport.includes('DiagHero'));
assert.ok(diagReport.includes('Diagnostic Campaign'));
assert.ok(diagReport.includes('TEST_BOOT'));
console.log('✓ Diagnostic event logging and collectRulesetDiagnostics verified cleanly');

// ── 8. Test Explicit CompanionActiveCartridge Registry ────────────────────────
console.log('Testing explicit CompanionActiveCartridge registry & auto-rehydration...');

const cartChatId = 'chat_cartridge_test_01';
const mockComp = { companionActiveCartridges: {} };

// Stamp PbtA
setCompanionActiveCartridge(cartChatId, {
    cartridgeId: 'pbta',
    genre: 'fantasy',
    systemLabel: 'Dungeon World',
    title: 'Cartridge Campaign',
}, null, mockComp);

const retrieved = getCompanionActiveCartridge(cartChatId, null, mockComp);
assert.strictEqual(retrieved.cartridgeId, 'pbta');
assert.strictEqual(retrieved.genre, 'fantasy');
assert.strictEqual(retrieved.systemLabel, 'Dungeon World');

// Global mock extension_settings and SillyTavern context for isPbtAActive test
globalThis.extension_settings = globalThis.extension_settings || {};
globalThis.extension_settings.multihog_companion = mockComp;
Object.assign(mockCompSettings, mockComp);

// Even with zero custom snippets and empty partitions in MultiHog:
const emptyRpgSettings = buildDefaultSettings();
emptyRpgSettings.chatStates = { [cartChatId]: {} };
assert.strictEqual(isPbtAActive(cartChatId, emptyRpgSettings), true, 'Explicit pbta cartridge must evaluate isPbtAActive as true even if MultiHog is wiped');
assert.strictEqual(isPbtaChat(cartChatId, emptyRpgSettings), true, 'Explicit pbta cartridge must evaluate isPbtaChat as true');

// Format badge using explicit cartridge
const cartBadge = formatRulesetBadge(cartChatId, emptyRpgSettings);
assert.strictEqual(cartBadge.isActive, true);
assert.strictEqual(cartBadge.badgeText, '🎲 PbtA (Dungeon World)');

// Ensure active chat consistency rehydrates cartridge
const rehydrated = await ensureActiveChatRulesetConsistency(cartChatId, emptyRpgSettings);
assert.strictEqual(rehydrated, true);
assert.ok(emptyRpgSettings.customSyspromptLibrary.some(p => p.id.startsWith('pbta_') && p.enabled), 'Rehydration must restore PbtA snippets');

// Stamp D&D 5e
setCompanionActiveCartridge(cartChatId, {
    cartridgeId: 'dnd5e',
}, null, mockComp);
assert.strictEqual(isPbtAActive(cartChatId, emptyRpgSettings), false, 'Explicit dnd5e cartridge must evaluate isPbtAActive as false');
const dndCartBadge = formatRulesetBadge(cartChatId, emptyRpgSettings);
assert.strictEqual(dndCartBadge.isActive, false);
assert.strictEqual(dndCartBadge.badgeText, '⚔️ D&D 5e Active');

console.log('✓ Explicit CompanionActiveCartridge registry and auto-rehydration verified cleanly');

console.log('\n--- ALL PBTA RULESET PERSISTENCE TESTS PASSED CLEANLY! ---');

