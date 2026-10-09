/**
 * concierge-world-rules-parser.test.js — MultiHog Companion
 *
 * Tests for Step 1: World Rules Dossier Schema, Parser, and Markdown Serialization.
 */

import assert from 'assert';
import {
    createEmptyDossier,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
} from '../concierge-parser.js';

console.log('--- Running Concierge World Rules & Custom Module Test Suite ---');

// 1. Defaults in createEmptyDossier
console.log('Testing createEmptyDossier defaults...');
{
    const d = createEmptyDossier();
    assert.ok(d.worldRules, 'dossier.worldRules should exist');
    assert.ok(Array.isArray(d.worldRules.axioms), 'dossier.worldRules.axioms should be an array');
    assert.strictEqual(d.worldRules.axioms.length, 0, 'dossier.worldRules.axioms should default empty');
    assert.strictEqual(d.worldRules.customModule, null, 'dossier.worldRules.customModule should default null');
    console.log('✓ createEmptyDossier defaults clean worldRules structure');
}

// 2. Parsing [WORLD_RULES] and [CUSTOM_MODULE] via applyDossierUpdates
console.log('Testing applyDossierUpdates [WORLD_RULES] and [CUSTOM_MODULE]...');
{
    const d = createEmptyDossier();
    const updateText = `
[UPDATE_DOSSIER]
summary: Establish biopunk technology rules and living weapon tracking

[WORLD_RULES]
title: Biomechanical Substitution
category: technology
axiom: Mechanical machinery and gunpowder are replaced by bio-engineered organisms.
substitutions:
- Cars/Vehicles -> Six-legged crawler beasts and chitin carriages
- Firearms -> Spitting vipers and acid-bladder beetles
negative_constraints:
- BANNED: Internal combustion engines, tires, gunpowder, metal firearms
architectural_notes: Parking garages replaced by stabling pens; armories are nurseries
[/WORLD_RULES]

[CUSTOM_MODULE]
tag: SYMBIOTES
label: Living Arsenal & Mounts
icon: 🐍
instruction: Track bonded symbiotes, feeding status (e.g. Fed 3/3), and stabled mounts.
sample:
- Spitting Viper: Fed (3/3 venom) | Docile
- Chitin Carapace: Molting in 2 days | +2 Armor
- Six-Legged Runner: Stabled at Gate | Well-fed
[/CUSTOM_MODULE]
[/UPDATE_DOSSIER]
`;

    const result = applyDossierUpdates(updateText, d);
    assert.ok(result.success, 'Parsing should succeed');
    assert.ok(result.hasMutations, 'Should detect mutations');
    assert.strictEqual(result.updatedDossier.worldRules.axioms.length, 1, 'Should have 1 world rule');

    const rule = result.updatedDossier.worldRules.axioms[0];
    assert.strictEqual(rule.title, 'Biomechanical Substitution');
    assert.strictEqual(rule.category, 'technology');
    assert.strictEqual(rule.axiom, 'Mechanical machinery and gunpowder are replaced by bio-engineered organisms.');
    assert.strictEqual(rule.substitutions.length, 2, 'Should have 2 substitutions');
    assert.strictEqual(rule.substitutions[0], 'Cars/Vehicles -> Six-legged crawler beasts and chitin carriages');
    assert.strictEqual(rule.negativeConstraints.length, 1, 'Should have 1 negative constraint line');
    assert.ok(rule.negativeConstraints[0].includes('BANNED: Internal combustion engines'));
    assert.ok(rule.architecturalNotes.includes('Parking garages replaced by stabling pens'));

    const mod = result.updatedDossier.worldRules.customModule;
    assert.ok(mod, 'Custom module should exist');
    assert.strictEqual(mod.tag, 'SYMBIOTES');
    assert.strictEqual(mod.label, 'Living Arsenal & Mounts');
    assert.strictEqual(mod.icon, '🐍');
    assert.ok(mod.instruction.includes('Track bonded symbiotes'));
    assert.ok(mod.sampleContent.includes('Spitting Viper: Fed'));

    console.log('✓ Successfully parsed [WORLD_RULES] and [CUSTOM_MODULE] blocks');
}

// 3. Incremental rule updates, removals, and multiple rules
console.log('Testing multiple rules, update-in-place, and removals...');
{
    let d = createEmptyDossier();

    // Step A: Add two rules
    const textA = `
[UPDATE_DOSSIER]
summary: Add aerial physiology rule

[WORLD_RULE]
title: Universal Innate Flight
category: physiology
axiom: Every human naturally has functional wings.
substitutions:
- Stairs/Elevators -> Vertical flight shafts and cantilevered perches
negative_constraints:
- BANNED: Wingless humans, non-vertical transit
architectural_notes: Open rooftop atriums and exterior roosts
[/WORLD_RULE]

[WORLD_RULE]
title: Atmospheric Turbulence
category: ecology
axiom: High-altitude storms cause extreme downdrafts.
[/WORLD_RULE]
[/UPDATE_DOSSIER]
`;

    let resA = applyDossierUpdates(textA, d);
    assert.strictEqual(resA.updatedDossier.worldRules.axioms.length, 2, 'Should have 2 rules');

    // Step B: Update one rule in place and remove the other
    const textB = `
[UPDATE_DOSSIER]
summary: Update flight axiom and remove turbulence

[WORLD_RULE]
title: Universal Innate Flight
axiom: Every humanoid has large, bright wings capable of sustained flight.
architectural_notes: Buildings lack ground doors; primary entrances are 5th-floor balconies.
[/WORLD_RULE]

[REMOVE_WORLD_RULE: Atmospheric Turbulence]
[/UPDATE_DOSSIER]
`;

    let resB = applyDossierUpdates(textB, resA.updatedDossier);
    assert.strictEqual(resB.updatedDossier.worldRules.axioms.length, 1, 'Should have 1 rule left after removal');
    assert.strictEqual(resB.updatedDossier.worldRules.axioms[0].title, 'Universal Innate Flight');
    assert.strictEqual(resB.updatedDossier.worldRules.axioms[0].axiom, 'Every humanoid has large, bright wings capable of sustained flight.');
    assert.ok(resB.updatedDossier.worldRules.axioms[0].architecturalNotes.includes('5th-floor balconies'));
    // Preserved substitutions from before
    assert.strictEqual(resB.updatedDossier.worldRules.axioms[0].substitutions.length, 1);

    // Step C: Clear rules
    const textC = `[UPDATE_DOSSIER]\n[CLEAR_WORLD_RULES]\n[/UPDATE_DOSSIER]`;
    let resC = applyDossierUpdates(textC, resB.updatedDossier);
    assert.strictEqual(resC.updatedDossier.worldRules.axioms.length, 0, 'Should clear all rules');

    console.log('✓ Successfully tested updates, removals, and CLEAR_WORLD_RULES');
}

// 4. Testing formatDossierForContext
console.log('Testing formatDossierForContext formatting...');
{
    const d = createEmptyDossier();
    d.meta.title = 'Winged Metropolis';
    d.worldRules.axioms.push({
        id: 'rule_flight',
        category: 'physiology',
        title: 'Universal Flight',
        axiom: 'All humanoids have wings.',
        substitutions: ['Elevators -> Flight shafts'],
        negativeConstraints: ['No wingless humanoids'],
        architecturalNotes: 'Rooftop perches standard',
    });
    d.worldRules.customModule = {
        tag: 'AERIAL',
        label: 'Wing Status',
        icon: '🪽',
        instruction: 'Track flight stamina and altitude.',
        sampleContent: 'Wings: Plumage Fresh | Stamina 5/5',
    };

    const ctx = formatDossierForContext(d);
    assert.ok(ctx.includes('[WORLD_RULES]'), 'Context should contain [WORLD_RULES]');
    assert.ok(ctx.includes('title: Universal Flight'), 'Context should contain title');
    assert.ok(ctx.includes('axiom: All humanoids have wings.'), 'Context should contain axiom');
    assert.ok(ctx.includes('- Elevators -> Flight shafts'), 'Context should contain substitutions');
    assert.ok(ctx.includes('[CUSTOM_MODULE]'), 'Context should contain [CUSTOM_MODULE]');
    assert.ok(ctx.includes('tag: AERIAL'), 'Context should contain tag');
    assert.ok(ctx.includes('label: Wing Status'), 'Context should contain label');
    console.log('✓ formatDossierForContext properly formats world rules and custom module');
}

// 5. Markdown Serialization and Deserialization Round-Trip
console.log('Testing Markdown serialization and deserialization roundtrip...');
{
    const original = createEmptyDossier();
    original.meta.title = 'Organic Frontier';
    original.meta.premise = 'A bio-punk world where technology is alive.';
    original.meta.systemKey = 'scifi';
    original.protagonist.name = 'Kaelen Vex';
    original.worldRules.axioms.push({
        id: 'rule_biotech',
        category: 'technology',
        title: 'Living Technology',
        axiom: 'Machinery is replaced with bonded biological symbiotes.',
        substitutions: ['Cars -> Runner beasts', 'Guns -> Spitting snakes'],
        negativeConstraints: ['BANNED: Gunpowder, metal firearms, internal combustion'],
        architecturalNotes: 'Feed pens replace garages',
    });
    original.worldRules.customModule = {
        tag: 'SYMBIOTES',
        label: 'Living Arsenal',
        icon: '🐍',
        instruction: 'Track bonded symbiotes and venom counts.',
        sampleContent: '- Spitting Viper: Fed 3/3\n- Chitin Plating: Molting in 3 days',
    };

    const md = serializeDossierToMarkdown(original);
    assert.ok(md.includes('## 🌐 World Rules & Physical Axioms:'), 'Markdown should have World Rules header');
    assert.ok(md.includes('### 🌐 Living Technology (technology)'), 'Markdown should have rule title');
    assert.ok(md.includes('## 📊 Custom Tracker Module:'), 'Markdown should have Custom Tracker Module header');
    assert.ok(md.includes('* **Tag:** [SYMBIOTES]'), 'Markdown should have module tag');

    const restored = parseMarkdownToDossier(md);
    assert.ok(restored, 'Restored dossier should not be null');
    assert.strictEqual(restored.meta.title, 'Organic Frontier');
    assert.strictEqual(restored.worldRules.axioms.length, 1, 'Restored should have 1 world rule');

    const rRule = restored.worldRules.axioms[0];
    assert.strictEqual(rRule.title, 'Living Technology');
    assert.strictEqual(rRule.category, 'technology');
    assert.strictEqual(rRule.axiom, 'Machinery is replaced with bonded biological symbiotes.');
    assert.strictEqual(rRule.substitutions.length, 2);
    assert.strictEqual(rRule.substitutions[0], 'Cars -> Runner beasts');
    assert.strictEqual(rRule.negativeConstraints.length, 1);
    assert.ok(rRule.negativeConstraints[0].includes('BANNED: Gunpowder'));
    assert.strictEqual(rRule.architecturalNotes, 'Feed pens replace garages');

    const rMod = restored.worldRules.customModule;
    assert.ok(rMod, 'Restored custom module should exist');
    assert.strictEqual(rMod.tag, 'SYMBIOTES');
    assert.strictEqual(rMod.label, 'Living Arsenal');
    assert.strictEqual(rMod.icon, '🐍');
    assert.strictEqual(rMod.instruction, 'Track bonded symbiotes and venom counts.');
    assert.ok(rMod.sampleContent.includes('Spitting Viper: Fed 3/3'));

    console.log('✓ Markdown serialization and deserialization round-trip cleanly preserves all world rules');
}

console.log('--- ALL CONCIERGE WORLD RULES PARSER TESTS PASSED CLEANLY! ---');
