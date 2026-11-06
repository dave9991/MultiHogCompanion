/**
 * tests/fixtures/make-seeded-draft.mjs — MultiHog Companion
 *
 * Builds a deterministic Session Zero draft (no LLM) for an engine, using the REAL parser/healer,
 * so a browser inspector can seed localStorage and verify RENDERING + LAUNCH without conversation
 * nondeterminism. Prints JSON: { storageKey, draft, expected } to stdout.
 *
 * Usage: node tests/fixtures/make-seeded-draft.mjs fae|pbta|dnd5e
 */
import { systemRegistry } from '../../concierge-system-registry.js';
import '../../concierge-system-pbta.js';
import '../../concierge-system-fae.js';
import '../../concierge-system-dnd5e.js';
import { createEmptyDossier, applyDossierUpdates, healAndNormalizeDossier } from '../../concierge-parser.js';

const BLOCKS = {
    fae: {
        name: 'Ines',
        title: 'The Hollow Light',
        location: 'The Drowned Chapel',
        update: `[UPDATE_DOSSIER]
summary: Seeded FAE fixture
ruleset: fae
system: cosmic_horror
title: The Hollow Light
tone: Creeping dread and candlelit stone
premise: A lantern warden descends into a drowned chapel where the light has begun to answer back.

[PROTAGONIST]
name: Ines
gender: female
positive_tags:
- Lantern Warden [when guarding a threshold]
- Trained Archivist [for forbidden texts]
- Steady Hands [when handling fragile relics]
negative_tags:
- Scar: Hollow Tinnitus
[/PROTAGONIST]

[MAP: The Drowned Chapel]
site: The Drowned Chapel
kind: DUNGEON
threat: MODERATE
entrance: Flooded Nave
brief_description: A half-sunk chapel whose bells ring under the water.
[/MAP]

[KICK]
starting_location: The Drowned Chapel
crisis: The chapel's light has started repeating the warden's words.
[/KICK]
[/UPDATE_DOSSIER]`,
    },
};

const engine = process.argv[2];
if (!BLOCKS[engine]) {
    console.error(`No seeded fixture defined for "${engine}" yet. Defined: ${Object.keys(BLOCKS).join(', ')}`);
    process.exit(2);
}

const spec = BLOCKS[engine];
const res = applyDossierUpdates(spec.update, createEmptyDossier(engine));
if (res.errors.length) {
    console.error('Fixture parse errors:', res.errors);
    process.exit(3);
}
const dossier = healAndNormalizeDossier(res.updatedDossier);
const adapter = systemRegistry.get(engine);
const memo = adapter.formatInitialMemo(dossier, { location: dossier.theKick?.startingLocation });

console.log(JSON.stringify({
    storageKey: adapter.getDraftStorageKey(),
    draft: {
        dossier,
        chatHistory: [],
        changelog: [],
        originChatId: null,
        originCampaignTitle: null,
        timestamp: Date.now(),
    },
    expected: {
        name: spec.name,
        title: spec.title,
        location: spec.location,
        initialMemo: memo,
    },
}, null, 2));
