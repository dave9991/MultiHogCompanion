/**
 * concierge-card-reader.js — MultiHog Companion
 *
 * Client-side parser for SillyTavern / Tavern Character Cards (PNG & JSON).
 * Extracts character name, personality, description, scenario, avatar data URL,
 * and embedded world books (character_book) without server-side dependencies.
 */

/**
 * Decodes base64 text into a UTF-8 string safely.
 * @param {string} b64
 * @returns {string}
 */
function decodeBase64Utf8(b64) {
    const binString = atob(b64);
    const bytes = Uint8Array.from(binString, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/**
 * Scans a PNG buffer and extracts all text chunks (tEXt).
 * @param {ArrayBuffer} buffer
 * @returns {Record<string, string>} Map of keyword -> text
 */
export function extractPngTextChunks(buffer) {
    const view = new DataView(buffer);
    const textMap = {};

    // Verify PNG signature: 137, 80, 78, 71, 13, 10, 26, 10
    if (view.byteLength < 8) return textMap;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (view.getUint8(i) !== signature[i]) return textMap;
    }

    let offset = 8;
    const decoder = new TextDecoder('latin1');

    while (offset < view.byteLength) {
        if (offset + 8 > view.byteLength) break;
        const length = view.getUint32(offset);
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7),
        );

        offset += 8;
        if (offset + length > view.byteLength) break;

        if (type === 'tEXt') {
            const chunkBytes = new Uint8Array(buffer, offset, length);
            const chunkStr = decoder.decode(chunkBytes);
            const nullIdx = chunkStr.indexOf('\0');
            if (nullIdx > 0) {
                const keyword = chunkStr.slice(0, nullIdx);
                const text = chunkStr.slice(nullIdx + 1);
                textMap[keyword.toLowerCase()] = text;
            }
        }

        offset += length + 4; // Skip data + 4 bytes CRC
    }

    return textMap;
}

/**
 * Normalizes raw character card JSON (V1, V2, or V3 spec) into a clean, uniform object.
 * @param {any} raw
 * @param {string|null} [avatarDataUrl=null]
 * @returns {object|null}
 */
export function normalizeCharacterCard(raw, avatarDataUrl = null) {
    if (!raw || typeof raw !== 'object') return null;

    // Check V2/V3 wrapper vs V1 flat
    const data = raw.data || raw;
    const name = String(data.name || raw.name || '').trim();
    if (!name) return null;

    return {
        name,
        description: String(data.description || raw.description || '').trim(),
        personality: String(data.personality || raw.personality || '').trim(),
        scenario: String(data.scenario || raw.scenario || '').trim(),
        firstMessage: String(data.first_mes || raw.first_mes || '').trim(),
        creatorNotes: String(data.creator_notes || raw.creator_notes || '').trim(),
        tags: Array.isArray(data.tags) ? data.tags : (Array.isArray(raw.tags) ? raw.tags : []),
        avatar: avatarDataUrl || null,
        characterBook: data.character_book || raw.character_book || null,
        spec: raw.spec || (raw.data ? 'chara_card_v2' : 'chara_card_v1'),
    };
}

/**
 * Parses an uploaded Character File (PNG or JSON).
 *
 * @param {File} file
 * @returns {Promise<object|null>} Normalized character card or null if not a character card
 */
export async function parseCharacterFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    // 1. JSON file
    if (ext === 'json') {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            return normalizeCharacterCard(parsed);
        } catch (_) {
            return null;
        }
    }

    // 2. PNG file
    if (ext === 'png' || file.type === 'image/png') {
        try {
            const buffer = await file.arrayBuffer();
            const textChunks = extractPngTextChunks(buffer);

            let rawJsonStr = null;

            // V3 spec takes precedence, then V2
            if (textChunks['ccv3']) {
                rawJsonStr = decodeBase64Utf8(textChunks['ccv3']);
            } else if (textChunks['chara']) {
                rawJsonStr = decodeBase64Utf8(textChunks['chara']);
            }

            if (!rawJsonStr) return null; // Regular PNG without character card metadata

            const parsed = JSON.parse(rawJsonStr);

            // Create base64 data URL for avatar
            const blob = new Blob([buffer], { type: 'image/png' });
            const avatarDataUrl = await new Promise(res => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.readAsDataURL(blob);
            });

            return normalizeCharacterCard(parsed, avatarDataUrl);
        } catch (err) {
            console.warn('[PbtA Concierge] Failed to parse PNG character chunk:', err);
            return null;
        }
    }

    return null;
}

/**
 * Formats a normalized character card into a tagged inspiration block for the Concierge prompt.
 * @param {object} card
 * @returns {string}
 */
export function formatCharacterInspirationBlock(card) {
    const parts = [
        `\n[INSPIRATION_CHARACTER_CARD: ${card.name}]`,
        `Name: ${card.name}`,
    ];

    if (card.description) parts.push(`Description & Appearance:\n${card.description}`);
    if (card.personality) parts.push(`Personality & Traits:\n${card.personality}`);
    if (card.scenario) parts.push(`Background & Scenario:\n${card.scenario}`);
    if (card.tags?.length) parts.push(`Tags: ${card.tags.join(', ')}`);

    parts.push('[/INSPIRATION_CHARACTER_CARD]\n');
    return parts.join('\n');
}
