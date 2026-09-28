/**
 * pbta-ruleset.js — MultiHog Companion
 *
 * Provides Powered by the Apocalypse (PbtA) Game Cartridge definitions,
 * genre stat presets, and seamless integration with Multihog's Quick Start.
 */

export const PBTA_CARTRIDGE_ID = 'pbta_narrative_engine_v1';
export const CARTRIDGE_FORMAT = 'multihog-game-cartridge';
export const CARTRIDGE_VERSION = 1;

/**
 * Genre configurations with specific stats, moves, and archetypes.
 */
export const PBTA_GENRES = {
    fantasy: {
        id: 'fantasy',
        label: 'Fantasy (Dungeon World / Fellowship)',
        icon: '⚔️',
        multihogGenre: 'fantasy',
        stats: ['Might', 'Agility', 'Wits', 'Heart', 'Arcana'],
        statDescriptions: 'Might (melee/force), Agility (finesse/speed), Wits (lore/perception), Heart (courage/empathy), Arcana (spells/relics)',
        archetypes: ['Fighter', 'Rogue', 'Wizard', 'Cleric', 'Ranger', 'Bard', 'Paladin', 'Druid'],
        moves: [
            'Hack & Slash (+Might) — engage an enemy in melee combat',
            'Volley (+Agility) — aim and shoot an enemy at range',
            'Defy Danger (+Attribute) — act despite imminent threat or disaster',
            'Cast a Spell (+Arcana) — channel arcane or divine magic',
            'Discern Realities (+Wits) — closely observe a person or situation',
            'Parley (+Heart) — press for what you want when you have leverage',
        ],
    },
    scifi: {
        id: 'scifi',
        label: 'Sci-Fi / Cyberpunk (The Sprawl / Scum)',
        icon: '🚀',
        multihogGenre: 'scifi',
        stats: ['Cool', 'Edge', 'Hard', 'Mind', 'Synth'],
        statDescriptions: 'Cool (calm under fire), Edge (reflexes/acrobatics), Hard (violence/force), Mind (tech/hacking), Synth (street cred/social)',
        archetypes: ['Netrunner', 'Mercenary', 'Star Pilot', 'Tech Specialist', 'Infiltrator', 'Bounty Hunter'],
        moves: [
            'Act Under Pressure (+Cool) — maintain composure when the stakes are lethal',
            'Engage Hostiles (+Hard or +Edge) — exchange fire or brawl in close quarters',
            'Jack In / Hack (+Mind) — breach ICE and interface with digital matrices',
            'Fast-Talk (+Synth) — bluff, negotiate, or trade on street reputation',
            'Assess Situation (+Mind) — spot tactical vantage points, hidden cameras, or exits',
        ],
    },
    anime: {
        id: 'anime',
        label: 'Anime / Shonen (Masks / Heroic)',
        icon: '✨',
        multihogGenre: 'fantasy', // MultiHog mapping fallback
        stats: ['Danger', 'Freak', 'Savior', 'Superior', 'Mundane'],
        statDescriptions: 'Danger (reckless power), Freak (superhuman abilities), Savior (protecting others), Superior (tactical arrogance), Mundane (human emotion)',
        archetypes: ['The Prodigy', 'The Hothead', 'The Chosen One', 'The Mentor', 'The Outsider', 'The Transformed'],
        moves: [
            'Directly Engage (+Danger) — charge in to clash with a rival or villain',
            'Unleash Powers (+Freak) — push superhuman energy or hidden potential past limits',
            'Take a Blow (+Savior) — dive in front of an attack to shield a friend',
            'Provoke (+Superior) — taunt or outsmart an opponent into making a mistake',
            'Pierce the Mask (+Mundane) — see through someone’s tough exterior into their true feelings',
        ],
    },
    horror: {
        id: 'horror',
        label: 'Modern / Horror (Monster of the Week)',
        icon: '🩸',
        multihogGenre: 'horror',
        stats: ['Cool', 'Hard', 'Hot', 'Sharp', 'Weird'],
        statDescriptions: 'Cool (calmness/driving), Hard (physical violence), Hot (charm/manipulation), Sharp (investigation/clues), Weird (occult/magic)',
        archetypes: ['The Hunter', 'The Occultist', 'The Detective', 'The Survivor', 'The Spooky', 'The Scholar'],
        moves: [
            'Kick Some Ass (+Hard) — engage a supernatural beast or hostile in combat',
            'Investigate a Mystery (+Sharp) — search a crime scene, analyze runes, or follow clues',
            'Act Under Fire (+Cool) — keep your nerve when confronted by eldritch horrors',
            'Manipulate Someone (+Hot) — get a civilian or official to do what you need',
            'Use Magic (+Weird) — chant a ritual or invoke esoteric rites',
        ],
    },
};

/**
 * Builds the PbtA role prompt section.
 */
export function buildPbtARoleContent() {
    return `<role>
Referee / Master of Ceremonies (MC) for a Powered by the Apocalypse (PbtA) narrative roleplaying game. 
Narrate the world, portray NPCs, maintain dramatic momentum, and adjudicate moves.
CORE PRINCIPLES:
- Be a fan of the protagonist: make them feel capable, but put them in genuine peril.
- Think dangerous: the world is dynamic, reactive, and never safe when swords are drawn or guns are drawn.
- Begin and end with the fiction: outcomes always flow from narrative actions, not abstract math.
- Play to find out what happens: never predetermine plot; let the dice and player choices guide the story.
</role>`;
}

/**
 * Builds the PbtA RNG system section instructions for consuming 2d6 from SillyTavern.
 */
export function buildPbtARngContent() {
    return `<rng_system>
The player NEVER rolls dice manually. SillyTavern silently injects cryptographically random dice in [RNG_QUEUE v7.0].
When the player's described action triggers a Move:
1. Identify the relevant character stat modifier (-3 to +3) from the [CHARACTER] sheet.
2. Pop the next pair of d6 values from [RNG_QUEUE v7.0] (Line 1 d6 + Line 2 d6, or the first two d6 values).
3. Calculate: Roll = (Die 1 + Die 2) + Stat Modifier.
4. Output the roll inline right before narrating its consequence:
   *(Move Name [Stat]: Die1 + Die2 + Mod = Total → Result Tier)*

TRI-STATE OUTCOME RESOLUTION (STRICT):
- 10+ (Strong Hit / Full Success): The player accomplishes their goal cleanly without complication, injury, or collateral damage.
- 7–9 (Weak Hit / Mixed Success): The player accomplishes their goal, BUT at a cost, complication, hard choice, or immediate counter-stroke. (Never a flat fail; always forward narrative momentum).
- 6- (Miss / Trouble): The player fails or the situation dramatically escalates. You (the Ref) make a GM Move (inflict harm, reveal an unwelcome truth, separate them, expend resources, turn their move back on them). The player marks +1 XP.

[FALLBACK]: If no queue is present in the prompt, simulate fair 2d6 internally with the same format.
</rng_system>`;
}

/**
 * Builds the PbtA combat rules section.
 */
export function buildPbtACombatContent() {
    return `<combat>
NO INITIATIVE TURNS. Combat is a cinematic conversation, not round-by-round math.
- NPCs do NOT roll attacks or saving throws. Their actions and counter-attacks happen naturally when the player rolls a 7–9 (compromise/counter-attack) or 6- (miss), or when the player hesitates.
- Enemies do not have bloated HP or AC. They have a threat tier and a Harm clock (typically 1 to 5 Harm to defeat).
- ARMOR: Armor reduces incoming Harm by its value (e.g. Armor 1 turns 3 Harm into 2 Harm).
- HARM TIERS:
  1 Harm: Scratches, bruises, wind knocked out.
  2 Harm: Deep cut, broken bone, moderate injury (-1 forward to physical actions).
  3 Harm: Severe, incapacitating trauma.
  5 Harm: Lethal / dying.
</combat>`;
}

/**
 * Builds the PbtA ruleset note.
 */
export function buildPbtARulesetNoteContent() {
    return `<ruleset_note>
Powered by the Apocalypse (PbtA) ruleset: 2d6 + Stat. 10+ Full Success | 7-9 Mixed Success (Success with cost/complication) | 6- Miss (GM Move + 1 XP). No initiative, no Armor Class math, no enemy attack rolls.
</ruleset_note>`;
}

/**
 * Builds the PbtA output footer.
 */
export function buildPbtAFooterContent() {
    return `<end_of_output_footer>
ALWAYS end every narrative output with:
*(Harm: [current]/5) | (XP: [current]/5) | (Hold: [current]) | (Location: [Coarse, Sub-location])*
Footer shows ONLY {{user}}'s Harm/XP/Hold/location — never party or NPC status.
</end_of_output_footer>`;
}

/**
 * Builds the PbtA XP system.
 */
export function buildPbtAXpContent() {
    return `<xp_system>
- Award 1 XP whenever the player rolls a 6- (Miss) on a Move: *(+1 XP — Miss)*.
- Award 1 XP when a major milestone, personal discovery, or quest objective is resolved: *(+1 XP — [reason])*.
- At 5 XP, the player levels up: *(Level Up! Choose an Advance: +1 to a Stat (max +3), a new Playbook Move, or erase a Condition)*. Reset XP counter to 0/5.
</xp_system>`;
}

/**
 * Generates the stock prompts tailored for a given genre.
 */
export function buildPbtAStockPrompts(genreKey = 'fantasy') {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const statsExample = genre.stats.map((s, idx) => `${s} ${idx === 0 ? '+2' : idx < 3 ? '+1' : idx === 3 ? '+0' : '-1'}`).join(', ');

    return {
        character: `Main character's core stats. MECHANICS ONLY: Never include narrative background or physical appearance in [CHARACTER]. Use this exact format:
[CHARACTER]
{{user}} (Archetype): Harm: 0/5 | Armor: 0
Stats: ${statsExample}
Moves: Move1 (trigger and mechanical effect), Move2 (trigger and mechanical effect)
Gear: Signature weapon/item (tags), everyday gear
Conditions: None
Hold/Forward: None
XP: 0/5
Status: Healthy
[/CHARACTER]`,

        party: `Companion and party members. MECHANICS ONLY. Use this format for each member:
Name (Archetype): Harm: 0/5 | Armor: 0
Stats: ${statsExample}
Moves: Signature Move (effect)
Gear: Weapon (tags) | Armor (value)
Conditions: None
Status: Healthy`,

        combat: `Active enemies and environmental threats in combat.
Group threats under ENEMIES: and NON-PARTY ALLIES: headers.
Use this format:
THREAT LEVEL: (Skirmish / Peril / Catastrophe)
ENEMIES:
Name: Harm [current/max] | Armor [X] | Threat: (Minion / Veteran / Boss)
Attacks: Attack Name (Harm dealt, tags like close/reach/far/messy)
Instinct: (What this threat desires or how it fights, e.g. "To overwhelm with numbers")
Status: Healthy`,
    };
}

/**
 * Builds the complete PbtA Game Cartridge object.
 */
export function buildPbtACartridge(genreKey = 'fantasy') {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

    const customSyspromptLibrary = [
        {
            id: 'pbta_base_override_role',
            tag: 'role',
            content: buildPbtARoleContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA Master of Ceremonies (MC) / Director role',
            origin: 'unlocked_base',
            baseTag: 'role',
        },
        {
            id: 'pbta_base_override_rng',
            tag: 'rng_system',
            content: buildPbtARngContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA 2d6 Move resolution via SillyTavern RNG Queue',
            origin: 'unlocked_base',
            baseTag: 'rng_system',
        },
        {
            id: 'pbta_base_override_combat',
            tag: 'combat',
            content: buildPbtACombatContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA fiction-first combat, Harm tiers, no enemy rolls',
            origin: 'unlocked_base',
            baseTag: 'combat',
        },
        {
            id: 'pbta_base_override_ruleset_note',
            tag: 'ruleset_note',
            content: buildPbtARulesetNoteContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA tri-state outcomes (10+, 7-9, 6-)',
            origin: 'unlocked_base',
            baseTag: 'ruleset_note',
        },
        {
            id: 'pbta_base_override_footer',
            tag: 'end_of_output_footer',
            content: buildPbtAFooterContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA Harm, XP, and Hold footer',
            origin: 'unlocked_base',
            baseTag: 'end_of_output_footer',
        },
        {
            id: 'pbta_base_override_xp',
            tag: 'xp_system',
            content: buildPbtAXpContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA XP on 6- Miss & 5 XP level advancement',
            origin: 'unlocked_base',
            baseTag: 'xp_system',
        },
    ];

    const syspromptModules = {
        // Unlocked overrides active
        role: false,
        rng_system: false,
        combat: false,
        ruleset_note: false,
        end_of_output_footer: false,
        xp_system: false,
        // D&D systems disabled in PbtA
        weapon_proficiencies: false,
        attacks_per_round: false,
        saving_throws: false,
    };

    const payload = {
        customSyspromptLibrary,
        syspromptModules,
        syspromptSectionOrder: [],
        stockPrompts: buildPbtAStockPrompts(genreKey),
        rngEnabled: true,
        rngQueueD20: true, // MultiHog's queue supplies fair d6 pairs on every line
        rngQueueD100: false,
        diceD100Mode: false,
        diceFunctionTool: false, // Ensure zero player interruption
        blockOrder: ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'XP', 'TIME'],
        modules: {
            combat: true,
            character: true,
            party: true,
            inventory: true,
            abilities: true,
            spells: false, // Spells are handled via Moves in PbtA
            xp: true,
            time: true,
        },
    };

    return {
        id: PBTA_CARTRIDGE_ID,
        name: `PbtA Narrative Engine (${genre.label})`,
        description: `Powered by the Apocalypse ruleset: 2d6 moves (10+/7-9/6-), Harm clocks, and zero manual dice rolling. Tailored for ${genre.label}.`,
        icon: genre.icon,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        format: CARTRIDGE_FORMAT,
        version: CARTRIDGE_VERSION,
        payload,
    };
}

/**
 * Builds the Quick Start instructions string passed to MultiHog character creation.
 */
export function buildPbtAQuickStartInstructions(genreKey = 'fantasy', charName = '', customNotes = '') {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

    return [
        `RULES: Powered by the Apocalypse (PbtA) ruleset.`,
        `GENRE: ${genre.label}.`,
        charName ? `NAME: ${charName}.` : null,
        `ATTRIBUTES: Assign standard modifier array (+2, +1, +1, 0, -1) to exactly these five stats: ${genre.stats.join(', ')}.`,
        `STAT DESCRIPTIONS: ${genre.statDescriptions}.`,
        `SUGGESTED ARCHETYPES: ${genre.archetypes.join(', ')}.`,
        `SUGGESTED MOVES (pick 2): ${genre.moves.join('; ')}.`,
        `FORMAT MANDATE: Output [CHARACTER] using Harm: 0/5, Armor, Stats with modifiers, 2 starting Moves, Gear, Conditions: None, Hold/Forward: None, and XP: 0/5. Do NOT output D&D stats (STR/DEX 1-20), AC, BAB, HP, or spell slots.`,
        customNotes ? `ADDITIONAL DETAILS: ${customNotes}` : null,
    ].filter(Boolean).join('\n');
}
