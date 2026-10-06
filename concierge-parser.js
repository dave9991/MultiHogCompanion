/**
 * concierge-parser.js — MultiHog Companion
 *
 * Parses [CONCIERGE_STATE] blocks from Concierge responses, updates the live
 * Campaign Dossier artifact, and serializes the dossier to Markdown and JSON.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';

/**
 * Creates a clean default Campaign Dossier object.
 * @returns {object}
 */
export function createEmptyDossier() {
    return {
        meta: {
            title: 'Untitled PbtA Campaign',
            systemKey: 'fantasy',
            systemLabel: PBTA_GENRES.fantasy.label,
            premise: '',
            tone: [],
            createdAt: Date.now(),
        },
        protagonist: {
            name: '',
            playbook: '',
            stats: {},
            startingMoves: [],
            harm: { max: 5, current: 0, armor: 0 },
            gear: [],
            bio: '',
            portraitSrc: null,
        },
        npcs: [],
        monsters: [],
        maps: [],
        factions: [],
        theKick: {
            startingLocation: '',
            crisis: '',
            openingPrompt: '',
        },
    };
}

/**
 * Strips [CONCIERGE_STATE] blocks out of text for display in the conversational bubble.
 * @param {string} text
 * @returns {string}
 */
export function stripConciergeStateBlocks(text) {
    if (!text) return '';
    return text
        .replace(/\[CONCIERGE_STATE\][\s\S]*?(?:\[\/CONCIERGE_STATE\]|$)/gi, '')
        .trim();
}

/**
 * Parse key-value lines (e.g. "name: Silas", "harm: 4")
 * @param {string} block
 * @returns {Record<string, string>}
 */
function parseKeyValueLines(block) {
    const res = {};
    const lines = block.split('\n');
    for (const line of lines) {
        const m = line.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*(.*)$/);
        if (m) {
            res[m[1].toLowerCase()] = m[2].trim();
        }
    }
    return res;
}

/**
 * Parse stats line like "Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1"
 * @param {string} line
 * @returns {Record<string, number>}
 */
function parseStatsString(line) {
    const stats = {};
    if (!line) return stats;
    const parts = line.split(/[,|;]/);
    for (const part of parts) {
        const m = part.trim().match(/^([a-zA-Z]+)\s*([+-]?\d+)/);
        if (m) {
            stats[m[1]] = parseInt(m[2], 10);
        }
    }
    return stats;
}

/**
 * Parse list items (lines starting with "- " or "* ")
 * @param {string} block
 * @param {string} sectionKey
 * @returns {string[]}
 */
function parseBulletList(block, sectionKey) {
    const re = new RegExp(`${sectionKey}\\s*:\\s*\\n?((?:\\s*[-*]\\s+[^\\n]+\\n?)*)`, 'i');
    const m = block.match(re);
    if (!m) return [];
    return m[1]
        .split('\n')
        .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
        .filter(Boolean);
}

/**
 * Incremental parser that updates a live Campaign Dossier with tags found in the Concierge's response.
 *
 * @param {string} text Full response text from LLM
 * @param {object} dossier Current dossier to patch
 * @returns {object} Updated dossier clone
 */
export function parseConciergeStateBlock(text, dossier) {
    if (!text || typeof text !== 'string') return dossier;

    const stateMatch = text.match(/\[CONCIERGE_STATE\]([\s\S]*?)(?:\[\/CONCIERGE_STATE\]|$)/i);
    if (!stateMatch) return dossier;

    const raw = stateMatch[1];
    const updated = JSON.parse(JSON.stringify(dossier));

    // 1. Meta / System
    const sysMatch = raw.match(/system\s*:\s*([a-zA-Z0-9_\-]+)/i);
    if (sysMatch) {
        const key = sysMatch[1].trim().toLowerCase();
        if (PBTA_GENRES[key]) {
            updated.meta.systemKey = key;
            updated.meta.systemLabel = PBTA_GENRES[key].label;
        }
    }

    const premiseMatch = raw.match(/premise\s*:\s*([^\n]+)/i);
    if (premiseMatch) {
        updated.meta.premise = premiseMatch[1].trim();
        if (!updated.meta.title || updated.meta.title === 'Untitled PbtA Campaign') {
            updated.meta.title = updated.meta.premise.slice(0, 40) + '...';
        }
    }

    // 2. Protagonist
    const protoMatch = raw.match(/\[PROTAGONIST\]([\s\S]*?)(?:\[\/PROTAGONIST\]|$)/i);
    if (protoMatch) {
        const pBlock = protoMatch[1];
        const kv = parseKeyValueLines(pBlock);

        if (kv.name) updated.protagonist.name = kv.name;
        if (kv.playbook) updated.protagonist.playbook = kv.playbook;
        if (kv.bio) updated.protagonist.bio = kv.bio;
        if (kv.stats) updated.protagonist.stats = parseStatsString(kv.stats);
        if (kv.harm) updated.protagonist.harm.max = parseInt(kv.harm, 10) || 5;
        if (kv.armor) updated.protagonist.harm.armor = parseInt(kv.armor, 10) || 0;

        const moves = parseBulletList(pBlock, 'moves');
        if (moves.length) updated.protagonist.startingMoves = moves;

        if (kv.gear) {
            updated.protagonist.gear = kv.gear.split(/[,;]/).map(g => g.trim()).filter(Boolean);
        }
    }

    // 2b. Supporting NPCs & Allies
    updated.npcs = updated.npcs || [];
    const npcMatches = raw.matchAll(/\[NPC\]([\s\S]*?)(?:\[\/NPC\]|$)/gi);
    for (const match of npcMatches) {
        const nBlock = match[1];
        const kv = parseKeyValueLines(nBlock);
        if (!kv.name) continue;

        const npcObj = {
            name: kv.name,
            role: kv.role || 'Ally',
            species: kv.species || kv.race || '',
            appearance: kv.appearance || kv.description || kv.look || '',
            equipment: kv.equipment || kv.gear || '',
            demeanor: kv.demeanor || '',
            background: kv.background || '',
            relationship: kv.relationship || '',
            movesOrBoons: kv.moves_or_boons || kv.moves || '',
            notes: kv.notes || '',
            portraitSrc: null,
        };

        const existingIdx = updated.npcs.findIndex(n => n.name.toLowerCase() === npcObj.name.toLowerCase());
        if (existingIdx >= 0) {
            updated.npcs[existingIdx] = Object.assign({}, updated.npcs[existingIdx], npcObj);
        } else {
            updated.npcs.push(npcObj);
        }
    }

    // 3. Monsters
    const monsterMatches = raw.matchAll(/\[MONSTER\]([\s\S]*?)(?:\[\/MONSTER\]|$)/gi);
    for (const match of monsterMatches) {
        const mBlock = match[1];
        const kv = parseKeyValueLines(mBlock);
        if (!kv.name) continue;

        const monsterObj = {
            name: kv.name,
            harm: parseInt(kv.harm, 10) || 4,
            armor: parseInt(kv.armor, 10) || 0,
            attacks: kv.attacks ? kv.attacks.split(/[,;]/).map(a => a.trim()).filter(Boolean) : [],
            weakness: kv.weakness || 'Unknown',
            impendingDoom: parseBulletList(mBlock, 'countdown'),
            notes: kv.notes || '',
        };

        const existingIdx = updated.monsters.findIndex(m => m.name.toLowerCase() === monsterObj.name.toLowerCase());
        if (existingIdx >= 0) {
            updated.monsters[existingIdx] = Object.assign({}, updated.monsters[existingIdx], monsterObj);
        } else {
            updated.monsters.push(monsterObj);
        }
    }

    // 4. Maps
    const mapMatches = raw.matchAll(/\[MAP\]([\s\S]*?)(?:\[\/MAP\]|$)/gi);
    for (const match of mapMatches) {
        const mBlock = match[1];
        const kv = parseKeyValueLines(mBlock);
        if (!kv.site) continue;

        const kindUpper = (kv.kind || 'INTERIOR').toUpperCase();
        const threatUpper = (kv.threat || 'MODERATE').toUpperCase();

        const mapObj = {
            site: kv.site,
            kind: ['DUNGEON', 'SETTLEMENT', 'INTERIOR'].includes(kindUpper) ? kindUpper : 'INTERIOR',
            threat: ['NONE', 'LOW', 'MODERATE', 'HIGH', 'DEADLY'].includes(threatUpper) ? threatUpper : 'MODERATE',
            entrance: kv.entrance || 'Main Entrance',
            prompt: kv.prompt || '',
            briefDescription: kv.brief_description || kv.prompt || '',
            status: 'queued',
        };

        const existingIdx = updated.maps.findIndex(m => m.site.toLowerCase() === mapObj.site.toLowerCase());
        if (existingIdx >= 0) {
            updated.maps[existingIdx] = Object.assign({}, updated.maps[existingIdx], mapObj);
        } else {
            updated.maps.push(mapObj);
        }
    }

    // 5. The Kick (Opening Incident)
    const kickMatch = raw.match(/\[KICK\]([\s\S]*?)(?:\[\/KICK\]|$)/i);
    if (kickMatch) {
        const kBlock = kickMatch[1];
        const kv = parseKeyValueLines(kBlock);
        if (kv.starting_location) updated.theKick.startingLocation = kv.starting_location;
        if (kv.crisis) updated.theKick.crisis = kv.crisis;
        if (kv.opening_prompt) updated.theKick.openingPrompt = kv.opening_prompt;
    }

    return updated;
}

/**
 * Serialize a Campaign Dossier into a formatted Markdown document suitable for
 * display, download, and injecting into SillyTavern World Info.
 *
 * @param {object} dossier
 * @returns {string}
 */
export function serializeDossierToMarkdown(dossier) {
    const meta = dossier.meta || {};
    const p = dossier.protagonist || {};
    const npcs = dossier.npcs || [];
    const monsters = dossier.monsters || [];
    const maps = dossier.maps || [];
    const kick = dossier.theKick || {};

    let statString = Object.entries(p.stats || {})
        .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`)
        .join(' · ');

    let movesMd = (p.startingMoves || []).map(m => `* ${m}`).join('\n') || '* No custom moves registered yet.';
    let gearMd = (p.gear || []).map(g => `* ${g}`).join('\n') || '* Basic equipment.';

    let npcsMd = npcs.length
        ? npcs.map(n => `### 👤 ${n.name}
* **Role:** ${n.role || 'Ally'}${n.species ? `\n* **Species:** ${n.species}` : ''}
* **Appearance:** ${n.appearance || 'None specified'}${n.equipment ? `\n* **Equipment:** ${n.equipment}` : ''}
* **Demeanor:** ${n.demeanor || 'None specified'}
* **Relationship:** ${n.relationship || 'Allied with protagonist'}
* **Background:** ${n.background || 'None specified'}
* **Moves/Boons:** ${n.movesOrBoons || 'None'}
* **Notes:** ${n.notes || 'None'}`).join('\n\n')
        : '_No supporting NPCs staged yet._';

    let monstersMd = monsters.length
        ? monsters.map(m => {
            let attacks = m.attacks.length ? m.attacks.join(', ') : 'Natural attacks';
            let doom = m.impendingDoom.length
                ? `\n  * **Countdown Clock:**\n    ${m.impendingDoom.map(d => `* ${d}`).join('\n    ')}`
                : '';
            return `### 👹 ${m.name}
* **Harm:** ${m.harm} | **Armor:** ${m.armor}
* **Attacks:** ${attacks}
* **Weakness:** ${m.weakness}${doom}
* **Notes:** ${m.notes || 'None'}`;
        }).join('\n\n')
        : '_No adversaries staged yet._';

    let mapsMd = maps.length
        ? maps.map(m => `* **${m.site}** (${m.kind} · Threat: ${m.threat})
  * Entrance: ${m.entrance}
  * Premise: ${m.briefDescription}`).join('\n')
        : '_No locations staged yet._';

    return `# 📜 CAMPAIGN DOSSIER: ${meta.title || 'Untitled PbtA Campaign'}

* **System Engine:** ${meta.systemLabel || 'PbtA Fantasy'} (\`${meta.systemKey || 'fantasy'}\`)
* **Premise:** ${meta.premise || 'Not specified'}

---

## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Playbook:** ${p.playbook || 'Wanderer'}
* **Stats:** ${statString || 'Not assigned'}
* **Harm Capacity:** ${p.harm?.max || 5} | **Armor:** ${p.harm?.armor || 0}
* **Background Bio:** ${p.bio || 'None'}

### ⚡ Key Moves:
${movesMd}

### 🎒 Starting Gear:
${gearMd}

---

## 👥 Supporting Cast & Allies (NPCs):
${npcsMd}

---

## 👹 Threats & Monsters:
${monstersMd}

---

## 🗺️ Locations & Sites:
${mapsMd}

---

## ⚡ The Kick (Opening Crisis):
* **Starting Point:** ${kick.startingLocation || 'The road'}
* **Inciting Crisis:** ${kick.crisis || 'Trouble approaches'}
* **Opening Hook:** ${kick.openingPrompt || 'You stand at the threshold...'}`;
}

/**
 * Reconstitutes a Campaign Dossier object from serialized Markdown.
 * Used for auto-recovery and fallback hydration from World Info or lorebooks.
 *
 * @param {string} markdown
 * @returns {object|null}
 */
export function parseMarkdownToDossier(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;
    const dossier = createEmptyDossier();

    // 1. Title
    const titleMatch = markdown.match(/#\s*(?:📜\s*)?CAMPAIGN DOSSIER:\s*([^\n\r]+)/i);
    if (titleMatch) dossier.meta.title = titleMatch[1].trim();

    // 2. System Engine
    const systemMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^(]+?)(?:\s*\(`?([a-z0-9_\-]+)`?\))?(?:\n|$)/i);
    if (systemMatch) {
        dossier.meta.systemLabel = systemMatch[1].trim();
        if (systemMatch[2]) dossier.meta.systemKey = systemMatch[2].trim();
    }

    // 3. Premise
    const premiseMatch = markdown.match(/\*\s*\*\*Premise:\*\*\s*([^\n\r]+)/i);
    if (premiseMatch) dossier.meta.premise = premiseMatch[1].trim();

    // 4. Protagonist
    const protoMatch = markdown.match(/##\s*(?:👤\s*)?Protagonist:\s*([^\n\r]+)/i);
    if (protoMatch) dossier.protagonist.name = protoMatch[1].trim();

    const playbookMatch = markdown.match(/\*\s*\*\*Playbook:\*\*\s*([^\n\r]+)/i);
    if (playbookMatch) dossier.protagonist.playbook = playbookMatch[1].trim();

    const statsMatch = markdown.match(/\*\s*\*\*Stats:\*\*\s*([^\n\r]+)/i);
    if (statsMatch) {
        const parsedStats = parseStatsString(statsMatch[1]);
        if (Object.keys(parsedStats).length > 0) {
            dossier.protagonist.stats = parsedStats;
        }
    }

    const harmMatch = markdown.match(/\*\s*\*\*Harm Capacity:\*\*\s*(\d+)(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
    if (harmMatch) {
        dossier.protagonist.harm = {
            max: parseInt(harmMatch[1], 10) || 5,
            current: 0,
            armor: parseInt(harmMatch[2], 10) || 0,
        };
    }

    const bioMatch = markdown.match(/\*\s*\*\*Background Bio:\*\*\s*([^\n\r]+)/i);
    if (bioMatch) dossier.protagonist.bio = bioMatch[1].trim();

    // 5. Moves
    const movesMatch = markdown.match(/###\s*(?:⚡\s*)?Key Moves:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (movesMatch) {
        const lines = movesMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('No custom'));
        if (lines.length) dossier.protagonist.startingMoves = lines;
    }

    // 6. Gear
    const gearMatch = markdown.match(/###\s*(?:🎒\s*)?Starting Gear:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (gearMatch) {
        const lines = gearMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('Basic'));
        if (lines.length) dossier.protagonist.gear = lines;
    }

    // 6b. Supporting NPCs / Allies
    const npcSection = markdown.match(/##\s*(?:👥\s*)?Supporting Cast[^\n]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (npcSection) {
        const npcBlocks = npcSection[1].split(/###\s*(?:👤\s*)?/);
        for (const block of npcBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const roleM = block.match(/\*\s*\*\*Role:\*\*\s*([^\n\r]+)/i);
            const appM = block.match(/\*\s*\*\*Appearance:\*\*\s*([^\n\r]+)/i);
            const demeanorM = block.match(/\*\s*\*\*Demeanor:\*\*\s*([^\n\r]+)/i);
            const relM = block.match(/\*\s*\*\*Relationship:\*\*\s*([^\n\r]+)/i);
            const bgM = block.match(/\*\s*\*\*Background:\*\*\s*([^\n\r]+)/i);
            const boonsM = block.match(/\*\s*\*\*Moves\/Boons:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const speciesM = block.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
            const equipM = block.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);

            dossier.npcs.push({
                name,
                role: roleM ? roleM[1].trim() : 'Ally',
                species: speciesM ? speciesM[1].trim() : '',
                appearance: appM && !appM[1].includes('None specified') ? appM[1].trim() : '',
                equipment: equipM ? equipM[1].trim() : '',
                demeanor: demeanorM ? demeanorM[1].trim() : '',
                relationship: relM ? relM[1].trim() : '',
                background: bgM ? bgM[1].trim() : '',
                movesOrBoons: boonsM ? boonsM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                portraitSrc: null,
            });
        }
    }

    // 7. Monsters
    const monsterSection = markdown.match(/##\s*(?:👹\s*)?Threats & Monsters:\s*([\s\S]*?)(?=##|---|$)/i);
    if (monsterSection) {
        const monsterBlocks = monsterSection[1].split(/###\s*(?:👹\s*)?/);
        for (const block of monsterBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const harmArmorM = block.match(/\*\s*\*\*Harm:\*\*\s*(\d+)(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
            const attacksM = block.match(/\*\s*\*\*Attacks:\*\*\s*([^\n\r]+)/i);
            const weaknessM = block.match(/\*\s*\*\*Weakness:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            dossier.monsters.push({
                name,
                harm: harmArmorM ? parseInt(harmArmorM[1], 10) : 3,
                armor: harmArmorM ? (parseInt(harmArmorM[2], 10) || 0) : 0,
                attacks: attacksM ? attacksM[1].split(',').map(s => s.trim()) : [],
                weakness: weaknessM ? weaknessM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                impendingDoom: [],
            });
        }
    }

    // 8. Locations & Sites
    const mapsSection = markdown.match(/##\s*(?:🗺️\s*)?Locations & Sites:\s*([\s\S]*?)(?=##|---|$)/i);
    if (mapsSection) {
        const mapRe = /\*\s*\*\*([^*]+)\*\*\s*\(([^·\)]+)(?:·\s*Threat:\s*([^)]+))?\)/g;
        let m;
        while ((m = mapRe.exec(mapsSection[1])) !== null) {
            dossier.maps.push({
                site: m[1].trim(),
                kind: m[2].trim(),
                threat: m[3] ? m[3].trim() : 'MODERATE',
                entrance: 'Main Entrance',
                briefDescription: '',
            });
        }
    }

    // 9. The Kick
    const kickSection = markdown.match(/##\s*(?:⚡\s*)?The Kick[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (kickSection) {
        const startM = kickSection[1].match(/\*\s*\*\*Starting Point:\*\*\s*([^\n\r]+)/i);
        const crisisM = kickSection[1].match(/\*\s*\*\*Inciting Crisis:\*\*\s*([^\n\r]+)/i);
        const hookM = kickSection[1].match(/\*\s*\*\*Opening Hook:\*\*\s*([^\n\r]+)/i);
        if (startM) dossier.theKick.startingLocation = startM[1].trim();
        if (crisisM) dossier.theKick.crisis = crisisM[1].trim();
        if (hookM) dossier.theKick.openingPrompt = hookM[1].trim();
    }

    return (dossier.protagonist.name || dossier.meta.title !== 'Untitled PbtA Campaign') ? dossier : null;
}
