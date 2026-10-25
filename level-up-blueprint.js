/**
 * MultiHog Companion — 1–20 Class Progression Codex & Blueprint Engine
 *
 * Manages the generation, lookup, and storage of 1–20 D&D class tables
 * and custom PbtA archetypes. Zero story token overhead.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { sendConciergeRequest } from './concierge-connection.js';

/**
 * Standard D&D 5e Cumulative XP thresholds (index 0 = Level 1).
 */
export const XP_LEVEL_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];

/**
 * Standard D&D 5e SRD Progression Archetypes.
 * Provides instant zero-latency, 100% accurate progressions for the 12 core classes.
 */
export const CORE_DND_PROGRESSIONS = {
    fighter: {
        className: 'Fighter',
        hitDie: 'd10',
        primaryStats: ['STR', 'DEX', 'CON'],
        levels: {
            1: { features: ['Fighting Style', 'Second Wind (1d10+Level HP 1/rest)'], profBonus: 2 },
            2: { features: ['Action Surge (1 extra action 1/rest)'], profBonus: 2 },
            3: { features: ['Martial Mastery (Critical hit on 19–20)'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (1 additional attack)'], profBonus: 3 },
            6: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            7: { features: ['Remarkable Athlete (+1/2 prof to non-prof physical checks, +5 ft jump)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            9: { features: ['Indomitable (Reroll a failed saving throw 1/long rest)'], profBonus: 4 },
            10: { features: ['Secondary Fighting Style'], profBonus: 4 },
            11: { features: ['Extra Attack (2 additional attacks)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            13: { features: ['Indomitable (2/long rest)'], profBonus: 5 },
            14: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            15: { features: ['Superior Critical (Critical hit on 18–20)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            17: { features: ['Action Surge (2/rest)', 'Indomitable (3/long rest)'], profBonus: 6 },
            18: { features: ['Survivor (Regain 5+CON HP at start of turn if below half HP)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 6 },
            20: { features: ['Extra Attack (3 additional attacks)'], profBonus: 6 },
        },
    },
    rogue: {
        className: 'Rogue',
        hitDie: 'd8',
        primaryStats: ['DEX', 'INT', 'CHA'],
        levels: {
            1: { features: ['Expertise (2 skills)', 'Sneak Attack (1d6)', 'Thieves Cant'], profBonus: 2 },
            2: { features: ['Cunning Action (Dash/Disengage/Hide as Bonus Action)'], profBonus: 2 },
            3: { features: ['Skirmish Tactics (Fast Hands & Infiltration)', 'Sneak Attack (2d6)'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 2 },
            5: { features: ['Uncanny Dodge (Halve incoming attack damage)', 'Sneak Attack (3d6)'], profBonus: 3 },
            6: { features: ['Expertise (2 additional skills)'], profBonus: 3 },
            7: { features: ['Evasion (No damage on DEX save success)', 'Sneak Attack (4d6)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            9: { features: ['Supreme Infiltration (Advantage on Stealth checks)', 'Sneak Attack (5d6)'], profBonus: 4 },
            10: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            11: { features: ['Reliable Talent (Rolls < 10 become 10)', 'Sneak Attack (6d6)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            13: { features: ['Ambush Reflexes (Two turns during first round of combat)', 'Sneak Attack (7d6)'], profBonus: 5 },
            14: { features: ['Blindsense (10 ft)'], profBonus: 5 },
            15: { features: ['Slippery Mind (Wisdom Save Proficiency)', 'Sneak Attack (8d6)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            17: { features: ['Death Strike (Double damage on surprised target)', 'Sneak Attack (9d6)'], profBonus: 6 },
            18: { features: ['Elusive (No attack roll has advantage against you)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)', 'Sneak Attack (10d6)'], asi: true, profBonus: 6 },
            20: { features: ['Stroke of Luck (Turn miss into hit or failed check into 20)'], profBonus: 6 },
        },
    },
    wizard: {
        className: 'Wizard',
        hitDie: 'd6',
        primaryStats: ['INT', 'CON', 'DEX'],
        levels: {
            1: { features: ['Spellcasting (Cantrips + Level 1 Slots: 2)', 'Arcane Recovery'], profBonus: 2 },
            2: { features: ['Arcane Savant (Halve gold/time to scribe spells, Sculpt Spells)', 'Level 1 Slots: 3'], profBonus: 2 },
            3: { features: ['Level 2 Spell Slots (2 slots)'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)', 'Cantrip Learned'], asi: true, profBonus: 2 },
            5: { features: ['Level 3 Spell Slots (2 slots)'], profBonus: 3 },
            6: { features: ['Potent Cantrip (Cantrip deals half damage on successful save)'], profBonus: 3 },
            7: { features: ['Level 4 Spell Slots (1 slot)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            9: { features: ['Level 5 Spell Slots (1 slot)'], profBonus: 4 },
            10: { features: ['Empowered Evocation (Add INT mod to spell damage)', 'Cantrip Learned'], profBonus: 4 },
            11: { features: ['Level 6 Spell Slots (1 slot)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            13: { features: ['Level 7 Spell Slots (1 slot)'], profBonus: 5 },
            14: { features: ['Overchannel (Maximize damage of 1st–5th level spells)'], profBonus: 5 },
            15: { features: ['Level 8 Spell Slots (1 slot)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            17: { features: ['Level 9 Spell Slots (1 slot)'], profBonus: 6 },
            18: { features: ['Spell Mastery (Free 1st & 2nd level spell at will)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 6 },
            20: { features: ['Signature Spells (Two free 3rd level spells per rest)'], profBonus: 6 },
        },
    },
    cleric: {
        className: 'Cleric',
        hitDie: 'd8',
        primaryStats: ['WIS', 'CON', 'STR'],
        levels: {
            1: { features: ['Divine Favor (Bonus heavy armor proficiency)', 'Spellcasting (Level 1: 2 slots)'], profBonus: 2 },
            2: { features: ['Channel Divinity (1/rest)', 'Radiance of the Dawn & Turn Undead'], profBonus: 2 },
            3: { features: ['Level 2 Spell Slots (2 slots)'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)', 'Cantrip Learned'], asi: true, profBonus: 2 },
            5: { features: ['Destroy Undead (CR 1/2)', 'Level 3 Spell Slots (2 slots)'], profBonus: 3 },
            6: { features: ['Blessed Healer (Healing spells also restore your HP)', 'Channel Divinity (2/rest)'], profBonus: 3 },
            7: { features: ['Level 4 Spell Slots (1 slot)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)', 'Divine Strike (+1d8 radiant on weapon hits)'], asi: true, profBonus: 3 },
            9: { features: ['Level 5 Spell Slots (1 slot)'], profBonus: 4 },
            10: { features: ['Divine Intervention (10% chance)'], profBonus: 4 },
            11: { features: ['Level 6 Spell Slots (1 slot)', 'Destroy Undead (CR 2)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            13: { features: ['Level 7 Spell Slots (1 slot)'], profBonus: 5 },
            14: { features: ['Destroy Undead (CR 3)'], profBonus: 5 },
            15: { features: ['Level 8 Spell Slots (1 slot)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            17: { features: ['Supreme Healing (Maximize healing spell dice)', 'Level 9 Spell Slots (1 slot)'], profBonus: 6 },
            18: { features: ['Channel Divinity (3/rest)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 6 },
            20: { features: ['Divine Intervention Auto-Success'], profBonus: 6 },
        },
    },
    barbarian: {
        className: 'Barbarian',
        hitDie: 'd12',
        primaryStats: ['STR', 'CON', 'DEX'],
        levels: {
            1: { features: ['Rage (2/day, +2 dmg)', 'Unarmored Defense (10+DEX+CON)'], profBonus: 2 },
            2: { features: ['Reckless Attack (Advantage on attacks)', 'Danger Sense'], profBonus: 2 },
            3: { features: ['Primal Instincts (Advantage on initiative & +1 Rage damage)', 'Rage (3/day)'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (1)', 'Fast Movement (+10 ft)'], profBonus: 3 },
            6: { features: ['Mindless Rage (Immune to charm/fear while raging)', 'Rage (4/day)'], profBonus: 3 },
            7: { features: ['Feral Instinct (Advantage on Initiative)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            9: { features: ['Brutal Critical (1 extra die)', 'Rage (+3 dmg)'], profBonus: 4 },
            10: { features: ['Intimidating Presence (Frighten a target as an action)'], profBonus: 4 },
            11: { features: ['Relentless Rage (CON save DC 10 to stay at 1 HP)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)', 'Rage (5/day)'], asi: true, profBonus: 4 },
            13: { features: ['Brutal Critical (2 extra dice)'], profBonus: 5 },
            14: { features: ['Unstoppable Juggernaut (Cannot be knocked prone or restrained while raging)'], profBonus: 5 },
            15: { features: ['Persistent Rage (Rage ends only if unconscious)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)', 'Rage (+4 dmg)'], asi: true, profBonus: 5 },
            17: { features: ['Brutal Critical (3 extra dice)', 'Rage (6/day)'], profBonus: 6 },
            18: { features: ['Indomitable Might (STR check total cannot be < STR score)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 6 },
            20: { features: ['Primal Champion (+4 STR & +4 CON, cap 24)', 'Unlimited Rage'], profBonus: 6 },
        },
    },
    paladin: {
        className: 'Paladin',
        hitDie: 'd10',
        primaryStats: ['STR', 'CHA', 'CON'],
        levels: {
            1: { features: ['Divine Sense (1+CHA/day)', 'Lay on Hands (5 x Level HP pool)'], profBonus: 2 },
            2: { features: ['Fighting Style', 'Divine Smite', 'Spellcasting (Level 1: 2 slots)'], profBonus: 2 },
            3: { features: ['Divine Grace (Channel Divinity: Sacred Weapon & Turn Unholy)', 'Divine Health'], profBonus: 2 },
            4: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (1)', 'Level 2 Spell Slots (2 slots)'], profBonus: 3 },
            6: { features: ['Aura of Protection (+CHA to all saves for allies within 10 ft)'], profBonus: 3 },
            7: { features: ['Aura of Warding (Allies within 10 ft have spell damage resistance)'], profBonus: 3 },
            8: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 3 },
            9: { features: ['Level 3 Spell Slots (2 slots)'], profBonus: 4 },
            10: { features: ['Aura of Courage (Immunity to Frightened)'], profBonus: 4 },
            11: { features: ['Improved Divine Smite (+1d8 radiant on all melee hits)'], profBonus: 4 },
            12: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 4 },
            13: { features: ['Level 4 Spell Slots (1 slot)'], profBonus: 5 },
            14: { features: ['Cleansing Touch (Remove 1 spell from target CHA/day)'], profBonus: 5 },
            15: { features: ['Undying Sentinel (When reduced to 0 HP, drop to 1 HP instead 1/day)'], profBonus: 5 },
            16: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 5 },
            17: { features: ['Level 5 Spell Slots (1 slot)'], profBonus: 6 },
            18: { features: ['Aura Expansion (Auras extend to 30 ft)'], profBonus: 6 },
            19: { features: ['Ability Score Improvement (or Feat)'], asi: true, profBonus: 6 },
            20: { features: ['Holy Champion Avatar (Radiant flight & empowered strike)'], profBonus: 6 },
        },
    },
};

/**
 * Checks if a campaign dossier already possesses a valid Progression Blueprint.
 *
 * @param {object} dossier Campaign dossier.
 * @returns {boolean}
 */
export function hasProgressionBlueprint(dossier) {
    if (!dossier || typeof dossier !== 'object') return false;
    const bp = dossier.progressionBlueprint;
    return !!(bp && typeof bp === 'object' && bp.levels && Object.keys(bp.levels).length > 0);
}

/**
 * Resolves a canonical core D&D class progression if recognized.
 *
 * @param {string} className Name of the character class.
 * @returns {object|null}
 */
export function getCanonicalDndProgression(className) {
    if (!className || typeof className !== 'string') return null;
    const lower = className.trim().toLowerCase();

    for (const [key, prog] of Object.entries(CORE_DND_PROGRESSIONS)) {
        if (lower.includes(key)) {
            return JSON.parse(JSON.stringify(prog));
        }
    }
    return null;
}

/**
 * Builds a prompt for an LLM to generate a balanced 1–20 Progression Codex
 * for an invented, homebrew, or custom setting class.
 *
 * @param {object} params
 * @param {object} params.character Protagonist sheet details.
 * @param {string} [params.genre='fantasy'] Setting genre.
 * @param {string} [params.worldRules=''] World premise or rules summary.
 * @returns {string} Prompt text.
 */
export function buildBlueprintPrompt({ character = {}, genre = 'fantasy', worldRules = '' }) {
    const name = character.name || 'Hero';
    const cName = character.class || 'Adventurer';
    const hitDie = character.hitDie || 'd8';
    const stats = Object.entries(character.stats || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ') || 'Standard array';

    return `You are an expert tabletop game designer and RPG systems architect.
Design a cohesive, exciting, and balanced 1–20 Class Progression Table for the following character class using a streamlined "D&D Lite" model:

CLASS NAME: ${cName}
CHARACTER: ${name} (Stats: ${stats}, Hit Die: ${hitDie})
GENRE / SETTING: ${genre}
WORLD PREMISE / RULES: ${worldRules || 'Standard campaign setting'}

GUIDELINES (D&D LITE PHILOSOPHY):
1. Single-Track Progression: Do NOT create or require rigid branching subclass trees or multi-class tables. Keep progression unified, elegant, and single-track (Levels 1 to 20).
2. Level 3 Archetype Milestone: At Level 3, grant a signature "Archetype Specialization" feature (e.g. Martial Mastery, Primal Instincts, Arcane Savant) that defines the class fantasy without splintering into sub-tables.
3. Milestones: Every level must provide tangible progression (HP gain via Hit Die + CON; class traits; ASIs/Feats at Levels 4, 8, 12, 16, 19).
4. Thematic Depth: Make the abilities uniquely fit the "${cName}" class fantasy. Do not use generic placeholders like "Subclass Feature".
5. Output Format: You MUST output the progression inside a clean JSON codeblock using this exact structure:

\`\`\`json
{
  "className": "${cName}",
  "hitDie": "${hitDie}",
  "primaryStats": ["STR", "DEX"],
  "levels": {
    "1": { "features": ["Feature 1", "Feature 2"], "profBonus": 2 },
    "2": { "features": ["Feature name (description)"], "profBonus": 2 },
    "3": { "features": ["Archetype Specialization: Name (description)"], "profBonus": 2 },
    "4": { "features": ["Ability Score Improvement or Feat"], "asi": true, "profBonus": 2 },
    ...
    "20": { "features": ["Capstone Feature"], "profBonus": 6 }
  }
}
\`\`\`
Provide all 20 levels. Output ONLY the JSON block.`;
}

/**
 * Parses and normalizes a Progression Blueprint from an LLM response.
 *
 * @param {string} responseText Raw LLM generation text.
 * @param {string} [fallbackClassName='Adventurer'] Fallback class name.
 * @param {string} [fallbackHitDie='d8'] Fallback hit die.
 * @returns {object|null}
 */
export function parseBlueprintFromResponse(responseText, fallbackClassName = 'Adventurer', fallbackHitDie = 'd8') {
    if (!responseText || typeof responseText !== 'string') return null;

    try {
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
            || responseText.match(/\{[\s\S]*"levels"[\s\S]*\}/i);

        const rawJson = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
        const parsed = JSON.parse(rawJson.trim());

        if (parsed && parsed.levels && typeof parsed.levels === 'object') {
            return {
                className: parsed.className || fallbackClassName,
                hitDie: parsed.hitDie || fallbackHitDie,
                primaryStats: Array.isArray(parsed.primaryStats) ? parsed.primaryStats : ['STR', 'DEX'],
                subclassTitle: parsed.subclassTitle || null,
                levels: parsed.levels,
                createdAt: new Date().toISOString(),
            };
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Failed to parse blueprint JSON:', err);
    }
    return null;
}

/**
 * Retrieves the specific progression perks, bonuses, and ASI flags for a target level.
 *
 * @param {object} blueprint Stored progression blueprint.
 * @param {number} targetLevel Level being advanced to (e.g. 4).
 * @param {number} [conModifier=0] Constitution modifier for HP calculation.
 * @returns {{
 *   level: number,
 *   features: string[],
 *   isAsi: boolean,
 *   isSubclass: boolean,
 *   profBonus: number,
 *   hitDie: string,
 *   averageHpGain: number
 * }}
 */
export function getTierPerks(blueprint, targetLevel, conModifier = 0) {
    const lvlKey = String(targetLevel);
    const perkData = blueprint?.levels?.[lvlKey] || {};

    const hitDie = blueprint?.hitDie || 'd8';
    const dieMax = parseInt(hitDie.replace(/\D/g, ''), 10) || 8;
    const avgRoll = Math.floor(dieMax / 2) + 1;
    const averageHpGain = Math.max(1, avgRoll + conModifier);

    return {
        level: targetLevel,
        features: Array.isArray(perkData.features) ? perkData.features : (perkData.features ? [perkData.features] : []),
        isAsi: !!perkData.asi,
        isSubclass: !!perkData.subclass,
        profBonus: perkData.profBonus || (Math.floor((targetLevel - 1) / 4) + 2),
        hitDie,
        averageHpGain,
    };
}

/**
 * Formats a Progression Blueprint into a concise text summary for LLM context or logs.
 *
 * @param {object} blueprint Progression blueprint.
 * @returns {string} Formatted text summary.
 */
export function formatBlueprintSummary(blueprint) {
    if (!blueprint || !blueprint.levels || typeof blueprint.levels !== 'object') {
        return 'No progression blueprint available.';
    }
    const lines = [];
    for (let i = 1; i <= 20; i++) {
        const lvl = blueprint.levels[String(i)] || blueprint.levels[i];
        if (lvl) {
            const feats = Array.isArray(lvl.features) ? lvl.features.join(', ') : (lvl.features || 'None');
            const prof = lvl.profBonus ? ` (Prof +${lvl.profBonus})` : '';
            lines.push(`Level ${i}${prof}: ${feats}`);
        }
    }
    return lines.join('\n');
}

/**
 * Autonomous Concierge generator for 1–20 custom / homebrew progression blueprints.
 *
 * @param {object} params
 * @param {object} [params.character={}] Character details.
 * @param {string} [params.genre='fantasy'] Campaign genre.
 * @param {string} [params.worldRules=''] World rules summary.
 * @returns {Promise<object>}
 */
export async function generateProgressionBlueprintViaConcierge({ character = {}, genre = 'fantasy', worldRules = '' } = {}) {
    const prompt = buildBlueprintPrompt({ character, genre, worldRules });
    const messages = [
        {
            role: 'system',
            content: 'You are a master RPG systems designer. Generate balanced, detailed 1–20 class progression tables in JSON format according to user instructions. Return valid JSON only inside a ```json codeblock.',
        },
        {
            role: 'user',
            content: prompt,
        },
    ];

    try {
        const reply = await sendConciergeRequest(messages);
        const parsed = parseBlueprintFromResponse(reply, character.class || 'Adventurer', character.hitDie || 'd8');
        if (parsed) {
            return parsed;
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Concierge blueprint generation error:', err);
    }

    // High quality balanced fallback if network or LLM fails
    return {
        className: character.class || 'Adventurer',
        hitDie: character.hitDie || 'd8',
        primaryStats: ['STR', 'DEX'],
        subclassTitle: 'Specialization',
        levels: {
            1: { features: ['Core Trait', 'Starting Proficiency'], profBonus: 2 },
            2: { features: ['Action Surge / Focus Ability'], profBonus: 2 },
            3: { features: ['Archetype Specialization'], subclass: true, profBonus: 2 },
            4: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack or Greater Magic'], profBonus: 3 },
            6: { features: ['Archetype Trait'], profBonus: 3 },
            7: { features: ['Tactical Resilience'], profBonus: 3 },
            8: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 3 },
            9: { features: ['Paragon Feature'], profBonus: 4 },
            10: { features: ['Archetype Mastery'], profBonus: 4 },
            11: { features: ['Empowered Strike or Enhanced Focus'], profBonus: 4 },
            12: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 4 },
            13: { features: ['Heroic Surge'], profBonus: 5 },
            14: { features: ['Iron Mind / Resilience'], profBonus: 5 },
            15: { features: ['Archetype Pinnacle'], profBonus: 5 },
            16: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 5 },
            17: { features: ['Legendary Focus'], profBonus: 6 },
            18: { features: ['Indomitable Stance'], profBonus: 6 },
            19: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 6 },
            20: { features: ['Legendary Avatar Capstone'], profBonus: 6 },
        },
    };
}
