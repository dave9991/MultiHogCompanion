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

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const EXTENSION_NAME = 'multihog_companion';

export function getConciergeConnectionSettings() {
    const s = extension_settings[EXTENSION_NAME] || {};
    return {
        connectionSource: s.conciergeConnectionSource || 'default',
        connectionProfileId: s.conciergeConnectionProfileId || '',
        completionPresetId: s.conciergeCompletionPresetId || '',
        ollamaUrl: s.conciergeOllamaUrl || 'http://localhost:11434',
        ollamaModel: s.conciergeOllamaModel || '',
        openaiUrl: s.conciergeOpenaiUrl || '',
        openaiKey: s.conciergeOpenaiKey || '',
        openaiModel: s.conciergeOpenaiModel || '',
        maxTokens: s.conciergeMaxTokens || 2048,
    };
}

export function updateConciergeConnectionSettings(patch) {
    extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
    Object.assign(extension_settings[EXTENSION_NAME], patch);
    saveSettingsDebounced();
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
    if (typeof raw === 'string') return raw;
    if (raw?.text) return raw.text;
    if (raw?.content) return raw.content;
    if (raw?.choices?.[0]?.message?.content) return raw.choices[0].message.content;
    return String(raw || '');
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
        max_tokens: settings.maxTokens > 0 ? settings.maxTokens : 2048,
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
    return data.choices?.[0]?.message?.content || '';
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
            num_predict: settings.maxTokens > 0 ? settings.maxTokens : 2048,
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
 * Send a request via SillyTavern default active connection.
 */
async function sendViaDefault(context, messages, { signal = null } = {}) {
    const hasImage = hasImagePayload(messages);

    // If images are present and main API is openai / chat completion:
    if (hasImage) {
        if (typeof context.sendOpenAIRequest === 'function' && context.main_api === 'openai') {
            const data = await context.sendOpenAIRequest('quiet', messages, signal);
            return data.choices?.[0]?.message?.content || '';
        }
        console.warn('[PbtA Concierge] Images attached but main API may not support multimodal payloads. Attempting chat completion.');
    }

    // Default to generateRaw / generateRawData
    if (typeof context.generateRaw === 'function') {
        // If messages is an array, format prompt for generateRaw
        return await context.generateRaw({
            prompt: messages,
            quietToLoud: true,
            instructOverride: false,
        });
    }

    throw new Error('No suitable SillyTavern generation function available.');
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
    const context = SillyTavern.getContext();

    // 1. Profile Mode
    if (settings.connectionSource === 'profile' && settings.connectionProfileId) {
        return await sendViaProfile(context, settings, messages, { signal });
    }

    // 2. Direct OpenAI
    if (settings.connectionSource === 'openai' && settings.openaiUrl) {
        return await sendViaDirectOpenAI(settings, messages, { signal });
    }

    // 3. Direct Ollama
    if (settings.connectionSource === 'ollama' && settings.ollamaModel) {
        return await sendViaDirectOllama(settings, messages, { signal });
    }

    // 4. Default SillyTavern Connection
    return await sendViaDefault(context, messages, { signal });
}
