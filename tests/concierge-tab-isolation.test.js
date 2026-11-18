/**
 * concierge-tab-isolation.test.js — MultiHog Companion
 *
 * Verifies strict UI tab isolation between the Settings sub-tabs
 * (#extensions_settings) and the Concierge blueprint deck (#mhc_concierge_modal).
 *
 * Prevents regressions where Settings tab switches call global jQuery .hide()
 * on .mhc-tab-content, causing the Concierge Live Blueprint to render pitch black / blank
 * upon loading or resetting an active campaign.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomHarness } from './helpers/dom-harness.js';
import {
    setConciergeTab,
    bindModalEvents,
    resetConciergeState,
} from '../concierge-ui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('MultiHog Companion — Tab Scoping & Isolation Suite', async (t) => {
    const indexJs = fs.readFileSync(path.join(ROOT_DIR, 'index.js'), 'utf8');
    const styleCss = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');

    await t.test('1. index.js scopes Settings sub-tab navigation to #extensions_settings', () => {
        // Must NOT use unadorned $('.mhc-tab-btn') or $('.mhc-tab-content') in settings navigation
        assert.ok(!indexJs.includes("function setActiveTab(tabId) {\n            $('.mhc-tab-btn')"),
            'index.js setActiveTab must not use un-scoped global $(".mhc-tab-btn")');
        assert.ok(indexJs.includes("settingsRoot.find('.mhc-tab-bar')") || indexJs.includes("tabBar.find('.mhc-tab-btn')"),
            'index.js setActiveTab must scope button active classes to settings');
        assert.ok(indexJs.includes("settingsRoot.find('.multihog-companion-settings > .mhc-tab-content") || indexJs.includes("#mhc_tab_ruleset"),
            'index.js setActiveTab must scope tab panel visibility exclusively to settings tabs');
    });

    await t.test('2. concierge-ui.js scopes Concierge modal tab switching & delegation to #mhc_concierge_modal', () => {
        const harness = installDomHarness();
        try {
            // Seed modal root before binding events (dropArea attaches native dragover/drop listeners)
            harness.$('#mhc_concierge_modal');
            bindModalEvents();

            const modalClickHandlers = harness.getElement('#mhc_concierge_modal')?.handlers.get('click') || [];
            assert.ok(
                modalClickHandlers.some(h => h.delegateSelector === '.mhc-dossier-tabs .mhc-tab-btn'),
                'bindModalEvents must register delegated click handler scoped to #mhc_concierge_modal .mhc-dossier-tabs .mhc-tab-btn'
            );
            const globalTabHandlers = harness.getElement('.mhc-tab-btn')?.handlers.get('click') || [];
            assert.strictEqual(
                globalTabHandlers.length,
                0,
                'must not bind global unqualified $(".mhc-tab-btn") click listener'
            );

            // Seed Settings sub-tab panel as active & visible to verify zero cross-contamination
            harness.$('#extensions_settings .mhc-tab-content').addClass('active').show();

            setConciergeTab('raw');
            assert.strictEqual(
                harness.$('#mhc_concierge_modal .mhc-dossier-tabs .mhc-tab-btn[data-tab="raw"]').hasClass('active'),
                true,
                'raw tab button inside modal must receive active class'
            );
            assert.strictEqual(
                harness.getElement('#mhc_concierge_modal #mhc_tab_raw')?.visible,
                true,
                '#mhc_tab_raw inside modal must be shown'
            );
            assert.strictEqual(
                harness.getElement('#mhc_concierge_modal .mhc-dossier-column > .mhc-tab-content')?.visible,
                false,
                'modal sibling tab panels must be hidden when switching tabs'
            );
            assert.strictEqual(
                harness.getElement('#extensions_settings .mhc-tab-content')?.visible,
                true,
                'Settings #extensions_settings .mhc-tab-content visibility must remain untouched'
            );
            assert.strictEqual(
                harness.$('#extensions_settings .mhc-tab-content').hasClass('active'),
                true,
                'Settings #extensions_settings .mhc-tab-content active class must remain untouched'
            );
        } finally {
            harness.cleanup();
        }
    });

    await t.test('3. resetConciergeState restores Live Blueprint (cards) tab as active and visible', () => {
        const harness = installDomHarness();
        try {
            harness.$('#mhc_concierge_modal');
            setConciergeTab('debug');
            assert.strictEqual(harness.$('#mhc_concierge_modal #mhc_tab_debug').hasClass('active'), true);

            resetConciergeState({ showGreeting: false });

            assert.strictEqual(
                harness.$('#mhc_concierge_modal #mhc_tab_cards').hasClass('active'),
                true,
                'resetConciergeState must set #mhc_tab_cards active'
            );
            assert.strictEqual(
                harness.getElement('#mhc_concierge_modal #mhc_tab_cards')?.visible,
                true,
                'resetConciergeState must make #mhc_tab_cards visible'
            );
        } finally {
            harness.cleanup();
        }
    });

    await t.test('4. style.css enforces display: flex !important on active Concierge tab content to defeat inline hide() styles', () => {
        assert.match(styleCss, /#mhc_concierge_modal\s+\.mhc-tab-content\.active[\s\S]*display:\s*flex\s*!important/,
            'style.css must enforce display: flex !important on active Concierge modal tabs');
        assert.match(styleCss, /\.multihog-companion-settings\s*>\s*\.mhc-tab-content\.active[\s\S]*display:\s*block\s*!important/,
            'style.css must enforce display: block !important on active Settings tabs');
    });
});
