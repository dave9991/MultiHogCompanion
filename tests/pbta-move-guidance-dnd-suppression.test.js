/**
 * pbta-move-guidance-dnd-suppression.test.js
 *
 * Verifies that:
 * 1. Concierge prompts (Builder, Critic, Talker) provide rich PbtA move authoring guidance
 *    (triggers, tri-state 10+/7-9/6- outcomes, forward/hold modifiers) and strictly forbid D&D jargon.
 * 2. Critic prompt contains a mandatory D&D purge check for moves and boons.
 * 3. buildPbtACartridge suppresses upstream D&D constraints and installs clean PbtA constraints.
 * 4. Decoupled CYOA stage 2 runner strictly prohibits advantage/disadvantage in PbtA mode.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
    buildConciergeBuilderPrompt,
    buildConciergeCriticPrompt,
    buildConciergeTalkerPrompt,
    buildConciergeSystemPrompt,
} from '../concierge-prompt.js';
import { buildPbtACartridge } from '../pbta-ruleset.js';
import { buildCyoaPrompt } from '../cyoa-generator.js';

test('1. buildConciergeBuilderPrompt contains PbtA Move Masterclass and strictly bans D&D disadvantage', () => {
    const builderPrompt = buildConciergeBuilderPrompt();

    // Verify Move Authoring Masterclass is present
    assert.ok(builderPrompt.includes('### 📜 PbtA Move Authoring & Mechanics Masterclass'), 'Must have Move Masterclass section');
    assert.ok(builderPrompt.includes('Roll-Triggered Moves'), 'Must describe roll-triggered moves');
    assert.ok(builderPrompt.includes('Fictional Trigger'), 'Must instruct on fictional triggers');
    assert.ok(builderPrompt.includes('On a 10+:'), 'Must describe 10+ strong hit outcome');
    assert.ok(builderPrompt.includes('On a 7–9:'), 'Must describe 7–9 weak hit outcome');
    assert.ok(builderPrompt.includes('On a 6-:'), 'Must describe 6- miss outcome');
    assert.ok(builderPrompt.includes('+1 forward'), 'Must instruct on +1 forward');
    assert.ok(builderPrompt.includes('-1 forward'), 'Must instruct on -1 forward');

    // Verify strict prohibition of D&D mechanics
    assert.ok(builderPrompt.includes('STRICT PROHIBITION OF D&D & D20 MECHANICS'), 'Must contain D&D prohibition header');
    assert.ok(builderPrompt.includes('NEVER write "disadvantage" or "rolls may have disadvantage"'), 'Must explicitly forbid disadvantage');
    assert.ok(builderPrompt.includes('Disadvantage DOES NOT EXIST in PbtA'), 'Must emphasize disadvantage does not exist');
    assert.ok(builderPrompt.includes('BANNED: "DC", "saving throw"'), 'Must ban D&D terminology');

    // Verify negative check: "disadvantage" should ONLY appear in a negative/prohibition context
    const cleanPrompt = builderPrompt.replace(/NEVER[^\n]*disadvantage[^\n]*/gi, '')
                                     .replace(/Disadvantage DOES NOT EXIST[^\n]*/gi, '')
                                     .replace(/NEVER write situational penalties as disadvantage[^\n]*/gi, '');
    assert.ok(!/disadvantage/i.test(cleanPrompt), 'No accidental unsuppressed disadvantage in Builder prompt');
});

test('2. buildConciergeCriticPrompt enforces Move Anatomy and D&D Purge Check', () => {
    const criticPrompt = buildConciergeCriticPrompt();

    // Verify Rubric Item 4 was upgraded
    assert.ok(criticPrompt.includes('PbtA Mechanical Bite & Move Integrity'), 'Rubric 4 must evaluate Move Integrity');
    assert.ok(criticPrompt.includes('Move Anatomy Audit:'), 'Must audit move anatomy');
    assert.ok(criticPrompt.includes('MANDATORY D&D PURGE CHECK:'), 'Must include D&D purge check');
    assert.ok(criticPrompt.includes('Immediate Revise for D&D Mechanics:'), 'Must have immediate revise rule for D&D jargon');
    assert.ok(criticPrompt.includes('Purge D&D mechanics/disadvantage from [entity]'), 'Directive must guide Builder to purge disadvantage');
});

test('3. buildConciergeTalkerPrompt and buildConciergeSystemPrompt forbid D&D disadvantage', () => {
    const talkerPrompt = buildConciergeTalkerPrompt();
    assert.ok(talkerPrompt.includes('No D&D Mechanics:'), 'Talker must have No D&D Mechanics point');
    assert.ok(talkerPrompt.includes('PbtA never uses advantage/disadvantage'), 'Talker must reject advantage/disadvantage');
    assert.ok(talkerPrompt.includes('+1 forward'), 'Talker must reference +1 forward');

    const sysPrompt = buildConciergeSystemPrompt();
    assert.ok(sysPrompt.includes('NEVER use advantage/disadvantage'), 'System prompt must reject advantage/disadvantage');
    assert.ok(sysPrompt.includes('Do NOT copy D&D spell slots, numeric DCs, attack rolls, advantage/disadvantage'), 'Card reader section must ban advantage/disadvantage');
});

test('4. buildPbtACartridge suppresses base D&D constraints and installs clean PbtA constraints', () => {
    const cartridge = buildPbtACartridge('fantasy');

    // Verify syspromptModules suppresses base D&D constraints
    assert.strictEqual(cartridge.payload.syspromptModules.constraints, false, 'syspromptModules.constraints must be false to suppress base 5e constraints');

    // Verify customSyspromptLibrary includes clean PbtA constraints override
    const constraintsSnippet = cartridge.payload.customSyspromptLibrary.find(s => s.tag === 'constraints');
    assert.ok(constraintsSnippet, 'Must have a constraints override snippet in customSyspromptLibrary');
    assert.strictEqual(constraintsSnippet.id, 'pbta_base_override_constraints');
    assert.ok(constraintsSnippet.enabled, 'Constraints snippet must be enabled');

    // Verify constraints snippet does NOT contain 5e disadvantage penalty
    assert.ok(constraintsSnippet.content.includes('NEVER impose D&D "disadvantage"'), 'Must explicitly forbid disadvantage in constraints snippet');
    // Verify constraints snippet contains output_constraints forbidding choices in narrative
    assert.ok(constraintsSnippet.content.includes('<output_constraints>'), 'Must have output_constraints');
    assert.ok(constraintsSnippet.content.includes('NEVER output lettered choices'), 'Must forbid lettered choices in narrative');

    const unsuppressedSnippet = constraintsSnippet.content.replace(/NEVER impose D&D "disadvantage"[^\n]*/gi, '');
    assert.ok(!/disadvantage/i.test(unsuppressedSnippet), 'No unsuppressed disadvantage in PbtA constraints snippet');
});

test('5. buildCyoaPrompt bans advantage/disadvantage in PbtA mode and guides Hold and dilemmas', () => {
    const { systemPrompt } = buildCyoaPrompt({
        narrative: 'The beast lunges forward with claws bared.',
        memo: '[CHARACTER]\n{{user}} (Hunter): 5/5 HP | Harm: 0/5',
        isPbta: true,
        rpgSettings: { pbtaGenre: 'fantasy' },
    });

    assert.ok(systemPrompt.includes('NO D&D MECHANICS:'), 'PbtA CYOA prompt must include NO D&D MECHANICS guideline');
    assert.ok(systemPrompt.includes('advantage/disadvantage'), 'PbtA CYOA prompt must ban advantage/disadvantage');
    assert.ok(systemPrompt.includes('moves roll 2d6 + Stat against fixed tiers (10+ / 7–9 / 6-)'), 'Must explain 2d6 tiers');
    assert.ok(systemPrompt.includes('SPENDING HOLD:'), 'PbtA CYOA prompt must instruct on spending Hold');
    assert.ok(systemPrompt.includes('DILEMMA CONTINUATION:'), 'PbtA CYOA prompt must instruct on dilemma continuation');

    const cleanCyoa = systemPrompt.replace(/NO D&D MECHANICS:[^\n]*/gi, '');
    assert.ok(!/disadvantage/i.test(cleanCyoa), 'No unsuppressed disadvantage in PbtA CYOA prompt');
});
