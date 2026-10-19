import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isProtagonistDowned,
    extractChoicesMarkup,
    buildCyoaPrompt,
} from '../cyoa-generator.js';

describe('CYOA Choice Generator Edge Cases', () => {

    it('accurately identifies downed protagonist across diverse narrative cues without false positives', () => {
        // True positives in PbtA memo
        const pbtaDownedMemo = '[CHARACTER]\n- Kaelen: 0/5 HP | Harm: 5/5 | Armor: 0';
        assert.strictEqual(isProtagonistDowned(pbtaDownedMemo, true), true);

        // Status keywords
        const dyingMemo = '[CHARACTER]\n- Silas: 1/5 HP | Harm: 4/5\nStatus: Mortally Wounded';
        assert.strictEqual(isProtagonistDowned(dyingMemo, true), true);

        // D&D 0 HP
        const dndDownedMemo = 'Hero: 0/45 HP | AC: 16';
        assert.strictEqual(isProtagonistDowned(dndDownedMemo, false), true);

        // False positive prevention: enemy is downed, but protagonist is healthy
        const healthyMemoWithEnemyDown = `
[CHARACTER]
- Kaelen: 5/5 HP | Harm: 0/5 | Armor: 1
Status: Ready
[ENEMIES]
- Goblin Raider: 0/7 HP | AC: 12
Status: Incapacitated
`;
        assert.strictEqual(isProtagonistDowned(healthyMemoWithEnemyDown, true), false, 'Must not report protagonist downed when only enemy is incapacitated');

        // Standard healthy narrative
        assert.strictEqual(isProtagonistDowned('[CHARACTER]\n- Kael: 4/5 HP | Harm: 1/5', true), false);
    });

    it('extracts and repairs choice markup across varied LLM formatting quirks', () => {
        // 1. Thinking tags before choices
        const rawWithThoughts = `
<think>
I need to generate 3 choices for the player.
1. Attack the bandit
2. Dodge behind cover
3. Cast shield
</think>
<choices>
<button>1. ⚡ Strike the bandit captain</button>
<button>2. 🛡️ Dive behind the overturned cart</button>
<button>3. 🔮 Channel an arcane ward</button>
</choices>
`;
        const cleaned1 = extractChoicesMarkup(rawWithThoughts);
        assert.ok(!cleaned1.includes('<think>'), 'Must strip thinking block');
        assert.ok(cleaned1.includes('<choices>'));
        assert.ok(cleaned1.includes('<button>1. ⚡ Strike the bandit captain</button>'));
        assert.ok(cleaned1.includes('<button>2. 🛡️ Dive behind the overturned cart</button>'));
        assert.ok(cleaned1.includes('<button>3. 🔮 Channel an arcane ward</button>'));

        // 2. Unclosed <choices> block (cut off by token limit)
        const unclosedBlock = `
<choices>
<button>1. Examine the locked chest</button>
<button>2. Search the desk drawers</button>
`;
        const cleaned2 = extractChoicesMarkup(unclosedBlock);
        assert.ok(cleaned2.startsWith('<choices>'));
        assert.ok(cleaned2.endsWith('</choices>'));
        assert.ok(cleaned2.includes('<button>1. Examine the locked chest</button>'));
        assert.ok(cleaned2.includes('<button>2. Search the desk drawers</button>'));

        // 3. Markdown numbered list without XML tags
        const markdownList = `
Here are your available choices:
1. Leap across the chasm
2. Look for another way around
3. Lower a rope for the party
`;
        const cleaned3 = extractChoicesMarkup(markdownList);
        assert.ok(cleaned3.startsWith('<choices>'));
        assert.ok(cleaned3.includes('<button>1. Leap across the chasm</button>'));
        assert.ok(cleaned3.includes('<button>2. Look for another way around</button>'));
        assert.ok(cleaned3.includes('<button>3. Lower a rope for the party</button>'));
        assert.ok(cleaned3.endsWith('</choices>'));
    });

    it('constructs specialized survival prompts when protagonist is downed', () => {
        const downedMemo = '[CHARACTER]\n- Lyra (Mage): 0/5 HP | Harm: 5/5 | Armor: 0\nStatus: Incapacitated';
        const narrative = 'The dragon breath knocks Lyra to the stone floor, her vision fading.';

        const prompt = buildCyoaPrompt({
            narrative,
            memo: downedMemo,
            isPbta: true,
            rpgSettings: {
                pbtaGenre: 'fantasy',
                cyoaConfig: { playstyle: 'cyoa_3' }
            }
        });

        assert.ok(prompt.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / INCAPACITATED'));
        assert.ok(prompt.systemPrompt.includes('exactly 3 Downed/Crisis survival choices'));
        assert.ok(prompt.systemPrompt.includes('CLING TO LIFE / LAST BREATH'));
        assert.ok(prompt.userPrompt.includes(narrative));
    });

    it('respects choice count configuration between cyoa_3 and cyoa_5 playstyles', () => {
        const healthyMemo = '[CHARACTER]\n- Lyra: 5/5 HP | Harm: 0/5';
        const narrative = 'You reach the crossroads.';

        const prompt3 = buildCyoaPrompt({
            narrative,
            memo: healthyMemo,
            isPbta: true,
            rpgSettings: { cyoaConfig: { playstyle: 'cyoa_3' } }
        });
        assert.ok(prompt3.systemPrompt.includes('exactly 3 choices'));

        const prompt5 = buildCyoaPrompt({
            narrative,
            memo: healthyMemo,
            isPbta: true,
            rpgSettings: { cyoaConfig: { playstyle: 'cyoa_5' } }
        });
        assert.ok(prompt5.systemPrompt.includes('exactly 5 choices'));
    });

});
