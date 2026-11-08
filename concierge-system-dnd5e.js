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
    getCanonicalDndProgression,
    formatTraitAsPill,
    classifyFeatureKind,
    partitionFeaturesAndAbilities,
} from './level-up-blueprint.js';
import { deriveHitDieForClass } from './level-up-scaffold.js';
import { deduplicateFeatures, extractFeatureKey } from './level-up-runner.js';
import { applyDndSubfooterAlignment } from './dnd-fixes.js';
import { buildPlayerCardBio } from './concierge-pc-format.js';
import { buildMonsterEntryContent } from './concierge-npc-format.js';
import { systemRegistry } from './concierge-system-registry.js';

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

/**
 * Normalizes equipment items into individual `- Item` inventory lines,
 * tagging weapons, armor, and gear with `[E]` (equipped).
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
    const cleanItems = items.map(it => it.replace(bulletRx, '').trim()).filter(Boolean);

    const GEAR_MATCH_RX = /\b(mail|armor|leather|shield|sword|longsword|shortsword|greatsword|axe|greataxe|handaxe|mace|warhammer|dagger|rapier|scimitar|bow|shortbow|longbow|crossbow|quarterstaff|staff|focus|wand|symbol|totem|greaves|helm|gauntlets|cloak|robe)\b/i;
    const NON_EQUIP_RX = /\b(pack|pouch|gold|gp|sp|cp|rations|rope|bedroll|tools|torch|potion|scroll|waterskin)\b/i;

    return cleanItems.map(item => {
        if (/\[E\]/i.test(item)) {
            return `- ${item}`;
        }
        if (GEAR_MATCH_RX.test(item) && !NON_EQUIP_RX.test(item)) {
            return `- ${item} [E]`;
        }
        return `- ${item}`;
    });
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
        const charName = (p.name || 'Protagonist').trim();
        const className = (p.class || 'Fighter').trim();
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
HD: ${hitDie} (1/1)
Status: ${statusText}
[/CHARACTER]

[ABILITIES]
${abilitiesBlock}
[/ABILITIES]`;

        if (spellsBlock) {
            memo += `\n\n[SPELLS]\n${spellsBlock}\n[/SPELLS]`;
        }

        memo += `\n\n[XP]
Total: 0 / 300 XP (Level 1)
[/XP]

[INVENTORY]
${inventoryLines.join('\n')}
[/INVENTORY]`;

        return memo;
    }

    mergeLiveMemo(liveMemo, dossier, charName = null) {
        if (!liveMemo || typeof liveMemo !== 'string') return liveMemo;
        // Non-destructive update of location or traits if present
        return liveMemo;
    }

    async installCartridge(systemKey, overrides, options = {}) {
        // MultiHog is natively D&D 5e!
        // Apply subfooter alignment and disable narrative-halting level_up_protocol
        try {
            await applyDndSubfooterAlignment();
            const s = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
                || globalThis.extension_settings?.rpg_tracker;
            if (s?.syspromptModules) {
                s.syspromptModules.level_up_protocol = false;
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
* Maps: Name of site, danger level, sensory details.
* Kick / Opening Hook: Starting location, sensory arrival, and immediate call to action / crisis.

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
danger: Low
sensory: A bustling roadside inn filled with traders and tired travelers.
[/MAP]

[KICK]
starting_location: The Crossroads Tavern
pressure: Bandits ambushing royal tax wagons along the King's Road.
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
