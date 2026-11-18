import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseGameSystemXml,
    serializeGameSystemToBlueprintBlock,
    normalizeGameSystemDrivers,
    extractGameSystemTemplate,
    mapWizardDraftToCustomModule,
    generateBlueprintGameSystemViaWizard,
} from '../game-system-bridge.js';
import {
    buildStage4CharacterBuilderPrompt,
} from '../concierge-prompt.js';
import {
    applyDossierUpdates,
    healAndNormalizeDossier,
    createEmptyDossier,
} from '../concierge-parser.js';
import {
    buildCustomModuleLoreEntry,
} from '../concierge-lore-distributor.js';

test('Game System Wizard Bridge — normalizeGameSystemDrivers', () => {
    assert.deepEqual(normalizeGameSystemDrivers('gm_deltas'), ['gm_deltas']);
    assert.deepEqual(normalizeGameSystemDrivers('GM_DELTAS, auto_tick'), ['gm_deltas', 'auto_tick']);
    assert.deepEqual(normalizeGameSystemDrivers(['clock', 'auto_tick']), ['clock', 'auto_tick']);
    assert.deepEqual(normalizeGameSystemDrivers('unknown_driver'), ['gm_annotation']);
    assert.deepEqual(normalizeGameSystemDrivers(''), ['gm_annotation']);
    assert.deepEqual(normalizeGameSystemDrivers(null), ['gm_annotation']);
});

test('Game System Wizard Bridge — extractGameSystemTemplate', () => {
    const rawWithCodeBlock = '```text\n[SYMBIOTES]\nSpitting Viper: Fed\n[/SYMBIOTES]\n```';
    assert.equal(
        extractGameSystemTemplate(rawWithCodeBlock, 'SYMBIOTES'),
        '[SYMBIOTES]\nSpitting Viper: Fed\n[/SYMBIOTES]'
    );

    const rawDirect = '[SYMBIOTES]\nChitin Carapace: Molting\n[/SYMBIOTES]';
    assert.equal(
        extractGameSystemTemplate(rawDirect, 'SYMBIOTES'),
        '[SYMBIOTES]\nChitin Carapace: Molting\n[/SYMBIOTES]'
    );
});

test('Game System Wizard Bridge — parseGameSystemXml handles native MultiHog wizard format', () => {
    const xml = `<game_system tag="RELIC_COMPASS" label="Relic Compass Gauge" icon="🧭" effect_owner="world" drivers="gm_deltas, auto_tick">
  <gm_instruction>
Track compass charge from 0 to 100%. Emit *(Compass: +10% charge)* when near artifacts.
  </gm_instruction>
  <tracker_template>
[RELIC_COMPASS]
Charge: [||||......] 40%
Attunement: North-by-Northeast
[/RELIC_COMPASS]
  </tracker_template>
  <sample_content>
[RELIC_COMPASS]
Charge: [||||......] 40%
Attunement: North-by-Northeast
[/RELIC_COMPASS]
  </sample_content>
</game_system>`;

    const parsed = parseGameSystemXml(xml);
    assert.equal(parsed.tag, 'RELIC_COMPASS');
    assert.equal(parsed.label, 'Relic Compass Gauge');
    assert.equal(parsed.icon, '🧭');
    assert.equal(parsed.effectOwner, 'world');
    assert.deepEqual(parsed.drivers, ['gm_deltas', 'auto_tick']);
    assert.match(parsed.gmInstruction, /Track compass charge from 0 to 100%/);
    assert.match(parsed.sampleContent, /Charge: \[\|\|\|\|\.\.\.\.\.\.\] 40%/);
});

test('Game System Wizard Bridge — serializeGameSystemToBlueprintBlock', () => {
    const customMod = {
        tag: 'SYMBIOTES',
        label: 'Living Arsenal & Mounts',
        icon: '🐍',
        drivers: ['gm_annotation'],
        instruction: 'Narrate symbiote behavior. Emit *(Symbiote fed: +1)* when fed.',
        sample: '[SYMBIOTES]\nSpitting Viper: Fed (3/3)\n[/SYMBIOTES]',
    };

    const serialized = serializeGameSystemToBlueprintBlock(customMod);
    assert.match(serialized, /\[CUSTOM_MODULE\]/);
    assert.match(serialized, /tag: SYMBIOTES/);
    assert.match(serialized, /label: Living Arsenal & Mounts/);
    assert.match(serialized, /icon: 🐍/);
    assert.match(serialized, /drivers: gm_annotation/);
    assert.match(serialized, /instruction: Narrate symbiote behavior/);
    assert.match(serialized, /sample:\n\[SYMBIOTES\]/);
    assert.match(serialized, /\[\/CUSTOM_MODULE\]/);
});

test('Concierge Parser — parse [CUSTOM_MODULE] with drivers and sample', () => {
    const dossier = createEmptyDossier();
    const updateText = `[UPDATE_DOSSIER]
[CUSTOM_MODULE]
tag: RELIC_COMPASS
label: Relic Compass Gauge
icon: 🧭
drivers: gm_deltas, auto_tick
instruction: Narrate compass resonance. Emit *(Compass: +10%)* near artifacts.
sample:
[RELIC_COMPASS]
Charge: 40%
[/RELIC_COMPASS]
[/CUSTOM_MODULE]
[/UPDATE_DOSSIER]`;

    const { updatedDossier, changes } = applyDossierUpdates(updateText, dossier);
    const mod = updatedDossier.worldRules?.customModule;
    assert.ok(mod, 'customModule should be populated in dossier');
    assert.equal(mod.tag, 'RELIC_COMPASS');
    assert.equal(mod.label, 'Relic Compass Gauge');
    assert.equal(mod.icon, '🧭');
    assert.deepEqual(mod.drivers, ['gm_deltas', 'auto_tick']);
    assert.match(mod.instruction, /Narrate compass resonance/);
    assert.match(mod.sample, /Charge: 40%/);
    assert.ok(changes.some(c => c.includes('RELIC_COMPASS')));
});

test('Concierge Parser — parse [GAME_SYSTEM] alias identically to [CUSTOM_MODULE]', () => {
    const dossier = createEmptyDossier();
    const updateText = `[UPDATE_DOSSIER]
[GAME_SYSTEM]
tag: SANITY
label: Sanity Meter
icon: 🧠
drivers: gm_annotation
instruction: Reduce sanity on eldritch encounters.
sample:
[SANITY]
Current: 8/10
[/SANITY]
[/GAME_SYSTEM]
[/UPDATE_DOSSIER]`;

    const { updatedDossier } = applyDossierUpdates(updateText, dossier);
    const mod = updatedDossier.worldRules?.customModule;
    assert.ok(mod, 'customModule should be populated from [GAME_SYSTEM]');
    assert.equal(mod.tag, 'SANITY');
    assert.equal(mod.label, 'Sanity Meter');
    assert.deepEqual(mod.drivers, ['gm_annotation']);
});

test('Concierge Parser — healAndNormalizeDossier preserves and normalizes customModule', () => {
    const rawDossier = {
        worldRules: {
            customModule: {
                tag: 'symbiotes',
                label: 'Symbiotes',
                drivers: 'gm_annotation',
                sampleContent: '[SYMBIOTES]\nViper: Fed\n[/SYMBIOTES]',
            },
        },
    };

    const healed = healAndNormalizeDossier(rawDossier);
    const mod = healed.worldRules?.customModule;
    assert.ok(mod);
    assert.equal(mod.tag, 'SYMBIOTES');
    assert.deepEqual(mod.drivers, ['gm_annotation']);
    assert.equal(mod.sample, '[SYMBIOTES]\nViper: Fed\n[/SYMBIOTES]');
});

test('Concierge Lore Distributor — buildCustomModuleLoreEntry generates rich CORE entry', () => {
    const customMod = {
        tag: 'RELIC_COMPASS_TRACKER',
        label: 'Relic Compass Tracker',
        drivers: 'gm_deltas',
        instruction: 'Advance compass reading by +10% when uncovering ancient tech.',
        sample: '[RELIC_COMPASS_TRACKER]\nCharge: 40%\nHeading: NNE\n[/RELIC_COMPASS_TRACKER]',
    };

    const entry = buildCustomModuleLoreEntry(customMod);
    assert.ok(entry);
    assert.equal(entry.name, 'HUD Tracker: Relic Compass Tracker');
    assert.match(entry.core, /Name: Relic Compass Tracker/);
    assert.match(entry.core, /Field: RELIC_COMPASS_TRACKER/);
    assert.match(entry.core, /Drivers: gm_deltas/);
    assert.match(entry.core, /Instruction: Advance compass reading/);
    assert.match(entry.core, /Format Sample:\s*\[RELIC_COMPASS_TRACKER\]/);
    assert.ok(entry.keys.includes('relic compass tracker'));
    assert.ok(entry.keys.includes('relic_compass_tracker'));
});

test('Game System Wizard Delegation — mapWizardDraftToCustomModule & generateBlueprintGameSystemViaWizard', async () => {
    const mapped = mapWizardDraftToCustomModule({
        name: 'Pip-Boy Rad Meter',
        icon: '☢️',
        needsTracker: true,
        driverTime: false,
        driverGmAnnotation: true,
        driverStatedFact: false,
        effectOwner: 'tracker',
        gmTag: 'rad_meter',
        gmContent: 'Emit *(Radiation: +25 Rads)* when entering irradiated zones.',
        trackerTag: 'RAD_METER',
        trackerLabel: 'Pip-Boy Rad Meter',
        trackerIcon: '☢️',
        trackerContent: '[RAD_METER]\nExposure: 0/1000 Rads (Clean)\n[/RAD_METER]',
    });

    assert.equal(mapped.tag, 'RAD_METER');
    assert.equal(mapped.label, 'Pip-Boy Rad Meter');
    assert.equal(mapped.icon, '☢️');
    assert.deepEqual(mapped.drivers, ['gm_annotation']);
    assert.match(mapped.instruction, /Radiation: \+25 Rads/);
    assert.match(mapped.sample, /\[RAD_METER\]/);

    const mockWizardModule = {
        getEffectiveWizardSystemPrompt: () => 'WIZARD_SYSTEM_PROMPT',
        parseWizardResponse: () => ({
            name: 'Suit Oxygen',
            icon: '🫧',
            needsTracker: true,
            driverTime: true,
            driverGmAnnotation: true,
            driverStatedFact: false,
            effectOwner: 'tracker',
            gmTag: 'suit_oxygen',
            gmContent: 'Narrate low-oxygen alarms.',
            trackerTag: 'SUIT_OXYGEN',
            trackerLabel: 'Suit Oxygen',
            trackerIcon: '🫧',
            trackerContent: '[SUIT_OXYGEN]\nO2: 100/100%\n[/SUIT_OXYGEN]',
        }),
    };

    let capturedSys = '';
    const res = await generateBlueprintGameSystemViaWizard({
        concept: 'Track suit oxygen depleting over time in toxic vaults',
        dossier: createEmptyDossier(),
        wizardModule: mockWizardModule,
        send: async (msgs) => {
            capturedSys = msgs[0].content;
            return '<meta name="Suit Oxygen" />';
        },
    });
    assert.equal(capturedSys, 'WIZARD_SYSTEM_PROMPT');
    assert.equal(res.usedWizardParser, true);
    assert.equal(res.customModule.tag, 'SUIT_OXYGEN');
    assert.equal(res.customModule.driverTime, true);
    assert.deepEqual(res.customModule.drivers, ['time', 'gm_annotation']);
});

test('Concierge Parser & Step 4 Prompt — [DESIGN_GAME_SYSTEM: ...] delegation', () => {
    const dossier = createEmptyDossier();
    const { designGameSystem, hasMutations } = applyDossierUpdates(
        '[UPDATE_DOSSIER]\nsummary: Delegate rad gauge\n[DESIGN_GAME_SYSTEM: Pip-Boy radiation meter tracking exposure]\n[/UPDATE_DOSSIER]',
        dossier
    );
    assert.equal(hasMutations, true);
    assert.equal(designGameSystem, 'Pip-Boy radiation meter tracking exposure');

    const step4Prompt = buildStage4CharacterBuilderPrompt(dossier, []);
    assert.match(step4Prompt, /\[DESIGN_GAME_SYSTEM:/);
    assert.ok(!step4Prompt.includes('### ⚙️ [CUSTOM_MODULE] Schema'), 'Step 4 Builder should use lean [DESIGN_GAME_SYSTEM] delegation');
});
