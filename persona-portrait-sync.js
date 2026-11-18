/// <reference path="./types.d.ts" />
/**
 * persona-portrait-sync.js — MultiHog Companion
 *
 * Handles SillyTavern persona chat-locking (`FEAT-07`), portrait image fetching,
 * multipart avatar upload (`/api/avatars/upload`), thumbnail cache invalidation,
 * DOM `<img>` cache-busting, and idempotent per-chat sync metadata tracking.
 */

function defaultShowToast(type, message, title = 'MultiHog Companion') {
    const ext = globalThis.extension_settings?.multihog_companion;
    if (ext && ext.showToasts === false) return;
    if (typeof toastr !== 'undefined' && toastr[type]) {
        toastr[type](message, title, {
            timeOut: 3200,
            extendedTimeOut: 1200,
            closeButton: true,
            preventDuplicates: true,
            progressBar: false,
        });
    }
}

/**
 * Bind the persona to the active chat and set it active if not already.
 *
 * @param {string} chatId
 * @param {{ name: string, avatar: string }} persona
 * @param {{ showToast?: (type: string, message: string, title?: string) => void }} [opts={}]
 * @returns {Promise<boolean>}
 */
export async function syncPersonaToChat(chatId, persona, opts = {}) {
    const notify = typeof opts.showToast === 'function' ? opts.showToast : defaultShowToast;
    const ctx = SillyTavern.getContext();
    const currentBound = ctx.chatMetadata?.persona;

    if (currentBound === persona.avatar) {
        return false;
    }

    console.log(`[MultiHog Companion] Locking persona "${persona.name}" (${persona.avatar}) to chat ${chatId}`);

    try {
        const { setUserAvatar, user_avatar } = await import('../../../personas.js');
        if (user_avatar !== persona.avatar) {
            await setUserAvatar(persona.avatar);
        }
    } catch (err) {
        console.warn('[MultiHog Companion] setUserAvatar failed:', err);
    }

    if (ctx.chatMetadata) {
        ctx.chatMetadata.persona = persona.avatar;
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
        }
    }

    try {
        if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions('/persona-lock on');
        }
    } catch (err) {
        console.warn('[MultiHog Companion] /persona-lock on failed:', err);
    }

    notify('info', `Bound persona "${persona.name}" to this chat.`);
    return true;
}

/**
 * Upload the image blob to the persona avatar file on SillyTavern server,
 * reload cached persona thumbnails, repaint matching DOM `<img>` nodes,
 * and emit `PERSONA_UPDATED`.
 *
 * @param {string} avatarId
 * @param {string} imageSrc
 * @returns {Promise<boolean>}
 */
export async function uploadImageToPersona(avatarId, imageSrc) {
    const ctx = SillyTavern.getContext();
    const getRequestHeaders = ctx.getRequestHeaders;

    let blob;
    if (imageSrc.startsWith('data:image/')) {
        const res = await fetch(imageSrc);
        blob = await res.blob();
    } else {
        const url = (imageSrc.startsWith('http://') || imageSrc.startsWith('https://') || imageSrc.startsWith('/'))
            ? imageSrc
            : `/${imageSrc}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch portrait from ${url}: ${res.statusText}`);
        }
        blob = await res.blob();
    }

    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('overwrite_name', avatarId);

    const uploadResponse = await fetch('/api/avatars/upload', {
        method: 'POST',
        headers: getRequestHeaders ? getRequestHeaders({ omitContentType: true }) : {},
        cache: 'no-cache',
        body: formData,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Persona avatar upload failed: ${uploadResponse.statusText}`);
    }

    try {
        const [{ getUserAvatar, getUserAvatars }, scriptMod] = await Promise.all([
            import('../../../personas.js').catch(() => ({})),
            import('../../../../script.js').catch(() => ({})),
        ]);
        if (typeof getUserAvatar === 'function') {
            await fetch(getUserAvatar(avatarId), { cache: 'reload' }).catch(() => {});
        }
        const thumbUrl = typeof scriptMod?.getThumbnailUrl === 'function'
            ? scriptMod.getThumbnailUrl('persona', avatarId)
            : `/thumbnail?type=persona&file=${encodeURIComponent(avatarId)}`;
        if (thumbUrl) {
            await fetch(thumbUrl, { cache: 'reload' }).catch(() => {});
        }
        if (typeof getUserAvatars === 'function') {
            await getUserAvatars(true, avatarId).catch(() => {});
        }
    } catch (_) {}

    // Force DOM repaint with timestamp cache buster
    try {
        const bust = String(Date.now());
        const updateSrcWithCacheBust = (src) => {
            if (!src) return src;
            try {
                const dummyBase = 'http://st.local';
                const parsed = new URL(src, dummyBase);
                parsed.searchParams.set('t', bust);
                if (src.startsWith('http://') || src.startsWith('https://')) {
                    return parsed.href;
                }
                return parsed.pathname + parsed.search;
            } catch (_) {
                const sep = src.includes('?') ? '&' : '?';
                return `${src}${sep}t=${bust}`;
            }
        };

        // Target ONLY elements belonging to this avatar, avoiding indiscriminate selection of #user_avatar_block
        const safeAvatarId = (avatarId || '').replace(/"/g, '\\"');
        const encodedAvatarId = encodeURIComponent(avatarId || '').replace(/"/g, '\\"');
        const selectors = [
            `.mes[is_user="true"] .avatar img`,
            `#avatar`,
            `#user_avatar_block [data-avatar-id="${safeAvatarId}"] img`,
            `img[src*="${safeAvatarId}"]`,
            `#quickPersonaImg`,
        ];
        if (encodedAvatarId && encodedAvatarId !== safeAvatarId) {
            selectors.push(`img[src*="${encodedAvatarId}"]`);
        }
        const selector = selectors.join(', ');

        if (typeof $ !== 'undefined') {
            $(selector).each(function () {
                const currentSrc = $(this).attr('src') || '';
                $(this).attr('src', updateSrcWithCacheBust(currentSrc));
            });
        } else if (typeof document !== 'undefined') {
            document.querySelectorAll(selector).forEach(el => {
                const currentSrc = el.getAttribute('src') || '';
                el.setAttribute('src', updateSrcWithCacheBust(currentSrc));
            });
        }
    } catch (_) {}

    try {
        if (ctx.eventSource && ctx.eventTypes?.PERSONA_UPDATED) {
            await ctx.eventSource.emit(ctx.eventTypes.PERSONA_UPDATED, avatarId);
        }
    } catch (_) {}

    return true;
}

/**
 * Sync portrait from MultiHog into SillyTavern persona.
 * Skips execution if the portrait is already recorded as synced unless opts.force is true.
 *
 * @param {string} chatId
 * @param {{ name: string, avatar: string }} persona
 * @param {string} portraitSrc
 * @param {{ force?: boolean, showToast?: (type: string, message: string, title?: string) => void }} [opts={}]
 * @returns {Promise<boolean>}
 */
export async function syncPortraitToPersona(chatId, persona, portraitSrc, opts = {}) {
    const notify = typeof opts.showToast === 'function' ? opts.showToast : defaultShowToast;
    const ctx = SillyTavern.getContext();
    const meta = ctx.chatMetadata?.multihog_companion || {};

    if (!opts.force && meta.synced_portrait === portraitSrc && meta.synced_persona === persona.avatar) {
        return false;
    }

    console.log(`[MultiHog Companion] Syncing portrait to persona "${persona.name}" (${persona.avatar})`);

    await uploadImageToPersona(persona.avatar, portraitSrc);

    if (ctx.chatMetadata) {
        ctx.chatMetadata.multihog_companion = {
            ...ctx.chatMetadata.multihog_companion,
            synced_portrait: portraitSrc,
            synced_persona: persona.avatar,
            synced_at: Date.now(),
        };
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
        }
    }

    notify('success', `Synced portrait for "${persona.name}".`);
    return true;
}
