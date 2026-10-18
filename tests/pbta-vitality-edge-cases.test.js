import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateRescaledHarm,
    rescalePbtaHarmLine,
    normalizePbtaVitalityLine,
    normalizePbtaMemo,
} from '../pbta-vitality-sync.js';

describe('PbtA Vitality & Harm Math Edge Cases', () => {

    it('strictly preserves life across scale compression (alive characters never die on dial change)', () => {
        // Old max 6, compressed to 3. Character with 5 harm (alive, 1 HP left)
        const compressedHarm = calculateRescaledHarm(5, 6, 3);
        assert.strictEqual(compressedHarm, 2, 'Must clamp to aliveCap (newMax - 1 = 2) so character remains alive');

        // Character with 0 harm remains at 0 harm
        assert.strictEqual(calculateRescaledHarm(0, 6, 3), 0);

        // Character already incapacitated at 6/6 maps to 3/3
        assert.strictEqual(calculateRescaledHarm(6, 6, 3), 3);
        // Character over max at 8/6 maps to 3/3
        assert.strictEqual(calculateRescaledHarm(8, 6, 3), 3);
    });

    it('preserves raw damage when scale expands without exceeding alive cap', () => {
        // Old max 4, expanded to 7. Character has 2 harm.
        assert.strictEqual(calculateRescaledHarm(2, 4, 7), 2);

        // Character has 3 harm (alive at 4). On expansion to 7, still has 3 harm.
        assert.strictEqual(calculateRescaledHarm(3, 4, 7), 3);

        // Incapacitated at 4/4 maps to 7/7
        assert.strictEqual(calculateRescaledHarm(4, 4, 7), 7);
    });

    it('gracefully normalizes extreme, invalid, or negative values', () => {
        assert.strictEqual(calculateRescaledHarm(-5, 5, 5), 0);
        assert.strictEqual(calculateRescaledHarm('invalid', 'bad', 'wrong'), 0);
        assert.strictEqual(calculateRescaledHarm(null, undefined, 5), 0);
        // When 0 max is passed, defaults to standard 5 max; 3 harm maps to 3 harm
        assert.strictEqual(calculateRescaledHarm(3, 0, 0), 3);
    });

    it('rescales tandem HP correctly in single line formats with varied bullet markers', () => {
        const lineBullet = '• Marcus (Gunslinger): 2/6 HP | Harm: 4/6 | Armor: 1';
        const rescaled = rescalePbtaHarmLine(lineBullet, 4, 'Marcus');
        // Old max 6, curHarm 4 -> proportional to max 4: round((4/6)*4) = round(2.66) = 3. Capped at newMax-1=3.
        // HP = 4 - 3 = 1/4 HP | Harm: 3/4
        assert.strictEqual(rescaled, '• Marcus (Gunslinger): 1/4 HP | Harm: 3/4 | Armor: 1');

        // Target mismatch should leave line untouched
        const untouched = rescalePbtaHarmLine(lineBullet, 4, 'OtherCharacter');
        assert.strictEqual(untouched, lineBullet);
    });

    it('normalizes malformed harm lines with irregular spacing or missing HP', () => {
        const lineColon = '- Sarah: Harm:3/5 | Armor:2';
        const normalized = normalizePbtaVitalityLine(lineColon);
        assert.strictEqual(normalized, '- Sarah: 2/5 HP | Harm: 3/5 | Armor:2');

        const lineHarmWord = 'Raven: 4/5 Harm';
        const normHarmWord = normalizePbtaVitalityLine(lineHarmWord);
        assert.strictEqual(normHarmWord, 'Raven: 1/5 HP | Harm: 4/5');
    });

    it('leaves standard non-harm D&D stat lines completely unmodified', () => {
        const dndLine = '- Goblin Archer: 7/7 HP | AC: 13 | Speed: 30ft';
        assert.strictEqual(normalizePbtaVitalityLine(dndLine), dndLine);
        assert.strictEqual(rescalePbtaHarmLine(dndLine, 5), dndLine);
    });

    it('normalizes multi-line memos containing both character, companion, and enemy harm', () => {
        const memo = `
[CHARACTER]
- Jinx (Saboteur): Harm: 2/5 | Armor: 0
Stats: Cool +2, Hard 0
Moves: ((PILLS)) Trick Shot (+Cool), Sabotage (+Weird)
Conditions: ((PILLS)) Shaken
[/CHARACTER]

[ENEMIES]
- Enforcer Mech: Harm: 4/6 | Armor: 2
[/ENEMIES]
`;
        const normalized = normalizePbtaMemo(memo);
        assert.ok(normalized.includes('Jinx (Saboteur): 3/5 HP | Harm: 2/5 | Armor: 0'));
        assert.ok(normalized.includes('Enforcer Mech: 2/6 HP | Harm: 4/6 | Armor: 2'));
    });

});
