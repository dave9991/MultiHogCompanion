import assert from 'node:assert';
import {
    detectActiveGenre,
    buildTailoredPbtaDocumentation,
    appendPbtaDocsToManual,
    setupCompanionDocInterceptor,
    teardownCompanionDocInterceptor,
} from '../pbta-companion-bridge.js';
import {
    extractPbtaCharacterState,
    normalizePbtaMemo,
} from '../pbta-vitality-sync.js';
import { PBTA_GENRES } from '../pbta-ruleset.js';

console.log('--- Running PbtA Adventure Companion Bridge Test Suite ---');

// ── 1. Genre Detection Tests ──────────────────────────────────────────────────
console.log('Testing detectActiveGenre...');

// 1a. Explicit override
assert.strictEqual(
    detectActiveGenre({ lastGenre: 'scifi' }),
    'scifi',
    'Explicit lastGenre should be respected'
);
assert.strictEqual(
    detectActiveGenre({ lastGenre: 'western' }),
    'western',
    'Western genre should be detected'
);

// 1b. Detected from state memo stats
const westernMemo = `[CHARACTER]
Cole Vance (Gunslinger): 5/5 HP | Harm: 0/5 | Armor: 1
Stats: Quick +2, Iron +1, Grit +1, Instinct 0, Savvy -1
((PILLS)) Moves: Quick Draw (+Quick), Fan the Hammer (+Iron)
[/CHARACTER]`;
assert.strictEqual(
    detectActiveGenre({ currentMemo: westernMemo }),
    'western',
    'Western stats in memo should trigger western genre detection'
);

const scifiMemo = `[CHARACTER]
Nova (Netrunner): 5/5 HP | Harm: 0/5 | Armor: 0
Stats: Mind +2, Cool +1, Edge +1, Hard 0, Synth -1
((PILLS)) Moves: Jack In / Hack (+Mind), Act Under Pressure (+Cool)
[/CHARACTER]`;
assert.strictEqual(
    detectActiveGenre({ currentMemo: scifiMemo }),
    'scifi',
    'Sci-Fi stats in memo should trigger scifi genre detection'
);

const animeMemo = `[CHARACTER]
Ren (Hothead): 5/5 HP | Harm: 0/5 | Armor: 0
Stats: Danger +2, Freak +1, Savior +1, Superior 0, Mundane -1
((PILLS)) Moves: Directly Engage (+Danger)
[/CHARACTER]`;
assert.strictEqual(
    detectActiveGenre({ currentMemo: animeMemo }),
    'anime',
    'Anime stats in memo should trigger anime genre detection'
);

// 1c. Default fallback
assert.strictEqual(
    detectActiveGenre({}),
    'fantasy',
    'Empty context should default to fantasy'
);
console.log('✓ detectActiveGenre accurately identifies genre across overrides, memo stats, and defaults');

// ── 2. Tailored Documentation Generation Tests ───────────────────────────────
console.log('Testing buildTailoredPbtaDocumentation...');

const scifiDoc = buildTailoredPbtaDocumentation('scifi');
assert.ok(scifiDoc.includes('Core 2d6 Move Resolution'), 'Must include 2d6 resolution table');
assert.ok(scifiDoc.includes('Strong Hit'), 'Must include Strong Hit (10+)');
assert.ok(scifiDoc.includes('Weak Hit'), 'Must include Weak Hit (7–9)');
assert.ok(scifiDoc.includes('Miss'), 'Must include Miss (6- / +1 XP)');
assert.ok(scifiDoc.includes('Zero-Touch RNG'), 'Must include Zero-Touch RNG queue explanation');
assert.ok(scifiDoc.includes('Harm Clock (0–5)'), 'Must include Harm Clock explanation');
assert.ok(scifiDoc.includes('Active Campaign Genre: Sci-Fi / Cyberpunk'), 'Must detail active Sci-Fi genre');
assert.ok(scifiDoc.includes('Cool (calm under fire)'), 'Must include Sci-Fi stat descriptions');
assert.ok(scifiDoc.includes('Jack In / Hack (+Mind)'), 'Must include Sci-Fi specific moves');
assert.ok(scifiDoc.includes('Guidelines for Adventure Companion (CHAT)'), 'Must include Adventure Companion operational guidance');
assert.ok(scifiDoc.includes('command_state_tracker'), 'Must instruct companion on state tracker commands using Harm');
assert.ok(scifiDoc.includes('Fantasy (Dungeon World / Fellowship)'), 'Must include other genres in quick reference');

console.log('✓ buildTailoredPbtaDocumentation constructs comprehensive, genre-tailored documentation');

// ── 3. Append to Upstream Manual Tests ────────────────────────────────────────
console.log('Testing appendPbtaDocsToManual...');

const mockUpstreamDoc = '# MultiHog D&D Framework Documentation\n\nDefault D&D 5e engine docs.';
const combined = appendPbtaDocsToManual(mockUpstreamDoc, 'western');

assert.ok(combined.startsWith(mockUpstreamDoc), 'Must preserve original upstream documentation verbatim');
assert.ok(combined.includes('Active Campaign Genre: Western / Weird West'), 'Must append tailored Western section');
console.log('✓ appendPbtaDocsToManual non-invasively appends PbtA documentation to upstream manual');

// ── 4. Fetch Interceptor Tests (Strategy 1) ──────────────────────────────────
console.log('Testing setupCompanionDocInterceptor window.fetch hook...');

// Mock browser environment
const originalGlobalWindow = globalThis.window;
let mockFetchCalled = false;
let interceptedUrl = null;

const fakeUpstreamResponse = new Response('# Upstream MultiHog Documentation\nUpstream content.', {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/markdown' },
});

globalThis.window = {
    fetch: async (input) => {
        mockFetchCalled = true;
        interceptedUrl = typeof input === 'string' ? input : input.url;
        if (interceptedUrl.includes('multihogDnDdoc.md')) {
            return fakeUpstreamResponse.clone();
        }
        return new Response('Unrelated data', { status: 200 });
    },
};

setupCompanionDocInterceptor();

// Test 4a: Intercepting multihogDnDdoc.md
const docRes = await globalThis.window.fetch('/scripts/extensions/third-party/SillyTavern-MultihogDnDFramework/docs/multihogDnDdoc.md');
assert.strictEqual(docRes.status, 200);
const augmentedContent = await docRes.text();

assert.ok(augmentedContent.includes('# Upstream MultiHog Documentation'), 'Must retain upstream content');
assert.ok(augmentedContent.includes('# Powered by the Apocalypse (PbtA) Framework Guide'), 'Must inject PbtA guide');
assert.ok(augmentedContent.includes('Core 2d6 Move Resolution'), 'Must inject 2d6 mechanics into fetched response');

// Test 4b: Unrelated fetch must pass through unaltered
const unrelatedRes = await globalThis.window.fetch('https://example.com/api/status');
const unrelatedContent = await unrelatedRes.text();
assert.strictEqual(unrelatedContent, 'Unrelated data', 'Unrelated requests must remain completely untouched');

// Test 4c: Clean teardown
teardownCompanionDocInterceptor();
const afterTeardownRes = await globalThis.window.fetch('/scripts/extensions/third-party/SillyTavern-MultihogDnDFramework/docs/multihogDnDdoc.md');
const afterTeardownText = await afterTeardownRes.text();
assert.ok(!afterTeardownText.includes('Powered by the Apocalypse'), 'After teardown, fetch returns unmodified upstream content');

// Restore original environment
globalThis.window = originalGlobalWindow;
console.log('✓ setupCompanionDocInterceptor cleanly intercepts multihogDnDdoc.md without disturbing other requests');

// ── 5. Strategy 3: State Memo Character Context Inspection ───────────────────
console.log('Testing Strategy 3: Character State Extraction from State Memo...');

const fullPbtaMemo = `[TIME]
Day 3, 02:15 PM (Afternoon)
[/TIME]

[LOCATION]
The Neon Underbelly, Sector 4
[/LOCATION]

[CHARACTER]
Kestrel (Infiltrator): 4/5 HP | Harm: 1/5 | Armor: 1
Stats: Cool +2, Edge +1, Mind +1, Hard 0, Synth -1
((PILLS)) Moves: Act Under Pressure (+Cool), Assess Situation (+Mind), Engage Hostiles (+Edge)
((PILLS)) Gear: Silenced Flechette Pistol (2 Harm, close), Chameleon Suit (Armor 1)
((PILLS)) Conditions: [ (-) Shaken: -1 Mind • ]
Hold/Forward: +1 Forward (next roll)
XP: 2/5
Status: Alert
[/CHARACTER]`;

const normalizedMemo = normalizePbtaMemo(fullPbtaMemo);
const charState = extractPbtaCharacterState(normalizedMemo);

assert.strictEqual(charState.isPbta, true, 'Memo must be identified as PbtA');
assert.strictEqual(charState.name, 'Kestrel', 'Character name should be extracted');
assert.strictEqual(charState.playbook, 'Infiltrator', 'Playbook should be extracted');
assert.strictEqual(charState.curHp, 4, 'Tandem HP should be extracted');
assert.strictEqual(charState.maxHp, 5, 'Max HP should be extracted');
assert.strictEqual(charState.curHarm, 1, 'Current Harm should be extracted');
assert.strictEqual(charState.maxHarm, 5, 'Max Harm should be extracted');
assert.strictEqual(charState.armor, 1, 'Armor should be extracted');
assert.ok(charState.stats.includes('Cool +2'), 'Character stats must be present');
assert.ok(charState.moves.includes('Act Under Pressure (+Cool)'), 'Character moves must be present');
assert.ok(charState.conditions.includes('Shaken'), 'Character conditions must be present');
assert.strictEqual(charState.xp, 2, 'XP must be extracted');

console.log('✓ extractPbtaCharacterState accurately verifies character stats, moves, harm, and conditions in memo');
console.log('--- ALL PBTA ADVENTURE COMPANION BRIDGE TESTS PASSED CLEANLY! ---');
