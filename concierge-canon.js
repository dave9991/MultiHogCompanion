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

import { resolveDossierNamePlaceholders, parseResolvedNameToken } from './namerag-hooks.js';

export const ARCHIVIST_TOKEN_THRESHOLD = 6000;
export const MIDDLE_IMPORT_TOKEN_THRESHOLD = 300;
export const CHUNK_TOKEN_TARGET = 600;
export const CLASSIFY_BATCH_SIZE = 5;
export const CLASSIFY_TIMEOUT_MS = 300000;
export const CANON_ENTRY_ORDER = 50; // below dossier-driven books (100)
export const CANON_KINDS = ['NPC', 'MONSTER', 'LOCATION', 'FACTION', 'RULE', 'EVENT', 'LORE'];

/**
 * Detect 3-bucket canon scale tier based on total staged tokens.
 * @param {number} totalTokens
 * @returns {'big'|'middle'|'vibe'}
 */
export function detectCanonBucket(totalTokens) {
    const t = Number(totalTokens) || 0;
    if (t > ARCHIVIST_TOKEN_THRESHOLD) return 'big';
    if (t >= MIDDLE_IMPORT_TOKEN_THRESHOLD) return 'middle';
    return 'vibe';
}

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
 * Clean PDF drop-shadow / kerning-doubled heading artifacts before chunking.
 * e.g. "F F F A A L L L L O O U U T T   B B I I B B L L E E : :   S S E E C C T T I I O O N N   Z Z E E R R O O"
 *   -> "FALLOUT BIBLE: SECTION ZERO"
 * Prose lines without these artifacts are returned completely untouched.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizePdfText(text) {
    if (!text) return '';
    const lines = String(text).split(/\r?\n/);
    const out = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        if (!tokens.length) return line;
        const singleCharTokens = tokens.filter(t => t.length === 1).length;
        if (singleCharTokens / tokens.length < 0.8) return line;
        const pairs = (trimmed.match(/(\S)\s+\1/g) || []).length;
        if (pairs < 3) return line;

        if (/\s{2,}/.test(trimmed)) {
            const rawWords = trimmed.split(/\s{2,}/);
            const outWords = rawWords.map(word => {
                let w = word.replace(/(?:(\S)\s+\1\s+\1|(\S)\s+\2)/g, '$1$2');
                w = w.replace(/\s+/g, '');
                return w;
            });
            return outWords.join(' ');
        }

        return trimmed.replace(/\b([A-Z])\s+\1(?:\s+\1)?\b/gi, '$1');
    });
    return out.join('\n');
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

    if (source.card && !source.text) {
        if (source.card.description) push(`${srcName} Description`, source.card.description);
        if (source.card.personality) push(`${srcName} Personality`, source.card.personality);
        if (source.card.scenario) push(`${srcName} Scenario`, source.card.scenario);
        if (out.length) return out;
    }

    const text = normalizePdfText(String(source.text || source.rawText || ''));
    const lines = text.split(/\r?\n/);
    const headings = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const mdMatch = line.match(/^#{1,4}\s+([^\n#]{1,80})$/);
        if (mdMatch) {
            headings.push({ lineIndex: i, title: mdMatch[1].trim() });
            continue;
        }
        const isAllCaps = /^[A-Z][A-Z0-9\s:,'’&/().-]{2,79}$/.test(line) && /\b[A-Z]{3,}\b/.test(line);
        const precededByBlankOrStart = (i === 0 || lines[i - 1].trim() === '');
        const followedByContent = (i + 1 < lines.length);
        if (isAllCaps && precededByBlankOrStart && followedByContent) {
            headings.push({ lineIndex: i, title: line });
        }
    }

    if (!headings.length) {
        const pieces = splitOversize(text.trim(), CHUNK_TOKEN_TARGET);
        pieces.forEach(p => push(firstWords(p, 5), p));
        return out;
    }

    if (headings[0].lineIndex > 0) {
        const pre = lines.slice(0, headings[0].lineIndex).join('\n').trim();
        if (pre) {
            const pieces = splitOversize(pre, CHUNK_TOKEN_TARGET);
            pieces.forEach(p => push(firstWords(p, 5), p));
        }
    }

    for (let h = 0; h < headings.length; h++) {
        const start = headings[h].lineIndex;
        const end = (h + 1 < headings.length) ? headings[h + 1].lineIndex : lines.length;
        const title = headings[h].title;
        const body = lines.slice(start + 1, end).join('\n').trim();
        const content = body || title;
        const pieces = splitOversize(content, CHUNK_TOKEN_TARGET);
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
    let s = String(reply || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .trim();
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
        if (!r || typeof r !== 'object' || (r.id === undefined && !r.kind && !r.name)) continue;
        const kind = String(r.kind || '').toUpperCase();
        const isDisabled = Boolean(r.disabled || r.outOfScope || Number(r.importance) === 0);
        const importance = isDisabled ? 1 : Math.min(5, Math.max(1, Math.round(Number(r.importance)) || 3));
        out.push({
            id: r.id !== undefined ? String(r.id) : undefined,
            kind: CANON_KINDS.includes(kind) ? kind : 'LORE',
            name: r.name ? String(r.name).trim() : undefined,
            aliases: Array.isArray(r.aliases) ? r.aliases.map(a => String(a).trim()).filter(Boolean).slice(0, 8) : [],
            importance,
            disabled: isDisabled,
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
 * Label chunks with batched LLM calls. Fails fast if the LLM connection is missing,
 * times out, or returns invalid/incomplete data.
 *
 * @param {Array} chunks
 * @param {{ send?: Function, onStatus?: Function, signal?: AbortSignal|null, timeoutMs?: number, framingBrief?: object }} [opts]
 * @returns {Promise<Array<{ chunk: object, label: object }>>}
 */
export async function classifyChunks(chunks, opts = {}) {
    if (!chunks || !chunks.length) return [];
    const { send = null, onStatus = () => {}, signal = null, timeoutMs = CLASSIFY_TIMEOUT_MS, framingBrief = {} } = opts;
    if (typeof send !== 'function') {
        throw new Error('Canon classification requires an active LLM connection.');
    }
    const results = [];

    const focalLens = (framingBrief.focalLens || framingBrief.premise || '').trim();

    for (let i = 0; i < chunks.length; i += CLASSIFY_BATCH_SIZE) {
        if (signal?.aborted) throw new Error('Canon labeling cancelled');
        const batch = chunks.slice(i, i + CLASSIFY_BATCH_SIZE);
        const batchNum = Math.floor(i / CLASSIFY_BATCH_SIZE) + 1;
        onStatus(`Cataloguing canon… ${Math.min(i + batch.length, chunks.length)}/${chunks.length}`);

        let reply;
        try {
            let system = `You label tabletop RPG setting notes. For each numbered passage return one JSON object. Reply with ONLY a JSON array: [{"id":"<id>","kind":"NPC|MONSTER|LOCATION|FACTION|RULE|EVENT|LORE","name":"<canonical name>","aliases":["..."],"importance":1-5}]. importance 5 = central to the setting, 1 = trivia.`;
            if (focalLens) {
                system += ` Campaign Focal Lens: ${focalLens}. Set "disabled": true and "importance": 1 for passages that are out-of-scope or irrelevant to this focal lens; set "disabled": false and "importance": 3-5 for passages relevant to this lens.`;
            }
            const user = batch.map(c => `ID: ${c.id}\nTitle: ${c.title}\nHint keys: ${(c.keys || []).join(', ')}\nText: ${c.text.slice(0, 1200)}`).join('\n\n---\n\n');
            reply = await withTimeout(send([{ role: 'system', content: system }, { role: 'user', content: user }], signal), timeoutMs, signal);
        } catch (err) {
            if (signal?.aborted) throw err;
            throw new Error(`Canon LLM labeling failed on batch ${batchNum}: ${err.message || err}`);
        }

        const labels = parseClassificationJson(reply);
        if (!labels.length) {
            throw new Error(`Canon LLM labeling returned invalid or empty JSON on batch ${batchNum}.`);
        }

        const byId = new Map(labels.map(l => [l.id, l]));
        for (let idx = 0; idx < batch.length; idx++) {
            const chunk = batch[idx];
            let l = byId.get(chunk.id);
            if (!l && labels.length === batch.length && labels[idx]) {
                l = labels[idx];
            }
            if (!l) {
                throw new Error(`Canon LLM labeling omitted chunk "${chunk.id}" on batch ${batchNum}.`);
            }
            results.push({ chunk, label: { ...l, name: l.name || chunk.title, disabled: Boolean(l.disabled) } });
        }
    }
    return results;
}

/**
 * Build a vector-matchable ST World Info entry for a labeled chunk.
 * @param {{ chunk: object, label: object }} item
 * @returns {{ id: string, name: string, comment: string, keys: string[], content: string, kind: string, importance: number, disabled: boolean }}
 */
export function buildCanonEntry({ chunk, label }) {
    const kind = label.kind || 'LORE';
    const name = (label.name || chunk.title || 'Untitled').trim();
    const id = chunk.id || label.id || `${kind}:${name}`;
    const keys = [...new Set([name, ...(label.aliases || []), ...(chunk.keys || [])]
        .map(k => String(k).trim()).filter(Boolean))].slice(0, 12);
    return {
        id,
        name,
        comment: `[${kind}] ${name}`,
        keys,
        content: chunk.text,
        kind,
        importance: label.importance !== undefined ? label.importance : 3,
        disabled: Boolean(label.disabled),
    };
}

const HONORIFIC_PREFIX_REGEX = /^(the|dr\.?|doctor|commander|agent|captain|lord|lady|sir|madam|officer|chief|sergeant|sgt\.?|general|gen\.?|colonel|col\.?|lieutenant|lt\.?)\s+/i;

/**
 * Normalizes an entity name by stripping common titles/honorifics, punctuation, and extra whitespace.
 * @param {string} name
 * @returns {string}
 */
export function normalizeEntityName(name = '') {
    if (!name || typeof name !== 'string') return '';
    return name
        .trim()
        .toLowerCase()
        .replace(HONORIFIC_PREFIX_REGEX, '')
        .replace(/[-_]/g, ' ')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Detects potential duplicate or split-chunk entity candidates within the same category.
 * - Exact normalized matches (e.g. "Vault 13" vs "Vault-13") are marked 'exact_match' (auto-linkable).
 * - Core token containment (e.g. "The Horrigan" vs "Frank Horrigan") are marked 'token_containment'.
 * - Shared surnames with distinct given names (e.g. "Jane Smith" vs "John Smith") are marked 'shared_surname'.
 *
 * @param {Array<object>} entries Staged canon entries
 * @returns {Array<object>} Candidate clusters
 */
export function detectDuplicateCandidates(entries = []) {
    if (!Array.isArray(entries) || entries.length < 2) return [];

    const candidates = [];
    const seenPairs = new Set();

    for (let i = 0; i < entries.length; i++) {
        const a = entries[i];
        if (!a || !a.name) continue;
        const normA = normalizeEntityName(a.name);
        if (!normA) continue;
        const wordsA = normA.split(' ').filter(Boolean);

        for (let j = i + 1; j < entries.length; j++) {
            const b = entries[j];
            if (!b || !b.name) continue;
            // Only compare entities of the same kind (NPC to NPC, LOCATION to LOCATION, etc.)
            if ((a.kind || 'LORE').toUpperCase() !== (b.kind || 'LORE').toUpperCase()) continue;

            const normB = normalizeEntityName(b.name);
            if (!normB) continue;
            const wordsB = normB.split(' ').filter(Boolean);

            const pairKey = [a.id || a.name, b.id || b.name].sort().join('::');
            if (seenPairs.has(pairKey)) continue;

            // 1. Exact normalized match (e.g. "Vault 13" vs "Vault-13", "The Enclave" vs "Enclave")
            if (normA === normB) {
                seenPairs.add(pairKey);
                candidates.push({
                    id: `cand_${i}_${j}`,
                    kind: a.kind,
                    type: 'exact_match',
                    entryA: a,
                    entryB: b,
                    nameA: a.name,
                    nameB: b.name,
                    excerptA: (a.content || '').slice(0, 300),
                    excerptB: (b.content || '').slice(0, 300),
                });
                continue;
            }

            // 2. Token containment / Stem overlap (e.g. "The Horrigan" ['horrigan'] vs "Frank Horrigan" ['frank', 'horrigan'])
            const isASubsetOfB = wordsA.length > 0 && wordsA.every(w => wordsB.includes(w));
            const isBSubsetOfA = wordsB.length > 0 && wordsB.every(w => wordsA.includes(w));

            if (isASubsetOfB || isBSubsetOfA) {
                seenPairs.add(pairKey);
                candidates.push({
                    id: `cand_${i}_${j}`,
                    kind: a.kind,
                    type: 'token_containment',
                    entryA: a,
                    entryB: b,
                    nameA: a.name,
                    nameB: b.name,
                    excerptA: (a.content || '').slice(0, 300),
                    excerptB: (b.content || '').slice(0, 300),
                });
                continue;
            }

            // 3. Shared surname with distinct given names for NPCs (e.g. "Jane Smith" vs "John Smith")
            if ((a.kind || '').toUpperCase() === 'NPC' && wordsA.length >= 2 && wordsB.length >= 2) {
                const surnameA = wordsA[wordsA.length - 1];
                const surnameB = wordsB[wordsB.length - 1];
                const givenA = wordsA[0];
                const givenB = wordsB[0];

                if (surnameA === surnameB && givenA !== givenB) {
                    seenPairs.add(pairKey);
                    candidates.push({
                        id: `cand_${i}_${j}`,
                        kind: a.kind,
                        type: 'shared_surname',
                        entryA: a,
                        entryB: b,
                        nameA: a.name,
                        nameB: b.name,
                        excerptA: (a.content || '').slice(0, 300),
                        excerptB: (b.content || '').slice(0, 300),
                    });
                }
            }
        }
    }

    return candidates;
}

/**
 * Arbitrates duplicate candidates using automatic alias linking for exact matches,
 * and a single fast LLM pass for semantic ambiguities.
 *
 * @param {Array<object>} candidates Detected candidate pairs
 * @param {Array<object>} entries All staged entries
 * @param {object} [opts]
 * @param {Function} [opts.send] LLM send function
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<{ entries: Array<object>, auditLog: Array<object> }>}
 */
export async function arbitrateDuplicateCandidates(candidates = [], entries = [], opts = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return { entries, auditLog: [] };
    }

    const { send = null, signal = null, timeoutMs = 15000 } = opts;
    const auditLog = [];
    const entriesToAbsorb = new Set();
    const needsLlmCandidates = [];

    // 1. Process exact matches immediately without LLM overhead
    for (const cand of candidates) {
        if (cand.type === 'exact_match') {
            const canonicalEntry = cand.entryA.name.length >= cand.entryB.name.length ? cand.entryA : cand.entryB;
            const absorbedEntry = canonicalEntry === cand.entryA ? cand.entryB : cand.entryA;

            if (entriesToAbsorb.has(canonicalEntry.id || canonicalEntry.name) || entriesToAbsorb.has(absorbedEntry.id || absorbedEntry.name)) {
                continue;
            }

            canonicalEntry.aliases = [...new Set([...(canonicalEntry.aliases || []), ...(absorbedEntry.aliases || []), absorbedEntry.name])].filter(a => a && a.toLowerCase() !== canonicalEntry.name.toLowerCase());
            canonicalEntry.keys = [...new Set([...(canonicalEntry.keys || []), ...(absorbedEntry.keys || []), absorbedEntry.name, ...(canonicalEntry.aliases || [])])];
            canonicalEntry.content = `${canonicalEntry.content.trim()}\n\n---\n[Additional Lore Excerpt]\n${absorbedEntry.content.trim()}`;
            canonicalEntry.importance = Math.max(canonicalEntry.importance || 3, absorbedEntry.importance || 3);
            entriesToAbsorb.add(absorbedEntry.id || absorbedEntry.name);

            auditLog.push({
                action: 'autoLink',
                canonical: canonicalEntry.name,
                absorbed: absorbedEntry.name,
                kind: canonicalEntry.kind,
                reason: 'Exact normalized name match (e.g. casing/punctuation)',
            });
        } else {
            needsLlmCandidates.push(cand);
        }
    }

    // 2. If there are ambiguous candidates (token containment or shared surname), query LLM if available
    if (needsLlmCandidates.length > 0 && typeof send === 'function') {
        try {
            const systemPrompt = `You are a Tabletop RPG lore archivist and entity deduplication arbiter.
Examine the following candidate entity pairs from imported campaign notes. For each candidate pair, decide whether they refer to the EXACT SAME entity across different document sections, or are DISTINCT entities (such as family members sharing a surname, or different sub-locations), or are REDUNDANT.

Actions:
- "link": They are the exact same individual or place (e.g., "The Horrigan" and "Frank Horrigan"). Provide preferred "canonicalName". Both passages will be preserved under this one entity.
- "separate": They are distinct individuals or places (e.g., "Jane Smith" and "John Smith" who are husband and wife). Keep both as separate cards.
- "merge": Nearly identical redundant text. Combine into one.

Reply ONLY with a JSON array:
[
  {
    "id": "<candidate id>",
    "action": "link" | "separate" | "merge",
    "canonicalName": "<Preferred Name>",
    "reason": "<1-sentence reason>"
  }
]`;

            const userPrompt = needsLlmCandidates.map(c =>
                `ID: ${c.id}\nKind: ${c.kind}\nCandidate A: "${c.nameA}"\nExcerpt A: ${c.excerptA}\nCandidate B: "${c.nameB}"\nExcerpt B: ${c.excerptB}`
            ).join('\n\n---\n\n');

            const reply = await withTimeout(
                send([{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], signal),
                timeoutMs,
                signal
            );

            let s = String(reply || '')
                .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
                .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
                .trim();
            const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence) s = fence[1].trim();
            const start = s.indexOf('[');
            const end = s.lastIndexOf(']');
            let verdicts = [];
            if (start !== -1 && end > start) {
                try {
                    const parsed = JSON.parse(s.slice(start, end + 1));
                    if (Array.isArray(parsed)) verdicts = parsed;
                } catch (_) {}
            }
            const verdictMap = new Map((verdicts || []).map(v => [v.id, v]));

            for (const cand of needsLlmCandidates) {
                const v = verdictMap.get(cand.id);
                if (!v) {
                    auditLog.push({ action: 'separate', nameA: cand.nameA, nameB: cand.nameB, kind: cand.kind, reason: 'No decision returned (kept separate by default)' });
                    continue;
                }

                if (v.action === 'link' || v.action === 'merge') {
                    const canonicalName = v.canonicalName?.trim() || cand.nameA;
                    const canonicalEntry = (cand.nameA === canonicalName || normalizeEntityName(cand.nameA) === normalizeEntityName(canonicalName))
                        ? cand.entryA
                        : cand.entryB;
                    const absorbedEntry = canonicalEntry === cand.entryA ? cand.entryB : cand.entryA;

                    if (entriesToAbsorb.has(canonicalEntry.id || canonicalEntry.name) || entriesToAbsorb.has(absorbedEntry.id || absorbedEntry.name)) {
                        continue;
                    }

                    canonicalEntry.name = canonicalName;
                    canonicalEntry.comment = `[${canonicalEntry.kind}] ${canonicalName}`;
                    canonicalEntry.aliases = [...new Set([...(canonicalEntry.aliases || []), ...(absorbedEntry.aliases || []), absorbedEntry.name])].filter(a => a && a.toLowerCase() !== canonicalName.toLowerCase());
                    canonicalEntry.keys = [...new Set([...(canonicalEntry.keys || []), ...(absorbedEntry.keys || []), absorbedEntry.name, ...(canonicalEntry.aliases || [])])];
                    canonicalEntry.content = `${canonicalEntry.content.trim()}\n\n---\n[Additional Lore Excerpt]\n${absorbedEntry.content.trim()}`;
                    canonicalEntry.importance = Math.max(canonicalEntry.importance || 3, absorbedEntry.importance || 3);
                    entriesToAbsorb.add(absorbedEntry.id || absorbedEntry.name);

                    auditLog.push({
                        action: v.action,
                        canonical: canonicalName,
                        absorbed: absorbedEntry.name,
                        kind: canonicalEntry.kind,
                        reason: v.reason || 'Identified as the same entity across excerpts',
                    });
                } else {
                    auditLog.push({
                        action: 'separate',
                        nameA: cand.nameA,
                        nameB: cand.nameB,
                        kind: cand.kind,
                        reason: v.reason || 'Distinct entities confirmed by arbiter',
                    });
                }
            }
        } catch (llmErr) {
            console.warn('[concierge-canon] Semantic deduplication arbitration failed or timed out:', llmErr);
            for (const cand of needsLlmCandidates) {
                auditLog.push({
                    action: 'separate',
                    nameA: cand.nameA,
                    nameB: cand.nameB,
                    kind: cand.kind,
                    reason: `Arbitration skipped (${llmErr.message || 'offline'}), safely kept separate`,
                });
            }
        }
    } else {
        // Without active LLM, safely default ambiguous candidates to separate
        for (const cand of needsLlmCandidates) {
            auditLog.push({
                action: 'separate',
                nameA: cand.nameA,
                nameB: cand.nameB,
                kind: cand.kind,
                reason: 'Heuristic candidate flagged; kept separate (no active LLM send provided)',
            });
        }
    }

    // Filter out absorbed entries across _sources
    if (entriesToAbsorb.size > 0) {
        for (const rec of _sources.values()) {
            if (Array.isArray(rec.labeled)) {
                rec.labeled = rec.labeled.filter(e => !entriesToAbsorb.has(e.id || e.name));
            }
        }
    }

    const finalEntries = entries.filter(e => !entriesToAbsorb.has(e.id || e.name));
    return { entries: finalEntries, auditLog };
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
        top[k] = list.sort((a, b) => b.importance - a.importance).slice(0, topN).map(e => {
            const { cleanName, tag, isResolvedToken } = parseResolvedNameToken(e.name);
            return (isResolvedToken && tag) ? `${cleanName} [concept: ${tag}]` : (cleanName || e.name);
        });
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

function estimateSourceTokens(source) {
    if (!source) return 0;
    if (Array.isArray(source.entries)) {
        return source.entries.reduce((a, e) => a + estimateTokens(e.content), 0);
    }
    if (source.text || source.rawText) return estimateTokens(source.text || source.rawText);
    if (source.card) {
        return estimateTokens([source.card.description, source.card.personality, source.card.scenario].filter(Boolean).join('\n\n'));
    }
    return 0;
}

export function getStagedTokenTotal() {
    let total = 0;
    for (const { source } of _sources.values()) {
        total += estimateSourceTokens(source);
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
 * Stage a source with zero LLM latency (pure parsing & chunking).
 * @param {object} source { name, type, entries?, text?, card? }
 * @returns {{ bucket: 'big'|'middle'|'vibe', totalTokens: number, sources: Array }}
 */
export function stageRawCanonSource(source) {
    if (source?.name) {
        const chunks = chunkLoreSource(source);
        _sources.set(source.name, { source, chunks, labeled: null });
    }
    const totalTokens = getStagedTokenTotal();
    const bucket = detectCanonBucket(totalTokens);
    return {
        bucket,
        totalTokens,
        sources: getStagedSourcesSummary(),
    };
}

/**
 * Returns a summary of staged sources (name, type, tokens, chunkCount, up to 12 headings).
 * @returns {Array<{ name: string, type: string, tokens: number, chunkCount: number, headings: string[] }>}
 */
export function getStagedSourcesSummary() {
    const list = [];
    for (const [name, rec] of _sources.entries()) {
        if (name === '__synthesized_canon__' || name === '__manual_canon__') continue;
        const source = rec.source || { name };
        const chunks = rec.chunks || chunkLoreSource(source);
        if (!rec.chunks) rec.chunks = chunks;
        const headings = chunks.map(c => c.title).filter(Boolean).slice(0, 12);
        const tokens = estimateSourceTokens(source) || chunks.reduce((acc, c) => acc + estimateTokens(c.text), 0);
        list.push({
            name: source.name || name,
            type: source.type || 'doc',
            tokens,
            chunkCount: chunks.length,
            headings,
        });
    }
    return list;
}

/**
 * Builds a compact prompt block [ATTACHED_SOURCES_OUTLINE] summarizing the staged sources.
 * @param {number} [maxTokens=1200]
 * @returns {string}
 */
export function extractSourcesStructuralOutline(maxTokens = 1200) {
    const summary = getStagedSourcesSummary();
    if (!summary.length) return '';

    const totalTokens = getStagedTokenTotal();
    const bucket = detectCanonBucket(totalTokens);

    const parts = [
        `[ATTACHED_SOURCES_OUTLINE]`,
        `Detected Bucket: ${bucket} (Total Tokens: ~${totalTokens})`,
    ];

    if (bucket === 'big') {
        for (const s of summary) {
            const rec = _sources.get(s.name);
            const chunks = rec?.chunks || chunkLoreSource(rec?.source);
            const titles = chunks.map(c => c.title).slice(0, 25);
            parts.push(`- Source "${s.name}" (${s.type}, ~${s.tokens} tokens, ${s.chunkCount} chunks):`);
            if (titles.length) {
                parts.push(`  Headings / Entries: ${titles.join(', ')}`);
            }
        }
    } else if (bucket === 'middle') {
        let budgetLeft = maxTokens - estimateTokens(parts.join('\n'));
        for (const s of summary) {
            const rec = _sources.get(s.name);
            const chunks = rec?.chunks || chunkLoreSource(rec?.source);
            const titles = chunks.map(c => c.title).slice(0, 25);
            parts.push(`- Source "${s.name}" (${s.type}, ~${s.tokens} tokens):`);
            if (titles.length) {
                parts.push(`  Headings: ${titles.join(', ')}`);
            }
            parts.push(`  Passages:`);
            for (const c of chunks) {
                const chunkStr = `### ${c.title}\n${c.text}\n`;
                const cost = estimateTokens(chunkStr);
                if (budgetLeft - cost < 50) {
                    parts.push(`[...truncated remaining passages due to token budget...]`);
                    budgetLeft = 0;
                    break;
                }
                parts.push(chunkStr.trim());
                budgetLeft -= cost;
            }
            if (budgetLeft <= 0) break;
        }
    } else {
        for (const s of summary) {
            const rec = _sources.get(s.name);
            const chunks = rec?.chunks || chunkLoreSource(rec?.source);
            parts.push(`- Source "${s.name}" (${s.type}, ~${s.tokens} tokens):`);
            for (const c of chunks) {
                parts.push(`### ${c.title}\n${c.text}`);
            }
        }
    }

    parts.push(`[/ATTACHED_SOURCES_OUTLINE]`);
    return parts.join('\n');
}

/**
 * Replaces _sources with a single '__manual_canon__' record.
 * @param {Array} entries
 */
export function setStagedCanonEntries(entries) {
    _sources = new Map();
    _sources.set('__manual_canon__', {
        source: { name: '__manual_canon__', type: 'doc' },
        chunks: [],
        labeled: Array.isArray(entries) ? [...entries] : [],
    });
}

/**
 * Finds matching entry in _sources labeled arrays by comment, id, or name (case-insensitive)
 * and toggles entry.disabled.
 * @param {string} commentOrName
 * @param {boolean} disabled
 * @returns {object|null}
 */
export function toggleCanonEntryDisabled(commentOrName, disabled) {
    const target = String(commentOrName || '').trim().toLowerCase();
    if (!target) return null;
    for (const rec of _sources.values()) {
        if (!Array.isArray(rec.labeled)) continue;
        for (const entry of rec.labeled) {
            const comment = String(entry.comment || '').trim().toLowerCase();
            const id = String(entry.id || '').trim().toLowerCase();
            const name = String(entry.name || '').trim().toLowerCase();
            if (comment === target || id === target || name === target) {
                entry.disabled = Boolean(disabled);
                return entry;
            }
        }
    }
    return null;
}

/**
 * Upserts a Canon entry into _sources (matching by comment or kind + name).
 * @param {object} rawEntry
 * @returns {object|null}
 */
export function upsertCanonEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    const kind = String(rawEntry.kind || 'LORE').toUpperCase();
    const name = String(rawEntry.name || rawEntry.title || 'Untitled').trim();
    const comment = String(rawEntry.comment || `[${kind}] ${name}`).trim();
    const formatted = {
        id: rawEntry.id || `${kind}:${name}`,
        name,
        comment,
        keys: Array.isArray(rawEntry.keys) ? rawEntry.keys : [name],
        content: String(rawEntry.content || rawEntry.text || ''),
        kind,
        importance: rawEntry.importance !== undefined ? Number(rawEntry.importance) : 3,
        disabled: Boolean(rawEntry.disabled),
    };

    const targetComment = comment.toLowerCase();
    const targetKindName = `[${kind}] ${name}`.toLowerCase();

    for (const rec of _sources.values()) {
        if (!Array.isArray(rec.labeled)) continue;
        for (let i = 0; i < rec.labeled.length; i++) {
            const e = rec.labeled[i];
            const eComment = String(e.comment || '').trim().toLowerCase();
            const eKindName = `[${e.kind || ''}] ${e.name || ''}`.trim().toLowerCase();
            if (eComment === targetComment || eKindName === targetKindName) {
                rec.labeled[i] = { ...e, ...formatted };
                return rec.labeled[i];
            }
        }
    }

    let targetRec = _sources.get('__manual_canon__');
    if (!targetRec) {
        if (!_sources.size) {
            targetRec = { source: { name: '__manual_canon__', type: 'doc' }, chunks: [], labeled: [] };
            _sources.set('__manual_canon__', targetRec);
        } else {
            targetRec = _sources.values().next().value;
            if (!Array.isArray(targetRec.labeled)) targetRec.labeled = [];
        }
    }
    targetRec.labeled.push(formatted);
    return formatted;
}

/**
 * Removes matching entry from _sources labeled arrays.
 * @param {string} commentOrName
 * @returns {boolean}
 */
export function removeCanonEntry(commentOrName) {
    const target = String(commentOrName || '').trim().toLowerCase();
    if (!target) return false;
    let removed = false;
    for (const rec of _sources.values()) {
        if (!Array.isArray(rec.labeled)) continue;
        const initialLen = rec.labeled.length;
        rec.labeled = rec.labeled.filter(entry => {
            const comment = String(entry.comment || '').trim().toLowerCase();
            const id = String(entry.id || '').trim().toLowerCase();
            const name = String(entry.name || '').trim().toLowerCase();
            return !(comment === target || id === target || name === target);
        });
        if (rec.labeled.length < initialLen) removed = true;
    }
    return removed;
}

/**
 * Tolerantly parses synthesized Canon entries from LLM response.
 * @param {string} reply
 * @returns {Array<object>}
 */
export function parseSynthesizedCanonEntries(reply) {
    let s = String(reply || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    let arr;
    try { arr = JSON.parse(s.slice(start, end + 1)); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];

    const out = [];
    let idx = 0;
    for (const r of arr) {
        if (!r || typeof r !== 'object') continue;
        const name = String(r.name || r.title || '').trim();
        if (!name) continue;
        const rawKind = String(r.kind || '').toUpperCase();
        const kind = CANON_KINDS.includes(rawKind) ? rawKind : 'LORE';
        const disabled = Boolean(r.disabled || r.outOfScope || Number(r.importance) === 0);
        const importance = disabled ? 1 : Math.min(5, Math.max(1, Math.round(Number(r.importance)) || 3));
        const aliases = Array.isArray(r.aliases) ? r.aliases.map(a => String(a).trim()).filter(Boolean).slice(0, 8) : [];
        const content = String(r.content || r.text || '').trim();
        const chunk = {
            id: r.id !== undefined ? String(r.id) : `synth#${idx++}`,
            title: name,
            text: content,
            keys: aliases,
        };
        const label = {
            id: chunk.id,
            kind,
            name,
            aliases,
            importance,
            disabled,
        };
        out.push(buildCanonEntry({ chunk, label }));
    }
    return out;
}

/**
 * Universal 3-Bucket Canon Builder from campaign framing.
 * @param {object} [framingBrief]
 * @param {object} [opts]
 * @returns {Promise<{ bucket: 'big'|'middle'|'vibe', entries: Array }>}
 */
export async function buildCanonFromFraming(framingBrief = {}, opts = {}) {
    const { send = null, onStatus = () => {}, signal = null, timeoutMs = CLASSIFY_TIMEOUT_MS } = opts;
    if (typeof send !== 'function') {
        throw new Error('Canon generation requires an active LLM connection.');
    }

    const totalTokens = getStagedTokenTotal();
    const bucket = detectCanonBucket(totalTokens);
    const allNameRagResolutions = [];

    if (bucket === 'big') {
        const chunkSourceMap = new Map();
        const allChunks = [];
        for (const [name, rec] of _sources.entries()) {
            if (name === '__synthesized_canon__' || name === '__manual_canon__') continue;
            const chunks = rec.chunks || chunkLoreSource(rec.source);
            rec.chunks = chunks;
            for (const c of chunks) {
                chunkSourceMap.set(c.id, name);
                allChunks.push(c);
            }
        }
        if (allChunks.length) {
            const labeledPairs = await classifyChunks(allChunks, { send, onStatus, signal, timeoutMs, framingBrief });
            const bySource = new Map();
            for (const pair of labeledPairs) {
                const srcName = chunkSourceMap.get(pair.chunk.id) || pair.chunk.source || '';
                if (!bySource.has(srcName)) bySource.set(srcName, []);
                bySource.get(srcName).push(buildCanonEntry(pair));
            }
            for (const [name, rec] of _sources.entries()) {
                if (bySource.has(name)) {
                    rec.labeled = bySource.get(name);
                } else if (name !== '__synthesized_canon__' && name !== '__manual_canon__') {
                    rec.labeled = [];
                }
            }
        }

        if (opts.synthesizeBridge !== false && framingBrief.focalLens?.trim()) {
            try {
                onStatus('Synthesizing focal bridge Canon entries…');
                const bridgeSystem = `You are a tabletop RPG lore archivist. The user provided imported campaign lore notes, but needs 2-4 focal bridge Canon entries connecting the broad lore to the campaign focal lens: "${framingBrief.focalLens.trim()}". Return ONLY a JSON array of 2-4 entries: [{"kind":"FACTION|LOCATION|NPC|RULE|EVENT|LORE","name":"...","aliases":["..."],"importance":4,"content":"2-4 sentences of specific local canon connecting to the focal lens"}]\n\nIMPORTANT FOR NAMES: For named NPCs, characters, or faction leaders, emit "name" as a targeted placeholder: "name": "[[NAME: evocative role or concept]]" (e.g. "[[NAME: grizzled wasteland doctor]]", "[[NAME: nomadic raider matriarch]]"). Do NOT invent generic trope names; NameRAG will inject targeted authentic names.`;
                const bridgeUser = `Campaign Title: ${framingBrief.title || 'Untitled'}\nPremise: ${framingBrief.premise || ''}\nFocal Lens: ${framingBrief.focalLens}\nTone: ${framingBrief.tone || ''}\n\nSynthesize 2 to 4 bridge entries that anchor this focal lens to the campaign setting.`;
                let bridgeReply = await withTimeout(send([{ role: 'system', content: bridgeSystem }, { role: 'user', content: bridgeUser }], signal), timeoutMs, signal);
                try {
                    const res = await resolveDossierNamePlaceholders(bridgeReply, { meta: framingBrief }, { returnDetails: true });
                    bridgeReply = res.text;
                    if (res.resolutions?.length) allNameRagResolutions.push(...res.resolutions);
                } catch (nameErr) {
                    console.warn('[concierge-canon] NameRAG resolution error in bridge synthesis:', nameErr);
                }
                const bridgeEntries = parseSynthesizedCanonEntries(bridgeReply);
                if (bridgeEntries.length) {
                    let synthRec = _sources.get('__synthesized_canon__');
                    if (!synthRec) {
                        synthRec = { source: { name: '__synthesized_canon__', type: 'doc' }, chunks: [], labeled: [] };
                        _sources.set('__synthesized_canon__', synthRec);
                    }
                    synthRec.labeled.push(...bridgeEntries);
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('[concierge-canon] Bridge synthesis skipped or failed:', err);
            }
        }
    } else if (bucket === 'middle') {
        const chunkSourceMap = new Map();
        const allChunks = [];
        for (const [name, rec] of _sources.entries()) {
            if (name === '__synthesized_canon__' || name === '__manual_canon__') continue;
            const chunks = rec.chunks || chunkLoreSource(rec.source);
            rec.chunks = chunks;
            for (const c of chunks) {
                chunkSourceMap.set(c.id, name);
                allChunks.push(c);
            }
        }
        if (allChunks.length) {
            const labeledPairs = await classifyChunks(allChunks, { send, onStatus, signal, timeoutMs, framingBrief });
            const bySource = new Map();
            for (const pair of labeledPairs) {
                const srcName = chunkSourceMap.get(pair.chunk.id) || pair.chunk.source || '';
                if (!bySource.has(srcName)) bySource.set(srcName, []);
                bySource.get(srcName).push(buildCanonEntry(pair));
            }
            for (const [name, rec] of _sources.entries()) {
                if (bySource.has(name)) {
                    rec.labeled = bySource.get(name);
                } else if (name !== '__synthesized_canon__' && name !== '__manual_canon__') {
                    rec.labeled = [];
                }
            }
        }

        onStatus('Expanding background canon from framing Q&A…');
        const systemPrompt = `You expand tabletop RPG campaign lore. Given the user's framing notes and imported notes, generate 5-8 expanded background Canon entries that fill in the missing world context around the imported notes and campaign framing. Reply with ONLY a JSON array: [{"kind":"FACTION|LOCATION|NPC|RULE|EVENT|LORE","name":"...","aliases":["..."],"importance":4,"content":"2-4 sentences of rich campaign canon"}]\n\nIMPORTANT FOR NAMES: For named NPCs, characters, or faction leaders, emit "name" as a targeted placeholder: "name": "[[NAME: evocative role or concept]]" (e.g. "[[NAME: grizzled wasteland doctor]]", "[[NAME: nomadic raider matriarch]]"). Do NOT invent generic trope names; NameRAG will inject targeted authentic names.`;
        const userContent = `Campaign Title: ${framingBrief.title || 'Untitled'}\nPremise: ${framingBrief.premise || ''}\nFocal Lens: ${framingBrief.focalLens || ''}\nTone: ${framingBrief.tone || ''}\nPillars: ${Array.isArray(framingBrief.pillars) ? framingBrief.pillars.join(', ') : (framingBrief.pillars || '')}\n\nImported Notes Summary:\n${extractSourcesStructuralOutline(800)}`;
        let reply = await withTimeout(send([{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], signal), timeoutMs, signal);
        try {
            const res = await resolveDossierNamePlaceholders(reply, { meta: framingBrief }, { returnDetails: true });
            reply = res.text;
            if (res.resolutions?.length) allNameRagResolutions.push(...res.resolutions);
        } catch (nameErr) {
            console.warn('[concierge-canon] NameRAG resolution error in middle expansion:', nameErr);
        }
        const synthEntries = parseSynthesizedCanonEntries(reply);
        _sources.set('__synthesized_canon__', {
            source: { name: '__synthesized_canon__', type: 'doc' },
            chunks: [],
            labeled: synthEntries,
        });
    } else {
        onStatus('Synthesizing foundational Canon Sketch…');
        const systemPrompt = `You are a tabletop RPG world builder. Based on the campaign framing, generate 8-12 foundational Canon Sketch entries covering factions, locations, notable NPCs, world rules, historical events, and general lore. Reply with ONLY a JSON array: [{"kind":"FACTION|LOCATION|NPC|RULE|EVENT|LORE","name":"...","aliases":["..."],"importance":4,"content":"2-4 sentences of rich campaign canon"}]\n\nIMPORTANT FOR NAMES: For named NPCs, characters, or faction leaders, emit "name" as a targeted placeholder: "name": "[[NAME: evocative role or concept]]" (e.g. "[[NAME: grizzled wasteland doctor]]", "[[NAME: nomadic raider matriarch]]"). Do NOT invent generic trope names; NameRAG will inject targeted authentic names.`;
        const userContent = `Campaign Title: ${framingBrief.title || 'Untitled'}\nPremise: ${framingBrief.premise || ''}\nFocal Lens: ${framingBrief.focalLens || ''}\nTone: ${framingBrief.tone || ''}\nPillars: ${Array.isArray(framingBrief.pillars) ? framingBrief.pillars.join(', ') : (framingBrief.pillars || '')}`;
        let reply = await withTimeout(send([{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], signal), timeoutMs, signal);
        try {
            const res = await resolveDossierNamePlaceholders(reply, { meta: framingBrief }, { returnDetails: true });
            reply = res.text;
            if (res.resolutions?.length) allNameRagResolutions.push(...res.resolutions);
        } catch (nameErr) {
            console.warn('[concierge-canon] NameRAG resolution error in foundational sketch:', nameErr);
        }
        const synthEntries = parseSynthesizedCanonEntries(reply);
        if (!synthEntries.length) {
            throw new Error('Canon synthesis returned invalid or empty JSON.');
        }
        _sources.set('__synthesized_canon__', {
            source: { name: '__synthesized_canon__', type: 'doc' },
            chunks: [],
            labeled: synthEntries,
        });
    }

    // Deduplication & Entity Consolidation pass
    const rawStaged = getStagedCanonEntries();
    const candidatePairs = detectDuplicateCandidates(rawStaged);
    let dedupAuditLog = [];

    if (candidatePairs.length > 0) {
        onStatus(`Analyzing ${candidatePairs.length} potential duplicate entity candidate(s)…`);
        const arbitrated = await arbitrateDuplicateCandidates(candidatePairs, rawStaged, { send, signal, timeoutMs });
        dedupAuditLog = arbitrated.auditLog;
    }

    const finalEntries = getStagedCanonEntries();
    const totalChunkCount = [..._sources.values()].reduce((acc, r) => acc + (r.chunks?.length || 0), 0);

    // Record formal Step 2 transaction for Debug Inspector
    if (typeof window !== 'undefined') {
        const linkedCount = dedupAuditLog.filter(d => d.action === 'link' || d.action === 'autoLink').length;
        const canonTxRecord = {
            id: 'tx_canon_' + Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            stage: 'canon',
            finalStatus: 'CANON_INGEST',
            builderSummary: `Series Bible generated: ${finalEntries.length} entries (${bucket.toUpperCase()} mode). Chunks: ${totalChunkCount}, Deduplicated/Linked: ${linkedCount}, NameRAG: ${allNameRagResolutions.length}`,
            promptInput: `Step 2 Series Bible Ingest: "${framingBrief.title || 'Untitled'}" [${bucket.toUpperCase()} MODE]`,
            summary: `Series Bible generated: ${finalEntries.length} entries (${bucket.toUpperCase()} mode).`,
            attempts: [{
                attempt: 1,
                rawResponse: JSON.stringify(finalEntries, null, 2),
                mode: bucket,
                totalChunks: totalChunkCount,
                labeledEntries: finalEntries.length,
                deduplication: dedupAuditLog,
                nameRagResolutions: allNameRagResolutions,
                errors: [],
                report: {
                    changes: [
                        `Ingested ${finalEntries.length} entries via ${bucket.toUpperCase()} mode.`,
                        ...(dedupAuditLog.map(d => d.action === 'separate' ? `Kept separate: ${d.nameA} & ${d.nameB}` : `Linked: ${d.canonical} ← ${d.absorbed} (${d.reason})`)),
                    ],
                    errors: [],
                    hasMutations: true,
                },
            }],
            hasMutations: true,
            updatedDossier: opts.activeDossier || framingBrief,
            rawOutput: JSON.stringify(finalEntries, null, 2),
            nameRagResolutions: allNameRagResolutions,
        };
        window._mhcLastBuilderTransaction = canonTxRecord;
    }

    return { bucket, entries: finalEntries, dedupAuditLog, nameRagResolutions: allNameRagResolutions };
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
    const chunks = chunkLoreSource(source);
    _sources.set(source.name, { source, chunks, labeled: null });
    const mode = getCurrentMode();
    if (mode === 'archivist') {
        try {
            for (const rec of _sources.values()) {
                if (rec.labeled) continue;
                const recChunks = rec.chunks || chunkLoreSource(rec.source);
                rec.chunks = recChunks;
                const labeled = await classifyChunks(recChunks, opts);
                rec.labeled = labeled.map(buildCanonEntry);
            }
        } catch (err) {
            _sources.delete(source.name);
            throw err;
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

    let nextUid = Math.max(-1, ...Object.keys(bookData.entries).map(Number).filter(n => !isNaN(n))) + 1;
    let written = 0;
    let skipped = 0;

    for (const e of entries) {
        const eComment = String(e.comment || '').toLowerCase();
        const existingEntry = Object.values(bookData.entries).find(be => String(be.comment || '').toLowerCase() === eComment);

        if (existingEntry) {
            const shouldDisable = Boolean(e.disabled);
            if (Boolean(existingEntry.disable) !== shouldDisable) {
                existingEntry.disable = shouldDisable;
                written++;
            } else {
                skipped++;
            }
            continue;
        }

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
            disable: Boolean(e.disabled),
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
    const parts = slice.map(e => {
        const { cleanName, tag, isResolvedToken } = parseResolvedNameToken(e.name);
        const displayName = (isResolvedToken && tag) ? `${cleanName} [concept: ${tag}]` : (cleanName || e.name);
        return `### [${e.kind}] ${displayName}\n${e.content}`;
    });
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

// ── Deterministic Snapshot, Diff & Agnostic Extraction Helpers ──────────────

/**
 * Snapshots framing metadata from a campaign dossier.
 * @param {object} dossier
 * @returns {{ title: string, premise: string, focalLens: string, tone: string }}
 */
export function snapshotFraming(dossier) {
    return {
        title: dossier?.meta?.title || '',
        premise: dossier?.meta?.premise || '',
        focalLens: dossier?.meta?.focalLens || '',
        tone: dossier?.meta?.tone || '',
    };
}

/**
 * Computes difference between two framing snapshots.
 * @param {object} oldSnap
 * @param {object} newSnap
 * @returns {{ hasChanges: boolean, lines: string[], block: string }}
 */
export function computeFramingDiff(oldSnap, newSnap) {
    const lines = [];
    const fields = [
        ['Title', oldSnap?.title || '', newSnap?.title || ''],
        ['Premise', oldSnap?.premise || '', newSnap?.premise || ''],
        ['Focal Lens', oldSnap?.focalLens || '', newSnap?.focalLens || ''],
        ['Tone', oldSnap?.tone || '', newSnap?.tone || ''],
    ];

    for (const [label, oldVal, newVal] of fields) {
        if (oldVal !== newVal) {
            lines.push(`${label}: "${oldVal}" -> "${newVal}"`);
        }
    }

    const hasChanges = lines.length > 0;
    const block = hasChanges ? `[UPSTREAM_FRAMING_DIFF]\n${lines.join('\n')}\n[/UPSTREAM_FRAMING_DIFF]` : '';
    return { hasChanges, lines, block };
}

/**
 * Snapshots canon entries and world rules axioms.
 * @param {Array} [entries]
 * @param {object|null} [worldRules]
 * @returns {Array<object>}
 */
export function snapshotCanon(entries = getStagedCanonEntries(), worldRules = null) {
    const list = (entries || []).map(e => ({
        comment: e.comment || `[${e.kind || 'LORE'}] ${e.name || 'Untitled'}`,
        name: e.name || '',
        kind: e.kind || 'LORE',
        content: e.content || '',
        disabled: Boolean(e.disabled),
    }));
    const axioms = (worldRules?.axioms || []).map(a => ({
        title: a.title || '',
        playerText: a.playerText || '',
    }));
    list.axioms = axioms;
    list.entries = list;
    return list;
}

/**
 * Computes difference between two canon snapshots.
 * @param {Array|object} oldSnap
 * @param {Array|object} newSnap
 * @returns {{ hasChanges: boolean, added: string[], modified: string[], disabled: string[], enabled: string[], removed: string[], axiomsChanged: string[], block: string }}
 */
export function computeCanonDiff(oldSnap, newSnap) {
    const oldEntries = Array.isArray(oldSnap) ? oldSnap : (oldSnap?.entries || []);
    const newEntries = Array.isArray(newSnap) ? newSnap : (newSnap?.entries || []);
    const oldAxioms = oldSnap?.axioms || [];
    const newAxioms = newSnap?.axioms || [];

    const added = [];
    const modified = [];
    const disabled = [];
    const enabled = [];
    const removed = [];
    const axiomsChanged = [];

    const oldMap = new Map();
    for (const e of oldEntries) {
        const key = (e.comment || e.name || '').trim().toLowerCase();
        if (key) oldMap.set(key, e);
    }

    const newMap = new Map();
    for (const e of newEntries) {
        const key = (e.comment || e.name || '').trim().toLowerCase();
        if (key) newMap.set(key, e);
    }

    for (const [key, newE] of newMap.entries()) {
        const label = newE.comment || newE.name || key;
        if (!oldMap.has(key)) {
            added.push(label);
        } else {
            const oldE = oldMap.get(key);
            if (!oldE.disabled && newE.disabled) {
                disabled.push(label);
            } else if (oldE.disabled && !newE.disabled) {
                enabled.push(label);
            }
            if (oldE.content !== newE.content || oldE.name !== newE.name || oldE.kind !== newE.kind) {
                modified.push(label);
            }
        }
    }

    for (const [key, oldE] of oldMap.entries()) {
        if (!newMap.has(key)) {
            removed.push(oldE.comment || oldE.name || key);
        }
    }

    const oldAxMap = new Map((oldAxioms || []).map(a => [(a.title || '').trim().toLowerCase(), a]));
    const newAxMap = new Map((newAxioms || []).map(a => [(a.title || '').trim().toLowerCase(), a]));

    for (const [titleKey, newA] of newAxMap.entries()) {
        if (!oldAxMap.has(titleKey)) {
            axiomsChanged.push(`Added axiom: "${newA.title}"`);
        } else {
            const oldA = oldAxMap.get(titleKey);
            if ((oldA.playerText || '') !== (newA.playerText || '')) {
                axiomsChanged.push(`Modified axiom: "${newA.title}"`);
            }
        }
    }
    for (const [titleKey, oldA] of oldAxMap.entries()) {
        if (!newAxMap.has(titleKey)) {
            axiomsChanged.push(`Removed axiom: "${oldA.title}"`);
        }
    }

    const hasChanges = Boolean(
        added.length || modified.length || disabled.length || enabled.length || removed.length || axiomsChanged.length
    );

    let block = '';
    if (hasChanges) {
        const lines = [];
        if (added.length) lines.push(`Added: ${added.join(', ')}`);
        if (removed.length) lines.push(`Removed: ${removed.join(', ')}`);
        if (disabled.length) lines.push(`Disabled: ${disabled.join(', ')}`);
        if (enabled.length) lines.push(`Enabled: ${enabled.join(', ')}`);
        if (modified.length) lines.push(`Modified: ${modified.join(', ')}`);
        if (axiomsChanged.length) {
            lines.push(`Axioms Changed:`);
            axiomsChanged.forEach(a => lines.push(`* ${a}`));
        }
        block = `[UPSTREAM_CANON_DIFF]\n${lines.join('\n')}\n[/UPSTREAM_CANON_DIFF]`;
    }

    return { hasChanges, added, modified, disabled, enabled, removed, axiomsChanged, block };
}

/**
 * Snapshots ruleset and adventure fields from a campaign dossier.
 * @param {object} dossier
 * @returns {object}
 */
export function snapshotAdventure(dossier) {
    return {
        ruleset: dossier?.meta?.ruleset || '',
        kick: dossier?.theKick || {},
        maps: (dossier?.maps || []).map(m => ({ site: m.site || m.name || '', briefDescription: m.briefDescription || m.prompt || '' })),
        monsters: (dossier?.monsters || []).map(m => ({ name: m.name || '', description: m.description || m.instinct || '' })),
        npcs: (dossier?.npcs || []).map(n => ({ name: n.name || '', role: n.role || '', description: n.description || '' })),
    };
}

/**
 * Computes difference between two adventure snapshots.
 * @param {object} oldSnap
 * @param {object} newSnap
 * @returns {{ hasChanges: boolean, lines: string[], block: string }}
 */
export function computeAdventureDiff(oldSnap, newSnap) {
    const lines = [];

    if ((oldSnap?.ruleset || '') !== (newSnap?.ruleset || '')) {
        lines.push(`Ruleset changed: "${oldSnap?.ruleset || ''}" -> "${newSnap?.ruleset || ''}"`);
    }

    const oldKick = oldSnap?.kick || {};
    const newKick = newSnap?.kick || {};
    if ((oldKick.startingLocation || '') !== (newKick.startingLocation || '')) {
        lines.push(`Starting Location: "${oldKick.startingLocation || ''}" -> "${newKick.startingLocation || ''}"`);
    }
    if ((oldKick.crisis || '') !== (newKick.crisis || '')) {
        lines.push(`Crisis: "${oldKick.crisis || ''}" -> "${newKick.crisis || ''}"`);
    }
    if ((oldKick.openingPrompt || '') !== (newKick.openingPrompt || '')) {
        lines.push(`Opening Prompt changed`);
    }

    const oldMaps = (oldSnap?.maps || []).map(m => m.site || '');
    const newMaps = (newSnap?.maps || []).map(m => m.site || '');
    const addedMaps = newMaps.filter(m => m && !oldMaps.includes(m));
    const removedMaps = oldMaps.filter(m => m && !newMaps.includes(m));
    if (addedMaps.length) lines.push(`Added Maps: ${addedMaps.join(', ')}`);
    if (removedMaps.length) lines.push(`Removed Maps: ${removedMaps.join(', ')}`);

    const oldMonsters = (oldSnap?.monsters || []).map(m => m.name || '');
    const newMonsters = (newSnap?.monsters || []).map(m => m.name || '');
    const addedMonsters = newMonsters.filter(m => m && !oldMonsters.includes(m));
    const removedMonsters = oldMonsters.filter(m => m && !newMonsters.includes(m));
    if (addedMonsters.length) lines.push(`Added Monsters: ${addedMonsters.join(', ')}`);
    if (removedMonsters.length) lines.push(`Removed Monsters: ${removedMonsters.join(', ')}`);

    const oldNpcs = (oldSnap?.npcs || []).map(n => n.name || '');
    const newNpcs = (newSnap?.npcs || []).map(n => n.name || '');
    const addedNpcs = newNpcs.filter(n => n && !oldNpcs.includes(n));
    const removedNpcs = oldNpcs.filter(n => n && !newNpcs.includes(n));
    if (addedNpcs.length) lines.push(`Added NPCs: ${addedNpcs.join(', ')}`);
    if (removedNpcs.length) lines.push(`Removed NPCs: ${removedNpcs.join(', ')}`);

    const hasChanges = lines.length > 0;
    const block = hasChanges ? `[UPSTREAM_ADVENTURE_DIFF]\n${lines.join('\n')}\n[/UPSTREAM_ADVENTURE_DIFF]` : '';
    return { hasChanges, lines, block };
}

/**
 * Extracts ruleset-agnostic bones from a dossier when switching rulesets.
 * @param {object} dossier
 * @returns {object}
 */
export function extractAgnosticAdventureBones(dossier) {
    const meta = dossier?.meta || {};
    const cfg = dossier?.config || {};
    const kick = dossier?.theKick || {};

    return {
        title: meta.title || dossier?.title || '',
        premise: meta.premise || dossier?.premise || '',
        focalLens: meta.focalLens || dossier?.focalLens || '',
        tone: meta.tone || dossier?.tone || '',
        agnosticConfig: {
            playstyle: cfg.playstyle !== undefined ? cfg.playstyle : 'story',
            partyMode: cfg.partyMode !== undefined ? cfg.partyMode : 'squad',
            cyoaEmojis: cfg.cyoaEmojis !== undefined ? cfg.cyoaEmojis : true,
            simulationDepth: cfg.simulationDepth !== undefined ? cfg.simulationDepth : 'active_fronts',
            relationships: cfg.relationships !== undefined ? cfg.relationships : true,
            artStyle: cfg.artStyle !== undefined ? cfg.artStyle : 'fantasy',
        },
        theKick: {
            startingLocation: kick.startingLocation || '',
            crisis: kick.crisis || '',
            openingPrompt: kick.openingPrompt || '',
        },
        maps: (dossier?.maps || []).map(m => ({
            site: m.site || m.name || '',
            kind: m.kind || 'INTERIOR',
            threat: m.threat || 'MODERATE',
            briefDescription: m.briefDescription || m.prompt || m.description || '',
            entrance: m.entrance || '',
        })),
        npcs: (dossier?.npcs || []).map(n => ({
            name: n.name || '',
            role: n.role || '',
            description: n.description || '',
            personality: n.personality || '',
        })),
        monsters: (dossier?.monsters || []).map(m => ({
            name: m.name || '',
            concept: m.description || m.instinct || m.species || '',
        })),
    };
}
