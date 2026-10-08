/**
 * pbta-companion-bridge.js — MultiHog Companion
 *
 * Implements non-invasive bridge to inform MultiHog's built-in Adventure Companion (CHAT)
 * of Powered by the Apocalypse (PbtA) rules and character context without modifying upstream code:
 *
 * 1. Strategy 1 (Macro Rules):
 *    Intercepts window.fetch for 'multihogDnDdoc.md'. Whenever the Adventure Companion's
 *    Tutorial Mode loads framework documentation, this appends an authoritative PbtA Narrative
 *    Engine guide dynamically tailored to the currently active campaign genre.
 *
 * 2. Strategy 3 (Micro State):
 *    Detects active campaign genre and character positioning from the state memo,
 *    enabling the Companion to inspect and advise on live stats, playbook moves, and Harm.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';

let _originalFetch = null;
let _interceptorActive = false;

/**
 * Detects the active PbtA genre from MultiHog settings, memo, or stored preferences.
 *
 * @param {object} [customContext] Optional context for testing or direct override
 * @param {string} [customContext.lastGenre]
 * @param {string} [customContext.currentMemo]
 * @param {object} [customContext.rpgSettings]
 * @returns {string} Canonical genre key in PBTA_GENRES (e.g. 'fantasy', 'scifi', 'western')
 */
export function detectActiveGenre(customContext = {}) {
    // 1. Direct explicit genre override
    if (customContext.lastGenre && PBTA_GENRES[customContext.lastGenre]) {
        return customContext.lastGenre;
    }

    // 2. MultiHog Companion extension settings
    try {
        const extSettings = typeof globalThis !== 'undefined'
            ? globalThis.SillyTavern?.getContext?.()?.extensionSettings?.multihog_companion
            : null;
        if (extSettings?.lastGenre && PBTA_GENRES[extSettings.lastGenre]) {
            return extSettings.lastGenre;
        }
    } catch (_) { /* ignore */ }

    // 3. Inspect active state memo content for genre signature stats
    const memo = customContext.currentMemo
        || (typeof globalThis !== 'undefined'
            ? globalThis.SillyTavern?.getContext?.()?.extensionSettings?.rpg_tracker?.currentMemo
            : '');

    if (memo && typeof memo === 'string') {
        const memoLower = memo.toLowerCase();
        if (/\b(grit|quick|iron|instinct|savvy)\b/.test(memoLower)) return 'western';
        if (/\b(cool|edge|hard|mind|synth)\b/.test(memoLower)) return 'scifi';
        if (/\b(danger|freak|savior|superior|mundane)\b/.test(memoLower)) return 'anime';
        if (/\b(cool|hard|hot|sharp|weird)\b/.test(memoLower)) return 'horror';
        if (/\b(panache|brawn|daring|wits|charm)\b/.test(memoLower) && /\b(cutlass|rigging|pirate|parley)\b/.test(memoLower)) return 'pirate';
        if (/\b(frame|engines|sensors|systems|pilot)\b/.test(memoLower)) return 'mecha';
        if (/\b(might|agility|wits|heart|arcana)\b/.test(memoLower)) return 'fantasy';
    }

    // 4. Default fallback
    return 'fantasy';
}

/**
 * Generates an authoritative PbtA Narrative Engine guide dynamically tailored
 * to the specified genre.
 *
 * @param {string} genreKey Key from PBTA_GENRES
 * @returns {string} Markdown documentation section
 */
export function buildTailoredPbtaDocumentation(genreKey = 'fantasy') {
    const activeKey = PBTA_GENRES[genreKey] ? genreKey : 'fantasy';
    const active = PBTA_GENRES[activeKey];

    // Build other genres quick-reference summary
    const otherGenresList = Object.entries(PBTA_GENRES)
        .filter(([key]) => key !== activeKey)
        .map(([, g]) => `* **${g.icon} ${g.label}:** Stats (${g.stats.join(', ')})`)
        .join('\n');

    return `

# Powered by the Apocalypse (PbtA) Framework Guide

> [!IMPORTANT]
> This campaign uses the **MultiHog PbtA Narrative Engine**. When PbtA is active, replace standard d20, DC targets, initiative orders, spell slots, and turn rounds with fiction-first conversational roleplay and 2d6 Moves.

---

## 🎲 1. Core 2d6 Move Resolution
Whenever a player action triggers a Move in the narrative, resolve using **2d6 + Stat Modifier** (-1 to +2):

| Roll Total | Outcome Tier | Narrative Consequence |
| :--- | :--- | :--- |
| **10+** | **Strong Hit** (Full Success) | You achieve your goal cleanly without cost, harm, or complications. |
| **7–9** | **Weak Hit** (Mixed Success) | You succeed, but at a cost, complication, compromise, or enemy counter-attack. |
| **6-** | **Miss** (Trouble / Complication) | Failure or serious complication! The GM makes a hard move and the player marks **+1 XP**. |

* **Zero-Touch RNG:** Players do not manually roll dice. SillyTavern supplies pre-rolled dice from its background queue directly to the Game Master / Ref.
* **No Initiative or Enemy Rolls:** Combat is a fluid conversation. Enemies do not roll attack bonuses or saving throws; their actions unfold when the player rolls a 7–9 or 6-, or hesitates in the fiction.
* **Harm Clock (0–5):** Health is tracked via Harm (0 = unharmed, 5 = incapacitated/fatal). Armor directly reduces incoming Harm (e.g. Armor 1 turns 2 Harm into 1 Harm).

---

## 🎭 2. Active Campaign Genre: ${active.label} ${active.icon}

### Core Stats (Modifier Array: +2, +1, +1, 0, -1)
${active.statDescriptions}

### Key Moves & Fictional Triggers
${active.moves.map(m => `* **${m}**`).join('\n')}

### Typical Playbook Archetypes
${active.archetypes.join(', ')}

---

## 💡 3. Guidelines for Adventure Companion (CHAT)
1. **Brainstorming & Fictional Moves:**
   * Suggest moves that naturally fit what the player wants to do in the fiction.
   * Reference the player's active stats from the State Memo to suggest their strongest approaches.
2. **Interpreting Weak Hits (7–9):**
   * Treat 7–9 as success with a catch: offer dramatic compromises, sacrifices, hard choices, or temporary set-backs rather than outright failure.
3. **State Tracker Commands (\`command_state_tracker\`):**
   * Use PbtA Harm (e.g., \`Harm: 2/5\`) and debilities (e.g., \`(-) Shaken: -1 Wits\`) instead of D&D HP bloat or spell slots.
4. **Acting for the Player (\`act_for_user\`):**
   * When CYOA choices are present, look for move triggers (\`[Move (+Stat)]\`).
   * When composing free-form actions, write concise in-character fictional moves that trigger the active genre's mechanics.

---

## 📚 4. Other Available PbtA Genres (Quick Reference)
${otherGenresList}
`;
}

/**
 * Appends tailored PbtA documentation to the upstream framework manual text.
 *
 * @param {string} originalManual Content of multihogDnDdoc.md
 * @param {string} [genreKey] Active genre key
 * @returns {string} Augmented documentation string
 */
export function appendPbtaDocsToManual(originalManual, genreKey) {
    const effectiveGenre = genreKey || detectActiveGenre();
    const pbtaSection = buildTailoredPbtaDocumentation(effectiveGenre);
    return `${originalManual || ''}\n\n---\n\n${pbtaSection}`;
}

/**
 * Installs the window.fetch interceptor to hook 'multihogDnDdoc.md' requests
 * originating from the Adventure Companion.
 */
export function setupCompanionDocInterceptor() {
    if (typeof window === 'undefined' || !window.fetch) return;
    if (_interceptorActive || window.fetch.__mhcDocBridgeInstalled) return;

    _originalFetch = window.fetch;

    const interceptedFetch = async function (input, init) {
        const url = typeof input === 'string'
            ? input
            : (input instanceof Request ? input.url : String(input || ''));

        if (url && (url.includes('multihogDnDdoc.md') || url.endsWith('multihogDnDdoc.md'))) {
            try {
                const response = await _originalFetch.call(this, input, init);
                if (response && response.ok) {
                    const originalText = await response.text();
                    const genreKey = detectActiveGenre();
                    const augmentedText = appendPbtaDocsToManual(originalText, genreKey);
                    return new Response(augmentedText, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                    });
                }
                return response;
            } catch (err) {
                console.warn('[MultiHog Companion] Fallback: Could not augment companion documentation fetch:', err);
            }
        }

        return _originalFetch.apply(this, arguments);
    };

    interceptedFetch.__mhcDocBridgeInstalled = true;
    window.fetch = interceptedFetch;
    _interceptorActive = true;
    console.log('[MultiHog Companion] Adventure Companion PbtA documentation bridge installed.');
}

/**
 * Uninstalls the window.fetch interceptor (useful for teardown or clean test runs).
 */
export function teardownCompanionDocInterceptor() {
    if (typeof window === 'undefined') return;
    if (_interceptorActive && _originalFetch) {
        window.fetch = _originalFetch;
        _originalFetch = null;
        _interceptorActive = false;
    }
}
