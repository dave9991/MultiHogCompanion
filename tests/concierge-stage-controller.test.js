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
    if (!elements.has(selector)) {
        elements.set(selector, {
            selector,
            visible: true,
            classes: new Set(),
            textVal: '',
            htmlVal: '',
            attrs: {},
            childrenList: [],
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
            children() { return this; },
            find() { return this; },
            closest() { return this; },
            is() { return true; },
            on() { return this; },
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

console.log('--- ALL CONCIERGE 4-STEP UI CONTROLLER TESTS PASSED CLEANLY! ---');
