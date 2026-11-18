/**
 * concierge-markdown-codec.js — MultiHog Companion
 *
 * Bidirectional Markdown codec for Campaign Dossiers (serialization & parsing),
 * Contemplative Blueprint Judge critique parsing, Builder transaction classification,
 * diagnostic trace formatting, and World Axiom HTML card rendering.
 */

import { PBTA_GENRES } from './pbta-ruleset.js';
import { FAE_GENRES } from './fae-ruleset.js';
import { escapeHtml } from './mhc-utils.js';
import { parseKeyValueLines, parseStatsString, parseBulletOrListItems } from './concierge-block-lexer.js';
import {
    createEmptyDossier,
    healAndNormalizeDossier,
    isDefaultUntitledCampaignTitle,
    isPlaceholderGearList,
    splitEquipmentIntoGearList,
    clampRelationshipScore,
    inferStartingNpcRelationships,
} from './concierge-parser.js';

/**
 * Serialize a Campaign Dossier into a formatted Markdown document suitable for
 * display, download, and injecting into SillyTavern World Info.
 *
 * @param {object} dossier
 * @param {{ includeCyoa?: boolean }} [options]
 * @returns {string}
 */
export function serializeDossierToMarkdown(dossier, options = {}) {
    const { includeCyoa = true } = options;
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
    const effectiveGear = !isPlaceholderGearList(p.gear)
        ? p.gear
        : (p.equipment ? splitEquipmentIntoGearList(p.equipment) : (p.gear || []));
    let gearMd = effectiveGear.map(g => `* ${g}`).join('\n') || '* Basic equipment.';

    let npcsMd = npcs.length
        ? npcs.map(n => {
            const standingsLine = (n.friendship !== undefined || n.affection !== undefined)
                ? `\n* **Standings:** Friendship ${n.friendship >= 0 ? '+' : ''}${n.friendship || 0} · Affection ${n.affection >= 0 ? '+' : ''}${n.affection || 0}`
                : '';
            const harmPart = (n.harm && (n.harm.current > 0 || n.harm.max !== undefined))
                ? `\n* **Harm:** ${n.harm.current || 0}/${n.harm.max || 5}${n.harm.armor ? ` | **Armor:** ${n.harm.armor}` : ''}`
                : '';
            const condPart = (n.conditions && (Array.isArray(n.conditions) ? n.conditions.length : String(n.conditions).trim()))
                ? `\n* **Conditions:** ${Array.isArray(n.conditions) ? n.conditions.join(', ') : n.conditions}`
                : '';
            const statusPart = n.status ? `\n* **Status:** ${n.status}` : (n.harm?.current > 0 ? '\n* **Status:** (-) Wounded' : '');
            const archetypePart = n.archetype ? `\n* **Archetype:** ${n.archetype}` : '';
            const genderPart = n.gender ? `\n* **Gender:** ${n.gender}` : '';
            return `### 👤 ${n.name}
* **Role:** ${n.role || 'Ally'}${archetypePart}${genderPart}${n.species ? `\n* **Species:** ${n.species}` : ''}${harmPart}${statusPart}${condPart}
* **Appearance:** ${n.appearance || 'None specified'}${n.equipment ? `\n* **Equipment:** ${n.equipment}` : ''}
* **Demeanor:** ${n.demeanor || 'None specified'}
* **Relationship:** ${n.relationship || 'Allied with protagonist'}${standingsLine}
* **Background:** ${n.background || 'None specified'}
* **Moves/Boons:** ${n.movesOrBoons || 'None'}
* **Notes:** ${n.notes || 'None'}`;
        }).join('\n\n')
        : '_No supporting NPCs staged yet._';

    let monstersMd = monsters.length
        ? monsters.map(m => {
            if (meta.ruleset === 'fae') {
                const threatStr = m.threatLevel ? `Threat Level ${m.threatLevel}` : 'Standard Threat';
                const layersStr = `${m.currentHarm ?? m.currentLayers ?? 0}/${m.harm ?? m.layers ?? 2} HP`;
                const poolsStr = Array.isArray(m.poolsAtRisk) ? m.poolsAtRisk.join(', ') : (m.poolsAtRisk || 'Health');
                const pressuresStr = Array.isArray(m.pressures) ? m.pressures.join(', ') : (m.pressures || 'None');
                const barriersStr = Array.isArray(m.leverageBarriers) ? m.leverageBarriers.join('; ') : (m.leverageBarriers || 'None');
                const finishStr = m.fullFinishTriggers ? `\n* **Full-Finish Triggers:** ${m.fullFinishTriggers}` : '';
                const notesStr = m.notes ? `\n* **Notes:** ${m.notes}` : '';
                const instinctStr = m.instinct ? `\n* **Instinct:** ${m.instinct}` : '';
                const statusStr = m.status ? `\n* **Status:** ${m.status}` : '';
                return `### 👹 ${m.name}
* **${threatStr}** | **Leverage Layers:** ${layersStr}
* **Pools at Risk:** ${poolsStr}
* **Pressures:** ${pressuresStr}${instinctStr}${statusStr}
* **Leverage Barriers:** ${barriersStr}${finishStr}${notesStr}`;
            }
            let attacks = (m.attacks && m.attacks.length) ? m.attacks.join(', ') : 'Natural attacks';
            let doom = (m.impendingDoom && m.impendingDoom.length)
                ? `\n  * **Countdown Clock:**\n    ${m.impendingDoom.map(d => `* ${d}`).join('\n    ')}`
                : '';
            const mCurHarm = parseInt(m.currentHarm ?? m.harm?.current, 10) || 0;
            const mMaxHarm = parseInt(m.harm?.max ?? m.harm, 10) || 4;
            const harmStr = mCurHarm > 0 ? `${mCurHarm}/${mMaxHarm} (Wounded)` : `${mMaxHarm}`;
            const statusLine = m.status ? `\n* **Status:** ${m.status}` : (mCurHarm > 0 ? '\n* **Status:** (-) Wounded' : '');
            return `### 👹 ${m.name}
* **Harm:** ${harmStr} | **Armor:** ${m.armor || 0}${statusLine}
* **Attacks:** ${attacks}
* **Weakness:** ${m.weakness || 'Unknown'}${doom}
* **Notes:** ${m.notes || 'None'}`;
        }).join('\n\n')
        : '_No adversaries staged yet._';

    let factionsMd = (dossier.factions || []).length
        ? dossier.factions.map(f => `### 🚩 ${f.name}
* **Agenda:** ${f.agenda || 'None specified'}
* **Standing:** ${f.standing || 'Neutral'}
* **Notes:** ${f.notes || 'None'}`).join('\n\n')
        : '_No factions staged yet._';

    let mapsMd = maps.length
        ? maps.map(m => `* **${m.site}** (${m.kind} · Threat: ${m.threat})
  * Entrance: ${m.entrance}
  * Premise: ${m.briefDescription}`).join('\n')
        : '_No locations staged yet._';

    let worldRulesMd = '';
    if (dossier.worldRules?.axioms && dossier.worldRules.axioms.length) {
        worldRulesMd = '\n\n---\n\n## 🌐 World Rules & Physical Axioms:\n' +
            dossier.worldRules.axioms.map(r => {
                let subLines = (r.substitutions && r.substitutions.length)
                    ? `\n* **Substitutions:**\n  ${r.substitutions.map(s => `* ${s}`).join('\n  ')}`
                    : '';
                let conLines = (r.negativeConstraints && r.negativeConstraints.length)
                    ? `\n* **Negative Constraints (Banned):**\n  ${r.negativeConstraints.map(c => `* ${c}`).join('\n  ')}`
                    : '';
                let archLine = r.architecturalNotes
                    ? `\n* **Architectural Implications:** ${r.architecturalNotes}`
                    : '';
                return `### 🌐 ${r.title} (${r.category || 'general'})\n* **Core Axiom:** ${r.axiom || 'None specified'}${subLines}${conLines}${archLine}`;
            }).join('\n\n');
    }

    let customModuleMd = '';
    if (dossier.worldRules?.customModule) {
        const cm = dossier.worldRules.customModule;
        const cmTag = cm.tag || cm.fieldKey || 'CUSTOM';
        const cmSample = cm.sampleContent || cm.sample || '';
        const sampleBlock = cmSample ? `\n\n\`\`\`text\n${cmSample}\n\`\`\`` : '';
        customModuleMd = `\n\n---\n\n## 📊 Custom Tracker Module:\n* **Tag:** [${cmTag}]\n* **Label:** ${cm.label || cmTag}\n* **Icon:** ${cm.icon || '📦'}\n* **State Model Instruction:** ${cm.instruction || 'None'}${sampleBlock}`;
    }

    const toneLine = meta.tone
        ? `\n* **Tone:** ${meta.tone}`
        : '';

    const isFae = meta.ruleset === 'fae';
    const isHeroicTier = Boolean(
        dossier.config?.heroicTier ||
        dossier.config?.heroic_tier ||
        dossier.config?.knobs?.heroic_tier ||
        dossier.character?.heroic_domain ||
        dossier.protagonist?.heroicDomain
    );
    const systemLine = isFae
        ? `* **System Engine:** Freeform Attrition Engine (${meta.systemLabel || 'Cosmic Horror'}) (\`${meta.systemKey || 'cosmic_horror'}\`)`
        : `* **System Engine:** ${meta.systemLabel || 'PbtA Fantasy'} (\`${meta.systemKey || 'fantasy'}\`)`;
    const heroicKnobStr = (isFae && isHeroicTier) ? ' | Heroic: ON' : '';
    const knobsLine = (isFae && dossier.config?.knobs)
        ? `\n* **FAE Knobs:** Flee Grace: ${dossier.config.knobs.flee_grace_toggle ? 'ON' : 'OFF'} | Shift: ${dossier.config.knobs.base_attrition_shift >= 0 ? '+' + dossier.config.knobs.base_attrition_shift : dossier.config.knobs.base_attrition_shift} | Overflow: ${dossier.config.knobs.overflow_default || 'scar_and_ko'}${heroicKnobStr}`
        : '';

    let protagonistSection = '';
    if (isFae) {
        const poolsMd = Object.values(p.pools || {}).map(pool =>
            `* **${pool.label} (${pool.current}/${pool.max}):** Recovery via \`${pool.recovery}\` · Zero Debuff: "${pool.zero_debuff}" · Overflow: \`${pool.on_overflow}\``
        ).join('\n') || '* No resource pools established.';

        const posTagsMd = (p.positiveTags || []).map(t => `* ${t}`).join('\n') || '* No positive tags registered yet.';
        const negTagsMd = (p.negativeTags || []).map(t => `* ${t}`).join('\n') || '* None.';

        const heroicDomain = p.heroicDomain || p.heroic_domain || dossier.character?.heroic_domain;
        const heroicDomainLine = (isHeroicTier && heroicDomain) ? `\n* **Heroic Domain:** ${heroicDomain}` : '';

        protagonistSection = `## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Archetype:** ${p.playbook || 'Investigator'}${heroicDomainLine}${p.gender ? `\n* **Gender:** ${p.gender}` : ''}${p.species ? `\n* **Species:** ${p.species}` : ''}${p.appearance ? `\n* **Appearance:** ${p.appearance}` : ''}${p.equipment ? `\n* **Equipment:** ${p.equipment}` : ''}${p.personality ? `\n* **Personality:** ${p.personality}` : ''}
* **Background Bio:** ${p.bio || p.background || 'None'}

### 🧪 Resource Pools:
${poolsMd}

### 🏷️ Positive Tags (Signature Gear & Traits):
${posTagsMd}

### 🩹 Scars & Debuffs:
${negTagsMd}`;
    } else {
        protagonistSection = `## 👤 Protagonist: ${p.name || 'Unnamed Adventurer'}
* **Playbook:** ${p.playbook || 'Wanderer'}${p.gender ? `\n* **Gender:** ${p.gender}` : ''}${p.species ? `\n* **Species:** ${p.species}` : ''}${p.appearance ? `\n* **Appearance:** ${p.appearance}` : ''}${p.equipment ? `\n* **Equipment:** ${p.equipment}` : ''}${p.personality ? `\n* **Personality:** ${p.personality}` : ''}${p.habits ? `\n* **Habits:** ${p.habits}` : ''}
* **Stats:** ${statString || 'Not assigned'}
* **Harm Capacity:** ${(p.harm?.current > 0) ? `${p.harm.current}/${p.harm.max || 5} (Wounded)` : (p.harm?.max || 5)} | **Armor:** ${p.harm?.armor || 0}${(p.status || (p.harm?.current > 0 ? '(-) Wounded' : '')) ? `\n* **Status:** ${p.status || '(-) Wounded'}` : ''}${(p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) ? `\n* **Conditions:** ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}` : ''}
* **Background Bio:** ${p.bio || p.background || 'None'}

### ⚡ Key Moves:
${movesMd}

### 🎒 Starting Gear:
${gearMd}`;
    }

    return `# 📜 CAMPAIGN DOSSIER: ${meta.title || (isFae ? 'Untitled FAE Campaign' : 'Untitled PbtA Campaign')}

${systemLine}${knobsLine}
* **Premise:** ${meta.premise || 'Not specified'}${toneLine}

---

${protagonistSection}

---

## 👥 Supporting Cast & Allies (NPCs):
${npcsMd}

---

## 👹 Threats & Monsters:
${monstersMd}

---

## 🚩 Factions & Powers:
${factionsMd}

---

## 🗺️ Locations & Sites:
${mapsMd}${worldRulesMd}${customModuleMd}

---

## ⚡ The Kick (Opening Crisis):
* **Starting Point:** ${kick.startingLocation || 'The road'}
* **Inciting Crisis:** ${kick.crisis || 'Trouble approaches'}
* **Opening Hook:** ${kick.openingPrompt || 'You stand at the threshold...'}${includeCyoa && dossier.cyoaExamples && dossier.cyoaExamples.length ? `\n\n---\n\n## 🎲 Tailored CYOA Move Choices:\n${dossier.cyoaExamples.map(c => `* ${c}`).join('\n')}` : ''}${dossier.config ? `\n\n---\n\n## ⚙️ Campaign Calibration Dials:
* **Playstyle:** ${dossier.config.playstyle || 'cyoa_5'}
* **Harm Capacity:** ${dossier.config.harmMax || 5}
* **Party Mode:** ${dossier.config.partyMode || 'squad'}
* **CYOA Emojis:** ${dossier.config.cyoaEmojis !== false ? 'Enabled' : 'Disabled'}${dossier.config.simulationDepth ? `\n* **Simulation Depth:** ${dossier.config.simulationDepth}` : ''}${dossier.config.artStyle ? `\n* **Art Direction:** ${dossier.config.artStyle}` : ''}${dossier.config.pacingXp ? `\n* **XP Pacing:** ${dossier.config.pacingXp}` : ''}${dossier.config.relationships !== undefined ? `\n* **Relationships:** ${dossier.config.relationships !== false ? 'Enabled' : 'Disabled'}` : ''}${dossier.config.maxHarmFate ? `\n* **Max Harm Fate:** ${dossier.config.maxHarmFate.rule || dossier.config.maxHarmFate}${dossier.config.maxHarmFate.statusToken ? ` | **Status Token:** ${dossier.config.maxHarmFate.statusToken}` : ''}` : ''}${(dossier.config.actionTempo || dossier.config.knobs?.action_tempo) ? `\n* **Action Tempo:** ${dossier.config.actionTempo || dossier.config.knobs?.action_tempo}` : ''}${isFae && dossier.config.knobs ? `\n* **Flee Grace:** ${dossier.config.knobs.flee_grace_toggle ? 'ON' : 'OFF'}\n* **Base Attrition Shift:** ${dossier.config.knobs.base_attrition_shift >= 0 ? '+' + dossier.config.knobs.base_attrition_shift : dossier.config.knobs.base_attrition_shift}\n* **Overflow Default:** ${dossier.config.knobs.overflow_default || 'scar_and_ko'}` : ''}${isFae && dossier.config.pacingScenes ? `\n* **Pacing Scenes:** ${dossier.config.pacingScenes}` : ''}` : ''}`;
}

/**
 * Parses markdown representation of a Campaign Dossier into a validated,
 * self-healed PbtaCampaignDossier object.
 *
 * @param {string} markdown
 * @returns {object|null}
 */
export function parseMarkdownToDossier(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;

    // Detect ruleset and optional genre key from markdown before initializing base dossier
    const isFae = /\bFreeform Attrition Engine\b/i.test(markdown)
        || /\bFAE Knobs:\b/i.test(markdown)
        || /\bResource Pools:\b/i.test(markdown)
        || /\bPositive Tags\b/i.test(markdown)
        || /\bLeverage Layers:\b/i.test(markdown);

    const initialRuleset = isFae ? 'fae' : 'pbta';
    let initialGenreKey = null;
    const preSysLineMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^\n\r]+)/i);
    if (preSysLineMatch) {
        const preKeyMatch = preSysLineMatch[1].match(/[`(]([a-z0-9_\-]+)[`)]/i);
        if (preKeyMatch) {
            initialGenreKey = preKeyMatch[1].toLowerCase();
        }
    }

    const dossier = createEmptyDossier(initialRuleset, initialGenreKey);

    // 1. Title (flexible matching for legacy versions)
    const titleMatch = markdown.match(/(?:#\s*)?(?:📜\s*)?(?:CAMPAIGN DOSSIER|Campaign Blueprint|Campaign Overview|Campaign Dossier)[:\s]*([^\n\r]+)/i);
    if (titleMatch) dossier.meta.title = titleMatch[1].trim();

    // 2. System Engine (flexible matching)
    const systemLineMatch = markdown.match(/\*\s*\*\*System Engine:\*\*\s*([^\n\r]+)/i);
    if (systemLineMatch) {
        const fullSysLine = systemLineMatch[1].trim();
        const keyMatch = fullSysLine.match(/[`(]([a-z0-9_\-]+)[`)]/i);
        if (keyMatch && (PBTA_GENRES[keyMatch[1].toLowerCase()] || FAE_GENRES[keyMatch[1].toLowerCase()] || keyMatch[1].toLowerCase() === 'custom')) {
            dossier.meta.systemKey = keyMatch[1].toLowerCase();
        }
        dossier.meta.systemLabel = fullSysLine.replace(/\s*\(?`?[a-z0-9_\-]+`?\)?\s*$/i, '').trim();
    }

    // 2b. FAE Knobs
    const knobsMatch = markdown.match(/\*\s*\*\*FAE Knobs:\*\*\s*([^\n\r]+)/i);
    if (knobsMatch) {
        dossier.config = dossier.config || {};
        dossier.config.knobs = dossier.config.knobs || {};
        const kStr = knobsMatch[1];
        if (/\bHeroic:\s*ON\b/i.test(kStr)) {
            dossier.config.heroicTier = true;
            dossier.config.heroic_tier = true;
            dossier.config.knobs.heroic_tier = true;
        } else if (/\bHeroic:\s*OFF\b/i.test(kStr)) {
            dossier.config.heroicTier = false;
            dossier.config.heroic_tier = false;
            dossier.config.knobs.heroic_tier = false;
        }
    }

    // 3. Premise & Tone
    const premiseMatch = markdown.match(/\*\s*\*\*Premise:\*\*\s*([^\n\r]+)/i);
    if (premiseMatch) dossier.meta.premise = premiseMatch[1].trim();

    const toneMatch = markdown.match(/\*\s*\*\*Tone:\*\*\s*([^\n\r]+)/i);
    if (toneMatch) {
        dossier.meta.tone = toneMatch[1].trim();
    }

    // 4. Protagonist (flexible matching)
    const protoMatch = markdown.match(/(?:##\s*)?(?:👤\s*)?Protagonist[:\s]*([^\n\r]+)/i);
    if (protoMatch) dossier.protagonist.name = protoMatch[1].trim();

    const playbookMatch = markdown.match(/\*\s*\*\*(?:Playbook|Archetype):\*\*\s*([^\n\r]+)/i);
    if (playbookMatch) dossier.protagonist.playbook = playbookMatch[1].trim();

    const heroicDomainMatch = markdown.match(/\*\s*\*\*Heroic Domain:\*\*\s*([^\n\r]+)/i);
    if (heroicDomainMatch) {
        dossier.protagonist.heroicDomain = heroicDomainMatch[1].trim();
    }

    const statsMatch = markdown.match(/\*\s*\*\*Stats:\*\*\s*([^\n\r]+)/i);
    if (statsMatch) {
        const parsedStats = parseStatsString(statsMatch[1]);
        if (Object.keys(parsedStats).length > 0) {
            dossier.protagonist.stats = parsedStats;
        }
    }

    const harmMatch = markdown.match(/\*\s*\*\*Harm Capacity:\*\*\s*(?:(\d+)\s*\/\s*(\d+)(?:\s*\([^)]*\))?|(\d+))(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
    if (harmMatch) {
        const curHarm = harmMatch[1] !== undefined ? (parseInt(harmMatch[1], 10) || 0) : 0;
        const maxHarm = harmMatch[2] !== undefined ? (parseInt(harmMatch[2], 10) || 5) : (parseInt(harmMatch[3], 10) || 5);
        dossier.protagonist.harm = {
            max: maxHarm,
            current: curHarm,
            armor: parseInt(harmMatch[4], 10) || 0,
        };
    }

    const bioMatch = markdown.match(/\*\s*\*\*Background Bio:\*\*\s*([^\n\r]+)/i);
    if (bioMatch) {
        const bioVal = bioMatch[1].trim();
        if (bioVal && bioVal !== 'None') {
            dossier.protagonist.bio = bioVal;
            dossier.protagonist.background = bioVal;
        }
    }

    const speciesMatch = markdown.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
    if (speciesMatch) dossier.protagonist.species = speciesMatch[1].trim();

    const genderMatch = markdown.match(/\*\s*\*\*Gender:\*\*\s*([^\n\r]+)/i);
    if (genderMatch) dossier.protagonist.gender = genderMatch[1].trim();

    const appMatch = markdown.match(/\*\s*\*\*Appearance:\*\*\s*([^\n\r]+)/i);
    if (appMatch) dossier.protagonist.appearance = appMatch[1].trim();

    const equipMatch = markdown.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);
    if (equipMatch) dossier.protagonist.equipment = equipMatch[1].trim();

    const persMatch = markdown.match(/\*\s*\*\*Personality:\*\*\s*([^\n\r]+)/i);
    if (persMatch) dossier.protagonist.personality = persMatch[1].trim();

    const habitsMatch = markdown.match(/\*\s*\*\*Habits:\*\*\s*([^\n\r]+)/i);
    if (habitsMatch) dossier.protagonist.habits = habitsMatch[1].trim();

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

    // 6a. FAE Resource Pools
    const poolsSection = markdown.match(/###\s*(?:🧪\s*)?Resource Pools[^\n]*:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (poolsSection) {
        const lines = poolsSection[1].split('\n').map(l => l.trim()).filter(Boolean);
        const parsedPools = {};
        for (const l of lines) {
            const m = l.match(/\*\s*\*\*([A-Za-z0-9\s&]+?)\s*\(([+-]?\d+)\/(\d+)\)\s*:\*\*\s*(.*)/i);
            if (m) {
                const rawLabel = m[1].trim();
                const cur = parseInt(m[2], 10);
                const max = parseInt(m[3], 10);
                const rest = m[4];

                const recM = rest.match(/Recovery via\s*[`"]?([^`"·\n]+)[`"]?/i);
                const zdM = rest.match(/Zero Debuff:\s*["“]?([^"”·\n]+)["”]?/i);
                const flowM = rest.match(/Overflow:\s*[`"]?([^`"·\n]+)[`"]?/i);

                const key = rawLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                parsedPools[key] = {
                    key,
                    label: rawLabel,
                    current: isNaN(cur) ? max : cur,
                    max: isNaN(max) ? 8 : max,
                    recovery: recM ? recM[1].trim() : 'camp_or_sleep',
                    zero_debuff: zdM ? zdM[1].trim() : `${rawLabel} Trauma`,
                    on_overflow: flowM ? flowM[1].trim() : 'scar_and_ko',
                    barColor: /body|health|phys/i.test(key) ? 'green' : /resolve|mind|spirit|sanity/i.test(key) ? 'purple' : /suppl|gear|torch|trail/i.test(key) ? 'amber' : 'blue',
                    passive_drain: null,
                    strain_flavor: '',
                };
            }
        }
        if (Object.keys(parsedPools).length > 0) {
            dossier.protagonist.pools = parsedPools;
            dossier.pools = parsedPools;
        }
    }

    // 6b. FAE Positive Tags & Scars
    const posTagsMatch = markdown.match(/###\s*(?:🏷️\s*)?Positive Tags[^\n]*:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (posTagsMatch) {
        const lines = posTagsMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('No positive'));
        if (lines.length) dossier.protagonist.positiveTags = lines;
    }
    const scarsMatch = markdown.match(/###\s*(?:🩹\s*)?(?:Scars & Debuffs|Scars)[^\n]*:\s*([\s\S]*?)(?=###|##|---|$)/i);
    if (scarsMatch) {
        const lines = scarsMatch[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(l => l && !l.startsWith('_No') && !l.startsWith('None'));
        if (lines.length) dossier.protagonist.negativeTags = lines;
    }

    // 6b. Supporting NPCs / Allies
    const npcSection = markdown.match(/##\s*(?:👥\s*)?Supporting Cast[^\n]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
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
            const standingsM = block.match(/\*\s*\*\*Standings:\*\*\s*Friendship\s*([+-]?\d+)\s*·\s*Affection\s*([+-]?\d+)/i);
            const bgM = block.match(/\*\s*\*\*Background:\*\*\s*([^\n\r]+)/i);
            const boonsM = block.match(/\*\s*\*\*Moves\/Boons:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const genderM = block.match(/\*\s*\*\*Gender:\*\*\s*([^\n\r]+)/i);
            const speciesM = block.match(/\*\s*\*\*Species:\*\*\s*([^\n\r]+)/i);
            const equipM = block.match(/\*\s*\*\*Equipment:\*\*\s*([^\n\r]+)/i);
            const archM = block.match(/\*\s*\*\*Archetype:\*\*\s*([^\n\r]+)/i);

            const role = roleM ? roleM[1].trim() : 'Ally';
            const relText = relM ? relM[1].trim() : '';
            let fVal = 0;
            let aVal = 0;
            if (standingsM) {
                fVal = clampRelationshipScore(standingsM[1]);
                aVal = clampRelationshipScore(standingsM[2]);
            } else {
                const inferred = inferStartingNpcRelationships(role, relText);
                fVal = inferred.friendship;
                aVal = inferred.affection;
            }

            dossier.npcs.push({
                name,
                role,
                gender: genderM ? genderM[1].trim() : '',
                archetype: archM ? archM[1].trim() : '',
                species: speciesM ? speciesM[1].trim() : '',
                appearance: appM && !appM[1].includes('None specified') ? appM[1].trim() : '',
                equipment: equipM ? equipM[1].trim() : '',
                demeanor: demeanorM ? demeanorM[1].trim() : '',
                relationship: relText,
                friendship: fVal,
                affection: aVal,
                background: bgM ? bgM[1].trim() : '',
                movesOrBoons: boonsM ? boonsM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                portraitSrc: null,
            });
        }
    }

    // 7. Monsters
    const monsterSection = markdown.match(/##\s*(?:👹\s*)?Threats & Monsters:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (monsterSection) {
        const monsterBlocks = monsterSection[1].split(/###\s*(?:👹\s*)?/);
        for (const block of monsterBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const harmArmorM = block.match(/\*\s*\*\*Harm:\*\*\s*(?:(\d+)\s*\/\s*(\d+)(?:\s*\([^)]*\))?|(\d+))(?:\s*\|\s*\*\*Armor:\*\*\s*(\d+))?/i);
            const faeThreatM = block.match(/\*\s*\*\*(?:Threat Level (\d+)|([^|*]+))\*\*\s*\|\s*\*\*Leverage Layers:\*\*\s*(?:(\d+)\s*\/\s*(\d+)|(\d+))/i);
            const poolsM = block.match(/\*\s*\*\*Pools at Risk:\*\*\s*([^\n\r]+)/i);
            const pressuresM = block.match(/\*\s*\*\*Pressures:\*\*\s*([^\n\r]+)/i);
            const instinctM = block.match(/\*\s*\*\*Instinct:\*\*\s*([^\n\r]+)/i);
            const statusM = block.match(/\*\s*\*\*Status:\*\*\s*([^\n\r]+)/i);
            const barriersM = block.match(/\*\s*\*\*Leverage Barriers:\*\*\s*([^\n\r]+)/i);
            const finishM = block.match(/\*\s*\*\*Full-Finish Triggers:\*\*\s*([^\n\r]+)/i);
            const attacksM = block.match(/\*\s*\*\*Attacks:\*\*\s*([^\n\r]+)/i);
            const weaknessM = block.match(/\*\s*\*\*Weakness:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            const doomM = block.match(/\*\s*\*\*Countdown Clock:\*\*\s*([\s\S]*?)(?=\*\s*\*\*Notes:|$)/i);
            const impendingDoom = [];
            if (doomM) {
                const dLines = doomM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                impendingDoom.push(...dLines);
            }

            const threatLevelNum = faeThreatM ? (parseInt(faeThreatM[1], 10) || null) : null;
            const curHarm = harmArmorM && harmArmorM[1] !== undefined ? (parseInt(harmArmorM[1], 10) || 0) : (faeThreatM && faeThreatM[3] !== undefined ? (parseInt(faeThreatM[3], 10) || 0) : 0);
            const maxHarm = harmArmorM
                ? (harmArmorM[2] !== undefined ? (parseInt(harmArmorM[2], 10) || 3) : (parseInt(harmArmorM[3], 10) || 3))
                : (faeThreatM ? (faeThreatM[4] !== undefined ? (parseInt(faeThreatM[4], 10) || 2) : (parseInt(faeThreatM[5], 10) || 2)) : 3);

            dossier.monsters.push({
                name,
                harm: maxHarm,
                currentHarm: curHarm,
                armor: harmArmorM ? (parseInt(harmArmorM[4], 10) || 0) : 0,
                attacks: attacksM ? attacksM[1].split(',').map(s => s.trim()) : [],
                weakness: weaknessM ? weaknessM[1].trim() : '',
                notes: notesM ? notesM[1].trim() : '',
                impendingDoom,
                threatLevel: threatLevelNum,
                layers: maxHarm,
                currentLayers: curHarm,
                poolsAtRisk: poolsM ? poolsM[1].split(',').map(s => s.trim()) : null,
                pressures: pressuresM ? pressuresM[1].split(',').map(s => s.trim()) : [],
                instinct: instinctM ? instinctM[1].trim() : '',
                status: statusM ? statusM[1].trim() : '',
                leverageBarriers: barriersM ? barriersM[1].split(';').map(s => s.trim()) : [],
                fullFinishTriggers: finishM ? finishM[1].trim() : '',
            });
        }
    }

    // 7b. Factions & Powers
    const factionSection = markdown.match(/##\s*(?:🚩\s*)?Factions & Powers:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (factionSection) {
        const fBlocks = factionSection[1].split(/###\s*(?:🚩\s*)?/);
        for (const block of fBlocks) {
            const lines = block.trim().split('\n');
            const name = lines[0]?.trim();
            if (!name || name.startsWith('_No')) continue;

            const agendaM = block.match(/\*\s*\*\*Agenda:\*\*\s*([^\n\r]+)/i);
            const standingM = block.match(/\*\s*\*\*Standing:\*\*\s*([^\n\r]+)/i);
            const notesM = block.match(/\*\s*\*\*Notes:\*\*\s*([^\n\r]+)/i);

            dossier.factions.push({
                name,
                agenda: agendaM ? agendaM[1].trim() : '',
                standing: standingM ? standingM[1].trim() : 'Neutral',
                notes: notesM ? notesM[1].trim() : '',
            });
        }
    }

    // 8. Locations & Sites
    const mapsSection = markdown.match(/##\s*(?:🗺️\s*)?Locations & Sites:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
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

    // 10. CYOA Choices
    const cyoaSection = markdown.match(/##\s*(?:🎲\s*)?Tailored CYOA Move Choices[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (cyoaSection) {
        const lines = cyoaSection[1].split('\n')
            .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
            .filter(Boolean);
        if (lines.length) dossier.cyoaExamples = lines;
    }

    // 11. Configuration Dials
    const configSection = markdown.match(/##\s*(?:⚙️\s*)?Campaign Calibration Dials[^:]*:\s*([\s\S]*?)(?=##|---|$)/i);
    if (configSection) {
        const psM = configSection[1].match(/\*\s*\*\*Playstyle:\*\*\s*([^\n\r]+)/i);
        const harmM = configSection[1].match(/\*\s*\*\*Harm Capacity:\*\*\s*([^\n\r]+)/i);
        const partyM = configSection[1].match(/\*\s*\*\*Party Mode:\*\*\s*([^\n\r]+)/i);
        const emM = configSection[1].match(/\*\s*\*\*CYOA Emojis:\*\*\s*([^\n\r]+)/i);
        const simM = configSection[1].match(/\*\s*\*\*Simulation Depth:\*\*\s*([^\n\r]+)/i);
        const artM = configSection[1].match(/\*\s*\*\*Art Direction:\*\*\s*([^\n\r]+)/i);
        const xpM = configSection[1].match(/\*\s*\*\*XP Pacing:\*\*\s*([^\n\r]+)/i);
        const relM = configSection[1].match(/\*\s*\*\*Relationships:\*\*\s*([^\n\r]+)/i);
        const fateM = configSection[1].match(/\*\s*\*\*Max Harm Fate:\*\*\s*([^\n\r|]+)(?:\s*\|\s*\*\*Status Token:\*\*\s*([^\n\r]+))?/i);

        dossier.config = dossier.config || {};
        if (psM) dossier.config.playstyle = psM[1].trim();
        if (harmM) {
            const hVal = parseInt(harmM[1], 10);
            if (!isNaN(hVal)) dossier.config.harmMax = hVal;
        }
        if (partyM) dossier.config.partyMode = partyM[1].trim();
        if (emM) dossier.config.cyoaEmojis = !/disabled|false|off/i.test(emM[1]);
        if (simM) dossier.config.simulationDepth = simM[1].trim();
        if (artM) dossier.config.artStyle = artM[1].trim();
        if (xpM) {
            const xpVal = parseInt(xpM[1], 10);
            if (!isNaN(xpVal)) dossier.config.pacingXp = xpVal;
        }
        if (relM) dossier.config.relationships = !/disabled|false|off/i.test(relM[1]);
        if (fateM) {
            const rule = fateM[1].trim();
            let statusToken = fateM[2] ? fateM[2].trim() : '(-) Incapacitated';
            if (!statusToken.startsWith('(-)') && !statusToken.startsWith('(+)')) statusToken = `(-) ${statusToken}`;
            dossier.config.maxHarmFate = {
                rule,
                statusToken,
                cyoaStyle: /respawn|graveyard|shrine/i.test(rule) ? 'respawn' : /burnout|exhaust|faint/i.test(rule) ? 'burnout' : 'crisis',
            };
        }

        const tempoM = configSection[1].match(/\*\s*\*\*Action Tempo:\*\*\s*([^\n\r]+)/i);
        if (tempoM) {
            const rawTempo = tempoM[1].trim().toLowerCase().replace(/[\s-]+/g, '_');
            const valid = ['action_serial', 'gritty_default', 'slow_burn', 'slice_of_life'].find(t => rawTempo.includes(t));
            if (valid) {
                dossier.config.actionTempo = valid;
                dossier.config.knobs = dossier.config.knobs || {};
                dossier.config.knobs.action_tempo = valid;
            }
        }
        const fleeGraceM = configSection[1].match(/\*\s*\*\*Flee Grace:\*\*\s*([^\n\r]+)/i);
        if (fleeGraceM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.flee_grace_toggle = /on|enabled|true/i.test(fleeGraceM[1]);
        }
        const shiftM = configSection[1].match(/\*\s*\*\*Base Attrition Shift:\*\*\s*([+-]?\d+)/i);
        if (shiftM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.base_attrition_shift = parseInt(shiftM[1], 10);
        }
        const overflowM = configSection[1].match(/\*\s*\*\*Overflow Default:\*\*\s*([^\n\r]+)/i);
        if (overflowM) {
            dossier.config.knobs = dossier.config.knobs || {};
            dossier.config.knobs.overflow_default = overflowM[1].trim();
        }
        const pacingScenesM = configSection[1].match(/\*\s*\*\*Pacing Scenes:\*\*\s*(\d+)/i);
        if (pacingScenesM) {
            dossier.config.pacingScenes = parseInt(pacingScenesM[1], 10);
        }
    }

    // 12. World Rules & Physical Axioms
    const worldRulesSection = markdown.match(/##\s*(?:🌐\s*)?World Rules[^\n]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (worldRulesSection) {
        const ruleBlocks = worldRulesSection[1].split(/###\s*(?:🌐\s*)?/);
        for (const block of ruleBlocks) {
            const lines = block.trim().split('\n');
            const header = lines[0]?.trim();
            if (!header || header.startsWith('_No')) continue;

            const headerM = header.match(/^([^(]+?)(?:\s*\(([^)]+)\))?$/);
            const title = headerM ? headerM[1].trim() : header;
            const category = headerM && headerM[2] ? headerM[2].trim().toLowerCase() : 'general';

            const axiomM = block.match(/\*\s*\*\*Core Axiom:\*\*\s*([^\n\r]+)/i);
            const archM = block.match(/\*\s*\*\*Architectural Implications:\*\*\s*([^\n\r]+)/i);

            const subM = block.match(/\*\s*\*\*Substitutions:\*\*\s*([\s\S]*?)(?=\*\s*\*\*|$)/i);
            const substitutions = [];
            if (subM) {
                const sLines = subM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                substitutions.push(...sLines);
            }

            const conM = block.match(/\*\s*\*\*Negative Constraints[^\*]*:\*\*\s*([\s\S]*?)(?=\*\s*\*\*|$)/i);
            const negativeConstraints = [];
            if (conM) {
                const cLines = conM[1].split('\n')
                    .map(l => l.replace(/^\s*[\*\-]\s*/, '').trim())
                    .filter(Boolean);
                negativeConstraints.push(...cLines);
            }

            dossier.worldRules = dossier.worldRules || { axioms: [], customModule: null };
            dossier.worldRules.axioms = dossier.worldRules.axioms || [];
            dossier.worldRules.axioms.push({
                id: `rule_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
                category,
                title,
                axiom: axiomM ? axiomM[1].trim() : '',
                substitutions,
                negativeConstraints,
                architecturalNotes: archM ? archM[1].trim() : '',
            });
        }
    }

    // 13. Custom Tracker Module
    const customModSection = markdown.match(/##\s*(?:📊\s*)?Custom Tracker Module[^:]*:\s*([\s\S]*?)(?=\n##[^#]|\n---|Ref:|$)/i);
    if (customModSection) {
        const tagM = customModSection[1].match(/\*\s*\*\*Tag:\*\*\s*\[?([A-Z0-9_]+)\]?/i);
        const labelM = customModSection[1].match(/\*\s*\*\*Label:\*\*\s*([^\n\r]+)/i);
        const iconM = customModSection[1].match(/\*\s*\*\*Icon:\*\*\s*([^\n\r]+)/i);
        const instM = customModSection[1].match(/\*\s*\*\*State Model Instruction:\*\*\s*([^\n\r]+)/i);
        const sampleM = customModSection[1].match(/```(?:text)?\s*([\s\S]*?)```/i);

        if (tagM) {
            const parsedTag = tagM[1].trim().toUpperCase();
            const parsedSample = sampleM ? sampleM[1].trim() : '';
            dossier.worldRules = dossier.worldRules || { axioms: [], customModule: null };
            dossier.worldRules.customModule = {
                tag: parsedTag,
                fieldKey: parsedTag,
                label: labelM ? labelM[1].trim() : parsedTag,
                icon: iconM ? iconM[1].trim() : '📦',
                instruction: instM ? instM[1].trim() : '',
                sampleContent: parsedSample,
                sample: parsedSample,
            };
        }
    }

    const isValid = Boolean(dossier.protagonist.name || !isDefaultUntitledCampaignTitle(dossier.meta?.title) || (dossier.worldRules?.axioms && dossier.worldRules.axioms.length > 0));
    return isValid ? healAndNormalizeDossier(dossier, markdown) : null;
}

/**
 * Parses a [DOSSIER_CRITIQUE] block emitted by the Contemplative Blueprint Judge / Critic.
 *
 * @param {string} rawText
 * @returns {{
 *   verdict: 'PASS'|'REVISE',
 *   score: number,
 *   grade: string,
 *   strengths: string[],
 *   weaknesses: string[],
 *   directives: string[],
 *   shouldRevise: boolean,
 *   rawText: string
 * }}
 */
export function parseDossierCritique(rawText) {
    const defaultCritique = {
        verdict: 'PASS',
        score: 85,
        grade: 'B+',
        strengths: [],
        weaknesses: [],
        directives: [],
        shouldRevise: false,
        rawText: rawText || '',
    };

    if (!rawText || typeof rawText !== 'string') return defaultCritique;

    const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const blockMatch = cleaned.match(/(?:^|\n)[ \t]*\[DOSSIER_CRITIQUE\][ \t]*(?:\r?\n|$)([\s\S]*?)(?:\[\/DOSSIER_CRITIQUE\]|$)/i)
        || cleaned.match(/\[DOSSIER_CRITIQUE\]([\s\S]*?)(?:\[\/DOSSIER_CRITIQUE\]|$)/i);
    const body = blockMatch ? blockMatch[1] : cleaned;
    const kv = parseKeyValueLines(body);

    const rawVerdict = String(kv.verdict || '').toUpperCase().trim();
    let score = parseInt(kv.score, 10);
    if (isNaN(score)) score = 85;
    score = Math.max(0, Math.min(100, score));

    const grade = (kv.grade || (score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D')).trim();
    const strengths = parseBulletOrListItems(body, 'strengths', { splitCommas: false });
    const weaknesses = parseBulletOrListItems(body, 'weaknesses', { splitCommas: false });
    const directives = parseBulletOrListItems(body, 'directives', { splitCommas: false });

    const verdict = (rawVerdict === 'REVISE' || (rawVerdict !== 'PASS' && score < 82 && directives.length > 0))
        ? 'REVISE'
        : 'PASS';

    const shouldRevise = (verdict === 'REVISE' || score < 82) && directives.length > 0;

    return {
        verdict,
        score,
        grade,
        strengths,
        weaknesses,
        directives,
        shouldRevise,
        rawText,
    };
}

/**
 * Determines whether the Smart-Gated Contemplative Judge Pass should run after Builder Pass 1.
 * Triggers on:
 *  - Initial campaign scaffolding (previously untitled/empty dossier that now has a premise/protagonist/entities)
 *  - Turn with uploaded lore/card attachments
 *  - Major structural updates touching 3+ distinct blueprint categories in a single turn
 * Bypasses on NOOP, syntax error fallbacks, or minor 1-2 field tweaks.
 *
 * @param {object} params
 * @param {object} [params.prevDossier] Dossier state before Pass 1
 * @param {object} [params.updatedDossier] Dossier state after Pass 1
 * @param {object} [params.builderReport] Report returned by applyDossierUpdates
 * @param {boolean} [params.hasAttachments] Whether attachments were processed this turn
 * @returns {boolean}
 */
export function shouldRunContemplativeJudgePass({
    prevDossier,
    updatedDossier,
    builderReport,
    hasAttachments = false,
} = {}) {
    if (!builderReport || !builderReport.hasMutations || builderReport.isNoop) {
        return false;
    }

    if (hasAttachments) {
        return true;
    }

    // Check if this turn transitioned the blueprint from blank/untitled to initial scaffold
    const wasBlank = !prevDossier || (
        (!prevDossier.meta?.premise) &&
        (!prevDossier.protagonist?.name) &&
        (!prevDossier.npcs || prevDossier.npcs.length === 0) &&
        (!prevDossier.monsters || prevDossier.monsters.length === 0)
    );
    const hasCoreNow = Boolean(
        updatedDossier?.meta?.premise ||
        updatedDossier?.protagonist?.name ||
        (updatedDossier?.npcs && updatedDossier.npcs.length > 0) ||
        (updatedDossier?.monsters && updatedDossier.monsters.length > 0)
    );
    if (wasBlank && hasCoreNow) {
        return true;
    }

    // Count distinct blueprint categories touched in builderReport.changes
    const changes = builderReport.changes || [];
    const categories = new Set();
    for (const ch of changes) {
        if (/^(?:PbtA Engine|Campaign title|Premise|Campaign tone)/i.test(ch)) categories.add('meta');
        else if (/^Protagonist/i.test(ch)) categories.add('protagonist');
        else if (/NPC/i.test(ch)) categories.add('npcs');
        else if (/Adversary|monsters/i.test(ch)) categories.add('monsters');
        else if (/Location|maps/i.test(ch)) categories.add('maps');
        else if (/Faction/i.test(ch)) categories.add('factions');
        else if (/The Kick/i.test(ch)) categories.add('kick');
        else if (/CYOA choices/i.test(ch)) categories.add('cyoa');
        else if (/World Rule|world rules/i.test(ch)) categories.add('worldRules');
        else if (/Custom Tracker Module/i.test(ch)) categories.add('customModule');
        else if (/dial set to/i.test(ch)) categories.add('config');
    }

    return categories.size >= 3;
}

/**
 * Classifies a builder transaction report into a standardized status code.
 * @param {object} [report]
 * @returns {'MUTATED'|'NOOP'|'SYNTAX_ERROR'|'UNRECOGNIZED_OUTPUT'}
 */
export function classifyBuilderReport(report) {
    if (!report) return 'UNRECOGNIZED_OUTPUT';
    if (report.hasMutations) return 'MUTATED';
    if (report.isNoop) return 'NOOP';
    if (report.errors && report.errors.length > 0) return 'SYNTAX_ERROR';
    return 'UNRECOGNIZED_OUTPUT';
}

/**
 * Builds the explicit directive notice for the Talker based on the builder's final status.
 * @param {'MUTATED'|'NOOP'|'SYNTAX_ERROR'|'UNRECOGNIZED_OUTPUT'} status
 * @param {string} [summaryText]
 * @param {string[]} [errors]
 * @returns {string}
 */
export function buildTalkerInstructionNotice(status, summaryText = '', errors = [], nameRagResolutions = []) {
    const resolvedLines = Array.isArray(nameRagResolutions) && nameRagResolutions.length
        ? `\n[RESOLVED_NAMES_THIS_TURN: ${nameRagResolutions.map(r => `${r.tag || r.placeholder} -> ${r.selectedName}`).join(', ')}]`
        : '';
    if (status === 'MUTATED' || status === 'NOOP') {
        return `[BUILDER_REPORT: ${summaryText}]${resolvedLines}`;
    }
    if (status === 'SYNTAX_ERROR') {
        const errStr = errors && errors.length ? ` (${errors.join('; ')})` : '';
        return `[BUILDER_ERROR: Attempted update failed validation${errStr}; blueprint unchanged. Please let the player know gently that there was a formatting hiccup and ask what they would like to adjust.]`;
    }
    return `[BUILDER_NOTICE: The Builder output did not include an [UPDATE_DOSSIER] block. No changes were made to the blueprint. Do NOT claim an edit was made. Discuss ideas conversationally with the player.]`;
}

/**
 * Format a builder transaction as a rich Markdown diagnostic trace for Antigravity or bug reporting.
 * @param {object} [tx]
 * @returns {string}
 */
export function formatDiagnosticTrace(tx) {
    if (!tx) return 'No diagnostic trace recorded.';
    const attempts = tx.attempts || [];
    const contempSection = tx.contemplation && (tx.contemplation.coreTension || tx.contemplation.worldConsequences || tx.contemplation.webOfEntanglement || tx.contemplation.kickPressure)
        ? [
            '',
            '#### 🧠 Architectural Contemplation (Pass 1 Scratchpad):',
            `- **Core Tension:** ${tx.contemplation.coreTension || '(none)'}`,
            `- **World Consequences:** ${tx.contemplation.worldConsequences || '(none)'}`,
            `- **Web of Entanglement:** ${tx.contemplation.webOfEntanglement || '(none)'}`,
            `- **Kick Pressure:** ${tx.contemplation.kickPressure || '(none)'}`,
        ]
        : [];

    const critiqueSection = tx.critique
        ? [
            '',
            '#### ⚖️ Blueprint Judge / Critic Pass:',
            `- **Verdict:** ${tx.critique.verdict} (Score: ${tx.critique.score}/100 · Grade: ${tx.critique.grade})`,
            `- **Triggered Second Pass:** ${Boolean(tx.critique.shouldRevise)}`,
            ...(tx.critique.strengths?.length ? [`- **Strengths:** ${tx.critique.strengths.join(' | ')}`] : []),
            ...(tx.critique.weaknesses?.length ? [`- **Weaknesses:** ${tx.critique.weaknesses.join(' | ')}`] : []),
            ...(tx.critique.directives?.length ? [`- **Directives:** ${tx.critique.directives.join(' | ')}`] : []),
        ]
        : [];

    const refinerSection = tx.refinerPass
        ? [
            '',
            '#### 🔨 Second-Pass Refiner:',
            `- **Summary:** ${tx.refinerPass.builderSummary || '(none)'}`,
            `- **Refinements Applied:** ${(tx.refinerPass.changes && tx.refinerPass.changes.length) ? tx.refinerPass.changes.join('; ') : 'None'}`,
        ]
        : [];

    const md = [
        '### 🎩 MultiHog Concierge Builder Diagnostic Trace',
        `- **Timestamp:** ${tx.timestamp || new Date().toISOString()}`,
        `- **Final Status:** ${tx.finalStatus || 'UNKNOWN'}`,
        `- **System Engine:** ${tx.systemEngine || 'fantasy'}`,
        `- **User Prompt:** ${tx.userPrompt || tx.userMessage || '(none)'}`,
        `- **Extracted Summary:** ${tx.builderSummary || '(none)'}`,
        ...contempSection,
        ...critiqueSection,
        ...refinerSection,
        '',
        '#### Execution Attempts:',
        ...attempts.map((a, i) => {
            const errs = a.report?.errors?.length ? a.report.errors.join('; ') : (a.errors?.length ? a.errors.join('; ') : 'None');
            const changes = a.report?.changes?.length ? a.report.changes.join('; ') : 'None';
            const raw = a.rawResponse || '(empty)';
            return [
                `* **Attempt ${a.attempt || a.attemptNumber || i + 1}:**`,
                `  - **Status:** Mutations: ${Boolean(a.report?.hasMutations || a.hasMutations)}, Noop: ${Boolean(a.report?.isNoop || a.isNoop)}`,
                `  - **Errors:** ${errs}`,
                `  - **Mutations:** ${changes}`,
                `  - **Raw Output:**`,
                '```text',
                raw,
                '```',
            ].join('\n');
        }),
        '',
        '#### 📇 Name Diversity Engine (NameRAG) Resolutions:',
        ...(() => {
            const res = tx.nameRagResolutions || [];
            if (!res.length) return ['*(No name placeholders resolved in this transaction)*'];
            return res.map((r, i) => [
                `* **[${i + 1}] ${r.placeholder}** (${r.tag}, ${r.blockType})`,
                `  - **Source:** ${r.source || 'NameRAG'}`,
                `  - **Search Query:** "${r.query || ''}"`,
                `  - **Pool Candidates:** ${(r.candidates && r.candidates.length) ? r.candidates.join(', ') : '(none)'}`,
                `  - **Selected Name:** **${r.selectedName}**`,
            ].join('\n'));
        })(),
        '',
        '#### Last Builder Request (Input Messages):',
        '```json',
        JSON.stringify(tx.builderRequest?.messages || [], null, 2),
        '```',
        '',
        '#### Current Blueprint Snapshot (activeDossier):',
        '```json',
        JSON.stringify(tx.activeDossierSnapshot || tx.currentDossierSnapshot || {}, null, 2),
        '```',
    ].join('\n');
    return md;
}

/**
 * Renders HTML for a single world axiom deck card.
 * @param {object} ax
 * @returns {string}
 */
export function buildAxiomCardHtml(ax) {
    const cat = (ax.category || 'physics').toLowerCase();
    let catColor = 'rgba(156, 163, 175, 0.4)';
    if (cat.includes('bio')) catColor = 'rgba(16, 185, 129, 0.4)';
    else if (cat.includes('magic')) catColor = 'rgba(168, 85, 247, 0.4)';
    else if (cat.includes('physic')) catColor = 'rgba(56, 189, 248, 0.4)';
    else if (cat.includes('social')) catColor = 'rgba(245, 158, 11, 0.4)';

    const subsHtml = ax.substitutions?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>Substitutions:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.substitutions.map(s => `<li>🔄 ${escapeHtml(s)}</li>`).join('')}</ul></div>`
        : '';
    const negHtml = ax.negativeConstraints?.length
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.9;"><b>Banned & Absences:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.negativeConstraints.map(nc => `<li>🚫 <span class="mhc-constraint-banned">${escapeHtml(nc)}</span></li>`).join('')}</ul></div>`
        : '';
    const archHtml = ax.architecturalNotes
        ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;">🏛️ <b>Infrastructure:</b> ${escapeHtml(ax.architecturalNotes)}</div>`
        : '';

    return `
        <div class="mhc-deck-item collapsible">
            <div class="mhc-deck-item-header">
                <div class="mhc-deck-item-title" style="color: #10b981;">
                    🌐 ${escapeHtml(ax.title || 'World Law')} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${catColor};">${escapeHtml(ax.category || 'physics').toUpperCase()}</span>
                </div>
                <span class="mhc-deck-item-toggle">▼</span>
            </div>
            <div class="mhc-deck-item-detail">
                <div style="font-size: 0.85em; opacity: 0.95; margin-bottom: 4px;"><b>Axiom:</b> ${escapeHtml(ax.axiom || '')}</div>
                ${subsHtml}
                ${negHtml}
                ${archHtml}
            </div>
        </div>
    `;
}
