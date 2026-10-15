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
    resolveCyoaMaxTokens,
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

// 4d. <choices> block with numbered text but NO <button> tags
const raw4 = `<choices>
1. ⚔️ Attack the sentry
2. 💬 "We don't have to fight."
3. 🏃 Run for the treeline
</choices>`;
const ext4 = extractCleanChoicesMarkup(raw4);
assert.ok(ext4.startsWith('<choices>'), '<choices> with plain numbers must be parsed');
assert.ok(ext4.includes('<button>1. ⚔️ Attack the sentry</button>'));
assert.ok(ext4.includes('<button>2. 💬 "We don\'t have to fight."</button>'));
assert.ok(ext4.includes('<button>3. 🏃 Run for the treeline</button>'));

// 4e. Unclosed <choices> and unclosed <button> tags
const raw5 = `<choices>
<button>1. ⚔️ Strike with blade
<button>2. 🛡️ Raise shield
<button>3. 🏃 Fall back`;
const ext5 = extractCleanChoicesMarkup(raw5);
assert.ok(ext5.startsWith('<choices>'), 'Unclosed choices and buttons must be recovered');
assert.ok(ext5.includes('<button>1. ⚔️ Strike with blade</button>'));
assert.ok(ext5.includes('<button>2. 🛡️ Raise shield</button>'));
assert.ok(ext5.includes('<button>3. 🏃 Fall back</button>'));

// 4f. <choice> or <option> tags
const raw6 = `<choices>
<choice>1. First choice</choice>
<choice>2. Second choice</choice>
</choices>`;
const ext6 = extractCleanChoicesMarkup(raw6);
assert.ok(ext6.includes('<button>1. First choice</button>'));
assert.ok(ext6.includes('<button>2. Second choice</button>'));

// 4g. Bullet list (-, •)
const raw7 = `<choices>
• ⚔️ Charge head-on
• 💬 Demand surrender
• 🏃 Retreat
</choices>`;
const ext7 = extractCleanChoicesMarkup(raw7);
assert.ok(ext7.includes('<button>1. ⚔️ Charge head-on</button>'));
assert.ok(ext7.includes('<button>2. 💬 Demand surrender</button>'));
assert.ok(ext7.includes('<button>3. 🏃 Retreat</button>'));

// 4h. Reasoning model output with <think>...</think>
const raw8 = `<think>
The character is at full health and in a dark cavern.
I should give them combat, stealth, and observation options.
</think>
<choices>
<button>1. ⚔️ Draw weapon</button>
<button>2. 🔍 Look closer</button>
</choices>`;
const ext8 = extractCleanChoicesMarkup(raw8);
assert.strictEqual(ext8, `<choices>\n<button>1. ⚔️ Draw weapon</button>\n<button>2. 🔍 Look closer</button>\n</choices>`);
assert.ok(!ext8.includes('<think>'), 'Thinking tokens must be stripped');

// 4i. Markdown fenced code block
const raw9 = `\`\`\`xml
<choices>
<button>1. Option Alpha</button>
<button>2. Option Beta</button>
</choices>
\`\`\``;
const ext9 = extractCleanChoicesMarkup(raw9);
assert.strictEqual(ext9, `<choices>\n<button>1. Option Alpha</button>\n<button>2. Option Beta</button>\n</choices>`);

// 4j. Reasoning model with unclosed <think> tag
const raw10 = `<think>
Formulating tactical options...
<choices>
<button>1. ⚔️ Option 1</button>
<button>2. 🛡️ Option 2</button>
</choices>`;
const ext10 = extractCleanChoicesMarkup(raw10);
assert.ok(ext10.includes('<button>1. ⚔️ Option 1</button>'));
assert.ok(ext10.includes('<button>2. 🛡️ Option 2</button>'));

console.log('✓ extractCleanChoicesMarkup extracts and repairs all choice formats (including unclosed, bullets, thinking tokens, and XML fences)');

// ── 5. extractTextFromApiResponse (Reasoning Model & Multi-Provider Support) ──
console.log('5. Testing extractTextFromApiResponse...');
const { extractTextFromApiResponse } = await import('../concierge-connection.js');

// Standard OpenAI format
const standardResp = {
    choices: [{ message: { content: '<choices><button>1. Test</button></choices>' } }]
};
assert.strictEqual(extractTextFromApiResponse(standardResp), '<choices><button>1. Test</button></choices>');

// Reasoning model where content is empty and choices are in reasoning_content
const reasoningOnlyResp = {
    choices: [{
        message: {
            content: '',
            reasoning_content: '<think>Let me formulate choices</think><choices><button>1. Sneak past</button></choices>'
        }
    }]
};
assert.ok(extractTextFromApiResponse(reasoningOnlyResp).includes('<button>1. Sneak past</button>'));

// Reasoning model where content has choices and reasoning has thoughts
const bothResp = {
    choices: [{
        message: {
            content: '<choices><button>1. Action A</button></choices>',
            reasoning_content: 'Analyzing scene context...'
        }
    }]
};
assert.strictEqual(extractTextFromApiResponse(bothResp), '<choices><button>1. Action A</button></choices>');

console.log('✓ extractTextFromApiResponse cleanly handles standard, reasoning-only, and hybrid responses');

// ── 6. Abort Lifecycle ──
console.log('6. Testing abortStage2Cyoa...');
assert.strictEqual(isStage2CyoaRunning(), false, 'Should be idle initially');
abortStage2Cyoa();
assert.strictEqual(isStage2CyoaRunning(), false, 'Should remain idle after abort');
console.log('✓ abortStage2Cyoa executes safely');

// ── 7. Fast Pipelined CYOA & Narrative Downed Detection ──
console.log('7. Testing Fast Pipelined CYOA & Narrative Downed Detection...');
const { isNarrativeDowned } = await import('../cyoa-decoupled-runner.js');

// Narrative Downed
assert.strictEqual(isNarrativeDowned('The troll strikes you hard. You collapse to the floor unconscious.'), true);
assert.strictEqual(isNarrativeDowned('The blast hits you, and your vision fades to black as you hit the wall.'), true);
assert.strictEqual(isNarrativeDowned('The enemy slashes your shield, leaving a deep gouge.'), false);

// isProtagonistDowned with narrative integration
const healthyMemo = `[CHARACTER]\nName: Silas\nHP: 24/24\n[/CHARACTER]`;
assert.strictEqual(isProtagonistDowned(healthyMemo, false, 'You collapse to the ground senseless.'), true, 'Narrative downed must override healthy memo');
assert.strictEqual(isProtagonistDowned(healthyMemo, false, 'You parry the blow and step back.'), false, 'Healthy memo + healthy narrative must remain not downed');

// Fast Pipelined Prompt Synthesis
const fastPrompt = buildStage2CyoaPrompt({
    narrative: 'The archers fire a volley. You dive behind a cart for cover.',
    memo: healthyMemo,
    isPbta: false,
    rpgSettings: { enableFastPipeline: true },
});
assert.ok(fastPrompt.userPrompt.includes('### IMMEDIATE TACTICAL SITUATION & NARRATIVE DELTA:'), 'Fast mode prompt must include narrative delta instructions');
assert.ok(fastPrompt.userPrompt.includes('Turn-Start Baseline'), 'Fast mode prompt must designate baseline memo');

// Legacy Sequential Prompt (when fast pipeline is explicitly disabled)
const legacyPrompt = buildStage2CyoaPrompt({
    narrative: 'The archers fire a volley.',
    memo: healthyMemo,
    isPbta: false,
    rpgSettings: { enableFastPipeline: false },
});
assert.ok(!legacyPrompt.userPrompt.includes('IMMEDIATE TACTICAL SITUATION & NARRATIVE DELTA'), 'Legacy mode must not include delta instructions');

// Narrative Downed prompts generate Downed mandate even with healthy memo
const downedPrompt = buildStage2CyoaPrompt({
    narrative: 'The blow is fatal. You fall unconscious onto the stone floor.',
    memo: healthyMemo,
    isPbta: false,
    rpgSettings: { enableFastPipeline: true },
});
assert.ok(downedPrompt.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED'), 'Narrative downed must mandate survival choices');
console.log('✓ Fast Pipelined prompt synthesis and narrative downed detection verified');

// ── 8. Dynamic Context Budget (resolveCyoaMaxTokens) ──
console.log('8. Testing resolveCyoaMaxTokens Dynamic Context Headroom...');

const sampleMessages = [
    { role: 'system', content: 'You are the tactical CYOA engine. Generate choices.' },
    { role: 'user', content: 'The dragon breathes fire across the courtyard. What do you do?' },
];

// 8a. User configuration matching current setup: 128k context with 100k response token limit
const user128kContext = {
    mainApi: 'openai',
    chatCompletionSettings: {
        openai_max_context: 131072,
        openai_max_tokens: 100000,
    },
};
const user128kTokens = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: user128kContext,
});
assert.strictEqual(user128kTokens, 100000, 'Must provide full 100k response headroom when configured in OpenAI settings');

// 8b. 128k context without response token clamp (dynamic context calculation)
const raw128kContext = {
    mainApi: 'openai',
    chatCompletionSettings: {
        openai_max_context: 131072,
    },
};
const raw128kTokens = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: raw128kContext,
});
assert.ok(raw128kTokens > 125000, `Expected > 125,000 tokens for 128k context, got ${raw128kTokens}`);

// 8c. 32k context model (e.g. Qwen 2.5 32k, Command-R)
const context32k = {
    mainApi: 'textgenerationwebui',
    maxContext: 32768,
};
const tokens32k = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: context32k,
});
assert.ok(tokens32k > 30000 && tokens32k < 32768, `Expected ~31,000 tokens for 32k context, got ${tokens32k}`);

// 8d. 8k context model (standard 8192 context window)
const context8k = {
    mainApi: 'kobold',
    maxContext: 8192,
};
const tokens8k = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: context8k,
});
assert.ok(tokens8k >= 4096 && tokens8k < 8192, `Expected 4k-8k tokens for 8k context, got ${tokens8k}`);

// 8e. Small response length on main chat (e.g. amount_gen = 350 or openai_max_tokens = 400)
// Must NOT choke the reasoning headroom for Stage 2 CYOA
const shortTurnContext = {
    mainApi: 'openai',
    chatCompletionSettings: {
        openai_max_context: 8192,
        openai_max_tokens: 350, // Short chat reply setting
    },
};
const tokensWithShortChat = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: shortTurnContext,
});
assert.ok(tokensWithShortChat >= 4096, `CYOA budget (${tokensWithShortChat}) must preserve full reasoning headroom even if chat reply is 350`);

// 8f. Explicit user override in rpgSettings
const explicitOverrideTokens = resolveCyoaMaxTokens({
    rpgSettings: { cyoaMaxTokens: 16384 },
    messages: sampleMessages,
    context: context8k,
});
assert.strictEqual(explicitOverrideTokens, 16384, 'Explicit user override in rpgSettings must take precedence');

// 8g. Explicit user override in Companion extension settings
const companionOverrideContext = {
    mainApi: 'openai',
    extensionSettings: {
        multihog_companion: { cyoaMaxTokens: 12000 },
    },
};
const companionOverrideTokens = resolveCyoaMaxTokens({
    messages: sampleMessages,
    context: companionOverrideContext,
});
assert.strictEqual(companionOverrideTokens, 12000, 'Explicit user override in companionSettings must be honored');

// 8h. Dedicated non-default connection endpoint (e.g. secondary Ollama profile with explicit maxTokens)
const dedicatedConn = {
    connectionSource: 'ollama',
    maxTokens: 6000,
};
const dedicatedTokens = resolveCyoaMaxTokens({
    connSettings: dedicatedConn,
    messages: sampleMessages,
    context: context8k,
});
assert.strictEqual(dedicatedTokens, 6000, 'Dedicated endpoint maxTokens must be respected');

console.log('✓ resolveCyoaMaxTokens dynamically scales context headroom for 4k/8k+ reasoning models and honors user overrides');

console.log('\n--- All Decoupled CYOA Engine tests PASSED! 🧭 ---');



