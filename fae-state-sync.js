/**
 * fae-state-sync.js — MultiHog Companion
 *
 * Bridges Freeform Attrition Engine (FAE) state with MultiHog's State Tracker
 * memo ([CHARACTER], [COMBAT], [PARTY]).
 *
 * Guarantees:
 * 1. Primary Pool (Health/Body/Grit) is always synchronized in lockstep with
 *    Line 1 "Name: cur/max HP" for MultiHog's health bar and portrait engine.
 * 2. Secondary pools (Sanity, Resolve, Torch & Supplies) are formatted as
 *    MultiHog ((BAR:color)) progress lines.
 * 3. Enforces post-turn deterministic clamp at 0 and adds pool zero_debuff.
 * 4. Enforces overflow redirection and scar_and_ko consequences.
 * 5. Synchronizes Scenes completed with XP for milestone tracking.
 */

import {
    FAE_GENRES,
    createInitialFaeState,
    sanitizeFaePositiveTags,
    toMultihogBarMarker,
} from './fae-ruleset.js';
import { stripMarkdownNameArtifacts } from './character-creator-sanitizer.js';

/**
 * Normalizes pool display labels to canonical object keys (e.g. "Torch & Supplies" -> "torch_and_supplies").
 *
 * @param {string} label
 * @returns {string}
 */
export function poolLabelToKey(label) {
    if (!label || typeof label !== 'string') return '';
    return label
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Splits a string on top-level commas or semicolons outside parentheses/brackets.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function splitTopLevelPillItems(str) {
    if (!str || typeof str !== 'string') return [];
    const res = [];
    let cur = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);

        const isSep = depth === 0 && (
            c === ';' ||
            (c === ',' && !(i > 0 && i < str.length - 1 && /\d/.test(str[i - 1]) && /\d/.test(str[i + 1])))
        );
        if (isSep) {
            if (cur.trim()) res.push(cur.trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    if (cur.trim()) res.push(cur.trim());
    return res;
}

/**
 * Normalizes a pill item so it follows "Name (Description)" syntax.
 *
 * @param {string} item
 * @param {string} [defaultDesc='']
 * @returns {string}
 */
export function normalizeFaePill(item, defaultDesc = '') {
    if (!item || typeof item !== 'string') return '';
    let trimmed = item.trim().replace(/^[-*•]\s*/, '').trim();
    if (!trimmed) return '';

    // Check if it already has trailing parentheses
    if (/\([^)]+\)$/.test(trimmed)) {
        return trimmed;
    }

    // Check "Name: Desc"
    const colonMatch = trimmed.match(/^([^:()]{1,40}):\s*(.+)$/);
    if (colonMatch) {
        const name = colonMatch[1].trim();
        const desc = colonMatch[2].trim().replace(/\(/g, '[').replace(/\)/g, ']');
        return `${name} (${desc})`;
    }

    return defaultDesc ? `${trimmed} (${defaultDesc})` : trimmed;
}

/**
 * Formats the [CHARACTER] memo block for an active FAE state.
 *
 * @param {object} faeState Structured FAE state
 * @returns {string} Formatted [CHARACTER] block
 */
export function formatFaeCharacterMemoBlock(faeState) {
    if (!faeState || typeof faeState !== 'object') return '';
    const char = faeState.character || {};
    const name = char.name || 'Protagonist';
    const archetype = char.archetype || faeState.genre || 'Investigator';
    const knobs = faeState.knobs || { flee_grace_toggle: true, base_attrition_shift: 0, overflow_default: 'scar_and_ko' };
    const pools = faeState.pools || {};
    const poolKeys = Object.keys(pools);

    if (poolKeys.length === 0) {
        return '';
    }

    const primaryKey = poolKeys[0];
    const primaryPool = pools[primaryKey];
    const secondaryKeys = poolKeys.slice(1);

    const scenesCur = char.scenes_completed ?? 0;
    const scenesMax = char.scenes_target ?? 4;

    const lines = ['[CHARACTER]'];

    // Line 1: Name (Archetype): cur/max HP | Pool: Label (cur/max) | Scenes: X/Y | XP: X/Y
    lines.push(
        `${name} (${archetype}): ${primaryPool.current}/${primaryPool.max} HP | Pool: ${primaryPool.label} (${primaryPool.current}/${primaryPool.max}) | Scenes: ${scenesCur}/${scenesMax} | XP: ${scenesCur}/${scenesMax}`
    );

    // Secondary Pools (Pools 2 and 3)
    for (const key of secondaryKeys) {
        const p = pools[key];
        const barMarker = toMultihogBarMarker(p.barColor);
        lines.push(
            `${barMarker} ${p.label}: ${p.current}/${p.max}`
        );
    }

    // Knobs and Active Temporary Advantage
    const hasHeroicDomain = Boolean(char.heroic_domain && !/^(?:none|null)$/i.test(String(char.heroic_domain).trim()));
    const isHeroic = Boolean(knobs.heroic_tier || hasHeroicDomain);

    const shiftStr = knobs.base_attrition_shift >= 0 ? `+${knobs.base_attrition_shift}` : `${knobs.base_attrition_shift}`;
    const advSnippet = char.temp_advantage ? ` | [Advantage: ${char.temp_advantage}]` : '';
    const heroicSnippet = isHeroic ? ' | Heroic: ON' : '';
    const flags = faeState.state_flags || { breather_available: true, turns_since_last_test: 0 };
    const tempoStr = knobs.action_tempo || 'gritty_default';
    const idleStr = `${flags.turns_since_last_test ?? 0}t`;
    const breatherStr = flags.breather_available !== false ? 'READY' : 'USED';
    lines.push(
        `FAE Knobs: Flee Grace: ${knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Shift: ${shiftStr} | Overflow: ${knobs.overflow_default} | Tempo: ${tempoStr} | Idle: ${idleStr} | Breather: ${breatherStr}${heroicSnippet}${advSnippet}`
    );

    if (isHeroic) {
        lines.push(`Heroic Domain: ${char.heroic_domain || 'None'}`);
    }

    // Positive Tags
    const rawPosTags = Array.isArray(char.positive_tags) ? char.positive_tags : [];
    const formattedPosTags = rawPosTags.map(t => normalizeFaePill(t, 'Positive Tag')).filter(Boolean);
    lines.push(`((PILLS)) Positive Tags: ${formattedPosTags.length > 0 ? formattedPosTags.join(', ') : 'None'}`);

    // Scars & Debuffs (and temp advantage formatted as a (+) pill)
    const rawNegTags = Array.isArray(char.negative_tags) ? char.negative_tags : [];
    const debuffPills = rawNegTags.map(t => {
        let clean = t.trim();
        const hasMinus = clean.startsWith('(-)');
        if (hasMinus) clean = clean.replace(/^\(-\)\s*/, '');
        const normalized = normalizeFaePill(clean, 'Debuff');
        return `(-) ${normalized}`;
    });

    if (char.temp_advantage) {
        debuffPills.push(`(+) Advantage: ${char.temp_advantage} (-1 Attrition on next action)`);
    }

    lines.push(`((PILLS)) Scars & Debuffs: ${debuffPills.length > 0 ? debuffPills.join(', ') : 'None'}`);

    // Status
    let statusStr = 'Healthy';
    if (primaryPool.current === 0) {
        statusStr = `(-) ${primaryPool.zero_debuff} (Breaking Point)`;
    } else {
        const zeroPool = Object.values(pools).find(p => p.current === 0);
        if (zeroPool) {
            statusStr = `(-) ${zeroPool.zero_debuff}`;
        } else if (rawNegTags.length > 0) {
            statusStr = '(-) Strained & Injured';
        }
    }
    lines.push(`Status: ${statusStr}`);
    lines.push('[/CHARACTER]');

    return lines.join('\n');
}

/**
 * Parses a MultiHog memo string into a structured FAE state object.
 *
 * @param {string} memoText Full state memo or [CHARACTER] block
 * @param {string} [fallbackGenreKey='cosmic_horror']
 * @returns {object} Structured FAE state
 */
export function parseFaeStateFromMemo(memoText, fallbackGenreKey = 'cosmic_horror') {
    const fallbackGenre = FAE_GENRES[fallbackGenreKey] || FAE_GENRES.cosmic_horror;
    const baseState = createInitialFaeState(fallbackGenre.id);

    if (!memoText || typeof memoText !== 'string') {
        return baseState;
    }

    const charBlockMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    const charText = charBlockMatch ? charBlockMatch[1] : memoText;
    const charLines = charText.split('\n');

    // 1. Line 1: Name (Archetype): cur/max HP | Pool: Label (cur/max) | Scenes: X/Y | XP: X/Y
    let line1 = charLines.find(l => /HP/i.test(l)) || '';
    if (line1) {
        line1 = line1.replace(/[*_`~]/g, '');
        while (/(\s*\(\s*([^)]+?)\s*\))\s*\(\s*\2\s*\)/i.test(line1)) {
            line1 = line1.replace(/(\s*\(\s*([^)]+?)\s*\))\s*\(\s*\2\s*\)/gi, '$1');
        }
    }
    const clauses = line1.split('|').map(s => s.trim());

    let name = baseState.character.name;
    let archetype = baseState.character.archetype;
    let primaryCur = null;
    let primaryMax = null;
    let primaryLabel = null;
    let scenesCur = baseState.character.scenes_completed;
    let scenesMax = baseState.character.scenes_target;

    if (clauses.length > 0) {
        const headMatch = clauses[0].match(/^\s*[-*+•–—]?\s*(.+?)(?:\s*\(([^)]+)\))?:\s*([+-]?\d+)\/(\d+)\s*HP/i);
        if (headMatch) {
            name = stripMarkdownNameArtifacts(headMatch[1]) || headMatch[1].trim();
            archetype = headMatch[2] ? headMatch[2].trim() : archetype;
            primaryCur = parseInt(headMatch[3], 10);
            primaryMax = parseInt(headMatch[4], 10);
        }
        let foundScenes = false;
        for (let i = 1; i < clauses.length; i++) {
            const c = clauses[i];
            const pMatch = c.match(/^Pool:\s*([^(\n]+?)(?:\s*\(([+-]?\d+)\/(\d+)\))?$/i);
            if (pMatch) {
                primaryLabel = pMatch[1].trim();
                if (pMatch[2] !== undefined) primaryCur = parseInt(pMatch[2], 10);
                if (pMatch[3] !== undefined) primaryMax = parseInt(pMatch[3], 10);
            }
            const sMatch = c.match(/^Scenes:\s*(\d+)\/(\d+)$/i);
            if (sMatch) {
                scenesCur = parseInt(sMatch[1], 10);
                scenesMax = parseInt(sMatch[2], 10);
                foundScenes = true;
            }
            const xMatch = c.match(/^XP:\s*(\d+)\/(\d+)$/i);
            if (xMatch && !foundScenes) {
                scenesCur = parseInt(xMatch[1], 10);
                scenesMax = parseInt(xMatch[2], 10);
            }
        }
    }

    // 2. FAE Knobs Line: FAE Knobs: [Heroic: ON | ]Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko[ | Tempo: ...] [ | Idle: ...] [ | Breather: ...] [ | Heroic: ON][ | [Advantage: ...]]
    const knobsLineMatch = charText.match(/FAE Knobs:\s*([^\n\r]+)/i);
    const knobs = { ...baseState.knobs };
    const state_flags = { ...baseState.state_flags };
    let tempAdvantage = null;

    if (knobsLineMatch) {
        const kLine = knobsLineMatch[1];
        const fleeM = kLine.match(/Flee Grace:\s*(ON|OFF)/i);
        if (fleeM) knobs.flee_grace_toggle = fleeM[1].toUpperCase() === 'ON';

        const shiftM = kLine.match(/Shift:\s*([+-]?\d+)/i);
        if (shiftM) knobs.base_attrition_shift = parseInt(shiftM[1], 10) || 0;

        const overM = kLine.match(/Overflow:\s*([a-zA-Z0-9_:]+)/i);
        if (overM) knobs.overflow_default = overM[1].trim();

        const tempoM = kLine.match(/Tempo:\s*([a-zA-Z0-9_]+)/i);
        if (tempoM) knobs.action_tempo = tempoM[1].trim();

        const idleM = kLine.match(/Idle:\s*(\d+)t?/i);
        if (idleM) state_flags.turns_since_last_test = parseInt(idleM[1], 10);

        const breatherM = kLine.match(/Breather:\s*([a-zA-Z0-9_]+)/i);
        if (breatherM) state_flags.breather_available = !/^(?:USED|OFF|false)$/i.test(breatherM[1].trim());

        const heroicM = kLine.match(/\bHeroic:\s*(ON|OFF|true|false)\b/i);
        if (heroicM) knobs.heroic_tier = /^(?:ON|true)$/i.test(heroicM[1]);

        const advM = kLine.match(/\[Advantage:\s*([^\]]+)\]/i);
        if (advM) tempAdvantage = advM[1].trim();
    }

    // Parse Heroic Domain slot if present
    let heroicDomain = null;
    const domainMatch = charText.match(/^Heroic Domain:\s*(.+)$/m);
    if (domainMatch) {
        const val = domainMatch[1].trim();
        if (val && !/^(?:none|null)$/i.test(val)) {
            heroicDomain = val;
            knobs.heroic_tier = true;
        }
    }

    // 3. Pools Parsing
    const parsedPools = {};
    const defaultPoolKeys = Object.keys(fallbackGenre.pools);
    const defaultPrimaryKey = defaultPoolKeys[0];
    const defaultPrimary = fallbackGenre.pools[defaultPrimaryKey];

    // Initialize primary pool from line 1
    const activePrimaryKey = primaryLabel ? poolLabelToKey(primaryLabel) : defaultPrimaryKey;
    const effectivePrimaryConfig = fallbackGenre.pools[activePrimaryKey] || defaultPrimary;

    parsedPools[activePrimaryKey] = {
        key: activePrimaryKey,
        label: primaryLabel || effectivePrimaryConfig.label,
        barColor: effectivePrimaryConfig.barColor || 'green',
        current: primaryCur !== null && !isNaN(primaryCur) ? primaryCur : effectivePrimaryConfig.current,
        max: primaryMax !== null && !isNaN(primaryMax) ? primaryMax : effectivePrimaryConfig.max,
        recovery: effectivePrimaryConfig.recovery,
        passive_drain: effectivePrimaryConfig.passive_drain ? { ...effectivePrimaryConfig.passive_drain } : null,
        strain_flavor: effectivePrimaryConfig.strain_flavor,
        zero_debuff: effectivePrimaryConfig.zero_debuff,
        on_overflow: effectivePrimaryConfig.on_overflow,
    };

    // Parse secondary pool lines
    for (const line of charLines) {
        if (/^(?:\[|\/|Status|Positive Tags|Scars|Conditions|FAE Knobs)/i.test(line.trim())) continue;
        if (/HP/i.test(line) && line.includes(name)) continue;

        // Check for ((BAR...)) or bare pool line: Label: cur/max (...)
        const barMatch = line.match(/(?:\(\(BAR(?::\s*([a-zA-Z]+)|([a-zA-Z]+)|\s*-\s*([^)]+))?\)\)\s*)?([A-Za-z0-9\s&]+?):\s*([+-]?\d+)\/(\d+)(?:\s*HP)?(?:\s*\(([^)]*)\))?/i);
        if (barMatch) {
            const rawLabel = barMatch[4].trim();
            if (/^(?:Pool|Scenes|XP|FAE Knobs|Status|Positive Tags|Scars|Conditions|Stats)/i.test(rawLabel)) {
                continue;
            }
            const pKey = poolLabelToKey(rawLabel);
            if (pKey === activePrimaryKey) continue; // Already primary

            const curVal = parseInt(barMatch[5], 10);
            const maxVal = parseInt(barMatch[6], 10);
            const details = barMatch[7] || '';
            const defaultPool = fallbackGenre.pools[pKey] || {};

            let zeroDebuff = defaultPool.zero_debuff || `${rawLabel} Trauma`;
            let recovery = defaultPool.recovery || 'camp_or_sleep';

            const zdMatch = details.match(/Zero Debuff:\s*([^|)]+)/i);
            if (zdMatch) zeroDebuff = zdMatch[1].trim();
            const recMatch = details.match(/Recovery:\s*([^|)]+)/i);
            if (recMatch) recovery = recMatch[1].trim();

            const rawColor = (barMatch[1] || barMatch[2] || barMatch[3] || '').trim().toLowerCase();
            const resolvedColor = (rawColor === 'amber' || rawColor === 'gold')
                ? 'gold'
                : (rawColor || defaultPool.barColor || 'purple');

            parsedPools[pKey] = {
                key: pKey,
                label: defaultPool.label || rawLabel,
                barColor: resolvedColor,
                current: isNaN(curVal) ? (defaultPool.current || maxVal) : curVal,
                max: isNaN(maxVal) ? (defaultPool.max || 6) : maxVal,
                recovery,
                passive_drain: defaultPool.passive_drain ? { ...defaultPool.passive_drain } : null,
                strain_flavor: defaultPool.strain_flavor || `${rawLabel} strain`,
                zero_debuff: zeroDebuff,
                on_overflow: defaultPool.on_overflow || knobs.overflow_default || 'redirect:health',
            };
        }
    }

    // Ensure all fallback genre pools exist in parsedPools
    for (const [k, p] of Object.entries(fallbackGenre.pools)) {
        if (!parsedPools[k]) {
            parsedPools[k] = { ...p, passive_drain: p.passive_drain ? { ...p.passive_drain } : null };
        }
    }

    // 4. Positive Tags
    let positiveTags = [];
    const posMatch = charText.match(/(?:\(\(PILLS\)\)\s*)?Positive Tags:\s*(.+)$/m);
    if (posMatch && !/^none$/i.test(posMatch[1].trim())) {
        positiveTags = splitTopLevelPillItems(posMatch[1])
            .map(t => t.trim())
            .filter(t => t && !/^none$/i.test(t));
    } else {
        positiveTags = [...fallbackGenre.defaultPositiveTags];
    }

    // 5. Scars & Debuffs
    const negativeTags = [];
    const negMatch = charText.match(/(?:\(\(PILLS\)\)\s*)?(?:Scars & Debuffs|Conditions):\s*(.+)$/m);
    if (negMatch && !/^none$/i.test(negMatch[1].trim())) {
        const rawItems = splitTopLevelPillItems(negMatch[1]);
        for (const item of rawItems) {
            const clean = item.trim();
            if (!clean || /^none$/i.test(clean)) continue;

            // Extract (+) Advantage tag if present
            const advPillMatch = clean.match(/^\(\+\)\s*Advantage:\s*([^(]+)/i);
            if (advPillMatch) {
                if (!tempAdvantage) {
                    tempAdvantage = advPillMatch[1].trim();
                }
                continue;
            }

            // Normal negative debuff
            const deMinus = clean.replace(/^\(-\)\s*/, '').trim();
            negativeTags.push(deMinus);
        }
    }

    // 6. Active Encounter in [COMBAT]
    let activeEncounter = null;
    const combatMatch = memoText.match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i);
    if (combatMatch && combatMatch[1].trim()) {
        const combatText = combatMatch[1].trim();
        const encRegex = /^\s*([^:\n]+?):\s*(\d+)\/(\d+)\s*HP\s*\|\s*Threat:\s*(\d+)(?:\s*\(([^)]+)\))?\s*\|\s*Pools:\s*([^\n]+)/m;
        const encMatch = combatText.match(encRegex);
        if (encMatch) {
            const statusMatch = combatText.match(/^Status:\s*([^[\n\r]+?)(?:\s*\[Barriers:\s*([^\]]+)\])?$/mi);
            const statusVal = statusMatch ? statusMatch[1].trim() : (combatText.match(/^Status:\s*(.+)$/m)?.[1]?.trim() || 'Active');
            const barriersVal = statusMatch?.[2]?.trim() || combatText.match(/Leverage Barriers(?:\s*\([^)]*\))?:\s*(.+)$/m)?.[1]?.trim() || '';
            const instinctVal = combatText.match(/^Instinct:\s*(.+)$/m)?.[1]?.trim() || '';

            activeEncounter = {
                name: encMatch[1].trim(),
                currentHp: parseInt(encMatch[2], 10),
                maxHp: parseInt(encMatch[3], 10),
                threat: parseInt(encMatch[4], 10),
                threatLabel: encMatch[5] ? encMatch[5].trim() : '',
                pools: encMatch[6].trim(),
                pressures: combatText.match(/(?:\(\(PILLS\)\)\s*)?Pressures:\s*(.+)$/m)?.[1]?.trim() || '',
                instinct: instinctVal,
                barriers: barriersVal,
                triggers: combatText.match(/Full-Finish Triggers:\s*(.+)$/m)?.[1]?.trim() || '',
                status: statusVal,
            };
        }
    }

    return {
        genre: fallbackGenre.label,
        genreKey: fallbackGenre.id,
        knobs,
        state_flags,
        character: {
            name,
            archetype,
            heroic_domain: knobs.heroic_tier ? (heroicDomain || (fallbackGenre.knobs?.heroic_tier ? fallbackGenre.defaultHeroicDomain : null)) : null,
            positive_tags: sanitizeFaePositiveTags(positiveTags, 5),
            negative_tags: negativeTags,
            temp_advantage: tempAdvantage,
            scenes_completed: scenesCur,
            scenes_target: scenesMax,
        },
        pools: parsedPools,
        activeEncounter,
    };
}

/**
 * Normalizes a single ((PILLS)) line in [COMBAT] or [CHARACTER] to ensure proper
 * syntax without broken parentheses.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizeFaePillsLine(line) {
    if (!line || typeof line !== 'string') return line;
    const pillLineMatch = line.match(/^(\s*(?:\(\(PILLS\)\)\s*)?[^:]+:\s*)(.+)$/i);
    if (!pillLineMatch) return line;

    const [, prefix, content] = pillLineMatch;
    if (/^none$/i.test(content.trim())) return line;

    const items = splitTopLevelPillItems(content);
    const cleaned = items.map(it => normalizeFaePill(it)).filter(Boolean);
    return `${prefix}${cleaned.join(', ')}`;
}

/**
 * Strips any [PARTY]...[/PARTY] block from a state memo for the FAE ruleset
 * (WRK-09: Upstream mergeMemo appends [PARTY] regardless of modules.party).
 *
 * @param {string} memo
 * @returns {string} Memo with [PARTY] block completely removed
 */
export function stripFaePartyBlockFromMemo(memo) {
    if (!memo || typeof memo !== 'string') return memo;
    if (!/\[PARTY\][\s\S]*?\[\/PARTY\]/i.test(memo)) return memo;
    return memo
        .replace(/\s*\[PARTY\][\s\S]*?\[\/PARTY\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Reconciles the state memo after an LLM turn, serving as a deterministic safety net.
 *
 * Enforces:
 * 1. Stage 1 Breaking Point Clamp: When a pool drops from > 0 to <= 0, clamps to 0
 *    and ensures its zero_debuff is present in Scars & Debuffs.
 * 2. Stage 2 Overflow: When a pool was already at 0 and takes loss, executes
 *    on_overflow rules (redirecting to target pool or scar_and_ko).
 * 3. Primary Pool <-> Line 1 HP lockstep synchronization.
 * 4. Scenes <-> XP synchronization and scene incrementation on combat resolution.
 * 5. Pill syntax normalization.
 *
 * @param {object|string} prevMemoOrState
 * @param {string} nextMemo
 * @param {string} [genreKey='cosmic_horror']
 * @param {object|null} [toolResolvedState=null] Authoritative state from resolve_fae_action tool call
 * @returns {{ memo: string, changed: boolean, state: object, events: string[] }}
 */
export function reconcileFaeMemoAfterTurn(prevMemoOrState, nextMemo, genreKey = 'cosmic_horror', toolResolvedState = null) {
    if (!nextMemo || typeof nextMemo !== 'string') {
        return { memo: nextMemo, changed: false, state: null, events: [] };
    }

    const prevState = typeof prevMemoOrState === 'string'
        ? parseFaeStateFromMemo(prevMemoOrState, genreKey)
        : prevMemoOrState;

    const nextState = parseFaeStateFromMemo(nextMemo, genreKey);
    const events = [];
    let needsRewrite = false;

    if (toolResolvedState) {
        // Authoritative Tool Call Mode: stamp ground-truth tool resolution onto nextState
        if (!nextState.state_flags) {
            nextState.state_flags = { breather_available: true, turns_since_last_test: 0 };
        }
        if (nextState.state_flags.turns_since_last_test !== 0) {
            nextState.state_flags.turns_since_last_test = 0;
            needsRewrite = true;
            events.push('TOOL_SYNC: Reset turns_since_last_test to 0');
        }

        if (toolResolvedState.pools) {
            for (const [pKey, tPool] of Object.entries(toolResolvedState.pools)) {
                if (!nextState.pools[pKey]) {
                    nextState.pools[pKey] = { ...tPool };
                    needsRewrite = true;
                    events.push(`TOOL_SYNC: Added missing pool ${pKey}`);
                } else {
                    if (nextState.pools[pKey].current !== tPool.current || nextState.pools[pKey].max !== tPool.max) {
                        events.push(`TOOL_SYNC: Pool ${pKey} stamped from (${nextState.pools[pKey].current}/${nextState.pools[pKey].max}) -> (${tPool.current}/${tPool.max})`);
                        nextState.pools[pKey].current = tPool.current;
                        nextState.pools[pKey].max = tPool.max;
                        needsRewrite = true;
                    }
                }
            }
        }

        if (Array.isArray(toolResolvedState.character?.negative_tags)) {
            for (const tag of toolResolvedState.character.negative_tags) {
                if (!nextState.character.negative_tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
                    nextState.character.negative_tags.push(tag);
                    needsRewrite = true;
                    events.push(`TOOL_SYNC: Added tool-resolved negative tag '${tag}'`);
                }
            }
        }

        const toolAdv = toolResolvedState.character?.temp_advantage || null;
        if (nextState.character.temp_advantage !== toolAdv) {
            nextState.character.temp_advantage = toolAdv;
            needsRewrite = true;
            events.push(`TOOL_SYNC: Set temp_advantage to '${toolAdv}'`);
        }
    } else {
        // Pre-computed matrix / LLM prompt mode: Compare pools between prevState and nextState
        for (const [pKey, nextPool] of Object.entries(nextState.pools)) {
            const prevPool = prevState?.pools?.[pKey];

            // 1. Stage 1: Pool was > 0 and dropped to <= 0 -> Clamp at 0 and ensure zero_debuff
            if (prevPool && prevPool.current > 0 && nextPool.current <= 0) {
                if (nextPool.current < 0) {
                    events.push(`BREAKING_POINT_CLAMP: ${pKey} (${nextPool.current}) clamped to 0`);
                    nextPool.current = 0;
                } else {
                    events.push(`BREAKING_POINT_CLAMP: ${pKey} clamped at 0`);
                }

                // Ensure zero_debuff is recorded
                const debuffName = nextPool.zero_debuff;
                const hasDebuff = nextState.character.negative_tags.some(t => t.toLowerCase().includes(debuffName.toLowerCase()));
                if (!hasDebuff) {
                    nextState.character.negative_tags.push(debuffName);
                    events.push(`ADDED_ZERO_DEBUFF: ${debuffName}`);
                }
            }

            // 2. Stage 2: Pool was ALREADY at 0 and took additional loss -> Trigger Overflow
            else if (prevPool && prevPool.current === 0) {
                if (nextPool.current < 0) {
                    const lossAmount = Math.max(1, Math.abs(nextPool.current));
                    nextPool.current = 0; // Pool stays at 0

                    const rule = nextPool.on_overflow || nextState.knobs?.overflow_default || 'scar_and_ko';

                    if (rule.startsWith('redirect:')) {
                        const targetKey = poolLabelToKey(rule.split(':')[1].trim());
                        const targetPool = nextState.pools[targetKey];
                        if (targetPool) {
                            events.push(`OVERFLOW_REDIRECT: ${pKey} at 0 redirected ${lossAmount} attrition to ${targetKey}`);
                            if (targetPool.current > 0 && targetPool.current - lossAmount <= 0) {
                                targetPool.current = 0;
                                const targetDebuff = targetPool.zero_debuff;
                                if (!nextState.character.negative_tags.some(t => t.toLowerCase().includes(targetDebuff.toLowerCase()))) {
                                    nextState.character.negative_tags.push(targetDebuff);
                                    events.push(`ADDED_ZERO_DEBUFF: ${targetDebuff}`);
                                }
                                events.push(`BREAKING_POINT_CLAMP: Target ${targetKey} clamped at 0`);
                            } else if (targetPool.current > 0) {
                                targetPool.current -= lossAmount;
                                events.push(`TARGET_STRAIN: ${targetKey} reduced to ${targetPool.current}/${targetPool.max}`);
                            } else {
                                // Target was also at 0! Cascade to scar_and_ko
                                targetPool.max = Math.max(1, targetPool.max - 1);
                                targetPool.current = 1;
                                events.push(`CASCADE_OVERFLOW_SCAR_AND_KO: ${targetKey} max reduced to ${targetPool.max}, set to 1`);
                            }
                        }
                    } else if (rule === 'scar_and_ko') {
                        nextPool.max = Math.max(1, nextPool.max - 1);
                        nextPool.current = 1;
                        const scarName = `Trauma Scar (${nextPool.label} Rupture)`;
                        if (!nextState.character.negative_tags.includes(scarName)) {
                            nextState.character.negative_tags.push(scarName);
                        }
                        events.push(`OVERFLOW_SCAR_AND_KO: ${pKey} max reduced to ${nextPool.max}, set to 1`);
                    }
                }
            }
        }
    }

    // 3. Synchronize Scenes Completed <-> XP and detect Encounter Resolution
    const prevEnc = prevState?.activeEncounter;
    const nextEnc = nextState.activeEncounter;
    const prevScenes = prevState?.character?.scenes_completed ?? 0;

    if (prevEnc && prevEnc.currentHp > 0) {
        const isResolvedNow = !nextEnc || nextEnc.currentHp === 0;
        if (isResolvedNow && nextState.character.scenes_completed <= prevScenes) {
            nextState.character.scenes_completed = prevScenes + 1;
            events.push(`SCENE_INCREMENTED: Encounter resolved; scenes completed is now ${nextState.character.scenes_completed}`);
        }
        if (isResolvedNow) {
            if (!nextState.state_flags) nextState.state_flags = { breather_available: true, turns_since_last_test: 0 };
            nextState.state_flags.breather_available = true;
        }
    }

    if (nextState.character.scenes_completed > prevScenes) {
        if (!nextState.state_flags) nextState.state_flags = { breather_available: true, turns_since_last_test: 0 };
        nextState.state_flags.breather_available = true;
    }

    // 4. Generate Reconciled [CHARACTER] Block
    const updatedCharBlock = formatFaeCharacterMemoBlock(nextState);

    let reconciledMemo = nextMemo;
    if (/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i.test(reconciledMemo)) {
        reconciledMemo = reconciledMemo.replace(/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i, updatedCharBlock);
    } else {
        reconciledMemo = `${reconciledMemo.trim()}\n\n${updatedCharBlock}`;
    }

    // 5. Normalize Pressures pill line in [COMBAT] if present
    if (/\[COMBAT\][\s\S]*?\[\/COMBAT\]/i.test(reconciledMemo)) {
        reconciledMemo = reconciledMemo.replace(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i, (m, combatBody) => {
            const lines = combatBody.split('\n');
            const normLines = lines.map(line => {
                if (/Pressures:/i.test(line)) {
                    return normalizeFaePillsLine(line);
                }
                return line;
            });
            return `[COMBAT]${normLines.join('\n')}[/COMBAT]`;
        });
    }

    // 6. Strip unwanted [PARTY] blocks for FAE ruleset (WRK-09: Upstream mergeMemo appends [PARTY] regardless of modules.party)
    if (/\[PARTY\][\s\S]*?\[\/PARTY\]/i.test(reconciledMemo)) {
        reconciledMemo = stripFaePartyBlockFromMemo(reconciledMemo);
        needsRewrite = true;
        events.push('REMOVED_PARTY_BLOCK: Stripped unwanted [PARTY] block for FAE ruleset');
    }

    const changed = needsRewrite || (reconciledMemo !== nextMemo);

    return {
        memo: reconciledMemo,
        changed,
        state: nextState,
        events,
    };
}

/**
 * Formats a complete initial game state memo ([TIME], [LOCATION], [CHARACTER], [COMBAT])
 * for an initial FAE campaign state.
 *
 * @param {object|string} [faeStateOrGenreKey='cosmic_horror']
 * @param {object} [options={}]
 * @returns {string} Initial state memo
 */
export function formatInitialFaeMemo(faeStateOrGenreKey = 'cosmic_horror', options = {}) {
    let state;
    const isObj = typeof faeStateOrGenreKey === 'object' && faeStateOrGenreKey !== null;

    if (typeof faeStateOrGenreKey === 'string') {
        state = createInitialFaeState(faeStateOrGenreKey, options);
    } else if (isObj) {
        if (faeStateOrGenreKey.pools && faeStateOrGenreKey.character) {
            state = faeStateOrGenreKey;
        } else {
            const genreKey = faeStateOrGenreKey.genreKey || faeStateOrGenreKey.config?.genre || faeStateOrGenreKey.config?.faeGenre || faeStateOrGenreKey.genre || options.genreKey || 'cosmic_horror';
            const p = faeStateOrGenreKey.protagonist || faeStateOrGenreKey.character || {};
            const isHeroic = Boolean(
                faeStateOrGenreKey.config?.heroicTier ??
                faeStateOrGenreKey.config?.heroic_tier ??
                faeStateOrGenreKey.heroicTier ??
                faeStateOrGenreKey.heroic_tier ??
                faeStateOrGenreKey.knobs?.heroic_tier ??
                faeStateOrGenreKey.config?.knobs?.heroic_tier ??
                options.heroicTier ??
                options.heroic_tier ??
                (FAE_GENRES[genreKey]?.knobs?.heroic_tier ?? false)
            );
            const resolvedDomain = p.heroicDomain || p.heroic_domain || faeStateOrGenreKey.character?.heroic_domain || (isHeroic ? FAE_GENRES[genreKey]?.defaultHeroicDomain : null) || null;
            const charOverrides = {
                name: p.name || 'Protagonist',
                archetype: p.archetype || p.playbook,
                positive_tags: p.positiveTags || p.positive_tags || p.tags,
                negative_tags: p.negativeTags || p.negative_tags || p.scars,
                heroic_domain: resolvedDomain,
                temp_advantage: p.temp_advantage,
                scenes_completed: p.scenes_completed,
                scenes_target: p.scenes_target,
            };
            const overrides = {
                ...faeStateOrGenreKey,
                heroic_tier: isHeroic,
                heroic_domain: resolvedDomain,
                character: { ...charOverrides, ...(faeStateOrGenreKey.character || {}) },
                pools: faeStateOrGenreKey.pools || p.pools || options.pools,
                knobs: {
                    ...(faeStateOrGenreKey.knobs || faeStateOrGenreKey.config?.knobs || options.knobs || {}),
                    heroic_tier: isHeroic,
                },
            };
            state = createInitialFaeState(genreKey, overrides);
        }
    } else {
        state = createInitialFaeState('cosmic_horror', options);
    }

    const blocks = [];

    // [TIME]
    const timeStr = options.time || 'Day 1, 08:00 AM (Morning)';
    blocks.push(`[TIME]\n${timeStr}\n[/TIME]`);

    // [LOCATION]
    const locStr = options.location || (isObj ? (faeStateOrGenreKey.theKick?.startingLocation || faeStateOrGenreKey.maps?.[0]?.site) : null) || 'Starting Location';
    blocks.push(`[LOCATION]\n${locStr}\n[/LOCATION]`);

    // Fold companions into [CHARACTER] positive tags per Zero-Bookkeeping Model (Section 2.4)
    let companions = [];
    if (isObj && faeStateOrGenreKey.config?.partyMode !== 'solo' && Array.isArray(faeStateOrGenreKey.npcs)) {
        companions = faeStateOrGenreKey.npcs.filter(n =>
            n && n.name && /companion|party|sidekick|follower|partner|ally|friend|crew|squad/i.test(n.role || 'companion')
        );
        if (companions.length > 0) {
            state.character = state.character || {};
            if (!Array.isArray(state.character.positive_tags)) {
                state.character.positive_tags = [];
            }
            for (const comp of companions) {
                const cName = (comp.name || 'Companion').trim();
                let cArchetype = comp.archetype || comp.playbook || '';
                if (!cArchetype) {
                    const rawRole = (comp.role || 'Companion').replace(/\s*\([^)]*\)/g, '').trim();
                    cArchetype = rawRole || 'Companion';
                }
                cArchetype = cArchetype.replace(/[()]/g, '').trim() || 'Companion';

                const alreadyMentioned = state.character.positive_tags.some(tag =>
                    String(tag).toLowerCase().includes(cName.toLowerCase())
                );
                if (!alreadyMentioned) {
                    state.character.positive_tags.push(`Companion: ${cName} (${cArchetype})`);
                }
            }
        }
    }

    // [CHARACTER]
    blocks.push(formatFaeCharacterMemoBlock(state));

    // [PARTY] if companion NPCs exist and partyMode !== 'solo'
    if (companions.length > 0) {
        const partyLines = ['[PARTY]'];
        const primaryPool = Object.values(state.pools || {})[0] || { label: 'Health', max: 8 };
        const primaryLabel = primaryPool.label || 'Health';
        const primaryMax = primaryPool.max || 8;

            for (let i = 0; i < companions.length; i++) {
                const comp = companions[i];
                const cName = (comp.name || 'Companion').trim();
                let cArchetype = comp.archetype || comp.playbook || '';
                if (!cArchetype) {
                    const rawRole = (comp.role || 'Companion').replace(/\s*\([^)]*\)/g, '').trim();
                    cArchetype = rawRole || 'Companion';
                }
                cArchetype = cArchetype.replace(/[()]/g, '').trim() || 'Companion';

                const cAppearance = (comp.appearance || comp.description || (comp.demeanor ? `${comp.demeanor} demeanor` : '')).trim();

                const rawTags = comp.positiveTags || comp.tags || comp.moves || ['Resourceful (adept survivor)'];
                const tagsList = Array.isArray(rawTags)
                    ? rawTags
                    : typeof rawTags === 'string'
                        ? splitTopLevelPillItems(rawTags)
                        : [String(rawTags)];
                const cTagsStr = tagsList.map(t => normalizeFaePill(t, 'Positive Tag')).filter(Boolean).join(', ') || 'Resourceful (adept survivor)';

                const rawBoons = comp.boons || comp.gear || ['Field Kit (1 Use)'];
                const boonsList = Array.isArray(rawBoons)
                    ? rawBoons
                    : typeof rawBoons === 'string'
                        ? splitTopLevelPillItems(rawBoons)
                        : [String(rawBoons)];
                const cBoonsStr = boonsList.map(b => normalizeFaePill(b, 'Boon')).filter(Boolean).join(', ') || 'Field Kit (1 Use)';

                if (i > 0) partyLines.push('');
                partyLines.push(
                    `- ${cName} (${cArchetype}): ${primaryMax}/${primaryMax} HP | Pool: ${primaryLabel} (${primaryMax}/${primaryMax})`,
                    ...(cAppearance ? [`Appearance: ${cAppearance}`] : []),
                    `((PILLS)) Positive Tags: ${cTagsStr}`,
                    `((PILLS)) Boons: ${cBoonsStr}`,
                    `((PILLS)) Scars & Debuffs: None`,
                    `Status: Healthy`
                );
            }
            partyLines.push('[/PARTY]');
            blocks.push(partyLines.join('\n'));
        }

    // [DUNGEON] if maps exist
    if (isObj && faeStateOrGenreKey.maps?.[0]?.site) {
        blocks.push(`[DUNGEON]\nActive Site: ${faeStateOrGenreKey.maps[0].site}\nThreat: ${faeStateOrGenreKey.maps[0].threat || 'MODERATE'}\n[/DUNGEON]`);
    }

    // [FACTIONS] if factions exist
    if (isObj && Array.isArray(faeStateOrGenreKey.factions) && faeStateOrGenreKey.factions.length > 0) {
        const fLines = ['[FACTIONS]'];
        for (const f of faeStateOrGenreKey.factions) {
            const rawStanding = (f.standing || 'Neutral').trim();
            let standingFormatted = rawStanding;
            const lower = rawStanding.toLowerCase();
            if (!rawStanding.startsWith('(+)') && !rawStanding.startsWith('(-)') && !rawStanding.startsWith('(+) ') && !rawStanding.startsWith('(-) ')) {
                if (lower.includes('ally') || lower.includes('allied') || lower.includes('friend') || lower.includes('sympathetic') || lower.includes('honored')) {
                    standingFormatted = `(+) ${rawStanding}`;
                } else if (lower.includes('hostile') || lower.includes('rival') || lower.includes('enemy') || lower.includes('hated') || lower.includes('unfriendly')) {
                    standingFormatted = `(-) ${rawStanding}`;
                }
            }

            const pills = [`${standingFormatted} (Standing)`];
            if (f.agenda) {
                pills.push(`Agenda (${f.agenda.replace(/[()]/g, '').trim()})`);
            }
            if (f.notes) {
                pills.push(`Notes (${f.notes.replace(/[()]/g, '').trim()})`);
            }

            fLines.push(`((PILLS)) ${f.name}: ${pills.join(', ')}`);
        }
        fLines.push('[/FACTIONS]');
        blocks.push(fLines.join('\n'));
    }

    // Custom HUD Module if present
    const customMod = isObj && faeStateOrGenreKey.worldRules?.customModule;
    if (customMod && (customMod.tag || customMod.fieldKey || customMod.label)) {
        const rawTag = (customMod.tag || customMod.fieldKey || customMod.label || 'CUSTOM')
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .toUpperCase();
        const label = customMod.label || customMod.tag || customMod.fieldKey || 'Custom Tracker';
        const sampleContent = (customMod.sampleContent || customMod.sample || `${label}: Initialized`).trim();
        blocks.push(`[${rawTag}]\n${sampleContent}\n[/${rawTag}]`);
    }

    // [COMBAT]
    if (options.encounter || options.activeEncounter) {
        const enc = options.encounter || options.activeEncounter;
        const encText = (typeof enc === 'string') ? enc : formatFaeEncounterBlock(enc);
        blocks.push(`[COMBAT]\n${encText}\n[/COMBAT]`);
    } else {
        blocks.push(`[COMBAT]\nActive: false\n[/COMBAT]`);
    }

    return blocks.join('\n\n');
}

/**
 * Formats an encounter object into a native 4-line FAE Encounter Block string (Section 5.1).
 *
 * @param {object} encounter
 * @returns {string}
 */
export function formatFaeEncounterBlock(encounter) {
    if (typeof encounter === 'string') return encounter;
    const name = encounter.name || 'Hazard';
    const curHp = encounter.currentHp ?? encounter.hp ?? 2;
    const maxHp = encounter.maxHp ?? 2;
    const threat = encounter.threat ?? encounter.threatLevel ?? 2;
    const threatLabel = encounter.threatLabel ? ` (${encounter.threatLabel})` : '';
    const pools = Array.isArray(encounter.pools) ? encounter.pools.join(', ') : (encounter.pools || 'Health');
    const pressures = Array.isArray(encounter.pressures) ? encounter.pressures.join(', ') : (encounter.pressures || 'None');
    const instinct = encounter.instinct || 'To hold ground and challenge intruders';
    const status = encounter.status || 'Entrenched';

    let barriersStr = '';
    if (Array.isArray(encounter.barriers) && encounter.barriers.length > 0) {
        barriersStr = encounter.barriers.map((b, i) => `${i + 1}. ${b}`).join(' -> ');
    } else if (encounter.barriers) {
        barriersStr = String(encounter.barriers).replace(/^\[|\]$/g, '').replace(/\]\s*\[/g, ' -> ');
    } else {
        barriersStr = '1. Defensive Line';
    }

    return [
        `${name}: ${curHp}/${maxHp} HP | Threat: ${threat}${threatLabel} | Pools: ${pools}`,
        `((PILLS)) Pressures: ${pressures}`,
        `Instinct: ${instinct}`,
        `Status: ${status} [Barriers: ${barriersStr}]`,
    ].join('\n');
}

/**
 * Advances the dynamic tempo counter based on whether the assistant message contained a 4dF roll (Section 5.2).
 * Threat 0 turns without rolls increment turns_since_last_test; turns with 4dF rolls reset it to 0.
 *
 * @param {string} memoText Full state memo or [CHARACTER] block
 * @param {string} [assistantNarrativeText=''] Assistant response text
 * @param {string} [fallbackGenre='cosmic_horror']
 * @returns {{ memo: string, state: object, turnsSinceLastTest: number }}
 */
export function advanceFaeTurnTempo(memoText, assistantNarrativeText = '', fallbackGenre = 'cosmic_horror') {
    const state = parseFaeStateFromMemo(memoText, fallbackGenre);
    if (!state.state_flags) {
        state.state_flags = { breather_available: true, turns_since_last_test: 0 };
    }
    const hasRoll = /\*\(FAE Action\b/i.test(assistantNarrativeText) || /4dF\s*\[/i.test(assistantNarrativeText);
    if (hasRoll) {
        state.state_flags.turns_since_last_test = 0;
    } else {
        state.state_flags.turns_since_last_test = (state.state_flags.turns_since_last_test ?? 0) + 1;
    }
    const updatedCharBlock = formatFaeCharacterMemoBlock(state);
    let updatedMemo = memoText || '';
    if (/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i.test(updatedMemo)) {
        updatedMemo = updatedMemo.replace(/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i, updatedCharBlock);
    } else {
        updatedMemo = `${updatedMemo.trim()}\n\n${updatedCharBlock}`;
    }
    return {
        memo: updatedMemo,
        state,
        turnsSinceLastTest: state.state_flags.turns_since_last_test,
    };
}

/**
 * Non-destructively merges a modified Campaign Dossier into an in-flight FAE state memo.
 * Preserves volatile in-game attributes:
 * - Current pool attrition levels (unless new max shrank below current, clamped to max)
 * - Scenes completed, turn tempo, and state flags
 * - Active trauma, conditions, and scars gained during play
 * - Existing [TIME], [LOCATION], and active [COMBAT] encounter blocks
 *
 * Updates:
 * - Protagonist name, archetype/playbook, heroic domain
 * - Newly configured or edited Positive Tags
 * - Newly added pools or pool labels/colors/zero_debuffs/strain_flavors
 * - Pacing scene target
 * - [FACTIONS] block if present in dossier
 *
 * @param {string} liveMemo The current running game state memo
 * @param {object} dossier The updated PbtaCampaignDossier / FAE dossier
 * @param {string} [charName=null] Optional explicit character name override
 * @returns {string} Merged state memo
 */
export function mergeDossierIntoLiveFaeMemo(liveMemo, dossier, charName = null) {
    if (!liveMemo || typeof liveMemo !== 'string' || !liveMemo.trim()) {
        return formatInitialFaeMemo(dossier, { location: dossier?.theKick?.startingLocation });
    }

    const genreKey = dossier?.meta?.systemKey || dossier?.config?.faeGenre || 'cosmic_horror';
    const activeState = parseFaeStateFromMemo(liveMemo, genreKey);
    if (!activeState || !activeState.pools || Object.keys(activeState.pools).length === 0) {
        return formatInitialFaeMemo(dossier, { location: dossier?.theKick?.startingLocation });
    }

    // Clone active state for non-destructive updates
    const nextState = {
        ...activeState,
        pools: { ...activeState.pools },
        character: { ...(activeState.character || {}) },
        knobs: { ...(activeState.knobs || {}) },
        state_flags: { ...(activeState.state_flags || {}) },
    };

    const p = dossier?.protagonist || {};
    const effectiveName = (charName || p.name || nextState.character.name || 'Protagonist').trim();
    nextState.character.name = effectiveName;

    if (p.playbook || p.archetype) {
        nextState.character.archetype = (p.playbook || p.archetype).trim();
    }

    const isHeroic = Boolean(
        dossier?.config?.heroicTier ??
        dossier?.config?.heroic_tier ??
        dossier?.heroicTier ??
        dossier?.heroic_tier ??
        dossier?.config?.knobs?.heroic_tier ??
        (FAE_GENRES[genreKey]?.knobs?.heroic_tier ?? false)
    );
    nextState.knobs.heroic_tier = isHeroic;

    const resolvedDomain = p.heroicDomain || p.heroic_domain || dossier?.character?.heroic_domain || null;
    if (resolvedDomain) {
        nextState.character.heroic_domain = resolvedDomain;
    } else if (!isHeroic) {
        nextState.character.heroic_domain = null;
    }

    // Merge Positive Tags: if dossier has positiveTags, update them while ensuring formatting
    const rawPosTags = p.positiveTags || p.positive_tags || p.tags;
    if (Array.isArray(rawPosTags) && rawPosTags.length > 0) {
        nextState.character.positive_tags = sanitizeFaePositiveTags(rawPosTags);
    }

    // Merge Negative Tags: preserve existing active scars/conditions, and merge newly specified ones
    const rawNegTags = p.negativeTags || p.negative_tags || p.scars;
    if (Array.isArray(rawNegTags) && rawNegTags.length > 0) {
        const mergedNeg = [...(nextState.character.negative_tags || [])];
        for (const t of rawNegTags) {
            const cleanT = String(t).trim();
            if (cleanT && !mergedNeg.some(existing => existing.toLowerCase().includes(cleanT.toLowerCase()))) {
                mergedNeg.push(cleanT);
            }
        }
        nextState.character.negative_tags = mergedNeg;
    }

    // Update scenes target if specified in dossier config
    const targetScenes = dossier?.config?.pacingScenes || dossier?.config?.knobs?.scenes_target;
    if (targetScenes) {
        nextState.character.scenes_target = parseInt(targetScenes, 10) || nextState.character.scenes_target || 4;
    }

    // Update pool definitions without losing current depletion
    const dossierPools = (p.pools && Object.keys(p.pools).length > 0)
        ? p.pools
        : ((dossier?.pools && Object.keys(dossier.pools).length > 0) ? dossier.pools : (FAE_GENRES[genreKey]?.pools || {}));

    // If dossier specifies explicit pools, prune any stale pools in activeState that are NOT in the dossier
    const explicitDossierPoolKeys = new Set(Object.keys(dossierPools));
    if (explicitDossierPoolKeys.size > 0) {
        for (const existingKey of Object.keys(nextState.pools)) {
            if (!explicitDossierPoolKeys.has(existingKey)) {
                delete nextState.pools[existingKey];
            }
        }
    }

    for (const [key, dPool] of Object.entries(dossierPools)) {
        if (!dPool) continue;
        if (nextState.pools[key]) {
            const activePool = nextState.pools[key];
            const newMax = typeof dPool.max === 'number' ? dPool.max : activePool.max;
            nextState.pools[key] = {
                ...activePool,
                label: dPool.label || activePool.label,
                barColor: dPool.barColor || activePool.barColor,
                max: newMax,
                current: Math.min(activePool.current, newMax), // Clamp if max shrank
                recovery: dPool.recovery !== undefined ? dPool.recovery : activePool.recovery,
                strain_flavor: dPool.strain_flavor || activePool.strain_flavor,
                zero_debuff: dPool.zero_debuff || activePool.zero_debuff,
                on_overflow: dPool.on_overflow || activePool.on_overflow,
            };
        } else {
            // New pool added in dossier
            nextState.pools[key] = {
                key: dPool.key || key,
                label: dPool.label || key,
                barColor: dPool.barColor || 'green',
                current: typeof dPool.current === 'number' ? dPool.current : (dPool.max || 8),
                max: dPool.max || 8,
                recovery: dPool.recovery,
                strain_flavor: dPool.strain_flavor,
                zero_debuff: dPool.zero_debuff,
                on_overflow: dPool.on_overflow,
            };
        }
    }

    // Fold companions into [CHARACTER] positive tags per Zero-Bookkeeping Model if partyMode !== 'solo'
    if (dossier?.config?.partyMode !== 'solo' && Array.isArray(dossier?.npcs)) {
        const companions = dossier.npcs.filter(n =>
            n && n.name && /companion|party|sidekick|follower|partner|ally|friend|crew|squad/i.test(n.role || 'companion')
        );
        if (companions.length > 0) {
            nextState.character.positive_tags = nextState.character.positive_tags || [];
            for (const comp of companions) {
                const cName = (comp.name || 'Companion').trim();
                let cArchetype = comp.archetype || comp.playbook || '';
                if (!cArchetype) {
                    const rawRole = (comp.role || 'Companion').replace(/\s*\([^)]*\)/g, '').trim();
                    cArchetype = rawRole || 'Companion';
                }
                cArchetype = cArchetype.replace(/[()]/g, '').trim() || 'Companion';

                const alreadyMentioned = nextState.character.positive_tags.some(tag =>
                    String(tag).toLowerCase().includes(cName.toLowerCase())
                );
                if (!alreadyMentioned) {
                    nextState.character.positive_tags.push(`Companion: ${cName} (${cArchetype})`);
                }
            }
        }
    }

    // Generate updated [CHARACTER] block
    const updatedCharBlock = formatFaeCharacterMemoBlock(nextState);

    let updatedMemo = liveMemo;
    if (/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i.test(updatedMemo)) {
        updatedMemo = updatedMemo.replace(/\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i, updatedCharBlock);
    } else {
        updatedMemo = `${updatedMemo.trim()}\n\n${updatedCharBlock}`;
    }

    // Also non-destructively update [FACTIONS] if dossier has factions
    if (Array.isArray(dossier?.factions) && dossier.factions.length > 0) {
        const fLines = ['[FACTIONS]'];
        for (const f of dossier.factions) {
            const rawStanding = (f.standing || 'Neutral').trim();
            let standingFormatted = rawStanding;
            const lower = rawStanding.toLowerCase();
            if (!rawStanding.startsWith('(+)') && !rawStanding.startsWith('(-)') && !rawStanding.startsWith('(+) ') && !rawStanding.startsWith('(-) ')) {
                if (lower.includes('ally') || lower.includes('allied') || lower.includes('friend') || lower.includes('sympathetic') || lower.includes('honored')) {
                    standingFormatted = `(+) ${rawStanding}`;
                } else if (lower.includes('hostile') || lower.includes('rival') || lower.includes('enemy') || lower.includes('hated') || lower.includes('unfriendly')) {
                    standingFormatted = `(-) ${rawStanding}`;
                }
            }
            const pills = [`${standingFormatted} (Standing)`];
            if (f.agenda) pills.push(`Agenda (${f.agenda.replace(/[()]/g, '').trim()})`);
            if (f.notes) pills.push(`Notes (${f.notes.replace(/[()]/g, '').trim()})`);
            fLines.push(`((PILLS)) ${f.name}: ${pills.join(', ')}`);
        }
        fLines.push('[/FACTIONS]');
        const factionsBlock = fLines.join('\n');

        if (/\[FACTIONS\][\s\S]*?\[\/FACTIONS\]/i.test(updatedMemo)) {
            updatedMemo = updatedMemo.replace(/\[FACTIONS\][\s\S]*?\[\/FACTIONS\]/i, factionsBlock);
        } else {
            updatedMemo = `${updatedMemo.trim()}\n\n${factionsBlock}`;
        }
    }

    return updatedMemo;
}
