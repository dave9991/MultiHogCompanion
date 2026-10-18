import assert from 'node:assert';
import {
    isValidCharacterName,
    extractNameFromBio,
    sanitizeCharacterStockPrompt,
    rectifyMemoCharacterName,
    determineEffectiveCharacterName,
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

console.log('--- ALL CHARACTER CREATOR SANITIZER TESTS PASSED CLEANLY! ---');
