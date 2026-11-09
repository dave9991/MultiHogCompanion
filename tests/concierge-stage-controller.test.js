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
            prop(k, v) { if (v !== undefined) return this; return false; },
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
const loadActiveBtn = getOrCreateMockElement('#mhc_load_active_campaign_btn');

await refreshConciergeActiveContext('chat_stub_999');
assert.strictEqual(livingWorldNavBtn.visible, false, 'Living World nav button must be hidden for stub chat');
assert.strictEqual(loadActiveBtn.visible, false, 'Load Active Campaign button must be hidden for stub chat');

// 5. refreshConciergeActiveContext shows Living World button for Concierge chat
await refreshConciergeActiveContext('chat_concierge_100');
assert.strictEqual(livingWorldNavBtn.visible, true, 'Living World nav button must be visible for Concierge chat');
assert.strictEqual(loadActiveBtn.visible, true, 'Load Active Campaign button must be visible for Concierge chat');

// 6. openConciergeModal with navMode: 'living-world' on stub falls back to new-adventure
await openConciergeModal({ ruleset: 'pbta', navMode: 'living-world' });
assert.strictEqual(getConciergeStageState().currentNavMode, 'new-adventure', 'openConciergeModal must fall back to new-adventure when no Concierge dossier exists');

console.log('--- ALL CONCIERGE 4-STEP UI CONTROLLER TESTS PASSED CLEANLY! ---');
