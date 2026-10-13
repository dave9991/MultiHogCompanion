/**
 * cyoa-decoupled-runner.js — MultiHog Companion
 *
 * Dedicated Stage 2 Choice Generator for Decoupled Two-Stage CYOA.
 *
 * Execution Flow:
 * 1. Stage 1 (Narrator) generates pure story prose (with <CYOA_mode> stripped from prompt).
 * 2. MultiHog State Tracker audits the story and settles state memo (HP, Harm, downed conditions).
 * 3. Stage 2 (This Runner) triggers with the settled State Memo and latest narrative chunk.
 * 4. Generates synchronized choices (e.g. Downed/Crisis choices if at 0 HP/Max Harm).
 * 5. Appends <choices> to chat[mesId], updates swipes, triggers _rpgFinalizeCyoaNarratorRender(),
 *    and unblocks UI.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';

let _activeCyoaAbortController = null;
let _isStage2Running = false;

/**
 * Returns whether Stage 2 CYOA generation is currently running.
 * @returns {boolean}
 */
export function isStage2CyoaRunning() {
    return _isStage2Running;
}

/**
 * Aborts any in-flight Stage 2 CYOA generation and cleans up UI lock.
 */
export function abortStage2Cyoa() {
    if (_activeCyoaAbortController) {
        _activeCyoaAbortController.abort();
        _activeCyoaAbortController = null;
    }
    _isStage2Running = false;
    removeCyoaLoadingIndicator();
    restoreSendButtonUI();
}

/**
 * Checks whether the protagonist is downed/incapacitated in the State Memo.
 * Handles both PbtA (Max Harm / 0 HP) and D&D (0 HP / Dying / Unconscious).
 *
 * @param {string} memoText
 * @param {boolean} [isPbta=false]
 * @returns {boolean}
 */
export function isProtagonistDowned(memoText, isPbta = false) {
    if (!memoText || typeof memoText !== 'string') return false;

    // Check [CHARACTER] section first if present
    const charMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    const scope = charMatch ? charMatch[1] : memoText;

    // Direct status keywords indicating down/dying
    if (/Status\s*:.*?\b(Incapacitated|Dying|Defeated|Unconscious|Mortally Wounded)\b/i.test(scope)) {
        return true;
    }

    if (isPbta) {
        // PbtA Harm checking: Harm: X/X where X === X (or curHarm >= maxHarm)
        const harmMatch = scope.match(/Harm\s*[:=]\s*(\d+)(?:\/(\d+))?/i);
        if (harmMatch) {
            const curHarm = parseInt(harmMatch[1], 10) || 0;
            const maxHarm = parseInt(harmMatch[2], 10) || 5;
            if (curHarm >= maxHarm && maxHarm > 0) return true;
        }
        // Tandem 0 HP
        if (/\b0\/\d+\s*HP\b/i.test(scope)) {
            return true;
        }
    } else {
        // D&D: 0 HP or negative HP
        const hpMatch = scope.match(/:\s*([+-]?\d+)(?:\/(\d+))?\s*HP\b/i);
        if (hpMatch) {
            const curHp = parseInt(hpMatch[1], 10);
            if (curHp <= 0) return true;
        }
    }

    return false;
}

/**
 * Constructs the Stage 2 prompt for the dedicated choice generator.
 *
 * @param {object} opts
 * @param {string} opts.narrative Latest narrative beat from assistant
 * @param {string} opts.memo Fresh state memo after State Tracker audit
 * @param {boolean} opts.isPbta Whether PbtA ruleset is active
 * @param {object} [opts.rpgSettings] MultiHog settings
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildStage2CyoaPrompt({ narrative, memo, isPbta, rpgSettings }) {
    const isDowned = isProtagonistDowned(memo, isPbta);
    const cyoaConfig = rpgSettings?.cyoaConfig || {};
    const playstyle = cyoaConfig.playstyle || 'cyoa_5';
    const choiceCount = playstyle === 'cyoa_3' ? 3 : 5;
    const cyoaEmojis = cyoaConfig.cyoaEmojis !== false;

    let systemPrompt = '';
    let guidelines = '';

    if (isPbta) {
        const genreKey = rpgSettings?.pbtaGenre || 'fantasy';
        const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

        if (isDowned) {
            guidelines = `CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / INCAPACITATED (Max Harm / 0 HP):
- Strict negative constraint: DO NOT offer standard physical attacks, normal combat maneuvers, or confident active conversation.
- The character has collapsed, is mortally wounded, or unconscious.
- You must generate exactly ${choiceCount} Downed/Crisis survival choices reflecting their helpless state:
  1. CLING TO LIFE / LAST BREATH: Fight to remain conscious or cling to life.
  2. FAINT PLEA / CALL FOR AID: Whisper a final word, reach out to an ally, or signal for help.
  3. DESPERATE SACRIFICE / GAMBIT: A fading gesture or last-ditch protective effort.
  ${choiceCount === 5 ? '4. SLIP INTO DARKNESS: Succumb to blackness, endure unconsciousness, or play dead.\n  5. ALLY INTERVENTION: Look to an ally to step in, drag you to cover, or turn the tide.' : ''}`;
        } else {
            guidelines = `PbtA Moves & Narrative Choices:
- Generate exactly ${choiceCount} choices tailored to the current scene and fictional pacing.
- At most 1 choice should trigger a dramatic PbtA Move with a stat bonus (e.g. "— [Move (+Stat)]").
- Remaining choices should be dialogue, tactical positioning, environmental awareness, or alternative actions (no move tags).
- Never overload choices with rolls; ordinary dialogue and observation never roll dice.`;
        }

        systemPrompt = `You are the specialized CYOA Choice Engine for a Powered by the Apocalypse (${genre.label}) tabletop RPG.
Your sole job is to formulate ${choiceCount} compelling player choices based on the latest narrative event and character state.

${guidelines}

FORMAT CONTRACT:
- Output ONLY a <choices> block containing <button> elements.
${cyoaEmojis ? '- Prefix each choice option with an appropriate thematic emoji.' : ''}
- Example format:
<choices>
<button>1. ⚔️ Attack the sentry — [Hack & Slash (+Might)]</button>
<button>2. 💬 "We don't have to do this the hard way."</button>
<button>3. 🔍 Scan the room for a hidden exit</button>
</choices>
Do NOT include any narrative explanation, commentary, or extra text outside the <choices>...</choices> block.`;
    } else {
        // D&D 5e / d20 Mode
        if (isDowned) {
            guidelines = `CRITICAL MANDATE — THE PROTAGONIST IS DOWNED / UNCONSCIOUS (0 HP / DYING):
- Strict negative constraint: The character is at 0 HP and unconscious/dying. DO NOT offer standard attacks, spells, or physical actions.
- You must generate exactly ${choiceCount} Downed/Survival choices:
  1. 🎲 Roll Death Saving Throw (d20, no modifiers; 10+ success, <10 failure)
  2. 🩸 Cling desperately to consciousness and fight to stabilize
  3. 💬 Whisper a faint final plea or signal to an ally for help
  ${choiceCount === 5 ? '4. 🛡️ Look to a party member to administer a potion or cast healing magic\n  5. 🌑 Succumb to the darkness and slip into unconsciousness' : ''}`;
        } else {
            guidelines = `D&D Tactical & Narrative Choices:
- Generate exactly ${choiceCount} actionable choices fitting D&D combat and exploration:
  1. Primary Combat Action or Spell (e.g., Attack with equipped weapon, cast a prepared spell)
  2. Tactical Maneuver or Positioning (e.g., Take cover, disengage, flank the enemy)
  3. Spoken Dialogue or Command (e.g., Command allies, shout a challenge, parley)
  ${choiceCount === 5 ? '4. Environmental Interaction or Perception (e.g., Search for an escape route, use terrain)\n  5. Defensive Option or Item (e.g., Drink a potion, ready shield, dodge)' : ''}`;
        }

        systemPrompt = `You are the specialized CYOA Choice Engine for a D&D tabletop RPG.
Your sole job is to formulate ${choiceCount} actionable, context-aware player choices based on the latest story beat and mechanical state.

${guidelines}

FORMAT CONTRACT:
- Output ONLY a <choices> block containing <button> elements.
${cyoaEmojis ? '- Prefix each choice option with an appropriate thematic emoji.' : ''}
- Example format:
<choices>
<button>1. ⚔️ Strike the hobgoblin with your longsword</button>
<button>2. 🔥 Cast Fire Bolt at the archer on the ledge</button>
<button>3. 🛡️ Disengage and retreat behind cover</button>
</choices>
Do NOT include any commentary or extra text outside the <choices>...</choices> block.`;
    }

    const cleanNarrative = String(narrative || '').slice(-2500).trim();
    const cleanMemo = String(memo || '').trim();

    const userPrompt = `### LATEST NARRATIVE SCENE:
${cleanNarrative}

### CURRENT CHARACTER & COMBAT STATE:
${cleanMemo}

Generate the ${choiceCount} choices now inside <choices>...</choices>:`;

    return { systemPrompt, userPrompt };
}

/**
 * Extracts and cleans the <choices>...</choices> markup from the model output.
 * If the model output plain buttons or markdown numbers, repairs them cleanly.
 *
 * @param {string} rawText
 * @returns {string|null}
 */
export function extractCleanChoicesMarkup(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // 1. Direct <choices> block
    const choicesMatch = rawText.match(/<choices\b[^>]*>([\s\S]*?)<\/choices\s*>/i);
    if (choicesMatch) {
        const inner = choicesMatch[1].trim();
        // Ensure buttons exist inside
        if (/<button[\s>]/i.test(inner)) {
            return `<choices>\n${inner}\n</choices>`;
        }
    }

    // 2. Loose <button> elements
    const buttonMatches = rawText.match(/<button\b[^>]*>[\s\S]*?<\/button\s*>/gi);
    if (buttonMatches && buttonMatches.length >= 2) {
        return `<choices>\n${buttonMatches.join('\n')}\n</choices>`;
    }

    // 3. Fallback: Numbered markdown list (e.g. "1. ⚔️ Attack", "2. 🏃 Flee")
    const lines = rawText.split('\n');
    const buttonList = [];
    const numRegex = /^\s*(?:[\*\-]\s*)?(?:\*\*)?(\d+)[\.\)](?:\*\*)?\s+(.+)$/;
    for (const line of lines) {
        const m = line.trim().match(numRegex);
        if (m) {
            buttonList.push(`<button>${m[1]}. ${m[2].trim()}</button>`);
        }
    }

    if (buttonList.length >= 2) {
        return `<choices>\n${buttonList.join('\n')}\n</choices>`;
    }

    return null;
}

/**
 * Polls for the MultiHog State Tracker model pass to finish.
 *
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<boolean>} True if State Tracker is idle, false if timed out.
 */
export async function waitForStateTracker(timeoutMs = 15000) {
    const startTime = Date.now();
    const isRunning = () => typeof globalThis._rpgStateModelRunning === 'function' && globalThis._rpgStateModelRunning();

    // Check immediately
    if (!isRunning()) return true;

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!isRunning()) {
            // Give a tiny tick for settings / currentMemo write to flush
            await new Promise(resolve => setTimeout(resolve, 50));
            return true;
        }
    }

    console.warn('[MultiHog Companion] State Tracker wait timed out. Proceeding with latest memo.');
    return false;
}

/**
 * Injects a temporary visual loading indicator into the active message's DOM.
 *
 * @param {number} messageId
 */
export function insertCyoaLoadingIndicator(messageId) {
    if (typeof document === 'undefined') return;
    removeCyoaLoadingIndicator();
    const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if (!mesEl) return;

    const loader = document.createElement('div');
    loader.className = 'rt-cyoa-choices rt-cyoa-loading';
    loader.setAttribute('data-cyoa-loader', 'true');
    loader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:10px;background:rgba(0,0,0,0.22);border-radius:6px;font-style:italic;opacity:0.85;border-left:3px solid var(--SmartThemeQuoteColor, #00ffaa);';
    loader.innerHTML = '<i class="fa-solid fa-dice-d20 fa-spin" style="color:var(--SmartThemeQuoteColor, #00ffaa);"></i> <span>Formulating tactical choices...</span>';
    mesEl.appendChild(loader);
}

/**
 * Removes any active loading indicator from the chat DOM.
 */
export function removeCyoaLoadingIndicator() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.rt-cyoa-loading, [data-cyoa-loader]').forEach(el => el.remove());
}

/**
 * Locks the SillyTavern UI during Stage 2 generation (shows stop button, blocks send button).
 */
export function lockSendButtonUI() {
    const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (typeof context?.deactivateSendButtons === 'function') {
        context.deactivateSendButtons();
    } else if (typeof document !== 'undefined') {
        const sendBtn = document.getElementById('send_but');
        if (sendBtn) sendBtn.disabled = true;
    }
}

/**
 * Restores the SillyTavern UI after Stage 2 generation completes or aborts.
 */
export function restoreSendButtonUI() {
    const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (typeof context?.activateSendButtons === 'function') {
        context.activateSendButtons();
    } else if (typeof document !== 'undefined') {
        const sendBtn = document.getElementById('send_but');
        if (sendBtn) sendBtn.disabled = false;
    }
}

/**
 * Executes the complete Stage 2 Decoupled CYOA pass.
 *
 * @param {object} params
 * @param {number} params.messageId Index of the assistant message in chat
 * @param {string} params.narrative Prose text from the assistant message
 * @param {boolean} params.isPbta Whether PbtA ruleset is active
 * @param {object} params.rpgSettings MultiHog settings
 * @param {Function} [params.showToast] Toast notification helper
 * @returns {Promise<boolean>} Success status
 */
export async function runDecoupledCyoaStage2({ messageId, narrative, isPbta, rpgSettings, showToast }) {
    if (_isStage2Running) {
        abortStage2Cyoa();
    }

    _isStage2Running = true;
    _activeCyoaAbortController = new AbortController();
    const signal = _activeCyoaAbortController.signal;

    try {
        // 1. Lock UI and show in-message spinner
        lockSendButtonUI();
        insertCyoaLoadingIndicator(messageId);

        // 2. Wait for MultiHog State Tracker to finish auditing
        await waitForStateTracker(12000);
        if (signal.aborted) return false;

        // 3. Obtain the freshly audited State Memo
        const freshMemo = rpgSettings?.currentMemo || SillyTavern.getContext?.()?.extensionSettings?.rpg_tracker?.currentMemo || '';

        // 4. Build Stage 2 prompt
        const { systemPrompt, userPrompt } = buildStage2CyoaPrompt({
            narrative,
            memo: freshMemo,
            isPbta,
            rpgSettings,
        });

        // 5. Connection settings: reuse concierge/router settings or fallback to default
        const { sendRoutedLlmRequest, getConciergeConnectionSettings } = await import('./concierge-connection.js');
        const connSettings = getConciergeConnectionSettings();
        connSettings.maxTokens = 400; // CYOA choices are brief

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        // 6. Generate choices via routed LLM call
        const rawOutput = await sendRoutedLlmRequest(connSettings, messages, signal);
        if (signal.aborted) return false;

        // 7. Extract valid <choices> block
        const choicesMarkup = extractCleanChoicesMarkup(rawOutput);
        if (!choicesMarkup) {
            console.warn('[MultiHog Companion] Decoupled CYOA did not produce valid choice markup:', rawOutput);
            removeCyoaLoadingIndicator();
            restoreSendButtonUI();
            _isStage2Running = false;
            return false;
        }

        // 8. Commit choices to active chat message and swipes
        const ctx = SillyTavern.getContext?.();
        const chat = ctx?.chat;
        if (!chat || !chat[messageId]) {
            removeCyoaLoadingIndicator();
            restoreSendButtonUI();
            _isStage2Running = false;
            return false;
        }

        const currentMsg = chat[messageId];
        // Strip any residual footer if needed and append choices
        const cleanBaseText = String(currentMsg.mes || '')
            .replace(/<choices\b[^>]*>[\s\S]*?<\/choices\s*>/gi, '')
            .replace(/<div\b[^>]*\brt-cyoa-choices\b[^>]*>[\s\S]*?<\/div\s*>/gi, '')
            .trim();

        const finalMesText = `${cleanBaseText}\n\n${choicesMarkup}`;
        currentMsg.mes = finalMesText;

        // Update swipe history array if present
        if (Array.isArray(currentMsg.swipes) && currentMsg.swipe_id !== undefined) {
            currentMsg.swipes[currentMsg.swipe_id] = finalMesText;
        }

        removeCyoaLoadingIndicator();

        // Update message DOM
        if (typeof ctx.updateMessageBlock === 'function') {
            ctx.updateMessageBlock(messageId, currentMsg);
        } else {
            const mesTextEl = document.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
            if (mesTextEl && typeof ctx.messageFormatting === 'function') {
                mesTextEl.innerHTML = ctx.messageFormatting(finalMesText, currentMsg.name, currentMsg.is_system, currentMsg.is_user);
            }
        }

        if (typeof ctx.saveChatDebounced === 'function') {
            ctx.saveChatDebounced();
        }

        // 9. Re-bind CYOA buttons and finalize styling via MultiHog's native DOM binder
        if (typeof globalThis._rpgFinalizeCyoaNarratorRender === 'function') {
            globalThis._rpgFinalizeCyoaNarratorRender();
        }

        if (showToast) {
            showToast('info', 'Tactical CYOA choices synchronized! 🧭', 'CYOA Engine');
        }

        return true;
    } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') {
            console.log('[MultiHog Companion] Decoupled CYOA generation was aborted by user.');
        } else {
            console.error('[MultiHog Companion] Decoupled CYOA generation failed:', err);
            if (showToast) {
                showToast('warning', 'Failed to generate CYOA choices. UI restored.', 'CYOA Engine');
            }
        }
        return false;
    } finally {
        removeCyoaLoadingIndicator();
        restoreSendButtonUI();
        _isStage2Running = false;
        _activeCyoaAbortController = null;
    }
}
