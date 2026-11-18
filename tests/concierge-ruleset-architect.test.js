import test from 'node:test';
import assert from 'node:assert/strict';

import {
    inferFallbackGenreFromContext,
    buildRulesetArchitectPrompt,
    parseRulesetArchitectOutput,
    runRulesetArchitect,
} from '../concierge-ruleset-architect.js';
import {
    createEmptyDossier,
    applyDossierUpdates,
    healAndNormalizeDossier,
} from '../concierge-parser.js';
import {
    buildStage3AdventureBuilderPrompt,
    buildStage3AdventureTalkerPrompt,
    buildStage4CharacterBuilderPrompt,
} from '../concierge-prompt.js';
import {
    resolveEffectivePbtaGenre,
    buildPbtARoleContent,
    buildPbtAStockPrompts,
} from '../pbta-ruleset.js';

test('Ruleset Architect — inferFallbackGenreFromContext detects Fallout/Wasteland', () => {
    const falloutDossier = createEmptyDossier('pbta');
    falloutDossier.meta.title = 'The Broken Chip';
    falloutDossier.meta.premise = 'Vault 13 survivors explore the nuclear wasteland for a water chip.';
    assert.equal(inferFallbackGenreFromContext(falloutDossier, 'pbta'), 'post_apocalyptic');

    const faeFallout = createEmptyDossier('fae');
    faeFallout.meta.premise = 'Post-apocalyptic wasteland scavengers';
    assert.equal(inferFallbackGenreFromContext(faeFallout, 'fae'), 'post_apocalyptic');
});

test('Ruleset Architect — buildRulesetArchitectPrompt includes catalog, Canon, and tweakRequest', () => {
    const dossier = createEmptyDossier('pbta');
    dossier.meta.title = 'The Broken Chip';
    dossier.meta.premise = 'Vault 13 water chip expedition';
    const canon = [{ kind: 'LOCATION', name: 'Vault 13', content: 'An isolated underground shelter.', disabled: false }];

    const { system, user } = buildRulesetArchitectPrompt(dossier, canon, { tweakRequest: 'Add a Rad stat and Vault Dweller archetype' });
    assert.match(system, /post_apocalyptic/);
    assert.match(system, /Ruleset Architect/);
    assert.match(user, /Vault 13/);
    assert.match(user, /Add a Rad stat and Vault Dweller archetype/);
});

test('Ruleset Architect — parseRulesetArchitectOutput handles preset + custom archetypes and system: custom', () => {
    const presetReply = JSON.stringify({
        system: 'post_apocalyptic',
        system_label: 'Post-Apocalyptic / Fallout Wasteland',
        summary: 'Selected post_apocalyptic with Vault-Tec archetypes.',
        archetypes: ['Vault Dweller', 'Wasteland Medic', 'Brotherhood Scribe'],
        moves: ['Scavenge Ruins (+Scrap) — search pre-war wreckage for tech or supplies'],
    });
    const parsedPreset = parseRulesetArchitectOutput(presetReply, 'pbta', 'fantasy');
    assert.equal(parsedPreset.systemKey, 'post_apocalyptic');
    assert.equal(parsedPreset.systemLabel, 'Post-Apocalyptic / Fallout Wasteland');
    assert.deepEqual(parsedPreset.customGenreSpec.archetypes, ['Vault Dweller', 'Wasteland Medic', 'Brotherhood Scribe']);

    const customReply = '```json\n' + JSON.stringify({
        system: 'custom',
        system_label: 'Vault-Tec Survival',
        summary: 'Custom Fallout ruleset with Rad stat.',
        stats: ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart'],
        stat_descriptions: 'Grit (toughness), Tech (pre-war science), Nerve (cool under fire), Rad (mutation/exposure), Heart (empathy)',
        archetypes: ['Vault Security', 'Follower Medic', 'Caravan Guard'],
        moves: ['Tinker Pre-War Tech (+Tech) — repair or jury-rig ancient hardware'],
        max_harm_fate: 'Critical Radiation Collapse',
    }) + '\n```';
    const parsedCustom = parseRulesetArchitectOutput(customReply, 'pbta', 'fantasy');
    assert.equal(parsedCustom.systemKey, 'custom');
    assert.equal(parsedCustom.systemLabel, 'Vault-Tec Survival');
    assert.deepEqual(parsedCustom.customGenreSpec.stats, ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart']);
    assert.deepEqual(parsedCustom.customGenreSpec.archetypes, ['Vault Security', 'Follower Medic', 'Caravan Guard']);
    assert.equal(parsedCustom.customGenreSpec.maxHarmFate, 'Critical Radiation Collapse');
});

test('Ruleset Architect — runRulesetArchitect executes LLM pass and falls back gracefully on error', async () => {
    const dossier = createEmptyDossier('pbta');
    dossier.meta.premise = 'Vault 13 wasteland survival';

    const okRes = await runRulesetArchitect({
        dossier,
        canonEntries: [],
        send: async () => JSON.stringify({
            system: 'post_apocalyptic',
            system_label: 'Wasteland PbtA',
            summary: 'Matched wasteland survival.',
        }),
    });
    assert.equal(okRes.systemKey, 'post_apocalyptic');
    assert.equal(okRes.fallbackUsed, false);

    const errRes = await runRulesetArchitect({
        dossier,
        canonEntries: [],
        send: async () => { throw new Error('Network offline'); },
    });
    assert.equal(errRes.systemKey, 'post_apocalyptic');
    assert.equal(errRes.fallbackUsed, true);
});

test('Parser & Prompts — [RECALIBRATE_RULESET], customGenreSpec persistence, and Stage 3/4 prompt injection', () => {
    const dossier = createEmptyDossier('pbta');
    dossier.meta.systemKey = 'custom';
    dossier.meta.systemLabel = 'Vault-Tec Survival';
    dossier.meta.customGenreSpec = {
        label: 'Vault-Tec Survival',
        stats: ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart'],
        archetypes: ['Vault Dweller', 'Wasteland Medic'],
        moves: ['Tinker Pre-War Tech (+Tech) — repair pre-war hardware'],
    };

    const healed = healAndNormalizeDossier(JSON.parse(JSON.stringify(dossier)));
    assert.deepEqual(healed.meta.customGenreSpec.stats, ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart']);

    const { recalibrateRuleset, hasMutations } = applyDossierUpdates(
        '[UPDATE_DOSSIER]\nsummary: Requesting ruleset tweak\n[RECALIBRATE_RULESET: Add a Caravan Driver archetype]\n[/UPDATE_DOSSIER]',
        healed
    );
    assert.equal(hasMutations, true);
    assert.equal(recalibrateRuleset, 'Add a Caravan Driver archetype');

    const step3Builder = buildStage3AdventureBuilderPrompt(healed, []);
    const step3Talker = buildStage3AdventureTalkerPrompt(healed, []);
    const step4Builder = buildStage4CharacterBuilderPrompt(healed, []);
    assert.match(step3Builder, /RECALIBRATE_RULESET/);
    assert.match(step3Builder, /Vault-Tec Survival/);
    assert.match(step3Talker, /Grit, Tech, Nerve, Rad, Heart/);
    assert.match(step4Builder, /Vault Dweller, Wasteland Medic/);

    const resolvedGenre = resolveEffectivePbtaGenre('custom', { customGenreSpec: healed.meta.customGenreSpec });
    assert.equal(resolvedGenre.label, 'Vault-Tec Survival');
    assert.deepEqual(resolvedGenre.stats, ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart']);

    const roleContent = buildPbtARoleContent(false, 'custom', { customGenreSpec: healed.meta.customGenreSpec });
    assert.match(roleContent, /Vault-Tec Survival/);
    const stockPrompts = buildPbtAStockPrompts('custom', { customGenreSpec: healed.meta.customGenreSpec });
    assert.match(stockPrompts.character, /Grit \+2, Tech \+1, Nerve \+1, Rad \+0, Heart -1/);
});
