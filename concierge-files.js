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
