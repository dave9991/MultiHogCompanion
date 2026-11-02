/**
 * fae-persistence.test.js
 *
 * Unit and integration tests for Freeform Attrition Engine (FAE) ruleset persistence,
 * Adventure Companion doc bridge interception, and cross-chat isolation between
 * FAE, PbtA, and factory D&D 5e.
 */

import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    isFaeActive,
    isFaeChat,
    isPbtAActive,
    isPbtaChat,
    getActiveRulesetId,
    formatRulesetBadge,
    ensureActiveChatRulesetConsistency,
    setCompanionActiveCartridge,
    getCompanionActiveCartridge,
    cleanseStockDndSettings,
    isLiveSettingsPollutedWithFae,
    containsFaeMarkers,
    collectRulesetDiagnostics,
} from '../pbta-ruleset-persistence.js';
import {
    detectActiveFaeGenre,
    appendFaeDocsToManual,
    setupCompanionDocInterceptor,
    teardownCompanionDocInterceptor,
} from '../pbta-companion-bridge.js';
import { FAE_GENRES, buildFaeCartridge } from '../fae-ruleset.js';
import { buildPbtACartridge } from '../pbta-ruleset.js';

// Setup Mock SillyTavern environment
let mockChatId = 'test_chat_fae_001';
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
        saveSettings: () => Promise.resolve(),
        saveSettingsDebounced: () => {},
        chatMetadata: {},
        saveMetadata: () => Promise.resolve(),
        saveMetadataDebounced: () => {},
    }),
};

describe('FAE Ruleset Persistence & Cross-Chat Isolation', () => {

    it('1. setCompanionActiveCartridge manages cartridgeId fae, pbta, and dnd5e with clean mutual exclusion', async () => {
        mockSettings = { chatStates: {} };
        mockCompSettings = { companionActiveCartridges: {} };

        // A. Set FAE active
        const faeChat = 'chat_fae_investigation';
        await setCompanionActiveCartridge(faeChat, {
            cartridgeId: 'fae',
            genre: 'cosmic_horror',
            systemLabel: 'Cosmic Horror Investigation',
        }, mockSettings, mockCompSettings);

        assert.strictEqual(isFaeActive(faeChat, mockSettings, mockCompSettings), true);
        assert.strictEqual(isFaeChat(faeChat, mockSettings, mockCompSettings), true);
        assert.strictEqual(isPbtAActive(faeChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isPbtaChat(faeChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(getActiveRulesetId(faeChat, mockSettings, mockCompSettings), 'fae');

        // B. Set PbtA active
        const pbtaChat = 'chat_pbta_delve';
        await setCompanionActiveCartridge(pbtaChat, {
            cartridgeId: 'pbta',
            genre: 'fantasy',
            systemLabel: 'Dungeon World',
        }, mockSettings, mockCompSettings);

        assert.strictEqual(isFaeActive(pbtaChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isFaeChat(pbtaChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isPbtAActive(pbtaChat, mockSettings, mockCompSettings), true);
        assert.strictEqual(isPbtaChat(pbtaChat, mockSettings, mockCompSettings), true);
        assert.strictEqual(getActiveRulesetId(pbtaChat, mockSettings, mockCompSettings), 'pbta');

        // C. Set D&D 5e active
        const dndChat = 'chat_dnd_sword_coast';
        await setCompanionActiveCartridge(dndChat, {
            cartridgeId: 'dnd5e',
            genre: 'fantasy',
            systemLabel: 'D&D 5e',
        }, mockSettings, mockCompSettings);

        assert.strictEqual(isFaeActive(dndChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isFaeChat(dndChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isPbtAActive(dndChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(isPbtaChat(dndChat, mockSettings, mockCompSettings), false);
        assert.strictEqual(getActiveRulesetId(dndChat, mockSettings, mockCompSettings), 'dnd5e');
    });

    it('2. isFaeActive and isFaeChat accurately identify FAE partitions without explicit cartridge stamp', () => {
        mockCompSettings = { companionActiveCartridges: {} };
        const s = {
            chatStates: {
                // Partition A: faeCampaignDossier
                chat_fae_dossier: {
                    faeCampaignDossier: {
                        meta: { title: 'Mouth of Madness', systemKey: 'cosmic_horror' },
                    },
                },
                // Partition B: pbtaCampaignDossier with ruleset: 'fae'
                chat_fae_ruleset_meta: {
                    pbtaCampaignDossier: {
                        meta: { ruleset: 'fae', title: 'Derelict Station' },
                    },
                },
                // Partition C: setup syspromptSnippetStates with fae_ prefix
                chat_fae_setup: {
                    setup: {
                        syspromptSnippetStates: {
                            fae_base_override_combat: true,
                        },
                    },
                },
                // Partition D: memo with FAE markers
                chat_fae_memo: {
                    currentMemo: '[CHARACTER]\nProtagonist: 8/8 HP | FAE Knobs: Flee Grace: ON | Shift: 0\n((PILLS)) Positive Tags: Calm, Ex-Military\n[/CHARACTER]',
                },
                // Partition E: pure D&D partition
                chat_dnd_pure: {
                    currentMemo: '[CHARACTER]\nFighter: 12/12 HP | AC: 16 | STR 16\n[/CHARACTER]',
                },
            },
        };

        assert.strictEqual(isFaeActive('chat_fae_dossier', s, mockCompSettings), true);
        assert.strictEqual(isPbtAActive('chat_fae_dossier', s, mockCompSettings), false);

        assert.strictEqual(isFaeActive('chat_fae_ruleset_meta', s, mockCompSettings), true);
        assert.strictEqual(isPbtAActive('chat_fae_ruleset_meta', s, mockCompSettings), false);

        assert.strictEqual(isFaeActive('chat_fae_setup', s, mockCompSettings), true);
        assert.strictEqual(isPbtAActive('chat_fae_setup', s, mockCompSettings), false);

        assert.strictEqual(isFaeActive('chat_fae_memo', s, mockCompSettings), true);
        assert.strictEqual(isPbtAActive('chat_fae_memo', s, mockCompSettings), false);

        assert.strictEqual(isFaeActive('chat_dnd_pure', s, mockCompSettings), false);
        assert.strictEqual(isPbtAActive('chat_dnd_pure', s, mockCompSettings), false);
    });

    it('3. formatRulesetBadge returns appropriate color and label for FAE, PbtA, and D&D 5e', () => {
        const s = { chatStates: {} };
        const comp = { companionActiveCartridges: {} };

        // FAE badge
        comp.companionActiveCartridges['chat_fae_badge'] = {
            cartridgeId: 'fae',
            genre: 'cosmic_horror',
            systemLabel: 'Cosmic Horror',
        };
        const faeBadge = formatRulesetBadge('chat_fae_badge', s, 'cosmic_horror', comp);
        assert.strictEqual(faeBadge.isActive, true);
        assert.strictEqual(faeBadge.ruleset, 'fae');
        assert.strictEqual(faeBadge.displayLabel, 'Cosmic Horror');
        assert.ok(faeBadge.badgeText.includes('🕯️ FAE'));
        assert.ok(faeBadge.summaryHtml.includes('4dF Attrition'));
        assert.strictEqual(faeBadge.badgeStyle.color, '#e0b0ff');

        // PbtA badge
        comp.companionActiveCartridges['chat_pbta_badge'] = {
            cartridgeId: 'pbta',
            genre: 'fantasy',
            systemLabel: 'Dungeon World',
        };
        const pbtaBadge = formatRulesetBadge('chat_pbta_badge', s, 'fantasy', comp);
        assert.strictEqual(pbtaBadge.isActive, true);
        assert.strictEqual(pbtaBadge.ruleset, 'pbta');
        assert.strictEqual(pbtaBadge.displayLabel, 'Dungeon World');
        assert.ok(pbtaBadge.badgeText.includes('🎲 PbtA'));
        assert.strictEqual(pbtaBadge.badgeStyle.color, '#88ccff');

        // D&D 5e badge
        comp.companionActiveCartridges['chat_dnd_badge'] = {
            cartridgeId: 'dnd5e',
            genre: 'fantasy',
            systemLabel: 'D&D 5e',
        };
        const dndBadge = formatRulesetBadge('chat_dnd_badge', s, 'fantasy', comp);
        assert.strictEqual(dndBadge.isActive, false);
        assert.strictEqual(dndBadge.ruleset, 'dnd5e');
        assert.strictEqual(dndBadge.badgeText, '⚔️ D&D 5e Active');
        assert.strictEqual(dndBadge.badgeStyle.color, '#ffcc88');
    });

    it('4. isLiveSettingsPollutedWithFae identifies FAE pollution vectors', () => {
        // Clean
        assert.strictEqual(isLiveSettingsPollutedWithFae({}), false);

        // FAE stock prompts
        const faeStockPrompts = {
            stockPrompts: {
                character: 'Protagonist: 8/8 HP | FAE Knobs: Flee Grace: ON',
            },
        };
        assert.strictEqual(isLiveSettingsPollutedWithFae(faeStockPrompts), true);

        // FAE custom library snippets
        const faeSnippets = {
            customSyspromptLibrary: [
                { id: 'fae_base_override_combat', enabled: true },
            ],
        };
        assert.strictEqual(isLiveSettingsPollutedWithFae(faeSnippets), true);

        // FAE cyoaConfig
        const faeCyoa = {
            cyoaConfig: {
                useCustomPrompt: true,
                customPromptText: '[SUBFOOTER: INTERACTIVE CHOICE BUTTONS]\nFORMATTING FAE CHOICES:\n',
            },
        };
        assert.strictEqual(isLiveSettingsPollutedWithFae(faeCyoa), true);
    });

    it('5. cleanseStockDndSettings cleanses both pbta_ and fae_ snippets and restores factory D&D 5e', async () => {
        const dirty = {
            customSyspromptLibrary: [
                { id: 'pbta_base_override_combat', enabled: true },
                { id: 'fae_base_override_combat', enabled: true },
                { id: 'user_custom_note', enabled: true },
            ],
            syspromptSnippetDatabase: [
                { id: 'pbta_base_override_combat' },
                { id: 'fae_base_override_combat' },
                { id: 'user_custom_note' },
            ],
            syspromptSectionOrder: [
                'lib:pbta_base_override_combat',
                'lib:fae_base_override_combat',
                'lib:user_custom_note',
            ],
            stockPrompts: {
                character: 'Protagonist: 8/8 HP | FAE Knobs: Flee Grace: ON',
            },
            syspromptModules: {
                role: false,
                combat: false,
                rng_system: false,
            },
            chatStates: {},
        };

        const result = await cleanseStockDndSettings(dirty, { chatId: 'chat_cleanse_test' });
        assert.strictEqual(result, true);

        // Both pbta_ and fae_ should be removed; user_custom_note preserved
        const remainingLibIds = dirty.customSyspromptLibrary.map(s => s.id);
        assert.deepStrictEqual(remainingLibIds, ['user_custom_note']);

        const remainingDbIds = dirty.syspromptSnippetDatabase.map(s => s.id);
        assert.deepStrictEqual(remainingDbIds, ['user_custom_note']);

        assert.deepStrictEqual(dirty.syspromptSectionOrder, ['lib:user_custom_note']);

        // Core D&D modules re-enabled
        assert.strictEqual(dirty.syspromptModules.role, true);
        assert.strictEqual(dirty.syspromptModules.combat, true);
        assert.strictEqual(dirty.syspromptModules.rng_system, true);

        // Neither PbtA nor FAE polluted
        assert.strictEqual(isLiveSettingsPollutedWithFae(dirty), false);
    });

    it('6. ensureActiveChatRulesetConsistency rehydrates FAE and cleanses cross-chat snippets', async () => {
        const faeChatId = 'chat_fae_rehydrate_01';
        const s = {
            customSyspromptLibrary: [
                // Lingering PbtA snippet from prior chat
                { id: 'pbta_base_override_combat', enabled: true },
            ],
            syspromptSectionOrder: ['lib:pbta_base_override_combat'],
            chatStates: {
                [faeChatId]: {
                    faeCampaignDossier: {
                        meta: { title: 'The Lost Crypt', systemKey: 'osr_dungeon', systemLabel: 'OSR Dungeon Delve' },
                    },
                },
            },
        };

        const comp = {
            companionActiveCartridges: {
                [faeChatId]: {
                    cartridgeId: 'fae',
                    genre: 'osr_dungeon',
                    systemLabel: 'OSR Dungeon Delve',
                },
            },
        };

        const activated = await ensureActiveChatRulesetConsistency(faeChatId, s, null, comp);
        assert.strictEqual(activated, true);

        // Verify fae_ snippets were rehydrated and pbta_ snippets were completely purged
        const libIds = s.customSyspromptLibrary.map(item => item.id);
        assert.ok(libIds.some(id => id.startsWith('fae_')), 'fae_ snippets must be present');
        assert.ok(!libIds.some(id => id.startsWith('pbta_')), 'pbta_ snippets must be completely purged');

        // Verify syspromptModules were configured for FAE (D&D systems disabled)
        assert.strictEqual(s.syspromptModules.saving_throws, false);
        assert.strictEqual(s.syspromptModules.attacks_per_round, false);

        // Verify stockPrompts were configured for FAE
        assert.ok(s.stockPrompts.character.includes('FAE Knobs:'));

        // Verify partition setup snapshot was written
        assert.ok(s.chatStates[faeChatId].setup);
        assert.strictEqual(s.chatStates[faeChatId].setup.syspromptSnippetStates['fae_base_override_combat'], true);
    });

    it('7. ensureActiveChatRulesetConsistency cleanses FAE snippets when switching back to pure D&D', async () => {
        const dndChatId = 'chat_dnd_return_01';
        const s = {
            customSyspromptLibrary: [
                { id: 'fae_base_override_combat', enabled: true },
            ],
            syspromptSectionOrder: ['lib:fae_base_override_combat'],
            stockPrompts: {
                character: 'Protagonist: 8/8 HP | FAE Knobs: Flee Grace: ON',
            },
            syspromptModules: {
                role: false,
                combat: false,
                rng_system: false,
            },
            chatStates: {
                [dndChatId]: {
                    characterName: 'Valeros',
                },
            },
        };

        const comp = {
            companionActiveCartridges: {
                [dndChatId]: {
                    cartridgeId: 'dnd5e',
                    genre: 'fantasy',
                    systemLabel: 'D&D 5e',
                },
            },
        };

        const activated = await ensureActiveChatRulesetConsistency(dndChatId, s, null, comp);
        assert.strictEqual(activated, false);

        // fae_ snippets purged
        assert.strictEqual(s.customSyspromptLibrary.some(item => item.id.startsWith('fae_')), false);
        // D&D core modules restored
        assert.strictEqual(s.syspromptModules.role, true);
        assert.strictEqual(s.syspromptModules.combat, true);
    });

    it('8. collectRulesetDiagnostics accurately reports FAE active status and candidate layers', () => {
        const faeChatId = 'chat_fae_diag';
        const s = {
            customSyspromptLibrary: [
                { id: 'fae_base_override_combat', enabled: true, scope: 'chat' },
            ],
            chatStates: {
                [faeChatId]: {
                    faeCampaignDossier: {
                        meta: { title: 'Cosmic Shadows', systemKey: 'cosmic_horror', systemLabel: 'Cosmic Horror' },
                        character: { name: 'Dr. John' },
                    },
                    currentMemo: '[CHARACTER]\nDr. John: 8/8 HP | FAE Knobs: Flee Grace: ON\n[/CHARACTER]',
                },
            },
        };

        const comp = {
            companionActiveCartridges: {
                [faeChatId]: {
                    cartridgeId: 'fae',
                    genre: 'cosmic_horror',
                    systemLabel: 'Cosmic Horror',
                },
            },
        };

        const report = collectRulesetDiagnostics(faeChatId, s, comp);
        assert.ok(report.includes('- **isFaeActive()**: `true`'));
        assert.ok(report.includes('- **isPbtAActive()**: `false`'));
        assert.ok(report.includes('🕯️ FAE (Cosmic Horror)'));
        assert.ok(report.includes('FAE Layer 1: Live customSyspromptLibrary fae_ snippets active'));
        assert.ok(report.includes('`faeCampaignDossier`: PRESENT'));
    });
});

describe('Adventure Companion FAE Documentation Bridge', () => {

    it('9. detectActiveFaeGenre detects FAE genre from overrides, pool markers, and defaults', () => {
        // Explicit override
        assert.strictEqual(detectActiveFaeGenre({ lastFaeGenre: 'weird_west' }), 'weird_west');
        assert.strictEqual(detectActiveFaeGenre({ genre: 'cyberpunk_noir' }), 'cyberpunk_noir');

        // Memo pool signatures
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Torch & Supplies: 6/6 (Zero Debuff: Pitch Black)' }),
            'osr_dungeon'
        );
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Ammo & Battery: 6/6 (Zero Debuff: Click on Empty)' }),
            'survival_horror'
        );
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Water & Filters: 6/6 (Zero Debuff: Dehydrated)' }),
            'post_apocalyptic'
        );
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Heat & Trace: 6/6 (Zero Debuff: Burned)' }),
            'cyberpunk_noir'
        );
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Oxygen & Power: 6/6 (Zero Debuff: Hypoxia)' }),
            'deep_space'
        );
        assert.strictEqual(
            detectActiveFaeGenre({ currentMemo: '((BAR:amber)) Trail Supplies: 6/6 (Zero Debuff: Parched)' }),
            'weird_west'
        );

        // Default fallback
        assert.strictEqual(detectActiveFaeGenre({}), 'cosmic_horror');
    });

    it('10. appendFaeDocsToManual constructs and appends FAE framework documentation', () => {
        const upstream = '# Upstream Manual\nFramework docs here.';
        const result = appendFaeDocsToManual(upstream, 'deep_space');

        assert.ok(result.startsWith(upstream));
        assert.ok(result.includes('# Freeform Attrition Engine (FAE) Framework Guide'));
        assert.ok(result.includes('Deep Space Derelict'));
        assert.ok(result.includes('Oxygen & Power'));
        assert.ok(result.includes('4dF Bell Curve'));
        assert.ok(result.includes('Two-Tier Pool Narration'));
    });

    it('11. setupCompanionDocInterceptor dynamically injects FAE or PbtA documentation based on active ruleset', async () => {
        const originalGlobalWindow = globalThis.window;
        let interceptedUrl = null;

        const fakeUpstreamResponse = new Response('# Upstream MultiHog Documentation\nUpstream content.', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/markdown' },
        });

        globalThis.window = {
            fetch: async (input) => {
                interceptedUrl = typeof input === 'string' ? input : input.url;
                if (interceptedUrl.includes('multihogDnDdoc.md')) {
                    return fakeUpstreamResponse.clone();
                }
                return new Response('Unrelated data', { status: 200 });
            },
        };

        setupCompanionDocInterceptor();

        try {
            // Case A: FAE active
            mockCompSettings.companionActiveCartridges = {
                [mockChatId]: {
                    cartridgeId: 'fae',
                    genre: 'survival_horror',
                    systemLabel: 'Survival Horror',
                },
            };

            const faeDocRes = await globalThis.window.fetch('/docs/multihogDnDdoc.md');
            const faeDocText = await faeDocRes.text();
            assert.ok(faeDocText.includes('# Freeform Attrition Engine (FAE) Framework Guide'), 'Must inject FAE guide when FAE is active');
            assert.ok(faeDocText.includes('Survival / Bio-Horror'), 'Must tailor to survival horror');

            // Case B: PbtA active
            mockCompSettings.companionActiveCartridges[mockChatId] = {
                cartridgeId: 'pbta',
                genre: 'western',
                systemLabel: 'Weird West PbtA',
            };

            const pbtaDocRes = await globalThis.window.fetch('/docs/multihogDnDdoc.md');
            const pbtaDocText = await pbtaDocRes.text();
            assert.ok(pbtaDocText.includes('# Powered by the Apocalypse (PbtA) Framework Guide'), 'Must inject PbtA guide when PbtA is active');
            assert.ok(pbtaDocText.includes('Core 2d6 Move Resolution'), 'Must contain 2d6 moves');
        } finally {
            teardownCompanionDocInterceptor();
            globalThis.window = originalGlobalWindow;
        }
    });
});
