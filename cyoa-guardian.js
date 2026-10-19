/**
 * MultiHog Companion - CYOA Guardian
 *
 * Automatically monitors narrator responses in both D&D 5e and PbtA adventures.
 * When the LLM drops CYOA choices (due to attention drift or instruction collision
 * with the status footer line), Guardian:
 * 1. Checks if markdown choices were generated without <button> tags and
 *    auto-repairs them into interactive CYOA buttons immediately.
 * 2. If completely omitted, auto-swipes with a high-priority steering reminder
 *    injected into the prompt (capped at max 1 retry to prevent infinite loops).
 * 3. Exposes /cyoaretry and /cyoafix slash commands for manual player control.
 */

import {
    runDecoupledCyoaStage2,
    abortStage2Cyoa,
    isStage2CyoaRunning,
    insertCyoaLoadingIndicator,
    lockSendButtonUI,
} from './cyoa-decoupled-runner.js';
import { isPbtAActive } from './pbta-ruleset-persistence.js';
import { isAdventureActive } from './adventure-chat.js';

let _wasGenerationStopped = false;
let _pendingSteeringReminder = null;
let _retryTracker = { mesId: -1, count: 0 };
let _lastStage2AttemptedMessageId = -1;
let _lastStage2AttemptedSwipeId = -1;

let _getSettings = () => {
    if (typeof SillyTavern !== 'undefined') {
        const ctx = SillyTavern.getContext?.();
        if (ctx?.extensionSettings?.MultiHogCompanion) {
            return ctx.extensionSettings.MultiHogCompanion;
        }
    }
    if (typeof extension_settings !== 'undefined' && extension_settings?.MultiHogCompanion) {
        return extension_settings.MultiHogCompanion;
    }
    return {};
};

/**
 * Checks if the narrator / SillyTavern is currently generating or streaming text.
 * @returns {boolean}
 */
export function isNarratorGenerating() {
    if (typeof document !== 'undefined') {
        const stopBtn = document.querySelector('#mes_stop, .mes_stop');
        if (stopBtn && stopBtn.style.display !== 'none' && stopBtn.offsetParent !== null) {
            return true;
        }
    }
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (typeof ctx?.isGenerating === 'function' && ctx.isGenerating()) {
        return true;
    }
    if (typeof globalThis.is_send_press !== 'undefined' && globalThis.is_send_press) {
        return true;
    }
    return false;
}

/**
 * Strips <CYOA_mode> prompt instructions and historical choice button markup
 * from outgoing chat messages so the Stage 1 narrator generates pure narrative prose.
 *
 * @param {object[]} chat
 * @returns {boolean} True if any message was modified
 */
export function stripCyoaFromOutgoingChat(chat) {
    if (!Array.isArray(chat) || chat.length === 0) return false;
    let didModify = false;

    const cyoaModeXmlPattern = /<CYOA_mode\b[^>]*>[\s\S]*?<\/CYOA_mode\s*>/gi;
    const choiceBlockPattern = /<choices\b[^>]*>[\s\S]*?<\/choices\s*>|<div\b[^>]*\brt-cyoa-choices\b[^>]*>[\s\S]*?<\/div\s*>|<button\b[^>]*>[\s\S]*?<\/button\s*>/gi;

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg) continue;

        if (typeof msg.mes === 'string') {
            let updated = msg.mes;
            if (cyoaModeXmlPattern.test(updated)) {
                updated = updated.replace(cyoaModeXmlPattern, '').trim();
            }
            if (choiceBlockPattern.test(updated)) {
                updated = updated.replace(choiceBlockPattern, '').trim();
            }
            if (updated !== msg.mes) {
                msg.mes = updated;
                didModify = true;
            }
        }

        if (typeof msg.content === 'string') {
            let updated = msg.content;
            if (cyoaModeXmlPattern.test(updated)) {
                updated = updated.replace(cyoaModeXmlPattern, '').trim();
            }
            if (choiceBlockPattern.test(updated)) {
                updated = updated.replace(choiceBlockPattern, '').trim();
            }
            if (updated !== msg.content) {
                msg.content = updated;
                didModify = true;
            }
        }

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    let updated = part.text;
                    if (cyoaModeXmlPattern.test(updated)) {
                        updated = updated.replace(cyoaModeXmlPattern, '').trim();
                    }
                    if (choiceBlockPattern.test(updated)) {
                        updated = updated.replace(choiceBlockPattern, '').trim();
                    }
                    if (updated !== part.text) {
                        part.text = updated;
                        didModify = true;
                    }
                }
            }
        }
    }
    return didModify;
}

/**
 * Checks whether CYOA choices are expected on the current turn.
 * Works for both D&D 5e and PbtA.
 *
 * @param {object} [rpgSettings]
 * @param {boolean} [isPbtaActive=false]
 * @returns {boolean}
 */
export function isCyoaExpected(rpgSettings, isPbtaActive = false) {
    if (!rpgSettings || rpgSettings.enabled === false) return false;

    if (isPbtaActive) {
        // In PbtA, CYOA is active unless playstyle is explicitly freeform
        const playstyle = rpgSettings.cyoaConfig?.playstyle;
        if (playstyle === 'freeform') return false;
        if (rpgSettings.syspromptModules?.CYOA_mode === false) return false;
        return true;
    }

    // In D&D 5e (MultiHog Framework):
    return rpgSettings.syspromptModules?.CYOA_mode === true;
}

/**
 * Checks whether the given text contains valid CYOA choice markup (<button> or <choices>).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasCyoaChoices(text) {
    if (!text || typeof text !== 'string') return false;
    if (/<button[\s>]/i.test(text)) return true;
    if (/<choices[\s>]/i.test(text)) return true;
    if (/class="rt-cyoa-choices"/i.test(text)) return true;
    return false;
}

/**
 * Checks if the message text contains numbered choices in plain text or markdown
 * (e.g. "1. ⚔️ Attack", "* 2. 🏃 Flee") and converts them into <choices><button>...</button></choices>.
 *
 * @param {string} text
 * @returns {string|null} Repaired text, or null if no valid choice list was found.
 */
export function tryRepairMarkdownChoices(text) {
    if (!text || typeof text !== 'string') return null;
    if (hasCyoaChoices(text)) return null;

    const lines = text.split('\n');
    const choiceIndices = [];
    const choicePattern = /^(?:[\*\-]\s*)?(?:\*\*)?(\d+)[\.\)](?:\*\*)?\s+(.+)$/;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (choicePattern.test(trimmed)) {
            choiceIndices.push(i);
        }
    }

    // Require between 2 and 8 numbered choices
    if (choiceIndices.length < 2 || choiceIndices.length > 8) {
        return null;
    }

    const firstIdx = choiceIndices[0];
    const lastIdx = choiceIndices[choiceIndices.length - 1];

    // Choice list must be near the very end of the message.
    // Any non-empty lines following the choices must only be the status footer.
    for (let i = lastIdx + 1; i < lines.length; i++) {
        const trailingLine = lines[i].trim();
        if (!trailingLine) continue;
        const isFooter = /^\s*[\*\_]?\(?(?:Harm|HP|XP|Hold|Location|Spell|Turn|Round|State|Level|Time|Day|HH:MM|\d{1,2}:\d{2})/i.test(trailingLine)
            || /^\s*[\*\_]?\[?(?:Harm|HP|XP|Hold|Location|Time|Day|HH:MM|\d{1,2}:\d{2})/i.test(trailingLine);
        if (!isFooter) {
            return null; // Normal narrative prose follows the list; this was not a choices block
        }
    }

    // All lines between firstIdx and lastIdx must be choices or empty lines
    for (let i = firstIdx; i <= lastIdx; i++) {
        const l = lines[i].trim();
        if (l && !choiceIndices.includes(i)) {
            return null;
        }
    }

    // Check if the immediately preceding line is an optional choices/options header
    let replaceStartIdx = firstIdx;
    if (firstIdx > 0) {
        const cleanPrev = lines[firstIdx - 1].replace(/[\*_:#\-]/g, '').trim();
        if (/^(?:(?:available|next|your)?\s*(?:choices|options|actions)|what do you do\??)$/i.test(cleanPrev)) {
            replaceStartIdx = firstIdx - 1;
        }
    }

    // Wrap each choice line into <button> tags
    const buttonLines = [];
    for (const idx of choiceIndices) {
        const raw = lines[idx].trim();
        const m = raw.match(choicePattern);
        if (m) {
            const num = m[1];
            const content = m[2].trim();
            buttonLines.push(`<button>${num}. ${content}</button>`);
        }
    }

    const choiceBlock = `<choices>\n${buttonLines.join('\n')}\n</choices>`;

    const newLines = [
        ...lines.slice(0, replaceStartIdx),
        choiceBlock,
        ...lines.slice(lastIdx + 1),
    ];

    return newLines.join('\n');
}

/**
 * Arms an ephemeral steering reminder to be injected on the next retry generation.
 *
 * @param {object} opts
 * @param {boolean} opts.isPbta
 * @param {number} [opts.choiceCount=5]
 */
export function armCyoaSteeringReminder({ isPbta = false, choiceCount = 5 }) {
    const example = isPbta
        ? `<choices>\n<button>1. ⚡ Take direct action to address the situation — [Move Name (+Stat)]</button>\n<button>2. 💬 "What's your read on this? Does anything feel off to you?"</button>\n<button>3. 🔍 Scan the surrounding area for anyone watching or listening in</button>\n</choices>`
        : `<choices>\n<button>1. ⚡ Take direct action to engage the target — [Attack (+5) vs AC 14]</button>\n<button>2. 💬 "Hold on. Let's talk before anyone does something reckless." — [Persuasion (+3) DC 12]</button>\n<button>3. 🔍 Scan the surrounding area for hidden threats or escape routes</button>\n</choices>`;

    _pendingSteeringReminder = `\n\n[CRITICAL GM FORMATTING REQUIREMENT]
Your previous response failed because it omitted the required CYOA choice buttons.
You MUST end this response with exactly ${choiceCount} choices wrapped inside a single <choices> XML block, with EVERY choice enclosed in a <button> tag:
${example}
Output sequence: (1) Scene narrative -> (2) <choices> block -> (3) Status footer.
DO NOT omit the <choices><button> block!`;
}

/**
 * Injects the armed CYOA steering reminder into the outgoing chat prompt.
 * Called by mhcGenerationInterceptor.
 *
 * @param {object[]} chat
 * @returns {boolean} True if injected
 */
export function interceptCyoaSteering(chat) {
    if (!_pendingSteeringReminder || !Array.isArray(chat) || chat.length === 0) {
        return false;
    }

    const reminder = _pendingSteeringReminder;
    _pendingSteeringReminder = null;

    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg) continue;
        const role = String(msg.role || '').toLowerCase();
        const isUser = msg.is_user || role === 'user' || role === 'human' || role === 'player';
        if (isUser) {
            if (typeof msg.mes === 'string') {
                msg.mes += reminder;
            } else if (typeof msg.content === 'string') {
                msg.content += reminder;
            } else if (Array.isArray(msg.content)) {
                msg.content.push({ type: 'text', text: reminder });
            }
            console.log('[MultiHog Companion] CYOA Guardian injected steering reminder into user prompt.');
            return true;
        }
    }
    return false;
}

/**
 * Triggers a swipe right to generate a fresh alternative response.
 */
export async function triggerSwipeRight() {
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (typeof ctx?.swipe?.right === 'function') {
            await ctx.swipe.right();
            return true;
        }
        const nextBtn = document.querySelector('#chat .mes:last-child .swipe_right, #chat .mes:last-child .mes_swipe_next');
        if (nextBtn) {
            nextBtn.click();
            return true;
        }
    } catch (err) {
        console.error('[MultiHog Companion] Failed to trigger swipe right:', err);
    }
    return false;
}

/**
 * Applies repaired text to the message and updates SillyTavern DOM and state.
 */
export async function applyRepairedMessage(messageId, repairedText) {
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const chat = ctx?.chat;
        if (!chat || !chat[messageId]) return false;

        chat[messageId].mes = repairedText;
        if (Array.isArray(chat[messageId].swipes) && chat[messageId].swipe_id !== undefined) {
            chat[messageId].swipes[chat[messageId].swipe_id] = repairedText;
        }

        if (typeof ctx.updateMessageBlock === 'function') {
            ctx.updateMessageBlock(messageId, chat[messageId]);
        } else {
            const mesTextEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
            if (mesTextEl && typeof ctx.messageFormatting === 'function') {
                mesTextEl.innerHTML = ctx.messageFormatting(repairedText, chat[messageId].name, chat[messageId].is_system, chat[messageId].is_user);
            }
        }

        if (typeof ctx.saveChat === 'function') {
            ctx.saveChat();
        } else if (typeof ctx.saveChatDebounced === 'function') {
            ctx.saveChatDebounced();
        } else if (typeof globalThis.saveChatConditional === 'function') {
            globalThis.saveChatConditional();
        } else if (typeof globalThis.saveChatDebounced === 'function') {
            globalThis.saveChatDebounced();
        }

        // Trigger MultiHog's DOM binder to immediately style and bind the buttons
        if (typeof globalThis._rpgFinalizeCyoaNarratorRender === 'function') {
            globalThis._rpgFinalizeCyoaNarratorRender();
        }
        return true;
    } catch (err) {
        console.error('[MultiHog Companion] Failed to apply repaired message:', err);
        return false;
    }
}

/**
 * Unified dispatcher for Decoupled Stage 2 CYOA generation.
 * Handles deduplication and streaming synchronization between CHARACTER_MESSAGE_RENDERED and GENERATION_ENDED.
 *
 * @param {object} params
 * @param {number} [params.messageId=-1]
 * @param {string} [params.triggerSource='unknown']
 * @param {() => object} params.getSettings
 * @param {() => boolean} params.isPbtaActive
 * @param {(type: string, message: string, title?: string) => void} [params.showToast]
 * @returns {Promise<boolean>}
 */
export async function triggerDecoupledCyoaForMessage({
    messageId = -1,
    triggerSource = 'unknown',
    getSettings,
    isPbtaActive,
    showToast,
    force = false,
} = {}) {
    if (_wasGenerationStopped) {
        if (force) {
            _wasGenerationStopped = false;
        } else {
            return false;
        }
    }
    const resolvedGetSettings = typeof getSettings === 'function' ? getSettings : _getSettings;
    const s = typeof resolvedGetSettings === 'function' ? resolvedGetSettings() : {};
    if (!force && s.enableDecoupledCyoa === false) return false;

    // If triggered by message rendering while narrator is still actively streaming,
    // defer execution to GENERATION_ENDED when narrative prose is complete.
    if (triggerSource === 'CHARACTER_MESSAGE_RENDERED' && isNarratorGenerating()) {
        return false;
    }

    if (isStage2CyoaRunning()) {
        lockSendButtonUI();
        if (messageId >= 0) insertCyoaLoadingIndicator(messageId);
        return false;
    }

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return false;

    const idx = messageId >= 0 ? messageId : chat.length - 1;
    // Never trigger Stage 2 CYOA on Message 0 (greeting) or unstarted/clean chats
    if (idx < 0 || (!force && (idx === 0 || !isAdventureActive()))) return false;

    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system) return false;

    const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
    const pbtaActive = typeof isPbtaActive === 'function' ? isPbtaActive() : false;

    if (!force && !isCyoaExpected(rpgSettings, pbtaActive)) return false;
    if (!force && hasCyoaChoices(msg.mes)) return false;

    const currentSwipeId = msg.swipe_id ?? 0;
    if (!force && _lastStage2AttemptedMessageId === idx && _lastStage2AttemptedSwipeId === currentSwipeId) {
        return false;
    }

    _lastStage2AttemptedMessageId = idx;
    _lastStage2AttemptedSwipeId = currentSwipeId;

    console.log(`[MultiHog Companion] Triggering Decoupled CYOA Stage 2 via ${triggerSource} for message:`, idx);

    try {
        const text = String(msg.mes || '');
        const ok = await runDecoupledCyoaStage2({
            messageId: idx,
            narrative: text,
            isPbta: pbtaActive,
            rpgSettings: {
                ...rpgSettings,
                cyoaMaxTokens: s?.cyoaMaxTokens || rpgSettings?.cyoaMaxTokens,
                enableFastPipeline: s?.enableFastPipeline !== false && rpgSettings?.enableFastPipeline !== false,
            },
            showToast,
        });
        if (!ok) {
            _lastStage2AttemptedMessageId = -1;
            _lastStage2AttemptedSwipeId = -1;
        }
        return ok;
    } catch (err) {
        _lastStage2AttemptedMessageId = -1;
        _lastStage2AttemptedSwipeId = -1;
        console.error('[MultiHog Companion] Decoupled CYOA Stage 2 error:', err);
        return false;
    }
}

/**
 * Registers CYOA Guardian event hooks.
 *
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {() => boolean} deps.isPbtaActive
 * @param {(type: string, message: string, title?: string) => void} deps.showToast
 */
export function initCyoaGuardian({ getSettings, isPbtaActive, showToast, eventSource: esParam, event_types: etParam }) {
    if (typeof getSettings === 'function') {
        _getSettings = getSettings;
    }
    const es = esParam || (typeof eventSource !== 'undefined' ? eventSource : null) || (typeof window !== 'undefined' ? window.eventSource : null) || globalThis.eventSource;
    const et = etParam || (typeof event_types !== 'undefined' ? event_types : null) || (typeof window !== 'undefined' ? window.event_types : null) || globalThis.event_types;
    if (!es || !et) return;

    // [CATALOG: EVT-09] See LISTENERS.md — CYOA Stage 2 Abort Guard (GENERATION_STARTED)
    if (et.GENERATION_STARTED) {
        es.on(et.GENERATION_STARTED, (...args) => {
            const dryRun = args.length ? args[args.length - 1] : false;
            if (dryRun === true) {
                return;
            }
            _wasGenerationStopped = false;
            _lastStage2AttemptedMessageId = -1;
            _lastStage2AttemptedSwipeId = -1;
            // Abort any in-flight Stage 2 pass when a new live generation starts (especially swipes)
            abortStage2Cyoa('new_generation_started');
        });
    }

    // [CATALOG: EVT-10] See LISTENERS.md — CYOA Stop Button Guard (GENERATION_STOPPED)
    if (et.GENERATION_STOPPED) {
        es.on(et.GENERATION_STOPPED, () => {
            _wasGenerationStopped = true;
            _pendingSteeringReminder = null;
            abortStage2Cyoa('generation_stopped');
        });
    }

    // [CATALOG: EVT-05] See LISTENERS.md — CYOA Chat Change State Reset (CHAT_CHANGED)
    if (et.CHAT_CHANGED) {
        es.on(et.CHAT_CHANGED, () => {
            _retryTracker = { mesId: -1, count: 0 };
            _pendingSteeringReminder = null;
            _lastStage2AttemptedMessageId = -1;
            _lastStage2AttemptedSwipeId = -1;
            abortStage2Cyoa('chat_changed');
        });
    }

    // [CATALOG: DOM-06] See LISTENERS.md — Native Capture Phase Click Interceptor for Stop Buttons
    if (typeof document !== 'undefined') {
        const handleStopClick = () => {
            if (isStage2CyoaRunning()) {
                console.log('[MultiHog Companion] User clicked Stop. Aborting Decoupled CYOA.');
                abortStage2Cyoa('user_stop_clicked');
            }
        };
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && (target.closest?.('.mes_stop, #mes_stop, .rt-cyoa-cancel-btn') || target.classList?.contains('mes_stop') || target.classList?.contains('rt-cyoa-cancel-btn'))) {
                handleStopClick();
            }
        }, true);
    }

    // [CATALOG: EVT-12] See LISTENERS.md — CYOA Prompt Sanitizer (CHAT_COMPLETION_PROMPT_READY)
    if (et.CHAT_COMPLETION_PROMPT_READY) {
        es.on(et.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
            const s = getSettings();
            if (s.enableDecoupledCyoa !== false && Array.isArray(eventData?.chat)) {
                stripCyoaFromOutgoingChat(eventData.chat);
            }
        });
    }

    // [CATALOG: EVT-06] See LISTENERS.md — Decoupled CYOA Stage 2 Dispatcher (CHARACTER_MESSAGE_RENDERED)
    if (et.CHARACTER_MESSAGE_RENDERED) {
        es.on(et.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            void triggerDecoupledCyoaForMessage({
                messageId,
                triggerSource: 'CHARACTER_MESSAGE_RENDERED',
                getSettings,
                isPbtaActive,
                showToast,
            });
        });
    }

    // [CATALOG: EVT-11] See LISTENERS.md — Decoupled CYOA Stage 2 Completion Trigger (GENERATION_ENDED)
    if (et.GENERATION_ENDED) {
        es.on(et.GENERATION_ENDED, async () => {
            await triggerDecoupledCyoaForMessage({
                triggerSource: 'GENERATION_ENDED',
                getSettings,
                isPbtaActive,
                showToast,
            });
        });
    }
}

/**
 * Regenerates CYOA choices for a given message using Stage 2 without touching the narrative prose.
 * Supports both options object { messageId, isPbtaActive, showToast } and positional arguments (messageId, isPbtaActive, showToast).
 *
 * @param {object|number} [optsOrMessageId={}]
 * @param {boolean|Function} [maybeIsPbta]
 * @param {Function} [maybeShowToast]
 * @returns {Promise<boolean>}
 */
export async function regenerateCyoaChoicesForMessage(optsOrMessageId = {}, maybeIsPbta, maybeShowToast) {
    let messageId = -1;
    let isPbtaActive = maybeIsPbta;
    let showToast = maybeShowToast;
    let customGetSettings = null;

    if (typeof optsOrMessageId === 'number') {
        messageId = optsOrMessageId;
    } else if (optsOrMessageId && typeof optsOrMessageId === 'object') {
        messageId = optsOrMessageId.messageId ?? -1;
        if (optsOrMessageId.isPbtaActive !== undefined) isPbtaActive = optsOrMessageId.isPbtaActive;
        if (optsOrMessageId.showToast !== undefined) showToast = optsOrMessageId.showToast;
        if (typeof optsOrMessageId.getSettings === 'function') customGetSettings = optsOrMessageId.getSettings;
    }

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        if (showToast) showToast('warning', 'No messages in chat to regenerate choices.', 'CYOA Engine');
        return false;
    }

    const idx = messageId >= 0 ? messageId : chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system) {
        if (showToast) showToast('warning', 'Target message is not a narrator message.', 'CYOA Engine');
        return false;
    }

    const pbtaActive = typeof isPbtaActive === 'function'
        ? isPbtaActive()
        : (isPbtaActive !== undefined ? Boolean(isPbtaActive) : (typeof isPbtAActive === 'function' ? isPbtAActive() : false));

    // Reset loop guard so manual re-roll on the same message is permitted
    _lastStage2AttemptedMessageId = -1;
    _lastStage2AttemptedSwipeId = -1;

    // Strip any existing choices from this message before re-rolling
    const cleanNarrative = String(msg.mes || '')
        .replace(/<choices\b[^>]*>[\s\S]*?<\/choices\s*>/gi, '')
        .replace(/<div\b[^>]*\b(?:rt-cyoa-choices|mhc-cyoa-loading-badge)\b[^>]*>[\s\S]*?<\/div\s*>/gi, '')
        .trim();

    msg.mes = cleanNarrative;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) {
        msg.swipes[msg.swipe_id] = cleanNarrative;
    }

    if (showToast) showToast('info', 'Formulating fresh choices... 🎲', 'CYOA Engine');

    // Route through the decoupled Stage 2 coordinator
    return await triggerDecoupledCyoaForMessage({
        messageId: idx,
        triggerSource: 'SLASH_COMMAND',
        getSettings: customGetSettings || _getSettings,
        isPbtaActive: () => pbtaActive,
        showToast,
        force: true,
    });
}

/**
 * Repairs existing plain-text markdown choices into buttons, or generates
 * fresh choices via Stage 2 if no choices exist at all.
 * Supports both options object { messageId, isPbtaActive, showToast } and positional arguments (messageId, isPbtaActive, showToast).
 *
 * @param {object|number} [optsOrMessageId={}]
 * @param {boolean|Function} [maybeIsPbta]
 * @param {Function} [maybeShowToast]
 * @returns {Promise<boolean>}
 */
export async function repairOrGenerateChoicesForMessage(optsOrMessageId = {}, maybeIsPbta, maybeShowToast) {
    let messageId = -1;
    let isPbtaActive = maybeIsPbta;
    let showToast = maybeShowToast;
    let customGetSettings = null;

    if (typeof optsOrMessageId === 'number') {
        messageId = optsOrMessageId;
    } else if (optsOrMessageId && typeof optsOrMessageId === 'object') {
        messageId = optsOrMessageId.messageId ?? -1;
        if (optsOrMessageId.isPbtaActive !== undefined) isPbtaActive = optsOrMessageId.isPbtaActive;
        if (optsOrMessageId.showToast !== undefined) showToast = optsOrMessageId.showToast;
        if (typeof optsOrMessageId.getSettings === 'function') customGetSettings = optsOrMessageId.getSettings;
    }

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        if (showToast) showToast('warning', 'No messages in chat to repair.', 'CYOA Engine');
        return false;
    }

    const idx = messageId >= 0 ? messageId : chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system) {
        if (showToast) showToast('warning', 'Target message is not from narrator.', 'CYOA Engine');
        return false;
    }

    // 1. If plain markdown choices exist, wrap them instantly
    const repaired = tryRepairMarkdownChoices(msg.mes);
    if (repaired) {
        const ok = await applyRepairedMessage(idx, repaired);
        if (ok && showToast) {
            showToast('success', 'Converted markdown choices into CYOA buttons! 🧭', 'CYOA Engine');
        }
        return ok;
    }

    // 2. If no choices exist at all, trigger Stage 2 to generate them!
    return await regenerateCyoaChoicesForMessage({
        messageId: idx,
        isPbtaActive,
        showToast,
        getSettings: customGetSettings || _getSettings,
    });
}

/**
 * Registers CYOA slash commands (/cyoagen, /cyoafix, /cyoaretry).
 */
export function registerCyoaSlashCommands(SlashCommandParser, SlashCommand, { getSettings, isPbtaActive, showToast } = {}) {
    if (typeof getSettings === 'function') {
        _getSettings = getSettings;
    }
    if (!SlashCommandParser?.addCommandObject || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoagen',
        callback: async () => {
            const ok = await regenerateCyoaChoicesForMessage({ isPbtaActive, showToast, getSettings: _getSettings });
            return ok ? 'Regenerated CYOA choices.' : 'Failed to regenerate CYOA choices.';
        },
        helpString: '<div>Formulates fresh CYOA choices for the latest narrator turn without touching the story prose.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoaretry',
        callback: async () => {
            // Backward-compatible alias for /cyoagen
            const ok = await regenerateCyoaChoicesForMessage({ isPbtaActive, showToast, getSettings: _getSettings });
            return ok ? 'Regenerated CYOA choices.' : 'Failed to regenerate CYOA choices.';
        },
        helpString: '<div>Alias for /cyoagen. Re-rolls CYOA choices for the latest narrator turn.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoafix',
        callback: async () => {
            const ok = await repairOrGenerateChoicesForMessage({ isPbtaActive, showToast, getSettings: _getSettings });
            return ok ? 'Successfully repaired/generated CYOA choices.' : 'Could not repair/generate CYOA choices.';
        },
        helpString: '<div>Converts plain-text numbered choices into buttons, or generates them via Stage 2 if missing.</div>',
    }));
}
