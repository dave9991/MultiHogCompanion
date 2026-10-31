import assert from 'node:assert';
import {
    estimateTokens, decideMode, chunkLoreSource, classifyChunkHeuristic, parseClassificationJson,
    classifyChunks, buildCanonEntry, summarizeCanonInventory, stageCanonSource, clearStagedCanon,
    setModeOverride, getCurrentMode, writeStagedCanon, getStagedCanonEntries, ARCHIVIST_TOKEN_THRESHOLD,
} from '../concierge-canon.js';

console.log('--- Running Concierge Canon / Archivist Test Suite ---');

// tokens + mode
assert.strictEqual(estimateTokens(''), 0);
assert.strictEqual(estimateTokens('abcdefgh'), 2);
assert.ok(estimateTokens('日本語のテキスト') >= 8, 'CJK counted per character');
assert.strictEqual(decideMode(100), 'vibe');
assert.strictEqual(decideMode(ARCHIVIST_TOKEN_THRESHOLD + 1), 'archivist');
assert.strictEqual(decideMode(100, 'archivist'), 'archivist');
assert.strictEqual(decideMode(99999, 'vibe'), 'vibe');

// chunking
const loreChunks = chunkLoreSource({ name: 'Book', entries: [{ title: 'Ashfall', keys: ['ash'], content: 'A city.' }, { title: 'Empty', content: '' }] });
assert.strictEqual(loreChunks.length, 1);
assert.deepStrictEqual(loreChunks[0].keys, ['ash']);
const docChunks = chunkLoreSource({ name: 'Doc', type: 'doc', text: '# Realm\nThe kingdom.\n\n## Villain\nThe Lich hunts.' });
assert.deepStrictEqual(docChunks.map(c => c.title), ['Realm', 'Villain']);
const big = 'Sentence here. '.repeat(1200);
const bigChunks = chunkLoreSource({ name: 'Big', entries: [{ title: 'Wall', content: big }] });
assert.ok(bigChunks.length > 1, 'oversize entry is split');
assert.ok(bigChunks.every(c => estimateTokens(c.text) <= 700));

// heuristic + parser
assert.strictEqual(classifyChunkHeuristic({ title: 'X', text: 'A dragon beast lurks and hunts.' }).kind, 'MONSTER');
assert.strictEqual(classifyChunkHeuristic({ title: 'X', text: 'zzz' }).kind, 'LORE');
const parsed = parseClassificationJson('```json\n[{"id":"a","kind":"npc","name":"Bo","aliases":["B"],"importance":9},{"id":"b","kind":"weird"},{"nope":1}]\n```');
assert.strictEqual(parsed.length, 2);
assert.strictEqual(parsed[0].kind, 'NPC');
assert.strictEqual(parsed[0].importance, 5);
assert.strictEqual(parsed[1].kind, 'LORE');
assert.deepStrictEqual(parseClassificationJson('garbage'), []);
assert.deepStrictEqual(parseClassificationJson('[not json]'), []);

// classifyChunks: LLM success, malformed → fallback
const chunks = [
    { id: 'a', title: 'Bo', text: 'He is a captain.', keys: [] },
    { id: 'b', title: 'Pit', text: 'A dragon beast.', keys: [] },
];
let fell = false;
let res = await classifyChunks(chunks, {
    send: async () => '[{"id":"a","kind":"NPC","name":"Captain Bo","importance":4}]',
    onFallback: () => { fell = true; },
});
assert.strictEqual(res[0].label.name, 'Captain Bo');
assert.strictEqual(res[1].label.kind, 'MONSTER', 'unlabeled chunk uses heuristic');
assert.ok(fell);
fell = false;
res = await classifyChunks(chunks, { send: async () => { throw new Error('down'); }, onFallback: () => { fell = true; } });
assert.ok(fell && res.length === 2);
res = await classifyChunks(chunks, {});
assert.strictEqual(res.length, 2);
await assert.rejects(classifyChunks(chunks, { send: async () => '[]', signal: AbortSignal.abort() }), /cancelled/);
await assert.rejects(classifyChunks(chunks, { send: () => new Promise(() => {}), timeoutMs: 20, signal: AbortSignal.abort() }));

// entry shape
const entry = buildCanonEntry({ chunk: { title: 'Bo', text: 'txt', keys: ['bo', 'Bo'] }, label: { kind: 'NPC', name: 'Bo', aliases: ['Captain'], importance: 4 } });
assert.strictEqual(entry.comment, '[NPC] Bo');
assert.deepStrictEqual(entry.keys, ['Bo', 'Captain', 'bo']);
const inv = summarizeCanonInventory([{ kind: 'NPC', name: 'A', importance: 1 }, { kind: 'NPC', name: 'B', importance: 5 }, { kind: 'LOCATION', name: 'C', importance: 3 }]);
assert.deepStrictEqual(inv.counts, { NPC: 2, LOCATION: 1 });
assert.strictEqual(inv.top.NPC[0], 'B');

// staging: vibe → no labeling; archivist → labeled; unstage
clearStagedCanon(); setModeOverride('auto');
let r = await stageCanonSource({ name: 's', type: 'doc', text: 'small' });
assert.strictEqual(r.mode, 'vibe');
assert.strictEqual(getStagedCanonEntries().length, 0);
setModeOverride('archivist');
r = await stageCanonSource({ name: 's', type: 'doc', text: '# Town\nA city by the sea.' });
assert.strictEqual(r.mode, 'archivist');
assert.strictEqual(getStagedCanonEntries().length, 1);
assert.strictEqual(getCurrentMode(), 'archivist');

// write: idempotent, vectorized, order below dossier books
const store = { entries: {} };
const calls = [];
const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/get')) return { ok: true, json: async () => JSON.parse(JSON.stringify(store)) };
    const body = JSON.parse(opts.body);
    store.entries = body.data.entries;
    return { ok: true };
};
const deps = { fetchImpl: fakeFetch, getHeaders: () => ({}) };
const w1 = await writeStagedCanon('camp', deps);
assert.strictEqual(w1.bookName, 'camp_Canon');
assert.strictEqual(w1.written, 1);
const e0 = Object.values(store.entries)[0];
assert.strictEqual(e0.vectorized, true);
assert.strictEqual(e0.constant, false);
assert.ok(e0.order < 100);
const w2 = await writeStagedCanon('camp', deps);
assert.strictEqual(w2.written, 0);
assert.strictEqual(w2.skipped, 1);
clearStagedCanon();
assert.strictEqual(await writeStagedCanon('camp', deps), null);

console.log('✅ Concierge Canon test suite passed.');
