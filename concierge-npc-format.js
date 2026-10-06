/**
 * concierge-npc-format.js — MultiHog Companion
 *
 * Translates PbtA Concierge dossier NPCs / monsters into the main MultiHog
 * extension's native NPC `[CORE]` layout so the Router can protect and patch
 * their fields (Body, Worn Equipment, Combat Profile, ...).
 *
 * The section *names* are read from the main extension's live settings
 * (`npcCoreSections`) at runtime, keyed by their stable section ids. If the
 * main extension renames or removes a section, we follow it instead of
 * hard-coding headers; if it can't be loaded we fall back to the stock names.
 * No main-extension file is modified.
 */

/** Stock section ids → fallback names (mirrors main's DEFAULT_NPC_SECTIONS). */
const FALLBACK_SECTION_NAMES = {
    sec_species: 'Species',
    sec_body: 'Body',
    sec_equipment: 'Worn Equipment',
    sec_personality: 'Personality',
    sec_background: 'Brief Background',
    sec_habits: 'Habits/Behaviors',
    sec_strengths: 'Strengths',
    sec_flaws: 'Flaws',
    sec_combat_profile: 'Combat Profile',
};

/**
 * Resolve the main extension's NPC core section names, keyed by section id.
 * A missing key means the user removed that section in main — callers skip it.
 * @returns {Promise<Record<string,string>>}
 */
export async function loadMainNpcSectionNames() {
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const schema = await import('../SillyTavern-MultihogDnDFramework/src/state/schema-sections.js');
        const settings = typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null;
        const custom = settings?.npcCoreSections;
        const sections = (Array.isArray(custom) && custom.length > 0) ? custom : schema.DEFAULT_NPC_SECTIONS;
        if (!Array.isArray(sections) || !sections.length) return { ...FALLBACK_SECTION_NAMES };
        const out = {};
        for (const sec of sections) {
            if (sec?.id && sec?.name) out[sec.id] = String(sec.name);
        }
        return Object.keys(out).length ? out : { ...FALLBACK_SECTION_NAMES };
    } catch (err) {
        console.warn('[PbtA Concierge] Could not read main NPC sections; using stock names:', err);
        return { ...FALLBACK_SECTION_NAMES };
    }
}

/** Split on commas that are not inside parentheses (so "Move (a, b), Move2" → 2 items). */
export function splitTopLevelCommas(text) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(text || '')) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if ((ch === ',' || ch === ';') && depth === 0) {
            if (cur.trim()) out.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function bullets(items) {
    return items.map(i => `- ${i}`).join('\n');
}

/**
 * Assemble `[CORE]` from {sectionId: text}, skipping empty values and any
 * section the main extension no longer defines.
 */
function assembleCore(fields, names) {
    const lines = [];
    for (const [id, text] of Object.entries(fields)) {
        const raw = String(text || '');
        const label = names[id];
        if (!raw.trim() || !label) continue;
        // Bullet lists start with "\n" and sit on their own lines under the header.
        lines.push(raw.startsWith('\n') ? `${label}:${raw.trimEnd()}` : `${label}: ${raw.trim()}`);
    }
    return lines.length ? `[CORE]\n${lines.join('\n')}\n[/CORE]` : '';
}

/**
 * Build the lorebook / library content for a dossier NPC.
 * Campaign-specific facts (relationship, notes) live OUTSIDE [CORE] — main
 * keeps those out of the protected identity block.
 * @param {object} npc Dossier NPC
 * @param {Record<string,string>} names From {@link loadMainNpcSectionNames}
 * @returns {{ core: string, full: string }}
 */
export function buildNpcEntryContent(npc, names) {
    const moves = splitTopLevelCommas(npc.movesOrBoons).map(m => `Move/Boon — ${m}`);
    const background = [npc.role ? `${npc.role}.` : '', npc.background || '']
        .filter(Boolean).join(' ').trim();

    const core = assembleCore({
        sec_species: npc.species,
        sec_body: npc.appearance,
        sec_equipment: npc.equipment,
        sec_personality: npc.demeanor,
        sec_background: background,
        sec_strengths: moves.length ? `\n${bullets(moves)}` : '',
    }, names);

    const chronicle = [
        npc.relationship ? `Relationship: ${npc.relationship}` : '',
        npc.notes ? `Notes: ${npc.notes}` : '',
    ].filter(Boolean).join('\n');

    return { core, full: chronicle ? `${core}\n${chronicle}` : core };
}

/**
 * Build the lorebook / library content for a PbtA monster (adversary).
 * Harm/Armor/attacks/countdown go into Combat Profile; weakness → Flaws.
 */
export function buildMonsterEntryContent(monster, names) {
    const attacks = Array.isArray(monster.attacks) ? monster.attacks : [];
    const doom = Array.isArray(monster.impendingDoom) ? monster.impendingDoom : [];
    const harmMax = Math.max(1, parseInt(monster.harm, 10) || 4);

    // Main's combatant parser (combat-persistence.js) and Enemies panel only recognize
    // "Name: cur/max HP ..." headers, so PbtA adversaries carry a redundant HP token that
    // descends in tandem with Harm — the same workaround the [PARTY] block uses.
    const combatLines = [
        `${monster.name}: ${harmMax}/${harmMax} HP | Harm: 0/${harmMax} | Armor: ${parseInt(monster.armor, 10) || 0}`,
        attacks.length ? `((PILLS)) Attacks: ${attacks.join(', ')}` : '',
        monster.weakness && monster.weakness !== 'Unknown' ? `((PILLS)) Weakness: ${monster.weakness}` : '',
        doom.length ? `Countdown: ${doom.join(' → ')}` : '',
        'Status: Healthy',
    ].filter(Boolean);

    const core = assembleCore({
        sec_background: monster.notes ? `PbtA adversary. ${monster.notes}` : 'PbtA adversary.',
        sec_strengths: attacks.length ? `\n${bullets(attacks)}` : '',
        sec_flaws: monster.weakness && monster.weakness !== 'Unknown' ? `\n${bullets([monster.weakness])}` : '',
        sec_combat_profile: `\n${combatLines.join('\n')}`,
    }, names);

    return { core, full: core };
}

/** Lorebook trigger keys: full name + first name. Never the role (too generic). */
export function buildNpcKeys(name) {
    const clean = String(name || '').trim();
    const first = clean.split(/\s+/)[0];
    const keys = [clean];
    if (first && first !== clean) keys.push(first);
    return keys.filter(Boolean);
}
