/**
 * MultiHog Companion — D&D 5e Fixes & Enhancements Engine
 * [CATALOG: FEAT-09] See FEATURES.md
 *
 * Implements Pathway B (Declarative MultiHog Native Overrides) for D&D 5e:
 * - Harmonizes <end_of_output_footer> and <CYOA_mode> via a parent-child subfooter contract.
 * - Leaves narrative footer 100% clean when CYOA is turned off (zero prompt leakage).
 * - Stores alignment directly in MultiHog's native customSyspromptLibrary ('unlocked_base')
 *   and cyoaConfig.customPromptText without any runtime monkey patches.
 */

export const DND_SUBFOOTER_OVERRIDE_ID = 'mhc_dnd_subfooter_override_footer';

/**
 * Builds the aligned D&D 5e status footer prompt.
 * Concludes narrative output and explicitly permits active subfooters.
 * Never utters the word "CYOA" or "choices" to avoid prompt leakage when CYOA is off.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.use24hTime=false]
 * @param {boolean} [options.useDdMmYyFormat=false]
 * @returns {string}
 */
export function getDndAlignedFooterContent(options = {}) {
    let timeFmt = '[HH:MM AM/PM], Day [X]';
    if (options.use24hTime) {
        timeFmt = timeFmt.replace(/\[HH:MM AM\/PM\]/g, '[HH:MM] (24-hour clock, NO AM/PM)');
    }
    if (options.useDdMmYyFormat) {
        timeFmt = timeFmt.replace(/Day\s+\[X\]/g, '[DD/MM/YYYY]');
    }

    return `<end_of_output_footer>
ALWAYS end every narrative output with:
*(Status: [HP]) | (XP: [current]/[next level]) | (Location: [Main, Sub, Sub-sub, etc])*
*Level [X] | ${timeFmt}*
(followed only by any active subfooters explicitly defined elsewhere in your instructions)

Footer shows ONLY {{user}}'s HP/XP/level/location — never party/NPC status or names.
Location is coarse-to-fine and may be four or more tiers.

- For an unmapped settlement building use Settlement, District, Building.
- Never refer to unmapped BUILDINGs positionally in the footer (e.g. "Main Street, General Store rear loading dock".) Either "Main Street" or "Main Street, General Store" if actually inside.
</end_of_output_footer>`;
}

/**
 * Builds the aligned D&D 5e CYOA prompt.
 * Designates itself as [SUBFOOTER: INTERACTIVE CHOICES] and commands the LLM
 * to attach immediately beneath the status footer.
 *
 * @param {number} [choiceCount=5]
 * @returns {string}
 */
export function getDndAlignedCyoaPrompt(choiceCount = 5) {
    const strictOrderLines = Array.from(
        { length: choiceCount },
        (_, i) => `${i + 1}. NARRATIVE-DECIDED (Choose whichever format fits the story best).`
    ).join('\n');

    return `[SUBFOOTER: INTERACTIVE CHOICES]
- Immediately following the status footer, append exactly ${choiceCount} choices for the user. NEVER forget the choices. This is a strict requirement.
- Output sequence: (1) Scene narrative -> (2) Status footer -> (3) <choices> subfooter.
- The <choices> block in (3) must immediately follow the status footer in (2) with NO story narration placed after them.
- Enclose all choices inside a single <choices> XML block.
- Wrap every single choice in a <button> tag.
- Prefix each choice text with a fitting emoji.
- Not all choices should always have a roll, though all choices *can* have a roll; high-stakes situations/problem-solving should utilize them more. Downtime needs less rolls.
- Not every looking around needs to be an investigation check, but investigating something specific should be.
- When a site map is attached: do not invent obstacles in choices (locked doors, traps, barricades, sealed passages, etc.) unless they already exist on that map. Offering such a check makes the obstacle real if chosen — keep choices map-real.
- A resource must be >0 (not depleted) in TRACKER STATE 0 (Current) to be eligible for a choice.
- Vary approaches across turns — avoid repeating the same stats, traits, abilities, or narrative actions as the previous turn.
- Wrap mechanical details (rolls, modifiers, DC/AC targets, resource costs, uses remaining) in square brackets, typically after an em dash, e.g. — [Persuasion (untrained, CHA +0) DC 13]. Prefix/trait tags at the start of a choice also use brackets but are separate from roll brackets.

Choice types available:
- NORMAL: Plain action/speech (e.g. "Open the door")
- NARRATIVE-DECIDED: Pick whichever format fits best based on context
- TRAIT/ABILITY: Prefix with [Trait Name] (e.g. "[Illithid] Read his mind")
- PREFIX: Prefix with a specific bracketed label (e.g. "[Attack] Swing the sword")

EXAMPLES:
(Style/variety references — counts may differ. STRICT GENERATION ORDER below is authoritative for how many choices you output.)

Example 1 (high-stakes scenario):
<choices>
<button>1. 🎯 Fire with Dead-Eye Focus — [2/3 per short rest] [Attack (+12) vs AC 15]</button>
<button>2. 💣 Throw a Smoke Bomb — [-1 Smoke Bomb]</button>
<button>3. 🥷 Slip along the hull's shadows — [Stealth (+6: Void-Runner) DC 14]</button>
<button>4. 🗣️ Shout a warning to the rest of your crew</button>
<button>5. 🛰️ Try to talk the hostile crew into standing down — [Persuasion (untrained, CHA +0) DC 13]</button>
</choices>

Example 2 (low-stakes/downtime scenario):
<choices>
<button>1. 🍺 Buy a round for the table and swap stories — [-20 GP]</button>
<button>2. 🗣️ "What happened to your face? That's the longest scar I've seen."</button>
<button>3. 🎵 Hum along to the tune the bard is playing</button>
<button>4. 📜 Show him the bounty notice from your pack — [Intimidation (+2) DC 10] (evidence lowers the DC)</button>
<button>5. ♣️ Join the card game at the corner table — [Bluff (+3) DC 18] (experienced players)</button>
</choices>

STRICT GENERATION ORDER:
You must generate exactly ${choiceCount} choices following these exact rules:
${strictOrderLines}`;
}

/**
 * Helper to retrieve active MultiHog settings safely.
 */
async function getMultiHogSettings() {
    try {
        if (typeof window !== 'undefined' && window['sillytavern-multihog-dnd']?.settings) {
            return window['sillytavern-multihog-dnd'].settings;
        }
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        return stateMgr?.getSettings?.() || null;
    } catch (_) {
        return null;
    }
}

/**
 * Helper to commit MultiHog settings and trigger sysprompt re-assembly.
 */
async function saveMultiHogSettingsAndSysprompt() {
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.autoApplySysprompt === 'function') {
            await bridge.autoApplySysprompt(true);
        }
        if (typeof bridge.saveSettings === 'function') {
            await bridge.saveSettings();
        }
    } catch (_) {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    }
}

/**
 * Checks whether the native D&D subfooter alignment is currently applied to settings.
 *
 * @param {object} [rpgSettings] Optional settings object (fetches live if omitted)
 * @returns {boolean}
 */
export function isDndSubfooterAlignmentApplied(rpgSettings) {
    if (!rpgSettings) return false;
    const hasFooterOverride = Array.isArray(rpgSettings.customSyspromptLibrary) &&
        rpgSettings.customSyspromptLibrary.some(item =>
            item && (item.id === DND_SUBFOOTER_OVERRIDE_ID || (item.origin === 'unlocked_base' && item.baseTag === 'end_of_output_footer' && item.content?.includes('active subfooters')))
        );
    const hasCyoaOverride = rpgSettings.cyoaConfig?.useCustomPrompt === true &&
        typeof rpgSettings.cyoaConfig?.customPromptText === 'string' &&
        rpgSettings.cyoaConfig.customPromptText.includes('[SUBFOOTER: INTERACTIVE CHOICES]');
    return !!(hasFooterOverride && hasCyoaOverride);
}

/**
 * Applies the D&D 5e Subfooter Alignment fix via native MultiHog settings overrides.
 *
 * @param {object} [options={}]
 * @param {object} [options.rpgSettings]
 * @returns {Promise<boolean>}
 */
export async function applyDndSubfooterAlignment(options = {}) {
    const rpgSettings = options.rpgSettings || await getMultiHogSettings();
    if (!rpgSettings) return false;

    // 1. Ensure customSyspromptLibrary array
    if (!Array.isArray(rpgSettings.customSyspromptLibrary)) {
        rpgSettings.customSyspromptLibrary = [];
    }

    // 2. Build aligned footer snippet
    const footerContent = getDndAlignedFooterContent({
        use24hTime: !!rpgSettings.use24hTime,
        useDdMmYyFormat: !!rpgSettings.useDdMmYyFormat,
    });

    const snippet = {
        id: DND_SUBFOOTER_OVERRIDE_ID,
        tag: 'end_of_output_footer',
        baseTag: 'end_of_output_footer',
        origin: 'unlocked_base',
        label: '<end_of_output_footer>',
        description: 'D&D 5e Status Footer (Subfooter Alignment)',
        enabled: true,
        content: footerContent,
    };

    // Remove any existing override with this ID or targeting end_of_output_footer with unlocked_base
    rpgSettings.customSyspromptLibrary = rpgSettings.customSyspromptLibrary.filter(
        item => item && item.id !== DND_SUBFOOTER_OVERRIDE_ID && !(item.origin === 'unlocked_base' && item.baseTag === 'end_of_output_footer')
    );
    rpgSettings.customSyspromptLibrary.push(snippet);

    // 3. Ensure cyoaConfig with aligned custom prompt
    if (!rpgSettings.cyoaConfig || typeof rpgSettings.cyoaConfig !== 'object') {
        rpgSettings.cyoaConfig = {};
    }
    const slotCount = Array.isArray(rpgSettings.cyoaConfig.slots) && rpgSettings.cyoaConfig.slots.length > 0
        ? rpgSettings.cyoaConfig.slots.length
        : 5;

    rpgSettings.cyoaConfig.useCustomPrompt = true;
    rpgSettings.cyoaConfig.customPromptText = getDndAlignedCyoaPrompt(slotCount);

    // 4. Save settings and recompile sysprompt
    await saveMultiHogSettingsAndSysprompt();
    return true;
}

/**
 * Reverts the D&D 5e Subfooter Alignment fix, restoring MultiHog stock factory prompts.
 *
 * @param {object} [options={}]
 * @param {object} [options.rpgSettings]
 * @returns {Promise<boolean>}
 */
export async function revertDndSubfooterAlignment(options = {}) {
    const rpgSettings = options.rpgSettings || await getMultiHogSettings();
    if (!rpgSettings) return false;

    // 1. Remove the footer override
    if (Array.isArray(rpgSettings.customSyspromptLibrary)) {
        rpgSettings.customSyspromptLibrary = rpgSettings.customSyspromptLibrary.filter(
            item => item && item.id !== DND_SUBFOOTER_OVERRIDE_ID && !(item.origin === 'unlocked_base' && item.baseTag === 'end_of_output_footer' && item.content?.includes('active subfooters'))
        );
    }

    // 2. Revert cyoaConfig if it holds our subfooter prompt
    if (rpgSettings.cyoaConfig && typeof rpgSettings.cyoaConfig === 'object') {
        if (rpgSettings.cyoaConfig.customPromptText?.includes('[SUBFOOTER: INTERACTIVE CHOICES]')) {
            rpgSettings.cyoaConfig.useCustomPrompt = false;
            rpgSettings.cyoaConfig.customPromptText = '';
        }
    }

    // 3. Save settings and recompile sysprompt
    await saveMultiHogSettingsAndSysprompt();
    return true;
}
