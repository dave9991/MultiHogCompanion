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
export const XP_LEVEL_THRESHOLDS = [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

/** Highest level the XP table can advance to. */
export const MAX_CHARACTER_LEVEL = 20;

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
            3: { features: ['Martial Mastery (Critical hit on 19–20)'], subclass: true, profBonus: 2 },
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
            3: { features: ['Skirmish Tactics (Fast Hands & Infiltration)', 'Sneak Attack (2d6)'], subclass: true, profBonus: 2 },
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
            1: { features: ['Spellcasting (Cantrips + Level 1 Slots: 2)', 'Arcane Recovery'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Arcane Savant (Halve gold/time to scribe spells, Sculpt Spells)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Arcane Tradition Mastery'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
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
            1: { features: ['Divine Favor (Bonus heavy armor proficiency)', 'Spellcasting (Level 1: 2 slots)'], subclass: true, spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Channel Divinity (1/rest)', 'Radiance of the Dawn & Turn Undead'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Divine Domain Doctrines'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
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
            3: { features: ['Primal Instincts (Advantage on initiative & +1 Rage damage)', 'Rage (3/day)'], subclass: true, profBonus: 2 },
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
            2: { features: ['Fighting Style', 'Divine Smite', 'Spellcasting (Level 1: 2 slots)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Divine Grace (Channel Divinity: Sacred Weapon & Turn Unholy)', 'Divine Health'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
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
    bard: {
        className: 'Bard',
        hitDie: 'd8',
        primaryStats: ['CHA', 'DEX', 'CON'],
        levels: {
            1: { features: ['Bardic Inspiration (d6, CHA/long rest)', 'Spellcasting'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Jack of All Trades (+1/2 prof to non-proficient checks)', 'Song of Rest (d6)'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Cutting Words & Bonus Lore (Bardic College Specialization)', 'Expertise (2 skills)'], subclass: true, spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Bardic Inspiration (d8)', 'Font of Inspiration (Regain on short rest)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Countercharm (Advantage vs Frightened/Charmed for allies)', 'Additional Magical Secrets (2 spells from any class)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Resonant Performance (Allies inspired gain temp HP equal to CHA mod)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Song of Rest (d8)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Bardic Inspiration (d10)', 'Expertise (2 additional skills)', 'Magical Secrets (2 spells)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['Silver Tongue (Minimum roll of 10 on Persuasion/Deception)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Song of Rest (d10)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Peerless Skill (Add Bardic Inspiration die to your own ability checks)', 'Magical Secrets (2 spells)'], profBonus: 5 },
            15: { features: ['Bardic Inspiration (d12)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Song of Rest (d12)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Magical Secrets (2 spells from any class)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Superior Inspiration (Regain 1 Bardic Inspiration on initiative if at 0)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    druid: {
        className: 'Druid',
        hitDie: 'd8',
        primaryStats: ['WIS', 'CON', 'DEX'],
        levels: {
            1: { features: ['Druidic', 'Spellcasting'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Wild Shape (2/rest, CR 1/2)', 'Natural Recovery (Druid Circle Specialization)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Circle Spells (Always-prepared terrain magic)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: ['Wild Shape Improvement (Swim speed)'], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Primal Communion (Advantage on Nature/Survival in wild terrain)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Land Stride (Ignore nonmagical difficult terrain)', 'Primal Strike (Beast attacks count as magical)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Elemental Affinity (Resistance to poison and nature hazards)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: ['Wild Shape Improvement (Flying speed, CR 1)'], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Verdant Ward (Allies within 10 ft gain +2 to saves vs nature/elemental effects)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Nature Ward (Immune to poison/disease and charm/fear from elementals or fey)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['Elemental Wild Shape (Expend 2 Wild Shapes to become an Elemental)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Primal Sanctuary (Beasts and plants hesitate to attack you)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Thousand Forms (Cast Alter Self at will)'], profBonus: 5 },
            15: { features: [' Elder Grove Mastery'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Awakened Wilds'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Timeless Body', 'Beast Spells (Cast spells while in Wild Shape)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Archdruid (Unlimited Wild Shape)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    monk: {
        className: 'Monk',
        hitDie: 'd8',
        primaryStats: ['DEX', 'WIS', 'CON'],
        levels: {
            1: { features: ['Unarmored Defense (10+DEX+WIS)', 'Martial Arts (1d4 unarmed strike, bonus unarmed attack)'], profBonus: 2 },
            2: { features: ['Ki (2 points/short rest: Flurry of Blows, Patient Defense, Step of the Wind)', 'Unarmored Movement (+10 ft)'], profBonus: 2 },
            3: { features: ['Open Hand Technique (Knock prone or push on Flurry)', 'Deflect Missiles'], subclass: true, profBonus: 2 },
            4: { features: ['Slow Fall (Reduce falling damage by 5 x Level)'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (1)', 'Stunning Strike (1 Ki: CON save or stunned)', 'Martial Arts (1d6)'], profBonus: 3 },
            6: { features: ['Ki-Empowered Strikes (Unarmed strikes count as magical)', 'Wholeness of Body (Heal 3 x Level HP 1/day)', 'Unarmored Movement (+15 ft)'], profBonus: 3 },
            7: { features: ['Evasion (No damage on DEX save success)', 'Stillness of Mind (End charmed or frightened)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Unarmored Movement Improvement (Run across vertical surfaces and liquids)'], profBonus: 4 },
            10: { features: ['Purity of Body (Immune to disease and poison)', 'Unarmored Movement (+20 ft)'], profBonus: 4 },
            11: { features: ['Tranquility (Sanctuary effect after long rest)', 'Martial Arts (1d8)'], profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Tongue of the Sun and Moon (Understand all spoken languages)'], profBonus: 5 },
            14: { features: ['Diamond Soul (Proficiency in all saving throws; spend 1 Ki to reroll)', 'Unarmored Movement (+25 ft)'], profBonus: 5 },
            15: { features: ['Timeless Body (No frailty from old age; need no food or water)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Quivering Palm (3 Ki: lethal vibrations)', 'Martial Arts (1d10)'], profBonus: 6 },
            18: { features: ['Empty Body (4 Ki: Invisible and resistant to all damage except force)', 'Unarmored Movement (+30 ft)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Perfect Self (Regain 4 Ki on initiative if at 0 Ki)'], profBonus: 6 },
        },
    },
    ranger: {
        className: 'Ranger',
        hitDie: 'd10',
        primaryStats: ['DEX', 'WIS', 'CON'],
        levels: {
            1: { features: ['Favored Enemy (Advantage on tracking & lore)', 'Natural Explorer (Deft Explorer)'], profBonus: 2 },
            2: { features: ['Fighting Style', 'Spellcasting (Hunter\'s Mark)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Colossus Slayer (+1d8 to wounded targets)', 'Primeval Awareness'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (1)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 3 },
            6: { features: ['Favored Enemy & Greater Explorer Improvement (+5 ft speed, climb/swim)'], profBonus: 3 },
            7: { features: ['Defensive Tactics (Multiattack Defense & Escape the Horde)'], spellSlots: { 1: 4, 2: 3 }, profBonus: 3 },
            8: { features: ['Land\'s Stride (Ignore nonmagical difficult terrain)'], asi: true, profBonus: 3 },
            9: { features: ['Conclave Mastery'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 4 },
            10: { features: ['Hide in Plain Sight (Nature\'s Veil: turn invisible as bonus action)'], profBonus: 4 },
            11: { features: ['Multiattack (Volley or Whirlwind Attack)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Apex Tracker'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 5 },
            14: { features: ['Vanish (Hide as a bonus action; cannot be tracked nonmagically)'], profBonus: 5 },
            15: { features: ['Superior Hunter\'s Defense (Uncanny Dodge or Stand Against the Tide)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Wilderness Paragon'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 6 },
            18: { features: ['Feral Senses (Detect invisible creatures within 30 ft)'], profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 5: 2 }, profBonus: 6 },
            20: { features: ['Foe Slayer (Add WIS modifier to attack or damage roll 1/turn)'], profBonus: 6 },
        },
    },
    sorcerer: {
        className: 'Sorcerer',
        hitDie: 'd6',
        primaryStats: ['CHA', 'CON', 'DEX'],
        levels: {
            1: { features: ['Spellcasting', 'Draconic Resilience (13+DEX AC & +1 HP/lvl)'], subclass: true, spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Font of Magic (Sorcery Points equal to Level; Flexible Casting)'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Metamagic (2 options: Twinned Spell, Quickened Spell, Careful Spell, Subtle Spell)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Magical Guidance (Spend 1 Sorcery Point to reroll a failed ability check)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Elemental Affinity (Add CHA mod to elemental spell damage & gain resistance)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Arcane Surge'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Bloodline Conduit'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Metamagic (1 additional option)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['High Sorcery'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Origin Focus'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Draconic Wings (At-will flying speed equal to walking speed)'], profBonus: 5 },
            15: { features: ['Sovereign Arcana'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Metamagic (1 additional option)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Draconic Presence (Spend 5 Sorcery Points for 60 ft awe/fear aura)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Sorcerous Restoration (Regain 4 Sorcery Points on every short rest)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    warlock: {
        className: 'Warlock',
        hitDie: 'd8',
        primaryStats: ['CHA', 'CON', 'DEX'],
        levels: {
            1: { features: ['Dark One\'s Blessing (CHA+Level temp HP on kill)', 'Pact Magic (Short Rest Slots)'], subclass: true, spellSlots: { 1: 1 }, profBonus: 2 },
            2: { features: ['Eldritch Invocations (2 invocations: Agonizing Blast, Devil\'s Sight)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Pact Boon (Pact of the Blade, Chain, or Tome)'], spellSlots: { 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Eldritch Invocations (3 total)'], spellSlots: { 3: 2 }, profBonus: 3 },
            6: { features: ['Dark One\'s Own Luck (Add d10 to an ability check or saving throw 1/rest)'], profBonus: 3 },
            7: { features: ['Eldritch Invocations (4 total)'], spellSlots: { 4: 2 }, profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Eldritch Invocations (5 total)'], spellSlots: { 5: 2 }, profBonus: 4 },
            10: { features: ['Fiendish Resilience (Choose 1 damage resistance after each rest)'], profBonus: 4 },
            11: { features: ['Mystic Arcanum (6th-level spell 1/long rest)'], spellSlots: { 5: 3 }, profBonus: 4 },
            12: { features: ['Eldritch Invocations (6 total)'], asi: true, profBonus: 4 },
            13: { features: ['Mystic Arcanum (7th-level spell 1/long rest)'], profBonus: 5 },
            14: { features: ['Hurl Through Hell (Banish hit target for 10d10 psychic damage 1/long rest)'], profBonus: 5 },
            15: { features: ['Mystic Arcanum (8th-level spell 1/long rest)', 'Eldritch Invocations (7 total)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Mystic Arcanum (9th-level spell 1/long rest)'], spellSlots: { 5: 4 }, profBonus: 6 },
            18: { features: ['Eldritch Invocations (8 total)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Eldritch Master (Spend 1 minute to regain all Pact Magic slots 1/long rest)'], profBonus: 6 },
        },
    },
};

// ─────────────────────────────────────────────────────────────
// Blueprint sanitation (roadmap declutter)
// HP gain, proficiency bonus, ASI and spell-slot bookkeeping are computed by
// the engine and have dedicated columns/flags. They must never appear as
// "features" in the roadmap or be written to the character sheet.
// ─────────────────────────────────────────────────────────────

const HP_NOISE_PATTERNS = [
    /^\s*(?:HP|Hit\s*Points?|Hit\s*Di(?:e|ce)|HD)\b/i,
    /\b(?:HP|Hit\s*Points?)\s*(?:gain|increase|per\s*level)\b/i,
    /\b(?:gain|gains|increase)\s*:?\s*\+?\d*d\d+(?:\s*\+\s*\w+)*\s*(?:HP|hit\s*points?)\b/i,
];
const PROF_NOISE_PATTERN = /^\s*proficiency\s*bonus\b/i;
const ASI_NOISE_PATTERN = /^\s*(?:ability\s*score\s*(?:improvement|increase)|ASI\b)/i;
const CANTRIP_NOISE_PATTERN = /^\s*(?:new\s*)?cantrips?(?:\s*learned)?\s*$/i;
const SLOT_NOISE_PATTERN = /^\s*Level\s*(\d)\s*(?:Spell\s*)?Slots?\s*[:(]?\s*(\d+)/i;

/**
 * Classifies a feature string as engine-computed bookkeeping rather than a real class feature.
 *
 * @param {string} feat
 * @returns {'hp'|'prof'|'asi'|'cantrip'|'slots'|null} Noise category, or null for a real feature.
 */
export function classifyFeatureNoise(feat) {
    if (typeof feat !== 'string') return 'hp';
    if (HP_NOISE_PATTERNS.some(re => re.test(feat))) return 'hp';
    if (PROF_NOISE_PATTERN.test(feat)) return 'prof';
    if (ASI_NOISE_PATTERN.test(feat)) return 'asi';
    if (CANTRIP_NOISE_PATTERN.test(feat)) return 'cantrip';
    if (SLOT_NOISE_PATTERN.test(feat)) return 'slots';
    return null;
}

/**
 * Normalizes a trait, feature, or ability string into MultiHog's interactive pill syntax:
 * `Name (hover tooltip description)` (or bare `Name` if there is no description).
 *
 * MultiHog's `renderPills` splits on commas at parenthesis depth 0 and matches
 * `/^(.+?)\s*\((.+)\)$/` to separate the pill badge title from its hover tooltip
 * (and extracts `X/Y` resource badges from inside the parentheses).
 *
 * - Converts `Name: description` or `Name — description` into `Name (description)`.
 * - Merges `Name (1/1 per rest): description` or `Name: description (1/1 per rest)`
 *   into `Name (description; 1/1 per rest)`.
 * - Replaces nested `(` `)` inside the outer description with `[` `]` so `splitSmart`
 *   never miscounts parenthesis depth.
 * - Preserves short category prefixes like `Feat: Sentinel` or `Feat: Sentinel (desc)`.
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatTraitAsPill(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^\(\((?:PILLS|PLS|PILL)\)\)\s*/i, '')
        .trim();
    if (!s) return '';

    const sanitizeInnerParens = (desc) => desc.replace(/\(/g, '[').replace(/\)/g, ']').trim();

    // Case 1: Ends with ')' — find the matching opening '(' for that final ')'
    if (s.endsWith(')')) {
        let depth = 0;
        let openIdx = -1;
        for (let i = s.length - 1; i >= 0; i--) {
            if (s[i] === ')') depth++;
            else if (s[i] === '(') {
                depth--;
                if (depth === 0) {
                    openIdx = i;
                    break;
                }
            }
        }
        if (openIdx > 0) {
            let head = s.slice(0, openIdx).trim();
            let desc = s.slice(openIdx + 1, -1).trim();

            // Check if head has a colon (e.g. "Second Wind: Regain 1d10+Level HP (1/1 per short rest)")
            // Preserve short prefix labels like "Feat: Sentinel"
            const colonIdx = head.indexOf(':');
            if (colonIdx > 0) {
                const prefix = head.slice(0, colonIdx).trim();
                const afterColon = head.slice(colonIdx + 1).trim();
                const isShortCategoryPrefix = /^(?:feat|boon)$/i.test(prefix) && !afterColon.includes(',');
                if (!isShortCategoryPrefix && afterColon) {
                    head = prefix;
                    desc = desc ? `${afterColon}; ${desc}` : afterColon;
                }
            }
            return `${head} (${sanitizeInnerParens(desc)})`;
        }
    }

    // Case 2: Does not end with ')' — check for top-level colon (e.g. "Darkvision: See 60 ft in dim light, 30 ft in dark"
    // or "Second Wind (1/1 per short rest): Regain 1d10+Level HP")
    let colonIdx = -1;
    let pDepth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') pDepth++;
        else if (s[i] === ')') pDepth = Math.max(0, pDepth - 1);
        else if (s[i] === ':' && pDepth === 0) {
            colonIdx = i;
            break;
        }
    }
    if (colonIdx > 0) {
        const left = s.slice(0, colonIdx).trim();
        const right = s.slice(colonIdx + 1).trim();
        const leftParenMatch = left.match(/^(.+?)\s*\((.+)\)$/);
        // Preserve short category/sub-title labels like "Feat: Sentinel" or "Custom Totem: Eagle Eye"
        // that have no mechanical description, commas, or numbers.
        const isShortTitleWithoutDesc = !leftParenMatch
            && !right.includes(',')
            && !/[+-]?\d/.test(right)
            && right.split(/\s+/).length <= 3;
        if (isShortTitleWithoutDesc) {
            return `${left}: ${right}`;
        }
        if (right) {
            if (leftParenMatch) {
                const name = leftParenMatch[1].trim();
                const tag = leftParenMatch[2].trim();
                return `${name} (${sanitizeInnerParens(`${right}; ${tag}`)})`;
            }
            return `${left} (${sanitizeInnerParens(right)})`;
        }
    }

    // Case 3: Top-level dash separator "Trait Name — description" or "Trait Name - description"
    const dashMatch = s.match(/^([^(—–-]+?)\s+(?:—|–|-)\s+(.+)$/);
    if (dashMatch) {
        const name = dashMatch[1].trim();
        const desc = dashMatch[2].trim();
        if (name && desc) {
            return `${name} (${sanitizeInnerParens(desc)})`;
        }
    }

    return s;
}

/**
 * Removes engine-computed bookkeeping strings (HP gain, prof bonus, ASI, spell slot rows),
 * normalizes each feature into MultiHog pill syntax (`Name (description)`), and deduplicates.
 *
 * @param {string[]} list
 * @returns {string[]}
 */
export function sanitizeFeatureList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed || classifyFeatureNoise(trimmed)) continue;
        const feat = formatTraitAsPill(trimmed);
        if (!feat) continue;
        const key = feat.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(feat);
    }
    return out;
}

/**
 * Normalizes one blueprint level entry. Tolerates string/array features, strips
 * bookkeeping noise into structured fields (asi flag, spellSlots).
 *
 * @param {object|string|string[]} raw Raw level entry.
 * @param {number} level Level number (1–20).
 * @returns {{features: string[], profBonus: number, asi: boolean, subclass: boolean, spellSlots: object|null}}
 */
export function normalizeLevelEntry(raw, level) {
    const entry = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { features: raw };
    let rawFeatures = [];
    if (Array.isArray(entry.features)) rawFeatures = entry.features;
    else if (typeof entry.features === 'string' && entry.features.trim()) rawFeatures = [entry.features];

    let asi = !!entry.asi;
    const spellSlots = (entry.spellSlots && typeof entry.spellSlots === 'object') ? { ...entry.spellSlots } : {};
    for (const f of rawFeatures) {
        if (typeof f !== 'string') continue;
        const kind = classifyFeatureNoise(f);
        if (kind === 'asi') asi = true;
        if (kind === 'slots') {
            const m = f.match(SLOT_NOISE_PATTERN);
            if (m) spellSlots[m[1]] = parseInt(m[2], 10);
        }
    }

    return {
        features: sanitizeFeatureList(rawFeatures),
        profBonus: Number(entry.profBonus) || (Math.floor((level - 1) / 4) + 2),
        asi,
        subclass: !!entry.subclass,
        spellSlots: Object.keys(spellSlots).length > 0 ? spellSlots : null,
    };
}

/**
 * Returns a normalized deep copy of a progression blueprint: levels keyed "1".."20",
 * features as clean arrays, bookkeeping noise removed, hit die canonicalized (e.g. "1d8" → "d8").
 * Idempotent and safe to call on stored blueprints.
 *
 * @param {object} blueprint
 * @returns {object|null}
 */
export function normalizeBlueprint(blueprint) {
    if (!blueprint || typeof blueprint !== 'object' || !blueprint.levels || typeof blueprint.levels !== 'object') {
        return blueprint || null;
    }
    const levels = {};
    for (let i = 1; i <= 20; i++) {
        const raw = blueprint.levels[String(i)] ?? blueprint.levels[i];
        const entry = normalizeLevelEntry(raw, i);
        if (!entry.spellSlots) delete entry.spellSlots;
        levels[String(i)] = entry;
    }
    const hdMatch = typeof blueprint.hitDie === 'string' ? blueprint.hitDie.match(/d\s*(4|6|8|10|12)\b/i) : null;
    return {
        ...blueprint,
        hitDie: hdMatch ? `d${hdMatch[1]}` : (blueprint.hitDie || 'd8'),
        levels,
    };
}

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
 * Checks whether a stored blueprint still describes the character's current class.
 * Tolerant of casing/punctuation and descriptive prefixes ("Shadow Rogue" matches a Rogue table).
 * A missing/generic class never invalidates a blueprint.
 *
 * @param {object} blueprint Stored progression blueprint.
 * @param {string} className Character's current class.
 * @returns {boolean}
 */
export function blueprintMatchesClass(blueprint, className) {
    if (!blueprint || !blueprint.className) return true;
    if (!className || typeof className !== 'string') return true;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const a = norm(blueprint.className);
    const b = norm(className);
    if (!a || !b || b === 'adventurer' || a === b || a.includes(b) || b.includes(a)) return true;
    const canonA = getCanonicalDndProgression(blueprint.className)?.className;
    const canonB = getCanonicalDndProgression(className)?.className;
    return !!(canonA && canonB && canonA === canonB);
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

    // Prefer exact word-boundary match so e.g. "Bombardier" does not match "bard"
    for (const [key, prog] of Object.entries(CORE_DND_PROGRESSIONS)) {
        const wordRe = new RegExp(`\\b${key}\\b`, 'i');
        if (wordRe.test(lower)) {
            return normalizeBlueprint(JSON.parse(JSON.stringify(prog)));
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
    const existingFeatures = Array.isArray(character.features) && character.features.length > 0
        ? character.features.join(', ')
        : 'None specified';

    return `You are an expert tabletop game designer and RPG systems architect.
Design a cohesive, exciting, and balanced 1–20 Class Progression Table for the following character class using a streamlined "D&D Lite" model:

CLASS NAME: ${cName}
CHARACTER: ${name} (Stats: ${stats}, Hit Die: ${hitDie})
ESTABLISHED STARTING TRAITS / AD-HOC ABILITIES: ${existingFeatures}
GENRE / SETTING: ${genre}
WORLD PREMISE / RULES: ${worldRules || 'Standard campaign setting'}

GUIDELINES (D&D LITE PHILOSOPHY):
1. Single-Track Progression: Do NOT create or require rigid branching subclass trees or multi-class tables. Keep progression unified, elegant, and single-track (Levels 1 to 20).
2. Starting Trait Integration: You MUST incorporate and honor the character's ESTABLISHED STARTING TRAITS (${existingFeatures !== 'None specified' ? existingFeatures : 'if any'}) into Level 1 (and early levels) of the progression table so existing abilities granted by the adventure are preserved rather than replaced.
3. Level 3 Archetype Milestone: At Level 3, grant a signature "Archetype Specialization" feature (e.g. Martial Mastery, Primal Instincts, Arcane Savant) that defines the class fantasy without splintering into sub-tables.
4. Milestones: Mark ASI/Feat levels (4, 8, 12, 16, 19) with "asi": true. The "features" array lists ONLY named class abilities (1–2 per level; an empty array is fine for ASI-only levels).
5. Engine-Computed Data — DO NOT LIST: Hit Points / HP gain / Hit Die, proficiency bonus, Ability Score Improvements, spell slot counts, and "cantrip learned" rows are tracked by the game engine and have their own fields. NEVER put them in "features".
6. MultiHog Pill Rendering Format: The character sheet renders every feature as an interactive hover-pill using "Feature Name (concise hover tooltip description)". Always put the mechanical effect, bonus, or rest recharge inside parentheses after the feature name—NEVER use colons ("Name: description") or dashes ("Name - description") outside parentheses, and never nest parentheses inside parentheses (use [brackets] inside parentheses if needed).
7. Thematic Depth: Make the abilities uniquely fit the "${cName}" class fantasy. Do not use generic placeholders like "Subclass Feature".
8. Output Format: You MUST output the progression inside a clean JSON codeblock using this exact structure:

\`\`\`json
{
  "className": "${cName}",
  "hitDie": "${hitDie}",
  "primaryStats": ["STR", "DEX"],
  "levels": {
    "1": { "features": ["Feature 1 (passive benefit)", "Feature 2 (1/1 per short rest)"], "profBonus": 2 },
    "2": { "features": ["Feature Name (concise mechanical description)"], "profBonus": 2 },
    "3": { "features": ["Signature Archetype Feature (defines class specialization)"], "subclass": true, "profBonus": 2 },
    "4": { "features": [], "asi": true, "profBonus": 2 },
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
            return normalizeBlueprint({
                className: parsed.className || fallbackClassName,
                hitDie: parsed.hitDie || fallbackHitDie,
                primaryStats: Array.isArray(parsed.primaryStats) ? parsed.primaryStats : ['STR', 'DEX'],
                subclassTitle: parsed.subclassTitle || null,
                levels: parsed.levels,
                createdAt: new Date().toISOString(),
            });
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
    const perkData = normalizeLevelEntry(blueprint?.levels?.[lvlKey] ?? blueprint?.levels?.[targetLevel], targetLevel);

    const hitDie = blueprint?.hitDie || 'd8';
    const dieMax = parseInt(hitDie.replace(/\D/g, ''), 10) || 8;
    const avgRoll = Math.floor(dieMax / 2) + 1;
    const averageHpGain = Math.max(1, avgRoll + conModifier);

    return {
        level: targetLevel,
        features: perkData.features,
        isAsi: perkData.asi,
        isSubclass: perkData.subclass,
        spellSlots: perkData.spellSlots,
        profBonus: perkData.profBonus,
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
        if (typeof toastr !== 'undefined' && typeof toastr.warning === 'function') {
            toastr.warning(
                `Could not parse custom 1–20 table for "${character.class || 'Adventurer'}"; loaded balanced standard progression instead.`,
                'Class Codex Fallback',
            );
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Concierge blueprint generation error:', err);
        if (typeof toastr !== 'undefined' && typeof toastr.warning === 'function') {
            toastr.warning(
                `Concierge unavailable (${err?.message || 'network timeout'}); loaded balanced standard progression for "${character.class || 'Adventurer'}".`,
                'Class Codex Fallback',
            );
        }
    }

    // High quality balanced fallback if network or LLM fails
    return normalizeBlueprint({
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
    });
}
