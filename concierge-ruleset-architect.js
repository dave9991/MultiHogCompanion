/**
 * concierge-ruleset-architect.js — MultiHog Companion
 *
 * Dedicated Step 3 Sub-Agent ("Ruleset Architect"):
 * Evaluates Step 1 Framing + Step 2 Canon (and optional mid-conversation tweak
 * requests) to select the best built-in genre preset OR craft a custom ruleset
 * specification (custom stats, archetypes/playbooks, moves, or FAE resource pools).
 */

import { PBTA_GENRES } from './pbta-ruleset.js';
import { FAE_GENRES } from './fae-ruleset.js';
import { DND5E_GENRES } from './concierge-system-dnd5e.js';
import { parseResolvedNameToken } from './namerag-hooks.js';

/**
 * Deterministic keyword fallback when the LLM is unavailable or returns invalid output.
 * @param {object} dossier
 * @param {string} [ruleset='pbta']
 * @returns {string}
 */
export function inferFallbackGenreFromContext(dossier, ruleset = 'pbta') {
    const meta = dossier?.meta || {};
    const hay = `${meta.title || ''} ${meta.premise || ''} ${meta.tone || ''} ${meta.focalLens || ''}`.toLowerCase();

    if (ruleset === 'fae') {
        if (/fallout|wasteland|post[- ]?apocalyp|nuclear|vault|rad/.test(hay) && FAE_GENRES.post_apocalyptic) return 'post_apocalyptic';
        if (/cyber|neon|hacker|corpo|noir/.test(hay) && FAE_GENRES.cyberpunk_noir) return 'cyberpunk_noir';
        if (/space|starship|sci[- ]?fi|galaxy|void/.test(hay) && FAE_GENRES.deep_space) return 'deep_space';
        if (/west|frontier|cowboy|revolver/.test(hay) && FAE_GENRES.weird_west) return 'weird_west';
        if (/survival|zombie|outbreak/.test(hay) && FAE_GENRES.survival_horror) return 'survival_horror';
        if (/dungeon|osr|sword|fantasy|magic/.test(hay) && FAE_GENRES.osr_dungeon) return 'osr_dungeon';
        return FAE_GENRES.cosmic_horror ? 'cosmic_horror' : Object.keys(FAE_GENRES)[0];
    }

    if (ruleset === 'dnd5e') {
        if (/dark|grim|osr|deadly|cursed/.test(hay) && DND5E_GENRES.dark_fantasy) return 'dark_fantasy';
        return DND5E_GENRES.fantasy ? 'fantasy' : Object.keys(DND5E_GENRES)[0];
    }

    // PbtA
    if (/fallout|wasteland|post[- ]?apocalyp|nuclear|vault|rad|raider/.test(hay)) return 'post_apocalyptic';
    if (/cyber|sci[- ]?fi|space|starship|android|alien|laser/.test(hay)) return 'scifi';
    if (/mecha|gundam|titan|pilot/.test(hay)) return 'mecha';
    if (/cosmic|lovecraft|eldritch|cultist/.test(hay)) return 'cosmic_horror';
    if (/survival|zombie|infection|quarantine/.test(hay)) return 'survival_horror';
    if (/horror|vampire|ghost|haunted|slasher/.test(hay)) return 'horror';
    if (/west|frontier|outlaw|saloon|sheriff/.test(hay)) return 'western';
    if (/pirate|ship|sea|corsair|ocean/.test(hay)) return 'pirate';
    if (/heist|victorian|gothic|thief|steampunk/.test(hay)) return 'gothic_heist';
    if (/slice of life|school|cozy|cafe|academy/.test(hay)) return 'slice_of_life';
    if (/anime|shonen|isekai|ninja/.test(hay)) return 'anime';
    return 'fantasy';
}

function getGenreCatalog(ruleset) {
    if (ruleset === 'fae') return FAE_GENRES;
    if (ruleset === 'dnd5e') return DND5E_GENRES;
    return PBTA_GENRES;
}

/**
 * Formats the built-in genre catalog concisely for the Ruleset Architect prompt.
 * @param {string} ruleset
 * @returns {string}
 */
function formatGenreCatalogForArchitect(ruleset) {
    const catalog = getGenreCatalog(ruleset);
    return Object.entries(catalog).map(([key, g]) => {
        if (ruleset === 'fae') {
            const pools = Object.values(g.pools || {}).map(p => `${p.label} (${p.max})`).join(', ');
            return `* "${key}": ${g.label} — Pools: [${pools}]`;
        }
        if (ruleset === 'dnd5e') {
            return `* "${key}": ${g.label} — Classes: [${(g.classes || []).slice(0, 6).join(', ')}]`;
        }
        return `* "${key}": ${g.label} — Stats: [${(g.stats || []).join(', ')}] | Archetypes: [${(g.archetypes || []).slice(0, 5).join(', ')}]`;
    }).join('\n');
}

/**
 * Builds the system & user prompt for the Step 3 Ruleset Architect sub-agent.
 *
 * @param {object} dossier
 * @param {Array<object>} [canonEntries=[]]
 * @param {object} [options={}]
 * @param {string} [options.tweakRequest='']
 * @returns {{ system: string, user: string }}
 */
export function buildRulesetArchitectPrompt(dossier, canonEntries = [], { tweakRequest = '' } = {}) {
    const meta = dossier?.meta || {};
    const ruleset = meta.ruleset || 'pbta';
    const catalogText = formatGenreCatalogForArchitect(ruleset);

    const activeCanon = (Array.isArray(canonEntries) ? canonEntries : [])
        .filter(e => !e.disabled)
        .slice(0, 12)
        .map(e => {
            const { cleanName } = parseResolvedNameToken(e.name);
            const preview = String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
            return `- [${e.kind || 'LORE'}] ${cleanName || e.name}: ${preview}`;
        })
        .join('\n');

    const axioms = (dossier?.worldRules?.axioms || [])
        .map(a => `- ${a.title}: ${a.axiom}`)
        .join('\n');

    const existingSpec = meta.customGenreSpec
        ? `\nCurrent Active Ruleset Spec:\n${JSON.stringify({ system: meta.systemKey, system_label: meta.systemLabel, ...meta.customGenreSpec }, null, 2)}`
        : `\nCurrent Genre Key: ${meta.systemKey || 'unset'} (${meta.systemLabel || 'unset'})`;

    const schemaDoc = ruleset === 'fae'
        ? `{
  "system": "<preset_key or custom>",
  "system_label": "<Evocative genre/ruleset title>",
  "summary": "<1-sentence rationale>",
  "pools": [
    { "label": "Health", "max": 8, "zero_debuff": "Crippled & Bleeding", "recovery": "camp_or_sleep", "overflow": "scar_and_ko" },
    { "label": "Rad-Load", "max": 8, "zero_debuff": "Radiation Sickness", "recovery": "decontamination", "overflow": "lethal" }
  ],
  "archetypes": ["Vault Dweller", "Wasteland Medic", "Caravan Guard", "Tech Scavenger"],
  "max_harm_fate": "Mortal Peril (Last Breath / Dying)"
}`
        : `{
  "system": "<preset_key or custom>",
  "system_label": "<Evocative genre/ruleset title, e.g. 'Post-Apocalyptic / Fallout' or 'Custom: Vault Survival'>",
  "summary": "<1-sentence rationale>",
  "stats": ["Stat1", "Stat2", "Stat3", "Stat4", "Stat5"],
  "stat_descriptions": "Stat1 (...), Stat2 (...), ...",
  "archetypes": ["Archetype 1", "Archetype 2", "Archetype 3", "Archetype 4"],
  "moves": [
    "Move Name (+Stat) — concise fictional trigger and effect",
    "Move Name 2 (+Stat) — concise fictional trigger and effect"
  ],
  "max_harm_fate": "Mortal Peril (Last Breath / Dying)"
}`;

    const system = `You are the **Ruleset Architect**, a specialized Tabletop RPG systems designer for Session Zero Step 3 (${ruleset.toUpperCase()}).
Your ONLY job is to select the best built-in genre preset OR design a tailored \`custom\` ruleset & archetype set that matches the campaign's premise, tone, and Canon.

### Built-In ${ruleset.toUpperCase()} Presets:
${catalogText}

### Rules:
1. If one of the built-in presets fits well, set \`"system"\` to that exact key (e.g. \`"post_apocalyptic"\`) AND you may still customize \`archetypes\`, \`moves\`, or \`stats\` to fit the specific setting (e.g. Fallout Vault-Tec archetypes).
2. If none of the presets fit cleanly—or the player explicitly asks for a custom set, custom stats, or custom archetypes—set \`"system": "custom"\` and provide a complete bespoke \`system_label\`, 5 distinct \`stats\` (for PbtA) or 2–3 \`pools\` (for FAE), 4–6 \`archetypes\`, and 3–5 signature \`moves\`.
3. If refining an existing ruleset per a player tweak request, preserve everything the player didn't ask to change.
4. Reply with **ONLY** a single valid JSON object matching this schema (no markdown prose outside the JSON):
${schemaDoc}`;

    const user = `Campaign Title: ${meta.title || 'Untitled'}
Active Ruleset Engine: ${ruleset.toUpperCase()}
Premise: ${meta.premise || 'Unstated'}
Tone: ${meta.tone || 'Unstated'}
Focal Lens: ${meta.focalLens || 'Unstated'}
${existingSpec}

Active Canon Highlights:
${activeCanon || '(None)'}

World Axioms:
${axioms || '(Standard physics)'}
${tweakRequest ? `\nPlayer / Builder Recalibration Request:\n"${tweakRequest}"` : '\nTask: Select or craft the ideal ruleset, stats/pools, and archetypes for this campaign.'}`;

    return { system, user };
}

/**
 * Tolerantly parses Ruleset Architect LLM output into normalized dossier meta fields.
 *
 * @param {string} rawText
 * @param {string} [ruleset='pbta']
 * @param {string} [fallbackGenreKey='fantasy']
 * @returns {{ systemKey: string, systemLabel: string, customGenreSpec: object|null, summary: string }}
 */
export function parseRulesetArchitectOutput(rawText, ruleset = 'pbta', fallbackGenreKey = '') {
    const catalog = getGenreCatalog(ruleset);
    const defaultKey = fallbackGenreKey && catalog[fallbackGenreKey]
        ? fallbackGenreKey
        : Object.keys(catalog)[0];

    let s = String(rawText || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .trim();

    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) {
        const preset = catalog[defaultKey];
        return {
            systemKey: defaultKey,
            systemLabel: preset?.label || defaultKey,
            customGenreSpec: null,
            summary: `Fallback to built-in ${defaultKey} preset`,
        };
    }

    let parsed = null;
    try {
        parsed = JSON.parse(s.slice(start, end + 1));
    } catch (_) {
        const preset = catalog[defaultKey];
        return {
            systemKey: defaultKey,
            systemLabel: preset?.label || defaultKey,
            customGenreSpec: null,
            summary: `Fallback to built-in ${defaultKey} preset`,
        };
    }

    const rawKey = String(parsed.system || parsed.systemKey || defaultKey).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const isCustom = rawKey === 'custom' || !catalog[rawKey];
    const systemKey = isCustom ? 'custom' : rawKey;
    const preset = !isCustom ? catalog[systemKey] : null;
    const systemLabel = String(parsed.system_label || parsed.systemLabel || preset?.label || (isCustom ? 'Custom Ruleset' : systemKey)).trim();

    const stats = Array.isArray(parsed.stats)
        ? parsed.stats.map(x => String(x).trim()).filter(Boolean).slice(0, 6)
        : (preset?.stats ? [...preset.stats] : null);
    const statDescriptions = typeof parsed.stat_descriptions === 'string' && parsed.stat_descriptions.trim()
        ? parsed.stat_descriptions.trim()
        : (typeof parsed.statDescriptions === 'string' && parsed.statDescriptions.trim()
            ? parsed.statDescriptions.trim()
            : (preset?.statDescriptions || ''));
    const archetypes = Array.isArray(parsed.archetypes)
        ? parsed.archetypes.map(x => String(x).trim()).filter(Boolean).slice(0, 8)
        : (preset?.archetypes ? [...preset.archetypes] : (preset?.classes ? [...preset.classes] : []));
    const moves = Array.isArray(parsed.moves)
        ? parsed.moves.map(x => String(x).trim()).filter(Boolean).slice(0, 8)
        : (preset?.moves ? [...preset.moves] : []);
    const pools = Array.isArray(parsed.pools) && parsed.pools.length
        ? parsed.pools.filter(p => p && p.label).slice(0, 4)
        : null;
    const maxHarmFate = typeof parsed.max_harm_fate === 'string' && parsed.max_harm_fate.trim()
        ? parsed.max_harm_fate.trim()
        : (typeof parsed.maxHarmFate === 'string' ? parsed.maxHarmFate.trim() : '');

    const hasCustomOverrides = Boolean(
        isCustom ||
        (Array.isArray(parsed.stats) && parsed.stats.length >= 4) ||
        (Array.isArray(parsed.archetypes) && parsed.archetypes.length > 0) ||
        (Array.isArray(parsed.moves) && parsed.moves.length > 0) ||
        (pools && pools.length > 0)
    );

    const customGenreSpec = hasCustomOverrides
        ? {
            label: systemLabel,
            ...(stats ? { stats } : {}),
            ...(statDescriptions ? { statDescriptions } : {}),
            ...(archetypes.length ? { archetypes } : {}),
            ...(moves.length ? { moves } : {}),
            ...(pools ? { pools } : {}),
            ...(maxHarmFate ? { maxHarmFate } : {}),
        }
        : null;

    return {
        systemKey,
        systemLabel,
        customGenreSpec,
        summary: String(parsed.summary || `Calibrated ${systemLabel}`).trim(),
    };
}

/**
 * Runs the Step 3 Ruleset Architect sub-agent via the provided LLM sender.
 *
 * @param {object} params
 * @param {object} params.dossier
 * @param {Array<object>} [params.canonEntries=[]]
 * @param {Function} params.send
 * @param {string} [params.tweakRequest='']
 * @returns {Promise<{ systemKey: string, systemLabel: string, customGenreSpec: object|null, summary: string, rawResponse: string, fallbackUsed: boolean }>}
 */
export async function runRulesetArchitect({ dossier, canonEntries = [], send, tweakRequest = '' }) {
    const ruleset = dossier?.meta?.ruleset || 'pbta';
    const fallbackKey = inferFallbackGenreFromContext(dossier, ruleset);
    const catalog = getGenreCatalog(ruleset);

    if (typeof send !== 'function') {
        const preset = catalog[fallbackKey];
        return {
            systemKey: fallbackKey,
            systemLabel: preset?.label || fallbackKey,
            customGenreSpec: null,
            summary: `Selected ${preset?.label || fallbackKey} (offline inference)`,
            rawResponse: '',
            fallbackUsed: true,
        };
    }

    const { system, user } = buildRulesetArchitectPrompt(dossier, canonEntries, { tweakRequest });
    try {
        const rawResponse = await send([
            { role: 'system', name: 'System', content: system },
            { role: 'user', name: 'Player', content: user },
        ]);
        const parsed = parseRulesetArchitectOutput(rawResponse, ruleset, fallbackKey);
        return {
            ...parsed,
            rawResponse: String(rawResponse || ''),
            fallbackUsed: false,
        };
    } catch (err) {
        console.warn('[MultiHog Companion] Ruleset Architect fallback due to error:', err);
        const preset = catalog[fallbackKey];
        return {
            systemKey: fallbackKey,
            systemLabel: preset?.label || fallbackKey,
            customGenreSpec: null,
            summary: `Fallback to ${preset?.label || fallbackKey}: ${err.message || err}`,
            rawResponse: '',
            fallbackUsed: true,
        };
    }
}
