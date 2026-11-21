/// <reference path="./types.d.ts" />
/**
 * concierge-state-store.js — MultiHog Companion
 *
 * Deterministic Two-Track State Store for the Concierge modal:
 * - Session Zero Sandbox Track (new-adventure)
 * - Active Living World Track (living-world)
 *
 * [CATALOG: FEAT-02] See FEATURES.md — Concierge Session Zero & Living World Dossier
 */

import { createEmptyDossier, isDossierEmptyOrUntouched, healAndNormalizeDossier } from './concierge-parser.js';

/**
 * Builds a clean Session Zero track state object.
 * @param {object|null} [dossier=null]
 * @returns {object}
 */
export function createEmptySessionZeroTrack(dossier = null) {
    const effectiveDossier = dossier || createEmptyDossier();
    return {
        dossier: effectiveDossier,
        chatHistory: [],
        changelog: [],
        currentAdventureStep: 'initial',
        unlockedSteps: { initial: true, canon: false, adventure: false, character: false },
        stageChatHistories: { initial: [], canon: [], adventure: [], character: [] },
        lastSyncedSnapshots: { framing: null, canon: null, adventure: null },
        attachedSources: [],
        stagedCanonEntries: [],
        pendingAttachments: [],
        activeImports: [],
        rulesetConfirmed: Boolean(effectiveDossier?.meta?.rulesetConfirmed),
    };
}

/**
 * Builds a clean Living World track state object.
 * @returns {object}
 */
export function createEmptyLivingWorldTrack() {
    return {
        chatId: null,
        campaignTitle: null,
        dossier: null,
        chatHistory: [],
        stagedCanonEntries: [],
    };
}

/**
 * Encapsulates Session Zero and Living World track snapshots and transitions
 * so switching tracks or forking never leaks properties across tracks.
 */
export class ConciergeStateStore {
    constructor() {
        this.sessionZeroTrack = createEmptySessionZeroTrack();
        this.livingWorldTrack = createEmptyLivingWorldTrack();
    }

    /**
     * Captures the active in-progress Session Zero fields into `sessionZeroTrack`.
     * @param {object} state
     * @param {Array} [stagedCanonEntries=[]]
     * @returns {object}
     */
    snapshotToSessionZero(state = {}, stagedCanonEntries = []) {
        const track = this.sessionZeroTrack;
        track.dossier = state.dossier || createEmptyDossier();
        track.chatHistory = [...(state.chatHistory || [])];
        track.changelog = [...(state.changelog || [])];
        track.currentAdventureStep = state.currentAdventureStep || 'initial';
        track.unlockedSteps = { ...(state.unlockedSteps || { initial: true, canon: false, adventure: false, character: false }) };
        track.stageChatHistories = { ...(state.stageChatHistories || { initial: [], canon: [], adventure: [], character: [] }) };
        track.lastSyncedSnapshots = { ...(state.lastSyncedSnapshots || { framing: null, canon: null, adventure: null }) };
        track.attachedSources = [...(state.attachedSources || [])];
        track.stagedCanonEntries = Array.isArray(stagedCanonEntries) ? [...stagedCanonEntries] : [];
        track.pendingAttachments = [...(state.pendingAttachments || [])];
        track.activeImports = [...(state.activeImports || [])];
        track.rulesetConfirmed = Boolean(track.dossier?.meta?.rulesetConfirmed);
        return track;
    }

    /**
     * Returns cloned state fields from `sessionZeroTrack` ready to restore into the UI controller.
     * @returns {object}
     */
    restoreFromSessionZero() {
        const track = this.sessionZeroTrack;
        return {
            dossier: track.dossier,
            chatHistory: track.chatHistory || [],
            changelog: track.changelog || [],
            currentAdventureStep: track.currentAdventureStep || 'initial',
            unlockedSteps: { ...(track.unlockedSteps || { initial: true, canon: false, adventure: false, character: false }) },
            stageChatHistories: { ...(track.stageChatHistories || { initial: [], canon: [], adventure: [], character: [] }) },
            lastSyncedSnapshots: { ...(track.lastSyncedSnapshots || { framing: null, canon: null, adventure: null }) },
            attachedSources: [...(track.attachedSources || [])],
            stagedCanonEntries: [...(track.stagedCanonEntries || [])],
            pendingAttachments: [...(track.pendingAttachments || [])],
            activeImports: [...(track.activeImports || [])],
        };
    }

    /**
     * Applies a validated localStorage draft payload into `sessionZeroTrack`.
     * @param {object} draft
     * @returns {object}
     */
    applyDraftToSessionZero(draft) {
        if (!draft || typeof draft !== 'object') return this.sessionZeroTrack;
        const track = this.sessionZeroTrack;
        if (draft.dossier) {
            track.dossier = healAndNormalizeDossier(draft.dossier);
        }
        if (Array.isArray(draft.stagedCanonEntries)) {
            track.stagedCanonEntries = [...draft.stagedCanonEntries];
        }
        if (draft.currentAdventureStep) {
            track.currentAdventureStep = draft.currentAdventureStep;
        }
        if (draft.unlockedSteps && typeof draft.unlockedSteps === 'object') {
            track.unlockedSteps = { ...track.unlockedSteps, ...draft.unlockedSteps };
        }
        if (draft.stageChatHistories && typeof draft.stageChatHistories === 'object') {
            track.stageChatHistories = { ...track.stageChatHistories, ...draft.stageChatHistories };
        }
        if (draft.lastSyncedSnapshots && typeof draft.lastSyncedSnapshots === 'object') {
            track.lastSyncedSnapshots = { ...track.lastSyncedSnapshots, ...draft.lastSyncedSnapshots };
        }
        if (Array.isArray(draft.attachedSources)) {
            track.attachedSources = [...draft.attachedSources];
        }
        track.chatHistory = Array.isArray(draft.chatHistory) ? [...draft.chatHistory] : [];
        track.changelog = Array.isArray(draft.changelog) ? [...draft.changelog] : [];
        track.rulesetConfirmed = Boolean(track.dossier?.meta?.rulesetConfirmed);
        return track;
    }

    /**
     * Checks whether `sessionZeroTrack` contains unsaved or in-progress user work.
     * @returns {boolean}
     */
    hasSessionZeroProgress() {
        return (Array.isArray(this.sessionZeroTrack.chatHistory) && this.sessionZeroTrack.chatHistory.length > 0)
            || !isDossierEmptyOrUntouched(this.sessionZeroTrack.dossier);
    }

    /**
     * Hydrates `livingWorldTrack` from a loaded active campaign dossier.
     * @param {string} chatId
     * @param {object} healedDossier
     * @returns {object}
     */
    hydrateLivingWorld(chatId, healedDossier) {
        const track = this.livingWorldTrack;
        track.chatId = chatId;
        track.dossier = healedDossier;
        track.dossier.meta = track.dossier.meta || {};
        track.dossier.meta.rulesetConfirmed = true;
        track.campaignTitle = (track.dossier.meta?.title || '').trim();
        track.dossier._originChatId = chatId;
        track.dossier._originCampaignTitle = track.campaignTitle;
        track.stagedCanonEntries = Array.isArray(track.dossier.canonLorebookEntries)
            ? [...track.dossier.canonLorebookEntries]
            : [];

        if (!track.chatHistory.length) {
            const isFae = track.dossier.meta?.ruleset === 'fae';
            const vitalityTerm = isFae ? 'resource pools' : 'Harm capacity';
            const greet = `📂 Loaded active campaign **"${track.campaignTitle || 'Active Campaign'}"**! You can adjust campaign calibration dials, scale ${vitalityTerm}, manage supporting NPCs, or evolve the blueprint below. Changes can be synced directly back to your running game with **🔄 Sync to Active Game**, or cloned into a fresh adventure with **🍴 Fork as New Campaign**.`;
            track.chatHistory = [{ role: 'assistant', content: greet }];
        }
        return track;
    }

    /**
     * Captures active Living World mutations before switching back to Session Zero.
     * @param {{ dossier?: object, chatHistory?: Array }} state
     * @returns {object}
     */
    snapshotToLivingWorld({ dossier = null, chatHistory = [] } = {}) {
        this.livingWorldTrack.dossier = dossier;
        this.livingWorldTrack.chatHistory = [...(chatHistory || [])];
        return this.livingWorldTrack;
    }

    /**
     * Clones an active campaign dossier into `sessionZeroTrack` for branching into a new adventure.
     * @param {object} sourceDossier
     * @returns {object}
     */
    forkToSessionZero(sourceDossier) {
        const clone = JSON.parse(JSON.stringify(sourceDossier));
        delete clone._originChatId;
        delete clone._originCampaignTitle;
        if (clone.meta) {
            delete clone.meta.chatId;
            const baseTitle = (clone.meta.title || 'Campaign').trim();
            clone.meta.title = baseTitle.endsWith('(Fork)') ? baseTitle : `${baseTitle} (Fork)`;
            clone.meta.rulesetConfirmed = false;
        }

        const track = this.sessionZeroTrack;
        track.dossier = clone;
        track.currentAdventureStep = 'initial';
        track.unlockedSteps = {
            initial: true,
            canon: true,
            adventure: true,
            character: true,
        };
        track.stagedCanonEntries = Array.isArray(clone.canonLorebookEntries) ? [...clone.canonLorebookEntries] : [];
        track.attachedSources = [];
        track.lastSyncedSnapshots = { framing: null, canon: null, adventure: null };
        track.rulesetConfirmed = false;

        const greet = `🍴 **Forked from "${this.livingWorldTrack.campaignTitle || 'Active Campaign'}"!**\n\nThe series bible, axioms, and world elements have been cloned into Session Zero Concierge. You can refine the framing and premise in Step 1, review canon in Step 2, and confirm or tune your ruleset & dials in Step 3.`;
        track.chatHistory = [{ role: 'assistant', content: greet }];
        track.stageChatHistories = {
            initial: [...track.chatHistory],
            canon: [],
            adventure: [],
            character: [],
        };
        return track;
    }
}

export const conciergeStore = new ConciergeStateStore();

/**
 * Returns the Session Zero Sandbox track state object.
 * @returns {object}
 */
export function getSessionZeroTrack() {
    return conciergeStore.sessionZeroTrack;
}

/**
 * Returns the Active Living World track state object.
 * @returns {object}
 */
export function getLivingWorldTrack() {
    return conciergeStore.livingWorldTrack;
}
