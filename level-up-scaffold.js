/**
 * MultiHog Companion — Level-Up Scaffold & Dossier Stub Generator
 *
 * Provides instant auto-scaffolding of campaign dossiers for chats originated
 * through Instant Action, Character Creator, or stock D&D without Session Zero.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { getCandidateChatIds } from './persona-matching.js';

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

    // Detect PbtA narrative mechanics
    const isPbta = /Harm\s*:\s*\d+\/\d+/i.test(memoText || '') || /\bMoves\s*:/i.test(memoText || '');

    if (isPbta) {
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
        const movesMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Moves\s*:\s*([^\n\r]+)/i);
        if (movesMatch) {
            result.moves = movesMatch[1]
                .split(/,(?![^(\[]*[)\]])/)
                .map(m => m.trim().replace(/^\(\(PILL\)\)\s*/i, ''))
                .filter(Boolean);
        } else {
            result.moves = [];
        }

        // Conditions ((PILLS)) Conditions: ...
        const condMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Conditions\s*:\s*([^\n\r]+)/i);
        if (condMatch) {
            result.conditions = condMatch[1]
                .split(/,(?![^(\[]*[)\]])/)
                .map(c => c.trim().replace(/^\(\(PILL\)\)\s*/i, ''))
                .filter(Boolean);
        } else {
            result.conditions = [];
        }

        // Gear ((PILLS)) Gear: ...
        const gearMatch = raw.match(/(?:\(\(PILLS\)\)\s*)?Gear\s*:\s*([^\n\r]+)/i);
        if (gearMatch) {
            result.gear = gearMatch[1]
                .split(/,(?![^(\[]*[)\]])/)
                .map(g => g.trim().replace(/^\(\(PILL\)\)\s*/i, ''))
                .filter(Boolean);
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
            // Derive reasonable default hit die from class
            const cLower = result.class.toLowerCase();
            if (cLower.includes('barbarian')) result.hitDie = 'd12';
            else if (cLower.includes('fighter') || cLower.includes('paladin') || cLower.includes('ranger')) result.hitDie = 'd10';
            else if (cLower.includes('wizard') || cLower.includes('sorcerer')) result.hitDie = 'd6';
            else result.hitDie = 'd8';
        }

        // 4. Features / Traits / Abilities
        const featMatch = raw.match(/(?:Features|Traits|Abilities)\s*:\s*([^\n\r]+)/i);
        if (featMatch) {
            result.features = featMatch[1]
                .split(/,(?![^(\[]*[)\]])/)
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
    if (!dossier) return false;
    if (dossier.meta?.systemKey === 'pbta') return true;
    if (dossier.protagonist?.isPbta || dossier.protagonist?.playbook || dossier.protagonist?.harm) return true;
    if (dossier.meta?.systemLabel && /PbtA|Dungeon World|Fellowship|Apocalypse/i.test(dossier.meta.systemLabel)) return true;
    return false;
}

/**
 * Creates a clean, standardized campaign dossier stub for unconfigured or stock D&D chats.
 *
 * @param {string} chatId Unique identifier for the chat.
 * @param {string} stateMemo Live state memo to parse character data from.
 * @param {string} [chatTitle=''] Optional title of the chat.
 * @returns {object} Standardized dossier stub.
 */
export function scaffoldDossierStubForChat(chatId, stateMemo, chatTitle = '') {
    const charData = parseCharacterBlockFromMemo(stateMemo);

    // Determine basic system key
    const isPbta = /Harm\s*:\s*\d+\/\d+/i.test(stateMemo) || /\(Harm:\s*\d+\/\d+\)/i.test(stateMemo) || !!charData.isPbta;
    const systemKey = isPbta ? 'pbta' : 'dnd5e';
    const systemLabel = isPbta ? 'PbtA Narrative Engine' : 'D&D 5e Standard';

    return {
        meta: {
            chatId: chatId || 'default',
            title: chatTitle || `${charData.name}'s Adventure`,
            systemKey,
            systemLabel,
            isStub: true,
            createdAt: new Date().toISOString(),
        },
        protagonist: {
            name: charData.name,
            class: charData.class,
            playbook: isPbta ? (charData.playbook || charData.class) : undefined,
            isPbta,
            level: isPbta ? null : charData.level,
            hitDie: isPbta ? null : charData.hitDie,
            hp: isPbta ? null : {
                current: charData.currentHp,
                max: charData.maxHp,
            },
            harm: isPbta ? (charData.harm || { current: 0, max: 4, armor: charData.armor || 1 }) : null,
            moves: isPbta ? (charData.moves || []) : undefined,
            startingMoves: isPbta ? (charData.moves || []) : undefined,
            conditions: isPbta ? (charData.conditions || []) : undefined,
            gear: isPbta ? (charData.gear || []) : undefined,
            features: isPbta ? undefined : (charData.features || []),
            abilities: isPbta ? undefined : (charData.abilities || []),
            status: isPbta ? (charData.status || 'Healthy') : undefined,
            stats: charData.stats,
            rawCharacterBlock: charData.rawText,
        },
        progressionBlueprint: null,
        config: {
            simulationDepth: 'active_fronts',
            partySyncEnabled: true,
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
    const liveMemo = options.memo
        || companionSettings?.currentMemo
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker?.currentMemo : null)
        || globalThis.extension_settings?.rpg_tracker?.currentMemo
        || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
        || '';

    if (!chatId) return scaffoldDossierStubForChat('unknown', liveMemo);

    const candidateIds = getCandidateChatIds(chatId);
    let dossier = null;

    // 1. Existing PbtA or Companion dossier in passed companionSettings
    if (companionSettings?.chatStates) {
        for (const cid of candidateIds) {
            const part = companionSettings.chatStates[cid];
            if (part?.pbtaCampaignDossier) {
                dossier = part.pbtaCampaignDossier;
                break;
            }
            if (part?.companionDossier) {
                dossier = part.companionDossier;
                break;
            }
        }
    }

    // 2. SillyTavern chatMetadata check (direct per-chat metadata)
    if (!dossier) {
        try {
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            const metaDossier = ctx?.chatMetadata?.mhc_dossier
                || ctx?.chat_metadata?.mhc_dossier
                || (typeof globalThis !== 'undefined' && globalThis.chat_metadata?.mhc_dossier);
            if (metaDossier && typeof metaDossier === 'object') {
                dossier = metaDossier;
            }
        } catch (_) {
            // SillyTavern context unavailable in headless testing
        }
    }

    // 3. Global extension_settings checks
    if (!dossier) {
        try {
            const compGlobal = (typeof extension_settings !== 'undefined' ? extension_settings?.multihog_companion : null)
                || globalThis.extension_settings?.multihog_companion;
            const rpgGlobal = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
                || globalThis.extension_settings?.rpg_tracker;

            for (const cid of candidateIds) {
                if (compGlobal?.chatStates?.[cid]?.companionDossier) {
                    dossier = compGlobal.chatStates[cid].companionDossier;
                    break;
                }
                if (rpgGlobal?.chatStates?.[cid]?.companionDossier) {
                    dossier = rpgGlobal.chatStates[cid].companionDossier;
                    break;
                }
            }
        } catch (_) {}
    }

    // Refresh protagonist details if existing dossier is a stub or has generic protagonist while liveMemo has real data
    if (dossier) {
        const pbtaMode = isDossierPbta(dossier) || /Harm\s*:\s*\d+\/\d+/i.test(liveMemo || '');
        if (pbtaMode) {
            dossier.meta = dossier.meta || {};
            dossier.meta.systemKey = 'pbta';
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

        if (dossier.meta?.isStub || dossier.protagonist?.name === 'Protagonist' || !dossier.protagonist?.class || dossier.protagonist?.class === 'Adventurer' || pbtaMode) {
            if (liveMemo) {
                const parsed = parseCharacterBlockFromMemo(liveMemo);
                if (parsed.name && parsed.name !== 'Protagonist') {
                    const isPbtaProtagonist = parsed.isPbta || pbtaMode;
                    dossier.protagonist = {
                        ...dossier.protagonist,
                        name: parsed.name,
                        class: parsed.class !== 'Adventurer' ? parsed.class : (dossier.protagonist?.class || parsed.class),
                        playbook: isPbtaProtagonist ? (parsed.playbook || dossier.protagonist?.playbook || parsed.class) : undefined,
                        isPbta: isPbtaProtagonist,
                        level: isPbtaProtagonist ? null : (parsed.level || dossier.protagonist?.level || 1),
                        hitDie: isPbtaProtagonist ? null : (parsed.hitDie || dossier.protagonist?.hitDie || 'd8'),
                        hp: isPbtaProtagonist ? null : {
                            current: parsed.currentHp || dossier.protagonist?.hp?.current || 10,
                            max: parsed.maxHp || dossier.protagonist?.hp?.max || 10,
                        },
                        harm: isPbtaProtagonist ? (parsed.harm || dossier.protagonist?.harm || { current: 0, max: 4, armor: 1 }) : null,
                        moves: isPbtaProtagonist ? (parsed.moves && parsed.moves.length > 0 ? parsed.moves : (dossier.protagonist?.moves || dossier.protagonist?.startingMoves || [])) : undefined,
                        startingMoves: isPbtaProtagonist ? (dossier.protagonist?.startingMoves || parsed.moves || []) : undefined,
                        conditions: isPbtaProtagonist ? (parsed.conditions || dossier.protagonist?.conditions || []) : undefined,
                        gear: isPbtaProtagonist ? (parsed.gear || dossier.protagonist?.gear || []) : undefined,
                        features: isPbtaProtagonist ? undefined : (parsed.features?.length > 0 ? parsed.features : (dossier.protagonist?.features || [])),
                        abilities: isPbtaProtagonist ? undefined : (parsed.abilities?.length > 0 ? parsed.abilities : (dossier.protagonist?.abilities || [])),
                        status: isPbtaProtagonist ? (parsed.status || dossier.protagonist?.status || 'Healthy') : undefined,
                        stats: Object.keys(parsed.stats).length > 0 ? parsed.stats : (dossier.protagonist?.stats || {}),
                        rawCharacterBlock: parsed.rawText || dossier.protagonist?.rawCharacterBlock,
                    };
                }
            }
        }

        if (liveMemo && !pbtaMode) {
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

        // Keep partition cache in sync
        if (companionSettings?.chatStates && chatId) {
            companionSettings.chatStates[chatId] = companionSettings.chatStates[chatId] || {};
            companionSettings.chatStates[chatId].companionDossier = dossier;
        }

        return dossier;
    }

    // 4. Auto-Scaffold fresh stub from current state memo
    const chatTitle = options.chatTitle || '';
    const stub = scaffoldDossierStubForChat(chatId, liveMemo, chatTitle);

    // Save in chat partition
    if (companionSettings?.chatStates && chatId) {
        companionSettings.chatStates[chatId] = companionSettings.chatStates[chatId] || {};
        companionSettings.chatStates[chatId].companionDossier = stub;
    }

    // Save in SillyTavern chatMetadata if available
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (ctx?.chatMetadata) {
            ctx.chatMetadata.mhc_dossier = stub;
            if (typeof ctx.saveMetadataDebounced === 'function') {
                ctx.saveMetadataDebounced();
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
 * 2. MultiHog Companion chatStates partitions (all candidate chat IDs)
 * 3. MultiHog RPG Tracker chatStates partitions (all candidate chat IDs)
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

    const candidateIds = getCandidateChatIds(chatId);

    // 1. SillyTavern chatMetadata
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (ctx?.chatMetadata) {
            ctx.chatMetadata.mhc_dossier = dossier;
        }
        if (typeof globalThis !== 'undefined' && globalThis.chat_metadata) {
            globalThis.chat_metadata.mhc_dossier = dossier;
        }
        if (typeof ctx?.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
        } else if (typeof ctx?.saveMetadata === 'function') {
            ctx.saveMetadata();
        }
    } catch (_) {}

    // 2. MultiHog Companion extension_settings partition
    try {
        const compSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.multihog_companion : null)
            || globalThis.extension_settings?.multihog_companion;
        if (compSettings) {
            compSettings.chatStates = compSettings.chatStates || {};
            for (const cid of candidateIds) {
                compSettings.chatStates[cid] = compSettings.chatStates[cid] || {};
                compSettings.chatStates[cid].companionDossier = dossier;
            }
        }
    } catch (_) {}

    // 3. Upstream MultiHog RPG Tracker partition
    try {
        const rpg = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
            || globalThis.extension_settings?.rpg_tracker;
        if (rpg) {
            rpg.chatStates = rpg.chatStates || {};
            for (const cid of candidateIds) {
                rpg.chatStates[cid] = rpg.chatStates[cid] || {};
                rpg.chatStates[cid].companionDossier = dossier;
            }
        }
    } catch (_) {}

    // 4. Save settings debounced
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    } catch (_) {}

    // 5. Campaign World Info Lorebook sync
    syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

    return dossier;
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

    // Format dossier to Markdown
    let md = `# 📜 CAMPAIGN DOSSIER: ${dossier.meta?.title || cleanTitle}\n\n`;
    md += `* **System Engine:** ${dossier.meta?.systemLabel || 'D&D 5e Standard'} (\`${dossier.meta?.systemKey || 'dnd5e'}\`)\n`;
    md += `* **Status:** Active Campaign\n\n---\n\n`;

    const p = dossier.protagonist || {};
    md += `## 👤 Protagonist: ${p.name || 'Hero'}\n`;
    md += `* **Class / Archetype:** ${p.class || 'Adventurer'}\n`;
    md += `* **Level:** ${p.level || 1}\n`;
    md += `* **Hit Points:** ${(p.hp?.current ?? 10)}/${(p.hp?.max ?? 10)} HP\n`;
    md += `* **Hit Die:** ${p.hitDie || 'd8'}\n`;
    if (p.stats && Object.keys(p.stats).length > 0) {
        md += `* **Attributes:** ${Object.entries(p.stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(' · ')}\n`;
    }
    if (p.rawCharacterBlock) {
        md += `\n### 📋 Character Sheet Details:\n\`\`\`text\n${p.rawCharacterBlock}\n\`\`\`\n`;
    }

    const bp = dossier.progressionBlueprint;
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

    const entry = {
        uid: Date.now(),
        key: ['campaign', 'dossier', 'setting overview', 'blueprint', 'campaign dossier', p.name || 'hero', p.class || 'adventurer'],
        keysecondary: [],
        comment: 'Campaign Dossier & 1–20 Progression Codex Artifact',
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
            const wiMod = await import('../../../public/scripts/world-info.js');
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
