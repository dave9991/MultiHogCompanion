/**
 * pbta-dossier-sync-nondestructive.test.js
 *
 * Verifies that pulling a campaign dossier back into the concierge and clicking
 * "Sync to Active Game" is 100% non-destructive to active tactical state:
 * 1. Active [COMBAT] and [ENEMIES] blocks are never wiped or overwritten.
 * 2. Active conditions (e.g. Bleeding, Shaken) are preserved.
 * 3. Compressing scale (e.g. 5/6 Harm to max 4) rescales to 3/4 Harm (alive stays alive).
 * 4. Expanding scale (e.g. 2/4 Harm to max 6) preserves raw injuries (2/6 Harm).
 * 5. Dead/incapacitated character at max harm (e.g. 6/6) stays at max harm (4/4).
 */

import assert from 'node:assert';
import {
    calculateRescaledHarm,
    rescalePbtaHarmLine,
    mergeDossierIntoLiveMemo,
} from '../pbta-vitality-sync.js';

console.log('--- Running Non-Destructive Dossier Sync & Harm Rescaling Tests ---');

// ── 1. calculateRescaledHarm Tests ───────────────────────────────────────────
console.log('Testing calculateRescaledHarm algorithm...');

// 1a. User specific case: 5/6 Harm compressing to Max 4 -> Must be 3/4 Harm (Alive stays alive!)
const res1 = calculateRescaledHarm(5, 6, 4);
assert.strictEqual(res1, 3, '5/6 Harm rescaled to Max 4 must become 3/4 Harm (never 4/4 dying)');

// 1b. 4/5 Harm compressing to Max 4 -> Must be 3/4 Harm
const res2 = calculateRescaledHarm(4, 5, 4);
assert.strictEqual(res2, 3, '4/5 Harm rescaled to Max 4 must become 3/4 Harm');

// 1c. 1/6 Harm compressing to Max 4 -> Must become 1/4 Harm
const res3 = calculateRescaledHarm(1, 6, 4);
assert.strictEqual(res3, 1, '1/6 Harm rescaled to Max 4 must become 1/4 Harm');

// 1d. 0/6 Harm (uninjured) -> Remains 0 Harm
const res4 = calculateRescaledHarm(0, 6, 4);
assert.strictEqual(res4, 0, '0 Harm remains 0 Harm');

// 1e. 6/6 Harm (already dead/incapacitated) compressing to Max 4 -> Remains at Max (4)
const res5 = calculateRescaledHarm(6, 6, 4);
assert.strictEqual(res5, 4, 'Already dead/incapacitated character (6/6) stays at max harm (4/4)');

// 1f. Expanding scale: 2/4 Harm expanding to Max 6 -> Preserves raw damage (2/6)
const res6 = calculateRescaledHarm(2, 4, 6);
assert.strictEqual(res6, 2, 'Expanding scale from 4 to 6 preserves 2 accrued damage (2/6)');

console.log('✓ calculateRescaledHarm passed all mathematical boundary tests');

// ── 2. rescalePbtaHarmLine Tests ─────────────────────────────────────────────
console.log('Testing rescalePbtaHarmLine line formatter...');

const lineA = 'Deckard (Blade Runner): 1/6 HP | Harm: 5/6 | Armor: 1';
const rescaledLineA = rescalePbtaHarmLine(lineA, 4);
assert.strictEqual(
    rescaledLineA,
    'Deckard (Blade Runner): 1/4 HP | Harm: 3/4 | Armor: 1',
    'Tandem HP & Harm line must rescale to 1/4 HP | Harm: 3/4'
);

const lineB = '- Rachael: Harm: 4/5 | Conditions: ((PILLS)) Shaken';
const rescaledLineB = rescalePbtaHarmLine(lineB, 4);
assert.strictEqual(
    rescaledLineB,
    '- Rachael: 1/4 HP | Harm: 3/4 | Conditions: ((PILLS)) Shaken',
    'Harm-only line must rescale tandem HP and Harm while preserving conditions'
);

console.log('✓ rescalePbtaHarmLine passed line format tests');

// ── 3. mergeDossierIntoLiveMemo Non-Destructive Tests ─────────────────────────
console.log('Testing mergeDossierIntoLiveMemo on active gameplay memos...');

const activeGameplayMemo = `[TIME]
Day 2, 11:30 PM (Midnight)
[/TIME]
[LOCATION]
The Flooded Catacombs - Sub-level 3
[/LOCATION]
[CHARACTER]
Talon (Ranger): 1/6 HP | Harm: 5/6 | Armor: 1
Stats: Cool +2, Hard +1, Sharp +1, Scrap 0, Weird -1
((PILLS)) Moves: Volley (+Sharp), Read a Sitch (+Sharp)
((PILLS)) Conditions: Bleeding (Right Shoulder), Shaken
((PILLS)) Gear: Recurve Bow (2 Harm, Far), Quiver (3 arrows)
[/CHARACTER]
[PARTY]
Lyra (Mage): 3/5 HP | Harm: 2/5 | Armor: 0
((PILLS)) Moves: Cast Spell (+Weird)
[/PARTY]
[COMBAT]
Round 3 (Party Initiative)
[/COMBAT]
[ENEMIES]
- Shadow Stalker: 1/4 HP | Harm: 3/4 | Status: Enraged, Cloaked
- Cave Beetle: 2/2 HP | Harm: 0/2 | Status: Skittering on ceiling
[/ENEMIES]`;

const updatedDossier = {
    meta: {
        title: 'Grimdark Odyssey',
        systemKey: 'fantasy',
        systemLabel: 'Fantasy PbtA',
    },
    protagonist: {
        name: 'Talon',
        playbook: 'Shadow Ranger', // Playbook updated
        stats: { Cool: 2, Hard: 2, Sharp: 1, Scrap: 0, Weird: -1 }, // Hard updated to +2
    },
    config: {
        harmMax: 4, // Max harm changed from 6 to 4!
    },
};

const merged = mergeDossierIntoLiveMemo(activeGameplayMemo, updatedDossier, 'Talon');

// Assertions:
// 1. Enemies block must be 100% intact
assert.ok(merged.includes('[COMBAT]\nRound 3 (Party Initiative)\n[/COMBAT]'), 'Combat section must be preserved');
assert.ok(merged.includes('[ENEMIES]'), 'Enemies block must be preserved');
assert.ok(merged.includes('Shadow Stalker: 1/4 HP | Harm: 3/4 | Status: Enraged, Cloaked'), 'Enemy 1 must be preserved');
assert.ok(merged.includes('Cave Beetle: 2/2 HP | Harm: 0/2 | Status: Skittering on ceiling'), 'Enemy 2 must be preserved');

// 2. Party companions must be preserved
assert.ok(merged.includes('Lyra (Mage): 3/5 HP | Harm: 2/5 | Armor: 0'), 'Party companions must be preserved');

// 3. Location and Time must be preserved
assert.ok(merged.includes('The Flooded Catacombs - Sub-level 3'), 'Active location must be preserved');
assert.ok(merged.includes('Day 2, 11:30 PM (Midnight)'), 'Active time must be preserved');

// 4. Protagonist conditions and gear must be preserved
assert.ok(merged.includes('((PILLS)) Conditions: Bleeding (Right Shoulder), Shaken'), 'Protagonist conditions must be preserved');
assert.ok(merged.includes('((PILLS)) Gear: Recurve Bow (2 Harm, Far), Quiver (3 arrows)'), 'Protagonist gear must be preserved');

// 5. Protagonist vitality must be rescaled from 5/6 to 3/4 (1/4 HP)
assert.ok(merged.includes('Talon (Shadow Ranger): 1/4 HP | Harm: 3/4 | Armor: 1'), 'Protagonist must have rescaled 1/4 HP and Harm 3/4 with updated Playbook');

// 6. Protagonist stats must be updated
assert.ok(merged.includes('Stats: Cool +2, Hard +2, Sharp +1, Scrap 0, Weird -1'), 'Protagonist stats must reflect dossier update');

console.log('✓ mergeDossierIntoLiveMemo cleanly preserved all active enemies, combat, location, conditions, and rescaled PC harm!');

console.log('\n--- ALL NON-DESTRUCTIVE DOSSIER SYNC TESTS PASSED CLEANLY! ---');
