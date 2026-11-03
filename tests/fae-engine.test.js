import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    FAE_CARTRIDGE_ID,
    FAE_GOD_TAGS_BLACKLIST,
    FAE_GENRES,
    FAE_GENRE_SKELETONS,
    rollFudgeDie,
    roll4dF,
    isGodTag,
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
    buildFaeStockPrompts,
    buildFaeQuickStartInstructions,
    buildFaeRngContent,
} from '../fae-ruleset.js';
import {
    formatFaeCharacterMemoBlock,
    parseFaeStateFromMemo,
    reconcileFaeMemoAfterTurn,
    formatInitialFaeMemo,
    splitTopLevelPillItems,
    normalizeFaePillsLine,
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

    test('isGodTag is deprecated and returns false for programmatic non-rejection', () => {
        assert.ok(Array.isArray(FAE_GOD_TAGS_BLACKLIST), 'FAE_GOD_TAGS_BLACKLIST export preserved for backwards compatibility');
        assert.strictEqual(isGodTag('Lucky'), false);
        assert.strictEqual(isGodTag('Smart'), false);
        assert.strictEqual(isGodTag('Strong'), false);
        assert.strictEqual(isGodTag('Invincible'), false);
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
        state.knobs.breather_available = true; // reset breather for zero-state isolation
        triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 0, 'Does not heal when at 0');
        assert.ok(state.character.negative_tags.includes('Rattled & Hesitant'), 'Does not clear debuff');
    });

    test('triggerEventOrRest enforces breather_available per scene and resets on scene_transition / camp / haven', () => {
        const state = createInitialFaeState('osr_dungeon');
        state.pools.resolve.current = 2;
        state.pools.resolve.max = 6;
        assert.strictEqual(state.knobs.breather_available, true);

        // Calling scene_breather heals a scene_breather pool once and sets breather_available = false
        const res1 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 4);
        assert.strictEqual(state.knobs.breather_available, false);
        assert.ok(res1.summary.includes('Recovered +2 resolve'));

        // Calling scene_breather a second time in the same scene returns 'Breather already used this scene.' without healing
        const res2 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 4, 'Resolve unaffected by second breather');
        assert.strictEqual(res2.summary, 'Breather already used this scene.');
        assert.strictEqual(state.knobs.breather_available, false);

        // Calling scene_transition resets breather_available to true so subsequent breather works again
        triggerEventOrRest(state, 'scene_transition');
        assert.strictEqual(state.knobs.breather_available, true);

        const res3 = triggerEventOrRest(state, 'scene_breather');
        assert.strictEqual(state.pools.resolve.current, 6);
        assert.strictEqual(state.knobs.breather_available, false);
        assert.ok(res3.summary.includes('Recovered +2 resolve'));

        // camp_or_sleep also resets breather_available to true
        triggerEventOrRest(state, 'camp_or_sleep');
        assert.strictEqual(state.knobs.breather_available, true);

        // haven_or_specialist also resets breather_available to true
        state.knobs.breather_available = false;
        triggerEventOrRest(state, 'haven_or_specialist');
        assert.strictEqual(state.knobs.breather_available, true);
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

        // When a pool is at 0, tags should be marked DISABLED
        state.pools.sanity.current = 0;
        const blockZero = buildFaeRngBlock({ state, lineCount: 6 });
        assert.ok(blockZero.includes('Sanity (0/8): Positive Tags: DISABLED (Pool at 0!)'));
    });

    test('buildFaeCartridge compiles valid cartridge object', () => {
        const cart = buildFaeCartridge('cosmic_horror');
        assert.strictEqual(cart.id, FAE_CARTRIDGE_ID);
        assert.ok(cart.name.includes('Freeform Attrition Engine'));
        assert.strictEqual(cart.payload.rngEnabled, true);
        assert.strictEqual(cart.payload.rngQueueD20, true);
        assert.strictEqual(cart.payload.syspromptModules.saving_throws, false);
        assert.strictEqual(cart.payload.syspromptModules.attacks_per_round, false);
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'role'));
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'rng_system'));
        assert.ok(cart.payload.customSyspromptLibrary.some(s => s.tag === 'combat'));
        assert.ok(cart.payload.stockPrompts.character.includes('[CHARACTER]'));
        assert.ok(cart.payload.stockPrompts.combat.includes('[COMBAT]'));
    });

    test('buildTailoredFaeDocumentation formats comprehensive markdown documentation', () => {
        const doc = buildTailoredFaeDocumentation('osr_dungeon');
        assert.ok(doc.includes('# Freeform Attrition Engine (FAE) Framework Guide'));
        assert.ok(doc.includes('Gritty OSR Dungeon Crawl'));
        assert.ok(doc.includes('Two-Tier Pool Narration'));
        assert.ok(doc.includes('Torch & Supplies'));
        assert.ok(doc.includes('Guidelines for MultiHog Adventure Companion'));
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
        assert.ok(memoBlock.includes('FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko | [Advantage: Safe Combo]'));
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
        prevState.knobs.breather_available = false;
        prevState.character.scenes_completed = 1;

        // Case A: scenes_completed increases in next memo
        const nextMemo = formatInitialFaeMemo(prevState).replace('Scenes: 1/4', 'Scenes: 2/4');
        const reconciled = reconcileFaeMemoAfterTurn(prevState, nextMemo, 'osr_dungeon');
        assert.strictEqual(reconciled.state.knobs.breather_available, true);

        // Case B: encounter resolves
        const prevStateWithEnc = createInitialFaeState('osr_dungeon');
        prevStateWithEnc.knobs.breather_available = false;
        prevStateWithEnc.character.scenes_completed = 1;
        prevStateWithEnc.activeEncounter = {
            name: 'Goblin Patrol',
            currentHp: 1,
            maxHp: 2,
            threat: 2,
        };
        const nextMemoNoEnc = formatInitialFaeMemo(prevStateWithEnc);
        const reconciledEnc = reconcileFaeMemoAfterTurn(prevStateWithEnc, nextMemoNoEnc, 'osr_dungeon');
        assert.strictEqual(reconciledEnc.state.knobs.breather_available, true);
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
});
