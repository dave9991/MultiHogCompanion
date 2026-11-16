/**
 * concierge-block-lexer.js — MultiHog Companion
 *
 * Low-level block, tag, key-value, stat, and bullet-list lexers for Concierge
 * state/dossier directive blocks ([UPDATE_DOSSIER], [CONCIERGE_STATE], etc.).
 */

import { stripThinkingContent } from './concierge-connection.js';

export const NEXT_DOSSIER_BLOCK_LOOKAHEAD = String.raw`(?=\n[ \t]*\[(?:\/?(?:UPDATE_DOSSIER|CONCIERGE_STATE|CONTEMPLATION|FRAMING|CANON_UPDATE|CANON_ENTRY|CONFIG|CYOA|PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|WORLD_RULES?|CUSTOM_MODULE|GAME_SYSTEM|REMOVE_CANON|DISABLE_CANON|ENABLE_CANON))(?::[^\n\]]+)?\][ \t]*(?:\r?\n|$))`;

/**
 * Strips quotes, backticks, and markdown wrapping from entity names.
 * @param {string} rawName
 * @returns {string}
 */
export function cleanTargetName(rawName) {
    if (!rawName) return '';
    let clean = rawName.trim();
    let prev;
    do {
        prev = clean;
        clean = clean
            .replace(/^(\*\*|__)(.*?)\1$/, '$2')
            .replace(/^["'“”‘’`]+(.*?)["'“”‘’`]+$/, '$1')
            .trim();
    } while (clean !== prev);
    return clean;
}

/**
 * Strips [UPDATE_DOSSIER] and [CONCIERGE_STATE] blocks (and standalone tags) out of text for display.
 * @param {string} text
 * @returns {string}
 */
export function stripConciergeStateBlocks(text) {
    if (!text) return '';
    const withoutThoughts = stripThinkingContent(text);
    return withoutThoughts
        .replace(/\[UPDATE_DOSSIER\][\s\S]*?(?:\[\/UPDATE_DOSSIER\]|$)/gi, '')
        .replace(/\[CONCIERGE_STATE\][\s\S]*?(?:\[\/CONCIERGE_STATE\]|$)/gi, '')
        .replace(/\[CONTEMPLATION\][\s\S]*?(?:\[\/CONTEMPLATION\]|$)/gi, '')
        .replace(/\[FRAMING\][\s\S]*?(?:\[\/FRAMING\]|$)/gi, '')
        .replace(/\[CANON_(?:ENTRY|UPDATE)(?::[^\n\]]+)?\][\s\S]*?(?:\[\/CANON_(?:ENTRY|UPDATE)\]|$)/gi, '')
        .replace(/\[(?:DISABLE|ENABLE|REMOVE)_CANON:[^\n\]]+\]/gi, '')
        .replace(/\[DOSSIER_CRITIQUE\][\s\S]*?(?:\[\/DOSSIER_CRITIQUE\]|$)/gi, '')
        .replace(/\[PROTAGONIST(?::[^\n\]]+)?\][\s\S]*?(?:\[\/PROTAGONIST\]|$)/gi, '')
        .replace(/\[NPC(?::[^\n\]]+)?\][\s\S]*?(?:\[\/NPC\]|$)/gi, '')
        .replace(/\[MONSTER(?::[^\n\]]+)?\][\s\S]*?(?:\[\/MONSTER\]|$)/gi, '')
        .replace(/\[MAP(?::[^\n\]]+)?\][\s\S]*?(?:\[\/MAP\]|$)/gi, '')
        .replace(/\[FACTION(?::[^\n\]]+)?\][\s\S]*?(?:\[\/FACTION\]|$)/gi, '')
        .replace(/\[KICK\][\s\S]*?(?:\[\/KICK\]|$)/gi, '')
        .replace(/\[CYOA\][\s\S]*?(?:\[\/CYOA\]|$)/gi, '')
        .replace(/\[CONFIG\][\s\S]*?(?:\[\/CONFIG\]|$)/gi, '')
        .replace(/\[WORLD_RULES?\][\s\S]*?(?:\[\/WORLD_RULES?\]|$)/gi, '')
        .replace(/\[CUSTOM_MODULE\][\s\S]*?(?:\[\/CUSTOM_MODULE\]|$)/gi, '')
        .replace(/\[REMOVE_(?:NPC|MONSTER|MAP|FACTION|WORLD_RULE):[^\n\]]+\]/gi, '')
        .replace(/\[REMOVE_CUSTOM_MODULE\]/gi, '')
        .replace(/\[(?:CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS|CLEAR_FACTIONS|CLEAR_WORLD_RULES)\]/gi, '')
        .replace(/\[NOOP\][\s\S]*?(?:\[\/NOOP\]|$)/gi, '')
        .replace(/\[BUILDER_REPORT:[^\n\]]+\]/gi, '')
        .replace(/\[PROMOTE_CANON:[^\n\]]*\]/gi, '')
        .replace(/```(?:text|markdown)?\s*```/gi, '')
        .trim();
}

/**
 * Resilient key-value parser handling markdown bullets, bolding, and colons.
 * Matches lines like:
 *   name: Silas
 *   **Playbook:** Occult Scholar
 *   - **Role:** Ally
 * @param {string} block
 * @returns {Record<string, string>}
 */
export function parseKeyValueLines(block) {
    const res = {};
    if (!block) return res;
    const lines = block.split('\n');
    for (const line of lines) {
        // Strip leading bullets / numbering / indentation
        const clean = line.replace(/^[\s\-*+]+/, '').trim();
        // Match key: value (with optional bolding **key**:)
        const m = clean.match(/^(?:\*\*)?([a-zA-Z0-9_\-]+)(?:\*\*)?\s*:\s*(.*)$/);
        if (m) {
            let val = m[2].trim();
            // Remove wrapping bold / italic if present
            val = val.replace(/^(\*\*|__|\*|_)(.*?)\1$/, '$2').trim();
            res[m[1].toLowerCase()] = val;
        }
    }
    return res;
}

/**
 * Resilient stats string parser.
 * Handles both "Cool +2" and "+2 Cool", with colons, commas, or parentheses.
 * e.g. "Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1"
 * e.g. "+2 Cool, +1 Sharp, +1 Hard, 0 Hot, -1 Weird"
 * @param {string} line
 * @returns {Record<string, number>}
 */
export function parseStatsString(line) {
    const stats = {};
    if (!line) return stats;
    const parts = line.split(/[,|;·•\u00B7]/);
    for (const part of parts) {
        const clean = part.replace(/[*_()]/g, '').trim();
        // Pattern A: Cool +2 or Cool: +2
        let m = clean.match(/^([a-zA-Z]+)\s*:?\s*([+-]?\d+)/);
        if (m) {
            stats[m[1]] = parseInt(m[2], 10);
            continue;
        }
        // Pattern B: +2 Cool
        m = clean.match(/^([+-]?\d+)\s+([a-zA-Z]+)/);
        if (m) {
            stats[m[2]] = parseInt(m[1], 10);
            continue;
        }
    }
    return stats;
}

/**
 * Resilient list item parser (lines starting with "- ", "* ", or numbered "1. ").
 * @param {string} block
 * @param {string} sectionKey
 * @returns {string[]}
 */
export function parseBulletList(block, sectionKey) {
    if (!block) return [];
    // Match sectionKey header (with optional bolding)
    const re = new RegExp(`(?:^|\n)[\\s\\-*]*(?:\\*\\*)?${sectionKey}(?:\\*\\*)?\\s*:\\s*\\n?((?:\\s*(?:[-*+]|\\d+[.)])\\s+[^\\n]+\\n?)*)`, 'i');
    const m = block.match(re);
    if (!m || !m[1]) return [];
    return m[1]
        .split('\n')
        .map(l => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
        .filter(Boolean);
}

/**
 * Splits a string on top-level commas, semicolons, or pipes outside of parentheses/brackets.
 * @param {string} str
 * @param {{ splitCommas?: boolean }} [opts]
 * @returns {string[]}
 */
export function splitTopLevelItems(str, { splitCommas = true } = {}) {
    if (!str || typeof str !== 'string') return [];
    const res = [];
    let cur = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);

        const isSep = depth === 0 && (
            c === ';' ||
            c === '|' ||
            (splitCommas && c === ',' && !(i > 0 && i < str.length - 1 && /\d/.test(str[i - 1]) && /\d/.test(str[i + 1])))
        );
        if (isSep) {
            if (cur.trim()) res.push(cur.trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    if (cur.trim()) res.push(cur.trim());
    return res;
}

/**
 * Resilient list item parser for bullet lines or inline comma/semicolon-separated values.
 * Ignores delimiters inside parentheses like "(+2, +1, +1, 0, -1)".
 * @param {string} block
 * @param {string} sectionKey
 * @param {{ splitCommas?: boolean }} [opts]
 * @returns {string[]}
 */
export function parseBulletOrListItems(block, sectionKey, { splitCommas = true } = {}) {
    const fromBullets = parseBulletList(block, sectionKey);
    if (fromBullets.length > 0) return fromBullets;
    const kv = parseKeyValueLines(block);
    const rawVal = kv[sectionKey.toLowerCase()];
    if (rawVal) {
        const cleaned = rawVal.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
        if (!cleaned || /^(?:none|n\/a|null)$/i.test(cleaned)) return [];
        return splitTopLevelItems(cleaned, { splitCommas });
    }
    return [];
}

/**
 * Matches all occurrences of a section block (e.g., PROTAGONIST, NPC, MONSTER, MAP, FACTION, KICK, WORLD_RULES, CUSTOM_MODULE, CONFIG, CYOA).
 * Requires EITHER:
 *  - A standalone line-start opening tag `[TAG]` (stopping at `[/TAG]`, the next standalone `[BLOCK]` header, or `$`), OR
 *  - An explicit closing tag `[/TAG]`.
 * Never matches unclosed inline mentions inside conversational or chain-of-thought prose.
 *
 * @param {string} raw
 * @param {string} tagRegexStr
 * @param {string} closeTagRegexStr
 * @returns {Array<{ inlineArg: string|undefined, content: string, fullMatch: string }>}
 */
export function matchDossierSectionBlocks(raw, tagRegexStr, closeTagRegexStr) {
    if (!raw) return [];
    const results = [];
    const lineStartRe = new RegExp(
        `(?:^|\\n)[ \\t]*\\[${tagRegexStr}\\][ \\t]*(?:\\r?\\n|$)([\\s\\S]*?)(?:\\[\\/${closeTagRegexStr}\\]|${NEXT_DOSSIER_BLOCK_LOOKAHEAD}|$)`,
        'gi',
    );
    let m;
    while ((m = lineStartRe.exec(raw)) !== null) {
        const hasInlineGroup = m.length > 2;
        results.push({
            inlineArg: hasInlineGroup ? m[1] : undefined,
            content: hasInlineGroup ? m[2] : m[1],
            fullMatch: m[0],
        });
    }
    if (results.length > 0) return results;

    const closedInlineRe = new RegExp(
        `\\[${tagRegexStr}\\]([\\s\\S]*?)\\[\\/${closeTagRegexStr}\\]`,
        'gi',
    );
    while ((m = closedInlineRe.exec(raw)) !== null) {
        const hasInlineGroup = m.length > 2;
        results.push({
            inlineArg: hasInlineGroup ? m[1] : undefined,
            content: hasInlineGroup ? m[2] : m[1],
            fullMatch: m[0],
        });
    }
    return results;
}

/**
 * Narrow repair for a known LLM slip: a section closer emitted WITHOUT brackets on its own line
 * (e.g. a bare `/protagonist` instead of `[/PROTAGONIST]`). Only whole-line, known-tag closers are
 * rewritten, so prose, values like "12/12", and every other engine's blocks are untouched.
 * @param {string} text
 * @returns {string}
 */
export function normalizeMalformedDossierClosers(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(
        /^[ \t]*\/(PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|CYOA|CONFIG|CONTEMPLATION|WORLD_RULES?|CUSTOM_MODULE|GAME_SYSTEM|FRAMING|CANON_UPDATE|CANON_ENTRY|REMOVE_CANON|DISABLE_CANON|ENABLE_CANON)[ \t]*$/gim,
        (_, tag) => `[/${tag.toUpperCase()}]`,
    );
}
