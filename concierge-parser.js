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
            tone: [],
            createdAt: Date.now(),
        },
        protagonist: {
            name: '',
            playbook: '',
            stats: {},
            startingMoves: [],
            harm: { max: 5, current: 0, armor: 0 },
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
    };
}

/**
 * Strips [CONCIERGE_STATE] blocks out of text for display in the conversational bubble.
 * @param {string} text
 * @returns {string}
 */
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
        .replace(/\[PROTAGONIST\][\s\S]*?(?:\[\/PROTAGONIST\]|$)/gi, '')
        .replace(/\[NPC\][\s\S]*?(?:\[\/NPC\]|$)/gi, '')
        .replace(/\[MONSTER\][\s\S]*?(?:\[\/MONSTER\]|$)/gi, '')
        .replace(/\[MAP\][\s\S]*?(?:\[\/MAP\]|$)/gi, '')
        .replace(/\[KICK\][\s\S]*?(?:\[\/KICK\]|$)/gi, '')
        .replace(/\[CYOA\][\s\S]*?(?:\[\/CYOA\]|$)/gi, '')
        .replace(/\[REMOVE_(?:NPC|MONSTER|MAP):[^\n\]]+\]/gi, '')
        .replace(/\[(?:CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS)\]/gi, '')
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

    if (p.name || p.playbook) {
        lines.push(`Protagonist: ${p.name || 'Unnamed Adventurer'} (Playbook: ${p.playbook || 'In Development'})`);
        if (p.stats && Object.keys(p.stats).length) {
            const statStr = Object.entries(p.stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ');
            lines.push(`  Stats: ${statStr}`);
        }
        lines.push(`  Harm: ${p.harm?.max ?? 5} | Armor: ${p.harm?.armor ?? 0}`);
        if (p.startingMoves && p.startingMoves.length) {
            lines.push(`  Moves: ${p.startingMoves.join(' | ')}`);
        }
        if (p.gear && p.gear.length) {
            lines.push(`  Gear: ${p.gear.join(', ')}`);
        }
        if (p.bio) {
            lines.push(`  Bio: ${p.bio}`);
        }
    } else {
        lines.push('Protagonist: Unset');
    }

    if (npcs.length) {
        lines.push(`NPCs (${npcs.length}):`);
        npcs.forEach(n => {
            const role = n.role ? ` [Role: ${n.role}]` : '';
            const bond = n.relationship ? ` (Bond: ${n.relationship})` : '';
            const look = n.appearance ? ` (Look: ${n.appearance})` : '';
            lines.push(`  - ${n.name}${role}${bond}${look}`);
        });
    } else {
        lines.push('NPCs: None');
    }

    if (monsters.length) {
        lines.push(`Monsters (${monsters.length}):`);
        monsters.forEach(m => {
            lines.push(`  - ${m.name} [Harm: ${m.harm}, Armor: ${m.armor}] (Weakness: ${m.weakness || 'Unknown'})`);
        });
    } else {
        lines.push('Monsters: None');
    }

    if (maps.length) {
        lines.push(`Maps (${maps.length}):`);
        maps.forEach(m => {
            lines.push(`  - ${m.site} [${m.kind}, Threat: ${m.threat}]`);
        });
    } else {
        lines.push('Maps: None');
    }

    if (kick.startingLocation || kick.crisis) {
        lines.push('The Kick:');
        if (kick.startingLocation) lines.push(`  Starting Location: ${kick.startingLocation}`);
        if (kick.crisis) lines.push(`  Crisis: ${kick.crisis}`);
    } else {
        lines.push('The Kick: Unset');
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
    };

    if (!text || typeof text !== 'string') return fallbackResult;

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
        const hasDirectBlocks = /\[(?:PROTAGONIST|NPC|MONSTER|MAP|KICK|REMOVE_NPC|REMOVE_MONSTER|REMOVE_MAP|CLEAR_NPCS|CLEAR_MONSTERS|CLEAR_MAPS)\]/i.test(text);
        if (hasDirectBlocks) {
            raw = text;
        }
    }

    if (!raw) return fallbackResult;

    const updated = JSON.parse(JSON.stringify(dossier));
    const changes = [];
    const errors = [];

    // ── 1. Meta / System ────────────────────────────────────────────────────────
    const sysMatch = raw.match(/system\s*:\s*([a-zA-Z0-9_\-]+)/i);
    if (sysMatch) {
        const key = sysMatch[1].trim().toLowerCase();
        if (PBTA_GENRES[key]) {
            if (updated.meta.systemKey !== key) {
                updated.meta.systemKey = key;
                updated.meta.systemLabel = PBTA_GENRES[key].label;
                changes.push(`PbtA Engine set to ${updated.meta.systemLabel} (${key})`);
            }
        } else {
            errors.push(`Unknown system engine "${key}". Available: ${Object.keys(PBTA_GENRES).join(', ')}`);
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
            const h = parseInt(kv.harm, 10);
            if (!isNaN(h)) {
                updated.protagonist.harm.max = h;
                changes.push(`Protagonist Harm max set to ${h}`);
            }
        }
        if (kv.armor) {
            const a = parseInt(kv.armor, 10);
            if (!isNaN(a)) {
                updated.protagonist.harm.armor = a;
                changes.push(`Protagonist Armor set to ${a}`);
            }
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
        const targetName = (rm[1] || rm[2] || '').trim();
        if (targetName) {
            const beforeLen = updated.npcs.length;
            updated.npcs = updated.npcs.filter(n => n.name.toLowerCase() !== targetName.toLowerCase());
            if (updated.npcs.length < beforeLen) {
                changes.push(`Removed NPC "${targetName}"`);
            }
        }
    }

    const npcMatches = raw.matchAll(/\[NPC\]([\s\S]*?)(?:\[\/NPC\]|$)/gi);
    for (const match of npcMatches) {
        const nBlock = match[1];
        const kv = parseKeyValueLines(nBlock);
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

        const npcObj = {
            name: kv.name,
            role: kv.role || 'Ally',
            species: kv.species || kv.race || '',
            appearance: kv.appearance || kv.description || kv.look || '',
            equipment: kv.equipment || kv.gear || '',
            demeanor: kv.demeanor || '',
            background: kv.background || '',
            relationship: kv.relationship || '',
            movesOrBoons: kv.moves_or_boons || kv.moves || '',
            notes: kv.notes || '',
            portraitSrc: null,
        };

        const existingIdx = updated.npcs.findIndex(n => n.name.toLowerCase() === npcObj.name.toLowerCase());
        if (existingIdx >= 0) {
            updated.npcs[existingIdx] = Object.assign({}, updated.npcs[existingIdx], npcObj);
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
        const targetName = (rm[1] || rm[2] || '').trim();
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

        const monsterObj = {
            name: kv.name,
            harm: parseInt(kv.harm, 10) || 4,
            armor: parseInt(kv.armor, 10) || 0,
            attacks: kv.attacks ? kv.attacks.split(/[,;]/).map(a => a.trim()).filter(Boolean) : [],
            weakness: kv.weakness || 'Unknown',
            impendingDoom: parseBulletList(mBlock, 'countdown'),
            notes: kv.notes || '',
        };

        const existingIdx = updated.monsters.findIndex(m => m.name.toLowerCase() === monsterObj.name.toLowerCase());
        if (existingIdx >= 0) {
            updated.monsters[existingIdx] = Object.assign({}, updated.monsters[existingIdx], monsterObj);
            changes.push(`Updated Adversary "${monsterObj.name}" (Harm: ${monsterObj.harm}, Armor: ${monsterObj.armor})`);
        } else {
            updated.monsters.push(monsterObj);
            changes.push(`Added Adversary "${monsterObj.name}" (Harm: ${monsterObj.harm}, Armor: ${monsterObj.armor})`);
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
        const targetSite = (rm[1] || rm[2] || '').trim();
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
            updated.maps[existingIdx] = Object.assign({}, updated.maps[existingIdx], mapObj);
            changes.push(`Updated Location "${mapObj.site}" (${mapObj.kind})`);
        } else {
            updated.maps.push(mapObj);
            changes.push(`Queued Location "${mapObj.site}" (${mapObj.kind}, Threat: ${mapObj.threat})`);
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

    return {
        success: errors.length === 0,
        updatedDossier: updated,
        changes,
        errors,
        hasMutations: changes.length > 0,
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
        ? npcs.map(n => `### 👤 ${n.name}
* **Role:** ${n.role || 'Ally'}${n.species ? `\n* **Species:** ${n.species}` : ''}
* **Appearance:** ${n.appearance || 'None specified'}${n.equipment ? `\n* **Equipment:** ${n.equipment}` : ''}
* **Demeanor:** ${n.demeanor || 'None specified'}
* **Relationship:** ${n.relationship || 'Allied with protagonist'}
* **Background:** ${n.background || 'None specified'}
* **Moves/Boons:** ${n.movesOrBoons || 'None'}
* **Notes:** ${n.notes || 'None'}`).join('\n\n')
        : '_No supporting NPCs staged yet._';

    let monstersMd = monsters.length
        ? monsters.map(m => {
            let attacks = m.attacks.length ? m.attacks.join(', ') : 'Natural attacks';
            let doom = m.impendingDoom.length
                ? `\n  * **Countdown Clock:**\n    ${m.impendingDoom.map(d => `* ${d}`).join('\n    ')}`
                : '';
            return `### 👹 ${m.name}
* **Harm:** ${m.harm} | **Armor:** ${m.armor}
* **Attacks:** ${attacks}
* **Weakness:** ${m.weakness}${doom}
* **Notes:** ${m.notes || 'None'}`;
        }).join('\n\n')
        : '_No adversaries staged yet._';

    let mapsMd = maps.length
        ? maps.map(m => `* **${m.site}** (${m.kind} · Threat: ${m.threat})
  * Entrance: ${m.entrance}
  * Premise: ${m.briefDescription}`).join('\n')
        : '_No locations staged yet._';

    return `# 📜 CAMPAIGN DOSSIER: ${meta.title || 'Untitled PbtA Campaign'}

* **System Engine:** ${meta.systemLabel || 'PbtA Fantasy'} (\`${meta.systemKey || 'fantasy'}\`)
* **Premise:** ${meta.premise || 'Not specified'}

---

## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Playbook:** ${p.playbook || 'Wanderer'}
* **Stats:** ${statString || 'Not assigned'}
* **Harm Capacity:** ${p.harm?.max || 5} | **Armor:** ${p.harm?.armor || 0}
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

## 🗺️ Locations & Sites:
${mapsMd}

---

## ⚡ The Kick (Opening Crisis):
* **Starting Point:** ${kick.startingLocation || 'The road'}
* **Inciting Crisis:** ${kick.crisis || 'Trouble approaches'}
* **Opening Hook:** ${kick.openingPrompt || 'You stand at the threshold...'}${dossier.cyoaExamples && dossier.cyoaExamples.length ? `\n\n---\n\n## 🎲 Tailored CYOA Move Choices:\n${dossier.cyoaExamples.map(c => `* ${c}`).join('\n')}` : ''}`;
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

    // 3. Premise
    const premiseMatch = markdown.match(/\*\s*\*\*Premise:\*\*\s*([^\n\r]+)/i);
    if (premiseMatch) dossier.meta.premise = premiseMatch[1].trim();

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
    const npcSection = markdown.match(/##\s*(?:👥\s*)?Supporting Cast[^\n]*:\s*([\s\S]*?)(?=##|---|$)/i);
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
            const bgM = block.match(/\*\s*\*\*Background:\*\*\s*([^\n\r]+)/i);
            const boonsM = block.match(/\*\s*\*\*Moves\/Boons:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const speciesM = block.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
            const equipM = block.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);

            dossier.npcs.push({
                name,
                role: roleM ? roleM[1].trim() : 'Ally',
                species: speciesM ? speciesM[1].trim() : '',
                appearance: appM && !appM[1].includes('None specified') ? appM[1].trim() : '',
                equipment: equipM ? equipM[1].trim() : '',
                demeanor: demeanorM ? demeanorM[1].trim() : '',
                relationship: relM ? relM[1].trim() : '',
                background: bgM ? bgM[1].trim() : '',
                movesOrBoons: boonsM ? boonsM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                portraitSrc: null,
            });
        }
    }

    // 7. Monsters
    const monsterSection = markdown.match(/##\s*(?:👹\s*)?Threats & Monsters:\s*([\s\S]*?)(?=##|---|$)/i);
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

            dossier.monsters.push({
                name,
                harm: harmArmorM ? parseInt(harmArmorM[1], 10) : 3,
                armor: harmArmorM ? (parseInt(harmArmorM[2], 10) || 0) : 0,
                attacks: attacksM ? attacksM[1].split(',').map(s => s.trim()) : [],
                weakness: weaknessM ? weaknessM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                impendingDoom: [],
            });
        }
    }

    // 8. Locations & Sites
    const mapsSection = markdown.match(/##\s*(?:🗺️\s*)?Locations & Sites:\s*([\s\S]*?)(?=##|---|$)/i);
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

    return (dossier.protagonist.name || dossier.meta.title !== 'Untitled PbtA Campaign') ? dossier : null;
}
