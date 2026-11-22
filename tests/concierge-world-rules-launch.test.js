import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildPbtAWorldRulesContent,
    buildPbtACartridge,
    formatInitialPbtaMemo,
} from '../pbta-ruleset.js';
import { buildFaeCartridge } from '../fae-ruleset.js';
import {
    buildCompanionActiveCartridgeRecord,
    registerCustomGameSystemInSettings,
    syncSavedCartridgePayloadFromLiveSettings,
} from '../concierge-runner.js';
import { syncChatSetupCatalogs, snapshotChatSetup } from '../../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge World Rules Launch Pipeline Test Suite ---');

// ── 1. buildPbtAWorldRulesContent System Prompt Block ─────────────────────────
console.log('Testing buildPbtAWorldRulesContent...');

assert.strictEqual(buildPbtAWorldRulesContent(null), '');
assert.strictEqual(buildPbtAWorldRulesContent({}), '');
assert.strictEqual(buildPbtAWorldRulesContent({ axioms: [] }), '');

const sampleWorldRules = {
    axioms: [
        {
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
            architecturalNotes: 'Cities feature living hives, meat-pumps, and bone skybridges instead of steel girders.',
        },
    ],
    customModule: {
        fieldKey: 'symbiontSync',
        label: 'Symbiont Bio-Sync',
        instruction: 'Track protagonist harmony with their bio-graft (0-100%).',
        sample: 'Symbiont Bio-Sync: 85% [Neural Pulse: STABLE]',
    },
};

const syspromptBlock = buildPbtAWorldRulesContent(sampleWorldRules);
assert.ok(syspromptBlock.startsWith('<world_rules>'), 'Must start with <world_rules>');
assert.ok(syspromptBlock.endsWith('</world_rules>'), 'Must end with </world_rules>');
assert.ok(syspromptBlock.includes('# Axiom 1: Biological Technology (BIOLOGY_FOR_TECH)'));
assert.ok(syspromptBlock.includes('Setting Law: All mechanical machinery is replaced by domesticated biotechnology.'));
assert.ok(syspromptBlock.includes('Required Substitutions:'));
assert.ok(syspromptBlock.includes('• Cars -> Domesticated beetle carriages'));
assert.ok(syspromptBlock.includes('• Guns -> Spitting cobras'));
assert.ok(syspromptBlock.includes('ABSENCES & STRICT NEGATIVE CONSTRAINTS:'));
assert.ok(syspromptBlock.includes('• NEVER introduce: No internal combustion engines'));
assert.ok(syspromptBlock.includes('• NEVER introduce: No manufactured firearms'));
assert.ok(syspromptBlock.includes('Cities feature living hives, meat-pumps, and bone skybridges'));
assert.ok(syspromptBlock.includes('NEVER violate these axioms or revert to generic real-world/mechanical tropes.'));

console.log('✓ buildPbtAWorldRulesContent cleanly compiles setting laws into an enforceable XML block');

// ── 2. buildPbtACartridge System Prompt & BlockOrder Integration ──────────────
console.log('Testing buildPbtACartridge with worldRules overrides...');

const cartridgeWithRules = buildPbtACartridge('fantasy', {
    worldRules: sampleWorldRules,
});

const customRulesEntry = cartridgeWithRules.payload.customSyspromptLibrary.find(p => p.id === 'pbta_custom_world_rules');
assert.ok(customRulesEntry, 'Cartridge must include pbta_custom_world_rules in customSyspromptLibrary');
assert.strictEqual(customRulesEntry.tag, 'world_rules');
assert.strictEqual(customRulesEntry.enabled, true);
assert.ok(customRulesEntry.content.includes('<world_rules>'));
assert.strictEqual(cartridgeWithRules.payload.syspromptModules.world_rules, false);

// Check customModule added to blockOrder
assert.ok(cartridgeWithRules.payload.blockOrder.includes('SYMBIONTSYNC'), 'blockOrder must include custom module tag SYMBIONTSYNC');

// Ensure standard cartridge without worldRules does not bloat
const cartridgeWithoutRules = buildPbtACartridge('fantasy', {});
const noRulesEntry = cartridgeWithoutRules.payload.customSyspromptLibrary.find(p => p.id === 'pbta_custom_world_rules');
assert.strictEqual(noRulesEntry, undefined, 'Cartridge without worldRules must omit pbta_custom_world_rules');
assert.ok(!cartridgeWithoutRules.payload.blockOrder.includes('SYMBIONTSYNC'), 'Cartridge without customModule must omit SYMBIONTSYNC');

console.log('✓ buildPbtACartridge dynamically injects world rules prompt and registers custom module in blockOrder');

// ── 3. formatInitialPbtaMemo Seeding ──────────────────────────────────────────
console.log('Testing formatInitialPbtaMemo with customModule...');

const sampleDossier = {
    meta: { title: 'Bio-Chitin Chronicles', systemKey: 'fantasy' },
    protagonist: {
        name: 'Vance',
        playbook: 'Bio-Grafted Scout',
        stats: { Might: 1, Agility: 2, Wits: 1, Heart: 0, Arcana: -1 },
        startingMoves: ['Hive Sense (Notice bio-signals)'],
        gear: ['Spitting Cobra Sidearm (2 Harm, close)'],
    },
    worldRules: sampleWorldRules,
};

const initialMemo = formatInitialPbtaMemo(sampleDossier);
assert.ok(initialMemo.includes('[CHARACTER]'), 'Memo must have [CHARACTER]');
assert.ok(initialMemo.includes('[SYMBIONTSYNC]'), 'Memo must seed [SYMBIONTSYNC] block');
assert.ok(initialMemo.includes('Symbiont Bio-Sync: 85% [Neural Pulse: STABLE]'), 'Memo must contain sample content');
assert.ok(initialMemo.includes('[/SYMBIONTSYNC]'), 'Memo must close [/SYMBIONTSYNC]');

// Ensure dossier without custom module does not seed tag
const plainMemo = formatInitialPbtaMemo({
    meta: { title: 'Normal Game' },
    protagonist: { name: 'Kael', stats: { Might: 0 } },
});
assert.ok(!plainMemo.includes('[SYMBIONTSYNC]'), 'Plain memo must not have [SYMBIONTSYNC]');

console.log('✓ formatInitialPbtaMemo seeds the custom HUD tracker tag block for immediate Turn 0 display');

// ── 4. concierge-runner.js Pipeline Source Checks ─────────────────────────────
console.log('Testing concierge-runner.js launch pipeline hooks...');

const runnerPath = path.join(ROOT_DIR, 'concierge-runner.js');
const runnerCode = fs.readFileSync(runnerPath, 'utf8');

assert.ok(runnerCode.includes('worldRules: dossier.worldRules'), 'concierge-runner.js must forward worldRules to cartridgeOverrides');
assert.ok(runnerCode.includes('Living Architecture & Infrastructure:'), 'concierge-runner.js must enrich Map Architect prompt with archContext');
assert.ok(runnerCode.includes('dist.worldRules?.length'), 'concierge-runner.js must upsert dist.worldRules if present');
assert.ok(runnerCode.includes('rpgSettings.customFields'), 'concierge-runner.js must register customFields in MultiHog settings');
assert.ok(runnerCode.includes('rpgSettings.chatStates[chatId].customFields'), 'concierge-runner.js must mirror customFields to chatStates');

console.log('✓ concierge-runner.js contains all required Step 5 launch pipeline integrations');

// ── 5. HAND-006 / HAND-007 / HAND-008 Cartridge & v3 Catalog Handoff ────────
console.log('Testing HAND-006 CompanionActiveCartridge metadata preservation...');
const customSpec = { label: 'Mycelial Punk', stats: ['Spore', 'Sinew', 'Craft', 'Bond', 'Echo'] };
const activeRecord = buildCompanionActiveCartridgeRecord(
    { id: 'pbta', label: 'PbtA Engine' },
    'custom',
    {
        meta: { title: 'Fungal Spire', systemLabel: 'PbtA: Mycelial Punk', customGenreSpec: customSpec },
        config: { harmMax: 6, relationships: false, playstyle: 'cyoa_5' },
        protagonist: { name: 'Lichen', stats: { Spore: 2, Sinew: 1, Craft: 0, Bond: 1, Echo: -1 } },
    },
    {
        title: 'Fungal Spire',
        cartridgeOverrides: { knobs: { action_tempo: 'heroic' } },
    },
);
assert.strictEqual(activeRecord.cartridgeId, 'pbta');
assert.deepStrictEqual(activeRecord.customGenreSpec, customSpec, 'HAND-006: customGenreSpec must be preserved');
assert.deepStrictEqual(activeRecord.stats, ['Spore', 'Sinew', 'Craft', 'Bond', 'Echo'], 'HAND-006: stats must be preserved');
assert.deepStrictEqual(activeRecord.knobs, { action_tempo: 'heroic' }, 'HAND-006: knobs must be preserved');
assert.strictEqual(activeRecord.config.harmMax, 6, 'HAND-006: config must be preserved');
console.log('✓ HAND-006 CompanionActiveCartridge preservation verified');

console.log('Testing HAND-007 v3 Custom Game System & Catalog registration...');
const liveSettings = {
    chatSetupCatalogVersion: 3,
    blockOrder: ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'TIME'],
    gameSystems: [],
    customSyspromptLibrary: [],
    customFields: [],
    gameSystemDatabase: [],
    syspromptSnippetDatabase: [],
    trackerModuleDatabase: [],
    syspromptModules: { CYOA_mode: true },
    cyoaConfig: { useCustomPrompt: true, playstyle: 'cyoa_5' },
    npcRelationshipBars: false,
    chatStates: {},
};
const registeredOk = registerCustomGameSystemInSettings(
    liveSettings,
    {
        tag: 'SYMBIONT_SYNC',
        label: 'Symbiont Bio-Sync',
        gmTag: 'symbiont_sync',
        icon: '🧬',
        drivers: ['time', 'gm_annotation'],
        instruction: 'Track protagonist harmony with their bio-graft.',
        sampleContent: '[SYMBIONT_SYNC]\nBio-Sync: 85%\n[/SYMBIONT_SYNC]',
    },
    { chatId: 'fungal_spire', syncChatSetupCatalogs },
);
assert.strictEqual(registeredOk, true);
assert.strictEqual(liveSettings.gameSystems.length, 1);
assert.strictEqual(liveSettings.gameSystems[0].driverTime, true, 'HAND-007: driverTime boolean flag must be set');
assert.strictEqual(liveSettings.gameSystems[0].driverGmAnnotation, true, 'HAND-007: driverGmAnnotation boolean flag must be set');
assert.strictEqual(liveSettings.gameSystems[0].driverStatedFact, false, 'HAND-007: driverStatedFact boolean flag must be false');
assert.strictEqual(liveSettings.gameSystems[0].scope, 'chat', 'HAND-007: gameSystem scope must be chat');
assert.strictEqual(liveSettings.gameSystems[0]._chatSetupMember, true, 'HAND-007: gameSystem must be chat setup member');
assert.ok(
    liveSettings.customSyspromptLibrary[0].content.startsWith('<symbiont_sync>\n')
        && liveSettings.customSyspromptLibrary[0].content.endsWith('\n</symbiont_sync>'),
    'HAND-007: GM section snippet must be wrapped in <tag>...</tag>',
);
assert.strictEqual(liveSettings.customSyspromptLibrary[0].tag, 'symbiont_sync');
assert.strictEqual(liveSettings.gameSystemDatabase.length, 1, 'HAND-007: v3 gameSystemDatabase must be synced');
assert.strictEqual(liveSettings.syspromptSnippetDatabase.length, 1, 'HAND-007: v3 syspromptSnippetDatabase must be synced');
assert.strictEqual(liveSettings.trackerModuleDatabase.length, 1, 'HAND-007: v3 trackerModuleDatabase must be synced');
const snapshot = snapshotChatSetup(liveSettings);
assert.strictEqual(snapshot.gameSystemStates[liveSettings.gameSystems[0].id], true, 'HAND-007: upstream snapshotChatSetup must capture enabled Game System state');
assert.strictEqual(snapshot.customFieldStates.SYMBIONT_SYNC, true, 'HAND-007: upstream snapshotChatSetup must capture enabled Custom Field state');
console.log('✓ HAND-007 v3 Custom Game System & catalog registration verified');

console.log('Testing HAND-008 gameCartridges payload completeness & post-Step-5 refresh...');
const pbtaBaseCart = buildPbtACartridge('fantasy', { config: { relationships: false } });
assert.strictEqual(pbtaBaseCart.payload.npcRelationshipBars, false, 'HAND-008: PbtA cartridge payload must include npcRelationshipBars');
assert.deepStrictEqual(pbtaBaseCart.payload.gameSystems, [], 'HAND-008: PbtA cartridge payload must initialize gameSystems');
assert.deepStrictEqual(pbtaBaseCart.payload.customFields, [], 'HAND-008: PbtA cartridge payload must initialize customFields');

const faeBaseCart = buildFaeCartridge('cosmic_horror', { config: { relationships: true } });
assert.strictEqual(faeBaseCart.payload.npcRelationshipBars, true, 'HAND-008: FAE cartridge payload must include npcRelationshipBars');
assert.deepStrictEqual(faeBaseCart.payload.gameSystems, [], 'HAND-008: FAE cartridge payload must initialize gameSystems');
assert.deepStrictEqual(faeBaseCart.payload.customFields, [], 'HAND-008: FAE cartridge payload must initialize customFields');

pbtaBaseCart.id = 'pbta_fungal_spire';
liveSettings.gameCartridges = [pbtaBaseCart];
const refreshed = syncSavedCartridgePayloadFromLiveSettings(liveSettings, 'pbta_fungal_spire');
assert.strictEqual(refreshed, true, 'HAND-008: saved campaign cartridge must refresh from post-Step-5 live settings');
assert.strictEqual(liveSettings.gameCartridges[0].payload.gameSystems.length, 1, 'HAND-008: saved cartridge must carry Step 5 Game System');
assert.strictEqual(liveSettings.gameCartridges[0].payload.customFields.length, 1, 'HAND-008: saved cartridge must carry Step 5 Custom Field');
assert.ok(liveSettings.gameCartridges[0].payload.blockOrder.includes('SYMBIONT_SYNC'), 'HAND-008: saved cartridge blockOrder must include SYMBIONT_SYNC');
console.log('✓ HAND-008 gameCartridges payload completeness and post-Step-5 refresh verified');

console.log('--- ALL CONCIERGE WORLD RULES LAUNCH PIPELINE TESTS PASSED CLEANLY! ---');
