/**
 * tests/phase13-state-tracker-prompts.test.js
 *
 * Verifies Phase 13 improvements to State Tracker LLM instruction processing
 * and D&D 5e Day 0 Memo alignment across PbtA, FAE, and D&D 5e:
 * 1. Ruleset-aligned systemPromptTemplate for PbtA & FAE (preserving XML contract while stripping D&D round/AC rules)
 * 2. Disabled conflicting modules (xp: false, 'benched party' false for FAE & solo PbtA) and omitted 'XP' in blockOrder
 * 3. Upstream buildModulesInstructionText integration (no D&D [XP]/[BENCHED PARTY] or D&D ENEMIES:/DEFEATED COMBATANTS: injection)
 * 4. FAE [CHARACTER] (Tempo | Idle | Breather) & [COMBAT] (STEPPING-STONE / END_COMBAT) transition rules
 * 5. Cross-ruleset hydration, pollution detection, and D&D restoration (systemPromptTemplate & modules)
 * 6. D&D 5e Day 0 [XP] (Level: 1 | XP: 0/300) and [INVENTORY] (Gear:/Other Items:) alignment with upstream renderer
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

import { buildDefaultSettings } from '../../SillyTavern-MultihogDnDFramework/src/state/defaults.js';
import { buildModulesInstructionText } from '../../SillyTavern-MultihogDnDFramework/memo-processor.js';
import {
    buildPbtASystemPromptTemplate,
    buildPbtAStockPrompts,
    buildPbtACartridge,
} from '../pbta-ruleset.js';
import {
    buildFaeSystemPromptTemplate,
    buildFaeStockPrompts,
    buildFaeCartridge,
} from '../fae-ruleset.js';
import {
    isLiveSettingsPollutedWithPbtA,
    isLiveSettingsPollutedWithFae,
    doesLiveLibraryMatchCartridge,
    cleanseStockDndSettings,
    ensureActiveChatRulesetConsistency,
} from '../pbta-ruleset-persistence.js';
import { Dnd5eSystemAdapter } from '../concierge-system-dnd5e.js';
import { systemRegistry } from '../concierge-system-registry.js';

const RENDERER_PATH = new URL('../../SillyTavern-MultihogDnDFramework/renderer.js', import.meta.url);

function loadUpstreamBlockRegex() {
    const src = fs.readFileSync(RENDERER_PATH, 'utf8');
    const m = src.match(/export function parseMemoBlocks[\s\S]*?const pattern = \/(.+)\/([a-z]*);/);
    assert.ok(m, 'Could not locate parseMemoBlocks pattern in upstream renderer.js');
    return new RegExp(m[1], m[2]);
}

function buildExtractorPromptForCartridge(cartridge) {
    const base = buildDefaultSettings();
    const simSettings = {
        ...base,
        stockPrompts: { ...base.stockPrompts, ...cartridge.payload.stockPrompts },
        modules: { ...base.modules, ...cartridge.payload.modules },
        syspromptModules: { ...base.syspromptModules, ...cartridge.payload.syspromptModules },
        systemPromptTemplate: cartridge.payload.systemPromptTemplate,
        customFields: [],
    };
    const modulesText = buildModulesInstructionText(simSettings);
    const fullSystemPrompt = simSettings.systemPromptTemplate.replace('{{modulesText}}', modulesText);
    return { simSettings, modulesText, fullSystemPrompt };
}

test('1. buildPbtASystemPromptTemplate and buildFaeSystemPromptTemplate preserve extractor structure without D&D round/AC rules', () => {
    const pbtaTpl = buildPbtASystemPromptTemplate();
    const faeTpl = buildFaeSystemPromptTemplate();

    for (const [label, tpl] of [['PbtA', pbtaTpl], ['FAE', faeTpl]]) {
        assert.ok(tpl.includes('{{modulesText}}'), `${label} template must include {{modulesText}}`);
        for (const tag of ['core_directives', 'modules', 'rules', 'list_formatting', 'buff_debuff_logic', 'progression_logic', 'custom_formatting']) {
            assert.ok(tpl.includes(`<${tag}>`) && tpl.includes(`</${tag}>`), `${label} template must include <${tag}>`);
        }
        assert.ok(tpl.includes('NO_CHANGES_DETECTED'), `${label} template must preserve NO_CHANGES_DETECTED`);
        assert.ok(tpl.includes('[TAG]REMOVED[/TAG]'), `${label} template must preserve [TAG]REMOVED[/TAG]`);
        assert.ok(tpl.includes('BLOCK PERSISTENCE:'), `${label} template must preserve BLOCK PERSISTENCE`);
        assert.ok(!tpl.includes('poisoned for 3 turns'), `${label} template must strip D&D turn duration instructions`);
        assert.ok(!tpl.includes('Decrement by 1 each round'), `${label} template must strip per-round counter decrementing`);
        assert.ok(!tpl.includes('AC 18 (base 13)'), `${label} template must strip D&D AC restoration anchors`);
        assert.ok(!tpl.includes('Shield (+5 AC, 1 turn)'), `${label} template must strip D&D Shield (+5 AC) example`);
    }

    assert.ok(pbtaTpl.includes('FICTION-FIRST STATE:'), 'PbtA template identifies fiction-first state model');
    assert.ok(pbtaTpl.includes('NEVER output a separate [XP] block'), 'PbtA template forbids separate [XP] block');
    assert.ok(faeTpl.includes('SINGLE-PASS ATTRITION & POOLS:'), 'FAE template identifies single-pass attrition pool model');
    assert.ok(faeTpl.includes('STRAIN VS. TRAUMA'), 'FAE template encodes Two-Tier Strain vs. Trauma rule');
    assert.ok(!faeTpl.includes('Heroic Domain'), 'FAE template avoids Heroic Domain string so non-heroic cartridges remain clean');
});

test('2. PbtA and FAE cartridges disable conflicting modules (xp, benched party) and omit XP from blockOrder', () => {
    const pbtaSolo = buildPbtACartridge('scifi', { config: { partyMode: 'solo' } });
    assert.strictEqual(pbtaSolo.payload.modules.xp, false);
    assert.strictEqual(pbtaSolo.payload.modules.party, false);
    assert.strictEqual(pbtaSolo.payload.modules['benched party'], false);
    assert.ok(!pbtaSolo.payload.blockOrder.includes('XP'), 'PbtA solo blockOrder omits XP');
    assert.ok(!pbtaSolo.payload.blockOrder.includes('PARTY'), 'PbtA solo blockOrder omits PARTY');
    assert.strictEqual(pbtaSolo.payload.systemPromptTemplate, buildPbtASystemPromptTemplate());

    const pbtaSquad = buildPbtACartridge('fantasy', { config: { partyMode: 'squad' } });
    assert.strictEqual(pbtaSquad.payload.modules.xp, false);
    assert.strictEqual(pbtaSquad.payload.modules.party, true);
    assert.strictEqual(pbtaSquad.payload.modules['benched party'], true, 'PbtA squad retains benched party support');
    assert.ok(!pbtaSquad.payload.blockOrder.includes('XP'), 'PbtA squad blockOrder omits XP');

    const faeCart = buildFaeCartridge('cosmic_horror', { config: { partyMode: 'party' } });
    assert.strictEqual(faeCart.payload.modules.xp, false);
    assert.strictEqual(faeCart.payload.modules.party, false);
    assert.strictEqual(faeCart.payload.modules['benched party'], false);
    assert.ok(!faeCart.payload.blockOrder.includes('XP'), 'FAE blockOrder omits XP');
    assert.strictEqual(faeCart.payload.systemPromptTemplate, buildFaeSystemPromptTemplate());
});

test('3. Upstream buildModulesInstructionText skips [XP], [BENCHED PARTY] (FAE/solo PbtA), and D&D combat auto-injections', () => {
    const faeCart = buildFaeCartridge('cosmic_horror');
    const { modulesText: faeMods, fullSystemPrompt: faePrompt } = buildExtractorPromptForCartridge(faeCart);
    assert.ok(!faeMods.includes('- [XP]:'), 'FAE extractor modulesText must NOT emit D&D [XP] module');
    assert.ok(!faeMods.includes('- [BENCHED PARTY]:'), 'FAE extractor modulesText must NOT emit [BENCHED PARTY] module');
    assert.ok(
        !faeMods.includes('- DEFEATED COMBATANTS: Mark defeated enemies as Status: Defeated'),
        'FAE [COMBAT] negative sentinel must prevent upstream D&D DEFEATED_COMBATANTS append',
    );
    assert.ok(
        !faeMods.includes('- COMBAT SIDES: Group combatants under ENEMIES:'),
        'FAE [COMBAT] negative sentinel must prevent upstream D&D COMBAT_SIDES append',
    );
    assert.ok(faePrompt.includes('SINGLE-PASS ATTRITION & POOLS:'), 'Compiled FAE State Extractor uses FAE template');

    const pbtaSolo = buildPbtACartridge('noir', { config: { partyMode: 'solo' } });
    const { modulesText: pbtaSoloMods } = buildExtractorPromptForCartridge(pbtaSolo);
    assert.ok(!pbtaSoloMods.includes('- [XP]:'), 'PbtA solo extractor modulesText must NOT emit D&D [XP] module');
    assert.ok(!pbtaSoloMods.includes('- [BENCHED PARTY]:'), 'PbtA solo extractor modulesText must NOT emit [BENCHED PARTY] module');
    assert.ok(
        !pbtaSoloMods.includes('- DEFEATED COMBATANTS: Mark defeated enemies as Status: Defeated. Do not omit them from the memo.'),
        'PbtA [COMBAT] explicit DEFEATED COMBATANTS rule prevents duplicate upstream D&D rule append',
    );

    const pbtaSquad = buildPbtACartridge('fantasy', { config: { partyMode: 'squad' } });
    const { modulesText: pbtaSquadMods } = buildExtractorPromptForCartridge(pbtaSquad);
    assert.ok(!pbtaSquadMods.includes('- [XP]:'), 'PbtA squad extractor modulesText must NOT emit D&D [XP] module');
    assert.ok(pbtaSquadMods.includes('- [BENCHED PARTY]:'), 'PbtA squad retains [BENCHED PARTY] module');
});

test('4. FAE stockPrompts preserve Tempo/Idle/Breather in [CHARACTER] and encode STEPPING-STONE / END_COMBAT in [COMBAT]', () => {
    const stockDefault = buildFaeStockPrompts('cosmic_horror', { actionTempo: 'slow_burn', heroicTier: false });
    assert.ok(stockDefault.character.includes('Tempo: slow_burn | Idle: 0t | Breather: READY'), 'FAE stock character prompt includes Tempo, Idle, and Breather');
    assert.ok(!stockDefault.character.includes('Heroic: ON'), 'Non-heroic FAE stock prompt omits Heroic: ON');
    assert.ok(stockDefault.character.includes('POOL & KNOB SYNCHRONIZATION:'), 'FAE stock character prompt documents pool/HP/knob sync');

    const stockHeroic = buildFaeStockPrompts('osr_dungeon', { heroicTier: true, knobs: { action_tempo: 'action_serial' } });
    assert.ok(stockHeroic.character.includes('Tempo: action_serial | Idle: 0t | Breather: READY | Heroic: ON'));

    assert.ok(stockDefault.combat.includes('STEPPING-STONE (-1 Encounter HP Layer):'), 'FAE [COMBAT] teaches Stepping-Stone HP layer decrement');
    assert.ok(stockDefault.combat.includes('FULL RESOLUTION (Encounter Layers -> 0)'), 'FAE [COMBAT] teaches Full Resolution transition');
    assert.ok(stockDefault.combat.includes('[COMBAT]END_COMBAT[/COMBAT]'), 'FAE [COMBAT] specifies END_COMBAT signal');
    assert.ok(!/disadvantage/i.test(buildPbtAStockPrompts('fantasy').combat), 'PbtA combat stock prompt stays free of D&D disadvantage leaks');
});

test('5. Cartridge hydration, pollution checks, and cleanseStockDndSettings sync & restore systemPromptTemplate and modules', async () => {
    const factory = buildDefaultSettings();
    const faeChatId = 'chat_p13_fae';
    const pbtaChatId = 'chat_p13_pbta';
    const dndChatId = 'chat_p13_dnd';

    const s = buildDefaultSettings();
    s.chatStates = {
        [faeChatId]: {
            faeCampaignDossier: {
                meta: { title: 'Black Beacon', ruleset: 'fae', systemKey: 'cosmic_horror', systemLabel: 'Cosmic Horror' },
                config: { heroicTier: false, actionTempo: 'slow_burn' },
            },
        },
        [pbtaChatId]: {
            pbtaCampaignDossier: {
                meta: { title: 'Chrome Alley', ruleset: 'pbta', systemKey: 'scifi', systemLabel: 'Sci-Fi' },
                config: { harmMax: 5, pacingXp: 5, partyMode: 'solo' },
            },
        },
        [dndChatId]: { characterName: 'Valeros' },
    };

    const comp = {
        companionActiveCartridges: {
            [faeChatId]: { cartridgeId: 'fae', genre: 'cosmic_horror', systemLabel: 'Cosmic Horror', config: { heroicTier: false, actionTempo: 'slow_burn' } },
            [pbtaChatId]: { cartridgeId: 'pbta', genre: 'scifi', systemLabel: 'Sci-Fi', config: { harmMax: 5, pacingXp: 5, partyMode: 'solo' } },
            [dndChatId]: { cartridgeId: 'dnd5e', genre: 'fantasy', systemLabel: 'D&D 5e' },
        },
    };

    // Hydrate FAE
    await ensureActiveChatRulesetConsistency(faeChatId, s, null, comp);
    assert.strictEqual(s.systemPromptTemplate, buildFaeSystemPromptTemplate());
    assert.strictEqual(s.modules.xp, false);
    assert.strictEqual(s.modules['benched party'], false);
    assert.strictEqual(isLiveSettingsPollutedWithFae(s), true);

    const expectedFae = buildFaeCartridge('cosmic_horror', {
        id: 'fae_chat_p13_fae',
        campaignTitle: undefined,
        systemLabel: 'Cosmic Horror',
        heroicTier: false,
        config: { heroicTier: false, actionTempo: 'slow_burn', diceFunctionTool: false },
    });
    assert.strictEqual(doesLiveLibraryMatchCartridge(s, expectedFae, 'fae_'), true);

    // Mismatched systemPromptTemplate triggers re-match = false
    const staleCheck = { ...s, systemPromptTemplate: factory.systemPromptTemplate };
    assert.strictEqual(doesLiveLibraryMatchCartridge(staleCheck, expectedFae, 'fae_'), false);

    // Switch to PbtA solo
    await ensureActiveChatRulesetConsistency(pbtaChatId, s, null, comp);
    assert.strictEqual(s.systemPromptTemplate, buildPbtASystemPromptTemplate());
    assert.strictEqual(s.modules.xp, false);
    assert.strictEqual(s.modules['benched party'], false);
    assert.strictEqual(isLiveSettingsPollutedWithPbtA(s), true);

    // Switch to D&D 5e -> cleanseStockDndSettings restores factory systemPromptTemplate and modules
    await ensureActiveChatRulesetConsistency(dndChatId, s, null, comp);
    assert.strictEqual(s.systemPromptTemplate, factory.systemPromptTemplate, 'cleanseStockDndSettings restores D&D systemPromptTemplate');
    assert.strictEqual(s.modules.xp, true, 'D&D xp module restored');
    assert.strictEqual(s.modules['benched party'], true, 'D&D benched party module restored');
    assert.strictEqual(s.modules.spells, true, 'D&D spells module restored');
    assert.strictEqual(isLiveSettingsPollutedWithPbtA(s), false);
    assert.strictEqual(isLiveSettingsPollutedWithFae(s), false);

    // Standalone template-only pollution check
    assert.strictEqual(
        isLiveSettingsPollutedWithPbtA({ systemPromptTemplate: buildPbtASystemPromptTemplate() }),
        true,
    );
    assert.strictEqual(
        isLiveSettingsPollutedWithFae({ systemPromptTemplate: buildFaeSystemPromptTemplate() }),
        true,
    );

    // Cleanse also strips ruleset template cleanly even if modules was initialized empty
    const bareDirty = { systemPromptTemplate: buildFaeSystemPromptTemplate(), customSyspromptLibrary: [{ id: 'fae_x', enabled: true }], modules: {} };
    await cleanseStockDndSettings(bareDirty, { chatId: 'dnd_fallback' });
    assert.strictEqual(bareDirty.systemPromptTemplate, factory.systemPromptTemplate);
    assert.strictEqual(bareDirty.modules.xp, true);
    assert.strictEqual(bareDirty.modules['benched party'], true);
});

test('6. D&D 5e Day 0 memo aligns [XP] and [INVENTORY] with DEFAULT_STOCK_PROMPTS and parses via upstream renderer regex', () => {
    const adapter = new Dnd5eSystemAdapter();
    const memo = adapter.formatInitialMemo({
        meta: { title: 'The Lost Crypt', ruleset: 'dnd5e' },
        protagonist: {
            name: 'Alden',
            class: 'Fighter',
            hitDie: 'd10',
            hp: { current: 12, max: 12 },
            ac: 18,
            stats: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 10 },
            equipment: 'Chain Mail (AC 16), Longsword, Shield (+2 AC), Healing Potion, Rope (50 ft), 25 gp',
        },
    });

    const rx = loadUpstreamBlockRegex();
    const blocks = {};
    for (const [, tag, content] of memo.matchAll(rx)) {
        blocks[tag.trim().toUpperCase()] = content.trim();
    }

    assert.strictEqual(blocks.XP, 'Level: 1 | XP: 0/300', '[XP] must match DEFAULT_STOCK_PROMPTS.xp format');
    assert.strictEqual(systemRegistry.detectRulesetFromMemo(`[XP]\n${blocks.XP}\n[/XP]`), 'dnd5e');

    assert.match(blocks.INVENTORY, /^Gear:\n(?:- .+ \[Common\] \[E\] .+\(~[\d,]+ GP\)\n?)+/m);
    assert.match(blocks.INVENTORY, /^Other Items:\n- 🧪 \[Common\] Healing Potion \(~50 GP\)/m);
    assert.match(blocks.INVENTORY, /- 💰 25 GP$/m);
    assert.ok(!blocks.INVENTORY.includes('[Common] 💰'), 'Bare currency must NOT carry a rarity tag');
});
