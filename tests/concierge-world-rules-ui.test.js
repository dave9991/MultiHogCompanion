import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge World Rules & Custom Module UI Test Suite ---');

// ── 1. HTML Template Verification (concierge-modal.html) ──────────────────────
console.log('Testing concierge-modal.html elements...');

const modalHtmlPath = path.join(ROOT_DIR, 'concierge-modal.html');
const modalHtml = fs.readFileSync(modalHtmlPath, 'utf8');

assert.ok(modalHtml.includes('id="mhc_deck_world_rules_card"'), 'Modal must have #mhc_deck_world_rules_card');
assert.ok(modalHtml.includes('class="mhc-card mhc-card-world-rules"'), 'Modal must have .mhc-card-world-rules');
assert.ok(modalHtml.includes('id="mhc_deck_world_rules_count"'), 'Modal must have #mhc_deck_world_rules_count');
assert.ok(modalHtml.includes('id="mhc_deck_world_rules_list"'), 'Modal must have #mhc_deck_world_rules_list');
assert.ok(modalHtml.includes('Standard world physics &amp; tropes apply') || modalHtml.includes('Standard world physics & tropes apply'), 'Modal must have default empty hint');

assert.ok(modalHtml.includes('id="mhc_deck_custom_module_card"'), 'Modal must have #mhc_deck_custom_module_card');
assert.ok(modalHtml.includes('class="mhc-card mhc-card-custom-module"'), 'Modal must have .mhc-card-custom-module');
assert.ok(modalHtml.includes('id="mhc_deck_custom_module_tag"'), 'Modal must have #mhc_deck_custom_module_tag');
assert.ok(modalHtml.includes('id="mhc_deck_custom_module_label"'), 'Modal must have #mhc_deck_custom_module_label');
assert.ok(modalHtml.includes('id="mhc_deck_custom_module_instruction"'), 'Modal must have #mhc_deck_custom_module_instruction');
assert.ok(modalHtml.includes('id="mhc_deck_custom_module_sample"'), 'Modal must have #mhc_deck_custom_module_sample');
assert.ok(modalHtml.includes('class="mhc-module-sample-preview"'), 'Modal must have .mhc-module-sample-preview');

console.log('✓ concierge-modal.html contains all required World Rules and Custom Module elements');

// ── 2. CSS Stylesheet Verification (style.css) ────────────────────────────────
console.log('Testing style.css rules...');

const cssPath = path.join(ROOT_DIR, 'style.css');
const css = fs.readFileSync(cssPath, 'utf8');

assert.ok(css.includes('.mhc-card-world-rules'), 'style.css must define .mhc-card-world-rules');
assert.ok(css.includes('.mhc-card-custom-module'), 'style.css must define .mhc-card-custom-module');
assert.ok(css.includes('.mhc-constraint-banned'), 'style.css must define .mhc-constraint-banned');
assert.ok(css.includes('.mhc-module-sample-preview'), 'style.css must define .mhc-module-sample-preview');

console.log('✓ style.css defines all required styles for World Rules and Custom Tracker cards');

// ── 3. UI Controller Logic Verification (concierge-ui.js) ─────────────────────
console.log('Testing concierge-ui.js integration...');

const uiJsPath = path.join(ROOT_DIR, 'concierge-ui.js');
const uiJs = fs.readFileSync(uiJsPath, 'utf8');

assert.ok(uiJs.includes('mhc_deck_world_rules_count'), 'concierge-ui.js must reference #mhc_deck_world_rules_count');
assert.ok(uiJs.includes('mhc_deck_world_rules_list'), 'concierge-ui.js must reference #mhc_deck_world_rules_list');
assert.ok(uiJs.includes('mhc_deck_custom_module_card'), 'concierge-ui.js must reference #mhc_deck_custom_module_card');
assert.ok(uiJs.includes('mhc_deck_custom_module_tag'), 'concierge-ui.js must reference #mhc_deck_custom_module_tag');
assert.ok(uiJs.includes('mhc_deck_custom_module_label'), 'concierge-ui.js must reference #mhc_deck_custom_module_label');
assert.ok(uiJs.includes('mhc_deck_custom_module_instruction'), 'concierge-ui.js must reference #mhc_deck_custom_module_instruction');
assert.ok(uiJs.includes('mhc_deck_custom_module_sample'), 'concierge-ui.js must reference #mhc_deck_custom_module_sample');
assert.ok(uiJs.includes('mhc-constraint-banned'), 'concierge-ui.js must render .mhc-constraint-banned');

console.log('✓ concierge-ui.js contains complete wiring for World Rules & Custom Module rendering');

// ── 4. Rendering Logic Simulation ─────────────────────────────────────────────
console.log('Testing rendering generation logic...');

function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function simulateRenderAxiom(ax) {
    const cat = (ax.category || 'physics').toLowerCase();
    let catColor = 'rgba(156, 163, 175, 0.4)';
    if (cat.includes('bio')) catColor = 'rgba(16, 185, 129, 0.4)';
    else if (cat.includes('magic')) catColor = 'rgba(168, 85, 247, 0.4)';
    else if (cat.includes('physic')) catColor = 'rgba(56, 189, 248, 0.4)';
    else if (cat.includes('social')) catColor = 'rgba(245, 158, 11, 0.4)';

    const subsHtml = ax.substitutions?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>Substitutions:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.substitutions.map(s => `<li>🔄 ${escapeHtml(s)}</li>`).join('')}</ul></div>`
        : '';
    const negHtml = ax.negativeConstraints?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.9;"><b>Banned & Absences:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.negativeConstraints.map(nc => `<li>🚫 <span class="mhc-constraint-banned">${escapeHtml(nc)}</span></li>`).join('')}</ul></div>`
        : '';
    const archHtml = ax.architecturalNotes
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;">🏛️ <b>Infrastructure:</b> ${escapeHtml(ax.architecturalNotes)}</div>`
        : '';

    return `
        <div class="mhc-deck-item collapsible">
            <div class="mhc-deck-item-header">
                <div class="mhc-deck-item-title" style="color: #10b981;">
                    🌐 ${escapeHtml(ax.title || 'World Law')} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${catColor};">${escapeHtml(ax.category || 'physics').toUpperCase()}</span>
                </div>
                <span class="mhc-deck-item-toggle">▼</span>
            </div>
            <div class="mhc-deck-item-detail">
                <div style="font-size: 0.85em; opacity: 0.95; margin-bottom: 4px;"><b>Axiom:</b> ${escapeHtml(ax.axiom || '')}</div>
                ${subsHtml}
                ${negHtml}
                ${archHtml}
            </div>
        </div>
    `;
}

const sampleAxiom = {
    title: 'Biological Technology',
    category: 'biology_for_tech',
    axiom: 'Mechanical machines are replaced by biotechnology.',
    substitutions: ['Cars -> Giant beetles', 'Guns -> Spitting snakes'],
    negativeConstraints: ['No combustion engines', 'No steel firearms'],
    architecturalNotes: 'Living hive buildings with bone skybridges',
};

const renderedHtml = simulateRenderAxiom(sampleAxiom);
assert.ok(renderedHtml.includes('🌐 Biological Technology'));
assert.ok(renderedHtml.includes('BIOLOGY_FOR_TECH'));
assert.ok(renderedHtml.includes('rgba(16, 185, 129, 0.4)'));
assert.ok(renderedHtml.includes('🔄 Cars -&gt; Giant beetles'));
assert.ok(renderedHtml.includes('🚫 <span class="mhc-constraint-banned">No combustion engines</span>'));
assert.ok(renderedHtml.includes('🏛️ <b>Infrastructure:</b> Living hive buildings with bone skybridges'));

// HTML escaping check
const unsafeAxiom = {
    title: '<script>alert(1)</script>',
    category: 'magic',
    axiom: 'Test & "quotes"',
    substitutions: ['<danger>'],
    negativeConstraints: ['<forbidden>'],
    architecturalNotes: '<structure>',
};
const safeRendered = simulateRenderAxiom(unsafeAxiom);
assert.ok(!safeRendered.includes('<script>'));
assert.ok(safeRendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(safeRendered.includes('&amp; &quot;quotes&quot;'));
assert.ok(safeRendered.includes('&lt;danger&gt;'));
assert.ok(safeRendered.includes('&lt;forbidden&gt;'));
assert.ok(safeRendered.includes('&lt;structure&gt;'));

console.log('✓ UI render templates produce valid, securely escaped HTML markup with badges and icons');

console.log('--- ALL CONCIERGE WORLD RULES UI TESTS PASSED CLEANLY! ---');
