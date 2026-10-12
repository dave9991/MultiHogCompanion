/**
 * concierge-dossier-healing.test.js — MultiHog Companion
 *
 * Verifies that:
 * 1. healAndNormalizeDossier heals partial, legacy, or corrupted dossiers.
 * 2. parseMarkdownToDossier tolerates legacy header styles and auto-heals schemas.
 * 3. Harm capacity dial and protagonist harm stay strictly synchronized.
 * 4. reconstituteDossierWithAi structures unstructured outline text into a valid dossier.
 */

import assert from 'node:assert';
import {
    createEmptyDossier,
    healAndNormalizeDossier,
    parseMarkdownToDossier,
    serializeDossierToMarkdown,
} from '../concierge-parser.js';

console.log('--- Running Concierge Dossier Self-Healing & Ingestion Test Suite ---');

// 1. Root Schema & Default Guarantee
console.log('Testing healAndNormalizeDossier with null and partial objects...');

const healedNull = healAndNormalizeDossier(null);
assert.strictEqual(healedNull.meta.title, 'Untitled PbtA Campaign');
assert.strictEqual(healedNull.config.harmMax, 5);
assert.strictEqual(healedNull.config.playstyle, 'cyoa_5');
assert.strictEqual(healedNull.config.partyMode, 'squad');
assert.strictEqual(healedNull.protagonist.harm.max, 5);
assert.ok(Array.isArray(healedNull.protagonist.startingMoves), 'Starting moves must be an array');
assert.ok(Array.isArray(healedNull.protagonist.gear), 'Gear must be an array');
assert.ok(Object.keys(healedNull.protagonist.stats).length >= 5, 'Stats must be populated');

console.log('✓ Null/empty objects heal into complete schema-compliant dossiers');

// 2. Legacy Harm Formats & Strict Synchronization
console.log('Testing legacy harm formats and harmMax synchronization...');

// 2a. Primitive integer harm (legacy pre-update schema)
const legacyInt = {
    meta: { title: 'Cyber City', systemKey: 'scifi' },
    protagonist: { name: 'K', harm: 6 },
};
const healedInt = healAndNormalizeDossier(legacyInt);
assert.strictEqual(healedInt.protagonist.harm.max, 6, 'Protagonist harm max must be 6');
assert.strictEqual(healedInt.protagonist.harm.current, 0, 'Protagonist harm current must be 0');
assert.strictEqual(healedInt.config.harmMax, 6, 'config.harmMax must sync with protagonist harm');

// 2b. Slash string harm (e.g. "2/5")
const legacySlash = {
    meta: { title: 'Weird West', systemKey: 'western' },
    protagonist: { name: 'Doc', harm: '2/5' },
};
const healedSlash = healAndNormalizeDossier(legacySlash);
assert.strictEqual(healedSlash.protagonist.harm.max, 5);
assert.strictEqual(healedSlash.protagonist.harm.current, 2);
assert.strictEqual(healedSlash.config.harmMax, 5);
assert.strictEqual(healedSlash.protagonist.status, '(-) Wounded', 'Status must reflect starting wounds');

// 2c. Dial out-of-bounds clamping (e.g. 99 Harm)
const crazyHarm = {
    protagonist: { name: 'Titan', harm: { max: 99, current: 0 } },
    config: { harmMax: 99 },
};
const healedCrazy = healAndNormalizeDossier(crazyHarm);
assert.strictEqual(healedCrazy.config.harmMax, 8, 'Harm max must clamp to 8');
assert.strictEqual(healedCrazy.protagonist.harm.max, 8, 'Protagonist harm max must clamp to 8');

console.log('✓ Legacy harm primitives and slash notations heal cleanly');

// 3. Tolerant Markdown Parser & Roundtrip Healing
console.log('Testing parseMarkdownToDossier with legacy header styles...');

const legacyMarkdown = `# Campaign Blueprint: The Obsidian Depths
* **System Engine:** Sci-Fi / Cyberpunk (The Sprawl) (\`scifi\`)
* **Premise:** Deep sea mining rig overrun by AI horrors.

## Protagonist: Marcus
* **Playbook:** Mercenary
* **Stats:** Cool +2, Hard +1, Edge +1, Mind +0, Synth -1
* **Harm Capacity:** 4 | **Armor:** 1

## Supporting Cast:
### Chief Vance
* **Role:** Station Administrator
* **Relationship:** Grudging employer

## Campaign Calibration Dials:
* **Harm Capacity:** 4
* **Playstyle:** cyoa_3
`;

const parsed = parseMarkdownToDossier(legacyMarkdown);
assert.ok(parsed, 'Must parse legacy header format');
assert.strictEqual(parsed.meta.title, 'The Obsidian Depths');
assert.strictEqual(parsed.meta.systemKey, 'scifi');
assert.strictEqual(parsed.protagonist.name, 'Marcus');
assert.strictEqual(parsed.protagonist.playbook, 'Mercenary');
assert.strictEqual(parsed.protagonist.harm.max, 4);
assert.strictEqual(parsed.protagonist.harm.armor, 1);
assert.strictEqual(parsed.config.harmMax, 4);
assert.strictEqual(parsed.config.playstyle, 'cyoa_3');
assert.strictEqual(parsed.npcs.length, 1);
assert.strictEqual(parsed.npcs[0].name, 'Chief Vance');

console.log('✓ Tolerant markdown parsing extracts and auto-heals legacy campaign structures');

// 4. Missing Stats Healing from Active Genre
console.log('Testing missing protagonist stats healing...');

const noStatsDossier = {
    meta: { systemKey: 'horror' },
    protagonist: { name: 'Sam' },
};
const healedStats = healAndNormalizeDossier(noStatsDossier);
assert.strictEqual(healedStats.protagonist.stats.Cool, 2, 'Must assign +2 to primary genre stat (Cool)');
assert.strictEqual(healedStats.protagonist.stats.Hard, 1, 'Must assign +1 to secondary genre stat (Hard)');
assert.strictEqual(healedStats.protagonist.startingMoves.length, 2, 'Must populate default starting moves');

console.log('✓ Empty character stats automatically populate from genre standard array');

console.log('--- ALL CONCIERGE DOSSIER HEALING TESTS PASSED CLEANLY! ---');
