import assert from 'node:assert';
import {
    retrieveCanonSlice, buildFocusBlock, parsePromoteRequests, stripPromoteTags, resolvePromoteRequests,
    markSlicePromoted, getPromotedSet, clearStagedCanon, estimateTokens, ARCHIVIST_QUOTAS,
} from '../concierge-canon.js';
import { buildConciergeBuilderPrompt } from '../concierge-prompt.js';
import { stripConciergeStateBlocks } from '../concierge-parser.js';

console.log('--- Running Concierge Canon Slice & Promote Test Suite ---');

const mk = (kind, name, content, keys = [name], importance = 3) => ({ kind, name, comment: `[${kind}] ${name}`, keys, content, importance });
const entries = [
    mk('LOCATION', 'Harbor of Ash', 'A smoking port city where the Salt Court rules.', ['Harbor of Ash', 'ash harbor'], 4),
    mk('FACTION', 'The Salt Court', 'Smugglers who run the harbor docks.', ['Salt Court'], 5),
    mk('NPC', 'Captain Vey', 'Harbor master, owes the Salt Court a debt.', ['Vey'], 3),
    mk('MONSTER', 'The Ash Wyrm', 'Sleeps under the volcano far inland.', ['Ash Wyrm'], 5),
    mk('LORE', 'Moon Calendar', 'Twelve moons and nothing else relevant.', ['calendar'], 1),
];

// retrieval
let slice = retrieveCanonSlice(entries, "Let's start with: the harbor city");
let names = slice.map(e => e.name);
assert.ok(names.includes('Harbor of Ash') && names.includes('The Salt Court') && names.includes('Captain Vey'), names.join());
assert.ok(!names.includes('Moon Calendar'), 'no hit → not returned');
assert.strictEqual(names[0], 'Harbor of Ash', 'name hit outranks body hit');
assert.deepStrictEqual(retrieveCanonSlice(entries, 'let us start please'), [], 'only stopwords → nothing');
assert.deepStrictEqual(retrieveCanonSlice([], 'harbor'), []);

// exclusion + budget
const ex = retrieveCanonSlice(entries, 'harbor', { exclude: new Set(['[LOCATION] Harbor of Ash']) });
assert.ok(!ex.some(e => e.name === 'Harbor of Ash'));
const huge = [mk('LORE', 'Harbor Chronicle', 'harbor '.repeat(5000)), mk('LORE', 'Harbor Notes', 'harbor note')];
const capped = retrieveCanonSlice(huge, 'harbor', { maxTokens: 300 });
assert.ok(capped.length >= 1);
assert.ok(capped.reduce((a, e) => a + estimateTokens(e.content), 0) <= 1300, 'single oversize entry is truncated');
assert.ok(retrieveCanonSlice(entries, 'harbor', { maxEntries: 1 }).length === 1);

// focus block
const fb = buildFocusBlock(slice);
assert.ok(fb.startsWith('\n[CANON_FOCUS') && fb.includes('### [FACTION] The Salt Court'));
assert.strictEqual(buildFocusBlock([]), '');

// promote parsing / resolution / stripping
const reply = 'Need more.\n[PROMOTE_CANON: Ash Wyrm]\n[PROMOTE_CANON: Nobody Here]\n[promote_canon: Ash Wyrm]';
assert.deepStrictEqual(parsePromoteRequests(reply), ['Ash Wyrm', 'Nobody Here']);
assert.strictEqual(stripPromoteTags(reply), 'Need more.');
assert.ok(!stripConciergeStateBlocks('Hello [PROMOTE_CANON: X] there').includes('PROMOTE'));
const { found, missing } = resolvePromoteRequests(['ash wyrm', 'Vey', 'Nobody Here'], entries);
assert.deepStrictEqual(found.map(e => e.name), ['The Ash Wyrm', 'Captain Vey']);
assert.deepStrictEqual(missing, ['Nobody Here']);

// promoted tracking resets with staging
markSlicePromoted(slice);
assert.ok(getPromotedSet().size >= 3);
clearStagedCanon();
assert.strictEqual(getPromotedSet().size, 0);

// builder prompt carries the Big-Lore rules + scaled quotas
const bp = buildConciergeBuilderPrompt();
assert.ok(bp.includes('[CANON_FOCUS]') && bp.includes('[PROMOTE_CANON: Exact Name]'));
assert.ok(bp.includes(`up to ${ARCHIVIST_QUOTAS.maps}`));

console.log('✅ Concierge Canon Slice & Promote test suite passed.');
