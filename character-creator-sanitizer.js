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
// [CATALOG: ADR-MP-05] See MONKEYPATCHES.md — In-Memory Upstream Settings Cleansing (stockPrompts Mutation)
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

/**
 * Neutralizes template macro placeholders inside system prompts and instructions
 * where they are intended as literal examples/rules for the model, rather than
 * dynamic macro variables to be expanded by SillyTavern's MacroEngine.
 *
 * Prevents:
 * 1. MacroDiagnostics syntax error warnings caused by illegal {{...}} tokens.
 * 2. Unintended substitution of {{char}} and {{user}} inside meta-instructions like
 *    "Never output template macro strings such as {{char}}, {{user}}..." or
 *    "Replace every literal occurrence of {{char}} in the text...".
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeInstructionMacroLiterals(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;

    // 1. Exact match for canonical MultiHog anti-macro rule in character-creator.js (lines 855, 1347, 1521)
    result = result.replace(
        /Never output template macro strings such as\s*\{\{char\}\},\s*\{\{user\}\},\s*or any other\s*(?:\{\{\.\.\.\}\}|\{\u200B\{\.\.\.\}\u200B})\s*placeholders/gi,
        'Never output template macro strings such as {\u200B{char}\u200B}, {\u200B{user}\u200B}, or any other {\u200B{...}\u200B} placeholders'
    );

    // 2. Any invalid macro ellipsis tokens {{...}}
    result = result.replace(/\{\{\s*\.{2,}\s*\}\}/g, '{\u200B{...}\u200B}');

    // 3. Literal occurrence of {{char}} or {{Char}} in transcription instructions (line 1475)
    result = result.replace(
        /(literal occurrence of\s*)\{\{(char)\}\}(\s*or\s*)\{\{(char)\}\}/gi,
        '$1{\u200B{$2}\u200B}$3{\u200B{$4}\u200B}'
    );

    // 4. Transcription instructions mentioning {{char}} / {{user}} substitution (line 1478)
    result = result.replace(
        /(\{\{(?:char|user)\}\})(\s+substitution)/gi,
        (m, p1, p2) => {
            const tag = p1.replace(/[{}]/g, '');
            return '{\u200B{' + tag + '}\u200B}' + p2;
        }
    );

    return result;
}

/**
 * Sanitizes arguments passed to SillyTavern generateRaw / generateRawData.
 * @param {object|any} args
 * @returns {object|any}
 */
export function sanitizeRawGenerationArgs(args) {
    if (!args) return args;
    if (typeof args === 'object' && !Array.isArray(args)) {
        let changed = false;
        const sanitized = { ...args };
        if (typeof sanitized.systemPrompt === 'string') {
            const cleaned = sanitizeInstructionMacroLiterals(sanitized.systemPrompt);
            if (cleaned !== sanitized.systemPrompt) {
                sanitized.systemPrompt = cleaned;
                changed = true;
            }
        }
        if (typeof sanitized.prompt === 'string') {
            const cleaned = sanitizeInstructionMacroLiterals(sanitized.prompt);
            if (cleaned !== sanitized.prompt) {
                sanitized.prompt = cleaned;
                changed = true;
            }
        }
        return changed ? sanitized : args;
    }
    return args;
}

/**
 * Installs runtime monkey patch on SillyTavern.getContext().generateRaw and generateRawData.
 * Intercepts outbound prompt strings to neutralize literal meta-macro examples before
 * SillyTavern's createRawPrompt() -> substituteParams() triggers MacroEngine parser warnings.
 */
// [CATALOG: ADR-MP-07] See MONKEYPATCHES.md — Outgoing Prompt Macro Syntax Sanitizer (generateRaw Interception)
export function installMacroSyntaxSanitizer() {
    if (typeof globalThis.SillyTavern === 'undefined' || typeof globalThis.SillyTavern.getContext !== 'function') {
        return false;
    }

    const origGetContext = globalThis.SillyTavern.getContext;
    if (origGetContext._mhcMacroSanitizerActive) return true;

    globalThis.SillyTavern.getContext = function (...args) {
        const ctx = origGetContext.apply(this, args);
        if (!ctx) return ctx;

        if (typeof ctx.generateRaw === 'function' && !ctx.generateRaw._mhcSanitized) {
            const origGenerateRaw = ctx.generateRaw;
            ctx.generateRaw = async function (genArgs) {
                return origGenerateRaw.call(this, sanitizeRawGenerationArgs(genArgs));
            };
            ctx.generateRaw._mhcSanitized = true;
        }

        if (typeof ctx.generateRawData === 'function' && !ctx.generateRawData._mhcSanitized) {
            const origGenerateRawData = ctx.generateRawData;
            ctx.generateRawData = async function (genArgs) {
                return origGenerateRawData.call(this, sanitizeRawGenerationArgs(genArgs));
            };
            ctx.generateRawData._mhcSanitized = true;
        }

        return ctx;
    };

    globalThis.SillyTavern.getContext._mhcMacroSanitizerActive = true;
    console.log('[MultiHog Companion] Outgoing prompt macro syntax sanitizer installed.');
    return true;
}


