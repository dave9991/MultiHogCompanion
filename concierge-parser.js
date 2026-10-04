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
    const monsters = dossier.monsters || [];
    const maps = dossier.maps || [];
    const kick = dossier.theKick || {};

    let statString = Object.entries(p.stats || {})
        .map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`)
        .join(' · ');

    let movesMd = (p.startingMoves || []).map(m => `* ${m}`).join('\n') || '* No custom moves registered yet.';
    let gearMd = (p.gear || []).map(g => `* ${g}`).join('\n') || '* Basic equipment.';

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
