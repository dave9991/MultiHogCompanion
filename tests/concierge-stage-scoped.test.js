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

console.log('--- ALL CONCIERGE STAGE-SCOPED PROMPT & DIRECTIVE TESTS PASSED! ---');
