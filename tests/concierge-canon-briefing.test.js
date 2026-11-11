import assert from 'node:assert';
import {
    buildInventoryBlock, parseSuggestedStarts, isVectorsWorldInfoEnabled, estimateTokens,
    stageCanonSource, clearStagedCanon, setModeOverride, shouldBrief, markBriefed, isBriefed,
} from '../concierge-canon.js';
import { buildArchivistBriefingPrompt, buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running Concierge Archivist Briefing Test Suite ---');

const entries = [
    ...Array.from({ length: 40 }, (_, i) => ({ kind: 'NPC', name: `Person Number ${i}`, importance: (i % 5) + 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ kind: 'LOCATION', name: `Place ${i}`, importance: 3 })),
    { kind: 'MONSTER', name: 'The Ash Wyrm', importance: 5 },
];
const block = buildInventoryBlock(entries);
assert.ok(block.includes('[CANON_INVENTORY: 53 entries'));
assert.ok(block.includes('NPCs (40)'));
assert.ok(block.includes('The Ash Wyrm'));
assert.ok(!block.includes('Person Number 0') || block.includes('…'), 'names are trimmed to top N');
assert.ok(estimateTokens(block) <= 1000);
assert.ok(estimateTokens(buildInventoryBlock(entries, 80)) <= 150, 'tight budget shrinks block');
assert.strictEqual(buildInventoryBlock([]), '');

const parsed = parseSuggestedStarts('Found lots!\n[SUGGESTED_STARTS]\n- The harbor city\n2. War of ash\n* Wyrm hunt\n- four\n- five\n[/SUGGESTED_STARTS]\nBye');
assert.deepStrictEqual(parsed.starts, ['The harbor city', 'War of ash', 'Wyrm hunt', 'four']);
assert.ok(!parsed.text.includes('SUGGESTED'));
assert.ok(parsed.text.includes('Found lots!') && parsed.text.includes('Bye'));
assert.deepStrictEqual(parseSuggestedStarts('no block').starts, []);

assert.strictEqual(isVectorsWorldInfoEnabled({ vectors: { enabled_world_info: true } }), true);
assert.strictEqual(isVectorsWorldInfoEnabled({ vectors: {} }), false);
assert.strictEqual(isVectorsWorldInfoEnabled(undefined), false);

// shouldBrief lifecycle
clearStagedCanon(); setModeOverride('auto');
assert.strictEqual(shouldBrief(), false);
await stageCanonSource({ name: 'tiny', type: 'doc', text: 'small' });
assert.strictEqual(shouldBrief(), false, 'vibe mode never briefs');
setModeOverride('archivist');
await stageCanonSource({ name: 'tiny', type: 'doc', text: '# Town\nA city.' }, {
    send: async () => '[{"id":"tiny#0","kind":"LOCATION","name":"Town","importance":3}]',
});
assert.strictEqual(shouldBrief(), true);
markBriefed();
assert.ok(isBriefed());
assert.strictEqual(shouldBrief(), false);
clearStagedCanon();
assert.strictEqual(isBriefed(), false, 'clear resets briefed flag');
setModeOverride('auto');

// prompts
const bp = buildArchivistBriefingPrompt();
assert.ok(bp.includes('Do NOT emit [UPDATE_DOSSIER]'));
assert.ok(bp.includes('[SUGGESTED_STARTS]'));
assert.ok(buildConciergeSystemPrompt().includes('[CANON_INVENTORY]'));

// ── Import & Commit Box & Manual Trigger Verification ──────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 1. Template Verification
const modalHtml = fs.readFileSync(path.join(ROOT_DIR, 'concierge-modal.html'), 'utf8');
assert.ok(modalHtml.includes('id="mhc_attach_btn"'), 'Modal must have #mhc_attach_btn');
assert.ok(modalHtml.includes('id="mhc_file_input"'), 'Modal must have #mhc_file_input');
assert.ok(modalHtml.includes('id="mhc_send_btn"'), 'Modal must have #mhc_send_btn');
assert.ok(modalHtml.includes('id="mhc_import_commit_box"'), 'Modal must have #mhc_import_commit_box');
assert.ok(modalHtml.includes('id="mhc_import_commit_icon"'), 'Modal must have #mhc_import_commit_icon');
assert.ok(modalHtml.includes('id="mhc_import_commit_status_text"'), 'Modal must have #mhc_import_commit_status_text');
assert.ok(modalHtml.includes('id="mhc_import_add_more_btn"'), 'Modal must have #mhc_import_add_more_btn');
assert.ok(modalHtml.includes('id="mhc_import_cancel_btn"'), 'Modal must have #mhc_import_cancel_btn');
assert.ok(modalHtml.includes('id="mhc_import_use_vibe_btn"'), 'Modal must have #mhc_import_use_vibe_btn');
assert.ok(modalHtml.includes('id="mhc_import_commit_btn"'), 'Modal must have #mhc_import_commit_btn');

// 2. CSS Verification
const styleCss = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
assert.ok(styleCss.includes('.mhc-import-commit-box'), 'style.css must have .mhc-import-commit-box');
assert.ok(styleCss.includes('.mhc-import-commit-status-row'), 'style.css must have .mhc-import-commit-status-row');
assert.ok(styleCss.includes('.mhc-import-commit-actions'), 'style.css must have .mhc-import-commit-actions');
assert.ok(styleCss.includes('.mhc-commit-btn'), 'style.css must have .mhc-commit-btn');
assert.ok(styleCss.includes('.mhc-send-btn:disabled'), 'style.css must have .mhc-send-btn:disabled');

// 3. UI State Synchronization Mock Test
const mockDomState = {
    inputRowVisible: true,
    commitBoxVisible: false,
    commitBtnDisabled: true,
    commitBtnText: '',
    cancelBtnVisible: false,
    vibeBtnVisible: false,
    statusText: '',
    sendBtnDisabled: true,
    sendBtnText: '',
    sendBtnTitle: '',
    chatInputText: '',
};

globalThis.$ = (selector) => {
    return {
        length: 1,
        show() {
            if (selector === '.mhc-chat-input-row') mockDomState.inputRowVisible = true;
            if (selector === '#mhc_import_commit_box') mockDomState.commitBoxVisible = true;
            if (selector === '#mhc_import_cancel_btn') mockDomState.cancelBtnVisible = true;
            if (selector === '#mhc_import_use_vibe_btn') mockDomState.vibeBtnVisible = true;
            return this;
        },
        hide() {
            if (selector === '.mhc-chat-input-row') mockDomState.inputRowVisible = false;
            if (selector === '#mhc_import_commit_box') mockDomState.commitBoxVisible = false;
            if (selector === '#mhc_import_cancel_btn') mockDomState.cancelBtnVisible = false;
            if (selector === '#mhc_import_use_vibe_btn') mockDomState.vibeBtnVisible = false;
            return this;
        },
        prop(propName, val) {
            if (selector === '#mhc_import_commit_btn' && propName === 'disabled') {
                mockDomState.commitBtnDisabled = val;
            }
            if (selector === '#mhc_send_btn' && propName === 'disabled') {
                mockDomState.sendBtnDisabled = val;
            }
            return this;
        },
        attr(attrName, val) {
            if (selector === '#mhc_send_btn' && attrName === 'title') {
                mockDomState.sendBtnTitle = val;
            }
            return this;
        },
        text(t) {
            if (t !== undefined) {
                if (selector === '#mhc_import_commit_btn') mockDomState.commitBtnText = t;
                if (selector === '#mhc_import_commit_status_text') mockDomState.statusText = t;
                if (selector === '#mhc_send_btn') mockDomState.sendBtnText = t;
                return this;
            }
            return t;
        },
        html(h) {
            return this;
        },
        val(v) {
            if (v !== undefined) {
                if (selector === '#mhc_chat_input') mockDomState.chatInputText = v;
                return this;
            }
            return selector === '#mhc_chat_input' ? mockDomState.chatInputText : '';
        },
        on() { return this; },
    };
};

const { syncImportCommitBoxUI, setImportCommitPending, getImportCommitPending, updateSendButtonState, getPendingAttachments } = await import('../concierge-ui.js');

// Test 3a: updateSendButtonState across empty, text-only, attachment-only, and text+attachment states
mockDomState.chatInputText = '';
updateSendButtonState();
assert.strictEqual(mockDomState.sendBtnDisabled, true, 'send button must be disabled when empty');
assert.strictEqual(mockDomState.sendBtnText, '➤');
assert.strictEqual(mockDomState.sendBtnTitle, 'Type a prompt or attach files to begin');

mockDomState.chatInputText = 'Cyberpunk adventure';
updateSendButtonState();
assert.strictEqual(mockDomState.sendBtnDisabled, false, 'send button must be enabled with text');
assert.strictEqual(mockDomState.sendBtnText, '➤');
assert.strictEqual(mockDomState.sendBtnTitle, 'Send message to Concierge');

// Test: when isImportCommitPending is false, normal chat input is visible
setImportCommitPending(false);
syncImportCommitBoxUI();
assert.strictEqual(mockDomState.inputRowVisible, true);
assert.strictEqual(mockDomState.commitBoxVisible, false);

// Test: when isImportCommitPending is true and canon entries exist needing briefing
clearStagedCanon();
setModeOverride('archivist');
await stageCanonSource({ name: 'lorebook', type: 'doc', text: '# Kingdom\nA great realm.' }, {
    send: async () => '[{"id":"lorebook#0","kind":"LOCATION","name":"Kingdom","importance":4}]',
});
assert.strictEqual(shouldBrief(), true);

setImportCommitPending(true);
syncImportCommitBoxUI();
assert.strictEqual(mockDomState.inputRowVisible, false, 'chat input must be hidden when commit is needed');
assert.strictEqual(mockDomState.commitBoxVisible, true, 'commit box must be shown when commit is needed');
assert.strictEqual(mockDomState.commitBtnDisabled, false, 'commit button must be enabled when ready');
assert.ok(mockDomState.commitBtnText.includes('Commit & Review Lore (1 entries)'));
assert.strictEqual(mockDomState.cancelBtnVisible, false);
assert.strictEqual(mockDomState.vibeBtnVisible, true);

// Test: switching back from pending commit restores chat input
setImportCommitPending(false);
syncImportCommitBoxUI();
assert.strictEqual(mockDomState.inputRowVisible, true);
assert.strictEqual(mockDomState.commitBoxVisible, false);

// Clean up
clearStagedCanon();
setModeOverride('auto');

console.log('✅ Concierge Archivist Briefing test suite passed.');
