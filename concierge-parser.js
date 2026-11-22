/// <reference path="./types.d.ts" />
/**
 * concierge-parser.js — MultiHog Companion
 *
 * Parses [CONCIERGE_STATE] blocks from Concierge responses, updates the live
 * Campaign Dossier artifact, and serializes the dossier to Markdown and JSON.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';
import { FAE_GENRES, sanitizeFaePositiveTags } from './fae-ruleset.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import { DND5E_GENRES } from './concierge-system-dnd5e.js';
import { normalizeGameSystemDrivers, extractGameSystemTemplate } from './game-system-bridge.js';
import {
    NEXT_DOSSIER_BLOCK_LOOKAHEAD,
    cleanTargetName,
    stripConciergeStateBlocks,
    parseKeyValueLines,
    parseStatsString,
    parseBulletList,
    splitTopLevelItems,
    parseBulletOrListItems,
    matchDossierSectionBlocks,
    normalizeMalformedDossierClosers,
} from './concierge-block-lexer.js';
import { escapeHtml } from './mhc-utils.js';
import { parseResolvedNameToken } from './namerag-hooks.js';

function canonicalizeResolvedName(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    const mConcept = trimmed.match(/^(.+?)\s*\[concept:\s*(.+?)\]$/i);
    if (mConcept) {
        return `[NAME: ${mConcept[2].trim()}, RESOLVED TO: ${mConcept[1].trim()}]`;
    }
    if (/^\[{1,2}NAME:\s*(.+?)\]{1,2}$/i.test(trimmed) && /,\s*RESOLVED TO:\s*/i.test(trimmed)) {
        const { cleanName, tag, isResolvedToken } = parseResolvedNameToken(trimmed);
        if (isResolvedToken && cleanName && tag) {
            return `[NAME: ${tag}, RESOLVED TO: ${cleanName}]`;
        }
    }
    return raw;
}

function entityNamesMatch(a, b) {
    if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
    const pa = parseResolvedNameToken(a);
    const pb = parseResolvedNameToken(b);
    const ka = (pa.cleanName || a).trim().toLowerCase();
    const kb = (pb.cleanName || b).trim().toLowerCase();
    if (!ka || !kb || ka !== kb) return false;
    // If BOTH are distinct evolved NameRAG tokens with different concept tags, keep them separate
    // (guards against merging two distinct entities if NameRAG/fallback returns a duplicate name).
    if (pa.isResolvedToken && pb.isResolvedToken && pa.tag && pb.tag) {
        if (pa.tag.trim().toLowerCase() !== pb.tag.trim().toLowerCase()) {
            return false;
        }
    }
    return true;
}

export {
    cleanTargetName,
    stripConciergeStateBlocks,
    parseStatsString,
    splitTopLevelItems,
    normalizeMalformedDossierClosers,
    matchDossierSectionBlocks,
    parseKeyValueLines,
    parseBulletList,
    parseBulletOrListItems,
    escapeHtml,
};

export {
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    parseDossierCritique,
    shouldRunContemplativeJudgePass,
    classifyBuilderReport,
    buildTalkerInstructionNotice,
    formatDiagnosticTrace,
    buildAxiomCardHtml,
} from './concierge-markdown-codec.js';

/**
 * Checks if a given campaign title matches any default placeholder (e.g. Untitled PbtA Campaign, Untitled FAE Campaign).
 * @param {string|null|undefined} title
 * @returns {boolean}
 */
export function isDefaultUntitledCampaignTitle(title) {
    if (!title || typeof title !== 'string') return true;
    return /^Untitled(?:\s+[A-Za-z0-9_-]+)?\s+Campaign$/i.test(title.trim());
}

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
            customGenreSpec: null,
            genreEstablished: Boolean(genreKey && genres[genreKey]),
            premise: '',
            tone: '',
            focalLens: '',
            framingComplete: false,
            rulesetConfirmed: false,
            stageNotes: {
                framing: '',
                canon: '',
                adventure: '',
            },
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
    const hasFocalLens = Boolean(meta.focalLens && meta.focalLens.trim() !== '');
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

    return !hasTitle && !hasPremise && !hasFocalLens && !hasProto && !hasNpcs && !hasMonsters && !hasMaps && !hasFactions && !hasKick && !hasCustomRules;
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
            currentNavMode: draft.currentNavMode === 'living-world' ? 'living-world' : 'new-adventure',
            currentAdventureStep: ['initial', 'canon', 'adventure', 'character'].includes(draft.currentAdventureStep) ? draft.currentAdventureStep : 'initial',
            unlockedSteps: draft.unlockedSteps && typeof draft.unlockedSteps === 'object'
                ? { ...draft.unlockedSteps, initial: true }
                : { initial: true, canon: false, adventure: false, character: false },
            stageChatHistories: draft.stageChatHistories && typeof draft.stageChatHistories === 'object'
                ? draft.stageChatHistories
                : { initial: [], canon: [], adventure: [], character: [] },
            stagedCanonEntries: Array.isArray(draft.stagedCanonEntries) ? draft.stagedCanonEntries : [],
            lastSyncedSnapshots: draft.lastSyncedSnapshots && typeof draft.lastSyncedSnapshots === 'object'
                ? draft.lastSyncedSnapshots
                : { framing: null, canon: null, adventure: null },
            attachedSources: Array.isArray(draft.attachedSources) ? draft.attachedSources : [],
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
 * Sanitizes a Heroic Domain string to enforce pure narrative jurisdiction / permissions
 * and purge any invented quantitative mechanics (e.g. daily powers, roll bonuses, pool negation).
 * @param {string} domain 
 * @returns {string}
 */
export function sanitizeHeroicDomain(domain) {
    if (!domain || typeof domain !== 'string') return '';
    let s = domain.trim();
    if (!s || /^(?:none|n\/a|null|false|off)$/i.test(s)) return '';

    const bracketMatch = s.match(/^([^\[\]]+)\[([\s\S]*?)\]$/);
    if (!bracketMatch) {
        return s;
    }

    const archetype = bracketMatch[1].trim();
    let body = bracketMatch[2].trim();

    // Check if mechanical artifacts or numbered list items exist
    const hasMechanics = /\b(?:auto-succeed|auto-success|negate|per session|per day|layer depletion|\+\d+|-\d+|\broll\b|\bpressure roll\b|\bdrain\b|\bpool\b)\b/i.test(body);
    const hasNumbers = /\b\d+[.)]\s*/.test(body);

    if (hasMechanics || hasNumbers) {
        // Split by numbered items or semicolons
        const items = body.split(/(?:;\s*|\s*\b\d+[.)]\s*)/).map(item => item.trim()).filter(Boolean);
        const cleanedPhrases = [];
        for (const item of items) {
            let phrase = item;
            // Strip mechanical clauses:
            // e.g. "Auto-succeed on one Pressure roll per session when shielding the innocent" -> "shielding the innocent"
            phrase = phrase.replace(/\b(?:auto-succeed|auto-success|succeed)\b[^\b]*(?:when|if|while)\s+/i, '');
            // e.g. "+1 to Pressure rolls when rallying the broken" -> "rallying the broken"
            phrase = phrase.replace(/[+-]\d+\s+(?:to\s+)?(?:pressure\s+rolls?|rolls?|actions?|tests?)\s+(?:when|if|while)\s+/i, '');
            phrase = phrase.replace(/\b(?:or\s+)?negate\s+[^,;\.]*(?:from\s+[^,;\.]*)?/gi, '');
            phrase = phrase.replace(/\bper\s+(?:session|day|scene|turn|rest)\b/gi, '');
            phrase = phrase.replace(/\b(?:from\s+the\s+\w+\s+pool|from\s+\w+\s+pool)\b/gi, '');
            phrase = phrase.replace(/\b(?:on\s+one\s+pressure\s+roll|on\s+pressure\s+rolls?)\b/gi, '');
            phrase = phrase.replace(/\b(?:layer\s+depletion|pool\s+drain|damage)\b/gi, '');
            phrase = phrase.replace(/^[0-9]+[.)]\s*/, '');
            phrase = phrase.replace(/^[,\s;—–-]+|[,\s;—–-]+$/g, '').trim();
            if (phrase.length > 2) {
                cleanedPhrases.push(phrase);
            }
        }
        if (cleanedPhrases.length > 0) {
            body = cleanedPhrases.join(', ');
        }
    }

    return `${archetype} [${body}]`;
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

    const rulesetId = systemRegistry.detectRuleset(dossier);
    const adapter = systemRegistry.get(rulesetId);
    const isFae = adapter.id === 'fae';
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

    const cleanContextName = (raw) => (raw ? (parseResolvedNameToken(raw).cleanName || raw) : raw);

    if (adapter.isProtagonistConfigured(p)) {
        lines.push(...adapter.formatProtagonistForContext({ ...p, name: cleanContextName(p.name) }, dossier));
    } else {
        lines.push('Protagonist: Unset');
    }

    if (npcs.length) {
        lines.push(`NPCs (${npcs.length}):`);
        npcs.forEach(n => {
            lines.push('[NPC]');
            lines.push(`name: ${cleanContextName(n.name)}`);
            const fields = [
                ['role', n.role], ['archetype', n.archetype], ['gender', n.gender], ['species', n.species], ['appearance', n.appearance],
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
            lines.push(...adapter.formatMonsterForContext({ ...m, name: cleanContextName(m.name) }, dossier));
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
            lines.push(`name: ${cleanContextName(f.name)}`);
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
        const dList = [];
        if (cm.driverGmAnnotation ?? cm.drivers?.gmAnnotation) dList.push('gm_annotation');
        if (cm.driverTime ?? cm.drivers?.time) dList.push('time');
        if (cm.driverStatedFact ?? cm.drivers?.statedFact) dList.push('stated_fact');
        if (dList.length) lines.push(`drivers: ${dList.join(', ')}`);
        if (cm.effectOwner) lines.push(`effect_owner: ${cm.effectOwner}`);
        if (cm.instruction) lines.push(`instruction: ${cm.instruction}`);
        if (cm.sampleContent) {
            lines.push('sample:');
            lines.push(cm.sampleContent);
        }
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
        canonMutations: [],
        recalibrateRuleset: '',
        designGameSystem: '',
    };

    if (!text || typeof text !== 'string') return fallbackResult;

    // Strip any closed <think>...</think> blocks before parsing directives
    const cleanedText = normalizeMalformedDossierClosers(text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
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
            canonMutations: [],
            recalibrateRuleset: '',
            designGameSystem: '',
        };
    }

    // 1. Locate directive content: [UPDATE_DOSSIER] or [CONCIERGE_STATE]
    let raw = null;
    const closedUpdateBlocks = [...cleanedText.matchAll(/(?:^|\n)[ \t]*\[UPDATE_DOSSIER\][ \t]*(?:\r?\n|$)([\s\S]*?)\[\/UPDATE_DOSSIER\]/gi)]
        .map(m => m[1])
        .filter(Boolean);
    const inlineClosedBlocks = closedUpdateBlocks.length
        ? closedUpdateBlocks
        : [...cleanedText.matchAll(/\[UPDATE_DOSSIER\]([\s\S]*?)\[\/UPDATE_DOSSIER\]/gi)]
            .map(m => m[1])
            .filter(Boolean);
    const updateMatch = cleanedText.match(/(?:^|\n)[ \t]*\[UPDATE_DOSSIER\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/UPDATE_DOSSIER\]|$)/i)
        || cleanedText.match(/\[UPDATE_DOSSIER\]([\s\S]*?)\[\/UPDATE_DOSSIER\]/i);
    const stateMatch = cleanedText.match(/(?:^|\n)[ \t]*\[CONCIERGE_STATE\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/CONCIERGE_STATE\]|$)/i)
        || cleanedText.match(/\[CONCIERGE_STATE\]([\s\S]*?)\[\/CONCIERGE_STATE\]/i);

    if (inlineClosedBlocks.length > 0) {
        raw = inlineClosedBlocks.join('\n\n');
    } else if (updateMatch) {
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
        const hasDirectBlocks = /(?:^|\n)[ \t]*\[(?:CONTEMPLATION|FRAMING|CANON_UPDATE|CANON_ENTRY|UPSERT_CANON_ENTRY|CONFIG|CYOA|PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|WORLD_RULES?|CUSTOM_MODULE|GAME_SYSTEM|DESIGN_GAME_SYSTEM|RECALIBRATE_RULESET|REMOVE_NPC|REMOVE_MONSTER|REMOVE_MAP|REMOVE_FACTION|REMOVE_WORLD_RULE|REMOVE_CUSTOM_MODULE|REMOVE_GAME_SYSTEM|REMOVE_CANON|DISABLE_CANON|ENABLE_CANON|CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS|CLEAR_FACTIONS|CLEAR_WORLD_RULES)(?::[^\n\]]+)?\][ \t]*(?:\r?\n|$)/i.test(cleanedText);
        if (hasDirectBlocks) {
            raw = cleanedText;
        }
    }

    if (!raw) return fallbackResult;

    const updated = JSON.parse(JSON.stringify(dossier));
    const changes = [];
    const errors = [];
    const canonMutations = [];
    let recalibrateRuleset = '';
    let designGameSystem = '';

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
    const framingBlocks = matchDossierSectionBlocks(raw, 'FRAMING', 'FRAMING');
    const canonEntryBlocks = matchDossierSectionBlocks(raw, '(?:CANON_(?:ENTRY|UPDATE)|UPSERT_CANON_ENTRY)(?::\\s*([^\\]\\r\\n]+))?', '(?:CANON_(?:ENTRY|UPDATE)|UPSERT_CANON_ENTRY)');
    const protoBlocks = matchDossierSectionBlocks(raw, 'PROTAGONIST', 'PROTAGONIST');
    const npcBlocks = matchDossierSectionBlocks(raw, 'NPC(?::\\s*([^\\]\\r\\n]+))?', 'NPC');
    const monsterBlocks = matchDossierSectionBlocks(raw, 'MONSTER(?::\\s*([^\\]\\r\\n]+))?', 'MONSTER');
    const mapBlocks = matchDossierSectionBlocks(raw, 'MAP(?::\\s*([^\\]\\r\\n]+))?', 'MAP');
    const factionBlocks = matchDossierSectionBlocks(raw, 'FACTION(?::\\s*([^\\]\\r\\n]+))?', 'FACTION');
    const kickBlocks = matchDossierSectionBlocks(raw, 'KICK', 'KICK');
    const cyoaBlocks = matchDossierSectionBlocks(raw, 'CYOA', 'CYOA');
    const ruleBlocks = matchDossierSectionBlocks(raw, 'WORLD_RULES?', 'WORLD_RULES?');
    const customModuleBlocks = matchDossierSectionBlocks(raw, '(?:CUSTOM_MODULE|GAME_SYSTEM)', '(?:CUSTOM_MODULE|GAME_SYSTEM)');
    const configBlocks = matchDossierSectionBlocks(raw, 'CONFIG', 'CONFIG');

    let topLevelRaw = raw;
    for (const group of [
        contempBlocks,
        framingBlocks,
        canonEntryBlocks,
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
        if (rVal === 'fae' || rVal === 'pbta' || rVal === 'dnd5e') {
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
        } else if (updated.meta?.ruleset === 'dnd5e' || (DND5E_GENRES && DND5E_GENRES[normalizeSystemKey(rawKey)]) || normalizeSystemKey(rawKey) === 'dnd5e') {
            let key = normalizeSystemKey(rawKey);
            if (key === 'dnd5e' || !DND5E_GENRES?.[key]) key = 'fantasy';
            updated.meta.ruleset = 'dnd5e';
            updated.meta.genreEstablished = true;
            const nextLabel = sysLabelMatch ? sysLabelMatch[1].trim() : (DND5E_GENRES?.[key]?.label || 'High Fantasy');
            if (updated.meta.systemKey !== key || updated.meta.systemLabel !== nextLabel) {
                updated.meta.systemKey = key;
                updated.meta.systemLabel = nextLabel;
                changes.push(`D&D 5e Genre set to ${nextLabel} (${key})`);
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
            if (!updated.meta.title || isDefaultUntitledCampaignTitle(updated.meta.title)) {
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

    // 0c. Framing blocks & top-level framing directives
    for (const fb of framingBlocks) {
        const kv = parseKeyValueLines(fb.content);
        if (kv.title) {
            const newTitle = cleanTargetName(kv.title);
            if (newTitle && updated.meta.title !== newTitle) {
                changes.push(`Campaign title set to "${newTitle}"`);
                updated.meta.title = newTitle;
            }
        }
        if (kv.premise) {
            const newPremise = kv.premise.trim().replace(/^(\*\*|__)(.*?)\1$/, '$2');
            if (newPremise && updated.meta.premise !== newPremise) {
                updated.meta.premise = newPremise;
                if (!updated.meta.title || isDefaultUntitledCampaignTitle(updated.meta.title)) {
                    updated.meta.title = newPremise.slice(0, 40) + '...';
                }
                changes.push(`Premise updated: "${newPremise}"`);
            }
        }
        if (kv.tone) {
            const rawTone = cleanTargetName(kv.tone);
            if (rawTone && updated.meta.tone !== rawTone) {
                updated.meta.tone = rawTone;
                changes.push(`Campaign tone set to: "${rawTone}"`);
            }
        }
        const lensVal = kv.focal_lens || kv.lens;
        if (lensVal && lensVal.trim()) {
            const cleanLens = cleanTargetName(lensVal);
            if (cleanLens && updated.meta.focalLens !== cleanLens) {
                updated.meta.focalLens = cleanLens;
                changes.push(`Campaign focal lens set to "${cleanLens}"`);
            }
        }
        const readyVal = kv.ready_for_canon || kv.framing_complete;
        if (readyVal && /^(true|yes|1)$/i.test(readyVal.trim())) {
            if (!updated.meta.framingComplete) {
                updated.meta.framingComplete = true;
                changes.push('Framing marked ready for Canon');
            }
        }
    }

    const focalLensMatch = topLevelRaw.match(/(?:focal_lens|lens)\s*:\s*([^\n\r]+)/i);
    if (focalLensMatch) {
        const cleanLens = cleanTargetName(focalLensMatch[1]);
        if (cleanLens && updated.meta.focalLens !== cleanLens) {
            updated.meta.focalLens = cleanLens;
            changes.push(`Campaign focal lens set to "${cleanLens}"`);
        }
    }

    const framingCompleteMatch = topLevelRaw.match(/(?:ready_for_canon|framing_complete)\s*:\s*([^\n\r]+)/i);
    if (framingCompleteMatch) {
        const readyVal = framingCompleteMatch[1].trim();
        if (/^(true|yes|1)$/i.test(readyVal)) {
            if (!updated.meta.framingComplete) {
                updated.meta.framingComplete = true;
                changes.push('Framing marked ready for Canon');
            }
        }
    }

    const rulesetConfirmedMatch = topLevelRaw.match(/(?:ruleset_confirmed|rulesetConfirmed)\s*:\s*([^\n\r]+)/i);
    if (rulesetConfirmedMatch) {
        const confVal = rulesetConfirmedMatch[1].trim();
        if (/^(true|yes|1)$/i.test(confVal)) {
            if (!updated.meta.rulesetConfirmed) {
                updated.meta.rulesetConfirmed = true;
                changes.push('Ruleset confirmed');
            }
        }
    }

    // ── 2. Protagonist ──────────────────────────────────────────────────────────
    if (protoBlocks.length > 0) {
        const pBlock = protoBlocks[0].content;
        const kv = parseKeyValueLines(pBlock);

        if (kv.name) kv.name = canonicalizeResolvedName(kv.name);
        if (kv.name && updated.protagonist.name !== kv.name) {
            changes.push(`Protagonist name: "${kv.name}" (was "${updated.protagonist.name || 'Unnamed'}")`);
            updated.protagonist.name = kv.name;
        }
        const archVal = kv.archetype || kv.playbook || kv.class || kv.character_class;
        if (archVal && (updated.protagonist.playbook !== archVal || updated.protagonist.archetype !== archVal || updated.protagonist.class !== archVal)) {
            changes.push(`Protagonist archetype/class: "${archVal}" (was "${updated.protagonist.archetype || updated.protagonist.playbook || updated.protagonist.class || 'None'}")`);
            updated.protagonist.playbook = archVal;
            updated.protagonist.archetype = archVal;
            updated.protagonist.class = archVal;
        }
        if (kv.class) {
            updated.protagonist.class = kv.class.trim();
        }
        if (kv.ac) {
            const parsedAc = parseInt(kv.ac, 10);
            if (!isNaN(parsedAc)) {
                updated.protagonist.ac = parsedAc;
            }
        }
        if (kv.hp) {
            const hpMatch = String(kv.hp).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (hpMatch) {
                updated.protagonist.hp = { current: parseInt(hpMatch[1], 10), max: parseInt(hpMatch[2], 10) };
            } else if (!isNaN(parseInt(kv.hp, 10))) {
                const hVal = parseInt(kv.hp, 10);
                updated.protagonist.hp = { current: hVal, max: hVal };
            }
        }
        if (kv.bio && updated.protagonist.bio !== kv.bio) {
            updated.protagonist.bio = kv.bio;
            changes.push(`Protagonist bio updated`);
        }
        if (kv.gender) {
            const cleanG = kv.gender.trim();
            if (cleanG && updated.protagonist.gender !== cleanG) {
                updated.protagonist.gender = cleanG;
                changes.push(`Protagonist gender: "${cleanG}"`);
            }
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

        const startingMoves = parseBulletOrListItems(pBlock, 'starting_moves', { splitCommas: false });
        const moves = startingMoves.length ? startingMoves : parseBulletOrListItems(pBlock, 'moves', { splitCommas: false });
        if (moves.length && updated.meta?.ruleset !== 'fae') {
            updated.protagonist.startingMoves = moves;
            changes.push(`Protagonist moves updated (${moves.length} moves registered)`);
        }

        const features = parseBulletOrListItems(pBlock, 'features', { splitCommas: false });
        if (features.length) {
            updated.protagonist.features = features;
            changes.push(`Protagonist features updated (${features.length} features registered)`);
        }

        const abilities = parseBulletOrListItems(pBlock, 'abilities', { splitCommas: false });
        if (abilities.length) {
            updated.protagonist.abilities = abilities;
            changes.push(`Protagonist abilities updated (${abilities.length} abilities registered)`);
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
            const cleanDomain = sanitizeHeroicDomain(String(domainVal).trim().replace(/^["']|["']$/g, ''));
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
            updated.npcs = updated.npcs.filter(n => !entityNamesMatch(n.name, targetName));
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
        kv.name = canonicalizeResolvedName(cleanTargetName(kv.name));
        if (!kv.name) continue;

        // Check if this NPC block requests removal
        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.npcs.length;
            updated.npcs = updated.npcs.filter(n => !entityNamesMatch(n.name, kv.name));
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
            gender: kv.gender ? kv.gender.trim() : '',
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

        const existingIdx = updated.npcs.findIndex(n => entityNamesMatch(n.name, npcObj.name));
        if (existingIdx >= 0) {
            // Partial follow-up edit: only overwrite fields the Concierge actually supplied
            const patch = {};
            const healedExistingName = canonicalizeResolvedName(updated.npcs[existingIdx].name);
            if (healedExistingName !== updated.npcs[existingIdx].name) {
                patch.name = healedExistingName;
            }
            const given = (...ks) => ks.some(k => kv[k] !== undefined && kv[k] !== '');
            if (given('role')) patch.role = npcObj.role;
            if (given('gender')) patch.gender = npcObj.gender;
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
            updated.monsters = updated.monsters.filter(m => !entityNamesMatch(m.name, targetName));
            if (updated.npcs && updated.monsters.length < beforeLen) {
                changes.push(`Removed Adversary "${targetName}"`);
            }
        }
    }

    for (const match of monsterBlocks) {
        const mBlock = match.content;
        const kv = parseKeyValueLines(mBlock);
        if (!kv.name && match.inlineArg) kv.name = match.inlineArg.trim();
        kv.name = canonicalizeResolvedName(cleanTargetName(kv.name));
        if (!kv.name) continue;

        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.monsters.length;
            updated.monsters = updated.monsters.filter(m => !entityNamesMatch(m.name, kv.name));
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
        if (kv.layers) {
            const slashMatch = String(kv.layers).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                mCurHarm = parseInt(slashMatch[1], 10);
                mMaxHarm = parseInt(slashMatch[2], 10);
            } else {
                const l = parseInt(kv.layers, 10);
                if (!isNaN(l)) {
                    mCurHarm = l;
                    mMaxHarm = l;
                }
            }
        } else if (kv.hp) {
            const slashMatch = String(kv.hp).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (slashMatch) {
                const curHp = parseInt(slashMatch[1], 10);
                const maxHp = parseInt(slashMatch[2], 10);
                mMaxHarm = maxHp;
                mCurHarm = Math.max(0, maxHp - curHp);
            } else {
                const h = parseInt(kv.hp, 10);
                if (!isNaN(h)) {
                    mMaxHarm = h;
                    mCurHarm = 0;
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

        const existingIdx = updated.monsters.findIndex(m => entityNamesMatch(m.name, monsterObj.name));
        if (existingIdx >= 0) {
            const patch = {};
            const healedExistingName = canonicalizeResolvedName(updated.monsters[existingIdx].name);
            if (healedExistingName !== updated.monsters[existingIdx].name) {
                patch.name = healedExistingName;
            }
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
            const isFae = updated.meta?.ruleset === 'fae';
            if (isFae || threatLevelNum !== null || kv.layers || monsterObj.threatLevel) {
                changes.push(`Updated FAE Encounter "${monsterObj.name}" (Threat: ${monsterObj.threatLevel || 2}, Layers: ${monsterObj.currentHarm}/${monsterObj.harm})`);
            } else {
                const woundLabel = monsterObj.currentHarm > 0 ? `Harm: ${monsterObj.currentHarm}/${monsterObj.harm}` : `Harm: ${monsterObj.harm}`;
                changes.push(`Updated Adversary "${monsterObj.name}" (${woundLabel}, Armor: ${monsterObj.armor})`);
            }
        } else {
            updated.monsters.push(monsterObj);
            const isFae = updated.meta?.ruleset === 'fae';
            if (isFae || threatLevelNum !== null || kv.layers) {
                changes.push(`Added FAE Encounter "${monsterObj.name}" (Threat: ${threatLevelNum || monsterObj.threatLevel || 2}, Layers: ${monsterObj.currentHarm || 2}/${monsterObj.harm || 2})`);
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
        const rawThreatUpper = (kv.threat || kv.danger || 'MODERATE').toUpperCase();
        const threatSynonyms = {
            MEDIUM: 'MODERATE',
            TENSE: 'HIGH',
            EXTREME: 'DEADLY',
            CALM: 'SAFE',
            PEACEFUL: 'SAFE',
        };
        const threatUpper = threatSynonyms[rawThreatUpper] || rawThreatUpper;

        const mapObj = {
            site: kv.site,
            kind: ['DUNGEON', 'SETTLEMENT', 'INTERIOR', 'WILDERNESS'].includes(kindUpper) ? kindUpper : 'INTERIOR',
            threat: ['NONE', 'SAFE', 'LOW', 'MODERATE', 'HIGH', 'DANGEROUS', 'DEADLY'].includes(threatUpper) ? threatUpper : 'MODERATE',
            entrance: kv.entrance || 'Main Entrance',
            prompt: kv.prompt || kv.sensory || '',
            briefDescription: kv.brief_description || kv.prompt || kv.sensory || '',
            status: 'queued',
        };

        const existingIdx = updated.maps.findIndex(m => m.site.toLowerCase() === mapObj.site.toLowerCase());
        if (existingIdx >= 0) {
            const patch = {};
            if (kv.kind) patch.kind = mapObj.kind;
            if (kv.threat || kv.danger) patch.threat = mapObj.threat;
            if (kv.entrance) patch.entrance = mapObj.entrance;
            if (kv.prompt || kv.sensory) { patch.prompt = mapObj.prompt; }
            if (kv.brief_description || kv.prompt || kv.sensory) patch.briefDescription = mapObj.briefDescription;
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
            updated.factions = updated.factions.filter(f => !entityNamesMatch(f.name, targetName));
            if (updated.factions.length < beforeLen) {
                changes.push(`Removed Faction "${targetName}"`);
            }
        }
    }

    for (const match of factionBlocks) {
        const fBlock = match.content;
        const kv = parseKeyValueLines(fBlock);
        if (!kv.name && match.inlineArg) kv.name = match.inlineArg.trim();
        kv.name = canonicalizeResolvedName(cleanTargetName(kv.name));
        if (!kv.name) continue;

        if (kv.action === 'remove' || kv.remove === 'true' || kv.status === 'remove') {
            const beforeLen = updated.factions.length;
            updated.factions = updated.factions.filter(f => !entityNamesMatch(f.name, kv.name));
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

        const existingIdx = updated.factions.findIndex(f => entityNamesMatch(f.name, factionObj.name));
        if (existingIdx >= 0) {
            const patch = {};
            const healedExistingName = canonicalizeResolvedName(updated.factions[existingIdx].name);
            if (healedExistingName !== updated.factions[existingIdx].name) {
                patch.name = healedExistingName;
            }
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
        const kickCrisis = kv.crisis || kv.pressure;
        if (kickCrisis && updated.theKick.crisis !== kickCrisis) {
            updated.theKick.crisis = kickCrisis;
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

    // ── 7c. Custom Tracker / Game System Module ────────────────────────────────
    if (/\[REMOVE_(?:CUSTOM_MODULE|GAME_SYSTEM)\]/i.test(raw) || /remove_(?:custom_module|game_system)\s*:\s*true/i.test(raw)) {
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
            const icon = (kv.icon || '📟').trim();
            const instruction = kv.instruction || kv.prompt || kv.description || kv.gm_instruction || kv.gm_content || '';
            const gmContent = kv.gm_content || kv.gm_instruction || instruction;
            const trackerContent = kv.tracker_content || kv.prompt || instruction;
            const effectOwner = (kv.effect_owner || kv.effectowner || 'tracker').toLowerCase();
            const drivers = normalizeGameSystemDrivers(kv);

            let sampleContent = '';
            const codeBlockM = cmBlock.match(/```(?:text)?\s*([\s\S]*?)```/i);
            const tagBlockM = tag ? extractGameSystemTemplate(cmBlock, tag) : '';
            if (codeBlockM) {
                sampleContent = codeBlockM[1].trim();
            } else if (tagBlockM) {
                sampleContent = tagBlockM.trim();
            } else {
                const sampleM = cmBlock.match(/(?:^|\n)\s*(?:sample|sample_content|content)\s*:\s*\n?([\s\S]*)$/i);
                if (sampleM && sampleM[1].trim()) {
                    sampleContent = sampleM[1].trim();
                } else {
                    sampleContent = (kv.sample || kv.sample_content || kv.content || '').trim();
                }
            }

            const moduleObj = {
                name: label || tag,
                tag,
                fieldKey: tag,
                label: label || tag,
                icon,
                instruction,
                gmContent,
                trackerContent,
                sampleContent,
                sample: sampleContent,
                driverTime: drivers.time,
                driverGmAnnotation: drivers.gmAnnotation,
                driverStatedFact: drivers.statedFact,
                drivers,
                effectOwner,
            };

            updated.worldRules.customModule = moduleObj;
            changes.push(`Configured Custom Tracker Module [${tag}] "${moduleObj.label}"`);
        }
    }

    // ── 7d. Canon Lorebook Mutations ──────────────────────────────────────────
    const disableCanonMatches = raw.matchAll(/(?:\[DISABLE_CANON:\s*([^\]]+)\]|disable_canon\s*:\s*([^\n\r]+))/gi);
    for (const m of disableCanonMatches) {
        const cleanName = cleanTargetName(m[1] || m[2]);
        if (cleanName) {
            canonMutations.push({ action: 'disable', target: cleanName });
            changes.push(`Disabled Canon entry "${cleanName}"`);
        }
    }

    const enableCanonMatches = raw.matchAll(/(?:\[ENABLE_CANON:\s*([^\]]+)\]|enable_canon\s*:\s*([^\n\r]+))/gi);
    for (const m of enableCanonMatches) {
        const cleanName = cleanTargetName(m[1] || m[2]);
        if (cleanName) {
            canonMutations.push({ action: 'enable', target: cleanName });
            changes.push(`Enabled Canon entry "${cleanName}"`);
        }
    }

    const removeCanonMatches = raw.matchAll(/(?:\[REMOVE_CANON:\s*([^\]]+)\]|remove_canon\s*:\s*([^\n\r]+))/gi);
    for (const m of removeCanonMatches) {
        const cleanName = cleanTargetName(m[1] || m[2]);
        if (cleanName) {
            canonMutations.push({ action: 'remove', target: cleanName });
            changes.push(`Removed Canon entry "${cleanName}"`);
        }
    }

    for (const block of canonEntryBlocks) {
        const kv = parseKeyValueLines(block.content);
        const name = canonicalizeResolvedName(cleanTargetName(kv.name || kv.title || block.inlineArg || ''));
        if (!name) continue;
        const content = (kv.content || kv.description || kv.text || '').trim();

        if (kv.action === 'remove' || kv.remove === 'true') {
            canonMutations.push({ action: 'remove', target: name });
            changes.push(`Removed Canon entry "${name}"`);
        } else if (kv.action === 'disable' || (!content && kv.disabled === 'true')) {
            canonMutations.push({ action: 'disable', target: name });
            changes.push(`Disabled Canon entry "${name}"`);
        } else if (kv.action === 'enable' || (!content && kv.disabled === 'false')) {
            canonMutations.push({ action: 'enable', target: name });
            changes.push(`Enabled Canon entry "${name}"`);
        } else {
            const kind = (kv.kind || 'LORE').toUpperCase();
            const aliases = kv.aliases ? kv.aliases.split(',').map(s => s.trim()).filter(Boolean) : [];
            const importance = parseInt(kv.importance, 10) || 4;
            const disabled = /^(true|yes|1)$/i.test(String(kv.disabled || ''));
            canonMutations.push({
                action: 'upsert',
                entry: {
                    kind,
                    name,
                    aliases,
                    importance,
                    content,
                    disabled,
                },
            });
            changes.push(`Upserted Canon entry [${kind}] "${name}"`);
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
        const isPipeTemplate = (v) => typeof v === 'string' && v.includes('|');

        // Playstyle
        const psRaw = (kv.playstyle || kv.cyoa_mode || kv.cyoa || '').toLowerCase().trim();
        if (psRaw && !isPipeTemplate(psRaw)) {
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
            const emRaw = String(kv.cyoa_emojis !== undefined ? kv.cyoa_emojis : kv.emojis).toLowerCase().trim();
            if (!isPipeTemplate(emRaw)) {
                const nextEm = !/^(false|off|0|no)$/.test(emRaw);
                if (nextEm !== updated.config.cyoaEmojis) {
                    updated.config.cyoaEmojis = nextEm;
                    changes.push(`CYOA Emojis set to ${nextEm ? 'On' : 'Off'}`);
                }
            }
        }

        // Harm Max / Lethality
        const harmStr = String(kv.harm_max || kv.harm || kv.lethality || '').trim();
        const harmRaw = !isPipeTemplate(harmStr) ? parseInt(harmStr, 10) : NaN;
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
        const partyRaw = (kv.party_mode || kv.party || '').toLowerCase().trim();
        if (partyRaw && !isPipeTemplate(partyRaw)) {
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
        const xpStr = String(kv.pacing_xp || kv.xp || '').trim();
        const xpRaw = !isPipeTemplate(xpStr) ? parseInt(xpStr, 10) : NaN;
        if (!isNaN(xpRaw) && (xpRaw === 3 || xpRaw === 5)) {
            if (xpRaw !== updated.config.pacingXp) {
                updated.config.pacingXp = xpRaw;
                changes.push(`XP Pacing dial set to ${xpRaw} XP per Advance`);
            }
        }

        // World Simulation Depth
        const simRaw = (kv.simulation_depth || kv.sim_depth || kv.simulation || '').toLowerCase().trim();
        if (simRaw && !isPipeTemplate(simRaw)) {
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
            if (!isPipeTemplate(relRaw)) {
                const nextRel = !/^(false|off|0|no|disabled)$/i.test(relRaw);
                if (nextRel !== updated.config.relationships) {
                    updated.config.relationships = nextRel;
                    changes.push(`Relationships dial set to ${nextRel ? 'On' : 'Off'}`);
                }
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
        const BOOLEAN_CONFIG_RE = /^(?:true|false|on|off|yes|no|1|0)$/i;
        const heroicRaw = kv.heroic_tier !== undefined ? kv.heroic_tier : (kv.heroic !== undefined ? kv.heroic : kv.heroic_domain_active);
        if (heroicRaw !== undefined) {
            const hStr = String(heroicRaw).trim();
            if (!isPipeTemplate(hStr) && BOOLEAN_CONFIG_RE.test(hStr)) {
                const val = /^(?:true|on|yes|1)$/i.test(hStr);
                if (updated.config.heroicTier !== val) {
                    updated.config.heroicTier = val;
                    updated.config.knobs.heroic_tier = val;
                    changes.push(`Heroic Tier dial set to ${val ? 'ON' : 'OFF'}`);
                }
            }
        }
        const fleeRaw = kv.flee_grace_toggle !== undefined ? kv.flee_grace_toggle : kv.flee_grace;
        if (fleeRaw !== undefined) {
            const fStr = String(fleeRaw).trim();
            if (!isPipeTemplate(fStr) && BOOLEAN_CONFIG_RE.test(fStr)) {
                const val = /^(?:true|on|yes|1)$/i.test(fStr);
                if (updated.config.knobs.flee_grace_toggle !== val) {
                    updated.config.knobs.flee_grace_toggle = val;
                    changes.push(`Flee Grace dial set to ${val ? 'ON' : 'OFF'}`);
                }
            }
        }
        const shiftRaw = kv.base_attrition_shift !== undefined ? kv.base_attrition_shift : kv.attrition_shift;
        if (shiftRaw !== undefined) {
            const sStr = String(shiftRaw).trim();
            const val = !isPipeTemplate(sStr) ? parseInt(sStr, 10) : NaN;
            if (!isNaN(val) && updated.config.knobs.base_attrition_shift !== val) {
                updated.config.knobs.base_attrition_shift = val;
                changes.push(`Base Attrition Shift dial set to ${val >= 0 ? '+' : ''}${val}`);
            }
        }
        const overflowRaw = kv.overflow_default !== undefined ? kv.overflow_default : kv.overflow;
        if (overflowRaw !== undefined) {
            const val = String(overflowRaw).trim().toLowerCase();
            if (!isPipeTemplate(val) && ['lethal', 'scar_and_ko', 'scene_fail'].includes(val) && updated.config.knobs.overflow_default !== val) {
                updated.config.knobs.overflow_default = val;
                changes.push(`Overflow default dial set to ${val}`);
            }
        }
        const tempoRaw = kv.action_tempo !== undefined ? kv.action_tempo : (kv.tempo !== undefined ? kv.tempo : kv.pacing_tempo);
        if (tempoRaw !== undefined) {
            const val = String(tempoRaw).trim().toLowerCase();
            if (!isPipeTemplate(val) && ['action_serial', 'gritty_default', 'slow_burn', 'slice_of_life'].includes(val)) {
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

    const NOOP_DIRECTIVE_SENTINEL = /^(?:none|n\/?a|null|false|no|unchanged|skip|nothing|nil|-+)$/i;

    const recalM = raw.match(/(?:\[RECALIBRATE_RULESET\s*:\s*([^\]]+)\]|^[ \t]*recalibrate_ruleset\s*:\s*([^\n\r]+))/im);
    if (recalM) {
        const candidateRecal = (recalM[1] || recalM[2] || '').trim();
        if (candidateRecal && !NOOP_DIRECTIVE_SENTINEL.test(candidateRecal)) {
            recalibrateRuleset = candidateRecal;
            changes.push(`Requested Ruleset Architect recalibration: ${recalibrateRuleset}`);
        }
    }

    const designGsM = raw.match(/(?:\[DESIGN_GAME_SYSTEM\s*:\s*([^\]]+)\]|^[ \t]*design_game_system\s*:\s*([^\n\r]+))/im);
    if (designGsM) {
        const candidateDesign = (designGsM[1] || designGsM[2] || '').trim();
        if (candidateDesign && !NOOP_DIRECTIVE_SENTINEL.test(candidateDesign)) {
            designGameSystem = candidateDesign;
            changes.push(`Requested Game System Wizard design: ${designGameSystem}`);
        }
    }

    return {
        success: errors.length === 0,
        updatedDossier: updated,
        changes,
        errors,
        hasMutations: changes.length > 0 || canonMutations.length > 0 || Boolean(recalibrateRuleset) || Boolean(designGameSystem),
        isNoop: false,
        builderSummary: builderSummary || (changes.length ? changes.join('; ') : 'Blueprint in sync'),
        contemplation: extractedContemplation,
        canonMutations,
        recalibrateRuleset,
        designGameSystem,
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
    const rawMeta = dossier.meta;
    dossier.meta.focalLens = typeof rawMeta.focalLens === 'string' ? rawMeta.focalLens.trim() : '';
    dossier.meta.framingComplete = Boolean(rawMeta.framingComplete);
    dossier.meta.rulesetConfirmed = Boolean(rawMeta.rulesetConfirmed);
    dossier.meta.customGenreSpec = (rawMeta.customGenreSpec && typeof rawMeta.customGenreSpec === 'object')
        ? JSON.parse(JSON.stringify(rawMeta.customGenreSpec))
        : null;
    dossier.meta.stageNotes = (rawMeta.stageNotes && typeof rawMeta.stageNotes === 'object')
        ? {
            framing: typeof rawMeta.stageNotes.framing === 'string' ? rawMeta.stageNotes.framing.trim() : '',
            canon: typeof rawMeta.stageNotes.canon === 'string' ? rawMeta.stageNotes.canon.trim() : '',
            adventure: typeof rawMeta.stageNotes.adventure === 'string' ? rawMeta.stageNotes.adventure.trim() : '',
        }
        : { framing: '', canon: '', adventure: '' };
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
    const dedupedNpcs = [];
    dossier.npcs.forEach(n => {
        n.name = canonicalizeResolvedName((n.name || 'Unnamed NPC').trim());
        n.role = (n.role || 'Ally').trim();
        if (n.species) {
            n.species = sanitizeSpeciesValue(n.species) || n.species.trim();
        }
        if (n.conditions) {
            n.conditions = sanitizeConditionsList(n.conditions);
        }
        n.friendship = clampRelationshipScore(n.friendship);
        n.affection = clampRelationshipScore(n.affection);

        const existing = dedupedNpcs.find(e => entityNamesMatch(e.name, n.name));
        if (existing) {
            const hasResolvedToken = (val) => typeof val === 'string' && /\[NAME:\s*.+?,\s*RESOLVED TO:/i.test(val);
            if (!hasResolvedToken(existing.name) && hasResolvedToken(n.name)) {
                existing.name = n.name;
            }
            for (const [k, v] of Object.entries(n)) {
                if (k === 'name') continue;
                const cur = existing[k];
                const isMissing = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
                const hasIncoming = v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
                if (isMissing && hasIncoming) {
                    existing[k] = v;
                }
            }
        } else {
            dedupedNpcs.push(n);
        }
    });
    dossier.npcs = dedupedNpcs;

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
        const normalizedTag = (cm.tag || cm.fieldKey || cm.trackerTag || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'CUSTOM';
        const normalizedSample = cm.sampleContent ?? cm.sample ?? '';
        dossier.worldRules.customModule = {
            ...cm,
            name: cm.name || cm.label || normalizedTag,
            tag: normalizedTag,
            fieldKey: normalizedTag,
            label: cm.label || normalizedTag,
            icon: cm.icon || cm.trackerIcon || '📟',
            instruction: cm.instruction || cm.gmContent || '',
            gmContent: cm.gmContent || cm.instruction || '',
            sampleContent: normalizedSample,
            sample: normalizedSample,
            drivers: normalizeGameSystemDrivers(cm),
            effectOwner: cm.effectOwner || 'tracker',
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
