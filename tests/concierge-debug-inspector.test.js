import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createEmptyDossier,
    applyDossierUpdates,
    classifyBuilderReport,
    buildTalkerInstructionNotice,
    formatDiagnosticTrace,
} from '../concierge-parser.js';
import { escapeHtml } from '../mhc-utils.js';
import { renderDebugInspectorDom } from '../concierge-debug-inspector.js';
import { installDomHarness } from './helpers/dom-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge Debug Inspector & Diagnostic Mode Test Suite ---');

// ── 1. Status Classification (classifyBuilderReport) ──────────────────────────
console.log('Testing classifyBuilderReport categorization...');

const mutatedReport = {
    success: true,
    hasMutations: true,
    isNoop: false,
    errors: [],
    builderSummary: 'Added Silver Longsword',
};
assert.strictEqual(classifyBuilderReport(mutatedReport), 'MUTATED');

const noopReport = {
    success: true,
    hasMutations: false,
    isNoop: true,
    errors: [],
    builderSummary: 'Player asked setting lore question',
};
assert.strictEqual(classifyBuilderReport(noopReport), 'NOOP');

const syntaxErrorReport = {
    success: false,
    hasMutations: false,
    isNoop: false,
    errors: ['Invalid armor rating "heavy"'],
    builderSummary: 'Failed validation',
};
assert.strictEqual(classifyBuilderReport(syntaxErrorReport), 'SYNTAX_ERROR');

const unrecognizedReport = {
    success: true,
    hasMutations: false,
    isNoop: false,
    errors: [],
    builderSummary: 'No blueprint mutations detected',
};
assert.strictEqual(classifyBuilderReport(unrecognizedReport), 'UNRECOGNIZED_OUTPUT');

assert.strictEqual(classifyBuilderReport(null), 'UNRECOGNIZED_OUTPUT');
assert.strictEqual(classifyBuilderReport(undefined), 'UNRECOGNIZED_OUTPUT');
console.log('✓ classifyBuilderReport cleanly categorizes MUTATED, NOOP, SYNTAX_ERROR, and UNRECOGNIZED_OUTPUT');

// ── 2. Talker Instruction Notice (buildTalkerInstructionNotice) ───────────────
console.log('Testing buildTalkerInstructionNotice anti-hallucination notices...');

const noticeMutated = buildTalkerInstructionNotice('MUTATED', 'Added Silver Longsword');
assert.strictEqual(noticeMutated, '[BUILDER_REPORT: Added Silver Longsword]');

const noticeNoop = buildTalkerInstructionNotice('NOOP', 'No blueprint changes requested');
assert.strictEqual(noticeNoop, '[BUILDER_REPORT: No blueprint changes requested]');

const noticeSyntaxErr = buildTalkerInstructionNotice('SYNTAX_ERROR', '', ['Invalid armor rating']);
assert.ok(noticeSyntaxErr.includes('[BUILDER_ERROR: Attempted update failed validation (Invalid armor rating)'));
assert.ok(noticeSyntaxErr.includes('blueprint unchanged'));
assert.ok(noticeSyntaxErr.includes('formatting hiccup'));

const noticeUnrecognized = buildTalkerInstructionNotice('UNRECOGNIZED_OUTPUT');
assert.ok(noticeUnrecognized.includes('[BUILDER_NOTICE: The Builder output did not include an [UPDATE_DOSSIER] block'));
assert.ok(noticeUnrecognized.includes('No changes were made to the blueprint'));
assert.ok(noticeUnrecognized.includes('Do NOT claim an edit was made'));
assert.ok(noticeUnrecognized.includes('Discuss ideas conversationally with the player'));
console.log('✓ buildTalkerInstructionNotice strictly prohibits hallucinated edits when output is unrecognized');

// ── 3. Silent Fallback Prevention Simulation ──────────────────────────────────
console.log('Testing Silent Fallback Prevention with unformatted LLM output...');

const initialDossier = createEmptyDossier();
initialDossier.protagonist.name = 'Kael';
initialDossier.protagonist.gear = ['Dagger'];

// Builder LLM outputs conversational prose without [UPDATE_DOSSIER] tags
const conversationalOutput = "I would be delighted to add a bag of holding and a ring of invisibility to your pack! Let's continue.";
const parseResult = applyDossierUpdates(conversationalOutput, initialDossier);

assert.strictEqual(parseResult.hasMutations, false);
assert.strictEqual(parseResult.isNoop, false);
assert.strictEqual(parseResult.changes.length, 0);

const status = classifyBuilderReport(parseResult);
assert.strictEqual(status, 'UNRECOGNIZED_OUTPUT');

const talkerNotice = buildTalkerInstructionNotice(status, parseResult.builderSummary, parseResult.errors);
assert.ok(talkerNotice.includes('Do NOT claim an edit was made'));
assert.strictEqual(initialDossier.protagonist.gear.length, 1);
assert.strictEqual(initialDossier.protagonist.gear[0], 'Dagger');
console.log('✓ Conversational chatter without directives triggers UNRECOGNIZED_OUTPUT notice and leaves blueprint untouched');

// ── 4. Full Diagnostic Trace Formatting (formatDiagnosticTrace) ───────────────
console.log('Testing formatDiagnosticTrace Markdown generation...');

assert.strictEqual(formatDiagnosticTrace(null), 'No diagnostic trace recorded.');
assert.strictEqual(formatDiagnosticTrace(undefined), 'No diagnostic trace recorded.');

const sampleTransaction = {
    timestamp: '2026-10-07T21:30:00.000Z',
    finalStatus: 'MUTATED',
    systemEngine: 'cyberpunk',
    userPrompt: 'Give Kael cyberware: Neural Deck',
    builderSummary: 'Added cyberware Neural Deck to Protagonist gear',
    builderRequest: {
        messages: [
            { role: 'system', name: 'System', content: 'You are the PbtA Blueprint Builder.' },
            { role: 'user', content: 'Give Kael cyberware: Neural Deck' },
        ],
    },
    attempts: [
        {
            attempt: 1,
            rawResponse: '[UPDATE_DOSSIER]\nsummary: Added cyberware Neural Deck\n[PROTAGONIST]\ngear: Neural Deck\n[/PROTAGONIST]\n[/UPDATE_DOSSIER]',
            hasMutations: true,
            isNoop: false,
            report: {
                hasMutations: true,
                isNoop: false,
                changes: ['Protagonist gear updated: Neural Deck'],
                errors: [],
            },
        },
    ],
    activeDossierSnapshot: {
        meta: { title: 'Neon Shadows', systemKey: 'cyberpunk' },
        protagonist: { name: 'Kael', gear: ['Neural Deck'] },
    },
    nameRagResolutions: [
        {
            placeholder: '[[NAME:protagonist]]',
            tag: 'protagonist',
            blockType: 'PROTAGONIST',
            query: 'cyberpunk operative star pilot cyborg',
            source: 'NameRAG (namerag-mcp)',
            candidates: ['Kaelen', 'Vex', 'Rix'],
            selectedName: 'Kaelen',
        },
    ],
};

const traceMd = formatDiagnosticTrace(sampleTransaction);
assert.ok(traceMd.includes('### 🎩 MultiHog Concierge Builder Diagnostic Trace'));
assert.ok(traceMd.includes('- **Final Status:** MUTATED'));
assert.ok(traceMd.includes('- **System Engine:** cyberpunk'));
assert.ok(traceMd.includes('- **User Prompt:** Give Kael cyberware: Neural Deck'));
assert.ok(traceMd.includes('- **Extracted Summary:** Added cyberware Neural Deck to Protagonist gear'));
assert.ok(traceMd.includes('#### Execution Attempts:'));
assert.ok(traceMd.includes('Attempt 1:'));
assert.ok(traceMd.includes('Protagonist gear updated: Neural Deck'));
assert.ok(traceMd.includes('```text\n[UPDATE_DOSSIER]'));
assert.ok(traceMd.includes('#### 📇 Name Diversity Engine (NameRAG) Resolutions:'));
assert.ok(traceMd.includes('[[NAME:protagonist]]'));
assert.ok(traceMd.includes('NameRAG (namerag-mcp)'));
assert.ok(traceMd.includes('Selected Name:** **Kaelen**'));
assert.ok(traceMd.includes('#### Last Builder Request (Input Messages):'));
assert.ok(traceMd.includes('You are the PbtA Blueprint Builder.'));
assert.ok(traceMd.includes('#### Current Blueprint Snapshot (activeDossier):'));
assert.ok(traceMd.includes('"Neon Shadows"'));
console.log('✓ formatDiagnosticTrace constructs rich, readable Markdown traces with NameRAG resolutions for Antigravity debug');

// ── 5. HTML Template Element Verification ─────────────────────────────────────
console.log('Testing HTML Template Element Integrations...');

const modalHtmlPath = path.join(ROOT_DIR, 'concierge-modal.html');
const modalHtml = fs.readFileSync(modalHtmlPath, 'utf8');

assert.ok(modalHtml.includes('id="mhc_tab_debug_btn"'), 'Modal must have #mhc_tab_debug_btn');
assert.ok(modalHtml.includes('id="mhc_tab_debug"'), 'Modal must have #mhc_tab_debug');
assert.ok(modalHtml.includes('id="mhc_debug_status_badge"'), 'Modal must have #mhc_debug_status_badge');
assert.ok(modalHtml.includes('id="mhc_debug_timestamp"'), 'Modal must have #mhc_debug_timestamp');
assert.ok(modalHtml.includes('id="mhc_debug_summary_text"'), 'Modal must have #mhc_debug_summary_text');
assert.ok(modalHtml.includes('id="mhc_debug_namerag_count"'), 'Modal must have #mhc_debug_namerag_count');
assert.ok(modalHtml.includes('id="mhc_debug_namerag_list"'), 'Modal must have #mhc_debug_namerag_list');
assert.ok(modalHtml.includes('id="mhc_debug_raw_output"'), 'Modal must have #mhc_debug_raw_output');
assert.ok(modalHtml.includes('id="mhc_debug_prompt_input"'), 'Modal must have #mhc_debug_prompt_input');
assert.ok(modalHtml.includes('id="mhc_debug_dossier_json"'), 'Modal must have #mhc_debug_dossier_json');
assert.ok(modalHtml.includes('class="menu_button mhc-copy-debug-trace-btn"'), 'Modal must have .mhc-copy-debug-trace-btn');
console.log('✓ concierge-modal.html contains all required debug inspector elements');

// ── 6. Behavioral DOM Rendering & Shared Utility Tests ────────────────────────
console.log('Testing escapeHtml utility and renderDebugInspectorDom via stateful DOM harness...');

// 6a. escapeHtml edge cases
assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(undefined), '');
assert.strictEqual(escapeHtml(42), '42');
assert.strictEqual(escapeHtml(false), 'false');
assert.strictEqual(
    escapeHtml(`<script>alert("x" & 'y')</script>`),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
);

// 6b. renderDebugInspectorDom behavioral DOM verification
const harness = installDomHarness();
try {
    // Awaiting turn (tx = null)
    renderDebugInspectorDom(null, { activeDossier: { meta: { title: 'Sandbox Test' } } });
    assert.strictEqual(harness.getElement('#mhc_debug_status_badge')?.textContent, 'Awaiting Turn');
    assert.strictEqual(harness.getElement('#mhc_debug_timestamp')?.textContent, '--:--:--');
    assert.strictEqual(harness.getElement('#mhc_debug_attempt_count')?.textContent, 'Attempt 0/2');
    assert.strictEqual(harness.getElement('#mhc_debug_critique_badge')?.textContent, 'Not Evaluated');
    assert.strictEqual(harness.getElement('#mhc_debug_namerag_count')?.textContent, '0 resolved');
    assert.ok(harness.getElement('#mhc_debug_dossier_json')?.textContent.includes('"Sandbox Test"'));

    // Full mutated transaction with Contemplation, Pass 2 Refiner critique, NameRAG, and XSS payloads
    const richTransaction = {
        timestamp: '18:05:00',
        finalStatus: 'MUTATED',
        builderSummary: 'Updated Kaelen and NPCs',
        contemplation: {
            coreTension: 'Guild blockade <script>alert(1)</script>',
            worldConsequences: 'Port rationing tightens',
        },
        critique: {
            verdict: 'REVISE',
            score: 76,
            grade: 'C',
            shouldRevise: true,
            strengths: ['Strong atmosphere'],
            weaknesses: ['Sparse dockside hooks'],
            directives: ['Add harbormaster rivalry'],
        },
        refinerPass: {
            hasMutations: true,
            changes: ['Added Harbormaster Vane & <img onerror=alert(1)>'],
        },
        attempts: [
            {
                attempt: 1,
                rawResponse: '[UPDATE_DOSSIER]\n[NOOP]\n[/UPDATE_DOSSIER]',
                report: {
                    changes: ['Added <script>xss</script> Blade'],
                    errors: ['Warn <b>raw</b> tag'],
                },
            },
        ],
        nameRagResolutions: [
            {
                placeholder: '[[NAME:npc]]',
                gender: 'F',
                source: 'NameRAG',
                query: 'maritime smuggler',
                candidates: ['Sera', 'Lyra'],
                selectedName: 'Sera',
            },
        ],
        builderRequest: {
            messages: [{ role: 'user', content: 'Build port ambush' }],
        },
        activeDossierSnapshot: { meta: { title: 'Port Ambush' } },
    };

    renderDebugInspectorDom(richTransaction, { activeDossier: {} });
    assert.strictEqual(harness.getElement('#mhc_debug_status_badge')?.textContent, 'MUTATED');
    assert.strictEqual(harness.getElement('#mhc_debug_status_badge')?.css.color, '#4ade80');
    assert.strictEqual(harness.getElement('#mhc_debug_timestamp')?.textContent, '18:05:00');
    assert.strictEqual(harness.getElement('#mhc_debug_attempt_count')?.textContent, 'Attempt 1/2');
    assert.strictEqual(harness.getElement('#mhc_debug_critique_badge')?.textContent, 'REFINED (Pass 2 · 76/100 C)');
    assert.strictEqual(harness.getElement('#mhc_debug_namerag_count')?.textContent, '1 resolved');

    const changesHtml = harness.getElement('#mhc_debug_changes_list')?.htmlContent || '';
    assert.ok(!changesHtml.includes('<script>'), 'Mutation list must escape <script>');
    assert.ok(changesHtml.includes('&lt;script&gt;xss&lt;/script&gt;'), 'Escaped mutation payload present');

    const errorsHtml = harness.getElement('#mhc_debug_errors_list')?.htmlContent || '';
    assert.ok(errorsHtml.includes('&lt;b&gt;raw&lt;/b&gt;'), 'Error list must escape HTML tags');

    const contempHtml = harness.getElement('#mhc_debug_contemplation_box')?.htmlContent || '';
    assert.ok(contempHtml.includes('Pass 1 Architectural Scratchpad'));
    assert.ok(!contempHtml.includes('<script>alert(1)</script>'), 'Contemplation box must escape <script>');
    assert.ok(contempHtml.includes('&lt;img onerror=alert(1)&gt;'), 'Refiner changes must escape HTML tags');
    assert.ok(contempHtml.includes('Resolved in Pass 2'));

    const nameRagHtml = harness.getElement('#mhc_debug_namerag_list')?.htmlContent || '';
    assert.ok(nameRagHtml.includes('♀ Female'));
    assert.ok(nameRagHtml.includes('<b style="color: #4ade80;">Sera (picked)</b>'));
    assert.ok(nameRagHtml.includes('Lyra'));
    assert.ok(harness.getElement('#mhc_debug_dossier_json')?.textContent.includes('"Port Ambush"'));
} finally {
    harness.cleanup();
}

console.log('✓ escapeHtml edge cases and renderDebugInspectorDom behavioral DOM assertions verified cleanly');
console.log('--- ALL CONCIERGE DEBUG INSPECTOR TESTS PASSED CLEANLY! ---');

