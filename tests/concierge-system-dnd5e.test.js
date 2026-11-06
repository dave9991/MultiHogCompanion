/**
 * tests/concierge-system-dnd5e.test.js — MultiHog Companion
 *
 * Verifies Phase 1: D&D 5e (D&D Lite) System Adapter & Ruleset Neutrality:
 * 1. System Registry registration, lookup, and ruleset detection.
 * 2. createEmptyDossier('dnd5e') schema defaults.
 * 3. Deterministic code enforcement in healAndNormalizeDossier:
 *    - Hit Die derivation from class name.
 *    - Ability modifier calculation and sign formatting.
 *    - Starting HP = HitDieMax + ConMod (clamped to min 1).
 *    - Instant CORE_DND_PROGRESSIONS blueprint linking.
 *    - Trait vs. Ability dual-block partitioning.
 *    - Level 1 spell slot initialization for casters.
 * 4. MultiHog card formatting for D&D protagonist and monsters.
 * 5. Initial Day 0 State Memo generation.
 */

import test from 'node:test';
import assert from 'node:assert';

import { systemRegistry } from '../concierge-system-registry.js';
import '../concierge-system-pbta.js';
import '../concierge-system-fae.js';
import {
    dnd5eSystemAdapter,
    calculateDndModifier,
    formatDndModifierString,
    DND5E_GENRES,
} from '../concierge-system-dnd5e.js';
import { createEmptyDossier, healAndNormalizeDossier } from '../concierge-parser.js';

test('1. Dnd5eSystemAdapter is registered in systemRegistry with valid metadata', () => {
    assert.ok(systemRegistry.has('dnd5e'), 'systemRegistry must contain dnd5e');
    const adapter = systemRegistry.get('dnd5e');
    assert.equal(adapter.id, 'dnd5e');
    assert.equal(adapter.label, 'D&D 5e (D&D Lite)');
    assert.equal(adapter.diceEngine, 'd20 + Modifier (D&D Lite)');
    assert.equal(adapter.badgeIcon, '⚔️');

    // Case insensitivity
    assert.equal(systemRegistry.get('DND5E').id, 'dnd5e');
    assert.equal(systemRegistry.get('  dNd5E  ').id, 'dnd5e');
});

test('2. detectRuleset identifies dnd5e from explicit meta and structural markers', () => {
    // Explicit meta
    assert.equal(systemRegistry.detectRuleset({ meta: { ruleset: 'dnd5e' } }), 'dnd5e');

    // Structural D&D markers: hitDie and D&D stats
    const dndStructural1 = {
        protagonist: {
            class: 'Fighter',
            hitDie: 'd10',
            stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 8 },
        },
    };
    assert.equal(systemRegistry.detectRuleset(dndStructural1), 'dnd5e', 'Must detect dnd5e from hitDie and stats');

    // Structural D&D marker: progressionBlueprint
    const dndStructural2 = {
        progressionBlueprint: {
            className: 'Rogue',
            levels: { 1: { features: ['Sneak Attack (1d6)'] } },
        },
    };
    assert.equal(systemRegistry.detectRuleset(dndStructural2), 'dnd5e', 'Must detect dnd5e from progressionBlueprint');

    // Does NOT misidentify PbtA or FAE
    const pbtaDossier = { protagonist: { startingMoves: ['Hack & Slash'] } };
    assert.equal(systemRegistry.detectRuleset(pbtaDossier), 'pbta');

    const faeDossier = { protagonist: { positiveTags: ['Alert'] } };
    assert.equal(systemRegistry.detectRuleset(faeDossier), 'fae');
});

test('3. calculateDndModifier and formatDndModifierString compute correct modifiers', () => {
    assert.equal(calculateDndModifier(10), 0);
    assert.equal(calculateDndModifier(11), 0);
    assert.equal(calculateDndModifier(12), 1);
    assert.equal(calculateDndModifier(13), 1);
    assert.equal(calculateDndModifier(14), 2);
    assert.equal(calculateDndModifier(16), 3);
    assert.equal(calculateDndModifier(18), 4);
    assert.equal(calculateDndModifier(20), 5);
    assert.equal(calculateDndModifier(9), -1);
    assert.equal(calculateDndModifier(8), -1);
    assert.equal(calculateDndModifier(7), -2);
    assert.equal(calculateDndModifier(3), -4);

    assert.equal(formatDndModifierString(16), '+3');
    assert.equal(formatDndModifierString(10), '+0');
    assert.equal(formatDndModifierString(8), '-1');
});

test('4. createEmptyDossier("dnd5e") scaffolds a valid D&D 5e campaign dossier', () => {
    const dossier = createEmptyDossier('dnd5e');

    assert.equal(dossier.meta.ruleset, 'dnd5e');
    assert.equal(dossier.meta.title, 'Untitled DND5E Campaign');
    assert.equal(dossier.meta.systemKey, 'fantasy');
    assert.equal(dossier.meta.systemLabel, DND5E_GENRES.fantasy.label);

    const p = dossier.protagonist;
    assert.equal(p.class, 'Fighter');
    assert.equal(p.level, 1);
    assert.equal(p.hitDie, 'd10');
    assert.equal(p.hp.max, 12); // 10 + CON 14 (+2)
    assert.equal(p.stats.STR, 14);
    assert.equal(p.stats.DEX, 12);
    assert.equal(p.stats.CON, 14);
    assert.equal(dossier.config.pacingXp, 300);
});

test('5. healAndNormalizeDossier enforces deterministic D&D Lite rules', () => {
    const rawDossier = {
        meta: { ruleset: 'dnd5e', systemKey: 'dark_fantasy' },
        protagonist: {
            name: 'Lou',
            class: 'Rogue',
            stats: { STR: 10, DEX: 16, CON: 14, INT: 12, WIS: 12, CHA: 10 },
            // Deliberately omitted hitDie and incorrect HP
            hp: { current: 99, max: 99 },
            features: [
                'Sneak Attack (Deal +1d6 damage when having advantage)',
                'Second Wind (Bonus action: heal 1d10+1 HP; 1/1 per short rest)',
            ],
        },
        monsters: [
            {
                name: 'Goblin Skulker',
                hp: 7,
                ac: 15,
                cr: '1/4',
                attacks: 'Scimitar (1d6+2 dmg), Shortbow (1d6+2 dmg)',
            },
        ],
    };

    const healed = healAndNormalizeDossier(rawDossier);
    const p = healed.protagonist;

    // 1. Hit Die derived from class Rogue -> d8
    assert.equal(p.hitDie, 'd8');

    // 2. Starting HP strictly calculated: 8 + CON mod (14 -> +2) = 10 HP
    assert.equal(p.hp.max, 10);
    assert.equal(p.hp.current, 10);

    // 3. Modifiers strictly verified
    assert.equal(calculateDndModifier(p.stats.DEX), 3);

    // 4. Instant CORE_DND_PROGRESSIONS Rogue blueprint attached
    assert.ok(healed.progressionBlueprint, 'Must attach progressionBlueprint for Rogue');
    assert.equal(healed.progressionBlueprint.className, 'Rogue');
    assert.equal(healed.progressionBlueprint.hitDie, 'd8');
    assert.ok(healed.progressionBlueprint.levels[1].features.length > 0);
    assert.ok(healed.progressionBlueprint.levels[20].features.length > 0);

    // 5. Trait vs Ability partitioned
    // Passive Sneak Attack in features, active Second Wind (1/1 per short rest) in abilities
    assert.ok(p.features.some(f => f.includes('Sneak Attack')), 'Sneak Attack must be in passive features');
    assert.ok(p.abilities.some(a => a.includes('Second Wind')), 'Second Wind must be in active abilities');

    // 6. Monster normalization
    const m = healed.monsters[0];
    assert.equal(m.hp.max, 7);
    assert.equal(m.ac, 15);
    assert.equal(m.cr, '1/4');
    assert.ok(Array.isArray(m.attacks));
    assert.equal(m.attacks.length, 2);
});

test('6. Caster classes receive structured Level 1 spell slots in healAndNormalizeDossier', () => {
    const wizardDossier = {
        meta: { ruleset: 'dnd5e', systemKey: 'fantasy' },
        protagonist: {
            name: 'Silas',
            class: 'Wizard',
            stats: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 12, CHA: 10 },
        },
    };

    const healed = healAndNormalizeDossier(wizardDossier);
    const p = healed.protagonist;

    assert.equal(p.hitDie, 'd6');
    assert.equal(p.hp.max, 7); // 6 + CON 12 (+1)
    assert.ok(p.spellSlots);
    assert.equal(p.spellSlots[1], 2, 'Full caster Wizard must receive 2 Level-1 spell slots at Level 1');
});

test('7. MultiHog card formatting adheres to D&D 5e [CORE] specifications', () => {
    const adapter = systemRegistry.get('dnd5e');
    const protagonist = {
        name: 'Thorin',
        gender: 'Male',
        species: 'Dwarf',
        class: 'Cleric',
        features: ['Disciple of Life (+2+SpellLevel healing)'],
        abilities: ['Channel Divinity (1/1 per short rest)'],
        equipment: 'Scale mail, warhammer, holy symbol',
    };

    const bio = adapter.formatPcBio(protagonist);
    assert.match(bio, /Species:\s*Dwarf\s*\(Male\)/i);
    assert.match(bio, /Disciple of Life/i);
    assert.match(bio, /Channel Divinity/i);

    const monster = {
        name: 'Ogre Brute',
        hp: { current: 59, max: 59 },
        ac: 11,
        cr: '2',
        attacks: ['Greatclub (2d8+4 bludgeoning)'],
        notes: 'Fierce brute guarding the ravine.',
    };

    const adv = adapter.formatAdversaryContent(monster);
    assert.ok(adv.core);
    assert.match(adv.core, /Ogre Brute:\s*59\/59 HP \| AC: 11 \| CR: 2/i);
    assert.match(adv.core, /\(\(PILLS\)\)\s*Attacks:\s*Greatclub/i);
});

test('8. formatInitialMemo produces standard Day 0 MultiHog D&D state memo complying with upstream parser contract', () => {
    const adapter = systemRegistry.get('dnd5e');
    const dossier = {
        meta: { title: 'The Lost Crypt', ruleset: 'dnd5e' },
        protagonist: {
            name: 'Lou',
            class: 'Rogue',
            hitDie: 'd8',
            hp: { current: 10, max: 10 },
            ac: 14,
            stats: { STR: 10, DEX: 16, CON: 14, INT: 12, WIS: 12, CHA: 10 },
            features: ['Sneak Attack (Deal +1d6 damage when having advantage)'],
            abilities: ['Cunning Action (Dash, Disengage, or Hide as bonus action)'],
            equipment: 'Leather armor, shortswords, thieves\' tools',
        },
        maps: [{ name: 'Crypt Entrance' }],
    };

    const memo = adapter.formatInitialMemo(dossier);

    // 1. Tag enclosure checks (must have matching opening and closing tags)
    assert.match(memo, /\[TIME\][\s\S]*?\[\/TIME\]/);
    assert.match(memo, /\[LOCATION\][\s\S]*?\[\/LOCATION\]/);
    assert.match(memo, /\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/);
    assert.match(memo, /\[ABILITIES\][\s\S]*?\[\/ABILITIES\]/);
    assert.match(memo, /\[XP\][\s\S]*?\[\/XP\]/);
    assert.match(memo, /\[INVENTORY\][\s\S]*?\[\/INVENTORY\]/);

    // 2. Upstream MultiHog parser contract simulation (extensions/SillyTavern-MultihogDnDFramework/renderer.js:1229)
    const UPSTREAM_MULTIHOG_PATTERN = /\[([^\]\/][^\]]*)\]([\s\S]*?)\[\/\1\]/gi;
    const blocks = {};
    for (const [, tag, content] of memo.matchAll(UPSTREAM_MULTIHOG_PATTERN)) {
        blocks[tag.trim().toUpperCase()] = content.trim();
    }

    const expectedKeys = ['TIME', 'LOCATION', 'CHARACTER', 'ABILITIES', 'XP', 'INVENTORY'];
    for (const key of expectedKeys) {
        assert.ok(blocks[key], `MultiHog parser must produce block for [${key}]`);
    }

    // 3. Cross-module contamination guard: TIME must never leak subsequent headers as raw text
    assert.ok(!blocks.TIME.includes('[LOCATION]'), 'TIME block must NOT contain unparsed [LOCATION]');
    assert.ok(!blocks.TIME.includes('[CHARACTER]'), 'TIME block must NOT contain unparsed [CHARACTER]');
    assert.ok(!blocks.LOCATION.includes('[CHARACTER]'), 'LOCATION block must NOT contain unparsed [CHARACTER]');

    // 4. Content assertions
    assert.match(blocks.CHARACTER, /Lou\s*\(Rogue\):\s*10\/10 HP/);
    assert.ok(!blocks.CHARACTER.includes('Protagonist'), 'CHARACTER block must use authored name, not fallback "Protagonist"');
    assert.match(blocks.CHARACTER, /HD:\s*d8\s*\(1\/1\)/);
    assert.match(blocks.CHARACTER, /AC:\s*14/);
    assert.match(blocks.CHARACTER, /Stats:\s*STR 10 \(\+0\),\s*DEX 16 \(\+3\),\s*CON 14 \(\+2\)/);
    assert.match(blocks.CHARACTER, /\(\(PILLS\)\)\s*Traits:\s*Sneak Attack/);
    assert.match(blocks.ABILITIES, /Cunning Action/);
    assert.match(blocks.XP, /\(0\/300\)\s*Level:\s*1/);
    assert.match(blocks.LOCATION, /Crypt Entrance/);
});

test('9. concierge-parser parses D&D 5e [UPDATE_DOSSIER] with class, stats, features, abilities and derives title', async () => {
    const { parseConciergeStateBlock, createEmptyDossier } = await import('../concierge-parser.js');
    const base = createEmptyDossier('dnd5e');

    const updateBlock = `\`\`\`
[UPDATE_DOSSIER]
summary: Established protagonist Donald the Fighter at The Crossroads Tavern
ruleset: dnd5e
premise: Investigate highway bandits ambushing royal tax wagons along the King's Road.

[PROTAGONIST]
name: Donald
class: Fighter
gender: male
ac: 16
hp: 12/12
stats: STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8
features:
- Second Wind (Regain 1d10+1 HP; 1/1 per short rest)
abilities:
- Action Surge (Take 1 additional action; 1/1 per short rest)
equipment: Chain mail, longsword, shield, 15 gp
[/PROTAGONIST]

[MAP: The Crossroads Tavern]
site: The Crossroads Tavern
danger: Low
sensory: A bustling roadside inn filled with traders and tired travelers.
[/MAP]
[/UPDATE_DOSSIER]
\`\`\``;

    const updated = parseConciergeStateBlock(updateBlock, base);

    assert.equal(updated.meta.ruleset, 'dnd5e', 'Ruleset must be set to dnd5e');
    assert.equal(updated.protagonist.name, 'Donald', 'Protagonist name must be Donald');
    assert.equal(updated.protagonist.class, 'Fighter', 'Protagonist class must be Fighter');
    assert.equal(updated.protagonist.gender, 'male', 'Protagonist gender must be male');
    assert.equal(updated.protagonist.ac, 16, 'Protagonist AC must be 16');
    assert.equal(updated.protagonist.hp.max, 12, 'Protagonist max HP must be 12');
    assert.equal(updated.protagonist.stats.STR, 16, 'Protagonist STR must be 16');
    assert.ok(updated.protagonist.features.length >= 1, 'Protagonist must have features parsed');
    assert.ok(updated.protagonist.abilities.length >= 1, 'Protagonist must have abilities parsed');
    assert.ok(updated.maps.length >= 1, 'Maps must be parsed');
    assert.equal(updated.maps[0].site, 'The Crossroads Tavern');

    // Title should have updated from premise
    assert.ok(!updated.meta.title.includes('Untitled'), `Title "${updated.meta.title}" must not be untitled default`);
});

test('10. concierge-parser accepts system: dnd5e and resiliently parses protagonist with unbracketed /protagonist closing tag', async () => {
    const { applyDossierUpdates, createEmptyDossier } = await import('../concierge-parser.js');
    const base = createEmptyDossier('dnd5e');

    const updateBlock = `\`\`\`
[UPDATE_DOSSIER]
summary: Established protagonist Donald the Fighter
ruleset: dnd5e
system: dnd5e
title: Donald's Frontier Quest

[PROTAGONIST]
name: Donald
class: Fighter
gender: male
ac: 16
hp: 12/12
stats: STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8
features:
- Fighting Style: Dueling
abilities:
- Second Wind (1/1 per short rest)
equipment: Chain mail, shield, 15 gp
/protagonist
[/UPDATE_DOSSIER]
\`\`\``;

    const res = applyDossierUpdates(updateBlock, base);
    const updated = res.updatedDossier;

    assert.equal(res.errors.length, 0, `Must have zero errors, got: ${res.errors.join('; ')}`);
    assert.equal(updated.meta.ruleset, 'dnd5e');
    assert.equal(updated.meta.systemKey, 'fantasy');
    assert.equal(updated.protagonist.name, 'Donald', 'Protagonist name must be Donald even with /protagonist closure');
    assert.equal(updated.protagonist.class, 'Fighter');
    assert.equal(updated.meta.title, "Donald's Frontier Quest");
    assert.ok(res.hasMutations, 'Must report mutations');
});
