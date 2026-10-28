/**
 * MultiHog Companion — Smart Aspect-Ratio & Crop Bridge
 *
 * Intercepts SillyTavern's /imagine slash command to dynamically inject
 * 16:9 widescreen dimensions for scene and location generation while preserving
 * 1:1 square dimensions for character/NPC portraits.
 *
 * Bridges upstream MultiHog DnD Framework location rerolls ("Set Location Image" modal)
 * to ensure manual rerolls are consistently detected as widescreen scenes regardless
 * of whether the LLM prompt includes explicit "wide shot" keywords.
 */

let _activeLocationReroll = null;

/**
 * Mark a location reroll as actively pending (e.g. from the "Set Location Image" modal).
 * @param {string} [path] Normalized location path or name.
 * @param {number} [ttlMs] Expiration TTL in milliseconds. Defaults to 3 minutes.
 */
export function markLocationRerollActive(path = '', ttlMs = 180000) {
    _activeLocationReroll = {
        path: String(path || '').trim(),
        expiresAt: Date.now() + ttlMs,
    };
}

/**
 * Clear any active location reroll state.
 */
export function clearActiveLocationReroll() {
    _activeLocationReroll = null;
}

/**
 * Check if a location reroll is currently active/pending.
 * @returns {boolean}
 */
export function isLocationRerollActive() {
    if (_activeLocationReroll) {
        if (Date.now() < _activeLocationReroll.expiresAt) {
            return true;
        }
        _activeLocationReroll = null;
    }
    return false;
}

/**
 * Inspect active DOM modals to see if a location image settings or preview modal is open.
 * @returns {boolean}
 */
export function isLocationPopupVisible() {
    if (typeof document === 'undefined') return false;
    const popups = document.querySelectorAll('.popup, .popup-content, .generic-popup');
    for (const p of popups) {
        const text = p.textContent || '';
        if (text.includes('Set Location Image')) return true;
        if (_activeLocationReroll?.path && text.includes(_activeLocationReroll.path)) return true;
    }
    return false;
}

/**
 * Resolve the current campaign active location name from the live memo or active reroll state.
 * @param {object} [ctx] SillyTavern context.
 * @returns {string}
 */
export function getActiveCampaignLocation(ctx = null) {
    try {
        if (_activeLocationReroll?.path) {
            return _activeLocationReroll.path;
        }
        const context = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
        const memo = context?.extensionSettings?.rpg_tracker?.currentMemo || '';
        if (memo) {
            const blockMatch = memo.match(/\[LOCATION\]\s*\n\s*([^\n\]]+)/i);
            if (blockMatch && blockMatch[1]) return blockMatch[1].trim();
            const inlineMatch = memo.match(/\(?Location:\s*([^)\n*]+)/i);
            if (inlineMatch && inlineMatch[1]) return inlineMatch[1].trim();
        }
    } catch {
        // Safe fallback
    }
    return '';
}

/**
 * Determine whether an /imagine image generation prompt corresponds to a location scene
 * (widescreen 16:9) versus a character/NPC portrait (1:1 square).
 * @param {string} promptText The generation prompt text.
 * @param {object} [ctx] SillyTavern context.
 * @returns {boolean}
 */
export function isSceneGenerationRequest(promptText = '', ctx = null) {
    // 1. Explicit reroll state: User recently clicked "AI Generate" or "Regenerate" on a location modal
    if (isLocationRerollActive()) {
        return true;
    }

    // 2. DOM inspection: A "Set Location Image" modal or matching preview is currently open
    if (isLocationPopupVisible()) {
        return true;
    }

    // 3. Campaign location match: Does the prompt text contain the active location's name or leaf?
    const activeLoc = getActiveCampaignLocation(ctx);
    if (activeLoc && activeLoc.length > 2) {
        const cleanPrompt = String(promptText || '').toLowerCase();
        const leaf = activeLoc.split(' :: ').pop().trim().toLowerCase();
        if (leaf.length > 2 && (cleanPrompt.includes(leaf) || cleanPrompt.includes(activeLoc.toLowerCase()))) {
            return true;
        }
    }

    // 4. Prompt heuristic keywords (standard scenes, landscapes, establishing and wide shots)
    return /wide shot|cinematic wide|landscape|establishing shot|scenery|panoramic|exterior scene|interior scene/i.test(promptText);
}

/**
 * Handle user clicks on location modal action buttons (DOM-10 delegation).
 * @param {HTMLElement} el The clicked element.
 */
export function handleLocationRerollClick(el) {
    try {
        if (!el || typeof $ === 'undefined') return;
        const $el = $(el);
        const btnText = ($el.text() || '').trim();
        const popup = $el.closest('.popup, .popup-content, .generic-popup, .dialog, [id*="popup"]');
        if (!popup.length) return;

        // Check if clicking "AI Generate" within "Set Location Image" modal
        const isSetLocDialog = popup.find('b:contains("Set Location Image")').length > 0 || popup.find('[id*="rt-loc-image"]').length > 0;
        if (isSetLocDialog && /ai generate/i.test(btnText)) {
            const subtitleEl = popup.find('b:contains("Set Location Image")').siblings('div').first();
            const locPath = subtitleEl.text().trim() || popup.find('div[style*="font-size:0.78em"]').first().text().trim();
            markLocationRerollActive(locPath || 'active_location');
            return;
        }

        // Check if clicking "Regenerate" within a Generated Portrait preview modal for a location
        if (/regenerate/i.test(btnText)) {
            const header = popup.find('b').text() || '';
            if (header.includes('Generated Portrait') || header.includes('AI Portrait Prompt')) {
                const entity = header.replace(/^.*?[-—]\s*/, '').trim();
                if (entity && (_activeLocationReroll?.path === entity || entity.includes('::') || isLocationRerollActive())) {
                    markLocationRerollActive(entity || _activeLocationReroll?.path);
                }
            }
        }
    } catch (err) {
        console.debug('[MultiHog Companion] Error in DOM-10 location reroll click handler:', err);
    }
}

/**
 * Wraps SlashCommandParser.commands['imagine'].callback to dynamically inject
 * resolutions into MultiHog requests.
 * @param {object} imagineCmd The imagine slash command definition.
 * @param {Function} getSettings Getter for companion settings.
 * @param {object} [ctx] SillyTavern context.
 */
export function wrapImagineCommand(imagineCmd, getSettings, ctx = null) {
    // [CATALOG: ADR-MP-02] See MONKEYPATCHES.md — /imagine Slash Command Callback Wrapping
    const originalCallback = imagineCmd.callback;

    imagineCmd.callback = async function (args, trigger) {
        const settings = typeof getSettings === 'function' ? getSettings() : {};

        if (settings.enableAspectRatioBridge !== false) {
            // MultiHog's signature: quiet=true, gallery=false, extend=false
            const isQuiet = String(args?.quiet).toLowerCase() === 'true';
            const isNoGallery = String(args?.gallery).toLowerCase() === 'false';
            const isNoExtend = String(args?.extend).toLowerCase() === 'false';
            const isMultiHog = isQuiet && isNoGallery && isNoExtend;

            // Intervene only if MultiHog didn't provide width/height
            if (isMultiHog && args.width === undefined && args.height === undefined) {
                const promptText = String(trigger || args?._unnamed || '');
                const isScene = isSceneGenerationRequest(promptText, ctx);

                if (isScene) {
                    // 16:9 widescreen for scenes (matches ~512x512 pixel budget to prevent VRAM spill)
                    args.width = Number(settings.sceneWidth) || 672;
                    args.height = Number(settings.sceneHeight) || 384;
                    console.log(`[MultiHog Companion] Smart Aspect-Ratio Bridge: Injected wide scene dimensions (${args.width}x${args.height}).`);
                } else {
                    // 1:1 square for character/NPC portraits
                    args.width = Number(settings.portraitWidth) || 512;
                    args.height = Number(settings.portraitHeight) || 512;
                    console.log(`[MultiHog Companion] Smart Aspect-Ratio Bridge: Injected square portrait dimensions (${args.width}x${args.height}).`);
                }
            }
        }

        return await originalCallback(args, trigger);
    };
}
