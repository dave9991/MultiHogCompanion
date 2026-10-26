/**
 * relationship-narrative-sync.js — MultiHog Companion
 *
 * Synchronizes MultiHog NPC relationships with SillyTavern lorebook narratives:
 *
 * 1. Direction A (Day 1 / First Encounter):
 *    Scans the NPC's lorebook entry to evaluate starting friendship & affection
 *    toward the PC. Runs ONCE EVER per NPC (no-op if already seeded or synced).
 *    Strictly assigns (0, 0) if the NPC has not met the PC or is an unaffiliated third party.
 *
 * 2. Direction B (Narrative Evolution / Tier Crossovers):
 *    Monitors relationship scores. When an NPC crosses a major MultiHog tier boundary,
 *    triggers an LLM completion using MultiHog's configured State Tracker connection to
 *    perform a full, cohesive rewrite of the lorebook entry.
 *    Eliminates narrative contradictions while preserving backstory, traits, and appearance.
 *
 * STRICT CONSTRAINT: Does not modify any upstream MultiHog files.
 */

import { isAdventureActive } from './adventure-chat.js';
import { stripThinkingContent, isReasoningDump } from './concierge-connection.js';

const EXTENSION_NAME = 'multihog_companion';

function getExtSettings() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object') return ctx.extensionSettings;
    return (typeof extension_settings !== 'undefined' ? extension_settings : (globalThis.extension_settings || {})) || {};
}

function getMultiHogSettings() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const fromCtx = ctx?.extensionSettings?.rpg_tracker;
    if (fromCtx && typeof fromCtx === 'object') return fromCtx;
    const ext = getExtSettings();
    if (ext.rpg_tracker && typeof ext.rpg_tracker === 'object') return ext.rpg_tracker;
    // Fallback if structured under multihog_dnd in legacy mock environments
    if (ext.multihog_dnd?.rpgSettings) return ext.multihog_dnd.rpgSettings;
    ext.rpg_tracker = ext.rpg_tracker || {};
    return ext.rpg_tracker;
}

function triggerSaveMultiHogSettings() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (typeof ctx?.saveSettingsDebounced === 'function') {
        try { ctx.saveSettingsDebounced(); } catch (_) {}
    } else if (typeof globalThis.saveSettingsDebounced === 'function') {
        try { globalThis.saveSettingsDebounced(); } catch (_) {}
    }
}

function triggerSaveMetadata() {
    if (typeof saveMetadataDebounced === 'function') {
        try { saveMetadataDebounced(); } catch (_) {}
    } else if (typeof globalThis.saveMetadataDebounced === 'function') {
        try { globalThis.saveMetadataDebounced(); } catch (_) {}
    }
}

async function sendLlmPrompt(connSettings, messages) {
    const conn = await import('./concierge-connection.js');
    return await conn.sendRoutedLlmRequest(connSettings, messages, { callerName: 'Relationship Sync' });
}

// ── 1. MultiHog Tier Math (Percentage-of-Max Thresholds) ───────────────────────

/**
 * Sanitizes and validates an LLM-proposed [CORE] field value ('Personality' or 'Habits/Behaviors').
 * Rejects nullish keywords, echoed field headers followed by placeholders, and ellipsis truncations ("...").
 * @param {unknown} rawVal
 * @param {'personality'|'habits'|string} [field='']
 * @returns {string|null}
 */
export function sanitizeCoreFieldUpdate(rawVal, field = '') {
    if (typeof rawVal !== 'string') return null;
    let val = rawVal.trim();
    if (!val) return null;

    // Strip surrounding quotes if the model double-wrapped the string
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
    }

    // Strip echoed field header prefixes (e.g. "Personality: ...", "**Habits/Behaviors:** ...")
    const headerPrefixRegex = /^habits/i.test(field)
        ? /^(?:[*_~`#>\-\s])*(?:Habits\s*(?:\/|&|and)\s*Behaviors|Habits|Behaviors)(?:[*_~`]*)\s*:\s*/i
        : /^personality/i.test(field)
            ? /^(?:[*_~`#>\-\s])*(?:Personality|Demeanor)(?:[*_~`]*)\s*:\s*/i
            : /^(?:[*_~`#>\-\s])*(?:Personality|Demeanor|Habits\s*(?:\/|&|and)\s*Behaviors|Habits|Behaviors)(?:[*_~`]*)\s*:\s*/i;

    while (headerPrefixRegex.test(val)) {
        val = val.replace(headerPrefixRegex, '').trim();
    }

    if (!val) return null;

    // Reject explicit no-change / nullish sentinel strings (properly grouped so 'none' inside prose is NOT matched)
    if (/^(?:null|nil|none|n\/a|na|no\s+changes?|unchanged|same(?:\s+as\s+before)?|keep\s+existing|not\s+applicable|nothing|\(no\s+changes?\)|\[no\s+changes?\]|\(unchanged\)|\[unchanged\]|\(none\)|\[none\])$/i.test(val)) {
        return null;
    }

    // Reject strings composed solely of dots, ellipses, dashes, brackets, or punctuation
    if (/^[\s.…\-_*~`[\]()'"/\\:;!?]+$/.test(val)) {
        return null;
    }

    // Reject ellipsis placeholders/truncations (e.g. "...", "Personality: ...", "... now warmer toward X")
    if (/\.{3,}|…/.test(val)) {
        return null;
    }

    // Require meaningful descriptive prose (at least 8 alphanumeric characters)
    const alphaNumCount = (val.match(/[A-Za-z0-9]/g) || []).length;
    if (alphaNumCount < 8) {
        return null;
    }

    return val;
}

/**
 * Surgically patches a labeled section (e.g. 'Personality' or 'Habits/Behaviors')
 * inside a [CORE] block string without modifying other sections.
 * Matches MultiHog upstream router-utils.js patchLabeledSection.
 * @param {string} text
 * @param {string} field
 * @param {string} newContent
 * @returns {{ ok: boolean, text: string }}
 */
export function patchLabeledSection(text, field, newContent) {
    if (!field || newContent == null || String(newContent).trim() === '') {
        return { ok: false, text: text || '' };
    }
    const body = typeof text === 'string' ? text : '';

    let fieldPatterns = [field.trim()];
    if (/^personality$/i.test(field)) {
        fieldPatterns = ['Personality'];
    } else if (/^habits/i.test(field)) {
        fieldPatterns = ['Habits/Behaviors', 'Habits & Behaviors', 'Habits', 'Behaviors'];
    }

    const sanitizedValue = (/^(?:personality|habits)/i.test(field))
        ? sanitizeCoreFieldUpdate(String(newContent), field)
        : String(newContent).trim();

    if (!sanitizedValue) {
        return { ok: false, text: body };
    }

    const escapedPatterns = fieldPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const leadingLabelRegex = new RegExp(`^(?:[*_~\\s])*(?:${escapedPatterns.join('|')})(?:[*_~]*)\\s*:\\s*`, 'i');
    let replacementValue = sanitizedValue;
    while (leadingLabelRegex.test(replacementValue)) {
        replacementValue = replacementValue.replace(leadingLabelRegex, '').trim();
    }
    if (!replacementValue) {
        return { ok: false, text: body };
    }

    const otherHeaders = [
        'Species',
        'Body', 'Appearance/Species', 'Appearance',
        'Worn Equipment', 'Equipment',
        'Personality',
        'Brief Background', 'Background',
        'Habits/Behaviors', 'Habits & Behaviors', 'Habits', 'Behaviors',
        'Strengths', 'Flaws',
        'Combat Profile',
        'Relationship',
    ];

    for (const rawLine of body.split('\n')) {
        const hm = rawLine.trim().match(/^([A-Z][A-Za-z0-9 \/&]+?)\s*:/);
        if (hm) {
            const nm = hm[1].trim();
            if (!otherHeaders.includes(nm)) otherHeaders.push(nm);
        }
    }

    const otherHeadersRegexStr = otherHeaders.map(h => {
        const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (h === 'Background') return '(?<!Brief\\s)Background';
        if (h === 'Behaviors') return '(?<!Habits\\/)(?<!Habits & )(?<!Habits and )Behaviors';
        if (h === 'Appearance') return '(?<!/)Appearance(?!\\/Species)';
        if (h === 'Equipment') return '(?<!Worn\\s)Equipment';
        return esc;
    }).join('|');

    // Anchor both the target header and the terminating lookahead header to line boundaries
    // so mid-sentence colons (e.g. "values relationship: trust") cannot truncate or mis-match sections.
    const targetFieldRegex = new RegExp(
        `(?:^|\\n)([ \\t]*(?:${escapedPatterns.join('|')})\\s*:)([\\s\\S]*?)(?=\\n[ \\t]*(?:${otherHeadersRegexStr})\\s*:|$)`,
        'i'
    );
    const fieldMatch = body.match(targetFieldRegex);

    if (!fieldMatch) {
        const fieldName = fieldPatterns[0] || field.trim();
        const replacement = `${fieldName}: ${replacementValue}\n`;
        let newBody = body.trimEnd();
        newBody = newBody ? `${newBody}\n${replacement}` : replacement;
        return { ok: true, text: newBody };
    }

    const matchedFieldName = fieldMatch[1];
    const targetSubstring = `${matchedFieldName}${fieldMatch[2]}`;
    const trailingEndsAtEof = (fieldMatch.index + fieldMatch[0].length) >= body.length;
    const replacement = `${matchedFieldName} ${replacementValue}${trailingEndsAtEof ? '\n' : ''}`;
    return { ok: true, text: body.replace(targetSubstring, () => replacement) };
}

/**
 * Applies a tier crossover update to an NPC lorebook entry.
 * - If [CORE]...[/CORE] exists:
 *   Surgically patches Personality and Habits/Behaviors inside [CORE].
 *   Appends the milestone to the ## Narrative Chronicle section below [/CORE].
 *   Preserves Species, Body, Worn Equipment, Combat Profile, and all past chronicles.
 * - If [CORE] does not exist (fallback for vanilla cards):
 *   Preserves the entire existing text and appends the milestone at the bottom.
 * @param {string} existingContent
 * @param {{ milestone: string, personality?: string|null, habits?: string|null }} update
 * @param {string} [timestamp='']
 * @returns {string}
 */
export function patchNpcLorebookEntry(existingContent, update, timestamp = '') {
    if (!existingContent || !update || !update.milestone) {
        return existingContent || '';
    }

    const timePrefix = timestamp ? `[${timestamp}] ` : '';
    const milestoneLine = `- ${timePrefix}Relationship Milestone: ${update.milestone.trim()}`;

    const coreMatch = existingContent.match(/\[CORE\]([\s\S]*?)\[\/CORE\]/i);

    if (coreMatch) {
        let coreInner = coreMatch[1];
        const cleanPersonality = sanitizeCoreFieldUpdate(update.personality, 'personality');
        if (cleanPersonality) {
            const pRes = patchLabeledSection(coreInner, 'Personality', cleanPersonality);
            if (pRes.ok) coreInner = pRes.text;
        }
        const cleanHabits = sanitizeCoreFieldUpdate(update.habits, 'habits');
        if (cleanHabits) {
            const hRes = patchLabeledSection(coreInner, 'Habits/Behaviors', cleanHabits);
            if (hRes.ok) coreInner = hRes.text;
        }

        let updatedEntry = existingContent.replace(coreMatch[0], () => `[CORE]${coreInner}[/CORE]`);

        // Append milestone to chronicle below [/CORE]
        const coreCloseIdx = updatedEntry.search(/\[\/CORE\]/i);
        const afterCore = coreCloseIdx >= 0 ? updatedEntry.slice(coreCloseIdx + 7) : '';
        if (/##\s*(?:Narrative\s+)?Chronicle/i.test(afterCore)) {
            updatedEntry = updatedEntry.trimEnd() + `\n${milestoneLine}`;
        } else {
            updatedEntry = updatedEntry.trimEnd() + `\n\n## Narrative Chronicle\n${milestoneLine}`;
        }

        return updatedEntry;
    }

    // Fallback for non-[CORE] entries: leave text untouched and append milestone at the bottom
    return `${existingContent.trimEnd()}\n\n${milestoneLine}`;
}

/**
 * Extracts up to maxPairs of clean user-assistant dialogue pairs from chat history.
 * Explicitly filters out system messages, tool calls, and hidden tracker injection memos.
 * @param {Array<object>} chat
 * @param {number} [maxPairs=3]
 * @returns {Array<{ user: string, assistant: string }>}
 */
export function extractRecentDialoguePairs(chat, maxPairs = 3) {
    if (!Array.isArray(chat) || chat.length === 0) return [];

    const pairs = [];
    let currentAssistant = null;

    for (let i = chat.length - 1; i >= 0 && pairs.length < maxPairs; i--) {
        const msg = chat[i];
        if (!msg || typeof msg !== 'object') continue;
        if (msg.is_system) continue;
        if (msg.extra?.type === 'tool') continue;
        if (msg.extra?.tool_calls && Array.isArray(msg.extra.tool_calls) && msg.extra.tool_calls.length > 0 && !msg.mes?.trim()) continue;

        const text = String(msg.mes || '').trim();
        if (!text) continue;

        // Skip tracker memos or hidden prompt injections
        if (/^\[(?:RPG|STATE|TIME|INVENTORY|STATUS|MEMO)\]/i.test(text)) continue;

        if (!msg.is_user) {
            if (!currentAssistant) {
                currentAssistant = text;
            }
        } else {
            if (currentAssistant) {
                pairs.unshift({
                    user: text,
                    assistant: currentAssistant,
                });
                currentAssistant = null;
            }
        }
    }

    return pairs;
}

/**
 * Resolves the current in-game timestamp from MultiHog state memo if present.
 * @param {string} [chatId]
 * @returns {string}
 */
export function getInGameTimestamp(chatId) {
    try {
        const rpg = getMultiHogSettings();
        const memo = (chatId && rpg.chatStates?.[chatId]?.currentMemo) || rpg.currentMemo || '';
        const timeMatch = memo.match(/\[TIME\]([\s\S]*?)\[\/TIME\]/i);
        if (timeMatch) {
            const raw = timeMatch[1].trim();
            const firstLine = raw.split('\n')[0].replace(/^[A-Za-z]+:\s*/, '').trim();
            if (firstLine) return firstLine;
        }
    } catch (_) {}
    return '';
}

/**
 * Maps a friendship value to a tier label and behavioral hint.
 * Matches MultiHog upstream relationship-math.js.
 * @param {number} value
 * @param {number} [max=150]
 * @returns {{ label: string, hint: string }}
 */
export function getFriendshipTier(value, max = 150) {
    const m = max || 150;
    const v = Math.max(-m, Math.min(m, Math.round(Number(value) || 0)));
    if (v <= -0.85 * m) return { label: 'HOSTILE', hint: 'open contempt, refuses cooperation, may sabotage or attack' };
    if (v <= -0.65 * m) return { label: 'ENEMY/HATEFUL', hint: 'deeply despises you, actively seeks to undermine your goals' };
    if (v <= -0.45 * m) return { label: 'BITTER/RESENTFUL', hint: 'hostile tone, holds active grudges, quick to anger' };
    if (v <= -0.25 * m) return { label: 'UNFRIENDLY/COLD', hint: 'curt and guarded, answers with bare minimum, visible irritation' };
    if (v <= -0.10 * m) return { label: 'DISTRUSTFUL/GUARDED', hint: 'suspicious of your motives, keeps a physical and emotional distance' };
    if (v <= -0.03 * m) return { label: 'WARY/UNEASY', hint: 'polite but distant, avoids personal topics, second-guesses motives' };
    if (v <=  0.03 * m) return { label: 'NEUTRAL/ACQUAINTANCE', hint: 'civil and transactional, neither warm nor cold' };
    if (v <=  0.10 * m) return { label: 'WARMING/FAVORABLE', hint: 'small smiles, starting to open up, shows basic goodwill' };
    if (v <=  0.25 * m) return { label: 'AMICABLE', hint: 'pleasant and chatty, actively engages in conversation, cooperative' };
    if (v <=  0.45 * m) return { label: 'FRIENDLY', hint: 'genuine warmth, light humor, willing to help when asked' };
    if (v <=  0.65 * m) return { label: 'CLOSE FRIEND', hint: 'deep trust, confides worries, stands up for you, proactive help' };
    if (v <=  0.85 * m) return { label: 'DEEP BOND/TRUSTED', hint: 'fiercely protective, emotional bedrock, treats you as inner circle' };
    return { label: 'BONDED/FAMILY', hint: 'unbreakable loyalty, would risk life without hesitation, shares deepest secrets' };
}

/**
 * Maps an affection value to a tier label and behavioral hint.
 * Matches MultiHog upstream relationship-math.js.
 * @param {number} value
 * @param {number} [max=150]
 * @returns {{ label: string, hint: string }}
 */
export function getAffectionTier(value, max = 150) {
    const m = max || 150;
    const v = Math.max(-m, Math.min(m, Math.round(Number(value) || 0)));
    if (v <= -0.85 * m) return { label: 'REVULSION', hint: 'finds your presence repulsive, recoils from proximity, hostile to advances' };
    if (v <= -0.65 * m) return { label: 'DISGUSTED', hint: 'active disdain for romantic or physical proximity, harsh rejections' };
    if (v <= -0.45 * m) return { label: 'AVERSION', hint: 'clearly uninterested, dismisses flirtation coldly, steers away from intimacy' };
    if (v <= -0.25 * m) return { label: 'AVOIDANT', hint: 'uncomfortable with romantic attention, subtly creates physical distance' };
    if (v <= -0.10 * m) return { label: 'UNRECEPTIVE/WITHDRAWN', hint: 'shuts down romantic undertones, visibly uncomfortable with flirting' };
    if (v <= -0.03 * m) return { label: 'INDIFFERENT/UNINTERESTED', hint: 'no romantic spark, gentle deflection of any advances' };
    if (v <=  0.03 * m) return { label: 'NEUTRAL/NO AFFECTION', hint: 'no romantic or emotional attachment toward you' };
    if (v <=  0.10 * m) return { label: 'CURIOUS/INTRIGUED', hint: 'brief lingering looks, testing waters, open to playful banter' };
    if (v <=  0.25 * m) return { label: 'RECEPTIVE/FLIRTATIOUS', hint: 'actively returns flirting, welcomes light physical touch, playful tension' };
    if (v <=  0.45 * m) return { label: 'INTERESTED', hint: 'steals glances, responds warmly to compliments, comfortable with proximity' };
    if (v <=  0.65 * m) return { label: 'ATTRACTED', hint: 'seeks your company, flustered by bold compliments, visible tension' };
    if (v <=  0.85 * m) return { label: 'SMITTEN/INFATUATED', hint: 'cannot hide feelings, heavily romantic, deeply emotionally invested' };
    return { label: 'DEEPLY IN LOVE', hint: 'emotionally devoted, craves closeness, expresses tenderness openly' };
}

// ── 2. Prompt Builders & Parsers ──────────────────────────────────────────────

/**
 * Direction A: Prompt to evaluate starting relationship from NPC narrative text.
 * @param {string} npcName
 * @param {string} npcContent
 * @param {string} pcName
 * @returns {Array<{ role: string, content: string }>}
 */
export function buildDirectionAPrompt(npcName, npcContent, pcName) {
    const safeNpc = npcName || 'the NPC';
    const safePc = pcName || 'the Protagonist';

    const systemPrompt = `You are an objective RPG relationship evaluator.
Your sole job is to evaluate the starting interpersonal bond of ${safeNpc} toward ${safePc}.

CRITICAL EVALUATION RULES:
1. Evaluate ONLY what ${safeNpc} feels toward ${safePc} (one-directional). Do NOT evaluate what ${safePc} feels toward ${safeNpc}.
2. If ${safeNpc} has not met ${safePc} yet, has no established personal history with ${safePc}, or is an unaffiliated third party (e.g. bandit, stranger, guard, neutral shopkeeper), you MUST strictly assign 0 Friendship and 0 Affection.
3. Only assign non-zero values if the text explicitly describes a pre-existing bond, allegiance, rivalry, friendship, debt, or romantic history with ${safePc}.
4. Scale Range:
   - Friendship: -150 to +150 (Hostile = -100, Distrustful = -40, Neutral/Stranger = 0, Amicable = +25, Friendly = +50, Devoted Ally = +100)
   - Affection: -150 to +150 (Revulsion = -100, Indifferent = 0, Flirtatious/Crush = +30, Deep Romance = +80)

Respond strictly in valid JSON format. Do NOT include thinking tags (<think>), chain-of-thought contemplation, or commentary:
{
  "friendship": <integer -150 to 150>,
  "affection": <integer -150 to 150>,
  "reason": "<brief 1-sentence rationale>"
}`;

    const userPrompt = `NPC NAME: ${safeNpc}
PROTAGONIST: ${safePc}

NPC LOREBOOK DESCRIPTION:
${npcContent}

Evaluate ${safeNpc}'s starting friendship and affection toward ${safePc}:`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Extracts and parses a balanced JSON object from raw model output,
 * resilient to stray braces in preambles or inside string literals.
 * @param {string} text
 * @returns {object|null}
 */
function parseBalancedJsonObject(text) {
    if (!text || typeof text !== 'string') return null;

    const candidates = [];
    let depth = 0;
    let startIdx = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === '{') {
            if (depth === 0) startIdx = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && startIdx !== -1) {
                    candidates.push(text.slice(startIdx, i + 1));
                    startIdx = -1;
                }
            }
        }
    }

    // Prefer the last valid JSON object in the output (after any preamble/scratchpad)
    for (let i = candidates.length - 1; i >= 0; i--) {
        try {
            const parsed = JSON.parse(candidates[i]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Direction A: Parses the JSON response from the evaluator model.
 * Strips reasoning/thinking tags before matching JSON to prevent scratchpad braces from being parsed.
 * @param {string} rawText
 * @returns {{ friendship: number, affection: number, reason: string } | null}
 */
export function parseDirectionAResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const cleanText = stripThinkingContent(rawText);
    const parsed = parseBalancedJsonObject(cleanText) || parseBalancedJsonObject(rawText);
    if (!parsed) return null;
    if (typeof parsed.friendship === 'number' && typeof parsed.affection === 'number') {
        return {
            friendship: Math.max(-150, Math.min(150, Math.round(parsed.friendship))),
            affection: Math.max(-150, Math.min(150, Math.round(parsed.affection))),
            reason: String(parsed.reason || '').trim(),
        };
    }
    return null;
}

/**
 * Direction B: Prompt for conservative relationship milestone and optional demeanor nuance.
 * @param {string} npcName
 * @param {string} currentContent
 * @param {string} pcName
 * @param {Array<object>} recentLogs
 * @param {{ label: string, hint: string }} targetFriendshipTier
 * @param {{ label: string, hint: string }} targetAffectionTier
 * @param {Array<{ user: string, assistant: string }>} [dialoguePairs=[]]
 * @returns {Array<{ role: string, content: string }>}
 */
export function buildDirectionBPrompt(npcName, currentContent, pcName, recentLogs, targetFriendshipTier, targetAffectionTier, dialoguePairs = []) {
    const safeNpc = npcName || 'the NPC';
    const safePc = pcName || 'the Protagonist';

    const formattedLogs = (recentLogs && recentLogs.length > 0)
        ? recentLogs.map(l => `• [${l.field?.toUpperCase() || 'DELTA'} ${l.delta >= 0 ? '+' : ''}${l.delta}] New Value: ${l.newValue}${l.reason ? ` (${l.reason})` : ''}`).join('\n')
        : '(Relationship points shifted through ongoing gameplay)';

    const formattedDialogue = (dialoguePairs && dialoguePairs.length > 0)
        ? dialoguePairs.map((p, idx) => `[Scene Exchange ${idx + 1}]\n${safePc}: ${p.user}\n${safeNpc}/Narrator: ${p.assistant}`).join('\n\n')
        : '(Recent dialogue unavailable)';

    const systemPrompt = `You are an expert RPG narrative author.
The relationship between ${safeNpc} and the protagonist ${safePc} has crossed a milestone boundary.

Your job is to generate a relationship chronicle milestone and, ONLY IF STRICTLY WARRANTED, a conservative nuance to their demeanor.

CRITICAL GUIDELINES:
1. CONSERVATIVE BY DEFAULT: Characters rarely undergo total personality overhauls. A cynical, blunt character remains cynical and blunt; an enemy who becomes an ally is still cautious. In most cases, NO changes to Personality or Habits are needed — return literal JSON null for both.
2. FULL FIELD REPLACEMENT (NEVER USE "..." OR PLACEHOLDERS): When "personality" or "habits" is non-null, your string value REPLACES the entire existing section in [CORE]. You MUST retain all of ${safeNpc}'s existing core traits/habits and weave in the subtle nuance toward ${safePc}. NEVER output "...", "Personality: ...", "unchanged", or a short fragment that discards their existing baseline description. Do NOT prefix the string with the field label ("Personality:" or "Habits/Behaviors:").
3. BOTH PROGRESSION AND DETERIORATION: Relationships can deepen or deteriorate. If the bond dropped to a negative tier (Bitter, Hostile, Distrustful), document the grievance or falling out in the milestone, and adjust demeanor accordingly if warranted. If the bond improved, record how trust or affection was earned.
4. PRESERVE ALL OTHER FIELDS: Never modify or invent Species, Body, Equipment, Background, or Combat Profile.
5. MILESTONE: Always provide a concise 1-2 sentence chronicle entry summarizing the moment or shift in standing between ${safeNpc} and ${safePc}.

Respond STRICTLY in valid JSON format with NO markdown code fences (\`\`\`) and NO conversational filler:
{
  "milestone": "<concise 1-2 sentence relationship milestone log>",
  "personality": <complete updated Personality string preserving existing traits + nuance toward ${safePc} ONLY if warranted, otherwise null>,
  "habits": <complete updated Habits/Behaviors string preserving existing habits + nuance toward ${safePc} ONLY if warranted, otherwise null>
}`;

    const userPrompt = `NPC NAME: ${safeNpc}
PROTAGONIST: ${safePc}

RECENT RELATIONSHIP LOG:
${formattedLogs}

RECENT CONVERSATION (LAST 3 EXCHANGES):
${formattedDialogue}

CURRENT LOREBOOK ENTRY FOR ${safeNpc}:
${currentContent}

NEW ATTITUDE STANDINGS:
- Friendship Tier: ${targetFriendshipTier.label} (${targetFriendshipTier.hint})
- Affection Tier: ${targetAffectionTier.label} (${targetAffectionTier.hint})

Evaluate the relationship milestone and any subtle demeanor adjustments:`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Direction B: Parses and cleans the structured milestone response.
 * Strips reasoning tokens, code fences, conversational preambles, echoed labels, and ellipsis placeholders.
 * @param {string} rawText
 * @returns {{ milestone: string, personality: string | null, habits: string | null } | null}
 */
export function parseDirectionBResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    if (isReasoningDump(rawText)) {
        return null;
    }
    let clean = stripThinkingContent(rawText);
    clean = clean.replace(/^```(?:json|markdown|text)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    const parsed = parseBalancedJsonObject(clean);
    if (!parsed) return null;

    const rawMilestone = typeof parsed.milestone === 'string' ? parsed.milestone.trim() : '';
    if (!rawMilestone || /^(?:null|nil|none|n\/a|\.+|…+)$/i.test(rawMilestone)) {
        return null;
    }

    const personality = sanitizeCoreFieldUpdate(parsed.personality, 'personality');
    const habits = sanitizeCoreFieldUpdate(parsed.habits, 'habits');

    return { milestone: rawMilestone, personality, habits };
}

// ── 3. Connection & State Helpers ─────────────────────────────────────────────

/**
 * Reads MultiHog's configured State Tracker connection parameters.
 * Falls back to default if not configured.
 * Leaves maxTokens at 0 so resolveConciergeMaxTokens can allocate proper reasoning headroom.
 * @returns {object}
 */
export function getStateTrackerConnectionSettings() {
    const s = getMultiHogSettings();

    return {
        connectionSource: s.connectionSource || 'default',
        connectionProfileId: s.connectionProfileId || '',
        completionPresetId: s.completionPresetId || '',
        ollamaUrl: s.ollamaUrl || 'http://localhost:11434',
        ollamaModel: s.ollamaModel || '',
        openaiUrl: s.openaiUrl || '',
        openaiKey: s.openaiKey || '',
        openaiModel: s.openaiModel || '',
        maxTokens: 0,
    };
}

/**
 * Resolves active protagonist / player character name.
 * @returns {string}
 */
export function resolveActiveProtagonistName() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (ctx?.chat_metadata?.character_name) return ctx.chat_metadata.character_name;
    if (ctx?.name1) return ctx.name1;
    return 'The Protagonist';
}

/**
 * In-memory ledger fallback if chat_metadata is not yet mounted.
 */
const inMemorySyncLedger = new Map();

/**
 * Retrieves the relationship sync ledger for a chat.
 * Guards against cross-chat bleed if an explicit chatId differs from the currently active chat.
 * @param {string} [chatId]
 * @returns {Record<string, object>}
 */
export function getRelationshipSyncLedger(chatId = '') {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (ctx?.chat_metadata) {
        const currentChatId = ctx.getCurrentChatId?.()
            || ctx.chatId
            || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : '')
            || '';
        if (!chatId || !currentChatId || chatId === currentChatId) {
            ctx.chat_metadata.mhc_rel_narrative_sync = ctx.chat_metadata.mhc_rel_narrative_sync || {};
            return ctx.chat_metadata.mhc_rel_narrative_sync;
        }
    }
    const key = chatId || 'default';
    if (!inMemorySyncLedger.has(key)) {
        inMemorySyncLedger.set(key, {});
    }
    return inMemorySyncLedger.get(key);
}

/**
 * Updates an entry in the relationship sync ledger.
 * @param {string} fullId `${bookName}::${uid}`
 * @param {object} record
 * @param {string} [chatId]
 */
export function updateRelationshipSyncLedger(fullId, record, chatId = '') {
    const ledger = getRelationshipSyncLedger(chatId);
    ledger[fullId] = Object.assign(ledger[fullId] || {}, record);
    triggerSaveMetadata();
}

// ── 4. Synchronization Orchestration ──────────────────────────────────────────

let isSyncInProgress = false;

/**
 * Checks if Relationship Narrative Sync is currently enabled and permissible.
 * @returns {boolean}
 */
export function isNarrativeSyncEnabled() {
    const extSettings = getExtSettings();
    const companion = extSettings[EXTENSION_NAME] || {};
    const rpg = getMultiHogSettings();

    const barsEnabled = rpg.npcRelationshipBars !== false;
    const syncEnabled = companion.enableRelationshipNarrativeSync !== false;
    return barsEnabled && syncEnabled;
}

/**
 * Direction A: Scans campaign NPC lorebook entries and initializes unsynced NPCs.
 * Strictly runs ONCE EVER per NPC (no-ops if already seeded or synced).
 *
 * @param {object} [options]
 * @param {boolean} [options.forceAll=false]
 * @param {boolean} [options.allowLlmScan=false] If false, seeds local ledger baselines without making LLM network calls
 * @returns {Promise<{ scanned: number, initialized: number, skipped: number }>}
 */
export async function scanAndInitUnsyncedNpcs({ forceAll = false, allowLlmScan = false } = {}) {
    if (isSyncInProgress) {
        return { scanned: 0, initialized: 0, skipped: 0 };
    }
    if (!isNarrativeSyncEnabled() && !forceAll) {
        return { scanned: 0, initialized: 0, skipped: 0 };
    }

    isSyncInProgress = true;
    let scanned = 0;
    let initialized = 0;
    let skipped = 0;

    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (!ctx) return { scanned: 0, initialized: 0, skipped: 0 };

        const rpg = getMultiHogSettings();
        rpg.npcRelationshipValues = rpg.npcRelationshipValues || {};
        rpg.npcRelationshipLog = rpg.npcRelationshipLog || {};

        const activeChatId = ctx.getCurrentChatId?.()
            || ctx.chatId
            || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
            || '';

        if (!forceAll && !isAdventureActive(activeChatId, ctx)) {
            return { scanned: 0, initialized: 0, skipped: 0 };
        }

        const partitionRelValues = (activeChatId && rpg.chatStates?.[activeChatId]?.npcRelationshipValues) || null;

        const ledger = getRelationshipSyncLedger(activeChatId);
        const pcName = resolveActiveProtagonistName();
        const connSettings = getStateTrackerConnectionSettings();

        // 1. Identify active NPC lorebook
        let npcBookName = (activeChatId && rpg.chatStates?.[activeChatId]?.campaignBooks?.npcs)
            || rpg.campaignBooks?.npcs || '';
        if (!npcBookName) {
            try {
                const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                const prefix = stateMgr.getEffectiveRouterCampaignPrefix?.(activeChatId);
                if (prefix) npcBookName = `${prefix}_NPCs`;
            } catch (_) {}
        }
        if (!npcBookName) {
            return { scanned: 0, initialized: 0, skipped: 0 };
        }

        // 2. Fetch lorebook entries
        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: npcBookName }),
        });
        if (!res.ok) return { scanned: 0, initialized: 0, skipped: 0 };
        const bookData = await res.json();
        if (!bookData?.entries) return { scanned: 0, initialized: 0, skipped: 0 };

        for (const [uidStr, entry] of Object.entries(bookData.entries)) {
            const uid = parseInt(uidStr, 10);
            const fullId = `${npcBookName}::${uid}`;
            const npcName = (entry.comment || entry.key?.[0] || '').trim();
            if (!npcName || !entry.content) continue;
            scanned++;

            // Check ledger: IF ALREADY INITIALIZED -> NO-OP
            if (ledger[fullId]?.initialized && !forceAll) {
                skipped++;
                continue;
            }

            // Check existing values in MultiHog (check active settings first, then chat partition)
            const existingVal = rpg.npcRelationshipValues[fullId]
                || partitionRelValues?.[fullId]
                || null;

            if (existingVal && (existingVal.friendship !== 0 || existingVal.affection !== 0) && !forceAll) {
                // Already has non-zero values (e.g. from pre-companion chat, Concierge, or manual edit)
                // Ensure active settings mirror it if missing
                if (!rpg.npcRelationshipValues[fullId]) {
                    rpg.npcRelationshipValues[fullId] = {
                        friendship: existingVal.friendship,
                        affection: existingVal.affection,
                    };
                }

                updateRelationshipSyncLedger(fullId, {
                    initialized: true,
                    lastSyncedTier: {
                        friendship: getFriendshipTier(existingVal.friendship).label,
                        affection: getAffectionTier(existingVal.affection).label,
                    },
                    lastFriendshipScore: existingVal.friendship,
                    lastAffectionScore: existingVal.affection,
                    lastSyncedAt: Date.now(),
                    initialSource: 'pre_existing',
                }, activeChatId);
                skipped++;
                continue;
            }

            // If active LLM scan is not permitted (e.g. background chat switch / page load),
            // record neutral/existing baseline passively without making unprompted LLM requests.
            if (!allowLlmScan) {
                const initF = existingVal?.friendship ?? 0;
                const initA = existingVal?.affection ?? 0;
                if (!rpg.npcRelationshipValues[fullId]) {
                    rpg.npcRelationshipValues[fullId] = {
                        friendship: initF,
                        affection: initA,
                    };
                }
                updateRelationshipSyncLedger(fullId, {
                    initialized: true,
                    lastSyncedTier: {
                        friendship: getFriendshipTier(initF).label,
                        affection: getAffectionTier(initA).label,
                    },
                    lastFriendshipScore: initF,
                    lastAffectionScore: initA,
                    lastSyncedAt: Date.now(),
                    initialSource: existingVal ? 'pre_existing' : 'default_neutral',
                }, activeChatId);
                initialized++;
                continue;
            }

            // Execute Direction A Micro-Scan
            const messages = buildDirectionAPrompt(npcName, entry.content, pcName);
            try {
                const rawOutput = await sendLlmPrompt(connSettings, messages);
                const parsed = parseDirectionAResponse(rawOutput);
                if (parsed) {
                    // Double check existing value didn't populate asynchronously
                    const checkCurrent = rpg.npcRelationshipValues[fullId] || partitionRelValues?.[fullId];
                    if (checkCurrent && (checkCurrent.friendship !== 0 || checkCurrent.affection !== 0) && !forceAll) {
                        skipped++;
                        continue;
                    }

                    rpg.npcRelationshipValues[fullId] = {
                        friendship: parsed.friendship,
                        affection: parsed.affection,
                    };
                    if (partitionRelValues) {
                        partitionRelValues[fullId] = {
                            friendship: parsed.friendship,
                            affection: parsed.affection,
                        };
                    }
                    rpg.npcRelationshipLog[fullId] = rpg.npcRelationshipLog[fullId] || [];
                    rpg.npcRelationshipLog[fullId].unshift({
                        timestamp: Date.now(),
                        field: 'friendship',
                        delta: parsed.friendship,
                        newValue: parsed.friendship,
                        source: 'narrative_init_sync',
                        reason: parsed.reason,
                    });

                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: getFriendshipTier(parsed.friendship).label,
                            affection: getAffectionTier(parsed.affection).label,
                        },
                        lastFriendshipScore: parsed.friendship,
                        lastAffectionScore: parsed.affection,
                        lastSyncedAt: Date.now(),
                        initialSource: 'narrative_scan',
                    }, activeChatId);
                    triggerSaveMultiHogSettings();
                    initialized++;
                } else {
                    // Default to neutral 0,0 and record so we do not re-run repeatedly
                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: getFriendshipTier(0).label,
                            affection: getAffectionTier(0).label,
                        },
                        lastFriendshipScore: 0,
                        lastAffectionScore: 0,
                        lastSyncedAt: Date.now(),
                        initialSource: 'default_neutral',
                    }, activeChatId);
                }
            } catch (err) {
                console.warn(`[MultiHog Companion] Direction A scan failed for ${npcName}:`, err);
            }
        }
    } finally {
        isSyncInProgress = false;
    }

    return { scanned, initialized, skipped };
}

/**
 * Direction B: Checks if any tracked NPC has crossed a tier boundary, and updates lorebook narrative.
 * @returns {Promise<{ checked: number, updated: number }>}
 */
export async function checkAndSyncTierCrossovers() {
    if (isSyncInProgress) {
        return { checked: 0, updated: 0 };
    }
    if (!isNarrativeSyncEnabled()) {
        return { checked: 0, updated: 0 };
    }

    isSyncInProgress = true;
    let checked = 0;
    let updated = 0;

    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (!ctx) return { checked: 0, updated: 0 };

        const activeChatId = ctx.getCurrentChatId?.()
            || ctx.chatId
            || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
            || '';

        if (!isAdventureActive(activeChatId, ctx)) {
            return { checked: 0, updated: 0 };
        }

        const extSettings = getExtSettings();
        const rpg = getMultiHogSettings();

        const partitionRelValues = (activeChatId && rpg.chatStates?.[activeChatId]?.npcRelationshipValues) || null;
        const isProjectionOwner = rpg.chatStateProjectionOwner && rpg.chatStateProjectionOwner === activeChatId;
        const relValues = partitionRelValues || (isProjectionOwner ? (rpg.npcRelationshipValues || {}) : {});
        const relLogs = (activeChatId && rpg.chatStates?.[activeChatId]?.npcRelationshipLog)
            || (isProjectionOwner ? (rpg.npcRelationshipLog || {}) : {});
        const ledger = getRelationshipSyncLedger(activeChatId);
        const pcName = resolveActiveProtagonistName();
        const connSettings = getStateTrackerConnectionSettings();

        // Resolve active campaign prefix to prevent cross-pollinating foreign campaign books
        let activePrefix = (activeChatId && rpg.chatStates?.[activeChatId]?.routerCampaignPrefix) || '';
        if (!activePrefix) {
            try {
                const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                activePrefix = stateMgr.getEffectiveRouterCampaignPrefix?.(activeChatId) || '';
            } catch (_) {}
        }
        if (!activePrefix && isProjectionOwner) {
            activePrefix = rpg.routerCampaignPrefix || '';
        }

        for (const [fullId, vals] of Object.entries(relValues)) {
            checked++;
            const fVal = vals?.friendship ?? 0;
            const aVal = vals?.affection ?? 0;
            const curFTier = getFriendshipTier(fVal);
            const curATier = getAffectionTier(aVal);

            const lastRec = ledger[fullId];
            const lastFTierLabel = lastRec?.lastSyncedTier?.friendship;
            const lastATierLabel = lastRec?.lastSyncedTier?.affection;

            // Tier boundary check: If NPC has never been initialized in this chat's ledger,
            // this is NOT a tier crossover. Record baseline tier (including neutral 0,0)
            // without triggering rewrite/toast so subsequent tier shifts are detected properly.
            if (!lastRec?.initialized || !lastFTierLabel) {
                if (vals && typeof vals === 'object') {
                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: curFTier.label,
                            affection: curATier.label,
                        },
                        lastFriendshipScore: fVal,
                        lastAffectionScore: aVal,
                        lastSyncedAt: Date.now(),
                        initialSource: 'baseline_catchup',
                    }, activeChatId);
                }
                continue;
            }

            // Tier boundary check: If tiers haven't changed, NO-OP!
            const fChanged = lastFTierLabel !== curFTier.label;
            const aChanged = lastATierLabel !== curATier.label;
            if (!fChanged && !aChanged) {
                continue;
            }

            // Split fullId to locate book and entry UID
            const [bookName, uidStr] = fullId.split('::');
            const uid = parseInt(uidStr, 10);
            if (!bookName || isNaN(uid)) continue;

            if (activePrefix && !bookName.toLowerCase().startsWith(activePrefix.toLowerCase())) {
                continue;
            }

            const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
            let bookData = null;
            try {
                const bRes = await fetch('/api/worldinfo/get', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ name: bookName }),
                });
                if (bRes.ok) bookData = await bRes.json();
            } catch (_) {}

            const entry = bookData?.entries?.[uid];
            if (!entry || !entry.content) continue;

            const npcName = (entry.comment || entry.key?.[0] || '').trim();
            const recentLogs = (relLogs[fullId] || []).slice(0, 5);

            // Extract recent dialogue pairs (3 pairs max)
            const chatMessages = ctx.chat || [];
            const dialoguePairs = extractRecentDialoguePairs(chatMessages, 3);
            const inGameTime = getInGameTimestamp(activeChatId);

            // Execute Direction B Narrative Rewrite
            const messages = buildDirectionBPrompt(npcName, entry.content, pcName, recentLogs, curFTier, curATier, dialoguePairs);
            try {
                const rawOutput = await sendLlmPrompt(connSettings, messages);

                // Guard against chat switches while the LLM request was in flight
                const latestChatId = ctx.getCurrentChatId?.()
                    || ctx.chatId
                    || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
                    || '';
                if (activeChatId && latestChatId && latestChatId !== activeChatId) {
                    break;
                }

                const updatePayload = parseDirectionBResponse(rawOutput);
                if (updatePayload && updatePayload.milestone) {
                    const patchedContent = patchNpcLorebookEntry(entry.content, updatePayload, inGameTime);
                    if (patchedContent && patchedContent !== entry.content) {
                        entry.content = patchedContent;

                        // Save to SillyTavern World Info
                        await fetch('/api/worldinfo/edit', {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ name: bookName, data: bookData }),
                        });

                        // Flush MultiHog router cache if available
                        try {
                            const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
                            if (typeof router.updateWorldInfoCache === 'function') {
                                await router.updateWorldInfoCache(bookName, bookData);
                            }
                        } catch (_) {}

                        updateRelationshipSyncLedger(fullId, {
                            initialized: true,
                            lastSyncedTier: {
                                friendship: curFTier.label,
                                affection: curATier.label,
                            },
                            lastFriendshipScore: fVal,
                            lastAffectionScore: aVal,
                            lastSyncedAt: Date.now(),
                        }, activeChatId);
                        updated++;

                        if (typeof toastr !== 'undefined' && extSettings[EXTENSION_NAME]?.showToasts !== false) {
                            const evolvedTierDesc = fChanged && aChanged
                                ? `${curFTier.label} & ${curATier.label}`
                                : fChanged
                                    ? curFTier.label
                                    : curATier.label;
                            toastr.info(`📖 ${npcName}'s narrative evolved to ${evolvedTierDesc}`, 'Relationship Narrative Sync');
                        }
                    }
                }
            } catch (err) {
                console.warn(`[MultiHog Companion] Direction B sync failed for ${npcName}:`, err);
            }
        }
    } finally {
        isSyncInProgress = false;
    }

    return { checked, updated };
}

/**
 * Returns a live status summary of tracked NPCs for UI display.
 * @returns {object}
 */
export function getRelationshipSyncStatus() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const activeChatId = ctx?.getCurrentChatId?.()
        || ctx?.chatId
        || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || '';
    const extSettings = getExtSettings();
    const rpg = getMultiHogSettings();
    const partitionRelValues = (activeChatId && rpg.chatStates?.[activeChatId]?.npcRelationshipValues) || null;
    const relValues = partitionRelValues || rpg.npcRelationshipValues || {};
    const ledger = getRelationshipSyncLedger(activeChatId);

    const barsEnabled = rpg.npcRelationshipBars !== false;
    const syncEnabled = extSettings[EXTENSION_NAME]?.enableRelationshipNarrativeSync !== false;

    const items = Object.entries(relValues).map(([fullId, vals]) => {
        const parts = fullId.split('::');
        const uid = parts[1] || '';
        const rec = ledger[fullId];
        const fVal = vals?.friendship ?? 0;
        const aVal = vals?.affection ?? 0;
        const fTier = getFriendshipTier(fVal);
        const aTier = getAffectionTier(aVal);

        return {
            fullId,
            uid,
            friendship: fVal,
            affection: aVal,
            friendshipTier: fTier.label,
            affectionTier: aTier.label,
            lastSyncedAt: rec?.lastSyncedAt || null,
            isInitialized: !!rec?.initialized,
        };
    });

    return {
        barsEnabled,
        syncEnabled,
        active: barsEnabled && syncEnabled,
        trackedCount: items.length,
        items,
    };
}
