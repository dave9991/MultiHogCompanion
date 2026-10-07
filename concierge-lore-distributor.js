/**
 * concierge-lore-distributor.js — MultiHog Companion
 *
 * Formats and distributes Session Zero Campaign Dossier entities across
 * MultiHog's native modular campaign lorebooks:
 * - {prefix}_NPCs      (NPCs & Monsters)
 * - {prefix}_Factions  (Factions & Organizations)
 * - {prefix}_Locations (Dungeons, Settlements, & Sites)
 * - {prefix}_Quests    (Starting Crisis / Emergent Quests)
 *
 * This replaces the legacy monolithic `constant: true` dossier injection,
 * allowing MultiHog's Lorebook Agent (Keyring Attention Model) to dynamically
 * activate and rotate context on demand without burning 1,500+ tokens per turn.
 */

import {
    buildNpcEntryContent,
    buildMonsterEntryContent,
    buildNpcKeys,
} from './concierge-npc-format.js';

/**
 * Extracts clean, deduplicated search keywords from a title or entity name.
 * @param {string} text
 * @returns {string[]}
 */
export function extractCleanKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    const clean = text.replace(/\[.*?\]/g, '').replace(/[^\w\s'-]/g, ' ').trim();
    if (!clean) return [];

    const keys = new Set();
    keys.add(clean);

    // Add significant multi-word segments if compound
    const words = clean.split(/\s+/).filter(w => w.length > 3);
    for (const w of words) {
        keys.add(w);
    }

    return Array.from(keys).slice(0, 6);
}

/**
 * Formats a faction entry for the campaign's Factions lorebook ({prefix}_Factions).
 * @param {object} faction
 * @returns {{ name: string, comment: string, keys: string[], core: string, full: string }}
 */
export function buildFactionEntry(faction) {
    const cleanName = (faction?.name || '').trim();
    const standing = faction?.standing || 'Neutral';
    const agenda = faction?.agenda || 'Unstated';
    const notes = faction?.notes ? `Notes: ${faction.notes}` : null;

    const core = [
        `[CORE]`,
        `Name: ${cleanName}`,
        `Type: Faction / Organization`,
        `Standing: ${standing}`,
        `Agenda: ${agenda}`,
        ...(notes ? [notes] : []),
        `[/CORE]`,
    ].join('\n');

    const keys = Array.from(new Set([
        cleanName,
        ...extractCleanKeywords(cleanName),
        'faction',
        'organization',
    ])).slice(0, 6);

    return {
        name: cleanName,
        comment: cleanName,
        keys,
        core,
        full: core,
    };
}

/**
 * Formats a location entry for the campaign's Locations lorebook ({prefix}_Locations).
 * @param {object} mapOrLocation
 * @returns {{ name: string, comment: string, keys: string[], core: string, full: string }}
 */
export function buildLocationEntry(mapOrLocation) {
    const site = (mapOrLocation?.site || mapOrLocation?.name || 'Uncharted Site').trim();
    const kind = mapOrLocation?.kind || 'INTERIOR';
    const threat = mapOrLocation?.threat || 'MODERATE';
    const desc = (mapOrLocation?.briefDescription || mapOrLocation?.prompt || mapOrLocation?.description || 'A notable site in the region.').trim();
    const entrance = mapOrLocation?.entrance ? `Entrance: ${mapOrLocation.entrance.trim()}` : null;

    const core = [
        `[CORE]`,
        desc,
        `Kind: ${kind}`,
        `Threat: ${threat}`,
        ...(entrance ? [entrance] : []),
        `[/CORE]`,
    ].join('\n');

    const keys = Array.from(new Set([
        site,
        ...extractCleanKeywords(site),
        'location',
        'site',
    ])).slice(0, 6);

    return {
        name: site,
        comment: site,
        keys,
        core,
        full: core,
    };
}

/**
 * Formats the starting crisis into an emergent quest for {prefix}_Quests.
 * @param {object} theKick
 * @param {object} [meta]
 * @returns {{ name: string, comment: string, keys: string[], core: string, full: string }|null}
 */
export function buildStartingQuestEntry(theKick, meta = {}) {
    const crisis = (theKick?.crisis || theKick?.openingPrompt || '').trim();
    if (!crisis) return null;

    const title = (meta?.title || 'Starting Incident').trim();
    const label = `Starting Crisis: ${title}`;

    const core = [
        `[CORE]`,
        `ID: starting_crisis`,
        `TYPE: emergent`,
        `STATUS: ACTIVE`,
        `GIVER: Circumstance @ {{user}}`,
        `PREMISE: ${crisis}`,
        `[/CORE]`,
    ].join('\n');

    const keys = Array.from(new Set([
        'crisis',
        'starting crisis',
        'incident',
        'objective',
        ...extractCleanKeywords(title),
    ])).slice(0, 6);

    return {
        name: label,
        comment: label,
        keys,
        core,
        full: core,
    };
}

/**
 * Builds the World Info entry object for the full Campaign Dossier artifact.
 * Configured with `constant: false` so it no longer hogs context on every turn.
 *
 * @param {string} dossierMarkdown
 * @param {number|string} [targetUid]
 * @returns {object}
 */
export function buildDossierWorldInfoEntry(dossierMarkdown, targetUid = null) {
    const uidNum = parseInt(targetUid, 10) || Date.now();
    return {
        uid: uidNum,
        key: ['campaign', 'dossier', 'setting overview', 'blueprint', 'campaign dossier'],
        keysecondary: [],
        comment: 'PbtA Concierge: Campaign Dossier Artifact',
        content: dossierMarkdown,
        constant: false, // Lean context: only pulled when relevant or queried
        selective: false,
        order: 100,
        position: 1, // High priority when active
        disable: false,
    };
}

/**
 * Prepares all entity packages across the 4 native campaign lorebook categories.
 *
 * @param {object} dossier
 * @param {object} [sectionNames]
 * @returns {{
 *   npcs: Array<{ name: string, core: string, full: string, keys: string[] }>,
 *   factions: Array<{ name: string, core: string, full: string, keys: string[] }>,
 *   locations: Array<{ name: string, core: string, full: string, keys: string[] }>,
 *   quests: Array<{ name: string, core: string, full: string, keys: string[] }>,
 * }}
 */
export function prepareCampaignLorebookDistributions(dossier, sectionNames = null) {
    if (!dossier || typeof dossier !== 'object') {
        return { npcs: [], factions: [], locations: [], quests: [] };
    }

    const npcs = (dossier.npcs || []).map(n => ({
        name: n.name,
        keys: buildNpcKeys(n.name),
        ...buildNpcEntryContent(n, sectionNames),
    })).filter(e => e.name && e.core);

    const monsters = (dossier.monsters || []).map(m => ({
        name: m.name,
        keys: buildNpcKeys(m.name),
        ...buildMonsterEntryContent(m, sectionNames),
    })).filter(e => e.name && e.core);

    const factions = (dossier.factions || [])
        .map(buildFactionEntry)
        .filter(f => f.name && f.core);

    // Locations from maps array and starting location
    const locationEntries = [];
    const seenLocations = new Set();

    if (Array.isArray(dossier.maps)) {
        for (const m of dossier.maps) {
            const entry = buildLocationEntry(m);
            if (entry.name && !seenLocations.has(entry.name.toLowerCase())) {
                seenLocations.add(entry.name.toLowerCase());
                locationEntries.push(entry);
            }
        }
    }

    if (dossier.theKick?.startingLocation) {
        const startLocName = dossier.theKick.startingLocation.trim();
        if (startLocName && !seenLocations.has(startLocName.toLowerCase())) {
            seenLocations.add(startLocName.toLowerCase());
            locationEntries.push(buildLocationEntry({
                site: startLocName,
                kind: 'INTERIOR',
                threat: 'LOW',
                briefDescription: `Starting location for ${dossier.meta?.title || 'the adventure'}.`,
            }));
        }
    }

    const questEntries = [];
    const startingQuest = buildStartingQuestEntry(dossier.theKick, dossier.meta);
    if (startingQuest) {
        questEntries.push(startingQuest);
    }

    return {
        npcs: [...npcs, ...monsters],
        factions,
        locations: locationEntries,
        quests: questEntries,
    };
}

/**
 * Generates World Skeleton markdown conforming to MultiHog's authoritative contract:
 * ## FACTIONS
 * ### <Name>
 * <1-2 sentences on nature and tension>
 *
 * ## LOCATIONS
 * ### <Name>
 * <1-2 sentences on description and state>
 *
 * ## CONFLICTS
 * ### <Name>
 * <1-2 sentences on parties involved and stakes>
 *
 * @param {object} dossier
 * @returns {string}
 */
export function buildWorldSkeletonMarkdown(dossier) {
    if (!dossier || typeof dossier !== 'object') return '';
    const sections = [];

    // 1. Factions
    const factions = dossier.factions || [];
    if (factions.length > 0) {
        const facLines = ['## FACTIONS'];
        for (const f of factions) {
            const cleanName = (f.name || '').trim();
            if (!cleanName) continue;
            const standing = f.standing || 'Neutral';
            const agenda = f.agenda || 'pursues unstated regional influence';
            const notes = f.notes ? ` ${f.notes}.` : '';
            facLines.push(`### ${cleanName}\nA ${standing.toLowerCase()} faction that ${agenda}.${notes}`);
        }
        if (facLines.length > 1) sections.push(facLines.join('\n'));
    }

    // 2. Locations
    const locEntries = [];
    const seenLocs = new Set();
    if (Array.isArray(dossier.maps)) {
        for (const m of dossier.maps) {
            const site = (m.site || m.name || '').trim();
            if (site && !seenLocs.has(site.toLowerCase())) {
                seenLocs.add(site.toLowerCase());
                const desc = (m.briefDescription || m.prompt || 'A notable regional territory.').trim();
                locEntries.push(`### ${site}\n${desc}`);
            }
        }
    }
    if (dossier.theKick?.startingLocation) {
        const startLoc = dossier.theKick.startingLocation.trim();
        if (startLoc && !seenLocs.has(startLoc.toLowerCase())) {
            seenLocs.add(startLoc.toLowerCase());
            locEntries.push(`### ${startLoc}\nThe primary staging grounds for the impending journey.`);
        }
    }
    if (locEntries.length > 0) {
        sections.push(['## LOCATIONS', ...locEntries].join('\n'));
    }

    // 3. Conflicts
    const conflictEntries = [];
    if (dossier.theKick?.crisis) {
        const title = (dossier.meta?.title || 'Starting Crisis').trim();
        conflictEntries.push(`### The ${title} Crisis\n${dossier.theKick.crisis.trim()}`);
    }
    const monsters = dossier.monsters || [];
    for (const m of monsters) {
        const mName = (m.name || '').trim();
        if (!mName) continue;
        const weakness = m.weakness ? ` Vulnerable to ${m.weakness}.` : '';
        const doom = Array.isArray(m.impendingDoom) && m.impendingDoom.length
            ? ` Looming progression: ${m.impendingDoom.join(' → ')}.`
            : '';
        conflictEntries.push(`### Threat of ${mName}\nPredatory pressure from ${mName}.${weakness}${doom}`);
    }
    if (conflictEntries.length > 0) {
        sections.push(['## CONFLICTS', ...conflictEntries].join('\n'));
    }

    return sections.join('\n\n');
}

/**
 * Builds array of MultiHog {prefix}_Skeleton entry objects directly from a dossier.
 * Adheres to MultiHog's Day 0 Baseline contract:
 * - disable: true
 * - key: []
 * - comment: "FACTION: ...", "LOCATION: ...", "CONFLICT: ..."
 * - content: "[Day 0 Baseline]\n..."
 * - extensions: { rpgCategory: "FAC"|"LOC"|"EVENT", rpgSkeleton: true }
 *
 * @param {object} dossier
 * @returns {Array<object>}
 */
export function buildWorldSkeletonEntries(dossier) {
    if (!dossier || typeof dossier !== 'object') return [];
    const entries = [];

    // Factions -> FAC
    const factions = dossier.factions || [];
    for (const f of factions) {
        const cleanName = (f.name || '').trim();
        if (!cleanName) continue;
        const standing = f.standing || 'Neutral';
        const agenda = f.agenda || 'Pursues regional interests';
        const notes = f.notes ? ` ${f.notes}.` : '';
        const text = `A ${standing.toLowerCase()} faction that ${agenda}.${notes}`;

        entries.push({
            comment: `FACTION: ${cleanName}`,
            content: `[Day 0 Baseline]\n${text}`,
            key: [],
            keysecondary: [],
            constant: false,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0,
            disable: true,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            extensions: { rpgCategory: 'FAC', rpgSkeleton: true },
        });
    }

    // Locations -> LOC
    const seenLocs = new Set();
    const mapList = Array.isArray(dossier.maps) ? dossier.maps : [];
    for (const m of mapList) {
        const site = (m.site || m.name || '').trim();
        if (!site || seenLocs.has(site.toLowerCase())) continue;
        seenLocs.add(site.toLowerCase());
        const desc = (m.briefDescription || m.prompt || 'A notable regional territory.').trim();

        entries.push({
            comment: `LOCATION: ${site}`,
            content: `[Day 0 Baseline]\n${desc}`,
            key: [],
            keysecondary: [],
            constant: false,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0,
            disable: true,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            extensions: { rpgCategory: 'LOC', rpgSkeleton: true },
        });
    }
    if (dossier.theKick?.startingLocation) {
        const startLoc = dossier.theKick.startingLocation.trim();
        if (startLoc && !seenLocs.has(startLoc.toLowerCase())) {
            seenLocs.add(startLoc.toLowerCase());
            entries.push({
                comment: `LOCATION: ${startLoc}`,
                content: `[Day 0 Baseline]\nThe primary staging grounds for the impending journey.`,
                key: [],
                keysecondary: [],
                constant: false,
                selective: false,
                selectiveLogic: 0,
                addMemo: true,
                order: 100,
                position: 0,
                disable: true,
                probability: 100,
                useProbability: false,
                depth: 4,
                group: '',
                groupOverride: false,
                groupWeight: 100,
                extensions: { rpgCategory: 'LOC', rpgSkeleton: true },
            });
        }
    }

    // Conflicts -> EVENT
    if (dossier.theKick?.crisis) {
        const title = (dossier.meta?.title || 'Campaign').trim();
        entries.push({
            comment: `CONFLICT: ${title} Crisis`,
            content: `[Day 0 Baseline]\n${dossier.theKick.crisis.trim()}`,
            key: [],
            keysecondary: [],
            constant: false,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0,
            disable: true,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            extensions: { rpgCategory: 'EVENT', rpgSkeleton: true },
        });
    }

    const monsters = dossier.monsters || [];
    for (const m of monsters) {
        const mName = (m.name || '').trim();
        if (!mName) continue;
        const weakness = m.weakness ? ` Vulnerable to ${m.weakness}.` : '';
        const doom = Array.isArray(m.impendingDoom) && m.impendingDoom.length
            ? ` Looming progression: ${m.impendingDoom.join(' → ')}.`
            : '';
        const desc = `Active threat posed by ${mName}.${weakness}${doom}`.trim();

        entries.push({
            comment: `CONFLICT: Threat of ${mName}`,
            content: `[Day 0 Baseline]\n${desc}`,
            key: [],
            keysecondary: [],
            constant: false,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0,
            disable: true,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            extensions: { rpgCategory: 'EVENT', rpgSkeleton: true },
        });
    }

    return entries;
}
