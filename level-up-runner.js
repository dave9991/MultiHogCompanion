/**
 * MultiHog Companion — Level-Up Runner & State Committer
 *
 * Coordinates deterministic XP evaluation, proposal formulation,
 * and surgical state memo patching.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { XP_LEVEL_THRESHOLDS, getTierPerks, getCanonicalDndProgression } from './level-up-blueprint.js';

/**
 * Evaluates whether the character has accumulated sufficient XP to advance a level.
 *
 * @param {string} memoText State memo text.
 * @param {string} [ruleset='dnd5e'] 'dnd5e' or 'pbta'.
 * @returns {{
 *   eligible: boolean,
 *   currentXp: number,
 *   maxThreshold: number,
 *   currentLevel: number,
 *   nextLevel: number,
 *   ruleset: string,
 *   surplusXp: number
 * }}
 */
export function evaluateLevelUpEligibility(memoText, ruleset = 'dnd5e') {
    const isPbta = ruleset === 'pbta' || /Harm\s*:\s*\d+\/\d+/i.test(memoText || '');

    if (isPbta) {
        const xpMatch = (memoText || '').match(/XP:\s*(\d+)(?:\/(\d+))?/i);
        const cur = xpMatch ? parseInt(xpMatch[1], 10) : 0;
        const max = xpMatch && xpMatch[2] ? parseInt(xpMatch[2], 10) : 5;
        const eligible = cur >= max && max > 0;
        return {
            eligible,
            currentXp: cur,
            maxThreshold: max,
            currentLevel: 1, // PbtA uses advances rather than numeric levels
            nextLevel: 2,
            ruleset: 'pbta',
            surplusXp: Math.max(0, cur - max),
        };
    }

    // Standard D&D 5e evaluation
    let currentXp = 0;
    let maxThreshold = 300;
    let currentLevel = 1;

    // Format A: Total: 1,200 / 2,700 XP (Level 3)
    const totalMatch = (memoText || '').match(/Total:\s*([\d,]+)\s*\/\s*([\d,]+)\s*XP\s*\(Level\s*(\d+)\)/i);
    // Format B: Level: 3 | XP: 1,200/2,700
    const legacyMatch = (memoText || '').match(/(?:Level:\s*(\d+)\s*\|?\s*)?XP:\s*([\d,]+)\/([\d,]+)/i);

    if (totalMatch) {
        currentXp = Number(totalMatch[1].replace(/,/g, ''));
        maxThreshold = Number(totalMatch[2].replace(/,/g, ''));
        currentLevel = parseInt(totalMatch[3], 10) || 1;
    } else if (legacyMatch) {
        currentLevel = legacyMatch[1] ? parseInt(legacyMatch[1], 10) : 1;
        currentXp = Number(legacyMatch[2].replace(/,/g, ''));
        maxThreshold = Number(legacyMatch[3].replace(/,/g, ''));
    } else {
        // Fallback: search [CHARACTER] for Level and [XP] for raw number
        const lvlSearch = (memoText || '').match(/Level\s*:\s*(\d+)/i);
        if (lvlSearch) currentLevel = parseInt(lvlSearch[1], 10) || 1;

        const xpNumSearch = (memoText || '').match(/XP\s*:\s*([\d,]+)/i);
        if (xpNumSearch) currentXp = Number(xpNumSearch[1].replace(/,/g, ''));

        // Derive threshold from D&D table
        const tableIndex = Math.min(currentLevel, XP_LEVEL_THRESHOLDS.length - 1);
        maxThreshold = XP_LEVEL_THRESHOLDS[tableIndex] || 300;
    }

    // Determine target threshold from canonical table if memo threshold is missing or 0
    if (!maxThreshold || maxThreshold <= 0) {
        const tableIndex = Math.min(currentLevel, XP_LEVEL_THRESHOLDS.length - 1);
        maxThreshold = XP_LEVEL_THRESHOLDS[tableIndex] || 300;
    }

    const eligible = currentXp >= maxThreshold && maxThreshold > 0;
    const surplusXp = Math.max(0, currentXp - maxThreshold);

    return {
        eligible,
        currentXp,
        maxThreshold,
        currentLevel,
        nextLevel: currentLevel + 1,
        ruleset: 'dnd5e',
        surplusXp,
    };
}

/**
 * Formulates a structured Level-Up Proposal Dossier based on character data,
 * progression blueprint, and target advancement level.
 *
 * @param {object} dossier Campaign dossier.
 * @param {object} blueprint Progression blueprint.
 * @param {number} targetLevel Target level being advanced to.
 * @param {object} [options={}] Optional user selections.
 * @returns {object} Proposal details for the Hybrid Review UI.
 */
export function formulateLevelUpProposal(dossier, blueprint, targetLevel, options = {}) {
    const isRespec = !!options.isRespec;
    const char = dossier?.protagonist || {};
    const isPbta = options.isPbta
        || dossier?.meta?.systemKey === 'pbta'
        || !!char.isPbta
        || !!char.playbook
        || !!char.harm
        || (dossier?.meta?.systemLabel && /PbtA|Dungeon World|Fellowship|Apocalypse/i.test(dossier.meta.systemLabel));

    if (isPbta) {
        const playbookName = char.playbook || char.class || 'Protagonist';
        const harm = char.harm || { current: 0, max: 4, armor: char.armor || 1 };
        const conditions = Array.isArray(char.conditions) ? [...char.conditions] : [];
        const stats = char.stats || {};

        let moves = [];
        if (Array.isArray(char.moves) && char.moves.length > 0) {
            moves = [...char.moves];
        } else if (Array.isArray(char.startingMoves) && char.startingMoves.length > 0) {
            moves = [...char.startingMoves];
        } else if (Array.isArray(char.features) && char.features.length > 0) {
            moves = [...char.features];
        }

        // Clean out any accidental D&D artifact strings
        moves = moves.filter(m => !/HP\s*Gain\s*:/i.test(m) && !/Hit\s*Die/i.test(m));

        return {
            isPbta: true,
            isRespec,
            characterName: char.name || 'Hero',
            className: playbookName,
            playbookName,
            targetLevel: null,
            currentLevel: null,
            hitDie: null,
            harm,
            conditions,
            stats,
            status: char.status || 'Healthy',
            hpChange: {
                oldMax: harm.max,
                gain: 0,
                newMax: harm.max,
                mode: 'pbta',
            },
            newFeatures: moves,
            isAsi: false,
            asiOptions: null,
            partyChanges: [],
        };
    }

    const conMod = Math.floor(((char.stats?.CON ?? 10) - 10) / 2);
    const perks = getTierPerks(blueprint, targetLevel, conMod);

    const oldHp = char.hp?.max || 10;
    
    // In Respec mode: character remains at their current level (no level advancement)
    const currentLevel = isRespec ? targetLevel : Math.max(1, targetLevel - 1);
    
    // In Respec mode: HP does not automatically increase; it is maintained by default
    const hpGain = isRespec ? 0 : (options.rolledHp !== undefined ? options.rolledHp : perks.averageHpGain);
    const newHp = isRespec ? oldHp : (oldHp + hpGain);

    // Active features: in respec mode, collect all active traits from level 1 up to currentLevel
    let features = [];
    if (isRespec) {
        if (blueprint?.levels) {
            for (let l = 1; l <= currentLevel; l++) {
                const lvlFeatures = blueprint.levels[String(l)]?.features || [];
                features.push(...lvlFeatures);
            }
        }
        if (Array.isArray(char.features) && char.features.length > 0) {
            features.push(...char.features);
        }
        features = Array.from(new Set(features));
        if (features.length === 0) {
            features = perks.features || [];
        }
    } else {
        features = perks.features || [];
    }

    // ASI or Feat recommendations if milestone level
    let asiOptions = null;
    if (perks.isAsi) {
        const primaryStat = blueprint?.primaryStats?.[0] || 'STR';
        const secondaryStat = blueprint?.primaryStats?.[1] || 'CON';
        asiOptions = {
            optionA: { type: 'asi', stat1: primaryStat, amount1: 2, label: `+2 to ${primaryStat}` },
            optionB: { type: 'asi', stat1: primaryStat, amount1: 1, stat2: secondaryStat, amount2: 1, label: `+1 to ${primaryStat} & +1 to ${secondaryStat}` },
            recommendedFeats: [
                'Sentinel',
                'Great Weapon Master',
                'Alert',
                'Mobile',
                'Lucky',
                'War Caster',
            ],
            selectedChoice: options.selectedAsi || 'optionA',
        };
    }

    // Party companions preview (only during actual level up, not respec)
    const partyChanges = [];
    if (!isRespec && dossier.config?.partySyncEnabled !== false) {
        const companions = dossier.party || [];
        for (const comp of companions) {
            partyChanges.push({
                name: comp.name,
                hpGain: Math.max(4, Math.floor(perks.averageHpGain * 0.8)),
                classFeature: `Scaled to Tier ${Math.ceil(targetLevel / 4)}`,
            });
        }
    }

    return {
        targetLevel,
        currentLevel,
        characterName: char.name || 'Hero',
        className: blueprint?.className || char.class || 'Adventurer',
        hitDie: perks.hitDie,
        hpChange: {
            oldMax: oldHp,
            gain: hpGain,
            newMax: newHp,
            mode: isRespec ? 'respec' : (options.rolledHp !== undefined ? 'rolled' : 'average'),
        },
        newFeatures: features,
        isAsi: perks.isAsi,
        asiOptions,
        partyChanges,
        isRespec,
    };
}

/**
 * Surgically commits the approved Level-Up / Respec proposal into the active State Memo.
 *
 * @param {object} params
 * @param {string} params.chatId Active chat ID.
 * @param {string} params.currentMemo Live state memo to update.
 * @param {object} params.proposal Approved proposal data.
 * @param {boolean} [params.isRespec=false] Whether this is a respec operation.
 * @param {object} [params.rpgSettings=null] MultiHog settings container.
 * @returns {{
 *   success: boolean,
 *   updatedMemo: string,
 *   summary: string
 * }}
 */
export function applyLevelUpCommit({ chatId, currentMemo, proposal, isRespec = false, rpgSettings = null }) {
    if (!currentMemo || typeof currentMemo !== 'string') {
        return { success: false, updatedMemo: currentMemo, summary: 'No active state memo found.' };
    }

    if (proposal.isPbta) {
        let updatedMemo = currentMemo;
        const charMatch = updatedMemo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
        if (charMatch) {
            let charBlock = charMatch[1];
            // If moves were modified
            if (Array.isArray(proposal.newFeatures)) {
                const movesStr = proposal.newFeatures.join(', ');
                if (/(?:\(\(PILLS\)\)\s*)?Moves\s*:/i.test(charBlock)) {
                    charBlock = charBlock.replace(
                        /((?:\(\(PILLS\)\)\s*)?Moves\s*:)[^\n\r]+/i,
                        `$1 ${movesStr}`
                    );
                }
            }
            // Update Harm & Armor if present in proposal
            if (proposal.harm) {
                if (/Harm\s*:\s*\d+\/\d+/i.test(charBlock)) {
                    charBlock = charBlock.replace(
                        /Harm\s*:\s*\d+\/\d+/i,
                        `Harm: ${proposal.harm.current}/${proposal.harm.max}`
                    );
                }
                if (/Armor\s*:\s*\d+/i.test(charBlock) && proposal.harm.armor !== undefined) {
                    charBlock = charBlock.replace(
                        /Armor\s*:\s*\d+/i,
                        `Armor: ${proposal.harm.armor}`
                    );
                }
            }
            updatedMemo = updatedMemo.replace(charMatch[0], `[CHARACTER]${charBlock}[/CHARACTER]`);
        }

        // Advance XP if not respec
        if (!isRespec) {
            const xpMatch = updatedMemo.match(/XP:\s*(\d+)(?:\/(\d+))?/i);
            if (xpMatch) {
                const cur = parseInt(xpMatch[1], 10) || 0;
                const max = parseInt(xpMatch[2], 10) || 5;
                const nextCur = Math.max(0, cur - max);
                updatedMemo = updatedMemo.replace(/XP:\s*\d+(?:\/\d+)?/i, `XP: ${nextCur}/${max}`);
            }
        }

        // Sync settings / partition
        if (rpgSettings) {
            rpgSettings.currentMemo = updatedMemo;
            if (rpgSettings.chatStates && chatId && rpgSettings.chatStates[chatId]) {
                rpgSettings.chatStates[chatId].currentMemo = updatedMemo;
                const proto = rpgSettings.chatStates[chatId].pbtaCampaignDossier?.protagonist;
                if (proto) {
                    proto.moves = [...(proposal.newFeatures || [])];
                    if (proposal.harm) proto.harm = { ...proposal.harm };
                }
            }
            if (typeof document !== 'undefined') {
                const memoEl = document.getElementById('rpg-tracker-memo');
                if (memoEl) {
                    memoEl.value = updatedMemo;
                    memoEl.dispatchEvent(new Event('input', { bubbles: true }));
                    memoEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.saveSettingsDebounced === 'function') {
                SillyTavern.getContext().saveSettingsDebounced();
            } else if (typeof globalThis.saveSettingsDebounced === 'function') {
                globalThis.saveSettingsDebounced();
            }
        }

        return {
            success: true,
            updatedMemo,
            summary: isRespec
                ? `Playbook sheet successfully tuned and saved.`
                : `Playbook Advance Complete! ${proposal.characterName}'s advances applied.`,
        };
    }

    let updatedMemo = currentMemo;
    const targetLevel = proposal.targetLevel;
    const newMaxHp = proposal.hpChange?.newMax;

    // 1. Update [CHARACTER] block
    const charMatch = updatedMemo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    if (charMatch) {
        let charBlock = charMatch[1];

        // Update Level
        if (!isRespec) {
            charBlock = charBlock.replace(/(Level\s*[:\s]\s*)\d+/i, `$1${targetLevel}`);
        }

        // Update HP: X/Y HP
        if (newMaxHp) {
            charBlock = charBlock.replace(/(\d+)\s*\/\s*(\d+)\s*HP/i, (m, cur, oldMax) => {
                const diff = newMaxHp - parseInt(oldMax, 10);
                const nextCur = parseInt(cur, 10) + (diff > 0 ? diff : 0);
                return `${nextCur}/${newMaxHp} HP`;
            });
        }

        // Apply ASI if chosen
        if (proposal.asiChoice?.type === 'asi') {
            const { stat1, amount1, stat2, amount2 } = proposal.asiChoice;
            if (stat1 && amount1) {
                const re1 = new RegExp(`\\b(${stat1}\\s*[:=]?\\s*)(\\d+)`, 'i');
                charBlock = charBlock.replace(re1, (m, prefix, val) => `${prefix}${parseInt(val, 10) + amount1}`);
            }
            if (stat2 && amount2) {
                const re2 = new RegExp(`\\b(${stat2}\\s*[:=]?\\s*)(\\d+)`, 'i');
                charBlock = charBlock.replace(re2, (m, prefix, val) => `${prefix}${parseInt(val, 10) + amount2}`);
            }
        }

        // Append new feature to Abilities/Features line if present
        if (Array.isArray(proposal.newFeatures) && proposal.newFeatures.length > 0) {
            const featText = proposal.newFeatures.join(', ');
            if (/Abilities\s*:/i.test(charBlock)) {
                charBlock = charBlock.replace(/(Abilities\s*:[^\n\r]*)/i, `$1, ${featText}`);
            } else if (/Features\s*:/i.test(charBlock)) {
                charBlock = charBlock.replace(/(Features\s*:[^\n\r]*)/i, `$1, ${featText}`);
            }
        }

        updatedMemo = updatedMemo.replace(charMatch[0], `[CHARACTER]${charBlock}[/CHARACTER]`);
    }

    // 2. Update [XP] block
    if (!isRespec) {
        const nextThreshold = targetLevel < XP_LEVEL_THRESHOLDS.length
            ? XP_LEVEL_THRESHOLDS[targetLevel]
            : XP_LEVEL_THRESHOLDS[XP_LEVEL_THRESHOLDS.length - 1];

        // Update Total: X / Y XP (Level Z)
        if (/Total:\s*[\d,]+\s*\/\s*[\d,]+\s*XP/i.test(updatedMemo)) {
            updatedMemo = updatedMemo.replace(
                /Total:\s*([\d,]+)\s*\/\s*[\d,]+\s*XP\s*\(Level\s*\d+\)/i,
                (m, cur) => `Total: ${cur} / ${nextThreshold.toLocaleString('en-US')} XP (Level ${targetLevel})`
            );
        } else if (/\[XP\]([\s\S]*?)\[\/XP\]/i.test(updatedMemo)) {
            updatedMemo = updatedMemo.replace(
                /\[XP\]([\s\S]*?)\[\/XP\]/i,
                (m, content) => {
                    let updatedXp = content.replace(/(Level\s*[:\s]\s*)\d+/i, `$1${targetLevel}`);
                    updatedXp = updatedXp.replace(/(XP:\s*[\d,]+)\/[\d,]+/i, `$1/${nextThreshold.toLocaleString('en-US')}`);
                    return `[XP]${updatedXp}[/XP]`;
                }
            );
        }
    }

    // 3. Update party companions if present and sync enabled
    if (Array.isArray(proposal.partyChanges) && proposal.partyChanges.length > 0) {
        const partyMatch = updatedMemo.match(/\[PARTY\]([\s\S]*?)\[\/PARTY\]/i);
        if (partyMatch) {
            let partyBlock = partyMatch[1];
            for (const pc of proposal.partyChanges) {
                const re = new RegExp(`(${pc.name}[^\\n:]*:\\s*)(\\d+)\\s*\\/\\s*(\\d+)\\s*HP`, 'i');
                partyBlock = partyBlock.replace(re, (m, prefix, cur, max) => {
                    const nextMax = parseInt(max, 10) + pc.hpGain;
                    const nextCur = parseInt(cur, 10) + pc.hpGain;
                    return `${prefix}${nextCur}/${nextMax} HP`;
                });
            }
            updatedMemo = updatedMemo.replace(partyMatch[0], `[PARTY]${partyBlock}[/PARTY]`);
        }
    }

    // Commit to MultiHog live settings if provided
    if (rpgSettings) {
        rpgSettings.currentMemo = updatedMemo;
        if (typeof globalThis._rpgUpdateUIMemo === 'function') {
            globalThis._rpgUpdateUIMemo(updatedMemo);
        }
        if (rpgSettings.chatStates && chatId && rpgSettings.chatStates[chatId]) {
            rpgSettings.chatStates[chatId].currentMemo = updatedMemo;
        }

        // Keep DOM textarea in sync if present
        if (typeof document !== 'undefined') {
            const memoEl = document.getElementById('rpg-tracker-memo');
            if (memoEl) {
                memoEl.value = updatedMemo;
                memoEl.dispatchEvent(new Event('input', { bubbles: true }));
                memoEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Persist settings
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.saveSettingsDebounced === 'function') {
            SillyTavern.getContext().saveSettingsDebounced();
        } else if (typeof globalThis.saveSettingsDebounced === 'function') {
            globalThis.saveSettingsDebounced();
        }
    }

    const summary = isRespec
        ? `Character sheet successfully tuned and respec applied.`
        : `Level Up Complete! ${proposal.characterName} is now Level ${targetLevel} (Max HP: ${newMaxHp}).`;

    return {
        success: true,
        updatedMemo,
        summary,
    };
}

/**
 * Decorates rendered XP progress bars in the RPG tracker panel with a golden
 * glow and an interactive Level-Up badge when currentXP >= maxThreshold.
 */
export function decorateXpBarsForLevelUp() {
    if (typeof document === 'undefined') return;
    const xpRows = document.querySelectorAll('.rt-xp-row');
    for (const row of xpRows) {
        const cur = Number(row.dataset.xpCurrent || 0);
        const max = Number(row.dataset.xpMax || 0);
        if (max > 0 && cur >= max) {
            row.classList.add('mhc-xp-level-up-ready');
            const labelEl = row.querySelector('.rt-xp-label');
            if (labelEl && !labelEl.querySelector('.mhc-xp-level-up-badge')) {
                const badge = document.createElement('span');
                badge.className = 'mhc-xp-level-up-badge';
                badge.innerHTML = '<i class="fa-solid fa-arrow-up"></i> Level Up!';
                badge.title = 'Click to Level Up character';
                labelEl.appendChild(badge);
            }
        } else {
            row.classList.remove('mhc-xp-level-up-ready');
            row.querySelector('.mhc-xp-level-up-badge')?.remove();
        }
    }
}

