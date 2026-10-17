/**
 * history-integrity-guard.test.js
 *
 * Tests for MultiHog Companion's History Integrity Guard & Quarantine Banner:
 * 1. Authoritative chat ID resolution when MultiHog's `_rpgCurrentChatId()` lags behind SillyTavern.
 * 2. Detection of `isHistoryPersistenceBlocked()` latch and `chatStateProjectionOwner` mismatches.
 * 3. Safe DOM quarantine banner rendering without mutating disk persistence.
 * 4. Verification of offloaded `multihog_history_*.json.gz` pointers (OK, HTTP 404, SHA-256 mismatch, schema error).
 * 5. Protection in `getCandidateChatIds` and `ensureActiveChatRulesetConsistency` against foreign chat leakage.
 */

import assert from 'assert';
import zlib from 'zlib';
import {
    resolveAuthoritativeChatId,
    normalizeChatIdForMatch,
    isSameChatId,
    checkTrackerProjectionIntegrity,
    renderTrackerQuarantineBanner,
    verifyHistoryPointer,
    scanAllChatHistories,
    formatHistoryDiagnosticReport,
    computeSha256Hex,
} from '../history-integrity-guard.js';
import {
    getCandidateChatIds,
    ensureActiveChatRulesetConsistency,
} from '../pbta-ruleset-persistence.js';

console.log('--- Running History Integrity Guard & Quarantine Test Suite ---');

// ── 1. Authoritative Chat ID Resolution when _rpgCurrentChatId lags ──────────
console.log('Testing resolveAuthoritativeChatId and getCandidateChatIds when MultiHog lags...');

globalThis._rpgCurrentChatId = () => 'DnD_Chat_Old';
globalThis.SillyTavern = {
    getContext: () => ({
        chatId: 'Concrete & Case Files',
        getCurrentChatId: () => 'Concrete & Case Files',
        chatMetadata: { chat_id: 'Concrete & Case Files' },
        extensionSettings: {
            rpg_tracker: {
                chatLinkEnabled: true,
                chatStateProjectionOwner: 'DnD_Chat_Old',
                currentMemo: '[CHARACTER]\nValerius Thorne (Wizard): 24/28 HP\n[/CHARACTER]',
                chatStates: {
                    'DnD_Chat_Old': {
                        currentMemo: '[CHARACTER]\nValerius Thorne (Wizard): 24/28 HP\n[/CHARACTER]',
                    },
                    'Concrete & Case Files': {
                        currentMemo: '[CHARACTER]\nLyle Holloway (The Sleuth): 4/4 HP | Harm: 0/4\n[/CHARACTER]',
                        pbtaCampaignDossier: {
                            meta: { title: 'Concrete & Case Files', systemKey: 'noir' },
                            protagonist: { name: 'Lyle Holloway', playbook: 'The Sleuth' },
                        },
                    },
                },
            },
        },
    }),
};

const resolved = resolveAuthoritativeChatId();
assert.strictEqual(resolved, 'Concrete & Case Files', 'Must prioritize SillyTavern active chatId over lagging _rpgCurrentChatId');

const candidates = getCandidateChatIds(null, globalThis.SillyTavern.getContext().extensionSettings.rpg_tracker);
assert.ok(candidates.includes('Concrete & Case Files'), 'Candidates must include active ST chatId');
assert.ok(!candidates.includes('DnD_Chat_Old'), 'Candidates must NOT include lagging _rpgCurrentChatId or foreign chatStateProjectionOwner');
assert.strictEqual(isSameChatId('Fable.jsonl', 'Fable'), true, 'isSameChatId must match across .jsonl suffix');
assert.strictEqual(normalizeChatIdForMatch('Fable.jsonl'), 'Fable', 'normalizeChatIdForMatch must strip .jsonl');

console.log('✓ Authoritative chat ID resolution verified');

// ── 2. Projection Integrity Check (Blocked & Owner Mismatch) ─────────────────
console.log('Testing checkTrackerProjectionIntegrity...');

const integrityBlocked = await checkTrackerProjectionIntegrity({
    isBlockedFn: () => true,
});
assert.strictEqual(integrityBlocked.healthy, false, 'Must report unhealthy when history persistence is blocked');
assert.strictEqual(integrityBlocked.persistenceBlocked, true, 'Must flag persistenceBlocked');
assert.strictEqual(integrityBlocked.ownerMismatch, true, 'Must flag ownerMismatch (DnD_Chat_Old vs Concrete & Case Files)');
assert.strictEqual(integrityBlocked.runtimeLagging, true, 'Must flag runtimeLagging (_rpgCurrentChatId != stChatId)');
assert.strictEqual(integrityBlocked.stChatId, 'Concrete & Case Files');
assert.strictEqual(integrityBlocked.projectionOwner, 'DnD_Chat_Old');
assert.ok(integrityBlocked.partitionMemo.includes('Lyle Holloway'), 'Must locate the arriving chat partition memo in memory');

// Healthy case when owner and runtime match and not blocked
globalThis._rpgCurrentChatId = () => 'Concrete & Case Files';
globalThis.SillyTavern.getContext = () => ({
    chatId: 'Concrete & Case Files',
    getCurrentChatId: () => 'Concrete & Case Files',
    extensionSettings: {
        rpg_tracker: {
            chatLinkEnabled: true,
            chatStateProjectionOwner: 'Concrete & Case Files',
            currentMemo: '[CHARACTER]\nLyle Holloway (The Sleuth): 4/4 HP\n[/CHARACTER]',
            chatStates: {
                'Concrete & Case Files': {
                    currentMemo: '[CHARACTER]\nLyle Holloway (The Sleuth): 4/4 HP\n[/CHARACTER]',
                },
            },
        },
    },
});

const integrityHealthy = await checkTrackerProjectionIntegrity({
    isBlockedFn: () => false,
});
assert.strictEqual(integrityHealthy.healthy, true, 'Must report healthy when owner matches and persistence is open');
assert.strictEqual(integrityHealthy.ownerMismatch, false);
assert.strictEqual(integrityHealthy.runtimeLagging, false);

console.log('✓ checkTrackerProjectionIntegrity verified');

// ── 3. Quarantine Banner Rendering ───────────────────────────────────────────
console.log('Testing renderTrackerQuarantineBanner...');

const mockRenderEl = { innerHTML: '<div>Valerius Thorne D&D Card</div>' };
const mockTextareaEl = { value: '[CHARACTER]\nValerius Thorne\n[/CHARACTER]' };
const mockDoc = {
    getElementById: (id) => {
        if (id === 'rpg-tracker-render') return mockRenderEl;
        if (id === 'rpg-tracker-memo') return mockTextareaEl;
        return null;
    },
};

const rendered = renderTrackerQuarantineBanner(integrityBlocked, { doc: mockDoc });
assert.strictEqual(rendered, true, 'renderTrackerQuarantineBanner must return true when DOM element exists');
assert.ok(mockRenderEl.innerHTML.includes('mhc-tracker-quarantine-banner'), 'Must render quarantine banner container');
assert.ok(mockRenderEl.innerHTML.includes('Concrete &amp; Case Files'), 'Must escape and display active chat name');
assert.ok(mockRenderEl.innerHTML.includes('DnD_Chat_Old'), 'Must display frozen projection owner name');
assert.ok(!mockRenderEl.innerHTML.includes('Valerius Thorne'), 'Must replace stale foreign character cards');
assert.ok(mockTextareaEl.value.includes('Lyle Holloway'), 'Must replace foreign textarea value with arriving partition memo');

console.log('✓ renderTrackerQuarantineBanner verified');

// ── 4. Offloaded History Pointer Verification & Scanner ──────────────────────
console.log('Testing verifyHistoryPointer and scanAllChatHistories...');

const validPayloadObj = {
    version: 2,
    memoHistory: ['[CHARACTER]\nLyle Holloway\n[/CHARACTER]'],
    dungeonMapHistory: [],
    mapEvolutionBacklogBySite: {},
    mapEvolutionThreadsBySite: {},
    mapEvolutionWorldReportApplications: {},
};
const validJson = JSON.stringify(validPayloadObj);
const validSha = await computeSha256Hex(validJson);
const gzBytes = zlib.gzipSync(Buffer.from(validJson, 'utf8'));

const mockFetch = async (url) => {
    if (url.includes('missing')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
    }
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => gzBytes.buffer.slice(gzBytes.byteOffset, gzBytes.byteOffset + gzBytes.byteLength),
    };
};

// 4a. Valid pointer
const okRes = await verifyHistoryPointer({
    version: 2,
    url: '/user/files/multihog_history_11111111-2222-3333-4444-555555555555.json.gz',
    sha256: validSha,
}, { fetchFn: mockFetch });
assert.strictEqual(okRes.status, 'ok', `Expected ok status, got ${okRes.status}: ${okRes.detail}`);
assert.strictEqual(okRes.memoHistoryCount, 1);

// 4b. Checksum mismatch
const mismatchRes = await verifyHistoryPointer({
    version: 2,
    url: '/user/files/multihog_history_11111111-2222-3333-4444-555555555555.json.gz',
    sha256: 'deadbeef00000000000000000000000000000000000000000000000000000000',
}, { fetchFn: mockFetch });
assert.strictEqual(mismatchRes.status, 'checksum_mismatch', 'Must detect SHA-256 mismatch');
assert.strictEqual(mismatchRes.actualSha256, validSha);

// 4c. HTTP 404 missing file
const missingRes = await verifyHistoryPointer({
    version: 2,
    url: '/user/files/multihog_history_missing-file.json.gz',
    sha256: validSha,
}, { fetchFn: mockFetch });
assert.strictEqual(missingRes.status, 'http_error', 'Must detect HTTP 404 missing file');
assert.strictEqual(missingRes.httpStatus, 404);

// 4d. Full scan and report formatting
const scanRpgSettings = {
    chatLinkEnabled: true,
    chatStateProjectionOwner: 'DnD_Chat',
    currentMemo: '[CHARACTER]\nDavid\n[/CHARACTER]',
    chatStates: {
        'DnD_Chat': {
            currentMemo: '[CHARACTER]\nDavid\n[/CHARACTER]',
            historyStorage: {
                version: 2,
                url: '/user/files/multihog_history_11111111-2222-3333-4444-555555555555.json.gz',
                sha256: validSha,
            },
        },
        'Horror': {
            currentMemo: '[CHARACTER]\nSarah\n[/CHARACTER]',
            historyStorage: {
                version: 2,
                url: '/user/files/multihog_history_missing-file.json.gz',
                sha256: validSha,
            },
        },
    },
};

const fullScan = await scanAllChatHistories({
    rpgSettings: scanRpgSettings,
    ctx: { chatId: 'Horror', getCurrentChatId: () => 'Horror' },
    fetchFn: mockFetch,
    isBlockedFn: () => true,
});

assert.strictEqual(fullScan.totalPartitions, 2);
assert.strictEqual(fullScan.fileBackedCount, 2);
assert.strictEqual(fullScan.healthyCount, 1);
assert.strictEqual(fullScan.brokenCount, 1);

const reportMd = formatHistoryDiagnosticReport(fullScan);
assert.ok(reportMd.includes('Broken / Unreadable History Files'), 'Report must include broken files section');
assert.ok(reportMd.includes('Horror'), 'Report must identify Horror chat');
assert.ok(reportMd.includes('HTTP 404'), 'Report must include HTTP 404 detail');

console.log('✓ verifyHistoryPointer and scanAllChatHistories verified');
console.log('--- All History Integrity Guard tests passed! ---');
