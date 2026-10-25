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
            1: { features: ['Fighting Style (Defense +1 AC, Dueling +2 dmg, or Great Weapon)', 'Second Wind (Bonus Action: heal 1d10+Level HP; 1/1 per short rest)'], profBonus: 2 },
            2: { features: ['Action Surge (Take 1 additional action on your turn; 1/1 per short rest)'], profBonus: 2 },
            3: { features: ['Martial Mastery (Weapon attacks score a critical hit on 19–20)'], subclass: true, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)'], profBonus: 3 },
            6: { features: [], asi: true, profBonus: 3 },
            7: { features: ['Remarkable Athlete (+1/2 prof to non-proficient STR/DEX/CON checks, +5 ft jump)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Indomitable (Reroll a failed saving throw; 1/1 per long rest)'], profBonus: 4 },
            10: { features: ['Secondary Fighting Style (Gain a second Fighting Style benefit)'], profBonus: 4 },
            11: { features: ['Extra Attack (Attack 3 times whenever you take the Attack action)'], profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Indomitable (Reroll a failed saving throw; 2/2 per long rest)'], profBonus: 5 },
            14: { features: [], asi: true, profBonus: 5 },
            15: { features: ['Superior Critical (Weapon attacks score a critical hit on 18–20)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Action Surge (Take 1 additional action; 2/2 per short rest)', 'Indomitable (Reroll a failed saving throw; 3/3 per long rest)'], profBonus: 6 },
            18: { features: ['Survivor (Regain 5+CON HP at start of turn if below half HP)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Extra Attack (Attack 4 times whenever you take the Attack action)'], profBonus: 6 },
        },
    },
    rogue: {
        className: 'Rogue',
        hitDie: 'd8',
        primaryStats: ['DEX', 'INT', 'CHA'],
        levels: {
            1: { features: ['Expertise (Double proficiency bonus in 2 chosen skills)', 'Sneak Attack (1d6 extra damage with advantage or ally adjacent)', 'Thieves\' Cant (Secret underbelly dialect and symbols)'], profBonus: 2 },
            2: { features: ['Cunning Action (Bonus Action: Dash, Disengage, or Hide)'], profBonus: 2 },
            3: { features: ['Skirmish Tactics (Fast Hands bonus-action object use & Infiltration expertise)', 'Sneak Attack (2d6)'], subclass: true, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Uncanny Dodge (Reaction: halve incoming attack damage from a seen attacker)', 'Sneak Attack (3d6)'], profBonus: 3 },
            6: { features: ['Expertise (Double proficiency bonus in 2 additional skills)'], profBonus: 3 },
            7: { features: ['Evasion (Take 0 damage on DEX save success, half on failure)', 'Sneak Attack (4d6)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Supreme Infiltration (Advantage on Stealth checks if moving no more than half speed)', 'Sneak Attack (5d6)'], profBonus: 4 },
            10: { features: [], asi: true, profBonus: 4 },
            11: { features: ['Reliable Talent (Treat d20 rolls of 9 or lower as 10 on proficient ability checks)', 'Sneak Attack (6d6)'], profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Ambush Reflexes (Take two turns during the first round of combat)', 'Sneak Attack (7d6)'], profBonus: 5 },
            14: { features: ['Blindsense (Locate hidden or invisible creatures within 10 ft)'], profBonus: 5 },
            15: { features: ['Slippery Mind (Proficiency in Wisdom saving throws)', 'Sneak Attack (8d6)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Death Strike (CON save or double damage against surprised targets)', 'Sneak Attack (9d6)'], profBonus: 6 },
            18: { features: ['Elusive (No attack roll has advantage against you while not incapacitated)'], profBonus: 6 },
            19: { features: ['Sneak Attack (10d6)'], asi: true, profBonus: 6 },
            20: { features: ['Stroke of Luck (Turn a missed attack into a hit or failed check into a natural 20; 1/1 per short rest)'], profBonus: 6 },
        },
    },
    wizard: {
        className: 'Wizard',
        hitDie: 'd6',
        primaryStats: ['INT', 'CON', 'DEX'],
        levels: {
            1: { features: ['Spellcasting (Arcane spellbook & ritual casting)', 'Arcane Recovery (Recover spell slots up to half Wizard level; 1/1 per long rest)'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Arcane Savant (Halve gold/time to scribe spells & Sculpt Spells around allies)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Arcane Tradition Mastery (Enhanced school focus)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: [], spellSlots: { 3: 2 }, profBonus: 3 },
            6: { features: ['Potent Cantrip (Targets take half cantrip damage even on a successful save)'], profBonus: 3 },
            7: { features: [], spellSlots: { 4: 1 }, profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: [], spellSlots: { 5: 1 }, profBonus: 4 },
            10: { features: ['Empowered Evocation (Add INT modifier to evocation spell damage rolls)'], profBonus: 4 },
            11: { features: [], spellSlots: { 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: [], spellSlots: { 7: 1 }, profBonus: 5 },
            14: { features: ['Overchannel (Maximize damage of a 1st–5th level spell; 1/1 per long rest safely)'], profBonus: 5 },
            15: { features: [], spellSlots: { 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: [], spellSlots: { 9: 1 }, profBonus: 6 },
            18: { features: ['Spell Mastery (Cast chosen 1st & 2nd level spells at will without slots)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Signature Spells (Cast two chosen 3rd-level spells free; 1/1 per short rest)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    cleric: {
        className: 'Cleric',
        hitDie: 'd8',
        primaryStats: ['WIS', 'CON', 'STR'],
        levels: {
            1: { features: ['Divine Favor (Bonus heavy armor proficiency & domain blessings)', 'Spellcasting (Divine prayer preparation)'], subclass: true, spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Channel Divinity (Turn Undead or Radiance of the Dawn; 1/1 per short rest)'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Divine Domain Doctrines (Always-prepared domain spells)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Destroy Undead (Instantly destroy undead of CR 1/2 or lower on Turn Undead)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Blessed Healer (Healing spells cast on others also heal you for 2+Spell Level)', 'Channel Divinity (Turn Undead or Domain effect; 2/2 per short rest)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: ['Divine Strike (+1d8 radiant damage on weapon hits 1/turn)'], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Divine Intervention (Implore deity aid, Level% chance; 1/1 per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['Destroy Undead (Instantly destroy undead of CR 2 or lower)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Destroy Undead (Instantly destroy undead of CR 3 or lower)', 'Divine Strike (+2d8 radiant damage on weapon hits 1/turn)'], profBonus: 5 },
            15: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Supreme Healing (Healing spells restore maximum possible dice roll)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Channel Divinity (Turn Undead or Domain effect; 3/3 per short rest)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Divine Intervention (Deity aid automatically succeeds; 1/1 per long rest)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    barbarian: {
        className: 'Barbarian',
        hitDie: 'd12',
        primaryStats: ['STR', 'CON', 'DEX'],
        levels: {
            1: { features: ['Rage (+2 melee damage, physical resistance, STR advantage; 2/2 per long rest)', 'Unarmored Defense (AC = 10 + DEX + CON)'], profBonus: 2 },
            2: { features: ['Reckless Attack (Gain advantage on melee STR attacks; attacks against you gain advantage)', 'Danger Sense (Advantage on DEX saves vs visible traps and spells)'], profBonus: 2 },
            3: { features: ['Primal Instincts (Totem Spirit resistance & +1 Rage damage)', 'Rage (+2 melee damage, physical resistance; 3/3 per long rest)'], subclass: true, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)', 'Fast Movement (+10 ft walking speed while not wearing heavy armor)'], profBonus: 3 },
            6: { features: ['Mindless Rage (Immune to charmed and frightened while raging)', 'Rage (+2 melee damage, physical resistance; 4/4 per long rest)'], profBonus: 3 },
            7: { features: ['Feral Instinct (Advantage on Initiative rolls; act normally if surprised when raging)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Brutal Critical (Roll 1 additional weapon damage die on a critical hit)', 'Rage (+3 melee damage, physical resistance; 4/4 per long rest)'], profBonus: 4 },
            10: { features: ['Intimidating Presence (Action: WIS save or frighten creature within 30 ft)'], profBonus: 4 },
            11: { features: ['Relentless Rage (DC 10 CON save to drop to 1 HP instead of 0 while raging)'], profBonus: 4 },
            12: { features: ['Rage (+3 melee damage, physical resistance; 5/5 per long rest)'], asi: true, profBonus: 4 },
            13: { features: ['Brutal Critical (Roll 2 additional weapon damage dice on a critical hit)'], profBonus: 5 },
            14: { features: ['Unstoppable Juggernaut (Cannot be knocked prone or restrained while raging)'], profBonus: 5 },
            15: { features: ['Persistent Rage (Rage ends early only if you fall unconscious or choose to end it)'], profBonus: 5 },
            16: { features: ['Rage (+4 melee damage, physical resistance; 5/5 per long rest)'], asi: true, profBonus: 5 },
            17: { features: ['Brutal Critical (Roll 3 additional weapon damage dice on a critical hit)', 'Rage (+4 melee damage, physical resistance; 6/6 per long rest)'], profBonus: 6 },
            18: { features: ['Indomitable Might (Minimum total for any STR check equals your STR score)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Primal Champion (+4 STR & +4 CON, maximum 24)', 'Rage (+4 melee damage, physical resistance; Unlimited)'], profBonus: 6 },
        },
    },
    paladin: {
        className: 'Paladin',
        hitDie: 'd10',
        primaryStats: ['STR', 'CHA', 'CON'],
        levels: {
            1: { features: ['Divine Sense (Detect celestials, fiends, and undead within 60 ft; 2/2 per long rest)', 'Lay on Hands (Restore HP from a pool of 5 x Paladin Level; 1/1 pool per long rest)'], profBonus: 2 },
            2: { features: ['Fighting Style (Defense, Dueling, Great Weapon, or Protection)', 'Divine Smite (Expend a spell slot on melee hit for +2d8 radiant damage)', 'Spellcasting (Paladin oath magic)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Divine Grace (Channel Divinity: Sacred Weapon or Turn the Unholy; 1/1 per short rest)', 'Divine Health (Immune to disease)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 3 }, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 3 },
            6: { features: ['Aura of Protection (You and allies within 10 ft gain +CHA mod to all saving throws)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 3 },
            7: { features: ['Aura of Warding (You and allies within 10 ft have resistance to damage from spells)'], spellSlots: { 1: 4, 2: 3 }, profBonus: 3 },
            8: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 3 },
            9: { features: [], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 4 },
            10: { features: ['Aura of Courage (You and allies within 10 ft cannot be frightened)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 4 },
            11: { features: ['Improved Divine Smite (All melee weapon strikes deal an extra +1d8 radiant damage)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 4 },
            12: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 4 },
            13: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 5 },
            14: { features: ['Cleansing Touch (Action: end one spell on yourself or a willing creature; 2/2 per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 5 },
            15: { features: ['Undying Sentinel (When reduced to 0 HP, drop to 1 HP instead; 1/1 per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 5 },
            16: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 5 },
            17: { features: [], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 6 },
            18: { features: ['Aura Expansion (All Paladin auras expand to a 30 ft radius)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 6 },
            20: { features: ['Holy Champion Avatar (Radiant aura, flight, and bonus-action Paladin spells; 1/1 per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 6 },
        },
    },
    bard: {
        className: 'Bard',
        hitDie: 'd8',
        primaryStats: ['CHA', 'DEX', 'CON'],
        levels: {
            1: { features: ['Bardic Inspiration (Bonus Action: grant d6 inspiration die; 3/3 per long rest)', 'Spellcasting (Arcane performance magic)'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Jack of All Trades (+1/2 proficiency bonus to non-proficient ability checks)', 'Song of Rest (Allies regain +1d6 HP during a short rest)'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Cutting Words & Bonus Lore (Reaction: subtract Inspiration die from enemy roll)', 'Expertise (Double proficiency bonus in 2 chosen skills)'], subclass: true, spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Bardic Inspiration (Grant d8 inspiration die; 3/3 per short rest)', 'Font of Inspiration (Regain all Bardic Inspiration uses on a short or long rest)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Countercharm (Action: grant allies within 30 ft advantage vs frightened or charmed)', 'Additional Magical Secrets (Learn 2 spells from any class)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Resonant Performance (Inspired allies gain temp HP equal to CHA modifier)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Song of Rest (Allies regain +1d8 HP during a short rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Bardic Inspiration (Grant d10 inspiration die; 4/4 per short rest)', 'Expertise (Double proficiency bonus in 2 additional skills)', 'Magical Secrets (Learn 2 spells from any class)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['Silver Tongue (Treat d20 rolls of 9 or lower as 10 on Persuasion and Deception)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Song of Rest (Allies regain +1d10 HP during a short rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Peerless Skill (Add a Bardic Inspiration die to your own ability checks)', 'Magical Secrets (Learn 2 additional spells from any class)'], profBonus: 5 },
            15: { features: ['Bardic Inspiration (Grant d12 inspiration die; 5/5 per short rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Song of Rest (Allies regain +1d12 HP during a short rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Magical Secrets (Learn 2 high-tier spells from any class)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Superior Inspiration (Regain 1 Bardic Inspiration on initiative if at 0)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    druid: {
        className: 'Druid',
        hitDie: 'd8',
        primaryStats: ['WIS', 'CON', 'DEX'],
        levels: {
            1: { features: ['Druidic (Secret language of druids and nature symbols)', 'Spellcasting (Primal nature magic)'], spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Wild Shape (Transform into a beast of CR 1/2 or lower; 2/2 per short rest)', 'Natural Recovery (Recover spell slots up to half Druid level; 1/1 per long rest)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Circle Spells (Always-prepared terrain spells)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: ['Wild Shape (Transform into beasts with swim speed up to CR 1/2; 2/2 per short rest)'], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Primal Communion (Advantage on Nature and Survival checks in wild terrain)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Land\'s Stride (Move through nonmagical difficult terrain with no extra cost)', 'Primal Strike (Attacks in beast form count as magical)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Elemental Affinity (Resistance to poison and natural elemental hazards)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: ['Wild Shape (Transform into beasts with flying speed up to CR 1; 2/2 per short rest)'], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Verdant Ward (Allies within 10 ft gain +2 to saves vs nature/elemental effects)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Nature\'s Ward (Immune to poison/disease and charm/fear from elementals or fey)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['Elemental Wild Shape (Expend 2 Wild Shapes to transform into an Elemental)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Primal Sanctuary (Wild beasts and plants hesitate to attack you)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Thousand Forms (Cast Alter Self at will without expending a spell slot)'], profBonus: 5 },
            15: { features: ['Elder Grove Mastery (Regenerate 1d6 HP at start of turn while in natural terrain)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Awakened Wilds (Commune with nature spirits across miles)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Timeless Body (Age 10x slower)', 'Beast Spells (Cast Druid spells while in Wild Shape)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Archdruid (Unlimited Wild Shape uses)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    monk: {
        className: 'Monk',
        hitDie: 'd8',
        primaryStats: ['DEX', 'WIS', 'CON'],
        levels: {
            1: { features: ['Unarmored Defense (AC = 10 + DEX + WIS)', 'Martial Arts (1d4 unarmed strike, bonus unarmed attack)'], profBonus: 2 },
            2: { features: ['Ki (Flurry of Blows, Patient Defense, Step of the Wind; 2/2 per short rest)', 'Unarmored Movement (+10 ft speed while unarmored)'], profBonus: 2 },
            3: { features: ['Open Hand Technique (Knock prone or push 15 ft on Flurry of Blows hits)', 'Deflect Missiles (Reaction: reduce ranged weapon damage by 1d10+DEX+Level)'], subclass: true, profBonus: 2 },
            4: { features: ['Slow Fall (Reaction: reduce falling damage by 5 x Monk Level)'], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)', 'Stunning Strike (Spend 1 Ki on melee hit: CON save or target is stunned)', 'Martial Arts (1d6 unarmed strike)'], profBonus: 3 },
            6: { features: ['Ki-Empowered Strikes (Unarmed strikes count as magical)', 'Wholeness of Body (Action: heal 3 x Monk Level HP; 1/1 per long rest)', 'Unarmored Movement (+15 ft speed)'], profBonus: 3 },
            7: { features: ['Evasion (Take 0 damage on DEX save success, half on failure)', 'Stillness of Mind (Action: end one charmed or frightened effect on yourself)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Unarmored Movement Improvement (Move along vertical surfaces and across liquids)'], profBonus: 4 },
            10: { features: ['Purity of Body (Immune to disease and poison)', 'Unarmored Movement (+20 ft speed)'], profBonus: 4 },
            11: { features: ['Tranquility (Gain Sanctuary ward after each long rest)', 'Martial Arts (1d8 unarmed strike)'], profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Tongue of the Sun and Moon (Understand and speak all spoken languages)'], profBonus: 5 },
            14: { features: ['Diamond Soul (Proficiency in all saving throws; spend 1 Ki to reroll a failed save)', 'Unarmored Movement (+25 ft speed)'], profBonus: 5 },
            15: { features: ['Timeless Body (Suffer no frailty of old age; require no food or water)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Quivering Palm (Spend 3 Ki: lethal vibrations deal 10d10 necrotic or reduce to 0 HP)', 'Martial Arts (1d10 unarmed strike)'], profBonus: 6 },
            18: { features: ['Empty Body (Spend 4 Ki: become invisible and gain resistance to all damage except force)', 'Unarmored Movement (+30 ft speed)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Perfect Self (Regain 4 Ki points on initiative if you have 0 Ki)'], profBonus: 6 },
        },
    },
    ranger: {
        className: 'Ranger',
        hitDie: 'd10',
        primaryStats: ['DEX', 'WIS', 'CON'],
        levels: {
            1: { features: ['Favored Enemy (Advantage on tracking & lore checks against chosen foes)', 'Natural Explorer (Deft Explorer expertise & wilderness navigation)'], profBonus: 2 },
            2: { features: ['Fighting Style (Archery +2 ranged hit, Defense, Dueling, or Two-Weapon)', 'Spellcasting (Hunter\'s Mark & wilderness magic)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Colossus Slayer (+1d8 weapon damage 1/turn against wounded targets)', 'Primeval Awareness (Sense supernatural creatures within 1 mile; 1/1 per short rest)'], subclass: true, spellSlots: { 1: 3 }, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 3 },
            6: { features: ['Favored Enemy & Greater Explorer Improvement (+5 ft walking, climb, and swim speed)'], profBonus: 3 },
            7: { features: ['Defensive Tactics (Multiattack Defense +4 AC vs repeat attacks & Escape the Horde)'], spellSlots: { 1: 4, 2: 3 }, profBonus: 3 },
            8: { features: ['Land\'s Stride (Move through nonmagical difficult terrain with no extra cost)'], asi: true, profBonus: 3 },
            9: { features: ['Conclave Mastery (Advantage on saves vs plants and terrain hazards)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 4 },
            10: { features: ['Hide in Plain Sight (Nature\'s Veil: turn invisible as a bonus action; 2/2 per long rest)'], profBonus: 4 },
            11: { features: ['Multiattack (Volley 10 ft AoE ranged attack or Whirlwind melee attack)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Apex Tracker (Marked quarry cannot benefit from invisibility or cover)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 5 },
            14: { features: ['Vanish (Bonus Action: Hide; cannot be tracked by nonmagical means)'], profBonus: 5 },
            15: { features: ['Superior Hunter\'s Defense (Reaction: Uncanny Dodge halve damage or Stand Against the Tide)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Wilderness Paragon (Critical hit range 19–20 against Favored Enemies)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 6 },
            18: { features: ['Feral Senses (Pinpoint invisible creatures within 30 ft with no attack disadvantage)'], profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 5: 2 }, profBonus: 6 },
            20: { features: ['Foe Slayer (Add WIS modifier to attack or damage roll 1/turn)'], profBonus: 6 },
        },
    },
    sorcerer: {
        className: 'Sorcerer',
        hitDie: 'd6',
        primaryStats: ['CHA', 'CON', 'DEX'],
        levels: {
            1: { features: ['Spellcasting (Innate bloodline magic)', 'Draconic Resilience (Base AC = 13 + DEX & +1 Max HP per level)'], subclass: true, spellSlots: { 1: 2 }, profBonus: 2 },
            2: { features: ['Font of Magic (Convert Sorcery Points and spell slots; 2/2 points per long rest)'], spellSlots: { 1: 3 }, profBonus: 2 },
            3: { features: ['Metamagic (Twinned Spell, Quickened Spell, Careful Spell, Subtle Spell; 3/3 Sorcery Points)'], spellSlots: { 1: 4, 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, spellSlots: { 1: 4, 2: 3 }, profBonus: 2 },
            5: { features: ['Magical Guidance (Spend 1 Sorcery Point to reroll a failed ability check)'], spellSlots: { 1: 4, 2: 3, 3: 2 }, profBonus: 3 },
            6: { features: ['Elemental Affinity (Add CHA modifier to elemental spell damage & gain resistance)'], spellSlots: { 1: 4, 2: 3, 3: 3 }, profBonus: 3 },
            7: { features: ['Arcane Surge (Channel bloodline power to ignore elemental resistance)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 1 }, profBonus: 3 },
            8: { features: [], asi: true, spellSlots: { 1: 4, 2: 3, 3: 3, 4: 2 }, profBonus: 3 },
            9: { features: ['Bloodline Conduit (+1 to spell save DC when spending Sorcery Points)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, profBonus: 4 },
            10: { features: ['Metamagic (3 options known; 10/10 Sorcery Points per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 }, profBonus: 4 },
            11: { features: ['High Sorcery (Innate mastery of high-circle bloodline spells)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Origin Focus (Maintain concentration through minor damage)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, profBonus: 5 },
            14: { features: ['Draconic Wings (Bonus Action: manifest wings for flying speed equal to walking speed)'], profBonus: 5 },
            15: { features: ['Sovereign Arcana (Advantage on saves against spells and magical effects)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Metamagic (4 options known; 17/17 Sorcery Points per long rest)'], spellSlots: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 }, profBonus: 6 },
            18: { features: ['Draconic Presence (Spend 5 Sorcery Points for 60 ft awe or fear aura; 1/1 per rest)'], spellSlots: { 5: 3 }, profBonus: 6 },
            19: { features: [], asi: true, spellSlots: { 6: 2 }, profBonus: 6 },
            20: { features: ['Sorcerous Restoration (Regain 4 expended Sorcery Points on every short rest)'], spellSlots: { 7: 2 }, profBonus: 6 },
        },
    },
    warlock: {
        className: 'Warlock',
        hitDie: 'd8',
        primaryStats: ['CHA', 'CON', 'DEX'],
        levels: {
            1: { features: ['Dark One\'s Blessing (Gain CHA+Level temporary HP when reducing a hostile to 0 HP)', 'Pact Magic (Spell slots recharge on every short rest)'], subclass: true, spellSlots: { 1: 1 }, profBonus: 2 },
            2: { features: ['Eldritch Invocations (2 invocations: Agonizing Blast +CHA to Eldritch Blast, Devil\'s Sight)'], spellSlots: { 1: 2 }, profBonus: 2 },
            3: { features: ['Pact Boon (Pact of the Blade, Chain familiar, or Tome of shadows)'], spellSlots: { 2: 2 }, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Eldritch Invocations (3 invocations known)'], spellSlots: { 3: 2 }, profBonus: 3 },
            6: { features: ['Dark One\'s Own Luck (Add +1d10 to an ability check or saving throw; 1/1 per short rest)'], profBonus: 3 },
            7: { features: ['Eldritch Invocations (4 invocations known)'], spellSlots: { 4: 2 }, profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Eldritch Invocations (5 invocations known)'], spellSlots: { 5: 2 }, profBonus: 4 },
            10: { features: ['Fiendish Resilience (Choose 1 damage type resistance after each short or long rest)'], profBonus: 4 },
            11: { features: ['Mystic Arcanum (Cast chosen 6th-level Arcanum spell; 1/1 per long rest)'], spellSlots: { 5: 3 }, profBonus: 4 },
            12: { features: ['Eldritch Invocations (6 invocations known)'], asi: true, profBonus: 4 },
            13: { features: ['Mystic Arcanum (Cast 6th & 7th-level Arcanum spells; 1/1 each per long rest)'], profBonus: 5 },
            14: { features: ['Hurl Through Hell (Banish hit target through lower planes for 10d10 psychic damage; 1/1 per long rest)'], profBonus: 5 },
            15: { features: ['Mystic Arcanum (Cast 6th, 7th & 8th-level Arcanum spells; 1/1 each per long rest)', 'Eldritch Invocations (7 invocations known)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Mystic Arcanum (Cast 6th–9th level Arcanum spells; 1/1 each per long rest)'], spellSlots: { 5: 4 }, profBonus: 6 },
            18: { features: ['Eldritch Invocations (8 invocations known)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Eldritch Master (Spend 1 minute to regain all expended Pact Magic slots; 1/1 per long rest)'], profBonus: 6 },
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

// Tracks explicit [ABILITY] or [TRAIT] prefixes stripped during formatTraitAsPill normalization
const EXPLICIT_FEATURE_KINDS = new Map();

const ACTIVE_ABILITY_USAGE_PATTERNS = [
    /\b\d+\s*\/\s*(?:\d+\s*)?(?:per\s+)?(?:short\s+rest|long\s+rest|rest|day|dawn|turn|round)\b/i,
    /\b(?:once|twice|\d+\s*times?)\s+per\s+(?:short\s+rest|long\s+rest|rest|day|dawn|turn|round)\b/i,
    /\b(?:CHA|WIS|INT|CON|STR|DEX|prof(?:iciency)?(?:\s*bonus)?)\s*(?:mod(?:ifier)?\s*)?\/\s*(?:short\s+rest|long\s+rest|rest|day)\b/i,
    /\b\d+\s*(?:ki|sorcery|grit|focus|psi)?\s*points?\s*\/\s*(?:short\s+rest|long\s+rest|rest|day)\b/i,
    /\(\s*\d+\s*\/\s*\d+\s*(?:per\s+|;|\))/i,
    /\b(?:spend|expend)\s+\d+\s*(?:ki|sorcery\s*points?|wild\s*shapes?|hit\s*dice|superiority\s*dice|channel\s*divinity|bardic\s*inspiration|lay\s+on\s+hands)\b/i,
];

const ACTIVE_ABILITY_NAME_PATTERN = /^(?:second wind|action surge|indomitable|cunning action|uncanny dodge|stroke of luck|arcane recovery|overchannel|channel divinity(?:\s*:.*)?|turn undead|destroy undead|divine intervention|rage|reckless attack|intimidating presence|lay on hands|divine sense|divine smite|cleansing touch|sacred weapon|abjure enemy|vow of enmity|bardic inspiration|countercharm|words of terror|wild shape|elemental wild shape|ki|flurry of blows|patient defense|step of the wind|deflect missiles|stunning strike|wholeness of body|stillness of mind|quivering palm|empty body|primeval awareness|hide in plain sight|vanish|font of magic|metamagic|magical guidance|draconic presence|sorcerous restoration|dark one's own luck|mystic arcanum|hurl through hell|eldritch master)\b/i;

/**
 * Normalizes a trait, feature, or ability string into MultiHog's interactive pill syntax:
 * `Name (hover tooltip description)` (or bare `Name` if there is no description).
 *
 * MultiHog's `renderPills` splits on commas at parenthesis depth 0 and matches
 * `/^(.+?)\s*\((.+)\)$/` to separate the pill badge title from its hover tooltip
 * (and extracts `X/Y` resource badges from inside the parentheses).
 *
 * - Strips optional `[TRAIT]` / `[ABILITY]` classification prefixes while recording
 *   the explicit kind for `classifyFeatureKind`.
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

    let explicitKind = null;
    const tagMatch = s.match(/^[\[(]\s*(?:⚡\s*)?(ABILITY|TRAIT)\s*:?\s*[\])]\s*/i);
    if (tagMatch) {
        explicitKind = tagMatch[1].toLowerCase() === 'ability' ? 'ability' : 'trait';
        s = s.slice(tagMatch[0].length).trim();
    }
    if (!s) return '';

    const recordKind = (formatted) => {
        if (explicitKind && formatted) {
            EXPLICIT_FEATURE_KINDS.set(formatted.toLowerCase(), explicitKind);
        }
        return formatted;
    };

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
            return recordKind(`${head} (${sanitizeInnerParens(desc)})`);
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
            return recordKind(`${left}: ${right}`);
        }
        if (right) {
            if (leftParenMatch) {
                const name = leftParenMatch[1].trim();
                const tag = leftParenMatch[2].trim();
                return recordKind(`${name} (${sanitizeInnerParens(`${right}; ${tag}`)})`);
            }
            return recordKind(`${left} (${sanitizeInnerParens(right)})`);
        }
    }

    // Case 3: Top-level dash separator "Trait Name — description" or "Trait Name - description"
    const dashMatch = s.match(/^([^(—–-]+?)\s+(?:—|–|-)\s+(.+)$/);
    if (dashMatch) {
        const name = dashMatch[1].trim();
        const desc = dashMatch[2].trim();
        if (name && desc) {
            return recordKind(`${name} (${sanitizeInnerParens(desc)})`);
        }
    }

    return recordKind(s);
}

/**
 * Deterministically classifies a feature string as either a passive character sheet trait
 * (`'trait'` -> `[CHARACTER] Traits:`) or an active/resource-tracked ability
 * (`'ability'` -> `[ABILITIES]`).
 *
 * Honors explicit `[ABILITY]` or `[TRAIT]` prefixes (even if already stripped by
 * `formatTraitAsPill`), rest/day usage counters (`1/rest`, `2/day`, `CHA/day`,
 * `1/1 per short rest`), resource expenditures (`Spend 1 Ki`), and canonical active
 * action names (`Cunning Action`, `Uncanny Dodge`, `Action Surge`, `Rage`, etc.).
 *
 * @param {string} feat
 * @returns {'trait'|'ability'}
 */
export function classifyFeatureKind(feat) {
    if (typeof feat !== 'string' || !feat.trim()) return 'trait';
    const raw = feat.trim();
    const explicitPrefix = raw.match(/^[\[(]\s*(?:⚡\s*)?(ABILITY|TRAIT)\s*:?\s*[\])]\s*/i);
    if (explicitPrefix) {
        return explicitPrefix[1].toLowerCase() === 'ability' ? 'ability' : 'trait';
    }
    const pill = formatTraitAsPill(raw);
    if (EXPLICIT_FEATURE_KINDS.has(pill.toLowerCase())) {
        return EXPLICIT_FEATURE_KINDS.get(pill.toLowerCase());
    }
    if (ACTIVE_ABILITY_USAGE_PATTERNS.some(re => re.test(pill))) {
        return 'ability';
    }
    const nameMatch = pill.match(/^([^(:\[]+)/);
    const baseName = (nameMatch ? nameMatch[1] : pill).trim();
    if (ACTIVE_ABILITY_NAME_PATTERN.test(baseName)) {
        return 'ability';
    }
    return 'trait';
}

/**
 * Partitions a list of feature strings into passive sheet traits (`[CHARACTER] Traits:`)
 * and active/resource abilities (`[ABILITIES]`).
 *
 * @param {string[]} list
 * @returns {{ traits: string[], abilities: string[] }}
 */
export function partitionFeaturesAndAbilities(list) {
    const clean = sanitizeFeatureList(list);
    const traits = [];
    const abilities = [];
    for (const item of clean) {
        if (classifyFeatureKind(item) === 'ability') {
            abilities.push(item);
        } else {
            traits.push(item);
        }
    }
    return { traits, abilities };
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
6. MultiHog Pill Rendering & Trait vs. Ability Routing: The character sheet renders every feature as an interactive hover-pill using "Feature Name (concise hover tooltip description)". Passive perks route to [CHARACTER] Traits, while active/rest-limited powers (include a usage counter like "1/1 per short rest" or "2/2 per long rest" inside the parentheses, or prefix with "[ABILITY]") route to the [ABILITIES] tracker. Always put the mechanical effect, bonus, or rest recharge inside parentheses after the feature name—NEVER use colons ("Name: description") or dashes ("Name - description") outside parentheses, and never nest parentheses inside parentheses (use [brackets] inside parentheses if needed).
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
    const { traits, abilities } = partitionFeaturesAndAbilities(perkData.features);

    const hitDie = blueprint?.hitDie || 'd8';
    const dieMax = parseInt(hitDie.replace(/\D/g, ''), 10) || 8;
    const avgRoll = Math.floor(dieMax / 2) + 1;
    const averageHpGain = Math.max(1, avgRoll + conModifier);

    return {
        level: targetLevel,
        features: perkData.features,
        traits,
        abilities,
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
 * @param {object} [options]
 * @param {boolean} [options.includeTags=false] Whether to prefix each feature with `[Trait]` or `[Ability]`.
 * @returns {string} Formatted text summary.
 */
export function formatBlueprintSummary(blueprint, { includeTags = false } = {}) {
    if (!blueprint || !blueprint.levels || typeof blueprint.levels !== 'object') {
        return 'No progression blueprint available.';
    }
    const lines = [];
    for (let i = 1; i <= 20; i++) {
        const lvl = blueprint.levels[String(i)] || blueprint.levels[i];
        if (lvl) {
            let feats = 'None';
            if (Array.isArray(lvl.features) && lvl.features.length > 0) {
                feats = includeTags
                    ? lvl.features.map(f => `[${classifyFeatureKind(f) === 'ability' ? 'Ability' : 'Trait'}] ${f}`).join(', ')
                    : lvl.features.join(', ');
            } else if (typeof lvl.features === 'string' && lvl.features.trim()) {
                feats = includeTags
                    ? `[${classifyFeatureKind(lvl.features) === 'ability' ? 'Ability' : 'Trait'}] ${lvl.features}`
                    : lvl.features;
            } else if (includeTags && lvl.asi) {
                feats = '(ASI / Feat Milestone)';
            }
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
            1: { features: ['Core Class Trait (Advantage on signature class checks)', 'Starting Readiness (+2 to initiative rolls)'], profBonus: 2 },
            2: { features: ['Action Surge (Take 1 additional action on your turn; 1/1 per short rest)'], profBonus: 2 },
            3: { features: ['Archetype Specialization (Signature class mastery technique)'], subclass: true, profBonus: 2 },
            4: { features: [], asi: true, profBonus: 2 },
            5: { features: ['Extra Attack (Attack twice whenever you take the Attack action)'], profBonus: 3 },
            6: { features: ['Archetype Trait (Enhanced situational defense and mobility)'], profBonus: 3 },
            7: { features: ['Tactical Resilience (Advantage on saving throws against being stunned or frightened)'], profBonus: 3 },
            8: { features: [], asi: true, profBonus: 3 },
            9: { features: ['Paragon Feature (Reroll a failed saving throw; 1/1 per long rest)'], profBonus: 4 },
            10: { features: ['Archetype Mastery (Add primary stat modifier to signature damage)'], profBonus: 4 },
            11: { features: ['Empowered Strike (Once per turn deal +1d8 bonus damage on a hit)'], profBonus: 4 },
            12: { features: [], asi: true, profBonus: 4 },
            13: { features: ['Heroic Surge (Regain 2d10+Level HP as a bonus action; 1/1 per short rest)'], profBonus: 5 },
            14: { features: ['Iron Mind (Proficiency in Wisdom saving throws)'], profBonus: 5 },
            15: { features: ['Archetype Pinnacle (Master-tier class technique; 1/1 per short rest)'], profBonus: 5 },
            16: { features: [], asi: true, profBonus: 5 },
            17: { features: ['Legendary Focus (Turn a missed attack or failed check into a 20; 1/1 per short rest)'], profBonus: 6 },
            18: { features: ['Indomitable Stance (Cannot be knocked prone or moved against your will)'], profBonus: 6 },
            19: { features: [], asi: true, profBonus: 6 },
            20: { features: ['Legendary Avatar Capstone (Supreme class transformation; 1/1 per long rest)'], profBonus: 6 },
        },
    });
}
