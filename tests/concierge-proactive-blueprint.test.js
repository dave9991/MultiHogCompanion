import assert from 'node:assert';
import { createEmptyDossier, applyDossierUpdates, stripConciergeStateBlocks } from '../concierge-parser.js';
import { buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running Concierge Proactive Blueprint & Context Hygiene Test Suite ---');

// 1. Verify system prompt instructions for proactive scaffolding and concise chat prose
console.log('Testing System Prompt Proactive Directives...');
const prompt = buildConciergeSystemPrompt();

assert.ok(
    prompt.includes('Session Zero Flow (Proactive Blueprint Scaffolding)'),
    'Prompt missing proactive blueprint scaffolding header',
);
assert.ok(
    prompt.includes('Scaffold First, Refine Fast'),
    'Prompt missing "Scaffold First, Refine Fast" instruction',
);
assert.ok(
    prompt.includes('Do NOT regurgitate full stat sheets, moves, harm numbers, or card lists into chat prose'),
    'Prompt missing instruction prohibiting card recitation in chat',
);
assert.ok(
    prompt.includes('The player already sees the Live Blueprint Deck visually on their screen'),
    'Prompt missing instruction reminding model of live visual deck',
);
console.log('✓ System prompt proactive scaffolding and concise chat directives verified');

// 2. Test multi-entity proactive draft parsing on Turn 1
console.log('Testing Multi-Entity Proactive Draft Parsing...');
const initialDossier = createEmptyDossier();

const proactiveTurn1Response = `Here is a strong draft for your noir occult mystery:

[UPDATE_DOSSIER]
title: Silas & The Cold Echo
system: horror
tone: gritty occult noir with slow-burning dread
premise: A disgraced detective investigates supernatural disappearances in an abandoned logging hamlet.

[CONFIG]
playstyle: cyoa_5
harm_max: 4
party_mode: solo
simulation_depth: living_world
cyoa_emojis: true
art_style: gritty watercolor graphic novel
[/CONFIG]

[PROTAGONIST]
name: Silas Vance
playbook: The Sleuth
stats: Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1
harm: 4
armor: 1
moves:
- Eye for Blood (+Sharp) (When examining violence, deduce the perpetrator's nature)
- Steely Gaze (+Cool) (Never flinch under psychological terror)
gear: .38 Snub Revolver (2-Harm, close), Trenchcoat (1-Armor), Silver pocketwatch
bio: Former homicide detective haunted by cases the department buried.
[/PROTAGONIST]

[FACTION]
name: The Iron Ring Syndicate
agenda: Smuggle eldritch artifacts through the timber company
standing: Hostile
notes: Fronted by the corrupt local foreman
[/FACTION]

[NPC]
name: Marta Sterling
role: Roadhouse Proprietor & Contact
demeanor: Guarded, chain-smoker, observant
appearance: Weathered woman in wool knit cardigan
relationship: Friend of Silas's late partner
moves_or_boons: Safe Booth (A secure room to sleep and lay low)
notes: Knows who arrived on the late freight trains
[/NPC]

[MONSTER]
name: The Hollow Stalker
harm: 4
armor: 1
attacks: Bone Spike (2-Harm, close), Glacial Wail (1-Harm, area)
weakness: Open flames, salted iron
countdown:
- Dusk: Timber workers find stripped marrow bones
- Midnight: Power lines snap along the logging road
- Witching Hour: The Stalker breaches the roadhouse cellar
notes: Ancient entity that mimics the voices of freezing travelers.
[/MONSTER]

[MAP]
site: Blackpine Timber Depot
kind: SETTLEMENT
threat: DANGEROUS
entrance: Snowed-in Rail Siding
prompt: Decrepit wooden lumberyard surrounded by dense black pines under heavy snow.
brief_description: Abandoned timber depot serving as the only shelter for miles.
[/MAP]

[KICK]
starting_location: Blackpine Timber Depot
crisis: Silas's car breaks down just outside the depot as heavy snow starts burying the tracks.
opening_prompt: The radiator hisses and dies as twilight turns the pine forest to silhouettes...
[/KICK]
[/UPDATE_DOSSIER]

I've sketched this into your Live Blueprint Deck on the right!`;

const report1 = applyDossierUpdates(proactiveTurn1Response, initialDossier);

assert.strictEqual(report1.success, true, 'Parsing should succeed');
assert.strictEqual(report1.hasMutations, true, 'Report must flag mutations');
assert.strictEqual(report1.errors.length, 0, `Expected 0 errors, got: ${report1.errors.join('; ')}`);

const d1 = report1.updatedDossier;
assert.strictEqual(d1.meta.title, 'Silas & The Cold Echo');
assert.strictEqual(d1.meta.systemKey, 'horror');
assert.strictEqual(d1.config.harmMax, 4);
assert.strictEqual(d1.config.partyMode, 'solo');
assert.strictEqual(d1.config.simulationDepth, 'living_world');
assert.strictEqual(d1.protagonist.name, 'Silas Vance');
assert.strictEqual(d1.protagonist.playbook, 'The Sleuth');
assert.strictEqual(d1.protagonist.stats.Cool, 2);
assert.strictEqual(d1.protagonist.stats.Weird, -1);
assert.strictEqual(d1.protagonist.startingMoves.length, 2);
assert.strictEqual(d1.factions.length, 1);
assert.strictEqual(d1.factions[0].name, 'The Iron Ring Syndicate');
assert.strictEqual(d1.npcs.length, 1);
assert.strictEqual(d1.npcs[0].name, 'Marta Sterling');
assert.strictEqual(d1.monsters.length, 1);
assert.strictEqual(d1.monsters[0].name, 'The Hollow Stalker');
assert.strictEqual(d1.monsters[0].impendingDoom.length, 3);
assert.strictEqual(d1.maps.length, 1);
assert.strictEqual(d1.maps[0].site, 'Blackpine Timber Depot');
assert.strictEqual(d1.theKick.startingLocation, 'Blackpine Timber Depot');
console.log('✓ Multi-entity proactive blueprint parsed and populated completely on Turn 1');

// 3. Test subsequent delta mutation preserving proactively scaffolded entities
console.log('Testing Follow-up Delta Update Preservation...');
const turn2Delta = `[UPDATE_DOSSIER]
[MONSTER]
name: The Hollow Stalker
weakness: Concentrated ultraviolet light and silver nitrate
[/MONSTER]
[/UPDATE_DOSSIER]`;

const report2 = applyDossierUpdates(turn2Delta, d1);
assert.strictEqual(report2.success, true);
const d2 = report2.updatedDossier;

// Verify updated monster
assert.strictEqual(d2.monsters[0].weakness, 'Concentrated ultraviolet light and silver nitrate');
assert.strictEqual(d2.monsters[0].name, 'The Hollow Stalker');
assert.strictEqual(d2.monsters[0].impendingDoom.length, 3, 'Impending doom countdown preserved');

// Verify other entities were preserved intact
assert.strictEqual(d2.protagonist.name, 'Silas Vance');
assert.strictEqual(d2.factions.length, 1);
assert.strictEqual(d2.npcs.length, 1);
assert.strictEqual(d2.maps.length, 1);
assert.strictEqual(d2.theKick.startingLocation, 'Blackpine Timber Depot');
console.log('✓ Delta follow-up update modified targeted field while preserving all scaffolded cards');

// 4. Test Context Hygiene: Strip state blocks from assistant chat messages
console.log('Testing Context Hygiene & Directive Stripping...');
const rawAssistantOutput = `I have drafted the campaign for you!

[UPDATE_DOSSIER]
title: Cold Echo
[/UPDATE_DOSSIER]

Take a look at the blueprint deck on the right and let me know if you want to change anything!`;

const cleanSpokenText = stripConciergeStateBlocks(rawAssistantOutput);
assert.ok(!cleanSpokenText.includes('[UPDATE_DOSSIER]'), 'Clean text must not contain [UPDATE_DOSSIER]');
assert.ok(!cleanSpokenText.includes('title: Cold Echo'), 'Clean text must not contain raw directive body');
assert.ok(cleanSpokenText.includes('I have drafted the campaign for you!'), 'Spoken greeting retained');
assert.ok(cleanSpokenText.includes('Take a look at the blueprint deck'), 'Spoken instructions retained');
console.log('✓ stripConciergeStateBlocks cleanly prunes directive blocks from assistant chat');

console.log('--- ALL CONCIERGE PROACTIVE BLUEPRINT TESTS PASSED CLEANLY! ---');
