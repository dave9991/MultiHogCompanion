/**
 * character-creator-sanitizer.js — MultiHog Companion
 *
 * Prevents macro leakage (e.g. {{user}}, {{char}}, {user}, User) during
 * MultiHog character creation, quickstart, and persona synchronization.
 *
 * Background:
 * Upstream MultiHog DnD ships DEFAULT_STOCK_PROMPTS.character with literal `{{user}} (Class): current/max HP`.
 * In a blank chat before adventure start, or during direct prompts sent via Chat Completion,
 * ST macros are not evaluated or resolve to default 'User'. When the LLM strictly follows
 * the prompt's structural template, it generates `[CHARACTER]\n{{user}} (Class): HP`.
 * Upstream's name extraction and persona creation then latch onto `{{user}}` as the character's
 * literal name, discarding the player's entered name and creating a SillyTavern persona named `{{user}}`.
 *
 * This module:
 * 1. Validates character names to strictly reject macros and generic placeholders.
 * 2. Pre-emptively sanitizes stock prompts before character generation so the LLM never sees `{{user}}`.
 * 3. Intercepts `sendDirectPrompt` via `runtime-bridge.js` to ensure generated memos are rectified
 *    before upstream persona creation runs.
 */

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
 * Extracts a character name from a bio or description string if mentioned.
 * Commonly matches "Species: <Name> is a human..." or "<Name> is a seasoned...".
 * @param {string} bio
 * @returns {string | null}
 */
export function extractNameFromBio(bio) {
    if (!bio || typeof bio !== 'string') return null;

    // Pattern 1: "Species:\n<Name> is a [race/class]" or "Species: <Name> is a [race/class]"
    const speciesMatch = bio.match(/(?:Species|Background|About|Name)\s*:\s*\n*\s*([A-Z][a-zA-Z'\-]{1,25}(?:\s+[A-Z][a-zA-Z'\-]{1,25}){1,3})\s+(?:is|was|has|lives|scrapes|works)\b/i);
    if (speciesMatch && isValidCharacterName(speciesMatch[1])) {
        return speciesMatch[1].trim();
    }

    // Pattern 2: "<Name> is a [adjective/race/class]"
    const isAMatch = bio.match(/\b([A-Z][a-zA-Z'\-]{1,25}(?:\s+[A-Z][a-zA-Z'\-]{1,25}){1,3})\s+is\s+a\b/i);
    if (isAMatch && isValidCharacterName(isAMatch[1])) {
        return isAMatch[1].trim();
    }

    return null;
}

/**
 * Sanitizes character stock prompts by replacing {{user}} with the specified
 * target character name or a clean placeholder.
 * @param {Record<string, string>} stockPrompts
 * @param {string} [targetName]
 * @returns {boolean} true if modified
 */
export function sanitizeCharacterStockPrompt(stockPrompts, targetName = '') {
    if (!stockPrompts || typeof stockPrompts !== 'object') return false;
    let modified = false;
    const replacement = (isValidCharacterName(targetName) ? targetName.trim() : 'Character Name');

    if (stockPrompts.character && typeof stockPrompts.character === 'string') {
        if (/\{\{user\}\}/i.test(stockPrompts.character)) {
            stockPrompts.character = stockPrompts.character.replace(/\{\{user\}\}/gi, replacement);
            modified = true;
        }
    }

    return modified;
}

/**
 * Rectifies the character name in a state memo string if it currently contains
 * {{user}}, {user}, or generic User.
 * @param {string} memo
 * @param {string} realName
 * @returns {string}
 */
export function rectifyMemoCharacterName(memo, realName) {
    if (!memo || typeof memo !== 'string' || !isValidCharacterName(realName)) return memo;

    return memo.replace(
        /(\[CHARACTER\][\s\S]*?)(?:\{\{user\}\}|\{user\}|User)(\s*[\(:])/gi,
        `$1${realName.trim()}$2`
    );
}

/**
 * Determines the true character name from available chat state, draft, bio, or memo.
 * @param {{ draft?: any, playerCharacter?: any, memo?: string, cid?: string }} context
 * @returns {string | null}
 */
export function determineEffectiveCharacterName(context = {}) {
    const { draft, playerCharacter, memo } = context;

    // 1. Explicit draft name from Character Creator
    if (draft?.name && isValidCharacterName(draft.name)) {
        return draft.name.trim();
    }

    // 2. Existing valid playerCharacter name
    if (playerCharacter?.name && isValidCharacterName(playerCharacter.name)) {
        return playerCharacter.name.trim();
    }

    // 3. Name mentioned in playerCharacter bio
    if (playerCharacter?.bio) {
        const bioName = extractNameFromBio(playerCharacter.bio);
        if (bioName && isValidCharacterName(bioName)) {
            return bioName;
        }
    }

    // 4. Memo [CHARACTER] first line if valid
    if (memo) {
        const charBlock = memo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
        if (charBlock) {
            const firstLine = charBlock[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
            const m = firstLine.match(/^([^(:\[\n]{2,50}?)(?:\s*\(|\s*:)/);
            if (m && isValidCharacterName(m[1])) {
                return m[1].trim();
            }
        }
    }

    return null;
}


