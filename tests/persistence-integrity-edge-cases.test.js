import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    persistPbtaChatState,
    resetPersistTimerForTesting,
} from '../pbta-ruleset-persistence.js';
import {
    isChatClean,
    isAdventureActive,
} from '../adventure-chat.js';
import {
    verifyHistoryPointer,
    computeSha256Hex,
} from '../history-integrity-guard.js';
import {
    setupMockSillyTavern,
    resetMockGlobals,
} from './helpers/mock-context.js';

describe('Persistence & History Integrity Edge Cases', () => {

    beforeEach(() => {
        resetPersistTimerForTesting();
        setupMockSillyTavern();
    });

    afterEach(() => {
        resetPersistTimerForTesting();
        resetMockGlobals();
    });

    it('safely rejects empty or invalid chatId in persistPbtaChatState without error', async () => {
        // null, undefined, empty string
        await assert.doesNotReject(async () => {
            await persistPbtaChatState(null);
            await persistPbtaChatState('');
            await persistPbtaChatState(undefined);
        });
    });

    it('prevents re-entrant cross-contamination while an in-flight persist is active', async () => {
        const mockRpgSettings = {
            enabled: true,
            chatStateProjectionOwner: 'chat_alpha',
            setupSnapshots: {},
            customSyspromptLibrary: [],
            syspromptSnippetDatabase: [],
        };

        // First call initiates persist
        const p1 = persistPbtaChatState('chat_alpha', mockRpgSettings);

        // Immediate concurrent second call with a different chatId while in-flight
        await persistPbtaChatState('chat_beta', mockRpgSettings);

        await p1;

        // Verify that chat_beta was rejected and did not pollute snapshots
        assert.ok(!mockRpgSettings.setupSnapshots['chat_beta'], 'In-flight persist must not write for a concurrent secondary chatId');
    });

    it('accurately identifies clean unstarted chats vs active adventures', () => {
        assert.strictEqual(isChatClean({ chat: [] }), true);
        assert.strictEqual(isChatClean(null), true);
        assert.strictEqual(isAdventureActive(null, { chat: [] }), false);

        // Chat with just character's initial greeting (!is_user)
        const greetingOnlyCtx = {
            chat: [{ is_user: false, mes: 'Welcome to the tavern, traveler.' }]
        };
        assert.strictEqual(isChatClean(greetingOnlyCtx), true, 'Initial character greeting is considered clean unstarted chat');
        assert.strictEqual(isAdventureActive(null, greetingOnlyCtx), false);

        // Active chat where user has interacted and character is initialized
        const activeCtx = {
            chat: [
                { is_user: false, mes: 'Welcome to the tavern.' },
                { is_user: true, mes: 'I look around the room.' }
            ],
            extensionSettings: {
                rpg_tracker: {
                    enabled: true,
                    currentMemo: '[CHARACTER]\n- Kaelen (Ranger): 5/5 HP | Harm: 0/5'
                }
            }
        };
        assert.strictEqual(isChatClean(activeCtx), false);
        assert.strictEqual(isAdventureActive(null, activeCtx), true);
    });

    it('detects checksum mismatches and verifies valid history storage pointers', async () => {
        // 1. Missing pointer
        const noPointerRes = await verifyHistoryPointer(null);
        assert.strictEqual(noPointerRes.status, 'no_pointer');

        // 2. Mock payload with required schema (version 1) and hash
        const rawPayload = JSON.stringify({
            version: 1,
            memoHistory: [{ turn: 1, text: 'Day 1' }],
            dungeonMapHistory: []
        });
        const validHash = await computeSha256Hex(rawPayload);

        const customFetchOk = async () => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(rawPayload).buffer,
        });

        const okRes = await verifyHistoryPointer({
            url: '/user/files/multihog_history_chat01.json',
            sha256: validHash
        }, { fetchFn: customFetchOk });

        assert.strictEqual(okRes.status, 'ok');
        assert.strictEqual(okRes.expectedSha256, validHash);

        // 3. Mismatched payload checksum (valid JSON with different content)
        const tamperedPayload = JSON.stringify({
            version: 1,
            memoHistory: [{ turn: 2, text: 'Modified Turn Data' }],
            dungeonMapHistory: []
        });
        const tamperedFetch = async () => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(tamperedPayload).buffer,
        });

        const mismatchRes = await verifyHistoryPointer({
            url: '/user/files/multihog_history_chat01.json',
            sha256: validHash
        }, { fetchFn: tamperedFetch });

        assert.strictEqual(mismatchRes.status, 'checksum_mismatch');
        assert.notStrictEqual(mismatchRes.actualSha256, validHash);
    });

});
