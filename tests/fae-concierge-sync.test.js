/**
 * fae-concierge-sync.test.js — MultiHog Companion
 *
 * Verifies Phase 1 FAE Concierge fixes:
 * 1. mergeDossierIntoLiveFaeMemo non-destructively updates live game memo without
 *    resetting in-flight pool attrition, trauma conditions, or scene progression.
 * 2. buildMonsterEntryContent formats FAE threats with Threat/Barriers/Pools and
 *    omits "PbtA adversary" and Harm/Armor.
 * 3. buildPlayerCardBio formats FAE protagonist tags and Heroic Domain and purges PbtA harm.
 * 4. healAndNormalizeDossier applies clean non-Harm default gear for FAE campaigns.
 */

import test from 'node:test';
import assert from 'node:assert';

import {
    mergeDossierIntoLiveFaeMemo,
    formatInitialFaeMemo,
    parseFaeStateFromMemo,
} from '../fae-state-sync.js';
import { buildMonsterEntryContent } from '../concierge-npc-format.js';
import { buildPlayerCardBio } from '../concierge-pc-format.js';
import { createEmptyDossier, healAndNormalizeDossier } from '../concierge-parser.js';

test('1. mergeDossierIntoLiveFaeMemo preserves in-flight attrition, scenes, and conditions', () => {
    // Initial memo
    const initialMemo = formatInitialFaeMemo('cosmic_horror', {
        location: 'Arkham Miskatonic Library',
        heroicTier: false,
    });

    // Simulate in-flight play: take 5 Sanity damage (down to 3/8), complete 2 scenes
    let inFlightMemo = initialMemo
        .replace(/((?:\(\(BAR[A-Z]+\)\)\s*)?Sanity:\s*)\d+\/\d+/i, '$13/8')
        .replace(/Scenes:\s*\d+\/\d+/i, 'Scenes: 2/4');

    if (inFlightMemo.includes('((PILLS)) Scars & Debuffs: None')) {
        inFlightMemo = inFlightMemo.replace(
            '((PILLS)) Scars & Debuffs: None',
            '((PILLS)) Scars & Debuffs: (-) Trauma: Auditory Hallucinations (constant whispering)'
        );
    } else {
        inFlightMemo = inFlightMemo.replace(
            '[/CHARACTER]',
            '((PILLS)) Scars & Debuffs: (-) Trauma: Auditory Hallucinations (constant whispering)\n[/CHARACTER]'
        );
    }

    // Add an active encounter block in [COMBAT]
    inFlightMemo += `\n\n[COMBAT]\nCultist Lurker: 1/2 HP | Threat: 2 (Moderate) | Pools: Health, Sanity\n((PILLS)) Pressures: Chanting\nInstinct: Ambush scholars\nStatus: (-) Wounded\n[/COMBAT]`;

    // Updated dossier from Concierge Deck
    const updatedDossier = {
        meta: {
            title: 'Shadows of Arkham',
            ruleset: 'fae',
            systemKey: 'cosmic_horror',
        },
        protagonist: {
            name: 'Dr. Henry Armitage',
            playbook: 'Occult Scholar',
            positiveTags: [
                'Occult Scholar (ancient tomes and rituals)',
                'Keen Eye (notices subtle occult glyphs)',
                'Resolute Will (guards mind against panic)',
            ],
            negativeTags: [
                'Fragile Constitution (strains under heavy exertion)',
            ],
            pools: {
                health: { label: 'Health', max: 8, barColor: 'green' },
                sanity: { label: 'Sanity', max: 8, barColor: 'blue' },
                resolve: { label: 'Resolve', max: 6, barColor: 'purple' },
            },
        },
        config: {
            faeGenre: 'cosmic_horror',
            pacingScenes: 6,
        },
        factions: [
            { name: 'Miskatonic University', standing: 'Allied', agenda: 'Contain anomalies' },
        ],
    };

    const mergedMemo = mergeDossierIntoLiveFaeMemo(inFlightMemo, updatedDossier);

    // 1. In-flight pool attrition must be preserved
    assert.match(mergedMemo, /Sanity:\s*3\/8/i, 'Sanity pool attrition (3/8) must be preserved');

    // 2. Scenes completed must be preserved
    assert.match(mergedMemo, /Scenes:\s*2\/6/i, 'Scenes completed (2) must be preserved while scenes target updates to 6');

    // 3. Trauma condition from play must be preserved alongside new negative tag
    assert.match(mergedMemo, /Auditory Hallucinations/i, 'Trauma condition from active play must be preserved');
    assert.match(mergedMemo, /Fragile Constitution/i, 'Newly configured negative tag must be merged');

    // 4. Positive tags must be updated
    assert.match(mergedMemo, /Occult Scholar/i, 'Updated positive tags must appear in [CHARACTER]');
    assert.match(mergedMemo, /Keen Eye/i, 'Updated positive tags must appear in [CHARACTER]');

    // 5. Active [COMBAT] block must be intact
    assert.match(mergedMemo, /\[COMBAT\][\s\S]*?Cultist Lurker[\s\S]*?\[\/COMBAT\]/i, 'Active [COMBAT] encounter block must be preserved');

    // 6. Factions block must be present
    assert.match(mergedMemo, /\[FACTIONS\][\s\S]*?Miskatonic University[\s\S]*?\[\/FACTIONS\]/i, '[FACTIONS] block must be updated');
});

test('2. buildMonsterEntryContent formats FAE threats cleanly without PbtA bleed', () => {
    const faeThreat = {
        name: 'The Dunwich Abomination',
        threatLevel: 3,
        layers: 3,
        currentLayers: 1,
        poolsAtRisk: ['Health', 'Sanity'],
        pressures: ['Acidic Secretions', 'Reality Distortion'],
        instinct: 'Rend flesh and invoke the Outer Gods',
        weakness: 'Blades forged with cold iron or lightning',
        leverageBarriers: ['Eldritch Ward', 'Shifting Mass'],
        notes: 'A titanic spawn that terrifies the countryside.',
    };

    const entry = buildMonsterEntryContent(faeThreat, null, { ruleset: 'fae' });

    assert.ok(entry.core, 'Must produce a valid [CORE] entry');
    // Must NOT contain PbtA adversary or PbtA Harm / Armor
    assert.doesNotMatch(entry.core, /PbtA adversary/i, 'Must not label FAE entity as PbtA adversary');
    assert.doesNotMatch(entry.core, /Armor:\s*\d+/i, 'Must not output PbtA Armor');
    assert.doesNotMatch(entry.core, /Harm:\s*\d+\/\d+/i, 'Must not output PbtA Harm');

    // Must contain FAE background & combat profile
    assert.match(entry.core, /FAE threat entity/i, 'Must label entity as FAE threat entity');
    assert.match(entry.core, /The Dunwich Abomination:\s*2\/3 HP\s*\|\s*Threat:\s*3 \(Formidable\)\s*\|\s*Pools:\s*Health,\s*Sanity/i, 'Combat profile must adhere to FAE standard');
    assert.match(entry.core, /Pressures:\s*Acidic Secretions,\s*Reality Distortion/i, 'Pressures pill must be present');
    assert.match(entry.core, /Instinct:\s*Rend flesh/i, 'Instinct must be present');
    assert.match(entry.core, /Leverage:\s*Blades forged/i, 'Leverage weakness pill must be present');
});

test('3. buildMonsterEntryContent retains backward compatibility for PbtA adversaries', () => {
    const pbtaMonster = {
        name: 'Goblin Skulker',
        harm: 3,
        currentHarm: 1,
        armor: 1,
        attacks: ['Rusty Dagger (2 Harm, close)'],
        weakness: 'Bright Light',
        impendingDoom: ['Steal rations', 'Poison water well'],
        notes: 'Cowardly cave lurker.',
    };

    const entry = buildMonsterEntryContent(pbtaMonster, null, { ruleset: 'pbta' });

    assert.match(entry.core, /PbtA adversary/i, 'Must label PbtA adversary');
    assert.match(entry.core, /Goblin Skulker:\s*2\/3 HP\s*\|\s*Harm:\s*1\/3\s*\|\s*Armor:\s*1/i, 'Must output PbtA tandem HP/Harm/Armor');
    assert.match(entry.core, /Attacks:\s*Rusty Dagger \(2 Harm, close\)/i, 'Must output PbtA attacks');
    assert.match(entry.core, /Countdown:\s*Steal rations → Poison water well/i, 'Must output countdown doom track');
});

test('4. buildPlayerCardBio formats FAE tags and Heroic Domain while cleansing Harm', () => {
    const faeProtagonist = {
        name: 'Kaelen Vance',
        playbook: 'Shadow Infiltrator',
        appearance: 'Slender, dark cloak, silver mask',
        equipment: 'Lockpicks, grappling wire, signature rapier (2 Harm)',
        personality: 'Quiet, calculating, fiercely loyal',
        background: 'Former guild thief turned investigator.',
        habits: 'Tests exits immediately upon entering a room.',
        positiveTags: [
            'Master of Locks (bypasses complex locks)',
            'Silent Step (leaves no trace)',
        ],
        negativeTags: [
            'Hunted by Syndicate (known face in criminal taverns)',
        ],
        heroicDomain: 'Shadow Veil (can step through shadows at Threat 0)',
    };

    const bio = buildPlayerCardBio(faeProtagonist, null, { ruleset: 'fae' });

    // Strengths must contain Positive Tags and Heroic Domain
    assert.match(bio, /Strengths:\s*\n- Heroic Domain:\s*Shadow Veil/i, 'Heroic Domain must appear in Strengths');
    assert.match(bio, /\+ Tag:\s*Master of Locks/i, 'Positive Tags must appear in Strengths');

    // Flaws must contain Negative Tags
    assert.match(bio, /Flaws:\s*\n- - Tag:\s*Hunted by Syndicate/i, 'Negative Tags must appear in Flaws');

    // Equipment must NOT retain accidental (2 Harm)
    assert.match(bio, /Worn Equipment:\s*Lockpicks, grappling wire, signature rapier\b/i, 'Accidental (2 Harm) must be stripped from FAE gear');
    assert.doesNotMatch(bio, /2 Harm/i, '2 Harm must not appear in FAE character equipment');
});

test('5. healAndNormalizeDossier supplies clean default gear without Harm for FAE', () => {
    const faeDossier = createEmptyDossier('fae', 'cosmic_horror');
    const healed = healAndNormalizeDossier(faeDossier);

    assert.deepStrictEqual(
        healed.protagonist.gear,
        ['Essential explorer kit', 'Signature tool or weapon'],
        'FAE default gear must be free of PbtA Harm tags'
    );

    const pbtaDossier = createEmptyDossier('pbta', 'fantasy');
    const pbtaHealed = healAndNormalizeDossier(pbtaDossier);

    assert.deepStrictEqual(
        pbtaHealed.protagonist.gear,
        ['Essential adventurer kit', 'Signature weapon (close, 2 Harm)'],
        'PbtA default gear must retain authentic PbtA tags'
    );
});
