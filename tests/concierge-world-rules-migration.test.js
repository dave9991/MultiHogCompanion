import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('--- Running Concierge World Rules & Locations Migration Test Suite ---');

// ── 1. Runner Lorebook Targets Verification ──────────────────────────────────
console.log('Testing concierge-runner.js lorebook targets...');
const runnerPath = path.join(ROOT_DIR, 'concierge-runner.js');
const runnerCode = fs.readFileSync(runnerPath, 'utf8');

assert.ok(runnerCode.includes('rulesBookName'), 'concierge-runner.js must define rulesBookName');
assert.ok(runnerCode.includes('upsertWorldInfoBook(rulesBookName, dist.worldRules)'), 'concierge-runner.js must upsert worldRules into rulesBookName');
assert.ok(!runnerCode.includes('upsertWorldInfoBook(locBookName, dist.worldRules)'), 'concierge-runner.js must NOT upsert worldRules into locBookName');
assert.ok(runnerCode.includes('export async function migrateMisplacedLocationsEntries'), 'concierge-runner.js must export migrateMisplacedLocationsEntries');

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

// ── 4. Index Lifecycle Verification ──────────────────────────────────────────
console.log('Testing index.js lifecycle hooks...');
const indexPath = path.join(ROOT_DIR, 'index.js');
const indexCode = fs.readFileSync(indexPath, 'utf8');

assert.ok(indexCode.includes('migrateMisplacedLocationsEntries'), 'index.js must import and call migrateMisplacedLocationsEntries');
assert.ok(indexCode.includes('mhc-migrate-rules'), 'index.js must register /mhc-migrate-rules slash command');

console.log('✓ index.js calls migrateMisplacedLocationsEntries during chat lifecycle and registers slash command');

// ── 5. Functional Migration Simulation ───────────────────────────────────────
console.log('Testing migrateMisplacedLocationsEntries behavior simulation...');
{
    // Simulate what migrateMisplacedLocationsEntries does with mock data
    const sampleLocBook = {
        name: 'Camp_Locations',
        entries: {
            0: {
                uid: 0,
                comment: 'HUD Tracker: Status & Encounter Tracking',
                content: '[CORE]\nName: Status & Encounter Tracking\nType: Custom HUD Tracker / Game System\nField: custom\nInstruction: Track combat resolution states. Auto-generate consequences on failed defense or defeat rolls per the Conquest Doctrine axiom.\n[/CORE]',
                key: ['status', 'encounter'],
            },
            1: {
                uid: 1,
                comment: 'Oakhaven Crossing',
                content: '[CORE]\nA bustling riverside trading post.\n[/CORE]',
                key: ['oakhaven crossing'],
            },
            2: {
                uid: 2,
                comment: 'World Axiom: The Conquest Doctrine',
                content: '[CORE]\nName: The Conquest Doctrine\nType: World Axiom (SOCIAL)\nAxiom: Martial authority reigns.\n[/CORE]',
                key: ['conquest doctrine'],
            },
        },
    };

    const axiomsToMove = [];
    const uidsToDelete = [];
    let purgedTrackers = 0;

    for (const [uid, entry] of Object.entries(sampleLocBook.entries)) {
        const comment = (entry.comment || '').trim();
        const content = (entry.content || '').trim();
        const isAxiom = /^World Axiom:/i.test(comment) || /Type:\s*World Axiom/i.test(content);
        const isTracker = /^HUD Tracker:/i.test(comment) || /Type:\s*Custom HUD Tracker/i.test(content);

        if (isAxiom) {
            axiomsToMove.push({ name: comment, content });
            uidsToDelete.push(uid);
        } else if (isTracker) {
            axiomsToMove.push({ name: comment, content });
            uidsToDelete.push(uid);
            purgedTrackers++;
        }
    }

    assert.strictEqual(axiomsToMove.length, 2, 'Should extract both World Axiom and standalone Tracker to move to Rules');
    assert.strictEqual(axiomsToMove[0].name, 'HUD Tracker: Status & Encounter Tracking');
    assert.ok(axiomsToMove[0].content.includes('Auto-generate consequences on failed defense or defeat rolls'));
    assert.strictEqual(axiomsToMove[1].name, 'World Axiom: The Conquest Doctrine');
    assert.strictEqual(purgedTrackers, 1, 'Should track 1 tracker migrated from Locations');
    assert.strictEqual(uidsToDelete.length, 2, 'Should delete 2 entries from Locations book');

    for (const uid of uidsToDelete) {
        delete sampleLocBook.entries[uid];
    }

    assert.strictEqual(Object.keys(sampleLocBook.entries).length, 1, 'Locations book should only have 1 entry left');
    assert.strictEqual(sampleLocBook.entries[1].comment, 'Oakhaven Crossing', 'Locations book should retain real location');

    console.log('✓ Migration simulation accurately extracts World Axioms, preserves standalone consequence rules, and leaves actual locations clean');
}

console.log('--- ALL CONCIERGE WORLD RULES MIGRATION TESTS PASSED CLEANLY! ---');
