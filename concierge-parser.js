/**
 * concierge-parser.js — MultiHog Companion
 *
 * Parses [CONCIERGE_STATE] blocks from Concierge responses, updates the live
 * Campaign Dossier artifact, and serializes the dossier to Markdown and JSON.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';

/**
 * Creates a clean default Campaign Dossier object.
 * @returns {object}
 */
export function createEmptyDossier() {
    return {
        meta: {
            title: 'Untitled PbtA Campaign',
            systemKey: 'fantasy',
            systemLabel: PBTA_GENRES.fantasy.label,
            premise: '',
            tone: '',
            createdAt: Date.now(),
        },
        protagonist: {
            name: '',
            playbook: '',
            stats: {},
            startingMoves: [],
            harm: { max: 5, current: 0, armor: 0 },
            conditions: [],
            status: '',
            gear: [],
            bio: '',
            portraitSrc: null,
        },
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
        config: {
            playstyle: 'cyoa_5',
            cyoaEmojis: true,
            harmMax: 5,
            partyMode: 'squad',
            artStyle: '',
            pacingXp: 5,
            simulationDepth: 'active_fronts',
            relationships: true,
        },
    };
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
};

/**
 * Normalizes raw system engine keys into canonical PBTA_GENRES keys.
 * @param {string} rawKey
 * @returns {string|null}
 */
export function normalizeSystemKey(rawKey) {
    if (!rawKey) return null;
    const clean = rawKey.trim().toLowerCase().replace(/[\s\-_]+/g, '_');
    if (PBTA_GENRES[clean]) return clean;
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
    return text
        .replace(/\[UPDATE_DOSSIER\][\s\S]*?(?:\[\/UPDATE_DOSSIER\]|$)/gi, '')
        .replace(/\[CONCIERGE_STATE\][\s\S]*?(?:\[\/CONCIERGE_STATE\]|$)/gi, '')
        .replace(/\[PROTAGONIST(?::[^\n\]]+)?\][\s\S]*?(?:\[\/PROTAGONIST\]|$)/gi, '')
        .replace(/\[NPC(?::[^\n\]]+)?\][\s\S]*?(?:\[\/NPC\]|$)/gi, '')
        .replace(/\[MONSTER(?::[^\n\]]+)?\][\s\S]*?(?:\[\/MONSTER\]|$)/gi, '')
        .replace(/\[MAP(?::[^\n\]]+)?\][\s\S]*?(?:\[\/MAP\]|$)/gi, '')
        .replace(/\[FACTION(?::[^\n\]]+)?\][\s\S]*?(?:\[\/FACTION\]|$)/gi, '')
        .replace(/\[KICK\][\s\S]*?(?:\[\/KICK\]|$)/gi, '')
        .replace(/\[CYOA\][\s\S]*?(?:\[\/CYOA\]|$)/gi, '')
        .replace(/\[CONFIG\][\s\S]*?(?:\[\/CONFIG\]|$)/gi, '')
        .replace(/\[REMOVE_(?:NPC|MONSTER|MAP|FACTION):[^\n\]]+\]/gi, '')
        .replace(/\[(?:CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS|CLEAR_FACTIONS)\]/gi, '')
        .replace(/\[NOOP\][\s\S]*?(?:\[\/NOOP\]|$)/gi, '')
        .replace(/\[BUILDER_REPORT:[^\n\]]+\]/gi, '')
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
function parseStatsString(line) {
    const stats = {};
    if (!line) return stats;
    const parts = line.split(/[,|;]/);
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
 * Resilient list item parser for bullet lines or inline comma/semicolon-separated values.
 * @param {string} block
 * @param {string} sectionKey
 * @returns {string[]}
 */
function parseBulletOrListItems(block, sectionKey) {
    const fromBullets = parseBulletList(block, sectionKey);
    if (fromBullets.length > 0) return fromBullets;
    const kv = parseKeyValueLines(block);
    const rawVal = kv[sectionKey.toLowerCase()];
    if (rawVal) {
        return rawVal.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
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

    const lines = [
        '[CURRENT_CAMPAIGN_DOSSIER]',
        'Status: IN_PROGRESS',
        `Title: ${meta.title || 'Untitled Campaign'}`,
        `System: ${meta.systemLabel || 'Fantasy'} (${meta.systemKey || 'fantasy'})`,
        meta.premise ? `Premise: ${meta.premise}` : null,
    ];

    // Full-detail view, written in the same key: value shape as [UPDATE_DOSSIER] blocks so the
    // model can copy names/keys exactly and emit precise partial edits.
    const cfg = dossier.config || {};
    lines.push(`Config: playstyle=${cfg.playstyle ?? 'cyoa_5'}, harm_max=${cfg.harmMax ?? 5}, party_mode=${cfg.partyMode ?? 'squad'}, cyoa_emojis=${cfg.cyoaEmojis !== false}, art_style=${cfg.artStyle || '(none)'}, pacing_xp=${cfg.pacingXp ?? 5}, simulation_depth=${cfg.simulationDepth ?? 'active_fronts'}, relationships=${cfg.relationships !== false ? 'on' : 'off'}`);
    if (meta.tone) lines.push(`Tone: ${meta.tone}`);

    if (p.name || p.playbook) {
        lines.push('[PROTAGONIST]');
        lines.push(`name: ${p.name || 'Unnamed Adventurer'}`);
        lines.push(`playbook: ${p.playbook || 'In Development'}`);
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
        if (p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) {
            lines.push(`conditions: ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}`);
        }
        if (p.status) lines.push(`status: ${p.status}`);
        if (p.startingMoves && p.startingMoves.length) {
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
                ['role', n.role], ['species', n.species], ['appearance', n.appearance],
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
            const curHarm = parseInt(m.currentHarm ?? m.harm?.current, 10) || 0;
            const maxHarm = parseInt(m.harm?.max ?? m.harm, 10) || 4;
            lines.push(curHarm > 0 ? `harm: ${curHarm}/${maxHarm}` : `harm: ${maxHarm}`);
            lines.push(`armor: ${m.armor || 0}`);
            if (m.status) lines.push(`status: ${m.status}`);
            if (m.attacks && m.attacks.length) lines.push(`attacks: ${[].concat(m.attacks).join(', ')}`);
            lines.push(`weakness: ${m.weakness || 'Unknown'}`);
            if (m.impendingDoom && m.impendingDoom.length) {
                lines.push('countdown:');
                m.impendingDoom.forEach(d => lines.push(`- ${d}`));
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
export function applyDossierUpdates(text, dossier) {
    const fallbackResult = {
        success: true,
        updatedDossier: dossier,
        changes: [],
        errors: [],
        hasMutations: false,
        isNoop: false,
        builderSummary: 'No blueprint mutations detected',
    };

    if (!text || typeof text !== 'string') return fallbackResult;

    // 0. Check for explicit NOOP
    const noopMatch = text.match(/\[NOOP\]([\s\S]*?)(?:\[\/NOOP\]|$)/i);
    const isExplicitNoop = Boolean(noopMatch) || /^\s*\[NOOP\]\s*$/i.test(text.trim());
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
        };
    }

    // 1. Locate directive content: [UPDATE_DOSSIER] or [CONCIERGE_STATE]
    let raw = null;
    const updateMatch = text.match(/\[UPDATE_DOSSIER\]([\s\S]*?)(?:\[\/UPDATE_DOSSIER\]|$)/i);
    const stateMatch = text.match(/\[CONCIERGE_STATE\]([\s\S]*?)(?:\[\/CONCIERGE_STATE\]|$)/i);

    if (updateMatch) {
        raw = updateMatch[1];
    } else if (stateMatch) {
        raw = stateMatch[1];
    } else {
        // Fallback: check if text contains standalone blocks directly
        const hasDirectBlocks = /\[(?:CONFIG|CYOA|PROTAGONIST|NPC|MONSTER|MAP|FACTION|KICK|WORLD_RULES?|CUSTOM_MODULE|REMOVE_NPC|REMOVE_MONSTER|REMOVE_MAP|REMOVE_FACTION|REMOVE_WORLD_RULE|REMOVE_CUSTOM_MODULE|CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS|CLEAR_FACTIONS|CLEAR_WORLD_RULES)\]/i.test(text);
        if (hasDirectBlocks) {
            raw = text;
        }
    }

    if (!raw) return fallbackResult;

    const updated = JSON.parse(JSON.stringify(dossier));
    const changes = [];
    const errors = [];

    // Extract builder summary if emitted
    let builderSummary = null;
    const summaryMatch = raw.match(/summary\s*:\s*([^\n\r]+)/i);
    if (summaryMatch) {
        builderSummary = summaryMatch[1].trim()
            .replace(/^(\*\*|__)(.*?)\1$/, '$2')
            .replace(/^["'“”‘’](.*)["'“”‘’]$/, '$1')
            .trim();
    }

    // ── 1. Meta / System ────────────────────────────────────────────────────────
    const sysMatch = raw.match(/system\s*:\s*([^\n\r]+)/i);
    if (sysMatch) {
        const rawKey = sysMatch[1].trim();
        const key = normalizeSystemKey(rawKey);
        if (key && PBTA_GENRES[key]) {
            if (updated.meta.systemKey !== key) {
                updated.meta.systemKey = key;
                updated.meta.systemLabel = PBTA_GENRES[key].label;
                changes.push(`PbtA Engine set to ${updated.meta.systemLabel} (${key})`);
            }
        } else {
            errors.push(`Unknown system engine "${rawKey}". Available: ${Object.keys(PBTA_GENRES).join(', ')}`);
        }
    }

    const titleMatch = raw.match(/title\s*:\s*([^\n\r]+)/i);
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

    const premiseMatch = raw.match(/premise\s*:\s*([^\n\r]+)/i);
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

    const toneMatch = raw.match(/tone\s*:\s*([^\n\r]+)/i);
    if (toneMatch) {
        const rawTone = cleanTargetName(toneMatch[1]);
        if (rawTone && updated.meta.tone !== rawTone) {
            updated.meta.tone = rawTone;
            changes.push(`Campaign tone set to: "${rawTone}"`);
        }
    }

    // ── 2. Protagonist ──────────────────────────────────────────────────────────
    const protoMatch = raw.match(/\[PROTAGONIST\]([\s\S]*?)(?:\[\/PROTAGONIST\]|$)/i);
    if (protoMatch) {
        const pBlock = protoMatch[1];
        const kv = parseKeyValueLines(pBlock);

        if (kv.name && updated.protagonist.name !== kv.name) {
            changes.push(`Protagonist name: "${kv.name}" (was "${updated.protagonist.name || 'Unnamed'}")`);
            updated.protagonist.name = kv.name;
        }
        if (kv.playbook && updated.protagonist.playbook !== kv.playbook) {
            changes.push(`Protagonist playbook: "${kv.playbook}" (was "${updated.protagonist.playbook || 'None'}")`);
            updated.protagonist.playbook = kv.playbook;
        }
        if (kv.bio && updated.protagonist.bio !== kv.bio) {
            updated.protagonist.bio = kv.bio;
            changes.push(`Protagonist bio updated`);
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
        if (kv.conditions) {
            const condList = kv.conditions.split(/[,;]/).map(c => c.trim()).filter(Boolean);
            if (condList.length) {
                updated.protagonist.conditions = condList;
                changes.push(`Protagonist conditions set: ${condList.join(', ')}`);
            }
        }
        if (kv.status) {
            updated.protagonist.status = kv.status.trim();
            changes.push(`Protagonist status set to "${updated.protagonist.status}"`);
        }

        const moves = parseBulletList(pBlock, 'moves');
        if (moves.length) {
            updated.protagonist.startingMoves = moves;
            changes.push(`Protagonist moves updated (${moves.length} moves registered)`);
        }

        if (kv.gear) {
            const gearList = kv.gear.split(/[,;]/).map(g => g.trim()).filter(Boolean);
            if (gearList.length) {
                updated.protagonist.gear = gearList;
                changes.push(`Protagonist gear updated: ${gearList.join(', ')}`);
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

    const npcMatches = raw.matchAll(/(?:\[NPC(?::\s*([^\]\r\n]+))?\])([\s\S]*?)(?:\[\/NPC\]|$)/gi);
    for (const match of npcMatches) {
        const inlineName = match[1]?.trim();
        const nBlock = match[2];
        const kv = parseKeyValueLines(nBlock);
        if (!kv.name && inlineName) kv.name = inlineName;
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

        let nConditions = [];
        if (kv.conditions) {
            nConditions = kv.conditions.split(/[,;]/).map(c => c.trim()).filter(Boolean);
        }

        const npcObj = {
            name: kv.name,
            role: kv.role || 'Ally',
            species: kv.species || kv.race || '',
            appearance: kv.appearance || kv.description || kv.look || '',
            equipment: kv.equipment || kv.gear || '',
            demeanor: kv.demeanor || '',
            background: kv.background || '',
            relationship: kv.relationship || '',
            friendship: fVal,
            affection: aVal,
            movesOrBoons: kv.moves_or_boons || kv.moves || '',
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
            if (given('species', 'race')) patch.species = npcObj.species;
            if (given('appearance', 'description', 'look')) patch.appearance = npcObj.appearance;
            if (given('equipment', 'gear')) patch.equipment = npcObj.equipment;
            if (given('demeanor')) patch.demeanor = npcObj.demeanor;
            if (given('background')) patch.background = npcObj.background;
            if (given('relationship')) patch.relationship = npcObj.relationship;
            if (given('friendship')) patch.friendship = clampRelationshipScore(kv.friendship);
            if (given('affection')) patch.affection = clampRelationshipScore(kv.affection);
            if (given('moves_or_boons', 'moves')) patch.movesOrBoons = npcObj.movesOrBoons;
            if (given('notes')) patch.notes = npcObj.notes;
            if (given('harm', 'current_harm', 'harm_current', 'wounds', 'armor') && nHarm) patch.harm = nHarm;
            if (given('conditions')) patch.conditions = npcObj.conditions;
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
            if (updated.monsters.length < beforeLen) {
                changes.push(`Removed Adversary "${targetName}"`);
            }
        }
    }

    const monsterMatches = raw.matchAll(/\[MONSTER\]([\s\S]*?)(?:\[\/MONSTER\]|$)/gi);
    for (const match of monsterMatches) {
        const mBlock = match[1];
        const kv = parseKeyValueLines(mBlock);
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
        if (kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
            const cVal = parseInt(kv.current_harm ?? kv.harm_current ?? kv.wounds, 10);
            if (!isNaN(cVal)) mCurHarm = cVal;
        }

        const monsterObj = {
            name: kv.name,
            harm: mMaxHarm,
            currentHarm: mCurHarm,
            armor: parseInt(kv.armor, 10) || 0,
            attacks: kv.attacks ? kv.attacks.split(/[,;]/).map(a => a.trim()).filter(Boolean) : [],
            weakness: kv.weakness || 'Unknown',
            impendingDoom: parseBulletList(mBlock, 'countdown'),
            notes: kv.notes || '',
            status: kv.status ? kv.status.trim() : (mCurHarm > 0 ? '(-) Wounded' : ''),
            conditions: kv.conditions ? kv.conditions.split(/[,;]/).map(c => c.trim()).filter(Boolean) : [],
        };

        const existingIdx = updated.monsters.findIndex(m => m.name.toLowerCase() === monsterObj.name.toLowerCase());
        if (existingIdx >= 0) {
            const patch = {};
            if (kv.harm || kv.current_harm !== undefined || kv.harm_current !== undefined || kv.wounds !== undefined) {
                patch.harm = monsterObj.harm;
                patch.currentHarm = monsterObj.currentHarm;
            }
            if (kv.armor) patch.armor = monsterObj.armor;
            if (kv.attacks) patch.attacks = monsterObj.attacks;
            if (kv.weakness) patch.weakness = monsterObj.weakness;
            if (monsterObj.impendingDoom.length) patch.impendingDoom = monsterObj.impendingDoom;
            if (kv.notes) patch.notes = monsterObj.notes;
            if (kv.status) patch.status = monsterObj.status;
            if (kv.conditions) patch.conditions = monsterObj.conditions;
            updated.monsters[existingIdx] = Object.assign({}, updated.monsters[existingIdx], patch);
            Object.assign(monsterObj, updated.monsters[existingIdx]);
            const woundLabel = monsterObj.currentHarm > 0 ? `Harm: ${monsterObj.currentHarm}/${monsterObj.harm}` : `Harm: ${monsterObj.harm}`;
            changes.push(`Updated Adversary "${monsterObj.name}" (${woundLabel}, Armor: ${monsterObj.armor})`);
        } else {
            updated.monsters.push(monsterObj);
            const woundLabel = monsterObj.currentHarm > 0 ? ` (Harm: ${monsterObj.currentHarm}/${monsterObj.harm}, Armor: ${monsterObj.armor})` : ` (Harm: ${monsterObj.harm}, Armor: ${monsterObj.armor})`;
            changes.push(`Added Adversary "${monsterObj.name}"${woundLabel}`);
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

    const mapMatches = raw.matchAll(/\[MAP\]([\s\S]*?)(?:\[\/MAP\]|$)/gi);
    for (const match of mapMatches) {
        const mBlock = match[1];
        const kv = parseKeyValueLines(mBlock);
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
            kind: ['DUNGEON', 'SETTLEMENT', 'INTERIOR'].includes(kindUpper) ? kindUpper : 'INTERIOR',
            threat: ['NONE', 'LOW', 'MODERATE', 'HIGH', 'DEADLY'].includes(threatUpper) ? threatUpper : 'MODERATE',
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

    const factionMatches = raw.matchAll(/\[FACTION\]([\s\S]*?)(?:\[\/FACTION\]|$)/gi);
    for (const match of factionMatches) {
        const fBlock = match[1];
        const kv = parseKeyValueLines(fBlock);
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
    const kickMatch = raw.match(/\[KICK\]([\s\S]*?)(?:\[\/KICK\]|$)/i);
    if (kickMatch) {
        const kBlock = kickMatch[1];
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
    const cyoaMatch = raw.match(/\[CYOA\]([\s\S]*?)(?:\[\/CYOA\]|$)/i);
    if (cyoaMatch) {
        const cBlock = cyoaMatch[1];
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

    const ruleMatches = raw.matchAll(/\[WORLD_RULES?\]([\s\S]*?)(?:\[\/WORLD_RULES?\]|$)/gi);
    for (const match of ruleMatches) {
        const rBlock = match[1];
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
            changes.push(`Removed Custom Tracker Module [${updated.worldRules.customModule.tag}]`);
            updated.worldRules.customModule = null;
        }
    }

    const customModuleMatch = raw.match(/\[CUSTOM_MODULE\]([\s\S]*?)(?:\[\/CUSTOM_MODULE\]|$)/i);
    if (customModuleMatch) {
        const cmBlock = customModuleMatch[1];
        const kv = parseKeyValueLines(cmBlock);
        const tag = (kv.tag || kv.name || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '');
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
                label: label || tag,
                icon,
                instruction,
                sampleContent,
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
    };

    const configMatch = raw.match(/\[CONFIG\]([\s\S]*?)(?:\[\/CONFIG\]|$)/i);
    if (configMatch) {
        const cBlock = configMatch[1];
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
    }

    return {
        success: errors.length === 0,
        updatedDossier: updated,
        changes,
        errors,
        hasMutations: changes.length > 0,
        isNoop: false,
        builderSummary: builderSummary || (changes.length ? changes.join('; ') : 'Blueprint in sync'),
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
export function serializeDossierToMarkdown(dossier) {
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
    let gearMd = (p.gear || []).map(g => `* ${g}`).join('\n') || '* Basic equipment.';

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
            return `### 👤 ${n.name}
* **Role:** ${n.role || 'Ally'}${n.species ? `\n* **Species:** ${n.species}` : ''}${harmPart}${statusPart}${condPart}
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
        const sampleBlock = cm.sampleContent ? `\n\n\`\`\`text\n${cm.sampleContent}\n\`\`\`` : '';
        customModuleMd = `\n\n---\n\n## 📊 Custom Tracker Module:\n* **Tag:** [${cm.tag}]\n* **Label:** ${cm.label}\n* **Icon:** ${cm.icon || '📦'}\n* **State Model Instruction:** ${cm.instruction || 'None'}${sampleBlock}`;
    }

    const toneLine = meta.tone
        ? `\n* **Tone:** ${meta.tone}`
        : '';

    return `# 📜 CAMPAIGN DOSSIER: ${meta.title || 'Untitled PbtA Campaign'}

* **System Engine:** ${meta.systemLabel || 'PbtA Fantasy'} (\`${meta.systemKey || 'fantasy'}\`)
* **Premise:** ${meta.premise || 'Not specified'}${toneLine}

---

## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Playbook:** ${p.playbook || 'Wanderer'}
* **Stats:** ${statString || 'Not assigned'}
* **Harm Capacity:** ${(p.harm?.current > 0) ? `${p.harm.current}/${p.harm.max || 5} (Wounded)` : (p.harm?.max || 5)} | **Armor:** ${p.harm?.armor || 0}${(p.status || (p.harm?.current > 0 ? '(-) Wounded' : '')) ? `\n* **Status:** ${p.status || '(-) Wounded'}` : ''}${(p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) ? `\n* **Conditions:** ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}` : ''}
* **Background Bio:** ${p.bio || 'None'}

### ⚡ Key Moves:
${movesMd}

### 🎒 Starting Gear:
${gearMd}

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
* **Opening Hook:** ${kick.openingPrompt || 'You stand at the threshold...'}${dossier.cyoaExamples && dossier.cyoaExamples.length ? `\n\n---\n\n## 🎲 Tailored CYOA Move Choices:\n${dossier.cyoaExamples.map(c => `* ${c}`).join('\n')}` : ''}${dossier.config ? `\n\n---\n\n## ⚙️ Campaign Calibration Dials:
* **Playstyle:** ${dossier.config.playstyle || 'cyoa_5'}
* **Harm Capacity:** ${dossier.config.harmMax || 5}
* **Party Mode:** ${dossier.config.partyMode || 'squad'}
* **CYOA Emojis:** ${dossier.config.cyoaEmojis !== false ? 'Enabled' : 'Disabled'}${dossier.config.simulationDepth ? `\n* **Simulation Depth:** ${dossier.config.simulationDepth}` : ''}${dossier.config.artStyle ? `\n* **Art Direction:** ${dossier.config.artStyle}` : ''}${dossier.config.pacingXp ? `\n* **XP Pacing:** ${dossier.config.pacingXp}` : ''}${dossier.config.relationships !== undefined ? `\n* **Relationships:** ${dossier.config.relationships !== false ? 'Enabled' : 'Disabled'}` : ''}` : ''}`;
}

/**
 * Reconstitutes a Campaign Dossier object from serialized Markdown.
 * Used for auto-recovery and fallback hydration from World Info or lorebooks.
 *
 * @param {string} markdown
 * @returns {object|null}
 */
export function parseMarkdownToDossier(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;
    const dossier = createEmptyDossier();

    // 1. Title
    const titleMatch = markdown.match(/#\s*(?:📜\s*)?CAMPAIGN DOSSIER:\s*([^\n\r]+)/i);
    if (titleMatch) dossier.meta.title = titleMatch[1].trim();

    // 2. System Engine
    const systemMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^(]+?)(?:\s*\(`?([a-z0-9_\-]+)`?\))?(?:\n|$)/i);
    if (systemMatch) {
        dossier.meta.systemLabel = systemMatch[1].trim();
        if (systemMatch[2]) dossier.meta.systemKey = systemMatch[2].trim();
    }

    // 3. Premise & Tone
    const premiseMatch = markdown.match(/\*\s*\*\*Premise:\*\*\s*([^\n\r]+)/i);
    if (premiseMatch) dossier.meta.premise = premiseMatch[1].trim();

    const toneMatch = markdown.match(/\*\s*\*\*Tone:\*\*\s*([^\n\r]+)/i);
    if (toneMatch) {
        dossier.meta.tone = toneMatch[1].trim();
    }

    // 4. Protagonist
    const protoMatch = markdown.match(/##\s*(?:👤\s*)?Protagonist:\s*([^\n\r]+)/i);
    if (protoMatch) dossier.protagonist.name = protoMatch[1].trim();

    const playbookMatch = markdown.match(/\*\s*\*\*Playbook:\*\*\s*([^\n\r]+)/i);
    if (playbookMatch) dossier.protagonist.playbook = playbookMatch[1].trim();

    const statsMatch = markdown.match(/\*\s*\*\*Stats:\*\*\s*([^\n\r]+)/i);
    if (statsMatch) {
        const parsedStats = parseStatsString(statsMatch[1]);
        if (Object.keys(parsedStats).length > 0) {
            dossier.protagonist.stats = parsedStats;
        }
    }

    const harmMatch = markdown.match(/\*\s*\*\*Harm Capacity:\*\*\s*(\d+)(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
    if (harmMatch) {
        dossier.protagonist.harm = {
            max: parseInt(harmMatch[1], 10) || 5,
            current: 0,
            armor: parseInt(harmMatch[2], 10) || 0,
        };
    }

    const bioMatch = markdown.match(/\*\s*\*\*Background Bio:\*\*\s*([^\n\r]+)/i);
    if (bioMatch) dossier.protagonist.bio = bioMatch[1].trim();

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

            const harmArmorM = block.match(/\*\s*\*\*Harm:\*\*\s*(\d+)(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
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

            dossier.monsters.push({
                name,
                harm: harmArmorM ? parseInt(harmArmorM[1], 10) : 3,
                armor: harmArmorM ? (parseInt(harmArmorM[2], 10) || 0) : 0,
                attacks: attacksM ? attacksM[1].split(',').map(s => s.trim()) : [],
                weakness: weaknessM ? weaknessM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                impendingDoom,
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
            dossier.worldRules = dossier.worldRules || { axioms: [], customModule: null };
            dossier.worldRules.customModule = {
                tag: tagM[1].trim().toUpperCase(),
                label: labelM ? labelM[1].trim() : tagM[1].trim(),
                icon: iconM ? iconM[1].trim() : '📦',
                instruction: instM ? instM[1].trim() : '',
                sampleContent: sampleM ? sampleM[1].trim() : '',
            };
        }
    }

    return (dossier.protagonist.name || dossier.meta.title !== 'Untitled PbtA Campaign' || (dossier.worldRules?.axioms && dossier.worldRules.axioms.length > 0)) ? dossier : null;
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
    const md = [
        '### 🎩 MultiHog Concierge Builder Diagnostic Trace',
        `- **Timestamp:** ${tx.timestamp || new Date().toISOString()}`,
        `- **Final Status:** ${tx.finalStatus || 'UNKNOWN'}`,
        `- **System Engine:** ${tx.systemEngine || 'fantasy'}`,
        `- **User Prompt:** ${tx.userPrompt || tx.userMessage || '(none)'}`,
        `- **Extracted Summary:** ${tx.builderSummary || '(none)'}`,
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
