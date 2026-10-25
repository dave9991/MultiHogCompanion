/**
 * PbtA Vitality & Party Sync Adapter for MultiHog Companion
 *
 * Resolves the impedance match between Powered by the Apocalypse (PbtA) Harm
 * and MultiHog D&D Framework's upstream parser requirements without modifying
 * upstream code:
 *
 * 1. PbtA tracks Harm (0 = healthy, maxHarm = incapacitated).
 * 2. MultiHog's upstream renderer (renderer.js) and portrait engine (portraits.js)
 *    strictly mandate a "Name: cur/max HP" regex anchor to extract party members,
 *    calculate health bar percentages ((cur/max)*100), and build portrait containers.
 * 3. This adapter normalizes memo lines to maintain descending tandem HP:
 *       curHp = Math.max(0, maxHarm - curHarm)
 *       maxHp = maxHarm
 *    producing: "Name: curHp/maxHp HP | Harm: curHarm/maxHarm | ..."
 * 4. This guarantees:
 *    - Upstream getPartyMembers() finds all companions for portraits & persona sync.
 *    - Upstream extractPartyVitals() renders the top party vitals strip cleanly.
 *    - Upstream blockToItems() assigns individual entity cards & health bars per member.
 */

import {
    formatMoveAsPill,
    formatConditionAsPill,
    normalizePill,
    splitTopLevelPillItems,
} from './pbta-ruleset.js';

/**
 * Normalizes a single ((PILLS)) Moves: or Conditions: line if it contains
 * unparenthesized move descriptions, double parentheticals, or echoed prompt placeholders.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizePbtaPillsLine(line) {
    if (!line || typeof line !== 'string') return line;

    // 1. Moves line
    const movesMatch = line.match(/^(\s*(?:\(\(PILLS\)\)\s*)?Moves:\s*)(.+)$/i);
    if (movesMatch) {
        const [, prefix, rawMovesText] = movesMatch;
        const topSegments = splitTopLevelPillItems(rawMovesText, { splitCommas: true });
        // Check if any segment has text after a closing ')' or has two '(' groups
        const needsRepair = topSegments.some(seg => {
            const openCount = (seg.match(/\(/g) || []).length;
            if (openCount >= 2) return true;
            if (openCount === 1 && !seg.trim().endsWith(')')) return true;
            return false;
        });
        if (needsRepair) {
            const splitByMoveHeader = rawMovesText
                .split(/,\s*(?=[A-Z][A-Za-z0-9'’\s-]{1,35}?\s*[\(\[][+-]?[A-Za-z0-9\s]{1,18}[\)\]])/)
                .map(s => s.trim())
                .filter(Boolean);
            const sourceList = splitByMoveHeader.length > 0 ? splitByMoveHeader : topSegments;
            const healed = sourceList.map(formatMoveAsPill).filter(Boolean).join(', ');
            if (healed) return `${prefix}${healed}`;
        }
        return line;
    }

    // 2. Conditions line with echoed prompt placeholder
    const condMatch = line.match(/^(\s*(?:\(\(PILLS\)\)\s*)?Conditions:\s*)(.+)$/i);
    if (condMatch && /(?:starting\s+(?:injury(?:\s+or\s+weakness)?|weakness|condition)|placeholder)/i.test(condMatch[2])) {
        const [, prefix, rawCondsText] = condMatch;
        const segments = splitTopLevelPillItems(rawCondsText, { splitCommas: true });
        const formatted = segments.map(formatConditionAsPill).filter(Boolean).join(', ');
        return `${prefix}${formatted || 'None'}`;
    }

    return line;
}

/**
 * Normalizes a single line containing Harm into a valid tandem HP line.
 * If the line does not contain Harm, returns the original line unchanged.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizePbtaVitalityLine(line) {
    if (!line || typeof line !== 'string') return line;
    if (!/Harm/i.test(line)) return line;

    // Pattern 1: Already has both HP and Harm, e.g.:
    // "Deckard (Blade Runner): 5/5 HP | Harm: 2/5 | Armor: 1"
    const tandemRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*([+-]?\d+)(?:\/(\d+))?\s*HP\s*\|\s*Harm\s*[:=]\s*(\d+)(?:\/(\d+))?(.*)$/i;
    const tandemMatch = line.match(tandemRegex);
    if (tandemMatch) {
        const [, lead, name, , maxHpRaw, curHarmRaw, maxHarmRaw, rest] = tandemMatch;
        const curHarm = parseInt(curHarmRaw, 10) || 0;
        const maxHarm = parseInt(maxHarmRaw || maxHpRaw, 10) || 5;
        const curHp = Math.max(0, maxHarm - curHarm);
        const maxHp = maxHarm;
        return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${rest}`;
    }

    // Pattern 2: Harm without HP (e.g., "Rachael: Harm: 1/5 | Armor: 0" or "- Rachael: 1/5 Harm")
    const harmOnlyRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*(?:Harm\s*[:=]\s*(\d+)(?:\/(\d+))?|(\d+)(?:\/(\d+))?\s*Harm)\s*(?:\|\s*)?(.*)$/i;
    const harmOnlyMatch = line.match(harmOnlyRegex);
    if (harmOnlyMatch) {
        const [, lead, name, h1, m1, h2, m2, rest] = harmOnlyMatch;
        const curHarm = parseInt(h1 || h2, 10) || 0;
        const maxHarm = parseInt(m1 || m2, 10) || 5;
        const curHp = Math.max(0, maxHarm - curHarm);
        const maxHp = maxHarm;
        const restSuffix = rest ? ` | ${rest.trim().replace(/^\|\s*/, '')}` : '';
        return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${restSuffix}`;
    }

    // Pattern 3: Line with HP followed by separated Harm clause (e.g. "Name: 4/4 HP | Armor: 1 | Harm: 1/4")
    const hpSeparatedHarmRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*([+-]?\d+)(?:\/(\d+))?\s*HP\s*[:|,]?\s*(.*)$/i;
    const hpSepMatch = line.match(hpSeparatedHarmRegex);
    if (hpSepMatch) {
        const [, lead, name, , maxHpRaw, rest] = hpSepMatch;
        const embeddedHarm = rest.match(/Harm\s*[:=]\s*(\d+)(?:\/(\d+))?/i);
        if (embeddedHarm) {
            const curHarm = parseInt(embeddedHarm[1], 10) || 0;
            const maxHarm = parseInt(embeddedHarm[2] || maxHpRaw, 10) || 5;
            const curHp = Math.max(0, maxHarm - curHarm);
            const maxHp = maxHarm;
            // Clean out the old Harm clause and re-inject standard tandem
            const cleanedRest = rest.replace(/\s*\|\s*Harm\s*[:=]\s*\d+(?:\/\d+)?/gi, '').trim();
            const restSuffix = cleanedRest ? ` | ${cleanedRest.replace(/^\|\s*/, '')}` : '';
            return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${restSuffix}`;
        }
    }

    return line;
}

/**
 * Normalizes an entire state memo text, ensuring all PbtA Harm entities have
 * synchronized descending tandem HP anchors and valid pill formatting.
 *
 * @param {string} memoText
 * @returns {string}
 */
export function normalizePbtaMemo(memoText) {
    if (!memoText || typeof memoText !== 'string') return memoText;
    if (!/Harm|Moves:|Conditions:/i.test(memoText)) return memoText;

    const lines = memoText.split('\n');
    let modified = false;

    const newLines = lines.map(line => {
        let norm = normalizePbtaVitalityLine(line);
        norm = normalizePbtaPillsLine(norm);
        if (norm !== line) modified = true;
        return norm;
    });

    return modified ? newLines.join('\n') : memoText;
}

/**
 * Synchronizes the live MultiHog settings currentMemo and chatState partitions
 * with tandem PbtA vitality formatting.
 *
 * @param {object} s MultiHog settings object
 * @param {string} [chatId] Active chat ID
 * @returns {boolean} True if changes were applied
 */
export function syncLivePbtaMemoVitality(s, chatId = null) {
    if (!s) return false;
    let didUpdate = false;

    if (s.currentMemo) {
        const normalized = normalizePbtaMemo(s.currentMemo);
        if (normalized !== s.currentMemo) {
            s.currentMemo = normalized;
            didUpdate = true;
        }
    }

    if (chatId && s.chatStates?.[chatId]?.currentMemo) {
        const normalized = normalizePbtaMemo(s.chatStates[chatId].currentMemo);
        if (normalized !== s.chatStates[chatId].currentMemo) {
            s.chatStates[chatId].currentMemo = normalized;
            didUpdate = true;
        }
    }

    return didUpdate;
}

/**
 * Extracts parsed PbtA character positioning, stats, moves, and conditions from
 * a state memo string. Useful for verifying that the Adventure Companion receives
 * comprehensive PbtA character context.
 *
 * @param {string} memoText
 * @returns {object|null}
 */
export function extractPbtaCharacterState(memoText) {
    if (!memoText || typeof memoText !== 'string') return null;

    const charBlockMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    const textToSearch = charBlockMatch ? charBlockMatch[1] : memoText;

    // 1. Name, Playbook, HP, Harm, Armor
    const headerRegex = /^\s*[-*+•–—]?\s*(.+?)(?:\s*\(([^)]+)\))?:\s*(\d+)\/(\d+)\s*HP\s*\|\s*Harm:\s*(\d+)\/(\d+)(?:\s*\|\s*Armor:\s*(\d+))?/m;
    const headerMatch = textToSearch.match(headerRegex);

    let name = null;
    let playbook = null;
    let curHarm = null;
    let maxHarm = null;
    let curHp = null;
    let maxHp = null;
    let armor = 0;

    if (headerMatch) {
        name = headerMatch[1].trim();
        playbook = headerMatch[2] ? headerMatch[2].trim() : null;
        curHp = parseInt(headerMatch[3], 10);
        maxHp = parseInt(headerMatch[4], 10);
        curHarm = parseInt(headerMatch[5], 10);
        maxHarm = parseInt(headerMatch[6], 10);
        if (headerMatch[7]) armor = parseInt(headerMatch[7], 10) || 0;
    }

    // 2. Stats
    const statsMatch = textToSearch.match(/Stats:\s*(.+)$/m);
    const statsStr = statsMatch ? statsMatch[1].trim() : '';

    // 3. Moves
    const movesMatch = textToSearch.match(/(?:\(\(PILLS\)\)\s*)?Moves:\s*(.+)$/m);
    const movesStr = movesMatch ? movesMatch[1].trim() : '';

    // 4. Conditions
    const condMatch = textToSearch.match(/(?:\(\(PILLS\)\)\s*)?Conditions:\s*(.+)$/m);
    const conditionsStr = condMatch ? condMatch[1].trim() : '';

    // 5. XP
    const xpMatch = textToSearch.match(/XP:\s*(\d+)(?:\/(\d+))?/i);
    const xp = xpMatch ? parseInt(xpMatch[1], 10) : 0;
    const xpMax = xpMatch && xpMatch[2] ? parseInt(xpMatch[2], 10) : 5;

    return {
        name,
        playbook,
        curHarm,
        maxHarm,
        curHp,
        maxHp,
        armor,
        stats: statsStr,
        moves: movesStr,
        conditions: conditionsStr,
        xp,
        xpMax,
        isPbta: !!(curHarm !== null || /Harm/i.test(textToSearch)),
    };
}

/**
 * Calculates rescaled Harm when the campaign's maximum Harm changes.
 * Guaranteed rules:
 * 1. If an entity was at full harm / dying (curHarm >= oldMaxHarm), stays at full harm (newMaxHarm).
 * 2. If an entity was alive / below max harm (curHarm < oldMaxHarm), they MUST stay below max harm
 *    and not die/incapacitate (capped strictly at newMaxHarm - 1).
 *    e.g. 5/6 Harm with newMax 4 becomes 3/4 Harm.
 * 3. If newMaxHarm >= oldMaxHarm (expanding scale), raw injuries are preserved.
 *
 * @param {number} curHarm
 * @param {number} oldMaxHarm
 * @param {number} newMaxHarm
 * @returns {number}
 */
export function calculateRescaledHarm(curHarm, oldMaxHarm, newMaxHarm) {
    const cur = Math.max(0, parseInt(curHarm, 10) || 0);
    const oldMax = Math.max(1, parseInt(oldMaxHarm, 10) || 5);
    const newMax = Math.max(1, parseInt(newMaxHarm, 10) || 5);

    if (cur === 0) return 0;

    // 1. If already incapacitated/dying at or above old maximum, map to new maximum
    if (cur >= oldMax) {
        return newMax;
    }

    // 2. Character was alive (< oldMax). Must remain strictly alive (< newMax, at most newMax - 1)
    const aliveCap = Math.max(0, newMax - 1);
    if (aliveCap === 0) {
        return 0;
    }

    if (newMax < oldMax) {
        // Compressing scale (e.g. 6 -> 4): calculate proportional harm rounded, clamped strictly to aliveCap
        const proportional = Math.round((cur / oldMax) * newMax);
        return Math.min(aliveCap, Math.max(1, proportional));
    }

    // Expanding or unchanged scale (e.g. 4 -> 6): preserve raw accumulated damage, capped at aliveCap
    return Math.min(aliveCap, cur);
}

/**
 * Rescales the Harm capacity and tandem HP on a single memo vitality line.
 *
 * @param {string} line
 * @param {number} newMaxHarm
 * @param {string|null} [entityName=null]
 * @returns {string}
 */
export function rescalePbtaHarmLine(line, newMaxHarm, entityName = null) {
    if (!line || typeof line !== 'string') return line;
    if (!/Harm/i.test(line)) return line;

    const newMax = Math.max(1, parseInt(newMaxHarm, 10) || 5);

    // Pattern A: Tandem HP and Harm line:
    // e.g. "Deckard (Blade Runner): 1/6 HP | Harm: 5/6 | Armor: 1"
    const tandemRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*([+-]?\d+)(?:\/(\d+))?\s*HP\s*\|\s*Harm\s*[:=]\s*(\d+)(?:\/(\d+))?(.*)$/i;
    const tandemMatch = line.match(tandemRegex);
    if (tandemMatch) {
        const [, lead, name, , oldMaxHpRaw, curHarmRaw, oldMaxHarmRaw, rest] = tandemMatch;
        if (entityName && !name.toLowerCase().includes(entityName.toLowerCase().trim())) {
            return line;
        }
        const curHarm = parseInt(curHarmRaw, 10) || 0;
        const oldMax = parseInt(oldMaxHarmRaw || oldMaxHpRaw, 10) || 5;
        const rescaledHarm = calculateRescaledHarm(curHarm, oldMax, newMax);
        const rescaledHp = Math.max(0, newMax - rescaledHarm);
        return `${lead}${name.trim()}: ${rescaledHp}/${newMax} HP | Harm: ${rescaledHarm}/${newMax}${rest}`;
    }

    // Pattern B: Harm-only line:
    // e.g. "Deckard: Harm: 5/6 | Armor: 1"
    const harmOnlyRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*(?:Harm\s*[:=]\s*(\d+)(?:\/(\d+))?|(\d+)(?:\/(\d+))?\s*Harm)\s*(?:\|\s*)?(.*)$/i;
    const harmOnlyMatch = line.match(harmOnlyRegex);
    if (harmOnlyMatch) {
        const [, lead, name, h1, m1, h2, m2, rest] = harmOnlyMatch;
        if (entityName && !name.toLowerCase().includes(entityName.toLowerCase().trim())) {
            return line;
        }
        const curHarm = parseInt(h1 || h2, 10) || 0;
        const oldMax = parseInt(m1 || m2, 10) || 5;
        const rescaledHarm = calculateRescaledHarm(curHarm, oldMax, newMax);
        const rescaledHp = Math.max(0, newMax - rescaledHarm);
        const restSuffix = rest ? ` | ${rest.trim().replace(/^\|\s*/, '')}` : '';
        return `${lead}${name.trim()}: ${rescaledHp}/${newMax} HP | Harm: ${rescaledHarm}/${newMax}${restSuffix}`;
    }

    return line;
}

/**
 * Non-destructively merges updated dossier configuration into an existing live memo.
 * Preserves active combat encounters ([COMBAT], [ENEMIES]), party companions, conditions,
 * location, and in-game time without resetting to Turn 0.
 *
 * @param {string} liveMemo The current state memo text
 * @param {object} dossier The updated PbtaCampaignDossier
 * @param {string} [charName] The protagonist's name
 * @returns {string} Merged memo text
 */
export function mergeDossierIntoLiveMemo(liveMemo, dossier, charName = null) {
    if (!liveMemo || typeof liveMemo !== 'string' || !liveMemo.trim()) {
        return liveMemo;
    }

    const p = dossier?.protagonist || {};
    const nextHarmMax = dossier?.config?.harmMax || p.harm?.max || 5;
    const effectiveName = (charName || p.name || '').trim();

    const lines = liveMemo.split('\n');
    let insideCharBlock = false;
    let charUpdated = false;

    const updatedLines = lines.map(line => {
        if (/^\[CHARACTER\]/i.test(line)) {
            insideCharBlock = true;
            return line;
        }
        if (/^\[\/CHARACTER\]/i.test(line)) {
            insideCharBlock = false;
            return line;
        }

        // 1. Rescale protagonist vitality line and update playbook if needed
        if (/Harm/i.test(line)) {
            const matchesProto = !effectiveName || line.toLowerCase().includes(effectiveName.toLowerCase()) || insideCharBlock;
            if (matchesProto && !charUpdated) {
                let workingLine = rescalePbtaHarmLine(line, nextHarmMax, insideCharBlock ? null : effectiveName);
                if (p.playbook && /^\s*[-*+•–—]?\s*(.+?)\s*\(([^)]+)\):/i.test(workingLine)) {
                    workingLine = workingLine.replace(/^(\s*[-*+•–—]?\s*)(.+?)\s*\(([^)]+)\)(:.*)$/i, (m, lead, nm, oldPb, rest) => {
                        return `${lead}${nm} (${p.playbook.trim()})${rest}`;
                    });
                }
                charUpdated = true;
                return workingLine;
            }
        }

        // 2. Fallback Playbook update if line didn't contain Harm
        if (insideCharBlock && p.playbook && /^\s*[-*+•–—]?\s*(.+?)\s*\(([^)]+)\):/i.test(line)) {
            const pbMatch = line.match(/^(\s*[-*+•–—]?\s*)(.+?)\s*\(([^)]+)\)(:.*)$/i);
            if (pbMatch && pbMatch[3].trim() !== p.playbook.trim()) {
                return `${pbMatch[1]}${pbMatch[2]} (${p.playbook.trim()})${pbMatch[4]}`;
            }
        }

        // 3. Update Stats if changed in dossier and inside [CHARACTER]
        if (insideCharBlock && p.stats && typeof p.stats === 'object' && /^Stats:/i.test(line.trim())) {
            const statsStr = Object.entries(p.stats)
                .map(([stat, val]) => `${stat} ${Number(val) > 0 ? '+' : ''}${val}`)
                .join(', ');
            return `Stats: ${statsStr}`;
        }

        // 4. Update Moves inside [CHARACTER] with properly formatted pills
        if (insideCharBlock && Array.isArray(p.startingMoves) && p.startingMoves.length > 0 && /^(?:\(\(PILLS\)\)\s*)?Moves:/i.test(line.trim())) {
            const movesStr = p.startingMoves.map(formatMoveAsPill).filter(Boolean).join(', ');
            if (movesStr) {
                return `((PILLS)) Moves: ${movesStr}`;
            }
        }

        // 5. Update Gear inside [CHARACTER] if current line is stock placeholder or dossier has gear/equipment
        if (insideCharBlock && /^(?:\(\(PILLS\)\)\s*)?Gear:/i.test(line.trim())) {
            const hasCustomGear = Array.isArray(p.gear) && p.gear.length > 0 && !p.gear.every(g => /^(?:Essential adventurer kit|Signature weapon|Basic equipment)/i.test(String(g || '').trim()));
            const rawGear = hasCustomGear
                ? p.gear
                : (typeof p.equipment === 'string' && p.equipment.trim())
                    ? splitTopLevelPillItems(p.equipment)
                    : [];
            if (rawGear.length > 0 && /Essential adventurer kit/i.test(line)) {
                const gearStr = rawGear.map(normalizePill).filter(Boolean).join(', ');
                if (gearStr) return `((PILLS)) Gear: ${gearStr}`;
            }
        }

        // 6. Repair Conditions inside [CHARACTER] if echoed prompt placeholder leaked
        if (insideCharBlock && /^(?:\(\(PILLS\)\)\s*)?Conditions:/i.test(line.trim()) && /starting\s+injury\s+or\s+weakness/i.test(line)) {
            return normalizePbtaPillsLine(line);
        }

        return line;
    });

    return updatedLines.join('\n');
}

/**
 * Force-renders Multihog tracker cards and optionally updates persistence layers.
 * Safe for pure DOM updates without triggering disk saves or SETTINGS_UPDATED loops.
 *
 * @param {object} s Multihog tracker settings
 * @param {string} chatId
 * @param {string} memo
 * @param {object} [options={}]
 * @param {boolean} [options.persist=false]
 * @returns {Promise<boolean>}
 */
export async function forceRenderTrackerView(s, chatId, memo, { persist = false } = {}) {
    if (!memo) return false;

    // 1. Textarea
    const textarea = typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo') : null;
    if (textarea) textarea.value = memo;

    // 2. Multihog global helper
    if (typeof globalThis._rpgUpdateUIMemo === 'function') {
        globalThis._rpgUpdateUIMemo(memo);
    }

    // 3. Runtime bridge
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.syncMemoView === 'function') bridge.syncMemoView();
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
        if (persist && typeof bridge.saveSettings === 'function') bridge.saveSettings();
    } catch (_) {}

    // 4. Force direct DOM card render if #rpg-tracker-render still shows .rt-empty
    const renderEl = typeof document !== 'undefined' ? document.getElementById('rpg-tracker-render') : null;
    if (renderEl) {
        try {
            const renderer = await import('../SillyTavern-MultihogDnDFramework/renderer.js');
            if (typeof renderer.renderMemoAsCards === 'function') {
                const cardsHtml = renderer.renderMemoAsCards(memo, null, {});
                if (cardsHtml && !cardsHtml.includes('rt-empty')) {
                    renderEl.innerHTML = cardsHtml;
                    if (typeof renderer.bindRenderedCardEvents === 'function') {
                        renderer.bindRenderedCardEvents(renderEl, memo, false);
                    }
                }
            }
        } catch (domErr) {
            console.warn('[MultiHog Companion] Direct card render fallback error:', domErr);
        }
    }

    // 4b. Decorate XP progress bars if ready for level up
    try {
        const { decorateXpBarsForLevelUp } = await import('./level-up-runner.js');
        decorateXpBarsForLevelUp();
    } catch (_) {}

    if (persist) {
        // 5. State manager
        try {
            const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
            if (typeof stateMgr.saveChatState === 'function' && chatId) {
                stateMgr.saveChatState(chatId);
            }
        } catch (_) {}

        // 6. SillyTavern settings persistence
        try {
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            if (typeof ctx?.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        } catch (_) {}
    }

    console.log(`[MultiHog Companion] Rendered Multihog game state memo for PbtA campaign in chat "${chatId}".`);
    return true;
}

