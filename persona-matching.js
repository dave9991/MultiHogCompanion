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
 * Checks whether a candidate string is a valid, real character name
 * (not a template macro or generic system placeholder).
 * @param {string} name
 * @returns {boolean}
 */
export function isValidCharacterName(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 80) return false;

    // Reject template macros anywhere in the name: {{user}}, {{char}}, {user}, {char}, etc.
    if (/\{+(?:user|char|name|player)\}+/i.test(trimmed)) return false;
    if (/^\{+.*?\}$/.test(trimmed)) return false;

    // Strip bracket/brace artifacts and examine core word
    const cleaned = trimmed.replace(/[{}]/g, '').trim();
    if (/^(character|unknown|user|name|player|my character|unnamed|pc)$/i.test(cleaned)) {
        return false;
    }

    return true;
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
            if (isValidCharacterName(candidate)) return candidate;
            return null;
        }
        if (firstLine && isValidCharacterName(firstLine) && firstLine.length <= 50) {
            return firstLine;
        }
    }
    const nameField = memo.match(/(?:^|\n)\s*(?:Name|Character Name)\s*[:\|]\s*([^\n\|\[<]{2,60})/im);
    if (nameField) {
        const candidate = nameField[1].replace(/<[^>]+>/g, '').trim();
        if (isValidCharacterName(candidate)) return candidate;
    }
    return null;
}

/**
 * Helper to resolve candidate chat IDs for partition lookup.
 * @param {string} [chatId]
 * @returns {string[]}
 */
export function getCandidateChatIds(chatId) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let raw = [];
    if (chatId) {
        raw = [chatId];
    } else {
        const stChatId = ctx?.getCurrentChatId?.() || ctx?.chatId || ctx?.chatMetadata?.chat_id || null;
        if (stChatId) {
            raw = [
                ctx?.getCurrentChatId?.(),
                ctx?.chatId,
                ctx?.chatMetadata?.chat_id,
            ];
        } else {
            raw = [
                (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null),
            ];
        }
    }
    const filtered = raw.filter(Boolean).map(String);
    const expanded = [];
    for (const id of filtered) {
        expanded.push(id);
        if (id.endsWith('.jsonl')) {
            expanded.push(id.slice(0, -6));
        } else {
            expanded.push(`${id}.jsonl`);
        }
    }
    return [...new Set(expanded)];
}

/**
 * Retrieve player character portrait src from Multihog settings.
 * Prioritizes customPortraits (where manual uploads, replacements, and newly assigned portraits reside),
 * matching upstream MultiHog's resolvePortraitSrcForPlayerCharacter lookup sequence,
 * then falls back to pbtaCampaignDossier or playerCharacter objects.
 *
 * @param {string} chatId
 * @param {string} [charName]
 * @param {object} [providedRpgSettings]
 * @returns {string|null}
 */
export function getMultihogPlayerPortrait(chatId, charName, providedRpgSettings = null) {
    const s = providedRpgSettings || (typeof globalThis._rpgSettings !== 'undefined'
        ? globalThis._rpgSettings
        : (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null));
    if (!s) return null;

    const candidateIds = getCandidateChatIds(chatId);
    const candidateNames = [];
    if (charName) candidateNames.push(charName);

    // Also collect names from character blocks or playerCharacter across candidate partitions
    for (const cid of candidateIds) {
        const pcName = s.chatStates?.[cid]?.playerCharacter?.name;
        if (pcName && !candidateNames.includes(pcName)) candidateNames.push(pcName);
        const protoName = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.name;
        if (protoName && !candidateNames.includes(protoName)) candidateNames.push(protoName);
    }
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = !owner || candidateIds.some(cid => cid === owner);
    if (isOwnerMatch && s.playerCharacter?.name && !candidateNames.includes(s.playerCharacter.name)) {
        candidateNames.push(s.playerCharacter.name);
    }

    const charVariants = [...new Set(candidateNames.flatMap(n => getNameMatchingVariants(n)))];

    const lookupInMap = (map, { allowGenericFallback = false } = {}) => {
        if (!map || typeof map !== 'object') return null;

        // 1. Exact match on candidate character names
        for (const name of candidateNames) {
            if (map[name]) return map[name];
        }

        // 2. Case-insensitive / normalized search across name variants
        const keys = Object.keys(map);
        for (const k of keys) {
            const keyVariants = getNameMatchingVariants(k);
            if (charVariants.some(cv => keyVariants.includes(cv))) {
                return map[k];
            }
        }

        // 3. Fallback for generic PC keys ONLY when explicitly allowed (e.g. partition scope)
        if (allowGenericFallback) {
            if (map['CHARACTER']) return map['CHARACTER'];
            if (map['PC']) return map['PC'];
        }

        return null;
    };

    // 1. Check chat partition customPortraits FIRST (holds user manual uploads and replaced portraits)
    for (const cid of candidateIds) {
        const part = s.chatStates?.[cid]?.customPortraits;
        const res = lookupInMap(part, { allowGenericFallback: true });
        if (res) return res;
    }

    // 2. Check live customPortraits (exact/variant match ONLY, no generic CHARACTER/PC fallback to prevent cross-chat bleed)
    const live = lookupInMap(s.customPortraits, { allowGenericFallback: false });
    if (live) return live;

    // 3. Check pbtaCampaignDossier or playerCharacter portraitSrc across candidate partitions
    for (const cid of candidateIds) {
        const dossierPortrait = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.portraitSrc;
        if (dossierPortrait) return dossierPortrait;
        const pcPortrait = s.chatStates?.[cid]?.playerCharacter?.portraitSrc;
        if (pcPortrait) return pcPortrait;
    }

    // 4. Check live playerCharacter portrait if projection owner matches or unset
    if (isOwnerMatch && s.playerCharacter?.portraitSrc) {
        return s.playerCharacter.portraitSrc;
    }

    return null;
}



