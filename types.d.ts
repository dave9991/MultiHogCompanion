/**
 * MultiHog Companion — Shared Ambient TypeScript / JSDoc Declarations
 * Zero-build type definitions for IDE autocomplete and `tsc --noEmit` checking.
 */

type RulesetId = 'pbta' | 'fae' | 'dnd5e' | (string & {});

type DossierStageId = 'initial' | 'canon' | 'adventure' | 'character';

interface DossierStageNotes {
    framing: string;
    canon: string;
    adventure: string;
    [key: string]: string;
}

interface DossierMeta {
    title: string;
    ruleset: RulesetId;
    systemKey: string;
    systemLabel: string;
    genreEstablished: boolean;
    premise: string;
    tone: string;
    focalLens: string;
    framingComplete: boolean;
    rulesetConfirmed: boolean;
    stageNotes: DossierStageNotes;
    createdAt: number;
    [key: string]: any;
}

interface DossierHarm {
    max: number;
    current: number;
    armor: number;
}

interface FaeResourcePool {
    key: string;
    label: string;
    current: number;
    max: number;
    recovery?: string;
    zero_debuff?: string;
    on_overflow?: string;
    barColor?: string;
    passive_drain?: string | null;
    strain_flavor?: string;
    [key: string]: any;
}

interface DossierProtagonist {
    name: string;
    playbook?: string;
    archetype?: string;
    className?: string;
    level?: number;
    hitDie?: string;
    species?: string;
    gender?: string;
    appearance?: string;
    equipment?: string;
    personality?: string;
    habits?: string;
    bio?: string;
    background?: string;
    portraitSrc?: string | null;
    stats?: Record<string, number>;
    harm?: DossierHarm;
    status?: string;
    conditions?: string[];
    startingMoves?: string[];
    features?: string[];
    abilities?: string[];
    gear?: string[];
    pools?: Record<string, FaeResourcePool>;
    positiveTags?: string[];
    negativeTags?: string[];
    heroicDomain?: string;
    [key: string]: any;
}

interface DossierNpc {
    name: string;
    role?: string;
    archetype?: string;
    gender?: string;
    species?: string;
    appearance?: string;
    equipment?: string;
    demeanor?: string;
    relationship?: string;
    friendship?: number;
    affection?: number;
    background?: string;
    movesOrBoons?: string;
    notes?: string;
    harm?: DossierHarm;
    status?: string;
    conditions?: string[];
    portraitSrc?: string | null;
    [key: string]: any;
}

interface DossierMonster {
    name: string;
    harm?: number | DossierHarm;
    currentHarm?: number;
    armor?: number;
    attacks?: string[];
    weakness?: string;
    notes?: string;
    status?: string;
    conditions?: string[];
    impendingDoom?: string[];
    threatLevel?: number | null;
    layers?: number;
    currentLayers?: number;
    poolsAtRisk?: string[] | null;
    pressures?: string[];
    instinct?: string;
    leverageBarriers?: string[];
    fullFinishTriggers?: string;
    [key: string]: any;
}

interface DossierFaction {
    name: string;
    agenda?: string;
    standing?: string;
    notes?: string;
    [key: string]: any;
}

interface DossierMapSite {
    site: string;
    kind?: string;
    threat?: string;
    entrance?: string;
    briefDescription?: string;
    [key: string]: any;
}

interface DossierWorldAxiom {
    id?: string;
    category?: string;
    title: string;
    axiom: string;
    substitutions?: string[];
    negativeConstraints?: string[];
    architecturalNotes?: string;
    [key: string]: any;
}

interface DossierCustomModule {
    name?: string;
    tag: string;
    fieldKey?: string;
    label: string;
    icon?: string;
    instruction?: string;
    gmContent?: string;
    sampleContent?: string;
    sample?: string;
    drivers?: {
        gmAnnotation?: boolean;
        time?: boolean;
        statedFact?: boolean;
        [key: string]: any;
    };
    effectOwner?: string;
    [key: string]: any;
}

interface DossierContemplation {
    coreTension: string;
    worldConsequences: string;
    webOfEntanglement: string;
    kickPressure: string;
}

interface DossierMaxHarmFate {
    rule: string;
    statusToken: string;
    cyoaStyle?: string;
}

interface DossierConfig {
    playstyle?: string;
    harmMax?: number;
    partyMode?: string;
    simulationDepth?: string;
    actionTempo?: string;
    pacingXp?: number;
    pacingScenes?: number;
    cyoaEmojis?: boolean;
    relationships?: boolean;
    artStyle?: string;
    maxHarmFate?: DossierMaxHarmFate;
    heroicTier?: boolean;
    heroic_tier?: boolean;
    knobs?: {
        flee_grace_toggle?: boolean;
        base_attrition_shift?: number;
        overflow_default?: string;
        action_tempo?: string;
        heroic_tier?: boolean;
        [key: string]: any;
    };
    [key: string]: any;
}

interface CompanionDossier {
    meta: DossierMeta;
    protagonist: DossierProtagonist;
    npcs: DossierNpc[];
    monsters: DossierMonster[];
    maps: DossierMapSite[];
    factions: DossierFaction[];
    theKick: {
        startingLocation: string;
        crisis: string;
        openingPrompt: string;
    };
    cyoaExamples: string[];
    worldRules: {
        axioms: DossierWorldAxiom[];
        customModule: DossierCustomModule | null;
    };
    contemplation: DossierContemplation;
    config: DossierConfig;
    pools?: Record<string, FaeResourcePool>;
    character?: Record<string, any>;
    knobs?: Record<string, any>;
    [key: string]: any;
}

interface ChatPartition {
    companionDossier?: CompanionDossier;
    campaignDossier?: CompanionDossier;
    pbtaCampaignDossier?: CompanionDossier;
    faeCampaignDossier?: CompanionDossier;
    activeCartridge?: RulesetId;
    ruleset?: RulesetId;
    pbtaGenre?: string;
    faeGenre?: string;
    pbtaWorldBooks?: string[];
    campaignPrefix?: string;
    currentMemo?: string;
    customSyspromptLibrary?: any[];
    syspromptSnippetDatabase?: any[];
    [key: string]: any;
}

interface RpgTrackerSettings {
    enabled?: boolean;
    currentMemo?: string;
    chatStateProjectionOwner?: string | null;
    chatStates?: Record<string, ChatPartition>;
    syspromptModules?: Record<string, any>;
    customSyspromptLibrary?: any[];
    syspromptSnippetDatabase?: any[];
    setupSnapshots?: Record<string, any>;
    stockPrompts?: Record<string, any>;
    [key: string]: any;
}

interface MultiHogCompanionSettings {
    boundPersonas?: Record<string, string>;
    lockedChats?: Record<string, boolean>;
    [key: string]: any;
}

interface SillyTavernContext {
    chatId?: string;
    characterId?: number;
    characters?: Array<{ name?: string; avatar?: string; [key: string]: any }>;
    chat?: Array<Record<string, any>>;
    chatMetadata?: Record<string, any>;
    extensionSettings?: {
        rpg_tracker?: RpgTrackerSettings;
        multihog_companion?: MultiHogCompanionSettings;
        [key: string]: any;
    };
    eventSource?: {
        on?: (event: string, handler: (...args: any[]) => any) => any;
        makeFirst?: (event: string, handler: (...args: any[]) => any) => any;
        emit?: (event: string, ...args: any[]) => any;
    };
    event_types?: Record<string, string>;
    getCurrentChatId?: () => string | null | undefined;
    saveSettingsDebounced?: () => void;
    saveMetadataDebounced?: () => void;
    [key: string]: any;
}

interface SessionZeroTrackState {
    dossier: CompanionDossier;
    chatHistory: Array<Record<string, any>>;
    changelog: string[];
    currentAdventureStep: DossierStageId;
    unlockedSteps: Record<DossierStageId, boolean>;
    stageChatHistories: Record<DossierStageId, Array<Record<string, any>>>;
    lastSyncedSnapshots: {
        framing: any;
        canon: any;
        adventure: any;
    };
    attachedSources: any[];
    stagedCanonEntries: any[];
    pendingAttachments: any[];
    activeImports: any[];
    rulesetConfirmed: boolean;
}

interface LivingWorldTrackState {
    chatId: string | null;
    campaignTitle: string | null;
    dossier: CompanionDossier | null;
    chatHistory: Array<Record<string, any>>;
    stagedCanonEntries: any[];
}

declare var SillyTavern: {
    getContext?: () => SillyTavernContext;
    [key: string]: any;
} | undefined;

declare var toastr: {
    info?: (msg: string, title?: string, opts?: Record<string, any>) => any;
    success?: (msg: string, title?: string, opts?: Record<string, any>) => any;
    warning?: (msg: string, title?: string, opts?: Record<string, any>) => any;
    error?: (msg: string, title?: string, opts?: Record<string, any>) => any;
} | undefined;

declare var $: ((selector: any) => any) & Record<string, any>;
declare var jQuery: typeof $;
declare var _rpgCurrentChatId: (() => string | null | undefined) | undefined;
