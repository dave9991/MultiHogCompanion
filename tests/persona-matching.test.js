import assert from 'node:assert';
import {
    getNameMatchingVariants,
    findMatchingPersona,
    extractNameFromMemo,
} from '../persona-matching.js';

console.log('--- Running Persona Matching & Quoted Nickname Test Suite ---');

// Test 1: getNameMatchingVariants
console.log('Testing getNameMatchingVariants with quoted nicknames and variations...');
const variants = getNameMatchingVariants('John "The axe" Smith');
assert.ok(variants.includes('john "the axe" smith'), 'Includes exact lowercase');
assert.ok(variants.includes('john the axe smith'), 'Includes quote-stripped variant (matching upstream behavior)');
assert.ok(variants.includes('john smith'), 'Includes nickname-stripped variant');

const smartVariants = getNameMatchingVariants('John “The axe” Smith');
assert.ok(smartVariants.includes('john "the axe" smith'), 'Converts smart curly quotes to straight quotes');
assert.ok(smartVariants.includes('john the axe smith'), 'Quote-strips smart quotes');
assert.ok(smartVariants.includes('john smith'), 'Strips smart-quoted nickname');

const parenVariants = getNameMatchingVariants('Ada (The Artificer)');
assert.ok(parenVariants.includes('ada'), 'Strips parenthetical nickname');

console.log('✓ getNameMatchingVariants produces accurate variants for quotes, smart quotes, and nicknames');

// Test 2: findMatchingPersona scenarios with provided personas map
console.log('Testing findMatchingPersona with personas map...');

const personasMap = {
    'avatar_upstream.png': 'John The axe Smith',      // Created by upstream DnD framework (quotes stripped)
    'avatar_simple.png': 'Jane Doe',
    'avatar_smart.png': 'Marcus “Ironhide” Vance',    // Created with smart quotes
    'avatar_base.png': 'William Tell',                 // Named without nickname
};

// Scenario A: PC with quoted nickname matching upstream quote-stripped persona
const matchUpstream = await findMatchingPersona('John "The axe" Smith', personasMap);
assert.ok(matchUpstream, 'Should find matching persona for John "The axe" Smith');
assert.strictEqual(matchUpstream.avatar, 'avatar_upstream.png');
assert.strictEqual(matchUpstream.name, 'John The axe Smith');
console.log('✓ Successfully matches PC with quoted nickname to upstream quote-stripped persona');

// Scenario B: PC with smart curly quotes matching upstream quote-stripped persona
const matchSmartPC = await findMatchingPersona('John “The axe” Smith', personasMap);
assert.ok(matchSmartPC, 'Should find matching persona for John “The axe” Smith');
assert.strictEqual(matchSmartPC.avatar, 'avatar_upstream.png');
console.log('✓ Successfully matches PC with smart curly quotes to upstream persona');

// Scenario C: Persona has smart quotes, PC has straight quotes
const matchSmartPersona = await findMatchingPersona('Marcus "Ironhide" Vance', personasMap);
assert.ok(matchSmartPersona, 'Should find matching persona for Marcus "Ironhide" Vance');
assert.strictEqual(matchSmartPersona.avatar, 'avatar_smart.png');
console.log('✓ Successfully matches straight-quoted PC to smart-quoted persona');

// Scenario D: PC has quoted nickname, Persona is just the base name (William Tell)
const matchBasePersona = await findMatchingPersona('William "Deadeye" Tell', personasMap);
assert.ok(matchBasePersona, 'Should match William "Deadeye" Tell to persona William Tell');
assert.strictEqual(matchBasePersona.avatar, 'avatar_base.png');
console.log('✓ Successfully matches quoted-nickname PC to base-name persona');

// Scenario E: Unrelated character returns null
const matchNone = await findMatchingPersona('Gandalf the Grey', personasMap);
assert.strictEqual(matchNone, null, 'Should return null for non-existent persona');
console.log('✓ Returns null safely when no matching persona exists');

// Test 3: extractNameFromMemo with memo variants
console.log('Testing extractNameFromMemo with various formatting edge cases...');

// 3a. Bulleted line with HP
const memoBullet = `[TIME] Day 1 [/TIME]\n[CHARACTER]\n- John "The axe" Smith: 20/20 HP | Harm: 0/5\n[/CHARACTER]`;
assert.strictEqual(extractNameFromMemo(memoBullet), 'John "The axe" Smith', 'Should strip bullet dash and extract quoted name');

// 3b. Name-only first line
const memoPlain = `[CHARACTER]\nJohn "The axe" Smith\n20/20 HP\n[/CHARACTER]`;
assert.strictEqual(extractNameFromMemo(memoPlain), 'John "The axe" Smith', 'Should extract name even without colon');

// 3c. HTML entities
const memoHtml = `[CHARACTER]\nJohn &quot;The axe&quot; Smith: 20/20 HP\n[/CHARACTER]`;
assert.strictEqual(extractNameFromMemo(memoHtml), 'John "The axe" Smith', 'Should decode HTML entities in name');

console.log('✓ extractNameFromMemo properly handles bullets, plain lines, and HTML entities');

console.log('--- ALL PERSONA MATCHING TESTS PASSED CLEANLY! ---');
