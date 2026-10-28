/**
 * MultiHog Companion — Smart Aspect-Ratio & Crop Bridge
 *
 * Intercepts SillyTavern's /imagine slash command to dynamically inject
 * 16:9 widescreen dimensions for scene and location generation while preserving
 * 1:1 square dimensions for character/NPC portraits.
 *
 * Bridges upstream MultiHog DnD Framework location rerolls ("Set Location Image" modal)
 * and automated background location generations to ensure locations are consistently
 * detected as widescreen scenes regardless of whether the LLM prompt includes
 * explicit "wide shot" keywords.
 *
 * Implements a strict sequential FIFO mutex queue for /imagine executions to prevent
 * SillyTavern core's in-memory extension_settings.sd mutation from causing cross-talk
 * or settings inversion across concurrent generations. Also discards pending jobs on
 * rapid chat switches.
 */

let _activeLocationReroll = null;
let _imagineQueue = Promise.resolve();
let _activeChatId = null;

/**
 * Set the currently active chat ID for the /imagine queue.
 * @param {string|null} chatId
 */
export function setActiveImagineChatId(chatId) {
    _activeChatId = chatId ? String(chatId) : null;
}

/**
 * Get the currently tracked active chat ID for the /imagine queue.
 * @returns {string|null}
 */
export function getActiveImagineChatId() {
    return _activeChatId;
}

/**
 * Reset the sequential /imagine execution queue (useful for testing and teardown).
 */
export function resetImagineQueue() {
    _imagineQueue = Promise.resolve();
}

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
 * Resolve the current campaign active location name from:
 * 1. Active reroll state (modal click)
 * 2. Recent chat message status footers (D&D 5e / standard MultiHog format)
 * 3. Live RPG tracker memo ([LOCATION] block or Location: line)
 *
 * @param {object} [ctx] SillyTavern context.
 * @returns {string}
 */
export function getActiveCampaignLocation(ctx = null) {
    try {
        if (_activeLocationReroll?.path) {
            return _activeLocationReroll.path;
        }
        const context = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

        // 1. Check recent chat message footers (mirrors MultiHog's getCurrentLocationText)
        if (context?.chat && Array.isArray(context.chat) && context.chat.length > 0) {
            for (let i = context.chat.length - 1; i >= 0 && i >= context.chat.length - 15; i--) {
                const msgContent = context.chat[i]?.mes || context.chat[i]?.['content'] || '';
                if (!msgContent) continue;
                // Matches (Location: ...), *(Location: ...)*, *Location: ...*, etc.
                const m = msgContent.match(/\(?\*?Location:\s*([^*)\n]+)\*?\)?/i);
                if (m && m[1]?.trim()) {
                    return m[1].trim();
                }
            }
        }

        // 2. Check RPG tracker live memo
        const memo = context?.extensionSettings?.rpg_tracker?.currentMemo || '';
        if (memo) {
            const blockMatch = memo.match(/\[LOCATION\]\s*\n\s*([^\n\]]+)/i);
            if (blockMatch && blockMatch[1]) return blockMatch[1].trim();
            const inlineMatch = memo.match(/\(?\*?Location:\s*([^*)\n]+)\*?\)?/i);
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
    return /wide shot|cinematic wide|landscape|establishing shot|scenery|panoramic|exterior scene|interior scene|room interior|building exterior|architecture|street view|dungeon corridor|dungeon room|aerial view|environmental shot/i.test(promptText);
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
 * resolutions into MultiHog requests and enforce sequential execution via a mutex queue.
 * @param {object} imagineCmd The imagine slash command definition.
 * @param {Function} getSettings Getter for companion settings.
 * @param {object} [ctx] SillyTavern context.
 */
export function wrapImagineCommand(imagineCmd, getSettings, ctx = null) {
    // [CATALOG: ADR-MP-02] See MONKEYPATCHES.md — /imagine Slash Command Callback Wrapping
    const originalCallback = imagineCmd.callback;

    imagineCmd.callback = async function (args, trigger) {
        const settings = typeof getSettings === 'function' ? getSettings() : {};
        const context = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
        const jobChatId = context?.chatId ? String(context.chatId) : _activeChatId;

        if (settings.enableAspectRatioBridge !== false) {
            // MultiHog's signature: quiet=true, gallery=false, extend=false
            const isQuiet = String(args?.quiet).toLowerCase() === 'true';
            const isNoGallery = String(args?.gallery).toLowerCase() === 'false';
            const isNoExtend = String(args?.extend).toLowerCase() === 'false';
            const isMultiHog = isQuiet && isNoGallery && isNoExtend;

            // Intervene only if MultiHog didn't provide width/height
            if (isMultiHog && args.width === undefined && args.height === undefined) {
                const promptText = String(trigger || args?._unnamed || '');
                const isScene = isSceneGenerationRequest(promptText, context);

                if (isScene) {
                    // Widescreen dimensions for scenes
                    args.width = Number(settings.sceneWidth) || 672;
                    args.height = Number(settings.sceneHeight) || 384;
                    // Prevent ST core setTypeSpecificDimensions from applying 1.5x face height multiplier
                    args.faces = false;
                    console.log(`[MultiHog Companion] Smart Aspect-Ratio Bridge: Injected wide scene dimensions (${args.width}x${args.height}).`);
                } else {
                    // Portrait dimensions for character/NPC portraits
                    args.width = Number(settings.portraitWidth) || 512;
                    args.height = Number(settings.portraitHeight) || 512;
                    console.log(`[MultiHog Companion] Smart Aspect-Ratio Bridge: Injected portrait dimensions (${args.width}x${args.height}).`);
                }
            }
        }

        // Sequential Mutex Execution:
        // SillyTavern's /imagine mutates global extension_settings.sd in-memory and restores it on completion.
        // We serialize calls through _imagineQueue so concurrent requests never poison shared settings.
        const executeJob = async () => {
            const currentChatId = context?.chatId ? String(context.chatId) : _activeChatId;
            if (jobChatId && currentChatId && jobChatId !== currentChatId) {
                console.log(`[MultiHog Companion] Smart Aspect-Ratio Bridge: Discarding queued /imagine for stale chat ${jobChatId} (active: ${currentChatId})`);
                return '';
            }
            return await originalCallback(args, trigger);
        };

        const jobPromise = _imagineQueue.then(executeJob, executeJob);
        _imagineQueue = jobPromise.catch(() => {});
        return await jobPromise;
    };
}
