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
 * Normalizes user-entered gender strings into standard NameRAG filters ('M', 'F', 'Dual').
 * @param {string} val
 * @returns {string|undefined}
 */
export function normalizeGenderFilter(val) {
    if (!val || typeof val !== 'string') return undefined;
    const clean = val.trim().toLowerCase();
    if (/^(m|male|man|boy|he|him|masculine)$/i.test(clean)) return 'M';
    if (/^(f|female|woman|girl|she|her|feminine)$/i.test(clean)) return 'F';
    if (/^(nb|non-binary|enby|unisex|dual|androgynous|they|them|neutral)$/i.test(clean)) return 'Dual';
    return undefined;
}

/**
 * Detects obvious gender references in character instructions/concepts.
 * @param {string} text
 * @returns {string|undefined}
 */
export function detectGenderFromText(text) {
    if (!text || typeof text !== 'string') return undefined;
    if (/\b(female|woman|girl|she|her|feminine)\b/i.test(text)) return 'F';
    if (/\b(male|man|boy|he|him|masculine)\b/i.test(text)) return 'M';
    if (/\b(non-binary|enby|unisex|androgynous|they|them)\b/i.test(text)) return 'Dual';
    return undefined;
}

/**
 * Extracts evocative keywords from freeform character descriptions,
 * stripping common field prefixes and stopwords.
 * @param {string} text
 * @param {number} [maxWords=15]
 * @returns {string}
 */
export function cleanContextKeywords(text, maxWords = 15) {
    if (!text || typeof text !== 'string') return '';
    const stopWords = new Set([
        'and', 'the', 'for', 'with', 'from', 'this', 'that', 'into', 'upon', 'about',
        'having', 'starting', 'starts', 'start', 'will', 'would', 'could', 'should',
        'character', 'player', 'years', 'year', 'old', 'e.g', 'etc', 'like', 'some',
    ]);
    return text
        .replace(/\b(playbook|role|species|demeanor|background|relationship|notes|attacks|weakness|gear|bio|appearance|traits|abilities|additional):\s*/gi, ' ')
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
        .slice(0, maxWords)
        .join(' ');
}

/**
 * Constructs a rich NameRAG search query from character context if available,
 * gracefully falling back to genre archetype pools when no details are provided.
 * @param {object} opts
 * @param {string} [opts.genre='fantasy']
 * @param {string} [opts.classHint='']
 * @param {string} [opts.contextText='']
 * @returns {string}
 */
export function buildContextAwareQuery({ genre = 'fantasy', classHint = '', contextText = '' } = {}) {
    const cleanedContext = cleanContextKeywords(contextText);
    if (!cleanedContext) {
        return buildGenreQuery(genre, classHint);
    }
    const genreWord = (genre || 'fantasy').replace(/_/g, ' ');
    const parts = [genreWord];
    if (classHint) parts.push(classHint);
    parts.push(cleanedContext);
    return parts.join(' ').trim();
}

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
 * Fetches a single random NameRAG candidate for a genre/class and optional context.
 * Falls back to offline pools if unavailable.
 * @param {string} genre
 * @param {string} [classHint]
 * @param {object} [options]
 * @param {number} [options.timeoutMs=4000]
 * @param {string} [options.contextText] Freeform backstory, instructions, or appearance text
 * @param {string} [options.gender] 'M', 'F', or 'Dual'
 * @returns {Promise<{ name: string, vibe?: string, source: string, error?: string }>}
 */
export async function rollNameRagCandidate(genre = 'fantasy', classHint = '', options = {}) {
    const timeoutMs = options.timeoutMs ?? 4000;
    const contextText = options.contextText || '';
    const gender = options.gender || null;
    const query = buildContextAwareQuery({ genre, classHint, contextText });
    let errorOccurred = false;
    let errorMessage = '';

    try {
        const searchOpts = { query, limit: 6 };
        if (gender) searchOpts.gender = gender;

        const searchPromise = searchNames(searchOpts);
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('NameRAG query timed out')), timeoutMs);
        });
        const results = await Promise.race([searchPromise, timeoutPromise]);
        clearTimeout(timeoutHandle);

        if (results && results.length > 0) {
            const picked = results[Math.floor(Math.random() * results.length)];
            return {
                name: picked.name,
                vibe: picked.vibe || picked.meaning || '',
                source: 'namerag',
            };
        }
    } catch (err) {
        errorOccurred = true;
        errorMessage = err?.message || String(err);
        console.warn('[MultiHog Companion] rollNameRagCandidate failed, falling back:', err);
    }

    // Graceful offline fallback
    try {
        const mod = await import('../SillyTavern-MultihogDnDFramework/src/state/character-names.js');
        if (typeof mod?.pickGenreCharacterName === 'function') {
            return {
                name: mod.pickGenreCharacterName(genre),
                source: 'offline_fallback',
                error: errorOccurred ? errorMessage : 'No results from NameRAG',
            };
        }
    } catch (_) {}

    return {
        name: 'Rowan Vance',
        source: 'static_fallback',
        error: errorOccurred ? errorMessage : 'Fallback module unavailable',
    };
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
export async function syncNameRagAdhocSysprompt(enabled, onRefreshOrCtx, maybeCtx = null) {
    const onRefresh = typeof onRefreshOrCtx === 'function' ? onRefreshOrCtx : null;
    const ctx = (onRefreshOrCtx && typeof onRefreshOrCtx === 'object' && !Array.isArray(onRefreshOrCtx))
        ? onRefreshOrCtx
        : (maybeCtx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null));
    const settings = ctx?.extensionSettings?.rpg_tracker;
    if (!settings) return;

    let hasChanged = false;
    settings.customSyspromptLibrary = settings.customSyspromptLibrary || [];
    const existingIndex = settings.customSyspromptLibrary.findIndex((p) => p.id === NAMERAG_SYSPROMPT_ID);

    const promptContent = `<name_generation>
When introducing new named characters, NPCs, merchants, or adversaries:
- If function tools are available, you may invoke \`search_names\` with the character's archetype or vibe (e.g. query: "cynical dwarven fence", limit: 5) to select an authentic, evocative name.
- Avoid repetitive or cliché LLM default names (e.g., Elidor, Silas, Lyra, Vance, Aurelia, Malachi). Select varied names authentic to the culture and setting.
</name_generation>`;

    if (enabled) {
        if (existingIndex >= 0) {
            const item = settings.customSyspromptLibrary[existingIndex];
            if (!item.enabled || item.scope !== 'global' || !item.globalEnabled || item.content !== promptContent) {
                item.enabled = true;
                item.scope = 'global';
                item.globalEnabled = true;
                item.content = promptContent;
                hasChanged = true;
            }
        } else {
            settings.customSyspromptLibrary.push({
                id: NAMERAG_SYSPROMPT_ID,
                tag: 'name_generation',
                title: 'Name Diversity & NameRAG Guidance',
                description: 'Guides the Narrator/GM to avoid repetitive names and use search_names when available',
                content: promptContent,
                enabled: true,
                scope: 'global',
                globalEnabled: true,
                origin: 'companion',
            });
            hasChanged = true;
        }
    } else {
        if (existingIndex >= 0) {
            const item = settings.customSyspromptLibrary[existingIndex];
            if (item.enabled || item.globalEnabled) {
                item.enabled = false;
                item.scope = 'global';
                item.globalEnabled = false;
                hasChanged = true;
            }
        }
    }

    if (Array.isArray(settings.syspromptSnippetDatabase)) {
        const dbIndex = settings.syspromptSnippetDatabase.findIndex((p) => p.id === NAMERAG_SYSPROMPT_ID);
        if (enabled) {
            if (dbIndex >= 0) {
                const item = settings.syspromptSnippetDatabase[dbIndex];
                if (item.scope !== 'global' || !item.globalEnabled || item.content !== promptContent) {
                    item.scope = 'global';
                    item.globalEnabled = true;
                    item.content = promptContent;
                    hasChanged = true;
                }
            } else {
                settings.syspromptSnippetDatabase.push({
                    id: NAMERAG_SYSPROMPT_ID,
                    tag: 'name_generation',
                    title: 'Name Diversity & NameRAG Guidance',
                    description: 'Guides the Narrator/GM to avoid repetitive names and use search_names when available',
                    content: promptContent,
                    scope: 'global',
                    globalEnabled: true,
                    origin: 'companion',
                });
                hasChanged = true;
            }
        } else {
            if (dbIndex >= 0) {
                const item = settings.syspromptSnippetDatabase[dbIndex];
                if (item.globalEnabled) {
                    item.scope = 'global';
                    item.globalEnabled = false;
                    hasChanged = true;
                }
            }
        }
    }

    if (hasChanged) {
        try {
            if (typeof ctx?.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        } catch (_) {}
    }

    if (typeof onRefresh === 'function') {
        await onRefresh();
    }
}

/**
 * Hooks MultiHog's Character Creator, Quick Start, and Onboarding roll buttons
 * to use NameRAG when enabled.
 * @param {() => boolean} isNameRagActive Check function returning whether NameRAG is enabled in Companion settings
 * @param {object} [options]
 * @param {(type: string, message: string, title?: string) => void} [options.showToast] Toast notification helper
 */
export function setupMultiHogRollHooks(isNameRagActive, { showToast } = {}) {
    // 1. Quick Start Roll Name button (#rt-quickstart-roll-name)
    // [CATALOG: DOM-02] [CATALOG: ADR-MP-04] See LISTENERS.md / MONKEYPATCHES.md — Quick Start Roll Name Hijack
    $(document).off('click.mhc_namerag_qs', '#rt-quickstart-roll-name');
    $(document).on('click.mhc_namerag_qs', '#rt-quickstart-roll-name', async function (e) {
        if (!isNameRagActive()) return; // Let MultiHog's native listener handle it
        e.stopImmediatePropagation();
        e.preventDefault();

        const btn = $(this);
        const origHtml = btn.html();
        btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const root = btn.closest('#rt-quickstart, .rt-quickstart, #rpg-tracker-quickstart');
            const activeGenreBtn = root.find('.rt-quickstart-genre-btn.active, .rt-quickstart-genre-btn[aria-pressed="true"]');
            const genre = activeGenreBtn.data('genre') || activeGenreBtn.attr('data-genre') || root.find('#rt-quickstart-genre').val() || 'fantasy';
            const instructions = root.find('#rt-quickstart-instructions').val() || '';
            const gender = detectGenderFromText(instructions);
            const candidate = await rollNameRagCandidate(genre, '', { contextText: instructions, gender });
            const input = root.find('#rt-quickstart-name');
            input.val(candidate.name).trigger('input');
            if (candidate.source !== 'namerag' && typeof showToast === 'function') {
                showToast('warning', 'NameRAG service unavailable; rolled standard name.', 'NameRAG Roll');
            }
        } catch (err) {
            console.error('[MultiHog Companion] Quickstart roll error:', err);
            if (typeof showToast === 'function') {
                showToast('error', `NameRAG error: ${err.message || err}`, 'NameRAG Roll');
            }
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 2. Character Creator Random Name button (#rt-cr-random-name)
    // [CATALOG: DOM-03] [CATALOG: ADR-MP-04] See LISTENERS.md / MONKEYPATCHES.md — Character Creator Roll Name Hijack
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
            const classHint = (panel.find('#rt-cr-class-other').is(':visible') && panel.find('#rt-cr-class-other').val())
                ? panel.find('#rt-cr-class-other').val()
                : (panel.find('#rt-cr-class').val() || '');
            const rawGender = panel.find('#rt-cr-gender').val() || '';
            const gender = normalizeGenderFilter(rawGender) || detectGenderFromText(rawGender);
            const contextText = [
                panel.find('#rt-cr-background').val(),
                panel.find('#rt-cr-appearance').val(),
                panel.find('#rt-cr-traits').val(),
                panel.find('#rt-cr-abilities').val(),
                panel.find('#rt-cr-additional').val(),
            ].filter(Boolean).join(' ');

            const candidate = await rollNameRagCandidate(genre, classHint, { contextText, gender });
            const input = panel.find('#rt-cr-name');
            input.val(candidate.name).trigger('input');
            if (candidate.source !== 'namerag' && typeof showToast === 'function') {
                showToast('warning', 'NameRAG service unavailable; rolled standard name.', 'NameRAG Roll');
            }
        } catch (err) {
            console.error('[MultiHog Companion] Character creator roll error:', err);
            if (typeof showToast === 'function') {
                showToast('error', `NameRAG error: ${err.message || err}`, 'NameRAG Roll');
            }
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 3. Onboarding Roll Name button (#rt-ob-roll-name)
    // [CATALOG: DOM-04] [CATALOG: ADR-MP-04] See LISTENERS.md / MONKEYPATCHES.md — Onboarding Roll Name Hijack
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
            const contextText = container.find('textarea, input[type="text"]:not(#rt-ob-rolled-name):not(#rt-onboarding-name)')
                .map((_, el) => $(el).val()).get().filter(Boolean).join(' ');
            const gender = detectGenderFromText(contextText);

            const candidate = await rollNameRagCandidate(genre, '', { contextText, gender });
            const input = container.find('#rt-ob-rolled-name, #rt-onboarding-name');
            input.val(candidate.name).trigger('input');
            if (candidate.source !== 'namerag' && typeof showToast === 'function') {
                showToast('warning', 'NameRAG service unavailable; rolled standard name.', 'NameRAG Roll');
            }
        } catch (err) {
            console.error('[MultiHog Companion] Onboarding roll error:', err);
            if (typeof showToast === 'function') {
                showToast('error', `NameRAG error: ${err.message || err}`, 'NameRAG Roll');
            }
        } finally {
            btn.prop('disabled', false).html(origHtml);
        }
    });

    // 4. Instant Action Blank Name Interception (#rt-quickstart-begin)
    // [CATALOG: DOM-05] See LISTENERS.md — Instant Action Blank Name Pre-Fill Observer
    $(document).off('click.mhc_namerag_begin', '#rt-quickstart-begin');
    $(document).on('click.mhc_namerag_begin', '#rt-quickstart-begin', async function (e) {
        if (!isNameRagActive()) return;
        const root = $(this).closest('#rt-quickstart, .rt-quickstart, #rpg-tracker-quickstart');
        const nameInput = root.find('#rt-quickstart-name');
        if (nameInput.length && !nameInput.val().trim()) {
            // Field is empty — fetch a NameRAG candidate first so prompt is seeded
            e.stopImmediatePropagation();
            e.preventDefault();
            try {
                const activeGenreBtn = root.find('.rt-quickstart-genre-btn.active, .rt-quickstart-genre-btn[aria-pressed="true"]');
                const genre = activeGenreBtn.data('genre') || activeGenreBtn.attr('data-genre') || root.find('#rt-quickstart-genre').val() || 'fantasy';
                const instructions = root.find('#rt-quickstart-instructions').val() || '';
                const gender = detectGenderFromText(instructions);
                const candidate = await rollNameRagCandidate(genre, '', { contextText: instructions, gender });
                nameInput.val(candidate.name).trigger('input');
                if (candidate.source !== 'namerag' && typeof showToast === 'function') {
                    showToast('warning', 'NameRAG service unavailable; rolled standard name.', 'NameRAG Roll');
                }
            } catch (err) {
                console.error('[MultiHog Companion] Quickstart begin name seed error:', err);
            }
            // Re-trigger click now that name is populated
            $(this).trigger('click');
        }
    });
}
