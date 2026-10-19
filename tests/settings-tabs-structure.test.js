import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsHtmlPath = path.resolve(__dirname, '../settings.html');
const styleCssPath = path.resolve(__dirname, '../style.css');

test('MultiHog Companion Settings Reorganization Structure', async (t) => {
    const html = fs.readFileSync(settingsHtmlPath, 'utf8');
    const css = fs.readFileSync(styleCssPath, 'utf8');

    await t.test('settings.html contains tab buttons with proper data-tab attributes', () => {
        assert.match(html, /class="mhc-tab-btn active"\s+data-tab="ruleset"/, 'Ruleset tab button should be present and active by default');
        assert.match(html, /class="mhc-tab-btn"\s+data-tab="story"/, 'Story & Sync tab button should be present');
        assert.match(html, /class="mhc-tab-btn"\s+data-tab="media"/, 'Media & Tools tab button should be present');
    });

    await t.test('settings.html contains tab content panels corresponding to data-tab ids', () => {
        assert.match(html, /id="mhc_tab_ruleset"/, 'Tab content for ruleset must exist');
        assert.match(html, /id="mhc_tab_story"/, 'Tab content for story must exist');
        assert.match(html, /id="mhc_tab_media"/, 'Tab content for media must exist');
    });

    await t.test('Ruleset tab contains Ruleset Engine and Concierge controls', () => {
        const rulesetTabSlice = html.split('id="mhc_tab_ruleset"')[1].split('id="mhc_tab_story"')[0];
        assert.match(rulesetTabSlice, /id="mhc_pbta_genre"/, 'Genre dropdown must be in ruleset tab');
        assert.match(rulesetTabSlice, /id="mhc_open_concierge_btn"/, 'Concierge button must be in ruleset tab');
        assert.match(rulesetTabSlice, /id="mhc_pbta_quickstart"/, 'Quickstart button must be in ruleset tab');
    });

    await t.test('Story tab contains CYOA Safety Net, Relationship Sync, and Lorebook Sync', () => {
        const storyTabSlice = html.split('id="mhc_tab_story"')[1].split('id="mhc_tab_media"')[0];
        assert.match(storyTabSlice, /id="mhc_cyoa_enable"/, 'CYOA Safety Net must be in story tab');
        assert.match(storyTabSlice, /id="mhc_rel_narrative_sync"/, 'Relationship Sync must be in story tab');
        assert.match(storyTabSlice, /id="mhc_lorebook_sync_enable"/, 'Lorebook Sync must be in story tab');
    });

    await t.test('Media tab contains Persona Sync, Aspect-Ratio Bridge, and NameRAG', () => {
        const mediaTabSlice = html.split('id="mhc_tab_media"')[1];
        assert.match(mediaTabSlice, /id="mhc_persona_sync"/, 'Persona Sync must be in media tab');
        assert.match(mediaTabSlice, /id="mhc_aspect_ratio_bridge"/, 'Aspect-Ratio Bridge must be in media tab');
        assert.match(mediaTabSlice, /id="mhc_namerag_section"/, 'NameRAG section must be in media tab');
    });

    await t.test('style.css defines styling for tabs and transitions', () => {
        assert.match(css, /\.mhc-tab-bar\s*\{/, 'Tab bar CSS must be defined');
        assert.match(css, /\.mhc-tab-btn\.active\s*\{/, 'Active tab CSS must be defined');
        assert.match(css, /\.mhc-tab-content\.active\s*\{/, 'Active tab content CSS must be defined');
    });
});
