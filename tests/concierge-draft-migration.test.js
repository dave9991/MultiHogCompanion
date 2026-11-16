/**
 * tests/concierge-draft-migration.test.js — MultiHog Companion
 *
 * Verifies ruleset draft isolation, corruption resilience, MIG-02 retirement,
 * canonical partition dossier persistence, and dynamic UI ruleset adapter integration.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadValidatedDraft,
    getDraftStorageKey,
} from '../concierge-ui.js';
import { systemRegistry } from '../concierge-system-registry.js';
import { createEmptyDossier } from '../concierge-parser.js';
import {
    getPartitionDossier,
    setPartitionDossier,
    isPbtAActive,
    isFaeActive,
} from '../pbta-ruleset-persistence.js';
import {
    getMultihogPlayerName,
    getMultihogPlayerPortrait,
} from '../persona-matching.js';
import '../concierge-system-pbta.js';
import '../concierge-system-fae.js';
import '../concierge-system-dnd5e.js';

// Setup mock in-memory localStorage for Node test runner
const mockStore = new Map();
globalThis.localStorage = {
    getItem(key) {
        return mockStore.has(key) ? mockStore.get(key) : null;
    },
    setItem(key, value) {
        mockStore.set(key, String(value));
    },
    removeItem(key) {
        mockStore.delete(key);
    },
    clear() {
        mockStore.clear();
    },
};

test('1. Scoped ruleset draft keys and MIG-02 retirement (legacy key ignored)', () => {
    localStorage.clear();

    assert.equal(getDraftStorageKey('pbta'), 'mhc_concierge_draft_pbta');
    assert.equal(getDraftStorageKey('fae'), 'mhc_concierge_draft_fae');
    assert.equal(getDraftStorageKey('dnd5e'), 'mhc_concierge_draft_dnd5e');

    const pbtaDossier = createEmptyDossier('pbta', 'fantasy');
    pbtaDossier.meta.title = 'Legacy PbtA Campaign';
    pbtaDossier.protagonist.name = 'Old Knight';

    const legacyPayload = {
        dossier: pbtaDossier,
        chatHistory: [{ role: 'user', content: 'Create a knight' }],
        changelog: ['Created knight'],
        originChatId: null,
        originCampaignTitle: null,
        timestamp: Date.now(),
    };

    // Legacy key is no longer read after MIG-02 retirement
    localStorage.setItem('mhc_pbta_concierge_draft', JSON.stringify(legacyPayload));
    assert.equal(loadValidatedDraft('pbta'), null, 'Legacy key must not be read after MIG-02 retirement');

    // Scoped keys load properly for pbta, fae, and dnd5e
    localStorage.setItem(getDraftStorageKey('pbta'), JSON.stringify(legacyPayload));
    const result = loadValidatedDraft('pbta');
    assert.ok(result?.draft, 'Scoped PbtA draft must load');
    assert.equal(result.draft.dossier.protagonist.name, 'Old Knight');

    const dndDossier = createEmptyDossier('dnd5e', 'forgotten_realms');
    dndDossier.meta.title = 'Waterdeep Intrigue';
    dndDossier.protagonist.name = 'Lyra';
    localStorage.setItem(getDraftStorageKey('dnd5e'), JSON.stringify({
        dossier: dndDossier,
        chatHistory: [{ role: 'user', content: 'Create a rogue' }],
        changelog: [],
        timestamp: Date.now(),
    }));
    const dndResult = loadValidatedDraft('dnd5e');
    assert.ok(dndResult?.draft, 'Scoped D&D 5e draft must load');
    assert.equal(dndResult.draft.dossier.meta.ruleset, 'dnd5e');
    assert.equal(dndResult.draft.dossier.protagonist.name, 'Lyra');
});

test('2. Multi-ruleset draft isolation prevents cross-engine pollution', () => {
    localStorage.clear();

    // Prepare PbtA draft
    const pbtaDossier = createEmptyDossier('pbta', 'fantasy');
    pbtaDossier.meta.title = 'Dungeon Delve';
    pbtaDossier.protagonist.name = 'Grom';
    const pbtaPayload = {
        dossier: pbtaDossier,
        chatHistory: [{ role: 'user', content: 'Delve' }],
        changelog: ['Started'],
        timestamp: Date.now(),
    };
    localStorage.setItem(getDraftStorageKey('pbta'), JSON.stringify(pbtaPayload));

    // Prepare FAE draft
    const faeDossier = createEmptyDossier('fae', 'cosmic_horror');
    faeDossier.meta.title = 'Arkham Mystery';
    faeDossier.protagonist.name = 'Edward';
    const faePayload = {
        dossier: faeDossier,
        chatHistory: [{ role: 'user', content: 'Investigate' }],
        changelog: ['Investigated'],
        timestamp: Date.now(),
    };
    localStorage.setItem(getDraftStorageKey('fae'), JSON.stringify(faePayload));

    // Verify both exist independently
    assert.ok(localStorage.getItem('mhc_concierge_draft_pbta'));
    assert.ok(localStorage.getItem('mhc_concierge_draft_fae'));

    // Loading PbtA gets PbtA
    const pbtaRes = loadValidatedDraft('pbta');
    assert.equal(pbtaRes.draft.dossier.meta.title, 'Dungeon Delve');
    assert.equal(pbtaRes.draft.dossier.protagonist.name, 'Grom');
    assert.equal(pbtaRes.draft.dossier.meta.ruleset, 'pbta');

    // Loading FAE gets FAE
    const faeRes = loadValidatedDraft('fae');
    assert.equal(faeRes.draft.dossier.meta.title, 'Arkham Mystery');
    assert.equal(faeRes.draft.dossier.protagonist.name, 'Edward');
    assert.equal(faeRes.draft.dossier.meta.ruleset, 'fae');
});

test('3. Draft corruption resilience purges corrupted storage safely', () => {
    localStorage.clear();

    // Store corrupted JSON in scoped key
    localStorage.setItem(getDraftStorageKey('pbta'), '{ bad: json, unclosed');

    const result = loadValidatedDraft('pbta');
    assert.ok(result);
    assert.equal(result.corrupted, true);
    assert.equal(localStorage.getItem(getDraftStorageKey('pbta')), null, 'Corrupted key must be purged');

    // Store incomplete/missing chatHistory draft in FAE scoped key
    localStorage.setItem(getDraftStorageKey('fae'), JSON.stringify({ dossier: {} }));
    const faeCorruptResult = loadValidatedDraft('fae');
    assert.ok(faeCorruptResult);
    assert.equal(faeCorruptResult.corrupted, true);
    assert.equal(localStorage.getItem(getDraftStorageKey('fae')), null, 'Incomplete FAE scoped key must be purged');
});

test('4. Dynamic UI Adapter integration & dial queries', () => {
    const pbtaAdapter = systemRegistry.get('pbta');
    const faeAdapter = systemRegistry.get('fae');

    assert.equal(pbtaAdapter.getAssistantName(), 'PbtA_Concierge');
    assert.equal(faeAdapter.getAssistantName(), 'FAE_Concierge');

    assert.ok(pbtaAdapter.getCritiqueUserInstruction().includes('5-point PbtA design rubric'));
    assert.ok(faeAdapter.getCritiqueUserInstruction().includes('5-point FAE design rubric'));

    assert.equal(pbtaAdapter.hasDial('harmMax'), true);
    assert.equal(pbtaAdapter.hasDial('heroicTier'), false);

    assert.equal(faeAdapter.hasDial('heroicTier'), true);
    assert.equal(faeAdapter.hasDial('actionTempo'), true);
    assert.equal(faeAdapter.hasDial('harmMax'), false);

    // Mock DOM elements container for renderDeckStats
    const mockElements = {
        vitalsEl: {
            _html: '',
            _visible: false,
            html(h) { this._html = h; return this; },
            empty() { this._html = ''; return this; },
            show() { this._visible = true; return this; },
            hide() { this._visible = false; return this; },
        },
        statsEl: {
            _items: [],
            _html: '',
            empty() { this._items = []; this._html = ''; return this; },
            append(item) { this._items.push(item); return this; },
            html(h) { this._html = h; return this; },
        },
        movesEl: {
            _text: '',
            _html: '',
            text(t) { this._text = t; return this; },
            html(h) { this._html = h; return this; },
        },
        heroicEl: {
            _visible: false,
            show() { this._visible = true; return this; },
            hide() { this._visible = false; return this; },
            find() { return { text() {} }; },
        },
    };

    // Test PbtA deck stats rendering
    const pbtaProto = {
        name: 'Fighter',
        stats: { Cool: 2, Hard: 1, Hot: 1, Sharp: 0, Weird: -1 },
        startingMoves: ['Slash — Strike in melee'],
    };
    pbtaAdapter.renderDeckStats(mockElements, pbtaProto, { config: { harmMax: 5 } });
    assert.ok(mockElements.statsEl._items.some(i => i.includes('Cool +2')));
    assert.ok(mockElements.movesEl._html.includes('Slash'));

    // Test FAE deck stats rendering
    const faeProto = {
        name: 'Occultist',
        positiveTags: ['Ward Weaver (barrier protection)', 'Keen Sight'],
        negativeTags: ['Haunted'],
        pools: {
            sanity: { label: 'Sanity', current: 7, max: 8, barColor: 'purple', zero_debuff: 'Madness' },
        },
    };
    faeAdapter.renderDeckStats(mockElements, faeProto, { config: { heroicTier: false } });
    assert.ok(mockElements.vitalsEl._html.includes('Sanity: 7/8'));
    assert.ok(mockElements.statsEl._items.some(i => i.includes('Ward Weaver')));
    assert.ok(mockElements.movesEl._html.includes('Haunted'));
});

test('5. Canonical getPartitionDossier / setPartitionDossier parity across pbta, fae, and dnd5e', () => {
    const dndDossier = createEmptyDossier('dnd5e', 'forgotten_realms');
    dndDossier.protagonist.name = 'Seraphina';
    const faeDossier = createEmptyDossier('fae', 'cosmic_horror');
    faeDossier.protagonist.name = 'Arthur Pendelton';
    faeDossier.protagonist.portraitSrc = 'user/images/arthur.png';
    const pbtaDossier = createEmptyDossier('pbta', 'fantasy');
    pbtaDossier.protagonist.name = 'Kaelen';

    const rpgSettings = {
        chatStates: {
            chat_dnd: {},
            chat_fae: {},
            chat_pbta: {},
            chat_fae_legacy: {
                faeCampaignDossier: faeDossier,
            },
        },
    };
    const compSettings = { companionActiveCartridges: {} };

    // D&D 5e write must populate companionDossier without polluting pbtaCampaignDossier
    setPartitionDossier(rpgSettings.chatStates.chat_dnd, dndDossier, 'dnd5e');
    assert.equal(rpgSettings.chatStates.chat_dnd.companionDossier, dndDossier);
    assert.equal(rpgSettings.chatStates.chat_dnd.pbtaCampaignDossier, undefined);
    assert.equal(rpgSettings.chatStates.chat_dnd.faeCampaignDossier, undefined);
    assert.equal(getPartitionDossier(rpgSettings.chatStates.chat_dnd), dndDossier);
    assert.equal(isPbtAActive('chat_dnd', rpgSettings, compSettings), false);
    assert.equal(isFaeActive('chat_dnd', rpgSettings, compSettings), false);

    // FAE write populates companionDossier and faeCampaignDossier
    setPartitionDossier(rpgSettings.chatStates.chat_fae, faeDossier, 'fae');
    assert.equal(rpgSettings.chatStates.chat_fae.companionDossier, faeDossier);
    assert.equal(rpgSettings.chatStates.chat_fae.faeCampaignDossier, faeDossier);
    assert.equal(rpgSettings.chatStates.chat_fae.pbtaCampaignDossier, undefined);
    assert.equal(isFaeActive('chat_fae', rpgSettings, compSettings), true);
    assert.equal(isPbtAActive('chat_fae', rpgSettings, compSettings), false);

    // PbtA write populates companionDossier and pbtaCampaignDossier
    setPartitionDossier(rpgSettings.chatStates.chat_pbta, pbtaDossier, 'pbta');
    assert.equal(rpgSettings.chatStates.chat_pbta.companionDossier, pbtaDossier);
    assert.equal(rpgSettings.chatStates.chat_pbta.pbtaCampaignDossier, pbtaDossier);
    assert.equal(isPbtAActive('chat_pbta', rpgSettings, compSettings), true);

    // Even if a legacy partition stored a dnd5e dossier in pbtaCampaignDossier, isPbtAActive rejects it
    rpgSettings.chatStates.chat_dnd_polluted = { pbtaCampaignDossier: dndDossier };
    assert.equal(isPbtAActive('chat_dnd_polluted', rpgSettings, compSettings), false);

    // Persona matching resolves FAE protagonist name and portrait from faeCampaignDossier
    assert.equal(getMultihogPlayerName('chat_fae_legacy', rpgSettings), 'Arthur Pendelton');
    assert.equal(getMultihogPlayerPortrait('chat_fae_legacy', null, rpgSettings), 'user/images/arthur.png');
});
