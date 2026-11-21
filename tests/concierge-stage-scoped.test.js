import assert from 'node:assert';
import {
    createEmptyDossier,
    healAndNormalizeDossier,
    isDossierEmptyOrUntouched,
    applyDossierUpdates,
    stripConciergeStateBlocks,
} from '../concierge-parser.js';
import {
    buildStage1InitialBuilderPrompt,
    buildStage1InitialTalkerPrompt,
    buildStage2CanonBuilderPrompt,
    buildStage2CanonTalkerPrompt,
    buildStage3AdventureBuilderPrompt,
    buildStage3AdventureTalkerPrompt,
    buildStage4CharacterBuilderPrompt,
    buildStage4CharacterTalkerPrompt,
    formatStageContinuityBrief,
} from '../concierge-prompt.js';
import { systemRegistry } from '../concierge-system-registry.js';
import { buildTalkerInstructionNotice, shouldRunContemplativeJudgePass } from '../concierge-markdown-codec.js';
import { matchDossierSectionBlocks, normalizeMalformedDossierClosers } from '../concierge-block-lexer.js';
import { ConciergeStateStore } from '../concierge-state-store.js';
import '../concierge-system-pbta.js';
import '../concierge-system-dnd5e.js';
import '../concierge-system-fae.js';

console.log('--- Running Concierge Stage-Scoped Prompts & Directives Test Suite ---');

// ── 1. createEmptyDossier & healAndNormalizeDossier Defaults ─────────────────
console.log('1. Testing createEmptyDossier framing defaults...');
const emptyPbta = createEmptyDossier('pbta');
assert.strictEqual(emptyPbta.meta.focalLens, '', 'focalLens defaults to empty string');
assert.strictEqual(emptyPbta.meta.framingComplete, false, 'framingComplete defaults to false');
assert.strictEqual(emptyPbta.meta.rulesetConfirmed, false, 'rulesetConfirmed defaults to false');
assert.strictEqual(isDossierEmptyOrUntouched(emptyPbta), true, 'Empty dossier is detected as untouched');

console.log('2. Testing isDossierEmptyOrUntouched with focalLens set...');
const withLens = createEmptyDossier('pbta');
withLens.meta.focalLens = 'Sector 4 Smuggling Docks';
assert.strictEqual(isDossierEmptyOrUntouched(withLens), false, 'Dossier with focalLens is recognized as touched');

console.log('3. Testing healAndNormalizeDossier preservation of framing properties...');
const healed = healAndNormalizeDossier({
    meta: {
        title: 'Healed Adventure',
        focalLens: '  Underground Catacombs  ',
        framingComplete: true,
        rulesetConfirmed: true,
    },
});
assert.strictEqual(healed.meta.focalLens, 'Underground Catacombs');
assert.strictEqual(healed.meta.framingComplete, true);
assert.strictEqual(healed.meta.rulesetConfirmed, true);

// ── 2. [FRAMING] & Top-Level Framing Updates ─────────────────────────────────
console.log('4. Testing top-level focal_lens and ready_for_canon directives...');
const updateTopLevel = `
[UPDATE_DOSSIER]
summary: Established focal lens
focal_lens: French Resistance in Lyon
ready_for_canon: true
ruleset_confirmed: true
`;
const repTopLevel = applyDossierUpdates(updateTopLevel, createEmptyDossier('pbta'));
assert.strictEqual(repTopLevel.updatedDossier.meta.focalLens, 'French Resistance in Lyon');
assert.strictEqual(repTopLevel.updatedDossier.meta.framingComplete, true);
assert.strictEqual(repTopLevel.updatedDossier.meta.rulesetConfirmed, true);
assert.ok(repTopLevel.changes.some(c => c.includes('Campaign focal lens set to "French Resistance in Lyon"')));
assert.ok(repTopLevel.changes.some(c => c.includes('Framing marked ready for Canon')));

console.log('5. Testing [FRAMING] block parsing in applyDossierUpdates...');
const updateFramingBlock = `
[UPDATE_DOSSIER]
summary: Framing block defined
[FRAMING]
title: Shadows of the Sprawl
premise: Corrupt megacorps battle street gangs for bio-tech hegemony.
lens: Low-tier runner crew in the Neon Sinks
tone: Gritty cyberpunk noir
framing_complete: yes
[/FRAMING]
`;
const repFraming = applyDossierUpdates(updateFramingBlock, createEmptyDossier('fae'));
assert.strictEqual(repFraming.updatedDossier.meta.title, 'Shadows of the Sprawl');
assert.strictEqual(repFraming.updatedDossier.meta.premise, 'Corrupt megacorps battle street gangs for bio-tech hegemony.');
assert.strictEqual(repFraming.updatedDossier.meta.focalLens, 'Low-tier runner crew in the Neon Sinks');
assert.strictEqual(repFraming.updatedDossier.meta.tone, 'Gritty cyberpunk noir');
assert.strictEqual(repFraming.updatedDossier.meta.framingComplete, true);
assert.strictEqual(repFraming.hasMutations, true);

// ── 3. Canon Mutations (Inline & Section Blocks) ─────────────────────────────
console.log('6. Testing inline Canon directives (disable, enable, remove)...');
const inlineCanonDirectives = `
[UPDATE_DOSSIER]
summary: Inline canon mutations
[DISABLE_CANON: Castle Black]
enable_canon: The Iron Bank
[REMOVE_CANON: Cult of Shadows]
`;
const repInlineCanon = applyDossierUpdates(inlineCanonDirectives, createEmptyDossier('pbta'));
assert.strictEqual(repInlineCanon.hasMutations, true);
assert.deepStrictEqual(repInlineCanon.canonMutations, [
    { action: 'disable', target: 'Castle Black' },
    { action: 'enable', target: 'The Iron Bank' },
    { action: 'remove', target: 'Cult of Shadows' },
]);
assert.ok(repInlineCanon.changes.some(c => c.includes('Disabled Canon entry "Castle Black"')));
assert.ok(repInlineCanon.changes.some(c => c.includes('Enabled Canon entry "The Iron Bank"')));
assert.ok(repInlineCanon.changes.some(c => c.includes('Removed Canon entry "Cult of Shadows"')));

console.log('7. Testing [CANON_ENTRY] and [CANON_UPDATE] block parsing...');
const canonEntryBlocks = `
[UPDATE_DOSSIER]
summary: Processed canon entry blocks
[CANON_ENTRY: House Raven]
kind: FACTION
importance: 5
aliases: Ravens, Black Feathers
content: Ancient order of spymasters operating in the shadows of Oldtown.
[/CANON_ENTRY]

[CANON_UPDATE: Forgotten Catacombs]
kind: LOCATION
action: disable
[/CANON_UPDATE]

[CANON_ENTRY]
name: Sunken Shrine
action: remove
[/CANON_ENTRY]
`;
const repCanonBlocks = applyDossierUpdates(canonEntryBlocks, createEmptyDossier('pbta'));
assert.strictEqual(repCanonBlocks.canonMutations.length, 3);
assert.deepStrictEqual(repCanonBlocks.canonMutations[0], {
    action: 'upsert',
    entry: {
        kind: 'FACTION',
        name: 'House Raven',
        aliases: ['Ravens', 'Black Feathers'],
        importance: 5,
        content: 'Ancient order of spymasters operating in the shadows of Oldtown.',
        disabled: false,
    },
});
assert.deepStrictEqual(repCanonBlocks.canonMutations[1], {
    action: 'disable',
    target: 'Forgotten Catacombs',
});
assert.deepStrictEqual(repCanonBlocks.canonMutations[2], {
    action: 'remove',
    target: 'Sunken Shrine',
});

// Also verify [CANON_ENTRY] with disabled: false AND body content parses as upsert (not enable)
const canonUpsertWithDisabledFalse = `
[UPDATE_DOSSIER]
summary: Tweaked Chrono-Dissonance twist timing
[CANON_ENTRY]
kind: LORE
name: The Chrono-Dissonance
importance: 4
disabled: false
content: Keep the opening Arroyo trial identical; anomalies only begin after the protagonist leaves.
[/CANON_ENTRY]
`;
const repUpsertDisabledFalse = applyDossierUpdates(canonUpsertWithDisabledFalse, createEmptyDossier('pbta'));
assert.strictEqual(repUpsertDisabledFalse.canonMutations.length, 1);
assert.deepStrictEqual(repUpsertDisabledFalse.canonMutations[0], {
    action: 'upsert',
    entry: {
        kind: 'LORE',
        name: 'The Chrono-Dissonance',
        aliases: [],
        importance: 4,
        content: 'Keep the opening Arroyo trial identical; anomalies only begin after the protagonist leaves.',
        disabled: false,
    },
});

console.log('8. Testing stripConciergeStateBlocks with [FRAMING] and [CANON_ENTRY]...');
const rawDialogueWithBlocks = `
Here is my conversational greeting to the player.

[UPDATE_DOSSIER]
summary: Hidden block
[FRAMING]
title: Secret Title
[/FRAMING]
[CANON_ENTRY: Ghost Ship]
content: Spooky ship
[/CANON_ENTRY]
[DISABLE_CANON: Old Port]
[/UPDATE_DOSSIER]

Let's discuss where we should take the story next!
`;
const stripped = stripConciergeStateBlocks(rawDialogueWithBlocks);
assert.ok(!stripped.includes('[UPDATE_DOSSIER]'));
assert.ok(!stripped.includes('[FRAMING]'));
assert.ok(!stripped.includes('[CANON_ENTRY'));
assert.ok(!stripped.includes('DISABLE_CANON'));
assert.ok(stripped.includes('Here is my conversational greeting'));
assert.ok(stripped.includes("Let's discuss where we should take the story next!"));

// ── 4. Stage-Scoped Prompt Builders ──────────────────────────────────────────
console.log('9. Testing Stage 1 Initial Prompts...');
const stage1Dossier = createEmptyDossier('pbta');
stage1Dossier.meta.title = 'Resistance 1944';
stage1Dossier.meta.premise = 'Partisans fighting in occupied France.';
stage1Dossier.meta.focalLens = 'Lyon cell safehouse';
stage1Dossier.meta.tone = 'Tense Espionage';
stage1Dossier.meta.framingComplete = true;

const s1BuilderPrompt = buildStage1InitialBuilderPrompt(stage1Dossier, 'Outline: 2000 lines of WWII notes (bucket: big)');
assert.ok(s1BuilderPrompt.includes('Step 1: Initial Intake & Framing'));
assert.ok(s1BuilderPrompt.includes('100% ruleset-agnostic'));
assert.ok(s1BuilderPrompt.includes('[FRAMING]'));
assert.ok(s1BuilderPrompt.includes('Big Import (bucket: big)'));
assert.ok(s1BuilderPrompt.includes('Resistance 1944'));
assert.ok(s1BuilderPrompt.includes('Lyon cell safehouse'));
assert.ok(s1BuilderPrompt.includes('[ATTACHED_SOURCES_OUTLINE]'));

const s1TalkerPrompt = buildStage1InitialTalkerPrompt(stage1Dossier, 'bucket: big');
assert.ok(s1TalkerPrompt.includes('Step 1: `🧭 Initial` (Intake & Framing)'));
assert.ok(s1TalkerPrompt.includes('100% Ruleset-Agnostic'));
assert.ok(s1TalkerPrompt.includes('📚 Canon'));
assert.ok(s1TalkerPrompt.includes('top stepper bar'));

console.log('10. Testing Stage 2 Canon Prompts...');
const sampleCanonEntries = [
    { kind: 'FACTION', name: 'Lyon Partisans', disabled: false, importance: 5, content: 'Underground network of freedom fighters.' },
    { kind: 'LOCATION', name: 'Safehouse 4', disabled: true, importance: 3, content: 'Burned out apartment near the train station.' },
];
const s2BuilderPrompt = buildStage2CanonBuilderPrompt(stage1Dossier, sampleCanonEntries, '[UPSTREAM_DIFF]\nFocal Lens changed');
assert.ok(s2BuilderPrompt.includes('Step 2: `📚 Canon` (Series Bible & World Laws)'));
assert.ok(s2BuilderPrompt.includes('[CANON_ENTRY]'));
assert.ok(s2BuilderPrompt.includes('[DISABLE_CANON: Name]'));
assert.ok(s2BuilderPrompt.includes('[WORLD_RULES]'));
assert.ok(s2BuilderPrompt.includes('NEVER output Episode 1 stat blocks here'));
assert.ok(s2BuilderPrompt.includes('Lyon Partisans'));
assert.ok(s2BuilderPrompt.includes('Safehouse 4 | DISABLED'));
assert.ok(s2BuilderPrompt.includes('[UPSTREAM_DIFF]'));

const s2TalkerPrompt = buildStage2CanonTalkerPrompt(stage1Dossier, sampleCanonEntries, '');
assert.ok(s2TalkerPrompt.includes('Step 2: `📚 Canon` (Series Bible & World Laws)'));
assert.ok(s2TalkerPrompt.includes('Active/Disabled'));
assert.ok(s2TalkerPrompt.includes('🗺️ Adventure'));
assert.ok(s2TalkerPrompt.includes('🧭 Initial'));

// 10b. Verify Stage 2 prompts include Campaign Framing, existing theKick context, and 350-char synth# previews
const stage2TweakDossier = createEmptyDossier('pbta');
stage2TweakDossier.meta.title = 'Fallout: Arroyo';
stage2TweakDossier.meta.premise = 'A tribal chosen one quests into the wasteland for a GECK.';
stage2TweakDossier.meta.focalLens = 'Keep the opening kick faithful; twists happen after departure';
stage2TweakDossier.meta.tone = 'Retro-futuristic grit';
stage2TweakDossier.theKick.startingLocation = 'Temple of Trials, Arroyo';
stage2TweakDossier.theKick.crisis = 'Pass the Elder trial to earn the Vault 13 jumpsuit.';
const synthTail = 'UNIQUE_BRIDGE_TAIL_MARKER_BEYOND_100_CHARS';
const synthLongContent = `${'A'.repeat(130)} ${synthTail}`;
const mixedCanonEntries = [
    ...Array.from({ length: 22 }, (_, i) => ({
        id: `FalloutBible#${i}`,
        kind: 'LORE',
        name: `Bible Chunk ${i}`,
        disabled: false,
        importance: 3,
        content: `${'B'.repeat(130)} CHUNK_TAIL_${i}`,
    })),
    {
        id: 'synth#0',
        kind: 'LORE',
        name: 'The Chrono-Dissonance',
        disabled: false,
        importance: 4,
        content: synthLongContent,
    },
];
const s2TweakBuilderPrompt = buildStage2CanonBuilderPrompt(stage2TweakDossier, mixedCanonEntries, '');
assert.ok(s2TweakBuilderPrompt.includes('Campaign Framing & Context'));
assert.ok(s2TweakBuilderPrompt.includes('Fallout: Arroyo'));
assert.ok(s2TweakBuilderPrompt.includes('A tribal chosen one quests into the wasteland for a GECK.'));
assert.ok(s2TweakBuilderPrompt.includes('Keep the opening kick faithful; twists happen after departure'));
assert.ok(s2TweakBuilderPrompt.includes('Retro-futuristic grit'));
assert.ok(s2TweakBuilderPrompt.includes('Temple of Trials, Arroyo'));
assert.ok(s2TweakBuilderPrompt.includes('Pass the Elder trial to earn the Vault 13 jumpsuit.'));
assert.ok(s2TweakBuilderPrompt.includes(synthTail), 'synth# bridge entries must expose up to 350 chars in Stage 2 context');
assert.ok(!s2TweakBuilderPrompt.includes('CHUNK_TAIL_0'), 'bulk chunked entries must remain capped at 100 chars when >20 entries');

const s2TweakTalkerPrompt = buildStage2CanonTalkerPrompt(stage2TweakDossier, mixedCanonEntries, '');
assert.ok(s2TweakTalkerPrompt.includes('Fallout: Arroyo'));
assert.ok(s2TweakTalkerPrompt.includes('Temple of Trials, Arroyo'));
assert.ok(s2TweakTalkerPrompt.includes('Pass the Elder trial to earn the Vault 13 jumpsuit.'));
assert.ok(s2TweakTalkerPrompt.includes(synthTail));

console.log('11. Testing Stage 3 Adventure Prompts...');
const s3DossierDnd = createEmptyDossier('dnd5e');
const s3BuilderDnd = buildStage3AdventureBuilderPrompt(s3DossierDnd, sampleCanonEntries, {
    upstreamDiff: '[UPSTREAM_CANON_DIFF]\nSafehouse 4 marked compromised',
    agnosticBones: { startingLocation: 'Cellar', crisis: 'Gestapo patrol approaching' },
});
assert.ok(s3BuilderDnd.includes('Step 3: `🗺️ Adventure` (Episode 1 Stage Set & Ruleset Engine)'));
assert.ok(s3BuilderDnd.includes('DND5E') || s3BuilderDnd.includes('D&D 5e'));
assert.ok(s3BuilderDnd.includes('[MONSTER'));
assert.ok(s3BuilderDnd.includes('[KICK]'));
assert.ok(s3BuilderDnd.includes('[MAP'));
assert.ok(s3BuilderDnd.includes('STRICTLY FORBIDDEN IN STEP 3: NEVER emit [PROTAGONIST]'));
assert.ok(s3BuilderDnd.includes('[UPSTREAM_CANON_DIFF]'));
assert.ok(s3BuilderDnd.includes('[AGNOSTIC_ADVENTURE_BONES]'));

const s3TalkerPrompt = buildStage3AdventureTalkerPrompt(s3DossierDnd, sampleCanonEntries, {
    upstreamDiff: 'Canon updated',
});
assert.ok(s3TalkerPrompt.includes('Step 3: `🗺️ Adventure` (Episode 1 Stage Set)'));
assert.ok(s3TalkerPrompt.includes('Harmonization Notice'));
assert.ok(s3TalkerPrompt.includes('📚 Canon'));
assert.ok(s3TalkerPrompt.includes('👤 Character'));

console.log('12. Testing Stage 4 Character Prompts...');
const s4BuilderFae = buildStage4CharacterBuilderPrompt(createEmptyDossier('fae'), sampleCanonEntries, {
    upstreamDiff: '[UPSTREAM_ADVENTURE_DIFF]\nNew starting weapon assigned',
});
assert.ok(s4BuilderFae.includes('Step 4: `👤 Character` (Protagonist & Progression Codex)'));
assert.ok(s4BuilderFae.includes('FAE'));
assert.ok(s4BuilderFae.includes('[PROTAGONIST]'));
assert.ok(s4BuilderFae.includes('positive_tags'));
assert.ok(s4BuilderFae.includes('FORBIDDEN IN STEP 4'));
assert.ok(s4BuilderFae.includes('[UPSTREAM_DIFF]'));

const s4TalkerPrompt = buildStage4CharacterTalkerPrompt(createEmptyDossier('fae'), sampleCanonEntries, {
    upstreamDiff: 'Adventure diff present',
});
assert.ok(s4TalkerPrompt.includes('Step 4: `👤 Character` (Protagonist & Progression Codex)'));
assert.ok(s4TalkerPrompt.includes('Progression Codex'));
assert.ok(s4TalkerPrompt.includes('🚀 Finalize & Launch Campaign'));
assert.ok(s4TalkerPrompt.includes('🗺️ Adventure'));
assert.ok(s4TalkerPrompt.includes('📚 Canon'));

console.log('13. Testing Ruleset Engine Confirmation & Protagonist Initialization...');
for (const rulesetId of ['dnd5e', 'pbta', 'fae']) {
    const adapter = systemRegistry.get(rulesetId);
    assert.ok(adapter, `Adapter ${rulesetId} must be registered`);
    const defaultGenre = adapter.getDefaultGenre();
    assert.ok(defaultGenre, `Adapter ${rulesetId} must have default genre`);
    const emptyProto = adapter.createEmptyProtagonist(defaultGenre);
    assert.ok(emptyProto, `Adapter ${rulesetId} must create empty protagonist`);

    // Simulate active dossier protagonist retention
    const activeDossier = createEmptyDossier('pbta');
    activeDossier.protagonist.name = 'Commander Shepard';
    activeDossier.protagonist.concept = 'Vanguard N7';
    activeDossier.protagonist.backstory = 'Survivor of Akuze';

    activeDossier.meta.ruleset = rulesetId;
    activeDossier.meta.rulesetConfirmed = true;

    activeDossier.protagonist = Object.assign(emptyProto, {
        name: activeDossier.protagonist?.name || '',
        concept: activeDossier.protagonist?.concept || '',
        backstory: activeDossier.protagonist?.backstory || '',
    });

    assert.strictEqual(activeDossier.protagonist.name, 'Commander Shepard');
    assert.strictEqual(activeDossier.protagonist.concept, 'Vanguard N7');
    assert.strictEqual(activeDossier.protagonist.backstory, 'Survivor of Akuze');
    assert.strictEqual(activeDossier.meta.rulesetConfirmed, true);
    assert.strictEqual(activeDossier.meta.ruleset, rulesetId);
}

console.log('14. Testing Stage 4 First-Entry Prompt & Reactive Guardrails...');
const s4TalkerReactive = buildStage4CharacterTalkerPrompt(createEmptyDossier('dnd5e'), sampleCanonEntries, {});
assert.ok(s4TalkerReactive.includes('Strictly Reactive Navigation Assistance'), 'Talker prompt must instruct reactive-only navigation');
assert.ok(s4TalkerReactive.includes('Never recite or quote this guidance unprompted'), 'Talker prompt must prohibit unprompted navigation recitation');

console.log('15. Testing Writers Room Continuity Brief & Hand-off Notes...');
const testDossier = createEmptyDossier('pbta');
testDossier.meta.title = 'Fallout: New Reno';
testDossier.meta.premise = 'Mob families battle for control of the casinos.';
testDossier.meta.stageNotes = {
    framing: 'Focus on gritty crime and high stakes.',
    canon: 'The Wright Family controls the alcohol stills.',
    adventure: 'Starts in the basement of the Desperado casino under gunfire.',
};
testDossier.theKick.startingLocation = 'Desperado Casino';
testDossier.theKick.crisis = 'Drive-by shooting breaks through the front glass';

const continuityBrief = formatStageContinuityBrief({
    dossier: testDossier,
    canonEntries: sampleCanonEntries,
    stage: 'character',
});

assert.ok(continuityBrief.includes('Authoritative Campaign Continuity Brief'));
assert.ok(continuityBrief.includes('Fallout: New Reno'));
assert.ok(continuityBrief.includes('Mob families battle for control of the casinos.'));
assert.ok(continuityBrief.includes('Focus on gritty crime and high stakes.'));
assert.ok(continuityBrief.includes('The Wright Family controls the alcohol stills.'));
assert.ok(continuityBrief.includes('Starts in the basement of the Desperado casino under gunfire.'));
assert.ok(continuityBrief.includes('Desperado Casino'));
assert.ok(continuityBrief.includes('Drive-by shooting breaks through the front glass'));
assert.ok(continuityBrief.includes('Lyon Partisans'));

const s4TalkerFull = buildStage4CharacterTalkerPrompt(testDossier, sampleCanonEntries);
assert.ok(s4TalkerFull.includes('Authoritative Campaign Continuity Brief'));
assert.ok(s4TalkerFull.includes('Fallout: New Reno'));
assert.ok(s4TalkerFull.includes('Desperado Casino'));
assert.ok(s4TalkerFull.includes('Lyon Partisans'));
assert.ok(s4TalkerFull.includes('Creative Team & Production Pipeline'));

const s4BuilderFull = buildStage4CharacterBuilderPrompt(testDossier, sampleCanonEntries);
assert.ok(s4BuilderFull.includes('Authoritative Campaign Continuity Brief'));
assert.ok(s4BuilderFull.includes('Desperado Casino'));
assert.ok(s4BuilderFull.includes('Lyon Partisans'));

console.log('16. Verifying raw prose preservation in stripConciergeStateBlocks (no prefix suppression)...');
const withPrefixAndBlock = 'Initial_Concierge:\n\n[NOOP][/NOOP]\n\nExcellent. You got the right idea.';
assert.strictEqual(stripConciergeStateBlocks(withPrefixAndBlock), 'Initial_Concierge:\n\n\n\nExcellent. You got the right idea.');

console.log('17. Testing Stage 3 & 4 Continuity Brief (NameRAG-resolved names, Twin-Names guard, starting_moves)...');
const twinTestDossier = createEmptyDossier('pbta');
twinTestDossier.meta.title = 'Broken Chip, Broken World';
twinTestDossier.theKick.startingLocation = 'Vault 13 Exit Perimeter';
twinTestDossier.theKick.crisis = 'Hydro-Chip Collapse';
twinTestDossier.npcs = [
    { name: '[NAME: eccentric scrap merchant, RESOLVED TO: Barnaby]', role: 'Trader' },
];
twinTestDossier.factions = [
    { name: 'Vault 13 Council' },
];
twinTestDossier.protagonist.name = '[NAME: vault dweller experimental probe, RESOLVED TO: Oliver]';
twinTestDossier.protagonist.playbook = 'VAULT PROBATION (Custom)';
twinTestDossier.protagonist.species = 'Human';
twinTestDossier.protagonist.stats = { Cool: 2, Hard: 1, Sharp: 1, Hot: 0, Weird: -1 };
twinTestDossier.protagonist.startingMoves = ['WASTELAND INTUITION (+Sharp): Read irradiated terrain.'];

const s3AdvTalker = buildStage3AdventureTalkerPrompt(twinTestDossier, sampleCanonEntries);
assert.ok(s3AdvTalker.includes('Barnaby [concept: eccentric scrap merchant]'), 'Stage 3 Talker must see NameRAG-resolved NPCs');
assert.ok(s3AdvTalker.includes('Vault 13 Council'), 'Stage 3 Talker must see staged Episode 1 factions');
assert.ok(s3AdvTalker.includes('Vault 13 Exit Perimeter'), 'Stage 3 Talker must see staged theKick');

const s4CharTalker = buildStage4CharacterTalkerPrompt(twinTestDossier, sampleCanonEntries);
assert.ok(s4CharTalker.includes('Current Protagonist Sheet'), 'Stage 4 Talker must include Current Protagonist Sheet');
assert.ok(s4CharTalker.includes('Oliver [concept: vault dweller experimental probe]'), 'Stage 4 Talker must see NameRAG-resolved Protagonist name');
assert.ok(s4CharTalker.includes('VAULT PROBATION (Custom)'), 'Stage 4 Talker must see Protagonist playbook');
assert.ok(s4CharTalker.includes('WASTELAND INTUITION (+Sharp)'), 'Stage 4 Talker must see Protagonist startingMoves');

const noticeWithNames = buildTalkerInstructionNotice('MUTATED', 'Assembles protagonist sheet', [], [
    { tag: 'vault dweller experimental probe', selectedName: 'Oliver' },
]);
assert.ok(noticeWithNames.includes('[RESOLVED_NAMES_THIS_TURN: vault dweller experimental probe -> Oliver]'));

const parsedStartingMoves = applyDossierUpdates(`
[UPDATE_DOSSIER]
summary: Created PbtA protagonist
[PROTAGONIST]
name: Oliver
playbook: VAULT PROBATION
starting_moves:
- WASTELAND INTUITION (+Sharp): Read irradiated terrain.
- SCAVENGER'S EYE (+Cool): Spot pre-war salvage.
[/PROTAGONIST]
`, createEmptyDossier('pbta'));
assert.strictEqual(parsedStartingMoves.updatedDossier.protagonist.startingMoves.length, 2);
assert.ok(parsedStartingMoves.updatedDossier.protagonist.startingMoves[0].includes('WASTELAND INTUITION'));

console.log('18. Testing Phase 0 Step 3 prompt removal directives, sentinel/pipe guards, and multi-block [UPDATE_DOSSIER] extraction...');
const s3FaePrompt = buildStage3AdventureBuilderPrompt(createEmptyDossier('fae'), sampleCanonEntries);
assert.ok(s3FaePrompt.includes('[CLEAR_MONSTERS]') && s3FaePrompt.includes('[REMOVE_MONSTER: Name]'), 'Step 3 prompt must document [CLEAR_MONSTERS] and [REMOVE_MONSTER: Name]');
assert.ok(s3FaePrompt.includes('NEVER emit `[RECALIBRATE_RULESET: none]`'), 'Step 3 prompt must warn against [RECALIBRATE_RULESET: none]');
assert.ok(!s3FaePrompt.includes('flee_grace_toggle: true | false'), 'Step 3 FAE [CONFIG] example must not contain literal pipe templates');

// Sentinel filtering for [RECALIBRATE_RULESET] / [DESIGN_GAME_SYSTEM] + pipe template [CONFIG] guard
const sentinelBase = createEmptyDossier('fae');
sentinelBase.config.knobs.flee_grace_toggle = false;
sentinelBase.config.knobs.base_attrition_shift = 1;
const sentinelParsed = applyDossierUpdates(`
[UPDATE_DOSSIER]
summary: Cleared threats without touching ruleset or dials
[CONFIG]
flee_grace_toggle: true | false
base_attrition_shift: 0 | 1 | -1
action_tempo: gritty_default | action_serial | slow_burn | slice_of_life
overflow_default: scar_and_ko | lethal | scene_fail
heroic_tier: true | false
[/CONFIG]
[RECALIBRATE_RULESET: none]
[DESIGN_GAME_SYSTEM: n/a]
[/UPDATE_DOSSIER]
`, sentinelBase);
assert.strictEqual(sentinelParsed.recalibrateRuleset, '', '[RECALIBRATE_RULESET: none] must be ignored');
assert.strictEqual(sentinelParsed.designGameSystem, '', '[DESIGN_GAME_SYSTEM: n/a] must be ignored');
assert.strictEqual(sentinelParsed.updatedDossier.config.knobs.flee_grace_toggle, false, 'Pipe template true | false must not flip flee_grace_toggle');
assert.strictEqual(sentinelParsed.updatedDossier.config.knobs.base_attrition_shift, 1, 'Pipe template 0 | 1 | -1 must not overwrite base_attrition_shift');

// Stray leading summary + [/UPDATE_DOSSIER] before real [UPDATE_DOSSIER]...[/UPDATE_DOSSIER], and multiple closed blocks
const seededMonsters = applyDossierUpdates(`
[UPDATE_DOSSIER]
[MONSTER: Dust Wolf Pack]
threat_level: 1
[/MONSTER]
[NPC]
name: Mouad
role: Auditor
[/NPC]
[/UPDATE_DOSSIER]
`, createEmptyDossier('fae')).updatedDossier;
assert.strictEqual(seededMonsters.monsters.length, 1);

const strayAndMultiRes = applyDossierUpdates(`
summary: Stripped queued adversaries and updated Mouad gender.
[/UPDATE_DOSSIER]

[UPDATE_DOSSIER]
summary: Stripped queued adversaries.
[CLEAR_MONSTERS]
[/UPDATE_DOSSIER]

[UPDATE_DOSSIER]
[NPC]
name: Mouad
gender: male
[/NPC]
[/UPDATE_DOSSIER]
`, seededMonsters);
assert.strictEqual(strayAndMultiRes.updatedDossier.monsters.length, 0, 'Closed [UPDATE_DOSSIER] after stray closer must apply [CLEAR_MONSTERS]');
assert.strictEqual(strayAndMultiRes.updatedDossier.npcs[0].gender, 'male', 'Second closed [UPDATE_DOSSIER] block must also be merged and parsed');

console.log('19. Testing Phase 1 Spine Audit fixes (CONC-005..CONC-009): lexer lookahead/strip/closers, draft healing, FAE Judge category...');
const unclosedNpcBeforeDirectives = `
[NPC]
name: Mouad
role: Auditor
[CLEAR_MONSTERS]
[REMOVE_NPC: Old Guard]
[RECALIBRATE_RULESET: Weird West]
[DESIGN_GAME_SYSTEM: Frontier Permit Meter]
`;
const parsedNpcBlocks = matchDossierSectionBlocks(unclosedNpcBeforeDirectives, 'NPC(?::\\s*([^\\]\\r\\n]+))?', 'NPC');
assert.strictEqual(parsedNpcBlocks.length, 1);
assert.ok(!parsedNpcBlocks[0].content.includes('[CLEAR_MONSTERS]'), 'Unclosed [NPC] must stop before [CLEAR_MONSTERS]');
assert.ok(!parsedNpcBlocks[0].content.includes('[REMOVE_NPC:'), 'Unclosed [NPC] must stop before [REMOVE_NPC]');
assert.ok(!parsedNpcBlocks[0].content.includes('[RECALIBRATE_RULESET:'), 'Unclosed [NPC] must stop before [RECALIBRATE_RULESET]');
assert.ok(!parsedNpcBlocks[0].content.includes('[DESIGN_GAME_SYSTEM:'), 'Unclosed [NPC] must stop before [DESIGN_GAME_SYSTEM]');

const strippedLeaks = stripConciergeStateBlocks(`Prose before
[RECALIBRATE_RULESET: Weird West]
[DESIGN_GAME_SYSTEM: Frontier Permit Meter]
[GAME_SYSTEM]
tag: PERMITS
[/GAME_SYSTEM]
[REMOVE_GAME_SYSTEM]
[UPSERT_CANON_ENTRY]
kind: LORE
name: Test
[/UPSERT_CANON_ENTRY]
Prose after`);
assert.ok(!strippedLeaks.includes('RECALIBRATE_RULESET') && !strippedLeaks.includes('DESIGN_GAME_SYSTEM') && !strippedLeaks.includes('GAME_SYSTEM') && !strippedLeaks.includes('REMOVE_GAME_SYSTEM') && !strippedLeaks.includes('UPSERT_CANON_ENTRY'), 'stripConciergeStateBlocks must remove all sub-agent and alias blocks');
assert.ok(strippedLeaks.includes('Prose before') && strippedLeaks.includes('Prose after'));

const repairedClosers = normalizeMalformedDossierClosers('/update_dossier\n/noop\n/upsert_canon_entry');
assert.ok(repairedClosers.includes('[/UPDATE_DOSSIER]'));
assert.ok(repairedClosers.includes('[/NOOP]'));
assert.ok(repairedClosers.includes('[/UPSERT_CANON_ENTRY]'));

const store = new ConciergeStateStore();
const corruptedRestore = createEmptyDossier('fae');
corruptedRestore.npcs = [
    { name: '[NAME: Vault City liaison, RESOLVED TO: Zaelyn]', role: 'Foil', gender: '' },
    { name: '[NAME: Vault City liaison, RESOLVED TO: Zaelyn, RESOLVED TO: Ashunte]', role: 'Foil', gender: 'female' },
];
const restoredTrack = store.applyDraftToSessionZero({ dossier: corruptedRestore });
assert.strictEqual(restoredTrack.dossier.npcs.length, 1, 'applyDraftToSessionZero must heal and deduplicate restored NPCs');
assert.strictEqual(restoredTrack.dossier.npcs[0].name, '[NAME: Vault City liaison, RESOLVED TO: Zaelyn]');
assert.strictEqual(restoredTrack.dossier.npcs[0].gender, 'female');

assert.strictEqual(
    shouldRunContemplativeJudgePass({
        prevDossier: { meta: { premise: 'Test' }, protagonist: { name: 'A' }, npcs: [{ name: 'N' }], monsters: [{ name: 'M' }] },
        updatedDossier: {},
        builderReport: {
            hasMutations: true,
            isNoop: false,
            changes: ['Updated NPC "Mouad"', 'Added FAE Encounter "Dust Wolf Pack"', 'The Kick crisis updated'],
        },
    }),
    true,
    'shouldRunContemplativeJudgePass must count "Added FAE Encounter ..." in the monsters category'
);

console.log('--- ALL CONCIERGE STAGE-SCOPED PROMPT & DIRECTIVE TESTS PASSED! ---');
