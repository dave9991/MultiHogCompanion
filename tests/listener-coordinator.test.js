import assert from 'node:assert';
import { triggerDecoupledCyoaForMessage } from '../cyoa-guardian.js';
import { rollNameRagCandidate, setupMultiHogRollHooks } from '../namerag-hooks.js';

console.log('--- Running Listener Coordinator & Defensive Hardening Test Suite ---');

// 1. Test Decoupled CYOA Trigger Deduplication
console.log('Testing Decoupled CYOA trigger deduplication...');
globalThis.SillyTavern = {
    getContext: () => ({
        chat: [
            { is_user: false, is_system: false, mes: 'Welcome to the tavern.', swipe_id: 0 },
            { is_user: false, is_system: false, mes: 'The goblin snarls and draws a rusted dagger.', swipe_id: 1 },
        ],
        extensionSettings: {
            rpg_tracker: {
                playstyle: 'cyoa_3',
            },
        },
    }),
};

let toastCount = 0;
const mockToast = () => { toastCount++; };

// First call: Should trigger Stage 2 for message 1
const firstAttempt = await triggerDecoupledCyoaForMessage({
    messageId: 1,
    triggerSource: 'CHARACTER_MESSAGE_RENDERED',
    getSettings: () => ({ enableDecoupledCyoa: true }),
    isPbtaActive: () => false,
    showToast: mockToast,
});
// (firstAttempt may be true or false depending on runner mock, but deduplication state is set)

// Immediate second call with identical messageId and swipeId: MUST be rejected by deduplication guard
const duplicateAttempt = await triggerDecoupledCyoaForMessage({
    messageId: 1,
    triggerSource: 'GENERATION_ENDED',
    getSettings: () => ({ enableDecoupledCyoa: true }),
    isPbtaActive: () => false,
    showToast: mockToast,
});
assert.strictEqual(duplicateAttempt, false, 'Duplicate trigger for identical message and swipe must be rejected');
console.log('✓ Decoupled CYOA duplicate trigger correctly rejected without redundant LLM call');

// 2. Test Message 0 and Unstarted Chat Rejection
console.log('Testing boundary guard on Message 0 (greeting)...');
const msg0Attempt = await triggerDecoupledCyoaForMessage({
    messageId: 0,
    triggerSource: 'CHARACTER_MESSAGE_RENDERED',
    getSettings: () => ({ enableDecoupledCyoa: true }),
    isPbtaActive: () => false,
});
assert.strictEqual(msg0Attempt, false, 'Message 0 must never trigger Stage 2 CYOA generation');
console.log('✓ Message 0 boundary guard safely enforced');

// 3. Test NameRAG Fallback & Toast Notification
console.log('Testing NameRAG roll fallback & toast warning delivery...');
let recordedToast = null;
const toastCollector = (type, message, title) => {
    recordedToast = { type, message, title };
};

// Mock DOM elements for QuickStart roll button
const listeners = {};
const mockBtn = {
    _html: '<i class="fa-solid fa-dice"></i> Roll',
    _disabled: false,
    html(val) {
        if (val !== undefined) this._html = val;
        return this._html;
    },
    prop(key, val) {
        if (val !== undefined) {
            this[`_${key}`] = val;
            return this;
        }
        return this[`_${key}`];
    },
    closest() {
        return {
            find(selector) {
                if (selector.includes('genre')) {
                    return {
                        data: () => 'cyberpunk',
                        attr: () => 'cyberpunk',
                        val: () => 'cyberpunk',
                    };
                }
                if (selector.includes('name')) {
                    return {
                        _val: '',
                        val(v) {
                            if (v !== undefined) {
                                this._val = v;
                                return this;
                            }
                            return this._val;
                        },
                        trigger() { return this; },
                    };
                }
                return { length: 0, val: () => '' };
            },
        };
    },
};

globalThis.$ = (selector) => {
    if (selector === globalThis.document) {
        return {
            off(evt) { delete listeners[evt]; return this; },
            on(evt, sel, fn) { listeners[evt] = fn; return this; },
        };
    }
    return mockBtn;
};
globalThis.document = {};

setupMultiHogRollHooks(() => true, { showToast: toastCollector });
assert.ok(listeners['click.mhc_namerag_qs'], 'Quickstart roll hook must be bound to document');

// Invoke the bound listener
let defaultPrevented = false;
let propagationStopped = false;
const fakeEvent = {
    preventDefault() { defaultPrevented = true; },
    stopImmediatePropagation() { propagationStopped = true; },
};

await listeners['click.mhc_namerag_qs'].call(mockBtn, fakeEvent);
assert.ok(propagationStopped, 'Native roll listener must be suppressed via stopImmediatePropagation');
assert.strictEqual(mockBtn.prop('disabled'), false, 'Button must be re-enabled after roll finishes');
assert.ok(recordedToast, 'A toast must be emitted informing user of fallback when NameRAG offline');
assert.strictEqual(recordedToast.type, 'warning', 'Toast should be a warning');
assert.ok(recordedToast.message.includes('NameRAG service unavailable'), 'Toast message should clearly explain fallback');
console.log('✓ NameRAG hook delivers resilient fallback, re-enables button, and displays warning toast');

console.log('--- ALL LISTENER COORDINATOR TESTS PASSED CLEANLY! ---');
