/**
 * concierge-system-dnd5e.js — MultiHog Companion
 *
 * D&D 5e (D&D Lite) Game System Adapter.
 * Encapsulates the streamlined single-track 1–20 D&D Lite model,
 * instant core SRD progressions (Fighter, Rogue, Wizard, etc.),
 * 6 ability modifiers, deterministic Hit Die / HP math,
 * passive traits vs. active [ABILITIES] routing, and Day 0 state memos.
 *
 * [CATALOG: FEAT-02] See FEATURES.md — Concierge Session Zero & Living World Dossier
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { ConciergeSystemAdapter } from './concierge-system-base.js';
import {
    CORE_DND_PROGRESSIONS,
    XP_LEVEL_THRESHOLDS,
    MAX_CHARACTER_LEVEL,
    getCanonicalDndProgression,
    formatTraitAsPill,
    classifyFeatureKind,
    partitionFeaturesAndAbilities,
} from './level-up-blueprint.js';
import { deriveHitDieForClass } from './level-up-scaffold.js';
import { deduplicateFeatures, extractFeatureKey } from './level-up-runner.js';
import { applyDndSubfooterAlignment } from './dnd-fixes.js';
import { buildCampaignContextSnippets, formatFactionsMemoBlock } from './pbta-ruleset.js';
import {
    cleanseStockDndSettings,
    setCompanionActiveCartridge,
    persistPbtaChatState,
} from './pbta-ruleset-persistence.js';
import { buildPlayerCardBio } from './concierge-pc-format.js';
import { buildMonsterEntryContent } from './concierge-npc-format.js';
import { systemRegistry } from './concierge-system-registry.js';
import { splitNameAndEmbeddedArchetype, flattenArchetypeParens } from './character-creator-sanitizer.js';

export const DND5E_GENRES = {
    fantasy: {
        id: 'fantasy',
        label: 'High Fantasy (Heroic Adventure)',
        icon: '🏰',
        description: 'Epic quests, ancient magic, dungeons, dragons, and heroic legends.',
        classes: ['Fighter', 'Rogue', 'Wizard', 'Cleric', 'Paladin', 'Ranger', 'Barbarian', 'Bard', 'Druid', 'Monk', 'Sorcerer', 'Warlock'],
        defaultClass: 'Fighter',
    },
    dark_fantasy: {
        id: 'dark_fantasy',
        label: 'Dark Fantasy Delve (Grimdark / OSR)',
        icon: '💀',
        description: 'Deadly dungeons, scarce resources, grim adversaries, and ancient forbidden horrors.',
        classes: ['Fighter', 'Rogue', 'Cleric', 'Wizard', 'Barbarian', 'Warlock'],
        defaultClass: 'Rogue',
    },
    sword_and_sorcery: {
        id: 'sword_and_sorcery',
        label: 'Sword & Sorcery (Low-Magic Grit)',
        icon: '🗡️',
        description: 'Brawn and cunning against decadent ruins, primordial beasts, and corrupt sorcerers.',
        classes: ['Barbarian', 'Fighter', 'Rogue', 'Ranger', 'Sorcerer'],
        defaultClass: 'Barbarian',
    },
    dungeon_crawl: {
        id: 'dungeon_crawl',
        label: 'Classic Dungeon Crawl (Traps & Vaults)',
        icon: '🗝️',
        description: 'Labyrinthine complexes, deadly traps, secret doors, and hoard vaults.',
        classes: ['Fighter', 'Rogue', 'Wizard', 'Cleric'],
        defaultClass: 'Fighter',
    },
    planescape: {
        id: 'planescape',
        label: 'Astral & Planar Voyages',
        icon: '🌌',
        description: 'Cosmic factions, outer planes, bizarre planar gates, and multiversal intrigue.',
        classes: ['Wizard', 'Warlock', 'Sorcerer', 'Monk', 'Bard', 'Paladin'],
        defaultClass: 'Wizard',
    },
};

/**
 * Calculates a D&D 5e ability modifier from a raw score.
 * Formula: Math.floor((score - 10) / 2)
 *
 * @param {number|string} score
 * @returns {number}
 */
export function calculateDndModifier(score) {
    const num = parseInt(score, 10);
    if (isNaN(num)) return 0;
    return Math.floor((num - 10) / 2);
}

/**
 * Formats a D&D 5e ability modifier with an explicit sign (+3, +0, -1).
 *
 * @param {number|string} score
 * @returns {string}
 */
export function formatDndModifierString(score) {
    const mod = calculateDndModifier(score);
    return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * Calculates a D&D 5e ability modifier from a raw score.
 *
 * @param {number|string} score
 * @returns {number}
 */
export function getDndStatModifier(score) {
    return calculateDndModifier(score);
}

const DND_RARITY_TAG_RX = /^\[(Common|Uncommon|Rare|Epic|Legendary|Artifact)\]\s*/i;
const DND_LEADING_EMOJI_RX = /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?\s*)+/u;
const DND_CURRENCY_LINE_RX = /^(?:💰|💵|🪙)?\s*(?:([$£€])\s*([\d,]+)(?:\s*(dollars?|usd|euros?|eur|pounds?|gbp))?|([\d,]+)\s*(gp|sp|cp|pp|ep|gold(?:\s+pieces?)?|silver(?:\s+pieces?)?|copper(?:\s+pieces?)?|dollars?|usd|credits?|caps?))\s*$/i;
const DND_WORTH_SUFFIX_RX = /\s*\(~[^)]+\)\s*$|\s*\(Worth:\s*[^)]+\)\s*$/i;

function pickDndItemEmoji(item, isGear) {
    const s = String(item || '').toLowerCase();
    if (/\b(?:shield|buckler)\b/.test(s)) return '🛡️';
    if (/\b(?:armor|mail|plate|leather|breastplate|chain|robe|cloak|helm|gauntlets|greaves)\b/.test(s)) return '🦺';
    if (/\b(?:bow|shortbow|longbow|crossbow|sling)\b/.test(s)) return '🏹';
    if (/\b(?:scroll|tome|grimoire|spellbook|book)\b/.test(s)) return '📜';
    if (/\b(?:focus|orb|totem|holy symbol|amulet)\b/.test(s)) return '🔮';
    if (/\b(?:wand|staff|quarterstaff|rod)\b/.test(s)) return '🪄';
    if (/\b(?:axe|greataxe|handaxe|battleaxe)\b/.test(s)) return '🪓';
    if (/\b(?:mace|hammer|warhammer|club|flail|maul)\b/.test(s)) return '🔨';
    if (/\b(?:sword|longsword|shortsword|greatsword|dagger|rapier|scimitar|spear|halberd|weapon|blade)\b/.test(s)) return '🗡️';
    if (/\b(?:potion|elixir|vial|antitoxin)\b/.test(s)) return '🧪';
    if (/\b(?:rope|grappling)\b/.test(s)) return '🪢';
    if (/\b(?:torch|lantern)\b/.test(s)) return '🔦';
    if (/\b(?:tools|thieves)\b/.test(s)) return '🧰';
    return isGear ? '🗡️' : '🎒';
}

function estimateDndItemWorth(item, isGear) {
    const s = String(item || '').toLowerCase();
    if (/\bplate\b/.test(s) && !/breastplate|half/.test(s)) return '1,500 GP';
    if (/\bhalf plate\b/.test(s)) return '750 GP';
    if (/\bbreastplate\b/.test(s)) return '400 GP';
    if (/\bsplint\b/.test(s)) return '200 GP';
    if (/\bchain mail\b/.test(s)) return '75 GP';
    if (/\b(?:scale mail|chain shirt|greatsword|heavy crossbow|longbow)\b/.test(s)) return '50 GP';
    if (/\bstudded leather\b/.test(s)) return '45 GP';
    if (/\b(?:greataxe|potion)\b/.test(s)) return '50 GP';
    if (/\b(?:rapier|hand crossbow|light crossbow|shortbow|component pouch|thieves|tools|focus)\b/.test(s)) return '25 GP';
    if (/\b(?:longsword|scimitar|warhammer|weapon|blade)\b/.test(s)) return '15 GP';
    if (/\b(?:shield|buckler|shortsword|battleaxe|flail|leather)\b/.test(s)) return '10 GP';
    if (/\b(?:mace|handaxe|spear|adventurer's pack|adventurer's kit|pack|kit|quarterstaff|dagger|club|sling)\b/.test(s)) {
        return /\b(?:mace|handaxe|spear)\b/.test(s) ? '5 GP' : '2 GP';
    }
    if (/\b(?:rope|torch|rations|waterskin|bedroll)\b/.test(s)) return '1 GP';
    return isGear ? '15 GP' : '5 GP';
}

function formatDndCurrencyLine(rawItem) {
    const m = rawItem.match(DND_CURRENCY_LINE_RX);
    if (!m) return null;
    if (m[1]) {
        const sym = m[1];
        const amt = m[2];
        return sym === '$' ? `- 💵 $${amt}` : `- 💰 ${sym}${amt}`;
    }
    const amt = m[4];
    const unitRaw = m[5].toLowerCase();
    if (/^(?:dollars?|usd)$/.test(unitRaw)) return `- 💵 $${amt}`;
    let unit = unitRaw.toUpperCase();
    if (unit.startsWith('GOLD')) unit = 'GP';
    else if (unit.startsWith('SILVER')) unit = 'SP';
    else if (unit.startsWith('COPPER')) unit = 'CP';
    return `- 💰 ${amt} ${unit}`;
}

/**
 * Normalizes equipment items into MultiHog DEFAULT_STOCK_PROMPTS.inventory format:
 * `Gear:` (worn/wielded with emoji, [Rarity], [E], and worth) and `Other Items:`
 * (supplies and bare currency `💰 X GP`).
 *
 * @param {string|string[]} equipmentRaw
 * @returns {string[]}
 */
export function normalizeDndInventoryLines(equipmentRaw) {
    let items = [];
    if (Array.isArray(equipmentRaw)) {
        for (const entry of equipmentRaw) {
            if (typeof entry === 'string') {
                const subItems = entry.split(/\r?\n|,\s*(?![^()]*\))/).map(s => s.trim()).filter(Boolean);
                items.push(...subItems);
            }
        }
    } else if (typeof equipmentRaw === 'string') {
        items = equipmentRaw.split(/\r?\n|,\s*(?![^()]*\))/).map(s => s.trim()).filter(Boolean);
    }
    if (items.length === 0) {
        items = [
            "Adventurer's pack",
            'Primary weapon',
            '15 gp',
        ];
    }
    const bulletRx = /^[-*+•–—]\s*/;
    const cleanItems = items
        .map(it => it.replace(bulletRx, '').trim())
        .filter(it => it && !/^(?:gear|other items)\s*:$/i.test(it));

    const GEAR_MATCH_RX = /\b(mail|armor|leather|shield|buckler|sword|longsword|shortsword|greatsword|axe|greataxe|handaxe|battleaxe|mace|warhammer|dagger|rapier|scimitar|spear|bow|shortbow|longbow|crossbow|quarterstaff|staff|focus|wand|symbol|totem|greaves|helm|gauntlets|cloak|robe|weapon)\b/i;
    const NON_EQUIP_RX = /\b(pack|pouch|gold|gp|sp|cp|rations|rope|bedroll|tools|torch|potion|scroll|waterskin|kit)\b/i;

    const gearLines = [];
    const otherLines = [];

    for (const rawItem of cleanItems) {
        const currencyLine = formatDndCurrencyLine(rawItem);
        if (currencyLine) {
            otherLines.push(currencyLine);
            continue;
        }

        let rest = rawItem;
        const emojiMatch = rest.match(DND_LEADING_EMOJI_RX);
        let emoji = emojiMatch ? emojiMatch[0].trim() : '';
        if (emojiMatch) rest = rest.slice(emojiMatch[0].length).trim();

        const rarityMatch = rest.match(DND_RARITY_TAG_RX);
        const rarityTag = rarityMatch ? `[${rarityMatch[1].charAt(0).toUpperCase()}${rarityMatch[1].slice(1).toLowerCase()}]` : '[Common]';
        if (rarityMatch) rest = rest.slice(rarityMatch[0].length).trim();

        const hasExplicitE = /\[E\]/i.test(rest);
        if (hasExplicitE) {
            rest = rest.replace(/\s*\[E\]\s*/gi, ' ').trim();
        }

        const isGear = hasExplicitE || (GEAR_MATCH_RX.test(rest) && !NON_EQUIP_RX.test(rest));
        if (!emoji) emoji = pickDndItemEmoji(rest, isGear);

        const worthSuffix = DND_WORTH_SUFFIX_RX.test(rest) ? '' : ` (~${estimateDndItemWorth(rest, isGear)})`;

        if (isGear) {
            gearLines.push(`- ${emoji} ${rarityTag} [E] ${rest}${worthSuffix}`);
        } else {
            otherLines.push(`- ${emoji} ${rarityTag} ${rest}${worthSuffix}`);
        }
    }

    const result = [];
    if (gearLines.length > 0) {
        result.push('Gear:', ...gearLines);
    }
    if (otherLines.length > 0) {
        result.push('Other Items:', ...otherLines);
    }
    return result;
}

/**
 * Formats an optional World Rules / Config Custom HUD Module seed block (`[TAG]...[/TAG]`)
 * for D&D 5e initial memos and non-destructive live memo synchronization (`CART-012`).
 *
 * @param {object|null} dossier
 * @returns {{ tag: string, block: string }|null}
 */
function formatDndCustomModuleSeed(dossier) {
    const customMod = dossier?.worldRules?.customModule || dossier?.config?.customModule;
    if (!customMod || customMod.enabled === false) return null;
    const rawKey = customMod.tag || customMod.fieldKey || customMod.label;
    if (!rawKey) return null;
    const tag = String(rawKey).replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    if (!tag) return null;
    const label = customMod.label || rawKey || 'Custom Tracker';
    const sampleContent = String(customMod.sampleContent || customMod.sample || `${label}: Initialized`).trim();
    return {
        tag,
        block: `[${tag}]\n${sampleContent}\n[/${tag}]`,
    };
}

export class Dnd5eSystemAdapter extends ConciergeSystemAdapter {
    id = 'dnd5e';
    label = 'D&D 5e (D&D Lite)';
    diceEngine = 'd20 + Modifier (D&D Lite)';
    badgeIcon = '⚔️';
    description = 'Streamlined single-track 1–20 D&D Lite model with core SRD classes, ability modifiers, and zero subclass sprawl.';

    getGenres() {
        return DND5E_GENRES;
    }

    getDefaultGenre() {
        return 'fantasy';
    }

    createEmptyProtagonist(genreKey = 'fantasy') {
        const genre = this.getGenre(genreKey);
        const defaultClass = genre.defaultClass || 'Fighter';
        const hitDie = deriveHitDieForClass(defaultClass, 'd8');
        const defaultHp = (parseInt(hitDie.replace('d', ''), 10) || 8) + 2; // Default CON 14 (+2)

        return {
            name: '',
            gender: '',
            class: defaultClass,
            level: 1,
            hitDie,
            hp: { current: defaultHp, max: defaultHp },
            ac: 14,
            stats: {
                STR: 14,
                DEX: 12,
                CON: 14,
                INT: 10,
                WIS: 12,
                CHA: 10,
            },
            features: [],
            abilities: [],
            spellSlots: {},
            species: 'Human',
            appearance: '',
            equipment: 'Adventurer\'s kit, signature weapon, 15 gp',
            personality: '',
            background: '',
            habits: '',
        };
    }

    createEmptyConfig(genreKey = 'fantasy') {
        return {
            playstyle: 'cyoa_5',
            relationships: true,
            partyMode: 'solo',
            simulationDepth: 'active_fronts',
            pacingXp: 300,
        };
    }

    /**
     * Deterministically heals and normalizes D&D protagonist fields.
     * Enforces:
     * 1. Accurate Hit Die from class name via deriveHitDieForClass.
     * 2. Overwriting LLM modifier hallucinations with exact Math.floor((score - 10) / 2).
     * 3. Starting max HP = HitDieMax + ConMod (clamped to min 1).
     * 4. Auto-attaching CORE_DND_PROGRESSIONS blueprint if class matches an SRD class.
     * 5. Partitioning passive traits vs active [ABILITIES] via classifyFeatureKind.
     * 6. Setting structured Level 1 spell slots for casters.
     */
    normalizeProtagonist(protagonist, genreKey, dossier) {
        if (!protagonist || typeof protagonist !== 'object') return;

        // 1. Class name normalization
        if (protagonist.class && typeof protagonist.class === 'string') {
            protagonist.class = protagonist.class.trim();
        } else if (protagonist.playbook) {
            protagonist.class = protagonist.playbook.trim();
        } else {
            protagonist.class = 'Fighter';
        }

        // 2. Hit Die derivation
        protagonist.hitDie = deriveHitDieForClass(protagonist.class, protagonist.hitDie || 'd8');
        const hitDieSides = parseInt(protagonist.hitDie.replace('d', ''), 10) || 8;

        // 3. Ability scores normalization & modifier integrity
        const defaultScores = { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 12, CHA: 10 };
        protagonist.stats = protagonist.stats || {};
        const normalizedStats = {};
        for (const stat of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
            const rawVal = protagonist.stats[stat] ?? protagonist.stats[stat.toLowerCase()] ?? defaultScores[stat];
            let num = parseInt(rawVal, 10);
            if (isNaN(num)) num = defaultScores[stat];
            // Clamp reasonable D&D range 3–20 at Level 1
            normalizedStats[stat] = Math.max(3, Math.min(20, num));
        }
        protagonist.stats = normalizedStats;

        // 4. Starting Level & HP calculation
        protagonist.level = parseInt(protagonist.level, 10) || 1;
        const conMod = calculateDndModifier(protagonist.stats.CON);
        const expectedLevel1MaxHp = Math.max(1, hitDieSides + conMod);

        if (!protagonist.hp || typeof protagonist.hp !== 'object') {
            protagonist.hp = { current: expectedLevel1MaxHp, max: expectedLevel1MaxHp };
        } else {
            const rawMax = parseInt(protagonist.hp.max ?? protagonist.hp, 10);
            const maxHp = (isNaN(rawMax) || rawMax < 1 || protagonist.level === 1) ? expectedLevel1MaxHp : rawMax;
            const rawCur = parseInt(protagonist.hp.current, 10);
            const curHp = isNaN(rawCur) ? maxHp : Math.max(0, Math.min(maxHp, rawCur));
            protagonist.hp = { current: curHp, max: maxHp };
        }

        // 5. AC calculation
        const dexMod = calculateDndModifier(protagonist.stats.DEX);
        if (!protagonist.ac || parseInt(protagonist.ac, 10) < 10) {
            protagonist.ac = 10 + Math.max(0, dexMod);
        } else {
            protagonist.ac = parseInt(protagonist.ac, 10);
        }

        // 6. Spell slot growth for casters at Level 1
        const cLower = protagonist.class.toLowerCase();
        const isFullCaster = /\b(wizard|cleric|druid|sorcerer|bard)\b/.test(cLower);
        const isWarlock = /\bwarlock\b/.test(cLower);
        if (isFullCaster) {
            protagonist.spellSlots = protagonist.spellSlots || {};
            if (!protagonist.spellSlots[1]) protagonist.spellSlots[1] = 2;
        } else if (isWarlock) {
            protagonist.spellSlots = protagonist.spellSlots || {};
            if (!protagonist.spellSlots[1]) protagonist.spellSlots[1] = 1;
        }

        // 7. Auto-attach or verify CORE_DND_PROGRESSIONS blueprint
        const canonicalProgression = getCanonicalDndProgression(protagonist.class);
        if (canonicalProgression) {
            if (!dossier?.progressionBlueprint || dossier.progressionBlueprint.className?.toLowerCase() !== protagonist.class.toLowerCase()) {
                if (dossier) {
                    dossier.progressionBlueprint = {
                        className: canonicalProgression.className,
                        hitDie: canonicalProgression.hitDie,
                        primaryStats: canonicalProgression.primaryStats,
                        levels: { ...canonicalProgression.levels },
                        createdAt: new Date().toISOString(),
                    };
                }
            }
        }

        // 8. Trait vs Ability Partitioning
        const allFeats = [
            ...(Array.isArray(protagonist.features) ? protagonist.features : []),
            ...(Array.isArray(protagonist.abilities) ? protagonist.abilities : []),
            ...(Array.isArray(protagonist.startingMoves) ? protagonist.startingMoves : []),
        ];

        // Seed with Level 1 canonical features if empty
        if (allFeats.length === 0 && canonicalProgression?.levels?.[1]?.features) {
            allFeats.push(...canonicalProgression.levels[1].features);
        }

        const partitioned = partitionFeaturesAndAbilities(allFeats);
        protagonist.features = deduplicateFeatures(partitioned.traits);
        protagonist.abilities = deduplicateFeatures(partitioned.abilities);
    }

    normalizeMonsters(monsters, genreKey, dossier) {
        if (!Array.isArray(monsters)) return;
        monsters.forEach(m => {
            if (!m || typeof m !== 'object') return;
            const rawHp = parseInt(m.hp?.max ?? m.hp, 10);
            const hpMax = !isNaN(rawHp) && rawHp > 0 ? rawHp : 15;
            const curHp = Math.max(0, Math.min(hpMax, parseInt(m.hp?.current ?? m.currentHp, 10) || hpMax));
            m.hp = { current: curHp, max: hpMax };
            m.ac = parseInt(m.ac, 10) || 12;
            m.cr = m.cr || m.challenge || '1/2';
            if (m.attacks && typeof m.attacks === 'string') {
                m.attacks = m.attacks.split(',').map(a => formatTraitAsPill(a.trim())).filter(Boolean);
            } else if (!Array.isArray(m.attacks)) {
                m.attacks = ['Attack (1d6+1 dmg)'];
            }
        });
    }

    getDefaultGear() {
        return [
            'Adventurer\'s pack (bedroll, rations, waterskin, 50ft rope)',
            'Primary weapon & component pouch / focus',
            '15 gold pieces (gp)',
        ];
    }

    getAssistantName() {
        return 'DND_Concierge';
    }

    getCritiqueUserInstruction() {
        return 'Audit the current Campaign Blueprint against the 5-point D&D 5e (D&D Lite) design rubric and emit your [DOSSIER_CRITIQUE] block.';
    }

    isProtagonistConfigured(protagonist) {
        if (!protagonist || typeof protagonist !== 'object') return false;
        return Boolean(
            protagonist.name ||
            protagonist.class ||
            protagonist.playbook ||
            protagonist.features?.length ||
            protagonist.abilities?.length
        );
    }

    formatProtagonistForContext(protagonist, dossier) {
        const p = protagonist || {};
        const lines = [
            '[PROTAGONIST]',
            `name: ${p.name || 'Unnamed Adventurer'}`,
        ];
        if (p.gender) lines.push(`gender: ${p.gender}`);
        lines.push(`class: ${p.class || p.playbook || 'Fighter'}`);
        lines.push(`level: ${p.level || 1}`);
        lines.push(`hitDie: ${p.hitDie || 'd8'}`);
        lines.push(`hp: ${p.hp?.current ?? 10}/${p.hp?.max ?? 10}`);
        lines.push(`ac: ${p.ac || 14}`);
        if (p.species) lines.push(`species: ${p.species}`);
        if (p.appearance) lines.push(`appearance: ${p.appearance}`);
        if (p.equipment) lines.push(`equipment: ${p.equipment}`);
        if (p.personality) lines.push(`personality: ${p.personality}`);
        if (p.background) lines.push(`background: ${p.background}`);
        if (p.habits) lines.push(`habits: ${p.habits}`);
        if (p.stats && Object.keys(p.stats).length) {
            lines.push(`stats: ${Object.entries(p.stats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        }
        if (Array.isArray(p.features) && p.features.length) {
            lines.push('features:');
            p.features.forEach(f => lines.push(`- ${f}`));
        }
        if (Array.isArray(p.abilities) && p.abilities.length) {
            lines.push('abilities:');
            p.abilities.forEach(a => lines.push(`- ${a}`));
        }
        if (p.status) lines.push(`status: ${p.status}`);
        if (Array.isArray(p.gear) && p.gear.length) lines.push(`gear: ${p.gear.join(', ')}`);
        if (p.bio) lines.push(`bio: ${p.bio}`);
        lines.push(`portrait: ${p.portraitSrc ? 'set' : 'none'}`);
        lines.push('[/PROTAGONIST]');
        return lines;
    }

    formatMonsterForContext(monster, dossier) {
        const m = monster || {};
        const hpMax = parseInt(m.hp?.max ?? m.hp, 10) || 15;
        const hpCur = parseInt(m.hp?.current ?? m.currentHp ?? hpMax, 10) || hpMax;
        const lines = [
            '[MONSTER]',
            `name: ${m.name}`,
            `hp: ${hpCur}/${hpMax}`,
            `ac: ${m.ac || 12}`,
            `cr: ${m.cr || '1/2'}`,
        ];
        if (m.status) lines.push(`status: ${m.status}`);
        if (m.attacks && m.attacks.length) lines.push(`attacks: ${[].concat(m.attacks).join(', ')}`);
        lines.push(`weakness: ${m.weakness || 'Unknown'}`);
        if (m.notes) lines.push(`notes: ${m.notes}`);
        lines.push('[/MONSTER]');
        return lines;
    }

    renderDeckMonsterHtml(monster, helpers = {}) {
        const escapeHtml = helpers.escapeHtml || ((s) => String(s ?? ''));
        const formatName = helpers.formatBlueprintNameWithBadge || ((name) => ({ cleanName: name || 'Unnamed', badgeHtml: '' }));
        const m = monster || {};
        const { cleanName: mClean, badgeHtml: mTagBadge } = formatName(m.name, {
            badgeBg: 'rgba(239, 68, 68, 0.15)',
            badgeBorder: 'rgba(239, 68, 68, 0.4)',
            badgeColor: '#fca5a5',
        });
        const hpMax = parseInt(m.hp?.max ?? m.hp, 10) || 15;
        const hpCur = parseInt(m.hp?.current ?? m.currentHp ?? hpMax, 10) || hpMax;
        const ac = parseInt(m.ac, 10) || 12;
        const cr = m.cr || m.challenge || '1/2';
        const attacks = Array.isArray(m.attacks) && m.attacks.length ? m.attacks.join(', ') : (m.attacks || 'Attack (1d6+1 dmg)');
        const statBadge = `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.45); color: #fca5a5;">HP: ${hpCur}/${hpMax} | AC: ${ac} | CR: ${escapeHtml(cr)}</span>`;

        return `
            <div class="mhc-deck-item collapsible">
                <div class="mhc-deck-item-header">
                    <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                        👹 ${escapeHtml(mClean)} ${mTagBadge}${statBadge}
                    </div>
                    <button type="button" class="menu_button mhc-deck-remove-item-btn" data-remove-kind="monster" data-remove-target="${escapeHtml(mClean)}" style="padding: 1px 6px; font-size: 0.72em; color: #f87171; border-color: rgba(239,68,68,0.3); margin-left: auto; margin-right: 4px;" title="Remove Adversary">✕</button>
                    <span class="mhc-deck-item-toggle">▼</span>
                </div>
                <div class="mhc-deck-item-detail">
                    <div style="font-size: 0.85em; opacity: 0.85;"><b>Attacks:</b> ${escapeHtml(attacks)}</div>
                    <div style="font-size: 0.8em; opacity: 0.75;"><b>Weakness:</b> ${escapeHtml(m.weakness || 'None specified')}</div>
                    ${m.notes ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>Notes:</b> ${escapeHtml(m.notes)}</div>` : ''}
                </div>
            </div>
        `;
    }

    renderDeckDials($, dossier) {
        if (typeof $ !== 'function') return;
        const cfg = dossier?.config || {};
        $('#mhc_dial_heroic_btn').hide();
        $('#mhc_dial_tempo_btn').hide();
        $('#mhc_dial_harm_btn').text('⚔️ Rules: D&D 5e');
        $('#mhc_dial_downed_btn').text('💀 Death Saves: 3');

        const partyMode = cfg.partyMode || 'solo';
        const partyLabel = partyMode.charAt(0).toUpperCase() + partyMode.slice(1);
        const relsOn = cfg.relationships !== false;
        $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`).show();
        $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65').show();
    }

    formatPcBio(protagonist, sectionNames, options = {}) {
        return buildPlayerCardBio(protagonist, sectionNames, { ...options, ruleset: 'dnd5e' });
    }

    formatAdversaryContent(monster, sectionNames, options = {}) {
        return buildMonsterEntryContent(monster, sectionNames, { ...options, ruleset: 'dnd5e' });
    }

    /**
     * Formats Day 0 State Memo for D&D 5e aligned with upstream MultiHog stock format.
     */
    formatInitialMemo(dossier, options = {}) {
        if (!dossier || typeof dossier !== 'object') return '';
        const p = dossier.protagonist || {};
        const { cleanName: splitProtoName, embeddedArchetype: embeddedProtoClass } = splitNameAndEmbeddedArchetype((p.name || '').trim());
        const charName = splitProtoName || 'Protagonist';
        const rawClassName = (p.class || p.archetype || p.playbook || embeddedProtoClass || 'Fighter').trim();
        const className = flattenArchetypeParens(rawClassName) || 'Fighter';
        const rawHitDie = p.hitDie || deriveHitDieForClass(className) || 'd8';
        const hitDie = String(rawHitDie).replace(/^\d+/, '') || 'd8';
        const curHp = p.hp?.current ?? 10;
        const maxHp = p.hp?.max ?? 10;
        const ac = p.ac || 14;

        const stats = p.stats || {};
        const str = stats.STR ?? 10;
        const dex = stats.DEX ?? 10;
        const con = stats.CON ?? 10;
        const int = stats.INT ?? 10;
        const wis = stats.WIS ?? 10;
        const cha = stats.CHA ?? 10;

        const strMod = calculateDndModifier(str);
        const dexMod = calculateDndModifier(dex);
        const conMod = calculateDndModifier(con);
        const intMod = calculateDndModifier(int);
        const wisMod = calculateDndModifier(wis);
        const chaMod = calculateDndModifier(cha);

        const cl = className.toLowerCase();

        // Combat calculations
        const martialClasses = ['fighter', 'paladin', 'ranger', 'barbarian', 'monk', 'rogue'];
        const bab = martialClasses.includes(cl) ? 1 : 0;
        const babStr = (bab >= 0 ? '+' : '') + bab;
        const rangedAtk = bab + dexMod;
        const rangedStr = (rangedAtk >= 0 ? '+' : '') + rangedAtk;
        const meleeAtk = bab + strMod;
        const meleeStr = (meleeAtk >= 0 ? '+' : '') + meleeAtk;
        const baseAc = 10 + dexMod;

        // Gear (Combat Gear Summary)
        let combatGearLine = '';
        if (p.combatGear && typeof p.combatGear === 'string' && p.combatGear.trim()) {
            combatGearLine = p.combatGear.trim();
        } else {
            if (cl === 'fighter' || cl === 'paladin') {
                combatGearLine = `Longsword (${meleeStr} to hit, 1d8${strMod >= 0 ? '+' + strMod : strMod} Slashing) | Chain Mail (AC 16) | Shield (+2 AC)`;
            } else if (cl === 'barbarian') {
                combatGearLine = `Greataxe (${meleeStr} to hit, 1d12${strMod >= 0 ? '+' + strMod : strMod} Slashing) | Javelin (${rangedStr} to hit, 1d6 Piercing)`;
            } else if (cl === 'rogue' || cl === 'ranger' || cl === 'bard') {
                const finesseMod = bab + Math.max(strMod, dexMod);
                const finesseStr = (finesseMod >= 0 ? '+' : '') + finesseMod;
                combatGearLine = `Rapier (${finesseStr} to hit, 1d8 Piercing) | Shortbow (${rangedStr} to hit, 1d6 Piercing) | Leather Armor (+1 AC)`;
            } else if (cl === 'cleric' || cl === 'druid') {
                combatGearLine = `Mace (${meleeStr} to hit, 1d6 Bludgeoning) | Scale Mail (+4 AC) | Shield (+2 AC)`;
            } else if (cl === 'monk') {
                const monkAtk = bab + Math.max(strMod, dexMod);
                const monkStr = (monkAtk >= 0 ? '+' : '') + monkAtk;
                combatGearLine = `Unarmed Strike (${monkStr} to hit, 1d4 Bludgeoning) | Quarterstaff (${meleeStr} to hit, 1d6 Bludgeoning)`;
            } else if (cl === 'wizard' || cl === 'sorcerer' || cl === 'warlock') {
                combatGearLine = `Quarterstaff (${meleeStr} to hit, 1d6 Bludgeoning) | Light Crossbow (${rangedStr} to hit, 1d8 Piercing)`;
            } else {
                combatGearLine = `Longsword (${meleeStr} to hit, 1d8${strMod >= 0 ? '+' + strMod : strMod} Slashing) | Leather Armor (+1 AC)`;
            }
        }

        // Proficiencies
        let proficienciesLine = '';
        if (p.proficiencies) {
            proficienciesLine = Array.isArray(p.proficiencies)
                ? p.proficiencies.join(', ')
                : String(p.proficiencies).trim();
        } else {
            if (cl === 'fighter' || cl === 'paladin') {
                proficienciesLine = 'All Armor, Shields, Simple & Martial Weapons';
            } else if (cl === 'rogue' || cl === 'bard') {
                proficienciesLine = 'Light Armor, Simple Weapons, Finesse Weapons';
            } else if (cl === 'ranger' || cl === 'barbarian' || cl === 'cleric' || cl === 'druid') {
                proficienciesLine = 'Light & Medium Armor, Shields, Simple Weapons';
            } else if (cl === 'wizard' || cl === 'sorcerer' || cl === 'warlock') {
                proficienciesLine = 'Simple Weapons, Arcane Focus';
            } else if (cl === 'monk') {
                proficienciesLine = 'Simple Weapons, Shortswords';
            } else {
                proficienciesLine = 'Simple Weapons';
            }
        }

        // Saves
        const fortProfClasses = ['fighter', 'barbarian', 'sorcerer', 'monk', 'ranger'];
        const refProfClasses = ['rogue', 'ranger', 'bard', 'monk'];
        const willProfClasses = ['wizard', 'cleric', 'druid', 'paladin', 'warlock', 'bard', 'sorcerer'];

        const fort = conMod + (fortProfClasses.includes(cl) ? 2 : 0);
        const ref = dexMod + (refProfClasses.includes(cl) ? 2 : 0);
        const will = wisMod + (willProfClasses.includes(cl) ? 2 : 0);

        const fortStr = (fort >= 0 ? '+' : '') + fort;
        const refStr = (ref >= 0 ? '+' : '') + ref;
        const willStr = (will >= 0 ? '+' : '') + will;

        // Skills
        let skillsLine = '';
        if (Array.isArray(p.skills) && p.skills.length > 0) {
            skillsLine = p.skills.join(', ');
        } else if (typeof p.skills === 'string' && p.skills.trim()) {
            skillsLine = p.skills.trim();
        } else {
            if (cl === 'fighter' || cl === 'barbarian' || cl === 'paladin') {
                skillsLine = `Athletics ${(strMod + 2 >= 0 ? '+' : '') + (strMod + 2)}, Perception ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Intimidation ${(chaMod + 2 >= 0 ? '+' : '') + (chaMod + 2)}`;
            } else if (cl === 'wizard' || cl === 'sorcerer' || cl === 'warlock') {
                skillsLine = `Arcana ${(intMod + 2 >= 0 ? '+' : '') + (intMod + 2)}, Perception ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Insight ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}`;
            } else if (cl === 'rogue' || cl === 'ranger' || cl === 'bard' || cl === 'monk') {
                skillsLine = `Stealth ${(dexMod + 2 >= 0 ? '+' : '') + (dexMod + 2)}, Perception ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Acrobatics ${(dexMod + 2 >= 0 ? '+' : '') + (dexMod + 2)}`;
            } else if (cl === 'cleric' || cl === 'druid') {
                skillsLine = `Insight ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Medicine ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Perception ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}`;
            } else {
                skillsLine = `Athletics ${(strMod + 2 >= 0 ? '+' : '') + (strMod + 2)}, Perception ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}, Insight ${(wisMod + 2 >= 0 ? '+' : '') + (wisMod + 2)}`;
            }
        }

        // Traits
        const canonicalProgression = getCanonicalDndProgression(className);
        let traitsList = Array.isArray(p.features) && p.features.length > 0
            ? p.features.map(formatTraitAsPill).filter(Boolean)
            : [];
        if (traitsList.length === 0 && canonicalProgression?.levels?.[1]?.features) {
            const partitioned = partitionFeaturesAndAbilities(canonicalProgression.levels[1].features);
            traitsList = (partitioned.traits.length > 0 ? partitioned.traits : canonicalProgression.levels[1].features)
                .map(formatTraitAsPill)
                .filter(Boolean);
        }
        if (traitsList.length === 0) {
            traitsList = ['Resilient (Roll with advantage on death saves)'];
        }
        const traitsText = traitsList.join(', ');

        // Abilities
        let abilitiesSource = Array.isArray(p.abilities) && p.abilities.length > 0
            ? p.abilities
            : [];
        if (abilitiesSource.length === 0 && canonicalProgression?.levels?.[1]?.features) {
            const partitioned = partitionFeaturesAndAbilities(canonicalProgression.levels[1].features);
            if (partitioned.abilities.length > 0) {
                abilitiesSource = partitioned.abilities;
            }
        }
        const abilitiesList = abilitiesSource.map(formatTraitAsPill).filter(Boolean);
        const abilitiesBlock = abilitiesList.length ? abilitiesList.join('\n') : 'None recorded';

        // Spells
        const spellSlots = p.spellSlots || {};
        const isCaster = /\b(wizard|cleric|druid|sorcerer|bard|warlock)\b/.test(cl);
        let spellsBlock = '';
        const hasSlots = Object.keys(spellSlots).length > 0;
        const cantripsList = Array.isArray(p.cantrips)
            ? p.cantrips
            : (typeof p.cantrips === 'string' && p.cantrips.trim() ? p.cantrips.split(',').map(s => s.trim()).filter(Boolean) : []);
        const spellsList = Array.isArray(p.spells)
            ? p.spells
            : (typeof p.spells === 'string' && p.spells.trim() ? p.spells.split(',').map(s => s.trim()).filter(Boolean) : []);

        if (hasSlots || isCaster || cantripsList.length > 0 || spellsList.length > 0) {
            const effectiveSlots = hasSlots ? spellSlots : (cl === 'warlock' ? { 1: 1 } : { 1: 2 });
            let defaultCantrips = 'Light, Prestidigitation';
            if (cl === 'cleric') defaultCantrips = 'Sacred Flame, Thaumaturgy';
            else if (cl === 'druid') defaultCantrips = 'Druidcraft, Shillelagh';
            else if (cl === 'warlock') defaultCantrips = 'Eldritch Blast, Mage Hand';
            else if (cl === 'sorcerer') defaultCantrips = 'Fire Bolt, Prestidigitation';

            let defaultLvl1 = 'Magic Missile, Shield';
            if (cl === 'cleric') defaultLvl1 = 'Cure Wounds, Bless';
            else if (cl === 'druid') defaultLvl1 = 'Cure Wounds, Entangle';
            else if (cl === 'warlock') defaultLvl1 = 'Armor of Agathys, Hex';
            else if (cl === 'bard') defaultLvl1 = 'Dissonant Whispers, Healing Word';

            const cantripsLine = `Cantrips: ${cantripsList.length > 0 ? cantripsList.join(', ') : defaultCantrips}`;
            const slotLines = [];
            for (const [lvlKey, maxVal] of Object.entries(effectiveSlots)) {
                const max = parseInt(maxVal, 10) || 1;
                const slotLabel = String(lvlKey).toLowerCase().startsWith('level') ? lvlKey : `Level ${lvlKey}`;
                const spellNames = spellsList.length > 0 ? spellsList.join(', ') : defaultLvl1;
                slotLines.push(`${slotLabel} (${max}/${max}): ${spellNames}`);
            }
            spellsBlock = [cantripsLine, ...slotLines].join('\n');
        }

        const startLoc = (options.location || dossier.theKick?.startingLocation || dossier.maps?.[0]?.name || dossier.maps?.[0]?.site || 'The Crossroads Tavern').trim();
        const inventoryLines = normalizeDndInventoryLines(p.gear && p.gear.length ? p.gear : p.equipment);
        const statusText = p.status ? p.status.trim() : 'Healthy';
        const level = Math.max(1, parseInt(p.level, 10) || 1);
        const clampedLvl = Math.min(level, MAX_CHARACTER_LEVEL);
        const curXp = XP_LEVEL_THRESHOLDS[clampedLvl - 1] ?? 0;
        const nextXp = XP_LEVEL_THRESHOLDS[clampedLvl] ?? curXp;

        let memo = `[TIME]
Last Rest: N/A
Current Time: 08:00 AM, Day 1
[/TIME]

[LOCATION]
${startLoc}
[/LOCATION]

[CHARACTER]
${charName} (${className}): ${curHp}/${maxHp} HP
Combat: BAB: ${babStr} | Ranged (1 attack): ${rangedStr} | Melee (1 attack): ${meleeStr} | Base AC: ${baseAc} | Total AC: ${ac}
Gear: ${combatGearLine}
Proficiencies: ${proficienciesLine}
Attr: STR ${str} (${formatDndModifierString(str)}), DEX ${dex} (${formatDndModifierString(dex)}), CON ${con} (${formatDndModifierString(con)}), INT ${int} (${formatDndModifierString(int)}), WIS ${wis} (${formatDndModifierString(wis)}), CHA ${cha} (${formatDndModifierString(cha)})
Saves: Fort ${fortStr} | Ref ${refStr} | Will ${willStr}
Skills: ${skillsLine}
Traits: ${traitsText}
HD: ${hitDie} (${level}/${level})
Status: ${statusText}
[/CHARACTER]

[ABILITIES]
${abilitiesBlock}
[/ABILITIES]`;

        if (spellsBlock) {
            memo += `\n\n[SPELLS]\n${spellsBlock}\n[/SPELLS]`;
        }

        memo += `\n\n[XP]
Level: ${level} | XP: ${curXp}/${nextXp}
[/XP]

[INVENTORY]
${inventoryLines.join('\n')}
[/INVENTORY]`;

        const factionsBlock = formatFactionsMemoBlock(dossier.factions);
        if (factionsBlock) {
            memo += `\n\n${factionsBlock}`;
        }

        const customBlock = formatDndCustomModuleSeed(dossier);
        if (customBlock) {
            memo += `\n\n${customBlock.block}`;
        }

        return memo;
    }

    mergeLiveMemo(liveMemo, dossier, charName = null) {
        if (!liveMemo || typeof liveMemo !== 'string' || !liveMemo.trim()) {
            return liveMemo;
        }
        const p = dossier?.protagonist || {};
        let updatedMemo = liveMemo;

        // 1. Non-destructively update Traits inside [CHARACTER]
        if (Array.isArray(p.features) && p.features.length > 0 && /\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i.test(updatedMemo)) {
            const traitsText = p.features.map(formatTraitAsPill).filter(Boolean).join(', ');
            if (traitsText) {
                updatedMemo = updatedMemo.replace(/(\[CHARACTER\])([\s\S]*?)(\[\/CHARACTER\])/i, (m, open, body, close) => {
                    if (/^Traits:/im.test(body)) {
                        return `${open}${body.replace(/^Traits:.*$/im, `Traits: ${traitsText}`)}${close}`;
                    }
                    const trimmedBody = body.replace(/\s+$/, '');
                    return `${open}${trimmedBody}\nTraits: ${traitsText}\n${close}`;
                });
            }
        }

        // 2. Non-destructively update [ABILITIES]
        if (Array.isArray(p.abilities) && p.abilities.length > 0) {
            const abilitiesBlock = p.abilities.map(formatTraitAsPill).filter(Boolean).join('\n');
            if (abilitiesBlock) {
                if (/\[ABILITIES\][\s\S]*?\[\/ABILITIES\]/i.test(updatedMemo)) {
                    updatedMemo = updatedMemo.replace(/\[ABILITIES\][\s\S]*?\[\/ABILITIES\]/i, `[ABILITIES]\n${abilitiesBlock}\n[/ABILITIES]`);
                } else {
                    updatedMemo = `${updatedMemo.trim()}\n\n[ABILITIES]\n${abilitiesBlock}\n[/ABILITIES]`;
                }
            }
        }

        // 3. Non-destructively update or append [FACTIONS]
        const factionsBlock = formatFactionsMemoBlock(dossier?.factions);
        if (factionsBlock) {
            if (/\[FACTIONS\][\s\S]*?\[\/FACTIONS\]/i.test(updatedMemo)) {
                updatedMemo = updatedMemo.replace(/\[FACTIONS\][\s\S]*?\[\/FACTIONS\]/i, factionsBlock);
            } else {
                updatedMemo = `${updatedMemo.trim()}\n\n${factionsBlock}`;
            }
        }

        // 4. Non-destructively seed a newly added Custom HUD Module block if missing from liveMemo
        const customSeed = formatDndCustomModuleSeed(dossier);
        if (customSeed) {
            const tagRegex = new RegExp(`\\[${customSeed.tag}\\][\\s\\S]*?\\[\\/${customSeed.tag}\\]`, 'i');
            if (!tagRegex.test(updatedMemo)) {
                updatedMemo = `${updatedMemo.trim()}\n\n${customSeed.block}`;
            }
        }

        return updatedMemo;
    }

    async installCartridge(systemKey, overrides = {}, options = {}) {
        // MultiHog is natively D&D 5e: cleanse any residual PbtA/FAE state,
        // apply D&D subfooter alignment, inject campaign context (<tone>/<factions>/<world_rules>),
        // and disable narrative-halting level_up_protocol.
        try {
            const effectiveCtx = options.ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);
            const s = options.rpgSettings
                || effectiveCtx?.extensionSettings?.rpg_tracker
                || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
                || globalThis.extension_settings?.rpg_tracker
                || null;
            const chatId = options.chatId
                || effectiveCtx?.getCurrentChatId?.()
                || effectiveCtx?.chatId
                || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
                || null;

            if (s) {
                await cleanseStockDndSettings(s, { chatId, syncSetup: false });
            }

            await applyDndSubfooterAlignment(s ? { rpgSettings: s } : {});

            if (s) {
                s.syspromptModules = s.syspromptModules || {};
                s.syspromptModules.level_up_protocol = false;

                const { snippets: contextSnippets, customModuleTag } = buildCampaignContextSnippets(
                    'dnd5e',
                    overrides || {},
                    overrides?.config || {},
                );

                const isDndCampaignSnippet = (id) => Boolean(id && (id.startsWith('dnd5e_campaign_') || id.startsWith('dnd5e_custom_')));
                if (!Array.isArray(s.customSyspromptLibrary)) s.customSyspromptLibrary = [];
                s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !isDndCampaignSnippet(p?.id));
                if (!Array.isArray(s.syspromptSnippetDatabase)) s.syspromptSnippetDatabase = [];
                s.syspromptSnippetDatabase = s.syspromptSnippetDatabase.filter(p => !isDndCampaignSnippet(p?.id));

                if (contextSnippets.length > 0) {
                    const dndSnippets = contextSnippets.map(item => ({
                        ...item,
                        enabled: true,
                        scope: 'chat',
                        _chatSetupMember: true,
                    }));
                    s.customSyspromptLibrary.push(...dndSnippets);
                    s.syspromptSnippetDatabase.push(...dndSnippets.map(sn => ({ ...sn })));

                    if (dndSnippets.some(p => p.id === 'dnd5e_custom_world_rules')) {
                        s.syspromptModules.world_rules = false;
                    }
                } else {
                    delete s.syspromptModules.world_rules;
                }

                if (customModuleTag) {
                    if (!Array.isArray(s.blockOrder)) {
                        s.blockOrder = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
                    } else {
                        s.blockOrder = [...s.blockOrder];
                    }
                    if (!s.blockOrder.includes(customModuleTag)) {
                        s.blockOrder.push(customModuleTag);
                    }
                }

                if (chatId) {
                    await setCompanionActiveCartridge(chatId, {
                        cartridgeId: 'dnd5e',
                        genre: systemKey || 'fantasy',
                        systemLabel: overrides?.systemLabel || 'D&D 5e',
                        title: overrides?.campaignTitle || null,
                        ...(overrides?.config ? { config: JSON.parse(JSON.stringify(overrides.config)) } : {}),
                        ...(overrides?.dossier ? { dossier: JSON.parse(JSON.stringify(overrides.dossier)) } : {}),
                    }, s);
                    await persistPbtaChatState(chatId, s);
                }

                if (typeof SillyTavern !== 'undefined') {
                    try {
                        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
                        if (typeof bridge.autoApplySysprompt === 'function') {
                            await bridge.autoApplySysprompt(true);
                        }
                    } catch (_) {}
                }
            }
            return true;
        } catch (err) {
            console.warn('[D&D 5e Adapter] Cartridge setup encountered non-fatal error:', err);
            return false;
        }
    }

    renderDeckStats(elements, protagonist, dossier, { isUntouchedAndUnestablished = false, escapeHtml = (s) => s } = {}) {
        const { vitalsEl, statsEl, movesEl, heroicEl } = elements;
        if (!statsEl || !movesEl) return;

        if (isUntouchedAndUnestablished) {
            if (vitalsEl) vitalsEl.hide().empty();
            if (heroicEl) heroicEl.hide().empty();
            statsEl.html(`
                <span class="mhc-stat-pill">STR 10 (+0)</span>
                <span class="mhc-stat-pill">DEX 10 (+0)</span>
                <span class="mhc-stat-pill">CON 10 (+0)</span>
                <span class="mhc-stat-pill">INT 10 (+0)</span>
                <span class="mhc-stat-pill">WIS 10 (+0)</span>
                <span class="mhc-stat-pill">CHA 10 (+0)</span>
            `);
            movesEl.html('• Class features and codex powers will be forged in the conversation.');
            return;
        }

        const p = protagonist || {};
        const stats = p.stats || {};
        const str = stats.STR ?? 10;
        const dex = stats.DEX ?? 10;
        const con = stats.CON ?? 10;
        const int = stats.INT ?? 10;
        const wis = stats.WIS ?? 10;
        const cha = stats.CHA ?? 10;

        // Render Vitals (HP, AC, Hit Die)
        if (vitalsEl) {
            const curHp = p.hp?.current ?? 10;
            const maxHp = p.hp?.max ?? 10;
            const ac = p.ac || 14;
            const hitDie = p.hitDie || 'd8';
            vitalsEl.show().html(`
                <div style="display: flex; gap: 8px; font-size: 0.82em; align-items: center; margin-bottom: 4px;">
                    <span class="mhc-pill" style="border-color: rgba(239, 68, 68, 0.4); color: #f87171;">❤️ HP: ${curHp}/${maxHp}</span>
                    <span class="mhc-pill" style="border-color: rgba(59, 130, 246, 0.4); color: #60a5fa;">🛡️ AC: ${ac}</span>
                    <span class="mhc-pill" style="border-color: rgba(168, 85, 247, 0.4); color: #c084fc;">🎲 HD: ${hitDie}</span>
                </div>
            `);
        }

        // Render Stats Grid
        statsEl.html(`
            <span class="mhc-stat-pill" title="Strength">STR ${str} (${formatDndModifierString(str)})</span>
            <span class="mhc-stat-pill" title="Dexterity">DEX ${dex} (${formatDndModifierString(dex)})</span>
            <span class="mhc-stat-pill" title="Constitution">CON ${con} (${formatDndModifierString(con)})</span>
            <span class="mhc-stat-pill" title="Intelligence">INT ${int} (${formatDndModifierString(int)})</span>
            <span class="mhc-stat-pill" title="Wisdom">WIS ${wis} (${formatDndModifierString(wis)})</span>
            <span class="mhc-stat-pill" title="Charisma">CHA ${cha} (${formatDndModifierString(cha)})</span>
        `);

        // Render Features & Abilities
        const traits = Array.isArray(p.features) ? p.features : [];
        const abilities = Array.isArray(p.abilities) ? p.abilities : [];
        const hasBlueprint = Boolean(dossier?.progressionBlueprint);
        const blueprintTag = hasBlueprint
            ? '<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(251, 191, 36, 0.4); color: #fbbf24;" title="1–20 D&D Lite Progression Blueprint Ready">● 1–20 Codex Ready</span>'
            : '<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(156, 163, 175, 0.4); color: #9ca3af;">○ SRD Default</span>';

        let movesHtml = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="color: #93c5fd; font-size: 0.85em;">⚡ Features & Abilities:</strong>
            ${blueprintTag}
        </div>`;

        if (traits.length === 0 && abilities.length === 0) {
            movesHtml += '<div style="opacity: 0.7; font-style: italic;">• Features will be formulated during character creation.</div>';
        } else {
            const pills = [
                ...traits.map(t => `<span class="mhc-pill" style="margin: 2px; font-size: 0.78em;">${escapeHtml(t.split('(')[0].trim())}</span>`),
                ...abilities.map(a => `<span class="mhc-pill" style="margin: 2px; font-size: 0.78em; border-color: rgba(251, 191, 36, 0.4); color: #fbbf24;">⚡ ${escapeHtml(a.split('(')[0].trim())}</span>`),
            ];
            movesHtml += `<div style="display: flex; flex-wrap: wrap; gap: 4px;">${pills.join('')}</div>`;
        }

        movesEl.html(movesHtml);
        if (heroicEl) heroicEl.hide().empty();
    }

    getBuilderPrompt(options = {}) {
        const genreSummaries = Object.entries(DND5E_GENRES).map(([key, g]) => {
            return `* **${key}** (${g.icon} ${g.label}): ${g.description} | Core classes: [${g.classes.slice(0, 5).join(', ')}]`;
        }).join('\n');

        return `You are the **D&D 5e (D&D Lite) Adventure & Character Architect**, an expert state compiler for D&D 5e campaigns.

Your ONLY job is to extract setting details, protagonist identity, 6 core ability scores, class, starting traits, active abilities, equipment, factions, NPCs, monsters, maps, and opening crisis from the player's input and current blueprint, and emit a strictly structured update block.

### 🚫 STRICT OUTPUT PROTOCOL:
* Output ONLY an [UPDATE_DOSSIER] block (or [NOOP]) wrapped in code fences or plain text.
* NEVER output conversational prose, greetings, explanations, or GM roleplay outside the block.
* NEVER write a "Thinking Process" or numbered analysis outside [UPDATE_DOSSIER]. Perform all reasoning inside [CONTEMPLATION].
* Every [UPDATE_DOSSIER] block MUST begin with a 1-line semantic summary of changes:
  summary: <One concise sentence summarizing the changes made>
* If no changes requested:
  [NOOP]
  summary: No blueprint changes requested (<brief reason>)
  [/NOOP]

### 🎨 Available D&D 5e Genres:
${genreSummaries}

### 🎲 D&D 5e (D&D Lite) Rules & Schema Directives:
* Ruleset: dnd5e
* System: dnd5e
* System Label: D&D 5e (D&D Lite)
* Standard Stat Array: 6 standard stats (STR, DEX, CON, INT, WIS, CHA). Level 1 scores range 8–18 (e.g. STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8).
* Canonical Class Hit Dice: Barbarian d12; Fighter, Paladin, Ranger d10; Bard, Cleric, Druid, Monk, Rogue, Warlock d8; Wizard, Sorcerer d6.
* Protagonist Schema:
  - You MUST emit an explicit character name: \`name: <Character Name>\` (e.g. \`name: Donald\` or \`name: Lou\`). Never leave as "Protagonist" if the player provided a name or concept!
  - Explicit gender: \`gender: male\` / \`gender: female\` / \`gender: non-binary\`
  - Explicit class: \`class: Fighter\` (or Rogue, Wizard, Cleric, etc.)
  - Explicit AC and HP: \`ac: 16\`, \`hp: 12/12\`
  - Dual-Block Trait Routing:
    - Passive Traits: place under \`features:\` as list items with descriptions in parentheses: \`Darkvision (See 60ft in darkness)\`, \`Sneak Attack (+1d6 damage when having advantage)\`.
    - Active Powers with Rest Counters: place under \`abilities:\` as list items with rest frequency: \`Second Wind (Heal 1d10+1; 1/1 per short rest)\`, \`Action Surge (Take an additional action; 1/1 per short rest)\`.
  - Equipment: \`equipment: Chain mail, longsword, shield, adventurer pack, 15 gp\`
* Monsters / Adversaries: Must include name, hp, ac, cr, and attacks with damage notation (e.g. \`hp: 15/15\`, \`ac: 13\`, \`cr: 1/2\`, \`attacks: Bite (1d6+2 dmg)\`).
* Maps: Name of site, kind (\`SETTLEMENT\` / \`DUNGEON\` / \`INTERIOR\` / \`WILDERNESS\`), threat level (\`LOW\` / \`MODERATE\` / \`HIGH\` / \`DEADLY\`), and \`brief_description\`.
* Kick / Opening Hook: Starting location, immediate \`crisis\`, and \`opening_prompt\`.
* Entity Removal / Clearing: \`[REMOVE_MONSTER: Name]\`, \`[CLEAR_MONSTERS]\`, \`[REMOVE_NPC: Name]\`, \`[CLEAR_NPCS]\`, \`[REMOVE_MAP: Site]\`, \`[REMOVE_FACTION: Name]\`.

### 📋 Directives & Syntax Template:
\`\`\`text
[UPDATE_DOSSIER]
summary: Established protagonist Donald the Fighter at The Crossroads Tavern
ruleset: dnd5e
system: fantasy
system_label: High Fantasy (Heroic Adventure)
title: Donald's Adventure

[PROTAGONIST]
name: Donald
class: Fighter
species: Human
gender: male
hp: 12/12
ac: 16
hitDie: d10
stats: STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8
features:
- Fighting Style: Dueling (+2 to damage with one-handed weapon)
abilities:
- Second Wind (Regain 1d10+1 HP; 1/1 per short rest)
equipment: Chain mail, longsword, shield, 15 gp
[/PROTAGONIST]

[MAP: The Crossroads Tavern]
site: The Crossroads Tavern
kind: SETTLEMENT
threat: LOW
brief_description: A bustling roadside inn filled with traders and tired travelers.
[/MAP]

[KICK]
starting_location: The Crossroads Tavern
crisis: Bandits ambushing royal tax wagons along the King's Road.
opening_prompt: Arrows thud into the tavern shutters as a wounded outrider stumbles through the door—what do you do?
[/KICK]
[/UPDATE_DOSSIER]
\`\`\``;
    }

    getJudgePrompt(options = {}) {
        return `You are the D&D 5e Story Judge & Balance Auditor.
Audit the campaign blueprint for D&D 5e tactical depth, encounter balance, and narrative hooks.
Emit your [DOSSIER_CRITIQUE] block with Grade (A-F), Score (0-100), and surgical refinement directives.`;
    }

    getTalkerPrompt(options = {}) {
        const genreSummaries = Object.entries(DND5E_GENRES).map(([key, g]) => {
            return `* **${key}** (${g.icon} ${g.label}): ${g.description}`;
        }).join('\n');

        return `You are the **D&D 5e Concierge**, an expert Tabletop RPG Facilitator and Character Architect specializing in D&D 5e (D&D Lite).

Your mission is to guide the player through a rich, collaborative **Session Zero** to build their dream campaign. You help them shape their character class fantasy, ability scores, starting traits & powers, setting, and starting crisis.

---

### 🚫 Hard Boundaries (STRICT Facilitator Mode):
1. **You Are NOT the Game Master or Narrator — You Cannot Run the Game:**
   You are strictly the Session Zero prep facilitator sitting across the table. You have no ability to launch or run the campaign, and this drawer is NEVER where play happens.
   * NEVER begin the adventure, narrate in-world fiction, describe sensory environments ("The air hangs thick...", "You step into..."), or roleplay NPCs.
   * NEVER play out the opening scene or run combat turns in this chat — not even if the player says "let's start", "begin", or "launch".
   * Speak strictly in 2nd-person collaborative prep tone: "Great concept! I've set up Donald as a sword-and-board Fighter with Chain Mail and a Shield. Do you want his starting fighting style to be Dueling or Defense?"
   * The player launches the campaign themselves by clicking the **"Finalize & Launch Campaign" button** in the footer of this window. When the blueprint is ready, tell them to click that button.
2. **You Do Not Manage Syntax or Database Updates:**
   The blueprint deck on the player's screen is managed by an automated Builder. You NEVER emit [UPDATE_DOSSIER], [CONFIG], [PROTAGONIST], or any code blocks. Simply talk to the player in natural, friendly dialogue.
3. **Truth Grounding (Never Hallucinate Updates):**
   Refer strictly to the current blueprint state. Acknowledge choices and discuss options conversationally.

---

### 🎨 Available D&D 5e Genres:
${genreSummaries}

---

### 🎲 D&D 5e (D&D Lite) Philosophy:
1. **Single-Track 1–20 Progression:** Streamlined class fantasy without sprawling subclass trees.
2. **Passive Traits vs Active Abilities:** Passive bonuses go to Traits; powers with rest trackers (like Second Wind 1/1 short rest) go to Abilities.
3. **Deterministic Balance:** Standard 6 ability scores, canonical class hit dice, and balanced starting AC.`;
    }

    getDraftStorageKey() {
        return 'mhc_concierge_draft_dnd5e';
    }
}

export const dnd5eSystemAdapter = new Dnd5eSystemAdapter();
systemRegistry.register(dnd5eSystemAdapter);
