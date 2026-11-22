/**
 * tests/cartridge-compiler-and-isolation.test.js — MultiHog Companion
 *
 * Phase 11 regression & contract suite covering:
 * 1. Upstream MultiHog sysprompt compiler delivery (<tone>, <factions>, <world_rules>, <ruleset_note>)
 *    verified against REAL upstream sysprompt.txt, game-systems.js rules, and section-enabled.js.
 * 2. Tri-ruleset campaign context & custom tracker module support across PbtA, FAE, and D&D 5e.
 * 3. Dnd5eSystemAdapter.installCartridge prior-ruleset cleansing & per-chat context injection.
 * 4. Same-ruleset cross-chat isolation (FAE <-> FAE, PbtA <-> PbtA, D&D <-> D&D) via REAL upstream
 *    chat-setup.js (snapshotChatSetup / applyChatSetup global catalog simulation) +
 *    ensureActiveChatRulesetConsistency().
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

import {
    buildPbtACartridge,
    buildCampaignContextSnippets,
    resolveEffectivePbtaGenre,
} from '../pbta-ruleset.js';
import {
    buildFaeCartridge,
    resolveEffectiveFaeGenre,
} from '../fae-ruleset.js';
import { PbtaSystemAdapter } from '../concierge-system-pbta.js';
import { FaeSystemAdapter } from '../concierge-system-fae.js';
import { Dnd5eSystemAdapter } from '../concierge-system-dnd5e.js';
import { syncActiveRulesetRngMode } from '../ruleset-rng-interceptor.js';
import {
    ensureActiveChatRulesetConsistency,
    doesLiveLibraryMatchCartridge,
    cleanseStockDndSettings,
} from '../pbta-ruleset-persistence.js';
import {
    findActiveUnlockedBaseOverride,
    isBaseSectionEnabled,
} from '../../SillyTavern-MultihogDnDFramework/src/state/section-enabled.js';
import {
    snapshotChatSetup,
    applyChatSetup,
} from '../../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js';
import { buildDefaultSettings } from '../../SillyTavern-MultihogDnDFramework/src/state/defaults.js';

const SYSPROMPT_TXT_PATH = new URL('../../SillyTavern-MultihogDnDFramework/sysprompt.txt', import.meta.url);
const GAME_SYSTEMS_PATH = new URL('../../SillyTavern-MultihogDnDFramework/game-systems.js', import.meta.url);

/**
 * Mirrors upstream game-systems.js extractTopLevelSections + normalizeSectionOrder +
 * getSectionRowDescriptor resolution against REAL upstream sysprompt.txt and section-enabled.js,
 * asserting upstream's unlocked_base exclusion predicate still matches game-systems.js source.
 */
function simulateUpstreamSyspromptCompilation(settings) {
    const rawText = fs.readFileSync(SYSPROMPT_TXT_PATH, 'utf8');
    const gsSrc = fs.readFileSync(GAME_SYSTEMS_PATH, 'utf8');

    // Assert upstream's unlocked_base filtering contract hasn't changed silently
    assert.ok(
        gsSrc.includes("p.origin !== 'unlocked_base' || p._chatSetupMember === false"),
        'Upstream normalizeSectionOrder predicate changed; update simulation',
    );

    const tagNameRe = '(?:\\[[^\\]]+\\][\\w_-]*|\\w[\\w_-]*)';
    const baseSections = [];
    for (const m of rawText.matchAll(new RegExp(`<(${tagNameRe})>([\\s\\S]*?)<\\/\\1>`, 'g'))) {
        baseSections.push({ tag: m[1], content: m[2].trim() });
    }
    const baseMap = new Map(baseSections.map(s => [s.tag, s.content]));
    const library = settings.customSyspromptLibrary || [];

    const orderableLibKeys = new Set(
        library
            .filter(p => p.origin !== 'unlocked_base' || p._chatSetupMember === false)
            .map(p => `lib:${p.id}`),
    );
    const baseKeys = baseSections.map(s => `base:${s.tag}`);
    const baseKeySet = new Set(baseKeys);

    let order = (Array.isArray(settings.syspromptSectionOrder) ? settings.syspromptSectionOrder : []).filter(key => {
        if (key.startsWith('base:')) return baseKeySet.has(key);
        if (key.startsWith('lib:')) return orderableLibKeys.has(key);
        return false;
    });

    for (const key of baseKeys) {
        if (!order.includes(key)) order.push(key);
    }

    const newLibKeys = [...orderableLibKeys].filter(key => !order.includes(key));
    if (newLibKeys.length) {
        const constraintsIdx = order.indexOf('base:constraints');
        if (constraintsIdx === -1) order.push(...newLibKeys);
        else order.splice(constraintsIdx, 0, ...newLibKeys);
    }

    const pieces = [];
    for (const key of order) {
        if (key.startsWith('base:')) {
            const tag = key.slice(5);
            const override = findActiveUnlockedBaseOverride(library, tag);
            if (override) {
                if (override.enabled && tag !== 'CYOA_mode') {
                    pieces.push({ key, tag, kind: 'unlocked', id: override.id, content: override.content });
                }
            } else if (isBaseSectionEnabled(tag, settings) && tag !== 'CYOA_mode') {
                pieces.push({ key, tag, kind: 'base', id: null, content: `<${tag}>\n${baseMap.get(tag) || ''}\n</${tag}>` });
            }
        } else if (key.startsWith('lib:')) {
            const id = key.slice(4);
            const item = library.find(p => p.id === id);
            if (item && item.enabled) {
                pieces.push({ key, tag: item.tag, kind: item.origin || 'custom', id: item.id, content: item.content });
            }
        }
    }

    return { order, pieces, compiled: pieces.map(p => p.content).join('\n\n') };
}

const SAMPLE_WORLD_RULES = {
    axioms: [
        {
            title: 'Ash-Struck Sky',
            category: 'ECOLOGY',
            axiom: 'Sunlight never reaches the valley floor; lamps burn purified grease.',
            substitutions: ['Sun -> Red-veined twilight'],
            negativeConstraints: ['No clear blue skies'],
        },
    ],
    customModule: {
        tag: 'ASHLUNG',
        fieldKey: 'ASHLUNG',
        label: 'Ash-Lung',
    },
};

const SAMPLE_FACTIONS = [
    { name: 'Cinder Wardens', standing: 'Hostile', agenda: 'Quarantine the basin' },
    { name: 'Lantern Guild', standing: 'Allied', agenda: 'Keep grease-lamps burning' },
];

test('1. buildCampaignContextSnippets builds orderable origin:"custom" snippets & customModuleTag', () => {
    const { snippets, customModuleTag } = buildCampaignContextSnippets('fae', {
        tone: 'Claustrophobic subterranean dread',
        factions: SAMPLE_FACTIONS,
        worldRules: SAMPLE_WORLD_RULES,
    });

    assert.strictEqual(snippets.length, 3);
    assert.strictEqual(snippets[0].id, 'fae_campaign_tone');
    assert.strictEqual(snippets[0].origin, 'custom');
    assert.ok(snippets[0].content.includes('<tone>'));

    assert.strictEqual(snippets[1].id, 'fae_campaign_factions');
    assert.strictEqual(snippets[1].origin, 'custom');
    assert.ok(snippets[1].content.includes('Cinder Wardens (Hostile)'));

    assert.strictEqual(snippets[2].id, 'fae_custom_world_rules');
    assert.strictEqual(snippets[2].origin, 'custom');
    assert.ok(snippets[2].content.includes('<world_rules>'));

    assert.strictEqual(customModuleTag, 'ASHLUNG');
});

test('2. PbtA & FAE cartridges deliver <tone>, <factions>, <world_rules>, and <ruleset_note> through upstream compiler', () => {
    for (const [label, cartridge] of [
        ['PbtA', buildPbtACartridge('horror', {
            tone: 'Cold Victorian gaslight paranoia',
            factions: SAMPLE_FACTIONS,
            worldRules: SAMPLE_WORLD_RULES,
        })],
        ['FAE', buildFaeCartridge('cosmic_horror', {
            tone: 'Cold Victorian gaslight paranoia',
            factions: SAMPLE_FACTIONS,
            worldRules: SAMPLE_WORLD_RULES,
        })],
    ]) {
        const s = buildDefaultSettings();
        s.customSyspromptLibrary = cartridge.payload.customSyspromptLibrary.map(item => ({
            ...item,
            enabled: item.enabled !== false,
            scope: 'chat',
            _chatSetupMember: true,
        }));
        Object.assign(s.syspromptModules, cartridge.payload.syspromptModules);
        s.blockOrder = [...cartridge.payload.blockOrder];

        assert.ok(s.blockOrder.includes('ASHLUNG'), `${label} blockOrder must include customModule ASHLUNG`);

        const { compiled, pieces } = simulateUpstreamSyspromptCompilation(s);
        const emittedTags = new Set(pieces.map(p => p.tag));

        assert.ok(emittedTags.has('tone'), `${label} compiled prompt must emit <tone>`);
        assert.ok(emittedTags.has('factions'), `${label} compiled prompt must emit <factions>`);
        assert.ok(emittedTags.has('world_rules'), `${label} compiled prompt must emit <world_rules>`);
        assert.ok(emittedTags.has('ruleset_note'), `${label} compiled prompt must emit <ruleset_note>`);

        assert.ok(compiled.includes('Cold Victorian gaslight paranoia'), `${label} compiled prompt contains tone text`);
        assert.ok(compiled.includes('Cinder Wardens (Hostile)'), `${label} compiled prompt contains faction text`);
        assert.ok(compiled.includes('Ash-Struck Sky'), `${label} compiled prompt contains world_rules axiom`);
        assert.ok(compiled.includes('<ruleset_note>'), `${label} compiled prompt contains ruleset_note`);
    }
});

test('3. Solo partyMode preserves disabled <[PARTY]_mechanics> when mapping snippets', () => {
    const pbtaSolo = buildPbtACartridge('fantasy', { config: { partyMode: 'solo' } });
    const pbtaParty = pbtaSolo.payload.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_party');
    assert.strictEqual(pbtaParty.enabled, false, 'PbtA solo cartridge must keep party override disabled');

    const faeSolo = buildFaeCartridge('osr_dungeon', { config: { partyMode: 'solo' } });
    const faeParty = faeSolo.payload.customSyspromptLibrary.find(p => p.id === 'fae_base_override_party');
    assert.strictEqual(faeParty.enabled, false, 'FAE solo cartridge must keep party override disabled');
});

test('4. Dnd5eSystemAdapter.installCartridge cleanses FAE/PbtA pollution and injects D&D campaign context', async () => {
    const adapter = new Dnd5eSystemAdapter();
    const s = buildDefaultSettings();
    const dndChatId = 'chat_dnd_clean_01';

    // Pollute live settings with leftover FAE overrides
    const faePollute = buildFaeCartridge('cosmic_horror', { tone: 'Stale FAE Tone' });
    s.customSyspromptLibrary = faePollute.payload.customSyspromptLibrary.map(p => ({ ...p, _chatSetupMember: true }));
    s.syspromptModules.combat = false;
    s.syspromptModules.saving_throws = false;
    s.stockPrompts.character = 'NO D&D MECHANICS FAE Knobs: Flee Grace: ON';
    s.chatStates = { [dndChatId]: { setup: {} } };
    s.chatStateProjectionOwner = dndChatId;

    const comp = { companionActiveCartridges: {} };
    globalThis.extension_settings = { multihog_companion: comp, rpg_tracker: s };

    const ok = await adapter.installCartridge('dark_fantasy', {
        campaignTitle: 'Ashen Citadels',
        systemLabel: 'D&D Lite (Dark Fantasy)',
        tone: 'Relentless iron-and-ash sword & sorcery',
        factions: SAMPLE_FACTIONS,
        worldRules: SAMPLE_WORLD_RULES,
    }, { chatId: dndChatId, rpgSettings: s });

    assert.strictEqual(ok, true);
    assert.strictEqual(s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_')), false, 'Stale FAE snippets purged');
    assert.strictEqual(s.syspromptModules.combat, true, 'D&D base combat module restored');
    assert.strictEqual(s.syspromptModules.saving_throws, true, 'D&D saving throws restored');
    assert.strictEqual(s.syspromptModules.level_up_protocol, false, 'level_up_protocol kept disabled for Level-Up Concierge');
    assert.strictEqual(s.syspromptModules.world_rules, false, 'Custom D&D world_rules snippet registered');
    assert.ok(s.blockOrder.includes('ASHLUNG'), 'D&D blockOrder includes customModule ASHLUNG');

    const { compiled } = simulateUpstreamSyspromptCompilation(s);
    assert.ok(compiled.includes('Relentless iron-and-ash sword & sorcery'), 'Compiled D&D prompt includes <tone>');
    assert.ok(compiled.includes('Lantern Guild (Allied)'), 'Compiled D&D prompt includes <factions>');
    assert.ok(compiled.includes('Ash-Struck Sky'), 'Compiled D&D prompt includes <world_rules>');
    assert.ok(compiled.includes('active subfooters'), 'Compiled D&D prompt includes D&D subfooter alignment');

    delete globalThis.extension_settings;
});

test('5. Same-ruleset cross-chat bleed (FAE <-> FAE via upstream applyChatSetup) is prevented and preserves diceFunctionTool', async () => {
    const chatA = 'chat_fae_a';
    const chatB = 'chat_fae_b';

    const dossierA = {
        meta: {
            title: 'Whispers Under Innsmouth',
            ruleset: 'fae',
            systemKey: 'cosmic_horror',
            systemLabel: 'FAE: Cosmic Horror',
            tone: 'Salt-rot coastal dread',
        },
        config: { heroicTier: false, diceFunctionTool: true, actionTempo: 'slow_burn' },
        protagonist: { name: 'Thomas', pools: { Health: { label: 'Health', current: 8, max: 8 }, Sanity: { label: 'Sanity', current: 8, max: 8 } } },
        factions: [{ name: 'Esoteric Order', standing: 'Hostile', agenda: 'Flood the harbor' }],
        worldRules: SAMPLE_WORLD_RULES,
    };

    const dossierB = {
        meta: {
            title: 'Barrow of Iron Kings',
            ruleset: 'fae',
            systemKey: 'osr_dungeon',
            systemLabel: 'FAE: OSR Dungeon',
            tone: 'Torchlit tomb-robbing grit',
        },
        config: { heroicTier: true, diceFunctionTool: false, actionTempo: 'action_serial' },
        protagonist: { name: 'Kael', pools: { Health: { label: 'Health', current: 8, max: 8 }, Torch: { label: 'Torch', current: 6, max: 6 } } },
        factions: [],
        worldRules: null,
    };

    const s = buildDefaultSettings();
    s.chatStates = {};

    // Install Chat A first and snapshot via REAL upstream snapshotChatSetup
    const cartA = buildFaeCartridge('cosmic_horror', {
        tone: dossierA.meta.tone,
        factions: dossierA.factions,
        worldRules: dossierA.worldRules,
        pools: dossierA.protagonist.pools,
        character: dossierA.protagonist,
        heroicTier: false,
        diceFunctionTool: true,
        config: dossierA.config,
    });
    s.customSyspromptLibrary = cartA.payload.customSyspromptLibrary.map(item => ({ ...item, enabled: item.enabled !== false, scope: 'chat', _chatSetupMember: true }));
    Object.assign(s.syspromptModules, cartA.payload.syspromptModules);
    Object.assign(s.stockPrompts, cartA.payload.stockPrompts);
    Object.assign(s.cyoaConfig, cartA.payload.cyoaConfig);
    s.diceFunctionTool = true;
    s.chatStates[chatA] = { faeCampaignDossier: dossierA, setup: snapshotChatSetup(s) };

    // Install Chat B next — this overwrites the GLOBAL syspromptSnippetDatabase with Chat B's definitions!
    const cartB = buildFaeCartridge('osr_dungeon', {
        tone: dossierB.meta.tone,
        pools: dossierB.protagonist.pools,
        character: dossierB.protagonist,
        heroicTier: true,
        diceFunctionTool: false,
        config: dossierB.config,
    });
    s.customSyspromptLibrary = cartB.payload.customSyspromptLibrary.map(item => ({ ...item, enabled: item.enabled !== false, scope: 'chat', _chatSetupMember: true }));
    s.syspromptSnippetDatabase = s.syspromptSnippetDatabase.filter(p => !p.id?.startsWith('fae_'));
    Object.assign(s.syspromptModules, cartB.payload.syspromptModules);
    Object.assign(s.stockPrompts, cartB.payload.stockPrompts);
    Object.assign(s.cyoaConfig, cartB.payload.cyoaConfig);
    s.diceFunctionTool = false;
    s.chatStates[chatB] = { faeCampaignDossier: dossierB, setup: snapshotChatSetup(s) };

    // Simulate switching back to Chat A (upstream loadChatState sets projectionOwner = chatA and runs applyChatSetup)
    s.chatStateProjectionOwner = chatA;
    applyChatSetup(s, s.chatStates[chatA].setup);
    assert.ok(
        s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_footer')?.content.includes('Torch'),
        'Precondition: upstream applyChatSetup alone bleeds Chat B Torch footer into Chat A',
    );

    const comp = {
        companionActiveCartridges: {
            [chatA]: { cartridgeId: 'fae', genre: 'cosmic_horror', title: dossierA.meta.title, systemLabel: dossierA.meta.systemLabel, config: dossierA.config },
            [chatB]: { cartridgeId: 'fae', genre: 'osr_dungeon', title: dossierB.meta.title, systemLabel: dossierB.meta.systemLabel, config: dossierB.config },
        },
    };

    const hydrated = await ensureActiveChatRulesetConsistency(chatA, s, null, comp);
    assert.strictEqual(hydrated, true);
    assert.strictEqual(s.diceFunctionTool, true, 'Chat A diceFunctionTool must remain true after rehydration');

    const footerAfter = s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_footer')?.content || '';
    const toneAfter = s.customSyspromptLibrary.find(p => p.id === 'fae_campaign_tone')?.content || '';
    const wrAfter = s.customSyspromptLibrary.find(p => p.id === 'fae_custom_world_rules')?.content || '';
    assert.ok(footerAfter.includes('Sanity') && !footerAfter.includes('Torch'), 'Chat A footer restored to Sanity (no Torch bleed)');
    assert.ok(toneAfter.includes('Salt-rot coastal dread'), 'Chat A <tone> restored');
    assert.ok(wrAfter.includes('Ash-Struck Sky'), 'Chat A <world_rules> restored');
    assert.strictEqual(s.chatStates[chatA].setup.syspromptSnippetStates.fae_custom_world_rules, true, 'Chat A setup snapshot retains fae_custom_world_rules');
    assert.strictEqual(doesLiveLibraryMatchCartridge(s, cartA, 'fae_'), true, 'Live settings now match Chat A FAE cartridge');
});

test('6. Same-ruleset cross-chat bleed (PbtA <-> PbtA) prunes departed worldRules and restores target settings', async () => {
    const chatFantasy = 'chat_pbta_fantasy';
    const chatScifi = 'chat_pbta_scifi';

    const cartScifi = buildPbtACartridge('scifi', {
        tone: 'Neon orbital syndicates',
        worldRules: SAMPLE_WORLD_RULES,
        config: { harmMax: 3, pacingXp: 3, partyMode: 'solo' },
    });
    const cartFantasy = buildPbtACartridge('fantasy', {
        systemLabel: 'Dungeon World',
        tone: 'Mythic moss-grown ruins',
        config: { harmMax: 5, pacingXp: 5, partyMode: 'squad' },
    });

    const s = buildDefaultSettings();
    s.customSyspromptLibrary = cartScifi.payload.customSyspromptLibrary.map(item => ({ ...item, enabled: item.enabled !== false, scope: 'chat', _chatSetupMember: true }));
    s.syspromptSnippetDatabase = s.customSyspromptLibrary.map(sn => ({ ...sn }));
    s.syspromptSectionOrder = ['base:role', 'lib:pbta_custom_world_rules', 'lib:pbta_campaign_tone', 'base:constraints'];
    Object.assign(s.stockPrompts, cartScifi.payload.stockPrompts);
    Object.assign(s.cyoaConfig, cartScifi.payload.cyoaConfig);
    s.chatStateProjectionOwner = chatFantasy;
    s.chatStates = {
        [chatFantasy]: {
            pbtaCampaignDossier: {
                meta: { title: 'Green Crown', ruleset: 'pbta', systemKey: 'fantasy', systemLabel: 'Dungeon World', tone: 'Mythic moss-grown ruins' },
                config: { harmMax: 5, pacingXp: 5, partyMode: 'squad' },
                protagonist: { name: 'Rowan', stats: { Might: 2, Agility: 1, Wits: 0, Heart: 1, Arcana: -1 } },
            },
        },
    };

    const hydrated = await ensureActiveChatRulesetConsistency(chatFantasy, s);
    assert.strictEqual(hydrated, true);
    assert.strictEqual(s.customSyspromptLibrary.some(p => p.id === 'pbta_custom_world_rules'), false, 'Sci-Fi world_rules purged when switching to Fantasy PbtA');
    assert.strictEqual(s.syspromptSnippetDatabase.some(p => p.id === 'pbta_custom_world_rules'), false, 'Sci-Fi world_rules pruned from syspromptSnippetDatabase');
    assert.strictEqual(s.syspromptSectionOrder.includes('lib:pbta_custom_world_rules'), false, 'Stale lib:pbta_custom_world_rules pruned from section order');
    assert.ok(
        s.customSyspromptLibrary.find(p => p.id === 'pbta_campaign_tone')?.content.includes('Mythic moss-grown ruins'),
        'Fantasy PbtA tone restored',
    );
    assert.ok(
        s.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_footer')?.content.includes('/5)'),
        'Fantasy harmMax 5 restored in footer',
    );
    assert.strictEqual(doesLiveLibraryMatchCartridge(s, cartFantasy, 'pbta_'), true);

    // Ensure cleanseStockDndSettings leaves non-companion snippets intact while clearing D&D campaign snippets
    await cleanseStockDndSettings(s, { chatId: 'plain_dnd_chat' });
    assert.strictEqual(s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_')), false);
});

test('7. Switching between Concierge D&D chat (with world_rules) and stock D&D chat isolates campaign context', async () => {
    const conciergeDndChat = 'chat_dnd_concierge_01';
    const stockDndChat = 'chat_dnd_stock_01';
    const adapter = new Dnd5eSystemAdapter();

    const s = buildDefaultSettings();
    s.chatStates = {
        [conciergeDndChat]: {
            companionDossier: {
                meta: { title: 'Ashen Citadels', ruleset: 'dnd5e', systemKey: 'dark_fantasy', tone: 'Grim iron & ash' },
                factions: SAMPLE_FACTIONS,
                worldRules: SAMPLE_WORLD_RULES,
                config: { playstyle: 'cyoa_5' },
            },
        },
        [stockDndChat]: {
            characterName: 'Valeros',
            setup: {},
        },
    };
    const comp = {
        companionActiveCartridges: {
            [conciergeDndChat]: { cartridgeId: 'dnd5e', genre: 'dark_fantasy', title: 'Ashen Citadels' },
            [stockDndChat]: { cartridgeId: 'dnd5e', genre: 'fantasy' },
        },
    };

    await adapter.installCartridge('dark_fantasy', {
        campaignTitle: 'Ashen Citadels',
        tone: 'Grim iron & ash',
        factions: SAMPLE_FACTIONS,
        worldRules: SAMPLE_WORLD_RULES,
        dossier: s.chatStates[conciergeDndChat].companionDossier,
    }, { chatId: conciergeDndChat, rpgSettings: s });

    assert.ok(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_campaign_tone'));
    assert.ok(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_custom_world_rules'));

    // Switch to plain stock D&D chat
    await ensureActiveChatRulesetConsistency(stockDndChat, s, null, comp);
    assert.strictEqual(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_campaign_tone'), false, 'Plain D&D chat must not inherit Concierge D&D <tone>');
    assert.strictEqual(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_custom_world_rules'), false, 'Plain D&D chat must not inherit Concierge D&D <world_rules>');
    assert.strictEqual(s.syspromptModules.world_rules, undefined, 'world_rules override toggle cleared for stock D&D chat');

    // Switch back to Concierge D&D chat
    await ensureActiveChatRulesetConsistency(conciergeDndChat, s, null, comp);
    assert.ok(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_campaign_tone'), 'Concierge D&D <tone> restored on switch back');
    assert.ok(s.customSyspromptLibrary.some(p => p.id === 'dnd5e_custom_world_rules'), 'Concierge D&D <world_rules> restored on switch back');
});

test('8. CART-001: PbtA customGenreSpec survives resolveEffectivePbtaGenre, normalizeProtagonist, hydration, and syncActiveRulesetRngMode', async () => {
    const customGenreSpec = {
        label: 'Vault Survival PbtA',
        stats: ['Grit', 'Tech', 'Nerve', 'Rad', 'Heart'],
        statDescriptions: 'Grit (wasteland brawl), Tech (pre-war circuitry), Nerve (steady under fire), Rad (mutation & stamina), Heart (hope & settlement morale)',
        archetypes: ['Vault Security', 'Follower Medic', 'Caravan Guard'],
        moves: [
            'Jury-Rig Pre-War Tech (+Tech) — coax broken Vault or RobCo hardware into working briefly',
            'Hold the Perimeter (+Grit) — trade fire or hold back wasteland raiders',
        ],
    };

    // A. resolveEffectivePbtaGenre honors dossier.meta.customGenreSpec
    const resolved = resolveEffectivePbtaGenre('custom', { dossier: { meta: { customGenreSpec } } });
    assert.strictEqual(resolved.label, 'Vault Survival PbtA');
    assert.deepStrictEqual(resolved.stats, customGenreSpec.stats);
    assert.ok(resolved.moves[0].includes('Jury-Rig Pre-War Tech'));

    // B. PbtaSystemAdapter.normalizeProtagonist uses customGenreSpec stats & moves
    const adapter = new PbtaSystemAdapter();
    const proto = { name: 'Elena', stats: {}, startingMoves: [], harm: { max: 5, current: 0 } };
    const dossier = {
        meta: { title: 'Vault 19', ruleset: 'pbta', systemKey: 'custom', systemLabel: 'Vault Survival PbtA', customGenreSpec },
        config: { harmMax: 5, diceFunctionTool: false, playstyle: 'cyoa_5' },
        protagonist: proto,
    };
    adapter.normalizeProtagonist(proto, 'custom', dossier);
    assert.deepStrictEqual(Object.keys(proto.stats), customGenreSpec.stats);
    assert.ok(proto.startingMoves[0].includes('Jury-Rig Pre-War Tech'));

    // C. ensureActiveChatRulesetConsistency + syncActiveRulesetRngMode preserve custom moves & stats
    const prevST = globalThis.SillyTavern;
    const prevExt = globalThis.extension_settings;
    try {
        const chatId = 'chat_pbta_custom_genre';
        const s = buildDefaultSettings();
        s.chatStates = { [chatId]: { pbtaCampaignDossier: dossier } };
        s.chatStateProjectionOwner = chatId;
        const comp = {
            companionActiveCartridges: {
                [chatId]: { cartridgeId: 'pbta', genre: 'custom', systemLabel: 'Vault Survival PbtA', customGenreSpec, config: dossier.config },
            },
        };
        globalThis.extension_settings = { rpg_tracker: s, multihog_companion: comp };
        globalThis.SillyTavern = {
            getContext: () => ({
                chatId,
                getCurrentChatId: () => chatId,
                extensionSettings: globalThis.extension_settings,
            }),
        };

        const hydrated = await ensureActiveChatRulesetConsistency(chatId, s, null, comp);
        assert.strictEqual(hydrated, true);

        const roleBeforeTool = s.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_role')?.content || '';
        assert.ok(roleBeforeTool.includes('Jury-Rig Pre-War Tech (+Tech)'), 'Hydrated PbtA role keeps custom moves');
        assert.ok(roleBeforeTool.includes('Grit (wasteland brawl)'), 'Hydrated PbtA role keeps custom statDescriptions');
        assert.ok(!roleBeforeTool.includes('Cast a Spell (+Arcana)'), 'Hydrated PbtA role does not revert to Fantasy moves');

        const expectedCart = buildPbtACartridge('custom', {
            id: `pbta_${chatId}`,
            systemLabel: 'Vault Survival PbtA',
            stats: customGenreSpec.stats,
            startingMoves: proto.startingMoves,
            config: dossier.config,
            customGenreSpec,
            dossier,
        });
        assert.strictEqual(doesLiveLibraryMatchCartridge(s, expectedCart, 'pbta_'), true);

        // Simulate outgoing turn RNG toggle
        s.diceFunctionTool = true;
        syncActiveRulesetRngMode(s);
        const roleAfterRngSync = s.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_role')?.content || '';
        const rngAfterRngSync = s.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_rng')?.content || '';
        assert.ok(roleAfterRngSync.includes('Jury-Rig Pre-War Tech (+Tech)'), 'syncActiveRulesetRngMode must preserve custom moves');
        assert.ok(roleAfterRngSync.includes('Grit (wasteland brawl)'), 'syncActiveRulesetRngMode must preserve custom statDescriptions');
        assert.ok(rngAfterRngSync.includes('"Jury-Rig Pre-War Tech"'), 'syncActiveRulesetRngMode must inject custom move example into tool prompt');
    } finally {
        if (prevST === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = prevST;
        if (prevExt === undefined) delete globalThis.extension_settings;
        else globalThis.extension_settings = prevExt;
    }
});

test('9. CART-002: FAE customGenreSpec pools & Heroic Tier survive normalization, cartridge build, hydration, and syncActiveRulesetRngMode', async () => {
    const customFaeSpec = {
        label: 'Atomic Wasteland',
        pools: [
            { label: 'Health', max: 8, zero_debuff: 'Crippled & Bleeding', recovery: 'camp_or_sleep', overflow: 'scar_and_ko' },
            { label: 'Rad-Load', max: 6, zero_debuff: 'Radiation Sickness', recovery: 'decontamination', overflow: 'lethal' },
        ],
        archetypes: ['Vault Dweller', 'Wasteland Medic'],
    };

    // A. resolveEffectiveFaeGenre converts Ruleset Architect pool array to keyed map
    const resolvedFae = resolveEffectiveFaeGenre('custom', { dossier: { meta: { customGenreSpec: customFaeSpec } } });
    assert.strictEqual(resolvedFae.label, 'Atomic Wasteland');
    assert.strictEqual(resolvedFae.pools.health.max, 8);
    assert.strictEqual(resolvedFae.pools.rad_load.label, 'Rad-Load');
    assert.strictEqual(resolvedFae.pools.rad_load.on_overflow, 'lethal');

    // B. FaeSystemAdapter.normalizeProtagonist populates custom pools when protagonist pools are empty
    const faeAdapter = new FaeSystemAdapter();
    const faeProto = { name: 'Courier Six', pools: {} };
    const faeDossier = {
        meta: { title: 'Mojave', ruleset: 'fae', systemKey: 'custom', systemLabel: 'Atomic Wasteland', customGenreSpec: customFaeSpec },
        config: { heroicTier: true, diceFunctionTool: false, playstyle: 'cyoa_5', actionTempo: 'gritty_default' },
        protagonist: faeProto,
    };
    faeAdapter.normalizeProtagonist(faeProto, 'custom', faeDossier);
    assert.ok(faeProto.pools.rad_load, 'normalizeProtagonist must initialize custom FAE Rad-Load pool');

    // C. buildFaeCartridge + ensureActiveChatRulesetConsistency + syncActiveRulesetRngMode preserve custom pools & Heroic Tier on empty memo
    const prevST = globalThis.SillyTavern;
    const prevExt = globalThis.extension_settings;
    try {
        const chatId = 'chat_fae_custom_heroic';
        const s = buildDefaultSettings();
        s.currentMemo = ''; // Empty initial memo before Turn 1
        s.chatStates = { [chatId]: { faeCampaignDossier: faeDossier } };
        s.chatStateProjectionOwner = chatId;
        const comp = {
            companionActiveCartridges: {
                [chatId]: { cartridgeId: 'fae', genre: 'custom', systemLabel: 'Atomic Wasteland', customGenreSpec: customFaeSpec, config: faeDossier.config },
            },
        };
        globalThis.extension_settings = { rpg_tracker: s, multihog_companion: comp };
        globalThis.SillyTavern = {
            getContext: () => ({
                chatId,
                getCurrentChatId: () => chatId,
                extensionSettings: globalThis.extension_settings,
            }),
        };

        await ensureActiveChatRulesetConsistency(chatId, s, null, comp);
        const footer = s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_footer')?.content || '';
        assert.ok(footer.includes('(Rad-Load: [current]/[max])'), 'Hydrated FAE footer includes custom Rad-Load pool');
        assert.ok(s.stockPrompts.character.includes('Rad-Load: 6/6'), 'Hydrated FAE stockPrompts includes custom Rad-Load bar');

        s.diceFunctionTool = true;
        syncActiveRulesetRngMode(s);
        const roleAfter = s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_role')?.content || '';
        assert.ok(roleAfter.includes('HEROIC DOMAINS (PRE-MATH LEVERAGE PERMISSIONS)'), 'syncActiveRulesetRngMode must keep Heroic Domains even when currentMemo is empty');
    } finally {
        if (prevST === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = prevST;
        if (prevExt === undefined) delete globalThis.extension_settings;
        else globalThis.extension_settings = prevExt;
    }
});

test('10. CART-003: doesLiveLibraryMatchCartridge detects missing customModuleTag in blockOrder', () => {
    const customCart = buildPbtACartridge('fantasy', {
        worldRules: SAMPLE_WORLD_RULES,
    });
    assert.ok(customCart.payload.blockOrder.includes('ASHLUNG'), 'Precondition: cartridge includes customModuleTag ASHLUNG');

    const s = buildDefaultSettings();
    s.customSyspromptLibrary = customCart.payload.customSyspromptLibrary.map(p => ({ ...p, enabled: true }));
    Object.assign(s.stockPrompts, customCart.payload.stockPrompts);
    s.systemPromptTemplate = customCart.payload.systemPromptTemplate;
    Object.assign(s.cyoaConfig, customCart.payload.cyoaConfig);
    s.diceFunctionTool = customCart.payload.diceFunctionTool;
    s.blockOrder = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'TIME']; // Missing ASHLUNG!

    assert.strictEqual(
        doesLiveLibraryMatchCartridge(s, customCart, 'pbta_'),
        false,
        'doesLiveLibraryMatchCartridge must return false when customModuleTag ASHLUNG is missing from s.blockOrder',
    );
});
