import assert from 'node:assert';
import {
    isValidCharacterName,
    extractNameFromBio,
    sanitizeCharacterStockPrompt,
    rectifyMemoCharacterName,
    determineEffectiveCharacterName,
    sanitizeInstructionMacroLiterals,
    sanitizeRawGenerationArgs,
    installMacroSyntaxSanitizer,
} from '../character-creator-sanitizer.js';

console.log('--- Running Character Creator Sanitizer Test Suite ---');

// 1. isValidCharacterName tests
console.log('Testing isValidCharacterName...');
assert.strictEqual(isValidCharacterName('{{user}}'), false, 'Rejects {{user}}');
assert.strictEqual(isValidCharacterName('{{char}}'), false, 'Rejects {{char}}');
assert.strictEqual(isValidCharacterName('{user}'), false, 'Rejects {user}');
assert.strictEqual(isValidCharacterName('{char}'), false, 'Rejects {char}');
assert.strictEqual(isValidCharacterName('user'), false, 'Rejects user');
assert.strictEqual(isValidCharacterName('User'), false, 'Rejects User');
assert.strictEqual(isValidCharacterName('name'), false, 'Rejects name');
assert.strictEqual(isValidCharacterName('Character'), false, 'Rejects Character');
assert.strictEqual(isValidCharacterName('player'), false, 'Rejects player');
assert.strictEqual(isValidCharacterName('My Character'), false, 'Rejects My Character');
assert.strictEqual(isValidCharacterName(''), false, 'Rejects empty');
assert.strictEqual(isValidCharacterName('a'), false, 'Rejects single character');
assert.strictEqual(isValidCharacterName('Edmund Wilson'), true, 'Accepts Edmund Wilson');
assert.strictEqual(isValidCharacterName('John "The axe" Smith'), true, 'Accepts John "The axe" Smith');
assert.strictEqual(isValidCharacterName('Valerius Thorne'), true, 'Accepts Valerius Thorne');
console.log('✓ isValidCharacterName properly identifies valid vs macro/placeholder names');

// 2. extractNameFromBio tests
console.log('Testing extractNameFromBio...');
const bio1 = `Species:\nEdmund Wilson is a human.\n\nBody:\nWiry, agile frame for tight spaces.`;
assert.strictEqual(extractNameFromBio(bio1), 'Edmund Wilson', 'Extracts name from Species line');

const bio2 = `Species: Valerius Thorne is a human wizard.\nBody: Lean build.`;
assert.strictEqual(extractNameFromBio(bio2), 'Valerius Thorne', 'Extracts name from inline Species');

const bio3 = `Background:\nA seasoned detective working the beat.`;
assert.strictEqual(extractNameFromBio(bio3), null, 'Returns null when no name is present');
console.log('✓ extractNameFromBio accurately parses protagonist names');

// 3. sanitizeCharacterStockPrompt tests
console.log('Testing sanitizeCharacterStockPrompt...');
const prompts1 = {
    character: `[CHARACTER]\n{{user}} (Class): current/max HP\nCombat: BAB...`,
};
const mod1 = sanitizeCharacterStockPrompt(prompts1, 'Edmund Wilson');
assert.strictEqual(mod1, true, 'Returns true when modified');
assert.ok(prompts1.character.includes('Edmund Wilson (Class): current/max HP'), 'Replaced {{user}} with target name');
assert.ok(!prompts1.character.includes('{{user}}'), 'No {{user}} remaining');

const prompts2 = {
    character: `[CHARACTER]\n{{user}} (Class): current/max HP`,
};
sanitizeCharacterStockPrompt(prompts2, '');
assert.ok(prompts2.character.includes('Character Name (Class): current/max HP'), 'Falls back to Character Name placeholder');
console.log('✓ sanitizeCharacterStockPrompt cleanses stock prompts without leaving macros');

// 4. rectifyMemoCharacterName tests
console.log('Testing rectifyMemoCharacterName...');
const corruptMemo = `[CHARACTER]
{{user}} (Cyber-Salvager): 8/8 HP
Combat: BAB: +1
[/CHARACTER]`;
const rectified = rectifyMemoCharacterName(corruptMemo, 'Edmund Wilson');
assert.ok(rectified.includes('[CHARACTER]\nEdmund Wilson (Cyber-Salvager): 8/8 HP'), 'Rectifies {{user}} to Edmund Wilson');
assert.ok(!rectified.includes('{{user}}'), 'No {{user}} in rectified memo');

const genericMemo = `[CHARACTER]
User (Warrior): 10/10 HP
[/CHARACTER]`;
const rectifiedUser = rectifyMemoCharacterName(genericMemo, 'Conan');
assert.ok(rectifiedUser.includes('[CHARACTER]\nConan (Warrior): 10/10 HP'), 'Rectifies User to Conan');
console.log('✓ rectifyMemoCharacterName repairs corrupted memos');

// 5. determineEffectiveCharacterName tests
console.log('Testing determineEffectiveCharacterName...');
const ctxDraft = {
    draft: { name: 'Edmund Wilson' },
    playerCharacter: { name: '{{user}}', bio: 'Species:\nEdmund Wilson is a human.' },
    memo: corruptMemo,
};
assert.strictEqual(determineEffectiveCharacterName(ctxDraft), 'Edmund Wilson', 'Prefers draft name when valid');

const ctxBioOnly = {
    draft: null,
    playerCharacter: { name: '{{user}}', bio: 'Species:\nEdmund Wilson is a human.' },
    memo: corruptMemo,
};
assert.strictEqual(determineEffectiveCharacterName(ctxBioOnly), 'Edmund Wilson', 'Recovers name from bio when draft is absent');

console.log('✓ determineEffectiveCharacterName robustly identifies the true character name');

// 6. sanitizeInstructionMacroLiterals & ADR-MP-07 tests
console.log('Testing sanitizeInstructionMacroLiterals & installMacroSyntaxSanitizer...');
const canonicalRule1 = '- CRITICAL: Never output template macro strings such as {{char}}, {{user}}, or any other {{...}} placeholders. Always replace them with the actual character name or a fitting proper name.';
const cleanedRule1 = sanitizeInstructionMacroLiterals(canonicalRule1);
assert.strictEqual(/\{\{(?!\u200B)/.test(cleanedRule1), false, 'Neutralizes all raw macros in canonical anti-macro instruction');
assert.ok(cleanedRule1.includes('{\u200B{char}\u200B}'), 'Escaped {{char}} with zero-width space');
assert.ok(cleanedRule1.includes('{\u200B{user}\u200B}'), 'Escaped {{user}} with zero-width space');
assert.ok(cleanedRule1.includes('{\u200B{...}\u200B}'), 'Escaped {{...}} with zero-width space');

const transcriptionRule = '  b) Replace every literal occurrence of {{char}} or {{Char}} in the text with the character actual name: Eldrin. This is mandatory.';
const cleanedTrans = sanitizeInstructionMacroLiterals(transcriptionRule);
assert.strictEqual(/\{\{(?!\u200B)/.test(cleanedTrans), false, 'Neutralizes raw macros in literal transcription instructions');

const substitutionRule = '- If the card fits the setting fine (other than the {{char}} substitution), output it almost completely unchanged.';
const cleanedSub = sanitizeInstructionMacroLiterals(substitutionRule);
assert.strictEqual(/\{\{(?!\u200B)/.test(cleanedSub), false, 'Neutralizes raw macros in substitution mention');

const rawEllipsisOnly = 'Some system text with {{...}} in it';
assert.ok(sanitizeInstructionMacroLiterals(rawEllipsisOnly).includes('{\u200B{...}\u200B}'), 'Neutralizes standalone illegal {{...}}');

// Verify legitimate macros are NOT modified if not part of meta-instructions
const legitimatePrompt = 'Character name is {{char}} and user is {{user}}. Output description.';
assert.strictEqual(sanitizeInstructionMacroLiterals(legitimatePrompt), legitimatePrompt, 'Preserves legitimate macros in standard generation prompts');

// Verify sanitizeRawGenerationArgs
const argsObj = {
    systemPrompt: canonicalRule1,
    prompt: 'Prompt body with {{...}} placeholder',
    responseLength: 500,
};
const sanitizedArgs = sanitizeRawGenerationArgs(argsObj);
assert.strictEqual(/\{\{(?!\u200B)/.test(sanitizedArgs.systemPrompt), false, 'Sanitizes systemPrompt in args object');
assert.strictEqual(/\{\{(?!\u200B)/.test(sanitizedArgs.prompt), false, 'Sanitizes prompt in args object');
assert.strictEqual(sanitizedArgs.responseLength, 500, 'Preserves other arguments');

// Verify installMacroSyntaxSanitizer wraps getContext cleanly
let calledGenerateRaw = false;
const mockSillyTavern = {
    getContext: () => ({
        generateRaw: async (args) => {
            calledGenerateRaw = true;
            assert.strictEqual(/\{\{(?!\u200B)/.test(args.systemPrompt), false, 'generateRaw receives sanitized systemPrompt');
            return 'OK';
        },
        generateRawData: async (args) => {
            return { choices: [{ message: { content: 'OK' } }] };
        },
    }),
};
globalThis.SillyTavern = mockSillyTavern;
assert.strictEqual(installMacroSyntaxSanitizer(), true, 'Installs macro syntax sanitizer');
const ctx = globalThis.SillyTavern.getContext();
await ctx.generateRaw({ systemPrompt: canonicalRule1 });
assert.strictEqual(calledGenerateRaw, true, 'Wrapped generateRaw was called and intercepted');
console.log('✓ sanitizeInstructionMacroLiterals and ADR-MP-07 runtime interception verified cleanly');

console.log('--- ALL CHARACTER CREATOR SANITIZER TESTS PASSED CLEANLY! ---');
