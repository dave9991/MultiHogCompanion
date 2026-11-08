import assert from 'node:assert';
import {
    estimateTokens, decideMode, chunkLoreSource, classifyChunkHeuristic, parseClassificationJson,
    classifyChunks, buildCanonEntry, summarizeCanonInventory, stageCanonSource, clearStagedCanon,
    setModeOverride, getCurrentMode, writeStagedCanon, getStagedCanonEntries, ARCHIVIST_TOKEN_THRESHOLD,
    normalizePdfText, unstageCanonSource,
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

// PDF kerning / drop-shadow normalization: double-spaced vs single-spaced
assert.strictEqual(
    normalizePdfText('F F F A A L L L L O O U U T T   B B I I B B L L E E : :   S S E E C C T T I I O O N N   Z Z E E R R O O'),
    'FALLOUT BIBLE: SECTION ZERO'
);
assert.strictEqual(
    normalizePdfText('B B R R O O T T H H E E R R H H O O O O D D   O O F F   S S T T E E E E L L   D D I I S S K K'),
    'BROTHERHOOD OF STEEL DISK'
);
assert.strictEqual(
    normalizePdfText('D D I I S S C C L L A A I I M M E E R R S S'),
    'D I S C L A I M E R S'
);
assert.strictEqual(
    normalizePdfText('F F F A A L L L L O O U U T T B B I I B B L L E E'),
    'F A L L O U T B I B L E'
);
assert.strictEqual(
    normalizePdfText('A dragon beast lurks and hunts.'),
    'A dragon beast lurks and hunts.'
);

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

// chunking PDF text with drop-shadow ALL-CAPS headings and no markdown hashes
const pdfSource = {
    name: 'PdfDoc',
    type: 'doc',
    text: `F F F A A L L L L O O U U T T   B B I I B B L L E E : :   S S E E C C T T I I O O N N   Z Z E E R R O O\n\nIntro to the wasteland archives.\n\nDISCLAIMERS\n\nLegal disclaimers here.`
};
const pdfChunks = chunkLoreSource(pdfSource);
assert.strictEqual(pdfChunks.length, 2);
assert.strictEqual(pdfChunks[0].title, 'FALLOUT BIBLE: SECTION ZERO');
assert.strictEqual(pdfChunks[0].text, 'Intro to the wasteland archives.');
assert.strictEqual(pdfChunks[1].title, 'DISCLAIMERS');
assert.strictEqual(pdfChunks[1].text, 'Legal disclaimers here.');

// Unified heading detection: Markdown headings, ALL-CAPS headings, and .MSG comments
const mixedDoc = {
    name: 'MixedDoc',
    type: 'doc',
    text: `# Introduction to Fallout

Welcome to the wastes.

# *** Brotherhood of Steel Honor Code *** # *** Maxson's History ***
Some msg comment lines here that should NOT trigger a heading split.

FALLOUT BIBLE: SECTION ZERO

This is section zero lore.

## Power Armor Specs

T-51b power armor details.`,
};
const mixedChunks = chunkLoreSource(mixedDoc);
assert.strictEqual(mixedChunks.length, 3);
assert.strictEqual(mixedChunks[0].title, 'Introduction to Fallout');
assert.ok(mixedChunks[0].text.includes('# *** Brotherhood of Steel Honor Code *** # *** Maxson\'s History ***'));
assert.strictEqual(mixedChunks[1].title, 'FALLOUT BIBLE: SECTION ZERO');
assert.strictEqual(mixedChunks[1].text, 'This is section zero lore.');
assert.strictEqual(mixedChunks[2].title, 'Power Armor Specs');
assert.strictEqual(mixedChunks[2].text, 'T-51b power armor details.');

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

// parseClassificationJson with thinking tags
const replyWithThink = `<think>
I need to classify these tabletop notes.
[internal bracketed notes]
</think>
\`\`\`json
[{"id":"a","kind":"npc","name":"Bo","aliases":["B"],"importance":9},{"id":"b","kind":"weird"},{"nope":1}]
\`\`\``;
const parsedThink = parseClassificationJson(replyWithThink);
assert.strictEqual(parsedThink.length, 2);
assert.strictEqual(parsedThink[0].name, 'Bo');
assert.strictEqual(parsedThink[0].kind, 'NPC');

const unclosedThink = `<think>Thinking in progress...
[{"id":"a","kind":"npc","name":"Bo"}]`;
assert.deepStrictEqual(parseClassificationJson(unclosedThink), []);

// classifyChunks: Fail-fast contract
const chunks = [
    { id: 'a', title: 'Bo', text: 'He is a captain.', keys: [] },
    { id: 'b', title: 'Pit', text: 'A dragon beast.', keys: [] },
];

// LLM success with IDs
let res = await classifyChunks(chunks, {
    send: async () => '[{"id":"a","kind":"NPC","name":"Captain Bo","importance":4},{"id":"b","kind":"MONSTER","name":"The Pit","importance":3}]',
});
assert.strictEqual(res[0].label.name, 'Captain Bo');
assert.strictEqual(res[1].label.name, 'The Pit');

// Positional fallback when LLM returns correct count but omits IDs
res = await classifyChunks(chunks, {
    send: async () => '[{"kind":"NPC","name":"Captain Bo","importance":4},{"kind":"MONSTER","name":"The Pit","importance":3}]',
});
assert.strictEqual(res[0].label.name, 'Captain Bo');
assert.strictEqual(res[1].label.name, 'The Pit');

// Fails fast when send is missing
await assert.rejects(
    classifyChunks(chunks, {}),
    /requires an active LLM connection/
);

// Fails fast when send throws
await assert.rejects(
    classifyChunks(chunks, { send: async () => { throw new Error('API down'); } }),
    /Canon LLM labeling failed on batch 1: API down/
);

// Fails fast when LLM returns invalid or empty JSON
await assert.rejects(
    classifyChunks(chunks, { send: async () => '[]' }),
    /Canon LLM labeling returned invalid or empty JSON on batch 1/
);
await assert.rejects(
    classifyChunks(chunks, { send: async () => 'not json' }),
    /Canon LLM labeling returned invalid or empty JSON on batch 1/
);

// Fails fast when LLM omits a chunk
await assert.rejects(
    classifyChunks(chunks, { send: async () => '[{"id":"a","kind":"NPC"}]' }),
    /Canon LLM labeling omitted chunk "b" on batch 1/
);

// AbortSignal
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
clearStagedCanon();
setModeOverride('auto');
let r = await stageCanonSource({ name: 's', type: 'doc', text: 'small' });
assert.strictEqual(r.mode, 'vibe');
assert.strictEqual(getStagedCanonEntries().length, 0);

setModeOverride('archivist');

// Test failure cleanup: when LLM fails, source is unstaged
await assert.rejects(
    stageCanonSource({ name: 'failDoc', type: 'doc', text: '# Fail\nFailure text.' }, {
        send: async () => { throw new Error('Model exploded'); }
    }),
    /Canon LLM labeling failed on batch 1/
);
assert.strictEqual(getStagedCanonEntries().length, 0, 'failed source is purged from _sources');

// Successful staging in archivist mode with send provided
r = await stageCanonSource({ name: 's', type: 'doc', text: '# Town\nA city by the sea.' }, {
    send: async () => '[{"id":"s#0","kind":"LOCATION","name":"Town","importance":3}]',
});
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
