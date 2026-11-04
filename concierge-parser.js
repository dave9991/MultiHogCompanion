/**
 * concierge-parser.js — MultiHog Companion
 *
 * Parses [CONCIERGE_STATE] blocks from Concierge responses, updates the live
 * Campaign Dossier artifact, and serializes the dossier to Markdown and JSON.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';
import { FAE_GENRES, sanitizeFaePositiveTags } from './fae-ruleset.js';
import { stripThinkingContent } from './concierge-connection.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';

/**
 * Creates a clean default Campaign Dossier object.
 * Delegates ruleset-specific protagonist, config, and pool scaffolding to the active system adapter.
 *
 * @param {string} [ruleset='pbta']
 * @param {string|null} [genreKey=null]
 * @returns {object}
 */
export function createEmptyDossier(ruleset = 'pbta', genreKey = null) {
    const adapter = systemRegistry.get(ruleset);
    const effectiveRuleset = adapter.id;
    const genres = adapter.getGenres();
    const systemKey = genreKey && genres[genreKey] ? genreKey : adapter.getDefaultGenre();
    const genreObj = adapter.getGenre(systemKey);

    const dossier = {
        meta: {
            title: `Untitled ${effectiveRuleset === 'fae' ? 'FAE' : (effectiveRuleset === 'pbta' ? 'PbtA' : effectiveRuleset.toUpperCase())} Campaign`,
            ruleset: effectiveRuleset,
            systemKey,
            systemLabel: genreObj.label || systemKey,
            genreEstablished: Boolean(genreKey && genres[genreKey]),
            premise: '',
            tone: '',
            createdAt: Date.now(),
        },
        protagonist: adapter.createEmptyProtagonist(systemKey),
        npcs: [],
        monsters: [],
        maps: [],
        factions: [],
        theKick: {
            startingLocation: '',
            crisis: '',
            openingPrompt: '',
        },
        cyoaExamples: [],
        worldRules: {
            axioms: [],
            customModule: null,
        },
        contemplation: {
            coreTension: '',
            worldConsequences: '',
            webOfEntanglement: '',
            kickPressure: '',
        },
        config: adapter.createEmptyConfig(systemKey),
    };

    if (typeof adapter.postProcessEmptyDossier === 'function') {
        adapter.postProcessEmptyDossier(dossier);
    }

    return dossier;
}

/**
 * Determines whether a Campaign Dossier is in an untouched/empty default state.
 * @param {object} dossier
 * @returns {boolean}
 */
export function isDossierEmptyOrUntouched(dossier) {
    if (!dossier || typeof dossier !== 'object') return true;
    const meta = dossier.meta || {};
    const proto = dossier.protagonist || {};
    const npcs = dossier.npcs || [];
    const monsters = dossier.monsters || [];
    const maps = dossier.maps || [];
    const factions = dossier.factions || [];
    const kick = dossier.theKick || {};
    const worldRules = dossier.worldRules || {};

    const hasTitle = Boolean(
        meta.title &&
        meta.title.trim() !== '' &&
        !/^untitled\s+.*campaign$/i.test(meta.title.trim())
    );
    const hasPremise = Boolean(meta.premise && meta.premise.trim() !== '');
    const hasProto = Boolean(
        (proto.name && proto.name.trim() !== '') ||
        (Array.isArray(proto.positiveTags) && proto.positiveTags.length > 0)
    );
    const hasNpcs = Array.isArray(npcs) && npcs.length > 0;
    const hasMonsters = Array.isArray(monsters) && monsters.length > 0;
    const hasMaps = Array.isArray(maps) && maps.length > 0;
    const hasFactions = Array.isArray(factions) && factions.length > 0;
    const hasKick = Boolean(
        (kick.startingLocation && kick.startingLocation.trim() !== '') ||
        (kick.crisis && kick.crisis.trim() !== '') ||
        (kick.openingPrompt && kick.openingPrompt.trim() !== '')
    );
    const hasCustomRules = Boolean(
        (worldRules.axioms && worldRules.axioms.length > 0) ||
        worldRules.customModule
    );

    return !hasTitle && !hasPremise && !hasProto && !hasNpcs && !hasMonsters && !hasMaps && !hasFactions && !hasKick && !hasCustomRules;
}

/**
 * Validates whether a Session Zero draft payload can be fully and safely restored.
 * Returns the healed and normalized draft object if valid, or null if incomplete/corrupted.
 *
 * Requirements for valid restoration:
 * 1. draft must be a non-null object.
 * 2. draft.chatHistory must be a non-empty Array containing valid message objects with a role.
 * 3. draft.dossier must be a valid object with at least meta and protagonist.
 * 4. draft.dossier must pass schema normalization via healAndNormalizeDossier.
 *
 * @param {object} draft
 * @returns {object|null} Validated and healed draft, or null if invalid/corrupt
 */
export function validateDraft(draft) {
    if (!draft || typeof draft !== 'object') return null;

    // 1. Must have valid chatHistory array
    if (!Array.isArray(draft.chatHistory)) {
        return null;
    }

    // Every item in chatHistory must be an object with a role string
    const allMessagesValid = draft.chatHistory.every(m => m && typeof m === 'object' && typeof m.role === 'string');
    if (!allMessagesValid) {
        return null;
    }

    // 2. Must have valid dossier structure with meta and protagonist
    if (!draft.dossier || typeof draft.dossier !== 'object' || !draft.dossier.meta || !draft.dossier.protagonist) {
        return null;
    }

    // 3. If chatHistory is empty AND dossier is untouched, there is no meaningful draft
    if (draft.chatHistory.length === 0 && isDossierEmptyOrUntouched(draft.dossier)) {
        return null;
    }

    // 3. Must be healable without error
    try {
        const healedDossier = healAndNormalizeDossier(draft.dossier);
        if (!healedDossier || !healedDossier.meta || !healedDossier.protagonist) {
            return null;
        }

        return {
            dossier: healedDossier,
            chatHistory: draft.chatHistory,
            changelog: Array.isArray(draft.changelog) ? draft.changelog : [],
            originChatId: typeof draft.originChatId === 'string' ? draft.originChatId : (draft.originChatId || null),
            originCampaignTitle: typeof draft.originCampaignTitle === 'string' ? draft.originCampaignTitle : (draft.originCampaignTitle || null),
            timestamp: typeof draft.timestamp === 'number' ? draft.timestamp : Date.now(),
        };
    } catch (_) {
        return null;
    }
}

export const SYSTEM_ALIASES = {
    modern: 'horror',
    'monster of the week': 'horror',
    motw: 'horror',
    pirates: 'pirate',
    piracy: 'pirate',
    swashbuckler: 'pirate',
    cosmic: 'cosmic_horror',
    lovecraft: 'cosmic_horror',
    cthulhu: 'cosmic_horror',
    survival: 'survival_horror',
    'survival horror': 'survival_horror',
    'post-apocalyptic': 'post_apocalyptic',
    'post apocalyptic': 'post_apocalyptic',
    apocalypse: 'post_apocalyptic',
    apocalyptic: 'post_apocalyptic',
    heist: 'gothic_heist',
    'gothic heist': 'gothic_heist',
    blades: 'gothic_heist',
    cyberpunk: 'scifi',
    sprawl: 'scifi',
    shonen: 'anime',
    superheroes: 'anime',
    masks: 'anime',
    dungeonworld: 'fantasy',
    'dungeon world': 'fantasy',
    fellowship: 'fantasy',
    'slice of life': 'slice_of_life',
    slice: 'slice_of_life',
    cozy: 'slice_of_life',
    wanderhome: 'slice_of_life',
    yazeba: 'slice_of_life',
    'small town': 'slice_of_life',
    'osr dungeon': 'osr_dungeon',
    osr: 'osr_dungeon',
    'cyberpunk noir': 'cyberpunk_noir',
    'deep space': 'deep_space',
    'weird west': 'weird_west',
};

/**
 * Normalizes raw system engine keys into canonical PBTA_GENRES or FAE_GENRES keys.
 * @param {string} rawKey
 * @returns {string|null}
 */
export function normalizeSystemKey(rawKey) {
    if (!rawKey) return null;
    const clean = rawKey.trim().toLowerCase().replace(/[\s\-_]+/g, '_');
    if (PBTA_GENRES[clean]) return clean;
    if (FAE_GENRES && FAE_GENRES[clean]) return clean;
    if (SYSTEM_ALIASES[clean]) return SYSTEM_ALIASES[clean];
    const plain = rawKey.trim().toLowerCase();
    if (SYSTEM_ALIASES[plain]) return SYSTEM_ALIASES[plain];
    return null;
}

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
 * Clamps a relationship score to MultiHog's standard -150..+150 scale.
 * @param {any} val
 * @returns {number}
 */
export function clampRelationshipScore(val) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return 0;
    return Math.max(-150, Math.min(150, num));
}

/**
 * Infers initial Friendship and Affection scores from role and narrative bond text.
 * Used when explicit numbers are omitted in the blueprint.
 * @param {string} [role]
 * @param {string} [relText]
 * @returns {{ friendship: number, affection: number }}
 */
export function inferStartingNpcRelationships(roleOrNpc = '', relText = '') {
    let combined = '';
    if (typeof roleOrNpc === 'object' && roleOrNpc !== null) {
        combined = `${roleOrNpc.role || ''} ${roleOrNpc.relationship || ''} ${roleOrNpc.demeanor || ''}`.toLowerCase();
    } else {
        combined = `${roleOrNpc || ''} ${relText || ''}`.toLowerCase();
    }
    if (/(lover|spouse|partner|husband|wife|fianc[ée]|boyfriend|girlfriend|sweetheart|romance)/i.test(combined)) {
        return { friendship: 35, affection: 60 };
    }
    if (/(rival|competitor|enemy|adversary|hostile|nemesis|hates|grudge)/i.test(combined)) {
        return { friendship: -30, affection: 0 };
    }
    if (/(mentor|patron|confidant|sworn brother|sworn sister|best friend|loyal)/i.test(combined)) {
        return { friendship: 45, affection: 0 };
    }
    if (/(ally|friend|companion|contact)/i.test(combined)) {
        return { friendship: 25, affection: 0 };
    }
    return { friendship: 0, affection: 0 };
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
function parseKeyValueLines(block) {
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
function parseBulletList(block, sectionKey) {
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
 * Strips echoed prompt placeholders (like "gender/subtype") from a species string.
 * @param {string} val
 * @returns {string}
 */
export function sanitizeSpeciesValue(val) {
    if (!val || typeof val !== 'string') return '';
    return val
        .replace(/,\s*gender\s*\/\s*subtype/gi, '')
        .replace(/\(\s*gender\s*\/\s*subtype\s*\)/gi, '')
        .replace(/\bgender\s*\/\s*subtype\b/gi, '')
        .replace(/\bspecies\s*\/\s*ancestry\b/gi, '')
        .replace(/^[,\s;]+|[,\s;]+$/g, '')
        .trim();
}

/**
 * Normalizes a list or string of PbtA conditions, stripping echoed prompt hints
 * (like "(-) Starting injury or weakness:") and ensuring debilities carry a (-) prefix.
 * @param {string[]|string} rawConds
 * @returns {string[]}
 */
export function sanitizeConditionsList(rawConds) {
    const items = Array.isArray(rawConds)
        ? rawConds.flatMap(c => typeof c === 'string' ? splitTopLevelItems(c, { splitCommas: true }) : [])
        : typeof rawConds === 'string'
            ? splitTopLevelItems(rawConds, { splitCommas: true })
            : [];

    const out = [];
    for (const rawItem of items) {
        let s = String(rawItem || '').replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim();
        if (!s) continue;

        let prefix = '';
        const prefixMatch = s.match(/^(\([+-]\))\s*(.*)$/);
        if (prefixMatch) {
            prefix = prefixMatch[1];
            s = prefixMatch[2].trim();
        }

        // Strip echoed prompt template hints
        s = s.replace(/^starting\s+injury\s+or\s+weakness\s*(?:[:—–-]\s*)?/i, '').trim();
        // If stripping the prefix left an outer parenthetical "(Tinnitus...)", unwrap it
        if (s.startsWith('(') && s.endsWith(')') && !s.slice(1, -1).includes('(')) {
            s = s.slice(1, -1).trim();
        }

        if (!s || /^(?:none|n\/a|null|healthy|uninjured|omit if healthy)$/i.test(s)) {
            continue;
        }

        // Capitalize first letter if lowercase
        if (/^[a-z]/.test(s)) {
            s = s.charAt(0).toUpperCase() + s.slice(1);
        }

        const finalPrefix = prefix || '(-)';
        out.push(`${finalPrefix} ${s}`);
    }
    return out;
}

/**
 * Checks whether a gear array is empty or contains only stock fallback placeholders.
 * @param {any} gear
 * @returns {boolean}
 */
export function isPlaceholderGearList(gear) {
    if (!Array.isArray(gear) || gear.length === 0) return true;
    return gear.every(g => {
        const s = String(g || '').trim();
        return !s || /^(?:Essential adventurer kit|Signature weapon|Basic equipment)/i.test(s);
    });
}

/**
 * Splits a freeform equipment string into individual gear items for HUD pills.
 * @param {string} equipStr
 * @returns {string[]}
 */
export function splitEquipmentIntoGearList(equipStr) {
    if (!equipStr || typeof equipStr !== 'string') return [];
    return splitTopLevelItems(equipStr, { splitCommas: true })
        .map(item => {
            const trimmed = item.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim();
            if (!trimmed) return '';
            return /^[a-z]/.test(trimmed) ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
        })
        .filter(Boolean);
}

/**
 * Resilient list item parser for bullet lines or inline comma/semicolon-separated values.
 * Ignores delimiters inside parentheses like "(+2, +1, +1, 0, -1)".
 * @param {string} block
 * @param {string} sectionKey
 * @param {{ splitCommas?: boolean }} [opts]
 * @returns {string[]}
 */
function parseBulletOrListItems(block, sectionKey, { splitCommas = true } = {}) {
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
 * Formats a live dossier object into a clean, compact markdown representation
 * pinned into LLM context as the single Source of Truth.
 *
 * @param {object} dossier
 * @returns {string}
 */
export function formatDossierForContext(dossier) {
    if (!dossier) {
        return `[CURRENT_CAMPAIGN_DOSSIER]\nStatus: UNINITIALIZED\n[/CURRENT_CAMPAIGN_DOSSIER]`;
    }
    const meta = dossier.meta || {};
    const p = dossier.protagonist || {};
    const npcs = dossier.npcs || [];
    const monsters = dossier.monsters || [];
    const maps = dossier.maps || [];
    const kick = dossier.theKick || {};

    const hasAnyContent = !!(
        (meta.premise && meta.premise.trim()) ||
        (p.name && p.name.trim()) ||
        npcs.length > 0 ||
        monsters.length > 0 ||
        maps.length > 0 ||
        (dossier.worldRules?.axioms && dossier.worldRules.axioms.length > 0) ||
        (dossier.worldRules?.customModule != null) ||
        kick.crisis ||
        kick.startingLocation
    );

    if (!hasAnyContent) {
        return `[CURRENT_CAMPAIGN_DOSSIER]
Status: UNINITIALIZED (No campaign elements established yet)
System: ${meta.systemLabel || 'Fantasy (Dungeon World)'}
Protagonist: Unset
NPCs: None
Monsters: None
Maps: None
The Kick: Unset
[/CURRENT_CAMPAIGN_DOSSIER]`;
    }

    const isFae = meta.ruleset === 'fae';
    const lines = [
        '[CURRENT_CAMPAIGN_DOSSIER]',
        'Status: IN_PROGRESS',
        `Title: ${meta.title || (isFae ? 'Untitled FAE Campaign' : 'Untitled Campaign')}`,
        `System: ${meta.systemLabel || (isFae ? 'Cosmic Horror' : 'Fantasy')} (${meta.systemKey || (isFae ? 'cosmic_horror' : 'fantasy')})${isFae ? ' [FAE]' : ''}`,
        meta.premise ? `Premise: ${meta.premise}` : null,
    ];

    // Full-detail view, written in the same key: value shape as [UPDATE_DOSSIER] blocks so the
    // model can copy names/keys exactly and emit precise partial edits.
    const cfg = dossier.config || {};
    const isHeroicTier = Boolean(cfg.heroicTier ?? cfg.knobs?.heroic_tier ?? false);
    const actionTempoStr = cfg.actionTempo || cfg.knobs?.action_tempo || 'gritty_default';
    const fatePart = cfg.maxHarmFate?.rule ? `, max_harm_fate=${cfg.maxHarmFate.rule}` : '';
    const knobsPart = (isFae && cfg.knobs)
        ? `, action_tempo=${actionTempoStr}, heroic_tier=${isHeroicTier ? 'on' : 'off'}, flee_grace=${cfg.knobs.flee_grace_toggle ? 'on' : 'off'}, base_attrition_shift=${cfg.knobs.base_attrition_shift ?? 0}, overflow_default=${cfg.knobs.overflow_default || 'scar_and_ko'}, pacing_scenes=${cfg.pacingScenes ?? 4}`
        : '';
    lines.push(`Config: playstyle=${cfg.playstyle ?? 'cyoa_5'}, harm_max=${cfg.harmMax ?? 5}, party_mode=${cfg.partyMode ?? 'squad'}, cyoa_emojis=${cfg.cyoaEmojis !== false}, art_style=${cfg.artStyle || '(none)'}, pacing_xp=${cfg.pacingXp ?? 5}, simulation_depth=${cfg.simulationDepth ?? 'active_fronts'}, relationships=${cfg.relationships !== false ? 'on' : 'off'}${fatePart}${knobsPart}`);
    if (meta.tone) lines.push(`Tone: ${meta.tone}`);

    if (p.name || p.playbook || (isFae && (p.positiveTags?.length || (p.pools && Object.keys(p.pools).length)))) {
        lines.push('[PROTAGONIST]');
        lines.push(`name: ${p.name || 'Unnamed Adventurer'}`);
        lines.push(`playbook: ${p.playbook || (isFae ? 'Investigator' : 'In Development')}`);
        if (p.species) lines.push(`species: ${p.species}`);
        if (p.appearance) lines.push(`appearance: ${p.appearance}`);
        if (p.equipment) lines.push(`equipment: ${p.equipment}`);
        if (p.personality) lines.push(`personality: ${p.personality}`);
        if (p.background) lines.push(`background: ${p.background}`);
        if (p.habits) lines.push(`habits: ${p.habits}`);
        if (isFae) {
            if (isHeroicTier || p.heroicDomain) {
                lines.push(`heroic_domain: ${p.heroicDomain || 'Archetype [specific domains]'}`);
            }
            if (p.positiveTags && p.positiveTags.length) {
                lines.push(`positive_tags: ${p.positiveTags.join(', ')}`);
            }
            if (p.negativeTags && p.negativeTags.length) {
                lines.push(`negative_tags: ${p.negativeTags.join(', ')}`);
            }
            if (p.pools && Object.keys(p.pools).length) {
                const poolStrs = Object.values(p.pools).map(pl => `${pl.label}: ${pl.current}/${pl.max} (zero_debuff: ${pl.zero_debuff || 'None'}, recovery: ${pl.recovery || ''}, overflow: ${pl.on_overflow || ''})`);
                lines.push(`pools: ${poolStrs.join(' | ')}`);
            }
        } else {
            if (p.stats && Object.keys(p.stats).length) {
                lines.push(`stats: ${Object.entries(p.stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`);
            }
            if (p.harm) {
                const curH = parseInt(p.harm.current, 10) || 0;
                const maxH = parseInt(p.harm.max, 10) || 5;
                lines.push(curH > 0 ? `harm: ${curH}/${maxH}` : `harm: ${maxH}`);
                lines.push(`armor: ${p.harm?.armor ?? 0}`);
            } else {
                lines.push('harm: 5');
                lines.push('armor: 0');
            }
        }
        if (!isFae && p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) {
            lines.push(`conditions: ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}`);
        }
        if (p.status) lines.push(`status: ${p.status}`);
        if (!isFae && p.startingMoves && p.startingMoves.length) {
            lines.push('moves:');
            p.startingMoves.forEach(mv => lines.push(`- ${mv}`));
        }
        if (p.gear && p.gear.length) lines.push(`gear: ${p.gear.join(', ')}`);
        if (p.bio) lines.push(`bio: ${p.bio}`);
        lines.push(`portrait: ${p.portraitSrc ? 'set' : 'none'}`);
        lines.push('[/PROTAGONIST]');
    } else {
        lines.push('Protagonist: Unset');
    }

    if (npcs.length) {
        lines.push(`NPCs (${npcs.length}):`);
        npcs.forEach(n => {
            lines.push('[NPC]');
            lines.push(`name: ${n.name}`);
            const fields = [
                ['role', n.role], ['archetype', n.archetype], ['species', n.species], ['appearance', n.appearance],
                ['equipment', n.equipment], ['demeanor', n.demeanor], ['background', n.background],
                ['relationship', n.relationship],
                ['friendship', n.friendship !== undefined ? n.friendship : null],
                ['affection', n.affection !== undefined ? n.affection : null],
                ['moves_or_boons', n.movesOrBoons], ['notes', n.notes],
            ];
            if (n.harm) {
                const curH = parseInt(n.harm.current, 10) || 0;
                const maxH = parseInt(n.harm.max, 10) || 5;
                if (curH > 0) fields.push(['harm', `${curH}/${maxH}`]);
                if (n.harm.armor) fields.push(['armor', n.harm.armor]);
            }
            if (n.conditions && (Array.isArray(n.conditions) ? n.conditions.length : String(n.conditions).trim())) {
                fields.push(['conditions', Array.isArray(n.conditions) ? n.conditions.join(', ') : n.conditions]);
            }
            if (n.status) fields.push(['status', n.status]);
            fields.forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') lines.push(`${k}: ${v}`); });
            lines.push('[/NPC]');
        });
    } else {
        lines.push('NPCs: None');
    }

    if (monsters.length) {
        lines.push(`Monsters (${monsters.length}):`);
        monsters.forEach(m => {
            lines.push('[MONSTER]');
            lines.push(`name: ${m.name}`);
            const curHarm = parseInt(m.currentHarm ?? m.harm?.current ?? m.currentLayers, 10) || 0;
            const maxHarm = parseInt(m.harm?.max ?? m.harm ?? m.layers, 10) || 4;
            if (isFae) {
                if (m.threatLevel !== undefined && m.threatLevel !== null) lines.push(`threat_level: ${m.threatLevel}`);
                lines.push(`layers: ${curHarm > 0 ? `${curHarm}/${maxHarm}` : `${maxHarm}`}`);
                if (m.poolsAtRisk) lines.push(`pools_at_risk: ${Array.isArray(m.poolsAtRisk) ? m.poolsAtRisk.join(', ') : m.poolsAtRisk}`);
                if (m.pressures && m.pressures.length) lines.push(`pressures: ${Array.isArray(m.pressures) ? m.pressures.join(', ') : m.pressures}`);
                if (m.instinct) lines.push(`instinct: ${m.instinct}`);
                if (m.status) lines.push(`status: ${m.status}`);
                if (m.leverageBarriers && m.leverageBarriers.length) lines.push(`leverage_barriers: ${Array.isArray(m.leverageBarriers) ? m.leverageBarriers.join(', ') : m.leverageBarriers}`);
                if (m.fullFinishTriggers) lines.push(`full_finish_triggers: ${m.fullFinishTriggers}`);
            } else {
                lines.push(curHarm > 0 ? `harm: ${curHarm}/${maxHarm}` : `harm: ${maxHarm}`);
                lines.push(`armor: ${m.armor || 0}`);
                if (m.status) lines.push(`status: ${m.status}`);
                if (m.attacks && m.attacks.length) lines.push(`attacks: ${[].concat(m.attacks).join(', ')}`);
                lines.push(`weakness: ${m.weakness || 'Unknown'}`);
                if (m.impendingDoom && m.impendingDoom.length) {
                    lines.push('countdown:');
                    m.impendingDoom.forEach(d => lines.push(`- ${d}`));
                }
            }
            if (m.notes) lines.push(`notes: ${m.notes}`);
            lines.push('[/MONSTER]');
        });
    } else {
        lines.push('Monsters: None');
    }

    if (maps.length) {
        lines.push(`Maps (${maps.length}):`);
        maps.forEach(m => {
            lines.push('[MAP]');
            lines.push(`site: ${m.site}`);
            lines.push(`kind: ${m.kind}`);
            lines.push(`threat: ${m.threat}`);
            if (m.entrance) lines.push(`entrance: ${m.entrance}`);
            if (m.prompt) lines.push(`prompt: ${m.prompt}`);
            if (m.briefDescription) lines.push(`brief_description: ${m.briefDescription}`);
            lines.push(`status: ${m.status || 'queued'}`);
            lines.push('[/MAP]');
        });
    } else {
        lines.push('Maps: None');
    }

    if (dossier.factions && dossier.factions.length) {
        lines.push(`Factions (${dossier.factions.length}):`);
        dossier.factions.forEach(f => {
            lines.push('[FACTION]');
            lines.push(`name: ${f.name}`);
            if (f.agenda) lines.push(`agenda: ${f.agenda}`);
            if (f.standing) lines.push(`standing: ${f.standing}`);
            if (f.notes) lines.push(`notes: ${f.notes}`);
            lines.push('[/FACTION]');
        });
    } else {
        lines.push('Factions: None');
    }

    if (kick.startingLocation || kick.crisis || kick.openingPrompt) {
        lines.push('[KICK]');
        if (kick.startingLocation) lines.push(`starting_location: ${kick.startingLocation}`);
        if (kick.crisis) lines.push(`crisis: ${kick.crisis}`);
        if (kick.openingPrompt) lines.push(`opening_prompt: ${kick.openingPrompt}`);
        lines.push('[/KICK]');
    } else {
        lines.push('The Kick: Unset');
    }

    if (dossier.cyoaExamples && dossier.cyoaExamples.length) {
        lines.push('[CYOA]');
        dossier.cyoaExamples.forEach(c => lines.push(`- ${c}`));
        lines.push('[/CYOA]');
    }

    if (dossier.worldRules?.axioms && dossier.worldRules.axioms.length) {
        lines.push(`World Rules (${dossier.worldRules.axioms.length}):`);
        dossier.worldRules.axioms.forEach(r => {
            lines.push('[WORLD_RULES]');
            lines.push(`title: ${r.title}`);
            if (r.category) lines.push(`category: ${r.category}`);
            if (r.axiom) lines.push(`axiom: ${r.axiom}`);
            if (r.substitutions && r.substitutions.length) {
                lines.push('substitutions:');
                r.substitutions.forEach(s => lines.push(`- ${s}`));
            }
            if (r.negativeConstraints && r.negativeConstraints.length) {
                lines.push('negative_constraints:');
                r.negativeConstraints.forEach(nc => lines.push(`- ${nc}`));
            }
            if (r.architecturalNotes) lines.push(`architectural_notes: ${r.architecturalNotes}`);
            lines.push('[/WORLD_RULES]');
        });
    }

    if (dossier.worldRules?.customModule) {
        const cm = dossier.worldRules.customModule;
        lines.push('[CUSTOM_MODULE]');
        lines.push(`tag: ${cm.tag}`);
        lines.push(`label: ${cm.label}`);
        if (cm.icon) lines.push(`icon: ${cm.icon}`);
        if (cm.instruction) lines.push(`instruction: ${cm.instruction}`);
        if (cm.sampleContent) lines.push(`sample: ${cm.sampleContent}`);
        lines.push('[/CUSTOM_MODULE]');
    }

    lines.push('[/CURRENT_CAMPAIGN_DOSSIER]');
    return lines.filter(Boolean).join('\n');
}

/**
 * Formats recent changelog records into a compact section for LLM context.
 * @param {string[]} changelog
 * @param {number} [maxEntries=8]
 * @returns {string}
 */
export function formatChangelogForContext(changelog, maxEntries = 8) {
    if (!Array.isArray(changelog) || !changelog.length) {
        return `[RECENT_CHANGELOG]\n(No blueprint mutations recorded yet)\n[/RECENT_CHANGELOG]`;
    }
    const recent = changelog.slice(-maxEntries);
    return `[RECENT_CHANGELOG]\n${recent.map(c => `- ${c}`).join('\n')}\n[/RECENT_CHANGELOG]`;
}

/**
 * Applies updates from Concierge text to a dossier, returning a detailed
 * transaction result report (changes, errors, and updated dossier).
 *
 * Supports both [UPDATE_DOSSIER] / [CONCIERGE_STATE] wrapper blocks and
 * standalone blocks ([PROTAGONIST], [NPC], etc.).
 *
 * @param {string} text LLM response text
 * @param {object} dossier Current dossier to patch
 * @returns {{
 *   success: boolean,
 *   updatedDossier: object,
 *   changes: string[],
 *   errors: string[],
 *   hasMutations: boolean
 * }}
 */
const NEXT_DOSSIER_BLOCK_LOOKAHEAD = String.raw`(?=\n[ \t]*\[(?:\/?(?:UPDATE_DOSSIER|CONCIERGE_STATE|CONTEMPLATION|CONFIG|CYOA|PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|WORLD_RULES?|CUSTOM_MODULE))(?::[^\n\]]+)?\][ \t]*(?:\r?\n|$))`;

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
function matchDossierSectionBlocks(raw, tagRegexStr, closeTagRegexStr) {
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

export function applyDossierUpdates(text, dossier) {
    const fallbackResult = {
        success: true,
        updatedDossier: dossier,
        changes: [],
        errors: [],
        hasMutations: false,
        isNoop: false,
        builderSummary: 'No blueprint mutations detected',
        contemplation: null,
    };

    if (!text || typeof text !== 'string') return fallbackResult;

    // Strip any closed <think>...</think> blocks before parsing directives
    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!cleanedText) return fallbackResult;

    // 0. Check for explicit NOOP (standalone line-start [NOOP] or explicitly closed [NOOP]...[/NOOP])
    const noopMatch = cleanedText.match(/(?:^|\n)[ \t]*\[NOOP\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/NOOP\]|$)/i)
        || cleanedText.match(/\[NOOP\]([\s\S]*?)\[\/NOOP\]/i);
    const isExplicitNoop = Boolean(noopMatch) || /^\s*\[NOOP\]\s*$/i.test(cleanedText);
    if (isExplicitNoop) {
        let noopSummary = '';
        if (noopMatch && noopMatch[1]) {
            const sm = noopMatch[1].match(/summary\s*:\s*([^\n\r]+)/i);
            if (sm) {
                noopSummary = sm[1].trim()
                    .replace(/^(\*\*|__)(.*?)\1$/, '$2')
                    .replace(/^["'“”‘’](.*)["'“”‘’]$/, '$1')
                    .trim();
            }
        }
        return {
            success: true,
            updatedDossier: dossier,
            changes: [],
            errors: [],
            hasMutations: false,
            isNoop: true,
            builderSummary: noopSummary || 'No blueprint changes requested',
            contemplation: null,
        };
    }

    // 1. Locate directive content: [UPDATE_DOSSIER] or [CONCIERGE_STATE]
    let raw = null;
    const updateMatch = cleanedText.match(/(?:^|\n)[ \t]*\[UPDATE_DOSSIER\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/UPDATE_DOSSIER\]|$)/i)
        || cleanedText.match(/\[UPDATE_DOSSIER\]([\s\S]*?)\[\/UPDATE_DOSSIER\]/i);
    const stateMatch = cleanedText.match(/(?:^|\n)[ \t]*\[CONCIERGE_STATE\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/CONCIERGE_STATE\]|$)/i)
        || cleanedText.match(/\[CONCIERGE_STATE\]([\s\S]*?)\[\/CONCIERGE_STATE\]/i);

    if (updateMatch) {
        raw = updateMatch[1];
    } else if (stateMatch) {
        raw = stateMatch[1];
    } else {
        // Do NOT scrape fallback blocks out of an unfinished chain-of-thought reasoning dump
        const isCoTPreamble = /^\s*(?:<think>|Here(?:'s| is) a thinking process|Thinking Process:|Let's think step by step|1\.\s+\*\*(?:Analyze|Understand|Evaluate)\b)/i.test(cleanedText);
        if (isCoTPreamble) {
            return fallbackResult;
        }
        // Fallback: check if text contains standalone line-start blocks or explicitly closed blocks directly
        const hasDirectBlocks = /(?:^|\n)[ \t]*\[(?:CONTEMPLATION|CONFIG|CYOA|PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|WORLD_RULES?|CUSTOM_MODULE|REMOVE_NPC|REMOVE_MONSTER|REMOVE_MAP|REMOVE_FACTION|REMOVE_WORLD_RULE|REMOVE_CUSTOM_MODULE|CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS|CLEAR_FACTIONS|CLEAR_WORLD_RULES)(?::[^\n\]]+)?\][ \t]*(?:\r?\n|$)/i.test(cleanedText);
        if (hasDirectBlocks) {
            raw = cleanedText;
        }
    }

    if (!raw) return fallbackResult;

    const updated = JSON.parse(JSON.stringify(dossier));
    const changes = [];
    const errors = [];

    // 0b. Extract [CONTEMPLATION] architectural reasoning scratchpad (inside or alongside [UPDATE_DOSSIER])
    let extractedContemplation = null;
    const contempBlocks = matchDossierSectionBlocks(raw, 'CONTEMPLATION', 'CONTEMPLATION');
    const contempContent = contempBlocks[0]?.content
        || (cleanedText.match(/\[CONTEMPLATION\]([\s\S]*?)\[\/CONTEMPLATION\]/i)?.[1] ?? null);
    if (contempContent) {
        const cKv = parseKeyValueLines(contempContent);
        const coreTension = (cKv.core_tension || cKv.coretension || cKv.tension || '').trim();
        const worldConsequences = (cKv.world_consequences || cKv.worldconsequences || cKv.consequences || '').trim();
        const webOfEntanglement = (cKv.web_of_entanglement || cKv.webofentanglement || cKv.entanglement || cKv.connections || '').trim();
        const kickPressure = (cKv.kick_pressure || cKv.kickpressure || cKv.pressure || '').trim();
        if (coreTension || worldConsequences || webOfEntanglement || kickPressure) {
            extractedContemplation = {
                coreTension: coreTension || updated.contemplation?.coreTension || '',
                worldConsequences: worldConsequences || updated.contemplation?.worldConsequences || '',
                webOfEntanglement: webOfEntanglement || updated.contemplation?.webOfEntanglement || '',
                kickPressure: kickPressure || updated.contemplation?.kickPressure || '',
            };
            updated.contemplation = extractedContemplation;
        }
    }

    // Pre-extract section blocks so top-level metadata keys (title:, system:, premise:, tone:, summary:)
    // never accidentally match keys inside [WORLD_RULES], [CUSTOM_MODULE], [PROTAGONIST], etc.
    const protoBlocks = matchDossierSectionBlocks(raw, 'PROTAGONIST', 'PROTAGONIST');
    const npcBlocks = matchDossierSectionBlocks(raw, 'NPC(?::\\s*([^\\]\\r\\n]+))?', 'NPC');
    const monsterBlocks = matchDossierSectionBlocks(raw, 'MONSTER(?::\\s*([^\\]\\r\\n]+))?', 'MONSTER');
    const mapBlocks = matchDossierSectionBlocks(raw, 'MAP(?::\\s*([^\\]\\r\\n]+))?', 'MAP');
    const factionBlocks = matchDossierSectionBlocks(raw, 'FACTION(?::\\s*([^\\]\\r\\n]+))?', 'FACTION');
    const kickBlocks = matchDossierSectionBlocks(raw, 'KICK', 'KICK');
    const cyoaBlocks = matchDossierSectionBlocks(raw, 'CYOA', 'CYOA');
    const ruleBlocks = matchDossierSectionBlocks(raw, 'WORLD_RULES?', 'WORLD_RULES?');
    const customModuleBlocks = matchDossierSectionBlocks(raw, 'CUSTOM_MODULE', 'CUSTOM_MODULE');
    const configBlocks = matchDossierSectionBlocks(raw, 'CONFIG', 'CONFIG');

    let topLevelRaw = raw;
    for (const group of [
        contempBlocks,
        protoBlocks,
        npcBlocks,
        monsterBlocks,
        mapBlocks,
        factionBlocks,
        kickBlocks,
        cyoaBlocks,
        ruleBlocks,
        customModuleBlocks,
        configBlocks,
    ]) {
        for (const blk of group) {
            if (blk.fullMatch) {
                topLevelRaw = topLevelRaw.replace(blk.fullMatch, '\n');
            }
        }
    }

    // Extract builder summary if emitted at top level
    let builderSummary = null;
    const summaryMatch = topLevelRaw.match(/summary\s*:\s*([^\n\r]+)/i);
    if (summaryMatch) {
        builderSummary = summaryMatch[1].trim()
            .replace(/^(\*\*|__)(.*?)\1$/, '$2')
            .replace(/^["'“”‘’](.*)["'“”‘’]$/, '$1')
            .trim();
    }

    // ── 1. Meta / System ────────────────────────────────────────────────────────
    const rulesetMatch = topLevelRaw.match(/ruleset\s*:\s*([^\n\r]+)/i);
    if (rulesetMatch) {
        const rVal = rulesetMatch[1].trim().toLowerCase();
        if (rVal === 'fae' || rVal === 'pbta') {
            if (updated.meta.ruleset !== rVal) {
                updated.meta.ruleset = rVal;
                changes.push(`Ruleset set to ${rVal.toUpperCase()}`);
            }
        }
    }

    const sysLabelMatch = topLevelRaw.match(/system_label\s*:\s*([^\n\r]+)/i);

    const sysMatch = topLevelRaw.match(/system\s*:\s*([^\n\r]+)/i);
    if (sysMatch) {
        let rawKey = sysMatch[1].trim();
        if (/^fae[:/]/i.test(rawKey)) {
            updated.meta.ruleset = 'fae';
            rawKey = rawKey.replace(/^fae[:/]\s*/i, '').trim();
        }
        const isFae = updated.meta?.ruleset === 'fae' || Boolean(FAE_GENRES[rawKey.toLowerCase()]);
        if (isFae) {
            updated.meta.ruleset = 'fae';
            updated.meta.genreEstablished = true;
            const normFaeKey = rawKey.toLowerCase();
            if (FAE_GENRES[normFaeKey]) {
                const key = normFaeKey;
                const nextLabel = sysLabelMatch ? sysLabelMatch[1].trim() : FAE_GENRES[key].label;
                if (updated.meta.systemKey !== key || updated.meta.systemLabel !== nextLabel) {
                    changes.push(`FAE Engine set to ${nextLabel} (${key})`);
                }
                updated.meta.systemKey = key;
                updated.meta.systemLabel = nextLabel;

                const clonedPools = {};
                for (const [k, p] of Object.entries(FAE_GENRES[key].pools)) {
                    clonedPools[k] = { ...p, key: p.key || k, passive_drain: p.passive_drain ? { ...p.passive_drain } : null };
                }
                updated.protagonist.pools = clonedPools;
                updated.config = updated.config || {};
                updated.config.knobs = { ...FAE_GENRES[key].knobs };
                const genreTempo = FAE_GENRES[key].knobs?.action_tempo || 'gritty_default';
                if (updated.config.actionTempo === undefined || updated.meta.systemKey !== key) {
                    updated.config.actionTempo = genreTempo;
                }
                const genreHeroic = Boolean(FAE_GENRES[key].knobs?.heroic_tier);
                if (updated.config.heroicTier === undefined || updated.meta.systemKey !== key) {
                    updated.config.heroicTier = genreHeroic;
                    if (genreHeroic && !updated.protagonist.heroicDomain) {
                        updated.protagonist.heroicDomain = FAE_GENRES[key].defaultHeroicDomain || '';
                    }
                }
            } else {
                const customKey = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom';
                const customLabel = sysLabelMatch ? sysLabelMatch[1].trim() : (customKey === 'custom' ? 'Custom FAE Setting' : rawKey.trim());
                if (updated.meta.systemKey !== customKey || updated.meta.systemLabel !== customLabel) {
                    changes.push(`FAE Engine set to ${customLabel} (${customKey})`);
                }
                updated.meta.systemKey = customKey;
                updated.meta.systemLabel = customLabel;
            }
        } else {
            const key = normalizeSystemKey(rawKey);
            if (key && PBTA_GENRES[key]) {
                updated.meta.genreEstablished = true;
                if (updated.meta.systemKey !== key) {
                    updated.meta.systemKey = key;
                    updated.meta.systemLabel = PBTA_GENRES[key].label;
                    changes.push(`PbtA Engine set to ${updated.meta.systemLabel} (${key})`);
                }
            } else {
                errors.push(`Unknown system engine "${rawKey}". Available: ${Object.keys(PBTA_GENRES).join(', ')}`);
            }
        }
    } else if (updated.meta?.ruleset === 'fae' && !updated.meta.systemKey) {
        const key = 'cosmic_horror';
        updated.meta.systemKey = key;
        updated.meta.systemLabel = FAE_GENRES[key].label;
        if (!updated.protagonist.pools || Object.keys(updated.protagonist.pools).length === 0) {
            const clonedPools = {};
            for (const [k, p] of Object.entries(FAE_GENRES[key].pools)) {
                clonedPools[k] = { ...p, key: p.key || k, passive_drain: p.passive_drain ? { ...p.passive_drain } : null };
            }
            updated.protagonist.pools = clonedPools;
        }
        updated.config = updated.config || {};
        if (!updated.config.knobs) {
            updated.config.knobs = { ...FAE_GENRES[key].knobs };
        }
    }

    if (sysLabelMatch && !sysMatch) {
        const nextLabel = sysLabelMatch[1].trim();
        if (updated.meta.systemLabel !== nextLabel) {
            updated.meta.systemLabel = nextLabel;
            updated.meta.genreEstablished = true;
            changes.push(`System label set to "${nextLabel}"`);
        }
    }

    const titleMatch = topLevelRaw.match(/title\s*:\s*([^\n\r]+)/i);
    if (titleMatch) {
        const newTitle = titleMatch[1].trim()
            .replace(/^(\*\*|__)(.*?)\1$/, '$2')
            .replace(/^["'“”‘’](.*)["'“”‘’]$/, '$1')
            .trim();
        if (newTitle && updated.meta.title !== newTitle) {
            changes.push(`Campaign title set to "${newTitle}"`);
            updated.meta.title = newTitle;
        }
    }

    const premiseMatch = topLevelRaw.match(/premise\s*:\s*([^\n\r]+)/i);
    if (premiseMatch) {
        const newPremise = premiseMatch[1].trim().replace(/^(\*\*|__)(.*?)\1$/, '$2');
        if (newPremise && updated.meta.premise !== newPremise) {
            updated.meta.premise = newPremise;
            if (!updated.meta.title || updated.meta.title === 'Untitled PbtA Campaign') {
                updated.meta.title = newPremise.slice(0, 40) + '...';
            }
            changes.push(`Premise updated: "${newPremise}"`);
        }
    }

    const toneMatch = topLevelRaw.match(/tone\s*:\s*([^\n\r]+)/i);
    if (toneMatch) {
        const rawTone = cleanTargetName(toneMatch[1]);
        if (rawTone && updated.meta.tone !== rawTone) {
            updated.meta.tone = rawTone;
            changes.push(`Campaign tone set to: "${rawTone}"`);
        }
    }

    // ── 2. Protagonist ──────────────────────────────────────────────────────────
    if (protoBlocks.length > 0) {
        const pBlock = protoBlocks[0].content;
        const kv = parseKeyValueLines(pBlock);

        if (kv.name && updated.protagonist.name !== kv.name) {
            changes.push(`Protagonist name: "${kv.name}" (was "${updated.protagonist.name || 'Unnamed'}")`);
            updated.protagonist.name = kv.name;
        }
        const archVal = kv.archetype || kv.playbook;
        if (archVal && (updated.protagonist.playbook !== archVal || updated.protagonist.archetype !== archVal)) {
            changes.push(`Protagonist archetype/playbook: "${archVal}" (was "${updated.protagonist.archetype || updated.protagonist.playbook || 'None'}")`);
            updated.protagonist.playbook = archVal;
            updated.protagonist.archetype = archVal;
        }
        if (kv.bio && updated.protagonist.bio !== kv.bio) {
            updated.protagonist.bio = kv.bio;
            changes.push(`Protagonist bio updated`);
        }
        if (kv.species) {
            const cleanSp = sanitizeSpeciesValue(kv.species) || kv.species.trim();
            if (cleanSp && updated.protagonist.species !== cleanSp) {
                updated.protagonist.species = cleanSp;
                changes.push(`Protagonist species: "${updated.protagonist.species}"`);
            }
        }
        const app = (kv.appearance || kv.body || '').trim();
        if (app && updated.protagonist.appearance !== app) {
            updated.protagonist.appearance = app;
            changes.push(`Protagonist appearance updated`);
        }
        const equip = (kv.equipment || '').trim();
        if (equip && updated.protagonist.equipment !== equip) {
            updated.protagonist.equipment = equip;
            changes.push(`Protagonist equipment updated`);
        }
        const pers = (kv.personality || kv.demeanor || '').trim();
        if (pers && updated.protagonist.personality !== pers) {
            updated.protagonist.personality = pers;
            changes.push(`Protagonist personality updated`);
        }
        const bg = (kv.background || '').trim();
        if (bg && updated.protagonist.background !== bg) {
            updated.protagonist.background = bg;
            changes.push(`Protagonist background updated`);
        }
        if (kv.habits && updated.protagonist.habits !== kv.habits.trim()) {
            updated.protagonist.habits = kv.habits.trim();
            changes.push(`Protagonist habits updated`);
        }
        if (kv.stats) {
            const parsedStats = parseStatsString(kv.stats);
            if (Object.keys(parsedStats).length > 0) {
                updated.protagonist.stats = parsedStats;
                const statStr = Object.entries(parsedStats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ');
                changes.push(`Protagonist stats updated: ${statStr}`);
            } else {
                errors.push(`Could not parse protagonist stats: "${kv.stats}"`);
            }
        }
        if (kv.harm) {
            const slashMatch = String(kv.harm).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                const cur = parseInt(slashMatch[1], 10);
                const max = parseInt(slashMatch[2], 10);
                updated.protagonist.harm.current = Math.max(0, cur);
                updated.protagonist.harm.max = Math.max(1, max);
                changes.push(`Protagonist Harm set to ${updated.protagonist.harm.current}/${updated.protagonist.harm.max}`);
            } else {
                const h = parseInt(kv.harm, 10);
                if (!isNaN(h)) {
                    updated.protagonist.harm.max = h;
                    changes.push(`Protagonist Harm max set to ${h}`);
                }
            }
        }
        if (kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
            const curVal = parseInt(kv.current_harm ?? kv.harm_current ?? kv.wounds, 10);
            if (!isNaN(curVal)) {
                updated.protagonist.harm.current = Math.max(0, curVal);
                changes.push(`Protagonist starting Harm set to ${updated.protagonist.harm.current}`);
            }
        }
        if (kv.armor) {
            const a = parseInt(kv.armor, 10);
            if (!isNaN(a)) {
                updated.protagonist.harm.armor = a;
                changes.push(`Protagonist Armor set to ${a}`);
            }
        }
        const rawProtoConds = parseBulletOrListItems(pBlock, 'conditions');
        if (rawProtoConds.length || kv.conditions !== undefined) {
            if (updated.meta?.ruleset !== 'fae') {
                const condList = sanitizeConditionsList(rawProtoConds.length ? rawProtoConds : kv.conditions);
                updated.protagonist.conditions = condList;
                if (condList.length) {
                    changes.push(`Protagonist conditions set: ${condList.join(', ')}`);
                }
            } else {
                updated.protagonist.conditions = [];
            }
        }
        if (kv.status) {
            updated.protagonist.status = kv.status.trim();
            changes.push(`Protagonist status set to "${updated.protagonist.status}"`);
        }

        const moves = parseBulletOrListItems(pBlock, 'moves', { splitCommas: false });
        if (moves.length && updated.meta?.ruleset !== 'fae') {
            updated.protagonist.startingMoves = moves;
            changes.push(`Protagonist moves updated (${moves.length} moves registered)`);
        }

        const gearList = parseBulletOrListItems(pBlock, 'gear', { splitCommas: true });
        if (gearList.length) {
            updated.protagonist.gear = gearList;
            if (!updated.protagonist.equipment) {
                updated.protagonist.equipment = gearList.join(', ');
            }
            changes.push(`Protagonist gear updated: ${gearList.join(', ')}`);
        } else if (equip && isPlaceholderGearList(updated.protagonist.gear)) {
            const derivedGear = splitEquipmentIntoGearList(equip);
            if (derivedGear.length) {
                updated.protagonist.gear = derivedGear;
            }
        }

        // FAE Heroic Domain
        const domainVal = kv.heroic_domain || kv.domain;
        if (domainVal !== undefined) {
            const cleanDomain = String(domainVal).trim().replace(/^["']|["']$/g, '');
            const isNone = /^(?:none|null|false|off|n\/a)$/i.test(cleanDomain) || cleanDomain === '';
            const finalDomain = isNone ? '' : cleanDomain;
            if (updated.protagonist.heroicDomain !== finalDomain) {
                updated.protagonist.heroicDomain = finalDomain;
                changes.push(`Protagonist Heroic Domain: "${finalDomain || 'None'}"`);
                if (finalDomain) {
                    updated.config = updated.config || {};
                    updated.config.heroicTier = true;
                    updated.config.knobs = updated.config.knobs || {};
                    updated.config.knobs.heroic_tier = true;
                }
            }
        }

        // FAE Positive Tags
        const rawPosTags = parseBulletOrListItems(pBlock, 'positive_tags', { splitCommas: true });
        const rawTags = rawPosTags.length ? rawPosTags : parseBulletOrListItems(pBlock, 'tags', { splitCommas: true });
        let posTagsList = [];
        if (rawTags.length) {
            posTagsList = rawTags;
        } else if (kv.positive_tags || kv.tags) {
            const rawVal = kv.positive_tags || kv.tags;
            posTagsList = splitTopLevelItems(rawVal, { splitCommas: true });
        }
        if (posTagsList.length > 0) {
            const cleanPos = sanitizeFaePositiveTags(posTagsList, 5);
            updated.protagonist.positiveTags = cleanPos;
            if (updated.meta?.ruleset !== 'fae') {
                if (!updated.protagonist.startingMoves || updated.protagonist.startingMoves.length === 0) {
                    updated.protagonist.startingMoves = [...cleanPos];
                }
            }
            changes.push(`Protagonist positive tags updated (${cleanPos.length} tags registered)`);
        }

        // FAE Negative Tags / Scars
        const rawNegTags = parseBulletOrListItems(pBlock, 'negative_tags', { splitCommas: true });
        const rawScars = rawNegTags.length ? rawNegTags : parseBulletOrListItems(pBlock, 'scars', { splitCommas: true });
        let negTagsList = [];
        if (rawScars.length) {
            negTagsList = rawScars;
        } else if (kv.negative_tags || kv.scars) {
            const rawVal = kv.negative_tags || kv.scars;
            negTagsList = splitTopLevelItems(rawVal, { splitCommas: true });
        }
        if (negTagsList.length > 0) {
            updated.protagonist.negativeTags = negTagsList;
            if (updated.meta?.ruleset !== 'fae') {
                if (!updated.protagonist.conditions || updated.protagonist.conditions.length === 0) {
                    updated.protagonist.conditions = [...negTagsList];
                }
            } else {
                updated.protagonist.conditions = [];
            }
            changes.push(`Protagonist negative tags / scars updated (${negTagsList.length} registered)`);
        }

        // FAE Pools
        const rawPoolsLines = parseBulletOrListItems(pBlock, 'pools', { splitCommas: false });
        let poolItems = [];
        if (rawPoolsLines.length > 0) {
            poolItems = rawPoolsLines;
        } else if (kv.pools) {
            poolItems = kv.pools.split('|').map(s => s.trim()).filter(Boolean);
        }
        if (poolItems.length > 0) {
            const parsedPools = {};
            const colorCycle = ['green', 'purple', 'amber', 'cyan', 'red'];
            let poolIdx = 0;
            for (const item of poolItems) {
                const poolMatch = item.match(/^([A-Za-z0-9_ &/-]+?)\s*:\s*(\d+)(?:\s*\/\s*(\d+))?(?:\s*\((.*?)\))?/i);
                if (poolMatch) {
                    const label = poolMatch[1].trim();
                    const key = label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                    const cur = parseInt(poolMatch[2], 10);
                    const max = poolMatch[3] !== undefined ? parseInt(poolMatch[3], 10) : cur;
                    const parenOptions = poolMatch[4] || '';

                    const optObj = {};
                    if (parenOptions) {
                        for (const opt of parenOptions.split(',')) {
                            const colonIdx = opt.indexOf(':');
                            if (colonIdx !== -1) {
                                const k = opt.slice(0, colonIdx).trim().toLowerCase();
                                const v = opt.slice(colonIdx + 1).trim();
                                if (k && v) {
                                    optObj[k] = v;
                                }
                            }
                        }
                    }

                    const rawDrain = optObj.passive_drain || optObj.drain;
                    let parsedDrain = null;
                    if (rawDrain) {
                        if (typeof rawDrain === 'object') {
                            parsedDrain = { ...rawDrain };
                        } else {
                            const drainStr = String(rawDrain).trim();
                            if (drainStr.includes(':')) {
                                const parts = drainStr.split(':');
                                const trigger = parts[0].trim();
                                const amount = parseInt(parts[1], 10) || 1;
                                const flavor = parts.slice(2).join(':').trim();
                                parsedDrain = { trigger, amount, flavor, reason: flavor };
                            } else {
                                parsedDrain = { trigger: drainStr, amount: 1, flavor: '', reason: '' };
                            }
                        }
                    }

                    const existing = updated.protagonist.pools?.[key] || {};
                    const barColor = optObj.color || existing.barColor || (key === 'health' || key === 'body' ? 'green' : (key === 'sanity' || key === 'nerve' ? 'purple' : colorCycle[poolIdx % colorCycle.length]));
                    parsedPools[key] = {
                        key,
                        label: existing.label || label,
                        barColor,
                        current: cur,
                        max,
                        recovery: optObj.recovery || existing.recovery || 'camp_or_sleep',
                        passive_drain: parsedDrain || (existing.passive_drain ? { ...existing.passive_drain } : null),
                        strain_flavor: optObj.strain_flavor || optObj.strain || existing.strain_flavor || '',
                        zero_debuff: optObj.zero_debuff || existing.zero_debuff || 'Clamped & Exhausted',
                        on_overflow: optObj.overflow || optObj.on_overflow || existing.on_overflow || 'scar_and_ko',
                    };
                    poolIdx++;
                    changes.push(`Protagonist pool ${label} set to ${cur}/${max}`);
                }
            }

            if (Object.keys(parsedPools).length > 0) {
                const existingPools = updated.protagonist.pools;
                const hasExistingCommonKeys = existingPools && Object.keys(parsedPools).some(k => Boolean(existingPools[k]));
                if (Object.keys(parsedPools).length >= 2 || !existingPools || !hasExistingCommonKeys) {
                    updated.protagonist.pools = parsedPools;
                } else {
                    updated.protagonist.pools = { ...(existingPools || {}), ...parsedPools };
                }
                updated.pools = updated.protagonist.pools;
            }
        }
    }

    // ── 3. Supporting NPCs / Allies ─────────────────────────────────────────────
    updated.npcs = updated.npcs || [];

    // Check for explicit clear / removal
    if (/\[CLEAR_NPCS\]/i.test(raw) || /clear_npcs\s*:\s*true/i.test(raw)) {
        if (updated.npcs.length > 0) {
            changes.push(`Cleared all ${updated.npcs.length} NPCs`);
            updated.npcs = [];
        }
    }

    const removeNpcMatches = raw.matchAll(/(?:\[REMOVE_NPC:\s*([^\]]+)\]|remove_npc\s*:\s*([^\n\r]+))/gi);
    for (const rm of removeNpcMatches) {
        const targetName = cleanTargetName(rm[1] || rm[2] || '');
        if (targetName) {
            const beforeLen = updated.npcs.length;
            updated.npcs = updated.npcs.filter(n => n.name.toLowerCase() !== targetName.toLowerCase());
            if (updated.npcs.length < beforeLen) {
                changes.push(`Removed NPC "${targetName}"`);
            }
        }
    }

    for (const match of npcBlocks) {
        const inlineName = match.inlineArg?.trim();
        const nBlock = match.content;
        const kv = parseKeyValueLines(nBlock);
        if (!kv.name && inlineName) kv.name = inlineName;
        kv.name = cleanTargetName(kv.name);
        if (!kv.name) continue;

        // Check if this NPC block requests removal
        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.npcs.length;
            updated.npcs = updated.npcs.filter(n => n.name.toLowerCase() !== kv.name.toLowerCase());
            if (updated.npcs.length < beforeLen) {
                changes.push(`Removed NPC "${kv.name}"`);
            }
            continue;
        }

        let fVal = kv.friendship !== undefined ? clampRelationshipScore(kv.friendship) : null;
        let aVal = kv.affection !== undefined ? clampRelationshipScore(kv.affection) : null;
        if (fVal === null && aVal === null) {
            const inferred = inferStartingNpcRelationships(kv.role, kv.relationship);
            fVal = inferred.friendship;
            aVal = inferred.affection;
        } else {
            fVal = fVal ?? 0;
            aVal = aVal ?? 0;
        }

        let nHarm = null;
        if (kv.harm) {
            const slashMatch = String(kv.harm).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                nHarm = { current: parseInt(slashMatch[1], 10), max: parseInt(slashMatch[2], 10), armor: 0 };
            } else {
                const h = parseInt(kv.harm, 10);
                if (!isNaN(h)) nHarm = { current: 0, max: h, armor: 0 };
            }
        }
        if (kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
            const cVal = parseInt(kv.current_harm ?? kv.harm_current ?? kv.wounds, 10);
            if (!isNaN(cVal)) {
                nHarm = nHarm || { current: 0, max: 5, armor: 0 };
                nHarm.current = cVal;
            }
        }
        if (kv.armor !== undefined) {
            const aVal = parseInt(kv.armor, 10);
            if (!isNaN(aVal)) {
                nHarm = nHarm || { current: 0, max: 5, armor: 0 };
                nHarm.armor = aVal;
            }
        }

        const rawNpcConds = parseBulletOrListItems(nBlock, 'conditions');
        const nConditions = (rawNpcConds.length || kv.conditions)
            ? sanitizeConditionsList(rawNpcConds.length ? rawNpcConds : kv.conditions)
            : [];

        const rawNpcSpecies = kv.species || kv.race || '';
        const cleanNpcSpecies = sanitizeSpeciesValue(rawNpcSpecies) || rawNpcSpecies.trim();
        const bulletBoons = parseBulletList(nBlock, 'moves_or_boons').concat(parseBulletList(nBlock, 'moves'));
        const npcMovesOrBoons = kv.moves_or_boons || kv.moves || (bulletBoons.length ? bulletBoons.join('; ') : '');

        const npcObj = {
            name: kv.name,
            role: kv.role || 'Ally',
            archetype: kv.archetype || kv.playbook || kv.class || '',
            species: cleanNpcSpecies,
            appearance: kv.appearance || kv.description || kv.look || '',
            equipment: kv.equipment || kv.gear || '',
            demeanor: kv.demeanor || '',
            background: kv.background || '',
            relationship: kv.relationship || '',
            friendship: fVal,
            affection: aVal,
            movesOrBoons: npcMovesOrBoons,
            notes: kv.notes || '',
            portraitSrc: null,
            harm: nHarm,
            conditions: nConditions,
            status: kv.status ? kv.status.trim() : (nHarm?.current > 0 ? '(-) Wounded' : ''),
        };

        const existingIdx = updated.npcs.findIndex(n => n.name.toLowerCase() === npcObj.name.toLowerCase());
        if (existingIdx >= 0) {
            // Partial follow-up edit: only overwrite fields the Concierge actually supplied
            const patch = {};
            const given = (...ks) => ks.some(k => kv[k] !== undefined && kv[k] !== '');
            if (given('role')) patch.role = npcObj.role;
            if (given('archetype', 'playbook', 'class')) patch.archetype = npcObj.archetype;
            if (given('species', 'race')) patch.species = npcObj.species;
            if (given('appearance', 'description', 'look')) patch.appearance = npcObj.appearance;
            if (given('equipment', 'gear')) patch.equipment = npcObj.equipment;
            if (given('demeanor')) patch.demeanor = npcObj.demeanor;
            if (given('background')) patch.background = npcObj.background;
            if (given('relationship')) patch.relationship = npcObj.relationship;
            if (given('friendship')) patch.friendship = clampRelationshipScore(kv.friendship);
            if (given('affection')) patch.affection = clampRelationshipScore(kv.affection);
            if (given('moves_or_boons', 'moves') || bulletBoons.length) patch.movesOrBoons = npcObj.movesOrBoons;
            if (given('notes')) patch.notes = npcObj.notes;
            if (given('harm', 'current_harm', 'harm_current', 'wounds', 'armor') && nHarm) patch.harm = nHarm;
            if (given('conditions') || rawNpcConds.length) patch.conditions = npcObj.conditions;
            if (given('status')) patch.status = npcObj.status;
            updated.npcs[existingIdx] = Object.assign({}, updated.npcs[existingIdx], patch);
            changes.push(`Updated NPC "${npcObj.name}" (${npcObj.role})`);
        } else {
            updated.npcs.push(npcObj);
            changes.push(`Added NPC "${npcObj.name}" (${npcObj.role})`);
        }
    }

    // ── 4. Monsters / Adversaries ───────────────────────────────────────────────
    updated.monsters = updated.monsters || [];

    if (/\[CLEAR_MONSTERS\]/i.test(raw) || /clear_monsters\s*:\s*true/i.test(raw)) {
        if (updated.monsters.length > 0) {
            changes.push(`Cleared all ${updated.monsters.length} monsters`);
            updated.monsters = [];
        }
    }

    const removeMonMatches = raw.matchAll(/(?:\[REMOVE_MONSTER:\s*([^\]]+)\]|remove_monster\s*:\s*([^\n\r]+))/gi);
    for (const rm of removeMonMatches) {
        const targetName = cleanTargetName(rm[1] || rm[2] || '');
        if (targetName) {
            const beforeLen = updated.monsters.length;
            updated.monsters = updated.monsters.filter(m => m.name.toLowerCase() !== targetName.toLowerCase());
            if (updated.npcs && updated.monsters.length < beforeLen) {
                changes.push(`Removed Adversary "${targetName}"`);
            }
        }
    }

    for (const match of monsterBlocks) {
        const mBlock = match.content;
        const kv = parseKeyValueLines(mBlock);
        if (!kv.name && match.inlineArg) kv.name = match.inlineArg.trim();
        kv.name = cleanTargetName(kv.name);
        if (!kv.name) continue;

        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.monsters.length;
            updated.monsters = updated.monsters.filter(m => m.name.toLowerCase() !== kv.name.toLowerCase());
            if (updated.monsters.length < beforeLen) {
                changes.push(`Removed Adversary "${kv.name}"`);
            }
            continue;
        }

        let mCurHarm = 0;
        let mMaxHarm = 4;
        if (kv.harm) {
            const slashMatch = String(kv.harm).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                mCurHarm = parseInt(slashMatch[1], 10);
                mMaxHarm = parseInt(slashMatch[2], 10);
            } else {
                const h = parseInt(kv.harm, 10);
                if (!isNaN(h)) mMaxHarm = h;
            }
        }
        if (kv.layers || kv.hp) {
            const rawLayers = kv.layers || kv.hp;
            const slashMatch = String(rawLayers).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                mCurHarm = parseInt(slashMatch[1], 10);
                mMaxHarm = parseInt(slashMatch[2], 10);
            } else {
                const l = parseInt(rawLayers, 10);
                if (!isNaN(l)) {
                    mCurHarm = l;
                    mMaxHarm = l;
                }
            }
        }
        if (kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
            const cVal = parseInt(kv.current_harm ?? kv.harm_current ?? kv.wounds, 10);
            if (!isNaN(cVal)) mCurHarm = cVal;
        }

        let threatLevelNum = null;
        if (kv.threat_level !== undefined || kv.threat !== undefined) {
            const rawT = parseInt(kv.threat_level ?? kv.threat, 10);
            if (!isNaN(rawT) && rawT >= 1 && rawT <= 4) {
                threatLevelNum = rawT;
            }
        }

        const rawPressures = parseBulletOrListItems(mBlock, 'pressures', { splitCommas: true });
        const rawBarriers = parseBulletOrListItems(mBlock, 'leverage_barriers', { splitCommas: true });
        let finalBarriers = rawBarriers.length ? rawBarriers : parseBulletOrListItems(mBlock, 'barriers', { splitCommas: true });
        if (finalBarriers.length === 1 && /\[.*?\][\s\S]*\[.*?\]/.test(finalBarriers[0])) {
            const matches = finalBarriers[0].match(/\[(.*?)\]/g);
            if (matches && matches.length > 1) {
                finalBarriers = matches.map(m => m.replace(/^\[|\]$/g, '').trim());
            }
        }
        const rawFinish = kv.full_finish_triggers || kv.full_finish_trigger || kv.finish_triggers || (parseBulletOrListItems(mBlock, 'full_finish_triggers', { splitCommas: false }).join('; '));
        const poolsAtRisk = kv.pools_at_risk || kv.pools;

        const parsedAttacks = parseBulletOrListItems(mBlock, 'attacks', { splitCommas: true });
        const parsedMonConds = parseBulletOrListItems(mBlock, 'conditions', { splitCommas: true });

        const monsterObj = {
            name: kv.name,
            harm: mMaxHarm,
            currentHarm: mCurHarm,
            armor: parseInt(kv.armor, 10) || 0,
            attacks: parsedAttacks,
            weakness: kv.weakness || 'Unknown',
            impendingDoom: parseBulletOrListItems(mBlock, 'countdown', { splitCommas: false }),
            notes: kv.notes || '',
            status: kv.status ? kv.status.trim() : (mCurHarm > 0 ? '(-) Wounded' : ''),
            instinct: kv.instinct ? kv.instinct.trim() : '',
            conditions: parsedMonConds.length ? sanitizeConditionsList(parsedMonConds) : [],
            threatLevel: threatLevelNum,
            layers: mMaxHarm,
            currentLayers: mCurHarm,
            poolsAtRisk: poolsAtRisk || null,
            pressures: rawPressures,
            leverageBarriers: finalBarriers,
            fullFinishTriggers: rawFinish || '',
        };

        const existingIdx = updated.monsters.findIndex(m => m.name.toLowerCase() === monsterObj.name.toLowerCase());
        if (existingIdx >= 0) {
            const patch = {};
            if (kv.harm || kv.layers || kv.hp || kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
                patch.harm = monsterObj.harm;
                patch.currentHarm = monsterObj.currentHarm;
                patch.layers = monsterObj.layers;
                patch.currentLayers = monsterObj.currentLayers;
            }
            if (threatLevelNum !== null) patch.threatLevel = threatLevelNum;
            if (poolsAtRisk) patch.poolsAtRisk = poolsAtRisk;
            if (rawPressures.length) patch.pressures = rawPressures;
            if (finalBarriers.length) patch.leverageBarriers = finalBarriers;
            if (rawFinish) patch.fullFinishTriggers = rawFinish;
            if (kv.armor) patch.armor = monsterObj.armor;
            if (parsedAttacks.length) patch.attacks = monsterObj.attacks;
            if (kv.weakness) patch.weakness = monsterObj.weakness;
            if (monsterObj.impendingDoom.length) patch.impendingDoom = monsterObj.impendingDoom;
            if (kv.notes) patch.notes = monsterObj.notes;
            if (kv.status) patch.status = monsterObj.status;
            if (kv.instinct) patch.instinct = monsterObj.instinct;
            if (parsedMonConds.length) patch.conditions = monsterObj.conditions;
            updated.monsters[existingIdx] = Object.assign({}, updated.monsters[existingIdx], patch);
            Object.assign(monsterObj, updated.monsters[existingIdx]);
            if (threatLevelNum !== null || kv.layers || monsterObj.threatLevel) {
                changes.push(`Updated FAE Encounter "${monsterObj.name}" (Threat: ${monsterObj.threatLevel || 2}, Layers: ${monsterObj.currentHarm}/${monsterObj.harm})`);
            } else {
                const woundLabel = monsterObj.currentHarm > 0 ? `Harm: ${monsterObj.currentHarm}/${monsterObj.harm}` : `Harm: ${monsterObj.harm}`;
                changes.push(`Updated Adversary "${monsterObj.name}" (${woundLabel}, Armor: ${monsterObj.armor})`);
            }
        } else {
            updated.monsters.push(monsterObj);
            if (threatLevelNum !== null || kv.layers) {
                changes.push(`Added FAE Encounter "${monsterObj.name}" (Threat: ${threatLevelNum || 2}, Layers: ${monsterObj.currentHarm}/${monsterObj.harm})`);
            } else {
                const woundLabel = monsterObj.currentHarm > 0 ? ` (Harm: ${monsterObj.currentHarm}/${monsterObj.harm}, Armor: ${monsterObj.armor})` : ` (Harm: ${monsterObj.harm}, Armor: ${monsterObj.armor})`;
                changes.push(`Added Adversary "${monsterObj.name}"${woundLabel}`);
            }
        }
    }

    // ── 5. Locations / Maps ─────────────────────────────────────────────────────
    updated.maps = updated.maps || [];

    if (/\[CLEAR_MAPS\]/i.test(raw) || /clear_maps\s*:\s*true/i.test(raw)) {
        if (updated.maps.length > 0) {
            changes.push(`Cleared all ${updated.maps.length} maps`);
            updated.maps = [];
        }
    }

    const removeMapMatches = raw.matchAll(/(?:\[REMOVE_MAP:\s*([^\]]+)\]|remove_map\s*:\s*([^\n\r]+))/gi);
    for (const rm of removeMapMatches) {
        const targetSite = cleanTargetName(rm[1] || rm[2] || '');
        if (targetSite) {
            const beforeLen = updated.maps.length;
            updated.maps = updated.maps.filter(m => m.site.toLowerCase() !== targetSite.toLowerCase());
            if (updated.maps.length < beforeLen) {
                changes.push(`Removed Location "${targetSite}"`);
            }
        }
    }

    for (const match of mapBlocks) {
        const mBlock = match.content;
        const kv = parseKeyValueLines(mBlock);
        if (!kv.site && match.inlineArg) kv.site = match.inlineArg.trim();
        kv.site = cleanTargetName(kv.site);
        if (!kv.site) continue;

        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.maps.length;
            updated.maps = updated.maps.filter(m => m.site.toLowerCase() !== kv.site.toLowerCase());
            if (updated.maps.length < beforeLen) {
                changes.push(`Removed Location "${kv.site}"`);
            }
            continue;
        }

        const kindUpper = (kv.kind || 'INTERIOR').toUpperCase();
        const threatUpper = (kv.threat || 'MODERATE').toUpperCase();

        const mapObj = {
            site: kv.site,
            kind: ['DUNGEON', 'SETTLEMENT', 'INTERIOR', 'WILDERNESS'].includes(kindUpper) ? kindUpper : 'INTERIOR',
            threat: ['NONE', 'SAFE', 'LOW', 'MODERATE', 'HIGH', 'DANGEROUS', 'DEADLY'].includes(threatUpper) ? threatUpper : 'MODERATE',
            entrance: kv.entrance || 'Main Entrance',
            prompt: kv.prompt || '',
            briefDescription: kv.brief_description || kv.prompt || '',
            status: 'queued',
        };

        const existingIdx = updated.maps.findIndex(m => m.site.toLowerCase() === mapObj.site.toLowerCase());
        if (existingIdx >= 0) {
            const patch = {};
            if (kv.kind) patch.kind = mapObj.kind;
            if (kv.threat) patch.threat = mapObj.threat;
            if (kv.entrance) patch.entrance = mapObj.entrance;
            if (kv.prompt) { patch.prompt = mapObj.prompt; }
            if (kv.brief_description || kv.prompt) patch.briefDescription = mapObj.briefDescription;
            updated.maps[existingIdx] = Object.assign({}, updated.maps[existingIdx], patch);
            changes.push(`Updated Location "${mapObj.site}" (${mapObj.kind})`);
        } else {
            updated.maps.push(mapObj);
            changes.push(`Queued Location "${mapObj.site}" (${mapObj.kind}, Threat: ${mapObj.threat})`);
        }
    }

    // ── 5b. Factions & Powers ──────────────────────────────────────────────────
    updated.factions = updated.factions || [];

    if (/\[CLEAR_FACTIONS\]/i.test(raw) || /clear_factions\s*:\s*true/i.test(raw)) {
        if (updated.factions.length > 0) {
            changes.push(`Cleared all ${updated.factions.length} factions`);
            updated.factions = [];
        }
    }

    const removeFactionMatches = raw.matchAll(/(?:\[REMOVE_FACTION:\s*([^\]]+)\]|remove_faction\s*:\s*([^\n\r]+))/gi);
    for (const rm of removeFactionMatches) {
        const targetName = cleanTargetName(rm[1] || rm[2] || '');
        if (targetName) {
            const beforeLen = updated.factions.length;
            updated.factions = updated.factions.filter(f => f.name.toLowerCase() !== targetName.toLowerCase());
            if (updated.factions.length < beforeLen) {
                changes.push(`Removed Faction "${targetName}"`);
            }
        }
    }

    for (const match of factionBlocks) {
        const fBlock = match.content;
        const kv = parseKeyValueLines(fBlock);
        if (!kv.name && match.inlineArg) kv.name = match.inlineArg.trim();
        kv.name = cleanTargetName(kv.name);
        if (!kv.name) continue;

        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.factions.length;
            updated.factions = updated.factions.filter(f => f.name.toLowerCase() !== kv.name.toLowerCase());
            if (updated.factions.length < beforeLen) {
                changes.push(`Removed Faction "${kv.name}"`);
            }
            continue;
        }

        const factionObj = {
            name: kv.name,
            agenda: kv.agenda || kv.goal || '',
            standing: kv.standing || kv.reputation || kv.influence || 'Neutral',
            notes: kv.notes || kv.description || '',
        };

        const existingIdx = updated.factions.findIndex(f => f.name.toLowerCase() === factionObj.name.toLowerCase());
        if (existingIdx >= 0) {
            const patch = {};
            if (kv.agenda || kv.goal) patch.agenda = factionObj.agenda;
            if (kv.standing || kv.reputation || kv.influence) patch.standing = factionObj.standing;
            if (kv.notes || kv.description) patch.notes = factionObj.notes;
            updated.factions[existingIdx] = Object.assign({}, updated.factions[existingIdx], patch);
            changes.push(`Updated Faction "${factionObj.name}"`);
        } else {
            updated.factions.push(factionObj);
            changes.push(`Added Faction "${factionObj.name}"`);
        }
    }

    // ── 6. The Kick (Opening Incident) ──────────────────────────────────────────
    if (kickBlocks.length > 0) {
        const kBlock = kickBlocks[0].content;
        const kv = parseKeyValueLines(kBlock);
        if (kv.starting_location && updated.theKick.startingLocation !== kv.starting_location) {
            updated.theKick.startingLocation = kv.starting_location;
            changes.push(`The Kick starting location: "${kv.starting_location}"`);
        }
        if (kv.crisis && updated.theKick.crisis !== kv.crisis) {
            updated.theKick.crisis = kv.crisis;
            changes.push(`The Kick crisis updated`);
        }
        if (kv.opening_prompt && updated.theKick.openingPrompt !== kv.opening_prompt) {
            updated.theKick.openingPrompt = kv.opening_prompt;
            changes.push(`The Kick opening prompt registered`);
        }
    }

    // ── 7. CYOA Examples (Optional Explicit Choices) ───────────────────────────
    if (cyoaBlocks.length > 0) {
        const cBlock = cyoaBlocks[0].content;
        const lines = cBlock.split('\n')
            .map(l => l.replace(/^[\*\-\s]+/, '').trim())
            .filter(Boolean);
        if (lines.length > 0) {
            updated.cyoaExamples = lines;
            changes.push(`Tailored CYOA choices registered (${lines.length} choices)`);
        }
    }

    // ── 7b. World Rules & Physical Axioms ──────────────────────────────────────
    updated.worldRules = updated.worldRules || { axioms: [], customModule: null };
    updated.worldRules.axioms = updated.worldRules.axioms || [];

    if (/\[CLEAR_WORLD_RULES\]/i.test(raw) || /clear_world_rules\s*:\s*true/i.test(raw)) {
        if (updated.worldRules.axioms.length > 0) {
            changes.push(`Cleared all ${updated.worldRules.axioms.length} world rules`);
            updated.worldRules.axioms = [];
        }
    }

    const removeRuleMatches = raw.matchAll(/(?:\[REMOVE_WORLD_RULE:\s*([^\]]+)\]|remove_world_rule\s*:\s*([^\n\r]+))/gi);
    for (const rm of removeRuleMatches) {
        const targetTitle = cleanTargetName(rm[1] || rm[2] || '');
        if (targetTitle) {
            const beforeLen = updated.worldRules.axioms.length;
            updated.worldRules.axioms = updated.worldRules.axioms.filter(r =>
                r.title.toLowerCase() !== targetTitle.toLowerCase() &&
                r.id?.toLowerCase() !== targetTitle.toLowerCase()
            );
            if (updated.worldRules.axioms.length < beforeLen) {
                changes.push(`Removed World Rule "${targetTitle}"`);
            }
        }
    }

    for (const match of ruleBlocks) {
        const rBlock = match.content;
        const kv = parseKeyValueLines(rBlock);
        const title = cleanTargetName(kv.title || kv.name || '');
        if (!title && !kv.axiom && !kv.rule && !kv.core_axiom) continue;

        const effectiveTitle = title || 'World Axiom';
        const rawCategory = (kv.category || 'technology').toLowerCase().trim();
        const category = ['technology', 'physiology', 'metaphysics', 'ecology', 'social', 'general'].includes(rawCategory)
            ? rawCategory
            : 'general';
        const axiom = kv.axiom || kv.rule || kv.core_axiom || '';
        const substitutions = parseBulletOrListItems(rBlock, 'substitutions');
        const negativeConstraints = parseBulletOrListItems(rBlock, 'negative_constraints').length
            ? parseBulletOrListItems(rBlock, 'negative_constraints')
            : parseBulletOrListItems(rBlock, 'banned');
        const architecturalNotes = kv.architectural_notes || kv.architecture || kv.architectural_implications || '';
        const id = kv.id || `rule_${effectiveTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

        const ruleObj = {
            id,
            category,
            title: effectiveTitle,
            axiom,
            substitutions,
            negativeConstraints,
            architecturalNotes,
        };

        const existingIdx = updated.worldRules.axioms.findIndex(r =>
            r.id.toLowerCase() === ruleObj.id.toLowerCase() ||
            r.title.toLowerCase() === ruleObj.title.toLowerCase()
        );

        if (existingIdx >= 0) {
            const patch = {};
            if (kv.category) patch.category = ruleObj.category;
            if (ruleObj.axiom) patch.axiom = ruleObj.axiom;
            if (ruleObj.substitutions.length) patch.substitutions = ruleObj.substitutions;
            if (ruleObj.negativeConstraints.length) patch.negativeConstraints = ruleObj.negativeConstraints;
            if (ruleObj.architecturalNotes) patch.architecturalNotes = ruleObj.architecturalNotes;
            updated.worldRules.axioms[existingIdx] = Object.assign({}, updated.worldRules.axioms[existingIdx], patch);
            changes.push(`Updated World Rule "${ruleObj.title}"`);
        } else {
            updated.worldRules.axioms.push(ruleObj);
            changes.push(`Added World Rule "${ruleObj.title}" (${ruleObj.category})`);
        }
    }

    // ── 7c. Custom Tracker Module ──────────────────────────────────────────────
    if (/\[REMOVE_CUSTOM_MODULE\]/i.test(raw) || /remove_custom_module\s*:\s*true/i.test(raw)) {
        if (updated.worldRules.customModule) {
            const existingTag = updated.worldRules.customModule.tag || updated.worldRules.customModule.fieldKey || 'CUSTOM';
            changes.push(`Removed Custom Tracker Module [${existingTag}]`);
            updated.worldRules.customModule = null;
        }
    }

    if (customModuleBlocks.length > 0) {
        const cmBlock = customModuleBlocks[0].content;
        const kv = parseKeyValueLines(cmBlock);
        const tag = (kv.tag || kv.fieldkey || kv.field_key || kv.name || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (tag) {
            const label = cleanTargetName(kv.label || kv.title || tag);
            const icon = (kv.icon || '📦').trim();
            const instruction = kv.instruction || kv.prompt || kv.description || '';
            let sampleContent = '';
            const codeBlockM = cmBlock.match(/```(?:text)?\s*([\s\S]*?)```/i);
            if (codeBlockM) {
                sampleContent = codeBlockM[1].trim();
            } else {
                const sampleM = cmBlock.match(/(?:^|\n)\s*(?:sample|sample_content|content)\s*:\s*\n?([\s\S]*?)(?=(?:\n\s*[a-zA-Z0-9_\-]+\s*:)|$)/i);
                if (sampleM && sampleM[1].trim()) {
                    sampleContent = sampleM[1].trim();
                } else {
                    sampleContent = (kv.sample || kv.sample_content || kv.content || '').trim();
                }
            }

            const moduleObj = {
                tag,
                fieldKey: tag,
                label: label || tag,
                icon,
                instruction,
                sampleContent,
                sample: sampleContent,
            };

            updated.worldRules.customModule = moduleObj;
            changes.push(`Configured Custom Tracker Module [${tag}] "${moduleObj.label}"`);
        }
    }

    // ── 8. Configuration / Campaign Dials ───────────────────────────────────────
    updated.config = updated.config || {
        playstyle: 'cyoa_5',
        cyoaEmojis: true,
        harmMax: 5,
        partyMode: 'squad',
        artStyle: '',
        pacingXp: 5,
        simulationDepth: 'active_fronts',
        maxHarmFate: {
            rule: 'Mortal Peril (Last Breath / Dying)',
            statusToken: '(-) Incapacitated',
            cyoaStyle: 'crisis',
        },
    };

    if (configBlocks.length > 0) {
        const cBlock = configBlocks[0].content;
        const kv = parseKeyValueLines(cBlock);

        // Playstyle
        const psRaw = (kv.playstyle || kv.cyoa_mode || kv.cyoa || '').toLowerCase();
        if (psRaw) {
            let nextPs = updated.config.playstyle;
            if (/^(freeform|prose|none|off|disabled|false|0)$/.test(psRaw)) nextPs = 'freeform';
            else if (/^(cyoa_3|3|minimal|minimalist)$/.test(psRaw)) nextPs = 'cyoa_3';
            else if (/^(cyoa_5|5|full|standard|true|default)$/.test(psRaw)) nextPs = 'cyoa_5';

            if (nextPs !== updated.config.playstyle) {
                updated.config.playstyle = nextPs;
                const label = nextPs === 'freeform' ? 'Pure Freeform (Prose Only)' : nextPs === 'cyoa_3' ? 'Minimalist CYOA (3 Choices)' : 'Interactive CYOA (5 Choices)';
                changes.push(`Playstyle dial set to ${label}`);
            }
        }

        // CYOA Emojis
        if (kv.cyoa_emojis !== undefined || kv.emojis !== undefined) {
            const emRaw = String(kv.cyoa_emojis !== undefined ? kv.cyoa_emojis : kv.emojis).toLowerCase();
            const nextEm = !/^(false|off|0|no)$/.test(emRaw);
            if (nextEm !== updated.config.cyoaEmojis) {
                updated.config.cyoaEmojis = nextEm;
                changes.push(`CYOA Emojis set to ${nextEm ? 'On' : 'Off'}`);
            }
        }

        // Harm Max / Lethality
        const harmRaw = parseInt(kv.harm_max || kv.harm || kv.lethality, 10);
        if (!isNaN(harmRaw) && harmRaw >= 2 && harmRaw <= 8) {
            if (harmRaw !== updated.config.harmMax) {
                updated.config.harmMax = harmRaw;
                if (updated.protagonist) {
                    updated.protagonist.harm = updated.protagonist.harm || { current: 0, armor: 0 };
                    updated.protagonist.harm.max = harmRaw;
                }
                const label = harmRaw <= 3 ? 'Gritty' : harmRaw === 4 ? 'Tense' : harmRaw === 5 ? 'Standard' : 'Heroic';
                changes.push(`Harm capacity dial set to ${harmRaw} (${label})`);
            }
        }

        // Party Mode
        const partyRaw = (kv.party_mode || kv.party || '').toLowerCase();
        if (partyRaw) {
            let nextParty = updated.config.partyMode;
            if (/^(solo|lone|loner|alone)$/.test(partyRaw)) nextParty = 'solo';
            else if (/^(duo|pair|partner|buddy)$/.test(partyRaw)) nextParty = 'duo';
            else if (/^(squad|team|party|full)$/.test(partyRaw)) nextParty = 'squad';

            if (nextParty !== updated.config.partyMode) {
                updated.config.partyMode = nextParty;
                changes.push(`Party mode dial set to ${nextParty.toUpperCase()}`);
            }
        }

        // Art Style
        if (kv.art_style !== undefined) {
            const nextArt = kv.art_style.trim();
            if (nextArt !== updated.config.artStyle) {
                updated.config.artStyle = nextArt;
                changes.push(`Art Direction dial set to "${nextArt}"`);
            }
        }

        // Pacing XP
        const xpRaw = parseInt(kv.pacing_xp || kv.xp, 10);
        if (!isNaN(xpRaw) && (xpRaw === 3 || xpRaw === 5)) {
            if (xpRaw !== updated.config.pacingXp) {
                updated.config.pacingXp = xpRaw;
                changes.push(`XP Pacing dial set to ${xpRaw} XP per Advance`);
            }
        }

        // World Simulation Depth
        const simRaw = (kv.simulation_depth || kv.sim_depth || kv.simulation || '').toLowerCase();
        if (simRaw) {
            let nextSim = updated.config.simulationDepth || 'active_fronts';
            if (/^(static|none|off|solo|disabled|narrative_solo)$/.test(simRaw)) nextSim = 'static';
            else if (/^(living|living_world|full|deep|all)$/.test(simRaw)) nextSim = 'living_world';
            else if (/^(active|active_fronts|fronts|standard|default)$/.test(simRaw)) nextSim = 'active_fronts';

            if (nextSim !== updated.config.simulationDepth) {
                updated.config.simulationDepth = nextSim;
                const label = nextSim === 'static' ? 'Static (Narrative Only)' : nextSim === 'living_world' ? 'Living World (Fronts + Maps)' : 'Active Fronts (Recommended)';
                changes.push(`Simulation Depth dial set to ${label}`);
            }
        }

        // Relationships Dial
        if (kv.relationships !== undefined || kv.relations !== undefined || kv.npc_relationships !== undefined) {
            const relRaw = String(kv.relationships ?? kv.relations ?? kv.npc_relationships).toLowerCase().trim();
            const nextRel = !/^(false|off|0|no|disabled)$/i.test(relRaw);
            if (nextRel !== updated.config.relationships) {
                updated.config.relationships = nextRel;
                changes.push(`Relationships dial set to ${nextRel ? 'On' : 'Off'}`);
            }
        }

        // Max Harm / Downed Fate Dial
        const fateRaw = kv.max_harm_fate || kv.downed_fate || kv.max_harm_rule || kv.death_rule;
        if (fateRaw) {
            let ruleStr = String(fateRaw).trim();
            let tokenStr = kv.downed_status || kv.status_token;
            if (ruleStr.includes('|')) {
                const parts = ruleStr.split('|');
                ruleStr = parts[0].trim();
                if (!tokenStr && parts[1]) {
                    tokenStr = parts[1].trim().replace(/^(?:status(?:\s*token)?\s*:?\s*)/i, '').trim();
                }
            }
            if (tokenStr) {
                tokenStr = tokenStr.trim().replace(/^(?:status(?:\s*token)?\s*:?\s*)/i, '').trim();
            }
            if (!tokenStr) {
                if (/respawn|graveyard|ghost|mmo|shrine/i.test(ruleStr)) tokenStr = '(-) Ghost';
                else if (/burnout|exhaust|faint|pass out|fatigue/i.test(ruleStr)) tokenStr = '(-) Burnt Out';
                else if (/unconscious|capture|knockout|arrest|subdue/i.test(ruleStr)) tokenStr = '(-) Unconscious';
                else tokenStr = '(-) Incapacitated';
            }
            if (!tokenStr.startsWith('(-)') && !tokenStr.startsWith('(+)')) {
                tokenStr = `(-) ${tokenStr}`;
            }

            let cyoaStyle = 'crisis';
            if (/respawn|graveyard|ghost|mmo|shrine/i.test(ruleStr)) cyoaStyle = 'respawn';
            else if (/burnout|exhaust|faint|pass out|fatigue/i.test(ruleStr)) cyoaStyle = 'burnout';
            else if (/unconscious|capture|knockout|arrest|subdue/i.test(ruleStr)) cyoaStyle = 'knockout';

            const nextFate = {
                rule: ruleStr,
                statusToken: tokenStr,
                cyoaStyle,
            };

            const prevFate = updated.config.maxHarmFate || {};
            if (prevFate.rule !== nextFate.rule || prevFate.statusToken !== nextFate.statusToken) {
                updated.config.maxHarmFate = nextFate;
                changes.push(`Max Harm fate dial set to "${ruleStr}" [${tokenStr}]`);
            }
        }

        // FAE Knobs in CONFIG
        updated.config.knobs = updated.config.knobs || {};
        const heroicRaw = kv.heroic_tier !== undefined ? kv.heroic_tier : (kv.heroic !== undefined ? kv.heroic : kv.heroic_domain_active);
        if (heroicRaw !== undefined) {
            const val = /^(?:true|on|yes|1)$/i.test(String(heroicRaw).trim());
            if (updated.config.heroicTier !== val) {
                updated.config.heroicTier = val;
                updated.config.knobs.heroic_tier = val;
                changes.push(`Heroic Tier dial set to ${val ? 'ON' : 'OFF'}`);
            }
        }
        const fleeRaw = kv.flee_grace_toggle !== undefined ? kv.flee_grace_toggle : kv.flee_grace;
        if (fleeRaw !== undefined) {
            const val = /true|on/i.test(String(fleeRaw).trim());
            if (updated.config.knobs.flee_grace_toggle !== val) {
                updated.config.knobs.flee_grace_toggle = val;
                changes.push(`Flee Grace dial set to ${val ? 'ON' : 'OFF'}`);
            }
        }
        const shiftRaw = kv.base_attrition_shift !== undefined ? kv.base_attrition_shift : kv.attrition_shift;
        if (shiftRaw !== undefined) {
            const val = parseInt(shiftRaw, 10);
            if (!isNaN(val) && updated.config.knobs.base_attrition_shift !== val) {
                updated.config.knobs.base_attrition_shift = val;
                changes.push(`Base Attrition Shift dial set to ${val >= 0 ? '+' : ''}${val}`);
            }
        }
        const overflowRaw = kv.overflow_default !== undefined ? kv.overflow_default : kv.overflow;
        if (overflowRaw !== undefined) {
            const val = String(overflowRaw).trim().toLowerCase();
            if (['lethal', 'scar_and_ko', 'scene_fail'].includes(val) && updated.config.knobs.overflow_default !== val) {
                updated.config.knobs.overflow_default = val;
                changes.push(`Overflow default dial set to ${val}`);
            }
        }
        const tempoRaw = kv.action_tempo !== undefined ? kv.action_tempo : (kv.tempo !== undefined ? kv.tempo : kv.pacing_tempo);
        if (tempoRaw !== undefined) {
            const val = String(tempoRaw).trim().toLowerCase();
            if (['action_serial', 'gritty_default', 'slow_burn', 'slice_of_life'].includes(val)) {
                if (updated.config.actionTempo !== val) {
                    updated.config.actionTempo = val;
                    updated.config.knobs.action_tempo = val;
                    changes.push(`Action Tempo dial set to ${val}`);
                }
            }
        }
    }

    // Top-level or outside-CONFIG FAE Knobs
    updated.config.knobs = updated.config.knobs || {};
    const topHeroicMatch = topLevelRaw.match(/heroic(?:_tier)?\s*:\s*(true|false|on|off|yes|no)/i);
    if (topHeroicMatch) {
        const val = /^(?:true|on|yes)$/i.test(String(topHeroicMatch[1]).trim());
        if (updated.config.heroicTier !== val) {
            updated.config.heroicTier = val;
            updated.config.knobs.heroic_tier = val;
            changes.push(`Heroic Tier dial set to ${val ? 'ON' : 'OFF'}`);
        }
    }
    const topFleeMatch = topLevelRaw.match(/flee_grace(?:_toggle)?\s*:\s*(true|false|on|off)/i);
    if (topFleeMatch) {
        const val = /true|on/i.test(String(topFleeMatch[1]).trim());
        if (updated.config.knobs.flee_grace_toggle !== val) {
            updated.config.knobs.flee_grace_toggle = val;
            changes.push(`Flee Grace dial set to ${val ? 'ON' : 'OFF'}`);
        }
    }
    const topShiftMatch = topLevelRaw.match(/base_attrition_shift\s*:\s*([+-]?\d+)/i);
    if (topShiftMatch) {
        const val = parseInt(topShiftMatch[1], 10);
        if (!isNaN(val) && updated.config.knobs.base_attrition_shift !== val) {
            updated.config.knobs.base_attrition_shift = val;
            changes.push(`Base Attrition Shift dial set to ${val >= 0 ? '+' : ''}${val}`);
        }
    }
    const topOverflowMatch = topLevelRaw.match(/overflow_default\s*:\s*([a-z_]+)/i);
    if (topOverflowMatch) {
        const val = String(topOverflowMatch[1]).trim().toLowerCase();
        if (['lethal', 'scar_and_ko', 'scene_fail'].includes(val) && updated.config.knobs.overflow_default !== val) {
            updated.config.knobs.overflow_default = val;
            changes.push(`Overflow default dial set to ${val}`);
        }
    }

    if (changes.length > 0) {
        updated.meta = updated.meta || {};
        updated.meta.genreEstablished = true;
    }

    if (updated.meta?.ruleset === 'fae') {
        updated.pools = updated.protagonist.pools;
        updated.knobs = updated.config?.knobs;
        updated.character = {
            name: updated.protagonist.name || 'Protagonist',
            archetype: updated.protagonist.archetype || updated.protagonist.playbook || 'Investigator',
            heroic_domain: updated.config?.heroicTier ? (updated.protagonist.heroicDomain || null) : null,
            positive_tags: updated.protagonist.positiveTags || [],
            negative_tags: updated.protagonist.negativeTags || [],
            scenes_completed: 0,
            scenes_target: updated.config?.pacingScenes || 4,
        };
    }

    return {
        success: errors.length === 0,
        updatedDossier: updated,
        changes,
        errors,
        hasMutations: changes.length > 0,
        isNoop: false,
        builderSummary: builderSummary || (changes.length ? changes.join('; ') : 'Blueprint in sync'),
        contemplation: extractedContemplation,
    };
}

/**
 * Backward-compatible incremental parser that updates a live Campaign Dossier.
 * Delegates to applyDossierUpdates under the hood.
 *
 * @param {string} text Full response text from LLM
 * @param {object} dossier Current dossier to patch
 * @returns {object} Updated dossier clone
 */
export function parseConciergeStateBlock(text, dossier) {
    return applyDossierUpdates(text, dossier).updatedDossier;
}

/**
 * Serialize a Campaign Dossier into a formatted Markdown document suitable for
 * display, download, and injecting into SillyTavern World Info.
 *
 * @param {object} dossier
 * @returns {string}
 */
export function serializeDossierToMarkdown(dossier, options = {}) {
    const { includeCyoa = true } = options;
    const meta = dossier.meta || {};
    const p = dossier.protagonist || {};
    const npcs = dossier.npcs || [];
    const monsters = dossier.monsters || [];
    const maps = dossier.maps || [];
    const kick = dossier.theKick || {};

    let statString = Object.entries(p.stats || {})
        .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`)
        .join(' · ');

    let movesMd = (p.startingMoves || []).map(m => `* ${m}`).join('\n') || '* No custom moves registered yet.';
    const effectiveGear = !isPlaceholderGearList(p.gear)
        ? p.gear
        : (p.equipment ? splitEquipmentIntoGearList(p.equipment) : (p.gear || []));
    let gearMd = effectiveGear.map(g => `* ${g}`).join('\n') || '* Basic equipment.';

    let npcsMd = npcs.length
        ? npcs.map(n => {
            const standingsLine = (n.friendship !== undefined || n.affection !== undefined)
                ? `\n* **Standings:** Friendship ${n.friendship >= 0 ? '+' : ''}${n.friendship || 0} · Affection ${n.affection >= 0 ? '+' : ''}${n.affection || 0}`
                : '';
            const harmPart = (n.harm && (n.harm.current > 0 || n.harm.max !== undefined))
                ? `\n* **Harm:** ${n.harm.current || 0}/${n.harm.max || 5}${n.harm.armor ? ` | **Armor:** ${n.harm.armor}` : ''}`
                : '';
            const condPart = (n.conditions && (Array.isArray(n.conditions) ? n.conditions.length : String(n.conditions).trim()))
                ? `\n* **Conditions:** ${Array.isArray(n.conditions) ? n.conditions.join(', ') : n.conditions}`
                : '';
            const statusPart = n.status ? `\n* **Status:** ${n.status}` : (n.harm?.current > 0 ? '\n* **Status:** (-) Wounded' : '');
            const archetypePart = n.archetype ? `\n* **Archetype:** ${n.archetype}` : '';
            return `### 👤 ${n.name}
* **Role:** ${n.role || 'Ally'}${archetypePart}${n.species ? `\n* **Species:** ${n.species}` : ''}${harmPart}${statusPart}${condPart}
* **Appearance:** ${n.appearance || 'None specified'}${n.equipment ? `\n* **Equipment:** ${n.equipment}` : ''}
* **Demeanor:** ${n.demeanor || 'None specified'}
* **Relationship:** ${n.relationship || 'Allied with protagonist'}${standingsLine}
* **Background:** ${n.background || 'None specified'}
* **Moves/Boons:** ${n.movesOrBoons || 'None'}
* **Notes:** ${n.notes || 'None'}`;
        }).join('\n\n')
        : '_No supporting NPCs staged yet._';

    let monstersMd = monsters.length
        ? monsters.map(m => {
            if (meta.ruleset === 'fae') {
                const threatStr = m.threatLevel ? `Threat Level ${m.threatLevel}` : 'Standard Threat';
                const layersStr = `${m.currentHarm ?? m.currentLayers ?? 0}/${m.harm ?? m.layers ?? 2} HP`;
                const poolsStr = Array.isArray(m.poolsAtRisk) ? m.poolsAtRisk.join(', ') : (m.poolsAtRisk || 'Health');
                const pressuresStr = Array.isArray(m.pressures) ? m.pressures.join(', ') : (m.pressures || 'None');
                const barriersStr = Array.isArray(m.leverageBarriers) ? m.leverageBarriers.join('; ') : (m.leverageBarriers || 'None');
                const finishStr = m.fullFinishTriggers ? `\n* **Full-Finish Triggers:** ${m.fullFinishTriggers}` : '';
                const notesStr = m.notes ? `\n* **Notes:** ${m.notes}` : '';
                const instinctStr = m.instinct ? `\n* **Instinct:** ${m.instinct}` : '';
                const statusStr = m.status ? `\n* **Status:** ${m.status}` : '';
                return `### 👹 ${m.name}
* **${threatStr}** | **Leverage Layers:** ${layersStr}
* **Pools at Risk:** ${poolsStr}
* **Pressures:** ${pressuresStr}${instinctStr}${statusStr}
* **Leverage Barriers:** ${barriersStr}${finishStr}${notesStr}`;
            }
            let attacks = (m.attacks && m.attacks.length) ? m.attacks.join(', ') : 'Natural attacks';
            let doom = (m.impendingDoom && m.impendingDoom.length)
                ? `\n  * **Countdown Clock:**\n    ${m.impendingDoom.map(d => `* ${d}`).join('\n    ')}`
                : '';
            const mCurHarm = parseInt(m.currentHarm ?? m.harm?.current, 10) || 0;
            const mMaxHarm = parseInt(m.harm?.max ?? m.harm, 10) || 4;
            const harmStr = mCurHarm > 0 ? `${mCurHarm}/${mMaxHarm} (Wounded)` : `${mMaxHarm}`;
            const statusLine = m.status ? `\n* **Status:** ${m.status}` : (mCurHarm > 0 ? '\n* **Status:** (-) Wounded' : '');
            return `### 👹 ${m.name}
* **Harm:** ${harmStr} | **Armor:** ${m.armor || 0}${statusLine}
* **Attacks:** ${attacks}
* **Weakness:** ${m.weakness || 'Unknown'}${doom}
* **Notes:** ${m.notes || 'None'}`;
        }).join('\n\n')
        : '_No adversaries staged yet._';

    let factionsMd = (dossier.factions || []).length
        ? dossier.factions.map(f => `### 🚩 ${f.name}
* **Agenda:** ${f.agenda || 'None specified'}
* **Standing:** ${f.standing || 'Neutral'}
* **Notes:** ${f.notes || 'None'}`).join('\n\n')
        : '_No factions staged yet._';

    let mapsMd = maps.length
        ? maps.map(m => `* **${m.site}** (${m.kind} · Threat: ${m.threat})
  * Entrance: ${m.entrance}
  * Premise: ${m.briefDescription}`).join('\n')
        : '_No locations staged yet._';

    let worldRulesMd = '';
    if (dossier.worldRules?.axioms && dossier.worldRules.axioms.length) {
        worldRulesMd = '\n\n---\n\n## 🌐 World Rules & Physical Axioms:\n' +
            dossier.worldRules.axioms.map(r => {
                let subLines = (r.substitutions && r.substitutions.length)
                    ? `\n* **Substitutions:**\n  ${r.substitutions.map(s => `* ${s}`).join('\n  ')}`
                    : '';
                let conLines = (r.negativeConstraints && r.negativeConstraints.length)
                    ? `\n* **Negative Constraints (Banned):**\n  ${r.negativeConstraints.map(c => `* ${c}`).join('\n  ')}`
                    : '';
                let archLine = r.architecturalNotes
                    ? `\n* **Architectural Implications:** ${r.architecturalNotes}`
                    : '';
                return `### 🌐 ${r.title} (${r.category || 'general'})\n* **Core Axiom:** ${r.axiom || 'None specified'}${subLines}${conLines}${archLine}`;
            }).join('\n\n');
    }

    let customModuleMd = '';
    if (dossier.worldRules?.customModule) {
        const cm = dossier.worldRules.customModule;
        const cmTag = cm.tag || cm.fieldKey || 'CUSTOM';
        const cmSample = cm.sampleContent || cm.sample || '';
        const sampleBlock = cmSample ? `\n\n\`\`\`text\n${cmSample}\n\`\`\`` : '';
        customModuleMd = `\n\n---\n\n## 📊 Custom Tracker Module:\n* **Tag:** [${cmTag}]\n* **Label:** ${cm.label || cmTag}\n* **Icon:** ${cm.icon || '📦'}\n* **State Model Instruction:** ${cm.instruction || 'None'}${sampleBlock}`;
    }

    const toneLine = meta.tone
        ? `\n* **Tone:** ${meta.tone}`
        : '';

    const isFae = meta.ruleset === 'fae';
    const isHeroicTier = Boolean(
        dossier.config?.heroicTier ||
        dossier.config?.heroic_tier ||
        dossier.config?.knobs?.heroic_tier ||
        dossier.character?.heroic_domain ||
        dossier.protagonist?.heroicDomain
    );
    const systemLine = isFae
        ? `* **System Engine:** Freeform Attrition Engine (${meta.systemLabel || 'Cosmic Horror'}) (\`${meta.systemKey || 'cosmic_horror'}\`)`
        : `* **System Engine:** ${meta.systemLabel || 'PbtA Fantasy'} (\`${meta.systemKey || 'fantasy'}\`)`;
    const heroicKnobStr = (isFae && isHeroicTier) ? ' | Heroic: ON' : '';
    const knobsLine = (isFae && dossier.config?.knobs)
        ? `\n* **FAE Knobs:** Flee Grace: ${dossier.config.knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Shift: ${dossier.config.knobs.base_attrition_shift >= 0 ? '+' + dossier.config.knobs.base_attrition_shift : dossier.config.knobs.base_attrition_shift} | Overflow: ${dossier.config.knobs.overflow_default || 'scar_and_ko'}${heroicKnobStr}`
        : '';

    let protagonistSection = '';
    if (isFae) {
        const poolsMd = Object.values(p.pools || {}).map(pool =>
            `* **${pool.label} (${pool.current}/${pool.max}):** Recovery via \`${pool.recovery}\` · Zero Debuff: "${pool.zero_debuff}" · Overflow: \`${pool.on_overflow}\``
        ).join('\n') || '* No resource pools established.';

        const posTagsMd = (p.positiveTags || []).map(t => `* ${t}`).join('\n') || '* No positive tags registered yet.';
        const negTagsMd = (p.negativeTags || []).map(t => `* ${t}`).join('\n') || '* None.';

        const heroicDomain = p.heroicDomain || p.heroic_domain || dossier.character?.heroic_domain;
        const heroicDomainLine = (isHeroicTier && heroicDomain) ? `\n* **Heroic Domain:** ${heroicDomain}` : '';

        protagonistSection = `## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Archetype:** ${p.playbook || 'Investigator'}${heroicDomainLine}${p.species ? `\n* **Species:** ${p.species}` : ''}${p.appearance ? `\n* **Appearance:** ${p.appearance}` : ''}${p.equipment ? `\n* **Equipment:** ${p.equipment}` : ''}${p.personality ? `\n* **Personality:** ${p.personality}` : ''}
* **Background Bio:** ${p.bio || p.background || 'None'}

### 🧪 Resource Pools:
${poolsMd}

### 🏷️ Positive Tags (Signature Gear & Traits):
${posTagsMd}

### 🩹 Scars & Debuffs:
${negTagsMd}`;
    } else {
        protagonistSection = `## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Playbook:** ${p.playbook || 'Wanderer'}${p.species ? `\n* **Species:** ${p.species}` : ''}${p.appearance ? `\n* **Appearance:** ${p.appearance}` : ''}${p.equipment ? `\n* **Equipment:** ${p.equipment}` : ''}${p.personality ? `\n* **Personality:** ${p.personality}` : ''}${p.habits ? `\n* **Habits:** ${p.habits}` : ''}
* **Stats:** ${statString || 'Not assigned'}
* **Harm Capacity:** ${(p.harm?.current > 0) ? `${p.harm.current}/${p.harm.max || 5} (Wounded)` : (p.harm?.max || 5)} | **Armor:** ${p.harm?.armor || 0}${(p.status || (p.harm?.current > 0 ? '(-) Wounded' : '')) ? `\n* **Status:** ${p.status || '(-) Wounded'}` : ''}${(p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) ? `\n* **Conditions:** ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}` : ''}
* **Background Bio:** ${p.bio || p.background || 'None'}

### ⚡ Key Moves:
${movesMd}

### 🎒 Starting Gear:
${gearMd}`;
    }

    return `# 📜 CAMPAIGN DOSSIER: ${meta.title || (isFae ? 'Untitled FAE Campaign' : 'Untitled PbtA Campaign')}

${systemLine}${knobsLine}
* **Premise:** ${meta.premise || 'Not specified'}${toneLine}

---

${protagonistSection}

---

## 👥 Supporting Cast & Allies (NPCs):
${npcsMd}

---

## 👹 Threats & Monsters:
${monstersMd}

---

## 🚩 Factions & Powers:
${factionsMd}

---

## 🗺️ Locations & Sites:
${mapsMd}${worldRulesMd}${customModuleMd}

---

## ⚡ The Kick (Opening Crisis):
* **Starting Point:** ${kick.startingLocation || 'The road'}
* **Inciting Crisis:** ${kick.crisis || 'Trouble approaches'}
* **Opening Hook:** ${kick.openingPrompt || 'You stand at the threshold...'}${includeCyoa && dossier.cyoaExamples && dossier.cyoaExamples.length ? `\n\n---\n\n## 🎲 Tailored CYOA Move Choices:\n${dossier.cyoaExamples.map(c => `* ${c}`).join('\n')}` : ''}${dossier.config ? `\n\n---\n\n## ⚙️ Campaign Calibration Dials:
* **Playstyle:** ${dossier.config.playstyle || 'cyoa_5'}
* **Harm Capacity:** ${dossier.config.harmMax || 5}
* **Party Mode:** ${dossier.config.partyMode || 'squad'}
* **CYOA Emojis:** ${dossier.config.cyoaEmojis !== false ? 'Enabled' : 'Disabled'}${dossier.config.simulationDepth ? `\n* **Simulation Depth:** ${dossier.config.simulationDepth}` : ''}${dossier.config.artStyle ? `\n* **Art Direction:** ${dossier.config.artStyle}` : ''}${dossier.config.pacingXp ? `\n* **XP Pacing:** ${dossier.config.pacingXp}` : ''}${dossier.config.relationships !== undefined ? `\n* **Relationships:** ${dossier.config.relationships !== false ? 'Enabled' : 'Disabled'}` : ''}${dossier.config.maxHarmFate ? `\n* **Max Harm Fate:** ${dossier.config.maxHarmFate.rule || dossier.config.maxHarmFate}${dossier.config.maxHarmFate.statusToken ? ` | **Status Token:** ${dossier.config.maxHarmFate.statusToken}` : ''}` : ''}${(dossier.config.actionTempo || dossier.config.knobs?.action_tempo) ? `\n* **Action Tempo:** ${dossier.config.actionTempo || dossier.config.knobs?.action_tempo}` : ''}${isFae && dossier.config.knobs ? `\n* **Flee Grace:** ${dossier.config.knobs.flee_grace_toggle ? 'ON' : 'OFF'}\n* **Base Attrition Shift:** ${dossier.config.knobs.base_attrition_shift >= 0 ? '+' + dossier.config.knobs.base_attrition_shift : dossier.config.knobs.base_attrition_shift}\n* **Overflow Default:** ${dossier.config.knobs.overflow_default || 'scar_and_ko'}` : ''}${isFae && dossier.config.pacingScenes ? `\n* **Pacing Scenes:** ${dossier.config.pacingScenes}` : ''}` : ''}`;
}

/**
 * Normalizes, repairs, and heals a PbtA Campaign Dossier object to guarantee
 * full compliance with the active runtime schema. Resilient against missing
 * fields, legacy version structures, or corrupt data types.
 *
 * @param {object} dossier Raw or partially loaded dossier
 * @param {string} [rawMarkdown=''] Optional source markdown for contextual recovery
 * @returns {object} Fully validated and healed dossier
 */
export function healAndNormalizeDossier(dossier, rawMarkdown = '') {
    const empty = createEmptyDossier();
    if (!dossier || typeof dossier !== 'object') {
        dossier = createEmptyDossier();
    }

    // 1. Meta
    dossier.meta = dossier.meta || {};
    const rulesetId = systemRegistry.detectRuleset(dossier);
    const adapter = systemRegistry.get(rulesetId);
    dossier.meta.ruleset = adapter.id;
    const isFae = adapter.id === 'fae';

    const genres = adapter.getGenres();
    const rawKey = (dossier.meta.systemKey || '').toLowerCase();
    if (rawKey && genres[rawKey]) {
        dossier.meta.systemKey = rawKey;
        dossier.meta.systemLabel = (dossier.meta.systemLabel && rawKey === 'custom') ? dossier.meta.systemLabel : (genres[rawKey].label || rawKey);
    } else if (rawKey) {
        dossier.meta.systemKey = rawKey;
        dossier.meta.systemLabel = dossier.meta.systemLabel || (rawKey === 'custom' ? `Custom ${adapter.id.toUpperCase()} Setting` : rawKey);
    } else {
        const found = Object.values(genres).find(g =>
            (rawKey && g.id?.toLowerCase() === rawKey) ||
            (dossier.meta.systemLabel && g.label?.toLowerCase().includes(dossier.meta.systemLabel.toLowerCase()))
        );
        dossier.meta.systemKey = found ? (found.id || found.key) : adapter.getDefaultGenre();
        dossier.meta.systemLabel = found ? found.label : (adapter.getGenre(dossier.meta.systemKey)?.label || dossier.meta.systemKey);
    }

    if (!dossier.meta.title || typeof dossier.meta.title !== 'string') {
        dossier.meta.title = `Untitled ${adapter.id === 'fae' ? 'FAE' : (adapter.id === 'pbta' ? 'PbtA' : adapter.id.toUpperCase())} Campaign`;
    }
    dossier.meta.premise = dossier.meta.premise || '';
    dossier.meta.tone = dossier.meta.tone || '';
    dossier.meta.createdAt = dossier.meta.createdAt || Date.now();
    if (dossier.meta.genreEstablished !== undefined) {
        dossier.meta.genreEstablished = Boolean(dossier.meta.genreEstablished);
    } else {
        dossier.meta.genreEstablished = Boolean(
            dossier.meta.systemKey &&
            (FAE_GENRES[dossier.meta.systemKey] || PBTA_GENRES[dossier.meta.systemKey] || dossier.meta.systemKey === 'custom')
        );
    }

    const activeGenre = isFae
        ? (FAE_GENRES[dossier.meta.systemKey] || FAE_GENRES.cosmic_horror)
        : (PBTA_GENRES[dossier.meta.systemKey] || PBTA_GENRES.fantasy);

    // 2. Config & Dials
    dossier.config = dossier.config || {};
    let harmMaxVal = parseInt(dossier.config.harmMax, 10);
    if (!isNaN(harmMaxVal)) {
        harmMaxVal = Math.max(2, Math.min(8, harmMaxVal));
    } else {
        const protoHarmMax = parseInt(dossier.protagonist?.harm?.max ?? (typeof dossier.protagonist?.harm === 'number' ? dossier.protagonist?.harm : null), 10);
        harmMaxVal = !isNaN(protoHarmMax) ? Math.max(2, Math.min(8, protoHarmMax)) : 5;
    }
    dossier.config.harmMax = harmMaxVal;

    let ps = (dossier.config.playstyle || 'cyoa_5').toLowerCase();
    if (!['cyoa_5', 'cyoa_3', 'freeform'].includes(ps)) ps = 'cyoa_5';
    dossier.config.playstyle = ps;

    let pm = (dossier.config.partyMode || 'squad').toLowerCase();
    if (!['squad', 'solo', 'duo'].includes(pm)) pm = 'squad';
    dossier.config.partyMode = pm;

    let sd = (dossier.config.simulationDepth || 'active_fronts').toLowerCase();
    if (!['active_fronts', 'living_world', 'static'].includes(sd)) sd = 'active_fronts';
    dossier.config.simulationDepth = sd;

    let tempo = (dossier.config.actionTempo || dossier.config.knobs?.action_tempo || 'gritty_default').toLowerCase();
    if (!['action_serial', 'gritty_default', 'slow_burn', 'slice_of_life'].includes(tempo)) tempo = 'gritty_default';
    dossier.config.actionTempo = tempo;
    if (dossier.config.knobs) dossier.config.knobs.action_tempo = tempo;

    let xp = parseInt(dossier.config.pacingXp, 10);
    if (isNaN(xp) || xp < 1 || xp > 10) xp = 5;
    dossier.config.pacingXp = xp;

    dossier.config.cyoaEmojis = dossier.config.cyoaEmojis !== false;
    dossier.config.relationships = dossier.config.relationships !== false;
    dossier.config.artStyle = dossier.config.artStyle || '';

    // Max Harm Fate normalization
    if (dossier.config.maxHarmFate) {
        if (typeof dossier.config.maxHarmFate === 'string') {
            const str = dossier.config.maxHarmFate.trim();
            const parts = str.split('|');
            const rule = parts[0].trim();
            let statusToken = parts[1] ? parts[1].replace(/^(?:status(?:\s*token)?\s*:?\s*)/i, '').trim() : '(-) Incapacitated';
            if (!statusToken.startsWith('(-)') && !statusToken.startsWith('(+)')) statusToken = `(-) ${statusToken}`;
            dossier.config.maxHarmFate = {
                rule,
                statusToken,
                cyoaStyle: /respawn|graveyard|shrine/i.test(rule) ? 'respawn' : /burnout|exhaust|faint/i.test(rule) ? 'burnout' : 'crisis',
            };
        } else if (typeof dossier.config.maxHarmFate === 'object') {
            const rule = String(dossier.config.maxHarmFate.rule || 'Mortal Peril (Last Breath / Dying)').trim();
            let statusToken = String(dossier.config.maxHarmFate.statusToken || '(-) Incapacitated').trim();
            if (!statusToken.startsWith('(-)') && !statusToken.startsWith('(+)')) statusToken = `(-) ${statusToken}`;
            dossier.config.maxHarmFate = {
                rule,
                statusToken,
                cyoaStyle: dossier.config.maxHarmFate.cyoaStyle || (/respawn|graveyard|shrine/i.test(rule) ? 'respawn' : /burnout|exhaust|faint/i.test(rule) ? 'burnout' : 'crisis'),
            };
        }
    } else {
        dossier.config.maxHarmFate = {
            rule: 'Mortal Peril (Last Breath / Dying)',
            statusToken: '(-) Incapacitated',
            cyoaStyle: 'crisis',
        };
    }

    // 3. Protagonist
    dossier.protagonist = dossier.protagonist || {};
    dossier.protagonist.name = (dossier.protagonist.name || '').trim();
    dossier.protagonist.playbook = (dossier.protagonist.playbook || '').trim();
    dossier.protagonist.species = sanitizeSpeciesValue(dossier.protagonist.species || '') || (dossier.protagonist.species || '').trim();
    dossier.protagonist.bio = dossier.protagonist.bio || dossier.protagonist.background || '';
    dossier.protagonist.background = dossier.protagonist.background || dossier.protagonist.bio || '';
    dossier.protagonist.portraitSrc = dossier.protagonist.portraitSrc || null;
    dossier.protagonist.conditions = sanitizeConditionsList(dossier.protagonist.conditions || []);

    // Harm normalization
    let protoHarmObj = { max: harmMaxVal, current: 0, armor: 0 };
    if (typeof dossier.protagonist.harm === 'number') {
        protoHarmObj.max = harmMaxVal;
    } else if (typeof dossier.protagonist.harm === 'string') {
        const parts = dossier.protagonist.harm.split('/');
        if (parts.length === 2) {
            protoHarmObj.current = parseInt(parts[0], 10) || 0;
            protoHarmObj.max = harmMaxVal;
        } else {
            protoHarmObj.max = harmMaxVal;
        }
    } else if (dossier.protagonist.harm && typeof dossier.protagonist.harm === 'object') {
        protoHarmObj.max = harmMaxVal;
        protoHarmObj.current = parseInt(dossier.protagonist.harm.current, 10) || 0;
        protoHarmObj.armor = parseInt(dossier.protagonist.harm.armor, 10) || 0;
    }
    protoHarmObj.max = Math.max(2, Math.min(8, protoHarmObj.max));
    protoHarmObj.current = Math.max(0, Math.min(protoHarmObj.max, protoHarmObj.current));
    protoHarmObj.armor = Math.max(0, protoHarmObj.armor);
    dossier.protagonist.harm = protoHarmObj;
    dossier.config.harmMax = protoHarmObj.max; // strictly synchronize

    if (dossier.protagonist.status) {
        dossier.protagonist.status = String(dossier.protagonist.status).trim();
    } else {
        dossier.protagonist.status = protoHarmObj.current > 0 ? '(-) Wounded' : '';
    }

    adapter.normalizeProtagonist(dossier.protagonist, dossier.meta.systemKey, dossier);

    const defaultGear = adapter.getDefaultGear();

    if (dossier.protagonist.equipment && isPlaceholderGearList(dossier.protagonist.gear)) {
        const fromEquip = splitEquipmentIntoGearList(dossier.protagonist.equipment);
        dossier.protagonist.gear = fromEquip.length > 0
            ? fromEquip
            : defaultGear;
    } else if (!Array.isArray(dossier.protagonist.gear) || dossier.protagonist.gear.length === 0) {
        dossier.protagonist.gear = defaultGear;
    } else if (!dossier.protagonist.equipment && !isPlaceholderGearList(dossier.protagonist.gear)) {
        dossier.protagonist.equipment = dossier.protagonist.gear.join(', ');
    }

    // 4. Arrays
    dossier.npcs = Array.isArray(dossier.npcs) ? dossier.npcs : [];
    dossier.npcs.forEach(n => {
        n.name = (n.name || 'Unnamed NPC').trim();
        n.role = (n.role || 'Ally').trim();
        if (n.species) {
            n.species = sanitizeSpeciesValue(n.species) || n.species.trim();
        }
        if (n.conditions) {
            n.conditions = sanitizeConditionsList(n.conditions);
        }
        n.friendship = clampRelationshipScore(n.friendship);
        n.affection = clampRelationshipScore(n.affection);
    });

    dossier.monsters = Array.isArray(dossier.monsters) ? dossier.monsters : [];
    adapter.normalizeMonsters(dossier.monsters, dossier.meta.systemKey, dossier);

    dossier.factions = Array.isArray(dossier.factions) ? dossier.factions : [];
    dossier.factions.forEach(f => {
        f.name = (f.name || 'Faction').trim();
        f.standing = (f.standing || 'Neutral').trim();
        f.agenda = f.agenda || '';
    });

    dossier.maps = Array.isArray(dossier.maps) ? dossier.maps : [];
    dossier.cyoaExamples = Array.isArray(dossier.cyoaExamples) ? dossier.cyoaExamples : [];

    // 5. theKick
    dossier.theKick = dossier.theKick || {};
    dossier.theKick.startingLocation = dossier.theKick.startingLocation || '';
    dossier.theKick.crisis = dossier.theKick.crisis || '';
    dossier.theKick.openingPrompt = dossier.theKick.openingPrompt || '';

    // 6. worldRules
    dossier.worldRules = dossier.worldRules || {};
    dossier.worldRules.axioms = Array.isArray(dossier.worldRules.axioms) ? dossier.worldRules.axioms : [];
    if (dossier.worldRules.customModule && typeof dossier.worldRules.customModule === 'object') {
        const cm = dossier.worldRules.customModule;
        const normalizedTag = (cm.tag || cm.fieldKey || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'CUSTOM';
        const normalizedSample = cm.sampleContent ?? cm.sample ?? '';
        dossier.worldRules.customModule = {
            ...cm,
            tag: normalizedTag,
            fieldKey: normalizedTag,
            label: cm.label || normalizedTag,
            icon: cm.icon || '📦',
            instruction: cm.instruction || '',
            sampleContent: normalizedSample,
            sample: normalizedSample,
        };
    } else {
        dossier.worldRules.customModule = null;
    }

    // 7. contemplation
    dossier.contemplation = dossier.contemplation && typeof dossier.contemplation === 'object'
        ? {
            coreTension: dossier.contemplation.coreTension || '',
            worldConsequences: dossier.contemplation.worldConsequences || '',
            webOfEntanglement: dossier.contemplation.webOfEntanglement || '',
            kickPressure: dossier.contemplation.kickPressure || '',
        }
        : {
            coreTension: '',
            worldConsequences: '',
            webOfEntanglement: '',
            kickPressure: '',
        };

    return dossier;
}

/**
 * Parses markdown representation of a Campaign Dossier into a validated,
 * self-healed PbtaCampaignDossier object.
 *
 * @param {string} markdown
 * @returns {object|null}
 */
export function parseMarkdownToDossier(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;

    // Detect ruleset and optional genre key from markdown before initializing base dossier
    const isFae = /\bFreeform Attrition Engine\b/i.test(markdown)
        || /\bFAE Knobs:\b/i.test(markdown)
        || /\bResource Pools:\b/i.test(markdown)
        || /\bPositive Tags\b/i.test(markdown)
        || /\bLeverage Layers:\b/i.test(markdown);

    const initialRuleset = isFae ? 'fae' : 'pbta';
    let initialGenreKey = null;
    const preSysLineMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^\n\r]+)/i);
    if (preSysLineMatch) {
        const preKeyMatch = preSysLineMatch[1].match(/[`(]([a-z0-9_\-]+)[`)]/i);
        if (preKeyMatch) {
            initialGenreKey = preKeyMatch[1].toLowerCase();
        }
    }

    const dossier = createEmptyDossier(initialRuleset, initialGenreKey);

    // 1. Title (flexible matching for legacy versions)
    const titleMatch = markdown.match(/(?:#\s*)?(?:📜\s*)?(?:CAMPAIGN DOSSIER|Campaign Blueprint|Campaign Overview|Campaign Dossier)[:\s]*([^\n\r]+)/i);
    if (titleMatch) dossier.meta.title = titleMatch[1].trim();

    // 2. System Engine (flexible matching)
    const systemLineMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^\n\r]+)/i);
    if (systemLineMatch) {
        const fullSysLine = systemLineMatch[1].trim();
        const keyMatch = fullSysLine.match(/[`(]([a-z0-9_\-]+)[`)]/i);
        if (keyMatch && (PBTA_GENRES[keyMatch[1].toLowerCase()] || FAE_GENRES[keyMatch[1].toLowerCase()])) {
            dossier.meta.systemKey = keyMatch[1].toLowerCase();
        }
        dossier.meta.systemLabel = fullSysLine.replace(/\s*\(?`?[a-z0-9_\-]+`?\)?\s*$/i, '').trim();
    }

    // 2b. FAE Knobs
    const knobsMatch = markdown.match(/\*\s*\*\*FAE Knobs:\*\*\s*([^\n\r]+)/i);
    if (knobsMatch) {
        dossier.config = dossier.config || {};
        dossier.config.knobs = dossier.config.knobs || {};
        const kStr = knobsMatch[1];
        if (/\bHeroic:\s*ON\b/i.test(kStr)) {
            dossier.config.heroicTier = true;
            dossier.config.heroic_tier = true;
            dossier.config.knobs.heroic_tier = true;
        } else if (/\bHeroic:\s*OFF\b/i.test(kStr)) {
            dossier.config.heroicTier = false;
            dossier.config.heroic_tier = false;
            dossier.config.knobs.heroic_tier = false;
        }
    }

    // 3. Premise & Tone
    const premiseMatch = markdown.match(/\*\s*\*\*Premise:\*\*\s*([^\n\r]+)/i);
    if (premiseMatch) dossier.meta.premise = premiseMatch[1].trim();

    const toneMatch = markdown.match(/\*\s*\*\*Tone:\*\*\s*([^\n\r]+)/i);
    if (toneMatch) {
        dossier.meta.tone = toneMatch[1].trim();
    }

    // 4. Protagonist (flexible matching)
    const protoMatch = markdown.match(/(?:##\s*)?(?:👤\s*)?Protagonist[:\s]*([^\n\r]+)/i);
    if (protoMatch) dossier.protagonist.name = protoMatch[1].trim();

    const playbookMatch = markdown.match(/\*\s*\*\*(?:Playbook|Archetype):\*\*\s*([^\n\r]+)/i);
    if (playbookMatch) dossier.protagonist.playbook = playbookMatch[1].trim();

    const heroicDomainMatch = markdown.match(/\*\s*\*\*Heroic Domain:\*\*\s*([^\n\r]+)/i);
    if (heroicDomainMatch) {
        dossier.protagonist.heroicDomain = heroicDomainMatch[1].trim();
    }

    const statsMatch = markdown.match(/\*\s*\*\*Stats:\*\*\s*([^\n\r]+)/i);
    if (statsMatch) {
        const parsedStats = parseStatsString(statsMatch[1]);
        if (Object.keys(parsedStats).length > 0) {
            dossier.protagonist.stats = parsedStats;
        }
    }

    const harmMatch = markdown.match(/\*\s*\*\*Harm Capacity:\*\*\s*(?:(\d+)\s*\/\s*(\d+)(?:\s*\([^)]*\))?|(\d+))(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
    if (harmMatch) {
        const curHarm = harmMatch[1] !== undefined ? (parseInt(harmMatch[1], 10) || 0) : 0;
        const maxHarm = harmMatch[2] !== undefined ? (parseInt(harmMatch[2], 10) || 5) : (parseInt(harmMatch[3], 10) || 5);
        dossier.protagonist.harm = {
            max: maxHarm,
            current: curHarm,
            armor: parseInt(harmMatch[4], 10) || 0,
        };
    }

    const bioMatch = markdown.match(/\*\s*\*\*Background Bio:\*\*\s*([^\n\r]+)/i);
    if (bioMatch) {
        const bioVal = bioMatch[1].trim();
        if (bioVal && bioVal !== 'None') {
            dossier.protagonist.bio = bioVal;
            dossier.protagonist.background = bioVal;
        }
    }

    const speciesMatch = markdown.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
    if (speciesMatch) dossier.protagonist.species = speciesMatch[1].trim();

    const appMatch = markdown.match(/\*\s*\*\*Appearance:\*\*\s*([^\n\r]+)/i);
    if (appMatch) dossier.protagonist.appearance = appMatch[1].trim();

    const equipMatch = markdown.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);
    if (equipMatch) dossier.protagonist.equipment = equipMatch[1].trim();

    const persMatch = markdown.match(/\*\s*\*\*Personality:\*\*\s*([^\n\r]+)/i);
    if (persMatch) dossier.protagonist.personality = persMatch[1].trim();

    const habitsMatch = markdown.match(/\*\s*\*\*Habits:\*\*\s*([^\n\r]+)/i);
    if (habitsMatch) dossier.protagonist.habits = habitsMatch[1].trim();

    // 5. Moves
    const movesMatch = markdown.match(/###\s*(?:⚡\s*)?Key Moves:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (movesMatch) {
        const lines = movesMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('No custom'));
        if (lines.length) dossier.protagonist.startingMoves = lines;
    }

    // 6. Gear
    const gearMatch = markdown.match(/###\s*(?:🎒\s*)?Starting Gear:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (gearMatch) {
        const lines = gearMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('Basic'));
        if (lines.length) dossier.protagonist.gear = lines;
    }

    // 6a. FAE Positive Tags & Scars
    const posTagsMatch = markdown.match(/###\s*(?:🏷️\s*)?Positive Tags[^\n]*:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (posTagsMatch) {
        const lines = posTagsMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('No positive'));
        if (lines.length) dossier.protagonist.positiveTags = lines;
    }
    const scarsMatch = markdown.match(/###\s*(?:🩹\s*)?(?:Scars & Debuffs|Scars)[^\n]*:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (scarsMatch) {
        const lines = scarsMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('None'));
        if (lines.length) dossier.protagonist.negativeTags = lines;
    }

    // 6b. Supporting NPCs / Allies
    const npcSection = markdown.match(/##\s*(?:👥\s*)?Supporting Cast[^\n]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (npcSection) {
        const npcBlocks = npcSection[1].split(/###\s*(?:👤\s*)?/);
        for (const block of npcBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const roleM = block.match(/\*\s*\*\*Role:\*\*\s*([^\n\r]+)/i);
            const appM = block.match(/\*\s*\*\*Appearance:\*\*\s*([^\n\r]+)/i);
            const demeanorM = block.match(/\*\s*\*\*Demeanor:\*\*\s*([^\n\r]+)/i);
            const relM = block.match(/\*\s*\*\*Relationship:\*\*\s*([^\n\r]+)/i);
            const standingsM = block.match(/\*\s*\*\*Standings:\*\*\s*Friendship\s*([+-]?\d+)\s*·\s*Affection\s*([+-]?\d+)/i);
            const bgM = block.match(/\*\s*\*\*Background:\*\*\s*([^\n\r]+)/i);
            const boonsM = block.match(/\*\s*\*\*Moves\/Boons:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const speciesM = block.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
            const equipM = block.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);
            const archM = block.match(/\*\s*\*\*Archetype:\*\*\s*([^\n\r]+)/i);

            const role = roleM ? roleM[1].trim() : 'Ally';
            const relText = relM ? relM[1].trim() : '';
            let fVal = 0;
            let aVal = 0;
            if (standingsM) {
                fVal = clampRelationshipScore(standingsM[1]);
                aVal = clampRelationshipScore(standingsM[2]);
            } else {
                const inferred = inferStartingNpcRelationships(role, relText);
                fVal = inferred.friendship;
                aVal = inferred.affection;
            }

            dossier.npcs.push({
                name,
                role,
                archetype: archM ? archM[1].trim() : '',
                species: speciesM ? speciesM[1].trim() : '',
                appearance: appM && !appM[1].includes('None specified') ? appM[1].trim() : '',
                equipment: equipM ? equipM[1].trim() : '',
                demeanor: demeanorM ? demeanorM[1].trim() : '',
                relationship: relText,
                friendship: fVal,
                affection: aVal,
                background: bgM ? bgM[1].trim() : '',
                movesOrBoons: boonsM ? boonsM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                portraitSrc: null,
            });
        }
    }

    // 7. Monsters
    const monsterSection = markdown.match(/##\s*(?:👹\s*)?Threats & Monsters:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (monsterSection) {
        const monsterBlocks = monsterSection[1].split(/###\s*(?:👹\s*)?/);
        for (const block of monsterBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const harmArmorM = block.match(/\*\s*\*\*Harm:\*\*\s*(?:(\d+)\s*\/\s*(\d+)(?:\s*\([^)]*\))?|(\d+))(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
            const faeThreatM = block.match(/\*\s*\*\*(?:Threat Level (\d+)|([^|*]+))\*\*\s*\|\s*\*\*Leverage Layers:\*\*\s*(?:(\d+)\s*\/\s*(\d+)|(\d+))/i);
            const poolsM = block.match(/\*\s*\*\*Pools at Risk:\*\*\s*([^\n\r]+)/i);
            const pressuresM = block.match(/\*\s*\*\*Pressures:\*\*\s*([^\n\r]+)/i);
            const instinctM = block.match(/\*\s*\*\*Instinct:\*\*\s*([^\n\r]+)/i);
            const statusM = block.match(/\*\s*\*\*Status:\*\*\s*([^\n\r]+)/i);
            const barriersM = block.match(/\*\s*\*\*Leverage Barriers:\*\*\s*([^\n\r]+)/i);
            const finishM = block.match(/\*\s*\*\*Full-Finish Triggers:\*\*\s*([^\n\r]+)/i);
            const attacksM = block.match(/\*\s*\*\*Attacks:\*\*\s*([^\n\r]+)/i);
            const weaknessM = block.match(/\*\s*\*\*Weakness:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const doomM = block.match(/\*\s*\*\*Countdown Clock:\*\*\s*([\s\S]*?)(?=\*\s*\*\*Notes:|$)/i);
            const impendingDoom = [];
            if (doomM) {
                const dLines = doomM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                impendingDoom.push(...dLines);
            }

            const threatLevelNum = faeThreatM ? (parseInt(faeThreatM[1], 10) || null) : null;
            const curHarm = harmArmorM && harmArmorM[1] !== undefined ? (parseInt(harmArmorM[1], 10) || 0) : (faeThreatM && faeThreatM[3] !== undefined ? (parseInt(faeThreatM[3], 10) || 0) : 0);
            const maxHarm = harmArmorM
                ? (harmArmorM[2] !== undefined ? (parseInt(harmArmorM[2], 10) || 3) : (parseInt(harmArmorM[3], 10) || 3))
                : (faeThreatM ? (faeThreatM[4] !== undefined ? (parseInt(faeThreatM[4], 10) || 2) : (parseInt(faeThreatM[5], 10) || 2)) : 3);

            dossier.monsters.push({
                name,
                harm: maxHarm,
                currentHarm: curHarm,
                armor: harmArmorM ? (parseInt(harmArmorM[4], 10) || 0) : 0,
                attacks: attacksM ? attacksM[1].split(',').map(s => s.trim()) : [],
                weakness: weaknessM ? weaknessM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                impendingDoom,
                threatLevel: threatLevelNum,
                layers: maxHarm,
                currentLayers: curHarm,
                poolsAtRisk: poolsM ? poolsM[1].split(',').map(s => s.trim()) : null,
                pressures: pressuresM ? pressuresM[1].split(',').map(s => s.trim()) : [],
                instinct: instinctM ? instinctM[1].trim() : '',
                status: statusM ? statusM[1].trim() : '',
                leverageBarriers: barriersM ? barriersM[1].split(';').map(s => s.trim()) : [],
                fullFinishTriggers: finishM ? finishM[1].trim() : '',
            });
        }
    }

    // 7b. Factions & Powers
    const factionSection = markdown.match(/##\s*(?:🚩\s*)?Factions & Powers:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (factionSection) {
        const fBlocks = factionSection[1].split(/###\s*(?:🚩\s*)?/);
        for (const block of fBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const agendaM = block.match(/\*\s*\*\*Agenda:\*\*\s*([^\n\r]+)/i);
            const standingM = block.match(/\*\s*\*\*Standing:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            dossier.factions.push({
                name,
                agenda: agendaM ? agendaM[1].trim() : '',
                standing: standingM ? standingM[1].trim() : 'Neutral',
                notes: notesM ? notesM[1].trim() : '',
            });
        }
    }

    // 8. Locations & Sites
    const mapsSection = markdown.match(/##\s*(?:🗺️\s*)?Locations & Sites:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (mapsSection) {
        const mapRe = /\*\s*\*\*([^*]+)\*\*\s*\(([^·\)]+)(?:·\s*Threat:\s*([^)]+))?\)/g;
        let m;
        while ((m = mapRe.exec(mapsSection[1])) !== null) {
            dossier.maps.push({
                site: m[1].trim(),
                kind: m[2].trim(),
                threat: m[3] ? m[3].trim() : 'MODERATE',
                entrance: 'Main Entrance',
                briefDescription: '',
            });
        }
    }

    // 9. The Kick
    const kickSection = markdown.match(/##\s*(?:⚡\s*)?The Kick[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (kickSection) {
        const startM = kickSection[1].match(/\*\s*\*\*Starting Point:\*\*\s*([^\n\r]+)/i);
        const crisisM = kickSection[1].match(/\*\s*\*\*Inciting Crisis:\*\*\s*([^\n\r]+)/i);
        const hookM = kickSection[1].match(/\*\s*\*\*Opening Hook:\*\*\s*([^\n\r]+)/i);
        if (startM) dossier.theKick.startingLocation = startM[1].trim();
        if (crisisM) dossier.theKick.crisis = crisisM[1].trim();
        if (hookM) dossier.theKick.openingPrompt = hookM[1].trim();
    }

    // 10. CYOA Choices
    const cyoaSection = markdown.match(/##\s*(?:🎲\s*)?Tailored CYOA Move Choices[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (cyoaSection) {
        const lines = cyoaSection[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(Boolean);
        if (lines.length) dossier.cyoaExamples = lines;
    }

    // 11. Configuration Dials
    const configSection = markdown.match(/##\s*(?:⚙️\s*)?Campaign Calibration Dials[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (configSection) {
        const psM = configSection[1].match(/\*\s*\*\*Playstyle:\*\*\s*([^\n\r]+)/i);
        const harmM = configSection[1].match(/\*\s*\*\*Harm Capacity:\*\*\s*([^\n\r]+)/i);
        const partyM = configSection[1].match(/\*\s*\*\*Party Mode:\*\*\s*([^\n\r]+)/i);
        const emM = configSection[1].match(/\*\s*\*\*CYOA Emojis:\*\*\s*([^\n\r]+)/i);
        const simM = configSection[1].match(/\*\s*\*\*Simulation Depth:\*\*\s*([^\n\r]+)/i);
        const artM = configSection[1].match(/\*\s*\*\*Art Direction:\*\*\s*([^\n\r]+)/i);
        const xpM = configSection[1].match(/\*\s*\*\*XP Pacing:\*\*\s*([^\n\r]+)/i);
        const relM = configSection[1].match(/\*\s*\*\*Relationships:\*\*\s*([^\n\r]+)/i);
        const fateM = configSection[1].match(/\*\s*\*\*Max Harm Fate:\*\*\s*([^\n\r|]+)(?:\s*\|\s*\*\*Status Token:\*\*\s*([^\n\r]+))?/i);

        dossier.config = dossier.config || {};
        if (psM) dossier.config.playstyle = psM[1].trim();
        if (harmM) {
            const hVal = parseInt(harmM[1], 10);
            if (!isNaN(hVal)) dossier.config.harmMax = hVal;
        }
        if (partyM) dossier.config.partyMode = partyM[1].trim();
        if (emM) dossier.config.cyoaEmojis = !/disabled|false|off/i.test(emM[1]);
        if (simM) dossier.config.simulationDepth = simM[1].trim();
        if (artM) dossier.config.artStyle = artM[1].trim();
        if (xpM) {
            const xpVal = parseInt(xpM[1], 10);
            if (!isNaN(xpVal)) dossier.config.pacingXp = xpVal;
        }
        if (relM) dossier.config.relationships = !/disabled|false|off/i.test(relM[1]);
        if (fateM) {
            const rule = fateM[1].trim();
            let statusToken = fateM[2] ? fateM[2].trim() : '(-) Incapacitated';
            if (!statusToken.startsWith('(-)') && !statusToken.startsWith('(+)')) statusToken = `(-) ${statusToken}`;
            dossier.config.maxHarmFate = {
                rule,
                statusToken,
                cyoaStyle: /respawn|graveyard|shrine/i.test(rule) ? 'respawn' : /burnout|exhaust|faint/i.test(rule) ? 'burnout' : 'crisis',
            };
        }

        const tempoM = configSection[1].match(/\*\s*\*\*Action Tempo:\*\*\s*([^\n\r]+)/i);
        if (tempoM) {
            const rawTempo = tempoM[1].trim().toLowerCase().replace(/[\s-]+/g, '_');
            const valid = ['action_serial', 'gritty_default', 'slow_burn', 'slice_of_life'].find(t => rawTempo.includes(t));
            if (valid) {
                dossier.config.actionTempo = valid;
                dossier.config.knobs = dossier.config.knobs || {};
                dossier.config.knobs.action_tempo = valid;
            }
        }
        const fleeGraceM = configSection[1].match(/\*\s*\*\*Flee Grace:\*\*\s*([^\n\r]+)/i);
        if (fleeGraceM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.flee_grace_toggle = /on|enabled|true/i.test(fleeGraceM[1]);
        }
        const shiftM = configSection[1].match(/\*\s*\*\*Base Attrition Shift:\*\*\s*([+-]?\d+)/i);
        if (shiftM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.base_attrition_shift = parseInt(shiftM[1], 10);
        }
        const overflowM = configSection[1].match(/\*\s*\*\*Overflow Default:\*\*\s*([^\n\r]+)/i);
        if (overflowM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.overflow_default = overflowM[1].trim();
        }
        const pacingScenesM = configSection[1].match(/\*\s*\*\*Pacing Scenes:\*\*\s*(\d+)/i);
        if (pacingScenesM) {
            dossier.config.pacingScenes = parseInt(pacingScenesM[1], 10);
        }
    }

    // 12. World Rules & Physical Axioms
    const worldRulesSection = markdown.match(/##\s*(?:🌐\s*)?World Rules[^\n]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (worldRulesSection) {
        const ruleBlocks = worldRulesSection[1].split(/###\s*(?:🌐\s*)?/);
        for (const block of ruleBlocks) {
            const lines = block.trim().split('\n');
            const header = lines[0]?.trim();
            if (!header || header.startsWith('_No')) continue;

            const headerM = header.match(/^([^(]+?)(?:\s*\(([^)]+)\))?$/);
            const title = headerM ? headerM[1].trim() : header;
            const category = headerM && headerM[2] ? headerM[2].trim().toLowerCase() : 'general';

            const axiomM = block.match(/\*\s*\*\*Core Axiom:\*\*\s*([^\n\r]+)/i);
            const archM = block.match(/\*\s*\*\*Architectural Implications:\*\*\s*([^\n\r]+)/i);

            const subM = block.match(/\*\s*\*\*Substitutions:\*\*\s*([\s\S]*?)(?=\*\s*\*\*|$)/i);
            const substitutions = [];
            if (subM) {
                const sLines = subM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                substitutions.push(...sLines);
            }

            const conM = block.match(/\*\s*\*\*Negative Constraints[^\*]*:\*\*\s*([\s\S]*?)(?=\*\s*\*\*|$)/i);
            const negativeConstraints = [];
            if (conM) {
                const cLines = conM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                negativeConstraints.push(...cLines);
            }

            dossier.worldRules = dossier.worldRules || { axioms: [], customModule: null };
            dossier.worldRules.axioms = dossier.worldRules.axioms || [];
            dossier.worldRules.axioms.push({
                id: `rule_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
                category,
                title,
                axiom: axiomM ? axiomM[1].trim() : '',
                substitutions,
                negativeConstraints,
                architecturalNotes: archM ? archM[1].trim() : '',
            });
        }
    }

    // 13. Custom Tracker Module
    const customModSection = markdown.match(/##\s*(?:📊\s*)?Custom Tracker Module[^:]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (customModSection) {
        const tagM = customModSection[1].match(/\*\s*\*\*Tag:\*\*\s*\[?([A-Z0-9_]+)\]?/i);
        const labelM = customModSection[1].match(/\*\s*\*\*Label:\*\*\s*([^\n\r]+)/i);
        const iconM = customModSection[1].match(/\*\s*\*\*Icon:\*\*\s*([^\n\r]+)/i);
        const instM = customModSection[1].match(/\*\s*\*\*State Model Instruction:\*\*\s*([^\n\r]+)/i);
        const sampleM = customModSection[1].match(/```(?:text)?\s*([\s\S]*?)```/i);

        if (tagM) {
            const parsedTag = tagM[1].trim().toUpperCase();
            const parsedSample = sampleM ? sampleM[1].trim() : '';
            dossier.worldRules = dossier.worldRules || { axioms: [], customModule: null };
            dossier.worldRules.customModule = {
                tag: parsedTag,
                fieldKey: parsedTag,
                label: labelM ? labelM[1].trim() : parsedTag,
                icon: iconM ? iconM[1].trim() : '📦',
                instruction: instM ? instM[1].trim() : '',
                sampleContent: parsedSample,
                sample: parsedSample,
            };
        }
    }

    const isValid = Boolean(dossier.protagonist.name || dossier.meta.title !== 'Untitled PbtA Campaign' || (dossier.worldRules?.axioms && dossier.worldRules.axioms.length > 0));
    return isValid ? healAndNormalizeDossier(dossier, markdown) : null;
}

/**
 * Parses a [DOSSIER_CRITIQUE] block emitted by the Contemplative Blueprint Judge / Critic.
 *
 * @param {string} rawText
 * @returns {{
 *   verdict: 'PASS'|'REVISE',
 *   score: number,
 *   grade: string,
 *   strengths: string[],
 *   weaknesses: string[],
 *   directives: string[],
 *   shouldRevise: boolean,
 *   rawText: string
 * }}
 */
export function parseDossierCritique(rawText) {
    const defaultCritique = {
        verdict: 'PASS',
        score: 85,
        grade: 'B+',
        strengths: [],
        weaknesses: [],
        directives: [],
        shouldRevise: false,
        rawText: rawText || '',
    };

    if (!rawText || typeof rawText !== 'string') return defaultCritique;

    const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const blockMatch = cleaned.match(/(?:^|\n)[ \t]*\[DOSSIER_CRITIQUE\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/DOSSIER_CRITIQUE\]|$)/i)
        || cleaned.match(/\[DOSSIER_CRITIQUE\]([\s\S]*?)(?:\[\/DOSSIER_CRITIQUE\]|$)/i);
    const body = blockMatch ? blockMatch[1] : cleaned;
    const kv = parseKeyValueLines(body);

    const rawVerdict = String(kv.verdict || '').toUpperCase().trim();
    let score = parseInt(kv.score, 10);
    if (isNaN(score)) score = 85;
    score = Math.max(0, Math.min(100, score));

    const grade = (kv.grade || (score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D')).trim();
    const strengths = parseBulletOrListItems(body, 'strengths', { splitCommas: false });
    const weaknesses = parseBulletOrListItems(body, 'weaknesses', { splitCommas: false });
    const directives = parseBulletOrListItems(body, 'directives', { splitCommas: false });

    const verdict = (rawVerdict === 'REVISE' || (rawVerdict !== 'PASS' && score < 82 && directives.length > 0))
        ? 'REVISE'
        : 'PASS';

    const shouldRevise = (verdict === 'REVISE' || score < 82) && directives.length > 0;

    return {
        verdict,
        score,
        grade,
        strengths,
        weaknesses,
        directives,
        shouldRevise,
        rawText,
    };
}

/**
 * Determines whether the Smart-Gated Contemplative Judge Pass should run after Builder Pass 1.
 * Triggers on:
 *  - Initial campaign scaffolding (previously untitled/empty dossier that now has a premise/protagonist/entities)
 *  - Turn with uploaded lore/card attachments
 *  - Major structural updates touching 3+ distinct blueprint categories in a single turn
 * Bypasses on NOOP, syntax error fallbacks, or minor 1-2 field tweaks.
 *
 * @param {object} params
 * @param {object} [params.prevDossier] Dossier state before Pass 1
 * @param {object} [params.updatedDossier] Dossier state after Pass 1
 * @param {object} [params.builderReport] Report returned by applyDossierUpdates
 * @param {boolean} [params.hasAttachments] Whether attachments were processed this turn
 * @returns {boolean}
 */
export function shouldRunContemplativeJudgePass({
    prevDossier,
    updatedDossier,
    builderReport,
    hasAttachments = false,
} = {}) {
    if (!builderReport || !builderReport.hasMutations || builderReport.isNoop) {
        return false;
    }

    if (hasAttachments) {
        return true;
    }

    // Check if this turn transitioned the blueprint from blank/untitled to initial scaffold
    const wasBlank = !prevDossier || (
        (!prevDossier.meta?.premise) &&
        (!prevDossier.protagonist?.name) &&
        (!prevDossier.npcs || prevDossier.npcs.length === 0) &&
        (!prevDossier.monsters || prevDossier.monsters.length === 0)
    );
    const hasCoreNow = Boolean(
        updatedDossier?.meta?.premise ||
        updatedDossier?.protagonist?.name ||
        (updatedDossier?.npcs && updatedDossier.npcs.length > 0) ||
        (updatedDossier?.monsters && updatedDossier.monsters.length > 0)
    );
    if (wasBlank && hasCoreNow) {
        return true;
    }

    // Count distinct blueprint categories touched in builderReport.changes
    const changes = builderReport.changes || [];
    const categories = new Set();
    for (const ch of changes) {
        if (/^(?:PbtA Engine|Campaign title|Premise|Campaign tone)/i.test(ch)) categories.add('meta');
        else if (/^Protagonist/i.test(ch)) categories.add('protagonist');
        else if (/NPC/i.test(ch)) categories.add('npcs');
        else if (/Adversary|monsters/i.test(ch)) categories.add('monsters');
        else if (/Location|maps/i.test(ch)) categories.add('maps');
        else if (/Faction/i.test(ch)) categories.add('factions');
        else if (/The Kick/i.test(ch)) categories.add('kick');
        else if (/CYOA choices/i.test(ch)) categories.add('cyoa');
        else if (/World Rule|world rules/i.test(ch)) categories.add('worldRules');
        else if (/Custom Tracker Module/i.test(ch)) categories.add('customModule');
        else if (/dial set to/i.test(ch)) categories.add('config');
    }

    return categories.size >= 3;
}

/**
 * Classifies a builder transaction report into a standardized status code.
 * @param {object} [report]
 * @returns {'MUTATED'|'NOOP'|'SYNTAX_ERROR'|'UNRECOGNIZED_OUTPUT'}
 */
export function classifyBuilderReport(report) {
    if (!report) return 'UNRECOGNIZED_OUTPUT';
    if (report.hasMutations) return 'MUTATED';
    if (report.isNoop) return 'NOOP';
    if (report.errors && report.errors.length > 0) return 'SYNTAX_ERROR';
    return 'UNRECOGNIZED_OUTPUT';
}

/**
 * Builds the explicit directive notice for the Talker based on the builder's final status.
 * @param {'MUTATED'|'NOOP'|'SYNTAX_ERROR'|'UNRECOGNIZED_OUTPUT'} status
 * @param {string} [summaryText]
 * @param {string[]} [errors]
 * @returns {string}
 */
export function buildTalkerInstructionNotice(status, summaryText = '', errors = []) {
    if (status === 'MUTATED' || status === 'NOOP') {
        return `[BUILDER_REPORT: ${summaryText}]`;
    }
    if (status === 'SYNTAX_ERROR') {
        const errStr = errors && errors.length ? ` (${errors.join('; ')})` : '';
        return `[BUILDER_ERROR: Attempted update failed validation${errStr}; blueprint unchanged. Please let the player know gently that there was a formatting hiccup and ask what they would like to adjust.]`;
    }
    return `[BUILDER_NOTICE: The Builder output did not include an [UPDATE_DOSSIER] block. No changes were made to the blueprint. Do NOT claim an edit was made. Discuss ideas conversationally with the player.]`;
}

/**
 * Format a builder transaction as a rich Markdown diagnostic trace for Antigravity or bug reporting.
 * @param {object} [tx]
 * @returns {string}
 */
export function formatDiagnosticTrace(tx) {
    if (!tx) return 'No diagnostic trace recorded.';
    const attempts = tx.attempts || [];
    const contempSection = tx.contemplation && (tx.contemplation.coreTension || tx.contemplation.worldConsequences || tx.contemplation.webOfEntanglement || tx.contemplation.kickPressure)
        ? [
            '',
            '#### 🧠 Architectural Contemplation (Pass 1 Scratchpad):',
            `- **Core Tension:** ${tx.contemplation.coreTension || '(none)'}`,
            `- **World Consequences:** ${tx.contemplation.worldConsequences || '(none)'}`,
            `- **Web of Entanglement:** ${tx.contemplation.webOfEntanglement || '(none)'}`,
            `- **Kick Pressure:** ${tx.contemplation.kickPressure || '(none)'}`,
        ]
        : [];

    const critiqueSection = tx.critique
        ? [
            '',
            '#### ⚖️ Blueprint Judge / Critic Pass:',
            `- **Verdict:** ${tx.critique.verdict} (Score: ${tx.critique.score}/100 · Grade: ${tx.critique.grade})`,
            `- **Triggered Second Pass:** ${Boolean(tx.critique.shouldRevise)}`,
            ...(tx.critique.strengths?.length ? [`- **Strengths:** ${tx.critique.strengths.join(' | ')}`] : []),
            ...(tx.critique.weaknesses?.length ? [`- **Weaknesses:** ${tx.critique.weaknesses.join(' | ')}`] : []),
            ...(tx.critique.directives?.length ? [`- **Directives:** ${tx.critique.directives.join(' | ')}`] : []),
        ]
        : [];

    const refinerSection = tx.refinerPass
        ? [
            '',
            '#### 🔨 Second-Pass Refiner:',
            `- **Summary:** ${tx.refinerPass.builderSummary || '(none)'}`,
            `- **Refinements Applied:** ${(tx.refinerPass.changes && tx.refinerPass.changes.length) ? tx.refinerPass.changes.join('; ') : 'None'}`,
        ]
        : [];

    const md = [
        '### 🎩 MultiHog Concierge Builder Diagnostic Trace',
        `- **Timestamp:** ${tx.timestamp || new Date().toISOString()}`,
        `- **Final Status:** ${tx.finalStatus || 'UNKNOWN'}`,
        `- **System Engine:** ${tx.systemEngine || 'fantasy'}`,
        `- **User Prompt:** ${tx.userPrompt || tx.userMessage || '(none)'}`,
        `- **Extracted Summary:** ${tx.builderSummary || '(none)'}`,
        ...contempSection,
        ...critiqueSection,
        ...refinerSection,
        '',
        '#### Execution Attempts:',
        ...attempts.map((a, i) => {
            const errs = a.report?.errors?.length ? a.report.errors.join('; ') : (a.errors?.length ? a.errors.join('; ') : 'None');
            const changes = a.report?.changes?.length ? a.report.changes.join('; ') : 'None';
            const raw = a.rawResponse || '(empty)';
            return [
                `* **Attempt ${a.attempt || a.attemptNumber || i + 1}:**`,
                `  - **Status:** Mutations: ${Boolean(a.report?.hasMutations || a.hasMutations)}, Noop: ${Boolean(a.report?.isNoop || a.isNoop)}`,
                `  - **Errors:** ${errs}`,
                `  - **Mutations:** ${changes}`,
                `  - **Raw Output:**`,
                '```text',
                raw,
                '```',
            ].join('\n');
        }),
        '',
        '#### 📇 Name Diversity Engine (NameRAG) Resolutions:',
        ...(() => {
            const res = tx.nameRagResolutions || [];
            if (!res.length) return ['*(No name placeholders resolved in this transaction)*'];
            return res.map((r, i) => [
                `* **[${i + 1}] ${r.placeholder}** (${r.tag}, ${r.blockType})`,
                `  - **Source:** ${r.source || 'NameRAG'}`,
                `  - **Search Query:** "${r.query || ''}"`,
                `  - **Pool Candidates:** ${(r.candidates && r.candidates.length) ? r.candidates.join(', ') : '(none)'}`,
                `  - **Selected Name:** **${r.selectedName}**`,
            ].join('\n'));
        })(),
        '',
        '#### Last Builder Request (Input Messages):',
        '```json',
        JSON.stringify(tx.builderRequest?.messages || [], null, 2),
        '```',
        '',
        '#### Current Blueprint Snapshot (activeDossier):',
        '```json',
        JSON.stringify(tx.activeDossierSnapshot || tx.currentDossierSnapshot || {}, null, 2),
        '```',
    ].join('\n');
    return md;
}

/**
 * Escapes characters for safe HTML inclusion.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Renders HTML for a single world axiom deck card.
 * @param {object} ax
 * @returns {string}
 */
export function buildAxiomCardHtml(ax) {
    const cat = (ax.category || 'physics').toLowerCase();
    let catColor = 'rgba(156, 163, 175, 0.4)';
    if (cat.includes('bio')) catColor = 'rgba(16, 185, 129, 0.4)';
    else if (cat.includes('magic')) catColor = 'rgba(168, 85, 247, 0.4)';
    else if (cat.includes('physic')) catColor = 'rgba(56, 189, 248, 0.4)';
    else if (cat.includes('social')) catColor = 'rgba(245, 158, 11, 0.4)';

    const subsHtml = ax.substitutions?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>Substitutions:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.substitutions.map(s => `<li>🔄 ${escapeHtml(s)}</li>`).join('')}</ul></div>`
        : '';
    const negHtml = ax.negativeConstraints?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.9;"><b>Banned & Absences:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.negativeConstraints.map(nc => `<li>🚫 <span class="mhc-constraint-banned">${escapeHtml(nc)}</span></li>`).join('')}</ul></div>`
        : '';
    const archHtml = ax.architecturalNotes
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;">🏛️ <b>Infrastructure:</b> ${escapeHtml(ax.architecturalNotes)}</div>`
        : '';

    return `
        <div class="mhc-deck-item collapsible">
            <div class="mhc-deck-item-header">
                <div class="mhc-deck-item-title" style="color: #10b981;">
                    🌐 ${escapeHtml(ax.title || 'World Law')} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${catColor};">${escapeHtml(ax.category || 'physics').toUpperCase()}</span>
                </div>
                <span class="mhc-deck-item-toggle">▼</span>
            </div>
            <div class="mhc-deck-item-detail">
                <div style="font-size: 0.85em; opacity: 0.95; margin-bottom: 4px;"><b>Axiom:</b> ${escapeHtml(ax.axiom || '')}</div>
                ${subsHtml}
                ${negHtml}
                ${archHtml}
            </div>
        </div>
    `;
}
