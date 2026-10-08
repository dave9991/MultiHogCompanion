/**
 * persona-matching.js — MultiHog Companion
 *
 * Robust character-to-persona matching utilities for SillyTavern and MultiHog D&D Framework.
 * Handles:
 * - Quoted nicknames (e.g. John "The axe" Smith, John “The axe” Smith)
 * - Upstream MultiHog DnD persona name sanitization (which strips quotes: replace(/['"\\]/g, ''))
 * - Parenthetical titles / descriptors (e.g. Bob (The Barbarian))
 * - Base-name personas without nicknames (e.g. John Smith matching John "The axe" Smith)
 * - Leading bullet points and markdown in [CHARACTER] memos
 */

/**
 * Generates normalized lookup keys/variants for a character or persona name.
 * Handles quoted nicknames (e.g. John "The axe" Smith), smart quotes, HTML entities,
 * parenthetical descriptors, and quote stripping (as done upstream by MultiHog DnD).
 * @param {string} rawName
 * @returns {string[]}
 */
export function getNameMatchingVariants(rawName) {
    if (!rawName || typeof rawName !== 'string') return [];
    // Decode HTML entities
    let str = rawName
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .trim();
    // Normalize unicode/curly quotes to standard straight quotes
    str = str.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

    const lower = str.toLowerCase();
    // 1. Without parentheses (e.g. "Bob (the Barbarian)" -> "Bob")
    const noParens = lower.replace(/\s*\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    // 2. Without quote characters (e.g. 'john "the axe" smith' -> 'john the axe smith')
    // MultiHog's buildNameOnlyPersonaIdentity strips quotes with replace(/['"\\]/g, '')
    const noQuotes = lower.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
    const noParensNoQuotes = noParens.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
    // 3. Without the quoted nickname altogether (e.g. 'john "the axe" smith' -> 'john smith')
    const noNickname = lower
        .replace(/\s*\(.*?\)/g, '')
        .replace(/\s*["'][^"']*["']/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return [...new Set([
        lower,
        noQuotes,
        noParens,
        noParensNoQuotes,
        noNickname,
    ])].filter(Boolean);
}

/**
 * Locate matching SillyTavern persona for the given character name.
 * @param {string} charName Character name from MultiHog
 * @param {Record<string, string>} [providedPersonas] Optional personas map ({ [avatarId]: name }) for direct lookup
 * @returns {Promise<{ avatar: string, name: string } | null>}
 */
export async function findMatchingPersona(charName, providedPersonas = null) {
    if (!charName) return null;

    let personas = providedPersonas;
    if (!personas) {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        let powerUser = ctx?.power_user || (typeof window !== 'undefined' ? window.power_user : null);
        if (!powerUser?.personas && typeof import('../../../power-user.js') !== 'undefined') {
            try {
                const pu = await import('../../../power-user.js');
                powerUser = pu.power_user;
            } catch (_) {}
        }
        personas = powerUser?.personas;
    }

    if (!personas || typeof personas !== 'object') return null;

    const charVariants = getNameMatchingVariants(charName);
    if (!charVariants.length) return null;

    // 1. Exact match across normalized variants
    // Catches:
    // - Exact raw match ("John \"The axe\" Smith" == "John \"The axe\" Smith")
    // - Upstream quote-stripped persona ("John \"The axe\" Smith" matching "John The axe Smith")
    // - Base-name persona without nickname ("John \"The axe\" Smith" matching "John Smith")
    // - Smart quotes vs straight quotes
    for (const [avatarId, personaName] of Object.entries(personas)) {
        if (!personaName) continue;
        const personaVariants = getNameMatchingVariants(personaName);
        const hasVariantMatch = charVariants.some(cv => personaVariants.includes(cv));
        if (hasVariantMatch) {
            return { avatar: avatarId, name: personaName };
        }
    }

    // 2. Prefix / substring match for titled names (e.g. "Bob" matching "Bob the Barbarian")
    for (const [avatarId, personaName] of Object.entries(personas)) {
        if (!personaName) continue;
        const personaVariants = getNameMatchingVariants(personaName);
        for (const cv of charVariants) {
            if (cv.length < 2) continue;
            for (const pv of personaVariants) {
                if (pv.length < 2) continue;
                if (cv.startsWith(pv) || pv.startsWith(cv)) {
                    return { avatar: avatarId, name: personaName };
                }
            }
        }
    }

    return null;
}

/**
 * Helper to extract character name from a memo string.
 * @param {string} memo
 * @returns {string | null}
 */
export function extractNameFromMemo(memo) {
    if (!memo || typeof memo !== 'string') return null;
    const charBlock = memo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    if (charBlock) {
        let firstLine = charBlock[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
        // Decode common HTML entities
        firstLine = firstLine
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/^[-*•–—]\s*/, '')
            .trim();
        const m = firstLine.match(/^([^(:\[\n]{2,50}?)(?:\s*\(|\s*:)/);
        if (m) {
            const candidate = m[1].trim();
            if (candidate && !/^(character|unknown|user|name)$/i.test(candidate)) return candidate;
        }
        if (firstLine && !/^(character|unknown|user|name)$/i.test(firstLine) && firstLine.length <= 50) {
            return firstLine;
        }
    }
    const nameField = memo.match(/(?:^|\n)\s*(?:Name|Character Name)\s*[:\|]\s*([^\n\|\[<]{2,60})/im);
    if (nameField) {
        const candidate = nameField[1].replace(/<[^>]+>/g, '').trim();
        if (candidate && !/^(character|unknown|user)$/i.test(candidate)) return candidate;
    }
    return null;
}
