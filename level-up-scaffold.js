/**
 * MultiHog Companion — Level-Up Scaffold & Dossier Stub Generator
 *
 * Provides instant auto-scaffolding of campaign dossiers for chats originated
 * through Instant Action, Character Creator, or stock D&D without Session Zero.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { getCandidateChatIds } from './persona-matching.js';
import { getPartitionDossier, setPartitionDossier } from './pbta-ruleset-persistence.js';
import { PBTA_GENRES, splitTopLevelPillItems, splitPbtaMovesLine } from './pbta-ruleset.js';
import { FAE_GENRES } from './fae-ruleset.js';
import { parseFaeStateFromMemo } from './fae-state-sync.js';
import { detectActiveFaeGenre } from './pbta-companion-bridge.js';
import { getCanonicalDndProgression } from './level-up-blueprint.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import './concierge-system-dnd5e.js';

/**
 * Derives the canonical D&D 5e Hit Die ('d6' | 'd8' | 'd10' | 'd12') from a class name.
 *
 * @param {string} className
 * @param {string} [fallback='d8']
 * @returns {string}
 */
export function deriveHitDieForClass(className, fallback = 'd8') {
    if (!className || typeof className !== 'string') return fallback;
    const cLower = className.toLowerCase();
    if (/\bbarbarian\b/.test(cLower)) return 'd12';
    if (/\b(fighter|paladin|ranger)\b/.test(cLower)) return 'd10';
    if (/\b(wizard|sorcerer)\b/.test(cLower)) return 'd6';
    if (/\b(bard|cleric|druid|monk|rogue|warlock|artificer)\b/.test(cLower)) return 'd8';
    return fallback;
}

/**
 * Extracts and parses key character sheet properties from a State Memo [CHARACTER] block.
 *
 * @param {string} memoText Full or partial state memo text.
 * @returns {{
 *   name: string,
 *   class: string,
 *   level: number,
 *   currentHp: number,
 *   maxHp: number,
 *   stats: Record<string, number>,
 *   hitDie: string,
 *   rawText: string
 * }}
 */
export function parseCharacterBlockFromMemo(memoText) {
    const fallback = {
        name: 'Protagonist',
        class: 'Adventurer',
        level: 1,
        currentHp: 10,
        maxHp: 10,
        stats: {},
        hitDie: 'd8',
        features: [],
        abilities: [],
        rawText: '',
    };

    if (!memoText || typeof memoText !== 'string') return fallback;

    const charMatch = memoText.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i)
        || memoText.match(/\[CHARACTER\]([\s\S]*?)(?=\n[ \t]*\[(?:PARTY|ENEMIES|COMBAT|LOCATION|INVENTORY|WORLD|XP|ABILITIES|SPELLS)\]|$)/i);

    if (!charMatch) return fallback;

    const raw = charMatch[1].trim();
    const result = { ...fallback, rawText: raw };

    // 1. Name & Archetype / Class
    // Format A: Name (Class): 15/15 HP
    // Format B: Name: Bob \n Class: Rogue \n Level: 1
    const titleLineMatch = raw.match(/^([^\n:(]+?)(?:\s*\(([^)]+)\))?\s*:\s*(\d+)\s*\/\s*(\d+)\s*HP/im);
    if (titleLineMatch) {
        result.name = titleLineMatch[1].trim();
        if (titleLineMatch[2]) result.class = titleLineMatch[2].trim();
        result.currentHp = parseInt(titleLineMatch[3], 10) || 10;
        result.maxHp = parseInt(titleLineMatch[4], 10) || 10;
    } else {
        const nameMatch = raw.match(/^\s*Name\s*:\s*([^\n\r]+)/im);
        if (nameMatch) result.name = nameMatch[1].trim();

        const hpMatch = raw.match(/(\d+)\s*\/\s*(\d+)\s*HP/i);
        if (hpMatch) {
            result.currentHp = parseInt(hpMatch[1], 10) || 10;
            result.maxHp = parseInt(hpMatch[2], 10) || 10;
        }
    }

    // Explicit Class line override if present
    const classMatch = raw.match(/^\s*Class\s*:\s*([^\n\r]+)/im);
    if (classMatch) {
        result.class = classMatch[1].trim();
    }

    // Detect active ruleset from memo markers
    const detectedRuleset = systemRegistry.detectRulesetFromMemo(memoText);
    const isFae = detectedRuleset === 'fae';
    const isPbta = !isFae && detectedRuleset === 'pbta';

    if (isFae) {
        const inferredGenreKey = detectActiveFaeGenre({ currentMemo: memoText }) || 'cosmic_horror';
        const faeState = parseFaeStateFromMemo(memoText, inferredGenreKey);
        result.isFae = true;
        result.isPbta = false;
        result.hitDie = null;
        result.level = null;
        if (faeState.character?.name && faeState.character.name !== 'Character') {
            result.name = faeState.character.name;
        }
        result.archetype = faeState.character?.archetype || (result.class !== 'Adventurer' ? result.class : 'Survivor');
        result.class = result.archetype;
        result.pools = faeState.pools || {};
        result.positiveTags = Array.isArray(faeState.character?.positive_tags) ? [...faeState.character.positive_tags] : [];
        result.negativeTags = Array.isArray(faeState.character?.negative_tags) ? [...faeState.character.negative_tags] : [];
        result.knobs = faeState.knobs ? { ...faeState.knobs } : undefined;
        result.scenesCompleted = faeState.character?.scenes_completed ?? 0;
        result.scenesTarget = faeState.character?.scenes_target ?? 4;
        result.status = faeState.character?.status || 'Healthy';
        result.genreKey = faeState.genreKey || 'cosmic_horror';
    } else if (isPbta) {
        result.isPbta = true;
        result.playbook = result.class;
        result.hitDie = null;
        result.level = null;

        // Harm & Armor
        const harmMatch = raw.match(/Harm\s*:\s*(\d+)\s*\/\s*(\d+)/i);
        if (harmMatch) {
            result.harm = {
                current: parseInt(harmMatch[1], 10) || 0,
                max: parseInt(harmMatch[2], 10) || 4,
                armor: 0,
            };
        } else {
            result.harm = { current: 0, max: 4, armor: 0 };
        }

        const armorMatch = raw.match(/Armor\s*:\s*(\d+)/i);
        if (armorMatch) {
            const arm = parseInt(armorMatch[1], 10) || 0;
            result.armor = arm;
            result.harm.armor = arm;
        }

        // Moves ((PILLS)) Moves: ...
        const movesMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Moves\s*:\s*([^\n\r]*)/i);
        if (movesMatch && movesMatch[1].trim()) {
            result.moves = splitPbtaMovesLine(movesMatch[1]);
        } else {
            result.moves = [];
        }

        // Conditions ((PILLS)) Conditions: ...
        const condMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Conditions\s*:\s*([^\n\r]*)/i);
        if (condMatch && condMatch[1].trim()) {
            result.conditions = splitTopLevelPillItems(condMatch[1])
                .map(c => c.trim().replace(/^\(\(PILL\)\)\s*/i, ''))
                .filter(c => c && !/^none$/i.test(c));
        } else {
            result.conditions = [];
        }

        // Gear ((PILLS)) Gear: ...
        const gearMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Gear\s*:\s*([^\n\r]*)/i);
        if (gearMatch && gearMatch[1].trim()) {
            result.gear = splitTopLevelPillItems(gearMatch[1])
                .map(g => g.trim().replace(/^\(\(PILL\)\)\s*/i, ''))
                .filter(g => g && !/^none$/i.test(g));
        } else {
            result.gear = [];
        }

        // Status
        const statusMatch = raw.match(/Status\s*:\s*([^\n\r]+)/i);
        if (statusMatch) {
            result.status = statusMatch[1].trim();
        }
    } else {
        // Standard D&D 5e: Level & Hit Die derivation
        // 2. Level
        const xpMatch = memoText.match(/\[XP\]([\s\S]*?)\[\/XP\]/i);
        const xpScope = xpMatch ? xpMatch[1] : memoText;
        const lvlMatch = xpScope.match(/Level\s*[:\s]\s*(\d+)/i) || raw.match(/Level\s*[:\s]\s*(\d+)/i);
        if (lvlMatch) {
            result.level = parseInt(lvlMatch[1], 10) || 1;
        }

        // 3. Hit Die
        const hdMatch = raw.match(/(?:Hit\s*Di(?:ce|e)|HD)\s*:\s*(\d*d\d+)/i) || raw.match(/\b(d[468]|d1[02])\b/i);
        if (hdMatch) {
            result.hitDie = hdMatch[1].toLowerCase().replace(/^\d+/, '');
        } else {
            result.hitDie = deriveHitDieForClass(result.class);
        }

        // 4. Features / Traits / Abilities
        const featMatch = raw.match(/(?:Features|Traits|Abilities)\s*:\s*([^\n\r]+)/i);
        if (featMatch) {
            const cleanFeatsStr = featMatch[1].replace(/^\(\((?:PILLS|PLS|PILL)\)\)\s*/i, '').trim();
            result.features = splitTopLevelPillItems(cleanFeatsStr)
                .map(f => f.trim())
                .filter(Boolean);
        } else {
            result.features = [];
        }
    }

    // 4. Attributes / Stats
    // D&D: STR 16 (+3), DEX 14 (+2), CON 14 (+2), INT 10 (+0), WIS 12 (+1), CHA 8 (-1)
    // PbtA: Might +2, Agility +1, Wits +1, Heart +0, Arcana -1
    const statLineMatch = raw.match(/(?:Stats|Attr|Attributes)\s*:\s*([^\n\r]+)/i);
    if (statLineMatch) {
        const pairs = statLineMatch[1].split(/[,|;]/);
        for (const pair of pairs) {
            const pMatch = pair.trim().match(/^([A-Za-z]+)\s*[:=]?\s*(\d+|\+?-?\d+)/);
            if (pMatch) {
                const statRaw = pMatch[1];
                const statVal = parseInt(pMatch[2], 10);
                if (!isNaN(statVal)) {
                    result.stats[statRaw.toUpperCase()] = statVal;
                    const titleKey = statRaw.charAt(0).toUpperCase() + statRaw.slice(1).toLowerCase();
                    result.stats[titleKey] = statVal;
                }
            }
        }
    }

    result.abilities = parseAbilitiesBlockFromMemo(memoText);

    return result;
}

/**
 * Parses the standalone [ABILITIES] block from the State Memo if present.
 *
 * @param {string} memoText Raw state memo text.
 * @returns {string[]} Array of active ability lines.
 */
export function parseAbilitiesBlockFromMemo(memoText) {
    if (!memoText || typeof memoText !== 'string') return [];
    const abMatch = memoText.match(/\[ABILITIES\]([\s\S]*?)\[\/ABILITIES\]/i);
    if (!abMatch) return [];
    return abMatch[1]
        .split('\n')
        .map(line => line.trim().replace(/^[-*•–—]\s*/, ''))
        .filter(Boolean);
}

/**
 * Detects whether a dossier represents a PbtA narrative campaign.
 *
 * @param {object} dossier Campaign dossier.
 * @returns {boolean}
 */
export function isDossierPbta(dossier) {
    if (!dossier || typeof dossier !== 'object') return false;
    return systemRegistry.detectRuleset(dossier, { fallback: 'dnd5e' }) === 'pbta';
}

/**
 * Detects whether a dossier represents an FAE narrative campaign.
 *
 * @param {object} dossier Campaign dossier.
 * @returns {boolean}
 */
export function isDossierFae(dossier) {
    if (!dossier || typeof dossier !== 'object') return false;
    return systemRegistry.detectRuleset(dossier, { fallback: 'dnd5e' }) === 'fae';
}

/**
 * Creates a clean, standardized campaign dossier stub for unconfigured or stock chats across D&D 5e, PbtA, and FAE.
 *
 * @param {string} chatId Unique identifier for the chat.
 * @param {string} stateMemo Live state memo to parse character data from.
 * @param {string} [chatTitle=''] Optional title of the chat.
 * @returns {object} Standardized dossier stub.
 */
export function scaffoldDossierStubForChat(chatId, stateMemo, chatTitle = '') {
    const charData = parseCharacterBlockFromMemo(stateMemo);

    // Determine active ruleset & system key
    const detectedRuleset = systemRegistry.detectRulesetFromMemo(stateMemo);
    const isFae = detectedRuleset === 'fae' || !!charData.isFae;
    const isPbta = !isFae && (detectedRuleset === 'pbta' || !!charData.isPbta);
    const ruleset = isFae ? 'fae' : (isPbta ? 'pbta' : 'dnd5e');
    const systemKey = isFae ? (charData.genreKey || 'cosmic_horror') : (isPbta ? 'pbta' : 'dnd5e');
    const systemLabel = isFae
        ? 'FAE Freeform Attrition Engine'
        : (isPbta ? 'PbtA Narrative Engine' : 'D&D 5e Standard');

    return {
        meta: {
            chatId: chatId || 'default',
            title: chatTitle || `${charData.name}'s Adventure`,
            ruleset,
            systemKey,
            systemLabel,
            isStub: true,
            autoScaffolded: true,
            createdAt: new Date().toISOString(),
        },
        protagonist: {
            name: charData.name,
            class: charData.class,
            archetype: isFae ? (charData.archetype || charData.class) : undefined,
            playbook: isPbta ? (charData.playbook || charData.class) : undefined,
            isFae,
            isPbta,
            level: (isPbta || isFae) ? null : charData.level,
            hitDie: (isPbta || isFae) ? null : charData.hitDie,
            hp: (isPbta || isFae) ? null : {
                current: charData.currentHp,
                max: charData.maxHp,
            },
            harm: isPbta ? (charData.harm || { current: 0, max: 4, armor: charData.armor || 1 }) : null,
            pools: isFae ? (charData.pools || {}) : undefined,
            positiveTags: isFae ? (charData.positiveTags || []) : undefined,
            negativeTags: isFae ? (charData.negativeTags || []) : undefined,
            moves: isPbta ? (charData.moves || []) : undefined,
            startingMoves: isPbta ? (charData.moves || []) : undefined,
            conditions: isPbta ? (charData.conditions || []) : undefined,
            gear: isPbta ? (charData.gear || []) : undefined,
            features: (isPbta || isFae) ? undefined : (charData.features || []),
            abilities: (isPbta || isFae) ? undefined : (charData.abilities || []),
            status: (isPbta || isFae) ? (charData.status || 'Healthy') : undefined,
            stats: charData.stats,
            rawCharacterBlock: charData.rawText,
        },
        progressionBlueprint: null,
        config: {
            simulationDepth: 'active_fronts',
            partySyncEnabled: !isFae,
            ...(isFae && charData.knobs ? { knobs: charData.knobs } : {}),
            ...(isFae && charData.scenesTarget ? { scenesTarget: charData.scenesTarget } : {}),
        },
    };
}

/**
 * Ensures an active chat has an accessible campaign dossier, scaffolding a stub if missing.
 *
 * @param {string} chatId The target chat identifier.
 * @param {object} [rpgSettings=null] MultiHog settings reference.
 * @param {object} [options={}] Optional configuration.
 * @returns {object} Active or newly scaffolded dossier.
 */
export function ensureChatDossier(chatId, companionSettings = null, options = {}) {
    const stCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const liveMemo = options.memo
        || companionSettings?.currentMemo
        || stCtx?.extensionSettings?.rpg_tracker?.currentMemo
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker?.currentMemo : null)
        || globalThis.extension_settings?.rpg_tracker?.currentMemo
        || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
        || '';

    if (!chatId) return scaffoldDossierStubForChat('unknown', liveMemo);

    const cleanPartId = String(chatId || '').replace(/\.jsonl$/i, '').trim();
    const candidateIds = getCandidateChatIds(chatId);
    let dossier = null;

    // 1. Existing PbtA, FAE, or Companion dossier in passed companionSettings
    if (companionSettings?.chatStates) {
        for (const cid of candidateIds) {
            const found = getPartitionDossier(companionSettings.chatStates[cid]);
            if (found) {
                dossier = found;
                break;
            }
        }
    }

    // 2. SillyTavern chatMetadata check (direct per-chat metadata)
    if (!dossier) {
        try {
            const metaDossier = stCtx?.chatMetadata?.mhc_dossier
                || stCtx?.chat_metadata?.mhc_dossier
                || (typeof globalThis !== 'undefined' && globalThis.chat_metadata?.mhc_dossier);
            if (metaDossier && typeof metaDossier === 'object') {
                dossier = metaDossier;
            }
        } catch (_) {
            // SillyTavern context unavailable in headless testing
        }
    }

    // 3. Global extension_settings & SillyTavern extensionSettings checks
    if (!dossier) {
        try {
            const compGlobal = stCtx?.extensionSettings?.multihog_companion
                || (typeof extension_settings !== 'undefined' ? extension_settings?.multihog_companion : null)
                || globalThis.extension_settings?.multihog_companion;
            const rpgGlobal = stCtx?.extensionSettings?.rpg_tracker
                || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
                || globalThis.extension_settings?.rpg_tracker;

            for (const cid of candidateIds) {
                const compDossier = getPartitionDossier(compGlobal?.chatStates?.[cid]);
                if (compDossier) {
                    dossier = compDossier;
                    break;
                }
                const rpgDossier = getPartitionDossier(rpgGlobal?.chatStates?.[cid]);
                if (rpgDossier) {
                    dossier = rpgDossier;
                    break;
                }
            }
        } catch (_) {}
    }

    // Refresh protagonist details if existing dossier is a stub or has generic protagonist while liveMemo has real data
    if (dossier) {
        const memoDetectedRuleset = liveMemo ? systemRegistry.detectRulesetFromMemo(liveMemo) : null;
        const faeMode = isDossierFae(dossier) || memoDetectedRuleset === 'fae';
        const pbtaMode = !faeMode && (isDossierPbta(dossier) || /Harm\s*:\s*\d+\/\d+/i.test(liveMemo || ''));
        if (faeMode) {
            dossier.meta = dossier.meta || {};
            dossier.meta.ruleset = 'fae';
            const existingKey = (dossier.meta.systemKey || '').toLowerCase();
            if (existingKey && (FAE_GENRES[existingKey] || existingKey === 'custom')) {
                dossier.meta.systemKey = existingKey;
            } else {
                dossier.meta.systemKey = 'cosmic_horror';
            }
            if (!dossier.meta.systemLabel || dossier.meta.systemLabel.includes('5e')) {
                dossier.meta.systemLabel = 'FAE Freeform Attrition Engine';
            }
            if (dossier.progressionBlueprint?.levels) {
                dossier.progressionBlueprint = null;
            }
            if (dossier.protagonist) {
                dossier.protagonist.isFae = true;
                dossier.protagonist.isPbta = false;
                dossier.protagonist.hitDie = null;
                dossier.protagonist.level = null;
                dossier.protagonist.archetype = dossier.protagonist.archetype || dossier.protagonist.class;
            }
        } else if (pbtaMode) {
            dossier.meta = dossier.meta || {};
            const existingKey = (dossier.meta.systemKey || '').toLowerCase();
            if (existingKey && PBTA_GENRES[existingKey]) {
                dossier.meta.genre = dossier.meta.genre || existingKey;
            } else {
                dossier.meta.systemKey = 'pbta';
            }
            if (!dossier.meta.systemLabel || dossier.meta.systemLabel.includes('5e')) {
                dossier.meta.systemLabel = 'PbtA Narrative Engine';
            }
            if (dossier.progressionBlueprint?.levels) {
                dossier.progressionBlueprint = null;
            }
            if (dossier.protagonist) {
                dossier.protagonist.isPbta = true;
                dossier.protagonist.hitDie = null;
                dossier.protagonist.level = null;
                dossier.protagonist.playbook = dossier.protagonist.playbook || dossier.protagonist.class;
                if (!dossier.protagonist.moves && dossier.protagonist.startingMoves) {
                    dossier.protagonist.moves = [...dossier.protagonist.startingMoves];
                }
            }
        }

        if (dossier.meta?.isStub || dossier.protagonist?.name === 'Protagonist' || !dossier.protagonist?.class || dossier.protagonist?.class === 'Adventurer' || pbtaMode || faeMode) {
            if (liveMemo) {
                const parsed = parseCharacterBlockFromMemo(liveMemo);
                if (parsed.name && parsed.name !== 'Protagonist') {
                    const isFaeProtagonist = parsed.isFae || faeMode;
                    const isPbtaProtagonist = !isFaeProtagonist && (parsed.isPbta || pbtaMode);
                    dossier.protagonist = {
                        ...dossier.protagonist,
                        name: parsed.name,
                        class: parsed.class !== 'Adventurer' ? parsed.class : (dossier.protagonist?.class || parsed.class),
                        archetype: isFaeProtagonist ? (parsed.archetype || dossier.protagonist?.archetype || parsed.class) : undefined,
                        playbook: isPbtaProtagonist ? (parsed.playbook || dossier.protagonist?.playbook || parsed.class) : undefined,
                        isFae: isFaeProtagonist,
                        isPbta: isPbtaProtagonist,
                        level: (isPbtaProtagonist || isFaeProtagonist) ? null : (parsed.level || dossier.protagonist?.level || 1),
                        hitDie: (isPbtaProtagonist || isFaeProtagonist) ? null : (parsed.hitDie || dossier.protagonist?.hitDie || deriveHitDieForClass(parsed.class || dossier.protagonist?.class)),
                        hp: (isPbtaProtagonist || isFaeProtagonist) ? null : {
                            current: parsed.currentHp || dossier.protagonist?.hp?.current || 10,
                            max: parsed.maxHp || dossier.protagonist?.hp?.max || 10,
                        },
                        harm: isPbtaProtagonist ? (parsed.harm || dossier.protagonist?.harm || { current: 0, max: 4, armor: 1 }) : null,
                        pools: isFaeProtagonist ? (Object.keys(parsed.pools || {}).length > 0 ? parsed.pools : (dossier.protagonist?.pools || {})) : undefined,
                        positiveTags: isFaeProtagonist ? (parsed.positiveTags?.length > 0 ? parsed.positiveTags : (dossier.protagonist?.positiveTags || [])) : undefined,
                        negativeTags: isFaeProtagonist ? (parsed.negativeTags?.length > 0 ? parsed.negativeTags : (dossier.protagonist?.negativeTags || [])) : undefined,
                        moves: isPbtaProtagonist ? (parsed.moves && parsed.moves.length > 0 ? parsed.moves : (dossier.protagonist?.moves || dossier.protagonist?.startingMoves || [])) : undefined,
                        startingMoves: isPbtaProtagonist ? (dossier.protagonist?.startingMoves || parsed.moves || []) : undefined,
                        conditions: isPbtaProtagonist ? (parsed.conditions || dossier.protagonist?.conditions || []) : undefined,
                        gear: isPbtaProtagonist ? (parsed.gear || dossier.protagonist?.gear || []) : undefined,
                        features: (isPbtaProtagonist || isFaeProtagonist) ? undefined : (parsed.features?.length > 0 ? parsed.features : (dossier.protagonist?.features || [])),
                        abilities: (isPbtaProtagonist || isFaeProtagonist) ? undefined : (parsed.abilities?.length > 0 ? parsed.abilities : (dossier.protagonist?.abilities || [])),
                        status: (isPbtaProtagonist || isFaeProtagonist) ? (parsed.status || dossier.protagonist?.status || 'Healthy') : undefined,
                        stats: Object.keys(parsed.stats).length > 0 ? parsed.stats : (dossier.protagonist?.stats || {}),
                        rawCharacterBlock: parsed.rawText || dossier.protagonist?.rawCharacterBlock,
                    };
                }
            }
        }

        if (liveMemo && !pbtaMode && !faeMode) {
            const liveParsed = parseCharacterBlockFromMemo(liveMemo);
            if (Array.isArray(liveParsed.features) && liveParsed.features.length > 0) {
                if (!dossier.protagonist) dossier.protagonist = {};
                if (!Array.isArray(dossier.protagonist.features) || dossier.protagonist.features.length === 0) {
                    dossier.protagonist.features = [...liveParsed.features];
                }
            }
            if (Array.isArray(liveParsed.abilities) && liveParsed.abilities.length > 0) {
                if (!dossier.protagonist) dossier.protagonist = {};
                if (!Array.isArray(dossier.protagonist.abilities) || dossier.protagonist.abilities.length === 0) {
                    dossier.protagonist.abilities = [...liveParsed.abilities];
                }
            }
        }

        // Auto-link canonical SRD progression if class matches and blueprint is missing (D&D 5e only)
        if (!pbtaMode && !faeMode && !dossier.progressionBlueprint && dossier.protagonist?.class) {
            const canonical = getCanonicalDndProgression(dossier.protagonist.class);
            if (canonical) {
                dossier.progressionBlueprint = {
                    className: canonical.className,
                    hitDie: canonical.hitDie,
                    primaryStats: canonical.primaryStats,
                    levels: { ...canonical.levels },
                };
            }
        }

        // Keep partition cache in sync without creating .jsonl duplicate keys (WRK-10)
        const rulesetHint = faeMode ? 'fae' : (pbtaMode ? 'pbta' : 'dnd5e');
        if (companionSettings?.chatStates && cleanPartId) {
            companionSettings.chatStates[cleanPartId] = companionSettings.chatStates[cleanPartId] || {};
            setPartitionDossier(companionSettings.chatStates[cleanPartId], dossier, rulesetHint);
        }

        return dossier;
    }

    // 4. Auto-Scaffold fresh stub from current state memo
    const chatTitle = options.chatTitle || '';
    const stub = scaffoldDossierStubForChat(chatId, liveMemo, chatTitle);
    const stubRuleset = stub.meta?.ruleset || (stub.meta?.systemKey === 'pbta' ? 'pbta' : 'dnd5e');

    if (stub.protagonist?.class && stubRuleset === 'dnd5e') {
        const canonical = getCanonicalDndProgression(stub.protagonist.class);
        if (canonical) {
            stub.progressionBlueprint = {
                className: canonical.className,
                hitDie: canonical.hitDie,
                primaryStats: canonical.primaryStats,
                levels: { ...canonical.levels },
            };
        }
    }

    // Save in chat partition without creating .jsonl duplicate keys (WRK-10)
    if (companionSettings?.chatStates && cleanPartId) {
        companionSettings.chatStates[cleanPartId] = companionSettings.chatStates[cleanPartId] || {};
        setPartitionDossier(companionSettings.chatStates[cleanPartId], stub, stubRuleset);
    }

    // Save in SillyTavern chatMetadata if available
    try {
        if (stCtx?.chatMetadata) {
            stCtx.chatMetadata.mhc_dossier = stub;
            if (typeof stCtx.saveMetadataDebounced === 'function') {
                stCtx.saveMetadataDebounced();
            }
        }
    } catch (_) {}

    // Auto-sync into Campaign_<ChatTitle> World Info Lorebook asynchronously
    syncDossierToWorldInfoBook(chatId, stub).catch(() => {});

    return stub;
}

/**
 * Persists the Campaign Dossier and Progression Blueprint across all storage tiers:
 * 1. SillyTavern chatMetadata (direct per-chat metadata, saved to disk)
 * 2. MultiHog Companion chatStates partition (canonical cleanId per WRK-10)
 * 3. MultiHog RPG Tracker chatStates partition (canonical cleanId per WRK-10)
 * 4. SillyTavern extension settings (saveSettingsDebounced)
 * 5. Campaign_<ChatTitle> World Info Lorebook (async)
 *
 * @param {string} chatId
 * @param {object} dossier
 * @returns {object} The persisted dossier
 */
export function persistCompanionDossier(chatId, dossier) {
    if (!dossier) return null;

    // Once a blueprint exists or build changes are committed, mark stub as false
    if (dossier.meta) {
        if (dossier.progressionBlueprint) {
            dossier.meta.isStub = false;
        }
        dossier.meta.updatedAt = new Date().toISOString();
    }

    const rulesetHint = isDossierFae(dossier) ? 'fae' : (isDossierPbta(dossier) ? 'pbta' : 'dnd5e');
    const stCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;

    // 1. SillyTavern chatMetadata
    try {
        if (stCtx?.chatMetadata) {
            stCtx.chatMetadata.mhc_dossier = dossier;
        }
        if (typeof globalThis !== 'undefined' && globalThis.chat_metadata) {
            globalThis.chat_metadata.mhc_dossier = dossier;
        }
        if (typeof stCtx?.saveMetadataDebounced === 'function') {
            stCtx.saveMetadataDebounced();
        } else if (typeof stCtx?.saveMetadata === 'function') {
            stCtx.saveMetadata();
        }
    } catch (_) {}

    // Strip .jsonl extension so duplicate extension-laden keys never pollute chatStates (WRK-10)
    const cleanId = String(chatId || '').replace(/\.jsonl$/i, '').trim();
    const syncStorePartition = (store) => {
        if (!store || !cleanId) return;
        store.chatStates = store.chatStates || {};
        store.chatStates[cleanId] = store.chatStates[cleanId] || {};
        setPartitionDossier(store.chatStates[cleanId], dossier, rulesetHint);
    };

    // 2. MultiHog Companion extension_settings partition
    try {
        const compTargets = new Set([
            stCtx?.extensionSettings?.multihog_companion,
            typeof extension_settings !== 'undefined' ? extension_settings?.multihog_companion : null,
            globalThis.extension_settings?.multihog_companion,
        ].filter(Boolean));
        for (const compSettings of compTargets) {
            syncStorePartition(compSettings);
        }
    } catch (_) {}

    // 3. Upstream MultiHog RPG Tracker partition
    try {
        const rpgTargets = new Set([
            stCtx?.extensionSettings?.rpg_tracker,
            typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null,
            globalThis.extension_settings?.rpg_tracker,
        ].filter(Boolean));
        for (const rpg of rpgTargets) {
            syncStorePartition(rpg);
        }
    } catch (_) {}

    // 4. Save settings debounced
    try {
        if (typeof stCtx?.saveSettingsDebounced === 'function') {
            stCtx.saveSettingsDebounced();
        } else if (typeof globalThis.saveSettingsDebounced === 'function') {
            globalThis.saveSettingsDebounced();
        }
    } catch (_) {}

    // 5. Campaign World Info Lorebook sync
    syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

    return dossier;
}

/**
 * Formats a Campaign Dossier (D&D 5e, PbtA, or FAE) into Markdown for SillyTavern World Info storage.
 *
 * @param {string} chatId
 * @param {object} dossier
 * @returns {string}
 */
export function buildDossierWorldInfoMarkdown(chatId, dossier) {
    if (!dossier) return '';
    const cleanId = String(chatId || 'Adventure').replace(/\.jsonl$/i, '').trim();
    const cleanTitle = (dossier.meta?.title || cleanId).replace(/[^\w\s'-]/g, '').trim();
    const isFae = isDossierFae(dossier);
    const isPbta = !isFae && isDossierPbta(dossier);
    const isStubCodex = Boolean(dossier.meta?.autoScaffolded || dossier.meta?.isStub);
    const p = dossier.protagonist || {};
    const charMeta = dossier.character || {};

    let md = isStubCodex
        ? `# 📜 CHARACTER PROGRESSION CODEX: ${dossier.meta?.title || cleanTitle}\n\n`
        : `# 📜 CAMPAIGN DOSSIER: ${dossier.meta?.title || cleanTitle}\n\n`;

    const fallbackLabel = isFae
        ? 'FAE Freeform Attrition Engine'
        : (isPbta ? 'PbtA Narrative Engine' : 'D&D 5e Standard');
    const fallbackKey = isFae ? 'fae' : (isPbta ? 'pbta' : 'dnd5e');
    md += `* **System Engine:** ${dossier.meta?.systemLabel || fallbackLabel} (\`${dossier.meta?.systemKey || fallbackKey}\`)\n`;
    md += `* **Status:** Active Campaign\n\n---\n\n`;

    md += `## 👤 Protagonist: ${p.name || 'Hero'}\n`;
    if (isFae) {
        md += `* **Archetype:** ${p.archetype || p.class || 'Survivor'}\n`;
        const pools = p.pools || charMeta.pools || {};
        if (Object.keys(pools).length > 0) {
            const poolsStr = Object.entries(pools)
                .map(([k, pool]) => `${pool?.label || k} (${pool?.current ?? pool?.max ?? 8}/${pool?.max ?? 8})`)
                .join(' · ');
            md += `* **Resource Pools:** ${poolsStr}\n`;
        }
        const posTags = p.positiveTags || p.positive_tags || charMeta.positiveTags || [];
        if (Array.isArray(posTags) && posTags.length > 0) {
            md += `* **Positive Tags:** ${posTags.join(', ')}\n`;
        }
        const negTags = p.negativeTags || p.negative_tags || charMeta.negativeTags || [];
        if (Array.isArray(negTags) && negTags.length > 0) {
            md += `* **Scars & Debuffs:** ${negTags.join(', ')}\n`;
        }
        if (dossier.config?.knobs) {
            const k = dossier.config.knobs;
            md += `* **FAE Knobs:** Flee Grace ${k.flee_grace_toggle ? 'ON' : 'OFF'} · Shift ${Number(k.base_attrition_shift || 0) >= 0 ? `+${Number(k.base_attrition_shift || 0)}` : k.base_attrition_shift} · Overflow ${k.overflow_default || 'scar_and_ko'}\n`;
        }
    } else if (isPbta) {
        md += `* **Playbook:** ${p.playbook || p.class || 'Wanderer'}\n`;
        const harm = p.harm || { current: 0, max: dossier.config?.harmMax || 5, armor: 0 };
        md += `* **Harm Track:** ${harm.current ?? 0}/${harm.max ?? 5} · **Armor:** ${harm.armor ?? p.armor ?? 0}\n`;
        if (p.stats && Object.keys(p.stats).length > 0) {
            md += `* **Stats:** ${Object.entries(p.stats).map(([k, v]) => `${k} ${Number(v) >= 0 ? `+${v}` : v}`).join(' · ')}\n`;
        }
        const moves = p.startingMoves || p.moves || [];
        if (Array.isArray(moves) && moves.length > 0) {
            md += `* **Moves:** ${moves.join(', ')}\n`;
        }
    } else {
        md += `* **Class / Archetype:** ${p.class || 'Adventurer'}\n`;
        md += `* **Level:** ${p.level || 1}\n`;
        md += `* **Hit Points:** ${(p.hp?.current ?? 10)}/${(p.hp?.max ?? 10)} HP\n`;
        md += `* **Hit Die:** ${p.hitDie || 'd8'}\n`;
        if (p.stats && Object.keys(p.stats).length > 0) {
            md += `* **Attributes:** ${Object.entries(p.stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(' · ')}\n`;
        }
    }

    if (p.rawCharacterBlock) {
        md += `\n### 📋 Character Sheet Details:\n\`\`\`text\n${p.rawCharacterBlock}\n\`\`\`\n`;
    }

    const bp = !isFae && !isPbta ? dossier.progressionBlueprint : null;
    if (bp && bp.levels) {
        md += `\n---\n\n## 📜 1–20 Progression Blueprint (${bp.className || p.class || 'Adventurer'})\n`;
        md += `* **Hit Die:** ${bp.hitDie || p.hitDie || 'd8'}\n`;
        if (bp.primaryStats) md += `* **Primary Stats:** ${bp.primaryStats.join(', ')}\n`;
        if (bp.subclassTitle) md += `* **Subclass Specialization:** ${bp.subclassTitle}\n\n`;
        md += `### Advancement Codex:\n`;
        for (const [lvl, data] of Object.entries(bp.levels)) {
            const feats = (data.features || []).join(', ');
            const asiNote = data.asi ? ' [Milestone ASI/Feat]' : '';
            const subNote = data.subclass ? ' [Subclass Archetype]' : '';
            md += `* **Level ${lvl}:** ${feats}${asiNote}${subNote}\n`;
        }
    }

    return md;
}

/**
 * Injects or updates the Campaign Dossier and Progression Blueprint into SillyTavern's World Info lorebooks.
 * Guarantees a Campaign_<ChatTitle> lorebook appears in the Worlds/Lorebooks dropdown.
 *
 * @param {string} chatId
 * @param {object} dossier
 * @returns {Promise<void>}
 */
export async function syncDossierToWorldInfoBook(chatId, dossier) {
    if (!chatId || !dossier) return;
    const cleanId = String(chatId).replace(/\.jsonl$/i, '').trim();
    const cleanTitle = (dossier.meta?.title || cleanId).replace(/[^\w\s'-]/g, '').trim();
    const bookName = cleanTitle.startsWith('Campaign_') ? cleanTitle : `Campaign_${cleanTitle || cleanId || 'Adventure'}`;

    const isStubCodex = Boolean(dossier.meta?.autoScaffolded || dossier.meta?.isStub);
    const md = buildDossierWorldInfoMarkdown(chatId, dossier);
    const p = dossier.protagonist || {};

    const entry = {
        uid: Date.now(),
        key: isStubCodex
            ? ['progression', 'codex', 'blueprint', 'level up', p.name || 'hero', p.class || 'adventurer']
            : ['campaign', 'dossier', 'setting overview', 'blueprint', 'campaign dossier', p.name || 'hero', p.class || 'adventurer'],
        keysecondary: [],
        comment: isStubCodex
            ? 'Character Progression Codex & Level-Up Artifact'
            : 'Campaign Dossier & 1–20 Progression Codex Artifact',
        content: md,
        constant: false,
        selective: false,
        order: 100,
        position: 1,
        disable: false,
    };

    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (!ctx) return;
        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));

        const getRes = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: bookName }),
        });

        let bookData = { entries: {} };
        if (getRes.ok) {
            bookData = await getRes.json();
            bookData.entries = bookData.entries || {};
        }

        // Find existing campaign dossier entry if present
        let targetUid = null;
        for (const [uid, e] of Object.entries(bookData.entries)) {
            if (e.comment?.includes('Campaign Dossier') || e.comment?.includes('CAMPAIGN_DOSSIER') || e.key?.includes('campaign dossier')) {
                targetUid = uid;
                break;
            }
        }

        entry.uid = targetUid ? parseInt(targetUid, 10) : entry.uid;
        bookData.entries[String(entry.uid)] = entry;

        await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: bookName, data: bookData }),
        });

        // Invalidate frontend cache if available
        try {
            const wiMod = await import('../../../world-info.js');
            if (wiMod?.worldInfoCache && typeof wiMod.worldInfoCache.set === 'function') {
                wiMod.worldInfoCache.set(bookName, bookData);
            }
        } catch (_) {}

        // Bind to chat metadata world_info if not set
        if (ctx.chatMetadata && !ctx.chatMetadata.world_info) {
            ctx.chatMetadata.world_info = bookName;
            if (typeof ctx.saveMetadataDebounced === 'function') {
                ctx.saveMetadataDebounced();
            }
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Could not sync Campaign Lorebook:', err);
    }
}
