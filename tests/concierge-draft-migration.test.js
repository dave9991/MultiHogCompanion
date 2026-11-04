/**
 * tests/concierge-draft-migration.test.js — MultiHog Companion
 *
 * Verifies Phase 3 modular storage migration, ruleset draft isolation,
 * corruption resilience, and dynamic UI ruleset adapter integration.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadValidatedDraft,
    getDraftStorageKey,
    STORAGE_DRAFT_KEY,
} from '../concierge-ui.js';
import { systemRegistry } from '../concierge-system-registry.js';
import { createEmptyDossier } from '../concierge-parser.js';
import '../concierge-system-pbta.js';
import '../concierge-system-fae.js';

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

test('1. Transparent legacy draft migration (mhc_pbta_concierge_draft -> mhc_concierge_draft_pbta)', () => {
    localStorage.clear();

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

    // Store in legacy key
    localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(legacyPayload));

    assert.equal(localStorage.getItem(STORAGE_DRAFT_KEY) !== null, true);
    assert.equal(localStorage.getItem(getDraftStorageKey('pbta')), null);

    // loadValidatedDraft('pbta') should transparently migrate it
    const result = loadValidatedDraft('pbta');
    assert.ok(result, 'Result must not be null');
    assert.ok(result.draft, 'Draft must be valid');
    assert.equal(result.draft.dossier.protagonist.name, 'Old Knight');

    // Verify key migration
    assert.ok(localStorage.getItem(getDraftStorageKey('pbta')), 'Scoped key must now be populated');
    assert.equal(localStorage.getItem(STORAGE_DRAFT_KEY), null, 'Legacy key must be purged after migration');
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

    // Store incomplete/missing chatHistory draft in legacy key
    localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify({ dossier: {} }));
    const legacyResult = loadValidatedDraft('pbta');
    assert.ok(legacyResult);
    assert.equal(legacyResult.corrupted, true);
    assert.equal(localStorage.getItem(STORAGE_DRAFT_KEY), null, 'Incomplete legacy key must be purged');
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
