/**
 * namerag-hooks.js — MultiHog Companion
 *
 * Non-invasive integration hooks between NameRAG and:
 * 1. Vanilla MultiHog roll buttons (#rt-cr-random-name, #rt-quickstart-roll-name, #rt-ob-roll-name)
 * 2. Instant Action unseeded character generation
 * 3. Ad-Hoc GM Guidance injected into MultiHog's customSyspromptLibrary
 * 4. Concierge Session Zero dynamic candidate seed generation
 */

import { searchNames, discoverNameRagServer } from './namerag-client.js';

export const NAMERAG_SYSPROMPT_ID = 'mhc_namerag_adhoc';

const GENRE_QUERY_MAP = {
    fantasy: 'high fantasy adventurer heroic spellcaster warrior rogue',
    scifi: 'cyberpunk science-fiction operative star pilot cyborg',
    realistic: 'modern noir investigator gritty contemporary',
    horror: 'gothic occult investigator victorian survivor macabre',
    western: 'dusty frontier gunslinger outlaw sheriff drifter',
    pirate: 'swashbuckling high-seas buccaneer corsair privateer',
    mecha: 'futuristic mecha pilot armored vanguard engineer',
    cosmic_horror: '1920s eldritch investigator antiquarian scholar',
    survival_horror: 'desperate survivor wasteland scavenger gritty',
    post_apocalyptic: 'post-apocalyptic raider wanderer scavenger mutant',
    gothic_heist: 'victorian thief scoundrel smokestack operative assassin',
    slice_of_life: 'whimsical pastoral traveler artisan cozy',
    anime: 'shonen heroic stylized fantasy warrior prodigy',
};

/**
 * Resolves a search query from a genre key and optional class/vibe hints.
 * @param {string} genre
 * @param {string} [classHint]
 * @returns {string}
 */
export function buildGenreQuery(genre = 'fantasy', classHint = '') {
    const base = GENRE_QUERY_MAP[genre?.toLowerCase()] || GENRE_QUERY_MAP.fantasy;
    return classHint ? `${base} ${classHint}`.trim() : base;
}

/**
 * Fetches a single random NameRAG candidate for a genre/class.
 * Falls back to offline pools if unavailable.
 * @param {string} genre
 * @param {string} [classHint]
 * @returns {Promise<{ name: string, vibe?: string }>}
 */
export async function rollNameRagCandidate(genre = 'fantasy', classHint = '') {
    const query = buildGenreQuery(genre, classHint);
    try {
        const results = await searchNames({ query, limit: 6 });
        if (results && results.length > 0) {
            const picked = results[Math.floor(Math.random() * results.length)];
            return {
                name: picked.name,
                vibe: picked.vibe || picked.meaning || '',
            };
        }
    } catch (err) {
        console.warn('[MultiHog Companion] rollNameRagCandidate failed, falling back:', err);
    }

    // Graceful offline fallback
    try {
        const mod = await import('../SillyTavern-MultihogDnDFramework/src/state/character-names.js');
        if (typeof mod?.pickGenreCharacterName === 'function') {
            return { name: mod.pickGenreCharacterName(genre) };
        }
    } catch (_) {}

    return { name: 'Rowan Vance' };
}

/**
 * Extracts all [[NAME:...]] or [[NAME]] placeholder tokens from raw text.
 * @param {string} text
 * @returns {Array<{ token: string, tag: string }>}
 */
export function extractNamePlaceholders(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = [];
    const seen = new Set();
    const regex = /\[\[NAME(?::\s*([^\]]+))?\]\]/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
        const token = m[0];
        if (!seen.has(token)) {
            seen.add(token);
            matches.push({
                token,
                tag: (m[1] || '').trim(),
            });
        }
    }
    return matches;
}

/**
 * Extracts surrounding entity context (role, playbook, species, background, demeanor, notes)
 * from a raw [UPDATE_DOSSIER] block for a given placeholder token.
 * @param {string} rawText
 * @param {string} token
 * @returns {{ blockType: string, contextSummary: string }}
 */
export function extractContextForPlaceholder(rawText, token) {
    if (!rawText || !token) return { blockType: 'general', contextSummary: '' };

    // Find the enclosing block containing this token
    const blockRegex = /\[(PROTAGONIST|NPC|MONSTER)(?::\s*[^\]]+)?\]([\s\S]*?)(?:\[\/\1\]|$)/gi;
    let bMatch;
    while ((bMatch = blockRegex.exec(rawText)) !== null) {
        const blockType = bMatch[1].toUpperCase();
        const blockContent = bMatch[2];
        if (blockContent.includes(token)) {
            const lines = blockContent.split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.includes(token) && !l.startsWith('moves:'));
            return {
                blockType,
                contextSummary: lines.slice(0, 8).join(' '),
            };
        }
    }

    return { blockType: 'general', contextSummary: '' };
}

/**
 * Builds a search query from placeholder metadata, surrounding entity text, and campaign setting.
 * @param {object} opts
 * @param {string} opts.tag
 * @param {string} opts.genre
 * @param {string} opts.blockType
 * @param {string} opts.contextSummary
 * @returns {string}
 */
export function buildQueryFromPlaceholderContext({ tag = '', genre = 'fantasy', blockType = '', contextSummary = '' } = {}) {
    const genreBase = GENRE_QUERY_MAP[genre?.toLowerCase()] || GENRE_QUERY_MAP.fantasy;
    const pieces = [genreBase];

    if (tag) pieces.push(tag.replace(/_/g, ' '));
    if (blockType && blockType !== 'GENERAL') pieces.push(blockType.toLowerCase());

    if (contextSummary) {
        // Strip common field prefixes to keep pure evocative words
        const cleaned = contextSummary
            .replace(/\b(playbook|role|species|demeanor|background|relationship|notes|attacks|weakness|gear|bio|appearance):\s*/gi, ' ')
            .replace(/[^a-zA-Z0-9\s-]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !['and', 'the', 'for', 'with', 'from'].includes(w.toLowerCase()))
            .slice(0, 15)
            .join(' ');
        if (cleaned) pieces.push(cleaned);
    }

    return pieces.filter(Boolean).join(' ').trim();
}

/**
 * Resolves all [[NAME:...]] placeholders across raw Builder output by performing
 * targeted NameRAG searches per entity, gracefully falling back to offline pools if unavailable.
 *
 * @param {string} rawBuilderOutput Raw LLM output containing [UPDATE_DOSSIER]
 * @param {object} activeDossier Current campaign dossier for genre and premise context
 * @param {object} [options]
 * @param {boolean} [options.returnDetails=false] If true, returns { text: string, resolutions: Array<object> }
 * @returns {Promise<string|{ text: string, resolutions: Array<object> }>} The raw output with all [[NAME:...]] tokens resolved to unique names
 */
export async function resolveDossierNamePlaceholders(rawBuilderOutput, activeDossier = {}, { returnDetails = false } = {}) {
    const emptyResult = returnDetails ? { text: rawBuilderOutput, resolutions: [] } : rawBuilderOutput;
    if (!rawBuilderOutput || typeof rawBuilderOutput !== 'string') return emptyResult;

    const placeholders = extractNamePlaceholders(rawBuilderOutput);
    if (placeholders.length === 0) return emptyResult;

    // Detect genre from output or active dossier
    const sysMatch = rawBuilderOutput.match(/system\s*:\s*([^\n\r]+)/i);
    const genre = (sysMatch ? sysMatch[1].trim() : (activeDossier?.meta?.systemKey || activeDossier?.meta?.system || 'fantasy')).toLowerCase();

    // Check NameRAG availability
    let nameRagAvailable = false;
    let activeServerName = null;
    try {
        const discovery = await discoverNameRagServer();
        nameRagAvailable = !!(discovery?.available && discovery?.serverName);
        activeServerName = discovery?.serverName || null;
    } catch (_) {}

    // Track names already used in this dossier to guarantee zero intra-campaign duplicates
    const usedNames = new Set();
    if (activeDossier?.protagonist?.name) usedNames.add(activeDossier.protagonist.name.toLowerCase());
    (activeDossier?.npcs || []).forEach(n => n.name && usedNames.add(n.name.toLowerCase()));
    (activeDossier?.monsters || []).forEach(m => m.name && usedNames.add(m.name.toLowerCase()));

    let resolvedOutput = rawBuilderOutput;
    const resolutions = [];

    for (const ph of placeholders) {
        const { blockType, contextSummary } = extractContextForPlaceholder(rawBuilderOutput, ph.token);
        const query = buildQueryFromPlaceholderContext({
            tag: ph.tag,
            genre,
            blockType,
            contextSummary,
        });

        let chosenName = null;
        let candidatePool = [];
        let source = nameRagAvailable ? `NameRAG (${activeServerName || 'MCP'})` : 'Offline Fallback Pool';

        if (nameRagAvailable) {
            try {
                const results = await searchNames({ query, limit: 6 });
                if (Array.isArray(results) && results.length > 0) {
                    candidatePool = results.map(r => r?.name).filter(Boolean);
                    const candidate = results.find(r => r?.name && !usedNames.has(r.name.toLowerCase()));
                    if (candidate) {
                        chosenName = candidate.name.trim();
                    } else if (results[0]?.name) {
                        chosenName = results[0].name.trim();
                    }
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Targeted NameRAG search failed for placeholder:', ph.token, err);
                source = 'Offline Fallback (Error)';
            }
        }

        // Offline fallback if NameRAG didn't resolve a name
        if (!chosenName) {
            source = source.includes('Error') ? source : 'Offline Fallback Pool';
            try {
                const mod = await import('../SillyTavern-MultihogDnDFramework/src/state/character-names.js');
                if (typeof mod?.pickGenreCharacterName === 'function') {
                    for (let i = 0; i < 5; i++) {
                        const fallback = mod.pickGenreCharacterName(genre);
                        if (fallback && !candidatePool.includes(fallback)) candidatePool.push(fallback);
                        if (fallback && !usedNames.has(fallback.toLowerCase())) {
                            chosenName = fallback;
                            break;
                        }
                    }
                }
            } catch (_) {}
        }

        if (!chosenName) {
            const defaultPool = ['Kaelen', 'Theron', 'Kaelis', 'Bryn', 'Maren', 'Sariel', 'Corin', 'Vael'];
            candidatePool = defaultPool.slice(0, 5);
            chosenName = defaultPool.find(n => !usedNames.has(n.toLowerCase())) || 'Kaelen';
        }

        usedNames.add(chosenName.toLowerCase());

        // Perform exact replacement across the entire text
        resolvedOutput = resolvedOutput.split(ph.token).join(chosenName);

        resolutions.push({
            placeholder: ph.token,
            tag: ph.tag || 'general',
            blockType,
            query,
            source,
            candidates: candidatePool,
            selectedName: chosenName,
        });
    }

    if (returnDetails) {
        return { text: resolvedOutput, resolutions };
    }
    return resolvedOutput;
}

/**
 * Fetches a batch of NameRAG candidate names and formats them into a prompt seed block for Concierge Session Zero.
 * (Maintained for legacy/fallback single-prompt compatibility)
 * @param {object} opts
 * @param {string} opts.genre
 * @param {string} [opts.premise]
 * @param {number} [opts.limit=8]
 * @returns {Promise<string>}
 */
export async function buildNameRagSeedsForConcierge({ genre = 'fantasy', premise = '', limit = 8 } = {}) {
    const discovery = await discoverNameRagServer();
    if (!discovery.available) return '';

    const query = [
        GENRE_QUERY_MAP[genre?.toLowerCase()] || genre,
        premise ? premise.slice(0, 150) : '',
    ].filter(Boolean).join(' ');

    try {
        const results = await searchNames({ query, limit });
        if (!results || results.length === 0) return '';

        const lines = results.map((r) => {
            const details = [r.gender, r.origin, r.meaning].filter(Boolean).join(' | ');
            const metaStr = details ? ` (${details})` : '';
            const vibeStr = r.vibe ? ` — ${r.vibe}` : '';
            return `* **${r.name}**${metaStr}${vibeStr}`;
        });

        return `\n\n[NAME_DIVERSITY_SEEDS]\nCurated evocative names from the world's name repository for this campaign:\n${lines.join('\n')}\n\nWhen proposing or drafting the protagonist, NPCs, monsters, or adversaries, draw inspiration or names directly from this pool rather than defaulting to repetitive tropes.\n[/NAME_DIVERSITY_SEEDS]`;
    } catch (err) {
        console.warn('[MultiHog Companion] Failed to build NameRAG seeds for Concierge:', err);
        return '';
    }
}

/**
 * Injects or updates the Ad-Hoc GM Guidance snippet in MultiHog's customSyspromptLibrary.
 * @param {boolean} enabled Whether the ad-hoc guidance should be active
 * @param {function} [onRefresh] Callback to trigger MultiHog sysprompt recompilation
 */
export async function syncNameRagAdhocSysprompt(enabled, onRefresh) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const settings = ctx?.extensionSettings?.rpg_tracker;
    if (!settings) return;

    settings.customSyspromptLibrary = settings.customSyspromptLibrary || [];
    const existingIndex = settings.customSyspromptLibrary.findIndex((p) => p.id === NAMERAG_SYSPROMPT_ID);

    const promptContent = `When introducing new named characters, NPCs, merchants, or adversaries:
- If function tools are available, you may invoke \`search_names\` with the character's archetype or vibe (e.g. query: "cynical dwarven fence", limit: 5) to select an authentic, evocative name.
- Avoid repetitive or cliché LLM default names (e.g., Elidor, Silas, Lyra, Vance, Aurelia, Malachi). Select varied names authentic to the culture and setting.`;

    if (enabled) {
        if (existingIndex >= 0) {
            settings.customSyspromptLibrary[existingIndex].enabled = true;
            settings.customSyspromptLibrary[existingIndex].content = promptContent;
        } else {
            settings.customSyspromptLibrary.push({
                id: NAMERAG_SYSPROMPT_ID,
                tag: 'name_generation',
                title: 'Name Diversity & NameRAG Guidance',
                description: 'Guides the Narrator/GM to avoid repetitive names and use search_names when available',
                content: promptContent,
                enabled: true,
                origin: 'companion',
            });
        }
    } else {
        if (existingIndex >= 0) {
            settings.customSyspromptLibrary[existingIndex].enabled = false;
        }
    }

    if (typeof onRefresh === 'function') {
        await onRefresh();
    }
}

/**
 * Hooks MultiHog's Character Creator, Quick Start, and Onboarding roll buttons
 * to use NameRAG when enabled.
 * @param {() => boolean} isNameRagActive Check function returning whether NameRAG is enabled in Companion settings
 */
export function setupMultiHogRollHooks(isNameRagActive) {
    // 1. Quick Start Roll Name button (#rt-quickstart-roll-name)
    $(document).off('click.mhc_namerag_qs', '#rt-quickstart-roll-name');
    $(document).on('click.mhc_namerag_qs', '#rt-quickstart-roll-name', async function (e) {
        if (!isNameRagActive()) return; // Let MultiHog's native listener handle it
        e.stopImmediatePropagation();
        e.preventDefault();

        const btn = $(this);
        const origHtml = btn.html();
        btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const root = btn.closest('#rpg-tracker-quickstart');
            const genre = root.find('#rt-quickstart-genre').val() || 'fantasy';
            const candidate = await rollNameRagCandidate(genre);
            const input = root.find('#rt-quickstart-name');
            input.val(candidate.name).trigger('input');
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 2. Character Creator Random Name button (#rt-cr-random-name)
    $(document).off('click.mhc_namerag_cr', '#rt-cr-random-name');
    $(document).on('click.mhc_namerag_cr', '#rt-cr-random-name', async function (e) {
        if (!isNameRagActive()) return;
        e.stopImmediatePropagation();
        e.preventDefault();

        const btn = $(this);
        const origHtml = btn.html();
        btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const panel = btn.closest('#rpg-tracker-char-creator');
            const genre = panel.find('#rt-cr-genre').val() || 'fantasy';
            const classHint = panel.find('#rt-cr-class').val() || '';
            const candidate = await rollNameRagCandidate(genre, classHint);
            const input = panel.find('#rt-cr-name');
            input.val(candidate.name).trigger('input');
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 3. Onboarding Roll Name button (#rt-ob-roll-name)
    $(document).off('click.mhc_namerag_ob', '#rt-ob-roll-name');
    $(document).on('click.mhc_namerag_ob', '#rt-ob-roll-name', async function (e) {
        if (!isNameRagActive()) return;
        e.stopImmediatePropagation();
        e.preventDefault();

        const btn = $(this);
        const origHtml = btn.html();
        btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const container = btn.closest('.rt-onboarding-panel, #rpg-tracker-onboarding, body');
            const genre = container.find('#rt-onboarding-genre, select[name="genre"]').val() || 'fantasy';
            const candidate = await rollNameRagCandidate(genre);
            const input = container.find('#rt-ob-rolled-name, #rt-onboarding-name');
            input.val(candidate.name).trigger('input');
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 4. Instant Action Blank Name Interception (#rt-quickstart-begin)
    // If player starts Quick Start without rolling/typing a name, pre-fill from NameRAG to prevent LLM default repetition
    $(document).off('click.mhc_namerag_begin', '#rt-quickstart-begin');
    $(document).on('click.mhc_namerag_begin', '#rt-quickstart-begin', async function (e) {
        if (!isNameRagActive()) return;
        const root = $(this).closest('#rpg-tracker-quickstart');
        const nameInput = root.find('#rt-quickstart-name');
        if (nameInput.length && !nameInput.val().trim()) {
            // Field is empty — fetch a NameRAG candidate first so prompt is seeded
            e.stopImmediatePropagation();
            e.preventDefault();
            const genre = root.find('#rt-quickstart-genre').val() || 'fantasy';
            const candidate = await rollNameRagCandidate(genre);
            nameInput.val(candidate.name).trigger('input');
            // Re-trigger click now that name is populated
            $(this).trigger('click');
        }
    });
}
