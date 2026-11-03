/**
 * tests/fae-concierge-cyoa.test.js — MultiHog Companion
 *
 * Comprehensive test suite verifying Freeform Attrition Engine (FAE)
 * support across the Session Zero Concierge and CYOA Choice Engine:
 * 1. FAE Empty Dossier initialization & untouched detection
 * 2. Parsing FAE [UPDATE_DOSSIER] blocks (pools, knobs, tags, trait qualification, encounter barriers)
 * 3. Dossier formatting and serialization to Markdown roundtrip
 * 4. FAE Concierge system prompts and builder prompts
 * 5. CYOA Choice Engine prompt generation & Downed / Zero-state detection for FAE
 * 6. Concierge Runner launch alias and FAE integration
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
    createEmptyDossier,
    isDossierEmptyOrUntouched,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    healAndNormalizeDossier,
} from '../concierge-parser.js';

import {
    buildConciergeSystemPrompt,
    buildFaeConciergeSystemPrompt,
    buildConciergeBuilderPrompt,
    buildFaeConciergeBuilderPrompt,
    buildConciergeBuilderContext,
} from '../concierge-prompt.js';

import {
    isProtagonistDowned,
    buildCyoaPrompt,
    extractChoicesMarkup,
} from '../cyoa-generator.js';

import {
    executeConciergeCampaignLaunch,
    launchPbtaCampaign,
} from '../concierge-runner.js';

import {
    FAE_GENRES,
    buildFaeQuickStartInstructions,
    buildFaeFooterContent,
    buildFaeCyoaPrompt,
} from '../fae-ruleset.js';
import { buildPbtAQuickStartInstructions } from '../pbta-ruleset.js';
import { formatInitialFaeMemo } from '../fae-state-sync.js';

test('FAE Session Zero Concierge: Dossier Initialization & Untouched Detection', () => {
    const dossier = createEmptyDossier('fae', 'osr_dungeon');

    assert.equal(dossier.meta.ruleset, 'fae');
    assert.equal(dossier.meta.systemKey, 'osr_dungeon');
    assert.equal(dossier.meta.systemLabel, FAE_GENRES.osr_dungeon.label);
    assert.equal(dossier.meta.title, 'Untitled FAE Campaign');

    // Pools initialized matching OSR Dungeon genre
    assert.ok(dossier.pools.health, 'Should have health pool');
    assert.ok(dossier.pools.resolve, 'Should have resolve pool');
    assert.ok(dossier.pools.torch_and_supplies, 'Should have torch_and_supplies pool');
    assert.equal(dossier.pools.health.max, 10);
    assert.equal(dossier.pools.torch_and_supplies.current, 6);

    // Knobs initialized matching OSR Dungeon genre
    assert.equal(dossier.knobs.flee_grace_toggle, false);
    assert.equal(dossier.knobs.base_attrition_shift, 0);
    assert.equal(dossier.knobs.overflow_default, 'lethal');

    // Untouched check
    assert.equal(isDossierEmptyOrUntouched(dossier), true);

    // After modifying title, is no longer untouched
    dossier.meta.title = 'The Sunken Vault';
    assert.equal(isDossierEmptyOrUntouched(dossier), false);
});

test('FAE Session Zero Concierge: Parsing [UPDATE_DOSSIER] with FAE fields & Trait Qualification', () => {
    let dossier = createEmptyDossier('fae', 'cosmic_horror');

    const updateText = `
[UPDATE_DOSSIER]
[META]
title: Shadows Over Arkham
ruleset: fae
system: cosmic_horror
premise: A series of unexplainable disappearances near the Miskatonic docks.
tone: Grim, investigative cosmic dread.
[/META]
[PROTAGONIST]
name: Inspector Thomas Malone
archetype: The Relentless Detective
positive_tags: Revolver .38 (Heavy snubnose), Street-Smart (Underworld informants), Strong [for lifting heavy crates], Calm [under gunfire and shock], Occult Library (Tome access)
negative_tags: Trembling Hands (Nerve Scar)
bio: A veteran investigator burdened by forbidden sights.
[/PROTAGONIST]
[CONFIG]
flee_grace_toggle: false
base_attrition_shift: 1
overflow_default: lethal
simulation_depth: living_world
[/CONFIG]
[MONSTER]
name: Deep One Hybrid
threat_level: 3
layers: 2
pools_at_risk: Health, Sanity
pressures: Crushing Claw Sweep (Health), Chilling Guttural Croak (Sanity)
leverage_barriers: [1. Barnacle-Encrusted Hide] [2. Shadow Camouflage]
full_finish_triggers: Submerge electrical line in the harbor basin, OR flare torch in gills
weakness: Bright magnesium fire
[/MONSTER]
[/UPDATE_DOSSIER]
`;

    const res = applyDossierUpdates(updateText, dossier);
    dossier = res.updatedDossier;

    assert.equal(dossier.meta.ruleset, 'fae');
    assert.equal(dossier.meta.title, 'Shadows Over Arkham');
    assert.equal(dossier.meta.systemKey, 'cosmic_horror');

    // Protagonist & Trait preservation
    assert.equal(dossier.protagonist.name, 'Inspector Thomas Malone');
    assert.equal(dossier.protagonist.archetype, 'The Relentless Detective');
    
    // Positive tags should preserve all valid and qualified tags up to 5
    const tags = dossier.protagonist.positiveTags;
    assert.equal(tags.length, 5);
    assert.ok(tags.some(t => t.includes('Revolver .38')));
    assert.ok(tags.some(t => t.includes('Street-Smart')));
    assert.ok(tags.some(t => t.includes('Strong [for lifting heavy crates]')));
    assert.ok(tags.some(t => t.includes('Calm [under gunfire and shock]')));
    assert.ok(tags.some(t => t.includes('Occult Library')));

    // Negative tags
    assert.ok(dossier.protagonist.negativeTags.some(t => t.includes('Trembling Hands')));

    // Knobs in config
    assert.equal(dossier.config.knobs.flee_grace_toggle, false);
    assert.equal(dossier.config.knobs.base_attrition_shift, 1);
    assert.equal(dossier.config.knobs.overflow_default, 'lethal');
    assert.equal(dossier.config.simulationDepth, 'living_world');

    // Monster encounter fields
    assert.equal(dossier.monsters.length, 1);
    const m = dossier.monsters[0];
    assert.equal(m.name, 'Deep One Hybrid');
    assert.equal(m.threatLevel, 3);
    assert.equal(m.layers, 2);
    assert.ok(m.poolsAtRisk.includes('Health'));
    assert.ok(m.pressures.some(p => p.includes('Crushing Claw Sweep')));
    assert.equal(m.leverageBarriers.length, 2);
    assert.ok(m.fullFinishTriggers.includes('Submerge electrical line'));
});

test('FAE Session Zero Concierge: Serialization to Markdown and Context Formatting', () => {
    let dossier = createEmptyDossier('fae', 'cyberpunk_noir');
    dossier.meta.title = 'Neon Shadows';
    dossier.meta.premise = 'A missing executive in the rain-slicked mega-spire.';
    dossier.protagonist.name = 'Kage';
    dossier.protagonist.archetype = 'The Netrunner';
    dossier.protagonist.positiveTags = [
        'Custom Cyberdeck (Direct neural tap)',
        'Monofilament Wire (Silent garrote and cutter)',
    ];
    dossier.protagonist.negativeTags = ['Burned Trace (Heat Scar)'];
    dossier.monsters = [{
        name: 'Arasaka Strike Drone',
        threatLevel: 2,
        layers: 1,
        poolsAtRisk: ['Body', 'Heat & Trace'],
        pressures: ['Gatling Sweep (Body)', 'Telemetry Uplink (Heat & Trace)'],
        leverageBarriers: ['Kinetic Shielding'],
        fullFinishTriggers: ['EMP grenade into vent port'],
    }];

    const md = serializeDossierToMarkdown(dossier);
    assert.ok(md.includes('# 📜 CAMPAIGN DOSSIER: Neon Shadows'));
    assert.ok(md.includes('Freeform Attrition Engine'));
    assert.ok(md.includes('## 👤 Protagonist: Kage'));
    assert.ok(md.includes('### 🏷️ Positive Tags (Signature Gear & Traits):'));
    assert.ok(md.includes('Custom Cyberdeck (Direct neural tap)'));
    assert.ok(md.includes('### 🩹 Scars & Debuffs:'));
    assert.ok(md.includes('Burned Trace (Heat Scar)'));
    assert.ok(md.includes('**Threat Level 2** | **Leverage Layers:**'));
    assert.ok(md.includes('**Leverage Barriers:** Kinetic Shielding'));
    assert.ok(md.includes('**Full-Finish Triggers:** EMP grenade into vent port'));

    // Context format
    const ctx = formatDossierForContext(dossier);
    assert.ok(ctx.includes('[CURRENT_CAMPAIGN_DOSSIER]'));
    assert.ok(ctx.includes('[FAE]'));
    assert.ok(ctx.includes('name: Arasaka Strike Drone'));
    assert.ok(ctx.includes('threat_level: 2'));
    assert.ok(ctx.includes('layers: 1'));

    // Normalization should preserve FAE ruleset
    const healed = healAndNormalizeDossier(dossier);
    assert.equal(healed.meta.ruleset, 'fae');
    assert.equal(healed.protagonist.name, 'Kage');
    assert.ok(healed.pools.body, 'Body pool preserved');
});

test('FAE Concierge System Prompts & Builder Prompt Routing', () => {
    // 1. buildFaeConciergeSystemPrompt
    const faePrompt = buildFaeConciergeSystemPrompt({ genreKey: 'cosmic_horror' });
    assert.ok(faePrompt.includes('Freeform Attrition Engine (FAE)'));
    assert.ok(faePrompt.includes('Single-Pass 4dF Resolution'));
    assert.ok(faePrompt.includes('Two-Tier Pool Narration'));
    assert.ok(faePrompt.includes('Strict Prohibition of D&D and 2d6 PbtA Mechanics'));
    assert.ok(faePrompt.includes('NEVER output PbtA 2d6 moves'));
    assert.ok(faePrompt.includes('The Trait Qualification Protocol (Cooperative Qualification)'));
    assert.ok(faePrompt.includes('Tier A (Auto-Qualify Broad Traits)'));
    assert.ok(faePrompt.includes('Tier B (Remove True Omnipotence with Clear Reason)'));
    assert.ok(faePrompt.includes('Strong [for lifting, hauling, or breaching doors]'));
    assert.ok(faePrompt.includes('Zero-Bookkeeping Model'));
    assert.ok(faePrompt.includes('Companion: Name (Role)'));
    assert.ok(faePrompt.includes('Companions as Combined Leverage'));
    assert.ok(faePrompt.includes('osr_dungeon'));
    assert.ok(faePrompt.includes('cyberpunk_noir'));

    // 2. buildConciergeSystemPrompt routing
    const routedFae = buildConciergeSystemPrompt({ ruleset: 'fae' });
    assert.ok(routedFae.includes('Freeform Attrition Engine (FAE)'));

    const routedPbta = buildConciergeSystemPrompt({ ruleset: 'pbta' });
    assert.ok(routedPbta.includes('Powered by the Apocalypse'));

    // 3. buildFaeConciergeBuilderPrompt
    const builderPrompt = buildFaeConciergeBuilderPrompt();
    assert.ok(builderPrompt.includes('[UPDATE_DOSSIER]'));
    assert.ok(builderPrompt.includes('ruleset: fae'));
    assert.ok(builderPrompt.includes('positive_tags:'));
    assert.ok(builderPrompt.includes('flee_grace_toggle:'));
    assert.ok(builderPrompt.includes('threat_level:'));
    assert.ok(builderPrompt.includes('leverage_barriers:'));

    // 4. buildConciergeBuilderPrompt routing
    const routedBuilderFae = buildConciergeBuilderPrompt({ ruleset: 'fae' });
    assert.ok(routedBuilderFae.includes('ruleset: fae'));

    // 5. buildConciergeBuilderContext with FAE dossier
    const dossier = createEmptyDossier('fae', 'cosmic_horror');
    const ctx = buildConciergeBuilderContext(dossier, ['Initialized FAE session']);
    assert.ok(ctx.includes('FAE Blueprint Builder'));
    assert.ok(ctx.includes('ruleset: fae'));
    assert.ok(ctx.includes('positive_tags:'));
});

test('CYOA Choice Engine: FAE Downed & Zero-State Detection', () => {
    // Healthy FAE memo
    const healthyMemo = `[TIME]
Day 1, 09:00 AM
[/TIME]

[LOCATION]
The Old Lighthouse
[/LOCATION]

[CHARACTER]
Thomas Malone (Investigator): 8/8 HP | Pool: Health (8/8) | Scenes: 0/4 | XP: 0/4
((BAR:purple)) Sanity: 6/6 (Zero Debuff: Paranoia | Recovery: scene_breather)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    assert.equal(isProtagonistDowned(healthyMemo, false, true), false);

    // Downed / Zero HP memo
    const downedMemoZeroHp = `[CHARACTER]
Thomas Malone (Investigator): 0/8 HP | Pool: Health (0/8) | Scenes: 1/4 | XP: 1/4
((BAR:purple)) Sanity: 4/6 (Zero Debuff: Paranoia | Recovery: scene_breather)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    assert.equal(isProtagonistDowned(downedMemoZeroHp, false, true), true);

    // Breaking Point status
    const breakingPointMemo = `[CHARACTER]
Thomas Malone (Investigator): 3/8 HP | Pool: Health (3/8)
Status: Incapacitated (BREAKING POINT)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    assert.equal(isProtagonistDowned(breakingPointMemo, false, true), true);

    // Overflow marker
    const overflowMemo = `[CHARACTER]
Thomas Malone (Investigator): 0/8 HP | OVERFLOW TO SANITY
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    assert.equal(isProtagonistDowned(overflowMemo, false, true), true);
});

test('CYOA Choice Engine: FAE Prompt Construction & Negative Constraints', () => {
    const memo = `[CHARACTER]
Kage (The Netrunner): 6/8 HP | Pool: Body (6/8)
((BAR:blue)) Nerve: 4/6
Positive Tags: [Subdermal Cyberdeck] [Silenced Pistol]
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    const narrative = 'The corporate enforcer steps into the elevator shaft, shotgun leveled at your chest.';

    // Normal active FAE choice prompt
    const { systemPrompt, userPrompt } = buildCyoaPrompt({
        narrative,
        memo,
        isPbta: false,
        isFae: true,
        rpgSettings: { faeGenre: 'cyberpunk_noir', cyoaConfig: { playstyle: 'cyoa_5', cyoaEmojis: true } },
    });

    assert.ok(systemPrompt.includes('Freeform Attrition Engine'));
    assert.ok(systemPrompt.includes('Cyberpunk / Syndicate Noir'));
    assert.ok(systemPrompt.includes('STYLE B BRACKET RULES:'));
    assert.ok(systemPrompt.includes('NO MECHANICAL SCOPE JARGON: NEVER output "Stepping-Stone:"'));
    assert.ok(systemPrompt.includes('TAG MATCHING:'));
    assert.ok(systemPrompt.includes('NEVER output D&D target DCs'));
    assert.ok(systemPrompt.includes('NEVER output PbtA 2d6 move names'));
    assert.ok(userPrompt.includes(narrative));

    // Downed / Zero-state FAE choice prompt
    const downedMemo = `[CHARACTER]
Kage (The Netrunner): 0/8 HP | Pool: Body (0/8)
Status: Incapacitated
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
[/CHARACTER]`;

    const downedPrompt = buildCyoaPrompt({
        narrative: 'You collapse onto the metal grate as the enforcer racks the slide.',
        memo: downedMemo,
        isPbta: false,
        isFae: true,
        rpgSettings: { faeGenre: 'cyberpunk_noir' },
    });

    assert.ok(downedPrompt.systemPrompt.includes('BREAKING POINT / ZERO-STATE'));
    assert.ok(downedPrompt.systemPrompt.includes('Tags are DISABLED at 0 HP'));
    assert.ok(downedPrompt.systemPrompt.includes('FLEE GRACE ESCAPE / DESPERATE RETREAT'));
    assert.ok(downedPrompt.systemPrompt.includes('PIVOT TO SECONDARY POOL'));
});

test('CYOA Choice Engine: Markup Extraction Resilience', () => {
    const rawFaeOutput = `Here are the choices:
<choices>
<button>1. 🔫 Line up the silenced pistol on the enforcer's hydraulic knee — [Body | +Silenced Pistol]</button>
<button>2. 💻 Deploy an optic glitch packet to blind their cyberware — [Nerve | +Subdermal Cyberdeck]</button>
<button>3. 🏃 Dive through the emergency escape chute into the service vents — [Body]</button>
<button>4. 🎙️ "You don't want to do this, chomba. Arasaka already scrubbed your team's pension."</button>
<button>5. 🛡️ Drop prone behind the server rack and cut the power breakers</button>
</choices>`;

    const parsed = extractChoicesMarkup(rawFaeOutput);
    assert.ok(parsed.startsWith('<choices>'));
    assert.ok(parsed.includes('<button>1. 🔫 Line up the silenced pistol'));
    assert.ok(parsed.includes('<button>5. 🛡️ Drop prone behind'));
    assert.ok(parsed.endsWith('</choices>'));
});

test('Concierge Runner: Campaign Launch Alias and Interface', () => {
    assert.equal(typeof executeConciergeCampaignLaunch, 'function');
    assert.equal(executeConciergeCampaignLaunch, launchPbtaCampaign);
});

describe('FAE Custom Genre & Custom Resource Pools', () => {
    test('1. createEmptyDossier("fae") has genreEstablished === false, while createEmptyDossier("fae", "deep_space") has genreEstablished === true and systemKey === "deep_space"', () => {
        const unestablished = createEmptyDossier('fae');
        assert.equal(unestablished.meta.genreEstablished, false);

        const established = createEmptyDossier('fae', 'deep_space');
        assert.equal(established.meta.genreEstablished, true);
        assert.equal(established.meta.systemKey, 'deep_space');

        const unestablishedPbta = createEmptyDossier('pbta');
        assert.equal(unestablishedPbta.meta.genreEstablished, false);

        const establishedPbta = createEmptyDossier('pbta', 'scifi');
        assert.equal(establishedPbta.meta.genreEstablished, true);
        assert.equal(establishedPbta.meta.systemKey, 'scifi');
    });

    test('2. applyDossierUpdates with custom FAE genre and custom pools replaces default pools and survives healAndNormalizeDossier', () => {
        const initial = createEmptyDossier('fae');
        assert.equal(initial.meta.genreEstablished, false);

        const updateText = `
[UPDATE_DOSSIER]
ruleset: fae
system: custom
system_label: Wuxia Jianghu
[PROTAGONIST]
name: Li Wei
pools: Chi: 10/10 (zero_debuff: Qi Deviation, recovery: camp_or_sleep, overflow: scar_and_ko, drain: on_day_pass:1:Inner demon erosion) | Honor: 6/6 (zero_debuff: Disgraced Outcast, recovery: haven_or_specialist, overflow: scene_fail)
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

        const res = applyDossierUpdates(updateText, initial);
        assert.equal(res.success, true);
        assert.equal(res.updatedDossier.meta.systemKey, 'custom');
        assert.equal(res.updatedDossier.meta.systemLabel, 'Wuxia Jianghu');
        assert.equal(res.updatedDossier.meta.genreEstablished, true);

        // Replaces the default health/sanity pools so Object.keys is ['chi', 'honor']
        assert.deepEqual(Object.keys(res.updatedDossier.protagonist.pools), ['chi', 'honor']);
        assert.equal(res.updatedDossier.protagonist.pools.chi.current, 10);
        assert.equal(res.updatedDossier.protagonist.pools.chi.max, 10);
        assert.equal(res.updatedDossier.protagonist.pools.chi.zero_debuff, 'Qi Deviation');
        assert.equal(res.updatedDossier.protagonist.pools.chi.passive_drain?.trigger, 'on_day_pass');
        assert.equal(res.updatedDossier.protagonist.pools.chi.passive_drain?.amount, 1);
        assert.equal(res.updatedDossier.protagonist.pools.chi.passive_drain?.flavor, 'Inner demon erosion');
        assert.equal(res.updatedDossier.protagonist.pools.honor.zero_debuff, 'Disgraced Outcast');
        assert.equal(res.updatedDossier.protagonist.pools.honor.on_overflow, 'scene_fail');

        // Preserves custom pools through healAndNormalizeDossier without re-adding health or sanity
        const healed = healAndNormalizeDossier(res.updatedDossier);
        assert.deepEqual(Object.keys(healed.protagonist.pools), ['chi', 'honor']);
        assert.equal(healed.meta.systemKey, 'custom');
        assert.equal(healed.meta.systemLabel, 'Wuxia Jianghu');
        assert.equal(healed.meta.genreEstablished, true);
    });

    test('3. applyDossierUpdates switching from untouched cosmic_horror to built-in system: osr_dungeon updates protagonist.pools', () => {
        const initial = createEmptyDossier('fae');
        assert.deepEqual(Object.keys(initial.protagonist.pools), ['health', 'sanity']);

        const updateText = `
[UPDATE_DOSSIER]
system: osr_dungeon
[/UPDATE_DOSSIER]`;

        const res = applyDossierUpdates(updateText, initial);
        assert.equal(res.success, true);
        assert.equal(res.updatedDossier.meta.systemKey, 'osr_dungeon');
        assert.deepEqual(Object.keys(res.updatedDossier.protagonist.pools), Object.keys(FAE_GENRES.osr_dungeon.pools));
        assert.ok(res.updatedDossier.protagonist.pools.torch_and_supplies);
        assert.ok(res.updatedDossier.protagonist.pools.resolve);
        assert.ok(res.updatedDossier.protagonist.pools.health);
        assert.equal(res.updatedDossier.protagonist.pools.sanity, undefined);
    });
});

test('FAE Session Zero Concierge: Modal HTML header switcher & dynamic elements', () => {
    const modalHtmlPath = path.resolve(__dirname, '../concierge-modal.html');
    const modalHtml = fs.readFileSync(modalHtmlPath, 'utf8');

    assert.ok(modalHtml.includes('id="mhc_concierge_modal_title"'), 'modal must contain #mhc_concierge_modal_title');
    assert.ok(modalHtml.includes('id="mhc_header_ruleset_toggle"'), 'modal must contain #mhc_header_ruleset_toggle');
    assert.ok(modalHtml.includes('data-ruleset="pbta"'), 'ruleset switcher must contain data-ruleset="pbta"');
    assert.ok(modalHtml.includes('data-ruleset="fae"'), 'ruleset switcher must contain data-ruleset="fae"');
    assert.ok(modalHtml.includes('id="mhc_deck_engine_title"'), 'system card must contain #mhc_deck_engine_title');
});

describe('Stage 2: Quick Start Party Override, Footer All-Pools, CYOA Pool Disambiguation & FAE Memo Initialization', () => {
    test('1. buildFaeQuickStartInstructions does NOT output PARTY OVERRIDE and enforces negative bold header mandate', () => {
        const withParty = buildFaeQuickStartInstructions('osr_dungeon', 'Lou', 'Lou and his friends enter the sewers underneath the city');
        assert.ok(!withParty.includes('PARTY OVERRIDE'), 'Must NOT include party override when customNotes mentions friends (instant action focuses on protagonist)');
        assert.ok(withParty.includes('NEVER wrap the character name or header line in markdown bold (**)'), 'Must include bold header prohibition');
        assert.ok(withParty.includes('NAME: Lou.'), 'Must mention Lou in name line');
        assert.ok(withParty.includes('Torch & Supplies'), 'Must list OSR pools in Quick Start instructions');
        assert.ok(withParty.includes('secondary pools formatted as "((BARBLUE)) Resolve: 6/6" or "((BARGOLD)) Torch & Supplies: 6/6"'));
        assert.ok(withParty.includes('Companion: Name (Role — detail)'), 'Must mention companion format in Positive Tags prompt');
        assert.ok(withParty.includes('Companion: Brother Marcus'), 'Must list Brother Marcus in OSR dungeon snippet');

        const solo = buildFaeQuickStartInstructions('osr_dungeon', 'Lou', 'Lou wanders into the crypt alone');
        assert.ok(!solo.includes('PARTY OVERRIDE'), 'Must NOT include party override when solo');
        assert.ok(solo.includes('NEVER wrap the character name or header line in markdown bold (**)'));
    });

    test('2. buildPbtAQuickStartInstructions does NOT output PARTY OVERRIDE and enforces negative bold header mandate', () => {
        const withParty = buildPbtAQuickStartInstructions('fantasy', 'Aelion', 'Aelion and his party explore the forgotten ruins');
        assert.ok(!withParty.includes('PARTY OVERRIDE'), 'Must NOT include party override when customNotes mentions party (instant action focuses on protagonist)');
        assert.ok(withParty.includes('NEVER wrap the character name or header line in markdown bold (**)'), 'Must include bold header prohibition');
        assert.ok(withParty.includes('NAME: Aelion.'), 'Must mention Aelion in name line');

        const solo = buildPbtAQuickStartInstructions('fantasy', 'Aelion', 'Aelion infiltrates the castle alone');
        assert.ok(!solo.includes('PARTY OVERRIDE'), 'Must NOT include party override when solo');
        assert.ok(solo.includes('NEVER wrap the character name or header line in markdown bold (**)'));
    });

    test('3. buildFaeFooterContent formats all active pools for multi-pool genres and enforces positive 2-line footer', () => {
        const osrFooter = buildFaeFooterContent('osr_dungeon');
        assert.ok(osrFooter.includes('*(Health: [current]/[max]) | (Resolve: [current]/[max]) | (Torch & Supplies: [current]/[max]) | (Scenes: [current]/[target]) | (Location: [Site Name, Current Area])*'), 'Must format all 3 OSR pools in footer template');
        assert.ok(osrFooter.includes('ALWAYS end every narrative message (including turns after a tool call, right above <choices>) with these exact two italicized lines:'), 'Must include positive instruction');
        assert.ok(osrFooter.includes('there MUST be a blank line between the status footer and <choices>'), 'Must enforce blank line before choices in FAE footer template');
        assert.ok(!osrFooter.includes('STRICT FOOTER RULE: NEVER output "Level X"'), 'Must remove negative D&D rule');

        // Custom pools override
        const customFooter = buildFaeFooterContent('custom', {
            pools: {
                chi: { label: 'Chi' },
                honor: { label: 'Honor' },
            },
        });
        assert.ok(customFooter.includes('*(Chi: [current]/[max]) | (Honor: [current]/[max]) | (Scenes: [current]/[target]) | (Location: [Site Name, Current Area])*'));
    });

    test('4. buildFaeCyoaPrompt includes CRITICAL BRACKET RULE and specifies active Resource Pools', () => {
        const cyoaOsr = buildFaeCyoaPrompt('osr_dungeon');
        assert.ok(cyoaOsr.includes('CRITICAL BRACKET RULE:'), 'Must include CRITICAL BRACKET RULE');
        assert.ok(cyoaOsr.includes('Health, Resolve, Torch & Supplies'), 'Must enumerate all 3 OSR pools in bracket rule');
        assert.ok(cyoaOsr.includes('There MUST be a blank line (\n\n) between the two-line italicized status/location footer and the <choices> block'), 'Must enforce blank line before choices in FAE CYOA prompt');
        assert.ok(cyoaOsr.includes('— [Health | +Trap-Wise]'), 'Must provide proper Style B pipe tag example');
        assert.ok(!cyoaOsr.includes('[Stepping-Stone:'), 'Must not contain legacy Stepping-Stone jargon');
    });

    test('5. buildCyoaPrompt dynamically extracts active pool names from memo and includes CRITICAL BRACKET RULE', () => {
        const osrMemo = `[LOCATION]
Sewers
[/LOCATION]

[CHARACTER]
Lou (The Sellsword): 10/10 HP | Pool: Health (10/10) | Scenes: 0/4 | XP: 0/4
((BAR:purple)) Resolve: 8/8 (Zero Debuff: Panicked | Recovery: Rest)
((BAR:orange)) Torch & Supplies: 6/6 (Zero Debuff: Plunged in Darkness | Recovery: Resupply)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Shield-Bearer (defense), Sewer-Wise (navigation)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]`;

        const { systemPrompt } = buildCyoaPrompt({
            narrative: 'A giant rat lunges from the dark slime water!',
            memo: osrMemo,
            isPbta: false,
            isFae: true,
            rpgSettings: { faeGenre: 'osr_dungeon' },
        });

        assert.ok(systemPrompt.includes('CRITICAL BRACKET RULE:'), 'Prompt must include CRITICAL BRACKET RULE');
        assert.ok(systemPrompt.includes('Health, Resolve, Torch & Supplies'), 'Prompt must resolve active pool names from memo');
        assert.ok(systemPrompt.includes('NEVER put a Positive Tag name in place of the Pool name!'));
        assert.ok(systemPrompt.includes('[Health | +Trap-Wise]'));
        assert.ok(!systemPrompt.includes('[Stepping-Stone:'));
    });

    test('6. formatInitialFaeMemo with companion NPCs, maps, and factions renders [PARTY], [DUNGEON], and [FACTIONS]', () => {
        const dossier = {
            genreKey: 'osr_dungeon',
            config: { partyMode: 'party' },
            theKick: { startingLocation: 'The Sunken Catacombs' },
            protagonist: {
                name: 'Lou',
                archetype: 'The Sellsword',
                positiveTags: ['Iron Grip (grappling)', 'Shield Wall (defense)'],
                negativeTags: [],
            },
            npcs: [
                {
                    name: 'Bran',
                    role: 'companion',
                    archetype: 'Torchbearer',
                    appearance: 'Lanky youth clutching a sputtering oil lantern',
                    positiveTags: ['Keen Eyed (spotting traps)'],
                    boons: ['Oil Flasks (3 Uses)'],
                },
                {
                    name: 'Gargoyle Guard',
                    role: 'enemy',
                },
            ],
            maps: [
                { site: 'The Sunken Catacombs', threat: 'HIGH' },
            ],
            factions: [
                {
                    name: 'The Guild of Delvers',
                    standing: 'Friendly',
                    agenda: 'Retrieve the lost sigil',
                },
            ],
            worldRules: {
                customModule: {
                    tag: 'TORCH_CLOCK',
                    label: 'Torch Clock',
                    sampleContent: 'Rounds remaining: 6',
                },
            },
        };

        const memo = formatInitialFaeMemo(dossier);

        // Verify Location
        assert.ok(memo.includes('[LOCATION]\nThe Sunken Catacombs\n[/LOCATION]'), 'Must format location from dossier');

        // Verify Character
        assert.ok(memo.includes('[CHARACTER]'), 'Must include [CHARACTER]');
        assert.ok(memo.includes('Lou (The Sellsword): 10/10 HP | Pool: Health (10/10)'), 'Must format protagonist with OSR pool stats');
        assert.ok(memo.includes('((BARBLUE)) Resolve: 6/6'), 'Must include secondary Resolve bar');
        assert.ok(memo.includes('((BARGOLD)) Torch & Supplies: 6/6'), 'Must include secondary Torch & Supplies bar');
        assert.ok(memo.includes('Companion: Bran (Torchbearer)'), 'Must fold companion into protagonist Positive Tags in [CHARACTER]');

        // Verify Party
        assert.ok(memo.includes('[PARTY]'), 'Must include [PARTY] block for companions');
        assert.ok(memo.includes('- Bran (Torchbearer): 10/10 HP | Pool: Health (10/10)'), 'Must format companion with primary pool and HP');
        assert.ok(memo.includes('Appearance: Lanky youth clutching a sputtering oil lantern'), 'Must include companion appearance');
        assert.ok(memo.includes('((PILLS)) Positive Tags: Keen Eyed (spotting traps)'), 'Must format companion positive tags');
        assert.ok(memo.includes('((PILLS)) Boons: Oil Flasks (3 Uses)'), 'Must format companion boons');
        assert.ok(memo.includes('((PILLS)) Scars & Debuffs: None'), 'Must format initial clean debuffs');
        assert.ok(memo.includes('Status: Healthy'), 'Must format companion status');
        assert.ok(!memo.includes('Gargoyle Guard'), 'Must exclude non-companion NPCs from [PARTY]');

        // Verify Dungeon
        assert.ok(memo.includes('[DUNGEON]\nActive Site: The Sunken Catacombs\nThreat: HIGH\n[/DUNGEON]'), 'Must include [DUNGEON] block');

        // Verify Factions
        assert.ok(memo.includes('[FACTIONS]'), 'Must include [FACTIONS] block');
        assert.ok(memo.includes('((PILLS)) The Guild of Delvers: (+) Friendly (Standing), Agenda (Retrieve the lost sigil)'), 'Must format faction with standing pill');

        // Verify Custom Module
        assert.ok(memo.includes('[TORCH_CLOCK]\nRounds remaining: 6\n[/TORCH_CLOCK]'), 'Must include custom module block');

        // Verify Combat inactive
        assert.ok(memo.includes('[COMBAT]\nActive: false\n[/COMBAT]'), 'Must initialize combat inactive');
    });

    test('7. formatInitialFaeMemo in solo mode omits [PARTY] block', () => {
        const soloDossier = {
            genreKey: 'osr_dungeon',
            config: { partyMode: 'solo' },
            protagonist: {
                name: 'Lou',
                archetype: 'The Sellsword',
            },
            npcs: [
                { name: 'Bran', role: 'companion' },
            ],
        };

        const memo = formatInitialFaeMemo(soloDossier);
        assert.ok(!memo.includes('[PARTY]'), 'Must NOT include [PARTY] when partyMode is solo');
        assert.ok(!memo.includes('Bran'));
        assert.ok(memo.includes('[COMBAT]\nActive: false\n[/COMBAT]'));
    });

    test('8. formatInitialFaeMemo does not duplicate companion if already present in positive_tags', () => {
        const dossier = {
            genreKey: 'osr_dungeon',
            config: { partyMode: 'party' },
            protagonist: {
                name: 'Lou',
                archetype: 'The Sellsword',
                positiveTags: ['Companion: Bran (Torchbearer)', 'Shield Wall (defense)'],
            },
            npcs: [
                { name: 'Bran', role: 'companion', archetype: 'Torchbearer' },
            ],
        };
        const memo = formatInitialFaeMemo(dossier);
        const charBlockMatch = memo.match(/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/);
        const charTags = charBlockMatch ? charBlockMatch[0] : '';
        const charMatches = charTags.match(/Companion:\s*Bran/gi) || [];
        assert.equal(charMatches.length, 1, 'Companion must only appear once in [CHARACTER] Positive Tags');
    });
});

describe('FAE Heroic Domains & Concierge Integration', () => {
    test('1. createEmptyDossier sets heroicTier and heroicDomain based on genre skeleton', () => {
        const osrDossier = createEmptyDossier('fae', 'osr_dungeon');
        assert.equal(osrDossier.config.heroicTier, true);
        assert.equal(osrDossier.config.knobs.heroic_tier, true);
        assert.equal(osrDossier.protagonist.heroicDomain, 'Spellblade [short-range blink and arcane ward-breaking]');

        const cosmicDossier = createEmptyDossier('fae', 'cosmic_horror');
        assert.equal(cosmicDossier.config.heroicTier, false);
        assert.equal(cosmicDossier.config.knobs.heroic_tier, false);
        assert.equal(cosmicDossier.protagonist.heroicDomain, '');
    });

    test('2. applyDossierUpdates parses heroic_tier in [CONFIG] and heroic_domain in [PROTAGONIST]', () => {
        const baseDossier = createEmptyDossier('fae', 'cosmic_horror');
        const updateText = `
[UPDATE_DOSSIER]
summary: Activating heroic tier and domain
ruleset: fae
system: cosmic_horror

[CONFIG]
heroic_tier: true
[/CONFIG]

[PROTAGONIST]
name: Jessica
playbook: The Occultist
heroic_domain: Arch-Mage [elemental conjuration and warding]
positive_tags: Ward Crafter (protective runes), Fast Reflexes (dodging)
[/PROTAGONIST]
[/UPDATE_DOSSIER]
`;
        const result = applyDossierUpdates(updateText, baseDossier);
        assert.ok(result.success);
        assert.equal(result.updatedDossier.config.heroicTier, true);
        assert.equal(result.updatedDossier.config.knobs.heroic_tier, true);
        assert.equal(result.updatedDossier.protagonist.heroicDomain, 'Arch-Mage [elemental conjuration and warding]');

        const contextStr = formatDossierForContext(result.updatedDossier);
        assert.ok(contextStr.includes('heroic_tier=on'));
        assert.ok(contextStr.includes('heroic_domain: Arch-Mage [elemental conjuration and warding]'));
    });

    test('3. serializeDossierToMarkdown and parseMarkdownToDossier roundtrip preserves Heroic Tier and Domain', () => {
        const heroicDossier = createEmptyDossier('fae', 'osr_dungeon');
        heroicDossier.meta.title = 'The Lost Tombs';
        heroicDossier.protagonist.name = 'Valeria';
        heroicDossier.protagonist.playbook = 'Spellblade';
        heroicDossier.protagonist.heroicDomain = 'Spellblade [short-range blink and arcane ward-breaking]';

        const md = serializeDossierToMarkdown(heroicDossier);
        assert.ok(md.includes('Heroic: ON'), 'Markdown must serialize Heroic: ON in FAE Knobs');
        assert.ok(md.includes('* **Heroic Domain:** Spellblade [short-range blink and arcane ward-breaking]'), 'Markdown must serialize Heroic Domain');

        const parsed = parseMarkdownToDossier(md);
        assert.ok(parsed, 'Parsed dossier must not be null');
        assert.equal(parsed.config.heroicTier, true);
        assert.equal(parsed.config.knobs.heroic_tier, true);
        assert.equal(parsed.protagonist.heroicDomain, 'Spellblade [short-range blink and arcane ward-breaking]');

        // Non-heroic dossier roundtrip
        const nonHeroic = createEmptyDossier('fae', 'cosmic_horror');
        nonHeroic.meta.title = 'Shadows Over Innsmouth';
        nonHeroic.protagonist.name = 'Arthur';
        const mdNonHeroic = serializeDossierToMarkdown(nonHeroic);
        assert.ok(!mdNonHeroic.includes('Heroic: ON'));
        assert.ok(!mdNonHeroic.includes('Heroic Domain:'));

        const parsedNonHeroic = parseMarkdownToDossier(mdNonHeroic);
        assert.ok(parsedNonHeroic);
        assert.equal(parsedNonHeroic.config.heroicTier, false);
        assert.equal(parsedNonHeroic.protagonist.heroicDomain, null);
    });

    test('4. concierge-modal.html contains heroic dial button and protagonist heroic domain elements', () => {
        const modalHtmlPath = path.resolve(__dirname, '../concierge-modal.html');
        const modalHtml = fs.readFileSync(modalHtmlPath, 'utf8');

        assert.ok(modalHtml.includes('id="mhc_dial_heroic_btn"'), 'Modal must contain #mhc_dial_heroic_btn');
        assert.ok(modalHtml.includes('id="mhc_deck_char_heroic_domain"'), 'Modal must contain #mhc_deck_char_heroic_domain');
        assert.ok(modalHtml.includes('id="mhc_deck_char_heroic_domain_text"'), 'Modal must contain #mhc_deck_char_heroic_domain_text');
    });
});
