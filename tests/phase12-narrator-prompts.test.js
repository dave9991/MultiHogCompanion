/**
 * tests/phase12-narrator-prompts.test.js — MultiHog Companion
 *
 * Verifies Phase 12 Narrator LLM prompt improvements across PbtA, FAE, and D&D 5e:
 * 1. Deft Touch & Narrative-First permission outside combat (all 3 rulesets)
 * 2. PbtA genre Move & Stat Domain grounding in <role> and dynamic <rng_system> examples
 *    + syncActiveRulesetRngMode preserving active non-fantasy genres
 * 3. Ruleset <state_memo> overrides & PbtA <world_progression> deduplication across compiler
 * 4. PbtA 3-line 2d6 queue (buildPbtA2d6Block) & aligned <[PARTY]_mechanics> schema
 * 5. FAE zero-math pre-computed tag columns (0 / 1 / 2 / 2+Adv Tags) & Roll Format Shift syntax
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

import {
    PBTA_GENRES,
    buildPbtARoleContent,
    buildPbtARngContent,
    buildPbtAStateMemoContent,
    buildPbtAPartyContent,
    buildPbtACartridge,
} from '../pbta-ruleset.js';
import {
    createInitialFaeState,
    buildFaeRngBlock,
    buildFaeRoleContent,
    buildFaeRngContent,
    buildFaeCombatContent,
    buildFaeStateMemoContent,
    buildFaeCartridge,
} from '../fae-ruleset.js';
import {
    buildPbtA2d6Block,
    syncActiveRulesetRngMode,
} from '../ruleset-rng-interceptor.js';
import {
    DND_SUBFOOTER_OVERRIDE_ID,
    DND_DEFT_TOUCH_OVERRIDE_ID,
    getDndDeftTouchPacingContent,
    applyDndSubfooterAlignment,
    revertDndSubfooterAlignment,
} from '../dnd-fixes.js';
import {
    findActiveUnlockedBaseOverride,
    isBaseSectionEnabled,
} from '../../SillyTavern-MultihogDnDFramework/src/state/section-enabled.js';
import { buildDefaultSettings } from '../../SillyTavern-MultihogDnDFramework/src/state/defaults.js';

const SYSPROMPT_TXT_PATH = new URL('../../SillyTavern-MultihogDnDFramework/sysprompt.txt', import.meta.url);

function compileSectionsWithUpstreamContract(cartridge) {
    const rawText = fs.readFileSync(SYSPROMPT_TXT_PATH, 'utf8');
    const tagNameRe = '(?:\\[[^\\]]+\\][\\w_-]*|\\w[\\w_-]*)';
    const baseSections = [];
    for (const m of rawText.matchAll(new RegExp(`<(${tagNameRe})>([\\s\\S]*?)<\\/\\1>`, 'g'))) {
        baseSections.push({ tag: m[1], content: m[2].trim() });
    }
    const baseMap = new Map(baseSections.map(s => [s.tag, s.content]));
    const s = buildDefaultSettings();
    s.customSyspromptLibrary = cartridge.payload.customSyspromptLibrary.map(item => ({
        ...item,
        enabled: item.enabled !== false,
        scope: 'chat',
        _chatSetupMember: true,
    }));
    Object.assign(s.syspromptModules, cartridge.payload.syspromptModules);

    const pieces = [];
    for (const { tag } of baseSections) {
        const override = findActiveUnlockedBaseOverride(s.customSyspromptLibrary, tag);
        if (override) {
            if (override.enabled && tag !== 'CYOA_mode') pieces.push({ tag, content: override.content });
        } else if (isBaseSectionEnabled(tag, s) && tag !== 'CYOA_mode') {
            pieces.push({ tag, content: `<${tag}>\n${baseMap.get(tag) || ''}\n</${tag}>` });
        }
    }
    for (const item of s.customSyspromptLibrary) {
        if (item.origin !== 'unlocked_base' && item.enabled) {
            pieces.push({ tag: item.tag, content: item.content });
        }
    }
    return { pieces, compiled: pieces.map(p => p.content).join('\n\n') };
}

test('1. Deft Touch & Narrative-First outside-combat pacing is present across PbtA, FAE, and D&D 5e', async () => {
    const pbtaRole = buildPbtARoleContent();
    assert.ok(pbtaRole.includes('NARRATIVE-FIRST & DEFT TOUCH OUTSIDE COMBAT:'));
    assert.ok(pbtaRole.includes('explicit permission NOT to invoke rules or roll dice on every turn'));
    assert.ok(pbtaRole.includes('Keep mechanics strictly separate from narrative prose'));

    const pbtaRngQueue = buildPbtARngContent({ toolMode: false });
    const pbtaRngTool = buildPbtARngContent({ toolMode: true });
    assert.ok(pbtaRngQueue.includes('DEFT TOUCH OUTSIDE COMBAT:'));
    assert.ok(pbtaRngTool.includes('DEFT TOUCH OUTSIDE COMBAT:'));

    const faeRole = buildFaeRoleContent();
    assert.ok(faeRole.includes('NARRATIVE-FIRST & DEFT TOUCH OUTSIDE COMBAT:'));
    assert.ok(faeRole.includes('explicit permission NOT to test resource pools or roll 4dF on every turn'));
    assert.ok(faeRole.includes('Keep mechanics strictly separate from story prose'));

    const faeRngQueue = buildFaeRngContent({ toolMode: false });
    const faeRngTool = buildFaeRngContent({ toolMode: true });
    assert.ok(faeRngQueue.includes('DEFT TOUCH OUTSIDE COMBAT:'));
    assert.ok(faeRngTool.includes('DEFT TOUCH OUTSIDE COMBAT'));

    const dndDeftTouch = getDndDeftTouchPacingContent();
    assert.ok(dndDeftTouch.startsWith('<deft_touch_pacing>'));
    assert.ok(dndDeftTouch.includes('NARRATIVE-FIRST & DEFT TOUCH OUTSIDE COMBAT:'));
    assert.ok(dndDeftTouch.includes('explicit permission NOT to call for skill checks or roll dice on every turn'));

    const mockRpg = { customSyspromptLibrary: [], cyoaConfig: { slots: [{}, {}, {}, {}, {}] } };
    await applyDndSubfooterAlignment({ rpgSettings: mockRpg });
    assert.ok(mockRpg.customSyspromptLibrary.some(p => p.id === DND_SUBFOOTER_OVERRIDE_ID));
    assert.ok(mockRpg.customSyspromptLibrary.some(p => p.id === DND_DEFT_TOUCH_OVERRIDE_ID && p.origin === 'custom' && p.enabled));

    await revertDndSubfooterAlignment({ rpgSettings: mockRpg });
    assert.strictEqual(mockRpg.customSyspromptLibrary.some(p => p.id === DND_DEFT_TOUCH_OVERRIDE_ID), false);
});

test('2. PbtA genre Move & Stat Domain grounding injects active non-fantasy moves and stats', () => {
    const scifiRole = buildPbtARoleContent(false, 'scifi');
    assert.ok(scifiRole.includes('ACTIVE GENRE MOVES & STAT DOMAINS (Sci-Fi / Cyberpunk'));
    assert.ok(scifiRole.includes(PBTA_GENRES.scifi.statDescriptions));
    assert.ok(scifiRole.includes('Jack In / Hack (+Mind)'));
    assert.ok(scifiRole.includes('Fast-Talk (+Synth)'));

    const mechaRole = buildPbtARoleContent({ isFreeform: true, genreKey: 'mecha' });
    assert.ok(mechaRole.includes(PBTA_GENRES.mecha.statDescriptions));
    assert.ok(mechaRole.includes('Full Salvo (+Systems)'));
    assert.ok(mechaRole.includes('Overclock Reactor (+Heat)'));

    const scifiRng = buildPbtARngContent({ genreKey: 'scifi' });
    assert.ok(scifiRng.includes('Act Under Pressure [Cool]:'), 'Sci-Fi rng uses Act Under Pressure [Cool]');
    assert.ok(scifiRng.includes('Jack In / Hack [Mind]:'), 'Sci-Fi rng uses Jack In / Hack [Mind]');
    assert.ok(!scifiRng.includes('Cast a Spell [Arcana]'), 'Sci-Fi rng must not leak Dungeon World Cast a Spell');
    assert.ok(!scifiRng.includes('Hack & Slash [Might]'), 'Sci-Fi rng must not leak Dungeon World Hack & Slash');

    const westernRng = buildPbtARngContent({ genreKey: 'western' });
    assert.ok(westernRng.includes('Quick Draw [Quick]:'));
    assert.ok(westernRng.includes('Fan the Hammer [Iron]:'));
    assert.ok(!westernRng.includes('Cast a Spell [Arcana]'));

    const westernToolRng = buildPbtARngContent({ toolMode: true, genreKey: 'western' });
    assert.ok(westernToolRng.includes('"Quick Draw"'));
    assert.ok(westernToolRng.includes('"Grit"'));
    assert.ok(!westernToolRng.includes('"Cast a Spell"'));

    // Default fantasy preserves canonical 6 examples
    const fantasyRng = buildPbtARngContent();
    assert.ok(fantasyRng.includes('Cast a Spell [Arcana]:'));
    assert.ok(fantasyRng.includes('Hack & Slash [Might]:'));

    // syncActiveRulesetRngMode preserves non-fantasy PbtA genre & stats when toggling diceFunctionTool
    const prevST = globalThis.SillyTavern;
    const prevExt = globalThis.extension_settings;
    try {
        const pbtaCart = buildPbtACartridge('scifi', { campaignTitle: 'Orbital Rust' });
        const settings = {
            diceFunctionTool: false,
            cyoaConfig: { playstyle: 'cyoa_5' },
            customSyspromptLibrary: pbtaCart.payload.customSyspromptLibrary.map(p => ({ ...p })),
            syspromptSnippetDatabase: pbtaCart.payload.customSyspromptLibrary.map(p => ({ ...p })),
            chatStates: {},
        };
        const comp = {
            companionActiveCartridges: {
                chat_pbta_scifi_sync: { cartridgeId: 'pbta', genre: 'scifi', systemLabel: 'The Sprawl' },
            },
        };
        globalThis.extension_settings = { rpg_tracker: settings, multihog_companion: comp };
        globalThis.SillyTavern = {
            getContext: () => ({
                chatId: 'chat_pbta_scifi_sync',
                getCurrentChatId: () => 'chat_pbta_scifi_sync',
                extensionSettings: globalThis.extension_settings,
            }),
        };

        settings.diceFunctionTool = true;
        syncActiveRulesetRngMode(settings);
        const rngToolContent = settings.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_rng').content;
        const roleContent = settings.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_role').content;
        assert.ok(rngToolContent.includes('FUNCTION TOOL CALL RESOLUTION (roll_pbta_move)'));
        assert.ok(rngToolContent.includes('"Act Under Pressure"'), 'Tool mode keeps Sci-Fi move example');
        assert.ok(!rngToolContent.includes('"Cast a Spell"'), 'Tool mode does not revert to Fantasy');
        assert.ok(roleContent.includes('Jack In / Hack (+Mind)'));
    } finally {
        if (prevST === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = prevST;
        if (prevExt === undefined) delete globalThis.extension_settings;
        else globalThis.extension_settings = prevExt;
    }
});

test('3. PbtA & FAE cartridges provide ruleset <state_memo> overrides and deduplicate <world_progression>', () => {
    const pbtaStateMemo = buildPbtAStateMemoContent();
    assert.ok(pbtaStateMemo.startsWith('<state_memo>'));
    assert.ok(pbtaStateMemo.includes('Max Harm (0 HP)'));
    assert.ok(!pbtaStateMemo.includes('cast with Level 1 at 0/4'));

    const faeStateMemo = buildFaeStateMemoContent();
    assert.ok(faeStateMemo.startsWith('<state_memo>'));
    assert.ok(faeStateMemo.includes('CRITICAL FAE ZERO-POOL RULE'));
    assert.ok(faeStateMemo.includes('NOT a depleted spell slot that forbids acting'));
    assert.ok(!faeStateMemo.includes('cast with Level 1 at 0/4'));

    const pbtaCart = buildPbtACartridge('horror');
    assert.strictEqual(pbtaCart.payload.syspromptModules.state_memo, false);
    assert.strictEqual(pbtaCart.payload.syspromptModules.world_progression, false);
    assert.ok(pbtaCart.payload.customSyspromptLibrary.some(p => p.id === 'pbta_base_override_state_memo' && p.origin === 'unlocked_base' && p.baseTag === 'state_memo'));

    const { pieces: pbtaPieces, compiled: pbtaCompiled } = compileSectionsWithUpstreamContract(pbtaCart);
    const pbtaStateMemos = pbtaPieces.filter(p => p.tag === 'state_memo');
    assert.strictEqual(pbtaStateMemos.length, 1);
    assert.ok(pbtaStateMemos[0].content.includes('Max Harm (0 HP)'));
    assert.strictEqual(pbtaPieces.filter(p => p.tag === 'world_progression').length, 0, 'Duplicate base <world_progression> suppressed when embedded in PbtA <role>');
    assert.strictEqual((pbtaCompiled.match(/Bleed-in:/g) || []).length, 1, 'World progression rules appear exactly once in PbtA prompt');

    const faeCart = buildFaeCartridge('cosmic_horror');
    assert.strictEqual(faeCart.payload.syspromptModules.state_memo, false);
    assert.strictEqual(faeCart.payload.syspromptModules.world_progression, true);
    assert.ok(faeCart.payload.customSyspromptLibrary.some(p => p.id === 'fae_base_override_state_memo' && p.origin === 'unlocked_base' && p.baseTag === 'state_memo'));

    const { pieces: faePieces } = compileSectionsWithUpstreamContract(faeCart);
    const faeStateMemos = faePieces.filter(p => p.tag === 'state_memo');
    assert.strictEqual(faeStateMemos.length, 1);
    assert.ok(faeStateMemos[0].content.includes('CRITICAL FAE ZERO-POOL RULE'));
});

test('4. buildPbtA2d6Block defaults to 3 pre-rolled lines and buildPbtAPartyContent aligns with lean schema', () => {
    const defaultQueue = buildPbtA2d6Block();
    assert.ok(defaultQueue.includes('1: 2d6 → '));
    assert.ok(defaultQueue.includes('2: 2d6 → '));
    assert.ok(defaultQueue.includes('3: 2d6 → '));

    const partyQueue = buildPbtAPartyContent({ toolMode: false });
    assert.ok(!partyQueue.includes('Stats: Stat1 +2'), 'No full 5-stat array on lean companions');
    assert.ok(partyQueue.includes('((PILLS)) Moves:'));
    assert.ok(partyQueue.includes('((PILLS)) Gear:'));
    assert.ok(partyQueue.includes('((PILLS)) Bonds:'));
    assert.ok(partyQueue.includes('((PILLS)) Conditions:'));
    assert.ok(partyQueue.includes('roll_pbta_move'), 'Supports Tool Mode fallback in bench_ETA_system');

    const partyTool = buildPbtAPartyContent({ toolMode: true });
    assert.ok(partyTool.includes('Call roll_pbta_move'));
});

test('5. FAE pre-computed matrix eliminates tag subtraction arithmetic and Shift syntax is documented', () => {
    const state = createInitialFaeState('survival_horror'); // base_attrition_shift = +1
    const block = buildFaeRngBlock({ state, lineCount: 1 });
    const rollMatch = block.match(/1: 4dF → \[[^\]]+\] = ([+-]?\d+)/);
    assert.ok(rollMatch, 'Queue must contain 4dF Roll #1');
    const d1 = parseInt(rollMatch[1], 10);
    const shift = state.knobs.base_attrition_shift; // +1

    for (let t = 1; t <= 4; t++) {
        const c0 = Math.max(0, t + d1 + shift);
        const c1 = Math.max(0, t + d1 + shift - 1);
        const c2 = Math.max(0, t + d1 + shift - 2);
        const c3 = Math.max(0, t + d1 + shift - 3);
        const piv = Math.max(0, Math.min(5, t + 1) + d1 + shift);
        const expected = `• Threat ${t}: ${c0} Attrition [0 Tags: ${c0} | 1 Tag (-1): ${c1} | 2 Tags (-2): ${c2} | 2 Tags+Adv (-3): ${c3}] (pivot: ${piv})`;
        assert.ok(block.includes(expected), `Matrix missing pre-computed Threat ${t} columns:\nExpected: ${expected}\nGot:\n${block}`);
    }

    const queuePrompt = buildFaeRngContent({ toolMode: false });
    const toolPrompt = buildFaeRngContent({ toolMode: true });
    assert.ok(queuePrompt.includes('[+ Shift S]'), 'Queue ROLL FORMAT must include optional Shift');
    assert.ok(toolPrompt.includes('[+ Shift S]'), 'Tool ROLL FORMAT must include optional Shift');

    const combatContent = buildFaeCombatContent('cosmic_horror');
    assert.ok(combatContent.includes('TWO-TIER NARRATION (see <role> Law 4):'));
});
