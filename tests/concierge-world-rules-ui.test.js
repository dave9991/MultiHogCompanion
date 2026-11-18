import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAxiomCardHtml, escapeHtml } from '../concierge-parser.js';
import {
    resetConciergeState,
    getActiveConciergeDossier,
    updateBlueprintDeck,
} from '../concierge-ui.js';
import { installDomHarness } from './helpers/dom-harness.js';

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

// ── 3. Behavioral UI Controller Execution (updateBlueprintDeck) ───────────────
console.log('Testing updateBlueprintDeck behavioral World Rules & Custom Module rendering...');
{
    const harness = installDomHarness();
    try {
        // 3a. Empty state rendering
        resetConciergeState({ showGreeting: false, ruleset: 'pbta' });
        assert.strictEqual(harness.$('#mhc_deck_world_rules_count').text(), '0');
        assert.ok(
            harness.$('#mhc_deck_world_rules_list').html().includes('Standard world physics & tropes apply.'),
            'Empty state must render default hint in #mhc_deck_world_rules_list'
        );
        assert.strictEqual(
            harness.getElement('#mhc_deck_custom_module_card')?.visible,
            false,
            '#mhc_deck_custom_module_card must be hidden when no customModule is configured'
        );

        // 3b. Populated World Axioms + Custom HUD Module rendering
        const active = getActiveConciergeDossier();
        active.worldRules = {
            axioms: [
                {
                    title: 'Biological Technology',
                    category: 'biology_for_tech',
                    axiom: 'Mechanical machines are replaced by biotechnology.',
                    substitutions: ['Cars -> Giant beetles'],
                    negativeConstraints: ['No combustion engines'],
                    architecturalNotes: 'Living hive buildings',
                },
            ],
            customModule: {
                tag: 'RADIATION',
                label: 'Vault Radiation',
                instruction: 'Track accumulated rads per scene.',
                drivers: 'gm_deltas',
                sampleContent: 'Rads: 2/10',
            },
        };

        updateBlueprintDeck();

        assert.strictEqual(harness.$('#mhc_deck_world_rules_count').text(), '1');
        const renderedListHtml = harness.$('#mhc_deck_world_rules_list').html();
        assert.ok(renderedListHtml.includes('🌐 Biological Technology'));
        assert.ok(renderedListHtml.includes('BIOLOGY_FOR_TECH'));
        assert.ok(renderedListHtml.includes('No combustion engines'));

        assert.strictEqual(
            harness.getElement('#mhc_deck_custom_module_card')?.visible,
            true,
            '#mhc_deck_custom_module_card must be visible when customModule is configured'
        );
        assert.strictEqual(harness.$('#mhc_deck_custom_module_tag').text(), 'RADIATION');
        assert.strictEqual(harness.$('#mhc_deck_custom_module_label').text(), 'Vault Radiation');
        assert.strictEqual(harness.$('#mhc_deck_custom_module_instruction').text(), 'Track accumulated rads per scene.');
        assert.strictEqual(harness.$('#mhc_deck_custom_module_drivers').text(), '⚡ GM Deltas');
        assert.strictEqual(harness.getElement('#mhc_deck_custom_module_drivers')?.visible, true);
        assert.strictEqual(harness.$('#mhc_deck_custom_module_sample').text(), 'Rads: 2/10');
        assert.strictEqual(harness.getElement('#mhc_deck_custom_module_sample')?.visible, true);
    } finally {
        harness.cleanup();
    }
}

console.log('✓ updateBlueprintDeck behaviorally renders World Rules & Custom Module cards in live DOM');

// ── 4. Rendering Logic Execution ──────────────────────────────────────────────
console.log('Testing buildAxiomCardHtml production rendering...');

const sampleAxiom = {
    title: 'Biological Technology',
    category: 'biology_for_tech',
    axiom: 'Mechanical machines are replaced by biotechnology.',
    substitutions: ['Cars -> Giant beetles', 'Guns -> Spitting snakes'],
    negativeConstraints: ['No combustion engines', 'No steel firearms'],
    architecturalNotes: 'Living hive buildings with bone skybridges',
};

const renderedHtml = buildAxiomCardHtml(sampleAxiom);
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
const safeRendered = buildAxiomCardHtml(unsafeAxiom);
assert.ok(!safeRendered.includes('<script>'));
assert.ok(safeRendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(safeRendered.includes('&amp; &quot;quotes&quot;'));
assert.ok(safeRendered.includes('&lt;danger&gt;'));
assert.ok(safeRendered.includes('&lt;forbidden&gt;'));
assert.ok(safeRendered.includes('&lt;structure&gt;'));

console.log('✓ UI render templates produce valid, securely escaped HTML markup with badges and icons');

console.log('--- ALL CONCIERGE WORLD RULES UI TESTS PASSED CLEANLY! ---');
