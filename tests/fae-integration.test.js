import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    mhcGenerationInterceptor,
    applyFaeCartridge,
    applyPbtACartridge,
    restoreStockDnd,
    isFaeActive,
    isPbtAActive,
    rectifyPostQuickStartState,
    syncCompanionDiceFunctionTools,
    syncActiveRulesetRngMode,
    getPendingFaeToolResolution,
    clearPendingFaeToolResolution,
} from '../index.js';
import {
    FAE_GENRES,
    triggerEventOrRest,
    buildFaeRngBlock,
    createInitialFaeState,
    executeFaeActionTool,
} from '../fae-ruleset.js';
import {
    parseFaeStateFromMemo,
    formatFaeCharacterMemoBlock,
    formatInitialFaeMemo,
    reconcileFaeMemoAfterTurn,
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

        // Turn 1: Adventure Start ("Begin the adventure.") -> Injects OPENING SCENE SETUP directive
        const openingChatMessages = [
            {
                role: 'user',
                is_user: true,
                mes: `[RNG_QUEUE v6.3]\nturn_id=789100\n1: d20=12 d4=3 d6=1 d8=6 d10=5 d12=8\n[/RNG_QUEUE]\n\nBegin the adventure. Character: Thomas Blackwood`,
            },
        ];

        mhcGenerationInterceptor(openingChatMessages);

        assert.ok(!openingChatMessages[0].mes.includes('[RNG_QUEUE v6.3]'), 'Upstream polyhedral queue must be stripped on Turn 1');
        assert.ok(openingChatMessages[0].mes.includes('[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]'), 'FAE 4dF queue header must be injected on Turn 1');
        assert.ok(openingChatMessages[0].mes.includes('[Pacing Directive (OPENING SCENE SETUP): This is the opening scene setup.'), 'Opening Scene Setup pacing directive must be injected on Turn 1');
        assert.ok(openingChatMessages[0].mes.includes('Begin the adventure. Character: Thomas Blackwood'), 'User message prose must be preserved cleanly');

        // Turn 2+: Ongoing adventure with prior assistant narrative turn -> Switches to normal tempo pacing
        const faeChatMessages = [
            {
                role: 'user',
                is_user: true,
                mes: 'Begin the adventure. Character: Thomas Blackwood',
            },
            {
                role: 'assistant',
                is_user: false,
                mes: 'The fog rolls across the Boston harbor docks as cold rain begins to fall.',
            },
            {
                role: 'user',
                is_user: true,
                mes: `[RNG_QUEUE v6.3]\nturn_id=789101\n1: d20=12 d4=3 d6=1 d8=6 d10=5 d12=8\n2: d20=19 d4=4 d6=6 d8=2 d10=1 d12=4\n[/RNG_QUEUE]\n\nI shine my flashlight toward the dark corridor.`,
            },
        ];

        mhcGenerationInterceptor(faeChatMessages);

        const currentTurnMsg = faeChatMessages[2];
        assert.ok(!currentTurnMsg.mes.includes('[RNG_QUEUE v6.3]'), 'Upstream polyhedral queue must be stripped');
        assert.ok(currentTurnMsg.mes.includes('[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]'), 'FAE 4dF queue header must be injected');
        assert.ok(currentTurnMsg.mes.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'), 'Pre-computed matrix must be injected');
        assert.ok(currentTurnMsg.mes.includes('Threat 1:'), 'Threat resolution lines must be present');
        assert.ok(currentTurnMsg.mes.includes('Sanity (5/8): Positive Tags: ENABLED'), 'Active pools status must be evaluated in matrix');
        assert.ok(currentTurnMsg.mes.includes('[Pacing Suggestion (slow_burn): Last pool test was 0 turn(s) ago.'), 'Live pacing suggestion must be included in RNG queue block on Turn 2+');
        assert.ok(!currentTurnMsg.mes.includes('OPENING SCENE SETUP'), 'Opening directive must not appear on Turn 2+');
        assert.ok(currentTurnMsg.mes.includes('I shine my flashlight toward the dark corridor.'), 'User message prose must be preserved cleanly');
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

    // ── Test 4: Quick Start Character Sanitization & Persona Rectification ────
    await t.test('rectifyPostQuickStartState repairs macro leakage, persona bio, and invalid persona bindings', async () => {
        const testSettings = {
            currentMemo: `[CHARACTER]
Character Name (The Hedge Cleric): 10/10 HP | Pool: Health (10/10) | Scenes: 0/4 | XP: 0/4
((BARBLUE)) Resolve: 6/6
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: redirect:Health
((PILLS)) Positive Tags: Herb Lore (Healing), Staff (Defense)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`,
            playerCharacter: {
                name: '{{user}}',
                bio: 'Species:\nEdward is a human hedge cleric.\n\nBackground:\nEdward serves the woodland folk.',
            },
            chatStates: {
                test_chat_quickstart: {
                    currentMemo: `[CHARACTER]
Edward (The Hedge Cleric): 10/10 HP | Pool: Health (10/10)
[/CHARACTER]`,
                    playerCharacter: {
                        name: 'Edward',
                        bio: 'Species: Edward is a human.',
                    },
                },
            },
        };

        const mockPowerUser = {
            personas: {
                avatar_1: '{{user}}',
                avatar_2: '**Lou**',
            },
            persona_descriptions: {
                '{{user}}': 'Old user bio',
                '**Lou**': 'Lou bio',
            },
            default_persona: '{{user}}',
        };

        const mockContext = {
            name1: '{{user}}',
            powerUser: mockPowerUser,
            extensionSettings: {
                rpg_tracker: testSettings,
            },
            chatId: 'test_chat_quickstart',
            getCurrentChatId: () => 'test_chat_quickstart',
        };

        globalThis.SillyTavern = {
            getContext: () => mockContext,
        };

        const resultName = await rectifyPostQuickStartState('Lou', testSettings);
        assert.strictEqual(resultName, 'Lou', 'Authoritative fallback name Lou preferred');

        // Verify currentMemo was repaired from "Character Name" to "Lou"
        assert.ok(testSettings.currentMemo.includes('Lou (The Hedge Cleric): 10/10 HP'));
        assert.ok(!testSettings.currentMemo.includes('Character Name'));

        // Verify playerCharacter name & bio repaired
        assert.strictEqual(testSettings.playerCharacter.name, 'Lou');
        assert.ok(testSettings.playerCharacter.bio.includes('Lou is a human hedge cleric'));
        assert.ok(!testSettings.playerCharacter.bio.includes('Edward is a human'));

        // Verify chatStates repaired
        const cs = testSettings.chatStates.test_chat_quickstart;
        assert.strictEqual(cs.playerCharacter.name, 'Lou');
        assert.ok(cs.currentMemo.includes('Lou (The Hedge Cleric): 10/10 HP'));
        assert.ok(!cs.currentMemo.includes('Edward (The Hedge Cleric)'));

        // Verify powerUser personas & default_persona repaired from {{user}}
        assert.strictEqual(mockPowerUser.personas.avatar_1, 'Lou');
        assert.strictEqual(mockPowerUser.personas.avatar_2, 'Lou');
        assert.strictEqual(mockPowerUser.default_persona, 'Lou');
        assert.strictEqual(mockContext.name1, 'Lou');
    });

    // ── Test 5: reconcileFaeMemoAfterTurn with toolResolvedState ────────────
    await t.test('reconcileFaeMemoAfterTurn accurately stamps toolResolvedState onto memo', () => {
        const initialMemo = `[CHARACTER]
Thomas Blackwood (The Antiquarian): 8/8 HP | Pool: Health (8/8)
((BAR:purple)) Sanity: 8/8
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: lethal | Tempo: slow_burn | Idle: 3t | Breather: READY
((PILLS)) Positive Tags: Ex-Military, Calm [under gunfire and shock]
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        // The LLM generated a turn, but hallucinated the pools or left them at 8/8 with Idle: 4t
        const llmGeneratedMemo = `[CHARACTER]
Thomas Blackwood (The Antiquarian): 8/8 HP | Pool: Health (8/8)
((BAR:purple)) Sanity: 8/8
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: lethal | Tempo: slow_burn | Idle: 4t | Breather: READY
((PILLS)) Positive Tags: Ex-Military, Calm [under gunfire and shock]
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        // But during the turn, the LLM had called resolve_fae_action, which resolved Sanity dropping to 0 (Clamp)
        const toolResolvedState = parseFaeStateFromMemo(initialMemo, 'cosmic_horror');
        toolResolvedState.pools.sanity.current = 0;
        toolResolvedState.character.negative_tags = ['Manic Dissociation'];
        toolResolvedState.character.temp_advantage = 'Tactical Opening';
        toolResolvedState.state_flags.turns_since_last_test = 0;

        const res = reconcileFaeMemoAfterTurn(initialMemo, llmGeneratedMemo, 'cosmic_horror', toolResolvedState);

        assert.strictEqual(res.changed, true, 'reconcileFaeMemoAfterTurn must mark changed when tool state differed');
        assert.ok(res.memo.includes('Sanity: 0/8'), 'Sanity must be stamped to 0/8');
        assert.ok(res.memo.includes('Idle: 0t'), 'Idle tempo counter must be stamped to 0t');
        assert.ok(res.memo.includes('Manic Dissociation'), 'Zero debuff from tool must be stamped onto memo');
        assert.ok(res.memo.includes('Advantage: Tactical Opening'), 'Temp advantage from stepping-stone tool call must be present');
        assert.strictEqual(res.state.pools.sanity.current, 0);
        assert.strictEqual(res.state.state_flags.turns_since_last_test, 0);
    });

    // ── Test 6: syncCompanionDiceFunctionTools Function Tool Call Registration ──
    await t.test('syncCompanionDiceFunctionTools manages resolve_fae_action and roll_pbta_move registration cleanly', async () => {
        const registeredTools = new Map();
        const testChatId = 'test_tool_reg_chat';
        const mockContext = {
            extensionSettings: {
                rpg_tracker: {
                    rngEnabled: true,
                    diceFunctionTool: true,
                    currentMemo: `[CHARACTER]
Thomas (The Antiquarian): 8/8 HP | Pool: Health (8/8)
((BAR:purple)) Sanity: 6/8
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: lethal
((PILLS)) Positive Tags: Calm [under gunfire and shock]
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`,
                    customSyspromptLibrary: [{ id: 'fae_core_rules', enabled: true }],
                    chatStates: {},
                },
                multihog_companion: { lastFaeGenre: 'cosmic_horror' },
            },
            chatId: testChatId,
            getCurrentChatId: () => testChatId,
            registerFunctionTool: (tool) => {
                registeredTools.set(tool.name, tool);
            },
            unregisterFunctionTool: (name) => {
                registeredTools.delete(name);
            },
        };

        globalThis.SillyTavern = { getContext: () => mockContext };
        globalThis.extension_settings = mockContext.extensionSettings;

        // 1. Activate FAE with diceFunctionTool = true
        await setCompanionActiveCartridge(testChatId, {
            cartridgeId: 'fae',
            genre: 'cosmic_horror',
            systemLabel: 'Cosmic Horror Investigation',
        }, mockContext.extensionSettings.rpg_tracker, mockContext.extensionSettings.multihog_companion);

        syncCompanionDiceFunctionTools();

        assert.ok(registeredTools.has('resolve_fae_action'), 'resolve_fae_action must be registered when FAE is active and diceFunctionTool is true');
        assert.ok(!registeredTools.has('roll_pbta_move'), 'roll_pbta_move must not be registered in FAE');

        // Execute the tool action
        clearPendingFaeToolResolution(testChatId);
        const faeTool = registeredTools.get('resolve_fae_action');
        const replyText = await faeTool.action({
            pool_at_risk: 'sanity',
            threat_level: 2,
            progress_scale: 'full',
            matched_positive_tags: ['Calm [under gunfire and shock]'],
            fixedDiceRoll: 0,
        });

        assert.ok(replyText.includes('INLINE ROLL'), 'Tool response must include INLINE ROLL directive');
        assert.ok(replyText.includes('OUTCOME TIER: POOL_STRAIN'), 'Tool response must reflect POOL_STRAIN');
        const pending = getPendingFaeToolResolution(testChatId);
        assert.ok(pending, 'Pending resolution must be stored in _pendingFaeToolResolutionByChat');
        assert.strictEqual(pending.state.pools.sanity.current, 5, 'Sanity should be 5/8 (6 - 1 attrition)');

        // 2. Switch to PbtA with diceFunctionTool = true
        await setCompanionActiveCartridge(testChatId, {
            cartridgeId: 'pbta',
            genre: 'fantasy',
            systemLabel: 'Fantasy PbtA',
        }, mockContext.extensionSettings.rpg_tracker, mockContext.extensionSettings.multihog_companion);
        mockContext.extensionSettings.rpg_tracker.customSyspromptLibrary = [{ id: 'pbta_core_rules', enabled: true }];

        syncCompanionDiceFunctionTools();

        assert.ok(!registeredTools.has('resolve_fae_action'), 'resolve_fae_action must be unregistered in PbtA');
        assert.ok(registeredTools.has('roll_pbta_move'), 'roll_pbta_move must be registered when PbtA is active and diceFunctionTool is true');

        const pbtaTool = registeredTools.get('roll_pbta_move');
        const pbtaReply = await pbtaTool.action({
            move_name: 'Hack & Slash',
            stat_name: 'Might',
            stat_mod: 2,
            forward_bonus: 0,
            fixed_d1: 5,
            fixed_d2: 4,
        });
        assert.ok(pbtaReply.includes('Strong Hit'), 'PbtA tool response must return Strong Hit (9 + 2 = 11)');

        // 3. Toggle diceFunctionTool = false
        mockContext.extensionSettings.rpg_tracker.diceFunctionTool = false;
        syncCompanionDiceFunctionTools();
        assert.ok(!registeredTools.has('resolve_fae_action'), 'resolve_fae_action must be unregistered when toolMode is false');
        assert.ok(!registeredTools.has('roll_pbta_move'), 'roll_pbta_move must be unregistered when toolMode is false');
    });

    // ── Test 7: mhcGenerationInterceptor in Tool Mode ───────────────────────
    await t.test('mhcGenerationInterceptor prepends pacing block in FAE toolMode and strips queue in PbtA toolMode', async () => {
        const testChatId = 'test_interceptor_tool_chat';
        const mockContext = {
            extensionSettings: {
                rpg_tracker: {
                    rngEnabled: true,
                    diceFunctionTool: true,
                    currentMemo: `[CHARACTER]
Thomas (The Antiquarian): 8/8 HP | Pool: Health (8/8)
((BAR:purple)) Sanity: 6/8
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: lethal | Tempo: slow_burn | Idle: 1t
((PILLS)) Positive Tags: Calm
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`,
                    customSyspromptLibrary: [{ id: 'fae_core_rules', enabled: true }],
                    chatStates: {},
                },
                multihog_companion: { lastFaeGenre: 'cosmic_horror' },
            },
            chatId: testChatId,
            getCurrentChatId: () => testChatId,
        };

        globalThis.SillyTavern = { getContext: () => mockContext };
        globalThis.extension_settings = mockContext.extensionSettings;

        await setCompanionActiveCartridge(testChatId, {
            cartridgeId: 'fae',
            genre: 'cosmic_horror',
            systemLabel: 'Cosmic Horror Investigation',
        }, mockContext.extensionSettings.rpg_tracker, mockContext.extensionSettings.multihog_companion);

        // FAE Turn: user message outside combat without [RNG_QUEUE] (with prior narrative turn)
        const faeChat = [
            { role: 'user', is_user: true, mes: 'Begin the adventure.' },
            { role: 'assistant', is_user: false, mes: 'You enter the dusty archive.' },
            { role: 'user', is_user: true, mes: 'I search the bookshelf carefully.' },
        ];
        mhcGenerationInterceptor(faeChat);

        const targetFaeMsg = faeChat[2];
        assert.ok(targetFaeMsg.mes.includes('[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]'), 'FAE pacing block must be prepended');
        assert.ok(targetFaeMsg.mes.includes('[Pacing Suggestion (slow_burn): Last pool test was 1 turn(s) ago.'), 'Pacing suggestion must be present');
        assert.ok(!targetFaeMsg.mes.includes('1: 4dF →'), 'Dice lines must be omitted in toolMode');
        assert.ok(!targetFaeMsg.mes.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'), 'Matrix must be omitted in toolMode');
        assert.ok(targetFaeMsg.mes.includes('I search the bookshelf carefully.'), 'User message prose must be preserved');

        // PbtA Turn: user message with upstream [RNG_QUEUE]
        await setCompanionActiveCartridge(testChatId, {
            cartridgeId: 'pbta',
            genre: 'fantasy',
            systemLabel: 'Fantasy PbtA',
        }, mockContext.extensionSettings.rpg_tracker, mockContext.extensionSettings.multihog_companion);
        mockContext.extensionSettings.rpg_tracker.customSyspromptLibrary = [{ id: 'pbta_core_rules', enabled: true }];

        const pbtaChat = [
            {
                role: 'user',
                is_user: true,
                mes: `[RNG_QUEUE v6.3]\nturn_id=111\n1: d20=10 d4=1 d6=2 d8=3 d10=4 d12=5\n[/RNG_QUEUE]\n\nI strike with my sword!`,
            },
        ];
        mhcGenerationInterceptor(pbtaChat);

        assert.ok(!pbtaChat[0].mes.includes('[RNG_QUEUE'), 'RNG queue must be completely stripped in PbtA toolMode');
        assert.strictEqual(pbtaChat[0].mes.trim(), 'I strike with my sword!', 'User message prose preserved cleanly');
    });

    // ── Test 8: syncActiveRulesetRngMode library update ─────────────────────
    await t.test('syncActiveRulesetRngMode updates customSyspromptLibrary when toggling diceFunctionTool', () => {
        const testChatId = 'test_rng_mode_sync_chat';
        const settings = {
            rngEnabled: true,
            diceFunctionTool: false,
            currentMemo: `[CHARACTER]
Thomas (The Antiquarian): 8/8 HP | Pool: Health (8/8)
((BAR:purple)) Sanity: 8/8
FAE Knobs: Flee Grace: ON | Shift: 0 | Overflow: lethal | Tempo: slow_burn
((PILLS)) Positive Tags: Calm
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`,
            customSyspromptLibrary: [
                { id: 'fae_base_override_rng', content: 'OLD RNG' },
                { id: 'fae_base_override_role', content: 'OLD ROLE' },
            ],
            syspromptSnippetDatabase: [
                { id: 'fae_base_override_rng', content: 'OLD RNG' },
                { id: 'fae_base_override_role', content: 'OLD ROLE' },
            ],
            chatStates: {},
        };

        const mockContext = {
            extensionSettings: {
                rpg_tracker: settings,
                multihog_companion: { lastFaeGenre: 'cosmic_horror' },
            },
            chatId: testChatId,
            getCurrentChatId: () => testChatId,
        };
        globalThis.SillyTavern = { getContext: () => mockContext };
        globalThis.extension_settings = mockContext.extensionSettings;

        // Toggle to true
        settings.diceFunctionTool = true;
        syncActiveRulesetRngMode(settings);

        const rngItem = settings.customSyspromptLibrary.find(p => p.id === 'fae_base_override_rng');
        const roleItem = settings.customSyspromptLibrary.find(p => p.id === 'fae_base_override_role');
        assert.ok(rngItem.content.includes('FUNCTION TOOL CALL RESOLUTION (resolve_fae_action)'));
        assert.ok(roleItem.content.includes('call resolve_fae_action()'));

        // Toggle to false
        settings.diceFunctionTool = false;
        syncActiveRulesetRngMode(settings);
        assert.ok(rngItem.content.includes('ZERO-MATH PRE-COMPUTED MATRIX'));
        assert.ok(roleItem.content.includes('check the Pre-Computed Turn Resolution Matrix'));
    });
});
