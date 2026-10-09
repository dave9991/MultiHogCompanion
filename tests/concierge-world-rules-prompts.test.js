/**
 * concierge-world-rules-prompts.test.js — MultiHog Companion
 *
 * Tests for Step 2: World Rules Session Zero Prompts (Builder & Talker).
 */

import assert from 'assert';
import {
    buildConciergeSystemPrompt,
    buildConciergeBuilderPrompt,
    buildConciergeTalkerPrompt,
    buildConciergeBuilderContext,
    buildConciergeTalkerContext,
} from '../concierge-prompt.js';
import {
    createEmptyDossier,
    applyDossierUpdates,
} from '../concierge-parser.js';

console.log('--- Running Concierge World Rules Prompts Test Suite ---');

// 1. Contract verification for buildConciergeSystemPrompt
console.log('Testing buildConciergeSystemPrompt contract...');
{
    const prompt = buildConciergeSystemPrompt();
    assert.ok(prompt.includes('[WORLD_RULES]'), 'System prompt should include [WORLD_RULES] directive');
    assert.ok(prompt.includes('[CUSTOM_MODULE]'), 'System prompt should include [CUSTOM_MODULE] directive');
    assert.ok(prompt.includes('title: Biomechanical Substitution'), 'System prompt should include sample title');
    assert.ok(prompt.includes('substitutions:'), 'System prompt should include substitutions header');
    assert.ok(prompt.includes('negative_constraints:'), 'System prompt should include negative constraints header');
    assert.ok(prompt.includes('tag: SYMBIOTES'), 'System prompt should include sample module tag');
    assert.ok(prompt.includes('World Rules & Custom Trackers'), 'System prompt should include World Rules flow guideline');
    console.log('✓ buildConciergeSystemPrompt contract verified');
}

// 2. Contract verification for buildConciergeBuilderPrompt
console.log('Testing buildConciergeBuilderPrompt contract...');
{
    const prompt = buildConciergeBuilderPrompt();
    assert.ok(prompt.includes('[WORLD_RULES]'), 'Builder prompt should include [WORLD_RULES] directive');
    assert.ok(prompt.includes('[CUSTOM_MODULE]'), 'Builder prompt should include [CUSTOM_MODULE] directive');
    assert.ok(prompt.includes('architectural_notes:'), 'Builder prompt should include architectural_notes');
    assert.ok(prompt.includes('instruction: Track bonded symbiotes'), 'Builder prompt should include module instruction example');
    assert.ok(prompt.includes('proactively include [WORLD_RULES]'), 'Builder prompt should mandate proactive world rules scaffolding');
    assert.ok(prompt.includes('remove_world_rule: Title'), 'Builder prompt should document remove_world_rule');
    assert.ok(prompt.includes('remove_custom_module: true'), 'Builder prompt should document remove_custom_module');
    console.log('✓ buildConciergeBuilderPrompt contract verified');
}

// 3. Contract verification for buildConciergeTalkerPrompt
console.log('Testing buildConciergeTalkerPrompt contract...');
{
    const prompt = buildConciergeTalkerPrompt();
    assert.ok(prompt.includes('Worldbuilding & Consequence Probing'), 'Talker prompt should include consequence probing guideline');
    assert.ok(prompt.includes('rooftop perches instead of street doors'), 'Talker prompt should give architectural probing example');
    assert.ok(prompt.includes('World Laws and Custom Tracker cards'), 'Talker prompt should direct attention to world rules in deck');
    console.log('✓ buildConciergeTalkerPrompt contract verified');
}

// 4. Testing context payload builders
console.log('Testing buildConciergeBuilderContext and buildConciergeTalkerContext...');
{
    const d = createEmptyDossier();
    d.meta.title = 'Bioluminescent Depths';
    d.worldRules.axioms.push({
        id: 'rule_deep_bioluminescence',
        category: 'ecology',
        title: 'Bioluminescent Ecology',
        axiom: 'In this sunless abyssal trench, all lighting and power comes from symbiotic radiant flora.',
        substitutions: ['Flashlights -> Lantern jellyfish', 'Streetlights -> Radiant spore trees'],
        negativeConstraints: ['BANNED: Electricity, fossil fuels'],
        architecturalNotes: 'Cities built into hollowed hydrothermal vents',
    });
    d.worldRules.customModule = {
        tag: 'BIOLUM',
        label: 'Light Reserves & Spores',
        icon: '🪼',
        instruction: 'Track carried radiant organisms and charge duration.',
        sampleContent: 'Lantern Jelly: Vibrant (4h left)\nSpore Flask: 2 charges',
    };

    const builderCtx = buildConciergeBuilderContext(d, ['Added world rule']);
    assert.ok(builderCtx.includes('[WORLD_RULES]'), 'Builder context should contain [WORLD_RULES]');
    assert.ok(builderCtx.includes('Bioluminescent Ecology'), 'Builder context should contain rule title');
    assert.ok(builderCtx.includes('[CUSTOM_MODULE]'), 'Builder context should contain [CUSTOM_MODULE]');
    assert.ok(builderCtx.includes('tag: BIOLUM'), 'Builder context should contain module tag');

    const talkerCtx = buildConciergeTalkerContext(d, ['Added world rule']);
    assert.ok(talkerCtx.includes('[CURRENT_LIVE_BLUEPRINT]'), 'Talker context should contain live blueprint');
    assert.ok(talkerCtx.includes('Bioluminescent Ecology'), 'Talker context should contain rule title');
    assert.ok(talkerCtx.includes('tag: BIOLUM'), 'Talker context should contain module tag');
    console.log('✓ Context payload builders properly format world rules and custom module');
}

// 5. Simulated Builder response conforming to prompt parses cleanly
console.log('Testing simulated Builder response parsing fidelity...');
{
    const d = createEmptyDossier();
    const simulatedBuilderResponse = `
[UPDATE_DOSSIER]
summary: Scaffold winged modern metropolis campaign

title: Skyward Metro
system: anime
tone: high-flying urban action with soaring aerial dogfights
premise: In a modern metropolis where every citizen possesses majestic wings, a skyway courier uncovers an illegal ground-tethering cartel.

[CONFIG]
playstyle: cyoa_5
party_mode: duo
art_style: vibrant modern anime with dynamic flight cinematography
simulation_depth: living_world
[/CONFIG]

[WORLD_RULES]
title: Universal Innate Flight
category: physiology
axiom: Every human possesses large, powerful functional wings from birth.
substitutions:
- Ground Highways -> Multi-tier altitude flight corridors
- Elevators and Stairs -> Vertical open-air atriums and exterior glide perches
negative_constraints:
- BANNED: Wingless humans, enclosed ground-only skyscrapers, combustion planes
architectural_notes: Buildings enter via rooftop balconies and 10th-story roosts; ground floors are storage
[/WORLD_RULES]

[CUSTOM_MODULE]
tag: WINGS
label: Flight & Feather Condition
icon: 🪽
instruction: Track wing stamina (0-5), plumage damage, and current altitude corridor.
sample:
- Wing Stamina: 5/5 (Fresh)
- Plumage: Groomed (Peregrine Falcon primary feathers)
- Altitude: Tier 2 (Mid-Skyline Corridor)
[/CUSTOM_MODULE]

[PROTAGONIST]
name: Caelum Zephyr
playbook: The Aerial Ace
stats: Danger +2, Superior +1, Savior +1, Mundane 0, Freak -1
moves:
- Thermal Stoop (+Danger) (When you dive from high altitude to strike an opponent or snatch an object)
- Slipstream Reflexes (+Superior) (When you weave through tight architecture or cross-winds under pressure)
harm: 5
armor: 1
gear: Glider goggles, pressurized delivery satchel, feather-preening oil
bio: A reckless courier who knows the city's downdrafts better than the sky patrol.
[/PROTAGONIST]

[FACTION]
name: Metro Sky Patrol
agenda: Regulate high-altitude corridors and clamp down on unsanctioned rooftop roosts
standing: Suspicious
notes: Equipped with net-harpoons and heavy downdraft fans
[/FACTION]

[NPC]
name: Sora Vance
role: Companion (Party)
species: Human (Kestrel Winged)
appearance: Slim athletic courier with reddish-brown plumage and goggles pushed up on her forehead
equipment: Courier harness, whistle, flight compass
demeanor: Cautious but fiercely loyal
relationship: Caelum's wingman and dispatch coordinator
friendship: 60
affection: 15
moves_or_boons: Radar Wing (Sora spots thermal drafts and patrol ambushes before they strike)
[/NPC]

[MONSTER]
name: Ground-Tether Enforcer
harm: 4
armor: 2
attacks: Pneumatic Net Cannon (2 Harm, snaring wings), Weighted Bolas (1 Harm, grounding)
weakness: Vulnerable to high-altitude stall dives
countdown:
- Omen: Unmarked tether harpoons discovered on delivery roofs
- Escalation: A courier is forcibly grounded and captured mid-flight
- Crisis: The Skyway Syndicate locks down the mid-corridor with aerial net-traps
notes: Heavily armored anti-flight mercenaries
[/MONSTER]

[MAP]
site: Stratum 40 Landing Hub
kind: SETTLEMENT
threat: SAFE
entrance: Open-air South Flight Deck
prompt: A bustling cantilevered terminal on the 40th floor of the Sky-Tower, crowded with winged commuters and cafe perches.
brief_description: Central dispatch hub for skyway couriers and aerial commuters.
[/MAP]

[KICK]
starting_location: Stratum 40 Landing Hub
crisis: As Caelum checks in at the dispatch roost, an EMP net explodes across the open atrium, threatening to send grounded couriers into a free-fall!
opening_prompt: The crisp morning wind whistles through your primary feathers as you flare your wings to land at the Stratum 40 dock...
[/KICK]
[/UPDATE_DOSSIER]
`;

    const result = applyDossierUpdates(simulatedBuilderResponse, d);
    assert.ok(result.success, 'Parser should succeed');
    assert.strictEqual(result.updatedDossier.meta.title, 'Skyward Metro');
    assert.strictEqual(result.updatedDossier.worldRules.axioms.length, 1);

    const r = result.updatedDossier.worldRules.axioms[0];
    assert.strictEqual(r.title, 'Universal Innate Flight');
    assert.strictEqual(r.category, 'physiology');
    assert.strictEqual(r.substitutions.length, 2);
    assert.strictEqual(r.negativeConstraints.length, 1);
    assert.ok(r.architecturalNotes.includes('rooftop balconies'));

    const cm = result.updatedDossier.worldRules.customModule;
    assert.ok(cm, 'Custom module should exist');
    assert.strictEqual(cm.tag, 'WINGS');
    assert.strictEqual(cm.icon, '🪽');
    assert.ok(cm.sampleContent.includes('Wing Stamina: 5/5'));

    console.log('✓ Simulated Builder response parsed with 100% fidelity');
}

console.log('--- ALL CONCIERGE WORLD RULES PROMPT TESTS PASSED CLEANLY! ---');
