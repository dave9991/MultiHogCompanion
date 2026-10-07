/**
 * PbtA Vitality & Party Sync Adapter for MultiHog Companion
 *
 * Resolves the impedance match between Powered by the Apocalypse (PbtA) Harm
 * and MultiHog D&D Framework's upstream parser requirements without modifying
 * upstream code:
 *
 * 1. PbtA tracks Harm (0 = healthy, maxHarm = incapacitated).
 * 2. MultiHog's upstream renderer (renderer.js) and portrait engine (portraits.js)
 *    strictly mandate a "Name: cur/max HP" regex anchor to extract party members,
 *    calculate health bar percentages ((cur/max)*100), and build portrait containers.
 * 3. This adapter normalizes memo lines to maintain descending tandem HP:
 *       curHp = Math.max(0, maxHarm - curHarm)
 *       maxHp = maxHarm
 *    producing: "Name: curHp/maxHp HP | Harm: curHarm/maxHarm | ..."
 * 4. This guarantees:
 *    - Upstream getPartyMembers() finds all companions for portraits & persona sync.
 *    - Upstream extractPartyVitals() renders the top party vitals strip cleanly.
 *    - Upstream blockToItems() assigns individual entity cards & health bars per member.
 */

/**
 * Normalizes a single line containing Harm into a valid tandem HP line.
 * If the line does not contain Harm, returns the original line unchanged.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizePbtaVitalityLine(line) {
    if (!line || typeof line !== 'string') return line;
    if (!/Harm/i.test(line)) return line;

    // Pattern 1: Already has both HP and Harm, e.g.:
    // "Deckard (Blade Runner): 5/5 HP | Harm: 2/5 | Armor: 1"
    const tandemRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*([+-]?\d+)(?:\/(\d+))?\s*HP\s*\|\s*Harm\s*[:=]\s*(\d+)(?:\/(\d+))?(.*)$/i;
    const tandemMatch = line.match(tandemRegex);
    if (tandemMatch) {
        const [, lead, name, , maxHpRaw, curHarmRaw, maxHarmRaw, rest] = tandemMatch;
        const curHarm = parseInt(curHarmRaw, 10) || 0;
        const maxHarm = parseInt(maxHarmRaw || maxHpRaw, 10) || 5;
        const curHp = Math.max(0, maxHarm - curHarm);
        const maxHp = maxHarm;
        return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${rest}`;
    }

    // Pattern 2: Harm without HP (e.g., "Rachael: Harm: 1/5 | Armor: 0" or "- Rachael: 1/5 Harm")
    const harmOnlyRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*(?:Harm\s*[:=]\s*(\d+)(?:\/(\d+))?|(\d+)(?:\/(\d+))?\s*Harm)\s*(?:\|\s*)?(.*)$/i;
    const harmOnlyMatch = line.match(harmOnlyRegex);
    if (harmOnlyMatch) {
        const [, lead, name, h1, m1, h2, m2, rest] = harmOnlyMatch;
        const curHarm = parseInt(h1 || h2, 10) || 0;
        const maxHarm = parseInt(m1 || m2, 10) || 5;
        const curHp = Math.max(0, maxHarm - curHarm);
        const maxHp = maxHarm;
        const restSuffix = rest ? ` | ${rest.trim().replace(/^\|\s*/, '')}` : '';
        return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${restSuffix}`;
    }

    // Pattern 3: Line with HP followed by separated Harm clause (e.g. "Name: 4/4 HP | Armor: 1 | Harm: 1/4")
    const hpSeparatedHarmRegex = /^(\s*[-*+•–—]?\s*)(.+?):\s*([+-]?\d+)(?:\/(\d+))?\s*HP\s*[:|,]?\s*(.*)$/i;
    const hpSepMatch = line.match(hpSeparatedHarmRegex);
    if (hpSepMatch) {
        const [, lead, name, , maxHpRaw, rest] = hpSepMatch;
        const embeddedHarm = rest.match(/Harm\s*[:=]\s*(\d+)(?:\/(\d+))?/i);
        if (embeddedHarm) {
            const curHarm = parseInt(embeddedHarm[1], 10) || 0;
            const maxHarm = parseInt(embeddedHarm[2] || maxHpRaw, 10) || 5;
            const curHp = Math.max(0, maxHarm - curHarm);
            const maxHp = maxHarm;
            // Clean out the old Harm clause and re-inject standard tandem
            const cleanedRest = rest.replace(/\s*\|\s*Harm\s*[:=]\s*\d+(?:\/\d+)?/gi, '').trim();
            const restSuffix = cleanedRest ? ` | ${cleanedRest.replace(/^\|\s*/, '')}` : '';
            return `${lead}${name.trim()}: ${curHp}/${maxHp} HP | Harm: ${curHarm}/${maxHarm}${restSuffix}`;
        }
    }

    return line;
}

/**
 * Normalizes an entire state memo text, ensuring all PbtA Harm entities have
 * synchronized descending tandem HP anchors.
 *
 * @param {string} memoText
 * @returns {string}
 */
export function normalizePbtaMemo(memoText) {
    if (!memoText || typeof memoText !== 'string') return memoText;
    if (!/Harm/i.test(memoText)) return memoText;

    const lines = memoText.split('\n');
    let modified = false;

    const newLines = lines.map(line => {
        const norm = normalizePbtaVitalityLine(line);
        if (norm !== line) modified = true;
        return norm;
    });

    return modified ? newLines.join('\n') : memoText;
}

/**
 * Synchronizes the live MultiHog settings currentMemo and chatState partitions
 * with tandem PbtA vitality formatting.
 *
 * @param {object} s MultiHog settings object
 * @param {string} [chatId] Active chat ID
 * @returns {boolean} True if changes were applied
 */
export function syncLivePbtaMemoVitality(s, chatId = null) {
    if (!s) return false;
    let didUpdate = false;

    if (s.currentMemo) {
        const normalized = normalizePbtaMemo(s.currentMemo);
        if (normalized !== s.currentMemo) {
            s.currentMemo = normalized;
            didUpdate = true;
        }
    }

    if (chatId && s.chatStates?.[chatId]?.currentMemo) {
        const normalized = normalizePbtaMemo(s.chatStates[chatId].currentMemo);
        if (normalized !== s.chatStates[chatId].currentMemo) {
            s.chatStates[chatId].currentMemo = normalized;
            didUpdate = true;
        }
    }

    return didUpdate;
}
