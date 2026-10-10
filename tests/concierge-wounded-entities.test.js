/**
 * Test suite for Wounded PC, Party Companions, and Adversaries in PbtA Concierge.
 */

import assert from 'node:assert';
import { createEmptyDossier, applyDossierUpdates, formatDossierForContext, serializeDossierToMarkdown } from '../concierge-parser.js';
import { formatInitialPbtaMemo } from '../pbta-ruleset.js';
import { buildMonsterEntryContent } from '../concierge-npc-format.js';

console.log('--- Running Wounded Entities Test Suite ---');

// 1. Parsing a Wounded Protagonist
{
    const dossier = createEmptyDossier();
    const updateText = `
[UPDATE_DOSSIER]
[PROTAGONIST]
name: Silas Vance
playbook: The Professional
stats: Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1
harm: 2/5
armor: 1
conditions: (-) Broken Rib (-1 to Hard), (-) Concussed
status: (-) Wounded
bio: Surviving an ambush in the woods.
[/PROTAGONIST]
[/UPDATE_DOSSIER]
`;
    const res = applyDossierUpdates(updateText, dossier);
    assert.strictEqual(res.success, true);
    const p = res.updatedDossier.protagonist;
    assert.strictEqual(p.name, 'Silas Vance');
    assert.strictEqual(p.harm.current, 2);
    assert.strictEqual(p.harm.max, 5);
    assert.strictEqual(p.harm.armor, 1);
    assert.deepStrictEqual(p.conditions, ['(-) Broken Rib (-1 to Hard)', '(-) Concussed']);
    assert.strictEqual(p.status, '(-) Wounded');
    console.log('✓ Wounded protagonist parsed successfully with harm: 2/5, conditions, and status');
}

// 2. Parsing a Wounded Party Companion
{
    const dossier = createEmptyDossier();
    const updateText = `
[UPDATE_DOSSIER]
[NPC]
name: Marta
role: Traveling Companion
appearance: Weathered face, oilskin coat
harm: 1/5
armor: 1
conditions: (-) Sprained Ankle
status: (-) Wounded
moves_or_boons: Safe Harbor
[/NPC]
[/UPDATE_DOSSIER]
`;
    const res = applyDossierUpdates(updateText, dossier);
    assert.strictEqual(res.success, true);
    const n = res.updatedDossier.npcs[0];
    assert.strictEqual(n.name, 'Marta');
    assert.strictEqual(n.harm.current, 1);
    assert.strictEqual(n.harm.max, 5);
    assert.strictEqual(n.harm.armor, 1);
    assert.deepStrictEqual(n.conditions, ['(-) Sprained Ankle']);
    assert.strictEqual(n.status, '(-) Wounded');
    console.log('✓ Wounded party companion parsed successfully with harm: 1/5, conditions, and status');
}

// 3. Parsing a Wounded Adversary / Monster
{
    const dossier = createEmptyDossier();
    const updateText = `
[UPDATE_DOSSIER]
[MONSTER]
name: The Ash Wendigo
harm: 2/4
armor: 1
status: (-) Wounded
attacks: Frost Claws (2 Harm)
weakness: Fire
[/MONSTER]
[/UPDATE_DOSSIER]
`;
    const res = applyDossierUpdates(updateText, dossier);
    assert.strictEqual(res.success, true);
    const m = res.updatedDossier.monsters[0];
    assert.strictEqual(m.name, 'The Ash Wendigo');
    assert.strictEqual(m.currentHarm, 2);
    assert.strictEqual(m.harm, 4);
    assert.strictEqual(m.status, '(-) Wounded');
    console.log('✓ Wounded adversary parsed successfully with harm: 2/4 and status');
}

// 4. Initial Memo Generation for Wounded PC and Party Companion
{
    const dossier = createEmptyDossier();
    dossier.protagonist = {
        name: 'Silas Vance',
        playbook: 'The Professional',
        stats: { Cool: 2, Sharp: 1, Hard: 1, Hot: 0, Weird: -1 },
        harm: { max: 5, current: 2, armor: 1 },
        conditions: ['(-) Broken Rib (-1 to Hard)', '(-) Concussed'],
        status: '(-) Wounded',
        startingMoves: ['Act Under Fire (+Cool)'],
        gear: ['Service Pistol (2 Harm)'],
    };
    dossier.npcs = [
        {
            name: 'Marta',
            role: 'Traveling Companion',
            appearance: 'Weathered face, oilskin coat',
            harm: { max: 5, current: 1, armor: 0 },
            conditions: ['(-) Sprained Ankle'],
            status: '(-) Wounded',
            movesOrBoons: 'Safe Harbor',
            relationship: 'Old ally',
        }
    ];

    const memo = formatInitialPbtaMemo(dossier);

    // Verify PC Block has descending tandem HP: (5 max - 2 cur) = 3 HP
    assert.match(memo, /Silas Vance \(The Professional\): 3\/5 HP \| Harm: 2\/5 \| Armor: 1/);
    assert.match(memo, /\(\(PILLS\)\) Conditions: \(-\) Broken Rib \(-1 to Hard\), \(-\) Concussed/);
    assert.match(memo, /Status: \(-\) Wounded/);

    // Verify PARTY Block has descending tandem HP: (5 max - 1 cur) = 4 HP
    assert.match(memo, /Marta \(Traveling Companion\): 4\/5 HP \| Harm: 1\/5 \| Armor: 0/);
    assert.match(memo, /\(\(PILLS\)\) Conditions: \(-\) Sprained Ankle/);
    assert.match(memo, /Status: \(-\) Wounded/);
    console.log('✓ formatInitialPbtaMemo generates correct tandem HP, conditions, and status for wounded PC and companion');
}

// 5. Monster Entry Generation for Wounded Adversary
{
    const monster = {
        name: 'The Ash Wendigo',
        harm: 4,
        currentHarm: 2,
        armor: 1,
        attacks: ['Frost Claws (2 Harm)'],
        weakness: 'Fire',
        status: '(-) Wounded',
    };
    const entry = buildMonsterEntryContent(monster);
    // curHp = 4 - 2 = 2
    assert.match(entry.core, /The Ash Wendigo: 2\/4 HP \| Harm: 2\/4 \| Armor: 1/);
    assert.match(entry.core, /Status: \(-\) Wounded/);
    console.log('✓ buildMonsterEntryContent generates correct tandem HP and status for wounded adversary');
}

// 6. Context Formatting & Serialization Round-Trip
{
    const dossier = createEmptyDossier();
    dossier.protagonist = {
        name: 'Silas Vance',
        playbook: 'The Professional',
        harm: { max: 5, current: 2, armor: 1 },
        conditions: ['(-) Concussed'],
        status: '(-) Wounded',
    };
    dossier.npcs = [
        {
            name: 'Marta',
            role: 'Traveling Companion',
            harm: { max: 5, current: 1, armor: 0 },
            conditions: ['(-) Sprained Ankle'],
            status: '(-) Wounded',
        }
    ];
    dossier.monsters = [
        {
            name: 'Wendigo',
            harm: 4,
            currentHarm: 2,
            armor: 1,
            status: '(-) Wounded',
        }
    ];

    const ctx = formatDossierForContext(dossier);
    assert.match(ctx, /harm: 2\/5/);
    assert.match(ctx, /conditions: \(-\) Concussed/);
    assert.match(ctx, /status: \(-\) Wounded/);

    const md = serializeDossierToMarkdown(dossier);
    assert.match(md, /2\/5 \(Wounded\)/);
    assert.match(md, /\*\*Status:\*\*\s*\(-\)\s*Wounded/);
    console.log('✓ formatDossierForContext and serializeDossierToMarkdown preserve starting wounds in context');
}

console.log('--- ALL WOUNDED ENTITY TESTS PASSED CLEANLY! ---');
