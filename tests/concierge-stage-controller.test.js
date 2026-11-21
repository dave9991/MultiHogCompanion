import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge 4-Step UI Controller & Modal Stepper Test Suite ---');

// ── 1. Modal HTML & CSS Structural Verification ──────────────────────────────
console.log('1. Testing concierge-modal.html 4-step stepper and stage cards...');
const modalHtml = fs.readFileSync(path.join(ROOT_DIR, 'concierge-modal.html'), 'utf8');

// Stepper Bar
assert.ok(modalHtml.includes('id="mhc_new_adventure_stepper"'), 'Must have #mhc_new_adventure_stepper');
assert.ok(modalHtml.includes('id="mhc_step_btn_initial"'), 'Must have #mhc_step_btn_initial');
assert.ok(modalHtml.includes('id="mhc_step_btn_canon"'), 'Must have #mhc_step_btn_canon');
assert.ok(modalHtml.includes('id="mhc_step_btn_adventure"'), 'Must have #mhc_step_btn_adventure');
assert.ok(modalHtml.includes('id="mhc_step_btn_character"'), 'Must have #mhc_step_btn_character');
assert.ok(modalHtml.includes('id="mhc_step_arrow_canon"'), 'Must have #mhc_step_arrow_canon');
assert.ok(modalHtml.includes('id="mhc_step_arrow_adventure"'), 'Must have #mhc_step_arrow_adventure');
assert.ok(modalHtml.includes('id="mhc_step_arrow_character"'), 'Must have #mhc_step_arrow_character');

// Step 1 Cards
assert.ok(modalHtml.includes('id="mhc_card_initial_framing"'), 'Must have #mhc_card_initial_framing');
assert.ok(modalHtml.includes('id="mhc_initial_framing_status"'), 'Must have #mhc_initial_framing_status');
assert.ok(modalHtml.includes('id="mhc_initial_title"'), 'Must have #mhc_initial_title');
assert.ok(modalHtml.includes('id="mhc_initial_premise"'), 'Must have #mhc_initial_premise');
assert.ok(modalHtml.includes('id="mhc_initial_focal_lens"'), 'Must have #mhc_initial_focal_lens');
assert.ok(modalHtml.includes('id="mhc_initial_tone"'), 'Must have #mhc_initial_tone');
assert.ok(modalHtml.includes('id="mhc_card_initial_sources"'), 'Must have #mhc_card_initial_sources');
assert.ok(modalHtml.includes('id="mhc_initial_sources_count"'), 'Must have #mhc_initial_sources_count');
assert.ok(modalHtml.includes('id="mhc_initial_sources_list"'), 'Must have #mhc_initial_sources_list');

// Step 2 Cards
assert.ok(modalHtml.includes('id="mhc_card_canon_entries"'), 'Must have #mhc_card_canon_entries');
assert.ok(modalHtml.includes('id="mhc_deck_canon_count"'), 'Must have #mhc_deck_canon_count');
assert.ok(modalHtml.includes('id="mhc_deck_canon_list"'), 'Must have #mhc_deck_canon_list');

// Step 3 Cards & Ruleset Gate
assert.ok(modalHtml.includes('id="mhc_adventure_ruleset_gate_hint"'), 'Must have #mhc_adventure_ruleset_gate_hint');
assert.ok(modalHtml.includes('id="mhc_header_ruleset_toggle"'), 'Must have #mhc_header_ruleset_toggle');

// Preserved existing cards
assert.ok(modalHtml.includes('id="mhc_deck_world_rules_card"'), 'Must preserve #mhc_deck_world_rules_card');
assert.ok(modalHtml.includes('id="mhc_deck_custom_module_card"'), 'Must preserve #mhc_deck_custom_module_card');
assert.ok(modalHtml.includes('class="mhc-card mhc-card-world-rules"'), 'Must preserve class="mhc-card mhc-card-world-rules"');
assert.ok(modalHtml.includes('class="mhc-card mhc-card-custom-module"'), 'Must preserve class="mhc-card mhc-card-custom-module"');

console.log('2. Testing style.css rules for stepper and stage cards...');
const css = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
assert.ok(css.includes('.mhc-adventure-stepper-bar'), 'Must style .mhc-adventure-stepper-bar');
assert.ok(css.includes('.mhc-step-btn'), 'Must style .mhc-step-btn');
assert.ok(css.includes('.mhc-canon-toggle-btn'), 'Must style .mhc-canon-toggle-btn');
assert.ok(css.includes('.mhc-initial-source-row'), 'Must style .mhc-initial-source-row');

// ── 2. Mock Environment & Controller Execution ────────────────────────────────
console.log('3. Setting up mock environment for concierge-ui controller testing...');

globalThis.window = globalThis;
globalThis.toastr = {
    info: () => {},
    success: () => {},
    warning: () => {},
    error: () => {},
    clear: () => {},
};
globalThis.document = {
    createElement: (tag) => getOrCreateMockElement(tag),
    getElementById: (id) => getOrCreateMockElement('#' + id),
    querySelector: (sel) => getOrCreateMockElement(sel),
    querySelectorAll: (sel) => [getOrCreateMockElement(sel)],
    body: { appendChild: () => {} },
};
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

const elements = new Map();
function getOrCreateMockElement(selector) {
    if (selector && typeof selector === 'object') {
        selector.attrs = selector.attrs || {};
        selector.style = selector.style || {};
        if (!selector.show) selector.show = function() { this.visible = true; return this; };
        if (!selector.hide) selector.hide = function() { this.visible = false; return this; };
        if (!selector.attr) selector.attr = function(k, v) { if (v !== undefined) { this.attrs[k] = v; return this; } return this.attrs[k]; };
        return selector;
    }
    if (!elements.has(selector)) {
        elements.set(selector, {
            selector,
            style: {},
            visible: true,
            classes: new Set(),
            textVal: '',
            htmlVal: '',
            attrs: {},
            props: {},
            childrenList: [],
            handlers: [],
            show() { this.visible = true; return this; },
            hide() { this.visible = false; return this; },
            addClass(c) { this.classes.add(c); return this; },
            removeClass(c) { this.classes.delete(c); return this; },
            hasClass(c) { return this.classes.has(c); },
            text(v) { if (v !== undefined) { this.textVal = String(v); return this; } return this.textVal; },
            html(v) { if (v !== undefined) { this.htmlVal = String(v); return this; } return this.htmlVal; },
            val(v) { if (v !== undefined) { this.textVal = String(v); return this; } return this.textVal; },
            attr(k, v) { if (v !== undefined) { this.attrs[k] = v; return this; } return this.attrs[k]; },
            css() { return this; },
            prop(k, v) { if (v !== undefined) { this.props[k] = v; return this; } return Boolean(this.props[k]); },
            empty() { this.childrenList = []; return this; },
            append(ch) { this.childrenList.push(ch); return this; },
            appendChild(ch) { this.childrenList.push(ch); return ch; },
            children() { return this.childrenList; },
            find() { return this; },
            closest() { return this; },
            is() { return true; },
            on(evt, sel, fn) {
                const handler = typeof sel === 'function' ? sel : fn;
                const delegate = typeof sel === 'string' ? sel : null;
                this.handlers.push({ evt, delegate, handler });
                return this;
            },
            trigger(evt, eventData, targetEl) {
                for (const h of this.handlers) {
                    if (h.evt === evt) {
                        if (h.delegate && targetEl) {
                            const delClean = h.delegate.replace(/^[.#]/, '');
                            const matchSel = targetEl.selector && targetEl.selector.includes(delClean);
                            const matchClass = targetEl.classes && targetEl.classes.has(delClean);
                            if (!matchSel && !matchClass) continue;
                        }
                        h.handler.call(targetEl || this, eventData || { stopPropagation: () => {} });
                    }
                }
                return this;
            },
            fadeIn() { this.visible = true; return this; },
            fadeOut() { this.visible = false; return this; },
            each() { return this; },
            addEventListener() { return this; },
            removeEventListener() { return this; },
            off() { return this; },
            length: 1,
        });
    }
    return elements.get(selector);
}

globalThis.$ = (selector) => {
    if (typeof selector === 'function') {
        // Document ready
        return;
    }
    return getOrCreateMockElement(selector);
};

// Import controller functions from concierge-ui.js
const {
    getConciergeStageState,
    evaluateStepUnlocks,
    setAdventureStep,
    resetConciergeState,
} = await import('../concierge-ui.js');

console.log('4. Testing getConciergeStageState defaults...');
const initialState = getConciergeStageState();
assert.strictEqual(initialState.currentNavMode, 'new-adventure', 'Default nav mode is new-adventure');
assert.strictEqual(initialState.currentAdventureStep, 'initial', 'Default adventure step is initial');
assert.strictEqual(initialState.unlockedSteps.initial, true, 'Initial step is unlocked');
assert.strictEqual(initialState.unlockedSteps.canon, false, 'Canon step is initially locked');
assert.strictEqual(initialState.unlockedSteps.adventure, false, 'Adventure step is initially locked');
assert.strictEqual(initialState.unlockedSteps.character, false, 'Character step is initially locked');

console.log('5. Testing evaluateStepUnlocks progression...');
// Initial evaluate
evaluateStepUnlocks();
let state = getConciergeStageState();
assert.strictEqual(state.unlockedSteps.canon, false, 'Canon remains locked when framing is empty');

// Step transition without unlock should fail
await setAdventureStep('canon');
assert.strictEqual(getConciergeStageState().currentAdventureStep, 'initial', 'Cannot navigate to locked canon step');

// Force navigation allows reaching step
await setAdventureStep('canon', { force: true, skipCanonBuild: true, skipHarmonization: true });
assert.strictEqual(getConciergeStageState().currentAdventureStep, 'canon', 'Force navigation reaches step');

// Return to initial
await setAdventureStep('initial');
assert.strictEqual(getConciergeStageState().currentAdventureStep, 'initial', 'Returned cleanly to initial step');

// Reset state
resetConciergeState({ showGreeting: false });
const resetState = getConciergeStageState();
assert.strictEqual(resetState.currentAdventureStep, 'initial', 'Reset returns to initial step');
assert.strictEqual(resetState.unlockedSteps.canon, false, 'Reset locks canon step');

// ── 3. Character Card Parsing & PNG Text Chunk Extraction ───────────────────
console.log('6. Testing PNG tEXt and iTXt chunk extraction and character card parsing...');

const { extractPngTextChunks, parseCharacterFile } = await import('../concierge-card-reader.js');

function packPngChunk(typeStr, dataBytes) {
    const typeBytes = new TextEncoder().encode(typeStr);
    const len = dataBytes.length;
    const out = new Uint8Array(4 + 4 + len + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, len);
    out.set(typeBytes, 4);
    out.set(dataBytes, 8);
    view.setUint32(8 + len, 0); // CRC
    return out;
}

function createPngWithChunks(chunks = []) {
    const ihdrData = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrChunk = packPngChunk('IHDR', ihdrData);
    const iendChunk = packPngChunk('IEND', new Uint8Array(0));
    const packedChunks = chunks.map(c => packPngChunk(c.type, c.data));
    const totalLen = signature.length + ihdrChunk.length + packedChunks.reduce((a, c) => a + c.length, 0) + iendChunk.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    result.set(signature, offset); offset += signature.length;
    result.set(ihdrChunk, offset); offset += ihdrChunk.length;
    for (const c of packedChunks) {
        result.set(c, offset);
        offset += c.length;
    }
    result.set(iendChunk, offset);
    return result.buffer;
}

function createTextChunkData(keyword, text) {
    const enc = new TextEncoder();
    const kBytes = enc.encode(keyword);
    const tBytes = enc.encode(text);
    const out = new Uint8Array(kBytes.length + 1 + tBytes.length);
    out.set(kBytes, 0);
    out[kBytes.length] = 0;
    out.set(tBytes, kBytes.length + 1);
    return out;
}

function createItxtChunkData(keyword, text) {
    const enc = new TextEncoder();
    const kBytes = enc.encode(keyword);
    const textBytes = enc.encode(text);
    // keyword + \0 + compFlag(0) + compMethod(0) + langTag(\0) + transKey(\0) + text
    const out = new Uint8Array(kBytes.length + 1 + 2 + 1 + 1 + textBytes.length);
    let offset = 0;
    out.set(kBytes, offset); offset += kBytes.length;
    out[offset++] = 0; // null separator
    out[offset++] = 0; // uncompressed
    out[offset++] = 0; // compression method
    out[offset++] = 0; // empty lang tag null separator
    out[offset++] = 0; // empty trans key null separator
    out.set(textBytes, offset);
    return out;
}

const v2CardJson = JSON.stringify({
    name: 'Lyra Moonshadow',
    description: 'An elusive rogue',
    personality: 'Clever and watchful',
    scenario: 'Sneaking into the archives',
});

const v3CardJson = JSON.stringify({
    spec: 'chara_card_v3',
    data: {
        name: 'Kaelen Dawnstrider',
        description: 'A disciplined paladin',
        personality: 'Steadfast and just',
        scenario: 'Defending the citadel gates',
    },
});

// tEXt chara chunk test
const textPngBuf = createPngWithChunks([
    { type: 'tEXt', data: createTextChunkData('chara', Buffer.from(v2CardJson).toString('base64')) },
]);
const textChunksRes = extractPngTextChunks(textPngBuf);
assert.ok(textChunksRes['chara'], 'extractPngTextChunks must find chara tEXt chunk');
const parsedTextCard = await parseCharacterFile({
    name: 'lyra.png',
    type: 'image/png',
    arrayBuffer: async () => textPngBuf,
});
assert.strictEqual(parsedTextCard.name, 'Lyra Moonshadow');
assert.strictEqual(parsedTextCard.avatar, null);

// iTXt ccv3 chunk test with whitespace in base64
const rawB64WithWhitespace = Buffer.from(v3CardJson).toString('base64').replace(/(.{15})/g, '$1\r\n  ');
const itxtPngBuf = createPngWithChunks([
    { type: 'iTXt', data: createItxtChunkData('ccv3', rawB64WithWhitespace) },
]);
const itxtChunksRes = extractPngTextChunks(itxtPngBuf);
assert.ok(itxtChunksRes['ccv3'], 'extractPngTextChunks must find ccv3 iTXt chunk');
const parsedItxtCard = await parseCharacterFile({
    name: 'kaelen.png',
    type: 'image/png',
    arrayBuffer: async () => itxtPngBuf,
});
assert.strictEqual(parsedItxtCard.name, 'Kaelen Dawnstrider');
assert.strictEqual(parsedItxtCard.avatar, null);
assert.ok(parsedItxtCard.description.includes('paladin'));

// ── 4. Character Card Attachment to Session Zero & Removal ───────────────────
console.log('7. Testing attachCharacterCardToSession, initial sources list & chip removal...');

const {
    attachCharacterCardToSession,
    isConciergeCreatedDossier,
    loadActiveCampaignDossier,
    refreshConciergeActiveContext,
    openConciergeModal,
    bindModalEvents,
} = await import('../concierge-ui.js');
const { getStagedSourcesSummary } = await import('../concierge-canon.js');

// Reset to clean initial state
resetConciergeState({ showGreeting: false });
bindModalEvents();

// Attach card
attachCharacterCardToSession(parsedItxtCard);

// 1. Verify Canon staging
const stagedSources = getStagedSourcesSummary();
const charCanonSource = stagedSources.find(s => s.name === 'Kaelen Dawnstrider (Character Card)');
assert.ok(charCanonSource, 'Character card must be staged as raw Canon source');
assert.strictEqual(charCanonSource.type, 'char');

// 2. Verify initial sources card update
const sourcesListEl = getOrCreateMockElement('#mhc_initial_sources_list');
assert.ok(sourcesListEl.childrenList.length > 0, '#mhc_initial_sources_list must contain rendered source');
assert.ok(sourcesListEl.childrenList.some(html => html.includes('Kaelen Dawnstrider (Character Card)')), 'Rendered source must include card name');

// 3. Verify removal via source remove button
const modalEl = getOrCreateMockElement('#mhc_concierge_modal');
const fakeSourceRemoveBtn = getOrCreateMockElement('.mhc-source-remove-btn');
fakeSourceRemoveBtn.attr('data-name', 'Kaelen Dawnstrider (Character Card)');
modalEl.trigger('click', { stopPropagation: () => {} }, fakeSourceRemoveBtn);

const stagedAfterRemove = getStagedSourcesSummary();
assert.ok(!stagedAfterRemove.some(s => s.name === 'Kaelen Dawnstrider (Character Card)'), 'Source must be unstaged after source remove button click');

// ── 5. Living World Button Suppression on Non-Concierge Adventures ────────────
console.log('8. Testing isConciergeCreatedDossier and Living World visibility...');

const { scaffoldDossierStubForChat, persistCompanionDossier } = await import('../level-up-scaffold.js');

// 1. Stub from Character Desk
const rawBarbarianMemo = `[CHARACTER]
Garrick (Barbarian): 18/18 HP
Combat: BAB: +1 | Melee: +4
HD: d12 (18/18)
[/CHARACTER]`;

const stubDossier = scaffoldDossierStubForChat('chat_stub_999', rawBarbarianMemo, "Garrick's Adventure");
assert.strictEqual(isConciergeCreatedDossier(stubDossier), false, 'Auto-scaffolded stub must NOT be conciergeCreated');

// Persist blueprint onto stub
stubDossier.progressionBlueprint = {
    className: 'Barbarian',
    hitDie: 'd12',
    levels: { 1: { features: ['Rage', 'Unarmored Defense'] } },
};
persistCompanionDossier('chat_stub_999', stubDossier);
// Even after persistCompanionDossier sets isStub = false, autoScaffolded is still true:
assert.strictEqual(isConciergeCreatedDossier(stubDossier), false, 'Stub with progressionBlueprint must still return false');

// 2. Genuine Concierge Dossier
const conciergeDossier = {
    meta: {
        chatId: 'chat_concierge_100',
        title: 'Sunken Citadel Delve',
        systemKey: 'pbta',
        conciergeCreated: true,
        premise: 'A lost temple swallowed by an ancient fissure',
    },
    protagonist: { name: 'Kaelen', class: 'Paladin' },
    theKick: { startingLocation: 'Oakhaven Village' },
    npcs: [{ name: 'Garrow', role: 'Guide' }],
};
assert.strictEqual(isConciergeCreatedDossier(conciergeDossier), true, 'Genuine Concierge dossier must return true');

// 3. loadActiveCampaignDossier on stub chat vs concierge chat
globalThis.SillyTavern = {
    getContext: () => ({
        getCurrentChatId: () => 'chat_stub_999',
        chatMetadata: { chat_id: 'chat_stub_999' },
        extensionSettings: {
            rpg_tracker: {
                chatStates: {
                    chat_stub_999: {
                        companionDossier: stubDossier,
                    },
                    chat_concierge_100: {
                        campaignDossier: conciergeDossier,
                    },
                },
            },
        },
    }),
};

const loadedStub = await loadActiveCampaignDossier('chat_stub_999');
assert.strictEqual(loadedStub, null, 'loadActiveCampaignDossier must ignore auto-scaffolded stub and return null');

const loadedConcierge = await loadActiveCampaignDossier('chat_concierge_100');
assert.ok(loadedConcierge, 'loadActiveCampaignDossier must return genuine Concierge dossier');
assert.strictEqual(loadedConcierge.meta.title, 'Sunken Citadel Delve');

// 4. refreshConciergeActiveContext hides Living World button for stub
const livingWorldNavBtn = getOrCreateMockElement('.mhc-mode-nav-btn[data-nav-mode="living-world"]');
const activeGameLabel = getOrCreateMockElement('#mhc_active_game_label');

await refreshConciergeActiveContext('chat_stub_999');
assert.strictEqual(livingWorldNavBtn.visible, false, 'Living World nav button must be hidden for stub chat');
assert.strictEqual(activeGameLabel.visible, false, 'Active Game label must be hidden for stub chat');

// 5. refreshConciergeActiveContext shows Living World button for Concierge chat
await refreshConciergeActiveContext('chat_concierge_100');
assert.strictEqual(livingWorldNavBtn.visible, true, 'Living World nav button must be visible for Concierge chat');
assert.strictEqual(activeGameLabel.visible, true, 'Active Game label must be visible for Concierge chat');
assert.ok(!modalHtml.includes('id="mhc_load_active_campaign_btn"'), 'concierge-modal.html must NOT contain obsolete #mhc_load_active_campaign_btn');

// 6. openConciergeModal with navMode: 'living-world' on stub falls back to new-adventure
await openConciergeModal({ ruleset: 'pbta', navMode: 'living-world' });
assert.strictEqual(getConciergeStageState().currentNavMode, 'new-adventure', 'openConciergeModal must fall back to new-adventure when no Concierge dossier exists');

// ── 6. Two-Track Isolation & Fork as New Campaign ──────────────────────────
console.log('9. Testing Two-Track Isolation (Session Zero <-> Living World) and Fork Campaign...');

const {
    switchToTrack,
    forkActiveCampaignToSessionZero,
    getActiveConciergeDossier,
    updateBlueprintDeck,
} = await import('../concierge-ui.js');

// Verify modal HTML has two-track elements
assert.ok(modalHtml.includes('id="mhc_active_game_label"'), 'concierge-modal.html must contain #mhc_active_game_label');
assert.ok(modalHtml.includes('id="mhc_active_game_title"'), 'concierge-modal.html must contain #mhc_active_game_title');
assert.ok(modalHtml.includes('class="mhc-track-group mhc-track-active-game"'), 'concierge-modal.html must contain active game track group');
assert.ok(modalHtml.includes('class="mhc-track-group mhc-track-sandbox"'), 'concierge-modal.html must contain sandbox track group');
assert.ok(modalHtml.includes('id="mhc_fork_campaign_btn"'), 'concierge-modal.html must contain #mhc_fork_campaign_btn');
assert.ok(css.includes('.mhc-track-group'), 'style.css must style .mhc-track-group');
assert.ok(css.includes('.mhc-track-divider'), 'style.css must style .mhc-track-divider');

// A. Start fresh in Session Zero
resetConciergeState({ showGreeting: true });
assert.strictEqual(getConciergeStageState().currentNavMode, 'new-adventure');

// Verify greeting has no "PbtA" mention
const initialTitleEl = getOrCreateMockElement('#mhc_initial_title');
updateBlueprintDeck();
assert.strictEqual(initialTitleEl.attrs?.text || initialTitleEl.text?.(), 'Untitled Campaign', 'Step 1 framing title must display Untitled Campaign without ruleset suffix');

// Setup a Session Zero draft with custom premise and step
const sessionDossier = getActiveConciergeDossier();
sessionDossier.meta = sessionDossier.meta || {};
sessionDossier.meta.title = 'My Sandbox Adventure';
sessionDossier.meta.premise = 'A mysterious uncharted island emerges in the mist.';
sessionDossier.meta.rulesetConfirmed = false;

// B. Switch to Living World (on chat_concierge_100)
globalThis.SillyTavern.getContext = () => ({
    getCurrentChatId: () => 'chat_concierge_100',
    chatMetadata: { chat_id: 'chat_concierge_100' },
    extensionSettings: {
        rpg_tracker: {
            chatStates: {
                chat_concierge_100: {
                    campaignDossier: conciergeDossier,
                },
            },
        },
    },
});

const switchedToLiving = await switchToTrack('living-world');
assert.strictEqual(switchedToLiving, true, 'Switching to living-world with valid concierge dossier must succeed');
assert.strictEqual(getConciergeStageState().currentNavMode, 'living-world', 'Nav mode must be living-world');

const livingDossier = getActiveConciergeDossier();
assert.strictEqual(livingDossier.meta.title, 'Sunken Citadel Delve', 'Living World must load active campaign title');
assert.strictEqual(livingDossier._originChatId, 'chat_concierge_100', 'Living World must record origin chatId');

// Check button visibility in Living World
const forkBtn = getOrCreateMockElement('#mhc_fork_campaign_btn');
const syncBtn = getOrCreateMockElement('#mhc_sync_active_campaign_btn');
const saveDraftBtn = getOrCreateMockElement('#mhc_save_draft_btn');
const stepperBar = getOrCreateMockElement('#mhc_new_adventure_stepper');

assert.strictEqual(forkBtn.visible, true, 'Fork button must be visible in Living World');
assert.strictEqual(syncBtn.visible, true, 'Sync button must be visible in Living World');
assert.strictEqual(saveDraftBtn.visible, false, 'Save Draft button must be hidden in Living World');
assert.strictEqual(stepperBar.visible, false, 'Stepper bar must be hidden in Living World');

// C. Switch back to Session Zero Concierge
const switchedToSessionZero = await switchToTrack('new-adventure');
assert.strictEqual(switchedToSessionZero, true, 'Switching to new-adventure must succeed');
assert.strictEqual(getConciergeStageState().currentNavMode, 'new-adventure', 'Nav mode must be new-adventure');

const restoredSessionDossier = getActiveConciergeDossier();
assert.strictEqual(restoredSessionDossier.meta.title, 'My Sandbox Adventure', 'Session Zero title must be pristine without Living World bleed-over');
assert.strictEqual(restoredSessionDossier.meta.premise, 'A mysterious uncharted island emerges in the mist.', 'Session Zero premise must be preserved');
assert.strictEqual(restoredSessionDossier._originChatId, undefined, 'Session Zero must have no _originChatId');

// Check button and stepper visibility in Session Zero
assert.strictEqual(forkBtn.visible, false, 'Fork button must be hidden in Session Zero');
assert.strictEqual(syncBtn.visible, false, 'Sync button must be hidden in Session Zero');
assert.strictEqual(saveDraftBtn.visible, true, 'Save Draft button must be visible in Session Zero');
assert.strictEqual(stepperBar.visible, true, 'Stepper bar must be visible in Session Zero');

// D. Test Fork as New Campaign
// Switch back to living world first
await switchToTrack('living-world');

// User cancels prompt
globalThis.__MHC_TEST_AUTO_CONFIRM__ = false;
const cancelledFork = await forkActiveCampaignToSessionZero();
assert.strictEqual(cancelledFork, false, 'Cancelling fork prompt must abort fork');
assert.strictEqual(getConciergeStageState().currentNavMode, 'living-world', 'Mode must remain living-world after cancellation');

// User confirms prompt
globalThis.__MHC_TEST_AUTO_CONFIRM__ = true;
const forked = await forkActiveCampaignToSessionZero();
assert.strictEqual(forked, true, 'forkActiveCampaignToSessionZero must succeed');
assert.strictEqual(getConciergeStageState().currentNavMode, 'new-adventure', 'After fork, mode must transition to new-adventure');

const forkedDossier = getActiveConciergeDossier();
assert.strictEqual(forkedDossier.meta.title, 'Sunken Citadel Delve (Fork)', 'Forked dossier title must be appended with (Fork)');
assert.strictEqual(forkedDossier.meta.rulesetConfirmed, false, 'Forked dossier rulesetConfirmed must be reset to false for Step 3 confirmation');
assert.strictEqual(forkedDossier._originChatId, undefined, 'Forked dossier must not retain _originChatId');
assert.strictEqual(forkedDossier.meta.chatId, undefined, 'Forked dossier must not retain meta.chatId');
assert.strictEqual(getConciergeStageState().currentAdventureStep, 'initial', 'Forked dossier must start at Step 1 (initial)');
assert.strictEqual(getConciergeStageState().unlockedSteps.character, true, 'Forked dossier must have all stages unlocked for editing');

// Clean up test flag
delete globalThis.__MHC_TEST_AUTO_CONFIRM__;

// ── 10. Direct ConciergeStateStore Unit Isolation Verification ────────────────
console.log('10. Testing ConciergeStateStore directly for zero cross-track state bleed...');

const { ConciergeStateStore } = await import('../concierge-state-store.js');
const { createEmptyDossier } = await import('../concierge-parser.js');

const store = new ConciergeStateStore();
assert.strictEqual(store.hasSessionZeroProgress(), false, 'Fresh ConciergeStateStore must report no Session Zero progress');

const s0Dossier = createEmptyDossier('pbta', 'fantasy');
s0Dossier.meta.title = 'Broken Crown';
s0Dossier.meta.premise = 'A shattered kingdom awaits a new regent.';

store.snapshotToSessionZero({
    dossier: s0Dossier,
    chatHistory: [{ role: 'user', content: 'Build a political intrigue campaign' }],
    changelog: ['Set title to Broken Crown'],
    currentAdventureStep: 'canon',
    unlockedSteps: { initial: true, canon: true, adventure: false, character: false },
    stageChatHistories: { initial: [{ role: 'user', content: 'hi' }], canon: [], adventure: [], character: [] },
    lastSyncedSnapshots: { framing: { title: 'Broken Crown' }, canon: null, adventure: null },
    attachedSources: [{ name: 'notes.md' }],
    pendingAttachments: [],
    activeImports: [],
}, [{ id: 'c1', name: 'Iron Guild' }]);

assert.strictEqual(store.hasSessionZeroProgress(), true, 'Snapshot must register Session Zero progress');

const lwDossier = createEmptyDossier('fae', 'cosmic_horror');
lwDossier.meta.title = 'Innsmouth Tides';
lwDossier.canonLorebookEntries = [{ id: 'lw1', name: 'Esoteric Order' }];
const hydrated = store.hydrateLivingWorld('chat_innsmouth', lwDossier);
assert.strictEqual(hydrated.chatId, 'chat_innsmouth');
assert.strictEqual(hydrated.campaignTitle, 'Innsmouth Tides');
assert.strictEqual(hydrated.dossier._originChatId, 'chat_innsmouth');
assert.strictEqual(hydrated.dossier.meta.rulesetConfirmed, true);
assert.strictEqual(hydrated.stagedCanonEntries.length, 1);
assert.strictEqual(hydrated.chatHistory.length, 1);

const restored = store.restoreFromSessionZero();
assert.strictEqual(restored.dossier.meta.title, 'Broken Crown');
assert.strictEqual(restored.currentAdventureStep, 'canon');
assert.strictEqual(restored.stagedCanonEntries[0].name, 'Iron Guild');
assert.strictEqual(restored.attachedSources[0].name, 'notes.md');
assert.strictEqual(restored.dossier._originChatId, undefined);

const forkedTrack = store.forkToSessionZero(hydrated.dossier);
assert.strictEqual(forkedTrack.dossier.meta.title, 'Innsmouth Tides (Fork)');
assert.strictEqual(forkedTrack.dossier.meta.rulesetConfirmed, false);
assert.strictEqual(forkedTrack.dossier._originChatId, undefined);
assert.strictEqual(forkedTrack.unlockedSteps.character, true);
assert.strictEqual(forkedTrack.currentAdventureStep, 'initial');
assert.strictEqual(forkedTrack.stagedCanonEntries[0].name, 'Esoteric Order');

store.applyDraftToSessionZero({
    dossier: s0Dossier,
    currentAdventureStep: 'adventure',
    unlockedSteps: { adventure: true },
    chatHistory: [{ role: 'assistant', content: 'Draft resumed' }],
    changelog: ['Resumed'],
    stagedCanonEntries: [{ id: 'c2', name: 'Silver Watch' }],
});
assert.strictEqual(store.sessionZeroTrack.currentAdventureStep, 'adventure');
assert.strictEqual(store.sessionZeroTrack.unlockedSteps.adventure, true);
assert.strictEqual(store.sessionZeroTrack.stagedCanonEntries[0].name, 'Silver Watch');

console.log('11. Testing CONC-010 (Step 3 gate behind Step 2 unlock) & CONC-014 (Pre-imported Step 2 initialization)...');
const { setStagedCanonEntries, clearStagedCanon } = await import('../concierge-canon.js');
resetConciergeState({ showGreeting: false });
clearStagedCanon();
setStagedCanonEntries([
    {
        id: 'FACTION:Vault City',
        kind: 'FACTION',
        name: 'Vault City',
        comment: '[FACTION] Vault City',
        content: 'An isolationist technocracy on the frontier.',
        disabled: false,
    },
]);
evaluateStepUnlocks();
const gatedState = getConciergeStageState();
assert.strictEqual(gatedState.unlockedSteps.canon, false, 'Canon remains locked when framing is incomplete');
assert.strictEqual(gatedState.unlockedSteps.adventure, false, 'CONC-010: Adventure must NOT unlock while Canon is still locked');

// Complete framing -> Step 2 unlocks -> entering Step 2 with pre-imported lore initializes welcome bubble + stageNotes.canon
const liveDossier = getActiveConciergeDossier();
liveDossier.meta.premise = 'Patrol the eastern border as a Ranger.';
liveDossier.meta.focalLens = 'Arroyo Crossing';
liveDossier.meta.framingComplete = true;
evaluateStepUnlocks();
assert.strictEqual(getConciergeStageState().unlockedSteps.canon, true, 'Framing complete unlocks Step 2 Canon');

await setAdventureStep('canon');
const chatChildren = document.getElementById('mhc_chat_messages').children();
assert.ok(chatChildren.length > 0, 'CONC-014: Entering Step 2 with pre-imported Canon must render Series Bible welcome bubble');
assert.ok(chatChildren.some(el => (el.innerHTML || el.htmlVal || '').includes('Series Bible Canon Ready')), 'Welcome bubble text must announce loaded Series Bible');
assert.strictEqual(getConciergeStageState().unlockedSteps.adventure, true, 'Step 3 Adventure unlocks after Step 2 is entered with Canon');
assert.ok((getActiveConciergeDossier().meta.stageNotes.canon || '').includes('Vault City'), 'Step 2 entry must populate stageNotes.canon with active factions');
clearStagedCanon();

console.log('12. Testing Phase 3 CONC-015 (Header Badge Safety), CONC-016 (Launch Gate), & CONC-018 (Factions/Calibration Snapshots)...');
const { extractAgnosticAdventureBones, snapshotAdventure, computeAdventureDiff } = await import('../concierge-canon.js');
resetConciergeState({ showGreeting: false });
const phase3Dossier = getActiveConciergeDossier();
phase3Dossier.meta.title = 'Frontier Law';
phase3Dossier.meta.premise = 'A patrol along the saline border.';
phase3Dossier.meta.focalLens = 'Arroyo Crossing';
phase3Dossier.meta.framingComplete = true;
phase3Dossier.meta.ruleset = 'pbta';
phase3Dossier.meta.rulesetConfirmed = true;
phase3Dossier.meta.systemKey = 'post_apocalyptic';
phase3Dossier.meta.systemLabel = 'Apocalypse Frontier';
phase3Dossier.theKick = { startingLocation: 'Arroyo Crossing', crisis: 'Raiders breach the sluice' };
phase3Dossier.factions = [{ name: 'Vault City', goal: 'Annex the sluice', disposition: 'Guarded', notes: 'Well-armed' }];
phase3Dossier.protagonist.name = '';

await setAdventureStep('adventure', { force: true, skipHarmonization: true });
evaluateStepUnlocks();
const launchBtnMock = getOrCreateMockElement('#mhc_launch_campaign_btn');
assert.strictEqual(getConciergeStageState().unlockedSteps.character, true, 'Step 4 unlocks once rulesetConfirmed + Episode 1 content exist');
assert.strictEqual(launchBtnMock.prop('disabled'), true, 'CONC-016: Launch button must remain disabled in Step 3 without named protagonist');
assert.ok((launchBtnMock.attr('title') || '').includes('Complete Step 4'), 'Disabled Launch button explains Step 4 requirement');

await setAdventureStep('character', { force: true, skipHarmonization: true });
evaluateStepUnlocks();
assert.strictEqual(launchBtnMock.prop('disabled'), true, 'CONC-016: Launch button must remain disabled on empty Step 4 entry until protagonist is named');

phase3Dossier.protagonist.name = 'Elena Vance';
evaluateStepUnlocks();
assert.strictEqual(launchBtnMock.prop('disabled'), false, 'CONC-016: Launch button enables once Step 4 has a named protagonist');

// CONC-015: Clicking header system badge in new-adventure mode must NOT wipe activeDossier
getOrCreateMockElement('#mhc_header_system_badge').trigger('click');
assert.strictEqual(getActiveConciergeDossier().meta.title, 'Frontier Law', 'CONC-015: Clicking header badge in new-adventure mode must not reset dossier');

// CONC-018: Agnostic bones & adventure snapshots preserve factions + ruleset calibration
const bones = extractAgnosticAdventureBones(phase3Dossier);
assert.strictEqual(bones.factions.length, 1);
assert.strictEqual(bones.factions[0].name, 'Vault City');

const snapBefore = snapshotAdventure(phase3Dossier);
phase3Dossier.meta.systemKey = 'noir_intrigue';
phase3Dossier.meta.systemLabel = 'Noir Intrigue';
phase3Dossier.factions.push({ name: 'Caravan Guild', goal: 'Keep water flowing' });
const advDiff = computeAdventureDiff(snapBefore, snapshotAdventure(phase3Dossier));
assert.strictEqual(advDiff.hasChanges, true, 'CONC-018: computeAdventureDiff detects calibration and faction edits');
assert.ok(advDiff.block.includes('Ruleset calibration changed'));
assert.ok(advDiff.block.includes('Added Factions: Caravan Guild'));

console.log('13. Testing Phase 4 CONC-024 (Living World Badge Safety) & CONC-021/022 (Runner Sync & Launch Partition Invariants)...');
// CONC-024: Header system badge in living-world mode must NOT reset/wipe the loaded campaign
globalThis.SillyTavern.getContext = () => ({
    getCurrentChatId: () => 'chat_concierge_100',
    chatMetadata: { chat_id: 'chat_concierge_100' },
    extensionSettings: {
        rpg_tracker: {
            chatStates: {
                chat_concierge_100: {
                    campaignDossier: conciergeDossier,
                },
            },
        },
    },
});
const lwEntered = await switchToTrack('living-world');
assert.strictEqual(lwEntered, true, 'Switching to living-world for CONC-024 check must succeed');
getOrCreateMockElement('#mhc_header_system_badge').trigger('click');
assert.strictEqual(getActiveConciergeDossier().meta.title, 'Sunken Citadel Delve', 'CONC-024: Clicking header badge in living-world mode must NOT wipe campaign');
assert.strictEqual(getConciergeStageState().currentNavMode, 'living-world');
await switchToTrack('new-adventure');

// CONC-021: syncPbtaCampaignUpdates runs cleanly with options, strips NameRAG tokens, and records adapter.id for D&D 5e
const { configureRuntimeActions } = await import('../../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
configureRuntimeActions({
    saveSettings: () => {},
    refreshRenderedView: () => {},
    syncMemoView: () => {},
    autoApplySysprompt: async () => {},
});
const { syncPbtaCampaignUpdates } = await import('../concierge-runner.js');
const syncRpgSettings = {
    chatStates: {
        chat_sync_dnd: {},
    },
};
const syncChatMeta = { chat_id: 'chat_sync_dnd' };
globalThis.SillyTavern.getContext = () => ({
    getCurrentChatId: () => 'chat_sync_dnd',
    chatId: 'chat_sync_dnd',
    chatMetadata: syncChatMeta,
    extensionSettings: {
        rpg_tracker: syncRpgSettings,
        multihog_companion: {},
    },
});
const dndSyncDossier = {
    meta: {
        title: 'Citadel 5e',
        ruleset: 'dnd5e',
        systemKey: 'grimdark',
        systemLabel: 'Grimdark 5e',
        premise: 'Hold the gate.',
        customGenreSpec: { stats: ['STR', 'DEX'] },
    },
    protagonist: { name: '[NAME: veteran soldier, RESOLVED TO: Kaelen]', hp: 12, ac: 16 },
    npcs: [{ name: '[NAME: quartermaster, RESOLVED TO: Mara]', role: 'Ally' }],
    monsters: [{ name: '[NAME: ridge stalker, RESOLVED TO: Ash Hound]', harm: 3 }],
    factions: [{ name: '[NAME: iron cabal, RESOLVED TO: Iron Pact]', agenda: 'Hold the gate' }],
};
const syncRes = await syncPbtaCampaignUpdates(dndSyncDossier, () => {}, { rpgSettings: syncRpgSettings });
assert.strictEqual(syncRes.success, true, `CONC-021: syncPbtaCampaignUpdates must succeed without ReferenceError (${syncRes.message})`);
assert.ok(syncRes.message.includes('D&D 5e'), 'CONC-021: D&D 5e sync message must reflect active adapter');
assert.strictEqual(syncChatMeta.CompanionActiveCartridge?.cartridgeId, 'dnd5e', 'CONC-021: CompanionActiveCartridge must preserve dnd5e cartridgeId');
assert.strictEqual(syncChatMeta.CompanionActiveCartridge?.dossier?.protagonist?.name, 'Kaelen', 'CONC-021: NameRAG token stripped from protagonist on sync');
assert.strictEqual(syncChatMeta.CompanionActiveCartridge?.dossier?.factions?.[0]?.name, 'Iron Pact', 'CONC-021: NameRAG token stripped from factions on sync');

// CONC-022: Verify concierge-runner.js launch registers Bestiary in standardSuffixes and distributes lorebooks/Canon/Skeleton unconditionally
const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, 'concierge-runner.js'), 'utf8');
assert.ok(runnerSrc.includes("'Bestiary'"), 'CONC-022: standardSuffixes in launchPbtaCampaign must include Bestiary');
assert.ok(!/if\s*\(\s*npcs\.length\s*\|\|\s*monsters\.length\s*\|\|\s*factions\.length\s*\)\s*\{[\s\S]*?injectDossierEntitiesIntoCampaignLorebooks/.test(runnerSrc), 'CONC-022: Lorebook distribution must not be gated behind npcs/monsters/factions non-empty check');

console.log('--- ALL CONCIERGE 4-STEP UI CONTROLLER TESTS PASSED CLEANLY! ---');
