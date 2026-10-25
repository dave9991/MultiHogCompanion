import test from 'node:test';
import assert from 'node:assert';
import {
    getMultihogPlayerPortrait,
    getMultihogPlayerName,
    extractNameFromMemo,
} from '../persona-matching.js';
import { isAdventureActive } from '../adventure-chat.js';

test('Portrait Sync - Resolution Priority & Precedence', async (t) => {
    await t.test('1. Prioritizes customPortraits (manual upload/replacement) over stale playerCharacter.portraitSrc', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_1': {
                    playerCharacter: {
                        name: 'Elira',
                        portraitSrc: 'http://stale/old_generated.png',
                    },
                    customPortraits: {
                        'Elira': 'http://custom/manual_downloaded.png',
                    },
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_1', 'Elira');
        assert.strictEqual(resolved, 'http://custom/manual_downloaded.png', 'Should prioritize replaced custom portrait over stale initial portrait');
    });

    await t.test('2. Prioritizes customPortraits over stale pbtaCampaignDossier protagonist portrait', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_2': {
                    pbtaCampaignDossier: {
                        protagonist: {
                            name: 'Corbin',
                            portraitSrc: 'http://stale/comfy_gen.png',
                        },
                    },
                    customPortraits: {
                        'Corbin': 'http://custom/uploaded_art.png',
                    },
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_2', 'Corbin');
        assert.strictEqual(resolved, 'http://custom/uploaded_art.png');
    });

    await t.test('3. Falls back to dossier or playerCharacter when no customPortrait exists', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_3': {
                    playerCharacter: {
                        name: 'Kael',
                        portraitSrc: 'http://fresh/dossier_art.png',
                    },
                    customPortraits: {},
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_3', 'Kael');
        assert.strictEqual(resolved, 'http://fresh/dossier_art.png');
    });

    await t.test('4. Handles normalized name variants (case-insensitive, parenthetical descriptors, quotes)', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_4': {
                    customPortraits: {
                        'Garrick (The Bold)': 'http://custom/garrick.png',
                    },
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_4', 'garrick');
        assert.strictEqual(resolved, 'http://custom/garrick.png');
    });

    await t.test('5. Does NOT match arbitrary NPCs via loose prefix/substring (no false positives)', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_5': {
                    playerCharacter: {
                        name: 'Dan',
                        portraitSrc: 'http://correct/dan.png',
                    },
                    customPortraits: {
                        'Daniel the Blacksmith': 'http://npc/daniel.png',
                        'Town Guard': 'http://npc/guard.png',
                    },
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_5', 'Dan');
        // 'Dan' should NOT falsely match 'Daniel the Blacksmith' and should instead fall back to Dan's portraitSrc
        assert.strictEqual(resolved, 'http://correct/dan.png');
    });

    await t.test('6. Does NOT bleed global CHARACTER or PC keys into chats with different characters', () => {
        globalThis._rpgSettings = {
            // Global customPortraits has leftover CHARACTER from previous deleted character
            customPortraits: {
                'CHARACTER': 'http://old/stale_deleted_pc.png',
            },
            chatStates: {
                'chat_6': {
                    playerCharacter: {
                        name: 'Vesper',
                        portraitSrc: 'http://correct/vesper.png',
                    },
                    customPortraits: {},
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_6', 'Vesper');
        // Should NOT return the global CHARACTER portrait, but should find Vesper's portraitSrc
        assert.strictEqual(resolved, 'http://correct/vesper.png');
    });

    await t.test('7. Cache buster URL manipulation preserves type and file query params on thumbnails', () => {
        const updateSrcWithCacheBust = (src) => {
            if (!src) return src;
            try {
                const dummyBase = 'http://st.local';
                const parsed = new URL(src, dummyBase);
                parsed.searchParams.set('t', '123456');
                if (src.startsWith('http://') || src.startsWith('https://')) {
                    return parsed.href;
                }
                return parsed.pathname + parsed.search;
            } catch (_) {
                const sep = src.includes('?') ? '&' : '?';
                return `${src}${sep}t=123456`;
            }
        };

        const original = '/thumbnail?type=persona&file=1792076243144-LyleHolloway.png';
        const updated = updateSrcWithCacheBust(original);
        assert.strictEqual(updated, '/thumbnail?type=persona&file=1792076243144-LyleHolloway.png&t=123456');
        assert.ok(updated.includes('type=persona'), 'Must preserve type parameter');
        assert.ok(updated.includes('file='), 'Must preserve file parameter');
    });

    await t.test('8. Collects candidate names from [CHARACTER] memo block when customPortraits uses full name', () => {
        globalThis._rpgSettings = {
            chatStates: {
                'chat_8': {
                    playerCharacter: {
                        name: 'Elira',
                    },
                    currentMemo: '[CHARACTER]\nElira Vance (Rogue): 12/12 HP\n[/CHARACTER]',
                    customPortraits: {
                        'Elira Vance': 'http://custom/elira_vance.png',
                    },
                },
            },
        };

        const resolved = getMultihogPlayerPortrait('chat_8', 'Elira');
        assert.strictEqual(resolved, 'http://custom/elira_vance.png', 'Should resolve customPortraits key matching [CHARACTER] memo name');
    });

    await t.test('9. extractNameFromMemo strips MultiHog ((HP)) and ((BARGREEN)) markers', () => {
        const memoLeadingIcon = '[CHARACTER]\n((HP)) Edmund Wilson (Smuggler): 12/12 HP\n[/CHARACTER]';
        assert.strictEqual(extractNameFromMemo(memoLeadingIcon), 'Edmund Wilson');

        const memoInlineBar = '[CHARACTER]\nEdmund Wilson (Smuggler) ((BARGREEN)) 12/12\n[/CHARACTER]';
        assert.strictEqual(extractNameFromMemo(memoInlineBar), 'Edmund Wilson');

        const memoNameBarOnly = '[CHARACTER]\nEdmund Wilson ((BARGREEN)) 12/12\n[/CHARACTER]';
        assert.strictEqual(extractNameFromMemo(memoNameBarOnly), 'Edmund Wilson');
    });

    await t.test('10. Turn-0 Character Creator session (0 chat messages) is recognized by isAdventureActive and resolves portrait', () => {
        const chatId = 'Game Master - 2026-10-24@21h53m53s981ms';
        const rpgTracker = {
            chatStateProjectionOwner: chatId,
            currentMemo: '[CHARACTER]\nEdmund Wilson (Smuggler): 12/12 HP\n[/CHARACTER]',
            playerCharacter: {
                name: 'Edmund Wilson',
                bio: 'A seasoned smuggler.',
            },
            chatStates: {
                [chatId]: {
                    playerCharacter: {
                        name: 'Edmund Wilson',
                        bio: 'A seasoned smuggler.',
                    },
                    customPortraits: {
                        'Edmund Wilson': '/user/images/2026-10-24@21h58m06s662ms.png',
                    },
                },
            },
        };
        globalThis._rpgSettings = rpgTracker;
        const turnZeroCtx = {
            chat: [], // onboardingSendStarterMessage: false (no messages sent yet)
            chatId,
            getCurrentChatId: () => chatId,
            extensionSettings: {
                rpg_tracker: rpgTracker,
            },
        };

        assert.strictEqual(
            isAdventureActive(chatId, turnZeroCtx),
            true,
            'Turn-0 chat with Character Creator state owned by active chat must be recognized as active'
        );
        assert.strictEqual(getMultihogPlayerName(chatId, rpgTracker), 'Edmund Wilson');
        assert.strictEqual(
            getMultihogPlayerPortrait(chatId, 'Edmund Wilson', rpgTracker),
            '/user/images/2026-10-24@21h58m06s662ms.png'
        );
    });
});
