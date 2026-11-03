/**
 * fae-ruleset.js — MultiHog Companion
 *
 * Provides the Freeform Attrition Engine (FAE) ruleset, deterministic 4dF mechanics,
 * genre skeletons, pre-computed turn resolution matrices, and cartridge builders
 * for single-pass narrative roleplay without action economy or binary pass/fail rolls.
 */

export const FAE_CARTRIDGE_ID = 'fae_attrition_engine_v1';
export const CARTRIDGE_FORMAT = 'multihog-game-cartridge';
export const CARTRIDGE_VERSION = 1;

/**
 * @deprecated Deprecated in favor of the LLM Trait Qualification Protocol (Section 2.3.1).
 * Universal blacklist of "God Tags" retained only for backwards compatibility.
 */
export const FAE_GOD_TAGS_BLACKLIST = [
    'lucky',
    'smart',
    'competent',
    'fast',
    'heroic',
    'strong',
    'good at everything',
    'invincible',
    'master',
    'omni',
];

/**
 * Maps a pool bar color name to a valid CSS suffix token supported by MultiHog's ((BAR<COLOR>)) syntax.
 * MultiHog renderer matches ((BARBLUE)), ((BARGOLD)), ((BARPURPLE)), ((BARRED)), ((BARGREEN)).
 * Note: 'amber' is invalid CSS and unsupported by MultiHog's regex; it maps to '((BARGOLD))'.
 *
 * @param {string} [barColor='purple']
 * @returns {string} e.g. '((BARPURPLE))', '((BARGOLD))'
 */
export function toMultihogBarMarker(barColor = 'purple') {
    const c = String(barColor || '').trim().toLowerCase();
    switch (c) {
        case 'amber':
        case 'yellow':
        case 'gold':
        case 'orange':
            return '((BARGOLD))';
        case 'blue':
        case 'cyan':
            return '((BARBLUE))';
        case 'purple':
        case 'violet':
            return '((BARPURPLE))';
        case 'red':
        case 'crimson':
            return '((BARRED))';
        case 'green':
            return '((BARGREEN))';
        default:
            return '((BARPURPLE))';
    }
}

/**
 * 7 Canonical FAE Genre Skeletons with resource pools, knobs, and archetypes.
 */
export const FAE_GENRES = {
    cosmic_horror: {
        id: 'cosmic_horror',
        label: 'Cosmic Horror Investigation (1920s Cthulhu / Caves of Madness)',
        icon: '🐙',
        multihogGenre: 'horror',
        knobs: {
            flee_grace_toggle: true,
            base_attrition_shift: 0,
            overflow_default: 'scar_and_ko',
            breather_available: true,
        },
        pools: {
            health: {
                key: 'health',
                label: 'Health',
                barColor: 'green',
                current: 8,
                max: 8,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'bruised ribs, winded breath, and grazing blows',
                zero_debuff: 'Crippled & Bleeding',
                on_overflow: 'scar_and_ko',
            },
            sanity: {
                key: 'sanity',
                label: 'Sanity',
                barColor: 'purple',
                current: 8,
                max: 8,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'day_pass',
                    amount: 1,
                    reason: 'The oppressive psychic resonance erodes your mind each day.',
                },
                strain_flavor: 'creeping dread, cold sweat, and sensory static',
                zero_debuff: 'Manic Dissociation',
                on_overflow: 'lethal',
            },
        },
        defaultPositiveTags: [
            'Ex-Military',
            'Calm [under gunfire and shock]',
            'Quiet',
            'Service Revolver',
        ],
        archetypes: [
            'The Antiquarian',
            'The Alienist',
            'The Private Investigator',
            'The Occult Scholar',
            'The Reluctant Heir',
            'The Escaped Patient',
        ],
        sampleEncounter: `The Whispering Study: 2/2 HP | Threat: 3 (Elite) | Pools: Sanity, Time
((PILLS)) Pressures: Shifting Geometric Diagrams (Sanity), Scratching Inside the Walls (Sanity), Approaching Cultist Patrol (Time)
Leverage Barriers (2 Layers): [1. Ciphered Ritual Ledger] [2. Locked Iron Safe]
Full-Finish Triggers: Grab the ledger and run (1 Turn), OR crack both layers to uncover the ritual's true weakness
Status: Unsearched`,
        cyoaExamples: [
            '1. 📜 Decipher the rituals in the ledger on the oak desk — [Sanity | +Occult Scholar]',
            '2. 🔦 Search the walls for hidden compartments or the safe — [Sanity]',
            '3. 🚪 Wedge a chair under the door handle to buy time against the cultists',
            '4. 💬 "We only have minutes. Help me find the seal before they break through!"',
            '5. 🏃 Grab the ledger and flee through the bay window before your mind breaks — [Sanity]',
        ],
    },
    osr_dungeon: {
        id: 'osr_dungeon',
        label: 'Gritty OSR Dungeon Crawl (Dark Fantasy Delve)',
        icon: '🕯️',
        multihogGenre: 'fantasy',
        knobs: {
            flee_grace_toggle: false,
            base_attrition_shift: 0,
            overflow_default: 'lethal',
            breather_available: true,
        },
        pools: {
            health: {
                key: 'health',
                label: 'Health',
                barColor: 'green',
                current: 10,
                max: 10,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'parrying shock, aching muscles, and dented armor',
                zero_debuff: "Death's Door",
                on_overflow: 'lethal',
            },
            resolve: {
                key: 'resolve',
                label: 'Resolve',
                barColor: 'blue',
                current: 6,
                max: 6,
                recovery: 'scene_breather',
                passive_drain: null,
                strain_flavor: 'frayed nerves, hesitation, and pounding heart',
                zero_debuff: 'Rattled & Hesitant',
                on_overflow: 'redirect:health',
            },
            torch_and_supplies: {
                key: 'torch_and_supplies',
                label: 'Torch & Supplies',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'camp_or_sleep',
                    amount: 1,
                    reason: 'Making camp consumes rations, water, and lantern oil.',
                },
                strain_flavor: 'dwindling rations and flickering torchlight',
                zero_debuff: 'Pitch Black & Starving',
                on_overflow: 'redirect:resolve',
            },
        },
        defaultPositiveTags: [
            'Veteran Mercenary (Frontline battle tactics and armor comfort)',
            'Heavy Shield (Sturdy oak shield for parrying)',
            'Trap-Wise (Keen eye for floor plates and tripwires)',
            'Companion: Brother Marcus (Cleric — blesses blades and wards off undead)',
        ],
        archetypes: [
            'The Sellsword',
            'The Grave Robber',
            'The Torchbearer',
            'The Hedge Cleric',
            'The Outcast Mage',
        ],
        sampleEncounter: `Goblin Cliff-Ambush: 2/2 HP | Threat: 2 (Standard) | Pools: Health, Resolve
((PILLS)) Pressures: Crossbow Volleys from the Ledge (Health), Warhammer Boss Blocking the Pass (Health), Mocking War-Chants (Resolve)
Leverage Barriers (2 Layers): [1. High Ground Crossbows] [2. Boss's Heavy Shield Wall]
Full-Finish Triggers: Slip past into the cave (1 Turn), OR break a Barrier first to rout the group
Status: Entrenched`,
        cyoaExamples: [
            '1. ⚔️ Raise your shield and charge the warhammer boss — [Health | +Heavy Shield]',
            '2. 🏹 Return fire at the crossbow snipers pinned on the high ledge — [Resolve]',
            '3. 🪨 Duck behind a stone outcrop to catch your breath and assess positions',
            '4. 🗣️ "Throw down your weapons! The cavern behind you is collapsing!"',
            '5. 🏃 Dive through the volley toward the dark cave entrance — [Health]',
        ],
    },
    survival_horror: {
        id: 'survival_horror',
        label: 'Survival / Bio-Horror (Outbreak / Final Girl)',
        icon: '🪓',
        multihogGenre: 'horror',
        knobs: {
            flee_grace_toggle: true,
            base_attrition_shift: 1,
            overflow_default: 'lethal',
            breather_available: true,
        },
        pools: {
            health: {
                key: 'health',
                label: 'Health',
                barColor: 'green',
                current: 8,
                max: 8,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'close scrapes, torn clothes, and bruised limbs',
                zero_debuff: 'Critically Injured',
                on_overflow: 'lethal',
            },
            nerve: {
                key: 'nerve',
                label: 'Nerve',
                barColor: 'blue',
                current: 6,
                max: 6,
                recovery: 'scene_breather',
                passive_drain: null,
                strain_flavor: 'pounding pulse, gasping breath, and trembling grip',
                zero_debuff: 'Panic-Stricken',
                on_overflow: 'redirect:health',
            },
            ammo_and_battery: {
                key: 'ammo_and_battery',
                label: 'Ammo & Battery',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'scene_transition',
                    amount: 1,
                    reason: 'Navigating unlit corridors drains flashlight power and consumes ammunition.',
                },
                strain_flavor: 'dwindling shells and flickering flashlight beam',
                zero_debuff: 'Click on Empty & Dark',
                on_overflow: 'redirect:nerve',
            },
        },
        defaultPositiveTags: [
            'Field Medic (Emergency triage under duress)',
            'Light on Feet (Silent steps and nimble evasion)',
            'Fire Axe (Heavy chopping tool and bludgeon)',
            'Resourceful (Making every shell and battery count)',
        ],
        archetypes: [
            'The Final Girl',
            'The Beat Cop',
            'The Paramedic',
            'The Engineer',
            'The Desperate Survivor',
        ],
        sampleEncounter: `Bio-Horror in Ward B: 2/2 HP | Threat: 3 (Elite) | Pools: Health, Nerve
((PILLS)) Pressures: Tendril Sweep from Ceiling (Health), Guttural Shriek Echoes (Nerve), Spreading Spore Mist (Health)
Leverage Barriers (2 Layers): [1. Armored Chitin Husk] [2. Blind Flailing Claws]
Full-Finish Triggers: Jam the fire door shut to trap it (1 Turn), OR sever the sensory tentacles to dispatch it
Status: Stalking`,
        cyoaExamples: [
            '1. 🪓 Swing the fire axe into the creature\'s exposed sensory tentacles — [Health | +Fire Axe]',
            '2. 🔦 Flash the high-beam strobe into its milky eyes to blind it — [Nerve]',
            '3. 🤫 Hold your breath behind the overturned gurney until the tentacles retract',
            '4. 🤝 Grab the wounded orderly and haul them into the security office',
            '5. 🏃 Sprint for the emergency stairwell and throw the iron deadbolt — [Health]',
        ],
    },
    post_apocalyptic: {
        id: 'post_apocalyptic',
        label: 'Post-Apocalyptic Wasteland (Dust & Fallout)',
        icon: '☣️',
        multihogGenre: 'scifi',
        knobs: {
            flee_grace_toggle: true,
            base_attrition_shift: 0,
            overflow_default: 'scar_and_ko',
            breather_available: true,
        },
        pools: {
            body: {
                key: 'body',
                label: 'Body',
                barColor: 'green',
                current: 9,
                max: 9,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'blunt impacts, coughing fits, and scorched flesh',
                zero_debuff: 'Broken & Battered',
                on_overflow: 'scar_and_ko',
            },
            grit: {
                key: 'grit',
                label: 'Grit',
                barColor: 'blue',
                current: 7,
                max: 7,
                recovery: 'scene_breather',
                passive_drain: null,
                strain_flavor: 'gritted teeth, dust in eyes, and exhaustion',
                zero_debuff: 'Shell-Shocked',
                on_overflow: 'redirect:body',
            },
            water_and_filters: {
                key: 'water_and_filters',
                label: 'Water & Filters',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'day_pass',
                    amount: 1,
                    reason: 'Surviving in the wasteland consumes rationed water and wears down respirator filters.',
                },
                strain_flavor: 'parched throat and whistling respirator filter',
                zero_debuff: 'Dehydrated & Rad-Sick',
                on_overflow: 'redirect:body',
            },
        },
        defaultPositiveTags: [
            'Wasteland Scrapper (Jury-rigging weapons and salvaged parts)',
            'Sawed-Off Shotgun (Devastating close-range punch)',
            'Rad-Hardened (Tolerance to ambient fallout and toxic water)',
            'Road-Tested (Expert driving and defensive maneuvers)',
        ],
        archetypes: [
            'The Road Warrior',
            'The Scavenger',
            'The Caravan Scout',
            'The Wasteland Shaman',
            'The Rad-Doctor',
        ],
        sampleEncounter: `Raider Checkpoint Barricade: 2/2 HP | Threat: 2 (Standard) | Pools: Body, Grit
((PILLS)) Pressures: Scrap-Iron Machine Gun Nest (Body), Spiked Road Blocks (Body), Howling Marauder Harassment (Grit)
Leverage Barriers (2 Layers): [1. Sandbag Bunker Gunner] [2. Welded Gate Chain]
Full-Finish Triggers: Floor the buggy through the drainage ditch (1 Turn), OR suppress the gunner to seize the toll gate
Status: Alerted`,
        cyoaExamples: [
            '1. 💥 Fire a slug into the gunner\'s observation slit — [Body | +Scrap Rifle]',
            '2. 🚗 Floor the accelerator toward the barricade gap — [Grit]',
            '3. 🔧 Splice the bypass cable under the dashboard to boost nitrous oxide',
            '4. 🗣️ "We have antibiotics and copper wire! Let\'s barter safe passage!"',
            '5. 🏃 Reverse into the ravine smoke screen to disengage — [Grit]',
        ],
    },
    cyberpunk_noir: {
        id: 'cyberpunk_noir',
        label: 'Cyberpunk / Syndicate Noir (High-Tech Low-Life)',
        icon: '🕵️',
        multihogGenre: 'scifi',
        knobs: {
            flee_grace_toggle: true,
            base_attrition_shift: 0,
            overflow_default: 'scene_fail',
            breather_available: true,
        },
        pools: {
            body: {
                key: 'body',
                label: 'Body',
                barColor: 'green',
                current: 8,
                max: 8,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'kinetic impacts, frayed wiring, and singing synth-skin',
                zero_debuff: 'System Shock & Flesh Rupture',
                on_overflow: 'scar_and_ko',
            },
            nerve: {
                key: 'nerve',
                label: 'Nerve',
                barColor: 'blue',
                current: 8,
                max: 8,
                recovery: 'scene_breather',
                passive_drain: null,
                strain_flavor: 'spiking adrenaline, sensory overload, and cyberware glitch',
                zero_debuff: 'Flatlined Focus',
                on_overflow: 'scene_fail',
            },
            heat_and_trace: {
                key: 'heat_and_trace',
                label: 'Heat & Trace',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'scene_transition',
                    amount: 1,
                    reason: 'Navigating syndicate territory increases ICE telemetry and surveillance pings.',
                },
                strain_flavor: 'pinging tracers and mounting corporate surveillance',
                zero_debuff: 'Burned & Pinged by CorpSec',
                on_overflow: 'redirect:nerve',
            },
        },
        defaultPositiveTags: [
            'Subdermal Cyberdeck (Direct neural interface for breach loops)',
            'Street-Smart (Reading underworld deals and informant tells)',
            'Silenced Monofilament Pistol (Lethal stealth sidearm)',
            'Ghost in the Net (Vanishing into encrypted proxy routes)',
        ],
        archetypes: [
            'The Hardboiled Detective',
            'The Netrunner',
            'The Street Samurai',
            'The Chrome Doctor',
            'The Fixer',
        ],
        sampleEncounter: `CorpSec Penthouse Breach: 2/2 HP | Threat: 3 (Elite) | Pools: Body, Nerve, Heat & Trace
((PILLS)) Pressures: Smart-Tracking Submachine Fire (Body), Black ICE Counter-Intrusion (Nerve), Automated Drone Sweep (Heat & Trace)
Leverage Barriers (2 Layers): [1. Heavy Enforcer Body Armor] [2. Biometric Terminal Lockdown]
Full-Finish Triggers: Grab the decrypted data shard and zip-line off the balcony (1 Turn), OR crack the mainframe
Status: Lockdown`,
        cyoaExamples: [
            '1. 💻 Burn through the ICE gate with an overclocked virus spike — [Nerve | +Cyberdeck]',
            '2. 🔫 Empty the silenced pistol into the enforcer\'s optic cluster — [Body | +Silenced Pistol]',
            '3. 🥷 Cut the room lights and blend into the server rack shadows',
            '4. 🎙️ Tap into the corp security frequency with a spoofed clearance code',
            '5. 🏃 Shatter the penthouse window and launch the grapple-line — [Body]',
        ],
    },
    deep_space: {
        id: 'deep_space',
        label: 'Deep Space Derelict (Void Survival)',
        icon: '🚀',
        multihogGenre: 'scifi',
        knobs: {
            flee_grace_toggle: false,
            base_attrition_shift: 1,
            overflow_default: 'lethal',
            breather_available: true,
        },
        pools: {
            body: {
                key: 'body',
                label: 'Body',
                barColor: 'green',
                current: 8,
                max: 8,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'suit micrometeoroid abrasions, muscle fatigue, and low-G nausea',
                zero_debuff: 'Decompressed & Traumatized',
                on_overflow: 'lethal',
            },
            sanity: {
                key: 'sanity',
                label: 'Sanity',
                barColor: 'purple',
                current: 7,
                max: 7,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'void claustrophobia, acoustic isolation, and uncanny echoes',
                zero_debuff: 'Space Madness / Void Terror',
                on_overflow: 'lethal',
            },
            oxygen_and_power: {
                key: 'oxygen_and_power',
                label: 'Oxygen & Power',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'scene_transition',
                    amount: 1,
                    reason: 'Exploring cold modules depletes suit oxygen scrubber and battery reserve.',
                },
                strain_flavor: 'hissing scrubber seals and blinking battery warnings',
                zero_debuff: 'Hypoxia & Suit Reserve Alarm',
                on_overflow: 'redirect:body',
            },
        },
        defaultPositiveTags: [
            'EVA Specialist (Thruster maneuvering and suit integrity)',
            'Plasma Torch (Heavy industrial cutter and hot defense)',
            'System Diagnostics (Diagnosing reactor faults and airlock seals)',
            'Cold-Blooded Composure (Suppression of existential dread)',
        ],
        archetypes: [
            'The Asteroid Miner',
            'The Ship Engineer',
            'The Medical Officer',
            'The Corporate Inspector',
            'The Void Navigator',
        ],
        sampleEncounter: `Derelict Hydroponics Hull Breach: 2/2 HP | Threat: 3 (Elite) | Pools: Body, Oxygen & Power
((PILLS)) Pressures: Explosive Vacuum Decompression (Body), Violent Shrapnel Swarm (Body), Rapid Oxygen Venting (Oxygen & Power)
Leverage Barriers (2 Layers): [1. Jammed Pressure Bulkhead] [2. Severed Emergency Cable]
Full-Finish Triggers: Manual seal of emergency hatch (1 Turn), OR secure tether and splice power
Status: Decompressing`,
        cyoaExamples: [
            '1. ⚡ Fire thrusters against the vacuum pull to reach the manual crank — [Body | +Heavy Loader Rig]',
            '2. 🔧 Splice the severed emergency bulkhead cable with wire-clips — [Oxygen & Power | +Systems Engineer]',
            '3. 🧲 Magnetize boots to the deck plate and brace against the howling air rush',
            '4. 🎙️ "Atmospheric venting in Hydroponics! Seal the corridor behind me!"',
            '5. 🏃 Throw yourself through the auxiliary hatch and slam the manual lever — [Body]',
        ],
    },
    weird_west: {
        id: 'weird_west',
        label: 'Weird West Frontier (Blood & Brimstone)',
        icon: '🤠',
        multihogGenre: 'fantasy',
        knobs: {
            flee_grace_toggle: true,
            base_attrition_shift: -1,
            overflow_default: 'scar_and_ko',
            breather_available: true,
        },
        pools: {
            grit: {
                key: 'grit',
                label: 'Grit',
                barColor: 'green',
                current: 9,
                max: 9,
                recovery: 'camp_or_sleep',
                passive_drain: null,
                strain_flavor: 'gunpowder burns, bruised ribs, and close whistling lead',
                zero_debuff: 'Bleeding Out in the Dust',
                on_overflow: 'scar_and_ko',
            },
            resolve: {
                key: 'resolve',
                label: 'Resolve',
                barColor: 'blue',
                current: 7,
                max: 7,
                recovery: 'scene_breather',
                passive_drain: null,
                strain_flavor: 'spooked horse nerves, eerie howling, and cold sweat',
                zero_debuff: 'Spooked & Shivering',
                on_overflow: 'redirect:grit',
            },
            trail_supplies: {
                key: 'trail_supplies',
                label: 'Trail Supplies',
                barColor: 'gold',
                current: 6,
                max: 6,
                recovery: 'haven_or_specialist',
                passive_drain: {
                    trigger: 'camp_or_sleep',
                    amount: 1,
                    reason: 'Setting camp in the cursed badlands consumes feed, jerky, and clean well water.',
                },
                strain_flavor: 'empty canteen, dry hardtack, and lame mule',
                zero_debuff: 'Parched & Saddle-Sore',
                on_overflow: 'redirect:resolve',
            },
        },
        defaultPositiveTags: [
            'Cold Iron Colt (Six-shooter blessed against unnatural horrors)',
            'Deadeye Reflexes (Fast-drawing from the hip under fire)',
            'Bounty Tracker (Reading hoofprints and broken brush)',
            'Frontier Medicine (Poultices, snakebite cure, and whiskey stitches)',
        ],
        archetypes: [
            'The Cursed Gunslinger',
            'The Frontier Preacher',
            'The Native Scout',
            'The Wandering Gambler',
            'The Desperate Marshal',
        ],
        sampleEncounter: `Skinwalker Ghost-Town Standoff: 2/2 HP | Threat: 2 (Standard) | Pools: Grit, Resolve
((PILLS)) Pressures: Telekinetic Shingle Barrage (Grit), Inhuman Mimicry of Loved Ones (Resolve), Unnatural Dust Devil (Resolve)
Leverage Barriers (2 Layers): [1. Unnatural Mist Veil] [2. Supernatural Armor of Animal Pelts]
Full-Finish Triggers: Gallop past the church on horseback (1 Turn), OR pierce the heart with cold iron
Status: Circling`,
        cyoaExamples: [
            '1. 🤠 Fan the hammer of the cold iron Colt through the dust — [Grit | +Cold Iron Colt]',
            '2. 📖 Recite the holy verses of protection aloud to dispel the voices — [Resolve]',
            '3. 🐴 Whistle sharp to keep your frightened mare from bolting into the scrub',
            '4. 👁️ Track the beast\'s prints in the dust to predict where it will strike next',
            '5. 🐎 Spur your horse hard toward the canyon pass before the circle closes — [Grit]',
        ],
    },
};

/**
 * Backwards-compatible alias for FAE_GENRES supporting both camelCase and UPPERCASE access.
 */
export const FAE_GENRE_SKELETONS = new Proxy(FAE_GENRES, {
    get(target, prop) {
        if (typeof prop === 'string') {
            return target[prop] || target[prop.toLowerCase()];
        }
        return target[prop];
    },
});

/**
 * Rolls a single Fudge die (-1, 0, or +1) using cryptographic rejection sampling
 * with Math.random fallback.
 *
 * @returns {number} -1, 0, or 1
 */
export function rollFudgeDie() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint8Array(1);
        while (true) {
            crypto.getRandomValues(buf);
            const val = buf[0];
            // 255 % 3 == 0 (0..254 are exactly 85 per outcome: 0..84 -> -1, 85..169 -> 0, 170..254 -> +1)
            if (val < 255) {
                return (val % 3) - 1;
            }
        }
    }
    const r = Math.random();
    if (r < 1 / 3) return -1;
    if (r < 2 / 3) return 0;
    return 1;
}

/**
 * Rolls 4 Fudge dice (4dF) ranging from -4 to +4 on a tight bell curve centered on 0.
 *
 * @returns {{ total: number, dice: [number, number, number, number] }}
 */
export function roll4dF() {
    const dice = [rollFudgeDie(), rollFudgeDie(), rollFudgeDie(), rollFudgeDie()];
    const total = dice.reduce((a, b) => a + b, 0);
    return { total, dice };
}

/**
 * @deprecated Deprecated in favor of the LLM Trait Qualification Protocol (Section 2.3.1).
 * Broad traits are governed semantically by the LLM (Cooperative Qualification:
 * Tier A auto-qualify into Trait [context]; Tier B omit true omnipotence with grounded alternative).
 * Always returns false so programmatic hard-rejection is eliminated.
 *
 * @param {string} [_tagText]
 * @returns {boolean}
 */
export function isGodTag(_tagText) {
    return false;
}

/**
 * Splits a tags string by top-level delimiters (newlines, semicolons, commas)
 * while preserving commas inside parentheses and brackets.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function splitTopLevelTagItems(str) {
    if (!str || typeof str !== 'string') return [];
    const res = [];
    let cur = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);

        const isSep = depth === 0 && (c === '\n' || c === ';' || c === ',');
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
 * Cleans formatting, strips bullets, deduplicates case-insensitively, and limits
 * an array of tags to a maximum count (default 5).
 * Broad trait scoping and omnipotence governance are delegated to the LLM via
 * the Trait Qualification Protocol (Section 2.3.1) without brittle programmatic filtering.
 *
 * @param {string[]|string} tags
 * @param {number} [maxTags=5]
 * @returns {string[]}
 */
export function sanitizeFaePositiveTags(tags, maxTags = 5) {
    if (!tags) return [];
    const list = Array.isArray(tags)
        ? tags
        : typeof tags === 'string'
            ? splitTopLevelTagItems(tags)
            : [];

    const sanitized = [];
    const seen = new Set();
    for (const item of list) {
        if (typeof item !== 'string') continue;
        const clean = item.trim().replace(/^[-*•+–—]\s*/, '').trim();
        if (!clean) continue;
        const lower = clean.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        sanitized.push(clean);
        if (sanitized.length >= maxTags) break;
    }
    return sanitized;
}

/**
 * Creates a fully cloned, structured FAE game state.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {object} [overrides={}]
 * @returns {object} Initial FAE state object
 */
export function createInitialFaeState(genreKey = 'cosmic_horror', overrides = {}) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const clonedPools = {};
    for (const [k, p] of Object.entries(genre.pools)) {
        clonedPools[k] = {
            key: p.key || k,
            label: p.label,
            barColor: p.barColor || 'green',
            current: p.current,
            max: p.max,
            recovery: p.recovery,
            passive_drain: p.passive_drain ? { ...p.passive_drain } : null,
            strain_flavor: p.strain_flavor,
            zero_debuff: p.zero_debuff,
            on_overflow: p.on_overflow,
        };
    }

    if (overrides.pools && typeof overrides.pools === 'object') {
        for (const [k, p] of Object.entries(overrides.pools)) {
            if (clonedPools[k]) {
                clonedPools[k] = { ...clonedPools[k], ...p };
            } else {
                clonedPools[k] = { ...p, key: p.key || k };
            }
        }
    }

    const charOverrides = overrides.character || overrides || {};
    const posTags = charOverrides.positive_tags || charOverrides.tags || genre.defaultPositiveTags;
    const negTags = charOverrides.negative_tags || charOverrides.scars || [];

    return {
        genre: genre.label,
        genreKey: genre.id,
        knobs: {
            flee_grace_toggle: overrides.knobs?.flee_grace_toggle ?? genre.knobs.flee_grace_toggle,
            base_attrition_shift: overrides.knobs?.base_attrition_shift ?? genre.knobs.base_attrition_shift,
            overflow_default: overrides.knobs?.overflow_default ?? genre.knobs.overflow_default,
            breather_available: overrides.knobs?.breather_available ?? genre.knobs.breather_available ?? true,
        },
        character: {
            name: charOverrides.name || 'Protagonist',
            archetype: charOverrides.archetype || genre.archetypes[0],
            positive_tags: sanitizeFaePositiveTags(posTags, 5),
            negative_tags: Array.isArray(negTags) ? [...negTags] : [],
            temp_advantage: charOverrides.temp_advantage || null,
            scenes_completed: parseInt(charOverrides.scenes_completed, 10) || 0,
            scenes_target: parseInt(charOverrides.scenes_target, 10) || 4,
        },
        pools: clonedPools,
    };
}

/**
 * Applies pool attrition or passive upkeep loss per Section 7 of the FAE spec.
 * Enforces the Two-Tier Narration law:
 * - Above 0: STRAIN ONLY (near-misses/breath, no disabling wounds).
 * - Dropping to <= 0: BREAKING POINT CLAMP at 0 and adds zero_debuff.
 * - Already at 0: Triggers handleOverflow().
 *
 * @param {object} state Active FAE state
 * @param {string} poolName Key of the pool
 * @param {number} amount Points of attrition
 * @param {string} [sourceNote=''] Optional narrative or scale context
 * @param {Set<string>} [visited=new Set()] Redirect cycle guard
 * @returns {object} Result object with outcome, remaining, and directive
 */
export function applyPoolLoss(state, poolName, amount, sourceNote = '', visited = new Set()) {
    const pool = state.pools[poolName];
    if (!pool) {
        throw new Error(`FAE Error: Pool "${poolName}" not found in state`);
    }
    const wasAtZero = (pool.current === 0);

    // Case 0: amount <= 0
    if (amount <= 0) {
        return {
            outcome: 'NO_LOSS',
            pool: poolName,
            remaining: pool.current,
            pool_remaining: pool.current,
            attrition: 0,
            note: sourceNote,
            directive: `${sourceNote ? sourceNote + ' ' : ''}No loss on ${poolName} (${pool.current}/${pool.max} remaining).`,
        };
    }

    // Case A: Pool > 0 drops to <= 0 -> Clamp at 0 & Apply Trauma / Zero Debuff
    if (!wasAtZero && (pool.current - amount <= 0)) {
        pool.current = 0;
        if (!state.character.negative_tags.includes(pool.zero_debuff)) {
            state.character.negative_tags.push(pool.zero_debuff);
        }
        const overflowRule = pool.on_overflow || state.knobs?.overflow_default || 'lethal';
        return {
            outcome: 'BREAKING_POINT_CLAMP',
            pool: poolName,
            attrition: amount,
            remaining: 0,
            pool_remaining: 0,
            zero_debuff: pool.zero_debuff,
            directive: (
                `${sourceNote ? sourceNote + ' ' : ''}TRAUMA / BREAKING POINT: ${poolName} drops to 0 and clamps! ` +
                `Narrate an actual wound or breakdown ('${pool.zero_debuff}'). ` +
                `Positive tags are now disabled for ${poolName} and any further loss triggers '${overflowRule}'.`
            ),
        };
    }

    // Case B: Pool was ALREADY at 0 -> Trigger Overflow
    if (wasAtZero) {
        return handleOverflow(state, poolName, amount, sourceNote, visited);
    }

    // Case C: Standard reduction (stays > 0 -> Narrate as STRAIN, never disabling wounds)
    pool.current -= amount;
    const strainHint = pool.strain_flavor || 'minor strain and near-misses';
    return {
        outcome: 'POOL_STRAIN',
        pool: poolName,
        attrition: amount,
        remaining: pool.current,
        pool_remaining: pool.current,
        directive: (
            `${sourceNote ? sourceNote + ' ' : ''}-${amount} ${poolName} (${pool.current}/${pool.max} remaining). ` +
            `STRAIN ONLY (Pool > 0): Narrate as ${strainHint}—do NOT narrate disabling wounds.`
        ),
    };
}

/**
 * Handles terminal consequences or cascading redirects when a pool at 0 takes attrition.
 *
 * @param {object} state Active FAE state
 * @param {string} poolName Key of the pool at 0
 * @param {number} attrition Amount of unmitigated attrition
 * @param {string} [sourceNote='']
 * @param {Set<string>} [visited=new Set()] Set of visited pools to prevent circular redirects
 * @returns {object} Overflow resolution result
 */
export function handleOverflow(state, poolName, attrition, sourceNote = '', visited = new Set()) {
    const pool = state.pools[poolName];
    if (!pool) {
        throw new Error(`FAE Error: Pool "${poolName}" not found in state`);
    }

    if (visited.has(poolName)) {
        // Break redirect cycle cleanly
        return {
            outcome: 'OVERFLOW_LETHAL',
            pool: poolName,
            attrition,
            pool_remaining: 0,
            remaining: 0,
            directive: `${sourceNote ? sourceNote + ' ' : ''}TERMINAL OVERFLOW on ${poolName}! Cycle broken; character succumbs.`,
        };
    }
    visited.add(poolName);

    const rule = pool.on_overflow || state.knobs?.overflow_default || 'lethal';

    // 1. Cascading Redirect (e.g., Supplies -> Resolve -> Health)
    if (rule.startsWith('redirect:')) {
        const targetPool = rule.split(':')[1].trim();
        const redirectNote = `${sourceNote ? sourceNote + ' ' : ''}[${poolName} at 0 -> Overflow redirected to ${targetPool}!]`;
        if (visited.has(targetPool)) {
            return {
                outcome: 'OVERFLOW_LETHAL',
                pool: targetPool,
                attrition,
                pool_remaining: 0,
                remaining: 0,
                directive: `${redirectNote} TERMINAL OVERFLOW: Circular redirect on ${targetPool} terminated.`,
            };
        }
        return applyPoolLoss(state, targetPool, attrition, redirectNote, visited);
    }

    // 2. Scar and Knock Out
    if (rule === 'scar_and_ko') {
        pool.max = Math.max(1, pool.max - 1);
        pool.current = 1;
        return {
            outcome: 'OVERFLOW_SCAR_AND_KO',
            pool: poolName,
            attrition,
            pool_remaining: 1,
            remaining: 1,
            directive: (
                `${sourceNote ? sourceNote + ' ' : ''}CRITICAL OVERFLOW on ${poolName}! Character is knocked out or forced from the scene. ` +
                `They wake up later in a safe/new location at 1 ${poolName} (Max reduced to ${pool.max}). ` +
                `Assign 1 permanent Negative Tag (Scar) reflecting this trauma.`
            ),
        };
    }

    // 3. Scene Failure (Non-lethal ejection)
    if (rule === 'scene_fail') {
        return {
            outcome: 'OVERFLOW_SCENE_FAIL',
            pool: poolName,
            attrition,
            pool_remaining: 0,
            remaining: 0,
            directive: (
                `${sourceNote ? sourceNote + ' ' : ''}CRITICAL OVERFLOW on ${poolName}! The character survives, but their objective fails. ` +
                `Narrate a forced retreat or loss of the scene's prize.`
            ),
        };
    }

    // 4. Lethal / Game Over
    return {
        outcome: 'OVERFLOW_LETHAL',
        pool: poolName,
        attrition,
        pool_remaining: 0,
        remaining: 0,
        directive: (
            `${sourceNote ? sourceNote + ' ' : ''}TERMINAL OVERFLOW on ${poolName}! The character succumbs to death or permanent madness. ` +
            `Narrate a dramatic, fitting conclusion to their story.`
        ),
    };
}

/**
 * Handles recovery tiers AND passive drain triggers per Section 7 of the FAE spec.
 * Passive drains are processed first (e.g. consuming supplies or suffering daily madness),
 * followed by pool recovery tiers.
 *
 * @param {object} state Active FAE state
 * @param {string} eventType 'scene_breather' | 'camp_or_sleep' | 'haven_or_specialist' | 'day_pass' | 'scene_transition'
 * @returns {{ event: string, summary: string, logs: string[] }}
 */
export function triggerEventOrRest(state, eventType) {
    if (!state.knobs) state.knobs = {};
    if (['scene_transition', 'camp_or_sleep', 'haven_or_specialist'].includes(eventType)) {
        state.knobs.breather_available = true;
    }
    if (eventType === 'scene_breather') {
        if (state.knobs.breather_available === false) {
            return {
                event: eventType,
                summary: 'Breather already used this scene.',
                logs: ['Breather already used this scene.'],
            };
        }
        state.knobs.breather_available = false;
    }

    const logs = [];

    // 1. Process Passive Drains First (e.g. eating rations at camp, or losing Sanity each day)
    for (const [pName, pool] of Object.entries(state.pools)) {
        const drain = pool.passive_drain;
        if (drain && drain.trigger === eventType) {
            const res = applyPoolLoss(state, pName, drain.amount, `[PASSIVE DRAIN: ${drain.reason}]`);
            logs.push(res.directive);
        }
    }

    // 2. Process Recoveries (if eventType is a rest tier)
    for (const [pName, pool] of Object.entries(state.pools)) {
        if (eventType === 'scene_breather' && pool.recovery === 'scene_breather') {
            if (pool.current > 0) { // Scene breather cannot clear a 0-state debuff
                const healed = Math.min(pool.max - pool.current, 2);
                pool.current += healed;
                logs.push(`Recovered +${healed} ${pName} (${pool.current}/${pool.max}).`);
            }
        } else if (eventType === 'camp_or_sleep' && (pool.recovery === 'scene_breather' || pool.recovery === 'camp_or_sleep')) {
            const healed = Math.max(1, Math.floor(pool.max / 2));
            pool.current = Math.min(pool.max, pool.current + healed);
            const idx = state.character.negative_tags.indexOf(pool.zero_debuff);
            if (idx !== -1) {
                state.character.negative_tags.splice(idx, 1);
            }
            logs.push(`Camp rest restored ${pName} to ${pool.current}/${pool.max} and cleared '${pool.zero_debuff}'.`);
        } else if (eventType === 'haven_or_specialist') {
            pool.current = pool.max;
            const idx = state.character.negative_tags.indexOf(pool.zero_debuff);
            if (idx !== -1) {
                state.character.negative_tags.splice(idx, 1);
            }
            logs.push(`Haven recovery fully restored ${pName} (${pool.max}/${pool.max}).`);
        }
    }

    return {
        event: eventType,
        summary: logs.join(' | '),
        logs,
    };
}

/**
 * Core single-pass action resolution function called by the LLM GM for Threat 1-4 Encounters.
 * Exact port of Section 7 of the FAE Specification.
 *
 * @param {object} state Active FAE state
 * @param {object} options
 * @param {string} options.pool_name Specific pool placed at risk ('health', 'sanity', etc.)
 * @param {number} options.threat_level Threat level 1 to 4
 * @param {string} [options.progress_scale='full'] 'full' | 'stepping_stone' | 'pivot'
 * @param {string[]} [options.matched_positive_tags=[]] Matched character positive tags (max 2)
 * @param {string[]} [options.matched_negative_tags=[]] Matched negative tags/scars
 * @param {boolean} [options.is_retreating=false] True if player is fleeing
 * @param {number|null} [options.fixedDiceRoll=null] Optional fixed roll for deterministic testing
 * @returns {object} Action resolution result
 */
export function resolveAction(state, {
    pool_name,
    threat_level,
    progress_scale = 'full',
    matched_positive_tags = [],
    matched_negative_tags = [],
    is_retreating = false,
    fixedDiceRoll = null,
} = {}) {
    const pool = state.pools[pool_name];
    if (!pool) {
        throw new Error(`FAE Error: Pool "${pool_name}" not found in state`);
    }
    const was_at_zero = (pool.current === 0);

    // 1. Enforce Tag Caps & Zero-State Rule
    let effective_pos_tags;
    const effective_neg_tags = [...matched_negative_tags];

    if (was_at_zero) {
        effective_pos_tags = []; // Positive tags disabled when pool is at 0
        if (!effective_neg_tags.includes(pool.zero_debuff)) {
            effective_neg_tags.push(pool.zero_debuff);
        }
    } else {
        effective_pos_tags = matched_positive_tags.slice(0, 2); // Hard cap at 2 character tags
        if (state.character.temp_advantage) {
            effective_pos_tags.push(state.character.temp_advantage);
            state.character.temp_advantage = null;
        }
    }

    // 2. Calculate Attrition: Threat + 4dF - PosTags + NegTags + GenreShift
    const dice_roll = (fixedDiceRoll !== null && fixedDiceRoll !== undefined)
        ? fixedDiceRoll
        : roll4dF().total;
    const effective_threat = Math.min(5, Math.max(1, threat_level + (progress_scale === 'pivot' ? 1 : 0)));
    const base_shift = state.knobs?.base_attrition_shift || 0;

    const raw_cost = (
        effective_threat +
        dice_roll -
        effective_pos_tags.length +
        effective_neg_tags.length +
        base_shift
    );
    const attrition = Math.max(0, raw_cost);

    // 3. Build Proportional Scale Directive (Updates Cartridge Layers)
    const scale_directives = {
        full: "FULL RESOLUTION: Grant the player's complete Intent and reduce Encounter HP/Layers to 0.",
        stepping_stone: (
            "STEPPING-STONE PROGRESS: Reduce Encounter HP/Layers by 1, cross off one Leverage Barrier, " +
            "and grant a temporary '[Advantage]' tag for the next turn."
        ),
        pivot: (
            "FORCED PIVOT: Current leverage cannot finish this target. The action connects, proves why " +
            "this approach won't work, and reveals the required leverage while keeping the scene moving."
        ),
    };
    const scale_note = scale_directives[progress_scale] || scale_directives.full;

    if (progress_scale === 'stepping_stone' && !state.character.temp_advantage) {
        state.character.temp_advantage = 'Advantage: Tactical Setup';
    }

    // 4. Handle Zero-Cost or Grace Retreat before standard pool loss
    if (attrition === 0) {
        return {
            outcome: 'UNFAZED_PROGRESS',
            dice: dice_roll,
            attrition: 0,
            pool_remaining: pool.current,
            remaining: pool.current,
            directive: `${scale_note} Cost: 0 ${pool_name}. Highlight protection from ${effective_pos_tags.join(', ') || 'decisive action'}.`,
        };
    }

    if (was_at_zero && is_retreating && state.knobs?.flee_grace_toggle) {
        return {
            outcome: 'GRACE_RETREAT_WITH_SCAR',
            dice: dice_roll,
            attrition,
            pool_remaining: 0,
            remaining: 0,
            directive: (
                "Player retreated at 0 pool with Flee Grace active and took overflow attrition. Escape succeeds! " +
                "Do NOT trigger lethal overflow; instead, Narrator selects a fitting gear tag to lose, companion to sideline, or permanent Scar."
            ),
        };
    }

    // 5. Apply Pool Loss (Strain vs. Trauma), Zero Clamp, or Overflow
    const loss_result = applyPoolLoss(state, pool_name, attrition, scale_note);
    loss_result.dice = dice_roll;
    return loss_result;
}

/**
 * Builds the pre-computed RNG Queue block with 4dF lines and a zero-math
 * lookup matrix for Roll #1.
 *
 * @param {object} [options={}]
 * @param {object|null} [options.state=null]
 * @param {string} [options.genreKey='cosmic_horror']
 * @param {number} [options.lineCount=6]
 * @returns {string} Formatted [RNG_QUEUE] block
 */
export function buildFaeRngBlock({ state = null, genreKey = 'cosmic_horror', lineCount = 6 } = {}) {
    const activeState = state || createInitialFaeState(genreKey);
    const rolls = [];
    for (let i = 0; i < lineCount; i++) {
        const roll = roll4dF();
        const diceFmt = roll.dice.map(d => (d > 0 ? `+${d}` : `${d}`)).join(', ');
        const signTotal = roll.total > 0 ? `+${roll.total}` : `${roll.total}`;
        rolls.push({
            line: `${i + 1}: 4dF → [${diceFmt}] = ${signTotal}`,
            total: roll.total,
            dice: roll.dice,
        });
    }

    const d1 = rolls[0].total;
    const shift = activeState.knobs?.base_attrition_shift || 0;
    const fleeGrace = activeState.knobs?.flee_grace_toggle;

    const matrixLines = [
        `--- PRE-COMPUTED TURN RESOLUTION MATRIX (Roll #1: 4dF = ${d1 > 0 ? '+' + d1 : d1}, Shift: ${shift >= 0 ? '+' + shift : shift}) ---`,
        `Base Attrition before Tags: max(0, Threat + 4dF(${d1 > 0 ? '+' + d1 : d1}) + Shift(${shift >= 0 ? '+' + shift : shift}))`,
    ];

    for (let t = 1; t <= 4; t++) {
        const baseCost = Math.max(0, t + d1 + shift);
        const pivotCost = Math.max(0, Math.min(5, t + 1) + d1 + shift);
        matrixLines.push(`• Threat ${t}: ${baseCost} Attrition (pivot: ${pivotCost})`);
    }
    matrixLines.push(`Tag Modifiers: Each matched Positive Tag (max 2 + Advantage) subtracts -1 (min 0). Each matched Negative Tag adds +1.`);
    matrixLines.push(`Active Pools Status & Outcome Thresholds for Roll #1:`);

    for (const [, pool] of Object.entries(activeState.pools)) {
        const isAtZero = (pool.current === 0);
        if (isAtZero) {
            matrixLines.push(
                `• ${pool.label} (0/${pool.max}): Positive Tags: DISABLED (Pool at 0!).` +
                `\n  - Attrition 0: UNFAZED_PROGRESS (0 loss)` +
                `\n  - Attrition >= 1: OVERFLOW (${pool.on_overflow})${fleeGrace ? ' / GRACE_RETREAT_WITH_SCAR if retreating' : ''}`
            );
        } else {
            const cur = pool.current;
            const strainRange = cur > 1 ? `1..${cur - 1}` : 'none';
            matrixLines.push(
                `• ${pool.label} (${cur}/${pool.max}): Positive Tags: ENABLED.` +
                `\n  - Attrition 0: UNFAZED_PROGRESS (0 loss)` +
                (cur > 1 ? `\n  - Attrition ${strainRange}: POOL_STRAIN (-N ${pool.label}, ${pool.strain_flavor})` : '') +
                `\n  - Attrition >= ${cur}: BREAKING_POINT_CLAMP (Clamps at 0 ${pool.label}, gains "${pool.zero_debuff}")`
            );
        }
    }

    const header = `[RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE]`;
    const queueText = rolls.map(r => r.line).join('\n');
    const matrixText = matrixLines.join('\n');

    return `${header}\n${queueText}\n\n${matrixText}\n[/RNG_QUEUE]`;
}

/**
 * Builds the FAE role prompt section.
 *
 * @param {boolean} [isFreeform=false]
 * @returns {string} XML role prompt block
 */
export function buildFaeRoleContent(isFreeform = false) {
    const coreLoopStep1 = isFreeform
        ? `1. Describe the situation honestly and establish immediate stakes, then ask what {{user}} does.`
        : `1. Describe the situation honestly and establish immediate scene stakes (tactical choices belong exclusively in the <choices> block at the end; do not write "What do you do?" in narrative prose).`;

    return `<role>
You are the Game Master (GM) running the Freeform Attrition Engine (FAE). FAE replaces binary pass/fail checks with single-pass forward momentum measured by resource attrition.

YOUR AGENDA:
- Make the world grounded, immersive, and dangerous.
- Be a fan of {{user}}: forward momentum is guaranteed; dice only measure wear-and-tear.
- Play to find out what happens: respect player Intent and let the fiction evolve honestly.

CORE LAWS OF FAE RESOLUTION:
1. SINGLE-PASS RESOLUTION: {{user}} declares Task and Intent. You evaluate the fiction, check the Pre-Computed Turn Resolution Matrix or call resolve_action(), and narrate the complete outcome in the same turn. NEVER halt the turn for meta-currency haggling or menu choices.
2. ENCOUNTER-WIDE RESOLUTION (NO ACTION ECONOMY): FAE has no initiative, combat rounds, or individual creature turns. The Threat describes the ENTIRE encounter as a whole, resolved in a single player turn.
3. ATTRITION OVER FAILURE: Actions succeed or advance. The dice (4dF from -4 to +4, tight bell curve on 0) determine how much wear-and-tear the character absorbs along the way.
4. TWO-TIER POOL NARRATION (STRAIN vs. TRAUMA):
   - Above Zero (Pool > 0): STRAIN ONLY. Narrate parrying shock, bruised muscles, winded breath, near-misses, cold sweat, or sensory static. NEVER narrate disabling wounds, broken bones, or permanent madness while a pool is above 0!
   - Reaching Zero (Pool == 0): BREAKING POINT CLAMP. Clamping at 0 is the exact narrative moment the character's guard breaks and they suffer their tangible injury or breakdown (their pool's zero_debuff).
   - Taking Loss at 0: OVERFLOW. Triggers the pool's on_overflow consequence (redirect, scar_and_ko, scene_fail, or lethal).
5. INTENT SCOPING & PROPORTIONAL LEVERAGE (TAGS + GEAR + PARTY):
   - Leverage is evaluated using personal tags, tools, terrain, and active companions/party members.
   - Threat 0 (Trivial/Mook): Do NOT roll. Narrate effortless brush-aside with 0 attrition.
   - Narrow / Bypass Intent (Flee, slip past, grab clue): Resolves encounter in 1 turn ("full").
   - Total Intent vs 2+/Y Layers Left: Resolves as "stepping_stone" (-1 Layer, cross off a Barrier, grant [+] Advantage: Setup for next turn). Coordinating companions or a decisive silver bullet can achieve "full" resolution or neutralize a listed Pressure (-1 Threat).
   - Wrong Tools / Zero Leverage: Resolves as "pivot" (+1 Threat, action connects, reveals necessary angle). Directing a relevant companion unlocks angles to avoid a "pivot".

CORE LOOP (every turn):
${coreLoopStep1}
2. {{user}} acts in the fiction with declared Task and Intent.
3. Consult the pre-computed resolution matrix or resolve_action() per <rng_system>. Print the roll inline: *(FAE Action [Pool]: 4dF [...] = Attrition X → Outcome)*.
4. Follow the Outcome honestly, update State Memo pools, and hand the spotlight back.
</role>`;
}

/**
 * Builds the FAE RNG system section instructions for consuming 4dF from SillyTavern.
 *
 * @returns {string} XML rng_system prompt block
 */
export function buildFaeRngContent() {
    return `<rng_system>
The player NEVER rolls dice. SillyTavern supplies pre-rolled 4dF values in [RNG_QUEUE v7.0 — FAE 4dF ATTRITION ENGINE].
Each line provides 4 Fudge dice (-1, 0, or +1 each), summing to a total from -4 to +4 on a tight bell curve centered on 0.

ATTRITION FORMULA:
Attrition = max(0, Threat + 4dF - MatchedPosTags + MatchedNegTags + GenreShift)
- Threat (1 to 4): Baseline encounter threat. Adjusted by +1 if entering a Pressure without prep, or -1 if neutralizing a Pressure via environment or coordinated companion maneuver.
- Positive Tags (max 2): Each matched character, gear, or companion tag subtracts -1 from Attrition. Respect bracketed situational qualifiers (Trait [context], e.g. Strong [for lifting, hauling, or breaching doors], Calm [under gunfire and shock]). (Plus 1 extra if an active [Advantage] tag is consumed).
  CRITICAL: If the target Pool is at 0, POSITIVE TAGS ARE DISABLED (0 tags apply)!
- Negative Tags: Each active Scar or debuff hindering the action adds +1 to Attrition.
- Genre Shift: -1 (Pulp), 0 (Gritty), +1 (Brutal/Horror).

ZERO-MATH PRE-COMPUTED MATRIX:
SillyTavern injects a pre-calculated turn resolution table directly in the [RNG_QUEUE] block for Roll #1.
Consult the matrix directly to find the exact Attrition and Outcome tier with zero arithmetic!

OUTCOME TIERS:
- Attrition 0 → UNFAZED_PROGRESS: Complete forward progress with 0 pool loss! Highlight character mastery and tag protection. (If retreating at 0 pool rolls 0 attrition, escape succeeds cleanly via UNFAZED_PROGRESS).
- Pool > 0 & Attrition > 0 → POOL_STRAIN: Deduct Attrition from pool. Narrate as near-misses, fatigue, winded breath, or dread. NO disabling wounds!
- Pool drops to <= 0 → BREAKING_POINT_CLAMP: Clamp pool at exactly 0. Narrate the character's breaking point trauma. Add pool's zero_debuff to Scars & Debuffs.
- Pool at 0 & Attrition > 0 → OVERFLOW:
  • If retreating at 0 rolls >= 1 attrition with Flee Grace active: GRACE_RETREAT_WITH_SCAR replaces overflow (escape succeeds; Narrator selects a fitting gear tag to lose, companion to sideline, or permanent Scar).
  • Otherwise execute pool's on_overflow rule (redirect, scar_and_ko, scene_fail, or lethal).

ROLL FORMAT (Strict SillyTavern Colorization):
Always wrap the roll line in single asterisks and parentheses right before narrating its consequence:
*(FAE Action [Pool]: 4dF [Roll: d1, d2, d3, d4 = Sum] + Threat N - PosTags + NegTags = Attrition X → Outcome)*
Example: *(FAE Action [Sanity]: 4dF [Roll: +1, 0, +1, 0 = +2] + Threat 3 - 1 (Calm [under gunfire and shock]) = Attrition 4 → BREAKING POINT CLAMP (0/8))*
</rng_system>`;
}

/**
 * Builds the FAE combat rules section with Encounter Block format.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @returns {string} XML combat prompt block
 */
export function buildFaeCombatContent(genreKey = 'cosmic_horror') {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;

    return `<combat>
NO INITIATIVE TURNS. NO ACTION ECONOMY.
Combat is an encounter-wide cinematic resolution, not a grid-based turn exchange.

NATIVE FAE ENCOUNTER BLOCK FORMAT:
In the [COMBAT] memo block, track the entire situation as a unified Encounter Block:
Name: X/Y HP | Threat: N (Label) | Pools: Pool1, Pool2
((PILLS)) Pressures: Pressure 1 (Pool), Pressure 2 (Pool)
Leverage Barriers (Y Layers): [1. First Defense] [2. Second Defense]
Full-Finish Triggers: Shortcut/Bypass (1 Turn), OR break Barriers
Status: Alerted / Entrenched / Stalking

ENCOUNTER HP TRACKS LEVERAGE LAYERS (NOT CREATURE HIT POINTS):
- A 2/2 HP encounter has 2 Leverage Barriers protecting it from total defeat.
- Narrow / Bypass Intent (slip past, escape, grab relic) resolves in 1 turn regardless of layers remaining.
- Total Intent achieves "full" resolution when 1 layer remains (1/Y HP) OR when leveraging a decisive environmental/party silver bullet. Total Intent against 2+/Y HP defaults to stepping_stone: strips 1 Layer (2/2 -> 1/2 HP), crosses off a Barrier, and grants [+] Advantage: Setup for the next turn.

ENCOUNTER THREAT SCALE (1 to 4):
- Threat 1 (Minor): Light hazard, mook squad (1/1 HP).
- Threat 2 (Standard): Armed patrol, capable beast (1/1 or 2/2 HP).
- Threat 3 (Elite): Heavy squad, horrifying monstrosity (2/2 or 3/3 HP).
- Threat 4 (Apex): Overwhelming entity, apex predator (3/3 HP).

STRICT THREAT MODIFIERS (max +/- 1):
- +1 Threat: Player charges directly into an active Pressure without prep, OR attempts a pivot action.
- -1 Threat (min 1): Player uses a clever environmental interaction or coordinated companion maneuver that directly neutralizes one of the listed Pressures.

TWO-TIER STRAIN VS TRAUMA RULE:
- Never narrate broken limbs or permanent damage when HP/Pool > 0.
- Pool at 0 clamps first; taking damage at 0 triggers overflow (${genre.knobs.overflow_default}).
</combat>`;
}

/**
 * Builds the FAE ruleset note.
 *
 * @returns {string} XML ruleset note
 */
export function buildFaeRulesetNoteContent() {
    return `<ruleset_note>
FAE reminder: 4dF Attrition Engine. Single-pass forward momentum. Threat describes entire encounter. Two-tier narration (Strain > 0, Trauma == 0). No initiative, no Armor Class, no saving throws, no enemy turns.
</ruleset_note>`;
}

/**
 * Builds the FAE output footer.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {object} [options={}]
 * @returns {string} XML footer content
 */
export function buildFaeFooterContent(genreKey = 'cosmic_horror', options = {}) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const activePools = (options?.pools && Object.keys(options.pools).length > 0)
        ? options.pools
        : (options?.config?.pools && Object.keys(options.config.pools).length > 0)
            ? options.config.pools
            : genre.pools;
    const poolSegments = Object.values(activePools).map(p => `(${p.label}: [current]/[max])`).join(' | ');

    let timeFmt = '[HH:MM AM/PM], Day [X]';
    if (options.use24hTime) {
        timeFmt = timeFmt.replace(/\[HH:MM AM\/PM\]/g, '[HH:MM] (24-hour clock, NO AM/PM)');
    }
    if (options.useDdMmYyFormat) {
        timeFmt = timeFmt.replace(/Day\s+\[X\]/g, '[DD/MM/YYYY]');
    }

    return `<end_of_output_footer>
ALWAYS end every narrative message (including turns after a tool call, right above <choices>) with these exact two italicized lines:
*${poolSegments} | (Scenes: [current]/[target]) | (Location: [Site Name, Current Area])*
*${timeFmt}*
(followed only by any active subfooters such as <choices>; there MUST be a blank line between the status footer and <choices>)
</end_of_output_footer>`;
}

/**
 * Builds the FAE XP and Milestone Advancement prompt.
 *
 * @returns {string} XML xp_system block
 */
export function buildFaeXpContent() {
    return `<xp_system>
CHARACTER ADVANCEMENT (MILESTONES):
Every 3 to 5 completed scenes (when Scenes reached target, e.g. Scenes: 4/4):
{{user}} chooses ONE milestone advance:
1. Heal a Scar: Permanently remove 1 Negative Tag (Scar) or restore +1 lost Max Pool capacity.
2. New Capability: Acquire 1 new Positive Tag (personal trait, signature gear, or loyal companion tag) earned in the fiction.
3. Hardened Reserve: Increase any Pool's Max capacity by +1 (hard ceiling of 12).
Reset Scenes and XP counter to 0/target upon advancing: *(Milestone Reached! Choose an Advance: Heal a Scar, New Positive Tag, or +1 Max Pool)*.
</xp_system>`;
}

/**
 * Builds the FAE party and companion tracking mechanics.
 *
 * @returns {string} XML [PARTY]_mechanics block
 */
export function buildFaePartyContent() {
    return `<[PARTY]_mechanics>
COMPANIONS, HIRELINGS & ADVENTURING PARTIES (ZERO-BOOKKEEPING MODEL):
Rather than tracking separate pools or turns for companions, companions are folded directly into Leverage and Tags:
1. Protagonist-Anchored Pools: Track ONLY {{user}}'s 2–3 core resource pools (representing the collective stamina, morale, and supplies of the group).
2. Companions as Fictional Leverage: Evaluate Proportional Leverage using the party's combined fictional presence. Coordinating companions can achieve "full" resolution, neutralize a listed Pressure (-1 Threat), or provide specialized capability so an action is not forced into a "pivot".
3. Companions as Positive Tags (2-Tag Cap): Record notable companions or hirelings as Positive Tags in [CHARACTER] (e.g., "Companion: Sister Valeria (Cleric)" or "Retainer: Torchbearer"). When they assist in the declared action, they count as 1 of the max 2 Positive Tags (-1 Attrition).
4. Companions as Narrative Buffer: At Breaking Point (0), scar_and_ko, or GRACE_RETREAT_WITH_SCAR, consequences can manifest narratively on a companion (e.g., retainer fleeing, or "(-) Companion Wounded: Valeria" disabling their tag until haven_or_specialist recovery).
</[PARTY]_mechanics>`;
}

/**
 * Builds the FAE constraints block.
 *
 * @param {boolean} [_isFreeform=false]
 * @returns {string} XML constraints block
 */
export function buildFaeConstraintsContent(_isFreeform = false) {
    return `<constraints>
<resolution_constraints>
Single-pass resolution is mandatory. Never pause mid-turn to ask players for mechanical rolls or choices. Intent determines outcome scale; 4dF attrition measures the cost. Never pre-judge the dice roll or predict whether a pool will hit 0 prior to evaluating the action.
</resolution_constraints>
<tag_and_zero_constraints>
Hard stacking cap: At most 2 Positive Tags may be applied to an action (plus 1 active [Advantage] tag).
Zero-State Rule: When a Pool is at 0, Positive Tags CANNOT be used to reduce attrition targeting that pool!
The Trait Qualification Protocol (Cooperative Qualification):
- Ideal Scope: A balanced tag applies to ~25–30% of genre situations (e.g. Ex-Military, Calm [under gunfire and shock], Quiet, Service Revolver, Trap-Wise).
- Tier A — Auto-Qualify Broad Traits (Trait [context]): When a player or card proposes an overly broad adjective (Strong, Smart, Fast, Lucky, Tough), do NOT reject or silently delete it. Preserve the player's archetype by attaching a bracketed situational qualifier narrowing its applicability to ~25–30%:
  • Strong -> Strong [for lifting, hauling, or breaching doors]
  • Smart -> Smart [for ancient ciphers and forensic clues]
  • Fast -> Fast [for dodging traps and ambushes]
  • Lucky -> Lucky [for narrowly surviving cave-ins and falls]
  • Tough -> Tough [against harsh poisons and extreme weather]
- Tier B — Remove Only True Omnipotence (With Clear Replacement): If a proposed tag claims absolute immunity or breaks the attrition engine entirely (Invincible, Never Misses, Immortal, Omniscient), omit/replace it, clearly explain why in narrative/chat, and offer a grounded Trait [context] alternative.
- Turn-by-Turn Evaluation: When matching up to 2 Positive Tags for -1 Attrition on a roll, respect any bracketed [context] qualifier (or if an unqualified broad tag exists on the sheet, interpret it narrowly within the character's archetype and auto-qualify it with [...] on the next State Tracker update).
</tag_and_zero_constraints>
<passive_drain_constraints>
Passive upkeep drain (rations at camp, environmental aura) is unmitigated by tags. It obeys the zero clamp (warns first), and triggers overflow if already at 0.
</passive_drain_constraints>
</constraints>`;
}

/**
 * Builds the FAE CYOA choice prompt tailored for single-pass attrition play.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {object} [overrides={}]
 * @returns {string} Subfooter prompt instructions
 */
export function buildFaeCyoaPrompt(genreKey = 'cosmic_horror', overrides = {}) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const config = overrides.config || overrides || {};
    const playstyle = config.playstyle || 'cyoa_5';
    if (playstyle === 'freeform') return '';

    const activePools = (overrides?.pools && Object.keys(overrides.pools).length > 0)
        ? overrides.pools
        : (config?.pools && Object.keys(config.pools).length > 0)
            ? config.pools
            : genre.pools;
    const poolLabels = Object.values(activePools).map(p => p.label).join(', ');
    const primaryPoolLabel = Object.values(activePools)[0]?.label || 'Health';

    const choiceCount = playstyle === 'cyoa_3' ? 3 : 5;
    const exampleList = genre.cyoaExamples.slice(0, choiceCount);
    const exampleButtons = exampleList.map(e => `<button>${e}</button>`).join('\n');

    return `[SUBFOOTER: INTERACTIVE CHOICE BUTTONS]
- You MUST ALWAYS end your response with exactly ${choiceCount} choices for {{user}}.
- Output sequence: (1) Scene narrative -> (2) Two-line italicized status/location footer -> (3) <choices> block.
- CRITICAL FORMATTING: There MUST be a blank line (\n\n) between the two-line italicized status/location footer and the <choices> block so Markdown parsers do not merge the footer into the choices container.
- Enclose all choices inside a single <choices> XML block.
- Wrap every single choice in a <button> tag with a number and fitting emoji.
- FORMATTING FAE CHOICES (STYLE B):
  • Primary / Risky Action: Append the targeted Resource Pool in brackets: — [Pool] or — [Pool | +Tag, +Advantage].
  • Environmental / Pressure Neutralizer: Action targeting an active Pressure from the Encounter Block to reduce Threat — [Pool] or — [Pool | +Tag].
  • Tactical Caution / Defensive Bracing: Zero-roll repositioning or setting up leverage (omit brackets).
  • Social / Dialogue: Spoken words or negotiation in quotes (omit brackets).
  • Retreat / Fallback: Disengagement or tactical withdrawal — [Pool] (or [Pool | +Tag]).
- CRITICAL BRACKET RULE:
  • The first item inside brackets [Pool | ...] MUST always be one of the active Resource Pools (${poolLabels}) — NEVER put a Tag, Boon, or skill name in the Pool slot!
  • If one or more Positive Tags (trait, gear, or companion) or an active Advantage apply: write — [Pool | +Tag1, +Tag2] (e.g. — [${primaryPoolLabel} | +Trap-Wise] or — [${primaryPoolLabel} | +Trap-Wise, +Advantage]). For companion tags like Companion: Brother Marcus (Cleric), write +Companion: Brother Marcus or +Brother Marcus.
  • If no Positive Tag applies: write — [Pool] (e.g. — [${primaryPoolLabel}]).
  • For pure dialogue or zero-roll free actions: omit the bracket entirely.
  • NO mechanical scope jargon: NEVER output "Stepping-Stone:", "Full Resolution:", "Tactical Caution:", or "Narrow Escape" inside the button brackets. (The GM evaluates intent scope internally when resolving the turn).
- ZERO-STATE ADAPTATION: If {{user}} is at 0 in their primary pool, choices MUST reflect desperation, crisis defense, or frantic flight.

EXAMPLES:
<choices>
${exampleButtons}
</choices>`;
}

/**
 * Generates stock prompt templates for FAE State Tracker memo synchronization.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {object} [overrides={}]
 * @returns {object} Stock prompts object
 */
export function buildFaeStockPrompts(genreKey = 'cosmic_horror', overrides = {}) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const poolKeys = Object.keys(genre.pools);
    const primary = genre.pools[poolKeys[0]];
    const secondaryList = poolKeys.slice(1).map(k => genre.pools[k]);

    const secondaryBars = secondaryList.map(p => {
        return `${toMultihogBarMarker(p.barColor)} ${p.label}: ${p.current}/${p.max}`;
    }).join('\n');

    const sampleTags = genre.defaultPositiveTags.join(', ');

    return {
        character: `Main character's core stats. MECHANICS ONLY.
NO D&D MECHANICS: Use FAE Archetypes and Resource Pools. Never write "1d8 damage", "AC", "spell slots", or "saving throws".
Format:
[CHARACTER]
{{user}} (${genre.archetypes[0]}): ${primary.current}/${primary.max} HP | Pool: ${primary.label} (${primary.current}/${primary.max}) | Scenes: 0/4 | XP: 0/4
${secondaryBars}
FAE Knobs: Flee Grace: ${genre.knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Shift: ${genre.knobs.base_attrition_shift >= 0 ? '+' + genre.knobs.base_attrition_shift : genre.knobs.base_attrition_shift} | Overflow: ${genre.knobs.overflow_default}
((PILLS)) Positive Tags: ${sampleTags}
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/CHARACTER]

PILL FORMATTING:
- Positive Tags: Name (descriptive detail) or Trait [context qualifier] (~25–30% situational scope, e.g. Strong [for lifting, hauling, or breaching doors], Calm [under gunfire and shock]). Can include personal traits, signature gear, or companions, e.g. Companion: Name (Role — detail). Auto-qualify broad traits via Tier A Trait Qualification Protocol.
- Scars & Debuffs: Prefix harmful debuffs with (-) for red pills, e.g. (-) ${primary.zero_debuff} (Trauma). Active temporary advantage tags prefix with (+) for green pills, e.g. (+) Advantage: Setup (-1 Attrition).`,

        combat: `Active encounter and situational obstacles in FAE.
Format:
[COMBAT]
${genre.sampleEncounter}
[/COMBAT]`,

        inventory: `Character signature gear and resources.
Every signature weapon or item acts as a Positive Tag:
[INVENTORY]
Signature Gear (Tags):
- 🗡️ [Signature] Signature Item (Tag description, usable once per action)
Supplies:
- 🎒 Basic travel pack (rations, flashlight/torch, bandages)
[/INVENTORY]`,

        party: `Companions and allies in FAE.
Format:
[PARTY]
Companion Name (${genre.archetypes[1] || 'Ally'}): 8/8 HP | Pool: Health (8/8)
((PILLS)) Positive Tags: Steady (Calm under pressure), Sidearm (Close defense)
((PILLS)) Boons: Tactical Support (Grants [+] Advantage when assisting)
((PILLS)) Scars & Debuffs: None
Status: Healthy
[/PARTY]`,
    };
}

/**
 * Builds the complete FAE Game Cartridge object.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {object} [overrides={}]
 * @returns {object} FAE cartridge definition
 */
export function buildFaeCartridge(genreKey = 'cosmic_horror', overrides = {}) {
    if (typeof genreKey === 'object' && genreKey !== null) {
        overrides = genreKey;
        genreKey = overrides.genreKey || overrides.genre || 'cosmic_horror';
    }
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const config = overrides.config || overrides || {};
    const playstyle = config.playstyle || overrides.playstyle || 'cyoa_5';
    const isFreeform = playstyle === 'freeform';

    const customSyspromptLibrary = [
        {
            id: 'fae_base_override_role',
            tag: 'role',
            content: buildFaeRoleContent(isFreeform),
            enabled: true,
            scope: 'chat',
            icon: 'fa-feather-pointed',
            description: 'FAE Single-Pass Attrition Engine Narrator Role',
            origin: 'unlocked_base',
            baseTag: 'role',
        },
        {
            id: 'fae_base_override_rng',
            tag: 'rng_system',
            content: buildFaeRngContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-dice-d6',
            description: 'FAE 4dF Attrition Engine and Pre-Computed Lookup Matrix',
            origin: 'unlocked_base',
            baseTag: 'rng_system',
        },
        {
            id: 'fae_base_override_combat',
            tag: 'combat',
            content: buildFaeCombatContent(genreKey),
            enabled: true,
            scope: 'chat',
            icon: 'fa-shield-halved',
            description: 'FAE Encounter Block and Leverage Layers',
            origin: 'unlocked_base',
            baseTag: 'combat',
        },
        {
            id: 'fae_base_override_ruleset_note',
            tag: 'ruleset_note',
            content: buildFaeRulesetNoteContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-scroll',
            description: 'FAE 4dF attrition reminder',
            origin: 'unlocked_base',
            baseTag: 'ruleset_note',
        },
        {
            id: 'fae_base_override_footer',
            tag: 'end_of_output_footer',
            content: buildFaeFooterContent(genreKey, config),
            enabled: true,
            scope: 'chat',
            icon: 'fa-shoe-prints',
            description: 'FAE Pool, Scenes, and Location footer',
            origin: 'unlocked_base',
            baseTag: 'end_of_output_footer',
        },
        {
            id: 'fae_base_override_xp',
            tag: 'xp_system',
            content: buildFaeXpContent(),
            enabled: true,
            scope: 'chat',
            icon: 'fa-award',
            description: 'FAE Milestone Advancement every 3-5 completed scenes',
            origin: 'unlocked_base',
            baseTag: 'xp_system',
        },
        {
            id: 'fae_base_override_party',
            tag: '[PARTY]_mechanics',
            content: buildFaePartyContent(),
            enabled: config.partyMode !== 'solo',
            scope: 'chat',
            icon: 'fa-users',
            description: 'FAE Companion tracking with pools and boons',
            origin: 'unlocked_base',
            baseTag: '[PARTY]_mechanics',
        },
        {
            id: 'fae_base_override_constraints',
            tag: 'constraints',
            content: buildFaeConstraintsContent(isFreeform),
            enabled: true,
            scope: 'chat',
            icon: 'fa-ban',
            description: 'FAE Tag caps, Trait Qualification Protocol, and zero-state rules',
            origin: 'unlocked_base',
            baseTag: 'constraints',
        },
    ];

    const syspromptModules = {
        role: false,
        rng_system: false,
        combat: false,
        ruleset_note: false,
        end_of_output_footer: false,
        xp_system: false,
        '[PARTY]_mechanics': false,
        constraints: false,
        CYOA_mode: !isFreeform,
        // D&D systems disabled in FAE
        weapon_proficiencies: false,
        attacks_per_round: false,
        saving_throws: false,
        level_up_protocol: false,
        homebrew_and_custom_classes: false,
        resting: false,
        loot: false,
        random_events: false,
        world_rules: false,
    };

    const baseBlockOrder = config.partyMode === 'solo'
        ? ['COMBAT', 'CHARACTER', 'INVENTORY', 'ABILITIES', 'XP', 'TIME']
        : ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'XP', 'TIME'];

    const payload = {
        customSyspromptLibrary,
        syspromptModules,
        syspromptSectionOrder: [],
        stockPrompts: buildFaeStockPrompts(genreKey, overrides),
        cyoaConfig: {
            useCustomPrompt: !isFreeform,
            customPromptText: isFreeform ? '' : buildFaeCyoaPrompt(genreKey, overrides),
            useButtonTags: !isFreeform,
            useXmlTag: !isFreeform,
            useEmojis: config.cyoaEmojis !== false,
            stripOldChoicesFromPrompt: true,
        },
        rngEnabled: true,
        rngQueueD20: true,
        rngQueueD100: false,
        diceD100Mode: false,
        diceFunctionTool: false,
        blockOrder: baseBlockOrder,
        modules: {
            combat: true,
            character: true,
            party: config.partyMode !== 'solo',
            inventory: true,
            abilities: false,
            spells: false,
            xp: true,
            time: true,
        },
    };

    const cartridgeId = overrides.id || FAE_CARTRIDGE_ID;
    const cartridgeName = overrides.name || `Freeform Attrition Engine (${overrides.systemLabel || genre.label})`;
    const cartridgeDesc = overrides.description || `FAE Attrition Engine: deterministic 4dF resolution, resource pools, and zero pass/fail walls. Tailored for ${genre.label}.`;

    return {
        id: cartridgeId,
        name: cartridgeName,
        description: cartridgeDesc,
        icon: overrides.icon || genre.icon || '🛡️',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        format: CARTRIDGE_FORMAT,
        version: CARTRIDGE_VERSION,
        payload,
    };
}

/**
 * Builds tailored documentation for the FAE framework for injection into
 * MultiHog's Adventure Companion fetch bridge.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @returns {string} Markdown documentation
 */
export function buildTailoredFaeDocumentation(genreKey = 'cosmic_horror') {
    const active = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;

    const otherGenresList = Object.entries(FAE_GENRES)
        .filter(([k]) => k !== active.id)
        .map(([, g]) => `* **${g.icon} ${g.label}:** Pools (${Object.values(g.pools).map(p => p.label).join(', ')})`)
        .join('\n');

    return `
# Freeform Attrition Engine (FAE) Framework Guide

> [!IMPORTANT]
> This campaign uses the **Freeform Attrition Engine (FAE)**. FAE eliminates pass/fail skill checks and tactical grid bloat.
> Forward narrative momentum is guaranteed; 4dF dice only measure wear-and-tear on your resource pools.

---

## 🎲 1. Core Resolution Laws
* **Single-Pass Resolution:** Player declares Task and Intent. The Game Master resolves the action and narrates consequences in the same turn.
* **Encounter-Wide Resolution:** Threat describes the entire scene/encounter (Threat 1 to 4). There are no initiative orders or creature turns.
* **4dF Bell Curve:** Rolls range from -4 to +4 centered on 0:
  \`Attrition = max(0, Threat + 4dF - PosTags + NegTags + GenreShift)\`
* **Two-Tier Pool Narration:**
  - **Pool > 0 (Strain):** Attrition is narrated as near-misses, bruised muscles, winded breath, or creeping dread. NEVER disabling wounds!
  - **Pool == 0 (Breaking Point Clamp):** Clamps at 0 and inflicts a tangible trauma debuff.
  - **Taking Loss at 0 (Overflow):** Executes the pool's terminal overflow rule (redirect, scar_and_ko, scene_fail, or lethal).
* **Intent Scoping & Proportional Leverage:**
  - **Narrow / Bypass Intent:** Resolves the obstacle in 1 turn ("full").
  - **Total Intent vs 2+ Layers:** Resolves as "stepping_stone" (-1 Layer, grants [+] Advantage for next turn).
  - **Wrong Tools:** Resolves as "pivot" (+1 Threat, reveals the true solution).
* **Companions & Parties (Zero-Bookkeeping Model):**
  - **Protagonist-Anchored Pools:** Track only {{user}}'s 2–3 resource pools representing the entire group.
  - **Companions as Fictional Leverage:** Party presence can achieve "full" resolution, neutralize Pressures (-1 Threat), or prevent a "pivot".
  - **Companions as Positive Tags:** Recorded as \`Companion: Name (Role)\` subject to the 2-tag cap (-1 Attrition).
  - **Companions as Narrative Buffer:** Breaking point or overflow consequences can manifest on companions (fleeing, taking wounds, or disabling tags).

---

## 🎭 2. Active Campaign Genre: ${active.label} ${active.icon}
* **Knobs:** Flee Grace: ${active.knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Base Shift: ${active.knobs.base_attrition_shift} | Default Overflow: ${active.knobs.overflow_default}
* **Resource Pools:**
${Object.values(active.pools).map(p => `  • **${p.label} (${p.max} max):** Recovery via \`${p.recovery}\`. Zero Debuff: "${p.zero_debuff}". Overflow: \`${p.on_overflow}\`.`).join('\n')}
* **Archetypes:** ${active.archetypes.join(', ')}
* **Starting Positive Tags:**
${active.defaultPositiveTags.map(t => `  • ${t}`).join('\n')}

---

## 💡 3. Guidelines for MultiHog Adventure Companion (CHAT)
1. **Suggesting Fictional Actions:**
   - Propose clear player actions with explicit declared intent (e.g. narrow bypass vs. stepping-stone assault) so the GM resolves it in one fluid turn.
   - Match the player's active Positive Tags to lower rolled attrition.
2. **Handling Breaking Points:**
   - When a pool reaches 0, treat it as a dramatic crisis. Recommend using Flee Grace or targeting an alternative pool.
3. **State Tracker Synchronization:**
   - Primary Pool syncs in tandem with Line 1 HP (\`cur/max HP\`).
   - Secondary pools are tracked via \`((BAR<COLOR>))\` progress bars (e.g. \`((BARBLUE))\`, \`((BARGOLD))\`, \`((BARPURPLE))\`).
   - Milestone advancement occurs every 3–5 completed scenes (\`Scenes: X/Y\` and \`XP: X/Y\`).
4. **Interactive Choice Buttons (Style B):**
   - Format player choices using Style B: \`— [Pool | +Tag, +Advantage]\` or \`— [Pool]\`. Dialogue and zero-roll actions omit brackets. Never display mechanical scope jargon inside button text.

---

## 📚 4. Other Available FAE Genres (Quick Reference)
${otherGenresList}
`;
}

/**
 * Builds the Quick Start instructions string passed to MultiHog character creation for FAE.
 *
 * @param {string} [genreKey='cosmic_horror']
 * @param {string} [charName='']
 * @param {string} [customNotes='']
 * @param {object|null} [customKnobs=null]
 * @returns {string} Quick start instructions
 */
export function buildFaeQuickStartInstructions(genreKey = 'cosmic_horror', charName = '', customNotes = '', customKnobs = null) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const poolKeys = Object.keys(genre.pools);
    const poolsStr = poolKeys.map(k => `${genre.pools[k].label} (${genre.pools[k].current}/${genre.pools[k].max})`).join(', ');
    const archetypesSnippet = genre.archetypes.slice(0, 4).join(', ');
    const tagsSnippet = genre.defaultPositiveTags.join(', ');
    const knobs = Object.assign({}, genre.knobs, customKnobs || {});

    return [
        `RULES: Freeform Attrition Engine (FAE) — ${genre.label}.`,
        charName ? `NAME: ${charName}.` : null,
        `ARCHETYPE: Choose ONE FAE Archetype (e.g. ${archetypesSnippet}). Output as "Name (Archetype)". FORBIDDEN: No D&D classes or subclasses (no Fighter, Wizard, Paladin, etc.).`,
        `RESOURCE POOLS: ${poolsStr}. Primary pool mirrors HP.`,
        `POSITIVE TAGS: Pick 4 distinct descriptive tags (~25–30% situational scope: personal traits, bracketed qualifiers like Strong [for lifting, hauling, or breaching doors], Calm [under gunfire and shock], signature gear, or "Companion: Name (Role — detail)" if the scenario includes friends/companions/party): ${tagsSnippet}. Follow Trait Qualification Protocol (Tier A: auto-qualify broad traits into Trait [context]; Tier B: omit true omnipotence with grounded Trait [context] replacement).`,
        `KNOBS: Flee Grace: ${knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Shift: ${knobs.base_attrition_shift >= 0 ? '+' + knobs.base_attrition_shift : knobs.base_attrition_shift} | Overflow: ${knobs.overflow_default}.`,
        `NO D&D: No character levels, no [XP] blocks, no spell slots, no AC/DC, or polyhedral damage dice. Use 4dF Attrition, Positive Tags, and Scars/Debuffs in [CHARACTER].`,
        `FORMAT MANDATE: Output [CHARACTER] with primary pool HP, secondary pools formatted as "((BARBLUE)) Resolve: 6/6" or "((BARGOLD)) Torch & Supplies: 6/6" (NEVER use a colon inside ((BAR...)), e.g. write ((BARBLUE)) or ((BARGOLD)), and do NOT append Zero Debuff/Recovery text on the bar line), FAE Knobs line, ((PILLS)) Positive Tags: Tag (detail), ((PILLS)) Scars & Debuffs: None, Status: Healthy. NEVER wrap the character name or header line in markdown bold (**).`,
        customNotes ? `ADDITIONAL DETAILS: ${customNotes}` : null,
    ].filter(Boolean).join('\n');
}

