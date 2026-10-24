/**
 * cyoa-generator.test.js — MultiHog Companion
 *
 * Verifies the CYOA Standalone Choice Generator and Prompt Builder:
 * 1. Downed/incapacitated detection in PbtA (Max Harm / 0 HP) and D&D (0 HP / Dying).
 * 2. System-aware prompt generation (crisis survival moves vs tactical choices).
 * 3. Choice markup extraction, think block stripping, and resilient parsing.
 * 4. API response text extraction across reasoning models.
 * 5. Generation state, lifecycle, and abort handling.
 * 6. Dynamic context-aware token budgeting (resolveCyoaMaxTokens).
 */

import assert from 'node:assert';
import {
    isProtagonistDowned,
    buildCyoaPrompt,
    extractChoicesMarkup,
    abortCyoaGeneration,
    isCyoaGenerating,
    resolveCyoaMaxTokens,
    extractTextFromApiResponse,
} from '../cyoa-generator.js';
import { serializeDossierToMarkdown } from '../concierge-parser.js';

console.log('--- Testing CYOA Choice Generator Engine ---');

// ── 1. Downed/Incapacitated Protagonist Detection ──
console.log('1. Testing isProtagonistDowned...');

// PbtA Harm checking
const pbtaMemoMaxHarm = `
[CHARACTER]
Hero: 0/5 HP | Harm: 5/5
Status: Incapacitated
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(pbtaMemoMaxHarm, true), true, 'PbtA character with Harm: 5/5 must be detected as downed');

const pbtaMemoHealthy = `
[CHARACTER]
Hero: 5/5 HP | Harm: 0/5
Status: Healthy
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(pbtaMemoHealthy, true), false, 'Healthy PbtA character must NOT be detected as downed');

const pbtaMemoTandemZeroHp = `
[CHARACTER]
Hero: 0/5 HP | Harm: 3/5
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(pbtaMemoTandemZeroHp, true), true, 'PbtA character with 0 HP must be detected as downed');

// D&D 5e HP checking
const dndMemoZeroHp = `
[CHARACTER]
Kaelen: 0/32 HP | AC: 16
Status: Unconscious
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(dndMemoZeroHp, false), true, 'D&D character with 0/32 HP must be detected as downed');

const dndMemoHealthy = `
[CHARACTER]
Kaelen: 24/32 HP | AC: 16
Status: Normal
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(dndMemoHealthy, false), false, 'Healthy D&D character must NOT be detected as downed');

// Status keywords
const statusDyingMemo = `
[CHARACTER]
Name: Roger
Status: Mortally Wounded
[/CHARACTER]
`;
assert.strictEqual(isProtagonistDowned(statusDyingMemo, false), true, 'Status keyword "Mortally Wounded" must indicate downed');

// Enemy downed should NOT down the protagonist
const enemyDownedMemo = `
[CHARACTER]
Hero: 20/20 HP | Harm: 0/5
Status: Healthy
[/CHARACTER]
[ENEMIES]
Goblin: 0/7 HP
Status: Incapacitated
[/ENEMIES]
`;
assert.strictEqual(isProtagonistDowned(enemyDownedMemo, true), false, 'Enemy at 0 HP must NOT cause protagonist to be marked downed');

console.log('✓ isProtagonistDowned accurately detects downed states across both PbtA and D&D');

// ── 2. Prompt Construction ──
console.log('2. Testing buildCyoaPrompt...');

// Test 2a: Healthy PbtA Character
const healthyPbtaPrompt = buildCyoaPrompt({
    narrative: 'The goblin chieftain snarls and swings his heavy morningstar at you.',
    memo: '[CHARACTER]\nHero: 5/5 HP | Harm: 0/5\n[/CHARACTER]',
    isPbta: true,
    rpgSettings: {
        pbtaGenre: 'fantasy',
        cyoaConfig: { playstyle: 'cyoa_5', cyoaEmojis: true },
    },
});
assert.ok(healthyPbtaPrompt.systemPrompt.includes('Powered by the Apocalypse'), 'System prompt must identify PbtA ruleset');
assert.ok(healthyPbtaPrompt.systemPrompt.includes('NO D&D MECHANICS:'), 'System prompt must ban D&D mechanics');
assert.ok(healthyPbtaPrompt.systemPrompt.includes('Prefix each choice option with an appropriate thematic emoji'), 'Emoji rule must be present when cyoaEmojis=true');
assert.ok(healthyPbtaPrompt.userPrompt.includes('The goblin chieftain snarls'), 'User prompt must include narrative beat');
assert.ok(!healthyPbtaPrompt.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED'), 'Healthy prompt must NOT contain Downed mandate');

// Test 2b: Downed PbtA Character (Crisis choices mandatory)
const downedPbtaPrompt = buildCyoaPrompt({
    narrative: 'The blow crushes your armor. You collapse into the cold mud, vision fading.',
    memo: '[CHARACTER]\nHero: 0/5 HP | Harm: 5/5\nStatus: Mortally Wounded\n[/CHARACTER]',
    isPbta: true,
    rpgSettings: {
        pbtaGenre: 'fantasy',
        cyoaConfig: { playstyle: 'cyoa_3', cyoaEmojis: true },
    },
});
assert.ok(downedPbtaPrompt.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / INCAPACITATED'), 'Downed character MUST receive crisis mandate');
assert.ok(downedPbtaPrompt.systemPrompt.includes('CLING TO LIFE / LAST BREATH'), 'Must mandate clinging to life');
assert.ok(downedPbtaPrompt.systemPrompt.includes('FAINT PLEA / CALL FOR AID'), 'Must mandate faint plea or call for aid');
assert.ok(downedPbtaPrompt.systemPrompt.includes('DESPERATE SACRIFICE / GAMBIT'), 'Must mandate desperate gamble');
assert.ok(downedPbtaPrompt.systemPrompt.includes('DO NOT offer standard physical attacks'), 'Must ban normal attacks while downed');

// Test 2c: D&D 5e Downed Character (Death Saves mandatory)
const downedDndPrompt = buildCyoaPrompt({
    narrative: 'The dragon breath incinerates the barrier. You fall unconscious to the flagstones.',
    memo: '[CHARACTER]\nKaelen: 0/45 HP\nStatus: Unconscious\n[/CHARACTER]',
    isPbta: false,
    rpgSettings: {
        cyoaConfig: { playstyle: 'cyoa_5', cyoaEmojis: true },
    },
});
assert.ok(downedDndPrompt.systemPrompt.includes('CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / UNCONSCIOUS'), 'D&D downed character MUST receive Death Save mandate');
assert.ok(downedDndPrompt.systemPrompt.includes('Roll Death Saving Throw'), 'Must mandate Death Saving Throw');

console.log('✓ buildCyoaPrompt dynamically adapts between PbtA and D&D and enforces downed mandates');

// ── 3. Choice Extraction & Resilient Parsing ──
console.log('3. Testing extractChoicesMarkup...');

// 3a. Clean XML choices
const cleanXml = `<choices>
<button>1. ⚔️ Attack the chieftain</button>
<button>2. 🛡️ Raise shield</button>
<button>3. 🏃 Retreat</button>
</choices>`;
const resXml = extractChoicesMarkup(cleanXml);
assert.ok(resXml.includes('<choices>'), 'Must extract clean choices block');
assert.ok(resXml.includes('<button>1. ⚔️ Attack the chieftain</button>'), 'Must preserve button tags');

// 3b. Reasoning/thinking tokens stripped before choices
const reasoningOutput = `<think>
The player is fighting a goblin. They should have aggressive, defensive, and tactical options.
</think>
<choices>
<button>1. ⚔️ Strike with dagger</button>
<button>2. 🛡️ Parry</button>
<button>3. 🔍 Scan exit</button>
</choices>`;
const resReasoning = extractChoicesMarkup(reasoningOutput);
assert.ok(!resReasoning.includes('<think>'), 'Must strip <think> tag');
assert.ok(!resReasoning.includes('The player is fighting'), 'Must strip thinking content');
assert.ok(resReasoning.includes('<button>1. ⚔️ Strike with dagger</button>'), 'Must preserve choices after thinking tokens');

// 3c. Unclosed thinking block containing choices
const unclosedThinkWithChoices = `<think>
Thinking...
<choices>
<button>1. ⚔️ Attack</button>
<button>2. 🏃 Flee</button>
</choices>`;
const resUnclosed = extractChoicesMarkup(unclosedThinkWithChoices);
assert.ok(resUnclosed.includes('<choices>'), 'Must salvage choices even from unclosed think block');
assert.ok(resUnclosed.includes('<button>1. ⚔️ Attack</button>'));

// 3c2. Alternative thinking tags (<thinking>, <reasoning>, <thought>)
const altThinkingCyoa = `<thinking>
Evaluating tactical positioning...
</thinking>
<reasoning>
Need 3 viable moves.
</reasoning>
<choices>
<button>1. ⚔️ Flank enemy</button>
<button>2. 🛡️ Take cover</button>
</choices>`;
const resAltThinking = extractChoicesMarkup(altThinkingCyoa);
assert.ok(!resAltThinking.includes('<thinking>') && !resAltThinking.includes('<reasoning>'), 'Must strip <thinking> and <reasoning> tags');
assert.ok(!resAltThinking.includes('Evaluating tactical positioning'), 'Must strip thinking content');
assert.ok(resAltThinking.includes('<button>1. ⚔️ Flank enemy</button>'), 'Must preserve choices');

// 3d. Markdown numbered list repair
const markdownList = `
Here are the choices:
1. ⚔️ Strike the chieftain with your warhammer
2. 🛡️ Dodge beneath the morningstar swing
3. 💬 "Yield now and I will spare your clan!"
`;
const resMarkdown = extractChoicesMarkup(markdownList);
assert.ok(resMarkdown.includes('<choices>'), 'Must convert markdown list into <choices>');
assert.ok(resMarkdown.includes('<button>1. ⚔️ Strike the chieftain with your warhammer</button>'), 'Must wrap line 1 in button tag');
assert.ok(resMarkdown.includes('<button>2. 🛡️ Dodge beneath the morningstar swing</button>'), 'Must wrap line 2 in button tag');

// 3e. Bulleted list repair
const bulletList = `
- ⚔️ Strike the chieftain
- 🛡️ Raise shield
- 🏃 Fall back to the archway
`;
const resBullet = extractChoicesMarkup(bulletList);
assert.ok(resBullet.includes('<choices>'), 'Must convert bullet list into <choices>');
assert.ok(resBullet.includes('<button>1. ⚔️ Strike the chieftain</button>'), 'Must auto-number bullet 1');

// 3f. Markdown code fences
const fencedXml = `\`\`\`xml
<choices>
<button>1. ⚔️ Attack</button>
<button>2. 🏃 Run</button>
</choices>
\`\`\``;
const resFenced = extractChoicesMarkup(fencedXml);
assert.ok(!resFenced.includes('```'), 'Must strip code fences');
assert.ok(resFenced.includes('<choices>'));

console.log('✓ extractChoicesMarkup extracts and repairs all choice formats (including unclosed, bullets, thinking tokens, and XML fences)');

// ── 4. API Response Extraction ──
console.log('4. Testing extractTextFromApiResponse...');

// OpenAI chat format
const oaiResponse = {
    choices: [
        {
            message: {
                role: 'assistant',
                content: '<choices><button>1. One</button><button>2. Two</button></choices>',
            },
        },
    ],
};
assert.strictEqual(
    extractTextFromApiResponse(oaiResponse),
    '<choices><button>1. One</button><button>2. Two</button></choices>',
    'Must extract content from standard OpenAI choices[0].message.content'
);

// Reasoning-only model format (o1 / DeepSeek R1)
const reasoningOnlyResponse = {
    choices: [
        {
            message: {
                role: 'assistant',
                content: '',
                reasoning_content: '<choices><button>1. Reasoning Choice</button><button>2. Option</button></choices>',
            },
        },
    ],
};
assert.strictEqual(
    extractTextFromApiResponse(reasoningOnlyResponse),
    '<choices><button>1. Reasoning Choice</button><button>2. Option</button></choices>',
    'Must extract choices from reasoning_content when content is empty'
);

console.log('✓ extractTextFromApiResponse cleanly handles standard, reasoning-only, and hybrid responses');

// ── 5. Abort and Lifecycle ──
console.log('5. Testing abortCyoaGeneration...');
assert.strictEqual(isCyoaGenerating(), false, 'isCyoaGenerating should initially be false');
abortCyoaGeneration('test_abort');
assert.strictEqual(isCyoaGenerating(), false, 'isCyoaGenerating must remain false after abort');
console.log('✓ abortCyoaGeneration executes safely');

// ── 6. Fast Pipeline & Context Integration ──
console.log('6. Testing Fast Pipelined prompt guidelines...');
const fastPipelinePrompt = buildCyoaPrompt({
    narrative: 'The goblin slashes your arm as you stumble.',
    memo: '[CHARACTER]\nHero: 5/5 HP | Harm: 0/5\n[/CHARACTER]',
    isPbta: true,
    rpgSettings: {
        pbtaGenre: 'fantasy',
        enableFastPipeline: true,
    },
});
assert.ok(fastPipelinePrompt.userPrompt.includes('Turn-Start Baseline'), 'Fast pipeline must label memo as Turn-Start Baseline');
assert.ok(fastPipelinePrompt.userPrompt.includes('IMMEDIATE TACTICAL SITUATION & NARRATIVE DELTA'), 'Fast pipeline must include tactical situation delta');
console.log('✓ Fast Pipelined prompt synthesis verified');

// ── 7. Dynamic Context Headroom ──
console.log('7. Testing resolveCyoaMaxTokens Dynamic Context Headroom...');
const mockCtxLarge = {
    mainApi: 'openai',
    chatCompletionSettings: { openai_max_context: 16384 },
};
const largeBudget = resolveCyoaMaxTokens({
    context: mockCtxLarge,
    messages: [{ role: 'user', content: 'Short prompt' }],
});
assert.ok(largeBudget >= 4096, `Budget for 16k context must provide reasoning headroom (got ${largeBudget})`);

const explicitBudget = resolveCyoaMaxTokens({
    rpgSettings: { cyoaMaxTokens: 750 },
    context: mockCtxLarge,
});
assert.strictEqual(explicitBudget, 750, 'Explicit cyoaMaxTokens must override auto context budget');
console.log('✓ resolveCyoaMaxTokens dynamically scales context headroom and honors user overrides');

// ── 8. Serialization Exclusion for World Info ──
console.log('8. Testing serializeDossierToMarkdown with includeCyoa: false for World Info...');
const testDossierWithCyoa = {
    meta: { title: 'Test Adventure', premise: 'A deep quest' },
    protagonist: { name: 'Aelion', stats: { Might: 2, Wits: 1 } },
    theKick: { startingLocation: 'Gate', crisis: 'Threat', openingPrompt: 'You arrive.' },
    cyoaExamples: [
        '1. ⚔️ Strike with blade — [Hack & Slash (+Might)]',
        '2. 🔍 Investigate the rune — [Discern Realities (+Wits)]',
    ],
    config: { playstyle: 'cyoa_5', harmMax: 5 },
};

const fullSerializedMd = serializeDossierToMarkdown(testDossierWithCyoa, { includeCyoa: true });
assert.ok(fullSerializedMd.includes('Tailored CYOA Move Choices'), 'Standard serialization must include CYOA choices');

const wiMarkdown = serializeDossierToMarkdown(testDossierWithCyoa, { includeCyoa: false });
assert.ok(!wiMarkdown.includes('Tailored CYOA Move Choices'), 'World Info serialization must omit CYOA block');
assert.ok(!wiMarkdown.includes('Hack & Slash'), 'World Info must not contain CYOA choice content');
assert.ok(wiMarkdown.includes('Aelion'), 'World Info serialization must keep protagonist');
console.log('✓ World Info dossier serialization cleanly excludes CYOA choices');

console.log('\n--- All CYOA Choice Generator Engine tests PASSED! 🧭 ---');
