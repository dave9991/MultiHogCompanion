/**
 * pbta-incapacitation-rules.test.js — MultiHog Companion
 *
 * Verifies that:
 * 1. buildPbtACombatContent dynamically scales Harm tiers according to harmMax (e.g. 5, 6, 4).
 * 2. buildPbtACombatContent mandates complete incapacitation at Max Harm (0 HP).
 * 3. buildPbtACyoaPrompt includes DOWNED / MAX HARM adaptive choices for unconscious/downed characters.
 * 4. buildPbtAStockPrompts strictly forbids D&D round/turn counters in conditions.
 * 5. buildPbtACartridge wires harmMax dynamically to buildPbtACombatContent.
 */

import assert from 'node:assert';
import {
    buildPbtACombatContent,
    buildPbtACyoaPrompt,
    buildPbtAStockPrompts,
    buildPbtACartridge,
} from '../pbta-ruleset.js';

console.log('--- Running PbtA Incapacitation & Downed CYOA Rules Test Suite ---');

// 1. Dynamic Harm Tiers in buildPbtACombatContent
console.log('Testing buildPbtACombatContent with default and dynamic harmMax...');

const combat5 = buildPbtACombatContent(5);
assert.ok(combat5.includes('5 Harm (Max Harm / 0 HP): Lethal / dying / unconscious (Status: Defeated / Incapacitated)'), '5 Harm must be marked Max Harm & Defeated');
assert.ok(combat5.includes('AT MAX HARM (5 Harm, 0 HP)'), 'Must include AT MAX HARM section for 5 Harm');
assert.ok(combat5.includes('CANNOT perform ordinary physical actions'), 'Must mandate that downed protagonist cannot act normally');

const combat6 = buildPbtACombatContent(6);
assert.ok(combat6.includes('6 Harm (Max Harm / 0 HP): Lethal / dying / unconscious (Status: Defeated / Incapacitated)'), '6 Harm must be marked Max Harm & Defeated');
assert.ok(combat6.includes('AT MAX HARM (6 Harm, 0 HP)'), 'Must include AT MAX HARM section for 6 Harm');
assert.ok(combat6.includes('5 Harm: Critical wound, organ damage'), '5 Harm in 6-max must be penultimate critical tier');

const combat4 = buildPbtACombatContent({ config: { harmMax: 4 } });
assert.ok(combat4.includes('4 Harm (Max Harm / 0 HP): Lethal / dying / unconscious (Status: Defeated / Incapacitated)'), '4 Harm must be marked Max Harm when passed in config');
assert.ok(combat4.includes('AT MAX HARM (4 Harm, 0 HP)'), 'Must include AT MAX HARM for 4 Harm');

console.log('✓ buildPbtACombatContent dynamically scales tiers and sets incapacitation threshold');

// 2. Downed / Max Harm CYOA Adaptive Choices
console.log('Testing buildPbtACyoaPrompt downed directives...');

const cyoa5 = buildPbtACyoaPrompt('fantasy', { playstyle: 'cyoa_5' });
assert.ok(cyoa5.includes('CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:'), 'Must include Downed CYOA section');
assert.ok(cyoa5.includes('CLING TO LIFE / LAST BREATH'), 'Must include Cling to Life / Last Breath option');
assert.ok(cyoa5.includes('FAINT UTTERANCE / CALL FOR AID'), 'Must include Faint Utterance option');
assert.ok(cyoa5.includes('SLIP INTO THE DARKNESS'), 'Must include Slip Into Darkness option');
assert.ok(cyoa5.includes('CRITICAL EXCEPTION: If {{user}} is downed at Max Harm / 0 HP'), 'Must instruct exception in order instructions');

const cyoa3 = buildPbtACyoaPrompt('scifi', { playstyle: 'cyoa_3' });
assert.ok(cyoa3.includes('CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:'), 'cyoa_3 must include Downed section');
assert.ok(cyoa3.includes('output 3 Downed/Crisis choices'), 'cyoa_3 must specify 3 Downed choices');

console.log('✓ buildPbtACyoaPrompt enforces adaptive Downed/Crisis choices at 0 HP');

// 3. Prohibition of D&D Round/Turn Counters in Stock Prompts
console.log('Testing buildPbtAStockPrompts condition rules...');

const stock6 = buildPbtAStockPrompts('fantasy', { config: { harmMax: 6, pacingXp: 5 } });
assert.ok(stock6.character.includes('NO D&D DAMAGE-OVER-TIME OR ROUND/TURN COUNTERS'), 'Must forbid D&D round counters in conditions');
assert.ok(stock6.character.includes('NEVER output "1 damage per round", "X turns remaining"'), 'Must explicitly ban turns remaining text');
assert.ok(stock6.character.includes('When {{user}} is at Max Harm / 0 HP (6/6 Harm, 0/6 HP), status MUST reflect incapacitation: Status: (-) Incapacitated, (-) Dying, or Defeated.'), 'Must specify status at max harm');

console.log('✓ buildPbtAStockPrompts bans D&D round tickers and enforces Incapacitated status');

// 4. Cartridge Integration with dynamic Harm
console.log('Testing buildPbtACartridge integration...');

const cart6 = buildPbtACartridge('fantasy', { config: { harmMax: 6, pacingXp: 5 } });
const combatSnippet = cart6.payload.customSyspromptLibrary.find(s => s.id === 'pbta_base_override_combat');
assert.ok(combatSnippet, 'Must include pbta_base_override_combat');
assert.ok(combatSnippet.content.includes('6 Harm (Max Harm / 0 HP)'), 'Cartridge combat prompt must use dynamic harmMax (6)');
assert.ok(combatSnippet.content.includes('AT MAX HARM (6 Harm, 0 HP)'), 'Cartridge must have 6 Harm incapacitation section');

console.log('✓ buildPbtACartridge properly wires dynamic harmMax into combat prompt');

console.log('--- ALL PBTA INCAPACITATION RULES TESTS PASSED CLEANLY! ---');
