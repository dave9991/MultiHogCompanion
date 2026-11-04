import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    FAE_CARTRIDGE_ID,
    FAE_GENRES,
    FAE_GENRE_SKELETONS,
    TEMPO_WINDOWS,
    isCompanionTag,
    getPacingSuggestion,
    rollFudgeDie,
    roll4dF,
    sanitizeFaePositiveTags,
    createInitialFaeState,
    applyPoolLoss,
    handleOverflow,
    triggerEventOrRest,
    resolveAction,
    buildFaeRngBlock,
    buildFaeCartridge,
    buildTailoredFaeDocumentation,
    toMultihogBarMarker,
    buildFaePartyContent,
    buildFaeConstraintsContent,
    buildFaeRoleContent,
    buildFaeCombatContent,
    buildFaeStockPrompts,
    buildFaeQuickStartInstructions,
    buildFaeRngContent,
    executeFaeActionTool,
} from '../fae-ruleset.js';
import {
    executePbtaMoveTool,
    buildPbtARngContent,
} from '../pbta-ruleset.js';
import {
    formatFaeCharacterMemoBlock,
    parseFaeStateFromMemo,
    reconcileFaeMemoAfterTurn,
    formatInitialFaeMemo,
    splitTopLevelPillItems,
    normalizeFaePillsLine,
    stripFaePartyBlockFromMemo,
} from '../fae-state-sync.js';

describe('Freeform Attrition Engine (FAE) — Core Mechanics & 4dF Dice', () => {
    test('rollFudgeDie produces -1, 0, or 1', () => {
        const results = new Set();
        for (let i = 0; i < 300; i++) {
            const die = rollFudgeDie();
            assert.ok([-1, 0, 1].includes(die), `Expected die to be -1, 0, or 1, got ${die}`);
            results.add(die);
        }
        assert.strictEqual(results.size, 3, 'Expected all 3 outcomes (-1, 0, 1) to be generated');
    });

    test('roll4dF returns a sum in -4..+4 and 4 individual dice', () => {
        for (let i = 0; i < 200; i++) {
            const { total, dice } = roll4dF();
            assert.strictEqual(dice.length, 4, 'Expected 4 dice');
            for (const d of dice) {
                assert.ok([-1, 0, 1].includes(d), `Die value ${d} out of range`);
            }
            const expectedSum = dice.reduce((a, b) => a + b, 0);
            assert.strictEqual(total, expectedSum, 'Total must equal sum of dice');
            assert.ok(total >= -4 && total <= 4, `Total ${total} must be within [-4, 4]`);
        }
    });

    test('TEMPO_WINDOWS and getPacingSuggestion accurately reflect Section 7 Pacing Triad', () => {
        assert.deepStrictEqual(TEMPO_WINDOWS.action_serial, { min: 0, max: 2, label: 'Action Serial (0-2t)' });
        assert.deepStrictEqual(TEMPO_WINDOWS.gritty_default, { min: 1, max: 4, label: 'Gritty Default (1-4t)' });
        assert.deepStrictEqual(TEMPO_WINDOWS.slow_burn, { min: 3, max: 7, label: 'Slow Burn (3-7t)' });
        assert.deepStrictEqual(TEMPO_WINDOWS.slice_of_life, { min: 6, max: 12, label: 'Slice of Life (6-12t)' });

        const state = createInitialFaeState('osr_dungeon'); // gritty_default: min 1, max 4
        state.state_flags.turns_since_last_test = 0;
        const sugg0 = getPacingSuggestion(state, false);
        assert.ok(sugg0.includes('Favor Threat 0 (no roll) and narrative breathing room'));

        state.state_flags.turns_since_last_test = 2;
        const sugg2 = getPacingSuggestion(state, false);
        assert.ok(sugg2.includes('On rhythm (2 turns since last test)'));

        state.state_flags.turns_since_last_test = 4;
        const sugg4 = getPacingSuggestion(state, false);
        assert.ok(sugg4.includes('introduce an external hook or complication'));

        // During active encounter, Threat 0 is NOT favored even when turns_since_last_test < min
        state.state_flags.turns_since_last_test = 0;
        const suggEnc = getPacingSuggestion(state, true);
        assert.ok(suggEnc.includes('On rhythm'));

        // Opening Scene Setup directive on Turn 1 / opening turn
        const openingDirective = '[Pacing Directive (OPENING SCENE SETUP): This is the opening scene setup. Do NOT roll dice or test any resource pools this turn — ignore the RNG queue above, establish the starting situation and immediate stakes, and hand the spotlight to {{user}}.] If the opening scene places the party at or inside an unmapped site (dungeon, ruin, building), call CreateAreaMap once before presenting choices.';
        assert.strictEqual(getPacingSuggestion(state, false, true), openingDirective);
        assert.strictEqual(getPacingSuggestion(state, false, { isOpeningTurn: true }), openingDirective);
        assert.strictEqual(getPacingSuggestion(state, { isOpeningTurn: true }), openingDirective);

        const openingState = createInitialFaeState('osr_dungeon');
        openingState.state_flags.is_opening_turn = true;
        assert.strictEqual(getPacingSuggestion(openingState, false), openingDirective);
    });

    test('isCompanionTag correctly identifies companion/retainer tags and zero-pool exemptions', () => {
        assert.strictEqual(isCompanionTag('Companion: Brother Marcus (Cleric)'), true);
        assert.strictEqual(isCompanionTag('retainer: Goblin Guide'), true);
        assert.strictEqual(isCompanionTag('Calm [under gunfire]'), false);
        assert.strictEqual(isCompanionTag('Heavy Shield'), false);
        assert.strictEqual(isCompanionTag(''), false);
        assert.strictEqual(isCompanionTag(null), false);
    });

    test('Companion tags and earned [Advantage] survive zero-pool penalty and advantage is preserved on retreat', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.health.current = 0;
        state.character.temp_advantage = 'High Ground';

        // 1. Retreating preserves temp_advantage and applies zero-pool debuff
        const retreatRes = resolveAction(state, {
            pool_name: 'health',
            threat_level: 2,
            progress_scale: 'full',
            matched_positive_tags: ['Companion: Brother Marcus', 'Heavy Shield'],
            is_retreating: true,
            fixedDiceRoll: 0,
        });
        assert.strictEqual(state.character.temp_advantage, 'High Ground', 'Advantage preserved on retreat');
        // Companion tag survives (1 effective tag), Heavy Shield ignored (personal tag at 0)
        assert.strictEqual(retreatRes.matched_positive_tags.length, 1);
        assert.strictEqual(retreatRes.matched_positive_tags[0], 'Companion: Brother Marcus');

        // 2. Active non-retreat action consumes temp_advantage even at 0 pool
        const attackRes = resolveAction(state, {
            pool_name: 'health',
            threat_level: 2,
            progress_scale: 'stepping_stone',
            matched_positive_tags: ['Companion: Brother Marcus', 'Heavy Shield'],
            is_retreating: false,
            fixedDiceRoll: 0,
        });
        assert.strictEqual(state.character.temp_advantage, 'Tactical Opening', 'stepping_stone grants new advantage');
        // Both companion tag AND earned advantage applied at zero pool!
        assert.ok(attackRes.matched_positive_tags.includes('Companion: Brother Marcus'));
        assert.ok(attackRes.matched_positive_tags.includes('[Advantage: High Ground]'));
        assert.ok(!attackRes.matched_positive_tags.includes('Heavy Shield'));
    });

    test('FAE_GENRES.cosmic_horror.defaultPositiveTags matches Section 4.1 Trait Qualification', () => {
        const expected = ['Ex-Military', 'Calm [under gunfire and shock]', 'Quiet', 'Service Revolver'];
        assert.deepStrictEqual(FAE_GENRES.cosmic_horror.defaultPositiveTags, expected);
        assert.deepStrictEqual(FAE_GENRE_SKELETONS.COSMIC_HORROR.defaultPositiveTags, expected);
        assert.deepStrictEqual(FAE_GENRE_SKELETONS.cosmic_horror.defaultPositiveTags, expected);
    });

    test('FAE_GENRES.osr_dungeon.defaultPositiveTags includes Brother Marcus companion tag', () => {
        assert.ok(
            FAE_GENRES.osr_dungeon.defaultPositiveTags.some(t => t.includes('Companion: Brother Marcus')),
            'Expected OSR Dungeon default positive tags to include Companion: Brother Marcus'
        );
    });

    test('sanitizeFaePositiveTags preserves compound and qualified tags without word-list stripping', () => {
        const raw = [
            '- Strong [for lifting or carrying]',
            '* Fast Draw',
            '• Lucky Coin (1 Use)',
            '+ Calm [under gunfire and shock]',
            'Service Revolver',
            'duplicate tag',
            'DUPLICATE TAG',
            'Extra Excluded Tag (exceeds maxTags)',
        ];
        const sanitized = sanitizeFaePositiveTags(raw, 5);
        assert.strictEqual(sanitized.length, 5);
        assert.deepStrictEqual(sanitized, [
            'Strong [for lifting or carrying]',
            'Fast Draw',
            'Lucky Coin (1 Use)',
            'Calm [under gunfire and shock]',
            'Service Revolver',
        ]);

        // String splitting preserves commas inside brackets and parentheses
        const strTags = 'Ex-Military, Strong [for lifting, hauling, or breaching doors], Quiet (Light footwork)';
        const fromStr = sanitizeFaePositiveTags(strTags, 5);
        assert.strictEqual(fromStr.length, 3);
        assert.strictEqual(fromStr[1], 'Strong [for lifting, hauling, or breaching doors]');

        // Companion and Retainer tags are exempt from the personal tag ceiling
        const mixedWithCompanions = [
            'Tag 1',
            'Tag 2',
            'Companion: Sister Valeria [Cleric]',
            'Tag 3',
            'Tag 4',
            'Retainer: Torchbearer',
            'Tag 5',
            'Tag 6 (exceeds personal cap)',
        ];
        const sanitizedMixed = sanitizeFaePositiveTags(mixedWithCompanions, 5);
        assert.strictEqual(sanitizedMixed.length, 7); // 5 personal tags + 2 companion tags
        assert.ok(sanitizedMixed.includes('Companion: Sister Valeria [Cleric]'));
        assert.ok(sanitizedMixed.includes('Retainer: Torchbearer'));
        assert.ok(!sanitizedMixed.includes('Tag 6 (exceeds personal cap)'));
    });

    test('FAE Prompts include Trait Qualification Protocol instructions and bracketed examples', () => {
        const constraints = buildFaeConstraintsContent();
        assert.ok(constraints.includes('The Trait Qualification Protocol (Cooperative Qualification)'));
        assert.ok(constraints.includes('Tier A — Auto-Qualify Broad Traits'));
        assert.ok(constraints.includes('Tier B — Remove Only True Omnipotence'));
        assert.ok(constraints.includes('Strong [for lifting, hauling, or breaching doors]'));

        const stock = buildFaeStockPrompts('cosmic_horror');
        assert.ok(stock.character.includes('Trait [context qualifier]'));
        assert.ok(stock.character.includes('Strong [for lifting, hauling, or breaching doors]'));
        assert.ok(stock.character.includes('Tier A Trait Qualification Protocol'));

        const quickStart = buildFaeQuickStartInstructions('cosmic_horror');
        assert.ok(quickStart.includes('Trait Qualification Protocol'));
        assert.ok(quickStart.includes('Strong [for lifting, hauling, or breaching doors]'));
        assert.ok(quickStart.includes('Calm [under gunfire and shock]'));

        const rng = buildFaeRngContent();
        assert.ok(rng.includes('Strong [for lifting, hauling, or breaching doors]'));
        assert.ok(rng.includes('Calm [under gunfire and shock]'));
    });
});

describe('Freeform Attrition Engine (FAE) — Section 8 Deterministic Spec Walkthrough', () => {
    test('Turn 1: Escaping the Murder of Crows (Threat 2, 0 Attrition -> UNFAZED_PROGRESS)', () => {
        // Spec 8.1: Arthur Pendelton in Cosmic Horror
        const state = createInitialFaeState('cosmic_horror');
        state.pools.sanity.current = 3; // Sanity: 3/8

        // Intent: Narrow/Bypass -> full. Threat: 2. Tags: Calm, Ex-Military. 4dF roll: 0.
        // Attrition = 2 + 0 - 2 = 0
        const result = resolveAction(state, {
            pool_name: 'sanity',
            threat_level: 2,
            progress_scale: 'full',
            matched_positive_tags: ['Calm', 'Ex-Military'],
            matched_negative_tags: [],
            is_retreating: true,
            fixedDiceRoll: 0,
        });

        assert.strictEqual(result.outcome, 'UNFAZED_PROGRESS');
        assert.strictEqual(result.attrition, 0);
        assert.strictEqual(result.pool_remaining, 3);
        assert.strictEqual(state.pools.sanity.current, 3);
        assert.ok(result.directive.includes('FULL RESOLUTION'));
        assert.ok(result.directive.includes('Cost: 0 sanity'));
    });

    test('Turn 2: Searching the Whispering Study (Threat 3, 4 Attrition -> BREAKING_POINT_CLAMP at 0)', () => {
        // Spec 8.2: Sanity at 3/8 takes 4 attrition -> drops to 0, clamps, adds Manic Dissociation
        const state = createInitialFaeState('cosmic_horror');
        state.pools.sanity.current = 3;

        // Intent: Total vs 2/2 HP -> stepping_stone. Threat: 3. Tag: Calm (1). 4dF: +2.
        // Attrition = 3 + 2 - 1 = 4.
        const result = resolveAction(state, {
            pool_name: 'sanity',
            threat_level: 3,
            progress_scale: 'stepping_stone',
            matched_positive_tags: ['Calm'],
            matched_negative_tags: [],
            is_retreating: false,
            fixedDiceRoll: 2,
        });

        assert.strictEqual(result.outcome, 'BREAKING_POINT_CLAMP');
        assert.strictEqual(result.attrition, 4);
        assert.strictEqual(result.remaining, 0);
        assert.strictEqual(state.pools.sanity.current, 0, 'Pool must be clamped at 0');
        assert.ok(state.character.negative_tags.includes('Manic Dissociation'), 'Must record zero_debuff');
        assert.ok(result.directive.includes('TRAUMA / BREAKING POINT'));
        assert.ok(state.character.temp_advantage !== null, 'Stepping-stone grants temporary advantage tag');
    });

    test('Turn 3: Fleeing at Zero with Flee Grace (Zero-State Tag Disabling & GRACE_RETREAT_WITH_SCAR)', () => {
        // Spec 8.3: Sanity at 0/8. Player flees. Flee Grace active.
        const state = createInitialFaeState('cosmic_horror');
        state.pools.sanity.current = 0;
        state.character.negative_tags = ['Manic Dissociation'];

        // Intent: Bypass -> full. Threat: 2. Tags passed: ['Calm'].
        // Because Sanity is at 0, Positive Tags are DISABLED (0 tags effective).
        // Negative tag: Manic Dissociation (+1). 4dF: -1.
        // Attrition = 2 - 1 - 0 + 1 = 2.
        const result = resolveAction(state, {
            pool_name: 'sanity',
            threat_level: 2,
            progress_scale: 'full',
            matched_positive_tags: ['Calm'],
            matched_negative_tags: ['Manic Dissociation'],
            is_retreating: true,
            fixedDiceRoll: -1,
        });

        assert.strictEqual(result.outcome, 'GRACE_RETREAT_WITH_SCAR');
        assert.strictEqual(result.attrition, 2);
        assert.strictEqual(result.pool_remaining, 0);
        assert.strictEqual(state.pools.sanity.current, 0);
        assert.ok(result.directive.includes('Flee Grace active'));
        assert.ok(result.directive.includes('Do NOT trigger lethal overflow'));
        assert.ok(result.directive.includes('companion to sideline'));
    });
});

describe('Freeform Attrition Engine (FAE) — Pool Loss & Overflow Rules', () => {
    test('Case 0: amount <= 0 returns NO_LOSS without deducting points', () => {
        const state = createInitialFaeState('cosmic_horror');
        const res = applyPoolLoss(state, 'health', 0, 'Zero cost test');
        assert.strictEqual(res.outcome, 'NO_LOSS');
        assert.strictEqual(res.remaining, 8);
        assert.strictEqual(state.pools.health.current, 8);
    });

    test('Case C: POOL_STRAIN reduces pool when remaining > 0 without adding debuff', () => {
        const state = createInitialFaeState('cosmic_horror');
        const res = applyPoolLoss(state, 'health', 3, 'Graze');
        assert.strictEqual(res.outcome, 'POOL_STRAIN');
        assert.strictEqual(res.attrition, 3);
        assert.strictEqual(res.remaining, 5);
        assert.strictEqual(state.pools.health.current, 5);
        assert.strictEqual(state.character.negative_tags.length, 0);
        assert.ok(res.directive.includes('STRAIN ONLY'));
    });

    test('Case A: BREAKING_POINT_CLAMP clamps pool at 0 and adds zero_debuff', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.pools.health.current = 4;
        const res = applyPoolLoss(state, 'health', 6, 'Heavy strike');
        assert.strictEqual(res.outcome, 'BREAKING_POINT_CLAMP');
        assert.strictEqual(res.attrition, 6);
        assert.strictEqual(res.remaining, 0);
        assert.strictEqual(state.pools.health.current, 0);
        assert.ok(state.character.negative_tags.includes('Crippled & Bleeding'));
    });

    test('Case B: handleOverflow with redirect cascades correctly (OSR Dungeon)', () => {
        const state = createInitialFaeState('osr_dungeon');
        // torch_and_supplies redirects to resolve; resolve redirects to health
        state.pools.torch_and_supplies.current = 0;
        state.pools.resolve.current = 5;

        // Drain 2 on torch_and_supplies while at 0 -> redirects 2 to resolve
        const res = applyPoolLoss(state, 'torch_and_supplies', 2, 'Starving');
        assert.strictEqual(res.outcome, 'POOL_STRAIN');
        assert.strictEqual(res.pool, 'resolve');
        assert.strictEqual(state.pools.resolve.current, 3);
        assert.strictEqual(state.pools.torch_and_supplies.current, 0);

        // When resolve is also at 0, redirects to health
        state.pools.resolve.current = 0;
        state.pools.health.current = 10;
        const res2 = applyPoolLoss(state, 'torch_and_supplies', 3, 'Deep darkness');
        assert.strictEqual(res2.outcome, 'POOL_STRAIN');
        assert.strictEqual(res2.pool, 'health');
        assert.strictEqual(state.pools.health.current, 7);
    });

    test('Case B: handleOverflow with scar_and_ko reduces max by 1 and sets current to 1', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.pools.health.current = 0;
        state.pools.health.max = 8;

        const res = handleOverflow(state, 'health', 2, 'Lethal blow');
        assert.strictEqual(res.outcome, 'OVERFLOW_SCAR_AND_KO');
        assert.strictEqual(state.pools.health.max, 7, 'Max health reduced by 1');
        assert.strictEqual(state.pools.health.current, 1, 'Current health set to 1');
    });

    test('Case B: handleOverflow with scene_fail leaves pool at 0', () => {
        const state = createInitialFaeState('cyberpunk_noir');
        state.pools.nerve.current = 0;

        const res = handleOverflow(state, 'nerve', 3, 'Overwhelmed');
        assert.strictEqual(res.outcome, 'OVERFLOW_SCENE_FAIL');
        assert.strictEqual(state.pools.nerve.current, 0);
        assert.ok(res.directive.includes('CRITICAL OVERFLOW on nerve'));
    });

    test('Case B: handleOverflow with lethal indicates terminal outcome', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.health.current = 0;

        const res = handleOverflow(state, 'health', 4, 'Death blow');
        assert.strictEqual(res.outcome, 'OVERFLOW_LETHAL');
        assert.strictEqual(state.pools.health.current, 0);
        assert.ok(res.directive.includes('TERMINAL OVERFLOW'));
    });

    test('Circular redirect guard terminates without infinite recursion', () => {
        const state = createInitialFaeState('cosmic_horror');
        // Deliberately create circular redirect
        state.pools.health.on_overflow = 'redirect:sanity';
        state.pools.sanity.on_overflow = 'redirect:health';
        state.pools.health.current = 0;
        state.pools.sanity.current = 0;

        const res = applyPoolLoss(state, 'health', 2, 'Loop test');
        assert.ok(res.outcome.startsWith('OVERFLOW_'), 'Must safely terminate recursion');
    });

    test('applyPoolLoss uses state.knobs.overflow_default when pool.on_overflow is omitted', () => {
        const state = createInitialFaeState('cosmic_horror');
        delete state.pools.health.on_overflow;
        state.knobs.overflow_default = 'scar_and_ko';
        state.pools.health.current = 4;

        const res = applyPoolLoss(state, 'health', 6, 'Heavy strike');
        assert.strictEqual(res.outcome, 'BREAKING_POINT_CLAMP');
        assert.strictEqual(state.pools.health.current, 0);
        assert.ok(res.directive.includes("triggers 'scar_and_ko'"), `Expected directive to include scar_and_ko, got: ${res.directive}`);

        // Also test fallback to 'lethal' if both omitted
        const state2 = createInitialFaeState('cosmic_horror');
        delete state2.pools.health.on_overflow;
        delete state2.knobs.overflow_default;
        state2.pools.health.current = 4;

        const res2 = applyPoolLoss(state2, 'health', 6, 'Heavy strike');
        assert.ok(res2.directive.includes("triggers 'lethal'"), `Expected directive to include lethal fallback, got: ${res2.directive}`);
    });
});

describe('Freeform Attrition Engine (FAE) — Recovery Tiers & Passive Upkeep', () => {
    test('scene_breather heals +2 when pool > 0, but does NOT heal or clear debuff at 0', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.resolve.current = 3;
        state.pools.resolve.max = 6;

        triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 5, 'Heals +2 when > 0');

        // At 0, breather cannot clear debuff or heal
        state.pools.resolve.current = 0;
        state.character.negative_tags = ['Rattled & Hesitant'];
        state.state_flags.breather_available = true; // reset breather for zero-state isolation
        triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 0, 'Does not heal when at 0');
        assert.ok(state.character.negative_tags.includes('Rattled & Hesitant'), 'Does not clear debuff');
    });

    test('triggerEventOrRest enforces breather_available per scene and resets on scene_transition / camp / haven', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.resolve.current = 2;
        state.pools.resolve.max = 6;
        assert.strictEqual(state.state_flags.breather_available, true);

        // Calling scene_breather heals a scene_breather pool once and sets breather_available = false
        const res1 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 4);
        assert.strictEqual(state.state_flags.breather_available, false);
        assert.ok(res1.summary.includes('Recovered +2 resolve'));

        // Calling scene_breather a second time in the same scene returns 'Breather already used this scene.' without healing
        const res2 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 4, 'Resolve unaffected by second breather');
        assert.strictEqual(res2.summary, 'Breather already used this scene.');
        assert.strictEqual(state.state_flags.breather_available, false);

        // Calling scene_transition resets breather_available to true so subsequent breather works again
        triggerEventOrRest(state, 'scene_transition');
        assert.strictEqual(state.state_flags.breather_available, true);

        const res3 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 6);
        assert.strictEqual(state.state_flags.breather_available, false);
        assert.ok(res3.summary.includes('Recovered +2 resolve'));

        // camp_or_sleep also resets breather_available to true
        triggerEventOrRest(state, 'camp_or_sleep');
        assert.strictEqual(state.state_flags.breather_available, true);

        // haven_or_specialist also resets breather_available to true
        state.state_flags.breather_available = false;
        triggerEventOrRest(state, 'haven_or_specialist');
        assert.strictEqual(state.state_flags.breather_available, true);
    });

    test('camp_or_sleep processes passive drain first, heals half max, and clears zero_debuff', () => {
        const state = createInitialFaeState('osr_dungeon');
        // OSR dungeon has passive drain on torch_and_supplies: 1 point at camp_or_sleep
        state.pools.torch_and_supplies.current = 6;
        state.pools.health.current = 2; // Health max is 10
        state.character.negative_tags = ["Death's Door"];

        triggerEventOrRest(state, 'camp_or_sleep');

        // Passive drain processed first
        assert.strictEqual(state.pools.torch_and_supplies.current, 5, 'Drained 1 torch & supplies');
        // Health heals half max (floor(10 / 2) = 5) -> 2 + 5 = 7
        assert.strictEqual(state.pools.health.current, 7, 'Restored half max health');
        assert.strictEqual(state.character.negative_tags.includes("Death's Door"), false, 'Cleared zero_debuff');
    });

    test('haven_or_specialist fully restores all pools and clears zero debuffs', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.health.current = 1;
        state.pools.resolve.current = 0;
        state.pools.torch_and_supplies.current = 0;
        state.character.negative_tags = ["Death's Door", 'Rattled & Hesitant', 'Pitch Black & Starving'];

        triggerEventOrRest(state, 'haven_or_specialist');

        assert.strictEqual(state.pools.health.current, state.pools.health.max);
        assert.strictEqual(state.pools.resolve.current, state.pools.resolve.max);
        assert.strictEqual(state.pools.torch_and_supplies.current, state.pools.torch_and_supplies.max);
        assert.strictEqual(state.character.negative_tags.length, 0, 'Cleared all zero debuffs');
    });

    test('day_pass processes environmental aura passive drain (Cosmic Horror Caves of Madness)', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.pools.sanity.current = 8;

        triggerEventOrRest(state, 'day_pass');
        assert.strictEqual(state.pools.sanity.current, 7, 'Sanity drained by 1 on day pass');
    });
});

describe('Freeform Attrition Engine (FAE) — Cartridge, RNG Block & Documentation', () => {
    test('buildFaeRngBlock generates pre-computed matrix with correct pool thresholds', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.pools.sanity.current = 3;
        const block = buildFaeRngBlock({ state, lineCount: 6 });

        assert.ok(block.includes('[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]'));
        assert.ok(block.includes('1: 4dF →'));
        assert.ok(block.includes('6: 4dF →'));
        assert.ok(block.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'));
        assert.ok(block.includes('• Threat 1:'));
        assert.ok(block.includes('• Threat 2:'));
        assert.ok(block.includes('• Threat 3:'));
        assert.ok(block.includes('• Threat 4:'));
        assert.ok(block.includes('Health (8/8): Positive Tags: ENABLED'));
        assert.ok(block.includes('Sanity (3/8): Positive Tags: ENABLED'));

        // When a pool is at 0, innate personal tags should be marked DISABLED
        state.pools.sanity.current = 0;
        const blockZero = buildFaeRngBlock({ state, lineCount: 6 });
        assert.ok(blockZero.includes('Sanity (0/8): Innate Personal Tags: DISABLED (Pool at 0!)'));
        assert.ok(blockZero.includes('Uninjured Companion: tags and earned [Advantage] still apply'));
    });

    test('buildFaeRngBlock injects OPENING SCENE SETUP directive when isOpeningTurn is true', () => {
        const state = createInitialFaeState('cosmic_horror');
        const blockOpening = buildFaeRngBlock({ state, lineCount: 6, isOpeningTurn: true });
        assert.ok(blockOpening.includes('[Pacing Directive (OPENING SCENE SETUP): This is the opening scene setup. Do NOT roll dice or test any resource pools this turn — ignore the RNG queue above, establish the starting situation and immediate stakes, and hand the spotlight to {{user}}.]'));

        const blockNormal = buildFaeRngBlock({ state, lineCount: 6, isOpeningTurn: false });
        assert.ok(blockNormal.includes('[Pacing Suggestion (slow_burn): Last pool test was 0 turn(s) ago.'));
        assert.ok(!blockNormal.includes('OPENING SCENE SETUP'));
    });

    test('buildFaeRngBlock defaults to 1 roll line, and omits rolls/matrix in opening turn or tool mode', () => {
        const state = createInitialFaeState('cosmic_horror');
        // Default options: 1 line
        const defaultBlock = buildFaeRngBlock({ state });
        assert.ok(defaultBlock.includes('1: 4dF →'));
        assert.ok(!defaultBlock.includes('2: 4dF →'));
        assert.ok(defaultBlock.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'));

        // isOpeningTurn === true: NO dice lines, NO matrix
        const openingBlock = buildFaeRngBlock({ state, isOpeningTurn: true });
        assert.ok(!openingBlock.includes('1: 4dF →'));
        assert.ok(!openingBlock.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'));
        assert.ok(openingBlock.includes('[Pacing Directive (OPENING SCENE SETUP)'));

        // toolMode === true: NO dice lines, NO matrix
        const toolBlock = buildFaeRngBlock({ state, toolMode: true });
        assert.ok(!toolBlock.includes('1: 4dF →'));
        assert.ok(!toolBlock.includes('PRE-COMPUTED TURN RESOLUTION MATRIX'));
        assert.ok(toolBlock.includes('[Pacing Suggestion (slow_burn)'));
    });

    test('executeFaeActionTool resolves action deterministically without mutating input state', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.pools.health.current = 8;
        state.pools.sanity.current = 6;
        state.character.positive_tags = ['Ex-Military', 'Calm [under gunfire and shock]'];
        state.character.negative_tags = [];
        state.character.temp_advantage = null;

        const frozenState = JSON.parse(JSON.stringify(state));

        const out = executeFaeActionTool(state, {
            pool_at_risk: 'sanity',
            threat_level: 2,
            progress_scale: 'stepping_stone',
            matched_positive_tags: ['Calm [under gunfire and shock]'],
            fixedDiceRoll: 1, // 4dF = +1
            grant_advantage_name: 'Opening Focus',
        });

        // 1. Verify input state was NOT mutated
        assert.deepStrictEqual(state, frozenState, 'executeFaeActionTool must not mutate input state');

        // 2. Verify calculation:
        // Threat 2 + 4dF(+1) - 1(posTag) = Attrition 2.
        // Sanity: 6 -> 4.
        assert.strictEqual(out.result.attrition, 2);
        assert.strictEqual(out.result.outcome, 'POOL_STRAIN');
        assert.strictEqual(out.updatedState.pools.sanity.current, 4);
        assert.strictEqual(out.updatedState.character.temp_advantage, 'Opening Focus');

        // 3. Verify inline_roll and response text
        assert.ok(out.inline_roll.includes('*(FAE Action [Sanity]: 4dF'));
        assert.ok(out.inline_roll.includes('Attrition 2 → POOL_STRAIN (4/8)'));
        assert.ok(out.updated_pools_footer.includes('(Sanity: 4/8)'));
        assert.ok(out.toolResponseText.includes('INLINE ROLL (print verbatim in prose before narrating consequence):'));
        assert.ok(out.toolResponseText.includes('OUTCOME TIER: POOL_STRAIN'));
        assert.ok(out.toolResponseText.includes('UPDATED FOOTER POOLS'));
    });

    test('executePbtaMoveTool resolves moves and outcome tiers accurately', () => {
        // Strong hit: 4 + 5 + 1 = 10
        const strongOut = executePbtaMoveTool({
            move_name: 'Hack & Slash',
            stat_name: 'Might',
            stat_mod: 1,
            forward_bonus: 0,
            fixed_d1: 4,
            fixed_d2: 5,
        });
        assert.strictEqual(strongOut.sum, 9);
        assert.strictEqual(strongOut.total, 10);
        assert.strictEqual(strongOut.tier, 'Strong Hit');
        assert.ok(strongOut.inline_roll.includes('*(Hack & Slash [Might]: 2d6 [Roll: 4 + 5 = 9] + 1 = 10 → Strong Hit)*'));

        // Weak hit: 2 + 4 + 1 = 7
        const weakOut = executePbtaMoveTool({
            move_name: 'Defy Danger',
            stat_name: 'Agility',
            stat_mod: 1,
            fixed_d1: 2,
            fixed_d2: 4,
        });
        assert.strictEqual(weakOut.total, 7);
        assert.strictEqual(weakOut.tier, 'Weak Hit');
        assert.ok(weakOut.inline_roll.includes('Weak Hit'));

        // Miss: 1 + 2 + 1 = 4
        const missOut = executePbtaMoveTool({
            move_name: 'Act Under Fire',
            stat_name: 'Cool',
            stat_mod: 1,
            fixed_d1: 1,
            fixed_d2: 2,
        });
        assert.strictEqual(missOut.total, 4);
        assert.strictEqual(missOut.tier, 'Miss');
        assert.ok(missOut.directive.includes('+1 XP — Miss'));
        assert.ok(missOut.toolResponseText.includes('OUTCOME TIER: Miss'));
    });

    test('buildFaeRngContent and buildPbtARngContent reflect toolMode accurately', () => {
        const faeQueue = buildFaeRngContent({ toolMode: false });
        assert.ok(faeQueue.includes('ZERO-MATH PRE-COMPUTED MATRIX'));
        assert.ok(!faeQueue.includes('FUNCTION TOOL CALL RESOLUTION'));

        const faeTool = buildFaeRngContent({ toolMode: true });
        assert.ok(!faeTool.includes('ZERO-MATH PRE-COMPUTED MATRIX'));
        assert.ok(faeTool.includes('FUNCTION TOOL CALL RESOLUTION (resolve_fae_action)'));

        const pbtaQueue = buildPbtARngContent({ toolMode: false });
        assert.ok(pbtaQueue.includes('[RNG_QUEUE v7.0]'));
        assert.ok(!pbtaQueue.includes('FUNCTION TOOL CALL RESOLUTION'));

        const pbtaTool = buildPbtARngContent({ toolMode: true });
        assert.ok(!pbtaTool.includes('[RNG_QUEUE v7.0]'));
        assert.ok(pbtaTool.includes('FUNCTION TOOL CALL RESOLUTION (roll_pbta_move)'));
    });

    test('buildFaeCartridge compiles valid cartridge object', () => {
        const cart = buildFaeCartridge('cosmic_horror');
        assert.strictEqual(cart.id, FAE_CARTRIDGE_ID);
        assert.ok(cart.name.includes('Freeform Attrition Engine'));
        assert.strictEqual(cart.payload.rngEnabled, true);
        assert.strictEqual(cart.payload.rngQueueD20, true);
        assert.strictEqual(cart.payload.syspromptModules.saving_throws, false);
        assert.strictEqual(cart.payload.syspromptModules.attacks_per_round, false);
        assert.strictEqual(cart.payload.modules.party, false, 'Party module must be unconditionally false in FAE');
        assert.ok(!cart.payload.blockOrder.includes('PARTY'), 'blockOrder must not contain PARTY');
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'role'));
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'rng_system'));
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'combat'));
        assert.ok(cart.payload.stockPrompts.character.includes('[CHARACTER]'));
        assert.ok(!cart.payload.stockPrompts.character.includes('{{user}} ('), 'Stock prompt character template must never use {{user}}');
        assert.ok(cart.payload.stockPrompts.character.includes('Character Name ('), 'Stock prompt defaults to Character Name');
        assert.ok(cart.payload.stockPrompts.character.includes('CRITICAL: Always output the character\'s actual proper name'));
        assert.ok(cart.payload.stockPrompts.party.includes('Do NOT output a [PARTY] block'));
        assert.ok(cart.payload.stockPrompts.combat.includes('[COMBAT]'));

        // When partyMode is explicitly set, modules.party remains false and PARTY is omitted from blockOrder
        const partyCart = buildFaeCartridge('osr_dungeon', { partyMode: 'party' });
        assert.strictEqual(partyCart.payload.modules.party, false, 'Party module must be false even in partyMode');
        assert.ok(!partyCart.payload.blockOrder.includes('PARTY'), 'blockOrder must not contain PARTY in partyMode');
        const partyOverride = partyCart.payload.customSyspromptLibrary.find(s => s.tag === '[PARTY]_mechanics');
        assert.ok(partyOverride && partyOverride.enabled, '[PARTY]_mechanics sysprompt override must be enabled');
        assert.strictEqual(partyOverride.description, 'FAE Zero-Bookkeeping Companion & Party Leverage Rules');

        // Target name resolution in stockPrompts
        const namedCart = buildFaeCartridge('cosmic_horror', { charName: 'Lou' });
        assert.ok(namedCart.payload.stockPrompts.character.includes('Lou (The Antiquarian)'), 'Uses resolved target name');
        assert.ok(!namedCart.payload.stockPrompts.character.includes('Character Name ('), 'Replaces default Character Name header');
    });

    test('buildFaeQuickStartInstructions mandates Zero-Bookkeeping and forbids [PARTY] block', () => {
        const instructions = buildFaeQuickStartInstructions('osr_dungeon', 'Lou');
        assert.ok(instructions.includes('COMPANIONS & PARTY: Do NOT output a [PARTY] block'));
        assert.ok(instructions.includes('"Companion: Name [role/specialty]"'));

        const pluralInstructions = buildFaeQuickStartInstructions('osr_dungeon', 'Lou', 'Lou and his companions venture into the dark barrows');
        assert.ok(pluralInstructions.includes('generate 2-3 "Companion: Name (Role — detail)" tags within the 4-tag budget'));
        assert.ok(pluralInstructions.includes('Pick 4 distinct descriptive tags'));
    });

    test('Narrative GM prompt sections instruct status footer and active state without printing memo blocks', () => {
        const role = buildFaeRoleContent();
        assert.ok(role.includes('reflect updated pool values in the two-line status footer, and hand the spotlight back.'));
        assert.ok(!role.includes('update State Memo pools'));

        const combat = buildFaeCombatContent('osr_dungeon');
        assert.ok(combat.includes('ACTIVE ENCOUNTER STATE ([COMBAT]):'));
        assert.ok(combat.includes('When an encounter is active in [COMBAT], it is represented as a unified 4-line Encounter Block:'));
        assert.ok(combat.includes('When an active Encounter block is present, its stated Threat is used for action rolls against those enemies.'));
        assert.ok(!combat.includes('In the [COMBAT] memo block, track the entire situation'));

        const party = buildFaePartyContent();
        assert.ok(party.includes('Notable companions or hirelings on the [CHARACTER] sheet carry a "Companion:" or "Retainer:" prefix'));
        assert.ok(party.includes('When the player\'s setup mentions friends or party members, the [CHARACTER] Positive Tags entries starting with Companion: or Retainer: ARE the mechanical companions; any other unnamed members are background retinue covered by the protagonist\'s pools. Do not wait on a tracker party list.'));
        assert.ok(!party.includes('Record notable companions or hirelings as Positive Tags in [CHARACTER]'));
    });

    test('buildTailoredFaeDocumentation formats comprehensive markdown documentation', () => {
        const doc = buildTailoredFaeDocumentation('osr_dungeon');
        assert.ok(doc.includes('# Freeform Attrition Engine (FAE) Framework Guide'));
        assert.ok(doc.includes('Gritty OSR Dungeon Crawl'));
        assert.ok(doc.includes('Two-Tier Pool Narration'));
        assert.ok(doc.includes('Torch & Supplies'));
        assert.ok(doc.includes('Guidelines for MultiHog Adventure Companion'));
        assert.ok(doc.includes('Zero-Bookkeeping Companions: FAE has modules.party disabled. NEVER instruct the State Tracker to create a [PARTY] block or per-companion pools. Add companions as `Companion: Name (Role)` entries under [CHARACTER] Positive Tags, and create their lore entries via command_lorebook_agent. Prefer ONE command per request where possible (the Companion action limit is small).'));
    });
});

describe('Freeform Attrition Engine (FAE) — State Sync & Post-Turn Reconciliation', () => {
    test('formatFaeCharacterMemoBlock serializes complete state', () => {
        const state = createInitialFaeState('cosmic_horror');
        state.character.temp_advantage = 'Safe Combo';
        const memoBlock = formatFaeCharacterMemoBlock(state);

        assert.ok(memoBlock.includes('[CHARACTER]'));
        assert.ok(memoBlock.includes('8/8 HP | Pool: Health (8/8) | Scenes: 0/4 | XP: 0/4'));
        assert.ok(memoBlock.includes('((BARPURPLE)) Sanity: 8/8'));
        assert.ok(!memoBlock.includes('Zero Debuff'), 'Secondary bar line must not include Zero Debuff');
        assert.ok(memoBlock.includes('FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: lethal | Tempo: slow_burn | Idle: 0t | Breather: READY | [Advantage: Safe Combo]'));
        assert.ok(memoBlock.includes('((PILLS)) Positive Tags:'));
        assert.ok(memoBlock.includes('((PILLS)) Scars & Debuffs: (+) Advantage: Safe Combo (-1 Attrition on next action)'));
        assert.ok(memoBlock.includes('Status: Healthy'));
        assert.ok(memoBlock.includes('[/CHARACTER]'));
    });

    test('parseFaeStateFromMemo accurately reconstitutes FAE state', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.health.current = 7;
        state.pools.resolve.current = 4;
        state.pools.torch_and_supplies.current = 3;
        state.character.scenes_completed = 2;
        state.character.negative_tags = ['Twisted Ankle'];
        state.character.temp_advantage = 'Flank Opening';

        const memo = formatInitialFaeMemo(state);
        const parsed = parseFaeStateFromMemo(memo, 'osr_dungeon');

        assert.strictEqual(parsed.pools.health.current, 7);
        assert.strictEqual(parsed.pools.health.max, 10);
        assert.strictEqual(parsed.pools.resolve.current, 4);
        assert.strictEqual(parsed.pools.torch_and_supplies.current, 3);
        assert.strictEqual(parsed.character.scenes_completed, 2);
        assert.strictEqual(parsed.character.scenes_target, 4);
        assert.ok(parsed.character.negative_tags.some(t => t.includes('Twisted Ankle')));
        assert.strictEqual(parsed.character.temp_advantage, 'Flank Opening');
    });

    test('toMultihogBarMarker maps colors correctly to MultiHog tokens', () => {
        assert.strictEqual(toMultihogBarMarker('amber'), '((BARGOLD))');
        assert.strictEqual(toMultihogBarMarker('yellow'), '((BARGOLD))');
        assert.strictEqual(toMultihogBarMarker('gold'), '((BARGOLD))');
        assert.strictEqual(toMultihogBarMarker('orange'), '((BARGOLD))');
        assert.strictEqual(toMultihogBarMarker('blue'), '((BARBLUE))');
        assert.strictEqual(toMultihogBarMarker('cyan'), '((BARBLUE))');
        assert.strictEqual(toMultihogBarMarker('purple'), '((BARPURPLE))');
        assert.strictEqual(toMultihogBarMarker('violet'), '((BARPURPLE))');
        assert.strictEqual(toMultihogBarMarker('red'), '((BARRED))');
        assert.strictEqual(toMultihogBarMarker('crimson'), '((BARRED))');
        assert.strictEqual(toMultihogBarMarker('green'), '((BARGREEN))');
        assert.strictEqual(toMultihogBarMarker('unknown'), '((BARPURPLE))');
    });

    test('parseFaeStateFromMemo parses new ((BARGOLD)) and legacy ((BAR: amber)) markers', () => {
        const newMemo = `[CHARACTER]
Arthur (Survivor): 10/10 HP | Pool: Health (10/10) | Scenes: 0/4 | XP: 0/4
((BARBLUE)) Resolve: 5/6
((BARGOLD)) Torch & Supplies: 4/6
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;
        const parsedNew = parseFaeStateFromMemo(newMemo, 'osr_dungeon');
        assert.strictEqual(parsedNew.pools.resolve.current, 5);
        assert.strictEqual(parsedNew.pools.resolve.barColor, 'blue');
        assert.strictEqual(parsedNew.pools.torch_and_supplies.current, 4);
        assert.strictEqual(parsedNew.pools.torch_and_supplies.barColor, 'gold');

        const legacyMemo = `[CHARACTER]
Arthur (Survivor): 10/10 HP | Pool: Health (10/10) | Scenes: 0/4 | XP: 0/4
((BAR: blue)) Resolve: 6/6 (Zero Debuff: Rattled & Hesitant | Recovery: scene_breather)
((BAR: amber)) Torch & Supplies: 3/6 (Zero Debuff: Pitch Black & Starving | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;
        const parsedLegacy = parseFaeStateFromMemo(legacyMemo, 'osr_dungeon');
        assert.strictEqual(parsedLegacy.pools.resolve.current, 6);
        assert.strictEqual(parsedLegacy.pools.resolve.barColor, 'blue');
        assert.strictEqual(parsedLegacy.pools.resolve.zero_debuff, 'Rattled & Hesitant');
        assert.strictEqual(parsedLegacy.pools.resolve.recovery, 'scene_breather');
        assert.strictEqual(parsedLegacy.pools.torch_and_supplies.current, 3);
        assert.strictEqual(parsedLegacy.pools.torch_and_supplies.barColor, 'gold');
        assert.strictEqual(parsedLegacy.pools.torch_and_supplies.zero_debuff, 'Pitch Black & Starving');
        assert.strictEqual(parsedLegacy.pools.torch_and_supplies.recovery, 'haven_or_specialist');
    });

    test('parseFaeStateFromMemo and reconcileFaeMemoAfterTurn cleanly heal markdown-polluted headers', () => {
        const boldMemo = `[TIME]
Day 1, 08:00 AM
[/TIME]

[CHARACTER]
**Lou (The Sellsword)**: 10/10 HP | Pool: Health (10/10) | Scenes: 0/3 | XP: 0/3
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Tough (Armor)
((PILLS)) Scars & Debuffs: None
Status: Normal
[/CHARACTER]`;

        const parsedBold = parseFaeStateFromMemo(boldMemo, 'fantasy');
        assert.strictEqual(parsedBold.character.name, 'Lou');
        assert.strictEqual(parsedBold.character.archetype, 'The Sellsword');

        const prevState = createInitialFaeState('fantasy');
        const reconciledBold = reconcileFaeMemoAfterTurn(prevState, boldMemo, 'fantasy');
        assert.ok(reconciledBold.memo.includes('Lou (The Sellsword): 10/10 HP'));
        assert.ok(!reconciledBold.memo.includes('**Lou'));

        const dupMemo = `[TIME]
Day 1, 08:00 AM
[/TIME]

[CHARACTER]
Lou (The Sellsword)** (The Sellsword): 10/10 HP | Pool: Health (10/10) | Scenes: 0/3 | XP: 0/3
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Tough (Armor)
((PILLS)) Scars & Debuffs: None
Status: Normal
[/CHARACTER]`;

        const parsedDup = parseFaeStateFromMemo(dupMemo, 'fantasy');
        assert.strictEqual(parsedDup.character.name, 'Lou');
        assert.strictEqual(parsedDup.character.archetype, 'The Sellsword');

        const reconciledDup = reconcileFaeMemoAfterTurn(prevState, dupMemo, 'fantasy');
        assert.ok(reconciledDup.memo.includes('Lou (The Sellsword): 10/10 HP'));
        assert.ok(!reconciledDup.memo.includes('(The Sellsword) (The Sellsword)'));
    });

    test('reconcileFaeMemoAfterTurn enforces Stage 1 Breaking Point Clamp and adds zero_debuff', () => {
        const prevState = createInitialFaeState('cosmic_horror');
        prevState.pools.sanity.current = 3;

        // Simulate an LLM turn where Sanity dropped to -2 and the LLM omitted the zero_debuff pill
        const nextMemo = `[TIME]
Day 1, 09:30 AM
[/TIME]

[CHARACTER]
Arthur Pendelton (The Antiquarian): 8/8 HP | Pool: Health (8/8) | Scenes: 0/4 | XP: 0/4
((BAR:purple)) Sanity: -2/8 (Zero Debuff: Manic Dissociation | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Ex-Military (Combat training), Calm (Nerves)
((PILLS)) Scars & Debuffs: None
Status: Strained
[/CHARACTER]`;

        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'cosmic_horror');

        assert.strictEqual(reconciled.changed, true);
        assert.strictEqual(reconciled.state.pools.sanity.current, 0, 'Sanity must be clamped at 0');
        assert.ok(reconciled.memo.includes('Sanity: 0/8'));
        assert.ok(reconciled.memo.includes('(-) Manic Dissociation'), 'Must inject zero_debuff into Scars & Debuffs');
        assert.ok(reconciled.events.some(e => e.includes('BREAKING_POINT_CLAMP')));
    });

    test('reconcileFaeMemoAfterTurn enforces Stage 2 Overflow Redirection when pool already at 0', () => {
        const prevState = createInitialFaeState('osr_dungeon');
        prevState.pools.torch_and_supplies.current = 0;
        prevState.pools.resolve.current = 6;

        // Memo where torch_and_supplies is depleted further (-2) while already at 0
        const nextMemo = `[CHARACTER]
Kaelen the Delver (Veteran Mercenary): 10/10 HP | Pool: Health (10/10) | Scenes: 1/4 | XP: 1/4
((BAR:blue)) Resolve: 6/6 (Zero Debuff: Rattled & Hesitant | Recovery: scene_breather)
((BAR:amber)) Torch & Supplies: -2/6 (Zero Debuff: Pitch Black & Starving | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: OFF | Shift: +0 | Overflow: lethal
((PILLS)) Positive Tags: Heavy Shield (Parrying oak)
((PILLS)) Scars & Debuffs: (-) Pitch Black & Starving
Status: Strained
[/CHARACTER]`;

        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'osr_dungeon');

        assert.strictEqual(reconciled.changed, true);
        assert.strictEqual(reconciled.state.pools.torch_and_supplies.current, 0);
        assert.strictEqual(reconciled.state.pools.resolve.current, 4, 'Redirected 2 attrition to resolve (6 -> 4)');
        assert.ok(reconciled.memo.includes('Resolve: 4/6'));
        assert.ok(reconciled.events.some(e => e.includes('OVERFLOW_REDIRECT')));
    });

    test('reconcileFaeMemoAfterTurn synchronizes Primary Pool with Line 1 HP', () => {
        const prevState = createInitialFaeState('cosmic_horror');
        prevState.pools.health.current = 8;

        // LLM wrote Health: 5/8 in secondary or changed it, but wrote 8/8 HP in Line 1
        const nextMemo = `[CHARACTER]
Arthur Pendelton (The Antiquarian): 8/8 HP | Pool: Health (5/8) | Scenes: 0/4 | XP: 0/4
((BAR:purple)) Sanity: 8/8
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Calm (Nerves)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'cosmic_horror');

        assert.strictEqual(reconciled.changed, true);
        assert.ok(reconciled.memo.includes('Arthur Pendelton (The Antiquarian): 5/8 HP'), 'Line 1 HP must synchronize with primary pool');
    });

    test('reconcileFaeMemoAfterTurn increments scenes and keeps XP in sync when encounter resolves', () => {
        const prevState = createInitialFaeState('cosmic_horror');
        prevState.character.scenes_completed = 0;
        prevState.activeEncounter = {
            name: 'Cultist Cell',
            currentHp: 1,
            maxHp: 2,
            threat: 2,
        };

        // Next turn: combat is cleared from memo, LLM forgot to increment Scenes
        const nextMemo = `[TIME]
Day 1, 11:00 AM
[/TIME]

[CHARACTER]
Arthur Pendelton (The Antiquarian): 7/8 HP | Pool: Health (7/8) | Scenes: 0/4 | XP: 0/4
((BAR:purple)) Sanity: 6/8
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Calm (Nerves)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'cosmic_horror');

        assert.strictEqual(reconciled.changed, true);
        assert.strictEqual(reconciled.state.character.scenes_completed, 1);
        assert.ok(reconciled.memo.includes('Scenes: 1/4 | XP: 1/4'));
    });

    test('reconcileFaeMemoAfterTurn ensures breather_available = true when scenes_completed increases or encounter resolves', () => {
        const prevState = createInitialFaeState('osr_dungeon');
        prevState.state_flags.breather_available = false;
        prevState.character.scenes_completed = 1;

        // Case A: scenes_completed increases in next memo
        const nextMemo = formatInitialFaeMemo(prevState).replace('Scenes: 1/4', 'Scenes: 2/4');
        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'osr_dungeon');
        assert.strictEqual(reconciled.state.state_flags.breather_available, true);

        // Case B: encounter resolves
        const prevStateWithEnc = createInitialFaeState('osr_dungeon');
        prevStateWithEnc.state_flags.breather_available = false;
        prevStateWithEnc.character.scenes_completed = 1;
        prevStateWithEnc.activeEncounter = {
            name: 'Goblin Patrol',
            currentHp: 1,
            maxHp: 2,
            threat: 2,
        };
        const nextMemoNoEnc = formatInitialFaeMemo(prevStateWithEnc);
        const reconciledEnc = reconcileFaeMemoAfterTurn(prevStateWithEnc, nextMemoNoEnc, 'osr_dungeon');
        assert.strictEqual(reconciledEnc.state.state_flags.breather_available, true);
    });

    test('buildFaePartyContent describes ZERO-BOOKKEEPING MODEL and folded mechanics', () => {
        const partyXml = buildFaePartyContent();
        assert.ok(partyXml.includes('ZERO-BOOKKEEPING MODEL'), 'Must describe ZERO-BOOKKEEPING MODEL');
        assert.ok(partyXml.includes('Protagonist-Anchored Pools'), 'Must mention Protagonist-Anchored Pools');
        assert.ok(partyXml.includes('Companions as Fictional Leverage'), 'Must mention Companions as Fictional Leverage');
        assert.ok(partyXml.includes('Companions as Positive Tags'), 'Must mention Companions as Positive Tags');
        assert.ok(partyXml.includes('Companions as Narrative Buffer'), 'Must mention Companions as Narrative Buffer');
        assert.ok(!partyXml.includes('Every companion tracks their own Primary Pool'), 'Must NOT have separate companion pool tracking');
        assert.ok(!partyXml.includes('Name (Archetype): 8/8 HP'), 'Must NOT declare individual creature HP stats');
    });

    test('reconcileFaeMemoAfterTurn and stripFaePartyBlockFromMemo strip unwanted [PARTY] blocks for FAE (WRK-09)', () => {
        const memoWithParty = `[TIME]
Day 1, 09:00 AM (Morning)
[/TIME]

[LOCATION]
The Sunken Crypt
[/LOCATION]

[CHARACTER]
Lou (The Sellsword): 10/10 HP | Pool: Health (10/10) | Scenes: 0/4 | XP: 0/4
((BARBLUE)) Resolve: 6/6
((BARGOLD)) Torch & Supplies: 6/6
FAE Knobs: Flee Grace: OFF | Shift: 0 | Overflow: lethal
((PILLS)) Positive Tags: Companion: Bran (Torchbearer), Iron Grip (grappling)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]

[PARTY]
- Bran (Torchbearer): 8/8 HP | Pool: Health (8/8)
((PILLS)) Positive Tags: Keen Eyed
Status: Healthy
[/PARTY]

[DUNGEON]
Active Site: The Sunken Crypt
Threat: MODERATE
[/DUNGEON]`;

        // 1. Direct strip function
        const stripped = stripFaePartyBlockFromMemo(memoWithParty);
        assert.ok(!stripped.includes('[PARTY]'), 'stripFaePartyBlockFromMemo must remove [PARTY] header');
        assert.ok(!stripped.includes('Bran (Torchbearer): 8/8 HP'), 'stripFaePartyBlockFromMemo must remove companion lines');
        assert.ok(!stripped.includes('[/PARTY]'), 'stripFaePartyBlockFromMemo must remove [/PARTY] footer');
        assert.ok(stripped.includes('[CHARACTER]'), 'stripFaePartyBlockFromMemo must keep [CHARACTER]');
        assert.ok(stripped.includes('[DUNGEON]'), 'stripFaePartyBlockFromMemo must keep [DUNGEON]');

        // 2. reconcileFaeMemoAfterTurn integration
        const prevState = parseFaeStateFromMemo(memoWithParty, 'osr_dungeon');
        const reconciled = reconcileFaeMemoAfterTurn(prevState, memoWithParty, 'osr_dungeon');
        assert.strictEqual(reconciled.changed, true, 'reconcileFaeMemoAfterTurn must mark changed when [PARTY] is stripped');
        assert.ok(!reconciled.memo.includes('[PARTY]'), 'reconciled memo must not contain [PARTY]');
        assert.ok(reconciled.events.some(e => e.includes('REMOVED_PARTY_BLOCK')), 'Must log REMOVED_PARTY_BLOCK event');

        // 3. No-op when no [PARTY] block is present
        const noPartyMemo = stripped;
        const noopReconciled = reconcileFaeMemoAfterTurn(prevState, noPartyMemo, 'osr_dungeon');
        assert.ok(!noopReconciled.memo.includes('[PARTY]'));
        assert.strictEqual(stripFaePartyBlockFromMemo(noPartyMemo), noPartyMemo, 'Must be no-op when no [PARTY] block exists');
    });
});

describe('Freeform Attrition Engine (FAE) — Heroic Domains (Pre-Math Leverage Permissions)', () => {
    test('1. FAE_GENRES genre defaults: osr_dungeon is heroic_tier true with defaultHeroicDomain, others are false', () => {
        assert.strictEqual(FAE_GENRES.osr_dungeon.knobs.heroic_tier, true);
        assert.strictEqual(FAE_GENRES.osr_dungeon.defaultHeroicDomain, 'Spellblade [short-range blink and arcane ward-breaking]');

        const nonHeroic = ['cosmic_horror', 'survival_horror', 'post_apocalyptic', 'cyberpunk_noir', 'deep_space', 'weird_west'];
        for (const key of nonHeroic) {
            assert.strictEqual(FAE_GENRES[key].knobs.heroic_tier, false, `${key} should have heroic_tier: false`);
            assert.strictEqual(FAE_GENRES[key].defaultHeroicDomain, null, `${key} should have defaultHeroicDomain: null`);
        }
    });

    test('2. createInitialFaeState initializes heroic_tier and heroic_domain appropriately', () => {
        const osrState = createInitialFaeState('osr_dungeon');
        assert.strictEqual(osrState.knobs.heroic_tier, true);
        assert.strictEqual(osrState.character.heroic_domain, 'Spellblade [short-range blink and arcane ward-breaking]');

        const cosmicState = createInitialFaeState('cosmic_horror');
        assert.strictEqual(cosmicState.knobs.heroic_tier, false);
        assert.strictEqual(cosmicState.character.heroic_domain, null);

        const customHeroic = createInitialFaeState('cosmic_horror', {
            heroic_tier: true,
            heroic_domain: 'Arch-Mage [elemental fire and warding]',
        });
        assert.strictEqual(customHeroic.knobs.heroic_tier, true);
        assert.strictEqual(customHeroic.character.heroic_domain, 'Arch-Mage [elemental fire and warding]');
    });

    test('3. Zero Leakage when heroic_tier is false across prompts and cartridges', () => {
        const roleXml = buildFaeRoleContent({ heroicTier: false });
        assert.ok(!roleXml.includes('Heroic Domain'), 'Role XML must not mention Heroic Domain when false');
        assert.ok(!roleXml.includes('Pre-Math Leverage'), 'Role XML must not mention Pre-Math Leverage when false');

        const combatXml = buildFaeCombatContent({ heroicTier: false });
        assert.ok(!combatXml.includes('or Heroic Domain'), 'Combat XML must not mention Heroic Domain when false');

        const constraintsXml = buildFaeConstraintsContent({ heroicTier: false });
        assert.ok(!constraintsXml.includes('Heroic Domain'), 'Constraints XML must not mention Heroic Domain when false');

        const stockPrompts = buildFaeStockPrompts('cosmic_horror', { heroicTier: false });
        assert.ok(!stockPrompts.character.includes('Heroic Domain'), 'Stock prompt must not include Heroic Domain when false');
        assert.ok(!stockPrompts.character.includes('Heroic: ON'), 'Stock prompt knobs must not say Heroic: ON when false');

        const quickStart = buildFaeQuickStartInstructions('cosmic_horror', { heroicTier: false });
        assert.ok(!quickStart.includes('HEROIC DOMAIN'), 'Quick start must not include HEROIC DOMAIN when false');
        assert.ok(!quickStart.includes('Heroic: ON'), 'Quick start must not include Heroic: ON when false');

        const cartridge = buildFaeCartridge('cosmic_horror', { heroicTier: false });
        const allCartridgeText = JSON.stringify(cartridge);
        assert.ok(!allCartridgeText.includes('Heroic Domain'), 'Cartridge payload must have zero mention of Heroic Domain when false');

        const nonHeroicState = createInitialFaeState('cosmic_horror');
        const memo = formatFaeCharacterMemoBlock(nonHeroicState);
        assert.ok(!memo.includes('Heroic Domain:'), 'Memo block must not mention Heroic Domain when false');
        assert.ok(!memo.includes('Heroic: ON'), 'Memo block must not include Heroic: ON when false');
    });

    test('4. Full Injection when heroic_tier is true across prompts and cartridges', () => {
        const roleXml = buildFaeRoleContent({ heroicTier: true });
        assert.ok(roleXml.includes('HEROIC DOMAINS (PRE-MATH LEVERAGE PERMISSIONS)'), 'Role XML must contain Heroic Domains section');
        assert.ok(roleXml.includes('Expands Threat 0'), 'Role XML must describe Threat 0 expansion');
        assert.ok(roleXml.includes('Grants Extraordinary Leverage'), 'Role XML must describe Extraordinary Leverage');
        assert.ok(roleXml.includes('Neutralizes Encounter Pressures'), 'Role XML must describe Pressure neutralization');
        assert.ok(roleXml.includes('Pure Pre-Math Leverage'), 'Role XML must state it is pure pre-math leverage');

        const combatXml = buildFaeCombatContent({ heroicTier: true });
        assert.ok(combatXml.includes('or Heroic Domain'), 'Combat XML must include Heroic Domain leverage in pressure neutralization');

        const constraintsXml = buildFaeConstraintsContent({ heroicTier: true });
        assert.ok(constraintsXml.includes('pure pre-math leverage'), 'Constraints XML must enforce pure pre-math leverage');

        const stockPrompts = buildFaeStockPrompts('osr_dungeon', { heroicTier: true });
        assert.ok(stockPrompts.character.includes('Heroic: ON'), 'Stock prompt knobs must include Heroic: ON');
        assert.ok(stockPrompts.character.includes('Heroic Domain: Archetype [specific domains]'), 'Stock prompt must include Heroic Domain template');

        const quickStart = buildFaeQuickStartInstructions('osr_dungeon', { heroicTier: true });
        assert.ok(quickStart.includes('Heroic: ON'), 'Quick start must include Heroic: ON');
        assert.ok(quickStart.includes('HEROIC DOMAIN: Include "Heroic Domain:'), 'Quick start must mandate Heroic Domain format');

        const cartridge = buildFaeCartridge('osr_dungeon');
        const allCartridgeText = JSON.stringify(cartridge);
        assert.ok(allCartridgeText.includes('Heroic Domain'), 'Cartridge payload must include Heroic Domain when true');

        const heroicState = createInitialFaeState('osr_dungeon');
        const memo = formatFaeCharacterMemoBlock(heroicState);
        assert.ok(memo.includes('Heroic Domain: Spellblade [short-range blink and arcane ward-breaking]'), 'Memo block must serialize Heroic Domain');
        assert.ok(memo.includes('Heroic: ON'), 'Memo block knobs must include Heroic: ON');
    });

    test('5. resolveAction strictly filters out heroic_domain from matched_positive_tags (Never reduces attrition)', () => {
        const state = createInitialFaeState('osr_dungeon');
        assert.strictEqual(state.character.heroic_domain, 'Spellblade [short-range blink and arcane ward-breaking]');

        // Case A: Action includes heroic domain as matched positive tag
        const resultWithDomain = resolveAction(state, {
            pool_name: 'health',
            threat_level: 2,
            fixedDiceRoll: 0,
            matched_positive_tags: ['Spellblade [short-range blink and arcane ward-breaking]'],
        });
        assert.deepStrictEqual(resultWithDomain.matched_positive_tags, [], 'heroic_domain must be filtered out of matched_positive_tags');
        assert.strictEqual(resultWithDomain.attrition, 2, 'Heroic domain must NOT reduce attrition (remains 2)');

        // Case B: Action includes standard positive tag alongside heroic domain
        const resultWithBoth = resolveAction(state, {
            pool_name: 'health',
            threat_level: 2,
            fixedDiceRoll: 0,
            matched_positive_tags: ['Veteran Mercenary', 'Spellblade [short-range blink and arcane ward-breaking]'],
        });
        assert.deepStrictEqual(resultWithBoth.matched_positive_tags, ['Veteran Mercenary'], 'Only legitimate positive tag should be retained');
        assert.strictEqual(resultWithBoth.attrition, 1, 'Attrition reduced by 1 only from Veteran Mercenary');

        // Case C: Action includes literal string prefix "Heroic Domain:"
        const resultWithPrefix = resolveAction(state, {
            pool_name: 'health',
            threat_level: 3,
            fixedDiceRoll: 0,
            matched_positive_tags: ['Heroic Domain: Spellblade [blink]', 'Heavy Shield'],
        });
        assert.deepStrictEqual(resultWithPrefix.matched_positive_tags, ['Heavy Shield']);
        assert.strictEqual(resultWithPrefix.attrition, 2);
    });

    test('6. parseFaeStateFromMemo and formatInitialFaeMemo roundtrip preserves Heroic Tier and Domain', () => {
        const rawMemo = `[SYSTEM]
MultiHog DnD Framework: Active
FAE Knobs: Flee Grace: OFF | Shift: 0 | Overflow: lethal | Heroic: ON
[/SYSTEM]

[CHARACTER]
Name: Lou
Archetype: Spellblade
Heroic Domain: Spellblade [short-range blink and arcane ward-breaking]
((BARRED)) Health: 10/10
((BARCYAN)) Resolve: 6/6
((BARGOLD)) Torch & Supplies: 6/6
((PILLS)) Positive Tags: Veteran Mercenary, Heavy Shield
[/CHARACTER]`;

        const parsed = parseFaeStateFromMemo(rawMemo);
        assert.strictEqual(parsed.knobs.heroic_tier, true);
        assert.strictEqual(parsed.character.heroic_domain, 'Spellblade [short-range blink and arcane ward-breaking]');

        const serialized = formatFaeCharacterMemoBlock(parsed);
        assert.ok(serialized.includes('Heroic: ON'));
        assert.ok(serialized.includes('Heroic Domain: Spellblade [short-range blink and arcane ward-breaking]'));

        // When Heroic is OFF
        const rawMemoOff = rawMemo.replace('Heroic: ON', 'Heroic: OFF').replace('Heroic Domain: Spellblade [short-range blink and arcane ward-breaking]\n', '');
        const parsedOff = parseFaeStateFromMemo(rawMemoOff);
        assert.strictEqual(parsedOff.knobs.heroic_tier, false);
        assert.strictEqual(parsedOff.character.heroic_domain, null);
    });
});
