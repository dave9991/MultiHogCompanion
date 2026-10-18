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
 *
 * @param {string} [reason='unspecified']
 */
export function abortStage2Cyoa(reason = 'unspecified') {
    if (!_isStage2Running && !_activeCyoaAbortController) {
        removeCyoaLoadingIndicator();
        restoreSendButtonUI();
        return;
    }
    console.log('[MultiHog Companion] CYOA Stage 2 aborted. Reason:', reason);
    if (_activeCyoaAbortController) {
        _activeCyoaAbortController.abort();
        _activeCyoaAbortController = null;
    }
    _isStage2Running = false;
    removeCyoaLoadingIndicator();
    restoreSendButtonUI();
}

/**
 * Detects whether the narrative text describes the protagonist collapsing,
 * falling unconscious, or being incapacitated.
 *
 * @param {string} narrativeText
 * @returns {boolean}
 */
export function isNarrativeDowned(narrativeText) {
    if (!narrativeText || typeof narrativeText !== 'string') return false;
    return /\b(?:collapse(?:s|d)?\s+(?:to\s+the\s+(?:floor|ground)|unconscious|senseless)|fall(?:s|en)?\s+unconscious|slip(?:s|ped)?\s+into\s+unconsciousness|vision\s+fades\s+to\s+black|rendered\s+unconscious|knocked\s+unconscious|mortally\s+wounded|succumb(?:s|ed)?\s+to\s+(?:the\s+wounds|death)|bleeding\s+out)\b/i.test(narrativeText);
}

/**
 * Checks whether the protagonist is downed/incapacitated in the State Memo or latest narrative.
 * Handles both PbtA (Max Harm / 0 HP) and D&D (0 HP / Dying / Unconscious).
 *
 * @param {string} memoText
 * @param {boolean} [isPbta=false]
 * @param {string} [narrativeText='']
 * @returns {boolean}
 */
export function isProtagonistDowned(memoText, isPbta = false, narrativeText = '') {
    if (narrativeText && isNarrativeDowned(narrativeText)) {
        return true;
    }
    if (!memoText || typeof memoText !== 'string') return false;

    // Check [CHARACTER] section first if present (terminated by [/CHARACTER], next section [HEADER], or end of text)
    const charMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)(?:\[\/CHARACTER\]|(?=\n[ \t]*\[(?:PARTY|ENEMIES|COMBAT|LOCATION|INVENTORY|WORLD)\])|$)/i);
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
    const isDowned = isProtagonistDowned(memo, isPbta, narrative);
    const cyoaConfig = rpgSettings?.cyoaConfig || {};
    const playstyle = cyoaConfig.playstyle || 'cyoa_5';
    const choiceCount = playstyle === 'cyoa_3' ? 3 : 5;
    const cyoaEmojis = cyoaConfig.cyoaEmojis !== false;
    const fastPipeline = rpgSettings?.enableFastPipeline !== false;

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
- NO D&D MECHANICS: NEVER output target DCs (e.g. "DC 14"), AC, attack rolls, or advantage/disadvantage. In PbtA, moves roll 2d6 + Stat against fixed tiers (10+ / 7–9 / 6-).
- STANCE & INTENT: Action choices may express a clear tactical stance (e.g. aggressive strike vs. defensive parry, stealthy approach vs. bold charge).
- SPENDING HOLD: If [CHARACTER] has spendable Hold (e.g. "Hold: X"), at most 1 choice may offer to spend a point: "— [Spend 1 Hold: Tactical Advantage]".
- DILEMMA CONTINUATION: When the preceding narrative introduced a complication (from a 7–9 Weak Hit) or a telegraphed threat (from a Soft Move), ensure choices provide concrete ways to navigate that dilemma.
- Remaining choices should be dialogue in quotes, tactical positioning, environmental awareness, or alternative actions (no move tags).
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

    const tacticalContext = fastPipeline
        ? `### CURRENT CHARACTER & COMBAT STATE (Turn-Start Baseline):
${cleanMemo}

### IMMEDIATE TACTICAL SITUATION & NARRATIVE DELTA:
The character sheet above reflects state at the start of this turn.
The narrative scene contains the most recent actions, damage, and situational shifts.
Synthesize both: if the character was injured, disarmed, restrained, downed, or shifted into danger during the narrative, generate options strictly reflecting their immediate physical reality.`
        : `### CURRENT CHARACTER & COMBAT STATE:
${cleanMemo}`;

    const userPrompt = `### LATEST NARRATIVE SCENE:
${cleanNarrative}

${tacticalContext}

Generate the ${choiceCount} choices now inside <choices>...</choices>:`;

    return { systemPrompt, userPrompt };
}

/**
 * Extracts and cleans the <choices>...</choices> markup from the model output.
 * Highly resilient parser supporting:
 * - Proper <choices><button>...</button></choices>
 * - <choice> or <option> tags
 * - Unclosed <choices> or unclosed <button> tags
 * - Plain text/markdown numbered lists (1., 1), [1], Option 1:, etc.)
 * - Bullet lists (-, *, •) and emoji-prefixed choices
 * - Stripping reasoning/thinking tokens (<think>...</think>, <thought>...</thought>)
 *
 * @param {string} rawText
 * @returns {string|null}
 */
export function extractCleanChoicesMarkup(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // 0. Strip reasoning/thinking tokens (<think>...</think>, <thought>...</thought>)
    // If choices were output inside an unclosed think block, preserve the choices
    let text = rawText
        .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, (m) => {
            if (/<(?:choices|button)\b/i.test(m)) {
                return m.replace(/^<think\b[^>]*>/i, '');
            }
            return '';
        })
        .replace(/<thought\b[^>]*>[\s\S]*?(?:<\/thought\s*>|$)/gi, (m) => {
            if (/<(?:choices|button)\b/i.test(m)) {
                return m.replace(/^<thought\b[^>]*>/i, '');
            }
            return '';
        })
        .trim();

    // Strip markdown code block wrappers (e.g. ```xml ... ``` or ```html ... ``` or ``` ... ```)
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

    // 1. Direct <button>...</button> elements found anywhere
    const buttonTagRegex = /<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi;
    const directButtons = [];
    let match;
    while ((match = buttonTagRegex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content) directButtons.push(`<button>${content}</button>`);
    }
    if (directButtons.length >= 2) {
        return `<choices>\n${directButtons.join('\n')}\n</choices>`;
    }

    // 2. Alternative tag names: <choice>...</choice> or <option>...</option>
    const altTagRegex = /<(?:choice|option)\b[^>]*>([\s\S]*?)<\/(?:choice|option)\s*>/gi;
    const altButtons = [];
    while ((match = altTagRegex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content) altButtons.push(`<button>${content}</button>`);
    }
    if (altButtons.length >= 2) {
        return `<choices>\n${altButtons.join('\n')}\n</choices>`;
    }

    // 3. Extract text inside <choices>...</choices> or unclosed <choices>...
    let candidateText = text;
    const choicesBlockMatch = text.match(/<choices\b[^>]*>([\s\S]*?)(?:<\/choices\s*>|$)/i);
    if (choicesBlockMatch && choicesBlockMatch[1].trim()) {
        candidateText = choicesBlockMatch[1].trim();
    }

    // 4. Line-by-line parsing
    const lines = candidateText.split('\n');
    const extracted = [];
    let autoIndex = 1;

    for (let line of lines) {
        let l = line.trim();
        if (!l) continue;
        // Skip opening/closing container tags
        if (/^<\/?choices\b[^>]*>$/i.test(l)) continue;

        // Strip loose opening/closing tags
        l = l.replace(/^<(?:button|choice|option)\b[^>]*>\s*/i, '')
             .replace(/<\/(?:button|choice|option)\s*>$/i, '')
             .replace(/^\[(?:button|choice|option)\]\s*/i, '')
             .replace(/\[\/(?:button|choice|option)\]$/i, '')
             .trim();

        if (!l) continue;

        // Pattern A: Numbered (e.g. "1. Foo", "1) Foo", "**1.** Foo", "1 - Foo", "[1] Foo", "Option 1: Foo", "Choice 1: Foo")
        const numPattern = /^(?:[\*\-•]\s*)?(?:\*\*)?(?:option|choice)?\s*\[?(\d+)\]?[\.\)\:\-]\s*(?:\*\*)?\s*(.+)$/i;
        const numM = l.match(numPattern);
        if (numM) {
            const num = numM[1];
            const content = numM[2].trim();
            if (content) {
                extracted.push(`<button>${num}. ${content}</button>`);
                autoIndex = parseInt(num, 10) + 1;
                continue;
            }
        }

        // Pattern B: Lettered (e.g. "A. Foo", "A) Foo", "- A: Foo")
        const letterPattern = /^(?:[\*\-•]\s*)?(?:\*\*)?([A-Ea-e])[\.\)\:\-]\s*(?:\*\*)?\s*(.+)$/;
        const letM = l.match(letterPattern);
        if (letM) {
            const content = letM[2].trim();
            if (content) {
                extracted.push(`<button>${autoIndex}. ${content}</button>`);
                autoIndex++;
                continue;
            }
        }

        // Pattern C: Bulleted or Dash list (e.g. "- ⚔️ Attack", "* 💬 Speak", "• 🏃 Run")
        const bulletPattern = /^(?:[\*\-•–—]|\d+\.)\s*(.+)$/;
        const bulM = l.match(bulletPattern);
        if (bulM) {
            const content = bulM[1].trim();
            if (content && content.length > 3) {
                extracted.push(`<button>${autoIndex}. ${content}</button>`);
                autoIndex++;
                continue;
            }
        }

        // Pattern D: Emoji-prefixed line (e.g. "⚔️ Attack the guard", "💬 Talk to them")
        if (/^[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}]/u.test(l) && l.length > 4) {
            extracted.push(`<button>${autoIndex}. ${l}</button>`);
            autoIndex++;
            continue;
        }
    }

    if (extracted.length >= 2) {
        return `<choices>\n${extracted.join('\n')}\n</choices>`;
    }

    return null;
}

/**
 * Polls for the MultiHog State Tracker model pass to finish.
 *
 * @param {number} [timeoutMs=120000]
 * @returns {Promise<boolean>} True if State Tracker is idle, false if timed out.
 */
export async function waitForStateTracker(timeoutMs = 120000) {
    const startTime = Date.now();
    const isRunning = () => typeof globalThis._rpgStateModelRunning === 'function' && globalThis._rpgStateModelRunning();

    // 1. Wait up to 3500ms for State Tracker to initiate (MultiHog runs keyword scans, map checks, and swiping before triggering state pass)
    const launchWaitLimit = 3500;
    while (Date.now() - startTime < launchWaitLimit) {
        if (isRunning()) break;
        await new Promise(resolve => setTimeout(resolve, 40));
    }

    // 2. If State Tracker did not launch (e.g. disabled, throttled turn, or non-character turn), proceed immediately
    if (!isRunning()) {
        return true;
    }

    // 3. Wait for State Tracker to finish auditing narrative
    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!isRunning()) {
            // Give a tiny tick for settings / currentMemo write to flush
            await new Promise(resolve => setTimeout(resolve, 80));
            return true;
        }
    }

    console.warn(`[MultiHog Companion] State Tracker wait timed out after ${Date.now() - startTime}ms. Proceeding.`);
    return false;
}

/**
 * Injects a temporary visual loading indicator into the active message's DOM.
 * Anchored to `.mes_block` directly adjacent to `.mes_text` so that re-renders of `.mes_text`
 * (e.g. by reasoningHandler, auto-translate, or code block highlighters) do not erase it.
 * Includes an inline Cancel button with Chrome button markers so Framework never hijacks it.
 *
 * @param {number} [messageId]
 */
export function insertCyoaLoadingIndicator(messageId) {
    if (typeof document === 'undefined') return;

    const mesContainer = (messageId !== undefined && messageId >= 0)
        ? document.querySelector(`#chat .mes[mesid="${messageId}"]`)
        : document.querySelector('#chat .mes:last-child');
    if (!mesContainer) {
        return;
    }

    const mesBlock = mesContainer.querySelector('.mes_block') || mesContainer;
    // If indicator already exists in this message, don't remove and re-add to avoid flicker
    if (mesBlock.querySelector('.mhc-cyoa-loading-badge')) {
        return;
    }

    // Remove any stale badge on other messages
    removeCyoaLoadingIndicator();

    const mesText = mesBlock.querySelector('.mes_text');

    const loader = document.createElement('div');
    loader.className = 'mhc-cyoa-loading-badge';
    loader.setAttribute('data-cyoa-loader', 'true');
    loader.style.cssText = 'display:flex !important;flex-direction:row !important;align-items:center !important;justify-content:space-between !important;gap:10px !important;padding:6px 32px 6px 12px !important;margin:8px 0 !important;background:rgba(20,20,30,0.65) !important;border-radius:6px !important;font-style:italic !important;opacity:0.9 !important;border-left:3px solid var(--SmartThemeQuoteColor, #00ffaa) !important;box-sizing:border-box !important;width:100% !important;';
    loader.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;font-size:0.88em;color:var(--SmartThemeBodyColor, #e0e0e0);">
            <i class="fa-solid fa-dice-d20 fa-spin" style="color:var(--SmartThemeQuoteColor, #00ffaa);font-size:1.1em;"></i>
            <span>Formulating tactical choices...</span>
        </div>
        <button type="button" class="rt-cyoa-cancel-btn menu_button" data-target="mhc-cancel" style="display:inline-flex !important;align-items:center !important;gap:4px !important;font-size:0.75em !important;padding:2px 8px !important;border-radius:4px !important;background:rgba(255,80,80,0.2) !important;border:1px solid rgba(255,80,80,0.4) !important;color:#ff9999 !important;cursor:pointer !important;flex-shrink:0 !important;line-height:1.2 !important;font-style:normal !important;width:auto !important;max-width:max-content !important;" title="Abort choice generation">
            <i class="fa-solid fa-xmark"></i> Cancel
        </button>
    `;

    const cancelBtn = loader.querySelector('.rt-cyoa-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            abortStage2Cyoa('cancel_button');
        });
    }

    if (mesText && mesText.parentNode === mesBlock) {
        mesText.insertAdjacentElement('afterend', loader);
    } else {
        mesBlock.appendChild(loader);
    }
}

/**
 * Removes any active loading indicator from the chat DOM.
 */
export function removeCyoaLoadingIndicator() {
    if (typeof document === 'undefined') return;
    const existing = document.querySelectorAll('.mhc-cyoa-loading-badge, [data-cyoa-loader]');
    existing.forEach(el => el.remove());
}

/**
 * Locks the SillyTavern send UI during Stage 2 generation.
 * Uses both scoped CSS and DOM attributes so neither SillyTavern unblockGeneration nor
 * activateSendButtons can prematurely unlock the send button while choices formulate.
 */
export function lockSendButtonUI() {
    if (typeof document === 'undefined') return;
    document.body.setAttribute('data-mhc-cyoa-generating', 'true');

    if (!document.getElementById('mhc-cyoa-lock-style')) {
        const style = document.createElement('style');
        style.id = 'mhc-cyoa-lock-style';
        style.textContent = `
            body[data-mhc-cyoa-generating="true"] #send_but {
                pointer-events: none !important;
                opacity: 0.45 !important;
            }
        `;
        document.head.appendChild(style);
    }

    const sendBtn = document.getElementById('send_but');
    if (sendBtn) {
        sendBtn.setAttribute('data-mhc-locked', 'true');
        sendBtn.style.pointerEvents = 'none';
        sendBtn.style.opacity = '0.45';
    }
    const sendText = document.getElementById('send_textarea');
    if (sendText) {
        sendText.setAttribute('data-mhc-locked', 'true');
    }
}

/**
 * Restores the SillyTavern send UI after Stage 2 generation completes or aborts.
 * Restores DOM attributes and cleans up generating attribute directly without emitting spurious events.
 */
export function restoreSendButtonUI() {
    if (typeof document === 'undefined') return;
    document.body.removeAttribute('data-mhc-cyoa-generating');
    const sendBtn = document.getElementById('send_but');
    if (sendBtn && sendBtn.getAttribute('data-mhc-locked')) {
        sendBtn.removeAttribute('data-mhc-locked');
        sendBtn.style.pointerEvents = '';
        sendBtn.style.opacity = '';
    }
    const sendText = document.getElementById('send_textarea');
    if (sendText && sendText.getAttribute('data-mhc-locked')) {
        sendText.removeAttribute('data-mhc-locked');
    }
}

/**
 * Resolves the token budget for Stage 2 CYOA choice generation.
 * Supports:
 * 1. Explicit user override in MultiHog / Companion settings (cyoaMaxTokens > 0).
 * 2. Dedicated connection (e.g. secondary Ollama/OpenAI profile).
 * 3. Default connection: Dynamically derives token budget from configured Main API
 *    context window (e.g. openai_max_context, max_context) minus estimated prompt size,
 *    providing full headroom for models requiring 4k-8k+ reasoning tokens (DeepSeek R1,
 *    Gemma 4, Qwen thinking variants).
 *
 * @param {object} [opts]
 * @param {object} [opts.rpgSettings] MultiHog / companion settings
 * @param {object} [opts.connSettings] Connection settings from concierge-connection
 * @param {Array<{role: string, content: string|Array}>} [opts.messages] Prompt messages
 * @param {object} [opts.context] Optional SillyTavern context override (for testing)
 * @returns {number} Token limit for the generation request
 */
export function resolveCyoaMaxTokens({ rpgSettings, connSettings, messages, context } = {}) {
    const ctx = context || (typeof globalThis.SillyTavern !== 'undefined' ? globalThis.SillyTavern.getContext?.() : null) || {};
    const companionSettings = ctx.extensionSettings?.multihog_companion || globalThis.extension_settings?.multihog_companion || {};

    // 1. Explicit user override takes top priority (MultiHog settings or Companion settings)
    const explicitOverride = Number(rpgSettings?.cyoaMaxTokens || companionSettings?.cyoaMaxTokens);
    if (!isNaN(explicitOverride) && explicitOverride > 0) {
        return Math.floor(explicitOverride);
    }

    // 2. Dedicated connection (profile, direct ollama, direct openai)
    if (connSettings && connSettings.connectionSource && connSettings.connectionSource !== 'default') {
        const dedicatedTokens = Number(connSettings.maxTokens);
        if (!isNaN(dedicatedTokens) && dedicatedTokens > 0) {
            return Math.floor(dedicatedTokens);
        }
    }

    // 3. Main API (default connection): dynamically derive from context window
    const mainApi = ctx.mainApi || globalThis.main_api || 'openai';

    let contextLimit = 0;

    // Check SillyTavern's global getMaxContextTokens helper if available
    if (typeof globalThis.getMaxContextTokens === 'function') {
        try {
            const raw = Number(globalThis.getMaxContextTokens());
            if (!isNaN(raw) && raw > 0) {
                contextLimit = raw;
            }
        } catch (_) {}
    }

    // Check OpenAI specific context size if mainApi is openai
    if (!contextLimit && mainApi === 'openai') {
        const oaiContext = Number(
            ctx.chatCompletionSettings?.openai_max_context ||
            globalThis.oai_settings?.openai_max_context
        );
        if (!isNaN(oaiContext) && oaiContext > 0) {
            contextLimit = oaiContext;
        }
    }

    // Check generic maxContext (context.maxContext or globalThis.max_context)
    if (!contextLimit) {
        const genContext = Number(ctx.maxContext || globalThis.max_context);
        if (!isNaN(genContext) && genContext > 0) {
            contextLimit = genContext;
        }
    }

    // Baseline fallback if context size cannot be determined: 8192
    if (!contextLimit || isNaN(contextLimit) || contextLimit <= 0) {
        contextLimit = 8192;
    }

    // Estimate prompt tokens (~3.2 chars/token for english/markdown, with a 250-token safety buffer for wrapper tags/role delimiters)
    let promptChars = 0;
    if (Array.isArray(messages)) {
        for (const msg of messages) {
            if (typeof msg?.content === 'string') {
                promptChars += msg.content.length;
            } else if (Array.isArray(msg?.content)) {
                for (const part of msg.content) {
                    if (part && typeof part.text === 'string') {
                        promptChars += part.text.length;
                    }
                }
            }
        }
    }
    const estimatedPromptTokens = Math.max(Math.ceil(promptChars / 3.2) + 250, 400);

    // Leave a 256-token headroom buffer
    const safetyBuffer = 256;
    let availableBudget = contextLimit - estimatedPromptTokens - safetyBuffer;

    // Minimum floor: at least 4096 if contextLimit >= 8192, else at least 2048 (or available remaining)
    const minFloor = contextLimit >= 8192 ? 4096 : Math.min(2048, contextLimit - estimatedPromptTokens);
    if (availableBudget < minFloor) {
        availableBudget = minFloor;
    }

    // If openai_max_tokens is configured on the main API and is >= 4096, clamp if availableBudget exceeds it
    const configuredMaxTokens = Number(
        ctx.chatCompletionSettings?.openai_max_tokens ||
        globalThis.oai_settings?.openai_max_tokens ||
        0
    );
    if (configuredMaxTokens >= 4096 && availableBudget > configuredMaxTokens) {
        availableBudget = configuredMaxTokens;
    }

    return Math.floor(availableBudget);
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
        abortStage2Cyoa('restart_stage2');
    }

    _isStage2Running = true;
    _activeCyoaAbortController = new AbortController();
    const signal = _activeCyoaAbortController.signal;

    try {
        // 1. Lock UI and show in-message spinner
        lockSendButtonUI();
        insertCyoaLoadingIndicator(messageId);

        // 2. Determine pipeline mode: Fast Pipelined vs. Sequential
        const fastPipeline = rpgSettings?.enableFastPipeline !== false;
        if (!fastPipeline) {
            const maxWait = Number(rpgSettings?.stateTrackerTimeoutMs) || 120000;
            const trackerOk = await waitForStateTracker(maxWait);
            if (signal.aborted) return false;
        } else {
            console.log('[MultiHog Companion] Fast Pipelined CYOA active. Formulating choices concurrently with background agents.');
        }

        // 3. Obtain State Memo baseline (active/turn-start memo)
        const freshMemo = rpgSettings?.currentMemo || SillyTavern.getContext?.()?.extensionSettings?.rpg_tracker?.currentMemo || '';

        // 4. Build Stage 2 prompt
        const { systemPrompt, userPrompt } = buildStage2CyoaPrompt({
            narrative,
            memo: freshMemo,
            isPbta,
            rpgSettings,
        });

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        // 5. Connection settings: reuse concierge/router settings or fallback to default
        const { sendRoutedLlmRequest, getConciergeConnectionSettings } = await import('./concierge-connection.js');
        const connSettings = getConciergeConnectionSettings();
        connSettings.maxTokens = resolveCyoaMaxTokens({
            rpgSettings,
            connSettings,
            messages,
        });

        console.log(`[MultiHog Companion] Decoupled CYOA Stage 2 token budget: ${connSettings.maxTokens}`);

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
            if (showToast) {
                showToast('warning', 'Decoupled CYOA did not produce valid choice buttons. Use /cyoagen to retry.', 'CYOA Engine');
            }
            return false;
        }

        // 8. Commit choices to active chat message and swipes
        const ctx = SillyTavern.getContext?.();
        const chat = ctx?.chat;
        if (!chat || !chat[messageId]) {
            console.warn('[MultiHog Companion] Target message not found in chat!');
            removeCyoaLoadingIndicator();
            restoreSendButtonUI();
            _isStage2Running = false;
            return false;
        }

        const currentMsg = chat[messageId];
        // Strip any residual footer if needed and append choices
        const cleanBaseText = String(currentMsg.mes || '')
            .replace(/<choices\b[^>]*>[\s\S]*?<\/choices\s*>/gi, '')
            .replace(/<div\b[^>]*\b(?:rt-cyoa-choices|mhc-cyoa-loading-badge)\b[^>]*>[\s\S]*?<\/div\s*>/gi, '')
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

        if (typeof ctx.saveChat === 'function') {
            ctx.saveChat();
        } else if (typeof ctx.saveChatDebounced === 'function') {
            ctx.saveChatDebounced();
        } else if (typeof globalThis.saveChatConditional === 'function') {
            globalThis.saveChatConditional();
        } else if (typeof globalThis.saveChatDebounced === 'function') {
            globalThis.saveChatDebounced();
        }

        // 9. Re-bind CYOA buttons and finalize styling via MultiHog's native DOM binder
        if (typeof globalThis._rpgFinalizeCyoaNarratorRender === 'function') {
            globalThis._rpgFinalizeCyoaNarratorRender();
        }

        if (showToast) {
            showToast('info', 'Tactical CYOA choices synchronized! 🧭', 'CYOA Engine');
        }

        console.log('[MultiHog Companion] Decoupled CYOA Stage 2 completed successfully.');
        return true;
    } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') {
            console.log('[MultiHog Companion] Decoupled CYOA generation was aborted by user/signal.');
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
