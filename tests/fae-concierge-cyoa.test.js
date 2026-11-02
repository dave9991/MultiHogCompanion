/**
 * tests/fae-concierge-cyoa.test.js — MultiHog Companion
 *
 * Comprehensive test suite verifying Freeform Attrition Engine (FAE)
 * support across the Session Zero Concierge and CYOA Choice Engine:
 * 1. FAE Empty Dossier initialization & untouched detection
 * 2. Parsing FAE [UPDATE_DOSSIER] blocks (pools, knobs, tags, god tag bans, encounter barriers)
 * 3. Dossier formatting and serialization to Markdown roundtrip
 * 4. FAE Concierge system prompts and builder prompts
 * 5. CYOA Choice Engine prompt generation & Downed / Zero-state detection for FAE
 * 6. Concierge Runner launch alias and FAE integration
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createEmptyDossier,
    isDossierEmptyOrUntouched,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
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

import { FAE_GENRES } from '../fae-ruleset.js';

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

test('FAE Session Zero Concierge: Parsing [UPDATE_DOSSIER] with FAE fields & God Tag ban', () => {
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
positive_tags: Revolver .38 (Heavy snubnose), Street-Smart (Underworld informants), Lucky (God tag), Invincible (Super god tag), Occult Library (Tome access)
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

    // Protagonist & God Tag filtering
    assert.equal(dossier.protagonist.name, 'Inspector Thomas Malone');
    assert.equal(dossier.protagonist.archetype, 'The Relentless Detective');
    
    // Positive tags should have filtered 'Lucky' and 'Invincible'
    const tags = dossier.protagonist.positiveTags;
    assert.ok(tags.some(t => t.includes('Revolver .38')));
    assert.ok(tags.some(t => t.includes('Street-Smart')));
    assert.ok(tags.some(t => t.includes('Occult Library')));
    assert.equal(tags.some(t => /lucky/i.test(t)), false, 'God tag "Lucky" must be filtered');
    assert.equal(tags.some(t => /invincible/i.test(t)), false, 'God tag "Invincible" must be filtered');

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
    assert.ok(faePrompt.includes('STRICT FORBIDDEN GOD TAGS'));
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
    assert.ok(systemPrompt.includes('FAE SCOPE & INTENT:'));
    assert.ok(systemPrompt.includes('Stepping-Stone: Partial progress to crack a leverage layer'));
    assert.ok(systemPrompt.includes('Full Finish: Direct resolution'));
    assert.ok(systemPrompt.includes('Bypass / Tactical Pivot'));
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
<button>1. 🔫 Line up the silenced pistol on the enforcer's hydraulic knee — [Stepping-Stone: Body | Tag: Silenced Pistol]</button>
<button>2. 💻 Deploy an optic glitch packet to blind their cyberware — [Stepping-Stone: Nerve | Tag: Subdermal Cyberdeck]</button>
<button>3. 🏃 Dive through the emergency escape chute into the service vents — [Bypass/Retreat: Body]</button>
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
