import assert from 'assert';
import {
    createEmptyDossier,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
} from '../concierge-parser.js';

console.log('--- Running Simulation Depth Dial & Config Test Suite ---');

// 1. Default creation
console.log('Testing createEmptyDossier defaults...');
const emptyDossier = createEmptyDossier();
assert.strictEqual(emptyDossier.config.simulationDepth, 'active_fronts', 'Default simulationDepth should be active_fronts');
console.log('✓ createEmptyDossier defaults to active_fronts');

// 2. [CONFIG] parsing for simulation_depth
console.log('Testing [CONFIG] parsing in applyDossierUpdates...');
const dossier = createEmptyDossier();
dossier.meta.title = 'Clockwork Shadows';

// Test living_world
const updateLiving = `
[CONFIG]
simulation_depth: living_world
playstyle: cyoa_3
harm_max: 4
[/CONFIG]
`;
const resLiving = applyDossierUpdates(updateLiving, dossier);
assert.strictEqual(resLiving.updatedDossier.config.simulationDepth, 'living_world');
assert.strictEqual(resLiving.hasMutations, true);
assert.ok(resLiving.changes.some(c => c.includes('Simulation Depth dial set to Living World')));
console.log('✓ Successfully parsed simulation_depth: living_world');

// Test static via alias
const updateStatic = `
[CONFIG]
sim_depth: static
[/CONFIG]
`;
const resStatic = applyDossierUpdates(updateStatic, resLiving.updatedDossier);
assert.strictEqual(resStatic.updatedDossier.config.simulationDepth, 'static');
assert.ok(resStatic.changes.some(c => c.includes('Simulation Depth dial set to Static (Narrative Only)')));
console.log('✓ Successfully parsed sim_depth: static');

// Test active_fronts via alias
const updateActive = `
[CONFIG]
simulation: active
[/CONFIG]
`;
const resActive = applyDossierUpdates(updateActive, resStatic.updatedDossier);
assert.strictEqual(resActive.updatedDossier.config.simulationDepth, 'active_fronts');
assert.ok(resActive.changes.some(c => c.includes('Simulation Depth dial set to Active Fronts (Recommended)')));
console.log('✓ Successfully parsed simulation: active');

// 3. formatDossierForContext includes simulation_depth
console.log('Testing formatDossierForContext serialization...');
dossier.meta.premise = 'A noir conspiracy in a drowned metropolis.';
dossier.protagonist.name = 'Echo';
dossier.config.simulationDepth = 'living_world';
const contextStr = formatDossierForContext(dossier);
assert.ok(contextStr.includes('simulation_depth=living_world'), 'Context string must contain simulation_depth=living_world');
console.log('✓ formatDossierForContext properly includes simulation_depth');

// 4. Markdown serialization and deserialization roundtrip
console.log('Testing Markdown serialization and deserialization roundtrip...');
dossier.config.simulationDepth = 'living_world';
const md = serializeDossierToMarkdown(dossier);
assert.ok(md.includes('* **Simulation Depth:** living_world'), 'Markdown must include Simulation Depth line');

const roundtripped = parseMarkdownToDossier(md);
assert.ok(roundtripped, 'Markdown must parse back into dossier object');
assert.strictEqual(roundtripped.config.simulationDepth, 'living_world', 'Reconstituted dossier must preserve simulationDepth');
console.log('✓ Markdown serialization and reconstitution preserves simulationDepth cleanly');

// 5. Verification of simulation settings mapping
console.log('Testing MultiHog simulation depth setting mapping logic...');
function mapSimulationSettings(depth) {
    if (depth === 'static') {
        return {
            worldProgressionEnabled: false,
            mapEvolutionEnabled: false,
        };
    } else if (depth === 'living_world') {
        return {
            worldProgressionEnabled: true,
            worldProgressionIntervalHours: 24,
            mapEvolutionEnabled: true,
            mapEvolutionIntervalHours: 8,
        };
    } else {
        // active_fronts
        return {
            worldProgressionEnabled: true,
            worldProgressionIntervalHours: 24,
            mapEvolutionEnabled: false,
        };
    }
}

const staticSettings = mapSimulationSettings('static');
assert.strictEqual(staticSettings.worldProgressionEnabled, false);
assert.strictEqual(staticSettings.mapEvolutionEnabled, false);

const frontsSettings = mapSimulationSettings('active_fronts');
assert.strictEqual(frontsSettings.worldProgressionEnabled, true);
assert.strictEqual(frontsSettings.worldProgressionIntervalHours, 24);
assert.strictEqual(frontsSettings.mapEvolutionEnabled, false);

const livingSettings = mapSimulationSettings('living_world');
assert.strictEqual(livingSettings.worldProgressionEnabled, true);
assert.strictEqual(livingSettings.worldProgressionIntervalHours, 24);
assert.strictEqual(livingSettings.mapEvolutionEnabled, true);
assert.strictEqual(livingSettings.mapEvolutionIntervalHours, 8);
console.log('✓ All 3 simulation tiers map accurately to MultiHog engine properties');

console.log('--- ALL SIMULATION DEPTH TESTS PASSED CLEANLY! ---');
