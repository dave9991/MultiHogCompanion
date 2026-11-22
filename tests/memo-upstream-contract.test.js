/**
 * tests/memo-upstream-contract.test.js — MultiHog Companion
 *
 * Deterministic guard (no LLM, no browser) for the class of bug that collapsed the whole
 * MultiHog state tracker into one 31-entry TIME card: a Day 0 memo whose blocks are not
 * parseable by the REAL upstream parser.
 *
 * The block regex is READ FROM upstream renderer.js SOURCE at test time (never copied), so any
 * upstream change to parseMemoBlocks is detected instead of silently drifting.
 * Covers every registered engine: dnd5e, pbta, fae.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

import { systemRegistry } from '../concierge-system-registry.js';
import '../concierge-system-pbta.js';
import '../concierge-system-fae.js';
import '../concierge-system-dnd5e.js';
import {
    createEmptyDossier,
    healAndNormalizeDossier,
    applyDossierUpdates,
    normalizeMalformedDossierClosers,
} from '../concierge-parser.js';
import {
    splitNameAndEmbeddedArchetype,
    flattenArchetypeParens,
    sanitizeCharacterHeaderInMemo,
    rectifyMemoCharacterName,
} from '../character-creator-sanitizer.js';
import {
    formatInitialFaeMemo,
    formatFaeCharacterMemoBlock,
    parseFaeStateFromMemo,
    normalizeFaePill,
} from '../fae-state-sync.js';
import {
    formatInitialPbtaMemo,
    isAlliedCompanionRole,
} from '../pbta-ruleset.js';

// ── Upstream parser, extracted from source ──────────────────────────────────
const RENDERER_PATH = new URL('../../SillyTavern-MultihogDnDFramework/renderer.js', import.meta.url);

function loadUpstreamBlockRegex() {
    const src = fs.readFileSync(RENDERER_PATH, 'utf8');
    const m = src.match(/export function parseMemoBlocks[\s\S]*?const pattern = \/(.+)\/([a-z]*);/);
    assert.ok(m, 'Could not locate parseMemoBlocks pattern in upstream renderer.js — upstream changed; update this guard.');
    return { source: m[1], flags: m[2] };
}

function upstreamParseMemoBlocks(memo) {
    const { source, flags } = loadUpstreamBlockRegex();
    const blocks = {};
    for (const [, tag, content] of memo.matchAll(new RegExp(source, flags))) {
        blocks[tag.trim().toUpperCase()] = content.trim();
    }
    return blocks;
}

test('0. upstream parseMemoBlocks regex is extractable and matches the contract we rely on', () => {
    const { source } = loadUpstreamBlockRegex();
    const blocks = upstreamParseMemoBlocks('[A]\nx\n[/A]\n\n[B]\ny\n[/B]');
    assert.deepEqual(Object.keys(blocks), ['A', 'B'], `unexpected upstream regex: ${source}`);
    // The bug we are guarding: no closers -> nothing parses.
    assert.deepEqual(upstreamParseMemoBlocks('[A]\nx\n\n[B]\ny'), {});
});

// ── Per-engine Day 0 memo contract ──────────────────────────────────────────
const ENGINES = [
    { id: 'dnd5e', name: 'Donald', required: ['TIME', 'LOCATION', 'CHARACTER', 'ABILITIES', 'XP', 'INVENTORY'] },
    { id: 'pbta', name: 'Mara', required: ['TIME', 'LOCATION', 'CHARACTER'] },
    { id: 'fae', name: 'Ines', required: ['TIME', 'LOCATION', 'CHARACTER'] },
];

function buildDossier(engineId, name) {
    const d = createEmptyDossier(engineId);
    d.protagonist.name = name;
    if (engineId === 'dnd5e') d.protagonist.class = 'Fighter';
    return healAndNormalizeDossier(d);
}

for (const eng of ENGINES) {
    test(`1.${eng.id} Day 0 memo parses through the REAL upstream parser into discrete blocks`, () => {
        const adapter = systemRegistry.get(eng.id);
        const dossier = buildDossier(eng.id, eng.name);
        const memo = adapter.formatInitialMemo(dossier, {});
        assert.ok(memo && memo.length > 0, `${eng.id}: formatInitialMemo returned empty`);

        const blocks = upstreamParseMemoBlocks(memo);
        for (const key of eng.required) {
            assert.ok(blocks[key] !== undefined, `${eng.id}: upstream parser produced no [${key}] block. Got: ${Object.keys(blocks).join(', ') || '(none)'}`);
        }

        // Cross-module contamination: no block body may contain another block's raw header/closer.
        for (const [tag, body] of Object.entries(blocks)) {
            const leaked = body.match(/^\s*\[\/?[A-Z][A-Z _]*\]\s*$/m);
            assert.ok(!leaked, `${eng.id}: [${tag}] body leaks raw tag line "${leaked && leaked[0].trim()}"`);
        }

        // Every opener must have a closer (nothing silently dropped by the lazy regex).
        const openers = [...memo.matchAll(/^\s*\[([A-Z][A-Z _]*)\]\s*$/gm)].map(x => x[1]);
        for (const tag of openers) {
            assert.ok(blocks[tag] !== undefined, `${eng.id}: [${tag}] opened but never parsed (missing [/${tag}]?)`);
        }

        // Identity: authored name present, fallback stub absent.
        assert.ok(blocks.CHARACTER.includes(eng.name), `${eng.id}: CHARACTER block missing authored name "${eng.name}"`);
        assert.ok(!/\bProtagonist\b/.test(blocks.CHARACTER), `${eng.id}: CHARACTER block fell back to "Protagonist"`);
    });
}

// ── Golden parser fixtures: malformed LLM output must not regress any engine ─
const PROTAGONIST_FIXTURES = {
    dnd5e: (closer) => `[UPDATE_DOSSIER]
summary: Donald the Fighter
ruleset: dnd5e
system: dnd5e
title: Donald's Frontier Quest

[PROTAGONIST]
name: Donald
class: Fighter
hp: 12/12
ac: 16
stats: STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8
${closer}
[/UPDATE_DOSSIER]`,
    pbta: (closer) => `[UPDATE_DOSSIER]
summary: Mara the Sleuth
title: Neon Alibi
system: cosmic_horror

[PROTAGONIST]
name: Mara
playbook: The Sleuth
stats: Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1
harm: 5
armor: 1
${closer}
[/UPDATE_DOSSIER]`,
    fae: (closer) => `[UPDATE_DOSSIER]
summary: Ines the Warden
ruleset: fae
system: cosmic_horror
title: The Hollow Light

[PROTAGONIST]
name: Ines
gender: female
positive_tags:
- Lantern Warden [when guarding a threshold]
${closer}
[/UPDATE_DOSSIER]`,
};

for (const [engineId, build] of Object.entries(PROTAGONIST_FIXTURES)) {
    for (const [label, closer] of [['well-formed [/PROTAGONIST]', '[/PROTAGONIST]'], ['bare /protagonist', '/protagonist']]) {
        test(`2.${engineId} parser extracts protagonist name with ${label}`, () => {
            const base = createEmptyDossier(engineId);
            const res = applyDossierUpdates(build(closer), base);
            const expected = { dnd5e: 'Donald', pbta: 'Mara', fae: 'Ines' }[engineId];
            assert.equal(res.updatedDossier.protagonist.name, expected, `${engineId}/${label}: name lost. errors=${res.errors.join('; ')}`);
            assert.ok(res.hasMutations, `${engineId}/${label}: no mutations reported`);
        });
    }
}

test('3. normalizeMalformedDossierClosers is narrow: rewrites only whole-line known-tag closers', () => {
    assert.equal(normalizeMalformedDossierClosers('a\n/protagonist\nb'), 'a\n[/PROTAGONIST]\nb');
    assert.equal(normalizeMalformedDossierClosers('  /npc  '), '[/NPC]');
    // Must NOT touch values, prose, paths, or unknown tags.
    const untouched = [
        'hp: 12/12',
        'Uses 1/1 per short rest',
        'the /protagonist command is a path-like word inside a sentence',
        'harm: 3/6',
        '/unknowntag',
        '[/PROTAGONIST]',
    ].join('\n');
    assert.equal(normalizeMalformedDossierClosers(untouched), untouched);
});

// ── MEMO-001 .. MEMO-005 Regression Guards ──────────────────────────────────
test('4. MEMO-001 & MEMO-002: Jon nested-paren archetype + starting flaws emit clean Turn-0 FAE memo with Status: Healthy', () => {
    const base = createEmptyDossier('fae', 'post_apocalyptic');
    const stage4Update = `[UPDATE_DOSSIER]
summary: Protagonist Jon built for wasteland magistracy.
ruleset: fae
system: post_apocalyptic
[PROTAGONIST]
name: Jon (Frontier Magistrate (Old World Paladin))
gender: male
positive_tags:
- Oathbound Sentinel [when enforcing NCR law or protecting civilians]
- Heavy Armor Training [when resisting bludgeon or ballistic attacks]
- Bureaucratic Inquisition [when cross-examining suspects or verifying warrants]
negative_tags:
- Unyielding Code [when tempted to break the law for a greater good]
- Dust-Blind [when tracking through a sandstorm or low visibility]
pools: Body: 10/10 | Stress: 8/8 | Rations & Gear: 6/6
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

    const applied = applyDossierUpdates(stage4Update, base);
    const healed = healAndNormalizeDossier(applied.updatedDossier);

    assert.equal(healed.protagonist.name, 'Jon');
    assert.equal(healed.protagonist.archetype, 'Frontier Magistrate — Old World Paladin');
    assert.equal(healed.character.archetype, 'Frontier Magistrate — Old World Paladin');

    const memo = formatInitialFaeMemo(healed, {});
    assert.ok(memo.includes('Jon (Frontier Magistrate — Old World Paladin): 10/10 HP | Pool: Body (10/10)'), `Unexpected header in:\n${memo}`);
    assert.ok(!memo.includes('The Road Warrior') && !memo.includes('The Sellsword'), 'Must not fall back to genre default archetype');
    assert.ok(!memo.includes('((Frontier'), 'Must not emit nested/double parens');
    assert.ok(memo.includes('Status: Healthy'), 'Starting negative tags/flaws must NOT fabricate Strained & Injured status');
    assert.ok(!memo.includes('Strained & Injured'));

    // Even if an un-healed dossier bypasses healAndNormalizeDossier with stale genre default, formatInitialFaeMemo cleans it
    const staleCharDossier = createEmptyDossier('fae', 'post_apocalyptic');
    staleCharDossier.protagonist.name = 'Jon (Frontier Magistrate (Old World Paladin))';
    staleCharDossier.protagonist.negativeTags = ['Unyielding Code (when tempted)'];
    const directMemo = formatInitialFaeMemo(staleCharDossier, {});
    assert.ok(directMemo.includes('Jon (Frontier Magistrate — Old World Paladin):'), 'Direct formatInitialFaeMemo must prefer embedded archetype over stale default');
    assert.ok(!directMemo.includes('The Road Warrior') && !directMemo.includes('The Sellsword'), 'Must not fall back to genre default archetype');
    assert.ok(directMemo.includes('Status: Healthy'));
});

test('5. MEMO-003: parseFaeStateFromMemo -> formatFaeCharacterMemoBlock preserves Status, nested archetypes, and explicit Positive Tags: None', () => {
    const liveMemo = `[CHARACTER]
Jon (Frontier Magistrate (Old World Paladin)) (The Sellsword): 9/10 HP | Pool: Body (9/10) | Scenes: 1/4 | XP: 1/4
((BARPURPLE)) Stress: 8/8
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko | Tempo: gritty_default | Idle: 1t | Breather: READY
((PILLS)) Positive Tags: None
((PILLS)) Scars & Debuffs: (-) Unyielding Code (moral dilemma)
Status: (-) Poisoned
[/CHARACTER]`;

    const parsed = parseFaeStateFromMemo(liveMemo, 'post_apocalyptic');
    assert.equal(parsed.character.name, 'Jon');
    assert.equal(parsed.character.archetype, 'Frontier Magistrate — Old World Paladin');
    assert.equal(parsed.character.status, '(-) Poisoned');
    assert.deepEqual(parsed.character.positive_tags, [], 'Explicit Positive Tags: None must not backfill genre defaults');
    assert.equal(parsed.pools.body.current, 9);

    const serialized = formatFaeCharacterMemoBlock(parsed);
    assert.ok(serialized.includes('Jon (Frontier Magistrate — Old World Paladin): 9/10 HP'));
    assert.ok(serialized.includes('((PILLS)) Positive Tags: None'));
    assert.ok(serialized.includes('Status: (-) Poisoned'));
    assert.ok(!serialized.includes('Strained & Injured'));
});

test('6. MEMO-004: normalizeFaePill converts inner parentheses in descriptions to brackets', () => {
    assert.equal(
        normalizeFaePill('Oathbound Sentinel (when defending (the weak))'),
        'Oathbound Sentinel (when defending [the weak])'
    );
    assert.equal(
        normalizeFaePill('(-) Burn (deep (thermal))'),
        '(-) Burn (deep [thermal])'
    );
});

test('7. MEMO-001: PbtA and D&D 5e initial memos split embedded archetypes and flatten nested parens', () => {
    const pbtaDossier = createEmptyDossier('pbta', 'fantasy');
    pbtaDossier.protagonist.name = 'Mara (Shadow Blade (Exile))';
    pbtaDossier.protagonist.playbook = '';
    const pbtaMemo = formatInitialPbtaMemo(pbtaDossier);
    assert.ok(pbtaMemo.includes('Mara (Shadow Blade — Exile): '), `Unexpected PbtA header:\n${pbtaMemo}`);
    assert.ok(!pbtaMemo.includes('(Wanderer)'), 'Must promote embedded playbook over Wanderer fallback');

    const dndDossier = createEmptyDossier('dnd5e');
    dndDossier.protagonist.name = 'Jon (Frontier Magistrate (Old World Paladin))';
    dndDossier.protagonist.class = '';
    const dndMemo = systemRegistry.get('dnd5e').formatInitialMemo(dndDossier, {});
    assert.ok(dndMemo.includes('Jon (Frontier Magistrate — Old World Paladin): '), `Unexpected D&D header:\n${dndMemo}`);
    assert.ok(!dndMemo.includes('(Fighter)'), 'Must promote embedded class over Fighter fallback');
});

test('8. MEMO-004: sanitizeCharacterHeaderInMemo & rectifyMemoCharacterName scope placeholder replacement strictly to Line 1', () => {
    const memoWithTagsMentioningUserAndPlayer = `[CHARACTER]
{{user}} (Frontier Magistrate (Old World Paladin)) (The Sellsword): 10/10 HP | Pool: Health (10/10)
((PILLS)) Positive Tags: Sworn to the User (defending civilians), Player of Cards (bluffing)
((PILLS)) Scars & Debuffs: (-) Debt to User (owes a favor)
Status: Healthy
[/CHARACTER]`;

    const rectified = rectifyMemoCharacterName(memoWithTagsMentioningUserAndPlayer, 'Jon');
    assert.ok(rectified.includes('Jon (Frontier Magistrate — Old World Paladin): 10/10 HP'));
    assert.ok(rectified.includes('Sworn to the User (defending civilians)'), 'Must NOT corrupt Positive Tags containing "User ("');
    assert.ok(rectified.includes('Player of Cards (bluffing)'), 'Must NOT corrupt Positive Tags containing "Player"');
    assert.ok(rectified.includes('(-) Debt to User (owes a favor)'), 'Must NOT corrupt Scars containing "User ("');

    // Also verify when Line 1 has a normal name while Line 3 has "Player (" or "User ("
    const cleanHeadMemo = `[CHARACTER]
Jon (Sentinel): 10/10 HP
((PILLS)) Positive Tags: User (system test), Player (trickster)
[/CHARACTER]`;
    const reSanitized = sanitizeCharacterHeaderInMemo(cleanHeadMemo, 'Marcus');
    assert.ok(reSanitized.includes('Jon (Sentinel): 10/10 HP'));
    assert.ok(reSanitized.includes('User (system test), Player (trickster)'), 'Line 1 scoping must leave pill lines untouched');
});

test('9. MEMO-004: isAlliedCompanionRole accepts genuine allies and rejects negated/adversarial roles', () => {
    assert.equal(isAlliedCompanionRole('Loyal Companion'), true);
    assert.equal(isAlliedCompanionRole('Party Medic'), true);
    assert.equal(isAlliedCompanionRole('Trusted Ally'), true);
    assert.equal(isAlliedCompanionRole('Expert Mentor'), true);

    assert.equal(isAlliedCompanionRole('Former ally turned enemy'), false);
    assert.equal(isAlliedCompanionRole('Betrayed the party'), false);
    assert.equal(isAlliedCompanionRole('Ex-companion rival'), false);
    assert.equal(isAlliedCompanionRole('Ex ally'), false);
    assert.equal(isAlliedCompanionRole('Hostile Patron'), false);
    assert.equal(isAlliedCompanionRole(''), false);
});

test('10. MEMO-001: splitNameAndEmbeddedArchetype leaves NameRAG tokens intact', () => {
    assert.deepEqual(
        splitNameAndEmbeddedArchetype('[[NAME: veteran magistrate (old world)]]'),
        { cleanName: '[[NAME: veteran magistrate (old world)]]', embeddedArchetype: '' }
    );
    assert.deepEqual(
        splitNameAndEmbeddedArchetype('[NAME: paladin, RESOLVED TO: Jon (Vanguard)]'),
        { cleanName: '[NAME: paladin, RESOLVED TO: Jon (Vanguard)]', embeddedArchetype: '' }
    );
    assert.equal(flattenArchetypeParens('(Frontier Magistrate (Old World Paladin))'), 'Frontier Magistrate — Old World Paladin');
});
