/**
 * tests/modular-lorebook-distribution.test.js
 *
 * Verification suite for Phase 1:
 * 1. Token optimization: Campaign Dossier in World Info must have `constant: false`
 * 2. Proper category distribution:
 *    - NPCs & Monsters -> {prefix}_NPCs
 *    - Factions -> {prefix}_Factions
 *    - Locations & Maps -> {prefix}_Locations
 *    - Starting Crisis -> {prefix}_Quests
 * 3. Clean [CORE] formatting and keyword extraction for MultiHog's Keyring attention model
 */

import assert from 'node:assert';
import {
    extractCleanKeywords,
    buildFactionEntry,
    buildLocationEntry,
    buildStartingQuestEntry,
    buildDossierWorldInfoEntry,
    prepareCampaignLorebookDistributions,
} from '../concierge-lore-distributor.js';

console.log('--- Running Modular Lorebook Distribution Test Suite ---');

// ── Test 1: Token Optimization (Dossier Artifact in World Info) ─────────────
console.log('Testing Token Optimization (Dossier Artifact)...');
const sampleMarkdown = '# Campaign Dossier: Vance: Cold Frost\n\nPremise: Paranormal investigator in the snow.';
const dossierEntry = buildDossierWorldInfoEntry(sampleMarkdown, 12345);

assert.strictEqual(dossierEntry.uid, 12345, 'UID should be preserved');
assert.strictEqual(dossierEntry.constant, false, 'CRITICAL: constant must be false to prevent burning prompt tokens');
assert.strictEqual(dossierEntry.disable, false, 'Entry should be enabled');
assert.ok(dossierEntry.key.includes('campaign dossier'), 'Keys should include campaign dossier');
assert.ok(dossierEntry.content.includes('Vance: Cold Frost'), 'Content should contain markdown');
console.log('✓ Dossier Artifact correctly generated with constant: false');

// ── Test 2: Clean Keyword Extraction ────────────────────────────────────────
console.log('Testing Clean Keyword Extraction...');
const keywords = extractCleanKeywords('The Order of the Silver Dawn');
assert.ok(keywords.includes('The Order of the Silver Dawn'), 'Full phrase should be preserved');
assert.ok(keywords.includes('Silver'), 'Subword Silver should be extracted');
assert.ok(keywords.includes('Dawn'), 'Subword Dawn should be extracted');
assert.ok(keywords.length <= 6, 'Keywords should be bounded to 6 max');
console.log('✓ Clean keyword extraction adheres to MultiHog cap');

// ── Test 3: Faction Formatting ──────────────────────────────────────────────
console.log('Testing Faction Formatting...');
const faction = {
    name: 'The Iron Syndicate',
    standing: 'Hostile',
    agenda: 'Control the underworld trade',
    notes: 'Led by Boss Thorne',
};
const factionEntry = buildFactionEntry(faction);
assert.strictEqual(factionEntry.name, 'The Iron Syndicate');
assert.ok(factionEntry.core.startsWith('[CORE]'), 'Should contain [CORE] opening tag');
assert.ok(factionEntry.core.endsWith('[/CORE]'), 'Should contain [/CORE] closing tag');
assert.ok(factionEntry.core.includes('Standing: Hostile'), 'Should include standing');
assert.ok(factionEntry.core.includes('Agenda: Control the underworld trade'), 'Should include agenda');
assert.ok(factionEntry.core.includes('Notes: Led by Boss Thorne'), 'Should include notes');
assert.ok(factionEntry.keys.includes('The Iron Syndicate'), 'Keys should include faction name');
console.log('✓ Factions cleanly formatted into [CORE] blocks');

// ── Test 4: Location Formatting ─────────────────────────────────────────────
console.log('Testing Location Formatting...');
const map = {
    site: 'Blackwood Pines Ranger Station',
    kind: 'SETTLEMENT',
    threat: 'MODERATE',
    entrance: 'Front Porch',
    briefDescription: 'A snowbound ranger outpost.',
};
const locEntry = buildLocationEntry(map);
assert.strictEqual(locEntry.name, 'Blackwood Pines Ranger Station');
assert.ok(locEntry.core.includes('[CORE]'), 'Should contain [CORE]');
assert.ok(locEntry.core.includes('Kind: SETTLEMENT'), 'Should specify Kind');
assert.ok(locEntry.core.includes('Threat: MODERATE'), 'Should specify Threat');
assert.ok(locEntry.core.includes('Entrance: Front Porch'), 'Should specify Entrance');
assert.ok(locEntry.core.includes('A snowbound ranger outpost.'), 'Should include description');
assert.ok(locEntry.keys.includes('Blackwood Pines Ranger Station'), 'Keys should include site name');
console.log('✓ Locations cleanly formatted for {prefix}_Locations');

// ── Test 5: Starting Quest Formatting ───────────────────────────────────────
console.log('Testing Starting Quest Formatting...');
const theKick = {
    crisis: 'A missing ranger patrol and strange tracks leading into the gorge.',
};
const meta = { title: 'Cold Frost' };
const questEntry = buildStartingQuestEntry(theKick, meta);
assert.ok(questEntry, 'Should generate quest entry');
assert.strictEqual(questEntry.name, 'Starting Crisis: Cold Frost');
assert.ok(questEntry.core.includes('ID: starting_crisis'));
assert.ok(questEntry.core.includes('TYPE: emergent'));
assert.ok(questEntry.core.includes('STATUS: ACTIVE'));
assert.ok(questEntry.core.includes('PREMISE: A missing ranger patrol'));
console.log('✓ Starting Crisis cleanly formatted as emergent quest for {prefix}_Quests');

// ── Test 6: Full Distribution Across Modular Books ─────────────────────────
console.log('Testing Full Distribution Across Modular Books...');
const fullDossier = {
    meta: { title: 'Vance: Cold Frost' },
    theKick: {
        startingLocation: 'Ranger Station',
        crisis: 'Blizzard traps the team as creatures attack.',
    },
    factions: [
        { name: 'Rangers Guild', standing: 'Friendly', agenda: 'Protect the pass' },
        { name: 'Frost Cult', standing: 'Hostile', agenda: 'Summon the blizzard' },
    ],
    npcs: [
        { name: 'Marta Okonkwo', role: 'Lighthouse Keeper', appearance: 'Weathered face', demeanor: 'Gruff' },
    ],
    monsters: [
        { name: 'Ash Wendigo', harm: 4, attacks: 'Frost Claws (2 Harm)' },
    ],
    maps: [
        { site: 'Ranger Station', kind: 'SETTLEMENT', threat: 'MODERATE' },
        { site: 'Sunken Crypt', kind: 'DUNGEON', threat: 'HIGH' },
    ],
};

const dist = prepareCampaignLorebookDistributions(fullDossier);

// Check NPCs & Monsters
assert.strictEqual(dist.npcs.length, 2, 'Should contain 1 NPC and 1 Monster');
assert.strictEqual(dist.npcs[0].name, 'Marta Okonkwo');
assert.strictEqual(dist.npcs[1].name, 'Ash Wendigo');

// Check Factions
assert.strictEqual(dist.factions.length, 2, 'Should contain 2 factions');
assert.strictEqual(dist.factions[0].name, 'Rangers Guild');
assert.strictEqual(dist.factions[1].name, 'Frost Cult');

// Check Locations
assert.strictEqual(dist.locations.length, 2, 'Should contain 2 unique locations');
assert.strictEqual(dist.locations[0].name, 'Ranger Station');
assert.strictEqual(dist.locations[1].name, 'Sunken Crypt');

// Check Quests
assert.strictEqual(dist.quests.length, 1, 'Should contain 1 starting emergent quest');
assert.strictEqual(dist.quests[0].name, 'Starting Crisis: Vance: Cold Frost');

console.log('✓ Full campaign distribution properly segments all 4 categories without cross-contamination');
console.log('--- ALL MODULAR LOREBOOK DISTRIBUTION TESTS PASSED CLEANLY! ---');
