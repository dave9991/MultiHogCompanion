/**
 * cyoa-safety-net.test.js — MultiHog Companion
 *
 * Verifies the CYOA Safety Net and Lifecycle Coordinator:
 * 1. Engine expectation rules (D&D 5e vs PbtA).
 * 2. Interactive choice markup detection.
 * 3. Fast markdown regex auto-repair.
 * 4. Outgoing prompt sanitization and single-stage retention.
 * 5. Event dispatching, deduplication, and boundary guards.
 * 6. Slash command registration and execution.
 */

import assert from 'node:assert';
import {
    isCyoaExpected,
    hasCyoaChoices,
    tryRepairMarkdownChoices,
    stripCyoaFromOutgoingChat,
    coordinateCyoaForMessage,
    registerCyoaSlashCommands,
    repairOrGenerateChoicesForMessage,
    regenerateCyoaChoicesForMessage,
    isNarratorGenerating,
} from '../cyoa-safety-net.js';

console.log('--- Running CYOA Safety Net Test Suite ---');

// ── 1. Engine Expectation Checks (D&D 5e vs PbtA) ───────────────────────────
console.log('1. Testing isCyoaExpected...');

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
console.log('2. Testing hasCyoaChoices...');

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

// ── 3. Fast Markdown Auto-Repair ────────────────────────────────────────────
console.log('3. Testing tryRepairMarkdownChoices...');

const rawNarrativeWithChoices = `The bugbear groans as your blow lands, but readies its morningstar for a counterstrike.

1. ⚡ Strike with your warhammer before it can recover
2. 🛡️ Raise your shield and brace for the impact
3. 🏃 Disengage and fall back toward the torchlight

*(HP: 14/18) | (Spell Slots: 2/3)*`;

const repaired = tryRepairMarkdownChoices(rawNarrativeWithChoices);
assert.ok(repaired !== null, 'Should detect and repair numbered choices');
assert.ok(repaired.includes('<choices>'), 'Repaired text should contain <choices>');
assert.ok(repaired.includes('</choices>'), 'Repaired text should contain </choices>');
assert.ok(repaired.includes('<button>1. ⚡ Strike with your warhammer before it can recover</button>'), 'Choice 1 should be wrapped in <button>');
assert.ok(repaired.includes('<button>2. 🛡️ Raise your shield and brace for the impact</button>'), 'Choice 2 should be wrapped in <button>');
assert.ok(repaired.includes('<button>3. 🏃 Disengage and fall back toward the torchlight</button>'), 'Choice 3 should be wrapped in <button>');
assert.ok(repaired.includes('*(HP: 14/18) | (Spell Slots: 2/3)*'), 'Footer should be preserved');

// Verify that choices are placed cleanly
const repairedChoicesIdx = repaired.indexOf('<choices>');
const narrativeIdx = repaired.indexOf('The bugbear groans');
assert.ok(repairedChoicesIdx > narrativeIdx, 'Choices should come after scene narrative');

// Should not touch messages that already have buttons
const alreadyHasButtons = `Some text\n<choices>\n<button>1. Attack</button>\n</choices>`;
assert.strictEqual(tryRepairMarkdownChoices(alreadyHasButtons), null, 'Should not modify text that already has buttons');

// Should not repair text with numbered items scattered in narrative prose
const numberedInStory = `We noticed three clues:\n1. Blood on the doorframe\n2. A broken dagger\n\nWe continued exploring the dungeon corridors for another hour.`;
assert.strictEqual(tryRepairMarkdownChoices(numberedInStory), null, 'Should not repair numbered items in the middle of story prose');

console.log('✓ Markdown choices auto-repair and edge-case safety verified');

// ── 4. Prompt Sanitization & Stripping ──────────────────────────────────────
console.log('4. Testing stripCyoaFromOutgoingChat...');

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

const didStrip = stripCyoaFromOutgoingChat(testChat, { stripActiveCyoa: true });
assert.strictEqual(didStrip, true, 'stripCyoaFromOutgoingChat must modify messages containing CYOA markup');
assert.ok(!testChat[0].mes.includes('<CYOA_mode>'), '<CYOA_mode> must be stripped in two-stage mode');
assert.ok(!testChat[1].mes.includes('<choices>'), '<choices> block must be stripped from assistant message 1');
assert.ok(!testChat[3].mes.includes('rt-cyoa-choices'), 'rt-cyoa-choices div must be stripped from assistant message 2');

// Safety Net mode: keeps active turn <CYOA_mode>
const safetyNetChat = [
    {
        role: 'assistant',
        mes: 'You stand in the mist.\n\n**What does Silas Vance do?**\n1. Search the dirt\n2. Call out\n\n*(Status: 32/32 HP)*\n*Level 8 | 06:30 PM, Day 1*',
    },
    {
        role: 'user',
        mes: 'I search the dirt.\n\n<CYOA_mode>\nGenerate 5 numbered choices at the end.\n</CYOA_mode>',
    },
];

stripCyoaFromOutgoingChat(safetyNetChat, { stripActiveCyoa: false });
assert.ok(safetyNetChat[1].mes.includes('<CYOA_mode>'), 'Safety net mode MUST keep active turn <CYOA_mode> for single-stage generation');
assert.ok(!safetyNetChat[0].mes.includes('What does Silas Vance do?'), 'Safety net mode MUST strip historical markdown choice list from prior turns');
assert.ok(safetyNetChat[0].mes.includes('You stand in the mist.'), 'Narrative prose must be preserved in older turns');

console.log('✓ Prompt sanitization and single-stage retention verified');

// ── 5. Lifecycle Coordination & Boundary Guards ─────────────────────────────
console.log('5. Testing coordinateCyoaForMessage happy path & deduplication...');

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [
            { is_user: false, is_system: false, mes: 'Welcome to the tavern.', swipe_id: 0 },
            {
                is_user: false,
                is_system: false,
                mes: 'The goblin lunges at you!\n<choices>\n<button>1. Strike</button>\n</choices>',
                swipes: ['The goblin lunges at you!\n<choices>\n<button>1. Strike</button>\n</choices>'],
                swipe_id: 0,
            },
        ],
        extensionSettings: {
            rpg_tracker: {
                enabled: true,
                playstyle: 'cyoa_3',
                syspromptModules: { CYOA_mode: true },
                currentMemo: '[CHARACTER]\nHero: 10/10 HP\n[/CHARACTER]',
            },
            MultiHogCompanion: {
                enableDecoupledCyoa: true,
                cyoaMode: 'safety_net',
            },
        },
    }),
};

let eventError = null;
try {
    const handled = await coordinateCyoaForMessage({
        triggerSource: 'GENERATION_ENDED',
        isPbtaActive: () => true,
    });
    assert.strictEqual(handled, false, 'Should return false (no-op) when choices are already present and hero is healthy');
} catch (err) {
    eventError = err;
}
assert.strictEqual(eventError, null, 'coordinateCyoaForMessage must not throw ReferenceError for isProtagonistDowned');

// Message 0 boundary guard
const msg0Attempt = await coordinateCyoaForMessage({
    messageId: 0,
    triggerSource: 'CHARACTER_MESSAGE_RENDERED',
    isPbtaActive: () => false,
});
assert.strictEqual(msg0Attempt, false, 'Message 0 must never trigger choice generation');

delete globalThis.SillyTavern;
console.log('✓ coordinateCyoaForMessage happy path, health check, and boundary guards verified');

// ── 6. Slash Commands ───────────────────────────────────────────────────────
console.log('6. Testing registerCyoaSlashCommands...');

const registeredCommands = {};
const mockSlashCommandParser = {
    addCommandObject: (cmd) => {
        registeredCommands[cmd.name] = cmd;
    },
};
const mockSlashCommand = {
    fromProps: (props) => props,
};

registerCyoaSlashCommands(mockSlashCommandParser, mockSlashCommand, {
    getSettings: () => ({ cyoaMode: 'safety_net', cyoaMaxTokens: 200 }),
    isPbtaActive: () => false,
    showToast: () => {},
});

assert.ok(registeredCommands.cyoagen, 'cyoagen command registered');
assert.ok(registeredCommands.cyoaretry, 'cyoaretry command registered');
assert.ok(registeredCommands.cyoafix, 'cyoafix command registered');

globalThis.SillyTavern = {
    getContext: () => ({
        chat: [
            { is_user: false, is_system: false, mes: 'Welcome.' },
            {
                is_user: false,
                is_system: false,
                mes: 'The goblin attacks!\n<choices>\n<button>1. Strike</button>\n</choices>',
                swipes: ['The goblin attacks!\n<choices>\n<button>1. Strike</button>\n</choices>'],
                swipe_id: 0,
            },
        ],
        extensionSettings: {
            rpg_tracker: {
                playstyle: 'cyoa_3',
                currentMemo: '[CHARACTER]\nHero: 10/10 HP\n[/CHARACTER]',
            },
        },
    }),
};

let slashError = null;
try {
    const res = await registeredCommands.cyoaretry.callback();
    assert.ok(typeof res === 'string', 'cyoaretry callback must return a result string without error');
} catch (err) {
    slashError = err;
}
assert.strictEqual(slashError, null, 'cyoaretry must never throw ReferenceError');
delete globalThis.SillyTavern;

console.log('✓ registerCyoaSlashCommands and execution verified');
console.log('--- ALL CYOA SAFETY NET TESTS PASSED CLEANLY! ---');
