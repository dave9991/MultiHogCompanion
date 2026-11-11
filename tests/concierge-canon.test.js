import assert from 'node:assert';
import {
    estimateTokens, decideMode, chunkLoreSource, classifyChunkHeuristic, parseClassificationJson,
    classifyChunks, buildCanonEntry, summarizeCanonInventory, stageCanonSource, clearStagedCanon,
    setModeOverride, getCurrentMode, writeStagedCanon, getStagedCanonEntries, ARCHIVIST_TOKEN_THRESHOLD,
    normalizePdfText, unstageCanonSource, MIDDLE_IMPORT_TOKEN_THRESHOLD, detectCanonBucket,
    stageRawCanonSource, getStagedSourcesSummary, extractSourcesStructuralOutline,
    parseSynthesizedCanonEntries, buildCanonFromFraming, setStagedCanonEntries,
    toggleCanonEntryDisabled, upsertCanonEntry, removeCanonEntry,
    snapshotFraming, computeFramingDiff, snapshotCanon, computeCanonDiff,
    snapshotAdventure, computeAdventureDiff, extractAgnosticAdventureBones,
    normalizeEntityName, detectDuplicateCandidates, arbitrateDuplicateCandidates,
} from '../concierge-canon.js';
import { normalizeCharacterCard } from '../concierge-card-reader.js';

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

// ── 3-Bucket Canon Engine & Lens Tests ──────────────────────────────────────

// 1. detectCanonBucket & Constants
assert.strictEqual(MIDDLE_IMPORT_TOKEN_THRESHOLD, 300);
assert.strictEqual(detectCanonBucket(0), 'vibe');
assert.strictEqual(detectCanonBucket(100), 'vibe');
assert.strictEqual(detectCanonBucket(299), 'vibe');
assert.strictEqual(detectCanonBucket(300), 'middle');
assert.strictEqual(detectCanonBucket(1500), 'middle');
assert.strictEqual(detectCanonBucket(6000), 'middle');
assert.strictEqual(detectCanonBucket(6001), 'big');
assert.strictEqual(detectCanonBucket(25000), 'big');

// 2. stageRawCanonSource & extractSourcesStructuralOutline (Zero LLM latency)
clearStagedCanon();
assert.strictEqual(extractSourcesStructuralOutline(), '');

const rawVibe = stageRawCanonSource({ name: 'TinyNote', type: 'doc', text: '# Intro\nA tiny setting note.' });
assert.strictEqual(rawVibe.bucket, 'vibe');
assert.strictEqual(rawVibe.sources.length, 1);
assert.strictEqual(rawVibe.sources[0].name, 'TinyNote');
assert.deepStrictEqual(rawVibe.sources[0].headings, ['Intro']);

// Outline for vibe
const vibeOutline = extractSourcesStructuralOutline(500);
assert.ok(vibeOutline.includes('[ATTACHED_SOURCES_OUTLINE]'));
assert.ok(vibeOutline.includes('Detected Bucket: vibe'));
assert.ok(vibeOutline.includes('TinyNote'));

// Add middle source
const midText = '# Lore Chapter\n' + 'Word '.repeat(450);
const rawMid = stageRawCanonSource({ name: 'MidBook', type: 'doc', text: midText });
assert.strictEqual(rawMid.bucket, 'middle');
const midOutline = extractSourcesStructuralOutline(1200);
assert.ok(midOutline.includes('Detected Bucket: middle'));
assert.ok(midOutline.includes('MidBook'));
assert.ok(midOutline.includes('Passages:'));

// Add big source
const hugeText = '# Big Tome\n' + 'Lore paragraph text.\n\n'.repeat(1500);
const rawBig = stageRawCanonSource({ name: 'HugeTome', type: 'doc', text: hugeText });
assert.strictEqual(rawBig.bucket, 'big');
const bigOutline = extractSourcesStructuralOutline(1200);
assert.ok(bigOutline.includes('Detected Bucket: big'));
assert.ok(bigOutline.includes('HugeTome'));
assert.ok(bigOutline.includes('Headings / Entries:'));

// 3. parseClassificationJson with disabled & outOfScope & importance=0
const parsedDisabled = parseClassificationJson(JSON.stringify([
    { id: '1', kind: 'NPC', name: 'Active NPC', importance: 4 },
    { id: '2', kind: 'LORE', name: 'Out of Scope Area', outOfScope: true },
    { id: '3', kind: 'RULE', name: 'Legacy Rule', disabled: true, importance: 5 },
    { id: '4', kind: 'EVENT', name: 'Ignored Trivia', importance: 0 },
]));
assert.strictEqual(parsedDisabled.length, 4);
assert.strictEqual(parsedDisabled[0].disabled, false);
assert.strictEqual(parsedDisabled[0].importance, 4);
assert.strictEqual(parsedDisabled[1].disabled, true);
assert.strictEqual(parsedDisabled[1].importance, 1);
assert.strictEqual(parsedDisabled[2].disabled, true);
assert.strictEqual(parsedDisabled[2].importance, 1);
assert.strictEqual(parsedDisabled[3].disabled, true);
assert.strictEqual(parsedDisabled[3].importance, 1);

// 4. classifyChunks with framingBrief focal lens
let capturedSystemPrompt = '';
const classifyTestChunks = [{ id: 'c1', title: 'Deep Warrens', text: 'Tunnels beneath the city.', keys: [] }];
const classifiedWithLens = await classifyChunks(classifyTestChunks, {
    framingBrief: { title: 'Underground Delve', focalLens: 'Tunnels and catacombs beneath Old Town' },
    send: async (messages) => {
        capturedSystemPrompt = messages[0].content;
        return '[{"id":"c1","kind":"LOCATION","name":"Deep Warrens","importance":5,"disabled":false}]';
    },
});
assert.ok(capturedSystemPrompt.includes('Campaign Focal Lens: Tunnels and catacombs beneath Old Town'));
assert.ok(capturedSystemPrompt.includes('Set "disabled": true and "importance": 1'));
assert.strictEqual(classifiedWithLens[0].label.disabled, false);

// 5. buildCanonEntry with id and disabled
const canonEntry = buildCanonEntry({
    chunk: { id: 'c1', title: 'Deep Warrens', text: 'Tunnels text', keys: ['warrens'] },
    label: { kind: 'LOCATION', name: 'Deep Warrens', importance: 5, disabled: true },
});
assert.strictEqual(canonEntry.id, 'c1');
assert.strictEqual(canonEntry.disabled, true);
assert.strictEqual(canonEntry.comment, '[LOCATION] Deep Warrens');

// 6. Entry Management: setStagedCanonEntries, toggleCanonEntryDisabled, upsertCanonEntry, removeCanonEntry
clearStagedCanon();
setStagedCanonEntries([canonEntry]);
assert.strictEqual(getStagedCanonEntries().length, 1);
assert.strictEqual(getStagedCanonEntries()[0].disabled, true);

// Toggle disabled
const toggled = toggleCanonEntryDisabled('[LOCATION] Deep Warrens', false);
assert.ok(toggled);
assert.strictEqual(toggled.disabled, false);
assert.strictEqual(getStagedCanonEntries()[0].disabled, false);

// Upsert new entry
const upserted = upsertCanonEntry({ name: 'Iron Guild', kind: 'FACTION', content: 'Blacksmiths', disabled: false });
assert.strictEqual(upserted.name, 'Iron Guild');
assert.strictEqual(upserted.comment, '[FACTION] Iron Guild');
assert.strictEqual(getStagedCanonEntries().length, 2);

// Upsert existing entry updates it
upsertCanonEntry({ name: 'Iron Guild', kind: 'FACTION', content: 'Updated blacksmiths', disabled: true });
assert.strictEqual(getStagedCanonEntries().length, 2);
const updatedGuild = getStagedCanonEntries().find(e => e.name === 'Iron Guild');
assert.strictEqual(updatedGuild.content, 'Updated blacksmiths');
assert.strictEqual(updatedGuild.disabled, true);

// Remove entry
const removed = removeCanonEntry('[FACTION] Iron Guild');
assert.strictEqual(removed, true);
assert.strictEqual(getStagedCanonEntries().length, 1);

// 7. writeStagedCanon persists disable: true and updates changed disable flag
const testStore = { entries: {} };
const testFetch = async (url, opts) => {
    if (url.endsWith('/get')) return { ok: true, json: async () => JSON.parse(JSON.stringify(testStore)) };
    const body = JSON.parse(opts.body);
    testStore.entries = body.data.entries;
    return { ok: true };
};
const testDeps = { fetchImpl: testFetch, getHeaders: () => ({}) };

// Deep Warrens has disabled: false
const writeRes1 = await writeStagedCanon('camp', testDeps);
assert.strictEqual(writeRes1.written, 1);
assert.strictEqual(Object.values(testStore.entries)[0].disable, false);

// Now disable Deep Warrens and write again
toggleCanonEntryDisabled('Deep Warrens', true);
const writeRes2 = await writeStagedCanon('camp', testDeps);
assert.strictEqual(writeRes2.written, 1, 'Updating disable flag counts as written');
assert.strictEqual(Object.values(testStore.entries)[0].disable, true);

// Calling write again without changes skips
const writeRes3 = await writeStagedCanon('camp', testDeps);
assert.strictEqual(writeRes3.written, 0);
assert.strictEqual(writeRes3.skipped, 1);

// 8. buildCanonFromFraming
// 8a. Vibe bucket (empty sources -> vibe foundational sketch)
clearStagedCanon();
const vibeFraming = {
    title: 'Neon Harbor',
    premise: 'Cyberpunk port city ruled by syndicates',
    focalLens: 'Smuggling docks of Sector 4',
    tone: 'Gritty Noir',
};
const vibeResult = await buildCanonFromFraming(vibeFraming, {
    send: async () => JSON.stringify([
        { kind: 'FACTION', name: 'Rust Syndicate', aliases: ['The Rust'], importance: 4, content: 'Controls Sector 4.' },
        { kind: 'LOCATION', name: 'Pier 19', aliases: ['Black Pier'], importance: 5, content: 'Smuggling hub.' },
    ]),
});
assert.strictEqual(vibeResult.bucket, 'vibe');
assert.strictEqual(vibeResult.entries.length, 2);
assert.strictEqual(vibeResult.entries[0].comment, '[FACTION] Rust Syndicate');
assert.strictEqual(vibeResult.entries[1].comment, '[LOCATION] Pier 19');

// 8b. Middle bucket (300..6000 tokens)
clearStagedCanon();
stageRawCanonSource({ name: 'PortNotes', type: 'doc', text: '# Cargo Manifest\n' + 'Detailed shipping logs.\n'.repeat(80) });
const midResult = await buildCanonFromFraming(vibeFraming, {
    send: async (messages) => {
        const sys = messages[0].content;
        if (sys.includes('label tabletop RPG')) {
            const matches = [...messages[1].content.matchAll(/ID:\s*([^\n]+)/g)];
            return JSON.stringify(matches.map(m => ({ id: m[1].trim(), kind: 'RULE', name: 'Cargo Manifest', importance: 3 })));
        }
        return JSON.stringify([
            { kind: 'NPC', name: 'Captain Vance', aliases: ['Vance'], importance: 4, content: 'Corrupt dockmaster.' },
        ]);
    },
});
assert.strictEqual(midResult.bucket, 'middle');
assert.ok(midResult.entries.some(e => e.name === 'Cargo Manifest'));
assert.ok(midResult.entries.some(e => e.name === 'Captain Vance'));

// 8c. Big bucket (>6000 tokens) with bridge synthesis
clearStagedCanon();
stageRawCanonSource({ name: 'Archive', type: 'doc', text: '# Ancient Lore\n' + 'Massive setting encyclopedia.\n\n'.repeat(1200) });
const bigResult = await buildCanonFromFraming(vibeFraming, {
    synthesizeBridge: true,
    send: async (messages) => {
        const sys = messages[0].content;
        if (sys.includes('label tabletop RPG')) {
            const matches = [...messages[1].content.matchAll(/ID:\s*([^\n]+)/g)];
            return JSON.stringify(matches.map(m => ({ id: m[1].trim(), kind: 'LORE', name: 'Ancient Lore', importance: 3 })));
        }
        if (sys.includes('focal bridge')) {
            return JSON.stringify([
                { kind: 'LOCATION', name: 'Sector 4 Smuggling Docks', aliases: ['Sector 4'], importance: 5, content: 'Local anchor.' },
            ]);
        }
        return '[]';
    },
});
assert.strictEqual(bigResult.bucket, 'big');
assert.ok(bigResult.entries.some(e => e.name === 'Ancient Lore'));
assert.ok(bigResult.entries.some(e => e.name === 'Sector 4 Smuggling Docks'));

// 9. Snapshot & Diff Helpers
// 9a. Framing Snapshot & Diff
const snapF1 = snapshotFraming({ meta: { title: 'Title A', premise: 'Premise A', focalLens: 'Lens A', tone: 'Dark' } });
const snapF2 = snapshotFraming({ meta: { title: 'Title A', premise: 'Premise B', focalLens: 'Lens A', tone: 'Light' } });
const framingDiffSame = computeFramingDiff(snapF1, snapF1);
assert.strictEqual(framingDiffSame.hasChanges, false);
assert.strictEqual(framingDiffSame.block, '');

const framingDiffChanged = computeFramingDiff(snapF1, snapF2);
assert.strictEqual(framingDiffChanged.hasChanges, true);
assert.ok(framingDiffChanged.block.includes('[UPSTREAM_FRAMING_DIFF]'));
assert.ok(framingDiffChanged.lines.some(l => l.includes('Premise: "Premise A" -> "Premise B"')));
assert.ok(framingDiffChanged.lines.some(l => l.includes('Tone: "Dark" -> "Light"')));

// 9b. Canon Snapshot & Diff
const canonEntriesA = [
    { comment: '[NPC] Alice', name: 'Alice', kind: 'NPC', content: 'Old bio', disabled: false },
    { comment: '[LOCATION] Castle', name: 'Castle', kind: 'LOCATION', content: 'Stone walls', disabled: false },
    { comment: '[FACTION] Cult', name: 'Cult', kind: 'FACTION', content: 'Dark robes', disabled: false },
];
const rulesA = { axioms: [{ title: 'Magic Law', playerText: 'Magic has a price.' }] };
const snapC1 = snapshotCanon(canonEntriesA, rulesA);

const canonEntriesB = [
    { comment: '[NPC] Alice', name: 'Alice', kind: 'NPC', content: 'New bio', disabled: false }, // modified
    { comment: '[LOCATION] Castle', name: 'Castle', kind: 'LOCATION', content: 'Stone walls', disabled: true }, // disabled
    { comment: '[NPC] Bob', name: 'Bob', kind: 'NPC', content: 'New ally', disabled: false }, // added
    // Cult removed
];
const rulesB = { axioms: [{ title: 'Magic Law', playerText: 'Magic is free.' }, { title: 'Death Law', playerText: 'No resurrection.' }] };
const snapC2 = snapshotCanon(canonEntriesB, rulesB);

const canonDiff = computeCanonDiff(snapC1, snapC2);
assert.strictEqual(canonDiff.hasChanges, true);
assert.ok(canonDiff.modified.includes('[NPC] Alice'));
assert.ok(canonDiff.disabled.includes('[LOCATION] Castle'));
assert.ok(canonDiff.added.includes('[NPC] Bob'));
assert.ok(canonDiff.removed.includes('[FACTION] Cult'));
assert.ok(canonDiff.axiomsChanged.some(a => a.includes('Modified axiom: "Magic Law"')));
assert.ok(canonDiff.axiomsChanged.some(a => a.includes('Added axiom: "Death Law"')));
assert.ok(canonDiff.block.includes('[UPSTREAM_CANON_DIFF]'));

// 9c. Adventure Snapshot & Diff
const snapAdv1 = snapshotAdventure({
    meta: { ruleset: 'pbta' },
    theKick: { startingLocation: 'Tavern', crisis: 'Fire' },
    maps: [{ site: 'Tavern', briefDescription: 'Cozy inn' }],
    monsters: [{ name: 'Rat', description: 'Small pest' }],
    npcs: [{ name: 'Innkeeper', role: 'Host', description: 'Friendly' }],
});
const snapAdv2 = snapshotAdventure({
    meta: { ruleset: 'fae' },
    theKick: { startingLocation: 'Dungeon', crisis: 'Flooding' },
    maps: [{ site: 'Tavern', briefDescription: 'Cozy inn' }, { site: 'Dungeon', briefDescription: 'Dark cells' }],
    monsters: [{ name: 'Rat', description: 'Small pest' }, { name: 'Dragon', description: 'Apex predator' }],
    npcs: [{ name: 'Innkeeper', role: 'Host', description: 'Friendly' }, { name: 'Guard', role: 'Sentry', description: 'Alert' }],
});
const advDiff = computeAdventureDiff(snapAdv1, snapAdv2);
assert.strictEqual(advDiff.hasChanges, true);
assert.ok(advDiff.lines.some(l => l.includes('Ruleset changed: "pbta" -> "fae"')));
assert.ok(advDiff.lines.some(l => l.includes('Starting Location: "Tavern" -> "Dungeon"')));
assert.ok(advDiff.lines.some(l => l.includes('Crisis: "Fire" -> "Flooding"')));
assert.ok(advDiff.lines.some(l => l.includes('Added Maps: Dungeon')));
assert.ok(advDiff.lines.some(l => l.includes('Added Monsters: Dragon')));
assert.ok(advDiff.lines.some(l => l.includes('Added NPCs: Guard')));
assert.ok(advDiff.block.includes('[UPSTREAM_ADVENTURE_DIFF]'));

// 9d. extractAgnosticAdventureBones
const agnosticDossier = {
    meta: { title: 'Deep Expanse', premise: 'Space voyage', focalLens: 'Derelict ship', tone: 'Tense', ruleset: 'pbta' },
    config: { playstyle: 'tactical', partyMode: 'solo', cyoaEmojis: false, simulationDepth: 'living_world', relationships: true, artStyle: 'sci-fi' },
    theKick: { startingLocation: 'Airlock', crisis: 'Oxygen leak', openingPrompt: 'Sirens blare.' },
    maps: [{ name: 'Airlock', kind: 'AIRLOCK', threat: 'HIGH', description: 'Depressurizing' }],
    npcs: [{ name: 'AI Companion', role: 'Navigator', description: 'Synthetic voice', personality: 'Calm' }],
    monsters: [{ name: 'Void Parasite', description: 'Crawls in ventilation' }],
};
const bones = extractAgnosticAdventureBones(agnosticDossier);
assert.strictEqual(bones.title, 'Deep Expanse');
assert.strictEqual(bones.premise, 'Space voyage');
assert.strictEqual(bones.focalLens, 'Derelict ship');
assert.strictEqual(bones.tone, 'Tense');
assert.deepStrictEqual(bones.agnosticConfig, {
    playstyle: 'tactical',
    partyMode: 'solo',
    cyoaEmojis: false,
    simulationDepth: 'living_world',
    relationships: true,
    artStyle: 'sci-fi',
});
assert.strictEqual(bones.theKick.startingLocation, 'Airlock');
assert.strictEqual(bones.theKick.crisis, 'Oxygen leak');
assert.strictEqual(bones.maps[0].site, 'Airlock');
assert.strictEqual(bones.npcs[0].name, 'AI Companion');
assert.strictEqual(bones.monsters[0].name, 'Void Parasite');

// 10. normalizeCharacterCard portrait sanitization
const rawCardWithAvatar = {
    name: 'Hero Protagonist',
    description: 'A courageous warrior.',
    personality: 'Brave and honest.',
};
const normalized = normalizeCharacterCard(rawCardWithAvatar, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
assert.strictEqual(normalized.name, 'Hero Protagonist');
assert.strictEqual(normalized.avatar, null, 'Character card avatar must be null unconditionally to avoid portrait hijacking');

// 11. Deduplication & Step 2 Debug Telemetry Tests
console.log('11. Testing 2-Tier Entity Deduplication & Step 2 Debug Telemetry...');

// 11a. normalizeEntityName
assert.strictEqual(normalizeEntityName('The Horrigan'), 'horrigan');
assert.strictEqual(normalizeEntityName('Dr. Aris Thorne'), 'aris thorne');
assert.strictEqual(normalizeEntityName('Captain Vance'), 'vance');
assert.strictEqual(normalizeEntityName('Vault-13'), 'vault 13');
assert.strictEqual(normalizeEntityName('The Enclave'), 'enclave');

// 11b. detectDuplicateCandidates
const sampleEntries = [
    { id: '1', kind: 'NPC', name: 'Frank Horrigan', content: 'Secret Service agent turned mutant.' },
    { id: '2', kind: 'NPC', name: 'The Horrigan', content: 'Mutant experiment loyal to president.' },
    { id: '3', kind: 'NPC', name: 'Jane Smith', content: 'Pioneer engineer from Vault 13.' },
    { id: '4', kind: 'NPC', name: 'John Smith', content: 'Vault 13 security officer, Jane\'s husband.' },
    { id: '5', kind: 'LOCATION', name: 'Vault 13', content: 'Subterranean shelter.' },
    { id: '6', kind: 'LOCATION', name: 'Vault-13', content: 'Secondary fallout shelter bunker.' },
    { id: '7', kind: 'FACTION', name: 'The Silica Cartel', content: 'Glass merchants.' },
    { id: '8', kind: 'LOCATION', name: 'The Rust Wastes', content: 'Irradiated desert.' },
];

const candidates = detectDuplicateCandidates(sampleEntries);
assert.ok(candidates.some(c => c.type === 'token_containment' && (c.nameA.includes('Horrigan') && c.nameB.includes('Horrigan'))), 'Must detect Frank Horrigan vs The Horrigan as token containment');
assert.ok(candidates.some(c => c.type === 'shared_surname' && (c.nameA === 'Jane Smith' && c.nameB === 'John Smith')), 'Must detect Jane Smith vs John Smith as shared surname');
assert.ok(candidates.some(c => c.type === 'exact_match' && (c.nameA.includes('Vault') && c.nameB.includes('Vault'))), 'Must detect Vault 13 vs Vault-13 as exact match');
assert.ok(!candidates.some(c => c.nameA === 'The Silica Cartel' || c.nameB === 'The Rust Wastes'), 'Unrelated entries across or within categories must not be flagged');

// 11c. arbitrateDuplicateCandidates
// Auto-link exact match without LLM
const autoLinkCandidates = candidates.filter(c => c.type === 'exact_match');
const autoLinkResult = await arbitrateDuplicateCandidates(autoLinkCandidates, sampleEntries.slice(4, 6));
assert.strictEqual(autoLinkResult.entries.length, 1, 'Exact match must consolidate 2 entries into 1');
assert.ok(autoLinkResult.entries[0].aliases.includes('Vault-13') || autoLinkResult.entries[0].aliases.includes('Vault 13'));
assert.ok(autoLinkResult.entries[0].content.includes('Subterranean shelter'));
assert.ok(autoLinkResult.entries[0].content.includes('Secondary fallout shelter bunker'));
assert.strictEqual(autoLinkResult.auditLog[0].action, 'autoLink');

// Arbitrate with mock LLM: link Horrigan, separate Smith
const mockLlmSend = async (messages) => {
    return JSON.stringify([
        {
            id: candidates.find(c => c.type === 'token_containment').id,
            action: 'link',
            canonicalName: 'Frank Horrigan',
            reason: 'Same individual described across multiple excerpts',
        },
        {
            id: candidates.find(c => c.type === 'shared_surname').id,
            action: 'separate',
            canonicalName: 'Jane Smith',
            reason: 'Married couple sharing surname, distinct NPCs',
        },
    ]);
};

clearStagedCanon();
setStagedCanonEntries(sampleEntries.slice(0, 4));
const initialStaged = getStagedCanonEntries();
const horriSmithCandidates = detectDuplicateCandidates(initialStaged);
const arbitrated = await arbitrateDuplicateCandidates(horriSmithCandidates, initialStaged, { send: mockLlmSend });

// Frank Horrigan consolidated
assert.ok(arbitrated.entries.some(e => e.name === 'Frank Horrigan'), 'Frank Horrigan canonical entry must exist');
assert.ok(!arbitrated.entries.some(e => e.name === 'The Horrigan'), 'The Horrigan must be absorbed into Frank Horrigan');
const frank = arbitrated.entries.find(e => e.name === 'Frank Horrigan');
assert.ok(frank.aliases.includes('The Horrigan'), 'The Horrigan must be retained as an alias');
assert.ok(frank.content.includes('Secret Service agent'));
assert.ok(frank.content.includes('Mutant experiment'));

// Jane Smith and John Smith preserved as distinct cards
assert.ok(arbitrated.entries.some(e => e.name === 'Jane Smith'), 'Jane Smith must be preserved');
assert.ok(arbitrated.entries.some(e => e.name === 'John Smith'), 'John Smith must be preserved');
assert.strictEqual(arbitrated.entries.length, 3, 'Must have exactly 3 entries: Frank Horrigan, Jane Smith, John Smith');

// 11d. Step 2 Debug Telemetry in buildCanonFromFraming
globalThis.window = {};
clearStagedCanon();
const telemetryFraming = {
    title: 'Ash Wastes',
    premise: 'Survival in irradiated ruins',
    focalLens: 'Enclave Outpost',
    tone: 'Post-apocalyptic',
};
const telemetryResult = await buildCanonFromFraming(telemetryFraming, {
    send: async () => JSON.stringify([
        { kind: 'NPC', name: 'Outpost Guard', aliases: [], importance: 3, content: 'Guards the perimeter.' },
        { kind: 'LOCATION', name: 'Irradiated Crater', aliases: [], importance: 4, content: 'Deep nuclear crater.' },
    ]),
});
assert.ok(globalThis.window._mhcLastBuilderTransaction, 'Transaction must be recorded on window');
assert.strictEqual(globalThis.window._mhcLastBuilderTransaction.stage, 'canon');
assert.strictEqual(globalThis.window._mhcLastBuilderTransaction.finalStatus, 'CANON_INGEST');
assert.ok(globalThis.window._mhcLastBuilderTransaction.summary.includes('Series Bible generated'));
assert.ok(globalThis.window._mhcLastBuilderTransaction.attempts[0].deduplication, 'Deduplication audit must be present in transaction');

console.log('✅ Concierge Canon test suite passed.');
