import assert from 'node:assert';
import {
    PBTA_GENRES,
    buildPbtACartridge,
    buildPbtAStockPrompts,
    buildPbtAQuickStartInstructions,
    formatInitialPbtaMemo,
} from '../pbta-ruleset.js';
import { buildMonsterEntryContent } from '../concierge-npc-format.js';

console.log('--- Running PbtA QoL Formatting Test Suite ---');

// 1. Verify all 11 genre presets generate valid cartridges with ((PILLS)) prompts
const genres = Object.keys(PBTA_GENRES);
assert.strictEqual(genres.length, 11, `Expected 11 genres, found ${genres.length}`);

for (const genreKey of genres) {
    const cartridge = buildPbtACartridge(genreKey);
    assert.ok(cartridge, `Cartridge should build for genre: ${genreKey}`);
    const prompts = cartridge.payload.stockPrompts;

    // Character prompt
    assert.ok(prompts.character.includes('5/5 HP | Harm: 0/5'), `Character missing 5/5 HP in ${genreKey}`);
    assert.ok(prompts.character.includes('((PILLS)) Moves:'), `Character missing ((PILLS)) Moves in ${genreKey}`);
    assert.ok(prompts.character.includes('((PILLS)) Gear:'), `Character missing ((PILLS)) Gear in ${genreKey}`);
    assert.ok(prompts.character.includes('((PILLS)) Conditions:'), `Character missing ((PILLS)) Conditions in ${genreKey}`);

    // Party prompt
    assert.ok(prompts.party.includes('5/5 HP | Harm: 0/5'), `Party missing 5/5 HP in ${genreKey}`);
    assert.ok(prompts.party.includes('((PILLS)) Moves:'), `Party missing ((PILLS)) Moves in ${genreKey}`);
    assert.ok(prompts.party.includes('((PILLS)) Gear:'), `Party missing ((PILLS)) Gear in ${genreKey}`);
    assert.ok(prompts.party.includes('((PILLS)) Bonds:'), `Party missing ((PILLS)) Bonds in ${genreKey}`);
    assert.ok(prompts.party.includes('((PILLS)) Conditions:'), `Party missing ((PILLS)) Conditions in ${genreKey}`);

    // Combat prompt
    assert.ok(prompts.combat.includes('((PILLS)) Attacks:'), `Combat missing ((PILLS)) Attacks in ${genreKey}`);
}
console.log('✓ All 11 genre presets generate valid ((PILLS)) and tandem HP prompts');

// 2. Quick Start instructions
const qs = buildPbtAQuickStartInstructions('fantasy', 'Geralt', 'Monster hunt');
assert.ok(qs.includes('5/5 HP | Harm: 0/5'), 'Quick Start mandate missing 5/5 HP');
assert.ok(qs.includes('((PILLS)) Moves:'), 'Quick Start mandate missing ((PILLS)) Moves');
assert.ok(qs.includes('((PILLS)) Gear:'), 'Quick Start mandate missing ((PILLS)) Gear');
assert.ok(qs.includes('((PILLS)) Conditions:'), 'Quick Start mandate missing ((PILLS)) Conditions');
console.log('✓ Quick Start instructions mandate tandem HP and ((PILLS))');

// 3. formatInitialPbtaMemo with solo protagonist
const soloDossier = {
    protagonist: {
        name: 'Deckard',
        playbook: 'Blade Runner',
        harm: { max: 4, armor: 1 },
        stats: { Cool: 2, Edge: 1, Hard: 1, Mind: 0, Synth: -1 },
        startingMoves: [
            'Assess Situation (+Mind): Scan for exits and blind spots',
            'Act Under Pressure (+Cool) (Stay icy under fire)',
        ],
        gear: ['Blaster pistol', 'Longcoat'],
    },
    theKick: { startingLocation: 'Sector 4 Neon Alley' },
    config: { harmMax: 4, pacingXp: 5, partyMode: 'solo' },
};
const soloMemo = formatInitialPbtaMemo(soloDossier);
assert.ok(soloMemo.includes('Deckard (Blade Runner): 4/4 HP | Harm: 0/4 | Armor: 1'), 'Solo memo missing 4/4 HP anchor');
assert.ok(soloMemo.includes('((PILLS)) Moves: Assess Situation (+Mind) (Scan for exits and blind spots), Act Under Pressure (+Cool) (Stay icy under fire)'), 'Solo memo missing normalized ((PILLS)) moves');
assert.ok(soloMemo.includes('((PILLS)) Gear: Blaster pistol, Longcoat'), 'Solo memo missing ((PILLS)) Gear');
assert.ok(soloMemo.includes('((PILLS)) Conditions: None'), 'Solo memo missing ((PILLS)) Conditions');
assert.ok(!soloMemo.includes('[PARTY]'), 'Solo memo should not have [PARTY] block');
console.log('✓ formatInitialPbtaMemo correctly formats solo protagonist with 4/4 HP, normalized pill moves, and pill gear');

// 4. formatInitialPbtaMemo with party companions
const squadDossier = {
    ...soloDossier,
    config: { harmMax: 5, pacingXp: 5, partyMode: 'squad' },
    npcs: [
        {
            name: 'Rachael',
            role: 'Companion',
            movesOrBoons: 'Nexus Empathy: Read synth emotional resonance',
            appearance: 'Dark tailored suit, obsidian eyes',
            relationship: 'Bound by secret origin',
            equipment: 'Derringer pistol (2 Harm)',
        },
    ],
};
const squadMemo = formatInitialPbtaMemo(squadDossier);
assert.ok(squadMemo.includes('[PARTY]'), 'Squad memo must include [PARTY]');
assert.ok(squadMemo.includes('Rachael (Companion): 5/5 HP | Harm: 0/5 | Armor: 0'), 'Companion missing 5/5 HP');
assert.ok(squadMemo.includes('((PILLS)) Moves: Nexus Empathy (Read synth emotional resonance)'), 'Companion boon missing normalized ((PILLS))');
assert.ok(squadMemo.includes('((PILLS)) Gear: Derringer pistol (2 Harm)'), 'Companion gear missing ((PILLS))');
assert.ok(squadMemo.includes('((PILLS)) Bonds: Bound by secret origin'), 'Companion bond missing ((PILLS))');
assert.ok(squadMemo.includes('((PILLS)) Conditions: None'), 'Companion missing ((PILLS)) Conditions');
console.log('✓ formatInitialPbtaMemo correctly formats squad companions with 5/5 HP, ((PILLS)) moves, gear, and bonds');

// 5. buildMonsterEntryContent
const mockMonster = {
    name: 'Gargoyle Stalker',
    harm: 3,
    armor: 2,
    attacks: ['Stone Claws (2 Harm, hand)', 'Dive Bomb (3 Harm, far, clumsy)'],
    weakness: 'Blunt sonic impact',
    impendingDoom: ['Roosting', 'Cathedral strike'],
};
const fieldNames = {
    sec_background: 'Background',
    sec_strengths: 'Attacks / Strengths',
    sec_flaws: 'Weaknesses',
    sec_combat_profile: 'Combat Profile',
};
const monsterEntry = buildMonsterEntryContent(mockMonster, fieldNames);
assert.ok(monsterEntry.core.includes('Gargoyle Stalker: 3/3 HP | Harm: 0/3 | Armor: 2'), 'Monster missing 3/3 HP');
assert.ok(monsterEntry.core.includes('((PILLS)) Attacks: Stone Claws (2 Harm, hand), Dive Bomb (3 Harm, far, clumsy)'), 'Monster missing ((PILLS)) Attacks');
assert.ok(monsterEntry.core.includes('((PILLS)) Weakness: Blunt sonic impact'), 'Monster missing ((PILLS)) Weakness');
console.log('✓ buildMonsterEntryContent generates ((PILLS)) attacks and weaknesses');

console.log('--- ALL STAGE 3 TESTS PASSED CLEANLY! ---');
