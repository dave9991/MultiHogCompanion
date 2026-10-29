/**
 * MultiHog Companion — Level-Up Runner & State Committer
 *
 * Coordinates deterministic XP evaluation, proposal formulation,
 * and surgical state memo patching.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { XP_LEVEL_THRESHOLDS, MAX_CHARACTER_LEVEL, getTierPerks, getCanonicalDndProgression, sanitizeFeatureList, formatTraitAsPill, classifyFeatureKind, partitionFeaturesAndAbilities } from './level-up-blueprint.js';
import { parseAbilitiesBlockFromMemo } from './level-up-scaffold.js';
import { PBTA_GENRES, formatMoveAsPill, splitTopLevelPillItems } from './pbta-ruleset.js';

/**
 * Extracts the canonical identity key of a feature or ability (text before '(', ':', or '[').
 * e.g. "Street Rat (+2 to Stealth...)" -> "street rat"
 *      "Underworld Broker (Forces...)" -> "underworld broker"
 * @param {string} feat
 * @returns {string}
 */
export function extractFeatureKey(feat) {
    if (!feat || typeof feat !== 'string') return '';
    const clean = feat.replace(/^[-*•\s]+/, '').trim();
    const match = clean.match(/^([^(:\[]+)/);
    if (match && match[1].trim()) {
        return match[1].trim().toLowerCase();
    }
    return clean.toLowerCase();
}

/**
 * Deduplicates a list of features or abilities by their canonical name key.
 * Preserves the first encountered version while ensuring no duplicates occur.
 * @param {string[]} list
 * @returns {string[]}
 */
export function deduplicateFeatures(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Map();
    for (const item of list) {
        if (!item || typeof item !== 'string') continue;
        const key = extractFeatureKey(item);
        if (!key) continue;
        if (!seen.has(key)) {
            seen.set(key, item.trim());
        }
    }
    return Array.from(seen.values());
}

/**
 * Merges incoming/upgraded features into an existing feature list by canonical name key.
 * When an incoming feature shares a key with an existing entry (e.g. `Sneak Attack (2d6)`
 * upgrading `Sneak Attack (1d6)` or `Rage (3/day, +2 dmg)` upgrading `Rage (2/day, +2 dmg)`),
 * the existing entry is replaced in place; genuinely new keys are appended.
 *
 * @param {string[]} baseList Existing features/abilities.
 * @param {string[]} upgradeList Incoming/higher-tier features/abilities.
 * @returns {string[]}
 */
export function mergeUpgradedFeatures(baseList = [], upgradeList = []) {
    const map = new Map();
    for (const item of sanitizeFeatureList(baseList)) {
        const key = extractFeatureKey(item);
        if (key && !map.has(key)) {
            map.set(key, item);
        }
    }
    for (const item of sanitizeFeatureList(upgradeList)) {
        const key = extractFeatureKey(item);
        if (key) {
            map.set(key, item);
        }
    }
    return Array.from(map.values());
}

/**
 * Collapses a blueprint's features from Level 1 up to `upToLevel`, upgrading scaling
 * features in place (so e.g. Level 5 Rogue has `Sneak Attack (3d6)` rather than three
 * separate Sneak Attack pills).
 *
 * @param {object} blueprint Progression blueprint.
 * @param {number} upToLevel Maximum level to include.
 * @returns {string[]}
 */
export function collapseCodexProgression(blueprint, upToLevel = 1) {
    if (!blueprint?.levels) return [];
    let acc = [];
    const maxLvl = Math.max(1, Math.min(20, Number(upToLevel) || 1));
    for (let l = 1; l <= maxLvl; l++) {
        const lvlFeatures = blueprint.levels[String(l)]?.features || blueprint.levels[l]?.features || [];
        acc = mergeUpgradedFeatures(acc, lvlFeatures);
    }
    return acc;
}

/**
 * Ensures that a feature or ability text retains its canonical name prefix.
 * e.g. ensureNamedFeature("Misfortune Gambit", "Once per long rest, reroll...")
 *      -> "Misfortune Gambit (Once per long rest, reroll...)"
 * @param {string} rawName Canonical ability/feature name.
 * @param {string} rawText Provided description or full text.
 * @returns {string} Formatted string with name guaranteed.
 */
export function ensureNamedFeature(rawName, rawText) {
    const name = (rawName || '').trim();
    let text = (rawText || '').trim();
    if (!name) return text;
    if (!text) return name;

    const nameLower = name.toLowerCase();
    const textLower = text.toLowerCase();
    if (textLower.startsWith(nameLower)) {
        return text;
    }

    if (text.startsWith('(') && text.endsWith(')')) {
        return `${name} ${text}`;
    }

    return `${name} (${text.replace(/^\(+|\)+$/g, '').trim()})`;
}

/**
 * Splits a string by a delimiter (e.g. ';') only at top-level parenthesis and bracket depth (depth 0),
 * preventing parenthetical descriptions with semicolons (e.g. `(Heal 1d10 HP; 1/1 per rest)`) from being cut in half.
 *
 * @param {string} str
 * @param {string} [delimiter=';']
 * @returns {string[]}
 */
export function splitTopLevelDirectives(str, delimiter = ';') {
    if (typeof str !== 'string') return [];
    const out = [];
    let cur = '';
    let pDepth = 0;
    let bDepth = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '(') pDepth++;
        else if (ch === ')') pDepth = Math.max(0, pDepth - 1);
        else if (ch === '[') bDepth++;
        else if (ch === ']') bDepth = Math.max(0, bDepth - 1);

        if (ch === delimiter && pDepth === 0 && bDepth === 0) {
            if (cur.trim()) out.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

/**
 * Robust bracket-depth scanner for Concierge directives in LLM responses.
 *
 * Scans forward tracking parenthesis/bracket depth so directives containing internal
 * brackets (e.g. `[UPDATE_LEVEL: 1 | [Trait] Street Rat (...); [⚡ Ability] ...]` or
 * `[ADD_FEATURE: Move Name [+STAT] (...)]`) are parsed as single complete directives
 * rather than truncating at the first inner `]`.
 *
 * @param {string} text Raw LLM response string.
 * @returns {{
 *   directives: Array<{ tag: string, payload: string }>,
 *   cleanedText: string
 * }}
 */
export function extractConciergeDirectives(text) {
    if (typeof text !== 'string' || !text) {
        return { directives: [], cleanedText: text || '' };
    }

    const KNOWN_DIRECTIVES = new Set([
        'UPDATE_LEVEL',
        'SET_HIT_DIE',
        'SET_CLASS_NAME',
        'ADD_FEATURE',
        'UPDATE_FEATURE',
        'REMOVE_FEATURE',
        'ADD_ABILITY',
        'UPDATE_ABILITY',
        'REMOVE_ABILITY',
        'MOVE_TO_ABILITIES',
        'MOVE_TO_FEATURES',
        'SET_STAT',
    ]);

    const directives = [];
    let cleaned = '';
    let i = 0;

    while (i < text.length) {
        if (text[i] === '[') {
            const rem = text.slice(i);
            const m = rem.match(/^\[([A-Z_]+)\s*:\s*/i);
            if (m && KNOWN_DIRECTIVES.has(m[1].toUpperCase())) {
                const tag = m[1].toUpperCase();
                let depth = 0;
                let endIdx = -1;
                for (let j = i; j < text.length; j++) {
                    if (text[j] === '[') depth++;
                    else if (text[j] === ']') {
                        depth--;
                        if (depth === 0) {
                            endIdx = j;
                            break;
                        }
                    }
                }
                if (endIdx > 0) {
                    const rawPayload = text.slice(i + m[0].length, endIdx).trim();
                    directives.push({ tag, payload: rawPayload });
                    i = endIdx + 1;
                    continue;
                }
            }
        }
        cleaned += text[i];
        i++;
    }

    // Strip full ```json ... ``` codeblocks from displayed chat text if present
    cleaned = cleaned.replace(/```(?:json)?[\s\S]*?"levels"[\s\S]*?```/gi, '');

    return {
        directives,
        cleanedText: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    };
}

/**
 * Checks whether a feature or ability string matches a removal directive target by exact canonical key
 * (preventing substring collisions like removing "Rage" from deleting "Enrage" or "Mindless Rage").
 *
 * @param {string} item Existing feature or ability string.
 * @param {string} rawTarget Target string from [REMOVE_FEATURE: ...] or [REMOVE_ABILITY: ...].
 * @returns {boolean}
 */
export function matchesFeatureRemovalTarget(item, rawTarget) {
    if (!item || !rawTarget) return false;
    const itemKey = extractFeatureKey(item);
    const targetKey = extractFeatureKey(rawTarget);
    if (!itemKey || !targetKey) return false;
    if (itemKey === targetKey) return true;
    return String(item).trim().toLowerCase() === String(rawTarget).trim().toLowerCase();
}

/**
 * Canonical PbtA advancement choices and their per-character usage caps.
 */
export const PBTA_ADVANCE_CATALOG = [
    { id: 'stat_boost', label: 'Increase a Stat by +1 (max +3)', maxTimes: 2 },
    { id: 'playbook_move', label: 'Take a New Move from Your Playbook', maxTimes: 4 },
    { id: 'cross_playbook_move', label: 'Take a Move from Another Playbook', maxTimes: 2 },
    { id: 'harm_capacity', label: 'Increase Max Harm Capacity by +1', maxTimes: 1 },
    { id: 'armor_training', label: 'Increase Armor by +1 (max 3)', maxTimes: 1 },
];

/**
 * Resolves the active PbtA genre key ('fantasy', 'scifi', 'horror', etc.) from a dossier.
 *
 * @param {object} dossier
 * @returns {string}
 */
export function resolvePbtaGenreKey(dossier) {
    const candidates = [dossier?.meta?.genre, dossier?.meta?.systemKey]
        .filter(Boolean)
        .map(s => String(s).trim().toLowerCase());
    for (const c of candidates) {
        if (PBTA_GENRES[c]) return c;
    }
    const label = (dossier?.meta?.systemLabel || '').toLowerCase();
    if (label) {
        const byLabel = Object.values(PBTA_GENRES).find(g =>
            label.includes(g.id.toLowerCase()) ||
            g.label.toLowerCase().includes(label) ||
            label.includes(g.label.split(' ')[0].toLowerCase())
        );
        if (byLabel) return byLabel.id;
    }
    const rawStats = dossier?.protagonist?.stats || dossier?.stats || {};
    const statKeysLower = new Set(Object.keys(rawStats).map(k => k.toLowerCase()));
    if (statKeysLower.size > 0) {
        let bestGenre = null;
        let bestHits = 0;
        for (const g of Object.values(PBTA_GENRES)) {
            const hits = g.stats.filter(s => statKeysLower.has(s.toLowerCase())).length;
            if (hits > bestHits) {
                bestHits = hits;
                bestGenre = g.id;
            }
        }
        if (bestGenre && bestHits >= 2) return bestGenre;
    }
    return 'fantasy';
}

/**
 * Deduplicates PbtA stats case-insensitively into canonical TitleCase keys
 * (eliminating duplicate 'AGILITY' + 'Agility' pairs from memo parsing).
 *
 * @param {object} statsObj Raw stats map.
 * @param {string} [genreKey='fantasy'] Active PbtA genre key.
 * @returns {Record<string, number>}
 */
export function getCanonicalPbtaStats(statsObj, genreKey = 'fantasy') {
    const genreStats = PBTA_GENRES[genreKey]?.stats || PBTA_GENRES.fantasy.stats;
    const canonicalNameByLower = new Map(genreStats.map(s => [s.toLowerCase(), s]));
    const out = {};
    if (statsObj && typeof statsObj === 'object') {
        const seenLower = new Map();
        for (const [rawKey, rawVal] of Object.entries(statsObj)) {
            const num = Number(rawVal);
            if (!Number.isFinite(num)) continue;
            const lower = rawKey.trim().toLowerCase();
            if (!lower) continue;
            const preferred = canonicalNameByLower.get(lower)
                || (rawKey !== rawKey.toUpperCase() ? rawKey.trim() : (rawKey.charAt(0).toUpperCase() + rawKey.slice(1).toLowerCase()));
            if (!seenLower.has(lower) || rawKey === preferred) {
                seenLower.set(lower, { key: preferred, val: num });
            }
        }
        for (const { key, val } of seenLower.values()) {
            out[key] = val;
        }
    }
    if (Object.keys(out).length === 0) {
        const defaults = [2, 1, 1, 0, -1];
        genreStats.forEach((s, idx) => {
            out[s] = defaults[idx] ?? 0;
        });
    }
    return out;
}

/**
 * Expands a short PBTA_GENRES move template ("Move Name (+Stat) — trigger")
 * into a complete PbtA move pill with 10+ and 7-9 outcomes, remapping the stat
 * to one of the character's actual stats if needed.
 *
 * @param {string} rawTemplate
 * @param {string[]} charStatNames
 * @returns {string}
 */
function expandGenreMoveTemplate(rawTemplate, charStatNames = []) {
    const m = String(rawTemplate || '').match(/^([^(—–]+?)\s*\(([^)]+)\)\s*[—–-]\s*(.+)$/);
    if (!m) return formatMoveAsPill(rawTemplate);
    const moveName = m[1].trim();
    const rawStatTag = m[2].trim();
    const trigger = m[3].trim().replace(/\.$/, '');
    const statWord = rawStatTag.replace(/[^A-Za-z]/g, '');
    const matchedStat = charStatNames.find(s => s.toLowerCase() === statWord.toLowerCase())
        || charStatNames[0]
        || statWord
        || 'Stat';
    return formatMoveAsPill(
        `${moveName} (+${matchedStat}): When you ${trigger}, roll +${matchedStat}. On a 10+, you succeed cleanly and press your advantage. On a 7-9, it works, but choose a compromise, cost, or hard bargain.`
    );
}

/**
 * Builds the structured PbtA Advance options for a character, enforcing usage caps
 * from `advancesTaken` and generating genre-appropriate playbook and cross-playbook moves.
 *
 * @param {object} dossier Campaign dossier.
 * @param {object} [proposal=null] Current proposal (or protagonist fallback).
 * @returns {Array<object>}
 */
export function buildPbtaAdvanceOptions(dossier, proposal = null) {
    const char = dossier?.protagonist || {};
    const genreKey = proposal?.genreKey || resolvePbtaGenreKey(dossier);
    const stats = getCanonicalPbtaStats(proposal?.stats || char.stats, genreKey);
    const statNames = Object.keys(stats);
    const harm = proposal?.harm || char.harm || { current: 0, max: 4, armor: 1 };
    const currentMoves = proposal?.newFeatures || char.moves || char.startingMoves || [];
    const ownedMoveKeys = new Set(currentMoves.map(m => extractFeatureKey(m)));
    const advancesTaken = Array.isArray(proposal?.advancesTaken)
        ? proposal.advancesTaken
        : (Array.isArray(char.advancesTaken) ? char.advancesTaken : []);

    const usedCounts = {};
    for (const entry of advancesTaken) {
        const id = typeof entry === 'string' ? entry : entry?.type;
        if (id) usedCounts[id] = (usedCounts[id] || 0) + 1;
    }

    const activeGenre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const topStat = statNames[0] || 'Might';
    const secondStat = statNames[1] || topStat;

    // Playbook moves: genre moves + signature archetype moves not yet owned
    const rawPlaybookTemplates = [
        ...(activeGenre.moves || []),
        `Signature Mastery (+${topStat}) — bring your playbook's signature discipline to bear under extreme pressure`,
        `Veteran Instincts (+${secondStat}) — read the hidden danger before a trap or ambush springs`,
        `Unbreakable Resolve (+${topStat}) — stand your ground and shield an ally from an incoming blow`,
    ];
    const suggestedPlaybookMoves = rawPlaybookTemplates
        .map(t => expandGenreMoveTemplate(t, statNames))
        .filter(m => !ownedMoveKeys.has(extractFeatureKey(m)));

    // Cross-playbook moves: sample iconic moves from other genres mapped to the character's stats
    const otherGenres = Object.values(PBTA_GENRES).filter(g => g.id !== activeGenre.id);
    const suggestedCrossMoves = [];
    for (const g of otherGenres) {
        if (g.moves && g.moves[0]) {
            const expanded = expandGenreMoveTemplate(g.moves[0], statNames);
            if (!ownedMoveKeys.has(extractFeatureKey(expanded))) {
                suggestedCrossMoves.push(expanded);
            }
        }
        if (suggestedCrossMoves.length >= 6) break;
    }

    const eligibleStats = statNames.filter(s => (stats[s] ?? 0) < 3);

    return PBTA_ADVANCE_CATALOG.map(def => {
        const used = usedCounts[def.id] || 0;
        let exhausted = used >= def.maxTimes;
        if (def.id === 'stat_boost' && eligibleStats.length === 0) exhausted = true;
        if (def.id === 'harm_capacity' && (harm.max || 4) >= 8) exhausted = true;
        if (def.id === 'armor_training' && (harm.armor ?? 0) >= 3) exhausted = true;

        return {
            ...def,
            used,
            remaining: Math.max(0, def.maxTimes - used),
            exhausted,
            ...(def.id === 'stat_boost' ? {
                eligibleStats,
                stats,
            } : {}),
            ...(def.id === 'playbook_move' ? {
                suggestedMoves: suggestedPlaybookMoves,
            } : {}),
            ...(def.id === 'cross_playbook_move' ? {
                suggestedMoves: suggestedCrossMoves,
            } : {}),
        };
    });
}

/**
 * Applies a chosen PbtA advance to a proposal object (idempotent).
 *
 * @param {object} proposal
 * @param {object} advanceSelection
 * @returns {object}
 */
export function applyPbtaAdvanceSelection(proposal, advanceSelection) {
    if (!proposal || !advanceSelection || !advanceSelection.type) return proposal;
    if (advanceSelection.applied) return proposal;

    const type = advanceSelection.type;
    if (type === 'stat_boost') {
        const stat = advanceSelection.stat;
        if (stat && proposal.stats && typeof proposal.stats === 'object') {
            const matchKey = Object.keys(proposal.stats).find(k => k.toLowerCase() === stat.toLowerCase()) || stat;
            const curVal = Number(proposal.stats[matchKey] ?? 0);
            const nextVal = Math.min(3, curVal + (Number(advanceSelection.amount) || 1));
            proposal.stats[matchKey] = nextVal;
            advanceSelection.stat = matchKey;
            advanceSelection.newValue = nextVal;
        }
    } else if (type === 'playbook_move' || type === 'cross_playbook_move') {
        const rawMove = (advanceSelection.move || '').trim();
        if (rawMove) {
            const pillMove = formatMoveAsPill(rawMove);
            proposal.newFeatures = Array.isArray(proposal.newFeatures) ? proposal.newFeatures : [];
            const key = extractFeatureKey(pillMove);
            const existingIdx = proposal.newFeatures.findIndex(m => extractFeatureKey(m) === key);
            if (existingIdx >= 0) {
                proposal.newFeatures[existingIdx] = pillMove;
            } else {
                proposal.newFeatures.push(pillMove);
            }
            advanceSelection.move = pillMove;
        }
    } else if (type === 'harm_capacity') {
        proposal.harm = proposal.harm || { current: 0, max: 4, armor: 1 };
        const delta = Number(advanceSelection.amount) || 1;
        proposal.harm.max = Math.min(8, (Number(proposal.harm.max) || 4) + delta);
        if (proposal.hpChange) {
            proposal.hpChange.newMax = proposal.harm.max;
            proposal.hpChange.gain = delta;
        }
    } else if (type === 'armor_training') {
        proposal.harm = proposal.harm || { current: 0, max: 4, armor: 1 };
        const delta = Number(advanceSelection.amount) || 1;
        proposal.harm.armor = Math.min(3, (Number(proposal.harm.armor) || 0) + delta);
    }

    proposal.advancesTaken = Array.isArray(proposal.advancesTaken) ? proposal.advancesTaken : [];
    proposal.advancesTaken.push(type);
    advanceSelection.applied = true;
    proposal.pbtaAdvance = advanceSelection;
    return proposal;
}

/**
 * Evaluates whether the character has accumulated sufficient XP to advance a level.
 *
 * @param {string} memoText State memo text.
 * @param {string} [ruleset='dnd5e'] 'dnd5e' or 'pbta'.
 * @returns {{
 *   eligible: boolean,
 *   currentXp: number,
 *   maxThreshold: number,
 *   currentLevel: number,
 *   nextLevel: number,
 *   ruleset: string,
 *   surplusXp: number
 * }}
 */
export function evaluateLevelUpEligibility(memoText, ruleset = null, options = {}) {
    const text = memoText || '';
    const charBlockMatch = text.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    const charScope = charBlockMatch ? charBlockMatch[1] : text;
    const hasDndXpBlock = /\[XP\][\s\S]*?\[\/XP\]/i.test(text) || /\bLevel\s*:\s*\d+/i.test(charScope);

    // Explicit ruleset wins; when omitted (null/undefined), auto-detect PbtA only if Harm is present and D&D Level/[XP] is not
    const isPbta = ruleset === 'pbta'
        || Boolean(ruleset && PBTA_GENRES[String(ruleset).toLowerCase()])
        || (ruleset !== 'dnd5e' && !hasDndXpBlock && /Harm\s*:\s*\d+\/\d+/i.test(charScope));

    if (isPbta) {
        const xpMatch = charScope.match(/XP:\s*(\d+)(?:\s*\/\s*(\d+))?/i)
            || text.match(/XP:\s*(\d+)(?:\s*\/\s*(\d+))?/i);
        const cur = xpMatch ? parseInt(xpMatch[1], 10) : 0;
        const fallbackMax = Number(options?.pacingXp) > 0 ? Number(options.pacingXp) : 5;
        const max = xpMatch && xpMatch[2] ? parseInt(xpMatch[2], 10) : fallbackMax;
        const eligible = cur >= max && max > 0;
        return {
            eligible,
            currentXp: cur,
            maxThreshold: max,
            currentLevel: 1, // PbtA uses advances rather than numeric levels
            nextLevel: 2,
            ruleset: 'pbta',
            surplusXp: Math.max(0, cur - max),
        };
    }

    // Standard D&D 5e evaluation
    let currentXp = 0;
    let maxThreshold = 300;
    let currentLevel = 1;

    // Format A: Total: 1,200 / 2,700 XP (Level 3)
    const totalMatch = (memoText || '').match(/Total:\s*([\d,]+)\s*\/\s*([\d,]+)\s*XP\s*\(Level\s*(\d+)\)/i);
    // Format B: Level: 3 | XP: 1,200/2,700
    const legacyMatch = (memoText || '').match(/(?:Level:\s*(\d+)\s*\|?\s*)?XP:\s*([\d,]+)\/([\d,]+)/i);

    if (totalMatch) {
        currentXp = Number(totalMatch[1].replace(/,/g, ''));
        maxThreshold = Number(totalMatch[2].replace(/,/g, ''));
        currentLevel = parseInt(totalMatch[3], 10) || 1;
    } else if (legacyMatch) {
        currentLevel = legacyMatch[1] ? parseInt(legacyMatch[1], 10) : 1;
        currentXp = Number(legacyMatch[2].replace(/,/g, ''));
        maxThreshold = Number(legacyMatch[3].replace(/,/g, ''));
    } else {
        // Fallback: search [CHARACTER] for Level and [XP] for raw number
        const lvlSearch = (memoText || '').match(/Level\s*:\s*(\d+)/i);
        if (lvlSearch) currentLevel = parseInt(lvlSearch[1], 10) || 1;

        const xpNumSearch = (memoText || '').match(/XP\s*:\s*([\d,]+)/i);
        if (xpNumSearch) currentXp = Number(xpNumSearch[1].replace(/,/g, ''));

        // Derive threshold from D&D table
        const tableIndex = Math.min(currentLevel, XP_LEVEL_THRESHOLDS.length - 1);
        maxThreshold = XP_LEVEL_THRESHOLDS[tableIndex] || 300;
    }

    // Determine target threshold from canonical table if memo threshold is missing or 0
    if (!maxThreshold || maxThreshold <= 0) {
        const tableIndex = Math.min(currentLevel, XP_LEVEL_THRESHOLDS.length - 1);
        maxThreshold = XP_LEVEL_THRESHOLDS[tableIndex] || 300;
    }

    // No advancement past the level cap (XP table ends at level 20)
    const eligible = currentXp >= maxThreshold && maxThreshold > 0 && currentLevel < MAX_CHARACTER_LEVEL;
    const surplusXp = Math.max(0, currentXp - maxThreshold);

    return {
        eligible,
        currentXp,
        maxThreshold,
        currentLevel,
        nextLevel: currentLevel + 1,
        ruleset: 'dnd5e',
        surplusXp,
    };
}

/**
 * Formulates a structured Level-Up Proposal Dossier based on character data,
 * progression blueprint, and target advancement level.
 *
 * @param {object} dossier Campaign dossier.
 * @param {object} blueprint Progression blueprint.
 * @param {number} targetLevel Target level being advanced to.
 * @param {object} [options={}] Optional user selections.
 * @returns {object} Proposal details for the Hybrid Review UI.
 */
export function formulateLevelUpProposal(dossier, blueprint, targetLevel, options = {}) {
    const isRespec = !!options.isRespec;
    const char = dossier?.protagonist || (dossier?.features || dossier?.name ? dossier : {});
    const sysKeyLower = (dossier?.meta?.systemKey || '').toLowerCase();
    const isPbta = options.isPbta
        || sysKeyLower === 'pbta'
        || Boolean(sysKeyLower && PBTA_GENRES[sysKeyLower])
        || !!char.isPbta
        || !!char.playbook
        || !!char.harm
        || (dossier?.meta?.systemLabel && /PbtA|Dungeon World|Fellowship|Apocalypse|Monster of the Week|Sprawl|Masks|Blades in the Dark|Wanderhome/i.test(dossier.meta.systemLabel));

    if (isPbta) {
        const genreKey = resolvePbtaGenreKey(dossier);
        const playbookName = char.playbook || char.class || 'Protagonist';
        const rawHarm = char.harm || { current: 0, max: dossier?.config?.harmMax || 4, armor: char.armor ?? 1 };
        const harm = {
            current: Number(rawHarm.current) || 0,
            max: Number(rawHarm.max) || Number(dossier?.config?.harmMax) || 4,
            armor: rawHarm.armor !== undefined ? Number(rawHarm.armor) : (Number(char.armor) || 1),
        };
        const conditions = Array.isArray(char.conditions) ? [...char.conditions] : [];
        const stats = getCanonicalPbtaStats(char.stats, genreKey);
        const pacingXp = Number(dossier?.config?.pacingXp) > 0 ? Number(dossier.config.pacingXp) : 5;
        const advancesTaken = Array.isArray(char.advancesTaken) ? [...char.advancesTaken] : [];

        let moves = [];
        if (Array.isArray(char.moves) && char.moves.length > 0) {
            moves = [...char.moves];
        } else if (Array.isArray(char.startingMoves) && char.startingMoves.length > 0) {
            moves = [...char.startingMoves];
        } else if (Array.isArray(char.features) && char.features.length > 0) {
            moves = [...char.features];
        }

        // Clean out any accidental D&D artifact strings
        moves = sanitizeFeatureList(moves).filter(m => !/HP\s*Gain\s*:|Hit\s*Die|\bSpell\s*Slots?\b|\bExtra\s*Attack\b/i.test(m));

        const baseProposal = {
            isPbta: true,
            isRespec,
            genreKey,
            pacingXp,
            characterName: char.name || 'Hero',
            className: playbookName,
            playbookName,
            targetLevel: null,
            currentLevel: null,
            hitDie: null,
            harm,
            conditions,
            stats,
            statNames: Object.keys(stats),
            status: char.status || 'Healthy',
            hpChange: {
                oldMax: harm.max,
                gain: 0,
                newMax: harm.max,
                mode: 'pbta',
            },
            newFeatures: moves,
            advancesTaken,
            pbtaAdvance: options.pbtaAdvance || null,
            isAsi: false,
            asiOptions: null,
            partyChanges: [],
        };
        baseProposal.advanceOptions = buildPbtaAdvanceOptions(dossier, baseProposal);
        return baseProposal;
    }

    const conMod = Math.floor(((char.stats?.CON ?? 10) - 10) / 2);
    const perks = getTierPerks(blueprint, targetLevel, conMod);

    const oldHp = char.hp?.max || 10;
    
    // In Respec mode: character remains at their current level (no level advancement)
    const currentLevel = isRespec ? targetLevel : Math.max(1, targetLevel - 1);
    
    // In Respec mode: HP does not automatically increase; it is maintained by default
    const hpGain = isRespec ? 0 : (options.rolledHp !== undefined ? options.rolledHp : perks.averageHpGain);
    const newHp = isRespec ? oldHp : (oldHp + hpGain);

    // Active abilities from [ABILITIES] block (resolved before partitioning codex features)
    let activeAbilities = [];
    if (Array.isArray(options.activeAbilities)) {
        activeAbilities = [...options.activeAbilities];
    } else if (Array.isArray(char.abilities) && char.abilities.length > 0) {
        activeAbilities = [...char.abilities];
    } else if (options.currentMemo || options.memo) {
        activeAbilities = parseAbilitiesBlockFromMemo(options.currentMemo || options.memo || '');
    }
    activeAbilities = deduplicateFeatures(activeAbilities.map(a => formatTraitAsPill(a)).filter(Boolean));

    const sheetFeatures = Array.isArray(char.features) ? sanitizeFeatureList(char.features) : [];
    const sheetTraitKeys = new Set(sheetFeatures.map(f => extractFeatureKey(f)).filter(Boolean));

    // Route codex features between passive [CHARACTER] Traits and active [ABILITIES]
    let features = [];
    if (isRespec) {
        const codexCollapsed = collapseCodexProgression(blueprint, currentLevel);
        const { traits: codexTraits, abilities: codexAbilities } = partitionFeaturesAndAbilities(codexCollapsed);

        // Preserve established sheet features first (so custom sheet descriptions win on key collision)
        const abilityKeys = new Set(activeAbilities.map(a => extractFeatureKey(a)).filter(Boolean));
        features = deduplicateFeatures([
            ...sheetFeatures,
            ...codexTraits.filter(t => !abilityKeys.has(extractFeatureKey(t))),
        ]);

        // Route codex active abilities into [ABILITIES] unless already tracked on the passive sheet
        const routedCodexAbilities = codexAbilities.filter(ab => !sheetTraitKeys.has(extractFeatureKey(ab)));
        if (routedCodexAbilities.length > 0) {
            activeAbilities = mergeUpgradedFeatures(activeAbilities, routedCodexAbilities);
        }

        if (features.length === 0 && activeAbilities.length === 0) {
            features = perks.traits || perks.features || [];
        }
    } else {
        const { traits: levelTraits, abilities: levelAbilities } = partitionFeaturesAndAbilities(perks.features || []);
        const abilitiesOnPassiveSheet = levelAbilities.filter(ab => sheetTraitKeys.has(extractFeatureKey(ab)));
        const abilitiesForTracker = levelAbilities.filter(ab => !sheetTraitKeys.has(extractFeatureKey(ab)));

        features = deduplicateFeatures([...levelTraits, ...abilitiesOnPassiveSheet]);
        if (abilitiesForTracker.length > 0) {
            activeAbilities = mergeUpgradedFeatures(activeAbilities, abilitiesForTracker);
        }
    }

    // ASI or Feat recommendations if milestone level
    let asiOptions = null;
    if (perks.isAsi) {
        const primaryStat = blueprint?.primaryStats?.[0] || 'STR';
        const secondaryStat = blueprint?.primaryStats?.[1] || 'CON';
        asiOptions = {
            optionA: { type: 'asi', stat1: primaryStat, amount1: 2, label: `+2 to ${primaryStat}` },
            optionB: { type: 'asi', stat1: primaryStat, amount1: 1, stat2: secondaryStat, amount2: 1, label: `+1 to ${primaryStat} & +1 to ${secondaryStat}` },
            recommendedFeats: [
                'Sentinel',
                'Great Weapon Master',
                'Alert',
                'Mobile',
                'Lucky',
                'War Caster',
            ],
            selectedChoice: options.selectedAsi || 'optionA',
        };
    }

        // Party companions preview (only during actual level up, not respec)
    const partyChanges = [];
    if (!isRespec && dossier.config?.partySyncEnabled !== false) {
        const companions = dossier.party || [];
        for (const comp of companions) {
            partyChanges.push({
                name: comp.name,
                hpGain: Math.max(4, Math.floor(perks.averageHpGain * 0.8)),
                classFeature: `Scaled to Tier ${Math.ceil(targetLevel / 4)}`,
            });
        }
    }

    return {
        targetLevel,
        currentLevel,
        characterName: char.name || 'Hero',
        className: blueprint?.className || char.class || 'Adventurer',
        hitDie: perks.hitDie,
        hpChange: {
            oldMax: oldHp,
            gain: hpGain,
            newMax: newHp,
            mode: isRespec ? 'respec' : (options.rolledHp !== undefined ? 'rolled' : 'average'),
        },
        newFeatures: features,
        activeAbilities,
        spellSlots: isRespec ? null : (perks.spellSlots || null),
        isAsi: perks.isAsi,
        asiOptions,
        partyChanges,
        isRespec,
    };
}

/**
 * Surgically commits the approved Level-Up / Respec proposal into the active State Memo.
 *
 * @param {object} params
 * @param {string} params.chatId Active chat ID.
 * @param {string} params.currentMemo Live state memo to update.
 * @param {object} params.proposal Approved proposal data.
 * @param {boolean} [params.isRespec=false] Whether this is a respec operation.
 * @param {object} [params.rpgSettings=null] MultiHog settings container.
 * @returns {{
 *   success: boolean,
 *   updatedMemo: string,
 *   summary: string
 * }}
 */
export function applyLevelUpCommit({ chatId, currentMemo, proposal, isRespec = false, rpgSettings = null }) {
    if (!currentMemo || typeof currentMemo !== 'string') {
        return { success: false, updatedMemo: currentMemo, summary: 'No active state memo found.' };
    }

    if (proposal.isPbta) {
        // Apply structured PbtA advance selection if present and not yet applied
        if (!isRespec && proposal.pbtaAdvance && !proposal.pbtaAdvance.applied) {
            applyPbtaAdvanceSelection(proposal, proposal.pbtaAdvance);
        }

        let updatedMemo = currentMemo;
        const charMatch = updatedMemo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
        if (charMatch) {
            let charBlock = charMatch[1];

            // 1. Update Stats in-place if modified
            if (proposal.stats && typeof proposal.stats === 'object' && Object.keys(proposal.stats).length > 0) {
                const canonStats = getCanonicalPbtaStats(proposal.stats, proposal.genreKey);
                if (/^\s*(?:Stats|Attr|Attributes)\s*:/im.test(charBlock)) {
                    charBlock = charBlock.replace(/^(\s*(?:Stats|Attr|Attributes)\s*:\s*)([^\n\r]*)/im, (full, prefix, lineBody) => {
                        let updatedLine = lineBody;
                        for (const [statName, val] of Object.entries(canonStats)) {
                            const statRe = new RegExp(`(\\b${statName}\\s*[:=]?\\s*)([+-]?\\d+)`, 'i');
                            const m = updatedLine.match(statRe);
                            if (m && parseInt(m[2], 10) !== Number(val)) {
                                const formattedVal = Number(val) > 0 ? `+${val}` : String(val);
                                updatedLine = updatedLine.replace(statRe, `$1${formattedVal}`);
                            }
                        }
                        return `${prefix}${updatedLine}`;
                    });
                } else {
                    const statsStr = Object.entries(canonStats)
                        .map(([k, v]) => `${k} ${Number(v) >= 0 ? '+' : ''}${v}`)
                        .join(', ');
                    charBlock = `${charBlock.trimEnd()}\nStats: ${statsStr}\n`;
                }
            }

            // 2. Normalize and commit Moves (handles existing, empty, or missing Moves: line)
            if (Array.isArray(proposal.newFeatures)) {
                const normalizedMoves = deduplicateFeatures(
                    proposal.newFeatures.map(m => formatMoveAsPill(m)).filter(Boolean)
                );
                proposal.newFeatures = normalizedMoves;
                const movesStr = normalizedMoves.join(', ');
                if (/(?:\(\(PILLS\)\)\s*)?Moves\s*:/i.test(charBlock)) {
                    charBlock = charBlock.replace(
                        /((?:\(\(PILLS\)\)\s*)?Moves\s*:)[^\n\r]*/i,
                        movesStr ? `$1 ${movesStr}` : '$1 None'
                    );
                } else if (movesStr) {
                    if (/^\s*(?:Stats|Attr|Attributes)\s*:[^\n\r]*/im.test(charBlock)) {
                        charBlock = charBlock.replace(
                            /^(\s*(?:Stats|Attr|Attributes)\s*:[^\n\r]*)/im,
                            `$1\n((PILLS)) Moves: ${movesStr}`
                        );
                    } else {
                        charBlock = `${charBlock.trimEnd()}\n((PILLS)) Moves: ${movesStr}\n`;
                    }
                }
            }

            // 3. Update Harm, tandem HP, & Armor if present in proposal
            if (proposal.harm) {
                const curHarm = Number(proposal.harm.current) || 0;
                const maxHarm = Number(proposal.harm.max) || 4;
                if (/Harm\s*:\s*\d+\/\d+/i.test(charBlock)) {
                    charBlock = charBlock.replace(
                        /Harm\s*:\s*\d+\/\d+/i,
                        `Harm: ${curHarm}/${maxHarm}`
                    );
                    // Keep descending tandem HP on the header line synchronized when maxHarm/curHarm changes
                    const curHp = Math.max(0, maxHarm - curHarm);
                    charBlock = charBlock.replace(
                        /(\d+)\s*\/\s*(\d+)\s*HP/i,
                        `${curHp}/${maxHarm} HP`
                    );
                }
                if (/Armor\s*:\s*\d+/i.test(charBlock) && proposal.harm.armor !== undefined) {
                    charBlock = charBlock.replace(
                        /Armor\s*:\s*\d+/i,
                        `Armor: ${proposal.harm.armor}`
                    );
                }
            }

            // 4. Advance XP inside [CHARACTER] if not respec
            if (!isRespec && /XP:\s*\d+(?:\s*\/\s*\d+)?/i.test(charBlock)) {
                const xpMatch = charBlock.match(/XP:\s*(\d+)(?:\s*\/\s*(\d+))?/i);
                if (xpMatch) {
                    const cur = parseInt(xpMatch[1], 10) || 0;
                    const max = xpMatch[2] ? parseInt(xpMatch[2], 10) : (Number(proposal.pacingXp) || 5);
                    const nextCur = Math.max(0, cur - max);
                    charBlock = charBlock.replace(/XP:\s*\d+(?:\s*\/\s*\d+)?/i, `XP: ${nextCur}/${max}`);
                }
            }

            updatedMemo = updatedMemo.replace(charMatch[0], `[CHARACTER]${charBlock}[/CHARACTER]`);
        }

        // Fallback: if XP was outside [CHARACTER], advance it there
        if (!isRespec && (!charMatch || !/XP:\s*\d+/i.test(charMatch[1]))) {
            const xpMatch = updatedMemo.match(/XP:\s*(\d+)(?:\s*\/\s*(\d+))?/i);
            if (xpMatch) {
                const cur = parseInt(xpMatch[1], 10) || 0;
                const max = xpMatch[2] ? parseInt(xpMatch[2], 10) : (Number(proposal.pacingXp) || 5);
                const nextCur = Math.max(0, cur - max);
                updatedMemo = updatedMemo.replace(/XP:\s*\d+(?:\s*\/\s*\d+)?/i, `XP: ${nextCur}/${max}`);
            }
        }

        // Sync settings / partition
        if (rpgSettings) {
            rpgSettings.currentMemo = updatedMemo;
            if (rpgSettings.chatStates && chatId && rpgSettings.chatStates[chatId]) {
                rpgSettings.chatStates[chatId].currentMemo = updatedMemo;
                for (const key of ['pbtaCampaignDossier', 'companionDossier']) {
                    const proto = rpgSettings.chatStates[chatId][key]?.protagonist;
                    if (proto) {
                        proto.moves = [...(proposal.newFeatures || [])];
                        if (proposal.harm) proto.harm = { ...proposal.harm };
                        if (proposal.stats) proto.stats = { ...getCanonicalPbtaStats(proposal.stats, proposal.genreKey) };
                        if (Array.isArray(proposal.advancesTaken)) proto.advancesTaken = [...proposal.advancesTaken];
                    }
                }
            }
            if (typeof document !== 'undefined') {
                const memoEl = document.getElementById('rpg-tracker-memo');
                if (memoEl) {
                    memoEl.value = updatedMemo;
                    memoEl.dispatchEvent(new Event('input', { bubbles: true }));
                    memoEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.saveSettingsDebounced === 'function') {
                SillyTavern.getContext().saveSettingsDebounced();
            } else if (typeof globalThis.saveSettingsDebounced === 'function') {
                globalThis.saveSettingsDebounced();
            }
        }

        return {
            success: true,
            updatedMemo,
            summary: isRespec
                ? `Playbook sheet successfully tuned and saved.`
                : `Playbook Advance Complete! ${proposal.characterName}'s advances applied.`,
        };
    }

    let updatedMemo = currentMemo;
    const targetLevel = proposal.targetLevel;
    const newMaxHp = proposal.hpChange?.newMax;
    // Never write engine-computed bookkeeping (HP gain, ASI, slot rows) to the sheet as features
    const cleanFeatures = Array.isArray(proposal.newFeatures) ? sanitizeFeatureList(proposal.newFeatures) : null;

    // 1. Update [CHARACTER] block
    const charMatch = updatedMemo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    if (charMatch) {
        let charBlock = charMatch[1];

        // Update Level
        if (!isRespec) {
            charBlock = charBlock.replace(/(Level\s*[:\s]\s*)\d+/i, `$1${targetLevel}`);
        }

        // Update HP: X/Y HP
        if (newMaxHp) {
            charBlock = charBlock.replace(/(\d+)\s*\/\s*(\d+)\s*HP/i, (m, cur, oldMax) => {
                const diff = newMaxHp - parseInt(oldMax, 10);
                const nextCur = parseInt(cur, 10) + (diff > 0 ? diff : 0);
                return `${nextCur}/${newMaxHp} HP`;
            });
        }

        // Update Hit Dice: strictly deterministic D&D 5e (HD: dX (targetLevel/targetLevel))
        const hdDie = (proposal.hitDie || 'd8').toLowerCase();
        const hdLine = `HD: ${hdDie} (${targetLevel}/${targetLevel})`;
        const hdPattern = /^\s*(?:Hit\s*Di(?:ce|e)|HD)\s*:\s*[^\n\r]+/im;
        if (hdPattern.test(charBlock)) {
            charBlock = charBlock.replace(hdPattern, hdLine);
        } else if (/^\s*Status\s*:/im.test(charBlock)) {
            charBlock = charBlock.replace(/^(\s*Status\s*:)/im, `${hdLine}\n$1`);
        } else {
            charBlock = `${charBlock.trimEnd()}\n${hdLine}\n`;
        }

        // Apply ASI if chosen
        if (proposal.asiChoice?.type === 'asi') {
            const { stat1, amount1, stat2, amount2 } = proposal.asiChoice;
            if (stat1 && amount1) {
                const re1 = new RegExp(`\\b(${stat1}\\s*[:=]?\\s*)(\\d+)`, 'i');
                charBlock = charBlock.replace(re1, (m, prefix, val) => `${prefix}${parseInt(val, 10) + amount1}`);
            }
            if (stat2 && amount2) {
                const re2 = new RegExp(`\\b(${stat2}\\s*[:=]?\\s*)(\\d+)`, 'i');
                charBlock = charBlock.replace(re2, (m, prefix, val) => `${prefix}${parseInt(val, 10) + amount2}`);
            }
        }

        // Update Features / Traits / Abilities line
        if (cleanFeatures) {
            const featText = cleanFeatures.join(', ');
            const featureLineRe = /((?:\(\((?:PILLS|PLS)\)\)\s*)?(?:Features|Traits|Abilities)\s*:\s*(?:\(\((?:PILLS|PLS)\)\)\s*)?)([^\n\r]*)/i;
            const existingMatch = charBlock.match(featureLineRe);

            if (isRespec) {
                // In Respec mode: replace the line cleanly with the exact approved list
                if (existingMatch) {
                    charBlock = charBlock.replace(existingMatch[0], `${existingMatch[1]}${featText}`);
                } else if (featText) {
                    // Use 'Traits:' for new lines because 'traits' is in MultiHog's STOCK_FIELD_RULES as 'pills'
                    charBlock = `${charBlock.trim()}\nTraits: ${featText}\n`;
                }
            } else {
                // In Level-Up mode: upgrade scaling features in place by key and append genuinely new ones
                if (existingMatch) {
                    const existingFeats = splitTopLevelPillItems(existingMatch[2])
                        .map(f => formatTraitAsPill(f))
                        .filter(Boolean);
                    if (cleanFeatures.length > 0) {
                        const combined = mergeUpgradedFeatures(existingFeats, cleanFeatures).join(', ');
                        charBlock = charBlock.replace(existingMatch[0], `${existingMatch[1]}${combined}`);
                    }
                } else if (featText) {
                    charBlock = `${charBlock.trim()}\nTraits: ${featText}\n`;
                }
            }
        }

        updatedMemo = updatedMemo.replace(charMatch[0], `[CHARACTER]${charBlock}[/CHARACTER]`);
    }

    // 1b. Update [ABILITIES] block if active abilities are defined
    if (Array.isArray(proposal.activeAbilities)) {
        const abMatch = updatedMemo.match(/\[ABILITIES\]([\s\S]*?)\[\/ABILITIES\]/i);
        const abLines = proposal.activeAbilities
            .map(a => formatTraitAsPill(a))
            .filter(Boolean);

        if (abMatch) {
            if (abLines.length > 0) {
                const formatted = abLines.join('\n');
                updatedMemo = updatedMemo.replace(abMatch[0], `[ABILITIES]\n${formatted}\n[/ABILITIES]`);
            } else if (isRespec) {
                updatedMemo = updatedMemo.replace(abMatch[0], `[ABILITIES]\n[/ABILITIES]`);
            }
        } else if (abLines.length > 0) {
            const formatted = abLines.join('\n');
            const abBlock = `\n\n[ABILITIES]\n${formatted}\n[/ABILITIES]`;
            if (/\[\/INVENTORY\]/i.test(updatedMemo)) {
                updatedMemo = updatedMemo.replace(/(\[\/INVENTORY\])/i, `$1${abBlock}`);
            } else if (/\[\/CHARACTER\]/i.test(updatedMemo)) {
                updatedMemo = updatedMemo.replace(/(\[\/CHARACTER\])/i, `$1${abBlock}`);
            }
        }
    }

    // 1c. Grow [SPELLS] slot maximums for casters (Level N (avail/max) lines)
    if (!isRespec && proposal.spellSlots && typeof proposal.spellSlots === 'object') {
        updatedMemo = applySpellSlotGrowth(updatedMemo, proposal.spellSlots);
    }

    // 2. Update [XP] block
    if (!isRespec) {
        const nextThreshold = targetLevel < XP_LEVEL_THRESHOLDS.length
            ? XP_LEVEL_THRESHOLDS[targetLevel]
            : XP_LEVEL_THRESHOLDS[XP_LEVEL_THRESHOLDS.length - 1];

        // Update Total: X / Y XP (Level Z)
        if (/Total:\s*[\d,]+\s*\/\s*[\d,]+\s*XP/i.test(updatedMemo)) {
            updatedMemo = updatedMemo.replace(
                /Total:\s*([\d,]+)\s*\/\s*[\d,]+\s*XP\s*\(Level\s*\d+\)/i,
                (m, cur) => `Total: ${cur} / ${nextThreshold.toLocaleString('en-US')} XP (Level ${targetLevel})`
            );
        } else if (/\[XP\]([\s\S]*?)\[\/XP\]/i.test(updatedMemo)) {
            updatedMemo = updatedMemo.replace(
                /\[XP\]([\s\S]*?)\[\/XP\]/i,
                (m, content) => {
                    let updatedXp = content.replace(/(Level\s*[:\s]\s*)\d+/i, `$1${targetLevel}`);
                    updatedXp = updatedXp.replace(/(XP:\s*[\d,]+)\/[\d,]+/i, `$1/${nextThreshold.toLocaleString('en-US')}`);
                    return `[XP]${updatedXp}[/XP]`;
                }
            );
        }
    }

    // 3. Update party companions if present and sync enabled
    if (Array.isArray(proposal.partyChanges) && proposal.partyChanges.length > 0) {
        const partyMatch = updatedMemo.match(/\[PARTY\]([\s\S]*?)\[\/PARTY\]/i);
        if (partyMatch) {
            let partyBlock = partyMatch[1];
            for (const pc of proposal.partyChanges) {
                const re = new RegExp(`(${pc.name}[^\\n:]*:\\s*)(\\d+)\\s*\\/\\s*(\\d+)\\s*HP`, 'i');
                partyBlock = partyBlock.replace(re, (m, prefix, cur, max) => {
                    const nextMax = parseInt(max, 10) + pc.hpGain;
                    const nextCur = parseInt(cur, 10) + pc.hpGain;
                    return `${prefix}${nextCur}/${nextMax} HP`;
                });
            }
            updatedMemo = updatedMemo.replace(partyMatch[0], `[PARTY]${partyBlock}[/PARTY]`);
        }
    }

    // Commit to MultiHog live settings if provided
    if (rpgSettings) {
        rpgSettings.currentMemo = updatedMemo;
        if (typeof globalThis._rpgUpdateUIMemo === 'function') {
            globalThis._rpgUpdateUIMemo(updatedMemo);
        }
        if (rpgSettings.chatStates && chatId && rpgSettings.chatStates[chatId]) {
            rpgSettings.chatStates[chatId].currentMemo = updatedMemo;
        }

        // Keep DOM textarea in sync if present
        if (typeof document !== 'undefined') {
            const memoEl = document.getElementById('rpg-tracker-memo');
            if (memoEl) {
                memoEl.value = updatedMemo;
                memoEl.dispatchEvent(new Event('input', { bubbles: true }));
                memoEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Persist settings
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.saveSettingsDebounced === 'function') {
            SillyTavern.getContext().saveSettingsDebounced();
        } else if (typeof globalThis.saveSettingsDebounced === 'function') {
            globalThis.saveSettingsDebounced();
        }
    }

    const summary = isRespec
        ? `Character sheet successfully tuned and respec applied.`
        : `Level Up Complete! ${proposal.characterName} is now Level ${targetLevel} (Max HP: ${newMaxHp}).`;

    return {
        success: true,
        updatedMemo,
        summary,
    };
}

/**
 * Raises spell slot maximums in the memo's [SPELLS] block.
 * `slotGrants` maps slot level -> new total max for that slot level (e.g. { 3: 2 }).
 * Available slots rise by the same delta; maximums never shrink. A slot level with no
 * existing line gets a new empty "Level N (max/max):" line. Memos without a [SPELLS]
 * block are left untouched.
 *
 * @param {string} memo State memo text.
 * @param {Object<string, number>} slotGrants
 * @returns {string} Updated memo.
 */
export function applySpellSlotGrowth(memo, slotGrants) {
    if (!memo || !slotGrants) return memo;
    const block = memo.match(/\[SPELLS\]([\s\S]*?)\[\/SPELLS\]/i);
    if (!block) return memo;
    let body = block[1];
    for (const [slotLevel, total] of Object.entries(slotGrants)) {
        const newMax = Number(total);
        if (!(newMax > 0)) continue;
        const re = new RegExp(`(Level\\s*${parseInt(slotLevel, 10)}\\s*\\()(\\d+)\\s*\\/\\s*(\\d+)(\\))`, 'i');
        if (!re.test(body)) {
            // Newly unlocked slot level: add an empty line for it
            body = `${body.replace(/\s+$/, '')}\nLevel ${parseInt(slotLevel, 10)} (${newMax}/${newMax}):\n`;
            continue;
        }
        body = body.replace(re, (m, pre, avail, max, post) => {
            const oldMax = parseInt(max, 10);
            if (newMax <= oldMax) return m;
            const nextAvail = parseInt(avail, 10) + (newMax - oldMax);
            return `${pre}${nextAvail}/${newMax}${post}`;
        });
    }
    return memo.replace(block[0], `[SPELLS]${body}[/SPELLS]`);
}

/**
 * Decorates rendered XP progress bars in the RPG tracker panel with a golden
 * glow and an interactive Level-Up badge when currentXP >= maxThreshold.
 */
export function decorateXpBarsForLevelUp() {
    if (typeof document === 'undefined') return;
    const xpRows = document.querySelectorAll('.rt-xp-row');
    for (const row of xpRows) {
        const cur = Number(row.dataset.xpCurrent || 0);
        const max = Number(row.dataset.xpMax || 0);
        if (max > 0 && cur >= max) {
            row.classList.add('mhc-xp-level-up-ready');
            const labelEl = row.querySelector('.rt-xp-label');
            if (labelEl && !labelEl.querySelector('.mhc-xp-level-up-badge')) {
                const badge = document.createElement('span');
                badge.className = 'mhc-xp-level-up-badge';
                badge.innerHTML = '<i class="fa-solid fa-arrow-up"></i> Level Up!';
                badge.title = 'Click to Level Up character';
                labelEl.appendChild(badge);
            }
        } else {
            row.classList.remove('mhc-xp-level-up-ready');
            row.querySelector('.mhc-xp-level-up-badge')?.remove();
        }
    }
}

