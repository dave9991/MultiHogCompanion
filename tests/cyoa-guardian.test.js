/**
 * MultiHog Companion - CYOA Guardian Test Suite
 *
 * Verifies choice detection, markdown auto-repair, steering prompt construction,
 * prompt injection, and engine rules for both D&D 5e and PbtA adventures.
 */

import assert from 'node:assert';
import {
    isCyoaExpected,
    hasCyoaChoices,
    tryRepairMarkdownChoices,
    armCyoaSteeringReminder,
    interceptCyoaSteering,
} from '../cyoa-guardian.js';

console.log('--- Running CYOA Guardian Test Suite ---');

// ── 1. Engine Expectation Checks (D&D 5e vs PbtA) ───────────────────────────

// D&D 5e checks
assert.strictEqual(
    isCyoaExpected({ enabled: true, syspromptModules: { CYOA_mode: true } }, false),
    true,
    'D&D with CYOA_mode=true should expect CYOA'
);

assert.strictEqual(
    isCyoaExpected({ enabled: true, syspromptModules: { CYOA_mode: false } }, false),
    false,
    'D&D with CYOA_mode=false should not expect CYOA'
);

assert.strictEqual(
    isCyoaExpected({ enabled: false, syspromptModules: { CYOA_mode: true } }, false),
    false,
    'D&D with master power enabled=false should not expect CYOA'
);

// PbtA checks
assert.strictEqual(
    isCyoaExpected({ enabled: true, cyoaConfig: { playstyle: 'cyoa_5' }, syspromptModules: { CYOA_mode: true } }, true),
    true,
    'PbtA with playstyle=cyoa_5 should expect CYOA'
);

assert.strictEqual(
    isCyoaExpected({ enabled: true, cyoaConfig: { playstyle: 'cyoa_3' }, syspromptModules: { CYOA_mode: true } }, true),
    true,
    'PbtA with playstyle=cyoa_3 should expect CYOA'
);

assert.strictEqual(
    isCyoaExpected({ enabled: true, cyoaConfig: { playstyle: 'freeform' } }, true),
    false,
    'PbtA with playstyle=freeform should not expect CYOA'
);

assert.strictEqual(
    isCyoaExpected({ enabled: true, syspromptModules: { CYOA_mode: false } }, true),
    false,
    'PbtA with CYOA_mode explicitly false should not expect CYOA'
);

console.log('✓ CYOA expectation rules for D&D 5e and PbtA verified');

// ── 2. Choice Detection Checks ──────────────────────────────────────────────

assert.strictEqual(
    hasCyoaChoices('Narrative text here\n<choices>\n<button>1. Attack</button>\n</choices>'),
    true,
    'Detects choices with <button> and <choices>'
);

assert.strictEqual(
    hasCyoaChoices('Narrative text here\n<button>1. Run away</button>'),
    true,
    'Detects choices with isolated <button>'
);

assert.strictEqual(
    hasCyoaChoices('Narrative text here\n<div class="rt-cyoa-choices">...</div>'),
    true,
    'Detects choices with .rt-cyoa-choices container'
);

assert.strictEqual(
    hasCyoaChoices('Narrative text with purely prose.\n*(Harm: 1/5) | (XP: 2/5) | (Hold: 0)*'),
    false,
    'Returns false for narrative ending in status footer without choices'
);

assert.strictEqual(
    hasCyoaChoices('Narrative text\n1. Attack the goblin\n2. Run away'),
    false,
    'Returns false for raw unformatted markdown choices'
);

console.log('✓ CYOA choice markup detection verified');

// ── 3. Markdown Auto-Repair Tests ───────────────────────────────────────────

// Case A: 3 choices followed by PbtA footer
const rawPbta = `The shadows lengthen along the cavern walls as the troll bellows.

1. ⚔️ Charge with your spear — [Hack & Slash (+Might)]
2. 🗣️ Try to distract the beast with your torch — [Defy Danger (+Agility)]
3. 🏃 Back out of the chamber toward the tunnel
*(Harm: 1/5) | (XP: 2/5) | (Hold: 0) | (Location: Sunken Caves)*
*[08:00 AM], Day 1*`;

const repairedPbta = tryRepairMarkdownChoices(rawPbta);
assert.ok(repairedPbta, 'Should successfully repair raw markdown choices with trailing footer');
assert.ok(repairedPbta.includes('<choices>'), 'Repaired text must contain <choices>');
assert.ok(repairedPbta.includes('<button>1. ⚔️ Charge with your spear — [Hack & Slash (+Might)]</button>'), 'Choice 1 wrapped');
assert.ok(repairedPbta.includes('<button>2. 🗣️ Try to distract the beast with your torch — [Defy Danger (+Agility)]</button>'), 'Choice 2 wrapped');
assert.ok(repairedPbta.includes('<button>3. 🏃 Back out of the chamber toward the tunnel</button>'), 'Choice 3 wrapped');
assert.ok(repairedPbta.includes('*(Harm: 1/5) | (XP: 2/5) | (Hold: 0) | (Location: Sunken Caves)*'), 'Preserves footer line 1');
assert.ok(repairedPbta.includes('*[08:00 AM], Day 1*'), 'Preserves footer line 2');
assert.ok(repairedPbta.startsWith('The shadows lengthen along the cavern walls'), 'Preserves initial narrative prose');

// Case B: 5 D&D choices with "Choices:" header
const rawDnd = `The temple doors slam shut behind you with a reverberating thud.

**Available Choices:**
1. ⚔️ Draw your greatsword and strike — [Attack (+6) vs AC 14]
2. 🛡️ Raise your shield and guard the cleric — [Athletics (+4) DC 12]
3. 🕯️ Examine the arcane runes carved into the floor — [Arcana (+5) DC 15]
4. 🗣️ Call out to the unseen entity demanding passage
5. 🚪 Try to pry the heavy bronze doors back open — [Strength (+3) DC 16]

*(HP: 24/24) | (Spell Slots: 3/4) | (Location: Sunken Temple)*`;

const repairedDnd = tryRepairMarkdownChoices(rawDnd);
assert.ok(repairedDnd, 'Should repair D&D choices with header');
assert.ok(repairedDnd.includes('<button>1. ⚔️ Draw your greatsword and strike — [Attack (+6) vs AC 14]</button>'), 'Choice 1 wrapped');
assert.ok(repairedDnd.includes('<button>5. 🚪 Try to pry the heavy bronze doors back open — [Strength (+3) DC 16]</button>'), 'Choice 5 wrapped');
assert.ok(!repairedDnd.includes('**Available Choices:**'), 'Header absorbed into choice block');
assert.ok(repairedDnd.includes('*(HP: 24/24)'), 'Preserves D&D status footer');

// Case C: Bulleted numbers
const rawBulleted = `The guard eyes you suspiciously.

* 1. Offer a bribe of 10 gold coins — [-10 GP]
* 2. Flash your credentials from the Guild — [Persuasion (+2) DC 11]
* 3. Turn around and walk away calmly`;

const repairedBulleted = tryRepairMarkdownChoices(rawBulleted);
assert.ok(repairedBulleted, 'Should repair bulleted numbers');
assert.ok(repairedBulleted.includes('<button>1. Offer a bribe of 10 gold coins — [-10 GP]</button>'), 'Strips bullet asterisk');
assert.ok(repairedBulleted.includes('<button>3. Turn around and walk away calmly</button>'));

// Case D: Negative tests (do not repair)
const alreadyFormatted = `Narrative\n<choices>\n<button>1. Go</button>\n</choices>`;
assert.strictEqual(tryRepairMarkdownChoices(alreadyFormatted), null, 'Does not touch already formatted choices');

const midParagraphList = `There were three ancient rules:
1. Do not speak after dark.
2. Do not feed the beast.
3. Obey the high priest.

Long narrative paragraph 1 follows here with lots of detailed description...
Long narrative paragraph 2 continues the story for several hundred words...
The scene continues without any choices offered at the end.`;

assert.strictEqual(
    tryRepairMarkdownChoices(midParagraphList),
    null,
    'Does not misidentify a numbered list embedded in earlier narrative paragraphs'
);

console.log('✓ Markdown choices auto-repair and edge-case safety verified');

// ── 4. Steering Prompt Arming and Interception ──────────────────────────────

// Arm PbtA reminder
armCyoaSteeringReminder({ isPbta: true, choiceCount: 3 });

const chatPbta = [
    { role: 'user', mes: 'I explore the ruined chapel.' },
    { role: 'assistant', mes: 'You find ancient relics...' },
    { role: 'user', mes: 'I reach for the silver chalice.' },
];

const injectedPbta = interceptCyoaSteering(chatPbta);
assert.strictEqual(injectedPbta, true, 'Interception should inject into user message');
assert.ok(chatPbta[2].mes.includes('[CRITICAL GM FORMATTING REQUIREMENT]'), 'User message contains reminder');
assert.ok(chatPbta[2].mes.includes('exactly 3 choices'), 'PbtA specifies 3 choices');
assert.ok(chatPbta[2].mes.includes('[Move Name (+Stat)]'), 'PbtA includes genre-agnostic move template');

// Reminder should be cleared after one injection
const secondPbtaPass = interceptCyoaSteering(chatPbta);
assert.strictEqual(secondPbtaPass, false, 'Steering reminder is disarmed after single injection');

// Arm D&D reminder
armCyoaSteeringReminder({ isPbta: false, choiceCount: 5 });

const chatDnd = [
    { role: 'user', mes: 'We kick down the door.' },
];

const injectedDnd = interceptCyoaSteering(chatDnd);
assert.strictEqual(injectedDnd, true, 'Interception should inject into D&D prompt');
assert.ok(chatDnd[0].mes.includes('[CRITICAL GM FORMATTING REQUIREMENT]'), 'D&D message contains reminder');
assert.ok(chatDnd[0].mes.includes('exactly 5 choices'), 'D&D specifies 5 choices');
assert.ok(chatDnd[0].mes.includes('[Attack (+5) vs AC 14]'), 'D&D includes DC/AC example');

console.log('✓ Ephemeral steering reminder arming and prompt injection verified');

// ── 5. Generation Active Guard & Flexible Repair/Regenerate Parameters ──────────
console.log('5. Testing isNarratorGenerating & argument normalization...');
const { isNarratorGenerating, repairOrGenerateChoicesForMessage, regenerateCyoaChoicesForMessage } = await import('../cyoa-guardian.js');

// In node environment without DOM, isNarratorGenerating() should evaluate to false
assert.strictEqual(isNarratorGenerating(), false, 'isNarratorGenerating must return false when no DOM/stop button is active');

// Mock DOM with active Stop button
globalThis.document = {
    querySelector: (sel) => {
        if (sel === '#mes_stop, .mes_stop') {
            return { style: { display: 'flex' }, offsetParent: {} };
        }
        return null;
    },
};
assert.strictEqual(isNarratorGenerating(), true, 'isNarratorGenerating must detect visible stop button');

// Mock DOM with hidden Stop button
globalThis.document = {
    querySelector: (sel) => {
        if (sel === '#mes_stop, .mes_stop') {
            return { style: { display: 'none' }, offsetParent: null };
        }
        return null;
    },
};
assert.strictEqual(isNarratorGenerating(), false, 'isNarratorGenerating must return false when stop button is display: none');
delete globalThis.document;

// Test repairOrGenerateChoicesForMessage argument normalization
// Pass empty chat
globalThis.SillyTavern = { getContext: () => ({ chat: [] }) };
const repairEmptyResObj = await repairOrGenerateChoicesForMessage({ messageId: 0 });
assert.strictEqual(repairEmptyResObj, false, 'repairOrGenerateChoicesForMessage handles options object with empty chat');

const repairEmptyResNum = await repairOrGenerateChoicesForMessage(0);
assert.strictEqual(repairEmptyResNum, false, 'repairOrGenerateChoicesForMessage handles positional number argument with empty chat');

const regenEmptyResObj = await regenerateCyoaChoicesForMessage({ messageId: 0 });
assert.strictEqual(regenEmptyResObj, false, 'regenerateCyoaChoicesForMessage handles options object with empty chat');

const regenEmptyResNum = await regenerateCyoaChoicesForMessage(0);
assert.strictEqual(regenEmptyResNum, false, 'regenerateCyoaChoicesForMessage handles positional number argument with empty chat');
delete globalThis.SillyTavern;

console.log('✓ isNarratorGenerating and parameter normalization verified');
console.log('--- ALL CYOA GUARDIAN TESTS PASSED CLEANLY! ---');

