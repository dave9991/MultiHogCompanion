import assert from 'node:assert';
import {
    buildInventoryBlock, parseSuggestedStarts, isVectorsWorldInfoEnabled, estimateTokens,
    stageCanonSource, clearStagedCanon, setModeOverride, shouldBrief, markBriefed, isBriefed,
} from '../concierge-canon.js';
import { buildArchivistBriefingPrompt, buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running Concierge Archivist Briefing Test Suite ---');

const entries = [
    ...Array.from({ length: 40 }, (_, i) => ({ kind: 'NPC', name: `Person Number ${i}`, importance: (i % 5) + 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ kind: 'LOCATION', name: `Place ${i}`, importance: 3 })),
    { kind: 'MONSTER', name: 'The Ash Wyrm', importance: 5 },
];
const block = buildInventoryBlock(entries);
assert.ok(block.includes('[CANON_INVENTORY: 53 entries'));
assert.ok(block.includes('NPCs (40)'));
assert.ok(block.includes('The Ash Wyrm'));
assert.ok(!block.includes('Person Number 0') || block.includes('…'), 'names are trimmed to top N');
assert.ok(estimateTokens(block) <= 1000);
assert.ok(estimateTokens(buildInventoryBlock(entries, 80)) <= 150, 'tight budget shrinks block');
assert.strictEqual(buildInventoryBlock([]), '');

const parsed = parseSuggestedStarts('Found lots!\n[SUGGESTED_STARTS]\n- The harbor city\n2. War of ash\n* Wyrm hunt\n- four\n- five\n[/SUGGESTED_STARTS]\nBye');
assert.deepStrictEqual(parsed.starts, ['The harbor city', 'War of ash', 'Wyrm hunt', 'four']);
assert.ok(!parsed.text.includes('SUGGESTED'));
assert.ok(parsed.text.includes('Found lots!') && parsed.text.includes('Bye'));
assert.deepStrictEqual(parseSuggestedStarts('no block').starts, []);

assert.strictEqual(isVectorsWorldInfoEnabled({ vectors: { enabled_world_info: true } }), true);
assert.strictEqual(isVectorsWorldInfoEnabled({ vectors: {} }), false);
assert.strictEqual(isVectorsWorldInfoEnabled(undefined), false);

// shouldBrief lifecycle
clearStagedCanon(); setModeOverride('auto');
assert.strictEqual(shouldBrief(), false);
await stageCanonSource({ name: 'tiny', type: 'doc', text: 'small' });
assert.strictEqual(shouldBrief(), false, 'vibe mode never briefs');
setModeOverride('archivist');
await stageCanonSource({ name: 'tiny', type: 'doc', text: '# Town\nA city.' });
assert.strictEqual(shouldBrief(), true);
markBriefed();
assert.ok(isBriefed());
assert.strictEqual(shouldBrief(), false);
clearStagedCanon();
assert.strictEqual(isBriefed(), false, 'clear resets briefed flag');
setModeOverride('auto');

// prompts
const bp = buildArchivistBriefingPrompt();
assert.ok(bp.includes('Do NOT emit [UPDATE_DOSSIER]'));
assert.ok(bp.includes('[SUGGESTED_STARTS]'));
assert.ok(buildConciergeSystemPrompt().includes('[CANON_INVENTORY]'));

console.log('✅ Concierge Archivist Briefing test suite passed.');
