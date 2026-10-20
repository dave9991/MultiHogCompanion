/**
 * concierge-connection.js — MultiHog Companion
 *
 * Dedicated LLM connection & routing layer for the PbtA Concierge Session Zero agent.
 * Supports:
 * 1. SillyTavern Connection Manager Profiles (silent background execution)
 * 2. Direct OpenAI-compatible endpoints (Cloud vision models: GPT-4o, Claude, Gemini)
 * 3. Direct Ollama endpoints (Local vision models: Llama 3.2 Vision, MiniCPM-V, etc.)
 * 4. SillyTavern default active connection fallback
 *
 * Preserves multimodal message array payloads (text + base64 image_url) without
 * string coercion.
 */

import { stripSillyTavernMacros } from './concierge-card-reader.js';

const EXTENSION_NAME = 'multihog_companion';

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || {};
}

export function getConciergeConnectionSettings() {
    const ctx = getContext();
    const s = ctx.extensionSettings?.[EXTENSION_NAME] || globalThis.extension_settings?.[EXTENSION_NAME] || {};
    return {
        connectionSource: s.conciergeConnectionSource || 'default',
        connectionProfileId: s.conciergeConnectionProfileId || '',
        completionPresetId: s.conciergeCompletionPresetId || '',
        ollamaUrl: s.conciergeOllamaUrl || 'http://localhost:11434',
        ollamaModel: s.conciergeOllamaModel || '',
        openaiUrl: s.conciergeOpenaiUrl || '',
        openaiKey: s.conciergeOpenaiKey || '',
        openaiModel: s.conciergeOpenaiModel || '',
        maxTokens: Number(s.conciergeMaxTokens) > 0 ? Number(s.conciergeMaxTokens) : 0,
    };
}

export function updateConciergeConnectionSettings(patch) {
    const ctx = getContext();
    const settings = ctx.extensionSettings || globalThis.extension_settings || {};
    settings[EXTENSION_NAME] = settings[EXTENSION_NAME] || {};
    Object.assign(settings[EXTENSION_NAME], patch);
    if (typeof ctx.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    } else if (typeof globalThis.saveSettingsDebounced === 'function') {
        globalThis.saveSettingsDebounced();
    }
}

/**
 * Fetch available models from an Ollama server.
 */
export async function fetchOllamaModels(url = 'http://localhost:11434') {
    const base = url.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Ollama tags request failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.models) ? data.models.map(m => m.name || m) : [];
}

/**
 * Fetch available models from an OpenAI-compatible endpoint.
 */
export async function fetchOpenAIModels(url, key = '') {
    if (!url) throw new Error('No endpoint URL provided');
    let base = url.replace(/\/+$/, '');
    if (!base.endsWith('/v1') && !base.includes('/v1/')) {
        base += '/v1';
    }
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    const res = await fetch(`${base}/models`, { headers });
    if (!res.ok) throw new Error(`OpenAI models request failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.data) ? data.data.map(m => m.id || m.name) : [];
}

/**
 * Check if a messages array contains any image attachments.
 */
export function hasImagePayload(messages) {
    if (!Array.isArray(messages)) return false;
    return messages.some(msg => {
        if (Array.isArray(msg.content)) {
            return msg.content.some(part => part?.type === 'image_url');
        }
        return false;
    });
}

/**
 * Send a request via SillyTavern Connection Profile.
 */
async function sendViaProfile(context, settings, messages, { signal = null, stream = false } = {}) {
    const service = context.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== 'function') {
        throw new Error('ConnectionManagerRequestService is not available in this SillyTavern build.');
    }

    const maxTokens = settings.maxTokens > 0 ? settings.maxTokens : undefined;
    const profile = typeof service.getProfile === 'function'
        ? service.getProfile(settings.connectionProfileId)
        : null;

    if (!profile) {
        throw new Error(`Connection profile "${settings.connectionProfileId}" not found.`);
    }

    const raw = await service.sendRequest(
        settings.connectionProfileId,
        messages,
        maxTokens,
        {
            stream: !!stream,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
            signal,
        },
    );

    // Extract text from result
    return extractTextFromApiResponse(raw);
}

/**
 * Send a request directly to an OpenAI-compatible endpoint.
 */
async function sendViaDirectOpenAI(settings, messages, { signal = null } = {}) {
    let base = (settings.openaiUrl || '').replace(/\/+$/, '');
    if (!base.endsWith('/v1') && !base.includes('/v1/')) {
        base += '/v1';
    }
    const url = `${base}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (settings.openaiKey) headers['Authorization'] = `Bearer ${settings.openaiKey}`;

    const body = {
        model: settings.openaiModel || 'gpt-4o-mini',
        messages,
        max_tokens: settings.maxTokens > 0 ? settings.maxTokens : 8192,
        temperature: 0.7,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return extractTextFromApiResponse(data);
}

/**
 * Send a request directly to an Ollama endpoint.
 */
async function sendViaDirectOllama(settings, messages, { signal = null } = {}) {
    const base = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const url = `${base}/api/chat`;

    // Format messages for Ollama API
    const ollamaMessages = messages.map(msg => {
        if (Array.isArray(msg.content)) {
            let text = '';
            const images = [];
            for (const part of msg.content) {
                if (part.type === 'text') text += part.text;
                if (part.type === 'image_url' && part.image_url?.url) {
                    const b64 = part.image_url.url.replace(/^data:image\/[^;]+;base64,/, '');
                    images.push(b64);
                }
            }
            return { role: msg.role, content: text, ...(images.length ? { images } : {}) };
        }
        return { role: msg.role, content: String(msg.content || '') };
    });

    const body = {
        model: settings.ollamaModel,
        messages: ollamaMessages,
        stream: false,
        options: {
            num_predict: settings.maxTokens > 0 ? settings.maxTokens : 8192,
            temperature: 0.7,
        },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.message?.content || '';
}

/**
 * Checks whether a string is an unfinished chain-of-thought reasoning dump
 * with no final structured directive block or CYOA markup.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isTruncatedReasoningDump(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    const hasStructuredPayload = /<(?:choices|button)\b/i.test(trimmed) ||
        /(?:^|\n)[ \t]*\[(?:UPDATE_DOSSIER|CONCIERGE_STATE|DOSSIER_CRITIQUE|NOOP)\]/i.test(trimmed) ||
        /\{[\s\S]*\}/.test(trimmed);
    if (hasStructuredPayload) return false;
    return /^(?:<think>|Here(?:'s| is) a thinking process|Thinking Process:|Let's think step by step|1\.\s+\*\*(?:Analyze|Understand|Evaluate)\b)/i.test(trimmed);
}

/**
 * Robust text extractor for API response objects across OpenAI, Anthropic, Ollama, and Kobold.
 * Inspects both standard message content and reasoning_content (for thinking/reasoning models like
 * DeepSeek R1, Gemma 4, Qwen 2.5/3 thinking variants).
 *
 * @param {object|string} data Raw API response
 * @returns {string}
 */
export function extractTextFromApiResponse(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;

    // Check chat completion choices (OpenAI-compatible)
    const choice = data.choices?.[0];
    if (choice) {
        const msg = choice.message;
        const content = typeof msg?.content === 'string' ? msg.content.trim() : (choice.text || '').trim();
        const reasoning = typeof msg?.reasoning_content === 'string'
            ? msg.reasoning_content.trim()
            : (typeof msg?.reasoning === 'string' ? msg.reasoning.trim() : '');

        if (content && reasoning) {
            // If content contains choice tags, Concierge directive blocks, or JSON, it is the clean answer
            if (/<(?:choices|button)\b/i.test(content) || /\[(?:UPDATE_DOSSIER|CONCIERGE_STATE|DOSSIER_CRITIQUE|NOOP)\]/i.test(content) || /\{[\s\S]*\}/.test(content)) {
                return content;
            }
            // If reasoning contains choice tags while content does not, include reasoning
            if (/<(?:choices|button)\b/i.test(reasoning)) {
                return `${reasoning}\n${content}`;
            }
            return content;
        }
        if (content) return content;
        if (reasoning) {
            // If the model placed a structured Concierge directive inside reasoning_content, extract from that directive onward
            const directiveMatch = reasoning.match(/(?:^|\n)[ \t]*(\[(?:UPDATE_DOSSIER|CONCIERGE_STATE|DOSSIER_CRITIQUE|NOOP)\][\s\S]*)$/i);
            if (directiveMatch) {
                return directiveMatch[1].trim();
            }
            // If the model placed JSON inside reasoning_content, extract it
            const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return jsonMatch[0].trim();
            }
            // Do not leak unfinished chain-of-thought dumps when content was starved by token truncation
            if (isTruncatedReasoningDump(reasoning)) {
                console.warn('[MultiHog Companion] Model exhausted output token budget inside reasoning_content before producing content.');
                return '';
            }
            return reasoning;
        }
    }

    // Direct Ollama format
    if (data.message?.content) {
        return data.message.content;
    }

    // Direct Anthropic / generic content array
    if (Array.isArray(data.content)) {
        return data.content
            .filter(p => p && (p.type === 'text' || typeof p.text === 'string'))
            .map(p => p.text || '')
            .join('\n\n');
    }
    if (typeof data.content === 'string') {
        return data.content;
    }

    // Kobold format
    if (Array.isArray(data.results) && data.results[0]?.text) {
        return data.results[0].text;
    }

    if (data.text) return data.text;
    if (data.response) return data.response;

    return '';
}

/**
 * Resolves the response token limit for Concierge requests over the default SillyTavern connection.
 * Preserves the user's preset limit when it is already generous (>= 8192) or unconfigured (null),
 * and boosts small chat reply limits (< 8192) so reasoning models never truncate mid-blueprint.
 *
 * @param {object} [opts]
 * @param {object} [opts.settings]
 * @param {Array<{role: string, content: string|Array}>} [opts.messages]
 * @param {object} [opts.context]
 * @returns {number|null}
 */
export function resolveConciergeMaxTokens({ settings, messages, context } = {}) {
    if (settings?.maxTokens && Number(settings.maxTokens) > 0) {
        return Math.floor(Number(settings.maxTokens));
    }

    const ctx = context || getContext();
    const configuredMaxTokens = Number(
        ctx?.chatCompletionSettings?.openai_max_tokens ||
        globalThis.oai_settings?.openai_max_tokens ||
        ctx?.amountGen ||
        globalThis.amount_gen ||
        0
    );

    // If no preset response cap is visible or the user already configured >= 8192 tokens,
    // return null so SillyTavern uses its native preset limit untouched.
    if (!configuredMaxTokens || isNaN(configuredMaxTokens) || configuredMaxTokens >= 8192) {
        return null;
    }

    // Otherwise, the active chat reply length (< 8192, e.g. 500 or 2048) would choke
    // reasoning models + full blueprint scaffolding. Dynamically scale up to context headroom.
    let contextLimit = Number(
        ctx?.chatCompletionSettings?.openai_max_context ||
        globalThis.oai_settings?.openai_max_context ||
        ctx?.maxContext ||
        globalThis.max_context ||
        0
    );
    if ((!contextLimit || isNaN(contextLimit)) && typeof globalThis.getMaxContextTokens === 'function') {
        try {
            contextLimit = Number(globalThis.getMaxContextTokens()) || 0;
        } catch (_) {}
    }
    if (!contextLimit || isNaN(contextLimit) || contextLimit <= 0) {
        contextLimit = 16384;
    }

    let promptChars = 0;
    if (Array.isArray(messages)) {
        for (const msg of messages) {
            if (typeof msg?.content === 'string') {
                promptChars += msg.content.length;
            } else if (Array.isArray(msg?.content)) {
                for (const part of msg.content) {
                    if (part && typeof part.text === 'string') {
                        promptChars += part.text.length;
                    }
                }
            }
        }
    }
    const estimatedPromptTokens = Math.max(Math.ceil(promptChars / 3.2) + 250, 400);
    const available = contextLimit - estimatedPromptTokens - 256;
    return Math.max(configuredMaxTokens, Math.min(16384, Math.max(4096, available)));
}

/**
 * Send a request via SillyTavern default active connection.
 */
async function sendViaDefault(context, settings, messages, { signal = null, callerName = 'MultiHog Companion' } = {}) {
    const hasImage = hasImagePayload(messages);

    // Explicitly attach names to isolate from SillyTavern's active background character
    const isolatedMessages = messages.map(msg => {
        let name = msg.name;
        if (!name) {
            if (msg.role === 'assistant') name = callerName.replace(/\s+/g, '_');
            else if (msg.role === 'user') name = 'Player';
            else if (msg.role === 'system') name = 'System';
        }
        return { ...msg, name };
    });

    // If images are present and main API is openai / chat completion:
    if (hasImage) {
        if (typeof context.sendOpenAIRequest === 'function' && context.main_api === 'openai') {
            const data = await context.sendOpenAIRequest('quiet', isolatedMessages, signal);
            return extractTextFromApiResponse(data);
        }
        console.warn(`[${callerName}] Images attached but main API may not support multimodal payloads. Attempting chat completion.`);
    }

    const responseLength = resolveConciergeMaxTokens({
        settings,
        messages: isolatedMessages,
        context,
    });

    // 1. Prefer generateRawData: returns raw API response without throwing 'Error: No message generated'
    // and allows extracting from reasoning_content when models output thoughts
    if (typeof context.generateRawData === 'function') {
        const rawData = await context.generateRawData({
            prompt: isolatedMessages,
            quietToLoud: false,
            quietName: callerName,
            instructOverride: false,
            responseLength: responseLength,
        });
        const extracted = extractTextFromApiResponse(rawData);
        if (extracted) {
            return extracted;
        }
        console.warn(`[${callerName}] generateRawData returned empty content. Raw data:`, rawData);
    }

    // 2. Fallback to generateRaw
    if (typeof context.generateRaw === 'function') {
        try {
            return await context.generateRaw({
                prompt: isolatedMessages,
                quietToLoud: false,
                quietName: callerName,
                instructOverride: false,
                trimNames: false,
                responseLength: responseLength,
            });
        } catch (err) {
            console.warn(`[${callerName}] generateRaw failed:`, err?.message || err);
            // If generateRaw throws 'No message generated', return empty string instead of crashing
            return '';
        }
    }

    throw new Error('No suitable SillyTavern generation function available.');
}

/**
 * Generic router: routes an LLM chat completion request according to provided connection settings.
 *
 * @param {object} settings Connection settings (source, profile, ollama, openai, maxTokens)
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {AbortSignal|object|null} [signalOrOptions]
 * @returns {Promise<string>}
 */
export async function sendRoutedLlmRequest(settings, messages, signalOrOptions = null) {
    let signal = null;
    let options = {};
    if (signalOrOptions instanceof AbortSignal) {
        signal = signalOrOptions;
    } else if (signalOrOptions && typeof signalOrOptions === 'object') {
        signal = signalOrOptions.signal || null;
        options = signalOrOptions;
    }
    const callerName = options.callerName || 'MultiHog Companion';
    const context = SillyTavern.getContext();

    // Sanitize all outgoing messages to strip any straggling SillyTavern macros ({{user}}, {{persona}}, {{char}}, etc.)
    // so SillyTavern's macro engine cannot substitute host persona or character details.
    const sanitizedMessages = (messages || []).map(msg => {
        if (typeof msg.content === 'string') {
            return { ...msg, content: stripSillyTavernMacros(msg.content) };
        }
        if (Array.isArray(msg.content)) {
            const sanitizedParts = msg.content.map(part => {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    return { ...part, text: stripSillyTavernMacros(part.text) };
                }
                return part;
            });
            return { ...msg, content: sanitizedParts };
        }
        return msg;
    });

    // 1. Profile Mode
    if (settings.connectionSource === 'profile' && settings.connectionProfileId) {
        return await sendViaProfile(context, settings, sanitizedMessages, { signal });
    }

    // 2. Direct OpenAI
    if (settings.connectionSource === 'openai' && settings.openaiUrl) {
        return await sendViaDirectOpenAI(settings, sanitizedMessages, { signal });
    }

    // 3. Direct Ollama
    if (settings.connectionSource === 'ollama' && settings.ollamaModel) {
        return await sendViaDirectOllama(settings, sanitizedMessages, { signal });
    }

    // 4. Default SillyTavern Connection
    return await sendViaDefault(context, settings, sanitizedMessages, { signal, callerName });
}

/**
 * Main entry point: routes a Concierge chat completion request according to user settings.
 *
 * @param {Array<{role: string, content: string|Array}>} messages
 * @param {AbortSignal|null} [signal]
 * @returns {Promise<string>}
 */
export async function sendConciergeRequest(messages, signal = null) {
    const settings = getConciergeConnectionSettings();
    return await sendRoutedLlmRequest(settings, messages, { signal, callerName: 'PbtA Concierge' });
}
