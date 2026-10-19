/**
 * history-integrity-guard.js
 *
 * Protects MultiHog Companion and the State Tracker UI when MultiHog's
 * file-backed history hydration (`hydrateChatHistories`) fails during a chat switch
 * or when `blockHistoryPersistence()` is latched.
 *
 * Without this guard:
 * 1. MultiHog's `onChatChanged` returns early before updating `runtimeState.currentChatId`
 *    or running `loadChatState(resolvedId)`.
 * 2. `_rpgCurrentChatId()` continues returning the departing chat's ID!
 * 3. `s.chatStateProjectionOwner` and `s.currentMemo` remain stuck on the departing chat!
 * 4. Every subsequent chat switch immediately exits at `if (isHistoryPersistenceBlocked()) return;`
 *    leaving the tracker permanently frozen on the wrong campaign until page reload.
 * 5. Worse: if `getActiveChatId()` prefers `_rpgCurrentChatId()`, Companion's own sync
 *    evaluates the departing chat ID and locks the departing chat's Persona onto the arriving chat!
 *
 * This module provides:
 * - Accurate SillyTavern chat ID resolution that detects when `_rpgCurrentChatId()` lags behind ST.
 * - Projection owner & history-persistence block detection (`checkTrackerProjectionIntegrity`).
 * - Safe, non-destructive DOM quarantine banner (`renderTrackerQuarantineBanner`) so foreign campaign
 *   stats are never displayed as live state for the active chat.
 * - Comprehensive file-backed history diagnostic scanner (`scanAllChatHistories` / `formatHistoryDiagnosticReport`)
 *   for `/mhc-history-check`.
 */

/**
 * Resolves the authoritative active chat ID directly from SillyTavern's context,
 * falling back to `_rpgCurrentChatId()` only when SillyTavern's context has no chat ID.
 *
 * Crucial: When MultiHog's `onChatChanged` aborts early (e.g. history hydration failure),
 * `runtimeState.currentChatId` (`_rpgCurrentChatId()`) remains stuck on the departing chat
 * while SillyTavern has already switched `ctx.chatId` to the arriving chat.
 *
 * @param {object|null} [ctxOverride=null]
 * @returns {string|null}
 */
export function resolveAuthoritativeChatId(ctxOverride = null) {
    const ctx = ctxOverride || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
    const stChatId = ctx?.getCurrentChatId?.() || ctx?.chatId || ctx?.chatMetadata?.chat_id || null;
    if (stChatId) return String(stChatId);

    if (typeof globalThis._rpgCurrentChatId === 'function') {
        const rpgId = globalThis._rpgCurrentChatId();
        if (rpgId) return String(rpgId);
    }
    return null;
}

/**
 * Normalizes a chat ID by stripping `.jsonl` for comparison.
 *
 * @param {string|null|undefined} id
 * @returns {string}
 */
export function normalizeChatIdForMatch(id) {
    if (!id || typeof id !== 'string') return '';
    const trimmed = id.trim();
    return trimmed.endsWith('.jsonl') ? trimmed.slice(0, -6) : trimmed;
}

/**
 * Checks whether two chat IDs refer to the same chat (ignoring `.jsonl` suffix).
 *
 * @param {string|null|undefined} idA
 * @param {string|null|undefined} idB
 * @returns {boolean}
 */
export function isSameChatId(idA, idB) {
    const normA = normalizeChatIdForMatch(idA);
    const normB = normalizeChatIdForMatch(idB);
    if (!normA || !normB) return false;
    return normA === normB;
}

/**
 * Checks if MultiHog's `isHistoryPersistenceBlocked()` latch is active.
 *
 * @param {Function|null} [blockCheckFn=null] Optional injected check function for tests
 * @returns {Promise<boolean>}
 */
export async function checkHistoryPersistenceBlocked(blockCheckFn = null) {
    if (typeof blockCheckFn === 'function') {
        try {
            return !!await blockCheckFn();
        } catch (_) {
            return false;
        }
    }
    try {
        const histMod = await import('../SillyTavern-MultihogDnDFramework/src/state/history-file-storage.js');
        if (typeof histMod.isHistoryPersistenceBlocked === 'function') {
            return !!histMod.isHistoryPersistenceBlocked();
        }
    } catch (_) {}
    return false;
}

/**
 * Inspects whether the MultiHog tracker's live projection is out of sync with SillyTavern's
 * active chat (e.g. because `hydrateChatHistories` failed or `isHistoryPersistenceBlocked()` is latched).
 *
 * @param {object} [options={}]
 * @param {string|null} [options.chatId=null]
 * @param {object|null} [options.rpgSettings=null]
 * @param {object|null} [options.ctx=null]
 * @param {Function|null} [options.isBlockedFn=null]
 * @returns {Promise<{
 *   healthy: boolean,
 *   persistenceBlocked: boolean,
 *   ownerMismatch: boolean,
 *   runtimeLagging: boolean,
 *   stChatId: string|null,
 *   rpgRuntimeChatId: string|null,
 *   projectionOwner: string|null,
 *   hasSavedPartition: boolean,
 *   partitionMemo: string,
 *   reason: string|null
 * }>}
 */
export async function checkTrackerProjectionIntegrity(options = {}) {
    const ctx = options.ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
    const s = options.rpgSettings || ctx?.extensionSettings?.rpg_tracker || null;
    const stChatId = options.chatId || resolveAuthoritativeChatId(ctx);
    const rpgRuntimeChatId = typeof globalThis._rpgCurrentChatId === 'function'
        ? (globalThis._rpgCurrentChatId() || null)
        : null;
    const projectionOwner = s?.chatStateProjectionOwner ? String(s.chatStateProjectionOwner).trim() : null;

    const persistenceBlocked = await checkHistoryPersistenceBlocked(options.isBlockedFn);

    const normSt = normalizeChatIdForMatch(stChatId);
    const savedPart = stChatId
        ? (s?.chatStates?.[stChatId] || s?.chatStates?.[normSt] || s?.chatStates?.[`${normSt}.jsonl`] || null)
        : null;
    const hasSavedPartition = !!savedPart;
    const partitionMemo = typeof savedPart?.currentMemo === 'string' ? savedPart.currentMemo : '';

    // Check if projectionOwner is set to a DIFFERENT chat than stChatId
    const ownerMismatch = Boolean(
        stChatId
        && projectionOwner
        && !isSameChatId(stChatId, projectionOwner)
    );

    // Check if MultiHog's runtimeState.currentChatId is set to a DIFFERENT chat than stChatId
    const runtimeLagging = Boolean(
        stChatId
        && rpgRuntimeChatId
        && !isSameChatId(stChatId, rpgRuntimeChatId)
    );

    let reason = null;
    if (persistenceBlocked && (ownerMismatch || runtimeLagging)) {
        reason = `History persistence is blocked and tracker projection is stuck on "${projectionOwner || rpgRuntimeChatId}" instead of active chat "${stChatId}".`;
    } else if (persistenceBlocked) {
        reason = `MultiHog history persistence is blocked (a file-backed history failed to load or verify during this session).`;
    } else if (ownerMismatch && s?.chatLinkEnabled !== false && String(s?.currentMemo || '').trim().length > 0) {
        reason = `Tracker projection owner "${projectionOwner}" does not match active chat "${stChatId}".`;
    }

    const healthy = !persistenceBlocked && !(ownerMismatch && s?.chatLinkEnabled !== false && String(s?.currentMemo || '').trim().length > 0);

    return {
        healthy,
        persistenceBlocked,
        ownerMismatch,
        runtimeLagging,
        stChatId,
        rpgRuntimeChatId,
        projectionOwner,
        hasSavedPartition,
        partitionMemo,
        reason,
    };
}

/**
 * Escapes HTML special characters for safe banner rendering.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Renders a prominent quarantine / warning banner in `#rpg-tracker-render` so that stale
 * foreign campaign data from a previous chat is NEVER masqueraded as the active chat's state
 * when MultiHog's history loader aborts.
 *
 * Crucial: Does NOT call `saveChatState` or `saveSettings` — preserves MultiHog's persistence lock
 * so nothing is written to disk while quarantined.
 *
 * @param {object} status Result from `checkTrackerProjectionIntegrity`
 * @param {object} [options={}]
 * @param {Document} [options.doc] Optional document reference for testing
 * @returns {boolean} True if DOM was updated
 */
export function renderTrackerQuarantineBanner(status, options = {}) {
    const doc = options.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return false;

    const renderEl = doc.getElementById('rpg-tracker-render');
    if (!renderEl) return false;

    const stChat = escapeHtml(status.stChatId || 'Unknown Chat');
    const stuckOwner = escapeHtml(status.projectionOwner || status.rpgRuntimeChatId || 'previous chat');
    const hasOwnMemo = Boolean(status.partitionMemo && status.partitionMemo.trim().length > 0);

    const bannerHtml = `
        <div class="mhc-tracker-quarantine-banner" data-quarantine-chat="${stChat}" style="
            background: rgba(220, 38, 38, 0.14);
            border: 1px solid rgba(248, 113, 113, 0.55);
            border-left: 4px solid #ef4444;
            border-radius: 8px;
            padding: 12px 14px;
            margin: 8px 6px;
            color: var(--SmartThemeBodyColorText, #f1f5f9);
            font-size: 0.86em;
            line-height: 1.45;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        ">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 1.02em; color: #fca5a5; margin-bottom: 6px;">
                <i class="fa-solid fa-shield-halved"></i>
                <span>State Tracker Quarantined — History Load Blocked</span>
            </div>
            <p style="margin: 0 0 8px 0; opacity: 0.92;">
                MultiHog could not verify or load the offloaded history file for <b>${stChat}</b> (or an earlier chat in this session).
                To protect your campaign data from cross-chat overwrite, persistence is locked and stale tracker cards from
                <b>${stuckOwner}</b> have been hidden.
            </p>
            <div style="background: rgba(0, 0, 0, 0.28); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; font-size: 0.92em;">
                <div><b>Active Chat:</b> <code>${stChat}</code></div>
                <div><b>Frozen Projection Owner:</b> <code>${stuckOwner}</code></div>
                <div><b>Saved Partition Memo in Memory:</b> ${hasOwnMemo ? `<span style="color:#86efac;">Present (${status.partitionMemo.length} chars, safe)</span>` : '<span style="color:#fde047;">Empty / Not found</span>'}</div>
            </div>
            <div style="font-size: 0.9em; opacity: 0.88;">
                <b>Next Steps:</b>
                <ol style="margin: 4px 0 0 18px; padding: 0;">
                    <li>Run <code>/mhc-history-check</code> in the chat input to see which <code>multihog_history_*.json.gz</code> file is missing or has a SHA-256 mismatch.</li>
                    <li>Restore the affected history file (or matching backup pair) and <b>reload the browser page (F5)</b> to clear the session lock.</li>
                </ol>
            </div>
        </div>
    `.trim();

    renderEl.innerHTML = bannerHtml;

    // Also clear or mark the raw memo textarea in the DOM ONLY if it is showing the foreign chat's memo,
    // without triggering input/change events that would flush into settings.
    const textarea = doc.getElementById('rpg-tracker-memo');
    if (textarea && status.ownerMismatch) {
        textarea.value = status.partitionMemo || '';
    }

    return true;
}

/**
 * Computes SHA-256 hex digest of a UTF-8 string using Web Crypto API or Node crypto fallback.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function computeSha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    if (globalThis.crypto?.subtle?.digest) {
        const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
        return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
    }
    try {
        const nodeCrypto = await import('crypto');
        return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
    } catch (_) {
        const histCrypto = await import('../SillyTavern-MultihogDnDFramework/src/state/history-crypto.js');
        return histCrypto.sha256Hex(bytes);
    }
}

/**
 * Fetches and verifies a single `historyStorage` pointer (`{ version, url, sha256, owner }`)
 * without mutating any settings or triggering `blockHistoryPersistence()`.
 *
 * @param {object} pointer
 * @param {object} [options={}]
 * @param {Function} [options.fetchFn] Custom fetch implementation (for tests)
 * @param {object} [options.headers] Custom request headers
 * @returns {Promise<{
 *   status: 'ok'|'no_pointer'|'invalid_url'|'http_error'|'decompress_error'|'json_error'|'schema_error'|'checksum_mismatch',
 *   url: string|null,
 *   expectedSha256: string|null,
 *   actualSha256: string|null,
 *   httpStatus: number|null,
 *   memoHistoryCount: number|null,
 *   dungeonMapHistoryCount: number|null,
 *   detail: string
 * }>}
 */
export async function verifyHistoryPointer(pointer, options = {}) {
    if (!pointer || typeof pointer !== 'object' || !pointer.url) {
        return {
            status: 'no_pointer',
            url: null,
            expectedSha256: null,
            actualSha256: null,
            httpStatus: null,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: 'No offloaded historyStorage pointer (inline or empty history).',
        };
    }

    const url = String(pointer.url);
    const expectedSha256 = pointer.sha256 ? String(pointer.sha256) : null;

    if (!/^\/?user\/files\/multihog_history_[a-z0-9-]+\.json(?:\.gz)?$/i.test(url)) {
        return {
            status: 'invalid_url',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: null,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: `Invalid history file path format: "${url}"`,
        };
    }

    const fetchImpl = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) {
        return {
            status: 'http_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: null,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: 'Fetch API unavailable in current environment.',
        };
    }

    const reqHeaders = options.headers || (
        typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.getRequestHeaders === 'function'
            ? SillyTavern.getContext().getRequestHeaders()
            : {}
    );

    let response;
    try {
        response = await fetchImpl(url, { headers: reqHeaders, cache: 'no-store' });
    } catch (netErr) {
        return {
            status: 'http_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: null,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: `Network error fetching "${url}": ${netErr?.message || netErr}`,
        };
    }

    if (!response.ok) {
        return {
            status: 'http_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: response.status,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: `HTTP ${response.status} (${response.statusText || 'Download failed'}) — file may be missing on disk.`,
        };
    }

    let bytes;
    try {
        bytes = new Uint8Array(await response.arrayBuffer());
        if (url.endsWith('.gz')) {
            // Only decompress if bytes start with gzip magic header 0x1f 0x8b (or always via DecompressionStream like MultiHog)
            if (typeof DecompressionStream === 'function') {
                bytes = new Uint8Array(
                    await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
                );
            } else {
                const zlib = await import('zlib');
                bytes = new Uint8Array(zlib.gunzipSync(bytes));
            }
        }
    } catch (decompErr) {
        return {
            status: 'decompress_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: response.status,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: `Gzip decompression failed: ${decompErr?.message || decompErr}`,
        };
    }

    let parsed;
    try {
        const text = new TextDecoder().decode(bytes);
        parsed = JSON.parse(text);
    } catch (jsonErr) {
        return {
            status: 'json_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: response.status,
            memoHistoryCount: null,
            dungeonMapHistoryCount: null,
            detail: `Invalid JSON in history file: ${jsonErr?.message || jsonErr}`,
        };
    }

    if (
        ![1, 2].includes(parsed?.version)
        || !Array.isArray(parsed?.memoHistory)
        || !Array.isArray(parsed?.dungeonMapHistory)
    ) {
        return {
            status: 'schema_error',
            url,
            expectedSha256,
            actualSha256: null,
            httpStatus: response.status,
            memoHistoryCount: Array.isArray(parsed?.memoHistory) ? parsed.memoHistory.length : null,
            dungeonMapHistoryCount: Array.isArray(parsed?.dungeonMapHistory) ? parsed.dungeonMapHistory.length : null,
            detail: `History file failed schema check (version=${parsed?.version}).`,
        };
    }

    // MultiHog computes sha256 over `JSON.stringify(data)` after parsing!
    const canonicalJson = JSON.stringify(parsed);
    const actualSha256 = await computeSha256Hex(canonicalJson);

    if (expectedSha256 && actualSha256 !== expectedSha256) {
        return {
            status: 'checksum_mismatch',
            url,
            expectedSha256,
            actualSha256,
            httpStatus: response.status,
            memoHistoryCount: parsed.memoHistory.length,
            dungeonMapHistoryCount: parsed.dungeonMapHistory.length,
            detail: `SHA-256 mismatch! Pointer expects ${expectedSha256.slice(0, 12)}…, file computed ${actualSha256.slice(0, 12)}… (${parsed.memoHistory.length} memo snapshots).`,
        };
    }

    return {
        status: 'ok',
        url,
        expectedSha256,
        actualSha256,
        httpStatus: response.status,
        memoHistoryCount: parsed.memoHistory.length,
        dungeonMapHistoryCount: parsed.dungeonMapHistory.length,
        detail: `OK (${parsed.memoHistory.length} memo snapshots, ${parsed.dungeonMapHistory.length} map snapshots).`,
    };
}

/**
 * Scans all `chatStates` partitions (and `globalHistoryStorage` if present) in MultiHog settings,
 * checking every `historyStorage` pointer and reporting broken, mismatched, or missing files.
 *
 * @param {object} [options={}]
 * @param {object|null} [options.rpgSettings=null]
 * @param {Function} [options.fetchFn]
 * @param {Function} [options.isBlockedFn]
 * @returns {Promise<{
 *   integrity: object,
 *   totalPartitions: number,
 *   fileBackedCount: number,
 *   healthyCount: number,
 *   brokenCount: number,
 *   results: Array<{
 *     chatId: string,
 *     hasHistoryStorage: boolean,
 *     inMemoryHydrated: boolean,
 *     memoChars: number,
 *     characterName: string|null,
 *     verification: object
 *   }>
 * }>}
 */
export async function scanAllChatHistories(options = {}) {
    const ctx = options.ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
    const s = options.rpgSettings || ctx?.extensionSettings?.rpg_tracker || null;

    const integrity = await checkTrackerProjectionIntegrity({
        rpgSettings: s,
        ctx,
        isBlockedFn: options.isBlockedFn,
    });

    const chatStates = s?.chatStates || {};
    const entries = Object.entries(chatStates);
    const results = [];
    let fileBackedCount = 0;
    let healthyCount = 0;
    let brokenCount = 0;

    for (const [chatId, part] of entries) {
        if (!part || typeof part !== 'object') continue;
        const hasHistoryStorage = Boolean(part.historyStorage?.url);
        const inMemoryHydrated = Array.isArray(part.memoHistory);
        const memoChars = typeof part.currentMemo === 'string' ? part.currentMemo.length : 0;

        // Extract protagonist/character name from dossier or memo for easy identification
        let characterName = part.pbtaCampaignDossier?.protagonist?.name
            || part.playerCharacter?.name
            || null;
        if (!characterName && typeof part.currentMemo === 'string') {
            const m = part.currentMemo.match(/\[CHARACTER\]\s*\n\s*([^\n:(]+)/i);
            if (m) characterName = m[1].trim();
        }

        const verification = await verifyHistoryPointer(part.historyStorage, {
            fetchFn: options.fetchFn,
            headers: options.headers,
        });

        if (hasHistoryStorage) {
            fileBackedCount++;
            if (verification.status === 'ok') {
                healthyCount++;
            } else {
                brokenCount++;
            }
        }

        results.push({
            chatId,
            hasHistoryStorage,
            inMemoryHydrated,
            memoChars,
            characterName,
            pointerOwner: part.historyStorage?.owner || null,
            verification,
        });
    }

    return {
        integrity,
        totalPartitions: results.length,
        fileBackedCount,
        healthyCount,
        brokenCount,
        results,
    };
}

/**
 * Formats the output of `scanAllChatHistories` into a clear Markdown diagnostic report.
 *
 * @param {object} scanResult Output from `scanAllChatHistories`
 * @returns {string}
 */
export function formatHistoryDiagnosticReport(scanResult = null) {
    if (!scanResult || typeof scanResult !== 'object') {
        return '*(No history diagnostic scan result provided)*';
    }
    const { integrity = {}, totalPartitions = 0, fileBackedCount = 0, healthyCount = 0, brokenCount = 0, results = [] } = scanResult;
    const lines = [];

    lines.push('### MultiHog Companion — History File & Projection Integrity Report');
    lines.push(`- **Active ST Chat**: \`${integrity.stChatId || 'null'}\``);
    lines.push(`- **MultiHog Runtime Chat (` + '`_rpgCurrentChatId`' + `)**: \`${integrity.rpgRuntimeChatId || 'null'}\`${integrity.runtimeLagging ? ' ⚠️ **LAGGING**' : ''}`);
    lines.push(`- **Projection Owner (` + '`chatStateProjectionOwner`' + `)**: \`${integrity.projectionOwner || 'null'}\`${integrity.ownerMismatch ? ' ⚠️ **MISMATCH**' : ''}`);
    lines.push(`- **History Persistence Latch**: ${integrity.persistenceBlocked ? '🛑 **BLOCKED (Session Locked — Reload Required)**' : '✅ Open (Normal)'}`);
    lines.push(`- **Partitions Scanned**: ${totalPartitions} total (${fileBackedCount} file-backed: ${healthyCount} healthy, ${brokenCount} broken)`);
    lines.push('');

    const broken = results.filter(r => r.hasHistoryStorage && r.verification.status !== 'ok');
    if (broken.length > 0) {
        lines.push('#### ❌ Broken / Unreadable History Files');
        for (const item of broken) {
            const v = item.verification;
            lines.push(`- **Chat \`${item.chatId}\`** (Character: \`${item.characterName || 'Unknown'}\`, Live Memo: ${item.memoChars} chars, Hydrated in RAM: \`${item.inMemoryHydrated}\`):`);
            lines.push(`  - **Status**: \`${v.status}\` — ${v.detail}`);
            lines.push(`  - **File URL**: \`${v.url}\``);
            if (v.expectedSha256) lines.push(`  - **Pointer SHA-256**: \`${v.expectedSha256}\``);
            if (v.actualSha256) lines.push(`  - **Actual File SHA-256**: \`${v.actualSha256}\``);
        }
        lines.push('');
    } else {
        lines.push('#### ✅ All File-Backed History Pointers Verified OK');
        lines.push('');
    }

    lines.push('#### 📋 All Chat Partitions Summary');
    for (const item of results) {
        const v = item.verification;
        const badge = !item.hasHistoryStorage
            ? '📄 Inline/No-file'
            : (v.status === 'ok' ? '✅ OK' : `❌ ${v.status.toUpperCase()}`);
        const fileShort = v.url ? v.url.replace(/^\/?user\/files\//, '') : '—';
        lines.push(`- **\`${item.chatId}\`** — ${badge} | Char: \`${item.characterName || '—'}\` | Memo: ${item.memoChars}c | File: \`${fileShort}\` | ${v.detail}`);
    }

    return lines.join('\n');
}
