/// <reference path="./types.d.ts" />
/**
 * ruleset-rng-interceptor.js — MultiHog Companion
 *
 * Manages PbtA (2d6) and FAE (4dF) dice RNG queue replacement inside SillyTavern's
 * `generate_interceptor` hook (`ADR-MP-03`), native function tool registration
 * (`resolve_fae_action`, `roll_pbta_move`), sysprompt RNG mode alignment,
 * and pending FAE tool state tracking across post-turn reconciliation.
 */

import {
    buildPbtARoleContent,
    buildPbtARngContent,
    executePbtaMoveTool,
} from './pbta-ruleset.js';
import {
    buildFaeRngBlock,
    buildFaeRngContent,
    buildFaeRoleContent,
    executeFaeActionTool,
} from './fae-ruleset.js';
import { parseFaeStateFromMemo } from './fae-state-sync.js';
import { detectActiveGenre, detectActiveFaeGenre } from './pbta-companion-bridge.js';
import {
    isPbtAActive,
    isFaeActive,
    getCompanionActiveCartridge,
    getPartitionDossier,
} from './pbta-ruleset-persistence.js';
import { resolveAuthoritativeChatId } from './history-integrity-guard.js';

let _stSaveSettingsDebounced = null;
try {
    const scr = await import('../../../../script.js');
    if (typeof scr?.saveSettingsDebounced === 'function') {
        _stSaveSettingsDebounced = scr.saveSettingsDebounced;
    }
} catch (_) {}

function triggerSaveSettingsDebounced() {
    const ctxSave = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.()?.saveSettingsDebounced : null;
    if (typeof ctxSave === 'function') {
        ctxSave();
    } else if (typeof globalThis.saveSettingsDebounced === 'function') {
        globalThis.saveSettingsDebounced();
    } else if (typeof _stSaveSettingsDebounced === 'function') {
        _stSaveSettingsDebounced();
    }
}

function getLocalRpgSettings() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    return ctx?.extensionSettings?.rpg_tracker
        || globalThis.extension_settings?.rpg_tracker
        || null;
}

const _pendingFaeToolResolutionByChat = new Map();

/**
 * Retrieves any pending FAE tool resolution recorded during the active turn for `chatId`.
 * @param {string} chatId
 * @returns {{ state: object, result: object, timestamp: number }|null}
 */
export function getPendingFaeToolResolution(chatId) {
    return _pendingFaeToolResolutionByChat.get(chatId) || null;
}

/**
 * Clears the pending FAE tool resolution record for `chatId`.
 * @param {string} chatId
 */
export function clearPendingFaeToolResolution(chatId) {
    _pendingFaeToolResolutionByChat.delete(chatId);
}

/**
 * Roll a single d6 using the same cryptographic rejection sampling MultiHog uses.
 * @returns {number}
 */
export function rollD6() {
    const buf = new Uint32Array(1);
    const limit = Math.floor(4294967296 / 6) * 6;
    let roll;
    do { crypto.getRandomValues(buf); roll = buf[0]; } while (roll >= limit);
    return (roll % 6) + 1;
}

/**
 * Build a clean PbtA 2d6 RNG block. Each line is one pre-paired 2d6 roll:
 *   1: 2d6 → 3 + 5 = 8
 * Replaces MultiHog's polyhedral queue (d20/d4/d6/d8/d10/d12 per line).
 *
 * @param {number} [lineCount=3]
 * @returns {string}
 */
export function buildPbtA2d6Block(lineCount = 3) {
    const turnId = Date.now();
    const count = Math.max(1, lineCount);
    const lines = [];
    for (let i = 0; i < count; i++) {
        const a = rollD6(), b = rollD6();
        lines.push(`${i + 1}: 2d6 → ${a} + ${b} = ${a + b}`);
    }
    return `[RNG_QUEUE v7.0 — PbtA 2d6]\nturn_id=${turnId}\nscope=this_response\n${lines.join('\n')}\n[/RNG_QUEUE]\n\n`;
}

/**
 * Synchronizes SillyTavern function tool registrations for Companion rulesets.
 * Registers resolve_fae_action when FAE is active and diceFunctionTool is true.
 * Registers roll_pbta_move when PbtA is active and diceFunctionTool is true.
 * Unregisters them and restores MultiHog's native RollTheDice tools when in D&D 5e or queue mode.
 */
export function syncCompanionDiceFunctionTools() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (!ctx || typeof ctx.registerFunctionTool !== 'function') {
        return;
    }

    try { ctx.unregisterFunctionTool?.('resolve_fae_action'); } catch (_) {}
    try { ctx.unregisterFunctionTool?.('roll_pbta_move'); } catch (_) {}

    const rpgSettings = getLocalRpgSettings();
    const activeChatId = resolveAuthoritativeChatId();

    const isFae = isFaeActive(activeChatId);
    const isPbta = !isFae && isPbtAActive(activeChatId);
    const rngEnabled = rpgSettings?.rngEnabled !== false;
    const toolMode = Boolean(rpgSettings?.diceFunctionTool);

    if (isFae && rngEnabled && toolMode) {
        try { ctx.unregisterFunctionTool?.('RollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('RollTheDiceD100'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('FatbodyRollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('MultihogRollTheDice'); } catch (_) {}

        ctx.registerFunctionTool({
            name: 'resolve_fae_action',
            displayName: 'Resolve FAE Action',
            description: 'Deterministically resolves an FAE 4dF resource pool test for a Threat 1–4 action, computing attrition, outcome tier, and pool updates.',
            parameters: {
                type: 'object',
                properties: {
                    pool_at_risk: {
                        type: 'string',
                        description: 'The resource pool placed at risk (e.g. Health, Sanity, Resolve, Supplies).',
                    },
                    threat_level: {
                        type: 'integer',
                        description: 'Threat level of the encounter/obstacle (1 to 4).',
                        minimum: 1,
                        maximum: 4,
                    },
                    progress_scale: {
                        type: 'string',
                        enum: ['full', 'stepping_stone', 'pivot'],
                        description: 'Outcome scale: full (complete resolution), stepping_stone (-1 encounter layer, grants advantage), or pivot (+1 threat, reveals new angle).',
                    },
                    matched_positive_tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Up to 2 matching positive personal, gear, or companion tags from [CHARACTER] that mitigate attrition.',
                    },
                    matched_negative_tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Any active Scars or Debuffs hindering this action that increase attrition.',
                    },
                    is_retreating: {
                        type: 'boolean',
                        description: 'True if the protagonist is fleeing or escaping the danger.',
                    },
                    grant_advantage_name: {
                        type: 'string',
                        description: 'Optional name for the advantage tag granted if progress_scale is stepping_stone (defaults to Tactical Opening).',
                    },
                },
                required: ['pool_at_risk', 'threat_level'],
            },
            formatMessage: () => '',
            action: async (args) => {
                const curSettings = getLocalRpgSettings();
                const curChatId = resolveAuthoritativeChatId();
                const memo = curSettings?.currentMemo || curSettings?.chatStates?.[curChatId]?.currentMemo || '';
                const genreKey = detectActiveFaeGenre({ chatId: curChatId, rpgSettings: curSettings, currentMemo: memo });
                const state = parseFaeStateFromMemo(memo, genreKey);
                const out = executeFaeActionTool(state, args);
                _pendingFaeToolResolutionByChat.set(curChatId, {
                    state: out.updatedState,
                    result: out.result,
                    timestamp: Date.now(),
                });
                return out.toolResponseText;
            },
        });
    } else if (isPbta && rngEnabled && toolMode) {
        try { ctx.unregisterFunctionTool?.('RollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('RollTheDiceD100'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('FatbodyRollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('MultihogRollTheDice'); } catch (_) {}

        ctx.registerFunctionTool({
            name: 'roll_pbta_move',
            displayName: 'Roll PbtA Move',
            description: 'Rolls 2d6 + Stat modifier (+ forward) for a triggered PbtA Move and determines the outcome tier (Strong Hit, Weak Hit, or Miss).',
            parameters: {
                type: 'object',
                properties: {
                    move_name: {
                        type: 'string',
                        description: 'The name of the triggered Move (e.g. Hack & Slash, Act Under Fire, Defy Danger).',
                    },
                    stat_name: {
                        type: 'string',
                        description: 'The character stat governing this Move (e.g. Cool, Hard, Might, Agility).',
                    },
                    stat_mod: {
                        type: 'integer',
                        description: 'The stat modifier from the character sheet (-1 to +3).',
                    },
                    forward_bonus: {
                        type: 'integer',
                        description: 'Any situational forward or hold bonus applied to this roll (default 0).',
                    },
                },
                required: ['move_name', 'stat_name'],
            },
            formatMessage: () => '',
            action: async (args) => {
                const out = executePbtaMoveTool(args);
                return out.toolResponseText;
            },
        });
    } else if (!isFae && !isPbta) {
        try {
            import('../SillyTavern-MultihogDnDFramework/narrative-hooks.js')
                .then(nh => nh.registerDiceFunctionTool?.())
                .catch(() => {});
        } catch (_) {}
    }
}

function syncSnippetContent(s, snippetId, desiredContent) {
    let updated = false;
    if (Array.isArray(s.customSyspromptLibrary)) {
        const item = s.customSyspromptLibrary.find(p => p.id === snippetId);
        if (item && item.content !== desiredContent) {
            item.content = desiredContent;
            updated = true;
        }
    }
    if (Array.isArray(s.syspromptSnippetDatabase)) {
        const dbItem = s.syspromptSnippetDatabase.find(p => p.id === snippetId);
        if (dbItem && dbItem.content !== desiredContent) {
            dbItem.content = desiredContent;
            updated = true;
        }
    }
    return updated;
}

/**
 * Synchronizes the active ruleset's sysprompts and tools with MultiHog's native diceFunctionTool toggle.
 *
 * @param {object|null} [rpgSettings=null]
 */
export function syncActiveRulesetRngMode(rpgSettings = null) {
    const s = rpgSettings || getLocalRpgSettings();
    if (!s) return;
    const activeChatId = resolveAuthoritativeChatId();
    const fae = isFaeActive(activeChatId);
    const pbta = !fae && isPbtAActive(activeChatId);
    const toolMode = Boolean(s.diceFunctionTool);
    const isFreeform = s.cyoaConfig?.playstyle === 'freeform';
    let changed = false;

    if (fae) {
        const memo = s.currentMemo || s.chatStates?.[activeChatId]?.currentMemo || '';
        const genreKey = detectActiveFaeGenre({ chatId: activeChatId, rpgSettings: s, currentMemo: memo });
        const faeState = parseFaeStateFromMemo(memo, genreKey);
        const isHeroic = Boolean(faeState.knobs?.heroic_tier);
        const desiredRng = buildFaeRngContent({ toolMode });
        const desiredRole = buildFaeRoleContent(isFreeform, { heroicTier: isHeroic, toolMode });

        if (syncSnippetContent(s, 'fae_base_override_rng', desiredRng)) changed = true;
        if (syncSnippetContent(s, 'fae_base_override_role', desiredRole)) changed = true;
    } else if (pbta) {
        const memo = s.currentMemo || s.chatStates?.[activeChatId]?.currentMemo || '';
        const activeCart = getCompanionActiveCartridge(activeChatId, s);
        const pbtaDossier = getPartitionDossier(s.chatStates?.[activeChatId]) || activeCart?.dossier || null;
        const genreKey = activeCart?.genre
            || pbtaDossier?.meta?.systemKey
            || detectActiveGenre({ currentMemo: memo, rpgSettings: s })
            || 'fantasy';
        const statsList = Object.keys(pbtaDossier?.protagonist?.stats || {});
        const systemLabel = activeCart?.systemLabel || pbtaDossier?.meta?.systemLabel || null;
        const pbtaOverrides = {
            ...(statsList.length >= 3 ? { stats: statsList } : {}),
            ...(systemLabel ? { systemLabel } : {}),
        };
        const desiredRng = buildPbtARngContent({ toolMode, genreKey, overrides: pbtaOverrides });
        const desiredRole = buildPbtARoleContent(isFreeform, genreKey, pbtaOverrides);

        if (syncSnippetContent(s, 'pbta_base_override_rng', desiredRng)) changed = true;
        if (syncSnippetContent(s, 'pbta_base_override_role', desiredRole)) changed = true;
    }

    if (changed) {
        triggerSaveSettingsDebounced();
    }

    syncCompanionDiceFunctionTools();
}

function getMsgRawText(msg) {
    if (!msg) return '';
    if (typeof msg.mes === 'string') return msg.mes;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content
            .filter(p => p?.type === 'text' && typeof p.text === 'string')
            .map(p => p.text)
            .join('\n');
    }
    return '';
}

function isUserChatMessage(msg) {
    if (!msg) return false;
    if (msg.is_user === true || msg.role === 'user' || msg.role === 'human' || msg.role === 'player') return true;
    const txt = getMsgRawText(msg);
    if (txt.includes('[RNG_QUEUE')) return true;
    return false;
}

function isAssistantNarrativeMessage(msg) {
    if (!msg) return false;
    if (msg.is_user === true || msg.role === 'user' || msg.role === 'human' || msg.role === 'player') return false;
    if (msg.is_system === true || msg.role === 'system') return false;
    if (msg.extra?.isSmallSys) return false;
    const txt = getMsgRawText(msg).trim();
    return txt.length > 0;
}

/**
 * SillyTavern generate_interceptor — runs AFTER MultiHog's interceptor
 * (loading_order 30 > 20). When PbtA or FAE is active for the current chat,
 * replaces MultiHog's polyhedral RNG queue with a clean 2d6 or 4dF block.
 *
 * Registered on globalThis via the manifest's generate_interceptor field.
 */
export function mhcGenerationInterceptor(chat, _contextSize, _abort, _type) {
    const activeChatId = resolveAuthoritativeChatId();
    if (activeChatId) {
        _pendingFaeToolResolutionByChat.delete(activeChatId);
    }

    const rpgSettings = getLocalRpgSettings();
    syncActiveRulesetRngMode(rpgSettings);

    const faeActive = isFaeActive(activeChatId);
    const pbtaActive = !faeActive && isPbtAActive(activeChatId);
    if (!Array.isArray(chat) || (!pbtaActive && !faeActive)) return;

    // MultiHog prepends its RNG block into the last user message's content.
    // Find it and replace with our clean 2d6 or 4dF block.
    const rngPattern = /\[RNG_QUEUE[\s\S]*?\[\/RNG_QUEUE\]\s*/g;

    let latestUserIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg) continue;
        const txt = getMsgRawText(msg);
        if (txt.includes('[RNG_QUEUE')) {
            latestUserIdx = i;
            break;
        }
    }
    if (latestUserIdx === -1) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (isUserChatMessage(chat[i])) {
                latestUserIdx = i;
                break;
            }
        }
    }

    if (faeActive) {
        let isOpeningTurn = false;
        if (latestUserIdx !== -1) {
            const rawUserText = getMsgRawText(chat[latestUserIdx]);
            const strippedText = rawUserText.replace(/\[RNG_QUEUE[\s\S]*?\[\/RNG_QUEUE\]\s*/gi, '').trim();
            const isBeginAdventure = /^\s*Begin the adventure\b/i.test(strippedText);

            let firstUserIdx = -1;
            for (let i = 0; i < chat.length; i++) {
                if (isUserChatMessage(chat[i])) {
                    firstUserIdx = i;
                    break;
                }
            }

            let hasPriorAssistantTurn = false;
            if (firstUserIdx !== -1 && latestUserIdx > firstUserIdx) {
                for (let i = firstUserIdx + 1; i < latestUserIdx; i++) {
                    if (isAssistantNarrativeMessage(chat[i])) {
                        hasPriorAssistantTurn = true;
                        break;
                    }
                }
            }

            isOpeningTurn = isBeginAdventure || !hasPriorAssistantTurn;
        }

        const memo = rpgSettings?.currentMemo || rpgSettings?.chatStates?.[activeChatId]?.currentMemo || '';
        const genreKey = detectActiveFaeGenre({ chatId: activeChatId, rpgSettings, currentMemo: memo });
        const faeState = parseFaeStateFromMemo(memo, genreKey);
        const combatMatch = memo.match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i);
        const hasActiveEncounter = Boolean(combatMatch && /[1-9]\d*\s*\/\s*[1-9]\d*\s*HP/i.test(combatMatch[1]));
        const toolMode = Boolean(rpgSettings?.diceFunctionTool);

        let replacementBlock = buildFaeRngBlock({
            state: faeState,
            genreKey: faeState.genreKey || genreKey,
            activeEncounter: hasActiveEncounter,
            isOpeningTurn,
            toolMode,
        });
        if (!replacementBlock.endsWith('\n\n')) {
            replacementBlock = `${replacementBlock}\n\n`;
        }

        let replaced = false;
        const startIndex = Math.max(0, chat.length - 3);
        for (let i = chat.length - 1; i >= startIndex; i--) {
            const msg = chat[i];
            if (!msg) continue;
            const raw = getMsgRawText(msg);
            if (raw.includes('[RNG_QUEUE')) {
                if (typeof msg.mes === 'string') {
                    msg.mes = msg.mes.replace(rngPattern, replacementBlock);
                }
                if (typeof msg.content === 'string') {
                    msg.content = msg.content.replace(rngPattern, replacementBlock);
                }
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('[RNG_QUEUE')) {
                            part.text = part.text.replace(rngPattern, replacementBlock);
                        }
                    }
                }
                replaced = true;
                console.log('[MultiHog Companion] Replaced polyhedral RNG queue with FAE 4dF block.');
                break;
            }
        }

        if (!replaced && latestUserIdx !== -1) {
            const userMsg = chat[latestUserIdx];
            if (typeof userMsg.mes === 'string') {
                userMsg.mes = `${replacementBlock}${userMsg.mes}`;
            } else if (typeof userMsg.content === 'string') {
                userMsg.content = `${replacementBlock}${userMsg.content}`;
            } else if (Array.isArray(userMsg.content)) {
                const textPart = userMsg.content.find(p => p?.type === 'text');
                if (textPart) {
                    textPart.text = `${replacementBlock}${textPart.text}`;
                } else {
                    userMsg.content.unshift({ type: 'text', text: replacementBlock });
                }
            }
            console.log('[MultiHog Companion] Prepended FAE 4dF block onto latest user message (toolMode outside combat).');
        }
    } else {
        const toolMode = Boolean(rpgSettings?.diceFunctionTool);
        const replacementBlock = toolMode ? '' : buildPbtA2d6Block(3);
        const startIndex = Math.max(0, chat.length - 3);
        for (let i = chat.length - 1; i >= startIndex; i--) {
            const msg = chat[i];
            if (!msg) continue;
            const raw = getMsgRawText(msg);
            if (raw.includes('[RNG_QUEUE')) {
                if (typeof msg.mes === 'string') {
                    msg.mes = msg.mes.replace(rngPattern, replacementBlock);
                }
                if (typeof msg.content === 'string') {
                    msg.content = msg.content.replace(rngPattern, replacementBlock);
                }
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('[RNG_QUEUE')) {
                            part.text = part.text.replace(rngPattern, replacementBlock);
                        }
                    }
                }
                console.log(toolMode
                    ? '[MultiHog Companion] Stripped RNG queue for PbtA Function Tool Call mode.'
                    : '[MultiHog Companion] Replaced polyhedral RNG queue with PbtA 2d6 rolls.');
                break;
            }
        }
    }
}

// [CATALOG: ADR-MP-03] See MONKEYPATCHES.md — SillyTavern Pipeline Generation Interceptor (PbtA 2d6 RNG Injection)
// Register the interceptor on globalThis so SillyTavern can call it.
globalThis.mhcGenerationInterceptor = mhcGenerationInterceptor;
