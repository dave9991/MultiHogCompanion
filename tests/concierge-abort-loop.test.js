import assert from 'node:assert';
import {
    detectRepetition,
    sendRoutedLlmRequest,
    ConciergeLoopError,
    ConciergeTimeoutError,
} from '../concierge-connection.js';

console.log('--- Running Concierge Abort / Loop Detection Test Suite ---');

globalThis.SillyTavern = { getContext: () => ({}) };

// 1. Repetition detector
assert.strictEqual(detectRepetition('A normal short reply.'), false);
const varied = Array.from({ length: 80 }, (_, i) => `line ${i}: unique content number ${i * 7919}`).join('\n');
assert.strictEqual(detectRepetition(varied), false, 'varied text must not trip the detector');
const unit = 'The hero walks into the tavern and orders a drink. ';
assert.strictEqual(detectRepetition('intro\n' + unit.repeat(5)), true, 'adjacent repetition');
const sameLine = Array.from({ length: 8 }, () => 'name: The same long repeated line here').join('\nother: x\n');
assert.strictEqual(detectRepetition(sameLine), true, 'repeated long line');
console.log('✓ detectRepetition');

function ndjsonResponse(chunks, { hang = false, signal } = {}) {
    const enc = new TextEncoder();
    let i = 0;
    return {
        ok: true,
        body: {
            getReader() {
                return {
                    async read() {
                        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                        if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
                        if (hang) {
                            await new Promise((_, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
                        }
                        return { done: true };
                    },
                    releaseLock() {},
                };
            },
        },
    };
}

const settings = { connectionSource: 'ollama', ollamaModel: 'm', ollamaUrl: 'http://x', timeoutSec: 0 };
const msgs = [{ role: 'user', content: 'hi' }];
const realFetch = globalThis.fetch;

// 2. Streams and returns text
globalThis.fetch = async (_u, opts) => {
    assert.strictEqual(JSON.parse(opts.body).stream, true);
    assert.ok(JSON.parse(opts.body).options.num_ctx > 0);
    return ndjsonResponse([
        JSON.stringify({ message: { content: 'Hello ' } }) + '\n',
        JSON.stringify({ message: { content: 'world' }, done: true }) + '\n',
    ]);
};
let seen = 0;
const out = await sendRoutedLlmRequest(settings, msgs, { onProgress: () => seen++ });
assert.strictEqual(out, 'Hello world');
assert.ok(seen >= 2);
console.log('✓ streams & reports progress');

// 3. Loop is aborted
globalThis.fetch = async (_u, opts) => {
    const lines = Array.from({ length: 40 }, () => JSON.stringify({ message: { content: 'The hero walks into the tavern and orders a drink. ' } }) + '\n');
    return ndjsonResponse(lines, { signal: opts.signal });
};
await assert.rejects(() => sendRoutedLlmRequest(settings, msgs, {}), ConciergeLoopError);
console.log('✓ loop aborts with ConciergeLoopError');

// 4. User abort
globalThis.fetch = async (_u, opts) => ndjsonResponse([JSON.stringify({ message: { content: 'hi' } }) + '\n'], { hang: true, signal: opts.signal });
const ac = new AbortController();
const p = sendRoutedLlmRequest(settings, msgs, { signal: ac.signal });
setTimeout(() => ac.abort(), 20);
await assert.rejects(() => p, err => err.name === 'AbortError');
console.log('✓ user abort');

// 5. Timeout
globalThis.fetch = async (_u, opts) => ndjsonResponse([], { hang: true, signal: opts.signal });
await assert.rejects(
    () => sendRoutedLlmRequest({ ...settings, timeoutSec: 0.05 }, msgs, {}),
    ConciergeTimeoutError,
);
console.log('✓ timeout');

// 6. Thinking-only reply gives a clear error
globalThis.fetch = async () => ndjsonResponse([JSON.stringify({ message: { thinking: 'hmm...' }, done: true }) + '\n']);
await assert.rejects(() => sendRoutedLlmRequest(settings, msgs, {}), /token budget thinking/);
console.log('✓ thinking-only reply');

globalThis.fetch = realFetch;
