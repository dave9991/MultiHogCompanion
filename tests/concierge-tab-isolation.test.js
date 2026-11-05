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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('MultiHog Companion — Tab Scoping & Isolation Suite', async (t) => {
    const indexJs = fs.readFileSync(path.join(ROOT_DIR, 'index.js'), 'utf8');
    const conciergeUiJs = fs.readFileSync(path.join(ROOT_DIR, 'concierge-ui.js'), 'utf8');
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

    await t.test('2. concierge-ui.js scopes Concierge modal tab switching to #mhc_concierge_modal', () => {
        // Must NOT use unadorned $('.mhc-tab-btn').on('click')
        assert.ok(!conciergeUiJs.includes("$('.mhc-tab-btn').on('click'"),
            'concierge-ui.js must not bind global unqualified $(".mhc-tab-btn") click listener');
        assert.ok(conciergeUiJs.includes("$('#mhc_concierge_modal').on('click', '.mhc-dossier-tabs .mhc-tab-btn'"),
            'concierge-ui.js must delegate tab clicks scoped to #mhc_concierge_modal .mhc-dossier-tabs');
        assert.ok(conciergeUiJs.includes("export function setConciergeTab("),
            'concierge-ui.js must export setConciergeTab for deterministic tab switching');
    });

    await t.test('3. concierge-ui.js guarantees Live Blueprint is active and unhidden upon loading active campaign', () => {
        assert.ok(conciergeUiJs.includes("setConciergeTab('cards')"),
            'concierge-ui.js must switch to cards tab upon loading or resetting active campaign');
    });

    await t.test('4. style.css enforces display: flex !important on active Concierge tab content to defeat inline hide() styles', () => {
        assert.match(styleCss, /#mhc_concierge_modal\s+\.mhc-tab-content\.active[\s\S]*display:\s*flex\s*!important/,
            'style.css must enforce display: flex !important on active Concierge modal tabs');
        assert.match(styleCss, /\.multihog-companion-settings\s*>\s*\.mhc-tab-content\.active[\s\S]*display:\s*block\s*!important/,
            'style.css must enforce display: block !important on active Settings tabs');
    });
});
