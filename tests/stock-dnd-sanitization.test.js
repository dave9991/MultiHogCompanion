/**
 * stock-dnd-sanitization.test.js
 *
 * Verifies that MultiHog Companion prevents PbtA / Dungeon World stock prompts
 * and module overrides from leaking across chat boundaries into new/unstarted chats
 * and MultiHog Instant Action sessions.
 */

import assert from 'assert';
import {
    isLiveSettingsPollutedWithPbtA,
    cleanseStockDndSettings,
    ensureActiveChatRulesetConsistency,
    isPbtAActive,
    setCompanionActiveCartridge,
} from '../pbta-ruleset-persistence.js';

console.log('--- Running Stock D&D Sanitization & Ruleset Isolation Test Suite ---');

// ── 1. Test isLiveSettingsPollutedWithPbtA Detection ──────────────────────────
console.log('Testing isLiveSettingsPollutedWithPbtA detection...');

// Clean D&D settings
const cleanDndSettings = {
    stockPrompts: {
        character: `Main character's core stats. MECHANICS ONLY. Use this format:
[CHARACTER]
{{user}} (Class): current/max HP
Combat: BAB: +X | Base AC: X
Attr: STR X (mod), DEX X (mod), CON X (mod), INT X (mod), WIS X (mod), CHA X (mod)
AC CALCULATION: Calculate Total AC...`,
        party: `Companion and party members. Full stat arrays.`,
        combat: `Active enemies and threats. Name: cur/max HP`,
    },
    syspromptModules: {
        role: true,
        rng_system: true,
        combat: true,
        xp_system: true,
    },
    customSyspromptLibrary: [],
};
assert.strictEqual(isLiveSettingsPollutedWithPbtA(cleanDndSettings), false, 'Clean D&D settings must not be flagged as polluted');

// Polluted settings: PbtA character prompt
const pollutedCharPrompt = {
    ...cleanDndSettings,
    stockPrompts: {
        ...cleanDndSettings.stockPrompts,
        character: `Main character's core stats. MECHANICS ONLY: Never include narrative background.
NO D&D MECHANICS: Never write "1d8 damage", "attack rolls", "disadvantage". Stats: Might, Agility, Wits, Heart, Arcana.
Moves: Cast a Spell, Arcane Analysis. Harm: 0/5.`,
    },
};
assert.strictEqual(isLiveSettingsPollutedWithPbtA(pollutedCharPrompt), true, 'PbtA character prompt must be flagged as polluted');

// Polluted settings: Dungeon World party prompt
const pollutedPartyPrompt = {
    ...cleanDndSettings,
    stockPrompts: {
        ...cleanDndSettings.stockPrompts,
        party: `Companion and party members. Lean & boon-driven hirelings/allies (Dungeon World style) — no full stat arrays.`,
    },
};
assert.strictEqual(isLiveSettingsPollutedWithPbtA(pollutedPartyPrompt), true, 'Dungeon World party prompt must be flagged as polluted');

// Polluted settings: PbtA disabled core modules
const pollutedModules = {
    ...cleanDndSettings,
    syspromptModules: {
        role: false,
        rng_system: false,
        combat: false,
        xp_system: false,
    },
};
assert.strictEqual(isLiveSettingsPollutedWithPbtA(pollutedModules), true, 'Disabled core D&D modules must be flagged as polluted');

// Polluted settings: Active pbta_ snippets in customSyspromptLibrary
const pollutedSnippets = {
    ...cleanDndSettings,
    customSyspromptLibrary: [
        { id: 'pbta_base_override_combat', enabled: true },
    ],
};
assert.strictEqual(isLiveSettingsPollutedWithPbtA(pollutedSnippets), true, 'Active pbta_ snippets must be flagged as polluted');

console.log('✓ isLiveSettingsPollutedWithPbtA accurately identifies all PbtA pollution vectors');

// ── 2. Test cleanseStockDndSettings Restoration ───────────────────────────────
console.log('Testing cleanseStockDndSettings restoration...');

const dirtySettings = {
    stockPrompts: {
        character: `NO D&D MECHANICS: Never write "1d8 damage", "attack rolls". Stats: Might, Agility, Wits, Heart. Harm: 0/5.`,
        party: `Lean & boon-driven hirelings/allies (Dungeon World style).`,
        combat: `Harm clock. Tier 1: 1-2 Harm.`,
    },
    syspromptModules: {
        role: false,
        rng_system: false,
        combat: false,
        ruleset_note: false,
        end_of_output_footer: false,
        xp_system: false,
        '[PARTY]_mechanics': false,
    },
    blockOrder: ['CHARACTER', 'INVENTORY'],
    customSyspromptLibrary: [
        { id: 'pbta_base_override_role', enabled: true },
        { id: 'custom_user_snippet', enabled: true },
    ],
    rngEnabled: true,
    rngQueueD20: true,
    chatStates: {
        'new_chat_101': {
            setup: {},
        },
    },
};

const cleanseResult = await cleanseStockDndSettings(dirtySettings, { chatId: 'new_chat_101', syncSetup: true });
assert.strictEqual(cleanseResult, true, 'cleanseStockDndSettings must return true');

// Verify stockPrompts are restored
assert.ok(
    dirtySettings.stockPrompts.character.includes('BAB:') || dirtySettings.stockPrompts.character.includes('AC CALCULATION') || !dirtySettings.stockPrompts.character.includes('NO D&D MECHANICS'),
    'Character stock prompt must be restored to D&D'
);
assert.strictEqual(dirtySettings.stockPrompts.party.includes('Dungeon World style'), false, 'Party prompt must not have Dungeon World style');
assert.strictEqual(dirtySettings.stockPrompts.combat.includes('Harm clock'), false, 'Combat prompt must not have Harm clock');

// Verify syspromptModules are re-enabled
assert.strictEqual(dirtySettings.syspromptModules.role, true, 'syspromptModules.role must be re-enabled');
assert.strictEqual(dirtySettings.syspromptModules.combat, true, 'syspromptModules.combat must be re-enabled');
assert.strictEqual(dirtySettings.syspromptModules.rng_system, true, 'syspromptModules.rng_system must be re-enabled');

// Verify customSyspromptLibrary pbta_ snippets are removed
const remainingPbtaSnippets = dirtySettings.customSyspromptLibrary.filter(p => p.id?.startsWith('pbta_'));
assert.strictEqual(remainingPbtaSnippets.length, 0, 'pbta_ snippets must be removed from customSyspromptLibrary');
assert.strictEqual(dirtySettings.customSyspromptLibrary.some(p => p.id === 'custom_user_snippet'), true, 'User snippets must be preserved');

// Verify isLiveSettingsPollutedWithPbtA now returns false
assert.strictEqual(isLiveSettingsPollutedWithPbtA(dirtySettings), false, 'Settings must be clean after cleanseStockDndSettings');

console.log('✓ cleanseStockDndSettings cleanly restores D&D 5e stockPrompts, modules, and snippets');

// ── 3. Test Chat Switch Isolation via ensureActiveChatRulesetConsistency ──────
console.log('Testing Chat Switch isolation when switching to blank new chat...');

const simulationRpgSettings = {
    stockPrompts: {
        character: `NO D&D MECHANICS: Never write "1d8 damage". Stats: Might, Agility, Wits, Heart. Harm: 0/5.`,
        party: `Lean & boon-driven hirelings/allies (Dungeon World style).`,
    },
    syspromptModules: {
        role: false,
        rng_system: false,
        combat: false,
    },
    customSyspromptLibrary: [
        { id: 'pbta_base_override_combat', enabled: false, scope: 'chat' },
    ],
    chatStateProjectionOwner: 'blank_new_chat_202',
    chatStates: {
        'fables_lullaby_chat': {
            pbtaCampaignDossier: {
                meta: { title: "Fable's Lullaby", systemKey: 'fantasy', systemLabel: 'Dungeon World' },
            },
        },
        'blank_new_chat_202': {
            currentMemo: '',
        },
    },
    currentMemo: '',
};

// Verify blank_new_chat_202 is initially recognized as non-PbtA
assert.strictEqual(isPbtAActive('blank_new_chat_202', simulationRpgSettings), false);

// Run ensureActiveChatRulesetConsistency on blank_new_chat_202
const consistencyResult = await ensureActiveChatRulesetConsistency('blank_new_chat_202', simulationRpgSettings);
assert.strictEqual(consistencyResult, false, 'ensureActiveChatRulesetConsistency returns false for non-PbtA chat');

// Verify that simulationRpgSettings were automatically sanitized!
assert.strictEqual(
    isLiveSettingsPollutedWithPbtA(simulationRpgSettings),
    false,
    'ensureActiveChatRulesetConsistency must sanitize polluted settings on non-PbtA chat'
);
assert.strictEqual(
    simulationRpgSettings.stockPrompts.character.includes('NO D&D MECHANICS'),
    false,
    'Character prompt must no longer contain PbtA instructions'
);
assert.strictEqual(simulationRpgSettings.syspromptModules.combat, true, 'Combat module must be re-enabled');

console.log('✓ ensureActiveChatRulesetConsistency automatically isolates and cleanses new chats on switch');

// ── 4. Verify PbtA Retention on Genuine PbtA Chat ─────────────────────────────
console.log('Testing PbtA retention when switching back to genuine PbtA campaign...');

const pbtaChatSettings = {
    customSyspromptLibrary: [],
    chatStates: {
        'fables_lullaby_chat': {
            pbtaCampaignDossier: {
                meta: { title: "Fable's Lullaby", systemKey: 'fantasy', systemLabel: 'Dungeon World' },
                protagonist: {
                    name: 'Fionnuala',
                    stats: { Might: 1, Agility: 2, Wits: 0 },
                },
            },
        },
    },
};

const pbtaResult = await ensureActiveChatRulesetConsistency('fables_lullaby_chat', pbtaChatSettings);
assert.strictEqual(pbtaResult, true, 'ensureActiveChatRulesetConsistency must rehydrate genuine PbtA chat');
assert.ok(
    pbtaChatSettings.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_')),
    'PbtA snippets must be rehydrated for genuine PbtA campaign'
);

console.log('✓ Genuine PbtA campaigns continue to rehydrate seamlessly without regression');

console.log('--- ALL STOCK D&D SANITIZATION TESTS PASSED CLEANLY! ---');
