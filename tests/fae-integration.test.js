import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    mhcGenerationInterceptor,
    applyFaeCartridge,
    restoreStockDnd,
    isFaeActive,
    isPbtAActive,
} from '../index.js';
import {
    FAE_GENRES,
    triggerEventOrRest,
    buildFaeRngBlock,
    createInitialFaeState,
} from '../fae-ruleset.js';
import {
    parseFaeStateFromMemo,
    formatFaeCharacterMemoBlock,
    formatInitialFaeMemo,
} from '../fae-state-sync.js';
import {
    setCompanionActiveCartridge,
    cleanseStockDndSettings,
} from '../pbta-ruleset-persistence.js';

test('FAE Integration Test Suite', async (t) => {
    // ── Test 1: mhcGenerationInterceptor RNG Injection ─────────────────────
    await t.test('mhcGenerationInterceptor replaces polyhedral RNG queue with FAE 4dF block when FAE is active, and preserves D&D chats', async () => {
        const dndChat = [
            {
                role: 'user',
                mes: `[RNG_QUEUE v6.3]\nturn_id=123456\n1: d20=14 d4=2 d6=5 d8=7 d10=3 d12=9\n2: d20=8 d4=1 d6=2 d8=4 d10=9 d12=11\n[/RNG_QUEUE]\n\nI investigate the ancient door.`,
            },
        ];

        // Ensure global state reflects D&D
        globalThis.extension_settings = {
            rpg_tracker: {
                customSyspromptLibrary: [],
                syspromptSnippetDatabase: [],
                syspromptModules: { role: true },
                stockPrompts: { character: 'D&D 5e Character' },
                chatStates: {},
            },
            multihog_companion: {},
        };
        globalThis.SillyTavern = {
            getContext: () => ({
                extensionSettings: globalThis.extension_settings,
                chatId: 'dnd_chat_1',
                getCurrentChatId: () => 'dnd_chat_1',
            }),
        };

        // When FAE is not active, interceptor must leave the message 100% untouched
        mhcGenerationInterceptor(dndChat);
        assert.ok(dndChat[0].mes.includes('[RNG_QUEUE v6.3]'), 'D&D chat queue must remain untouched');
        assert.ok(dndChat[0].mes.includes('d20=14'), 'D&D dice lines must remain intact');

        // Now activate FAE for a chat
        const faeChatId = 'fae_campaign_chat_1';
        globalThis.SillyTavern = {
            getContext: () => ({
                extensionSettings: globalThis.extension_settings,
                chatId: faeChatId,
                getCurrentChatId: () => faeChatId,
            }),
        };

        // Stamp active FAE cartridge in Companion settings and tracker
        await setCompanionActiveCartridge(faeChatId, {
            cartridgeId: 'fae',
            genre: 'cosmic_horror',
            systemLabel: 'Cosmic Horror Investigation',
        }, globalThis.extension_settings.rpg_tracker, globalThis.extension_settings.multihog_companion);

        globalThis.extension_settings.rpg_tracker.customSyspromptLibrary = [
            { id: 'fae_core_rules', enabled: true },
        ];
        globalThis.extension_settings.rpg_tracker.currentMemo = `[CHARACTER]
Thomas Blackwood (The Antiquarian): 6/8 HP | Pool: Health (6/8) | Scenes: 1/4 | XP: 1/4
((BAR:purple)) Sanity: 5/8 (Zero Debuff: Manic Dissociation | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Occult Lore (Forbidden knowledge), Service Revolver (.38)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        assert.strictEqual(isFaeActive(faeChatId), true, 'FAE must be detected as active');

        const faeChatMessages = [
            {
                role: 'user',
                mes: `[RNG_QUEUE v6.3]\nturn_id=789101\n1: d20=12 d4=3 d6=1 d8=6 d10=5 d12=8\n2: d20=19 d4=4 d6=6 d8=2 d10=1 d12=4\n[/RNG_QUEUE]\n\nI shine my flashlight toward the dark corridor.`,
            },
        ];

        mhcGenerationInterceptor(faeChatMessages);

        assert.ok(!faeChatMessages[0].mes.includes('[RNG_QUEUE v6.3]'), 'Upstream polyhedral queue must be stripped');
        assert.ok(faeChatMessages[0].mes.includes('[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]'), 'FAE 4dF queue header must be injected');
        assert.ok(faeChatMessages[0].mes.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'), 'Pre-computed matrix must be injected');
        assert.ok(faeChatMessages[0].mes.includes('Threat 1:'), 'Threat resolution lines must be present');
        assert.ok(faeChatMessages[0].mes.includes('Sanity (5/8): Positive Tags: ENABLED'), 'Active pools status must be evaluated in matrix');
        assert.ok(faeChatMessages[0].mes.includes('I shine my flashlight toward the dark corridor.'), 'User message prose must be preserved cleanly');
    });

    // ── Test 2: applyFaeCartridge and restoreStockDnd Round-Trip ─────────────
    await t.test('applyFaeCartridge and restoreStockDnd round-trip cleanly', async () => {
        const testChatId = 'fae_roundtrip_chat';
        globalThis.extension_settings = {
            rpg_tracker: {
                customSyspromptLibrary: [],
                syspromptSnippetDatabase: [],
                syspromptModules: { role: true, combat: true },
                stockPrompts: { character: 'D&D 5e Base' },
                gameCartridges: [],
                chatStates: {},
            },
            multihog_companion: {},
        };
        globalThis.SillyTavern = {
            getContext: () => ({
                extensionSettings: globalThis.extension_settings,
                chatId: testChatId,
                getCurrentChatId: () => testChatId,
            }),
        };

        // 1. Apply FAE Cartridge
        const applied = await applyFaeCartridge('survival_horror', {
            systemLabel: 'Survival Horror Slasher',
            knobs: {
                flee_grace_toggle: true,
                base_attrition_shift: 1,
                overflow_default: 'scar_and_ko',
            },
        });

        assert.strictEqual(applied, true, 'applyFaeCartridge must succeed');
        assert.strictEqual(isFaeActive(testChatId), true, 'Chat must report FAE active');

        const s = globalThis.extension_settings.rpg_tracker;
        assert.ok(s.customSyspromptLibrary.some(p => p.id === 'fae_base_override_role' && p.enabled), 'FAE base role override snippet must be enabled');
        assert.ok(s.stockPrompts.character.includes('Health'), 'FAE character stock prompt must contain Health');
        assert.ok(s.stockPrompts.character.includes('Nerve'), 'FAE character stock prompt must contain Nerve');
        assert.strictEqual(s.rngEnabled, true, 'RNG queue must be enabled');

        // 2. Restore Stock D&D 5e
        const restored = await restoreStockDnd();
        assert.strictEqual(restored, true, 'restoreStockDnd must succeed');
        assert.strictEqual(isFaeActive(testChatId), false, 'Chat must no longer report FAE active');

        assert.strictEqual(
            s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_')),
            false,
            'All fae_ snippets must be cleansed from customSyspromptLibrary'
        );
        assert.ok(
            !s.stockPrompts.character.includes('Nerve'),
            'FAE Nerve pool must be cleansed from character stock prompt'
        );
    });

    // ── Test 3: triggerEventOrRest + formatFaeCharacterMemoBlock for /mhc-fae-rest ──
    await t.test('triggerEventOrRest + formatFaeCharacterMemoBlock correctly processes rest tiers and passive drains for /mhc-fae-rest', () => {
        const initialMemo = `[CHARACTER]
Arthur Pendelton (The Antiquarian): 3/8 HP | Pool: Health (3/8) | Scenes: 2/4 | XP: 2/4
((BAR:purple)) Sanity: 4/8 (Zero Debuff: Manic Dissociation | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Occultist (Forbidden lore), Revolver (.38 caliber)
((PILLS)) Scars & Debuffs: (-) Winded
Status: Fatigued
[/CHARACTER]

[INVENTORY]
- Leather satchel
[/INVENTORY]`;

        const state = parseFaeStateFromMemo(initialMemo, 'cosmic_horror');
        assert.strictEqual(state.pools.health.current, 3);
        assert.strictEqual(state.pools.sanity.current, 4);

        // 1. Camp rest: restores 50% max to Health (4 HP healed: 3 + 4 = 7). Sanity is haven-only so it does not heal.
        const campResult = triggerEventOrRest(state, 'camp_or_sleep');
        assert.strictEqual(state.pools.health.current, 7, 'Camp rest should restore Health from 3 to 7');
        assert.strictEqual(state.pools.sanity.current, 4, 'Sanity should NOT heal during camp');
        assert.ok(campResult.summary.includes('Camp rest restored health to 7/8'), 'Summary logs camp recovery');

        // Re-format [CHARACTER] block
        const memoAfterCamp = formatFaeCharacterMemoBlock(state);
        assert.ok(memoAfterCamp.includes('7/8 HP | Pool: Health (7/8)'), 'Primary pool updated in memo block');
        assert.ok(memoAfterCamp.includes('Sanity: 4/8'), 'Sanity preserved in memo block');

        // 2. Day Pass: triggers passive drain on Sanity in cosmic_horror (-1 Sanity)
        const dayResult = triggerEventOrRest(state, 'day_pass');
        assert.strictEqual(state.pools.sanity.current, 3, 'Sanity should decrease by 1 from day_pass passive drain');
        assert.ok(dayResult.summary.includes('sanity (3/8 remaining)'), 'Summary logs Sanity passive drain');

        // 3. Haven recovery: fully restores all pools to max
        const havenResult = triggerEventOrRest(state, 'haven_or_specialist');
        assert.strictEqual(state.pools.health.current, 8, 'Health fully restored at Haven');
        assert.strictEqual(state.pools.sanity.current, 8, 'Sanity fully restored at Haven');
        assert.ok(havenResult.summary.includes('Haven recovery fully restored'), 'Summary logs full haven recovery');

        const memoAfterHaven = formatFaeCharacterMemoBlock(state);
        assert.ok(memoAfterHaven.includes('8/8 HP | Pool: Health (8/8)'));
        assert.ok(memoAfterHaven.includes('Sanity: 8/8'));
    });
});
