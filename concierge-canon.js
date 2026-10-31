/**
 * concierge-canon.js — MultiHog Companion
 *
 * Archivist-mode intake for the PbtA Concierge.
 * - Estimates input size (token heuristic, CJK-aware) and decides Vibe vs Archivist mode.
 * - Chunks big lorebooks / documents and labels each chunk (NPC / MONSTER / LOCATION / ...)
 *   via a batched LLM pass with a regex fallback.
 * - Writes every chunk to the `{prefix}_Canon` lorebook as vector-matchable entries
 *   (`vectorized: true` + keyword keys) so nothing from a big lore dump is lost.
 *
 * Pure helpers are exported for unit testing; network/LLM access is injected.
 */

export const ARCHIVIST_TOKEN_THRESHOLD = 6000;
export const CHUNK_TOKEN_TARGET = 600;
export const CLASSIFY_BATCH_SIZE = 10;
export const CLASSIFY_TIMEOUT_MS = 60000;
export const CANON_ENTRY_ORDER = 50; // below dossier-driven books (100)
export const CANON_KINDS = ['NPC', 'MONSTER', 'LOCATION', 'FACTION', 'RULE', 'EVENT', 'LORE'];

/**
 * Rough token estimate: ~4 chars/token for latin text, ~1 token per CJK character.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    const s = String(text || '');
    if (!s) return 0;
    const cjk = (s.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
    const rest = s.length - cjk;
    return Math.ceil(rest / 4) + cjk;
}

/**
 * Decide Vibe vs Archivist mode.
 * @param {number} totalTokens
 * @param {'auto'|'vibe'|'archivist'} [override='auto']
 * @returns {'vibe'|'archivist'}
 */
export function decideMode(totalTokens, override = 'auto') {
    if (override === 'vibe') return 'vibe';
    if (override === 'archivist') return 'archivist';
    return totalTokens > ARCHIVIST_TOKEN_THRESHOLD ? 'archivist' : 'vibe';
}

/** Split an oversize block on paragraph (then sentence) boundaries. */
function splitOversize(text, maxTokens) {
    if (estimateTokens(text) <= maxTokens) return [text];
    const parts = [];
    let buf = '';
    const paras = text.split(/\n{2,}/);
    const flush = () => { if (buf.trim()) parts.push(buf.trim()); buf = ''; };
    for (const para of paras) {
        const units = estimateTokens(para) > maxTokens ? para.split(/(?<=[.!?])\s+/) : [para];
        for (const u of units) {
            if (buf && estimateTokens(buf + '\n\n' + u) > maxTokens) flush();
            buf = buf ? `${buf}\n\n${u}` : u;
        }
    }
    flush();
    return parts;
}

/**
 * Turn a source into chunks `{ id, title, text, keys, hint }`.
 * - lorebook source: `{ name, type:'lore', entries:[{title,keys,content}] }` → one chunk per entry
 * - document source: `{ name, type:'doc', text }` → split on markdown headings, then paragraphs
 * @param {object} source
 * @returns {Array<{ id: string, title: string, text: string, keys: string[], source: string }>}
 */
export function chunkLoreSource(source) {
    if (!source) return [];
    const out = [];
    const srcName = source.name || 'source';
    let n = 0;
    const push = (title, text, keys = []) => {
        const t = String(text || '').trim();
        if (!t) return;
        out.push({ id: `${srcName}#${n++}`, title: String(title || '').trim() || 'Untitled', text: t, keys, source: srcName });
    };

    if (Array.isArray(source.entries)) {
        for (const e of source.entries) {
            const pieces = splitOversize(String(e.content || ''), CHUNK_TOKEN_TARGET);
            pieces.forEach((p, i) => push(pieces.length > 1 ? `${e.title} (${i + 1})` : e.title, p, e.keys || []));
        }
        return out;
    }

    const text = String(source.text || '');
    const sections = text.split(/^(?=#{1,4}\s)/m);
    for (const sec of sections) {
        if (!sec.trim()) continue;
        const m = sec.match(/^#{1,4}\s+(.+)$/m);
        const title = m ? m[1].trim() : '';
        const body = m ? sec.replace(m[0], '').trim() : sec.trim();
        const pieces = splitOversize(body, CHUNK_TOKEN_TARGET);
        pieces.forEach((p, i) => push(title ? (pieces.length > 1 ? `${title} (${i + 1})` : title) : firstWords(p, 5), p));
    }
    return out;
}

function firstWords(text, n) {
    return String(text).replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
}

/**
 * Regex/heuristic fallback labeling (no LLM).
 * @param {{ id: string, title: string, text: string, keys?: string[] }} chunk
 * @returns {{ kind: string, name: string, aliases: string[], importance: number }}
 */
export function classifyChunkHeuristic(chunk) {
    const hay = `${chunk.title}\n${chunk.text}`.toLowerCase();
    const score = (words) => words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
    const candidates = [
        ['MONSTER', score(['monster', 'beast', 'creature', 'dragon', 'undead', 'demon', 'horror', 'predator', 'lurks', 'hunts'])],
        ['FACTION', score(['guild', 'order of', 'clan', 'cult', 'house ', 'empire', 'kingdom', 'faction', 'council', 'army', 'syndicate'])],
        ['LOCATION', score(['city', 'town', 'village', 'fortress', 'ruins', 'forest', 'mountain', 'dungeon', 'temple', 'district', 'harbor', 'region', 'castle'])],
        ['RULE', score(['law of', 'magic works', 'rule', 'cannot', 'forbidden', 'technology', 'always', 'never'])],
        ['EVENT', score(['war', 'plague', 'festival', 'battle', 'siege', 'prophecy', 'cataclysm', 'years ago'])],
        ['NPC', score([' he ', ' she ', ' his ', ' her ', 'born', 'lord', 'lady', 'captain', 'mentor', 'merchant', 'priest'])],
    ];
    candidates.sort((a, b) => b[1] - a[1]);
    const kind = candidates[0][1] > 0 ? candidates[0][0] : 'LORE';
    return {
        kind,
        name: chunk.title,
        aliases: (chunk.keys || []).filter(k => k && k.toLowerCase() !== chunk.title.toLowerCase()).slice(0, 6),
        importance: 3,
    };
}

/**
 * Tolerant parser for the labeling LLM's reply. Accepts fenced JSON or bare arrays.
 * @param {string} reply
 * @returns {Array<{ id: string, kind: string, name?: string, aliases: string[], importance: number }>}
 */
export function parseClassificationJson(reply) {
    let s = String(reply || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let arr;
    try { arr = JSON.parse(s.slice(start, end + 1)); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const r of arr) {
        if (!r || typeof r !== 'object' || r.id === undefined) continue;
        const kind = String(r.kind || '').toUpperCase();
        out.push({
            id: String(r.id),
            kind: CANON_KINDS.includes(kind) ? kind : 'LORE',
            name: r.name ? String(r.name).trim() : undefined,
            aliases: Array.isArray(r.aliases) ? r.aliases.map(a => String(a).trim()).filter(Boolean).slice(0, 8) : [],
            importance: Math.min(5, Math.max(1, Math.round(Number(r.importance)) || 3)),
        });
    }
    return out;
}

function withTimeout(promise, ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Canon labeling timed out')), ms);
        const onAbort = () => { clearTimeout(timer); reject(new Error('Canon labeling cancelled')); };
        if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}

/**
 * Label chunks with batched LLM calls; any failed batch falls back to heuristics.
 *
 * @param {Array} chunks
 * @param {{ send?: Function, onStatus?: Function, signal?: AbortSignal|null, onFallback?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<{ chunk: object, label: object }>>}
 */
export async function classifyChunks(chunks, opts = {}) {
    const { send = null, onStatus = () => {}, signal = null, onFallback = () => {}, timeoutMs = CLASSIFY_TIMEOUT_MS } = opts;
    const results = [];
    let fellBack = false;

    for (let i = 0; i < chunks.length; i += CLASSIFY_BATCH_SIZE) {
        if (signal?.aborted) throw new Error('Canon labeling cancelled');
        const batch = chunks.slice(i, i + CLASSIFY_BATCH_SIZE);
        onStatus(`Cataloguing canon… ${Math.min(i + batch.length, chunks.length)}/${chunks.length}`);

        let labels = [];
        if (send) {
            try {
                const system = `You label tabletop RPG setting notes. For each numbered passage return one JSON object. Reply with ONLY a JSON array: [{"id":"<id>","kind":"NPC|MONSTER|LOCATION|FACTION|RULE|EVENT|LORE","name":"<canonical name>","aliases":["..."],"importance":1-5}]. importance 5 = central to the setting, 1 = trivia.`;
                const user = batch.map(c => `ID: ${c.id}\nTitle: ${c.title}\nHint keys: ${(c.keys || []).join(', ')}\nText: ${c.text.slice(0, 1200)}`).join('\n\n---\n\n');
                const reply = await withTimeout(send([{ role: 'system', content: system }, { role: 'user', content: user }], signal), timeoutMs, signal);
                labels = parseClassificationJson(reply);
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('[PbtA Concierge] Canon labeling batch failed, using heuristics:', err);
            }
        }
        const byId = new Map(labels.map(l => [l.id, l]));
        for (const chunk of batch) {
            const l = byId.get(chunk.id);
            if (l) {
                results.push({ chunk, label: { ...l, name: l.name || chunk.title } });
            } else {
                fellBack = true;
                results.push({ chunk, label: classifyChunkHeuristic(chunk) });
            }
        }
    }
    if (fellBack) onFallback();
    return results;
}

/**
 * Build a vector-matchable ST World Info entry for a labeled chunk.
 * @param {{ chunk: object, label: object }} item
 * @returns {{ name: string, comment: string, keys: string[], content: string, kind: string, importance: number }}
 */
export function buildCanonEntry({ chunk, label }) {
    const name = (label.name || chunk.title || 'Untitled').trim();
    const keys = [...new Set([name, ...(label.aliases || []), ...(chunk.keys || [])]
        .map(k => String(k).trim()).filter(Boolean))].slice(0, 12);
    return {
        name,
        comment: `[${label.kind}] ${name}`,
        keys,
        content: chunk.text,
        kind: label.kind,
        importance: label.importance,
    };
}

/**
 * Summarise labeled entries for the Stage 2 briefing.
 * @param {Array<{ kind: string, name: string, importance: number }>} entries
 * @param {number} [topN=5]
 */
export function summarizeCanonInventory(entries, topN = 5) {
    const counts = {};
    const buckets = {};
    for (const e of entries) {
        counts[e.kind] = (counts[e.kind] || 0) + 1;
        (buckets[e.kind] ||= []).push(e);
    }
    const top = {};
    for (const [k, list] of Object.entries(buckets)) {
        top[k] = list.sort((a, b) => b.importance - a.importance).slice(0, topN).map(e => e.name);
    }
    return { counts, top, total: entries.length };
}

// ── Staging store (attach-time) ──────────────────────────────────────────────

let _sources = new Map(); // name → { source, labeled: entries[]|null }
let _override = 'auto';
let _briefed = false;

export function setModeOverride(mode) {
    _override = ['vibe', 'archivist'].includes(mode) ? mode : 'auto';
}
export function getModeOverride() { return _override; }

export function getStagedTokenTotal() {
    let total = 0;
    for (const { source } of _sources.values()) {
        total += Array.isArray(source.entries)
            ? source.entries.reduce((a, e) => a + estimateTokens(e.content), 0)
            : estimateTokens(source.text);
    }
    return total;
}

export function getCurrentMode() {
    return decideMode(getStagedTokenTotal(), _override);
}

export function unstageCanonSource(name) { _sources.delete(name); }
export function clearStagedCanon() { _sources = new Map(); _briefed = false; _promoted = new Set(); }
export function getStagedCanonEntries() {
    return [...(_sources.values())].flatMap(s => s.labeled || []);
}

/**
 * Register a source for Canon ingest. If the staged total puts us in Archivist mode,
 * label all unlabeled sources now (so the user sees progress at attach time).
 *
 * @param {object} source { name, type, entries? | text? }
 * @param {object} [opts] same as classifyChunks opts
 * @returns {Promise<{ mode: 'vibe'|'archivist', entries: Array }>}
 */
export async function stageCanonSource(source, opts = {}) {
    if (!source?.name) return { mode: getCurrentMode(), entries: [] };
    _sources.set(source.name, { source, labeled: null });
    const mode = getCurrentMode();
    if (mode === 'archivist') {
        for (const rec of _sources.values()) {
            if (rec.labeled) continue;
            const chunks = chunkLoreSource(rec.source);
            const labeled = await classifyChunks(chunks, opts);
            rec.labeled = labeled.map(buildCanonEntry);
        }
    }
    return { mode, entries: getStagedCanonEntries() };
}

/**
 * Write staged Canon entries into `{prefix}_Canon`. Idempotent: entries are matched by comment.
 *
 * @param {string} prefix
 * @param {object} [deps] injectable `{ fetchImpl, getHeaders, afterSave }` for tests
 * @returns {Promise<{ bookName: string, written: number, skipped: number }|null>}
 */
export async function writeStagedCanon(prefix, deps = {}) {
    const entries = getStagedCanonEntries();
    if (!entries.length) return null;
    const bookName = prefix ? `${prefix}_Canon` : 'Canon';
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const getHeaders = deps.getHeaders || ctx?.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
    const doFetch = deps.fetchImpl || fetch;

    let bookData = null;
    try {
        const res = await doFetch('/api/worldinfo/get', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name: bookName }) });
        if (res.ok) bookData = await res.json();
    } catch (_) {}
    if (!bookData || typeof bookData !== 'object' || !bookData.entries) {
        bookData = { entries: {}, name: bookName, scan_depth: 4, token_budget: 800, recursive: false, extensions: {} };
    }

    const existing = new Set(Object.values(bookData.entries).map(e => String(e.comment || '').toLowerCase()));
    let nextUid = Math.max(-1, ...Object.keys(bookData.entries).map(Number).filter(n => !isNaN(n))) + 1;
    let written = 0;
    let skipped = 0;

    for (const e of entries) {
        if (existing.has(e.comment.toLowerCase())) { skipped++; continue; }
        existing.add(e.comment.toLowerCase());
        bookData.entries[nextUid] = {
            uid: nextUid,
            key: e.keys,
            keysecondary: [],
            comment: e.comment,
            content: e.content,
            constant: false,
            vectorized: true,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: CANON_ENTRY_ORDER,
            position: 0,
            disable: false,
            probability: 100,
            useProbability: false,
            depth: 4,
            extensions: { canon: true, canonKind: e.kind, canonImportance: e.importance, vectorized: true },
        };
        nextUid++;
        written++;
    }

    if (written) {
        await doFetch('/api/worldinfo/edit', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name: bookName, data: bookData }) });
        if (typeof deps.afterSave === 'function') await deps.afterSave(bookName, bookData);
    }
    return { bookName, written, skipped };
}

// ── Stage 2: briefing ────────────────────────────────────────────────────────

/** True when Archivist mode has staged Canon and the user hasn't been briefed yet. */
export function shouldBrief() {
    return getCurrentMode() === 'archivist' && getStagedCanonEntries().length > 0 && !_briefed;
}
export function markBriefed() { _briefed = true; }
export function isBriefed() { return _briefed; }

const KIND_LABELS = { NPC: 'NPCs', MONSTER: 'Monsters/threats', LOCATION: 'Locations', FACTION: 'Factions', RULE: 'World rules', EVENT: 'Events', LORE: 'General lore' };

/**
 * Compact `[CANON_INVENTORY]` prompt block: counts and top names only, never full text.
 * Capped to roughly `maxTokens` by trimming the names per kind.
 *
 * @param {Array} entries labeled canon entries
 * @param {number} [maxTokens=1000]
 * @returns {string}
 */
export function buildInventoryBlock(entries, maxTokens = 1000) {
    if (!entries?.length) return '';
    let topN = 8;
    let block = '';
    for (; topN >= 1; topN--) {
        const inv = summarizeCanonInventory(entries, topN);
        const lines = Object.keys(inv.counts).sort((a, b) => inv.counts[b] - inv.counts[a]).map(k =>
            `* ${KIND_LABELS[k] || k} (${inv.counts[k]}): ${(inv.top[k] || []).join(', ')}${inv.counts[k] > topN ? ', …' : ''}`);
        block = `\n[CANON_INVENTORY: ${inv.total} entries catalogued into the campaign's Canon lorebook]\n${lines.join('\n')}\n[/CANON_INVENTORY]\n`;
        if (estimateTokens(block) <= maxTokens) break;
    }
    return block;
}

/**
 * Extract and strip the `[SUGGESTED_STARTS]` block from a briefing reply.
 * @param {string} reply
 * @returns {{ text: string, starts: string[] }}
 */
export function parseSuggestedStarts(reply) {
    const raw = String(reply || '');
    const m = raw.match(/\[SUGGESTED_STARTS\]([\s\S]*?)\[\/SUGGESTED_STARTS\]/i);
    if (!m) return { text: raw.trim(), starts: [] };
    const starts = m[1].split('\n')
        .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 4);
    return { text: raw.replace(m[0], '').trim(), starts };
}

/**
 * Is ST's Vectors extension enabled for World Info? (undefined settings → treated as off)
 * @param {object} [extensionSettings]
 */
export function isVectorsWorldInfoEnabled(extensionSettings) {
    const v = extensionSettings?.vectors;
    return Boolean(v && v.enabled_world_info);
}

// ── Stage 3: focus slice & promote-on-demand ─────────────────────────────────

export const FOCUS_SLICE_TOKEN_BUDGET = 2500;
export const ARCHIVIST_QUOTAS = { maps: 3, monsters: 3, npcs: 4 };

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'let', 'lets', 'start', 'starting', 'from', 'into', 'about', 'want', 'have', 'build', 'out', 'canon', 'please', 'would', 'like', 'are', 'was', 'you', 'our', 'your', 'can', 'its']);

function queryTerms(text) {
    return [...new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(t => t.length > 2 && !STOP.has(t)))];
}

/**
 * Score & select the Canon entries most relevant to `query`, returned in full within a token budget.
 * Name/key hits outweigh body hits; importance breaks ties. Entries with no hit are never returned.
 *
 * @param {Array} entries labeled canon entries
 * @param {string} query user text (e.g. the chosen start)
 * @param {{ maxTokens?: number, maxEntries?: number, exclude?: Set<string> }} [opts]
 * @returns {Array}
 */
export function retrieveCanonSlice(entries, query, opts = {}) {
    const { maxTokens = FOCUS_SLICE_TOKEN_BUDGET, maxEntries = 12, exclude = new Set() } = opts;
    const terms = queryTerms(query);
    if (!terms.length || !entries?.length) return [];
    const scored = [];
    for (const e of entries) {
        if (exclude.has(e.comment)) continue;
        const nameHay = `${e.name} ${(e.keys || []).join(' ')}`.toLowerCase();
        const bodyHay = String(e.content || '').toLowerCase();
        let score = 0;
        for (const t of terms) {
            if (nameHay.includes(t)) score += 5;
            else if (bodyHay.includes(t)) score += 1;
        }
        if (score > 0) scored.push({ e, score: score + (e.importance || 3) * 0.5 });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = [];
    let used = 0;
    for (const { e } of scored) {
        const cost = estimateTokens(e.content) + 20;
        if (out.length >= maxEntries) break;
        if (used + cost > maxTokens) { if (!out.length) { out.push({ ...e, content: e.content.slice(0, maxTokens * 4) }); } continue; }
        out.push(e);
        used += cost;
    }
    return out;
}

/**
 * `[CANON_FOCUS]` block: full text of the entries relevant to the player's chosen start.
 * @param {Array} slice
 * @returns {string}
 */
export function buildFocusBlock(slice) {
    if (!slice?.length) return '';
    const parts = slice.map(e => `### [${e.kind}] ${e.name}\n${e.content}`);
    return `\n[CANON_FOCUS: full canon for the player's chosen focus]\n${parts.join('\n\n')}\n[/CANON_FOCUS]\n`;
}

/**
 * Extract `[PROMOTE_CANON: Name]` requests from a model reply.
 * @param {string} reply
 * @returns {string[]}
 */
export function parsePromoteRequests(reply) {
    const names = [];
    const re = /\[PROMOTE_CANON:\s*([^\]\n]+)\]/gi;
    let m;
    while ((m = re.exec(String(reply || '')))) names.push(m[1].trim());
    return [...new Set(names)].slice(0, 6);
}

/** Remove `[PROMOTE_CANON: …]` tags from display text. */
export function stripPromoteTags(text) {
    return String(text || '').replace(/\s*\[PROMOTE_CANON:[^\]\n]*\]/gi, '').trim();
}

/**
 * Resolve requested names to staged Canon entries (exact name/alias, then substring).
 * @param {string[]} names
 * @param {Array} entries
 * @returns {{ found: Array, missing: string[] }}
 */
export function resolvePromoteRequests(names, entries) {
    const found = [];
    const missing = [];
    for (const raw of names) {
        const n = raw.toLowerCase();
        const hit = entries.find(e => e.name.toLowerCase() === n || (e.keys || []).some(k => k.toLowerCase() === n))
            || entries.find(e => e.name.toLowerCase().includes(n) || n.includes(e.name.toLowerCase()));
        if (hit) { if (!found.includes(hit)) found.push(hit); } else missing.push(raw);
    }
    return { found, missing };
}

let _promoted = new Set(); // comments already shown in full this session
export function markSlicePromoted(slice) { slice.forEach(e => _promoted.add(e.comment)); }
export function getPromotedSet() { return _promoted; }
