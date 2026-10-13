/**
 * decoupled-cyoa-pipeline.test.js — MultiHog Companion
 *
 * Verifies the Decoupled Two-Stage CYOA Engine:
 * 1. Prompt sanitization (stripping <CYOA_mode> and past choice buttons).
 * 2. Downed/incapacitated detection in PbtA (Max Harm / 0 HP) and D&D (0 HP / Dying).
 * 3. System-aware Stage 2 prompt generation (crisis moves vs tactical choices).
 * 4. Choice markup extraction and repair.
 * 5. Stage 2 execution and abort handling.
 */

import assert from 'node:assert';
import {
    stripCyoaFromOutgoingChat,
} from '../cyoa-guardian.js';
import {
    isProtagonistDowned,
    buildStage2CyoaPrompt,
    extractCleanChoicesMarkup,
    abortStage2Cyoa,
    isStage2CyoaRunning,
} from '../cyoa-decoupled-runner.js';

console.log('--- Testing Decoupled CYOA Engine ---');

// ── 1. Prompt Sanitization & Stripping ──
console.log('1. Testing stripCyoaFromOutgoingChat...');

const testChat = [
    {
        role: 'user',
        mes: 'I charge the goblin!\n\n<CYOA_mode>\nGenerate 5 numbered choices at the end.\n</CYOA_mode>\n\n### STATE MEMO\n[CHARACTER]\nHero: 10/10 HP\n[/CHARACTER]',
    },
    {
        role: 'assistant',
        mes: 'The goblin lunges at you with a rusted dagger.\n\n<choices>\n<button>1. ⚔️ Strike</button>\n<button>2. 🛡️ Dodge</button>\n</choices>\n\n*(Status: 10/10 HP)*',
    },
    {
        role: 'user',
        mes: 'I swing my sword!',
    },
    {
        role: 'assistant',
        mes: 'Your sword strikes true!\n\n<div class="rt-cyoa-choices"><button>1. Loot</button><button>2. Move on</button></div>',
    },
];

const didStrip = stripCyoaFromOutgoingChat(testChat);
assert.strictEqual(didStrip, true, 'stripCyoaFromOutgoingChat must modify messages containing CYOA markup');

// Check that <CYOA_mode> is gone from user message
assert.ok(!testChat[0].mes.includes('<CYOA_mode>'), '<CYOA_mode> must be stripped from user message');
assert.ok(testChat[0].mes.includes('I charge the goblin!'), 'User text must be preserved');
assert.ok(testChat[0].mes.includes('### STATE MEMO'), 'State memo must be preserved');

// Check that <choices> are gone from past assistant messages
assert.ok(!testChat[1].mes.includes('<choices>'), '<choices> block must be stripped from assistant message 1');
assert.ok(!testChat[1].mes.includes('<button>'), '<button> tags must be stripped from assistant message 1');
assert.ok(testChat[1].mes.includes('The goblin lunges at you'), 'Assistant narrative must be preserved');
assert.ok(testChat[1].mes.includes('*(Status: 10/10 HP)*'), 'Status footer must be preserved');

// Check that .rt-cyoa-choices div is gone from assistant message 2
assert.ok(!testChat[3].mes.includes('rt-cyoa-choices'), 'rt-cyoa-choices div must be stripped from assistant message 2');
assert.ok(testChat[3].mes.includes('Your sword strikes true!'), 'Assistant narrative must be preserved');

console.log('✓ Prompt sanitization cleanly strips CYOA mode and historical buttons without touching story');

// ── 2. Downed Detection (PbtA vs D&D) ──
console.log('2. Testing isProtagonistDowned...');

// 2a. PbtA Downed cases
const pbtaDownMemo1 = `[CHARACTER]
Hero (Warrior): 0/5 HP | Harm: 5/5 | Armor: 1
Status: (-) Incapacitated
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(pbtaDownMemo1, true), true, 'PbtA 5/5 Harm must be detected as downed');

const pbtaDownMemo2 = `[CHARACTER]
Hero: 0/5 HP | Harm: 5/5
Status: Healthy
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(pbtaDownMemo2, true), true, 'PbtA 0/5 HP must be detected as downed');

const pbtaDownMemo3 = `[CHARACTER]
Hero: 2/5 HP | Harm: 3/5
Status: (-) Dying
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(pbtaDownMemo3, true), true, 'PbtA Status: Dying must be detected as downed');

// 2b. PbtA Conscious cases
const pbtaConsciousMemo = `[CHARACTER]
Hero: 3/5 HP | Harm: 2/5 | Armor: 1
Status: Healthy
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(pbtaConsciousMemo, true), false, 'PbtA 2/5 Harm must be conscious');

// 2c. D&D Downed cases
const dndDownMemo1 = `[CHARACTER]
Hero: 0/24 HP
Status: (-) Dying (Death Saves 0/3), (-) Unconscious
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(dndDownMemo1, false), true, 'D&D 0 HP must be detected as downed');

const dndDownMemo2 = `[CHARACTER]
Hero: -4/30 HP
Status: Unconscious
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(dndDownMemo2, false), true, 'D&D negative HP must be detected as downed');

// 2d. D&D Conscious cases
const dndConsciousMemo = `[CHARACTER]
Hero: 18/24 HP
Status: Healthy
[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(dndConsciousMemo, false), false, 'D&D 18 HP must be conscious');

console.log('✓ isProtagonistDowned accurately detects downed states across both PbtA and D&D');

// ── 3. Stage 2 CYOA Prompt Generation ──
console.log('3. Testing buildStage2CyoaPrompt...');

// 3a. PbtA Downed prompt
const pbtaDownPrompts = buildStage2CyoaPrompt({
    narrative: 'The beast strikes you down. The world spins and turns to black.',
    memo: pbtaDownMemo1,
    isPbta: true,
    rpgSettings: { pbtaGenre: 'fantasy', cyoaConfig: { playstyle: 'cyoa_5' } },
});
assert.ok(pbtaDownPrompts.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / INCAPACITATED'), 'PbtA Downed prompt must contain Downed mandate');
assert.ok(pbtaDownPrompts.systemPrompt.includes('CLING TO LIFE / LAST BREATH'), 'Must mandate Cling to Life choice');
assert.ok(pbtaDownPrompts.systemPrompt.includes('FAINT PLEA / CALL FOR AID'), 'Must mandate Faint Plea choice');
assert.ok(pbtaDownPrompts.systemPrompt.includes('SLIP INTO DARKNESS'), 'Must mandate Slip into darkness choice');
assert.ok(pbtaDownPrompts.userPrompt.includes('The beast strikes you down'), 'User prompt must include narrative context');
assert.ok(pbtaDownPrompts.userPrompt.includes('Harm: 5/5'), 'User prompt must include fresh state memo');

// 3b. PbtA Conscious prompt
const pbtaConsciousPrompts = buildStage2CyoaPrompt({
    narrative: 'You draw your blade and face the raiders.',
    memo: pbtaConsciousMemo,
    isPbta: true,
    rpgSettings: { pbtaGenre: 'fantasy', cyoaConfig: { playstyle: 'cyoa_5' } },
});
assert.ok(!pbtaConsciousPrompts.systemPrompt.includes('THE PROTAGONIST IS DOWNED'), 'Conscious prompt must NOT contain downed mandate');
assert.ok(pbtaConsciousPrompts.systemPrompt.includes('PbtA Moves & Narrative Choices'), 'Conscious prompt must instruct PbtA moves');

// 3c. D&D Downed prompt
const dndDownPrompts = buildStage2CyoaPrompt({
    narrative: 'The orc warlord lands a critical hit. You fall bleeding onto the stone floor.',
    memo: dndDownMemo1,
    isPbta: false,
    rpgSettings: { cyoaConfig: { playstyle: 'cyoa_5' } },
});
assert.ok(dndDownPrompts.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / UNCONSCIOUS (0 HP / DYING)'), 'D&D Downed prompt must contain 0 HP dying mandate');
assert.ok(dndDownPrompts.systemPrompt.includes('Roll Death Saving Throw'), 'Must mandate Death Saving Throw choice');
assert.ok(dndDownPrompts.systemPrompt.includes('Cling desperately to consciousness'), 'Must mandate stabilization choice');

// 3d. D&D Conscious prompt
const dndConsciousPrompts = buildStage2CyoaPrompt({
    narrative: 'The dungeon corridor opens into a vaulted chamber.',
    memo: dndConsciousMemo,
    isPbta: false,
    rpgSettings: { cyoaConfig: { playstyle: 'cyoa_5' } },
});
assert.ok(!dndConsciousPrompts.systemPrompt.includes('THE PROTAGONIST IS DOWNED'), 'D&D conscious prompt must NOT contain downed mandate');
assert.ok(dndConsciousPrompts.systemPrompt.includes('D&D Tactical & Narrative Choices'), 'D&D conscious prompt must instruct tactical options');

console.log('✓ buildStage2CyoaPrompt dynamically adapts between PbtA and D&D and enforces downed mandates');

// ── 4. Extract and Repair Choices Markup ──
console.log('4. Testing extractCleanChoicesMarkup...');

// 4a. Clean <choices> block
const raw1 = `Here are the options:
<choices>
<button>1. ⚔️ Attack</button>
<button>2. 🏃 Flee</button>
<button>3. 💬 Talk</button>
</choices>`;
const ext1 = extractCleanChoicesMarkup(raw1);
assert.strictEqual(ext1, `<choices>\n<button>1. ⚔️ Attack</button>\n<button>2. 🏃 Flee</button>\n<button>3. 💬 Talk</button>\n</choices>`);

// 4b. Loose buttons without <choices>
const raw2 = `<button>1. Option A</button>\n<button>2. Option B</button>`;
const ext2 = extractCleanChoicesMarkup(raw2);
assert.strictEqual(ext2, `<choices>\n<button>1. Option A</button>\n<button>2. Option B</button>\n</choices>`);

// 4c. Plain numbered markdown list
const raw3 = `1. ⚔️ Strike with sword
2. 🛡️ Raise shield
3. 🏃 Fall back`;
const ext3 = extractCleanChoicesMarkup(raw3);
assert.ok(ext3.startsWith('<choices>'), 'Numbered markdown list must be wrapped into <choices>');
assert.ok(ext3.includes('<button>1. ⚔️ Strike with sword</button>'), 'Line 1 must be button tag');
assert.ok(ext3.includes('<button>2. 🛡️ Raise shield</button>'), 'Line 2 must be button tag');
assert.ok(ext3.includes('<button>3. 🏃 Fall back</button>'), 'Line 3 must be button tag');

console.log('✓ extractCleanChoicesMarkup extracts and repairs all choice formats');

// ── 5. Abort Lifecycle ──
console.log('5. Testing abortStage2Cyoa...');
assert.strictEqual(isStage2CyoaRunning(), false, 'Should be idle initially');
abortStage2Cyoa();
assert.strictEqual(isStage2CyoaRunning(), false, 'Should remain idle after abort');
console.log('✓ abortStage2Cyoa executes safely');

console.log('\n--- All Decoupled CYOA Engine tests PASSED! 🧭 ---');
