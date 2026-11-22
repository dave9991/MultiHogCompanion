/**
 * tests/modular-lorebook-distribution.test.js
 *
 * Verification suite for Phase 1:
 * 1. Token optimization: Campaign Dossier in World Info must have `constant: false`
 * 2. Proper category distribution:
 *    - NPCs -> {prefix}_NPCs (zero monsters/hazards)
 *    - Monsters & Hazards -> {prefix}_Bestiary
 *    - Factions -> {prefix}_Factions
 *    - Locations & Maps -> {prefix}_Locations
 *    - Starting Crisis -> {prefix}_Quests
 * 3. Clean [CORE] formatting and keyword extraction for MultiHog's Keyring attention model
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    extractCleanKeywords,
    buildFactionEntry,
    buildLocationEntry,
    buildStartingQuestEntry,
    buildWorldRuleEntry,
    buildWorldSkeletonEntries,
    buildDossierWorldInfoEntry,
    prepareCampaignLorebookDistributions,
    buildMapThreatBrief,
} from '../concierge-lore-distributor.js';
import { buildPlayerCardBio } from '../concierge-pc-format.js';
import { buildMonsterEntryContent } from '../concierge-npc-format.js';
import { stripResolvedNameTokensInText, sanitizeDossierResolvedNameTokens } from '../namerag-hooks.js';
import {
    registerAndActivateWorldInfoBook,
    prepareSanitizedDossierForFramework,
    STANDARD_CAMPAIGN_BOOK_SUFFIXES,
    resolveCanonicalCampaignPrefix,
    stampCanonicalCampaignPrefix,
    mergePreservingMappedLocationCore,
} from '../concierge-runner.js';
import { healAndNormalizeDossier } from '../concierge-parser.js';

console.log('--- Running Modular Lorebook Distribution Test Suite ---');

// ── Test 1: Token Optimization (Dossier Artifact in World Info) ─────────────
console.log('Testing Token Optimization (Dossier Artifact)...');
const sampleMarkdown = '# Campaign Dossier: Vance: Cold Frost\n\nPremise: Paranormal investigator in the snow.';
const dossierEntry = buildDossierWorldInfoEntry(sampleMarkdown, 12345);

assert.strictEqual(dossierEntry.uid, 12345, 'UID should be preserved');
assert.strictEqual(dossierEntry.constant, false, 'CRITICAL: constant must be false to prevent burning prompt tokens');
assert.strictEqual(dossierEntry.disable, false, 'Entry should be enabled');
assert.ok(dossierEntry.key.includes('campaign dossier'), 'Keys should include campaign dossier');
assert.ok(dossierEntry.content.includes('Vance: Cold Frost'), 'Content should contain markdown');
console.log('✓ Dossier Artifact correctly generated with constant: false');

// ── Test 2: Clean Keyword Extraction ────────────────────────────────────────
console.log('Testing Clean Keyword Extraction...');
const keywords = extractCleanKeywords('The Order of the Silver Dawn');
assert.ok(keywords.includes('The Order of the Silver Dawn'), 'Full phrase should be preserved');
assert.ok(keywords.includes('Silver'), 'Subword Silver should be extracted');
assert.ok(keywords.includes('Dawn'), 'Subword Dawn should be extracted');
assert.ok(keywords.length <= 6, 'Keywords should be bounded to 6 max');
console.log('✓ Clean keyword extraction adheres to MultiHog cap');

// ── Test 3: Faction Formatting ──────────────────────────────────────────────
console.log('Testing Faction Formatting...');
const faction = {
    name: 'The Iron Syndicate',
    standing: 'Hostile',
    agenda: 'Control the underworld trade',
    notes: 'Led by Boss Thorne',
};
const factionEntry = buildFactionEntry(faction);
assert.strictEqual(factionEntry.name, 'The Iron Syndicate');
assert.ok(factionEntry.core.startsWith('[CORE]'), 'Should contain [CORE] opening tag');
assert.ok(factionEntry.core.endsWith('[/CORE]'), 'Should contain [/CORE] closing tag');
assert.ok(factionEntry.core.includes('Standing: Hostile'), 'Should include standing');
assert.ok(factionEntry.core.includes('Agenda: Control the underworld trade'), 'Should include agenda');
assert.ok(factionEntry.core.includes('Notes: Led by Boss Thorne'), 'Should include notes');
assert.ok(factionEntry.keys.includes('The Iron Syndicate'), 'Keys should include faction name');
console.log('✓ Factions cleanly formatted into [CORE] blocks');

// ── Test 4: Location Formatting ─────────────────────────────────────────────
console.log('Testing Location Formatting...');
const map = {
    site: 'Blackwood Pines Ranger Station',
    kind: 'SETTLEMENT',
    threat: 'MODERATE',
    entrance: 'Front Porch',
    briefDescription: 'A snowbound ranger outpost.',
};
const locEntry = buildLocationEntry(map);
assert.strictEqual(locEntry.name, 'Blackwood Pines Ranger Station');
assert.ok(locEntry.core.includes('[CORE]'), 'Should contain [CORE]');
assert.ok(locEntry.core.includes('Kind: SETTLEMENT'), 'Should specify Kind');
assert.ok(locEntry.core.includes('Threat: MODERATE'), 'Should specify Threat');
assert.ok(locEntry.core.includes('Entrance: Front Porch'), 'Should specify Entrance');
assert.ok(locEntry.core.includes('A snowbound ranger outpost.'), 'Should include description');
assert.ok(locEntry.keys.includes('Blackwood Pines Ranger Station'), 'Keys should include site name');
console.log('✓ Locations cleanly formatted for {prefix}_Locations');

// ── Test 5: Starting Quest Formatting ───────────────────────────────────────
console.log('Testing Starting Quest Formatting...');
const theKick = {
    crisis: 'A missing ranger patrol and strange tracks leading into the gorge.',
};
const meta = { title: 'Cold Frost' };
const questEntry = buildStartingQuestEntry(theKick, meta);
assert.ok(questEntry, 'Should generate quest entry');
assert.strictEqual(questEntry.name, 'Starting Crisis: Cold Frost');
assert.ok(questEntry.core.includes('ID: starting_crisis'));
assert.ok(questEntry.core.includes('TYPE: emergent'));
assert.ok(questEntry.core.includes('STATUS: ACTIVE'));
assert.ok(questEntry.core.includes('PREMISE: A missing ranger patrol'));
console.log('✓ Starting Crisis cleanly formatted as emergent quest for {prefix}_Quests');

// ── Test 6: Full Distribution Across Modular Books ─────────────────────────
console.log('Testing Full Distribution Across Modular Books...');
const fullDossier = {
    meta: { title: 'Vance: Cold Frost' },
    theKick: {
        startingLocation: 'Ranger Station',
        crisis: 'Blizzard traps the team as creatures attack.',
    },
    factions: [
        { name: 'Rangers Guild', standing: 'Friendly', agenda: 'Protect the pass' },
        { name: 'Frost Cult', standing: 'Hostile', agenda: 'Summon the blizzard' },
    ],
    npcs: [
        { name: 'Marta Okonkwo', role: 'Lighthouse Keeper', appearance: 'Weathered face', demeanor: 'Gruff' },
    ],
    monsters: [
        { name: 'Ash Wendigo', harm: 4, attacks: 'Frost Claws (2 Harm)' },
    ],
    maps: [
        { site: 'Ranger Station', kind: 'SETTLEMENT', threat: 'MODERATE' },
        { site: 'Sunken Crypt', kind: 'DUNGEON', threat: 'HIGH' },
    ],
};

const dist = prepareCampaignLorebookDistributions(fullDossier);

// Check NPCs & Bestiary separation
assert.strictEqual(dist.npcs.length, 1, 'Should contain 1 NPC (zero monsters)');
assert.strictEqual(dist.npcs[0].name, 'Marta Okonkwo');
assert.strictEqual(dist.npcs.some(n => n.name === 'Ash Wendigo'), false, 'Monsters must not enter NPCs distribution');

assert.ok(Array.isArray(dist.bestiary), 'Should produce bestiary array');
assert.strictEqual(dist.bestiary.length, 1, 'Should contain 1 Monster in bestiary');
assert.strictEqual(dist.bestiary[0].name, 'Ash Wendigo');
assert.ok(dist.bestiary[0].core.includes('Combat Profile'), 'Bestiary entry should retain combat profile');
assert.ok(dist.bestiary[0].keys.includes('Ash Wendigo'), 'Bestiary keys should include monster name');

// Check Map Threat Brief helper
const threatBrief = buildMapThreatBrief(fullDossier);
assert.ok(threatBrief.includes('Ash Wendigo'), 'Map threat brief should mention staged monster');
assert.ok(threatBrief.includes('CREATURE, GROUP, or HAZARD'), 'Map threat brief should guide native Map Architect kinds');
assert.strictEqual(buildMapThreatBrief({ ...fullDossier, monsters: [] }), '', 'Map threat brief should be empty when no monsters exist');

// Check Factions
assert.strictEqual(dist.factions.length, 2, 'Should contain 2 factions');
assert.strictEqual(dist.factions[0].name, 'Rangers Guild');
assert.strictEqual(dist.factions[1].name, 'Frost Cult');

// Check Locations
assert.strictEqual(dist.locations.length, 2, 'Should contain 2 unique locations');
assert.strictEqual(dist.locations[0].name, 'Ranger Station');
assert.strictEqual(dist.locations[1].name, 'Sunken Crypt');

// Check Quests
assert.strictEqual(dist.quests.length, 1, 'Should contain 1 starting emergent quest');
assert.strictEqual(dist.quests[0].name, 'Starting Crisis: Vance: Cold Frost');

console.log('✓ Full campaign distribution properly segments all 4 categories without cross-contamination');

// ── Test 7: HAND-001 Recursive NameRAG Token Stripping ───────────────────────
console.log('Testing HAND-001 universal NameRAG token stripping...');
assert.strictEqual(
    stripResolvedNameTokensInText('Speak with [NAME: gruff guard, RESOLVED TO: Bram] and [REALNAME: Lyra Voss, NAME: spy] by [[NAME: dock_master]].'),
    'Speak with Bram and Lyra Voss by dock_master.',
);
assert.strictEqual(
    stripResolvedNameTokensInText('Escorted by Mara [concept: hardened guide] through the pass.'),
    'Escorted by Mara through the pass.',
);

const pollutedRawDossier = {
    meta: {
        title: '[NAME: icy port, RESOLVED TO: Frosthaven] Chronicles',
        premise: 'Find [NAME: lost heir, RESOLVED TO: Kaelen] in the ruins.',
        tone: 'Grim noir',
    },
    theKick: {
        startingLocation: '[NAME: inn, RESOLVED TO: The Lantern Inn]',
        crisis: 'Assassins strike [NAME: patron, RESOLVED TO: Elara] at dawn.',
        openingPrompt: 'Meet [[NAME: contact_name]] at [NAME: inn, RESOLVED TO: The Lantern Inn].',
    },
    protagonist: {
        name: '[NAME: detective, RESOLVED TO: Silas Thorne]',
        bio: 'Partnered with [NAME: partner, RESOLVED TO: Rook] [concept: tough].',
        background: 'Sworn enemy of [NAME: crime boss, RESOLVED TO: Vane].',
        portraitSrc: 'data:image/png;base64,[NAME: fake, RESOLVED TO: keep]',
    },
    npcs: [
        { name: '[NAME: smith, RESOLVED TO: Torin]', role: 'Ally of [NAME: patron, RESOLVED TO: Elara]', notes: 'Owes [[NAME: debt_holder]] coin.' },
    ],
    monsters: [
        { name: '[NAME: hound, RESOLVED TO: Ash Stalker]', harm: 4, attacks: 'Shadow Bite ([NAME: curse, RESOLVED TO: Decay]), Frost Claws', weakness: 'Silver forged by [NAME: smith, RESOLVED TO: Torin]' },
    ],
    factions: [
        { name: '[NAME: syndicate, RESOLVED TO: Iron Ledger]', agenda: 'Depose [NAME: patron, RESOLVED TO: Elara]' },
    ],
    maps: [
        { site: '[NAME: inn, RESOLVED TO: The Lantern Inn]', briefDescription: 'Owned by [NAME: innkeep, RESOLVED TO: Marta].', entrance: 'Side alley' },
    ],
    worldRules: {
        axioms: [{ title: 'Law of [NAME: oath, RESOLVED TO: Salt]', axiom: 'Only [NAME: smith, RESOLVED TO: Torin] knows the secret.' }],
    },
};

const cleanedDossier = await prepareSanitizedDossierForFramework(pollutedRawDossier, {
    healAndNormalizeDossier,
    resolvePlaceholders: async (jsonStr) => jsonStr.replace(/\[\[NAME:\s*([^\]]+)\]\]/g, (_, tag) => tag.trim()),
});
assert.strictEqual(cleanedDossier.meta.title, 'Frosthaven Chronicles');
assert.strictEqual(cleanedDossier.meta.premise, 'Find Kaelen in the ruins.');
assert.strictEqual(cleanedDossier.theKick.startingLocation, 'The Lantern Inn');
assert.strictEqual(cleanedDossier.theKick.crisis, 'Assassins strike Elara at dawn.');
assert.strictEqual(cleanedDossier.protagonist.name, 'Silas Thorne');
assert.strictEqual(cleanedDossier.protagonist.bio, 'Partnered with Rook.');
assert.strictEqual(cleanedDossier.protagonist.portraitSrc, 'data:image/png;base64,[NAME: fake, RESOLVED TO: keep]', 'Data URI portraitSrc must remain untouched');
assert.strictEqual(cleanedDossier.npcs[0].role, 'Ally of Elara');
assert.strictEqual(cleanedDossier.monsters[0].weakness, 'Silver forged by Torin');
assert.strictEqual(cleanedDossier.factions[0].agenda, 'Depose Elara');
assert.strictEqual(cleanedDossier.maps[0].briefDescription, 'Owned by Marta.');
assert.strictEqual(cleanedDossier.worldRules.axioms[0].title, 'Law of Salt');

// Direct formatter defense when unstripped objects are passed directly
const dirtyPcBio = buildPlayerCardBio({ name: 'Hero', bio: 'Mentored by [NAME: mage, RESOLVED TO: Orin].' });
assert.ok(!dirtyPcBio.includes('RESOLVED TO'), 'buildPlayerCardBio must strip NameRAG tokens directly');
assert.ok(dirtyPcBio.includes('Mentored by Orin.'), 'buildPlayerCardBio must preserve resolved name');

const dirtyWorldRule = buildWorldRuleEntry({ title: 'Guild of [NAME: guild, RESOLVED TO: Ember]', axiom: 'Led by [NAME: archmage, RESOLVED TO: Vael].' });
assert.ok(!dirtyWorldRule.core.includes('RESOLVED TO'), 'buildWorldRuleEntry must strip NameRAG tokens');
assert.ok(dirtyWorldRule.keys.includes('Guild of Ember'), 'extractCleanKeywords must preserve resolved keyword');

const dirtySkeleton = buildWorldSkeletonEntries(JSON.parse(JSON.stringify(pollutedRawDossier)));
assert.ok(dirtySkeleton.every(s => !s.comment.includes('RESOLVED TO') && !s.content.includes('RESOLVED TO')), 'World Skeleton entries must be clean of RESOLVED TO tokens');
console.log('✓ HAND-001 recursive and formatter-level NameRAG token sanitization verified');

// ── Test 8: HAND-003 Bestiary String Attacks/Doom & ST Registry Activation ───
console.log('Testing HAND-003 Bestiary string normalization and ST World Info activation...');
const pbtaStrMonster = buildMonsterEntryContent({
    name: '[NAME: beast, RESOLVED TO: Mire Stalker]',
    harm: 5,
    attacks: 'Barbed Tongue (2 Harm, close), Acid Spit (1 Harm, near)',
    impendingDoom: 'Circles prey → Drags into bog → Consumes whole',
});
assert.ok(pbtaStrMonster.core.includes('Mire Stalker: 5/5 HP | Harm: 0/5 | Armor: 0'));
assert.ok(pbtaStrMonster.core.includes('((PILLS)) Attacks: Barbed Tongue (2 Harm, close), Acid Spit (1 Harm, near)'), 'String attacks must be normalized into Combat Profile');
assert.ok(pbtaStrMonster.core.includes('- Barbed Tongue (2 Harm, close)'), 'String attacks must populate Strengths bullets');
assert.ok(pbtaStrMonster.core.includes('Countdown: Circles prey → Drags into bog → Consumes whole'), 'String impendingDoom must be preserved');

const callLog = [];
await registerAndActivateWorldInfoBook('Frosthaven_Bestiary', { entries: {} }, {
    ctx: {
        saveWorldInfo: async (name) => callLog.push(`save:${name}`),
        updateWorldInfoList: async () => callLog.push('updateList'),
        executeSlashCommandsWithOptions: async (cmd) => callLog.push(`cmd:${cmd}`),
    },
    router: {
        updateWorldInfoCache: async (name) => callLog.push(`cache:${name}`),
        rememberCampaignBook: (name) => callLog.push(`remember:${name}`),
    },
    activateOnChat: true,
});
assert.deepStrictEqual(callLog, [
    'cache:Frosthaven_Bestiary',
    'remember:Frosthaven_Bestiary',
    'save:Frosthaven_Bestiary',
    'updateList',
    'cmd:/world state=on silent=true "Frosthaven_Bestiary"',
]);
console.log('✓ HAND-003 Bestiary normalization and ST World Info registry/activation verified');

// ── Test 9: HAND-004 Canonical Campaign Prefix Ordering & Early Stamping ────
console.log('Testing HAND-004 canonical campaign prefix resolution and stamping...');
const fakeRpgSettings = {
    chatStates: {
        'Game Master - 2026-11-21@12h00m': {
            renamedCampaignPrefix: 'Frosthaven_Chronicles',
        },
    },
};
// Must prefer explicit renamedCampaignPrefix over raw timestamped chatId or .jsonl suffix
assert.strictEqual(
    resolveCanonicalCampaignPrefix('Game Master - 2026-11-21@12h00m.jsonl', {
        adventureTitle: 'Frosthaven Chronicles',
        rpgSettings: fakeRpgSettings,
        stateMgr: {
            getEffectiveRouterCampaignPrefix: () => 'Game_Master_2026_11_21_12h00m',
            sanitizeCampaignPrefixString: (s) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        },
    }),
    'Frosthaven_Chronicles',
    'resolveCanonicalCampaignPrefix must honor Step 0b renamedCampaignPrefix pin even when chatId ends in .jsonl',
);
// Fallback strips .jsonl and sanitizes cleanly
assert.strictEqual(
    resolveCanonicalCampaignPrefix('Echoes in the Dark.jsonl', { adventureTitle: 'Echoes in the Dark' }),
    'Echoes_in_the_Dark',
);

const stampedSettings = { chatStates: {} };
const stamped = stampCanonicalCampaignPrefix('chat_1', 'Frosthaven_Chronicles', stampedSettings);
assert.strictEqual(stamped, 'Frosthaven_Chronicles');
assert.strictEqual(stampedSettings.chatStates.chat_1.renamedCampaignPrefix, 'Frosthaven_Chronicles');
for (const suf of STANDARD_CAMPAIGN_BOOK_SUFFIXES) {
    assert.ok(
        stampedSettings.chatStates.chat_1.campaignBooks.includes(`Frosthaven_Chronicles_${suf}`),
        `campaignBooks must contain Frosthaven_Chronicles_${suf}`,
    );
}
console.log('✓ HAND-004 canonical prefix resolution and early stamping verified');

// ── Test 10: HAND-005 Map Architect Prompt/Brief Separation & CORE Merge ────
console.log('Testing HAND-005 Map Architect interop and Location [CORE] preservation...');
const existingMappedLoc = [
    '[CORE]',
    'Old brief description',
    'Host Site: Frosthold',
    'Host Brief: Command keep overlooking the harbor.',
    '[/CORE]',
    '[MAP]',
    '{"version":3,"site":"Harbor Watch"}',
    '[/MAP]',
    '[Day 2] Guards doubled at the gate.',
].join('\n');

const refreshedLocCore = buildLocationEntry({
    site: 'Harbor Watch',
    kind: 'INTERIOR',
    threat: 'HIGH',
    entrance: 'Sea Gate',
    briefDescription: 'Fortified watchtower overlooking the icy harbor.',
}).core;

const mergedLoc = mergePreservingMappedLocationCore(existingMappedLoc, refreshedLocCore);
assert.ok(mergedLoc.includes('Fortified watchtower overlooking the icy harbor.'), 'Updated brief must replace old brief');
assert.ok(mergedLoc.includes('Kind: INTERIOR'), 'Structured Kind must be included');
assert.ok(mergedLoc.includes('Host Site: Frosthold'), 'Host Site metadata inside [CORE] must be preserved');
assert.ok(mergedLoc.includes('Host Brief: Command keep overlooking the harbor.'), 'Host Brief metadata inside [CORE] must be preserved');
assert.ok(mergedLoc.includes('[MAP]\n{"version":3,"site":"Harbor Watch"}\n[/MAP]'), '[MAP] attachment must remain untouched');
assert.ok(mergedLoc.includes('[Day 2] Guards doubled at the gate.'), 'Post-[/CORE] chronicle text must remain untouched');

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerCode = fs.readFileSync(path.join(runnerDir, 'concierge-runner.js'), 'utf8');
const runMapBlock = runnerCode.match(/await mapArch\.runMapArchitect\(\{([\s\S]*?)\}\);/);
assert.ok(runMapBlock, 'concierge-runner.js must call mapArch.runMapArchitect');
assert.ok(runMapBlock[1].includes('threatContext'), 'Map Architect prompt must include threatContext');
assert.ok(
    !/brief_description:[^\n]*threatContext/.test(runMapBlock[1]),
    'Map Architect brief_description must NOT include private threatContext generation directives',
);
assert.ok(
    runMapBlock[1].includes('locationCore: buildLocationEntry(primaryMap).core'),
    'Map Architect must receive structured locationCore from buildLocationEntry(primaryMap).core',
);
console.log('✓ HAND-005 Map Architect brief/prompt separation and Location [CORE] preservation verified');

console.log('--- ALL MODULAR LOREBOOK DISTRIBUTION TESTS PASSED CLEANLY! ---');
