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
} from './cyoa-decoupled-runner.js';

let _wasGenerationStopped = false;
let _pendingSteeringReminder = null;
let _retryTracker = { mesId: -1, count: 0 };

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
        const isFooter = /^\s*[\*\_]?\(?(?:Harm|HP|XP|Hold|Location|Spell|Turn|Round|State)/i.test(trailingLine)
            || /^\s*\[(?:Harm|HP|XP|Hold|Location)/i.test(trailingLine);
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

        if (typeof ctx.saveChatDebounced === 'function') {
            ctx.saveChatDebounced();
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
 * Registers CYOA Guardian event hooks.
 *
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {() => boolean} deps.isPbtaActive
 * @param {(type: string, message: string, title?: string) => void} deps.showToast
 */
export function initCyoaGuardian({ getSettings, isPbtaActive, showToast, eventSource: esParam, event_types: etParam }) {
    const es = esParam || (typeof eventSource !== 'undefined' ? eventSource : null) || (typeof window !== 'undefined' ? window.eventSource : null) || globalThis.eventSource;
    const et = etParam || (typeof event_types !== 'undefined' ? event_types : null) || (typeof window !== 'undefined' ? window.event_types : null) || globalThis.event_types;
    if (!es || !et) return;

    if (et.GENERATION_STARTED) {
        es.on(et.GENERATION_STARTED, () => {
            _wasGenerationStopped = false;
            // Abort any in-flight Stage 2 pass when a new generation starts (especially swipes)
            abortStage2Cyoa();
        });
    }

    if (et.GENERATION_STOPPED) {
        es.on(et.GENERATION_STOPPED, () => {
            _wasGenerationStopped = true;
            _pendingSteeringReminder = null;
            abortStage2Cyoa();
        });
    }

    if (et.CHAT_CHANGED) {
        es.on(et.CHAT_CHANGED, () => {
            _retryTracker = { mesId: -1, count: 0 };
            _pendingSteeringReminder = null;
            abortStage2Cyoa();
        });
    }

    // Bind document-level Stop button listener so clicking Stop square aborts Stage 2 immediately
    if (typeof document !== 'undefined') {
        const handleStopClick = () => {
            if (isStage2CyoaRunning()) {
                console.log('[MultiHog Companion] User clicked Stop. Aborting Decoupled CYOA.');
                abortStage2Cyoa();
            }
        };
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && (target.closest?.('.mes_stop, #mes_stop') || target.classList?.contains('mes_stop'))) {
                handleStopClick();
            }
        }, true);
    }

    // Fail-safe prompt sanitization on CHAT_COMPLETION_PROMPT_READY
    if (et.CHAT_COMPLETION_PROMPT_READY) {
        es.on(et.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
            const s = getSettings();
            if (s.enableDecoupledCyoa !== false && Array.isArray(eventData?.chat)) {
                stripCyoaFromOutgoingChat(eventData.chat);
            }
        });
    }

    if (et.GENERATION_ENDED) {
        es.on(et.GENERATION_ENDED, async () => {
            if (_wasGenerationStopped) return;

            const s = getSettings();
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || chat.length === 0) return;

            const lastIdx = chat.length - 1;
            const lastMsg = chat[lastIdx];
            if (!lastMsg || lastMsg.is_user || lastMsg.is_system) return;

            const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
            const pbtaActive = typeof isPbtaActive === 'function' ? isPbtaActive() : false;

            if (!isCyoaExpected(rpgSettings, pbtaActive)) {
                return;
            }

            // ── DECOUPLED TWO-STAGE CYOA PATH ──
            if (s.enableDecoupledCyoa !== false) {
                const text = String(lastMsg.mes || '');
                // If message already has CYOA buttons (e.g. from previous edit), skip Stage 2
                if (hasCyoaChoices(text)) {
                    _retryTracker = { mesId: -1, count: 0 };
                    return;
                }

                await runDecoupledCyoaStage2({
                    messageId: lastIdx,
                    narrative: text,
                    isPbta: pbtaActive,
                    rpgSettings,
                    showToast,
                });
                return;
            }

            // ── LEGACY GUARDIAN PATH (when decoupled CYOA is disabled) ──
            if (s.enableCyoaAutoRetry === false && s.enableCyoaMarkdownAutoRepair === false) {
                return;
            }

            const text = String(lastMsg.mes || '');
            if (hasCyoaChoices(text)) {
                _retryTracker = { mesId: -1, count: 0 };
                return;
            }

            // 1. Try Markdown Auto-Repair (instant, zero token re-roll)
            if (s.enableCyoaMarkdownAutoRepair !== false) {
                const repaired = tryRepairMarkdownChoices(text);
                if (repaired) {
                    const ok = await applyRepairedMessage(lastIdx, repaired);
                    if (ok) {
                        _retryTracker = { mesId: -1, count: 0 };
                        showToast('info', 'Auto-converted markdown choices into CYOA buttons! 🧭', 'CYOA Guardian');
                        return;
                    }
                }
            }
        });
    }
}

/**
 * Registers CYOA slash commands (/cyoaretry and /cyoafix).
 */
export function registerCyoaSlashCommands(SlashCommandParser, SlashCommand, { isPbtaActive, showToast }) {
    if (!SlashCommandParser?.addCommandObject || !SlashCommand) return;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoaretry',
        callback: async () => {
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
            const pbtaActive = typeof isPbtaActive === 'function' ? isPbtaActive() : false;
            const choiceCount = pbtaActive && (rpgSettings?.cyoaConfig?.playstyle === 'cyoa_3') ? 3 : 5;

            armCyoaSteeringReminder({ isPbta: pbtaActive, choiceCount });
            showToast('info', 'Swiping with CYOA steering reminder... 🎲', 'CYOA Guardian');
            await triggerSwipeRight();
            return 'Swiping with CYOA steering reminder...';
        },
        helpString: '<div>Swipes the latest narrator message and injects a strict CYOA choices reminder.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'cyoafix',
        callback: async () => {
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || chat.length === 0) {
                showToast('warning', 'No messages in chat to repair.', 'CYOA Guardian');
                return 'No messages in chat.';
            }

            const lastIdx = chat.length - 1;
            const lastMsg = chat[lastIdx];
            if (lastMsg.is_user || lastMsg.is_system) {
                showToast('warning', 'Last message is not a narrator message.', 'CYOA Guardian');
                return 'Last message is not from narrator.';
            }

            const repaired = tryRepairMarkdownChoices(lastMsg.mes);
            if (repaired) {
                await applyRepairedMessage(lastIdx, repaired);
                showToast('success', 'Converted markdown choices into CYOA buttons! 🧭', 'CYOA Guardian');
                return 'Successfully converted markdown choices into CYOA buttons.';
            } else {
                showToast('warning', 'No markdown choices found to convert. Use /cyoaretry to re-roll.', 'CYOA Guardian');
                return 'No markdown choices found to convert.';
            }
        },
        helpString: '<div>Scans the latest narrator message for plain-text numbered choices and wraps them into interactive CYOA buttons.</div>',
    }));
}
