/**
 * concierge-sync-chat-affinity.test.js — MultiHog Companion
 *
 * Verifies Chat Affinity for Concierge loaded campaign dossiers:
 * 1. validateDraft preserves originChatId and originCampaignTitle.
 * 2. In-memory Session Zero blueprint is strictly retained across chat switches.
 * 3. '🔄 Sync to Active Game' button is visible when active chat matches origin chat.
 * 4. '🔄 Sync to Active Game' button vanishes when switching to a foreign or non-PbtA chat.
 * 5. '🔄 Sync to Active Game' button reappears automatically when returning to original chat.
 * 6. Fresh Session Zero drafts without an active campaign origin keep the sync button hidden.
 * 7. resetConciergeState cleanses origin tracking and hides the sync button.
 */

import { strict as assert } from 'assert';
import {
    createEmptyDossier,
    validateDraft,
    healAndNormalizeDossier,
} from '../concierge-parser.js';

// Setup Mock DOM and Storage
globalThis.window = globalThis;
const storageMap = new Map();
globalThis.localStorage = {
    getItem: (k) => storageMap.get(k) || null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
};

globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => '',
});

const domState = {
    syncBtnVisible: false,
    loadBtnTitle: '',
    loadBtnHtml: '',
};

globalThis.$ = (selector) => {
    return {
        length: 1,
        show() {
            if (selector === '#mhc_sync_active_campaign_btn') domState.syncBtnVisible = true;
            return this;
        },
        hide() {
            if (selector === '#mhc_sync_active_campaign_btn') domState.syncBtnVisible = false;
            return this;
        },
        attr(name, val) {
            if (val !== undefined) {
                if (selector === '#mhc_load_active_campaign_btn') {
                    domState.loadBtnTitle = val;
                }
                return this;
            }
            return selector === '#mhc_load_active_campaign_btn' ? domState.loadBtnTitle : '';
        },
        html(val) {
            if (val !== undefined) {
                if (selector === '#mhc_load_active_campaign_btn') {
                    domState.loadBtnHtml = val;
                }
                return this;
            }
            return selector === '#mhc_load_active_campaign_btn' ? domState.loadBtnHtml : '';
        },
        is(query) {
            if (selector === '#mhc_concierge_modal') return true;
            if (selector === '#mhc_sync_active_campaign_btn') return domState.syncBtnVisible;
            return false;
        },
        on() { return this; },
        empty() { return this; },
        val() { return ''; },
        fadeIn() { return this; },
        fadeOut() { return this; },
        text() { return this; },
        css() { return this; },
        append() { return this; },
        remove() { return this; },
        children() { return { length: 0 }; },
        find() { return { slideToggle() {}, toggleClass() {} }; },
        closest() { return { find() { return { slideToggle() {} }; }, toggleClass() {} }; },
    };
};

let currentMockChatId = 'Chat_A.jsonl';
const mockRpgSettings = {
    chatStates: {
        'Chat_A.jsonl': {
            pbtaCampaignDossier: {
                meta: {
                    title: 'Concrete & Case Files',
                    systemKey: 'noir',
                    systemLabel: 'City of Mist',
                    premise: 'Hardboiled detective mystery.',
                },
                protagonist: {
                    name: 'Sam Spayd',
                    playbook: 'Private Investigator',
                    stats: { cool: 2, hard: 1, sharp: 1, scrap: 0, weird: -1 },
                },
                config: { harmMax: 5 },
            },
        },
        'Chat_B.jsonl': {
            pbtaCampaignDossier: {
                meta: {
                    title: 'Dungeon of Torment',
                    systemKey: 'fantasy',
                    systemLabel: 'Dungeon World',
                    premise: 'Deep dungeon crawling.',
                },
                protagonist: {
                    name: 'Valerius',
                    playbook: 'Paladin',
                    stats: { cool: 1, hard: 2, sharp: 0, scrap: 1, weird: -1 },
                },
                config: { harmMax: 6 },
            },
        },
        'Chat_Plain.jsonl': {
            // Non-PbtA plain chat
        },
    },
};

globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: {
            rpg_tracker: mockRpgSettings,
            multihog_companion: {},
        },
        getCurrentChatId: () => currentMockChatId,
        chatId: currentMockChatId,
    }),
};

// Import concierge-ui components after mocks are initialized
const {
    loadActiveCampaignDossier,
    updateSyncButtonState,
    refreshConciergeActiveContext,
    setLoadedCampaignOrigin,
    getLoadedCampaignOrigin,
    resetConciergeState,
} = await import('../concierge-ui.js');

console.log('--- Running Concierge Sync Button Chat Affinity & State Retention Test Suite ---');

// ── 1. validateDraft Origin Tracking ───────────────────────────────────────────
console.log('Testing validateDraft preservation of originChatId and originCampaignTitle...');
{
    const baseDossier = createEmptyDossier();
    baseDossier.meta.title = 'Concrete & Case Files';
    baseDossier.protagonist.name = 'Sam Spayd';

    const draftWithOrigin = {
        dossier: baseDossier,
        chatHistory: [{ role: 'assistant', content: 'Welcome' }],
        changelog: ['Harm updated'],
        originChatId: 'Chat_A.jsonl',
        originCampaignTitle: 'Concrete & Case Files',
        timestamp: Date.now(),
    };

    const validated = validateDraft(draftWithOrigin);
    assert.ok(validated, 'Draft with origin must pass validation');
    assert.strictEqual(validated.originChatId, 'Chat_A.jsonl', 'originChatId must be strictly preserved');
    assert.strictEqual(validated.originCampaignTitle, 'Concrete & Case Files', 'originCampaignTitle must be strictly preserved');
    console.log('✓ validateDraft preserves originChatId and originCampaignTitle');
}

// ── 2. loadActiveCampaignDossier Scoping & Resolution ────────────────────────
console.log('Testing loadActiveCampaignDossier for target chats...');
{
    const dossierA = await loadActiveCampaignDossier('Chat_A.jsonl');
    assert.ok(dossierA, 'Chat A campaign must be found');
    assert.strictEqual(dossierA.meta.title, 'Concrete & Case Files');

    const dossierB = await loadActiveCampaignDossier('Chat_B.jsonl');
    assert.ok(dossierB, 'Chat B campaign must be found');
    assert.strictEqual(dossierB.meta.title, 'Dungeon of Torment');

    const dossierPlain = await loadActiveCampaignDossier('Chat_Plain.jsonl');
    assert.strictEqual(dossierPlain, null, 'Plain chat must return null active campaign');
    console.log('✓ loadActiveCampaignDossier correctly resolves campaigns per chat');
}

// ── 3. Chat Affinity & Sync Button Visibility Across Chat Switches ────────────
console.log('Testing Chat Affinity lifecycle across Chat A -> Chat B -> Chat A...');
{
    // Step A: Load active campaign from Chat A
    currentMockChatId = 'Chat_A.jsonl';
    const loadedA = await loadActiveCampaignDossier('Chat_A.jsonl');
    setLoadedCampaignOrigin('Chat_A.jsonl', loadedA.meta.title, loadedA);

    // Verify origin is registered
    const origin = getLoadedCampaignOrigin();
    assert.strictEqual(origin.originChatId, 'Chat_A.jsonl');
    assert.strictEqual(origin.originCampaignTitle, 'Concrete & Case Files');

    // In Chat A, sync button must be visible
    const isVisibleInA = await updateSyncButtonState('Chat_A.jsonl');
    assert.strictEqual(isVisibleInA, true, 'Sync button must be visible in origin Chat A');
    assert.strictEqual(domState.syncBtnVisible, true, 'DOM element must be shown in Chat A');

    // Step B: User switches to second PbtA game (Chat B)
    currentMockChatId = 'Chat_B.jsonl';
    await refreshConciergeActiveContext('Chat_B.jsonl');

    // In Chat B, sync button must VANISH
    assert.strictEqual(domState.syncBtnVisible, false, 'Sync button must vanish in foreign Chat B');
    assert.ok(domState.loadBtnHtml.includes('Dungeon of Torment'), 'Load Active Campaign button should offer Chat B title');

    // The blueprint/dossier origin is still retained (not wiped!)
    const originWhileInB = getLoadedCampaignOrigin();
    assert.strictEqual(originWhileInB.originChatId, 'Chat_A.jsonl', 'Draft origin must be retained while viewing Chat B');

    // Step C: User switches to plain/non-PbtA chat
    currentMockChatId = 'Chat_Plain.jsonl';
    await refreshConciergeActiveContext('Chat_Plain.jsonl');
    assert.strictEqual(domState.syncBtnVisible, false, 'Sync button must vanish in plain non-PbtA chat');

    // Step D: User switches back to original chat (Chat A)
    currentMockChatId = 'Chat_A.jsonl';
    await refreshConciergeActiveContext('Chat_A.jsonl');

    // In Chat A, sync button must REAPPEAR
    assert.strictEqual(domState.syncBtnVisible, true, 'Sync button must automatically reappear when returning to Chat A');
    assert.ok(domState.loadBtnTitle.includes('Concrete & Case Files'), 'Load Active Campaign title must contain full campaign name');
    assert.ok(domState.loadBtnHtml.includes('Concrete & Case'), 'Load Active Campaign button should offer Chat A title');
    console.log('✓ Chat Affinity correctly toggles Sync button visibility across chat switches');
}

// ── 4. Fresh Session Zero Draft (No Active Origin) Guardrail ─────────────────
console.log('Testing fresh Session Zero draft without active origin...');
{
    // Reset state cleanly
    resetConciergeState({ showGreeting: false });
    assert.strictEqual(domState.syncBtnVisible, false, 'Resetting state must hide sync button');
    assert.strictEqual(getLoadedCampaignOrigin().originChatId, null, 'Resetting state must clear originChatId');

    // User drafts a brand new campaign in Session Zero (without clicking "Load Active Campaign")
    currentMockChatId = 'Chat_B.jsonl';
    const isVisibleNewDraft = await updateSyncButtonState('Chat_B.jsonl');
    assert.strictEqual(isVisibleNewDraft, false, 'Fresh unlinked draft must never show Sync button');
    assert.strictEqual(domState.syncBtnVisible, false, 'DOM element must remain hidden for unlinked draft');
    console.log('✓ Fresh unlinked draft does not show Sync button');
}

console.log('--- ALL CONCIERGE SYNC CHAT AFFINITY TESTS PASSED CLEANLY! ---');
