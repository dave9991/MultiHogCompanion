/**
 * namerag-client.js — MultiHog Companion
 *
 * Client for discovering and querying the NameRAG MCP server via SillyTavern's
 * MCP Server plugin (/api/plugins/mcp/servers).
 *
 * Zero hardcoded addresses: dynamically queries SillyTavern's registered MCP
 * servers, discovers whichever server offers 'search_names' or is named 'namerag',
 * and quietly hides all NameRAG features if not installed/configured.
 */

const PLUGIN_ID = 'mcp';
const DISCOVERY_CACHE_TTL_MS = 15000;

let cachedDiscovery = null;
let lastDiscoveryTime = 0;

/**
 * Normalizes request headers from SillyTavern's context.
 * @returns {Record<string, string>}
 */
function getHeaders() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const reqHeaders = ctx?.getRequestHeaders?.() || {};
    return {
        'Content-Type': 'application/json',
        ...reqHeaders,
    };
}

/**
 * Dynamically discovers if an MCP server providing NameRAG is registered in SillyTavern.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<{ available: boolean, serverName: string|null, isRunning: boolean, tools: Array<any> }>}
 */
export async function discoverNameRagServer(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedDiscovery && (now - lastDiscoveryTime < DISCOVERY_CACHE_TTL_MS)) {
        return cachedDiscovery;
    }

    const fallback = { available: false, serverName: null, isRunning: false, tools: [] };

    try {
        const res = await fetch(`/api/plugins/${PLUGIN_ID}/servers`, {
            method: 'GET',
            headers: getHeaders(),
        });

        if (!res.ok) {
            cachedDiscovery = fallback;
            lastDiscoveryTime = now;
            return fallback;
        }

        const servers = await res.json();
        if (!Array.isArray(servers) || servers.length === 0) {
            cachedDiscovery = fallback;
            lastDiscoveryTime = now;
            return fallback;
        }

        // Search for a server that advertises the search_names tool or has namerag in its name
        const match = servers.find((s) => {
            const hasTool = Array.isArray(s?.cachedTools) && s.cachedTools.some((t) => t?.name === 'search_names');
            const nameMatch = typeof s?.name === 'string' && /namerag/i.test(s.name);
            return hasTool || nameMatch;
        });

        if (!match) {
            cachedDiscovery = fallback;
            lastDiscoveryTime = now;
            return fallback;
        }

        cachedDiscovery = {
            available: true,
            serverName: match.name,
            isRunning: !!match.isRunning,
            tools: match.cachedTools || [],
        };
        lastDiscoveryTime = now;
        return cachedDiscovery;
    } catch (err) {
        // Quiet failure: do not pollute logs if MCP is simply not running/installed
        cachedDiscovery = fallback;
        lastDiscoveryTime = now;
        return fallback;
    }
}

/**
 * Parses raw tool output from MCP call-tool endpoint into clean candidate objects.
 * Handles string JSON, arrays, and newline-delimited JSON objects.
 * @param {any} raw
 * @returns {Array<{ name: string, gender?: string, vibe?: string, origin?: string, meaning?: string }>}
 */
export function parseNameRagOutput(raw) {
    if (!raw) return [];

    let payload = raw;

    // Unwrap MCP response wrapper: { result: { data: ... } } or { content: [ { type: 'text', text: '...' } ] }
    if (payload?.result?.data !== undefined) payload = payload.result.data;
    else if (payload?.result !== undefined) payload = payload.result;
    else if (payload?.data !== undefined) payload = payload.data;

    if (Array.isArray(payload?.content)) {
        const textParts = payload.content
            .filter((c) => c && (c.type === 'text' || typeof c.text === 'string'))
            .map((c) => c.text);
        if (textParts.length > 0) {
            payload = textParts.join('\n');
        }
    }

    if (Array.isArray(payload)) {
        return payload.map(normalizeCandidate).filter(Boolean);
    }

    if (typeof payload === 'object' && payload !== null) {
        if (Array.isArray(payload.result)) {
            return payload.result.map(normalizeCandidate).filter(Boolean);
        }
        if (payload.name) {
            return [normalizeCandidate(payload)].filter(Boolean);
        }
    }

    if (typeof payload === 'string') {
        const clean = payload.trim();
        if (!clean) return [];

        // Try parsing entire payload as a JSON array or object
        try {
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) return parsed.map(normalizeCandidate).filter(Boolean);
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.result)) return parsed.result.map(normalizeCandidate).filter(Boolean);
                if (parsed.name) return [normalizeCandidate(parsed)].filter(Boolean);
            }
        } catch (_) {
            // Not a single JSON document, try multi-line / chunk parsing below
        }

        // Try extracting JSON objects separated by newlines or whitespace: {...}\n{...}
        const candidates = [];
        const regex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        let match;
        while ((match = regex.exec(clean)) !== null) {
            try {
                const item = JSON.parse(match[0]);
                const norm = normalizeCandidate(item);
                if (norm) candidates.push(norm);
            } catch (_) {
                // Ignore unparseable chunks
            }
        }
        if (candidates.length > 0) return candidates;
    }

    return [];
}

/**
 * Normalizes a single raw name item into a standard shape.
 */
function normalizeCandidate(item) {
    if (!item || typeof item !== 'object') return null;
    const name = String(item.name || item.Name || '').trim();
    if (!name) return null;

    let vibe = item.vibe || item.Vibe || '';
    let origin = item.origin || item.Origin || '';
    let meaning = item.meaning || item.Meaning || '';
    const gender = item.gender || item.Gender || '';

    // If vibe contains formatted segments (e.g. "Name: ... | Origin: ... | Meaning: ... | Vibe: ..."), extract them
    if (typeof vibe === 'string' && vibe.includes('|')) {
        const origMatch = vibe.match(/Origin:\s*([^|]+)/i);
        if (origMatch && !origin) origin = origMatch[1].trim();

        const meanMatch = vibe.match(/Meaning:\s*([^|]+)/i);
        if (meanMatch && !meaning) meaning = meanMatch[1].trim();

        const vibeMatch = vibe.match(/Vibe:\s*(.+)$/i);
        if (vibeMatch) vibe = vibeMatch[1].trim();
    }

    return {
        name,
        gender: gender || 'Dual',
        vibe: vibe || '',
        origin: origin || '',
        meaning: meaning || '',
    };
}

/**
 * Calls NameRAG's search_names tool via the discovered SillyTavern MCP server.
 * @param {object} opts
 * @param {string} opts.query Character vibe, role, or background description
 * @param {number} [opts.limit=5] Max names to return
 * @param {string} [opts.gender] Optional 'M', 'F', or 'Dual'
 * @param {string} [opts.starts_with]
 * @param {number} [opts.min_length]
 * @param {number} [opts.max_length]
 * @param {string} [opts.origin]
 * @returns {Promise<Array<{ name: string, gender: string, vibe: string, origin: string, meaning: string }>>}
 */
export async function searchNames(opts = {}) {
    const discovery = await discoverNameRagServer();
    if (!discovery.available || !discovery.serverName) {
        return [];
    }

    const { serverName } = discovery;
    const args = {
        query: opts.query || 'adventurer hero',
        limit: Number(opts.limit) || 5,
    };
    if (opts.gender) args.gender = opts.gender;
    if (opts.starts_with) args.starts_with = opts.starts_with;
    if (opts.min_length) args.min_length = Number(opts.min_length);
    if (opts.max_length) args.max_length = Number(opts.max_length);
    if (opts.origin) args.origin = opts.origin;

    const executeCall = async () => {
        const res = await fetch(`/api/plugins/${PLUGIN_ID}/servers/${encodeURIComponent(serverName)}/call-tool`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                toolName: 'search_names',
                arguments: args,
            }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    };

    try {
        const data = await executeCall();
        return parseNameRagOutput(data);
    } catch (err) {
        // If server is not running, attempt one start-and-retry
        if (/not running/i.test(err?.message)) {
            try {
                await fetch(`/api/plugins/${PLUGIN_ID}/servers/${encodeURIComponent(serverName)}/start`, {
                    method: 'POST',
                    headers: getHeaders(),
                });
                const retryData = await executeCall();
                return parseNameRagOutput(retryData);
            } catch (_) {
                return [];
            }
        }
        console.warn('[MultiHog Companion] NameRAG query failed:', err.message);
        return [];
    }
}

/**
 * Tests NameRAG connectivity and returns status + sample result.
 * @param {string} [testQuery='robed wizard']
 * @returns {Promise<{ ok: boolean, serverName?: string, sample?: any, error?: string }>}
 */
export async function testNameRagConnection(testQuery = 'robed wizard') {
    const discovery = await discoverNameRagServer(true);
    if (!discovery.available || !discovery.serverName) {
        return { ok: false, error: 'NameRAG server not found in SillyTavern MCP configuration.' };
    }

    try {
        const results = await searchNames({ query: testQuery, limit: 1 });
        if (results && results.length > 0) {
            return {
                ok: true,
                serverName: discovery.serverName,
                sample: results[0],
            };
        }
        return {
            ok: false,
            serverName: discovery.serverName,
            error: 'Server responded but returned 0 candidates.',
        };
    } catch (err) {
        return {
            ok: false,
            serverName: discovery.serverName,
            error: err.message || 'Connection error',
        };
    }
}
