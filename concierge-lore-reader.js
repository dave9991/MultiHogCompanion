/**
 * concierge-lore-reader.js — MultiHog Companion
 *
 * Hybrid Lorebook (World Info) reader and synthesizer for the PbtA Concierge.
 * - Sanitizes raw JSON lorebook entries by dropping engine plumbing.
 * - Directly feeds compact lorebooks (<= 4,000 words) into the Concierge prompt.
 * - Runs a lightweight "World Archivist" sub-agent pass for dense lorebooks (> 4,000 words)
 *   to extract a clean 400-word Setting Brief.
 */

import { sendConciergeRequest } from './concierge-connection.js';

const DIRECT_FEED_WORD_LIMIT = 4000;
const ARCHIVIST_MAX_INPUT_WORDS = 12000;

/**
 * Fetch a World Info book by name from SillyTavern's backend.
 * @param {string} bookName
 * @returns {Promise<object|null>}
 */
export async function fetchWorldInfoBook(bookName) {
    if (!bookName) return null;
    const ctx = SillyTavern.getContext();
    const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));

    try {
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: bookName }),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn(`[PbtA Concierge] Could not fetch World Info book "${bookName}":`, err);
        return null;
    }
}

/**
 * Extracts and sanitizes active entries from raw lorebook data.
 * Drops internal metadata (uid, scan_depth, selective, etc.) and keeps only canon text.
 *
 * @param {any} rawBook
 * @returns {Array<{ title: string, keys: string[], content: string, wordCount: number }>}
 */
export function sanitizeLorebookEntries(rawBook) {
    if (!rawBook || typeof rawBook !== 'object') return [];

    const rawEntries = rawBook.entries || rawBook;
    const entriesList = Array.isArray(rawEntries)
        ? rawEntries
        : (typeof rawEntries === 'object' ? Object.values(rawEntries) : []);

    const cleaned = [];

    for (const entry of entriesList) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.disable === true) continue; // Skip disabled entries

        const content = String(entry.content || '').trim();
        if (!content) continue;

        let title = String(entry.comment || '').trim();
        const keys = Array.isArray(entry.key)
            ? entry.key.map(k => String(k).trim()).filter(Boolean)
            : (typeof entry.key === 'string' ? entry.key.split(',').map(k => k.trim()).filter(Boolean) : []);

        if (!title && keys.length) {
            title = keys.slice(0, 3).join(', ');
        }
        if (!title) {
            title = 'World Entry';
        }

        const words = content.split(/\s+/).length;
        cleaned.push({ title, keys, content, wordCount: words });
    }

    return cleaned;
}

/**
 * Runs a background "World Archivist" sub-agent pass to summarize a dense lorebook.
 *
 * @param {string} bookName
 * @param {Array<{ title: string, keys: string[], content: string }>} entries
 * @param {(status: string) => void} [onStatus]
 * @returns {Promise<string>} 400-word Setting Brief
 */
export async function runWorldArchivistPass(bookName, entries, onStatus = () => {}) {
    onStatus(`Archivist synthesizing "${bookName}"...`);

    // Prepare text payload up to ARCHIVIST_MAX_INPUT_WORDS
    let totalWords = 0;
    const entryBlocks = [];

    for (const e of entries) {
        if (totalWords + e.wordCount > ARCHIVIST_MAX_INPUT_WORDS) {
            entryBlocks.push(`\n... [Remaining ${entries.length - entryBlocks.length} entries truncated to fit synthesis budget]`);
            break;
        }
        entryBlocks.push(`### [${e.title}]\n${e.content}`);
        totalWords += e.wordCount;
    }

    const archivistPrompt = `You are a Tabletop RPG World Archivist. Synthesize the following raw lorebook entries into a high-yield, structured 400-word Setting Brief for a Powered by the Apocalypse (PbtA) Session Zero.

Disregard technical trigger keywords, author tags, and game-engine plumbing. Extract the genuine narrative canon:

1. **Genre, Era, and Atmosphere:** Tone, technology/magic level, visual aesthetic.
2. **Major Factions & Authorities:** Who holds power, who opposes them, and their active conflicts.
3. **2–3 Iconic Locations:** Settlements, ruins, or hazardous regions ideal for adventure sites.
4. **Supernatural, Monstrous, or Occult Forces:** What dangerous creatures or mysterious phenomena threaten people.

Output ONLY the structured Setting Brief.`;

    const messages = [
        { role: 'system', content: archivistPrompt },
        { role: 'user', content: `Lorebook Name: "${bookName}"\n\n${entryBlocks.join('\n\n')}` },
    ];

    try {
        const brief = await sendConciergeRequest(messages);
        return brief.trim();
    } catch (err) {
        console.warn('[PbtA Concierge] World Archivist pass failed, falling back to extractive summary:', err);
        return entryBlocks.slice(0, 5).join('\n\n');
    }
}

/**
 * Main processor: takes a Lorebook (from ST library or uploaded JSON) and returns
 * the appropriate prompt block (direct context vs. synthesized brief).
 *
 * @param {string} bookName
 * @param {object} rawBook
 * @param {(status: string) => void} [onStatus]
 * @returns {Promise<{ block: string, mode: 'direct'|'synthesized', totalWords: number }>}
 */
export async function processLorebookForConcierge(bookName, rawBook, onStatus = () => {}) {
    const cleaned = sanitizeLorebookEntries(rawBook);
    if (!cleaned.length) {
        throw new Error(`Lorebook "${bookName}" contains no active text entries.`);
    }

    const totalWords = cleaned.reduce((acc, e) => acc + e.wordCount, 0);

    // 1. Compact Lorebook: Direct Feed
    if (totalWords <= DIRECT_FEED_WORD_LIMIT) {
        const textParts = cleaned.map(e => `### [${e.title}]\n${e.content}`);
        const block = `\n[INSPIRATION_LOREBOOK: ${bookName}]\n${textParts.join('\n\n')}\n[/INSPIRATION_LOREBOOK]\n`;
        return { block, mode: 'direct', totalWords };
    }

    // 2. Dense Lorebook: Sub-Agent Pass
    const brief = await runWorldArchivistPass(bookName, cleaned, onStatus);
    const block = `\n[INSPIRATION_LOREBOOK_BRIEF: ${bookName}]\n${brief}\n[/INSPIRATION_LOREBOOK_BRIEF]\n`;
    return { block, mode: 'synthesized', totalWords };
}
