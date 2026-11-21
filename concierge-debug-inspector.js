/**
 * concierge-debug-inspector.js — MultiHog Companion
 *
 * Renders the latest Builder transaction state into the in-modal debug inspector DOM.
 */

import { escapeHtml } from './mhc-utils.js';

/**
 * Renders the latest Builder transaction state into the in-modal debug inspector.
 *
 * @param {object|null|undefined} tx
 * @param {{ activeDossier?: object|null }} [options]
 */
export function renderDebugInspectorDom(tx, { activeDossier = null } = {}) {
    // 1. In-Modal Tab Elements
    const modalBadge = $('#mhc_debug_status_badge');
    const modalTime = $('#mhc_debug_timestamp');
    const modalSummary = $('#mhc_debug_summary_text');
    const modalChanges = $('#mhc_debug_changes_list');
    const modalErrors = $('#mhc_debug_errors_list');
    const modalCritiqueBadge = $('#mhc_debug_critique_badge');
    const modalContempBox = $('#mhc_debug_contemplation_box');
    const modalRaw = $('#mhc_debug_raw_output');
    const modalAttempts = $('#mhc_debug_attempt_count');
    const modalPrompt = $('#mhc_debug_prompt_input');
    const modalDossier = $('#mhc_debug_dossier_json');
    const modalNameRagCount = $('#mhc_debug_namerag_count');
    const modalNameRagList = $('#mhc_debug_namerag_list');

    if (!tx) {
        modalBadge.text('Awaiting Turn').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc', borderColor: 'rgba(156,163,175,0.4)' });
        modalTime.text('--:--:--');
        modalSummary.text('No build transactions recorded yet.');
        modalChanges.empty();
        modalErrors.empty();
        modalCritiqueBadge.text('Not Evaluated').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalContempBox.html('<div style="opacity: 0.6; font-style: italic;">No architectural contemplation or judge critique recorded yet.</div>');
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalNameRagList.html('<div style="opacity: 0.6; font-style: italic;">No name placeholders resolved in this transaction.</div>');
        modalRaw.text('(No raw Builder response captured yet)');
        modalAttempts.text('Attempt 0/2');
        modalPrompt.text('(No prompt recorded yet)');
        modalDossier.text(JSON.stringify(activeDossier || {}, null, 2));
        return;
    }

    const attempts = tx.attempts || [];
    const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
    const rawText = lastAttempt?.rawResponse || '(empty)';
    const status = tx.finalStatus || 'UNKNOWN';
    const timeFormatted = tx.timestamp
        ? (typeof tx.timestamp === 'string' && tx.timestamp.includes(':') && !tx.timestamp.includes('T') ? tx.timestamp : new Date(tx.timestamp).toLocaleTimeString())
        : '--:--:--';

    let badgeColor = '#ccc';
    let badgeBg = 'rgba(150,150,150,0.2)';
    let badgeBorder = 'rgba(255,255,255,0.15)';

    if (status === 'MUTATED' || status === 'CANON_INGEST') {
        badgeColor = '#4ade80';
        badgeBg = 'rgba(34, 197, 94, 0.2)';
        badgeBorder = 'rgba(34, 197, 94, 0.4)';
    } else if (status === 'NOOP') {
        badgeColor = '#60a5fa';
        badgeBg = 'rgba(59, 130, 246, 0.2)';
        badgeBorder = 'rgba(59, 130, 246, 0.4)';
    } else if (status === 'SYNTAX_ERROR') {
        badgeColor = '#f87171';
        badgeBg = 'rgba(239, 68, 68, 0.2)';
        badgeBorder = 'rgba(239, 68, 68, 0.4)';
    } else if (status === 'UNRECOGNIZED_OUTPUT') {
        badgeColor = '#fbbf24';
        badgeBg = 'rgba(245, 158, 11, 0.2)';
        badgeBorder = 'rgba(245, 158, 11, 0.4)';
    }

    modalBadge.text(status).css({ color: badgeColor, background: badgeBg, borderColor: badgeBorder });
    modalTime.text(timeFormatted);
    modalSummary.text(tx.builderSummary || tx.summary || 'No summary available');

    modalChanges.empty();
    const changes = lastAttempt?.report?.changes || [];
    if (changes.length) {
        modalChanges.html(`<b>Mutations:</b> ${changes.map(c => `• ${escapeHtml(c)}`).join(' ')}`);
    } else if (lastAttempt?.deduplication?.length) {
        const dedupHtml = lastAttempt.deduplication.map(d =>
            d.action === 'separate'
                ? `• Kept separate: <b>${escapeHtml(d.nameA)}</b> & <b>${escapeHtml(d.nameB)}</b> <i>(${escapeHtml(d.reason)})</i>`
                : `• Linked: <b>${escapeHtml(d.canonical)}</b> ← <b>${escapeHtml(d.absorbed)}</b> <i>(${escapeHtml(d.reason)})</i>`
        ).join('<br>');
        modalChanges.html(`<b>Deduplication / Entity Consolidation:</b><br>${dedupHtml}`);
    }

    modalErrors.empty();
    const errors = lastAttempt?.report?.errors || lastAttempt?.errors || [];
    if (errors.length) {
        modalErrors.html(`<b>Errors:</b> ${errors.map(e => `⚠️ ${escapeHtml(e)}`).join('; ')}`);
    }

    // Contemplation & Blueprint Judge Critique
    const contemp = tx.contemplation || tx.activeDossierSnapshot?.contemplation;
    const critique = tx.critique;
    const contempParts = [];
    if (contemp && (contemp.coreTension || contemp.worldConsequences || contemp.webOfEntanglement || contemp.kickPressure)) {
        contempParts.push(`
            <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(192, 132, 252, 0.25); border-radius: 4px; padding: 6px 8px;">
                <div style="font-weight: 600; color: #e9d5ff; margin-bottom: 3px;">🧠 Pass 1 Architectural Scratchpad</div>
                ${contemp.coreTension ? `<div><b>Core Tension:</b> ${escapeHtml(contemp.coreTension)}</div>` : ''}
                ${contemp.worldConsequences ? `<div><b>World Consequences:</b> ${escapeHtml(contemp.worldConsequences)}</div>` : ''}
                ${contemp.webOfEntanglement ? `<div><b>Web of Entanglement:</b> ${escapeHtml(contemp.webOfEntanglement)}</div>` : ''}
                ${contemp.kickPressure ? `<div><b>Kick Pressure:</b> ${escapeHtml(contemp.kickPressure)}</div>` : ''}
            </div>
        `);
    }
    if (critique) {
        const isRevise = Boolean(critique.shouldRevise);
        const refinerApplied = Boolean(tx.refinerPass?.hasMutations);
        if (refinerApplied) {
            modalCritiqueBadge.text(`REFINED (Pass 2 · ${critique.score}/100 ${critique.grade || 'C'})`).css({
                background: 'rgba(168, 85, 247, 0.25)',
                color: '#c084fc',
            });
        } else {
            modalCritiqueBadge.text(`${critique.grade || 'B'} (${critique.score}/100 · ${critique.verdict})`).css({
                background: isRevise ? 'rgba(251, 191, 36, 0.2)' : 'rgba(74, 222, 128, 0.2)',
                color: isRevise ? '#fbbf24' : '#4ade80',
            });
        }
        contempParts.push(`
            <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(250, 204, 21, 0.25); border-radius: 4px; padding: 6px 8px;">
                <div style="font-weight: 600; color: #fde047; margin-bottom: 3px;">⚖️ ${refinerApplied ? 'Pass 1 Judge Critique' : 'Judge Verdict'}: ${escapeHtml(critique.verdict)} (${critique.score}/100 · ${escapeHtml(critique.grade)})${refinerApplied ? ' <span style="color: #c084fc; font-weight: normal; font-size: 0.9em;">(Resolved in Pass 2)</span>' : ''}</div>
                ${critique.strengths?.length ? `<div style="color: #86efac;"><b>Strengths:</b> ${critique.strengths.map(s => escapeHtml(s)).join(' · ')}</div>` : ''}
                ${critique.weaknesses?.length ? `<div style="color: #fca5a5;"><b>Weaknesses:</b> ${critique.weaknesses.map(w => escapeHtml(w)).join(' · ')}</div>` : ''}
                ${critique.directives?.length ? `<div style="color: #93c5fd;"><b>Directives:</b> ${critique.directives.map(d => escapeHtml(d)).join(' · ')}</div>` : ''}
                ${tx.refinerPass?.hasMutations ? `<div style="color: #c4b5fd; margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(168, 85, 247, 0.4);"><b>✅ Pass 2 Refiner Applied (Resolved):</b> ${tx.refinerPass.changes.map(c => escapeHtml(c)).join('; ')}</div>` : ''}
            </div>
        `);
    } else if (contempParts.length > 0) {
        modalCritiqueBadge.text('Scratchpad Active').css({ background: 'rgba(192, 132, 252, 0.2)', color: '#c084fc' });
    } else {
        modalCritiqueBadge.text('Bypassed / Minor Turn').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
    }

    if (contempParts.length > 0) {
        modalContempBox.html(contempParts.join(''));
    } else {
        modalContempBox.html('<div style="opacity: 0.6; font-style: italic;">No architectural contemplation or judge critique recorded in this turn.</div>');
    }

    // Name Diversity Engine (NameRAG) Resolutions
    const resolutions = tx.nameRagResolutions || lastAttempt?.nameRagResolutions || [];
    if (resolutions.length > 0) {
        modalNameRagCount.text(`${resolutions.length} resolved`).css({ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' });
        const itemsHtml = resolutions.map((r) => {
            const candidatesStr = (r.candidates && r.candidates.length)
                ? r.candidates.map(c => c === r.selectedName ? `<b style="color: #4ade80;">${escapeHtml(c)} (picked)</b>` : escapeHtml(c)).join(', ')
                : '(none returned)';
            let genderBadge = '';
            if (r.gender === 'F') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(236, 72, 153, 0.2); color: #f472b6; margin-left: 6px;">♀ Female</span>';
            else if (r.gender === 'M') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; margin-left: 6px;">♂ Male</span>';
            else if (r.gender === 'Dual') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(168, 85, 247, 0.2); color: #c084fc; margin-left: 6px;">⚥ Non-Binary</span>';
            return `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 6px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <div>
                            <span style="font-weight: 600; color: #facc15;">${escapeHtml(r.placeholder)}</span>
                            ${genderBadge}
                        </div>
                        <span style="font-size: 0.85em; opacity: 0.75;">${escapeHtml(r.source || 'NameRAG')}</span>
                    </div>
                    <div style="color: #94a3b8; font-size: 0.9em; margin-bottom: 2px;"><b>Query:</b> <i>"${escapeHtml(r.query || '')}"</i></div>
                    <div style="color: #cbd5e1; font-size: 0.9em;"><b>Pool:</b> ${candidatesStr}</div>
                </div>
            `;
        }).join('');
        modalNameRagList.html(itemsHtml);
    } else {
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        const zeroMsg = tx.stage === 'canon'
            ? '0 NameRAG resolved (Entities preserved verbatim from imported source document).'
            : 'No name placeholders resolved in this transaction.';
        modalNameRagList.html(`<div style="opacity: 0.6; font-style: italic;">${zeroMsg}</div>`);
    }

    modalRaw.text(rawText || tx.rawOutput || '(empty)');
    const pass1Attempts = attempts.filter(a => typeof a?.attempt === 'number').length;
    const extraPasses = attempts.filter(a => typeof a?.attempt !== 'number' && a?.attempt).map(a => String(a.attempt));
    const attemptLabel = tx.stage === 'canon'
        ? 'Attempt 1/1 (Ingest Pass)'
        : (extraPasses.length > 0
            ? `Pass 1 (${pass1Attempts || 1}/2) + ${extraPasses.join(' + ')}`
            : `Attempt ${attempts.length}/2`);
    modalAttempts.text(attemptLabel);
    modalPrompt.text(tx.promptInput ? String(tx.promptInput) : JSON.stringify(tx.builderRequest?.messages || [], null, 2));
    modalDossier.text(JSON.stringify(tx.activeDossierSnapshot || tx.currentDossierSnapshot || activeDossier || {}, null, 2));
}
