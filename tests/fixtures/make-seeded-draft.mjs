/**
 * tests/fixtures/make-seeded-draft.mjs — MultiHog Companion
 *
 * Builds a deterministic Session Zero draft (no LLM) for an engine, using the REAL parser/healer,
 * so a browser inspector can seed localStorage and verify RENDERING + LAUNCH without conversation
 * nondeterminism. Prints JSON: { storageKey, draft, expected } to stdout.
 *
 * Usage: node tests/fixtures/make-seeded-draft.mjs fae|pbta|dnd5e
 */
import fs from 'node:fs';
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
    pbta: {
        name: 'Kaelen',
        title: 'Ashes of the Iron Spire',
        location: 'The Sunken Watchtower',
        update: `[UPDATE_DOSSIER]
summary: Seeded PbtA fixture
ruleset: pbta
system: fantasy
title: Ashes of the Iron Spire
tone: Mythic peril and rain-slicked ruins
premise: An exiled ranger returns to a sunken border watchtower where the signal beacon burns black.

[PROTAGONIST]
name: Kaelen
playbook: The Ranger
gender: male
stats: Might +1, Agility +2, Wit +1, Spirit +0, Charm -1
harm: 0/5 (Armor: 1)
starting_moves:
- Called Shot: When you attack a surprised or defenseless foe at range, roll+Agility.
- Wild Empathy: You can speak with and understand beasts of the wild.
gear:
- Ashwood Longbow
- Ranger Cloak (1 Armor)
- Signal Horn
conditions:
- Vigilant
[/PROTAGONIST]

[MAP: The Sunken Watchtower]
site: The Sunken Watchtower
kind: DUNGEON
threat: MODERATE
entrance: Collapsed Causeway
brief_description: A flooded border tower whose iron brazier burns with cold soot.
[/MAP]

[KICK]
starting_location: The Sunken Watchtower
crisis: Shadow-hounds are circling the causeway as the black beacon flares.
[/KICK]
[/UPDATE_DOSSIER]`,
    },
    dnd5e: {
        name: 'Vespera',
        title: 'The Sunken Vault',
        location: 'The Crossroads Tavern',
        update: `[UPDATE_DOSSIER]
summary: Seeded D&D 5e fixture
ruleset: dnd5e
system: fantasy
title: The Sunken Vault
tone: High fantasy mystery and arcane danger
premise: A draconic sorcerer investigates an ancient vault beneath a crossroads tavern whose cellar stones whisper of dragons.

[PROTAGONIST]
name: Vespera
class: Sorcerer
gender: female
species: Dragonborn
stats: STR 10, DEX 14, CON 14, INT 12, WIS 10, CHA 16
hp: 8/8
ac: 15
features:
- Draconic Resilience (Base AC 13 + DEX modifier when unarmored)
abilities:
- Breath Weapon: Fire 15ft cone (2d6 fire damage, DEX save DC 13; 1/1 per rest)
gear:
- Dagger
- Arcane Focus (Crystal Orb)
- Dungeoneer's Pack
- 15 gp
proficiencies:
- Daggers, Darts, Slings, Quarterstaffs, Light Crossbows, Arcane Focus
skills:
- Arcana +3, Perception +2, Intimidation +5
cantrips:
- Fire Bolt, Prestidigitation
spells:
- Magic Missile, Shield
[/PROTAGONIST]

[NPC: Caleb the Barkeep]
name: Caleb
role: Tavern Keeper
disposition: Friendly
location: The Crossroads Tavern
brief_description: A retired adventurer who tends bar with a vigilant eye.
notes: Discovered glowing draconic runes beneath his cellar beer barrels.
[/NPC]

[MAP: The Crossroads Tavern]
site: The Crossroads Tavern
kind: SETTLEMENT
threat: LOW
entrance: Heavy Oak Doors
brief_description: A bustling waystation perched on the high trade road.
[/MAP]

[KICK]
starting_location: The Crossroads Tavern
crisis: Goblin looters have breached the forgotten vault below the wine cellar.
[/KICK]
[/UPDATE_DOSSIER]`,
        quests: [
            {
                name: 'The Cellar Incursion',
                status: 'active',
                giver: 'Caleb the Barkeep',
                description: 'Clear the goblin looters out of the cellar and seal the breached vault door.',
            },
        ],
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
if (spec.quests && Array.isArray(spec.quests)) {
    dossier.quests = spec.quests;
}
const adapter = systemRegistry.get(engine);
const memo = adapter.formatInitialMemo(dossier, { location: dossier.theKick?.startingLocation });

const payload = {
    storageKey: adapter.getDraftStorageKey(),
    draft: {
        dossier,
        chatHistory: [],
        changelog: [],
        originChatId: null,
        originCampaignTitle: null,
        timestamp: Date.now(),
        turn0Text: memo,
    },
    expected: {
        name: spec.name,
        title: spec.title,
        location: spec.location,
        initialMemo: memo,
        turn0Text: memo,
    },
};

const jsonStr = JSON.stringify(payload, null, 2);
console.log(jsonStr);

const outUrl = new URL(`seeded-draft-${engine}.json`, import.meta.url);
fs.writeFileSync(outUrl, jsonStr + '\n', 'utf8');
