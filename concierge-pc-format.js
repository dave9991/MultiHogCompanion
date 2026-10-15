/**
 * concierge-pc-format.js — MultiHog Companion
 *
 * Formats PbtA Concierge protagonist data into the main MultiHog extension's
 * native Player Character card format (`DEFAULT_PC_SECTIONS`).
 *
 * Ensures that when the user opens the "Full PC Card" in Campaign Records,
 * all 8 sections (Species, Body, Worn Equipment, Personality, Background,
 * Habits & Behaviors, Strengths, Flaws) render with their dedicated badges,
 * icons, and colors, and allows the Lorebook Router's `applyPcCoreUpdate` to
 * reliably locate and patch `Body` and `Worn Equipment` during play.
 */

/** Stock section ids → fallback names (mirrors main's DEFAULT_PC_SECTIONS). */
export const FALLBACK_PC_SECTION_NAMES = {
    sec_species: 'Species',
    sec_body: 'Body',
    sec_equipment: 'Worn Equipment',
    sec_personality: 'Personality',
    sec_background: 'Background',
    sec_habits: 'Habits & Behaviors',
    sec_strengths: 'Strengths',
    sec_flaws: 'Flaws',
};

/**
 * Resolve the main extension's PC core section names, keyed by section id.
 * Reads live settings (`pcCoreSections`) at runtime, falling back to stock names.
 * @returns {Promise<Record<string, string>>}
 */
export async function loadMainPcSectionNames() {
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const schema = await import('../SillyTavern-MultihogDnDFramework/src/state/schema-sections.js');
        const settings = typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null;
        const custom = settings?.pcCoreSections;
        const sections = (Array.isArray(custom) && custom.length > 0) ? custom : schema.DEFAULT_PC_SECTIONS;
        if (!Array.isArray(sections) || !sections.length) return { ...FALLBACK_PC_SECTION_NAMES };
        const out = {};
        for (const sec of sections) {
            if (sec?.id && sec?.name) out[sec.id] = String(sec.name);
        }
        return Object.keys(out).length ? out : { ...FALLBACK_PC_SECTION_NAMES };
    } catch (err) {
        console.warn('[PbtA Concierge] Could not read main PC sections; using stock names:', err);
        return { ...FALLBACK_PC_SECTION_NAMES };
    }
}

/** Formats an array of strings into a markdown bullet list. */
function bullets(items) {
    return items.map(i => `- ${i}`).join('\n');
}

/**
 * If text already contains labeled sections (e.g. `Species:`, `Body:`),
 * extracts them into a key-value map keyed by lowercase label.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function extractExistingSections(text) {
    if (!text || typeof text !== 'string') return {};
    const lines = text.split('\n');
    const sections = {};
    let currentKey = null;
    let currentLines = [];

    const headerRegex = /^([A-Za-z0-9 &\/]+?)\s*:\s*(.*)$/;

    for (const rawLine of lines) {
        const match = rawLine.match(headerRegex);
        if (match && !rawLine.startsWith('- ') && !rawLine.startsWith('* ')) {
            if (currentKey) {
                sections[currentKey] = currentLines.join('\n').trim();
            }
            currentKey = match[1].trim().toLowerCase();
            currentLines = match[2].trim() ? [match[2].trim()] : [];
        } else if (currentKey) {
            currentLines.push(rawLine);
        }
    }
    if (currentKey) {
        sections[currentKey] = currentLines.join('\n').trim();
    }
    return sections;
}

/**
 * Builds a fully structured Player Character bio string adhering to MultiHog's
 * `DEFAULT_PC_SECTIONS`.
 *
 * @param {object} p Protagonist object from PbtaCampaignDossier
 * @param {Record<string, string>} [names] Section names keyed by section ID
 * @returns {string} Fully structured PC bio string
 */
export function buildPlayerCardBio(p = {}, names = FALLBACK_PC_SECTION_NAMES) {
    if (!p || typeof p !== 'object') return '';
    const n = names || FALLBACK_PC_SECTION_NAMES;

    // Check if protagonist.bio is already pre-structured with section headers
    const existing = extractExistingSections(p.bio || '');

    // 1. Species
    const speciesLabel = n.sec_species || 'Species';
    const speciesVal = existing['species']
        || p.species
        || (p.playbook ? `Human, ${p.playbook}` : 'Human');

    // 2. Body / Appearance
    const bodyLabel = n.sec_body || 'Body';
    const bodyVal = existing['body']
        || existing['appearance']
        || existing['appearance/species']
        || p.appearance
        || p.body
        || `A focused and observant presence matching the ${p.playbook || 'wanderer'} playbook.`;

    // 3. Worn Equipment
    const equipLabel = n.sec_equipment || 'Worn Equipment';
    let rawEquip = existing['worn equipment']
        || existing['equipment']
        || existing['gear']
        || p.equipment
        || p.gear;
    if (Array.isArray(rawEquip)) rawEquip = rawEquip.join(', ');
    const equipVal = rawEquip || 'Standard traveling gear and personal essentials.';

    // 4. Personality
    const persLabel = n.sec_personality || 'Personality';
    const persVal = existing['personality']
        || existing['demeanor']
        || p.personality
        || p.demeanor
        || 'Driven, alert, and determined to see matters through.';

    // 5. Background
    const bgLabel = n.sec_background || 'Background';
    let bgVal = existing['background']
        || existing['brief background']
        || p.background
        || (p.bio && !Object.keys(existing).length ? p.bio : null)
        || `A seasoned ${p.playbook || 'adventurer'} navigating dangerous terrain.`;

    // 6. Habits & Behaviors
    const habitsLabel = n.sec_habits || 'Habits & Behaviors';
    const habitsVal = existing['habits & behaviors']
        || existing['habits/behaviors']
        || existing['habits']
        || existing['behaviors']
        || p.habits
        || 'Measured and alert, keeping a close eye on the surroundings.';

    // 7. Strengths (Moves)
    const strLabel = n.sec_strengths || 'Strengths';
    let strVal = existing['strengths'];
    if (!strVal) {
        const moves = Array.isArray(p.startingMoves) && p.startingMoves.length
            ? p.startingMoves
            : (Array.isArray(p.moves) ? p.moves : []);
        if (moves.length) {
            strVal = `\n${bullets(moves)}`;
        } else {
            strVal = '\n- Resilient and adaptable under pressure.';
        }
    } else if (!strVal.startsWith('\n')) {
        strVal = `\n${strVal}`;
    }

    // 8. Flaws (Conditions / Weaknesses)
    const flawsLabel = n.sec_flaws || 'Flaws';
    let flawsVal = existing['flaws'];
    if (!flawsVal) {
        const conds = Array.isArray(p.conditions) && p.conditions.length
            ? p.conditions
            : (p.conditions ? [p.conditions] : (p.flaws ? (Array.isArray(p.flaws) ? p.flaws : [p.flaws]) : []));
        if (conds.length) {
            flawsVal = `\n${bullets(conds)}`;
        } else {
            flawsVal = '\n- Bound by obligations that leave little room for error.';
        }
    } else if (!flawsVal.startsWith('\n')) {
        flawsVal = `\n${flawsVal}`;
    }

    const sections = [
        `${speciesLabel}: ${speciesVal}`,
        `${bodyLabel}: ${bodyVal}`,
        `${equipLabel}: ${equipVal}`,
        `${persLabel}: ${persVal}`,
        `${bgLabel}: ${bgVal}`,
        `${habitsLabel}: ${habitsVal}`,
        `${strLabel}:${strVal.trimEnd()}`,
        `${flawsLabel}:${flawsVal.trimEnd()}`,
    ];

    return sections.join('\n');
}
