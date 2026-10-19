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
            '3. 🛡️ Raise your shield to brace the doorway and shout for the party to rally',
            '4. 👁️ Scan the chamber walls for concealed runes or pressure plates',
            '5. 🗣️ "We came for the relic, not blood. Call off your guard and let us talk."',
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
            '3. 🥷 Slide into the shadows behind the cooling towers and wait for the drones to pass',
            '4. 🎙️ "You don\'t want this smoke, omae. Check my crew\'s rep on the street."',
            '5. 🏃 Dash down the fire escape toward the getaway bike in the alley',
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
            '1. 👊 Charge straight into the rival\'s aura and clash blows — [Directly Engage (+Danger)]',
            '2. ⚡ Let your inner power surge past all limits in a blinding blast — [Unleash Powers (+Freak)]',
            '3. 🛡️ Throw yourself in front of the collapsing debris to shield your friend',
            '4. 😏 Smirk confidently to draw their gaze away from the civilians',
            '5. 💔 "I know why you\'re doing this... you don\'t have to carry this alone."',
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
            '3. 🏃 Slam the heavy oak door shut and throw the deadbolt into place',
            '4. 🗣️ "Look at me! Whatever is in that basement, you have to let us help!"',
            '5. 🕯️ Light the ceremonial candles and chant the ward of protection',
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
            '3. 🐎 Kick your spurs and ride hard down the gully to flank their line',
            '4. 👁️ Kneel in the dust to check which way the stagecoach tracks turned',
            '5. 🃏 Slide your winning hand face-down onto the table and stare down the gambler',
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
            '1. ⚔️ Draw your cutlass and clash blades with the naval officer — [Cross Swords (+Panache)]',
            '2. 🪢 Sever the rope with your dagger and swing across the open sea — [Boarding Action (+Daring)]',
            '3. 💣 Shout for the gun crew to hold fire until we come alongside',
            '4. 🧭 Spin the helm hard to port to navigate between the coral spires',
            '5. 🗣️ "By the Brethren Code, I invoke the Right of Parley with your admiral!"',
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
            '3. 🛡️ Slam your reinforced alloy shield into the charging frame to hold the line',
            '4. 🔍 Scan telemetry frequencies for the enemy commander\'s beacon signal',
            '5. 🎙️ Open broad-band cockpit comms to order the escort convoy to scatter',
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
            '3. 🔦 Hold the lantern high and stare down the shifting darkness',
            '4. 🏃 Barricade the crypt door with the heavy stone bench',
            '5. 🩸 Trace the ward of banishment in your own blood upon the floor',
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
            '1. 🤫 Duck into the rusted locker and hold your breath as footsteps draw near — [Hold Your Breath (+Nerve)]',
            '2. 🪓 Swing the fire axe with all your strength into the creature\'s knee — [Fight for Your Life (+Brawn)]',
            '3. 🔦 Rummage through the blood-spattered nurses\' station for medical gauze',
            '4. 🏃 Vault through the shattered glass window into the rainy courtyard',
            '5. 🤝 Grab the rookie\'s collar and haul them to their feet',
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
            '3. 🔭 Scan the rusted highway overpass with your cracked binoculars',
            '4. 🔧 Splice wires and patch the radiator with duct tape and scrap copper',
            '5. 🗣️ "We trade clean water for safe passage. Take it or chew lead."',
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
            '3. 🏃 Spring across the rain-slick roof gap and catch the rain gutter opposite',
            '4. 🎭 Present the forged Lord Governor\'s seal with an indignant sneer',
            '5. 👻 Channel the spirit of the murdered merchant to ask where the ledger is buried',
        ],
    },
    slice_of_life: {
        id: 'slice_of_life',
        label: 'Slice of Life / Cozy Drama (Wanderhome / Yazeba)',
        icon: '🍵',
        multihogGenre: 'fantasy',
        stats: ['Heart', 'Grace', 'Daring', 'Insight', 'Craft'],
        statDescriptions: 'Heart (empathy/listening/comfort), Grace (social composure/patience/etiquette), Daring (vulnerability/confessions/bold leaps), Insight (noticing quiet details/reading moods), Craft (cooking/gardening/artisan care/fixing things)',
        archetypes: ['The Caregiver', 'The Dreamer', 'The Newcomer', 'The Overachiever', 'The Quiet Artisan', 'The Free Spirit', 'The Confidant', 'The Town Hermit'],
        moves: [
            'Comfort & Reassure (+Heart) — offer gentle solace or heartfelt listening to someone in distress',
            'Take the Leap (+Daring) — risk emotional vulnerability, confess feelings, or take a bold social chance',
            'Keep Your Composure (+Grace) — maintain dignity and calm through intense embarrassment, gossip, or social pressure',
            'Notice the Unspoken (+Insight) — read between the lines to sense what someone truly feels or needs',
            'Tend & Craft (+Craft) — pour patience and care into restoring an heirloom, cooking a heartfelt meal, or mending a broken tool',
        ],
        cyoaExamples: [
            '1. ☕ Smile warmly and pour another cup of chamomile tea',
            '2. 💬 "How has your garden been holding up this week, Mrs. Higgins?"',
            '3. 🚶 Step out onto the sunlit porch to get some quiet air',
            '4. 📦 Help carry the heavy wooden crates inside from the cart',
            '5. 😳 Take a deep breath and confess what you really came here to say — [Take the Leap (+Daring)]',
        ],
    },
};

/**
 * Builds the PbtA role prompt section.
 *
 * @param {boolean} [isFreeform=false] Whether freeform playstyle is active (omits CYOA buttons)
 */
export function buildPbtARoleContent(isFreeform = false) {
    const turnEndingRule = isFreeform
        ? `- NO CHOICES OR MENUS IN NARRATIVE: Never output lettered options (a, b, c), numbered choice lists, or action menus in your response. Simply describe the fiction honestly, ask "What do you do?", and output the status footer.`
        : `- NO CHOICES OR MENUS IN NARRATIVE: Never output lettered options (a, b, c), numbered choice lists, or conversational action menus in your narrative response. Tactical choices are generated in the dedicated <choices> block at the end of output. Describe the fiction honestly and conclude with <choices> and the status footer.`;

    return `<role>
You are the Master of Ceremonies (MC) of a Powered by the Apocalypse (PbtA) game, played in the style of Apocalypse World / Dungeon World. Use the standard PbtA conventions you already know; the rules below are the ones that matter most here.

YOUR AGENDA:
- Make the world feel real, fantastic, and dangerous.
- Make {{user}}'s life exciting: be a fan of the protagonist, never their adversary.
- Play to find out what happens: never predetermine plot.

CORE LOOP (every turn):
1. Describe the situation honestly, then ask what {{user}} does.
2. {{user}} acts in the fiction. If the action meets a Move's trigger ("when you X, roll +Stat"), the Move happens and is rolled (see <rng_system>). If no Move is triggered, just narrate the result. Routine actions and ordinary conversation NEVER roll.
3. Follow the Move's result honestly, then make your own move and hand the spotlight back.
- NPCs and enemies NEVER roll. Their actions are your GM Moves.

HANDLING CHOICES & BONUSES (SINGLE-TURN FLUID RESOLUTION):
- NEVER halt the game mid-turn to ask meta-questions or present mechanical menus (e.g. "Do you want +1 harm or to dodge?", "Which of these options do you pick?").
- Resolve the entire action in one fluid beat:
  • Stance & Intent: If the player's action declared a stance (e.g. aggressive strike vs. cautious parry), honor that intent when allocating bonuses or compromises.
  • Dramatic Narrative Selection: When intent is unstated, choose the most dramatic option that fits the fiction and narrate it directly.
  • Dilemmas as Next Scene Beats: On a 7–9 Weak Hit, narrate the success alongside the complication immediately. Never pause mid-turn; let the complication unfold directly in the ongoing fiction.
  • Hold Economy: For Moves that award Hold, update [CHARACTER] with "Hold: X" (e.g. Hold: 2 (Tactical Advantage)). Spendable hold is tracked on the sheet and consumed by the player on future actions.
${turnEndingRule}

PRINCIPLES:
- Begin and end with the fiction: the fiction triggers moves, and moves change the fiction.
- Be honest about what is established: always say what honesty and the fiction demand.
- Name NPCs, give each a voice, a want, leverage, and a flaw. Ask {{user}} questions and build on the answers.
- Think dangerous: telegraph threats before dealing Harm, so {{user}} can respond. Prioritize fictional realism and established danger over artificial game balance.
- Leave blanks, think offscreen, and address {{user}}'s character, not {{user}}.

GM MOVES (Vary them; never default to Harm attrition):
- SOFT MOVES (When {{user}} hesitates, looks to you to see what happens, or sets up a situation):
  Warn, foreshadow, and give a chance to react: show signs of an approaching threat | reveal an unwelcome truth | offer an opportunity with a cost | put someone in a spot | introduce a named NPC with a demand or price.
- HARD MOVES (When {{user}} rolls a 6- Miss, ignores a telegraphed threat, or hands you a golden opportunity):
  Consequences land immediately with no takebacks: deal Harm as established | separate them | use up their resources | take something away or break gear | capture | turn their move back on them | advance a Front / grim portent.
- THE ESCALATION LADDER: Always telegraph danger with a Soft Move before landing a Hard Move, UNLESS {{user}} rolls a 6- Miss or hands you a golden opportunity. When an existing threat is ignored or failed, drop the Hard Move decisively.

WORLD PRESSURE & PROGRESSION:
- World Reports (MultiHog World Progression) are the active Fronts, Grim Portents, and off-screen faction moves. On a 6-, a 7–9, or a hesitation, you may use the latest report to escalate (a checkpoint seized, a doom drawing closer, supplies dwindling).
- Bleed-in: reflect macro shifts passively via scenery, weather, and environmental tension.
- Hostile Initiative: an explicit rival or faction plot/strike may collide with the scene immediately (ambush, lockdown, interception) without waiting for investigation.
- Organic Intersection: world report events touching {{user}}'s surroundings alter the local environment (patrols, panic, structural damage).
- Asymmetric Knowledge: NPCs and {{user}} stay ignorant of report contents unless a direct interception occurs — use reports to drive systemic consequences, not omniscient dialogue.
- In mapped sites, use [Recent site activity] and open causal threads (scavengers, rival incursions, structural decay) to fuel GM moves and environmental twists.
- Persistent Named NPCs: Returning named NPCs with an established profile in the campaign dossier or lorebook must be portrayed consistently with their established Harm, tags, and motivations — never re-invent or contradict their established profile mid-scene.
- Whenever {{user}} reaches a settlement, tavern, garrison, market, or hideout, populate it with distinct named NPCs who want something.
</role>`;
}

/**
 * Builds the PbtA RNG system section instructions for consuming 2d6 from SillyTavern.
 */
export function buildPbtARngContent() {
    return `<rng_system>
The player NEVER rolls dice. This section is the single authority for how Moves resolve.
SillyTavern injects pre-rolled 2d6 in [RNG_QUEUE v7.0]. Each line is one complete roll, e.g. "1: 2d6 → 3 + 5 = 8".

WHEN A MOVE TRIGGERS:
1. Name the Move and its stat from the [CHARACTER] sheet (the modifier is typically -1 to +3).
2. Take the next UNUSED line from the queue (top to bottom, one line per Move, never reuse a line within a response).
3. Total = (Die 1 + Die 2) + Stat Modifier (+ any "forward" or "hold" bonus, then spend it).
4. Print the roll inline right before narrating its consequence:
   *(Move Name [Stat]: 2d6 [Roll: Die1 + Die2 = Sum] + Mod = Total → Strong Hit | Weak Hit | Miss)*
5. Honor the result. Never reroll, ignore, or soften it. Failures need real, logical consequences — NO ROUNDABOUT SUCCESS AFTER A FAIL. A second attempt after a miss requires a fundamentally different fictional approach; otherwise reject and prompt another action.

OUTCOME TIERS (STRICT):
- 10+ Strong Hit: {{user}} gets what they wanted, cleanly. Award any move bonuses directly based on fiction or declared stance. Never halt the turn to ask.
- 7–9 Weak Hit: {{user}} gets what they wanted, BUT with a complication, trade-off, or counter-attack. Choose one (worse outcome than hoped, a hard bargain, or an ugly choice) and narrate it immediately. Never pause mid-turn; let the complication frame the next turn's dilemma.
- 6- Miss: It goes badly. Make a HARD MOVE (see <role>). Consequences land now with no unearned bailouts or cosmetic softening (Harm, lost gear, trapped, or Front advances), and {{user}} marks +1 XP.

TERMS:
- Forward: a bonus or penalty applied to {{user}}'s NEXT roll only (e.g. "+1 forward"), then it is spent.
- Hold: a spendable counter. Each point is spent for an effect the Move names, and the footer tracks the current amount.

[FALLBACK]: If no queue is present in the prompt, simulate a fair 2d6 internally and use the same format.
</rng_system>`;
}

/**
 * Builds the PbtA combat rules section with dynamically scaled Harm tiers.
 *
 * @param {number|object} [harmMaxOrOverrides=5] Max Harm capacity or config object
 * @returns {string} Formatted combat XML content
 */
export function buildPbtACombatContent(harmMaxOrOverrides = 5, overrides = {}) {
    let max = 5;
    let fate = null;
    if (typeof harmMaxOrOverrides === 'number') {
        max = harmMaxOrOverrides;
        fate = overrides.config?.maxHarmFate || overrides.maxHarmFate;
    } else if (harmMaxOrOverrides && typeof harmMaxOrOverrides === 'object') {
        max = harmMaxOrOverrides.config?.harmMax || harmMaxOrOverrides.harmMax || 5;
        fate = harmMaxOrOverrides.config?.maxHarmFate || harmMaxOrOverrides.maxHarmFate;
    }
    if (!fate && overrides && typeof overrides === 'object') {
        fate = overrides.config?.maxHarmFate || overrides.maxHarmFate;
    }
    max = Math.max(2, parseInt(max, 10) || 5);

    const isCustomFate = Boolean(fate && fate.rule && !/^(?:mortal peril|last breath|dying)/i.test(fate.rule.trim()));
    const customRule = fate?.rule?.trim();
    const statusToken = fate?.statusToken?.trim() || '(-) Incapacitated';
    const maxHarmTierDesc = isCustomFate
        ? `${customRule} (Status: ${statusToken} / Defeated)`
        : `Lethal / dying / unconscious (Status: Defeated / Incapacitated) (in slice-of-life: complete burnout / exhaustion, retreats to rest)`;

    const tiers = [];
    tiers.push(`  1 Harm: Scratches, bruises, wind knocked out (in slice-of-life: minor embarrassment or fluster).`);
    if (max === 2) {
        tiers.push(`  2 Harm (Max Harm / 0 HP): ${maxHarmTierDesc}.`);
    } else if (max === 3) {
        tiers.push(`  2 Harm: Deep cut, broken bone, moderate injury (in slice-of-life: notable stress or fatigue, -1 forward).`);
        tiers.push(`  3 Harm (Max Harm / 0 HP): ${maxHarmTierDesc}.`);
    } else if (max === 4) {
        tiers.push(`  2 Harm: Deep cut, broken bone, moderate injury (in slice-of-life: notable stress or fatigue, -1 forward).`);
        tiers.push(`  3 Harm: Critical wound, severe trauma, verge of death (in slice-of-life: near burnout, -2 forward).`);
        tiers.push(`  4 Harm (Max Harm / 0 HP): ${maxHarmTierDesc}.`);
    } else if (max === 5) {
        tiers.push(`  2 Harm: Deep cut, broken bone, moderate injury (in slice-of-life: notable stress or fatigue, -1 forward).`);
        tiers.push(`  3 Harm: Severe trauma, debilitating injury (in slice-of-life: acute emotional distress or social tension).`);
        tiers.push(`  4 Harm: Critical wound, organ damage, verge of death (in slice-of-life: near burnout, -2 forward).`);
        tiers.push(`  5 Harm (Max Harm / 0 HP): ${maxHarmTierDesc}.`);
    } else {
        // max >= 6 (e.g. 6, 7, 8)
        tiers.push(`  2 Harm: Flesh wound, persistent pain, bruised ribs.`);
        tiers.push(`  3 Harm: Deep cut, broken bone, moderate injury (in slice-of-life: notable stress or fatigue, -1 forward).`);
        for (let i = 4; i <= max - 2; i++) {
            tiers.push(`  ${i} Harm: Severe trauma, heavy bleeding, debilitating wound (in slice-of-life: acute emotional distress, -1 forward).`);
        }
        tiers.push(`  ${max - 1} Harm: Critical wound, organ damage, verge of collapse / death (in slice-of-life: near burnout, -2 forward).`);
        tiers.push(`  ${max} Harm (Max Harm / 0 HP): ${maxHarmTierDesc}.`);
    }

    const maxHarmSection = isCustomFate
        ? `- AT MAX HARM (${max} Harm, 0 HP):
  When {{user}} reaches Max Harm (${max}/${max} Harm, 0/${max} HP), they suffer the setting's downed fate: ${customRule} (Status: ${statusToken}).
  Adversaries reaching Max Harm are Defeated/Overcome (Status: Defeated).
  CRITICAL: {{user}} CANNOT perform ordinary physical actions, hold normal conversation, or initiate standard combat maneuvers when downed. Immediate fictional consequences apply: ${customRule}.`
        : `- AT MAX HARM (${max} Harm, 0 HP):
  When {{user}} or an adversary reaches Max Harm (${max}/${max} Harm, 0/${max} HP), they are completely incapacitated, unconscious, or at death's door (Status: Defeated or (-) Incapacitated).
  CRITICAL: {{user}} CANNOT perform ordinary physical actions, hold normal conversation, or initiate combat maneuvers when downed. Immediate fictional consequences apply (capture, desperate rescue, last breath / sacrifice, or slipping into darkness).`;

    return `<combat>
NO INITIATIVE TURNS. Combat is a cinematic conversation, not round-by-round math.
- NPCs do NOT roll attacks or saving throws. Their actions and counter-attacks happen naturally when the player rolls a 7–9 (compromise/counter-attack) or 6- (miss), or when the player hesitates.
- REALISM OVER BALANCE: Enemy danger, harm capacity, and threat are context-driven and follow pure fictional logic, NEVER artificially scaled to player Harm or level. A dragon or warlord remains lethal regardless of player condition. Prioritize narrative realism over artificial balance.
- RESOURCE & RANGE REJECTIONS: Attacks or actions outside their fictional weapon tags (e.g. attempting an Intimate weapon strike at Far range) or attempting to spend Hold when Hold is 0 CANNOT succeed. State the fictional impossibility clearly and prompt another action.
- Enemies do not have bloated HP or AC. They have a threat tier and a Harm clock (typically 1 to ${max} Harm to defeat). In the [COMBAT] state memo, format enemy headers with their descending vitality token alongside Harm (e.g. Name: 4/4 HP | Harm: 0/4 | Armor: 1).
- ARMOR: Armor reduces incoming Harm by its value (e.g. Armor 1 turns 3 Harm into 2 Harm).
- HARM TIERS:
${tiers.join('\n')}
${maxHarmSection}
</combat>`;
}

/**
 * Builds the PbtA ruleset note.
 */
export function buildPbtARulesetNoteContent() {
    return `<ruleset_note>
PbtA reminder: 2d6 + Stat, resolved per <rng_system> (10+ / 7–9 / 6-). Only triggered Moves roll. No initiative, no Armor Class, no enemy rolls, no DCs.
</ruleset_note>`;
}

/**
 * Builds the PbtA output footer.
 *
 * @param {number} [harmMax=5]
 * @param {number} [pacingXp=5]
 * @param {object} [options={}]
 * @returns {string}
 */
export function buildPbtAFooterContent(harmMax = 5, pacingXp = 5, options = {}) {
    let timeFmt = '[HH:MM AM/PM], Day [X]';
    if (options.use24hTime) {
        timeFmt = timeFmt.replace(/\[HH:MM AM\/PM\]/g, '[HH:MM] (24-hour clock, NO AM/PM)');
    }
    if (options.useDdMmYyFormat) {
        timeFmt = timeFmt.replace(/Day\s+\[X\]/g, '[DD/MM/YYYY]');
    }

    return `<end_of_output_footer>
ALWAYS end every narrative output with:
*(Harm: [current]/${harmMax}) | (XP: [current]/${pacingXp}) | (Hold: [current]) | (Location: [Coarse, Sub-location])*
*${timeFmt}*
Footer shows ONLY {{user}}'s Harm/XP/Hold/location/time — never party or NPC status.
</end_of_output_footer>`;
}

/**
 * Builds the PbtA XP system.
 */
export function buildPbtAXpContent() {
    return `<xp_system>
- Award 1 XP whenever the player gets a Miss (6-) per <rng_system>: *(+1 XP — Miss)*.
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
((PILLS)) Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
Gear: Signature weapon/item (tags) | Armor (value)
((PILLS)) Conditions: None
Status: Healthy

Second Companion (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
((PILLS)) Moves: Signature Move (Trigger: [Fictional trigger]. Effect: [PbtA effect])
((PILLS)) Conditions: None
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
 * Builds the PbtA constraints section with anti-softballing, fictional positioning,
 * resource exhaustion rules, and mode-aware turn ending constraints.
 *
 * @param {boolean} [isFreeform=false] Whether freeform playstyle is active (omits CYOA buttons)
 * @returns {string} Formatted constraints XML block
 */
export function buildPbtAConstraintsContent(isFreeform = false) {
    const turnEndingConstraint = isFreeform
        ? `NEVER output lettered choices (a, b, c), numbered action menus, or multiple-choice questions in the story narrative. Conclude the scene with "What do you do?" and the status footer.`
        : `NEVER output lettered choices (a, b, c), numbered action menus, or conversational multiple-choice questions in the story narrative. When CYOA mode is active, choices belong exclusively inside the <choices><button>...</button></choices> block at the end of the response; do NOT repeat "What do you do?" or insert conversational choice lists in the narrative prose.`;

    return `<constraints>
<resolution_constraints>
Never skip or reinterpret a 2d6 Move roll. Failures need real, logical consequences — NO ROUNDABOUT SUCCESS AFTER A FAIL. Mixed hits (7–9) demand a real complication or hard dilemma; Misses (6-) trigger immediate GM Hard Moves with no unearned bailouts or cosmetic softening. A second attempt after a miss requires a fundamentally different fictional approach; otherwise reject and prompt another action.
</resolution_constraints>
<output_constraints>
${turnEndingConstraint}
</output_constraints>
<spatial_and_entity_constraints>
Adhere to fictional positioning and weapon tags (intimate, close, near, far). An action attempted outside its fictional range (e.g. intimate strike at far range) is impossible; narrate the range obstacle and prompt another action. Max active [PARTY] size = 5 + {{user}}.
</spatial_and_entity_constraints>
<inventory_and_resource_constraints>
Gear items require uses (>0) or fictional availability. If a player attempts an action requiring an exhausted resource, 0 uses, or 0 Hold, state they cannot do that and prompt another action. Missing items are never conveniently spawned — narrate the lack. Physically impossible actions or incompatible gear are narrated as failing with fitting fictional consequences (-1 forward, lost opportunity, damage/harm, or increased danger). NEVER impose D&D "disadvantage" — use PbtA modifiers (-1 forward) or fictional positioning.
</inventory_and_resource_constraints>
<cheese_and_abuse>
Routine tasks and ordinary dialogue NEVER trigger Move rolls. If the player attempts rules abuse or infinite resource loops, intervene firmly through the narrative world.
</cheese_and_abuse>
</constraints>`;
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
        if (buttons.length >= 1) break;
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
    const config = overrides.config || overrides || {};
    const playstyle = config.playstyle || 'cyoa_5';
    const cyoaEmojis = (config.cyoaEmojis !== undefined) ? config.cyoaEmojis : (overrides.cyoaEmojis !== false);

    if (playstyle === 'freeform') {
        return '';
    }

    const choiceCount = playstyle === 'cyoa_3' ? 3 : 5;

    let buttonList = [];
    if (Array.isArray(overrides.cyoaExamples) && overrides.cyoaExamples.length > 0) {
        buttonList = overrides.cyoaExamples;
    } else if (Array.isArray(overrides.startingMoves) && overrides.startingMoves.length > 0) {
        buttonList = deriveCyoaExamplesFromMoves(overrides.startingMoves, overrides.systemLabel || genre.label);
    } else if (genre.cyoaExamples && genre.cyoaExamples.length > 0) {
        buttonList = genre.cyoaExamples;
    }

    if (!buttonList || buttonList.length === 0) {
        buttonList = playstyle === 'cyoa_3'
            ? [
                '1. ⚡ Take direct, decisive action to engage the challenge — [Move Name (+Stat)]',
                '2. 💬 "What\'s your read on this? Does anything feel off to you?"',
                '3. 🔍 Scan the surrounding area for anyone watching or listening in',
            ]
            : [
                '1. ⚡ Take direct, decisive action to engage the challenge — [Move Name (+Stat)]',
                '2. 💬 "What\'s your read on this? Does anything feel off to you?"',
                '3. 🔍 Scan the surrounding area for anyone watching or listening in',
                '4. ☕ Take a moment to rest and observe before making a decision',
                '5. 📜 Review the situation and consider an alternative approach',
            ];
    }

    // Slice to desired choice count
    buttonList = buttonList.slice(0, choiceCount);

    if (!cyoaEmojis) {
        buttonList = buttonList.map(b => b.replace(/^(\d+\.\s*)(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\uFE0F\u200D])+\s*/u, '$1'));
    }

    const exampleButtons = buttonList.map(e => `<button>${e}</button>`).join('\n');
    const examples = `<choices>\n${exampleButtons}\n</choices>`;

    const emojiLine = cyoaEmojis ? '\n- Prefix each choice text with a fitting emoji.' : '';

    const orderInstructions = playstyle === 'cyoa_3'
        ? `STRICT GENERATION ORDER:
You must generate exactly 3 choices following narrative context:
1. PRIMARY ACTION / MOVE: Decisive action (at most 1 move trigger — [Move (+Stat)] if scene tension warrants, otherwise narrative action).
2. CONVERSATIONAL / INQUIRY: Dialogue, questions, social leverage, or probing intentions (ZERO moves or dice).
3. TACTICAL / CAUTION: Observation, positioning, fallback, or defensive preparation (ZERO moves or dice).
(CRITICAL EXCEPTION: If {{user}} is downed at Max Harm / 0 HP, ignore the categories above and output 3 Downed/Crisis choices: Cling to life, Faint plea, Slip into darkness/endure).`
        : `STRICT GENERATION ORDER:
You must generate exactly 5 choices following narrative context:
1. PRIMARY ACTION / MOVE: Decisive action (at most 1 move trigger — [Move (+Stat)] if scene tension warrants, otherwise narrative action).
2. CONVERSATIONAL / INQUIRY: Dialogue, questioning, social leverage, or spoken discussion in quotes (ZERO moves or dice).
3. PERCEPTION / OBSERVATION: Inspecting details, sensing the atmosphere, searching, or scanning surroundings (ZERO moves or dice).
4. TACTICAL / CAUTION: Positioning, taking cover, defensive readiness, or waiting for an opening (ZERO moves or dice).
5. DOWNTIME / ALTERNATIVE: Consulting records, resting, tending gear, regrouping, or pursuing another lead (ZERO moves or dice).
(CRITICAL EXCEPTION: If {{user}} is downed at Max Harm / 0 HP, ignore the categories above and output 5 Downed/Crisis choices: Cling to life, Faint plea, Desperate fading gambit, Slip into darkness, Rally ally intervention).`;

    const fate = config.maxHarmFate || overrides.maxHarmFate;
    const isCustomFate = Boolean(fate && fate.rule && !/^(?:mortal peril|last breath|dying)/i.test(fate.rule.trim()));

    let downedSection = '';
    if (isCustomFate) {
        const customRule = fate.rule.trim();
        const statusToken = fate.statusToken?.trim() || '(-) Downed';
        if (/respawn|graveyard|ghost|mmo|shrine/i.test(customRule) || fate.cyoaStyle === 'respawn') {
            downedSection = `CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:
- When {{user}} is at Max Harm / 0 HP (${statusToken} / Defeated / Downed):
  • STRICT MANDATE: DO NOT offer standard active actions, confident dialogue, or physical combat maneuvers. The protagonist has fallen in this encounter: ${customRule}.
  • Adapt all choices to reflect their downed condition and respawn/aftermath mechanics:
    1. RELEASE SPIRIT / RESPAWN: Surrender physical vessel and return to the nearest graveyard, soul shrine, or bindstone.
    2. AWAIT RESURRECTION: Send out a spirit flare, whisper through bond, or call on an ally/healer for a revival.
    3. DESPERATE SACRIFICE / SPIRIT PULSE: A last-ditch ephemeral activation, trigger item, or parting plea.
    4. SLIP INTO THE SHADOWS / PHANTOM FORM: Drift in ghost form, evaluate defeat, or assess threat logs.
    5. ALLY INTERVENTION: Signal companions to fall back, secure player's remnant, or disengage.`;
        } else if (/burnout|exhaust|faint|pass out|fatigue/i.test(customRule) || fate.cyoaStyle === 'burnout') {
            downedSection = `CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:
- When {{user}} is at Max Harm / 0 HP (${statusToken} / Defeated / Exhausted):
  • STRICT MANDATE: DO NOT offer standard active actions, confident banter, or energetic maneuvers. The protagonist has reached complete burnout: ${customRule}.
  • Adapt all choices to reflect their total emotional/physical exhaustion:
    1. COLLAPSE / RETREAT TO REST: Surrender to exhaustion, collapse into bed, or retreat to sleep.
    2. ACCEPT COMFORT / CARE: Allow a friend, companion, or loved one to take over and nurse you.
    3. RAW CONFESSION / TEARS: Let tears spill out, voice unvarnished vulnerability, or vent overwhelmed feelings.
    4. SLIP INTO SILENCE / WITHDRAW: Shut down outward communication, hide under blankets, or endure the fatigue.
    5. ALLY INTERVENTION: Look to friends or companions to step in, protect you from scrutiny, or care for you.`;
        } else {
            downedSection = `CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:
- When {{user}} is at Max Harm / 0 HP (${statusToken} / Defeated / Downed):
  • STRICT MANDATE: DO NOT offer standard active actions, confident dialogue, or normal maneuvers. The protagonist is downed: ${customRule}.
  • Adapt all choices to reflect their condition (${customRule}):
    1. SUCCUMB TO THE CRISIS: Accept the immediate fictional consequence of ${customRule}.
    2. FAINT UTTERANCE / CALL FOR AID: Whisper a desperate final word, reach out to an ally, or signal for help.
    3. DESPERATE SACRIFICE / GAMBIT: A last-ditch, fading gesture or protective sacrifice.
    4. SLIP INTO UNCONSCIOUSNESS: Succumb to the outcome, play dead, or fade out.
    5. ALLY INTERVENTION: Look to an ally to step in, drag {{user}} away, or turn the tide.`;
        }
    } else {
        downedSection = `CRITICAL — DOWNED / MAX HARM (0 HP) ADAPTIVE CHOICES:
- When {{user}} is at Max Harm / 0 HP (Incapacitated / Defeated / Dying):
  • STRICT MANDATE: DO NOT offer standard active actions, confident dialogue, or physical combat maneuvers. The protagonist is completely incapacitated or on the verge of death.
  • Adapt all choices to reflect their desperate, helpless, or unconscious condition:
    1. CLING TO LIFE / LAST BREATH: Fight to remain conscious or hold on to life.
    2. FAINT UTTERANCE / CALL FOR AID: Whisper a desperate final word, reach out to an ally, or signal for help.
    3. DESPERATE SACRIFICE / GAMBIT: A last-ditch, fading gesture or protective sacrifice.
    4. SLIP INTO THE DARKNESS: Succumb to unconsciousness, play dead, or endure the blackness.
    5. ALLY INTERVENTION: Look to an ally to step in, drag {{user}} to cover, or turn the tide.
    (In slice-of-life: choices reflect total emotional/physical burnout, retreating to bed/tears, or letting friends care for them).`;
    }

    return `[INTERACTIVE CHOICE BUTTONS]
- You MUST ALWAYS end your response with exactly ${choiceCount} choices for the user. NEVER forget the choices.
- Output sequence: (1) Scene narrative -> (2) <choices> block -> (3) Status footer.
- Enclose all choices inside a single <choices> XML block.
- Wrap every single choice in a <button> tag.${emojiLine}
- NO D&D MECHANICS: NEVER output target DCs (e.g. "DC 14"), Armor Class ("vs AC 15"), or advantage/disadvantage. In PbtA, moves roll 2d6 + Stat against fixed tiers (10+ Full Success | 7–9 Mixed Success | 6- Miss).
- When a choice triggers a PbtA Move, format it as: — [Move Name (+Stat)]
- When a choice consumes equipment or uses a gear tag, format it as: — [-1 Resource] or — [Item Name (tag)]

Choice types available:
- NORMAL: Plain action or spoken dialogue (e.g. "Open the blast door" or "Tell me what you know")
- MOVE TRIGGER: Action that triggers a Move with stat modifier: — [Move Name (+Stat)]
- ARCHETYPE / TAG: Action leveraging special playbook moves or gear tags

TENSION-ADAPTIVE MOVE PACING:
- EVALUATE SCENE TENSION BEFORE GENERATING CHOICES:
  • LOW TENSION / DOWNTIME (Taverns, campfires, safehouses, transit, shopping, routine conversation):
    Generate 100% plain dialogue, inquiry, and narrative actions (ZERO moves). Ordinary conversation and routine tasks NEVER use dice.
  • SIMMERING FRICTION / SOCIAL STANDOFF (Diplomacy, interrogation, tense standoff with leverage):
    At most 1 choice triggers a Move (e.g. Parley, Fast-Talk, or sudden draw). The other choices must be spoken dialogue, observation, or tactical positioning.
  • HIGH TENSION / PERIL (Active combat, chases, lethal traps, frantic escape):
    1 to 2 choices may trigger tactical Moves (e.g. melee, ranged, spells/tech), while the remaining choices provide tactical maneuvers, taking cover, positioning, or spoken commands (no move tags).
- NEVER OVERLOAD: Never offer more than 2 choices with moves even in deadly combat. Most choices should always be narrative or conversational options.

STANCE, HOLD & DILEMMA INTEGRATION:
- STANCE-LOADED CHOICES: Action choices may express a clear tactical stance (e.g., aggressive strike vs. defensive parry, stealthy approach vs. bold charge). When rolled, the MC will honor this declared stance without pausing for confirmation.
- SPENDING HOLD: If {{user}} has spendable Hold in [CHARACTER] (e.g. "Hold: 2 (Tactical Advantage)"), at most 1 choice may offer to spend a point: — [Spend 1 Hold: Tactical Advantage].
- DILEMMA CONTINUATION: When the preceding narrative introduced a complication (from a 7–9 Weak Hit) or a telegraphed threat (from a Soft Move), ensure the choices provide concrete ways to navigate that dilemma.

${downedSection}

EXAMPLES (Formatting & Ratio Reference):
${examples}

${orderInstructions}`;
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
    const config = overrides.config || overrides || {};
    const harmMax = config.harmMax || overrides.harmMax || 5;
    const pacingXp = config.pacingXp || overrides.pacingXp || 5;
    const fate = config.maxHarmFate || overrides.maxHarmFate;
    const isCustomFate = Boolean(fate && fate.statusToken && !/^(-|\(\-\))\s*incapacitated/i.test(fate.statusToken.trim()));
    const statusInstruction = isCustomFate
        ? `When {{user}} is at Max Harm / 0 HP (${harmMax}/${harmMax} Harm, 0/${harmMax} HP), status MUST reflect condition: Status: ${fate.statusToken}, (-) Incapacitated, (-) Dying, or Defeated. Use plain "Healthy" when unaffected.`
        : `When {{user}} is at Max Harm / 0 HP (${harmMax}/${harmMax} Harm, 0/${harmMax} HP), status MUST reflect incapacitation: Status: (-) Incapacitated, (-) Dying, or Defeated. Use plain "Healthy" when unaffected.`;

    const statsList = (Array.isArray(overrides.stats) && overrides.stats.length > 0)
        ? overrides.stats
        : genre.stats;
    const statsExample = statsList.map((s, idx) => `${s} ${idx === 0 ? '+2' : idx < 3 ? '+1' : idx === 3 ? '+0' : '-1'}`).join(', ');

    return {
        character: `Main character's core stats. MECHANICS ONLY: Never include narrative background or physical appearance in [CHARACTER].
NO D&D MECHANICS: Never write "1d8 damage", "attack rolls", "disadvantage", "5 ft", or "turns". Use PbtA concepts: Harm (+1 Harm), positioning, and modifiers (+1 forward, +1 hold).
Format:
[CHARACTER]
{{user}} (Archetype): ${harmMax}/${harmMax} HP | Harm: 0/${harmMax} | Armor: 0
Stats: ${statsExample}
((PILLS)) Moves: Move 1 [+Stat] (Trigger and narrative effect), Move 2 [+Stat] (Trigger and narrative effect)
((PILLS)) Gear: Signature weapon (Tags, 2 Harm), Protective gear ((+) Armor 1)
Wealth: Coin 3 (or setting currency)
((PILLS)) Conditions: None
Hold/Forward: None
XP: 0/${pacingXp}
Status: Healthy
[/CHARACTER]

PILL FORMATTING (renders as interactive badges with mouse-over tooltips):
- Moves: Separate moves with commas, using square brackets for the stat tag and a single pair of trailing parentheses for the entire trigger/effect description: Move Name [+Stat] (Trigger and effect). NEVER leave move descriptions outside parentheses or use nested parentheses inside a move description.
- Gear: Separate equipped items with commas, placing weapon tags, armor values, or uses inside trailing parentheses: Item Name (Tags, harm/armor). Use (+) for armor or protective bonuses, e.g. Static Shroud ((+) +1 Armor).
- Conditions & Status: Prefix harmful conditions with (-) for red pills, beneficial with (+) for green pills, e.g. ((PILLS)) Conditions: (-) Shaken (-1 forward to Wits), (+) Inspired (+1 forward).
  NO D&D DAMAGE-OVER-TIME OR ROUND/TURN COUNTERS: NEVER output "1 damage per round", "X turns remaining", or saving throw DC tickers. PbtA conditions are fictional debilities or narrative triggers (e.g. "(-) Bleeding (Risk taking +1 Harm on strenuous physical action without medical aid)").
  ${statusInstruction}`,

        party: `Companion and party members. MECHANICS ONLY. Lean & boon-driven hirelings/allies (Dungeon World style) — no full stat arrays. Every member MUST begin with their own header line. Separate distinct members with an empty line:
Name (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
((PILLS)) Moves: Tactical Support (+1 forward on defense or positioning when standing near companion), Second Move (Trigger and narrative effect)
((PILLS)) Gear: Signature weapon (Tags, 2 Harm), Protective gear ((+) Armor 1)
((PILLS)) Bonds: Protagonist Name (Bond or debt detail), Faction Name (Relationship context)
((PILLS)) Conditions: None
Status: Healthy

Second Companion (Archetype): 5/5 HP | Harm: 0/5 | Armor: 0
Appearance: Key physical features, clothing, or silhouette
((PILLS)) Moves: Signature Move (Trigger and narrative effect)
((PILLS)) Gear: Utility item (Tags)
((PILLS)) Bonds: Protagonist Name (Bond detail)
((PILLS)) Conditions: None
Status: Healthy

PILL FORMATTING: Separate companion moves, gear, and bonds with commas and put the trigger/effect/tag in parentheses: Name (detail). Details appear on hover.`,

        combat: `Active enemies and environmental threats in combat.
Group threats under ENEMIES: and NON-PARTY ALLIES: headers.
CRITICAL FORMAT: Every combatant MUST start on its own line with Name: cur/max HP | Harm: cur/max | Armor: X — the HP token is required for the tracker to recognize the combatant. HP descends in tandem with Harm (e.g. a 4-Harm enemy: 4/4 HP | Harm: 0/4; after 1 Harm: 3/4 HP | Harm: 1/4; at 4 Harm: 0/4 HP | Harm: 4/4, Status: Defeated).
Use this format:
THREAT LEVEL: (Skirmish / Peril / Catastrophe)
ENEMIES:
Name: 4/4 HP | Harm: 0/4 | Armor: 1 | Threat: (Minion / Veteran / Boss)
((PILLS)) Attacks: Attack Name (Harm dealt, tags like close/reach/far/messy), Second Attack (Harm dealt, tags)
Instinct: (What this threat desires or how it fights, e.g. "To overwhelm with numbers")
Status: Healthy

PILL FORMATTING (the tracker turns these into hoverable pills):
- Separate multiple attacks, abilities, or statuses with commas, and put each one's detail in trailing parentheses: Name (detail). The detail appears on hover. Keep commas out of the detail text unless they are inside the parentheses.
- Status entries start with (-) for harmful conditions (red) or (+) for beneficial ones (green), e.g. Status: (-) Winded (-1 forward on the next Act Under Fire), (+) Enraged (+1 Harm dealt). Use plain "Healthy" when unaffected.
- Optional extra lines for special threats, same Name (detail) style: ((PILLS)) Abilities: Heavy Hauler (Holds a grabbed target in place), Weakness: White birch fire (Ignores Armor).`,

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
 * Formats setting axioms, substitutions, and strict negative constraints into a
 * prompt block for MultiHog's compiled system prompt.
 *
 * @param {object} worldRules
 * @returns {string}
 */
export function buildPbtAWorldRulesContent(worldRules) {
    if (!worldRules || typeof worldRules !== 'object') return '';
    const axioms = Array.isArray(worldRules.axioms) ? worldRules.axioms : [];
    if (!axioms.length) return '';

    const lines = [
        '<world_rules>',
        '[MANDATORY PHYSICAL & SETTING LAWS OF THIS WORLD]',
        'Adhere strictly to the following setting axioms and physical reality:',
    ];

    axioms.forEach((ax, idx) => {
        const title = (ax.title || `Axiom ${idx + 1}`).trim();
        const cat = (ax.category || 'physics').toUpperCase();
        lines.push(`\n# Axiom ${idx + 1}: ${title} (${cat})`);
        if (ax.axiom) {
            lines.push(`- Setting Law: ${ax.axiom.trim()}`);
        }

        const subs = Array.isArray(ax.substitutions) ? ax.substitutions.filter(Boolean) : [];
        if (subs.length) {
            lines.push('- Required Substitutions:');
            subs.forEach(s => lines.push(`  • ${s.trim()}`));
        }

        const negs = Array.isArray(ax.negativeConstraints) ? ax.negativeConstraints.filter(Boolean) : [];
        if (negs.length) {
            lines.push('- ABSENCES & STRICT NEGATIVE CONSTRAINTS:');
            negs.forEach(n => lines.push(`  • NEVER introduce: ${n.trim()}`));
        }

        if (ax.architecturalNotes) {
            lines.push(`- Infrastructure & Living Architecture:\n  • ${ax.architecturalNotes.trim()}`);
        }
    });

    lines.push('\nNEVER violate these axioms or revert to generic real-world/mechanical tropes.\n</world_rules>');
    return lines.join('\n');
}

/**
 * Builds the complete PbtA Game Cartridge object, optionally accepting dynamic overrides.
 *
 * @param {string} [genreKey='fantasy']
 * @param {object} [overrides={}]
 * @returns {object} Game cartridge definition
 */
export function buildPbtACartridge(genreKey = 'fantasy', overrides = {}) {
    if (typeof genreKey === 'object' && genreKey !== null) {
        overrides = genreKey;
        genreKey = overrides.genreKey || overrides.genre || 'fantasy';
    }
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const config = overrides.config || overrides || {};
    const harmMax = config.harmMax || overrides.harmMax || 5;
    const pacingXp = config.pacingXp || overrides.pacingXp || 5;
    const partyMode = config.partyMode || overrides.partyMode || 'squad';
    const playstyle = config.playstyle || overrides.playstyle || 'cyoa_5';
    const isFreeform = playstyle === 'freeform';
    const use24hTime = Boolean(
        config.use24hTime ?? overrides.use24hTime ?? (
            typeof globalThis !== 'undefined' &&
            globalThis.SillyTavern?.getContext?.()?.extensionSettings?.rpg_tracker?.use24hTime
        )
    );
    const useDdMmYyFormat = Boolean(
        config.useDdMmYyFormat ?? overrides.useDdMmYyFormat ?? (
            typeof globalThis !== 'undefined' &&
            globalThis.SillyTavern?.getContext?.()?.extensionSettings?.rpg_tracker?.useDdMmYyFormat
        )
    );

    const customSyspromptLibrary = [
        {
            id: 'pbta_base_override_role',
            tag: 'role',
            content: buildPbtARoleContent(isFreeform),
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
            content: buildPbtACombatContent(harmMax, overrides),
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
            content: buildPbtAFooterContent(harmMax, pacingXp, { use24hTime, useDdMmYyFormat }),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA Harm, XP, Hold, and Location/Time footer',
            origin: 'unlocked_base',
            baseTag: 'end_of_output_footer',
        },
        {
            id: 'pbta_base_override_xp',
            tag: 'xp_system',
            content: `<xp_system>\n- Award 1 XP whenever the player gets a Miss (6-) per <rng_system>: *(+1 XP — Miss)*.\n- Award 1 XP when a major milestone, personal discovery, or quest objective is resolved: *(+1 XP — [reason])*. \n- At ${pacingXp} XP, the player levels up: *(Level Up! Choose an Advance: +1 to a Stat (max +3), a new Playbook Move, or erase a Condition)*. Reset XP counter to 0/${pacingXp}.\n</xp_system>`,
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: `PbtA XP on 6- Miss & ${pacingXp} XP level advancement`,
            origin: 'unlocked_base',
            baseTag: 'xp_system',
        },
        {
            id: 'pbta_base_override_party',
            tag: '[PARTY]_mechanics',
            content: buildPbtAPartyContent(),
            enabled: partyMode !== 'solo',
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA companion format and 2d6 bench resolution',
            origin: 'unlocked_base',
            baseTag: '[PARTY]_mechanics',
        },
        {
            id: 'pbta_base_override_constraints',
            tag: 'constraints',
            content: buildPbtAConstraintsContent(isFreeform),
            enabled: true,
            scope: 'chat',
            icon: 'fa-lock-open',
            description: 'PbtA fiction-first constraints and modifier rules',
            origin: 'unlocked_base',
            baseTag: 'constraints',
        },
    ];

    if (overrides.tone || config.tone) {
        const toneStr = String(overrides.tone || config.tone).trim();
        if (toneStr) {
            customSyspromptLibrary.push({
                id: 'pbta_campaign_tone',
                tag: 'tone',
                content: `<tone>\nAtmosphere & Tone: ${toneStr}\nNarrate with this atmospheric style, sensory texture, mood, and genre conventions consistently.\n</tone>`,
                enabled: true,
                scope: 'chat',
                icon: 'fa-masks-theater',
                description: `Campaign tone: ${toneStr}`,
                origin: 'unlocked_base',
                baseTag: 'tone',
            });
        }
    }

    const factionsList = overrides.factions || config.factions;
    if (Array.isArray(factionsList) && factionsList.length > 0) {
        const fText = factionsList.map(f => `- ${f.name} (${f.standing || 'Neutral'}): ${f.agenda || 'Unstated'}${f.notes ? ` — ${f.notes}` : ''}`).join('\n');
        customSyspromptLibrary.push({
            id: 'pbta_campaign_factions',
            tag: 'factions',
            content: `<factions>\nCampaign Factions & Powers:\n${fText}\nPortray faction agents, rivalries, and shifting leverage dynamically in response to protagonist moves.\n</factions>`,
            enabled: true,
            scope: 'chat',
            icon: 'fa-flag',
            description: 'Campaign factions and political agendas',
            origin: 'unlocked_base',
            baseTag: 'factions',
        });
    }

    // Setting World Rules (Axioms, Substitutions, Negative Constraints)
    const worldRules = overrides.worldRules || config.worldRules;
    if (worldRules && Array.isArray(worldRules.axioms) && worldRules.axioms.length > 0) {
        const wrContent = buildPbtAWorldRulesContent(worldRules);
        if (wrContent) {
            customSyspromptLibrary.push({
                id: 'pbta_custom_world_rules',
                tag: 'world_rules',
                content: wrContent,
                enabled: true,
                scope: 'chat',
                icon: 'fa-globe',
                description: 'Setting Axioms, Laws, and Negative Constraints',
                origin: 'unlocked_base',
                baseTag: 'world_rules',
            });
        }
    }

    const syspromptModules = {
        // Unlocked overrides active
        role: false,
        rng_system: false,
        combat: false,
        ruleset_note: false,
        end_of_output_footer: false,
        xp_system: false,
        '[PARTY]_mechanics': false,
        constraints: false, // Suppress base D&D constraints containing disadvantage/spells
        CYOA_mode: !isFreeform,
        // D&D systems disabled in PbtA
        weapon_proficiencies: false,
        attacks_per_round: false,
        saving_throws: false,
        level_up_protocol: false,
        homebrew_and_custom_classes: false,
        resting: false,
        loot: false,
        random_events: false,
        world_rules: false, // Override active via customSyspromptLibrary
    };

    const baseBlockOrder = partyMode === 'solo'
        ? ['COMBAT', 'CHARACTER', 'INVENTORY', 'ABILITIES', 'XP', 'TIME']
        : ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'XP', 'TIME'];
    const customMod = worldRules?.customModule;
    if (customMod && (customMod.tag || customMod.fieldKey || customMod.label)) {
        const cTag = (customMod.tag || customMod.fieldKey || customMod.label).replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        if (!baseBlockOrder.includes(cTag)) {
            baseBlockOrder.push(cTag);
        }
    }

    const payload = {
        customSyspromptLibrary,
        syspromptModules,
        syspromptSectionOrder: [],
        stockPrompts: buildPbtAStockPrompts(genreKey, overrides),
        cyoaConfig: {
            useCustomPrompt: !isFreeform,
            customPromptText: isFreeform ? '' : buildPbtACyoaPrompt(genreKey, overrides),
            useButtonTags: !isFreeform,
            useXmlTag: !isFreeform,
            useEmojis: config.cyoaEmojis !== false,
            stripOldChoicesFromPrompt: true,
        },
        rngEnabled: true,
        // "rngQueueD20" enables the polyhedral RNG queue from which the PbtA
        // engine intercepts and consumes 2d6 values.
        rngQueueD20: true,
        rngQueueD100: false,
        diceD100Mode: false,
        diceFunctionTool: false, // Disable AI function-call dice to avoid player interruptions
        blockOrder: baseBlockOrder,
        modules: {
            combat: true,
            character: true,
            party: partyMode !== 'solo',
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
        `FORMAT MANDATE: Output [CHARACTER] using 5/5 HP | Harm: 0/5 | Armor: 0, Stats with modifiers, ((PILLS)) Moves: Move 1 (detail), Move 2 (detail), ((PILLS)) Gear: Signature weapon (tags), Armor ((+) +1 Armor), Wealth, ((PILLS)) Conditions: None, Hold/Forward: None, XP: 0/5, Status: Healthy. Do NOT output D&D stats (STR/DEX 1-20), AC, BAB, spell slots, or daily ability counters.`,
        customNotes ? `ADDITIONAL DETAILS: ${customNotes}` : null,
    ].filter(Boolean).join('\n');
}

/**
 * Splits a string on top-level commas or semicolons outside parentheses/brackets.
 * @param {string} str
 * @param {{ splitCommas?: boolean }} [opts]
 * @returns {string[]}
 */
export function splitTopLevelPillItems(str, { splitCommas = true } = {}) {
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
            (splitCommas && c === ',' && !(i > 0 && i < str.length - 1 && /\d/.test(str[i - 1]) && /\d/.test(str[i + 1])))
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
 * Formats a general pill item ("Name: Desc" -> "Name (Desc)") without matching colons deep inside prose.
 * @param {string} item
 * @returns {string}
 */
export function normalizePill(item) {
    if (typeof item !== 'string') return String(item || '');
    const trimmed = item.trim().replace(/^[-*•]\s*/, '').trim();
    if (!trimmed) return '';
    // Only treat a colon as "Name: Desc" if the label before the colon is short and has no parentheses
    const colonMatch = trimmed.match(/^([^:()]{1,40}):\s*(.+)$/);
    if (colonMatch && !/\([^)]+\)$/.test(trimmed)) {
        const name = colonMatch[1].trim();
        const desc = colonMatch[2].trim().replace(/\(/g, '[').replace(/\)/g, ']');
        return `${name} (${desc})`;
    }
    return trimmed;
}

/**
 * Formats a PbtA move or companion boon into a single clean MultiHog ((PILLS)) item:
 * "Move Name [+Stat] (Trigger and effect with no nested parentheses)"
 * Prevents upstream splitSmart from splitting on commas inside move descriptions,
 * and prevents upstream renderPills from truncating the move name at a (+Stat) paren.
 *
 * @param {string} item
 * @returns {string}
 */
export function formatMoveAsPill(item) {
    if (typeof item !== 'string') return String(item || '');
    const trimmed = item.trim().replace(/^[-*•]\s*/, '').trim();
    if (!trimmed) return '';

    const cleanDesc = (d) => {
        let s = String(d || '').trim();
        if (s.startsWith('(') && s.endsWith(')') && !s.slice(1, -1).includes(')')) {
            s = s.slice(1, -1).trim();
        }
        // Restore "choose one (a, b, or c)" if previously mangled by old normalizePill
        s = s.replace(/\b(choose\s+(?:one|two|three|\d+))\s*\(([^()]+)\)/gi, '$1: $2');
        return s.replace(/\(/g, '[').replace(/\)/g, ']').trim();
    };

    // Case 1: "Move Name (+Stat) Description..." or "Move Name (Passive) Description..."
    const statWithDescMatch = trimmed.match(/^([^(:\[\n—–]+?)\s*[\(\[]\s*([+-]?\s*[A-Za-z]{2,15})\s*[\)\]]\s*(?:[:—–-]\s*)?(\S[\s\S]*)$/);
    if (statWithDescMatch) {
        const moveName = statWithDescMatch[1].trim().replace(/[-—–:]\s*$/, '').trim();
        const rawTag = statWithDescMatch[2].trim().replace(/\s+/g, '');
        const desc = cleanDesc(statWithDescMatch[3]);
        return desc ? `${moveName} [${rawTag}] (${desc})` : `${moveName} (${rawTag})`;
    }

    // Case 2: "Move Name (+Stat)" with no description
    const statOnlyMatch = trimmed.match(/^([^(:\[\n—–]+?)\s*[\(\[]\s*([+-]\s*[A-Za-z]{2,15}|Passive|Innate|Active|Ritual)\s*[\)\]]$/i);
    if (statOnlyMatch) {
        const moveName = statOnlyMatch[1].trim().replace(/[-—–:]\s*$/, '').trim();
        const rawTag = statOnlyMatch[2].trim().replace(/\s+/g, '');
        return `${moveName} (${rawTag})`;
    }

    // Case 3: "Move Name: Description" or "Move Name — Description"
    const sepMatch = trimmed.match(/^([^:\n—–-]{2,45}?)\s*(?::|—|–|\s+-)\s+([\s\S]+)$/);
    if (sepMatch && !sepMatch[1].includes('(')) {
        const moveName = sepMatch[1].trim();
        const desc = cleanDesc(sepMatch[2]);
        return desc ? `${moveName} (${desc})` : moveName;
    }

    // Case 4: "Move Name (Description)"
    const parenMatch = trimmed.match(/^([^(:\n—–-]+?)\s*\(([\s\S]+)\)$/);
    if (parenMatch) {
        const moveName = parenMatch[1].trim().replace(/[:—–-]\s*$/, '').replace(/\(([^)]+)\)/g, '[$1]').trim();
        const desc = cleanDesc(parenMatch[2]);
        return desc ? `${moveName} (${desc})` : moveName;
    }

    return normalizePill(trimmed);
}

/**
 * Formats a PbtA condition item into a clean pill, stripping echoed prompt hints
 * like "Starting injury or weakness:" and ensuring a (-) or (+) prefix.
 * @param {string} item
 * @returns {string}
 */
export function formatConditionAsPill(item) {
    if (typeof item !== 'string') return '';
    let s = item.trim().replace(/^[-*•]\s*/, '').trim();
    if (!s) return '';

    let prefix = '';
    const pm = s.match(/^(\([+-]\))\s*(.*)$/);
    if (pm) {
        prefix = pm[1];
        s = pm[2].trim();
    }

    s = s.replace(/^(?:starting\s+(?:injury(?:\s+or\s+weakness)?|weakness|condition)|placeholder|guidance)\s*(?:[:—–-]\s*)?/i, '').trim();
    if (s.startsWith('(') && s.endsWith(')') && !s.slice(1, -1).includes('(')) {
        s = s.slice(1, -1).trim();
    }
    if (!s || /^(?:none|n\/a|null|healthy|uninjured)$/i.test(s)) return '';
    if (/^[a-z]/.test(s)) {
        s = s.charAt(0).toUpperCase() + s.slice(1);
    }

    const normalized = normalizePill(s);
    return `${prefix || '(-)'} ${normalized}`;
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
    const harmMax = dossier.config?.harmMax || p.harm?.max || 5;
    const pacingXp = dossier.config?.pacingXp || 5;
    const isSolo = dossier.config?.partyMode === 'solo';
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

    // Format moves (comma-separated for pill splitting, with single trailing paren per move)
    const rawMoves = Array.isArray(p.startingMoves) && p.startingMoves.length > 0
        ? p.startingMoves
        : ['Act Under Fire (+Cool)', 'Read a Tense Situation (+Sharp)'];
    const movesStr = rawMoves.map(formatMoveAsPill).filter(Boolean).join(', ');

    // Format gear: prefer real p.gear items, else p.equipment, else stock fallback
    const hasCustomGear = Array.isArray(p.gear) && p.gear.length > 0 && !p.gear.every(g => /^(?:Essential adventurer kit|Signature weapon|Basic equipment)/i.test(String(g || '').trim()));
    const rawGear = hasCustomGear
        ? p.gear
        : (typeof p.equipment === 'string' && p.equipment.trim())
            ? splitTopLevelPillItems(p.equipment)
            : (Array.isArray(p.gear) && p.gear.length > 0)
                ? p.gear
                : (typeof p.gear === 'string' && p.gear.trim())
                    ? splitTopLevelPillItems(p.gear)
                    : ['Essential adventurer kit (utility tools)', 'Signature weapon (2 Harm, close)'];
    const gearStr = rawGear.map(normalizePill).filter(Boolean).join(', ');

    const locationStr = (kick.startingLocation || dossier.maps?.[0]?.site || 'The Starting Threshold').trim();

    const blocks = [];

    // 1. TIME Block
    blocks.push(`[TIME]\nDay 1, 08:00 AM (Morning)\n[/TIME]`);

    // 2. LOCATION Block
    blocks.push(`[LOCATION]\n${locationStr}\n[/LOCATION]`);

    // 3. CHARACTER Block
    const harmCurrent = Math.max(0, parseInt(p.harm?.current, 10) || 0);
    const curHp = Math.max(0, harmMax - harmCurrent);
    const rawConditions = Array.isArray(p.conditions)
        ? p.conditions.flatMap(c => typeof c === 'string' ? splitTopLevelPillItems(c) : [])
        : (typeof p.conditions === 'string' ? splitTopLevelPillItems(p.conditions) : []);
    let condsStr = rawConditions.map(formatConditionAsPill).filter(Boolean).join(', ');
    if (!condsStr) {
        condsStr = harmCurrent > 0 ? '(-) Wounded' : 'None';
    }
    const statusStr = p.status ? p.status.trim() : (harmCurrent > 0 ? '(-) Wounded' : 'Healthy');

    const charLines = [
        `[CHARACTER]`,
        `${charName} (${playbook}): ${curHp}/${harmMax} HP | Harm: ${harmCurrent}/${harmMax} | Armor: ${armor}`,
        `Stats: ${statsStr}`,
        `((PILLS)) Moves: ${movesStr}`,
        `((PILLS)) Gear: ${gearStr}`,
        `((PILLS)) Conditions: ${condsStr}`,
        `Hold/Forward: None`,
        `XP: 0/${pacingXp}`,
        `Status: ${statusStr}`,
        `[/CHARACTER]`,
    ];
    blocks.push(charLines.join('\n'));

    // 3b. If companion NPCs exist in the dossier and party mode is not solo, initialize [PARTY] block
    const npcs = dossier.npcs || [];
    const companions = isSolo ? [] : npcs.filter(n => {
        const r = (n.role || '').toLowerCase();
        return r.includes('companion') || r.includes('party') || r.includes('sidekick') || r.includes('follower') || r.includes('partner');
    });
    if (companions.length > 0) {
        const partyLines = ['[PARTY]'];
        for (let i = 0; i < companions.length; i++) {
            const comp = companions[i];
            const cName = comp.name || 'Companion';
            // Determine display archetype/role: prefer archetype/playbook, or cleaned role without parentheticals like '(Party)'
            let cTitle = comp.archetype || comp.playbook || '';
            if (!cTitle) {
                const rawRole = (comp.role || 'Companion').replace(/\s*\([^)]*\)/g, '').trim();
                cTitle = rawRole || 'Companion';
            }
            cTitle = cTitle.replace(/[()]/g, '').trim() || 'Companion';
            let cBoons = comp.movesOrBoons || 'Assist (+1 forward when cooperating)';
            const rawBoons = Array.isArray(cBoons)
                ? cBoons
                : typeof cBoons === 'string'
                    ? splitTopLevelPillItems(cBoons, { splitCommas: !cBoons.includes(';') && !cBoons.includes(':') })
                    : [String(cBoons)];
            const cBoonsStr = rawBoons.map(formatMoveAsPill).filter(Boolean).join(', ');

            let cGear = comp.equipment || comp.gear || 'Signature equipment (utility)';
            const rawCompGear = Array.isArray(cGear)
                ? cGear
                : typeof cGear === 'string'
                    ? splitTopLevelPillItems(cGear)
                    : [String(cGear)];
            const cGearStr = rawCompGear.map(normalizePill).filter(Boolean).join(', ');

            let cBonds = comp.relationship || `${charName} (Allied with protagonist)`;
            let cBondsStr = '';
            if (Array.isArray(cBonds)) {
                cBondsStr = cBonds.map(normalizePill).filter(Boolean).join(', ');
            } else if (typeof cBonds === 'string') {
                const trimmedBond = cBonds.trim();
                // If it's a long prose sentence without trailing parens, wrap it as "ProtagonistName (Relationship detail)"
                if (trimmedBond && (trimmedBond.length > 40 || /[;.]/.test(trimmedBond)) && !/\([^)]+\)$/.test(trimmedBond) && !trimmedBond.toLowerCase().startsWith(charName.toLowerCase())) {
                    const safeBondDesc = trimmedBond.replace(/\(/g, '[').replace(/\)/g, ']');
                    cBondsStr = `${charName} (${safeBondDesc})`;
                } else {
                    cBondsStr = splitTopLevelPillItems(trimmedBond).map(normalizePill).filter(Boolean).join(', ');
                }
            } else {
                cBondsStr = `${charName} (Allied with protagonist)`;
            }

            const cApp = comp.appearance || comp.description || (comp.demeanor ? `${comp.demeanor} demeanor` : '');

            const cHarmMax = comp.harm?.max || 5;
            const cHarmCur = Math.max(0, parseInt(comp.harm?.current, 10) || 0);
            const cCurHp = Math.max(0, cHarmMax - cHarmCur);
            const cArmor = comp.harm?.armor || parseInt(comp.armor, 10) || 0;
            const rawCConds = Array.isArray(comp.conditions)
                ? comp.conditions.flatMap(c => typeof c === 'string' ? splitTopLevelPillItems(c) : [])
                : (typeof comp.conditions === 'string' ? splitTopLevelPillItems(comp.conditions) : []);
            let cCondsStr = rawCConds.map(formatConditionAsPill).filter(Boolean).join(', ');
            if (!cCondsStr) {
                cCondsStr = cHarmCur > 0 ? '(-) Wounded' : 'None';
            }
            const cStatus = comp.status ? comp.status.trim() : (cHarmCur > 0 ? '(-) Wounded' : 'Healthy');

            if (i > 0) partyLines.push('');
            partyLines.push(
                `- ${cName} (${cTitle}): ${cCurHp}/${cHarmMax} HP | Harm: ${cHarmCur}/${cHarmMax} | Armor: ${cArmor}`,
                ...(cApp ? [`Appearance: ${cApp}`] : []),
                `((PILLS)) Moves: ${cBoonsStr}`,
                `((PILLS)) Gear: ${cGearStr}`,
                `((PILLS)) Bonds: ${cBondsStr}`,
                `((PILLS)) Conditions: ${cCondsStr}`,
                `Status: ${cStatus}`
            );
        }
        partyLines.push('[/PARTY]');
        blocks.push(partyLines.join('\n'));
    }

    // 4. If maps exist, add DUNGEON block
    if (dossier.maps?.[0]?.site) {
        blocks.push(`[DUNGEON]\nActive Site: ${dossier.maps[0].site}\nThreat: ${dossier.maps[0].threat || 'MODERATE'}\n[/DUNGEON]`);
    }

    // 5. If factions exist, add FACTIONS block
    if (Array.isArray(dossier.factions) && dossier.factions.length > 0) {
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

    // 6. If Custom HUD Module exists, add initial custom module block
    const customMod = dossier?.worldRules?.customModule;
    if (customMod && (customMod.tag || customMod.fieldKey || customMod.label)) {
        const rawTag = (customMod.tag || customMod.fieldKey || customMod.label || 'CUSTOM')
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .toUpperCase();
        const label = customMod.label || customMod.tag || customMod.fieldKey || 'Custom Tracker';
        const sampleContent = (customMod.sampleContent || customMod.sample || `${label}: Initialized`).trim();
        blocks.push(`[${rawTag}]\n${sampleContent}\n[/${rawTag}]`);
    }

    return blocks.join('\n\n');
}
