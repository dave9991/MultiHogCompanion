/**
 * Verifies the PbtA core-rule prompts reinforce the canonical PbtA loop.
 */
import assert from 'node:assert';
import {
    buildPbtARoleContent,
    buildPbtARngContent,
    buildPbtARulesetNoteContent,
    buildPbtAFooterContent,
    buildPbtAStockPrompts,
} from '../pbta-ruleset.js';

const role = buildPbtARoleContent();
assert.ok(/GM MOVES/.test(role), 'role lists GM moves');
assert.ok(/NPCs and enemies NEVER roll/.test(role), 'role states NPCs never roll');
assert.ok(/Routine actions and ordinary conversation NEVER roll/.test(role), 'role states trigger rule');

const rng = buildPbtARngContent();
assert.ok(/2d6 → 3 \+ 5 = 8/.test(rng), 'rng documents queue line format');
assert.ok(/10\+ Strong Hit/.test(rng) && /7–9 Weak Hit/.test(rng) && /6- Miss/.test(rng), 'rng has all tiers');
assert.ok(/Forward:/.test(rng) && /Hold:/.test(rng), 'rng defines forward and hold');
assert.ok(!/-3 to \+3/.test(rng), 'modifier range is consistent');

assert.ok(!/10\+ Full Success/.test(buildPbtARulesetNoteContent()), 'ruleset_note does not duplicate tiers');
assert.ok(/\/7\)/.test(buildPbtAFooterContent(7, 5)), 'footer uses provided harmMax');
assert.ok(!/disadvantage/i.test(buildPbtAStockPrompts('fantasy').combat.replace(/NEVER[^\n]*disadvantage/gi, '')), 'no D&D disadvantage leak in combat stock prompt');

console.log('--- ALL PBTA CORE RULES PROMPT TESTS PASSED CLEANLY! ---');
