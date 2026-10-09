import assert from 'assert';
import {
    createEmptyDossier,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    clampRelationshipScore,
    inferStartingNpcRelationships,
} from '../concierge-parser.js';
import { prepareCampaignLorebookDistributions } from '../concierge-lore-distributor.js';

console.log('--- Running Concierge NPC Relationships Test Suite ---');

// 1. Defaults
console.log('Testing createEmptyDossier defaults...');
const empty = createEmptyDossier();
assert.strictEqual(empty.config.relationships, true, 'Default relationships dial should be enabled (true)');
console.log('✓ createEmptyDossier defaults relationships to true');

// 2. clampRelationshipScore
console.log('Testing clampRelationshipScore...');
assert.strictEqual(clampRelationshipScore(50), 50);
assert.strictEqual(clampRelationshipScore(-50), -50);
assert.strictEqual(clampRelationshipScore(200), 150);
assert.strictEqual(clampRelationshipScore(-200), -150);
assert.strictEqual(clampRelationshipScore('42'), 42);
assert.strictEqual(clampRelationshipScore('invalid'), 0);
assert.strictEqual(clampRelationshipScore(null), 0);
console.log('✓ clampRelationshipScore handles bounds and edge cases cleanly');

// 3. inferStartingNpcRelationships
console.log('Testing inferStartingNpcRelationships heuristic...');
const allyRel = inferStartingNpcRelationships({ role: 'Trusted Ally', demeanor: 'warm', relationship: 'Longtime friend' });
assert.strictEqual(allyRel.friendship, 25);
assert.strictEqual(allyRel.affection, 0);

const rivalRel = inferStartingNpcRelationships({ role: 'Bitter Rival', demeanor: 'hostile', relationship: 'Former mentor turned enemy' });
assert.strictEqual(rivalRel.friendship, -30);
assert.strictEqual(rivalRel.affection, 0);

const romanceRel = inferStartingNpcRelationships({ role: 'Lover', demeanor: 'tender', relationship: 'Secret romance' });
assert.strictEqual(romanceRel.friendship, 35);
assert.strictEqual(romanceRel.affection, 60);

const vendorRel = inferStartingNpcRelationships({ role: 'Shopkeeper', demeanor: 'neutral', relationship: 'Regular customer' });
assert.strictEqual(vendorRel.friendship, 0);
assert.strictEqual(vendorRel.affection, 0);
console.log('✓ inferStartingNpcRelationships accurately infers starting baselines');

// 4. applyDossierUpdates [CONFIG] and [NPC] parsing
console.log('Testing [CONFIG] and [NPC] block parsing...');
const dossier = createEmptyDossier();
dossier.meta.title = 'Neon Heartbeats';

const initialTurn = `
[CONFIG]
relationships: on
harm_max: 5
[/CONFIG]

[NPC]
name: Marta Okonkwo
role: Fierce Quartermaster
demeanor: Stoic, protective
appearance: Tall cyborg with scarred chassis
relationship: Owed a life debt
friendship: 45
affection: 10
moves: Patch Up; Supply Run
[/NPC]

[NPC]
name: Julian Cruz
role: Informant
demeanor: Nervous, calculating
appearance: Shabby trenchcoat, augmented eyes
relationship: Sells rumors for stims
[/NPC]
`;

const res1 = applyDossierUpdates(initialTurn, dossier);
assert.strictEqual(res1.hasMutations, true);
assert.strictEqual(res1.updatedDossier.config.relationships, true);
assert.strictEqual(res1.updatedDossier.npcs.length, 2);

const marta = res1.updatedDossier.npcs.find(n => n.name === 'Marta Okonkwo');
assert.ok(marta, 'Marta should be present');
assert.strictEqual(marta.friendship, 45, 'Marta friendship should be explicitly parsed as 45');
assert.strictEqual(marta.affection, 10, 'Marta affection should be explicitly parsed as 10');

const julian = res1.updatedDossier.npcs.find(n => n.name === 'Julian Cruz');
assert.ok(julian, 'Julian should be present');
assert.strictEqual(julian.friendship, 0, 'Julian friendship should be inferred as 0 for Informant');
assert.strictEqual(julian.affection, 0, 'Julian affection should be inferred as 0 for Informant');
console.log('✓ [NPC] blocks parsed with explicit and inferred relationship scores');

// Test turning relationships dial off
const toggleOffUpdate = `
[CONFIG]
relationships: off
[/CONFIG]
`;
const res2 = applyDossierUpdates(toggleOffUpdate, res1.updatedDossier);
assert.strictEqual(res2.updatedDossier.config.relationships, false);
assert.ok(res2.changes.some(c => c.includes('Relationships dial set to Off')));
console.log('✓ [CONFIG] relationships: off parsed successfully');

// 5. formatDossierForContext
console.log('Testing formatDossierForContext formatting...');
const contextStrOn = formatDossierForContext(res1.updatedDossier);
assert.ok(contextStrOn.includes('relationships=on'), 'Context string should include relationships=on');
assert.ok(contextStrOn.includes('friendship: 45'), 'Context string should include friendship: 45');
assert.ok(contextStrOn.includes('affection: 10'), 'Context string should include affection: 10');

const contextStrOff = formatDossierForContext(res2.updatedDossier);
assert.ok(contextStrOff.includes('relationships=off'), 'Context string should include relationships=off');
console.log('✓ formatDossierForContext properly formats relationship status and NPC scores');

// 6. Markdown Roundtrip
console.log('Testing Markdown serialization and deserialization roundtrip...');
const serialized = serializeDossierToMarkdown(res1.updatedDossier);
assert.ok(serialized.includes('* **Relationships:** Enabled'), 'Markdown should serialize Relationships: Enabled');
assert.ok(serialized.includes('**Standings:** Friendship +45 · Affection +10'), 'Markdown should serialize Standings line');

const parsedDossier = parseMarkdownToDossier(serialized);
assert.strictEqual(parsedDossier.config.relationships, true);
assert.strictEqual(parsedDossier.npcs.length, 2);
const parsedMarta = parsedDossier.npcs.find(n => n.name === 'Marta Okonkwo');
assert.strictEqual(parsedMarta.friendship, 45);
assert.strictEqual(parsedMarta.affection, 10);
console.log('✓ Markdown serialization and deserialization round-trip cleanly preserves standings and dial');

// 7. prepareCampaignLorebookDistributions preserves relationships
console.log('Testing prepareCampaignLorebookDistributions preservation...');
const dists = prepareCampaignLorebookDistributions(res1.updatedDossier);
assert.ok(Array.isArray(dists.npcs), 'NPC distribution array should exist');
assert.strictEqual(dists.npcs.length, 2);
const distMarta = dists.npcs.find(i => i.name === 'Marta Okonkwo');
assert.strictEqual(distMarta.friendship, 45);
assert.strictEqual(distMarta.affection, 10);
assert.strictEqual(distMarta.role, 'Fierce Quartermaster');
console.log('✓ prepareCampaignLorebookDistributions preserves role, friendship, and affection');

console.log('--- ALL NPC RELATIONSHIP TESTS PASSED CLEANLY! ---');
