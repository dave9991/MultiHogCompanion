/**
 * tests/world-skeleton-integration.test.js
 *
 * Verification suite for Phase 2:
 * 1. World Skeleton Markdown adherence to MultiHog contract (## FACTIONS, ## LOCATIONS, ## CONFLICTS)
 * 2. Day 0 Baseline record structure:
 *    - disable: true (never injected into narrative directly)
 *    - key: [] (no accidental keyword hits)
 *    - comment formatted as TYPE: Label
 *    - content prefixed with [Day 0 Baseline]
 *    - extensions tagged with { rpgCategory, rpgSkeleton: true }
 * 3. Strict macro rule: named individual NPCs are excluded from the skeleton
 */

import assert from 'node:assert';
import {
    buildWorldSkeletonMarkdown,
    buildWorldSkeletonEntries,
} from '../concierge-lore-distributor.js';

console.log('--- Running World Skeleton Integration Test Suite ---');

const testDossier = {
    meta: {
        title: 'Silas & The Wendigo',
        premise: 'A winter survival investigation in the pine valley.',
        tone: 'Grim and claustrophobic',
    },
    theKick: {
        startingLocation: 'Blackwood Pines Station',
        crisis: 'A catastrophic blizzard knocks out communications and tracks lead into the deep woods.',
    },
    factions: [
        {
            name: 'The Rangers Guild',
            standing: 'Friendly',
            agenda: 'maintain alpine watch and rescue stranded hikers',
            notes: 'Led by Captain Ward',
        },
        {
            name: 'The Whispering Circle',
            standing: 'Hostile',
            agenda: 'awaken ancient entities sleeping beneath the permafrost',
        },
    ],
    npcs: [
        {
            name: 'Marta Okonkwo',
            role: 'Station Keeper',
            appearance: 'Weathered face, silver hair',
        },
    ],
    monsters: [
        {
            name: 'Ash Wendigo',
            weakness: 'White birch fire',
            impendingDoom: ['Hunters disappear', 'Claw marks on cabin', 'Full blizzard siege'],
        },
    ],
    maps: [
        {
            site: 'Blackwood Pines Station',
            kind: 'SETTLEMENT',
            threat: 'MODERATE',
            briefDescription: 'An alpine ranger outpost surrounded by snowdrifts.',
        },
        {
            site: 'Frost-Hollow Caverns',
            kind: 'DUNGEON',
            threat: 'HIGH',
            briefDescription: 'Subterranean ice caves beneath the mountain peak.',
        },
    ],
};

// ── Test 1: Markdown Structure Contract ─────────────────────────────────────
console.log('Testing World Skeleton Markdown formatting...');
const md = buildWorldSkeletonMarkdown(testDossier);

assert.ok(md.includes('## FACTIONS'), 'Must include ## FACTIONS header');
assert.ok(md.includes('## LOCATIONS'), 'Must include ## LOCATIONS header');
assert.ok(md.includes('## CONFLICTS'), 'Must include ## CONFLICTS header');

// Check levels and lines
assert.ok(md.includes('### The Rangers Guild'), 'Must format faction with ###');
assert.ok(md.includes('### Blackwood Pines Station'), 'Must format location with ###');
assert.ok(md.includes('### Threat of Ash Wendigo'), 'Must format monster conflict with ###');
assert.ok(md.includes('### The Silas & The Wendigo Crisis'), 'Must format starting crisis with ###');

// Ensure named NPC "Marta Okonkwo" does NOT appear as a section or entity
assert.ok(!md.includes('### Marta Okonkwo'), 'CRITICAL: Individual NPCs must not become skeleton entities');
assert.ok(!md.includes('## NPCS'), 'CRITICAL: Skeleton must not contain ## NPCS');

console.log('✓ Markdown structure strictly conforms to MultiHog macro skeleton contract');

// ── Test 2: Day 0 Baseline Entry Generation ─────────────────────────────────
console.log('Testing Day 0 Baseline Lorebook Entries...');
const entries = buildWorldSkeletonEntries(testDossier);

assert.ok(entries.length >= 4, `Expected at least 4 skeleton entries, found ${entries.length}`);

for (const entry of entries) {
    // Contract checks
    assert.strictEqual(entry.disable, true, `Entry "${entry.comment}" must have disable: true`);
    assert.deepStrictEqual(entry.key, [], `Entry "${entry.comment}" must have empty key array`);
    assert.strictEqual(entry.constant, false, `Entry "${entry.comment}" must have constant: false`);
    assert.ok(entry.content.startsWith('[Day 0 Baseline]\n'), `Entry "${entry.comment}" must begin with [Day 0 Baseline]`);
    assert.ok(entry.extensions?.rpgSkeleton === true, `Entry "${entry.comment}" must have rpgSkeleton: true`);
    assert.ok(['FAC', 'LOC', 'EVENT'].includes(entry.extensions?.rpgCategory), `Entry "${entry.comment}" has invalid rpgCategory`);
}

// Check category counts
const facEntries = entries.filter(e => e.extensions.rpgCategory === 'FAC');
const locEntries = entries.filter(e => e.extensions.rpgCategory === 'LOC');
const eventEntries = entries.filter(e => e.extensions.rpgCategory === 'EVENT');

assert.strictEqual(facEntries.length, 2, 'Should have 2 faction entries');
assert.strictEqual(locEntries.length, 2, 'Should have 2 location entries');
assert.strictEqual(eventEntries.length, 2, 'Should have 2 conflict entries (crisis + monster threat)');

assert.strictEqual(facEntries[0].comment, 'FACTION: The Rangers Guild');
assert.strictEqual(locEntries[0].comment, 'LOCATION: Blackwood Pines Station');
assert.strictEqual(eventEntries[0].comment, 'CONFLICT: Silas & The Wendigo Crisis');
assert.strictEqual(eventEntries[1].comment, 'CONFLICT: Threat of Ash Wendigo');

console.log('✓ Day 0 Baseline entries correctly created with strict flags and categories');
console.log('--- ALL WORLD SKELETON INTEGRATION TESTS PASSED CLEANLY! ---');
