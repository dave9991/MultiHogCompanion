import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge World Rules & Dedicated Rules Lorebook Test Suite ---');

// ── 1. Runner Lorebook Targets Verification ──────────────────────────────────
console.log('Testing concierge-runner.js lorebook targets...');
const runnerPath = path.join(ROOT_DIR, 'concierge-runner.js');
const runnerCode = fs.readFileSync(runnerPath, 'utf8');

assert.ok(runnerCode.includes('rulesBookName'), 'concierge-runner.js must define rulesBookName');
assert.ok(runnerCode.includes('upsertWorldInfoBook(rulesBookName, dist.worldRules)'), 'concierge-runner.js must upsert worldRules into rulesBookName');
assert.ok(!runnerCode.includes('upsertWorldInfoBook(locBookName, dist.worldRules)'), 'concierge-runner.js must NOT upsert worldRules into locBookName');

console.log('✓ concierge-runner.js cleanly routes worldRules into dedicated _Rules book');

// ── 2. Modal UI Verification (Dismiss Button) ─────────────────────────────────
console.log('Testing concierge-modal.html elements...');
const modalPath = path.join(ROOT_DIR, 'concierge-modal.html');
const modalHtml = fs.readFileSync(modalPath, 'utf8');

assert.ok(modalHtml.includes('id="mhc_deck_remove_custom_mod_btn"'), 'concierge-modal.html must include #mhc_deck_remove_custom_mod_btn');

const uiJsPath = path.join(ROOT_DIR, 'concierge-ui.js');
const uiJs = fs.readFileSync(uiJsPath, 'utf8');
assert.ok(uiJs.includes('mhc_deck_remove_custom_mod_btn'), 'concierge-ui.js must bind #mhc_deck_remove_custom_mod_btn click event');
assert.ok(uiJs.includes('activeDossier.worldRules.customModule = null'), 'concierge-ui.js must nullify customModule on remove click');

console.log('✓ Custom HUD Tracker card features 1-click dismiss button with active controller binding');

// ── 3. Prompt Guardrails Verification ─────────────────────────────────────────
console.log('Testing concierge-prompt.js guardrails...');
const promptPath = path.join(ROOT_DIR, 'concierge-prompt.js');
const promptCode = fs.readFileSync(promptPath, 'utf8');

assert.ok(promptCode.includes('NEVER emit generic trackers'), 'concierge-prompt.js must explicitly forbid generic trackers');
assert.ok(promptCode.includes('Status Tracking'), 'concierge-prompt.js must specifically call out Status Tracking');
assert.ok(promptCode.includes('Encounter Tracking'), 'concierge-prompt.js must specifically call out Encounter Tracking');

console.log('✓ concierge-prompt.js contains strict guardrails against hallucinating generic trackers');

console.log('--- ALL CONCIERGE WORLD RULES & DEDICATED RULES LOREBOOK TESTS PASSED CLEANLY! ---');
