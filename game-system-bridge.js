/**
 * game-system-bridge.js — MultiHog Companion
 *
 * Bridges the Concierge Session Zero agent with MultiHog's native Game System Wizard.
 * Allows the Concierge to act as a client for custom game systems and HUD trackers,
 * renders live previews on the Blueprint Deck, provides an "Edit in Wizard" UI bridge,
 * and ensures complete registration across MultiHog's settings and lorebooks at campaign launch.
 */

/**
 * Extracts a self-closing XML tag attribute map (e.g. <meta name="Foo" icon="🧭"/>).
 * @param {string} raw
 * @param {string} tagName
 * @returns {Record<string, string>|null}
 */
export function extractSelfClosingTag(raw, tagName) {
    if (!raw || typeof raw !== 'string') return null;
    const regex = new RegExp(`<${tagName}\\b([^>]*?)\\/?>`, 'i');
    const match = raw.match(regex);
    if (!match) return null;
    const attrString = match[1];
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_\-]+)=(?:["']([^"']*)["']|(\S+))/g;
    let m;
    while ((m = attrRegex.exec(attrString)) !== null) {
        attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
    return attrs;
}

/**
 * Extracts an explicit open/close XML block (e.g. <gm_section tag="foo">...</gm_section>).
 * @param {string} raw
 * @param {string} tagName
 * @returns {{ attrs: Record<string, string>, content: string }|null}
 */
export function extractTagBlock(raw, tagName) {
    if (!raw || typeof raw !== 'string') return null;
    const regex = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = raw.match(regex);
    if (!match) return null;
    const attrString = match[1];
    const content = (match[2] || '').trim();
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_\-]+)=(?:["']([^"']*)["']|(\S+))/g;
    let m;
    while ((m = attrRegex.exec(attrString)) !== null) {
        attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
    }
    return { attrs, content };
}

/**
 * Extracts the literal [TAG] ... [/TAG] sample template from tracker module content.
 * @param {string} content
 * @param {string} tag
 * @returns {string}
 */
export function extractGameSystemTemplate(content, tag) {
    if (!content || typeof content !== 'string') return '';
    const cleanTag = (tag || '').trim().toUpperCase();
    if (cleanTag) {
        const regex = new RegExp(`\\[${cleanTag}\\][\\s\\S]*?\\[\\/${cleanTag}\\]`, 'i');
        const match = content.match(regex);
        if (match) return match[0].trim();
    }
    const codeBlockMatch = content.match(/```(?:text)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    return '';
}

/**
 * Normalizes drivers from raw meta, string, array, or custom module fields into an array of driver strings.
 * Canonical driver identifiers: 'gm_annotation', 'gm_deltas', 'auto_tick', 'clock', 'time', 'stated_fact'.
 *
 * @param {string|Array<string>|object} input
 * @returns {Array<string>}
 */
export function normalizeGameSystemDrivers(input) {
    if (!input) return ['gm_annotation'];
    if (typeof input === 'object' && input.drivers) {
        return normalizeGameSystemDrivers(input.drivers);
    }
    if (Array.isArray(input)) {
        const cleaned = input
            .map(s => String(s).trim().toLowerCase())
            .filter(p => ['gm_annotation', 'gm_deltas', 'auto_tick', 'clock', 'time', 'stated_fact'].includes(p));
        return cleaned.length ? cleaned : ['gm_annotation'];
    }
    if (typeof input === 'string') {
        const parts = input.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const valid = parts.filter(p => ['gm_annotation', 'gm_deltas', 'auto_tick', 'clock', 'time', 'stated_fact'].includes(p));
        return valid.length ? valid : ['gm_annotation'];
    }
    if (typeof input === 'object') {
        const list = [];
        if (input.time || input.driverTime || input.driver_time) list.push('time');
        if (input.gmAnnotation || input.driverGmAnnotation || input.driver_gm_annotation) list.push('gm_annotation');
        if (input.statedFact || input.driverStatedFact || input.driver_stated_fact) list.push('stated_fact');
        return list.length ? list : ['gm_annotation'];
    }
    return ['gm_annotation'];
}

/**
 * Converts drivers array or string into upstream MultiHog wizard boolean driver flags.
 *
 * @param {string|Array<string>|object} drivers
 * @returns {{ driverTime: boolean, driverGmAnnotation: boolean, driverStatedFact: boolean }}
 */
export function toWizardDriverFlags(drivers) {
    const list = normalizeGameSystemDrivers(drivers);
    const dStr = list.join(' ').toLowerCase();
    return {
        driverTime: dStr.includes('time') || dStr.includes('auto') || dStr.includes('clock'),
        driverGmAnnotation: dStr.includes('annotation') || dStr.includes('delta') || dStr.includes('gm'),
        driverStatedFact: dStr.includes('stated') || dStr.includes('fact'),
    };
}

/**
 * Parses upstream Game System Wizard XML output into a normalized Game System object.
 * Compatible with MultiHog's native parseWizardResponse format.
 *
 * @param {string} rawText
 * @returns {object}
 */
export function parseGameSystemXml(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('Invalid or empty Game System XML string');
    }

    const gsBlock = extractTagBlock(rawText, 'game_system');
    const metaAttrs = extractSelfClosingTag(rawText, 'meta') || gsBlock?.attrs || {};
    const gmBlock = extractTagBlock(rawText, 'gm_section') || extractTagBlock(rawText, 'gm_instruction');
    const trackerBlock = extractTagBlock(rawText, 'tracker_module') || extractTagBlock(rawText, 'tracker_template') || extractTagBlock(rawText, 'sample_content');

    if (!gmBlock && !trackerBlock && !gsBlock) {
        throw new Error('AI output did not contain a valid <gm_section> or <tracker_module> block');
    }

    const name = metaAttrs.label || metaAttrs.name || trackerBlock?.attrs?.label || trackerBlock?.attrs?.tag || gmBlock?.attrs?.tag || 'Custom System';
    const icon = metaAttrs.icon || trackerBlock?.attrs?.icon || '📟';
    const trackerTag = (trackerBlock?.attrs?.tag || metaAttrs.tag || name)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toUpperCase();
    const gmTag = (gmBlock?.attrs?.tag || name)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();

    const driversAttr = metaAttrs.drivers || metaAttrs;
    const drivers = normalizeGameSystemDrivers(driversAttr);
    const flags = toWizardDriverFlags(drivers);
    const effectOwner = metaAttrs.effect_owner === 'gm' ? 'gm' : (metaAttrs.effectOwner || 'world');
    const trackerContent = trackerBlock?.content || '';
    const gmContent = gmBlock?.content || '';
    const sampleBlock = extractTagBlock(rawText, 'sample_content');
    const sampleContent = sampleBlock?.content || trackerContent;
    const template = extractGameSystemTemplate(sampleContent || trackerContent, trackerTag);

    return {
        name,
        label: metaAttrs.label || trackerBlock?.attrs?.label || name,
        tag: trackerTag,
        fieldKey: trackerTag,
        icon,
        needsTracker: metaAttrs.needs_tracker !== 'false' && Boolean(trackerBlock || template),
        driverTime: flags.driverTime,
        driverGmAnnotation: flags.driverGmAnnotation,
        driverStatedFact: flags.driverStatedFact,
        drivers,
        effectOwner,
        gmTag,
        gmContent: gmContent.trim(),
        gmInstruction: gmContent.trim(),
        instruction: (gmContent || trackerContent).trim(),
        trackerTag,
        trackerLabel: trackerBlock?.attrs?.label || name,
        trackerIcon: icon,
        trackerContent: trackerContent.trim(),
        sampleContent: (sampleContent || template).trim(),
        sample: (sampleContent || template).trim(),
        template: template.trim(),
    };
}

/**
 * Serializes a Game System object into a clean Session Zero blueprint [CUSTOM_MODULE] block.
 * @param {object} gs
 * @returns {string}
 */
export function serializeGameSystemToBlueprintBlock(gs) {
    if (!gs || typeof gs !== 'object') return '';
    const tag = (gs.tag || gs.trackerTag || gs.fieldKey || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const label = gs.label || gs.name || tag;
    const icon = gs.icon || gs.trackerIcon || '📟';

    const driversList = normalizeGameSystemDrivers(gs.drivers || {
        driverTime: gs.driverTime,
        driverGmAnnotation: gs.driverGmAnnotation,
        driverStatedFact: gs.driverStatedFact,
    });
    const driversStr = driversList.join(', ');

    const instruction = (gs.gmContent || gs.gmInstruction || gs.instruction || '').trim();
    const sample = (gs.sampleContent || gs.sample || '').trim();

    const lines = [
        '[CUSTOM_MODULE]',
        `tag: ${tag}`,
        `label: ${label}`,
        `icon: ${icon}`,
        `drivers: ${driversStr}`,
    ];
    if (gs.effectOwner) {
        lines.push(`effect_owner: ${gs.effectOwner}`);
    }
    if (instruction) {
        lines.push(`instruction: ${instruction}`);
    }
    if (sample) {
        lines.push('sample:');
        lines.push(sample);
    }
    lines.push('[/CUSTOM_MODULE]');
    return lines.join('\n');
}

/**
 * Opens MultiHog's native Game System Wizard modal with the active Blueprint system pre-loaded.
 * @param {object} customModule Active custom module from dossier.worldRules.customModule
 * @param {object} options
 * @param {function} [options.onSave] Callback invoked with the updated Game System when saved
 * @returns {Promise<object|null>}
 */
export async function openBlueprintGameSystemInWizard(customModule, { onSave = null } = {}) {
    try {
        const gsMod = await import('../SillyTavern-MultihogDnDFramework/game-systems.js');
        if (typeof gsMod?.openGameSystemWizard !== 'function') {
            globalThis.toastr?.warning?.('MultiHog Game System Wizard is not available in current environment.');
            return null;
        }

        const effectiveCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const settings = effectiveCtx?.extensionSettings?.rpg_tracker || globalThis.extension_settings?.rpg_tracker;
        if (!settings) {
            globalThis.toastr?.warning?.('MultiHog RPG Tracker settings not found.');
            return null;
        }

        settings.customSyspromptLibrary = settings.customSyspromptLibrary || [];
        settings.customFields = settings.customFields || [];
        settings.gameSystems = settings.gameSystems || [];

        let existingSystem = null;
        if (customModule && (customModule.tag || customModule.fieldKey || customModule.label)) {
            const tag = (customModule.tag || customModule.fieldKey || 'CUSTOM').toUpperCase();
            const gmTag = (customModule.gmTag || tag).toLowerCase();
            const label = customModule.label || customModule.name || tag;
            const icon = customModule.icon || '📟';

            // Ensure linked syspromptLibrary entry exists in settings
            let libEntry = settings.customSyspromptLibrary.find(p => p.tag === gmTag || p.id === customModule.syspromptLibraryId);
            if (!libEntry && customModule.gmContent) {
                libEntry = {
                    id: customModule.syspromptLibraryId || `mhc_lib_${Date.now()}`,
                    tag: gmTag,
                    content: customModule.gmContent,
                    enabled: true,
                    icon: 'fa-hat-wizard',
                    description: `Game System: ${label}`,
                    origin: 'wizard',
                };
                settings.customSyspromptLibrary.push(libEntry);
            }

            // Ensure linked customField exists in settings
            let fieldEntry = settings.customFields.find(f => f.tag.toUpperCase() === tag);
            if (!fieldEntry) {
                fieldEntry = {
                    tag,
                    label,
                    icon,
                    prompt: customModule.trackerContent || customModule.instruction || '',
                    template: customModule.sampleContent || customModule.sample || '',
                    enabled: true,
                    origin: 'wizard',
                };
                settings.customFields.push(fieldEntry);
            }

            // Build or match gameSystems record
            existingSystem = settings.gameSystems.find(g => g.customFieldTag?.toUpperCase() === tag || g.name === label);
            if (!existingSystem) {
                const flags = toWizardDriverFlags(customModule.drivers || customModule);
                existingSystem = {
                    id: `mhc_gs_${Date.now()}`,
                    name: label,
                    icon,
                    needsTracker: true,
                    driverTime: flags.driverTime,
                    driverGmAnnotation: flags.driverGmAnnotation,
                    driverStatedFact: flags.driverStatedFact,
                    effectOwner: customModule.effectOwner || 'tracker',
                    syspromptLibraryId: libEntry?.id || null,
                    customFieldTag: tag,
                    description: customModule.description || label,
                };
                settings.gameSystems.push(existingSystem);
            }
        }

        // Open native modal
        await gsMod.openGameSystemWizard(existingSystem);

        // Read back updated records from settings
        const updatedTag = (existingSystem?.customFieldTag || customModule?.tag || customModule?.fieldKey || '').toUpperCase();
        const updatedField = settings.customFields.find(f => f.tag?.toUpperCase() === updatedTag);
        const updatedLib = settings.customSyspromptLibrary.find(p => p.id === existingSystem?.syspromptLibraryId);
        const updatedGs = settings.gameSystems.find(g => g.id === existingSystem?.id || g.customFieldTag?.toUpperCase() === updatedTag);

        if (updatedField || updatedGs || updatedLib) {
            const updatedCustomModule = {
                name: updatedGs?.name || updatedField?.label || customModule?.label || updatedTag,
                label: updatedField?.label || updatedGs?.name || customModule?.label || updatedTag,
                tag: updatedTag,
                fieldKey: updatedTag,
                icon: updatedGs?.icon || updatedField?.icon || customModule?.icon || '📟',
                needsTracker: updatedGs ? updatedGs.needsTracker !== false : true,
                driverTime: Boolean(updatedGs?.driverTime),
                driverGmAnnotation: Boolean(updatedGs?.driverGmAnnotation ?? true),
                driverStatedFact: Boolean(updatedGs?.driverStatedFact),
                drivers: {
                    time: Boolean(updatedGs?.driverTime),
                    gmAnnotation: Boolean(updatedGs?.driverGmAnnotation ?? true),
                    statedFact: Boolean(updatedGs?.driverStatedFact),
                },
                effectOwner: updatedGs?.effectOwner || 'tracker',
                gmTag: updatedLib?.tag || (customModule?.gmTag || updatedTag).toLowerCase(),
                gmContent: updatedLib?.content || customModule?.gmContent || '',
                instruction: updatedLib?.content || updatedField?.prompt || customModule?.instruction || '',
                trackerTag: updatedTag,
                trackerLabel: updatedField?.label || updatedGs?.name || updatedTag,
                trackerIcon: updatedField?.icon || updatedGs?.icon || '📟',
                trackerContent: updatedField?.prompt || '',
                sampleContent: updatedField?.template || customModule?.sampleContent || '',
                sample: updatedField?.template || customModule?.sampleContent || '',
                syspromptLibraryId: updatedLib?.id || existingSystem?.syspromptLibraryId || null,
            };

            if (typeof onSave === 'function') {
                onSave(updatedCustomModule);
            }
            return updatedCustomModule;
        }

        return null;
    } catch (err) {
        console.error('[MultiHog Companion] openBlueprintGameSystemInWizard error:', err);
        globalThis.toastr?.error?.(`Could not open Game System Wizard: ${err.message}`);
        return null;
    }
}
