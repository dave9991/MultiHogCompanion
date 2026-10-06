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
        cyoaExamples: [
            '1. ⚔️ Leap forward with blade drawn to strike the beast — [Hack & Slash (+Might)]',
            '2. 🏹 Draw an arrow and aim for the eye socket from distance — [Volley (+Agility)]',
            '3. 🔮 Channel an arcane incantation through your staff — [Cast a Spell (+Arcana)]',
            '4. 👁️ Study the chamber walls for concealed runes or pressure plates — [Discern Realities (+Wits)]',
            '5. 🗣️ "We came for the relic, not blood. Call off your guard and let us talk." — [Parley (+Heart)]',
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
        cyoaExamples: [
            '1. 💥 Draw your sidearm and trade fire through the steam pipes — [Engage Hostiles (+Hard)]',
            '2. 💻 Jack your cyberdeck directly into the security terminal — [Jack In / Hack (+Mind)]',
            '3. 🥷 Vault over the catwalk railing into the darkness below — [Act Under Pressure (+Edge)]',
            '4. 🎙️ "You don\'t want this smoke, omae. Check my crew\'s rep on the street." — [Fast-Talk (+Synth)]',
            '5. 🔍 Scan the maintenance tunnel for power conduits or camera blind spots — [Assess Situation (+Mind)]',
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
        cyoaExamples: [
            '1. 👊 Charge straight into the rival\'s aura and trade blows — [Directly Engage (+Danger)]',
            '2. ⚡ Let your inner power surge past all limits in a blinding blast — [Unleash Powers (+Freak)]',
            '3. 🛡️ Throw yourself in front of the collapsing debris to shield your friend — [Take a Blow (+Savior)]',
            '4. 😏 Smirk and taunt them to draw their focus away from the civilians — [Provoke (+Superior)]',
            '5. 💔 "I know why you\'re doing this... you don\'t have to carry this alone." — [Pierce the Mask (+Mundane)]',
        ],
    },
    horror: {
        id: 'horror',
        label: 'Modern / Monster Hunter (Monster of the Week)',
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
        cyoaExamples: [
            '1. 🪓 Drive the fire axe into the creature\'s clawed arm — [Kick Some Ass (+Hard)]',
            '2. 🔦 Search the bloodstained desk for occult manuscripts or clues — [Investigate a Mystery (+Sharp)]',
            '3. 🏃 Keep your nerve and sprint past the writhing shadows toward the exit — [Act Under Fire (+Cool)]',
            '4. 🗣️ "Look at me! Whatever is in that basement, you have to let us help!" — [Manipulate Someone (+Hot)]',
            '5. 🕯️ Light the ceremonial candles and chant the ward of protection — [Use Magic (+Weird)]',
        ],
    },
    western: {
        id: 'western',
        label: 'Western / Weird West (Deadlands / Dust)',
        icon: '🤠',
        multihogGenre: 'fantasy',
        stats: ['Grit', 'Quick', 'Iron', 'Instinct', 'Savvy'],
        statDescriptions: 'Grit (tenacity/enduring pain), Quick (fast-draw/reflexes/riding), Iron (firearms/dynamite/intimidation), Instinct (tracking/scouting/survival), Savvy (gambling/barter/deception)',
        archetypes: ['The Gunslinger', 'The Outlaw', 'The Lawman', 'The Preacher', 'The Drifter', 'The Gambler', 'The Scout'],
        moves: [
            'Quick Draw (+Quick) — draw and fire before the other side can react',
            'Fan the Hammer (+Iron) — unleash rapid lethal gunfire at point-blank or medium range',
            'Standoff (+Grit) — stare down a rival or withstand pain without flinching',
            'Read the Trail (+Instinct) — track signs across the desert or anticipate an ambush',
            'Silver Tongue (+Savvy) — bluff, cheat at cards, or talk your way out of a hanging',
        ],
        cyoaExamples: [
            '1. 🤠 Draw from the hip and fire two rounds into the saloon doorway — [Quick Draw (+Quick)]',
            '2. 🧨 Light the dynamite stick and hurl it toward the barricade — [Fan the Hammer (+Iron)]',
            '3. 🐎 Kick your spurs and ride hard along the canyon ridge — [Standoff (+Grit)]',
            '4. 👁️ Kneel in the dust to examine the fresh horseshoe impressions — [Read the Trail (+Instinct)]',
            '5. 🃏 Slide an ace from your sleeve and raise the wager — [Silver Tongue (+Savvy)]',
        ],
    },
    pirate: {
        id: 'pirate',
        label: 'Swashbuckling / High Seas (7th Sea / Pirate World)',
        icon: '🏴‍☠️',
        multihogGenre: 'fantasy',
        stats: ['Panache', 'Brawn', 'Daring', 'Wits', 'Charm'],
        statDescriptions: 'Panache (flamboyance/cutlass dueling/rigging acrobatics), Brawn (heavy sailing/cannons/deck brawling), Daring (bold gambles/boarding actions/steering into storms), Wits (navigation/spotting shoals/tactics), Charm (shanties/pirate parley/carousing/morale)',
        archetypes: ['The Captain', 'The Buccaneer', 'The Navigator', 'The Master Gunner', 'The Duelist', 'The Ship Doctor', 'The Sea Witch'],
        moves: [
            'Cross Swords (+Panache) — engage an enemy marine or rival pirate in blade dueling',
            'Boarding Action (+Daring) — swing across the rigging on a cutlass rope onto the enemy deck',
            'Man the Broadside (+Brawn) — direct cannon fire, haul heavy anchor chains, or brawl on deck',
            'Chart the Unknown (+Wits) — steer through deadly shoals, doldrums, or read strange sea omens',
            'Pirate Parley (+Charm) — press your reputation for a truce, carouse with scoundrels, or demand ransom',
        ],
        cyoaExamples: [
            '1. ⚔️ Draw your cutlass and flourish into high guard against the naval officer — [Cross Swords (+Panache)]',
            '2. 🪢 Sever the rope with your dagger and swing across the open sea onto the galleon\'s quarterdeck — [Boarding Action (+Daring)]',
            '3. 💣 Touch the smoldering match to the twin 24-pounder cannons — [Man the Broadside (+Brawn)]',
            '4. 🧭 Spin the helm hard to port to navigate between the jagged coral spires — [Chart the Unknown (+Wits)]',
            '5. 🗣️ "By the Brethren Code, I invoke the Right of Parley with your admiral!" — [Pirate Parley (+Charm)]',
        ],
    },
    mecha: {
        id: 'mecha',
        label: 'Giant Mecha (Beam Saber / Lancer)',
        icon: '🤖',
        multihogGenre: 'scifi',
        stats: ['Frame', 'Sync', 'Systems', 'Heat', 'Pilot'],
        statDescriptions: 'Frame (armor plating/kinetic impact/structural health), Sync (neural interface/high-G maneuvers/reflexes), Systems (sensors/electronic warfare/missile locks), Heat (overdrive/beam cannons/plasma discharge), Pilot (unmounted grit/sidearms/cockpit charisma)',
        archetypes: ['The Ace Pilot', 'The Heavy Artillery', 'The Vanguard Striker', 'The EW Specialist', 'The Test Pilot', 'The Mercenary'],
        moves: [
            'Full Salvo (+Systems) — lock onto multiple targets with missiles and heavy ordnance',
            'High-G Burn (+Sync) — execute an evasive aerial thruster maneuver at extreme velocity',
            'Overclock Reactor (+Heat) — channel reactor core power into maximum beam output',
            'Crushing Blow (+Frame) — ram, stomp, or clash in close-quarters melee with your frame',
            'Bail / Eject (+Pilot) — escape a compromised chassis or fight on foot with sidearms',
        ],
        cyoaExamples: [
            '1. 🚀 Fire a full salvo of micro-missiles into the enemy squadron — [Full Salvo (+Systems)]',
            '2. ⚡ Boost lateral thrusters to barrel roll through the flak screen — [High-G Burn (+Sync)]',
            '3. 💥 Overclock the beam cannon to vaporize the command bunker — [Overclock Reactor (+Heat)]',
            '4. 🛡️ Slam your reinforced alloy shield into the charging bipedal mech — [Crushing Blow (+Frame)]',
            '5. 🎙️ Open broad-band cockpit comms to demand the convoy\'s surrender — [Bail / Eject (+Pilot)]',
        ],
    },
    cosmic_horror: {
        id: 'cosmic_horror',
        label: 'Cosmic / Eldritch Horror (Call of Cthulhu / Tremulus)',
        icon: '🐙',
        multihogGenre: 'horror',
        stats: ['Sanity', 'Insight', 'Grit', 'Flesh', 'Forbidden'],
        statDescriptions: 'Sanity (mental fortitude/logic/resisting madness), Insight (forensics/investigation/reading occult glyphs), Grit (enduring dread/nerve/willpower), Flesh (physical struggle/escape/brawling), Forbidden (channeling eldritch rites/void artifacts)',
        archetypes: ['The Antiquarian', 'The Alienist', 'The Detective', 'The Occult Scholar', 'The Reluctant Heir', 'The Escaped Patient'],
        moves: [
            'Cling to Sanity (+Sanity) — withstand the incomprehensible sight of alien entities',
            'Decipher the Obscure (+Insight) — read blasphemous texts, inspect crime scenes, or track occult signs',
            'Stand Fast (+Grit) — refuse to run or freeze when dread paralyzes the room',
            'Desperate Flight (+Flesh) — scramble through narrow passages and slam heavy iron doors',
            'Invoke the Rites (+Forbidden) — speak syllables of the Void to cast a protective ward or banish a horror',
        ],
        cyoaExamples: [
            '1. 🕯️ Close your eyes, breathe, and recite poetry to resist the whispers — [Cling to Sanity (+Sanity)]',
            '2. 📜 Inspect the damp symbols carved into the altar\'s underside — [Decipher the Obscure (+Insight)]',
            '3. 🔦 Hold the lantern high and stare down the shifting darkness — [Stand Fast (+Grit)]',
            '4. 🏃 Barricade the crypt door with the heavy stone bench — [Desperate Flight (+Flesh)]',
            '5. 🩸 Trace the ward of banishment in your own blood upon the floor — [Invoke the Rites (+Forbidden)]',
        ],
    },
    survival_horror: {
        id: 'survival_horror',
        label: 'Survival / Slasher Horror (Resident Evil / Final Girl)',
        icon: '🪓',
        multihogGenre: 'horror',
        stats: ['Nerve', 'Brawn', 'Scavenge', 'Agility', 'Heart'],
        statDescriptions: 'Nerve (suppressing panic/stealth/silence), Brawn (desperate melee/heavy weapons/blunt force), Scavenge (searching for keys/ammo/batteries/first-aid), Agility (running/evading traps/vaulting windows), Heart (rallying other survivors/sacrifice/morale)',
        archetypes: ['The Final Girl', 'The Jock', 'The Nerd', 'The Skeptic', 'The Caregiver', 'The Veteran Officer'],
        moves: [
            'Hold Your Breath (+Nerve) — stay perfectly quiet while the stalker patrols feet away',
            'Fight for Your Life (+Brawn) — strike back with an axe, shotgun, or improvised weapon',
            'Scavenge Supplies (+Scavenge) — search a dark room for ammunition, herbs, or access cards',
            'Sprint for Cover (+Agility) — break into a mad dash to leap through a window or vent',
            'Protect Another (+Heart) — dive in front of the monster to pull a screaming friend to safety',
        ],
        cyoaExamples: [
            '1. 🤫 Duck into the rusted locker and hold your breath as the footsteps draw near — [Hold Your Breath (+Nerve)]',
            '2. 🪓 Swing the fire axe with all your strength into the creature\'s knee — [Fight for Your Life (+Brawn)]',
            '3. 🔦 Rummage through the blood-spattered nurses\' station for medical gauze — [Scavenge Supplies (+Scavenge)]',
            '4. 🏃 Vault through the shattered glass window into the rainy courtyard — [Sprint for Cover (+Agility)]',
            '5. 🤝 Grab the rookie\'s collar and haul them to their feet before the ceiling caves in — [Protect Another (+Heart)]',
        ],
    },
    post_apocalyptic: {
        id: 'post_apocalyptic',
        label: 'Post-Apocalyptic / Wasteland (Apocalypse World / Fallout)',
        icon: '☣️',
        multihogGenre: 'scifi',
        stats: ['Cool', 'Hard', 'Sharp', 'Scrap', 'Weird'],
        statDescriptions: 'Cool (calm under fire/driving/nerves), Hard (violence/intimidation/brute force), Sharp (scouting/evaluating threats/tracking), Scrap (jury-rigging/barter/salvage/mechanics), Weird (mutations/psychic static/rad intuition)',
        archetypes: ['The Road Warrior', 'The Scrapper', 'The Marauder', 'The Wasteland Shaman', 'The Medic', 'The Convoy Driver'],
        moves: [
            'Act Under Fire (+Cool) — stay steady behind the wheel or under sniper fire',
            'Go Aggro (+Hard) — demand submission or unleash sudden devastating violence',
            'Read a Sitch (+Sharp) — scan the ruins for snipers, rad-hotspots, or escape routes',
            'Jury-Rig (+Scrap) — cobble together a functional weapon, vehicle repair, or filter from junk',
            'Open Your Brain (+Weird) — touch the psychic maelstrom or sense oncoming radiation storms',
        ],
        cyoaExamples: [
            '1. 🚗 Floor the accelerator of your armored rig to ram the raider buggy — [Act Under Fire (+Cool)]',
            '2. 💥 Rack your sawed-off shotgun and step right into the gang leader\'s face — [Go Aggro (+Hard)]',
            '3. 🔭 Scan the rusted highway overpass with your cracked binoculars — [Read a Sitch (+Sharp)]',
            '4. 🔧 Splice wires and patch the radiator with duct tape and scrap copper — [Jury-Rig (+Scrap)]',
            '5. 🌀 Close your eyes and let the psychic static reveal where the water cache lies — [Open Your Brain (+Weird)]',
        ],
    },
    gothic_heist: {
        id: 'gothic_heist',
        label: 'Victorian / Gothic Heist (Blades in the Dark / Dishonored)',
        icon: '🕵️',
        multihogGenre: 'fantasy',
        stats: ['Prowl', 'Finesse', 'Skulk', 'Sway', 'Attune'],
        statDescriptions: 'Prowl (rooftop leaping/speed/acrobatics), Finesse (lockpicking/sleight of hand/pickpocketing), Skulk (shadows/stealth/ambush), Sway (deception/charm/blackmail/cons), Attune (ghosts/arcane leylines/electroplasmic tech)',
        archetypes: ['The Cutpurse', 'The Whisper (Occultist)', 'The Slide (Grifter)', 'The Leech (Alchemist)', 'The Spider (Mastermind)', 'The Hound (Sniper)'],
        moves: [
            'Slip Through the Shadows (+Skulk) — move through gaslit alleyways and guards without being spotted',
            'Pick a Pocket or Lock (+Finesse) — bypass a tumblered vault or lift a key from a belt',
            'Leap the Rooftops (+Prowl) — sprint across slate roofs, chimneys, and ziplines under pursuit',
            'Work the Mark (+Sway) — fast-talk an aristocratic guard, forge a pass, or run a confidence game',
            'Attune to the Veil (+Attune) — commune with lingering spectres or siphon electroplasmic energy',
        ],
        cyoaExamples: [
            '1. 🗝️ Slide your tension wrench into the iron vault lock — [Pick a Pocket or Lock (+Finesse)]',
            '2. 🥷 Melt into the alcove as the Bluecoat watch patrol passes under the streetlamp — [Slip Through the Shadows (+Skulk)]',
            '3. 🏃 Spring across the rain-slick roof gap and catch the rain gutter opposite — [Leap the Rooftops (+Prowl)]',
            '4. 🎭 Present the forged Lord Governor\'s seal with an indignant sneer — [Work the Mark (+Sway)]',
            '5. 👻 Channel the spirit of the murdered merchant to ask where the ledger is buried — [Attune to the Veil (+Attune)]',
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
- Populate the world with living people: Whenever the protagonist visits settlements, taverns, garrisons, clinics, markets, or faction hideouts, proactively introduce distinct, named NPCs with personalities, agendas, and clear desires.
- Introduce NPCs to complicate or assist: When the player rolls a 7-9 (mixed success) or 6- (miss), you may introduce an NPC (a rival, inquisitive bystander, allied savior with a cost, or demanding authority) as part of your GM Move.
- Give every NPC a voice, demeanor, and agenda: Never treat NPCs as cardboard quest-dispensers. Give them wants, leverage, and flaws.
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
  4 Harm: Critical wound, organ damage, verge of death (-2 forward to all actions).
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
 * Builds the PbtA party mechanics and companion bench resolution section.
 */
export function buildPbtAPartyContent() {
    return `<[PARTY]_mechanics>
On joining: state *(Name joins the party)* and declare their profile matching [PARTY] format.
CRITICAL FORMAT: Every party member MUST start on their own line with Name (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0. Separate distinct members with a blank line.
Companion damage tracking: MultiHog visualizes HP as a descending vitality bar (5/5 = full health). When a companion takes Harm, increment their Harm and decrement their HP in tandem (e.g. at 1 Harm: 4/5 HP | Harm: 1/5; at 2 Harm: 3/5 HP | Harm: 2/5; at 5 Harm: 0/5 HP | Harm: 5/5, Incapacitated).
[PARTY]
Name (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
Stats: Stat1 +2, Stat2 +1, Stat3 +1, Stat4 +0, Stat5 -1
Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
Gear: Signature weapon/item (tags) | Armor (value)
Conditions: None
Status: Healthy

Second Companion (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
Status: Healthy
[/PARTY]

<leaving_vs_benching>
Only permanent departure needs annotation: death, explicit final farewell, defection, or closure ruling out reunion → narrate, then *(Left the party: Name — reason)* (exact string; hard delete).
- Never for temporary separation, however dramatic. Temporary/contactable = Benched (the common case).
- Upon rejoin, don't declare stats again; only narrate unbenching.
</leaving_vs_benching>

<bench_ETA_system>
On benching, estimate an in-world return ETA. Just before return (never once already in-scene), resolve the companion's off-screen mission:
Pop the next pair of d6 dice from [RNG_QUEUE v7.0] and add the companion's most relevant stat:
- 10+ (Strong Hit): Companion returns on time, mission accomplished cleanly without complications or harm.
- 7–9 (Mixed Success): Companion returns, but with a complication (delayed return, caught heat, debt, marked condition, or +1 Harm taken).
- 6- (Trouble): Companion returns wounded (+2 Harm or higher), failed objective, captured, or in need of extraction.
This roll is mandatory, always pre-return.
</bench_ETA_system>
</[PARTY]_mechanics>`;
}

/**
 * Derives dynamic CYOA button choices directly from an array of PbtA starting moves.
 *
 * @param {string[]} moves Array of move strings (e.g. "Investigate a Mystery (+Sharp): ...")
 * @param {string} [contextLabel] Context or genre label
 * @returns {string[]} Formatted CYOA button strings
 */
export function deriveCyoaExamplesFromMoves(moves = [], contextLabel = '') {
    if (!Array.isArray(moves) || moves.length === 0) return [];
    const buttons = [];
    let idx = 1;

    for (const moveStr of moves) {
        if (buttons.length >= 4) break;
        const clean = moveStr.replace(/^[\*\-\s]+/, '').trim();
        if (!clean) continue;

        // Pattern: Move Name (+Stat): description OR Move Name (+Stat)
        const match = clean.match(/^([^:\(]+?)\s*(\([+-]?[a-zA-Z]+\))?(?:\s*:\s*(.*))?$/);
        if (match) {
            const moveName = match[1].trim();
            const statTag = match[2] ? match[2].trim() : '';
            const desc = match[3] ? match[3].trim() : '';
            const statWord = statTag.replace(/[\(\)+-]/g, '').toLowerCase();

            let emoji = '⚡';
            if (/sharp|wits|mind|insight|logic|investigat|percept/i.test(statWord + moveName)) emoji = '🔍';
            else if (/cool|nerve|stealth|skulk|shadow/i.test(statWord + moveName)) emoji = '🤫';
            else if (/hard|might|brawn|iron|flesh|danger|combat|ass|strike/i.test(statWord + moveName)) emoji = '💥';
            else if (/hot|heart|charm|sway|parley|manipulat|talk/i.test(statWord + moveName)) emoji = '🗣️';
            else if (/weird|arcana|forbidden|attune|magic|freak/i.test(statWord + moveName)) emoji = '🔮';
            else if (/agility|quick|edge|prowl|speed/i.test(statWord + moveName)) emoji = '🏃';
            else if (/tech|scrap|systems|hack/i.test(statWord + moveName)) emoji = '💻';

            let actionText = '';
            if (desc) {
                const firstClause = desc.split(/[\.;]/)[0].trim();
                actionText = firstClause.charAt(0).toUpperCase() + firstClause.slice(1);
            } else {
                actionText = `Take action to ${moveName.toLowerCase()}`;
            }

            if (!/^[A-Z]/.test(actionText)) actionText = `Execute ${moveName}`;

            const tagPart = statTag ? ` — [${moveName} ${statTag}]` : ` — [${moveName}]`;
            buttons.push(`${idx}. ${emoji} ${actionText}${tagPart}`);
            idx++;
        }
    }

    // Complement with standard narrative and conversational choices up to 5
    if (buttons.length === 1) {
        buttons.push(`${idx++}. 🗣️ Speak directly with those present to probe their intentions`);
        buttons.push(`${idx++}. 🏃 Take cover and observe how the situation develops`);
        buttons.push(`${idx++}. 🔍 Closely examine the immediate surroundings for hidden hazards or exits`);
        buttons.push(`${idx++}. 🎒 Check your gear and prepare for immediate trouble`);
    } else if (buttons.length === 2) {
        buttons.push(`${idx++}. 🗣️ Press for answers: "Tell me what you know before this escalates."`);
        buttons.push(`${idx++}. 🏃 Reposition carefully to secure a tactical vantage point`);
        buttons.push(`${idx++}. 🔍 Check your perimeter and watch for an impending counter-move`);
    } else if (buttons.length === 3) {
        buttons.push(`${idx++}. 🗣️ "We can do this the easy way or the hard way. Your call."`);
        buttons.push(`${idx++}. 🏃 Disengage and slip away into the cover of the environment`);
    } else if (buttons.length === 4) {
        buttons.push(`${idx++}. 🗣️ Hold up a hand and speak calmly to defuse the rising tension`);
    }

    return buttons;
}

/**
 * Builds the PbtA CYOA prompt customized for the given genre and overrides.
 *
 * @param {string} [genreKey='fantasy']
 * @param {object} [overrides={}]
 * @returns {string}
 */
export function buildPbtACyoaPrompt(genreKey = 'fantasy', overrides = {}) {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

    let buttonList = [];
    if (Array.isArray(overrides.cyoaExamples) && overrides.cyoaExamples.length > 0) {
        buttonList = overrides.cyoaExamples;
    } else if (Array.isArray(overrides.startingMoves) && overrides.startingMoves.length > 0) {
        buttonList = deriveCyoaExamplesFromMoves(overrides.startingMoves, overrides.systemLabel || genre.label);
    } else if (genre.cyoaExamples && genre.cyoaExamples.length > 0) {
        buttonList = genre.cyoaExamples;
    }

    if (!buttonList || buttonList.length === 0) {
        buttonList = ['1. ⚔️ Leap forward with blade drawn to strike the beast — [Hack & Slash (+Might)]'];
    }

    const exampleButtons = buttonList.map(e => `<button>${e}</button>`).join('\n');
    const examples = `<choices>\n${exampleButtons}\n</choices>`;
    const displayLabel = overrides.systemLabel || overrides.name || genre.label;

    return `[END OF OUTPUT REQUIREMENT]
- You MUST ALWAYS end your response with exactly 5 choices for the user. NEVER forget the choices.
- Enclose all choices inside a single <choices> XML block.
- Wrap every single choice in a <button> tag.
- Prefix each choice text with a fitting emoji.
- High-stakes situations and perilous obstacles should feature Moves; conversational downtime needs fewer rolls.
- NO D&D MECHANICS: NEVER output target DCs (e.g. "DC 14"), Armor Class ("vs AC 15"), or advantage/disadvantage. In PbtA, moves roll 2d6 + Stat against fixed tiers (10+ Full Success | 7–9 Mixed Success | 6- Miss).
- When a choice triggers a PbtA Move, format it as: — [Move Name (+Stat)]
- When a choice consumes equipment or uses a gear tag, format it as: — [-1 Resource] or — [Item Name (tag)]

Choice types available:
- NORMAL: Plain action or spoken dialogue (e.g. "Open the blast door" or "Tell me what you know")
- MOVE TRIGGER: Action that triggers a Move with stat modifier: — [Move Name (+Stat)]
- ARCHETYPE / TAG: Action leveraging special playbook moves or gear tags

EXAMPLES (${displayLabel}):
${examples}

STRICT GENERATION ORDER:
You must generate exactly 5 choices following narrative context:
1. NARRATIVE-DECIDED (Choose whichever format fits the story best).
2. NARRATIVE-DECIDED (Choose whichever format fits the story best).
3. NARRATIVE-DECIDED (Choose whichever format fits the story best).
4. NARRATIVE-DECIDED (Choose whichever format fits the story best).
5. NARRATIVE-DECIDED (Choose whichever format fits the story best).`;
}

/**
 * Generates the stock prompts tailored for a given genre and overrides.
 *
 * @param {string} [genreKey='fantasy']
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function buildPbtAStockPrompts(genreKey = 'fantasy', overrides = {}) {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const statsList = (Array.isArray(overrides.stats) && overrides.stats.length > 0)
        ? overrides.stats
        : genre.stats;
    const statsExample = statsList.map((s, idx) => `${s} ${idx === 0 ? '+2' : idx < 3 ? '+1' : idx === 3 ? '+0' : '-1'}`).join(', ');

    return {
        character: `Main character's core stats. MECHANICS ONLY: Never include narrative background or physical appearance in [CHARACTER].
NO D&D MECHANICS: Never write "1d8 damage", "attack rolls", "disadvantage", "5 ft", or "turns". Use PbtA concepts: Harm (+1 Harm), positioning, and modifiers (+1 forward, +1 hold).
Format:
[CHARACTER]
{{user}} (Archetype): Harm: 0/5 | Armor: 0
Stats: ${statsExample}
Moves: Move 1 (Trigger: [Fictional trigger]. Effect: [PbtA effect/harm/positioning]) | Move 2 (Trigger: [Fictional trigger]. Effect: [PbtA effect/harm/positioning])
Gear: Signature weapon/item (tags), travel gear
Wealth: Coin 3 (or setting currency)
Conditions: None
Hold/Forward: None
XP: 0/5
Status: Healthy
[/CHARACTER]`,

        party: `Companion and party members. MECHANICS ONLY. Every member MUST begin with their own header line. Separate distinct members with an empty line:
Name (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
Stats: ${statsExample}
Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
Gear: Signature weapon/item (tags) | Armor (value)
Conditions: None
Status: Healthy

Second Companion (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
Status: Healthy`,

        combat: `Active enemies and environmental threats in combat.
Group threats under ENEMIES: and NON-PARTY ALLIES: headers.
CRITICAL FORMAT: Every combatant MUST start on its own line with Name: cur/max HP | Harm: cur/max | Armor: X — the HP token is required for the tracker to recognize the combatant. HP descends in tandem with Harm (e.g. a 4-Harm enemy: 4/4 HP | Harm: 0/4; after 1 Harm: 3/4 HP | Harm: 1/4; at 4 Harm: 0/4 HP | Harm: 4/4, Status: Defeated).
Use this format:
THREAT LEVEL: (Skirmish / Peril / Catastrophe)
ENEMIES:
Name: 4/4 HP | Harm: 0/4 | Armor: 1 | Threat: (Minion / Veteran / Boss)
Attacks: Attack Name (Harm dealt, tags like close/reach/far/messy), Second Attack (Harm dealt, tags)
Instinct: (What this threat desires or how it fights, e.g. "To overwhelm with numbers")
Status: Healthy

PILL FORMATTING (the tracker turns these into hoverable pills):
- Separate multiple attacks, abilities, or statuses with commas, and put each one's detail in trailing parentheses: Name (detail). The detail appears on hover. Keep commas out of the detail text unless they are inside the parentheses.
- Status entries start with (-) for harmful conditions (red) or (+) for beneficial ones (green), e.g. Status: (-) Winded (Disadvantage on the next Act Under Fire), (+) Enraged (+1 Harm dealt). Use plain "Healthy" when unaffected.
- Optional extra lines for special threats, same Name (detail) style: Abilities: Heavy Hauler (Holds a grabbed target in place), Weakness: White birch fire (Ignores Armor).`,

        inventory: `Character possessions, equipment, weapons, and wealth.
MANDATORY FORMAT FOR EVERY ITEM:
- Every item MUST have a rarity or quality tag: [Common], [Uncommon], [Rare], [Exceptional], or [Signature]
- Every item MUST have a thematic emoji prefix before the tag
- NO D&D MECHANICS: NEVER output "AC +X", damage dice like "1d8", or "+1/+2" weapon suffixes.
- Use PbtA tags in parentheses:
  • Armor: (Armor 1), (Armor 2, clumsy), or (Armor 1, sealed)
  • Weapons: (close, 2 Harm), (far, reload, 3 Harm), (hand, messy, 1 Harm), (stun), (piercing)
  • Gear: (3 uses), (slow), (fragile), (valuable)
- Estimated worth or setting currency: (~X Credits), (~X GP), (~X Dollars), (~X Coin), (~X Scrap)
- Bare currency goes under Other Items.

EQUIPPED ITEMS: Tag actively worn, wielded, or holstered items with [E] immediately after the rarity tag.

Example:
[INVENTORY]
Gear:
- 🗡️ [Signature] [E] Vibro-Blade (hand, close, 2 Harm, piercing) (~250 Credits)
- 🦺 [Common] [E] Armored Courier Vest (Armor 1) (~150 Credits)
Other Items:
- 💉 [Common] Trauma Stim (restores 2 Harm, 2 uses) (~80 Credits)
- 💻 [Uncommon] Decking Cable & Multi-tool (~50 Credits)
- 💵 500 Credits
[/INVENTORY]`,
    };
}

/**
 * Builds the complete PbtA Game Cartridge object, optionally accepting dynamic overrides.
 *
 * @param {string} [genreKey='fantasy']
 * @param {object} [overrides={}]
 * @returns {object} Game cartridge definition
 */
export function buildPbtACartridge(genreKey = 'fantasy', overrides = {}) {
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
        {
            id: 'pbta_base_override_party',
            tag: '[PARTY]_mechanics',
            content: buildPbtAPartyContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA companion format and 2d6 bench resolution',
            origin: 'unlocked_base',
            baseTag: '[PARTY]_mechanics',
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
        '[PARTY]_mechanics': false,
        // D&D systems disabled in PbtA
        weapon_proficiencies: false,
        attacks_per_round: false,
        saving_throws: false,
        level_up_protocol: false,
        homebrew_and_custom_classes: false,
        resting: false,
        loot: false,
        random_events: false,
    };

    const payload = {
        customSyspromptLibrary,
        syspromptModules,
        syspromptSectionOrder: [],
        stockPrompts: buildPbtAStockPrompts(genreKey, overrides),
        cyoaConfig: {
            useCustomPrompt: true,
            customPromptText: buildPbtACyoaPrompt(genreKey, overrides),
            useButtonTags: true,
            useXmlTag: true,
            useEmojis: true,
            stripOldChoicesFromPrompt: true,
        },
        rngEnabled: true,
        // "rngQueueD20" enables the polyhedral RNG queue from which the PbtA
        // engine intercepts and consumes 2d6 values.
        rngQueueD20: true,
        rngQueueD100: false,
        diceD100Mode: false,
        diceFunctionTool: false, // Disable AI function-call dice to avoid player interruptions
        blockOrder: ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'XP', 'TIME'],
        modules: {
            combat: true,
            character: true,
            party: true,
            inventory: true,
            abilities: false, // In PbtA, abilities ARE Playbook Moves (avoids D&D daily spell/ability counters)
            spells: false,    // Magic is handled via Arcana / Weird Moves
            xp: true,
            time: true,
        },
    };

    const cleanTitleSlug = overrides.campaignTitle
        ? overrides.campaignTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        : '';
    const cartridgeId = overrides.id || (cleanTitleSlug ? `pbta_${cleanTitleSlug}` : PBTA_CARTRIDGE_ID);
    const cartridgeName = overrides.name || (overrides.campaignTitle ? `PbtA: ${overrides.campaignTitle}` : `PbtA Narrative Engine (${overrides.systemLabel || genre.label})`);
    const cartridgeDesc = overrides.description || `Powered by the Apocalypse ruleset: 2d6 moves (10+/7-9/6-), Harm clocks, and zero manual dice rolling. Tailored for ${overrides.systemLabel || genre.label}.`;

    return {
        id: cartridgeId,
        name: cartridgeName,
        description: cartridgeDesc,
        icon: overrides.icon || genre.icon || '🎲',
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
        `ATTRIBUTES: Assign the standard PbtA modifier array (+2, +1, +1, 0, -1) across: ${genre.stats.join(', ')}. Exactly ONE stat must be -1 (flaw/weakness).`,
        `STAT DESCRIPTIONS: ${genre.statDescriptions}.`,
        `SUGGESTED ARCHETYPES: ${genre.archetypes.join(', ')}.`,
        `SUGGESTED MOVES (pick 2): ${genre.moves.join('; ')}.`,
        `NO D&D MECHANICS: Moves MUST use PbtA terminology (Harm, +1 forward, fictional positioning). NEVER write "1d8 damage", "attack rolls", "disadvantage", "5 ft", or "turns".`,
        `NO D&D GEAR: Armor MUST use PbtA armor rating (e.g. Armor 1, Armor 2), NEVER "AC +X". Weapons MUST use tags and Harm (e.g. close, 2 Harm), NEVER D&D damage dice (1d8) or +1/+2 magic suffixes.`,
        `FORMAT MANDATE: Output [CHARACTER] using Harm: 0/5, Armor, Stats with modifiers, 2 starting Moves, Gear, Conditions: None, Hold/Forward: None, and XP: 0/5. Do NOT output D&D stats (STR/DEX 1-20), AC, BAB, HP, spell slots, or daily ability counters.`,
        customNotes ? `ADDITIONAL DETAILS: ${customNotes}` : null,
    ].filter(Boolean).join('\n');
}

/**
 * Generates the initial Multihog game state memo ([TIME], [LOCATION], [CHARACTER], [DUNGEON])
 * from a completed PbtA Campaign Dossier.
 *
 * @param {object} dossier
 * @returns {string} Formatted game state memo
 */
export function formatInitialPbtaMemo(dossier) {
    if (!dossier || typeof dossier !== 'object') return '';
    const p = dossier.protagonist || {};
    const kick = dossier.theKick || {};
    const charName = (p.name || 'Protagonist').trim();
    const playbook = (p.playbook || 'Wanderer').trim();
    const harmMax = p.harm?.max || 5;
    const armor = p.harm?.armor || 0;

    // Format stats: "Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1"
    let statsStr = '';
    if (p.stats && typeof p.stats === 'object') {
        statsStr = Object.entries(p.stats)
            .map(([stat, val]) => `${stat} ${Number(val) >= 0 ? '+' : ''}${val}`)
            .join(', ');
    } else {
        statsStr = 'Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1';
    }

    // Format moves
    const moves = Array.isArray(p.startingMoves) && p.startingMoves.length > 0
        ? p.startingMoves
        : ['Act Under Fire (+Cool)', 'Read a Tense Situation (+Sharp)'];
    const movesStr = moves.join(' | ');

    // Format gear
    const gearStr = Array.isArray(p.gear) && p.gear.length > 0
        ? p.gear.join(', ')
        : 'Essential adventurer kit, signature item';

    const locationStr = (kick.startingLocation || dossier.maps?.[0]?.site || 'The Starting Threshold').trim();

    const blocks = [];

    // 1. TIME Block
    blocks.push(`[TIME]\nDay 1, 08:00 AM (Morning)\n[/TIME]`);

    // 2. LOCATION Block
    blocks.push(`[LOCATION]\n${locationStr}\n[/LOCATION]`);

    // 3. CHARACTER Block
    const charLines = [
        `[CHARACTER]`,
        `${charName} (${playbook}): Harm: 0/${harmMax} | Armor: ${armor}`,
        `Stats: ${statsStr}`,
        `Moves: ${movesStr}`,
        `Gear: ${gearStr}`,
        `Conditions: None`,
        `Hold/Forward: None`,
        `XP: 0/5`,
        `[/CHARACTER]`,
    ];
    blocks.push(charLines.join('\n'));

    // 3b. If companion NPCs exist in the dossier, initialize [PARTY] block
    const npcs = dossier.npcs || [];
    const companions = npcs.filter(n => {
        const r = (n.role || '').toLowerCase();
        return r.includes('companion') || r.includes('party') || r.includes('sidekick') || r.includes('follower') || r.includes('partner');
    });
    if (companions.length > 0) {
        const partyLines = ['[PARTY]'];
        for (let i = 0; i < companions.length; i++) {
            const comp = companions[i];
            const cName = comp.name || 'Companion';
            const cRole = comp.role || 'Companion';
            const cBoons = comp.movesOrBoons || 'Assist (+1 forward when cooperating)';
            const cApp = comp.appearance || comp.description || (comp.demeanor ? `${comp.demeanor} demeanor` : '');
            if (i > 0) partyLines.push('');
            partyLines.push(
                `${cName} (${cRole}): 5/5 HP | Harm: 0/5 | Armor: 0`,
                ...(cApp ? [`Appearance: ${cApp}`] : []),
                `Moves: ${cBoons}`,
                `Bond: ${comp.relationship || 'Allied with protagonist'}`,
                `Conditions: None`,
                `Status: Healthy`
            );
        }
        partyLines.push('[/PARTY]');
        blocks.push(partyLines.join('\n'));
    }

    // 4. If maps exist, add DUNGEON block
    if (dossier.maps?.[0]?.site) {
        blocks.push(`[DUNGEON]\nActive Site: ${dossier.maps[0].site}\nThreat: ${dossier.maps[0].threat || 'MODERATE'}\n[/DUNGEON]`);
    }

    return blocks.join('\n\n');
}
