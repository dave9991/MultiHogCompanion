/**
 * cyoa-safety-net.js — MultiHog Companion
 *
 * Dedicated Safety Net and Lifecycle Coordinator for CYOA Choice Buttons.
 *
 * Execution Model:
 * 1. Single-Stage by Default: Outgoing prompt retains active turn <CYOA_mode> so
 *    the narrator generates story and choices together in one pass.
 * 2. Prompt Hygiene: Strips historical choice buttons and markdown choice lists
 *    from older turns so context remains clean and focused.
 * 3. Intelligent Safety Net:
 *    a. If narrator generates valid interactive buttons -> Complete (no-op).
 *    b. If narrator generates plain numbered markdown -> Fast local regex auto-repair (0 extra latency/calls).
 *    c. If choices are dropped or character is downed -> Triggers standalone cyoa-generator.
 * 4. Manual Control: Exposes /cyoagen, /cyoafix, and /cyoaretry slash commands.
 */

import {
    generateCyoaChoices,
    abortCyoaGeneration,
    isCyoaGenerating,
    insertCyoaLoadingIndicator,
    lockSendButtonUI,
    isProtagonistDowned,
} from './cyoa-generator.js';
import { isPbtAActive } from './pbta-ruleset-persistence.js';
import { isAdventureActive } from './adventure-chat.js';

let _wasGenerationStopped = false;
let _lastAttemptedMessageId = -1;
let _lastAttemptedSwipeId = -1;

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
        if (typeof $ !== 'undefined') {
            try {
                if ($('#mes_stop, .mes_stop').is(':visible')) {
                    return true;
                }
            } catch (_) {}
        }
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
 * from outgoing chat messages so context remains clean.
 *
 * In Safety Net mode (default), preserves the active user turn's CYOA instructions
 * so the narrator produces single-stage choices directly.
 *
 * @param {object[]} chat
 * @param {object} [options={}]
 * @param {boolean} [options.stripActiveCyoa=false]
 * @returns {boolean} True if any message was modified
 */
export function stripCyoaFromOutgoingChat(chat, options = {}) {
    if (!Array.isArray(chat) || chat.length === 0) return false;
    let didModify = false;

    const stripActiveCyoa = options.stripActiveCyoa === true;
    const cyoaModeXmlPattern = /<CYOA_mode\b[^>]*>[\s\S]*?<\/CYOA_mode\s*>/gi;
    const choiceBlockPattern = /<choices\b[^>]*>[\s\S]*?<\/choices\s*>|<div\b[^>]*\brt-cyoa-choices\b[^>]*>[\s\S]*?<\/div\s*>|<button\b[^>]*>[\s\S]*?<\/button\s*>/gi;
    const historicalMarkdownChoicesPattern = /\n*\*{0,2}What (?:does [^\n*?]+|do you) do\?\*{0,2}\s*(?:\n+\s*(?:[1-5]\.|\(\d+\)|[-*•])\s+[^\n]+)+(?=\s*(?:\n\s*\*(?:Status|Harm|HP|XP|Hold|Location|Time|Day|Level|\([A-Za-z]+:)|\n\s*<choices|$))/gi;
    const historicalStandalonePromptPattern = /\n*\*{0,2}What (?:does [^\n*?]+|do you) do\?\*{0,2}\s*(?=\s*(?:\n\s*[\*\_]?\(?(?:Status|Harm|HP|XP|Hold|Location|Time|Day|Level|\([A-Za-z]+:)|\n\s*<choices|$))/gi;

    // Find the active user message index matching MultiHog's backwards lookup.
    let activeUserIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m) continue;
        const role = String(m.role || m.Role || '').toLowerCase().trim();
        if (m.is_user || role === 'user' || role === 'human' || role === 'player') {
            activeUserIdx = i;
            break;
        }
    }
    if (activeUserIdx === -1) {
        for (let i = chat.length - 1; i >= 0; i--) {
            const role = String(chat[i]?.role || chat[i]?.Role || '').toLowerCase().trim();
            if (role && role !== 'system' && role !== 'assistant' && role !== 'ai' && role !== 'model') {
                activeUserIdx = i;
                break;
            }
        }
    }
    if (activeUserIdx === -1 && chat.length > 0) {
        activeUserIdx = chat.length - 1;
    }

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentTurn = (i >= activeUserIdx);
        const shouldStripCyoaMode = stripActiveCyoa || !isCurrentTurn;

        const cleanString = (str) => {
            if (typeof str !== 'string') return str;
            let updated = str;
            if (shouldStripCyoaMode && cyoaModeXmlPattern.test(updated)) {
                cyoaModeXmlPattern.lastIndex = 0;
                updated = updated.replace(cyoaModeXmlPattern, '').trim();
            }
            if (shouldStripCyoaMode && choiceBlockPattern.test(updated)) {
                choiceBlockPattern.lastIndex = 0;
                updated = updated.replace(choiceBlockPattern, '').trim();
            }
            if (!isCurrentTurn && historicalMarkdownChoicesPattern.test(updated)) {
                historicalMarkdownChoicesPattern.lastIndex = 0;
                updated = updated.replace(historicalMarkdownChoicesPattern, '').trim();
            }
            if (!isCurrentTurn && historicalStandalonePromptPattern.test(updated)) {
                historicalStandalonePromptPattern.lastIndex = 0;
                updated = updated.replace(historicalStandalonePromptPattern, '').trim();
            }
            return updated;
        };

        if (typeof msg.mes === 'string') {
            const updated = cleanString(msg.mes);
            if (updated !== msg.mes) {
                msg.mes = updated;
                didModify = true;
            }
        }

        if (typeof msg.content === 'string') {
            const updated = cleanString(msg.content);
            if (updated !== msg.content) {
                msg.content = updated;
                didModify = true;
            }
        }

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    const updated = cleanString(part.text);
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
        const playstyle = rpgSettings.cyoaConfig?.playstyle;
        if (playstyle === 'freeform') return false;
        if (rpgSettings.syspromptModules?.CYOA_mode === false) return false;
        return true;
    }

    // In D&D 5e (MultiHog Framework):
    return rpgSettings.syspromptModules?.CYOA_mode === true;
}

/**
 * Checks whether the text contains a pending level-up announcement or choice prompt
 * that protocol requires to pause for user input without generating story choices.
 *
 * Catches:
 * - Upstream D&D 5e: "⬆ LEVEL UP — Now Level [X]", "→ Awaiting your choice before the story continues."
 * - PbtA ruleset: "*(Level Up! Choose an Advance: ...)*", "Level Up! Choose an Advance:"
 *
 * @param {string} text
 * @returns {boolean}
 */
// [CATALOG: WRK-08] See WORKAROUNDS.md — Level-Up & Permadeath Pause Protocol Shield
export function isLevelUpPending(text) {
    if (!text || typeof text !== 'string') return false;
    if (/⬆\s*LEVEL UP|LEVEL UP\s*—\s*Now Level\b/i.test(text)) return true;
    if (/Awaiting your (?:level-up\s+)?choice before the story continues/i.test(text)) return true;
    if (/Level Up!\s*Choose an Advance\b/i.test(text)) return true;
    return false;
}

/**
 * Checks whether the protagonist is confirmed dead (not merely downed or dying) in the state memo.
 * When dead, story choices and survival moves should be suppressed.
 *
 * @param {string} memoText
 * @returns {boolean}
 */
// [CATALOG: WRK-08] See WORKAROUNDS.md — Level-Up & Permadeath Pause Protocol Shield
export function isProtagonistDead(memoText) {
    if (!memoText || typeof memoText !== 'string') return false;
    const charMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)(?:\[\/CHARACTER\]|(?=\n[ \t]*\[(?:PARTY|ENEMIES|COMBAT|LOCATION|INVENTORY|WORLD)\])|$)/i);
    const scope = charMatch ? charMatch[1] : memoText;
    return /Status\s*:.*?\b(Dead|Deceased|Slain|Killed)\b/i.test(scope);
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

    if (choiceIndices.length < 2 || choiceIndices.length > 8) {
        return null;
    }

    const firstIdx = choiceIndices[0];
    const lastIdx = choiceIndices[choiceIndices.length - 1];

    const footerRegex = /^\s*[\*\_]?\(?(?:Status|Harm|HP|XP|Hold|Location|Spell|Turn|Round|State|Level|Time|Day|HH:MM|\d{1,2}:\d{2})/i;
    const footerRegexAlt = /^\s*[\*\_]?\[?(?:Status|Harm|HP|XP|Hold|Location|Time|Day|HH:MM|\d{1,2}:\d{2})/i;

    for (let i = lastIdx + 1; i < lines.length; i++) {
        const trailingLine = lines[i].trim();
        if (!trailingLine) continue;
        const isFooter = footerRegex.test(trailingLine) || footerRegexAlt.test(trailingLine);
        if (!isFooter) {
            return null;
        }
    }

    for (let i = firstIdx; i <= lastIdx; i++) {
        const l = lines[i].trim();
        if (l && !choiceIndices.includes(i)) {
            return null;
        }
    }

    let replaceStartIdx = firstIdx;
    if (firstIdx > 0) {
        const cleanPrev = lines[firstIdx - 1].replace(/[\*_:#\-]/g, '').trim();
        if (/^(?:(?:available|next|your)?\s*(?:choices|options|actions)|what (?:does [^?]+|do you) do\??)$/i.test(cleanPrev)) {
            replaceStartIdx = firstIdx - 1;
        }
    }

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
    const beforeChoices = lines.slice(0, replaceStartIdx);
    const trailingLines = lines.slice(lastIdx + 1);

    const hasTrailingFooter = trailingLines.some(l => {
        const t = l.trim();
        return t && (footerRegex.test(t) || footerRegexAlt.test(t));
    });

    let newLines;
    if (hasTrailingFooter) {
        newLines = [
            ...beforeChoices,
            ...trailingLines,
            '',
            choiceBlock,
        ];
    } else {
        newLines = [
            ...beforeChoices,
            choiceBlock,
            ...trailingLines,
        ];
    }

    return newLines.join('\n').trim();
}

/**
 * Applies repaired text to the message and updates SillyTavern DOM and state.
 *
 * @param {number} messageId
 * @param {string} repairedText
 * @returns {Promise<boolean>}
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
        } else if (typeof document !== 'undefined') {
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
 * Unified dispatcher and safety net for CYOA choices.
 * Evaluates settled narrator messages:
 * 1. If choices exist and character is healthy -> complete (no-op).
 * 2. If choices are in plain markdown -> local auto-repair to buttons.
 * 3. If choices are missing or character is downed -> triggers generateCyoaChoices.
 *
 * @param {object} params
 * @param {number} [params.messageId=-1]
 * @param {string} [params.triggerSource='unknown']
 * @param {() => object} [params.getSettings]
 * @param {() => boolean} [params.isPbtaActive]
 * @param {(type: string, message: string, title?: string) => void} [params.showToast]
 * @param {boolean} [params.force=false]
 * @returns {Promise<boolean>}
 */
export async function coordinateCyoaForMessage({
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
    const cyoaMode = s.cyoaMode || (s.enableDecoupledCyoa !== false ? 'safety_net' : 'disabled');
    if (!force && cyoaMode === 'disabled') return false;

    // Defer if narrator is still actively streaming
    if (triggerSource === 'CHARACTER_MESSAGE_RENDERED' && isNarratorGenerating()) {
        return false;
    }

    if (isCyoaGenerating()) {
        lockSendButtonUI();
        if (messageId >= 0) insertCyoaLoadingIndicator(messageId);
        return false;
    }

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return false;

    const idx = messageId >= 0 ? messageId : chat.length - 1;
    if (idx < 0 || (!force && (idx === 0 || !isAdventureActive()))) return false;

    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system || msg.extra?.isSmallSys || msg.extra?.tool_invocations || (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0)) {
        return false;
    }

    const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
    const pbtaActive = typeof isPbtaActive === 'function' ? isPbtaActive() : false;

    if (!force && !isCyoaExpected(rpgSettings, pbtaActive)) return false;

    // [CATALOG: WRK-08] See WORKAROUNDS.md — Level-Up & Permadeath Pause Protocol Shield
    if (!force && isLevelUpPending(msg.mes)) {
        console.log(`[MultiHog Companion] Level-up detected for message ${idx}; pausing CYOA generation as instructed by protocol.`);
        return false;
    }

    const freshMemo = rpgSettings?.currentMemo || SillyTavern.getContext?.()?.extensionSettings?.rpg_tracker?.currentMemo || '';
    if (!force && isProtagonistDead(freshMemo)) {
        console.log(`[MultiHog Companion] Protagonist is deceased for message ${idx}; suppressing CYOA choices.`);
        return false;
    }

    const currentSwipeId = msg.swipe_id ?? 0;
    if (!force && _lastAttemptedMessageId === idx && _lastAttemptedSwipeId === currentSwipeId) {
        return false;
    }

    // 1. Happy Path: Check if valid <choices><button>...</button></choices> already exist
    if (!force && hasCyoaChoices(msg.mes)) {
        const isDowned = isProtagonistDowned(freshMemo, pbtaActive);
        if (!isDowned) {
            return false;
        }
        if (/Death Saving Throw|Last Breath|Cling to life|Succumb|whisper a final plea|faint plea/i.test(msg.mes)) {
            return false;
        }
    }

    // 2. Local Regex Auto-Repair Path: Check if plain numbered markdown choices can be converted to buttons
    if (!force && !hasCyoaChoices(msg.mes)) {
        const repaired = tryRepairMarkdownChoices(msg.mes);
        if (repaired) {
            console.log(`[MultiHog Companion] Auto-repaired markdown choices into buttons for message:`, idx);
            const ok = await applyRepairedMessage(idx, repaired);
            if (ok) {
                if (showToast) showToast('info', 'Auto-formatted choices into buttons 🧭', 'CYOA Engine');
                return true;
            }
        }
    }

    // 3. Fallback Repair Path: Choices were skipped or missing -> Trigger Choice Generator
    _lastAttemptedMessageId = idx;
    _lastAttemptedSwipeId = currentSwipeId;

    console.log(`[MultiHog Companion] Triggering CYOA choice generator via ${triggerSource} for message:`, idx);

    try {
        const text = String(msg.mes || '');
        const ok = await generateCyoaChoices({
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
            _lastAttemptedMessageId = -1;
            _lastAttemptedSwipeId = -1;
        }
        return ok;
    } catch (err) {
        _lastAttemptedMessageId = -1;
        _lastAttemptedSwipeId = -1;
        console.error('[MultiHog Companion] CYOA choice generator error:', err);
        return false;
    }
}

/**
 * Registers CYOA Safety Net event hooks with catalog anchor tags.
 *
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {() => boolean} deps.isPbtaActive
 * @param {(type: string, message: string, title?: string) => void} deps.showToast
 * @param {object} [deps.eventSource]
 * @param {object} [deps.event_types]
 */
export function initCyoaSafetyNet({ getSettings, isPbtaActive, showToast, eventSource: esParam, event_types: etParam }) {
    if (typeof getSettings === 'function') {
        _getSettings = getSettings;
    }
    const es = esParam || (typeof eventSource !== 'undefined' ? eventSource : null) || (typeof window !== 'undefined' ? window.eventSource : null) || globalThis.eventSource;
    const et = etParam || (typeof event_types !== 'undefined' ? event_types : null) || (typeof window !== 'undefined' ? window.event_types : null) || globalThis.event_types;
    if (!es || !et) return;

    // [CATALOG: EVT-09] See LISTENERS.md — CYOA Generation Guard (GENERATION_STARTED)
    if (et.GENERATION_STARTED) {
        es.on(et.GENERATION_STARTED, (type, params, dryRun) => {
            if (dryRun) return;
            if (type === 'quiet') return;
            _wasGenerationStopped = false;
            _lastAttemptedMessageId = -1;
            _lastAttemptedSwipeId = -1;
            abortCyoaGeneration('generation_started');
        });
    }

    // [CATALOG: EVT-10] See LISTENERS.md — CYOA Stop Guard (GENERATION_STOPPED)
    if (et.GENERATION_STOPPED) {
        es.on(et.GENERATION_STOPPED, () => {
            _wasGenerationStopped = true;
            _lastAttemptedMessageId = -1;
            _lastAttemptedSwipeId = -1;
            abortCyoaGeneration('generation_stopped');
        });
    }

    // [CATALOG: EVT-05] See LISTENERS.md — CYOA State Reset (CHAT_CHANGED)
    if (et.CHAT_CHANGED) {
        es.on(et.CHAT_CHANGED, () => {
            _wasGenerationStopped = false;
            _lastAttemptedMessageId = -1;
            _lastAttemptedSwipeId = -1;
            abortCyoaGeneration('chat_changed');
        });
    }

    // [CATALOG: DOM-06] See LISTENERS.md — Native Capture Phase Click Interceptor for Stop Buttons
    if (typeof document !== 'undefined') {
        const handleStopClick = () => {
            if (isCyoaGenerating()) {
                console.log('[MultiHog Companion] User clicked Stop. Aborting CYOA generation.');
                abortCyoaGeneration('user_stop_clicked');
            }
        };
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && (target.closest?.('.mes_stop, #mes_stop, .rt-cyoa-cancel-btn') || target.classList?.contains('mes_stop') || target.classList?.contains('rt-cyoa-cancel-btn'))) {
                handleStopClick();
            }
        }, true);
    }

    // [CATALOG: EVT-12] See LISTENERS.md — CYOA Outgoing Prompt Sanitizer (CHAT_COMPLETION_PROMPT_READY)
    if (et.CHAT_COMPLETION_PROMPT_READY) {
        es.on(et.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
            const s = getSettings();
            const cyoaMode = s.cyoaMode || (s.enableDecoupledCyoa !== false ? 'safety_net' : 'disabled');
            if (cyoaMode === 'disabled') return;
            if (Array.isArray(eventData?.chat)) {
                stripCyoaFromOutgoingChat(eventData.chat, {
                    stripActiveCyoa: cyoaMode === 'two_stage' || cyoaMode === 'always_decoupled',
                });
            }
        });
    }

    // [CATALOG: EVT-06] See LISTENERS.md — CYOA Safety Net & Auto-Repair Dispatcher (CHARACTER_MESSAGE_RENDERED)
    if (et.CHARACTER_MESSAGE_RENDERED) {
        es.on(et.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            void coordinateCyoaForMessage({
                messageId,
                triggerSource: 'CHARACTER_MESSAGE_RENDERED',
                getSettings,
                isPbtaActive,
                showToast,
            });
        });
    }

    // [CATALOG: EVT-11] See LISTENERS.md — CYOA Fallback Completion Trigger (GENERATION_ENDED)
    if (et.GENERATION_ENDED) {
        es.on(et.GENERATION_ENDED, async () => {
            await coordinateCyoaForMessage({
                triggerSource: 'GENERATION_ENDED',
                getSettings,
                isPbtaActive,
                showToast,
            });
        });
    }
}

/**
 * Regenerates CYOA choices for a given message without touching the narrative prose.
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

    _lastAttemptedMessageId = -1;
    _lastAttemptedSwipeId = -1;

    const cleanNarrative = String(msg.mes || '')
        .replace(/<choices\b[^>]*>[\s\S]*?<\/choices\s*>/gi, '')
        .replace(/<div\b[^>]*\b(?:rt-cyoa-choices|mhc-cyoa-loading-badge)\b[^>]*>[\s\S]*?<\/div\s*>/gi, '')
        .trim();

    msg.mes = cleanNarrative;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) {
        msg.swipes[msg.swipe_id] = cleanNarrative;
    }

    if (showToast) showToast('info', 'Formulating fresh choices... 🎲', 'CYOA Engine');

    return await coordinateCyoaForMessage({
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
 * fresh choices if no choices exist at all.
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

    const repaired = tryRepairMarkdownChoices(msg.mes);
    if (repaired) {
        const ok = await applyRepairedMessage(idx, repaired);
        if (ok && showToast) {
            showToast('success', 'Converted markdown choices into CYOA buttons! 🧭', 'CYOA Engine');
        }
        return ok;
    }

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
        helpString: '<div>Converts plain-text numbered choices into buttons, or generates them via choice generator if missing.</div>',
    }));
}

/**
 * Interactive trigger from the SillyTavern wand menu (#mhc_wand_cyoa_fix_reroll).
 * Strictly operates on the latest message in chat (chat[chat.length - 1]).
 * Fails safely if the latest message is not a settled narrator response.
 *
 * @param {object} [options={}]
 * @param {Function} [options.getSettings]
 * @param {boolean|Function} [options.isPbtaActive]
 * @param {Function} [options.showToast]
 * @returns {Promise<boolean>}
 */
export async function handleWandCyoaFixOrReroll({ getSettings, isPbtaActive, showToast } = {}) {
    const resolvedGetSettings = typeof getSettings === 'function' ? getSettings : _getSettings;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chat = ctx?.chat;

    if (!Array.isArray(chat) || chat.length === 0) {
        if (showToast) showToast('warning', 'No messages in chat to format or reroll choices.', 'CYOA Engine');
        return false;
    }

    if (isNarratorGenerating()) {
        if (showToast) showToast('info', 'Please wait until the narrator finishes generating.', 'CYOA Engine');
        return false;
    }

    const idx = chat.length - 1;
    const msg = chat[idx];

    // Safety guard: must be a settled narrator/assistant message with narrative text.
    // Rejects user messages, system/toolcall cards, and intermediary empty-thought assistant turns.
    if (!msg || msg.is_user || msg.is_system || msg.extra?.isSmallSys || msg.extra?.tool_invocations || !msg.mes || !msg.mes.trim()) {
        if (showToast) showToast('warning', 'Latest message is not a settled narrator response.', 'CYOA Engine');
        return false;
    }

    // Fast Path: Check if plain numbered markdown choices can be converted to buttons (0 tokens, 0 latency)
    const repaired = tryRepairMarkdownChoices(msg.mes);
    if (repaired) {
        const ok = await applyRepairedMessage(idx, repaired);
        if (ok && showToast) {
            showToast('success', 'Converted markdown choices into CYOA buttons! 🧭', 'CYOA Engine');
        }
        return ok;
    }

    // Reroll / Generate Path: Choices missing or re-rolling existing buttons
    return await regenerateCyoaChoicesForMessage({
        messageId: idx,
        isPbtaActive,
        showToast,
        getSettings: resolvedGetSettings,
    });
}

