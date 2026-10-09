import assert from 'node:assert';
import {
    extractWorldRuleKeywords,
    buildWorldRuleEntry,
    buildCustomModuleLoreEntry,
    prepareCampaignLorebookDistributions,
    buildWorldSkeletonMarkdown,
    buildWorldSkeletonEntries,
} from '../concierge-lore-distributor.js';

console.log('--- Running Concierge World Rules Lore & Skeleton Distribution Test Suite ---');

// ── 1. Bi-directional Keyword Extraction ──────────────────────────────────────
console.log('Testing extractWorldRuleKeywords...');

const sampleAxiom = {
    title: 'Biological Technology',
    category: 'biology_for_tech',
    axiom: 'All mechanical machinery is replaced by domesticated biotechnology.',
    substitutions: [
        'Cars -> Domesticated beetle carriages',
        'Guns -> Spitting cobras',
    ],
    negativeConstraints: [
        'No internal combustion engines',
        'No manufactured firearms',
    ],
    architecturalNotes: 'Living hive buildings and bone skybridges.',
};

const keys = extractWorldRuleKeywords(sampleAxiom);
assert.ok(keys.includes('Biological Technology'), 'Should include full title');
assert.ok(keys.includes('biological') || keys.includes('technology'), 'Should include title tokens');
assert.ok(keys.includes('biology for tech'), 'Should include category phrase');

// Both sides of substitutions
assert.ok(keys.some(k => /car/i.test(k)), 'Should extract replaced concept: car/cars');
assert.ok(keys.some(k => /beetle/i.test(k)), 'Should extract biological replacement: beetle');
assert.ok(keys.some(k => /gun/i.test(k)), 'Should extract replaced concept: gun/guns');
assert.ok(keys.some(k => /cobra/i.test(k)), 'Should extract biological replacement: cobra');

// Banned negative constraints
assert.ok(keys.some(k => /combustion|engine/i.test(k)), 'Should extract banned concept from negative constraints');
assert.ok(keys.some(k => /firearm/i.test(k)), 'Should extract banned firearms');

// Standard anchors
assert.ok(keys.includes('world rule') || keys.includes('world law'), 'Should include world rule anchor');
assert.ok(keys.length <= 12, `Keyword list should be bounded, found ${keys.length}`);

// Test alternative "for" syntax ("animals for cars")
const altAxiom = {
    title: 'Avian Transmutation',
    category: 'physics',
    substitutions: ['Gliders for cars'],
    negativeConstraints: ['Without wheels'],
};
const altKeys = extractWorldRuleKeywords(altAxiom);
assert.ok(altKeys.some(k => /glider/i.test(k)), 'Should extract gliders');
assert.ok(altKeys.some(k => /car/i.test(k)), 'Should extract cars');
assert.ok(altKeys.some(k => /wheel/i.test(k)), 'Should extract wheels');

console.log('✓ extractWorldRuleKeywords accurately extracts bi-directional trigger keys and banned concepts');

// ── 2. World Rule [CORE] Lorebook Entry Formatting ────────────────────────────
console.log('Testing buildWorldRuleEntry...');

const ruleEntry = buildWorldRuleEntry(sampleAxiom);
assert.ok(ruleEntry, 'Entry should be generated');
assert.strictEqual(ruleEntry.name, 'World Axiom: Biological Technology');
assert.strictEqual(ruleEntry.comment, 'World Axiom: Biological Technology');
assert.ok(ruleEntry.core.startsWith('[CORE]'), 'Should open with [CORE]');
assert.ok(ruleEntry.core.endsWith('[/CORE]'), 'Should close with [/CORE]');
assert.ok(ruleEntry.core.includes('Type: World Axiom (BIOLOGY_FOR_TECH)'));
assert.ok(ruleEntry.core.includes('Axiom: All mechanical machinery is replaced by domesticated biotechnology.'));
assert.ok(ruleEntry.core.includes('- Cars -> Domesticated beetle carriages'));
assert.ok(ruleEntry.core.includes('- Guns -> Spitting cobras'));
assert.ok(ruleEntry.core.includes('- No internal combustion engines'));
assert.ok(ruleEntry.core.includes('Infrastructure & Architecture: Living hive buildings and bone skybridges.'));
assert.ok(ruleEntry.keys.length > 0, 'Entry should have trigger keys');

// Edge cases
assert.strictEqual(buildWorldRuleEntry(null), null);
assert.strictEqual(buildWorldRuleEntry({}), null);

console.log('✓ buildWorldRuleEntry formats clean, token-efficient [CORE] blocks');

// ── 3. Custom HUD Tracker Lorebook Entry Formatting ───────────────────────────
console.log('Testing buildCustomModuleLoreEntry...');

const customModule = {
    fieldKey: 'symbiontSync',
    label: 'Symbiont Bio-Sync',
    instruction: 'Track protagonist harmony with their bio-graft (0-100%).',
    sample: 'Symbiont Bio-Sync: 85% [Neural Pulse: STABLE]',
};

const modEntry = buildCustomModuleLoreEntry(customModule);
assert.ok(modEntry, 'Module entry should be generated');
assert.strictEqual(modEntry.name, 'HUD Tracker: Symbiont Bio-Sync');
assert.ok(modEntry.core.includes('[CORE]'));
assert.ok(modEntry.core.includes('Type: Custom HUD Tracker / Game System'));
assert.ok(modEntry.core.includes('Field: symbiontSync'));
assert.ok(modEntry.core.includes('Instruction: Track protagonist harmony with their bio-graft (0-100%).'));
assert.ok(modEntry.core.includes('Format Sample: Symbiont Bio-Sync: 85% [Neural Pulse: STABLE]'));
assert.ok(modEntry.keys.includes('symbiontsync'));

assert.strictEqual(buildCustomModuleLoreEntry(null), null);
assert.strictEqual(buildCustomModuleLoreEntry({}), null);

console.log('✓ buildCustomModuleLoreEntry formats HUD tracker system lore entry');

// ── 4. prepareCampaignLorebookDistributions Packaging ────────────────────────
console.log('Testing prepareCampaignLorebookDistributions...');

const testDossier = {
    meta: { title: 'Bio-Chitin Chronicles' },
    theKick: { startingLocation: 'Spore Central Station', crisis: 'The Great Queen bug is ailing.' },
    npcs: [{ name: 'Vance', role: 'Carriage Driver' }],
    monsters: [{ name: 'Chitin Scuttler', harm: 3 }],
    factions: [{ name: 'Larva Guild', standing: 'Allied' }],
    maps: [{ site: 'Spore Central Station', kind: 'SETTLEMENT' }],
    worldRules: {
        axioms: [sampleAxiom],
        customModule,
    },
};

const dist = prepareCampaignLorebookDistributions(testDossier);
assert.strictEqual(dist.npcs.length, 2, 'Should contain 1 NPC and 1 Monster');
assert.strictEqual(dist.factions.length, 1, 'Should contain 1 Faction');
assert.strictEqual(dist.locations.length, 1, 'Should contain 1 Location');
assert.strictEqual(dist.quests.length, 1, 'Should contain 1 Starting Quest');

// Check worldRules distribution
assert.strictEqual(dist.worldRules.length, 2, 'Should contain 1 Axiom entry and 1 Custom Tracker entry');
assert.strictEqual(dist.worldRules[0].name, 'World Axiom: Biological Technology');
assert.strictEqual(dist.worldRules[1].name, 'HUD Tracker: Symbiont Bio-Sync');

// Backward compatibility check with dossier without worldRules
const plainDossier = {
    meta: { title: 'Standard Fantasy' },
    theKick: { startingLocation: 'Crossroads Inn' },
};
const plainDist = prepareCampaignLorebookDistributions(plainDossier);
assert.deepStrictEqual(plainDist.worldRules, [], 'Plain dossier should produce empty worldRules array');

console.log('✓ prepareCampaignLorebookDistributions packages worldRules cleanly without breaking existing categories');

// ── 5. World Skeleton Markdown & Day 0 Baseline Integration ──────────────────
console.log('Testing World Skeleton enrichment...');

const skeletonMd = buildWorldSkeletonMarkdown(testDossier);
assert.ok(skeletonMd.includes('## FACTIONS'), 'Must preserve ## FACTIONS header');
assert.ok(skeletonMd.includes('## LOCATIONS'), 'Must preserve ## LOCATIONS header');
assert.ok(skeletonMd.includes('## CONFLICTS'), 'Must preserve ## CONFLICTS header');
assert.ok(skeletonMd.includes('Architecture: Living hive buildings and bone skybridges.'), 'Location description must reflect architectural notes');

const skeletonEntries = buildWorldSkeletonEntries(testDossier);
const locEntry = skeletonEntries.find(e => e.comment.includes('Spore Central Station'));
assert.ok(locEntry, 'Should find Spore Central Station LOC entry');
assert.strictEqual(locEntry.extensions.rpgCategory, 'LOC');
assert.strictEqual(locEntry.extensions.rpgSkeleton, true);
assert.ok(locEntry.content.includes('Architecture: Living hive buildings and bone skybridges.'), 'Day 0 Baseline content must inherit architectural notes');

console.log('✓ World Skeleton reflects living architecture while strictly honoring MultiHog contract');

console.log('--- ALL CONCIERGE WORLD RULES LORE & SKELETON TESTS PASSED CLEANLY! ---');
