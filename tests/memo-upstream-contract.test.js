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
