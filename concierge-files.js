/**
 * concierge-files.js — MultiHog Companion
 *
 * Client-side file & image processing for the PbtA Concierge Session Zero interface.
 * Leverages SillyTavern's native document extractors (PDF, DOCX, MD, HTML, EPUB)
 * and provides base64 image data URLs for vision-capable LLMs.
 */

import { resolveCardMacros } from './concierge-card-reader.js';

/**
 * Read an image file as a Base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            return reject(new Error(`File "${file.name}" is not an image.`));
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read image.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Extract plain text from an uploaded document using SillyTavern's built-in extractors.
 * Gracefully falls back to browser file.text() for standard text/markdown files.
 *
 * @param {File} file
 * @returns {Promise<{ filename: string, text: string, type: string }>}
 */
export async function extractDocumentContent(file) {
    const filename = file.name || 'document';
    const mime = (file.type || '').toLowerCase();
    const ext = filename.split('.').pop().toLowerCase();

    // 0. SillyTavern Chat Export (.jsonl)
    if (ext === 'jsonl') {
        const text = await file.text();
        const chatData = parseSillyTavernChatJsonl(text, filename);
        return { filename, text: text.trim(), type: 'chat', chatData };
    }

    // 1. Text / Markdown / Plain files
    if (
        mime === 'text/plain' ||
        mime === 'text/markdown' ||
        mime === 'application/json' ||
        ext === 'txt' ||
        ext === 'md' ||
        ext === 'json'
    ) {
        const text = await file.text();
        // Check if plain json actually contains ST chat lines
        if (text.includes('"chat_metadata"') && text.includes('"mes":')) {
            const chatData = parseSillyTavernChatJsonl(text, filename);
            return { filename, text: text.trim(), type: 'chat', chatData };
        }
        return { filename, text: text.trim(), type: 'text' };
    }

    // 2. SillyTavern native extractors
    try {
        const utils = await import('../../../utils.js');

        // PDF
        if (mime === 'application/pdf' || ext === 'pdf') {
            if (typeof utils.extractTextFromPDF === 'function') {
                const text = await utils.extractTextFromPDF(file);
                return { filename, text: text.trim(), type: 'pdf' };
            }
        }

        // Microsoft Office (DOCX / PPTX / XLSX)
        if (
            mime.includes('officedocument') ||
            mime.includes('opendocument') ||
            ['docx', 'xlsx', 'pptx', 'odt'].includes(ext)
        ) {
            if (typeof utils.extractTextFromOffice === 'function') {
                const text = await utils.extractTextFromOffice(file);
                return { filename, text: text.trim(), type: 'office' };
            }
        }

        // EPUB
        if (mime === 'application/epub+zip' || ext === 'epub') {
            if (typeof utils.extractTextFromEpub === 'function') {
                const text = await utils.extractTextFromEpub(file);
                return { filename, text: text.trim(), type: 'epub' };
            }
        }

        // HTML
        if (mime === 'text/html' || ext === 'html' || ext === 'htm') {
            if (typeof utils.extractTextFromHTML === 'function') {
                const text = await utils.extractTextFromHTML(file);
                return { filename, text: text.trim(), type: 'html' };
            }
        }
    } catch (err) {
        console.warn(`[PbtA Concierge] SillyTavern document converter failed for "${filename}":`, err);
    }

    // Fallback: Attempt text reading
    try {
        const text = await file.text();
        if (/^[\x00-\x08\x0E-\x1F\x7F-\xFF]*$/.test(text)) {
            throw new Error('File contains unsupported binary data.');
        }
        return { filename, text: text.trim(), type: 'text' };
    } catch (err) {
        throw new Error(`Could not parse document "${filename}": ${err.message}`);
    }
}

/**
 * Format an extracted document into a clean, tagged reference block for the LLM prompt.
 *
 * @param {string} filename
 * @param {string} text
 * @param {number} [maxWordLimit=5000]
 * @param {string} [protagonistName='']
 * @returns {string}
 */
export function formatDocumentPromptBlock(filename, text, maxWordLimit = 5000, protagonistName = '') {
    let clean = resolveCardMacros(text.trim(), protagonistName);
    const words = clean.split(/\s+/);

    let truncated = false;
    if (words.length > maxWordLimit) {
        clean = words.slice(0, maxWordLimit).join(' ') + '\n... [Document truncated to preserve context window]';
        truncated = true;
    }

    return `\n[ATTACHED_DOCUMENT: ${filename}${truncated ? ' (truncated)' : ''}]\n${clean}\n[/ATTACHED_DOCUMENT]\n`;
}

/**
 * Parses raw JSONL content from a SillyTavern chat file.
 * Strips out LLM chain-of-thought scratchpads (extra.reasoning), duplicate swipes,
 * and internal timestamps to leave clean chronological dialogue.
 *
 * @param {string} rawText
 * @param {string} [filename='']
 * @returns {{ charName: string, userName: string, chatMeta: object|null, messages: Array<{ sender: string, isUser: boolean, text: string }> }}
 */
export function parseSillyTavernChatJsonl(rawText, filename = '') {
    const lines = rawText.split('\n');
    const messages = [];
    let chatMeta = null;
    let userName = 'User';
    let charName = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const obj = JSON.parse(trimmed);
            if (obj.chat_metadata) {
                chatMeta = obj.chat_metadata;
                if (obj.user_name && obj.user_name !== 'unused') userName = obj.user_name;
                if (obj.character_name && obj.character_name !== 'unused') charName = obj.character_name;
                continue;
            }

            if (typeof obj.mes === 'string') {
                const sender = obj.name || (obj.is_user ? userName : 'Companion');
                if (!charName && !obj.is_user && obj.name) {
                    charName = obj.name;
                }
                const msgText = obj.mes.trim();
                if (msgText) {
                    messages.push({
                        sender,
                        isUser: !!obj.is_user,
                        text: msgText,
                    });
                }
            }
        } catch (_) {}
    }

    if (!charName && filename) {
        // e.g. "Seraphina - 2023-5-12 @21h 32m 29s 224ms.jsonl" -> "Seraphina"
        const m = filename.match(/^([^\-]+?)(?:\s*-\s*\d|\.jsonl|$)/i);
        if (m) charName = m[1].trim();
    }

    return {
        charName: charName || 'Companion',
        userName,
        chatMeta,
        messages,
    };
}

/**
 * Formats parsed chat transcript data into a high-signal inspiration block
 * with clear pointers for the Concierge.
 *
 * @param {object} chatData
 * @param {string} [filename='']
 * @param {number} [maxMessages=40]
 * @param {string} [protagonistName='']
 * @returns {string}
 */
export function formatChatTranscriptPromptBlock(chatData, filename = '', maxMessages = 40, protagonistName = '') {
    if (!chatData || !Array.isArray(chatData.messages)) return '';
    const { charName, userName, messages, chatMeta } = chatData;
    const selectedMsgs = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;

    const formattedTranscript = selectedMsgs.map(m => {
        const cleanText = resolveCardMacros(m.text, protagonistName);
        return `**${m.sender}**: ${cleanText}`;
    }).join('\n\n');

    const referencedBook = chatMeta?.tunnelvision_selected_book || '';

    return `\n[PRIOR_ROLEPLAY_CHAT_LOG: ${charName || filename}]
Source File: "${filename}" (${messages.length} messages${messages.length > maxMessages ? `, showing latest ${maxMessages}` : ''})
Key Participants: ${charName} (Companion/NPC) and ${protagonistName || userName} (Player)
${referencedBook ? `Referenced Setting/Lorebook: "${referencedBook}"\n` : ''}
## CONCIERGE GUIDELINES FOR READING THIS CHAT LOG:
1. STORY CONTINUITY: Treat this chat transcript as established canon backstory. The events, injuries, and conversations that occurred here really happened.
2. CHARACTER DYNAMIC & BOND: Emulate the established relationship, intimacy/tone, and dynamic between ${protagonistName || userName} and ${charName}.
3. LORE & CANON EXTRACTION: Extract any mentioned landmarks, sanctuaries, factions, or magical sources (e.g. sacred glades, ancient springs, Eldoria) to ground the campaign setting.
4. THREATS & INCITING INCIDENT: Look for foreshadowed perils or adversaries (e.g. beasts roaming the woods, Shadowfangs, encroaching darkness) and stage them as threats in the Campaign Dossier.
5. "THE KICK" (STARTING INCIDENT): Offer to start the PbtA adventure either immediately following this conversation or when an outside crisis shatters this sanctuary.
6. PROTAGONIST PLAYBOOK: Use how the player acted, their physical state, and background to propose fitting PbtA stats, starting playbook, and gear.

## CHAT LOG TRANSCRIPT:
${formattedTranscript}
[/PRIOR_ROLEPLAY_CHAT_LOG]\n`;
}

