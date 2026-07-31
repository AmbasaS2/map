/*
 * 지도 — SillyTavern UI Extension
 * Universal enchanted parchment map for roleplay scenes.
 *
 * - Spell flavor remains English.
 * - Map contents and controls are Korean.
 * - Map state is stored per chat and backed up to a character-shared notebook for cross-device continuity.
 * - RP reflection uses SillyTavern extension prompt injection, not the input box.
 */

const MODULE_NAME = 'marauders_map';
const METADATA_KEY = 'marauders_map_state';
const EXTENSION_ROOT_ID = 'mma-root';
const EXTENSION_PROMPT_KEY = 'marauders_map_active_context';
const FOOTSTEP_LIMIT = 10;
const DEBUG_LOG_LIMIT = 40;
const memoryDebugLogs = [];
const EXTENSION_VERSION = '3.0.0';
const SHARED_NOTEBOOK_KEYS = Object.freeze(['managedItems', 'footstepProfiles', 'trackedPeople', 'recommendations', 'searchResults']);
const DISCOVERY_HISTORY_LIMIT = 30;
const UNCOLLECTED_RECOMMENDATION_LIMIT = 24;
const OUTPUT_MODE_CONFIGS = Object.freeze({
    basic: Object.freeze({
        key: 'basic',
        label: '기본',
        mapMaxTokens: 8000,
        locationRange: '6~9',
        situationRange: '8~12',
        detailsRange: '4~6',
        questRange: '3~5',
        discoveryRange: '5~7',
        discoveryMaxTokens: 5000,
        personSearchMaxTokens: 2500,
    }),
    saver: Object.freeze({
        key: 'saver',
        label: '절약',
        mapMaxTokens: 4000,
        locationRange: '4~7',
        situationRange: '4~10',
        detailsRange: '3~4',
        questRange: '2~3',
        discoveryRange: '3~5',
        discoveryMaxTokens: 2500,
        personSearchMaxTokens: 1500,
    }),
});
const SETTINGS_DEFAULTS = Object.freeze({
    enabled: true,
    connectionProfile: 'main',
    outputMode: 'basic',
    fontScale: 100,
    theme: 'marauder',
});

const THEME_OPTIONS = Object.freeze({
    marauder: {
        key: 'marauder',
        label: "Marauder's Map (HP AU)",
        shortLabel: "Marauder's Map",
        menuIcon: '📜',
        menuTitle: "Marauder's Map",
        activationVariant: 'spell',
        closeText: 'Mischief Managed.',
        idleNote: '낡은 양피지가 조용히 펼쳐진다.',
        activateText: 'I solemnly swear that I am up to no good.',
        castingText: '잉크가 양피지에 스며드는 중...',
        completeText: '지도가 모두 그려졌습니다.',
        readyHint: '주문을 한 번 누르면 지도가 활성화된다.',
        loaderTitle: "Marauder's Map",
        locationInfoIcon: '🎨',
        discoveryUi: {
            icon: '🪄',
            name: 'Revelio',
            question: 'Revelio를 외울까요?',
            confirm: 'Revelio',
            loader: '지도에 감춰진 것을 드러내는 중…',
            panelTitle: 'Revelio로 드러난 것',
        },
    },
    modern: {
        key: 'modern',
        label: 'S.H.I.E.L.D. Field Locator (MCU AU)',
        shortLabel: 'S.H.I.E.L.D. LOCATOR',
        menuIcon: '📍',
        menuTitle: 'S.H.I.E.L.D. Field Locator',
        activationVariant: 'warning',
        closeText: '×',
        idleNote: 'S.H.I.E.L.D. Field Locator는 합법적인 동의하에 위치 추적 서비스를 지원합니다.',
        activateText: '위치 추적 활성화',
        castingText: '위치 추적 서비스를 활성화하는 중...',
        completeText: '모든 타겟의 위치가 파악되었습니다.',
        readyHint: '',
        loaderTitle: 'S.H.I.E.L.D. LOCATOR',
        locationInfoIcon: '⌖',
        discoveryUi: {
            icon: '📡',
            name: '주변 상황 탐색',
            question: '주변 상황을 탐색할까요?',
            confirm: '탐색',
            loader: '주변의 존재와 변화를 포착하는 중…',
            panelTitle: '주변에서 포착된 것',
        },
    },
    bonbon: {
        key: 'bonbon',
        label: 'Bonbon Board',
        shortLabel: 'BONBON BOARD',
        menuIcon: '🎲',
        menuTitle: 'Bonbon Board',
        activationVariant: 'game-box',
        closeText: '×',
        idleNote: '',
        activateText: '봉봉보드 시작하기',
        castingText: '게임을 준비하는 중...',
        completeText: '게임판 준비가 끝났습니다.',
        readyHint: '',
        loaderTitle: 'Bonbon Board',
        locationInfoIcon: '🎨',
        discoveryUi: {
            icon: '🔑',
            name: '열쇠 카드',
            question: '열쇠 카드를 사용할까요?',
            confirm: '사용하기',
            loader: '보드에 숨은 것을 찾는 중...',
            panelTitle: '열쇠 카드로 찾은 것',
        },
    },
});

const EMPTY_MEMORY = Object.freeze({
    map: null,
    // A single per-chat rollback snapshot. This is deliberately not shared
    // through the character notebook: ↩️ means the map immediately before the
    // current chat's latest map-changing refresh, never another chat's map.
    previousMap: null,
    selectedLocationId: null,
    managedItems: [],
    footstepProfiles: {},
    trackedPeople: {},
    recommendations: [],
    searchResults: [],
    discoveries: [],
    discoveryHistory: [],
    discoveryGeneratedAt: null,
    generatedAt: null,
    mapRevision: null,
    lastAction: null,
});

let spellCasting = false;
let initialized = false;
let lifecycleEnabled = true;
let initDomReadyHandler = null;
let appLifecycleHooksBound = false;
let appLifecycleHandlers = [];
let chatChangedHooked = false;
let lastKnownChatSignature = '';
let profileSwitchDepth = 0;
let suppressChatChangeUntil = 0;
let mapResizeState = null;
// Serialize metadata writes so fast consecutive UI actions cannot finish out of order.
let saveMemoryQueue = Promise.resolve();
let saveMemorySequence = 0;
let mapRevisionSequence = 0;
// Only one map/selected-location generation may commit at a time.
let activeMapGeneration = null;
let activeDiscoveryConfirm = null;

function shouldIgnoreChatChanged() {
    return profileSwitchDepth > 0 || Date.now() < suppressChatChangeUntil;
}

function markProfileSwitchSuppression(ms = 2500) {
    suppressChatChangeUntil = Math.max(suppressChatChangeUntil, Date.now() + ms);
}

function getStableChatSignature() {
    try {
        const ctx = safeContext();
        const id = ctx?.chatId;
        if (typeof id === 'string' && id.trim()) return `chatId:${id.trim()}`;
        if (typeof id === 'number' && Number.isFinite(id)) return `chatId:${id}`;
        return '';
    } catch {
        return '';
    }
}

function rememberCurrentChatSignature() {
    const signature = getStableChatSignature();
    if (signature) lastKnownChatSignature = signature;
    return signature;
}

function assertChatSignatureUnchanged(startSignature, operation = 'request') {
    const endSignature = getStableChatSignature();
    if (startSignature && endSignature && startSignature !== endSignature) {
        pushDebugLog(`${operation}.cancelled.chat_changed`, '요청 중 채팅이 바뀌어 결과를 저장하지 않았습니다.', {
            startChatSignature: startSignature,
            endChatSignature: endSignature,
        });
        throw createMapGenerationCancelledError('chat changed during request');
    }
}

function assertMapSnapshotUnchanged(startMap, operation = 'request', footstepSnapshot = null) {
    const currentMap = ensureMemory().map;
    let changed = Boolean(startMap && currentMap !== startMap);
    if (!changed && footstepSnapshot) {
        const live = currentMap?.footsteps?.find(item => String(item.id) === String(footstepSnapshot.id));
        changed = !live
            || String(live.locationId || '') !== String(footstepSnapshot.locationId || '')
            || String(live.status || '').replace(/\s+/g, ' ').trim() !== String(footstepSnapshot.status || '').replace(/\s+/g, ' ').trim();
    }
    if (!changed) return;
    pushDebugLog(`${operation}.cancelled.map_changed`, '요청 중 지도가 갱신되어 이전 지도 기준 결과를 저장하지 않았습니다.', {
        expectedFootstepId: footstepSnapshot?.id || '',
    });
    throw createMapGenerationCancelledError('map changed during request');
}

function createMapRevisionToken() {
    mapRevisionSequence += 1;
    return `map-${Date.now().toString(36)}-${mapRevisionSequence.toString(36)}`;
}


function serializeForDebug(value) {
    try {
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
        if (typeof value === 'string') return value;
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}

function sanitizeDebugData(value) {
    const data = serializeForDebug(value);
    const clean = (input, depth = 0) => {
        if (input == null) return input;
        if (depth > 3) return '[omitted]';
        if (typeof input === 'string') return input.length > 220 ? `${input.slice(0, 220)}…` : input;
        if (typeof input !== 'object') return input;
        if (Array.isArray(input)) return input.slice(0, 8).map(item => clean(item, depth + 1));
        const out = {};
        for (const [key, raw] of Object.entries(input)) {
            if (/preview|raw|prompt|stack|available/i.test(key)) continue;
            if (/profileId|connectionProfile|selectedProfile|target/i.test(key)) {
                out[key] = raw ? '[selected]' : '';
                continue;
            }
            if (/profileName/i.test(key)) {
                out[key] = raw ? '[selected profile]' : '';
                continue;
            }
            if (/filename|url|href/i.test(key)) continue;
            out[key] = clean(raw, depth + 1);
        }
        return out;
    };
    return clean(data);
}

function getDebugLogs() {
    return memoryDebugLogs.slice();
}

function pushDebugLog(type, message, data = null) {
    const entry = {
        at: nowStamp(),
        version: EXTENSION_VERSION,
        type: String(type || 'info'),
        message: String(message || ''),
        theme: (() => { try { return getThemeKey(); } catch { return 'unknown'; } })(),
        chat: (() => { try { return safeContext()?.chatId ? 'active' : (safeContext()?.chat?.length ? 'active' : ''); } catch { return ''; } })(),
        data: sanitizeDebugData(data),
    };
    memoryDebugLogs.unshift(entry);
    if (memoryDebugLogs.length > DEBUG_LOG_LIMIT) memoryDebugLogs.length = DEBUG_LOG_LIMIT;
}

function clearDebugLogs() {
    memoryDebugLogs.length = 0;
}

function shouldPrintDebugToConsole() {
    return false;
}

function copyDebugLogsToClipboard() {
    const payload = {
        extension: '지도',
        version: EXTENSION_VERSION,
        time: nowStamp(),
        theme: (() => { try { return getThemeKey(); } catch { return 'unknown'; } })(),
        logs: getDebugLogs().slice(0, 40),
    };
    const text = JSON.stringify(payload, null, 2);
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).then(() => toast('디버그 로그를 복사했습니다.', 'success'));
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    toast('디버그 로그를 복사했습니다.', 'success');
}

function buildMapDebugDump() {
    const settings = (() => { try { return getSettings(); } catch { return {}; } })();
    const profiles = (() => {
        try {
            return Array.from(window.__mmaConnectionProfileCache || []).map(profile => ({
                id: profile.id || '',
                name: profile.name || '',
                model: profile.model || profile.modelName || profile.api || '',
            }));
        } catch {
            return [];
        }
    })();

    const selectedProfile = profiles.find(p => p.id === settings.connectionProfile) || null;

    return JSON.stringify({
        extension: '지도',
        version: EXTENSION_VERSION,
        time: nowStamp(),
        theme: (() => { try { return getThemeKey(); } catch { return 'unknown'; } })(),
        settings: {
            theme: settings.theme,
            outputMode: normalizeOutputMode(settings.outputMode),
            fontScale: settings.fontScale,
            connectionProfile: settings.connectionProfile === 'main' ? 'main' : 'selected',
            selectedProfile: Boolean(selectedProfile),
            cachedProfileCount: profiles.length,
        },
        currentMap: (() => {
            try {
                const memory = ensureMemory();
                const map = memory.map || null;
                return map ? {
                    mapTitle: map.mapTitle || '',
                    regionName: map.regionName || '',
                    timeHint: map.timeHint || '',
                    currentLocationId: map.currentLocationId || '',
                    locations: Array.isArray(map.locations) ? map.locations.length : 0,
                    footsteps: Array.isArray(map.footsteps) ? map.footsteps.length : 0,
                    events: Array.isArray(map.events) ? map.events.length : 0,
                    discoveries: Array.isArray(memory.discoveries) ? memory.discoveries.length : 0,
                    discoveryHistory: Array.isArray(memory.discoveryHistory) ? memory.discoveryHistory.length : 0,
                    managedItems: Array.isArray(memory.managedItems) ? memory.managedItems.length : 0,
                    recommendations: Array.isArray(memory.recommendations) ? memory.recommendations.length : 0,
                    trackedPeople: memory.trackedPeople ? Object.keys(memory.trackedPeople).length : 0,
                } : null;
            } catch {
                return null;
            }
        })(),
        searchState: (() => {
            try {
                const memory = ensureMemory();
                return {
                    placeResults: Array.isArray(memory.recommendations) ? memory.recommendations.length : 0,
                    collectedPlaces: Array.isArray(memory.recommendations) ? memory.recommendations.filter(item => item?.collected).length : 0,
                    personSearchHistory: Array.isArray(memory.searchResults) ? memory.searchResults.length : 0,
                    trackedPeople: memory.trackedPeople ? Object.keys(memory.trackedPeople).length : 0,
                    activeInjectedContexts: (memory.managedItems || []).filter(item => ['injected', 'char_notice', 'user_notice'].includes(item?.status)).length,
                };
            } catch {
                return null;
            }
        })(),
        logs: getDebugLogs().slice(0, 40),
    }, null, 2);
}

function showMapSettingsDebugDump() {
    const dump = buildMapDebugDump();
    const panel = document.getElementById('mma-settings-debug-panel');
    const output = document.getElementById('mma-settings-debug-output');
    if (panel) panel.style.display = '';
    if (output) {
        output.value = dump;
        output.style.display = '';
    }
    toast('디버그 로그를 표시했습니다.', 'success');
    return dump;
}

function toggleMapSettingsDebugDump() {
    const panel = document.getElementById('mma-settings-debug-panel');
    if (panel && panel.style.display !== 'none' && panel.offsetParent !== null) {
        panel.style.display = 'none';
        toast('디버그 로그를 접었습니다.', 'success');
        return '';
    }
    return showMapSettingsDebugDump();
}

async function copyMapSettingsDebugDump() {
    const dump = showMapSettingsDebugDump();
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dump);
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = dump;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
    toast('디버그 로그를 복사했습니다.', 'success');
}

function clearMapSettingsDebugDump() {
    clearDebugLogs();
    const output = document.getElementById('mma-settings-debug-output');
    if (output) output.value = buildMapDebugDump();
    toast('디버그 로그를 비웠습니다.', 'success');
}


function setupDebugHooks() {
    // Quiet runtime: do not hook global window errors/rejections or beforeunload for debug logging.
    // Keep only harmless cleanup/viewport handlers needed by the map UI.
    if (globalThis.__mmaDebugHooksInstalled) return;
    globalThis.__mmaDebugHooksInstalled = true;
    window.addEventListener('pagehide', () => {
        cancelActiveMapGeneration('page hidden');
        if (mapResizeState) endMapResize();
    });
    window.visualViewport?.addEventListener?.('resize', () => {
        const canvas = document.getElementById('mma-map-canvas');
        if (canvas && !mapResizeState && canvas.dataset.mmaUserResized === 'true') {
            const rect = canvas.getBoundingClientRect();
            const max = Math.max(240, Math.round(getViewportHeight() - rect.top - 18));
            if (canvas.getBoundingClientRect().height > max) applyMapCanvasHeight(canvas, max, max);
        }
    });
}

function setupOverlayDebugObserver() {
    // Quiet runtime: no DOM-wide debug observer. The map works without this observer.
    return;
}

function stContext() {
    if (!globalThis.SillyTavern?.getContext) {
        throw new Error('SillyTavern.getContext()를 찾을 수 없습니다.');
    }
    return globalThis.SillyTavern.getContext();
}

function safeContext() {
    try {
        if (!globalThis.SillyTavern?.getContext) return null;
        return globalThis.SillyTavern.getContext() || null;
    } catch {
        return null;
    }
}

function isContextReady() {
    const ctx = safeContext();
    return Boolean(ctx && document.body);
}

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatCompactMapTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/^\d{4}-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
    return match ? `${match[1]}.${match[2]} ${match[3]}` : text;
}

function getSettings() {
    const ctx = stContext();
    if (!ctx.extensionSettings) ctx.extensionSettings = {};
    if (!ctx.extensionSettings[MODULE_NAME]) ctx.extensionSettings[MODULE_NAME] = clone(SETTINGS_DEFAULTS);
    const settings = ctx.extensionSettings[MODULE_NAME];
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
        if (!Object.hasOwn(settings, key)) settings[key] = value;
    }
    return settings;
}

function saveSettings() {
    try {
        const ctx = stContext();
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        } else if (typeof globalThis.saveSettingsDebounced === 'function') {
            globalThis.saveSettingsDebounced();
        }
    } catch (error) {
        console.warn('[MarauderMap] 설정 저장 실패:', error);
    }
}

function normalizeFontScale(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 13;

    // Backward compatibility: older versions stored this as a percentage
    // such as 75, 100, or 115. New UI stores the visible font size in px.
    const px = number > 40 ? (number / 100) * 13 : number;
    return Math.min(24, Math.max(10, Math.round(px)));
}

function applyFontScale() {
    let px = 13;
    try {
        px = normalizeFontScale(getSettings().fontScale);
    } catch {
        px = 13;
    }
    const root = document.getElementById(EXTENSION_ROOT_ID);
    const windowEl = document.getElementById('mma-window');
    const value = String(px / 13);
    root?.style.setProperty('--mma-font-scale', value);
    windowEl?.style.setProperty('--mma-font-scale', value);
}


function normalizeTheme(value) {
    return Object.hasOwn(THEME_OPTIONS, value) ? value : 'marauder';
}

function getThemeKey() {
    try {
        const settings = getSettings();
        settings.theme = normalizeTheme(settings.theme);
        return settings.theme;
    } catch {
        return 'marauder';
    }
}

function getThemeConfig() {
    return THEME_OPTIONS[getThemeKey()] || THEME_OPTIONS.marauder;
}

function normalizeOutputMode(value) {
    return Object.hasOwn(OUTPUT_MODE_CONFIGS, value) ? value : 'basic';
}

function getOutputModeKey() {
    try {
        const settings = getSettings();
        settings.outputMode = normalizeOutputMode(settings.outputMode);
        return settings.outputMode;
    } catch {
        return 'basic';
    }
}

function getOutputModeConfig() {
    return OUTPUT_MODE_CONFIGS[getOutputModeKey()] || OUTPUT_MODE_CONFIGS.basic;
}

function getDiscoveryUiConfig() {
    return getThemeConfig().discoveryUi || THEME_OPTIONS.marauder.discoveryUi;
}
function getMapActivationCompleteText() {
    const theme = getThemeConfig();
    return theme.completeText || '지도가 모두 그려졌습니다.';
}


function getExtensionMenuIcon() {
    return getThemeConfig().menuIcon || '📜';
}

function refreshExtensionsMenuButton() {
    const button = document.getElementById('mma-extension-menu-button');
    if (!button) return;
    button.title = getThemeConfig().menuTitle || getThemeConfig().shortLabel;
    button.innerHTML = `<span class="mma-menu-icon extensionsMenuExtensionButton">${getExtensionMenuIcon()}</span><span class="mma-menu-label">지도</span>`;
}

function applyThemeClass() {
    const theme = getThemeKey();
    const root = document.getElementById(EXTENSION_ROOT_ID);
    const windowEl = document.getElementById('mma-window');
    [root, windowEl].filter(Boolean).forEach(el => {
        for (const key of Object.keys(THEME_OPTIONS)) {
            el.classList.toggle(`mma-theme-${key}`, theme === key);
        }
        el.dataset.mmaTheme = theme;
    });
}

function setTheme(value, rerender = false) {
    const settings = getSettings();
    settings.theme = normalizeTheme(value);
    saveSettings();
    applyThemeClass();
    refreshExtensionsMenuButton();
    if (rerender) renderSpellScreen();
}

function isModernTheme() {
    return getThemeKey() === 'modern';
}

function isBonbonTheme() {
    return getThemeKey() === 'bonbon';
}

function isMarauderTheme() {
    return getThemeKey() === 'marauder';
}

function getCurrentCharacterKey() {
    try {
        const ctx = stContext();
        const char = Number.isInteger(ctx.characterId) ? ctx.characters?.[ctx.characterId] : null;
        const stableSource = char?.avatar || char?.name || ctx.name2 || ctx.characterId || 'default-character';
        return safeId(String(stableSource), 'character');
    } catch {
        return 'character-default';
    }
}

function createEmptyNotebook() {
    return {
        managedItems: [],
        footstepProfiles: {},
        trackedPeople: {},
        recommendations: [],
        searchResults: [],
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
    };
}

function normalizeNotebookShape(notebook) {
    const book = notebook && typeof notebook === 'object' && !Array.isArray(notebook) ? notebook : createEmptyNotebook();
    if (!Array.isArray(book.managedItems)) book.managedItems = [];
    if (!book.footstepProfiles || typeof book.footstepProfiles !== 'object' || Array.isArray(book.footstepProfiles)) book.footstepProfiles = {};
    if (!book.trackedPeople || typeof book.trackedPeople !== 'object' || Array.isArray(book.trackedPeople)) book.trackedPeople = {};
    if (!Array.isArray(book.recommendations)) book.recommendations = [];
    if (!Array.isArray(book.searchResults)) book.searchResults = [];

    // Storage-scope migration: map copies must never live in a character-wide
    // notebook. Keep only explicitly collected notebook information.
    delete book.lastMaps;
    delete book.activeMapBackups;

    book.updatedAt = book.updatedAt || nowStamp();
    return book;
}

function arrayIdentity(item, index, prefix = 'item') {
    if (!item || typeof item !== 'object') return `${prefix}:${index}`;
    return String(item.id || item.sourceId || item.source || item.name || item.title || item.locationName || `${prefix}:${index}`);
}

function mergeArrayByIdentity(base = [], incoming = [], limit = Infinity, prefix = 'item') {
    const map = new Map();
    const add = (item, index, sourcePrefix) => {
        if (!item || typeof item !== 'object') return;
        const key = arrayIdentity(item, index, sourcePrefix);
        const previous = map.get(key) || {};
        map.set(key, { ...previous, ...item });
    };
    (Array.isArray(base) ? base : []).forEach((item, index) => add(item, index, prefix));
    (Array.isArray(incoming) ? incoming : []).forEach((item, index) => add(item, index, prefix));
    const values = Array.from(map.values());
    return Number.isFinite(limit) ? values.slice(0, Math.max(0, limit)) : values;
}

function mergeTrackedPeople(base = {}, incoming = {}) {
    const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return out;
    Object.entries(incoming).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        const previous = out[key] || {};
        const history = mergeArrayByIdentity(previous.history || [], value.history || [], Infinity, `${key}:history`);
        out[key] = { ...previous, ...value, history };
    });
    return out;
}

function notebookHasData(source) {
    if (!source || typeof source !== 'object') return false;
    return Boolean(
        (Array.isArray(source.managedItems) && source.managedItems.length) ||
        (source.footstepProfiles && typeof source.footstepProfiles === 'object' && Object.keys(source.footstepProfiles).length) ||
        (source.trackedPeople && typeof source.trackedPeople === 'object' && Object.keys(source.trackedPeople).length) ||
        (Array.isArray(source.recommendations) && source.recommendations.length) ||
        (Array.isArray(source.searchResults) && source.searchResults.length)
    );
}



function isValidMapData(map) {
    return !!map && typeof map === 'object' && Array.isArray(map.locations) && map.locations.length > 0;
}



function purgeLegacyMapBackupsFromChat(memory) {
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return false;
    let changed = false;
    for (const key of ['lastMaps', 'activeMapBackups']) {
        if (Object.hasOwn(memory, key)) {
            delete memory[key];
            changed = true;
        }
    }
    return changed;
}

function purgeLegacySharedMapBackups(settings = getSettings()) {
    const notebooks = settings?.characterNotebooks;
    if (!notebooks || typeof notebooks !== 'object' || Array.isArray(notebooks)) return 0;

    let cleaned = 0;
    for (const notebook of Object.values(notebooks)) {
        if (!notebook || typeof notebook !== 'object' || Array.isArray(notebook)) continue;
        let changed = false;
        for (const key of ['lastMaps', 'activeMapBackups']) {
            if (Object.hasOwn(notebook, key)) {
                delete notebook[key];
                changed = true;
            }
        }
        if (changed) cleaned += 1;
    }
    if (cleaned) {
        saveSettings();
        pushDebugLog('migration.sharedMapBackups.purged', '캐릭터 공용 수첩의 예전 지도 백업을 정리했습니다.', { notebooks: cleaned });
    }
    return cleaned;
}

const legacyChatMapCleanupQueued = new WeakSet();
function scheduleLegacyChatMapCleanupSave(memory) {
    if (!memory || legacyChatMapCleanupQueued.has(memory)) return;
    legacyChatMapCleanupQueued.add(memory);

    Promise.resolve().then(async () => {
        legacyChatMapCleanupQueued.delete(memory);
        const ctx = safeContext();
        if (!ctx?.chatMetadata || ctx.chatMetadata[METADATA_KEY] !== memory) return;
        try {
            if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
            else if (typeof ctx.saveChatMetadata === 'function') await ctx.saveChatMetadata();
            pushDebugLog('migration.chatMapBackups.purged', '현재 채팅의 예전 지도 백업을 정리했습니다.');
        } catch (error) {
            pushDebugLog('migration.chatMapBackups.purge.error', '현재 채팅의 예전 지도 백업 정리 저장에 실패했습니다.', serializeForDebug(error));
        }
    });
}

function normalizePreviousMapSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !isValidMapData(value.map)) return null;
    return {
        map: value.map,
        selectedLocationId: String(value.selectedLocationId || value.map.currentLocationId || value.map.locations[0]?.id || ''),
        generatedAt: value.generatedAt || null,
        capturedAt: value.capturedAt || null,
        reason: String(value.reason || ''),
    };
}

function createPreviousMapSnapshot(memory = null, reason = 'refresh') {
    const target = memory || ensureMemory();
    if (!isValidMapData(target.map)) return null;

    return {
        map: clone(target.map),
        selectedLocationId: target.selectedLocationId || target.map.currentLocationId || target.map.locations[0]?.id || '',
        generatedAt: target.generatedAt || null,
        capturedAt: nowStamp(),
        reason: String(reason || 'refresh'),
    };
}

function commitPreviousMapSnapshot(memory = null, snapshot = null) {
    const target = memory || ensureMemory();
    const normalized = normalizePreviousMapSnapshot(snapshot);
    if (!normalized) return false;

    target.previousMap = normalized;
    pushDebugLog('map.rollback.capture', '현재 채팅의 직전 지도 스냅샷을 저장했습니다.', {
        reason: normalized.reason,
        locations: normalized.map.locations.length,
    });
    return true;
}

function hasPreviousMapSnapshot(memory = null) {
    const target = memory || ensureMemory();
    return Boolean(normalizePreviousMapSnapshot(target.previousMap));
}


async function restorePreviousMap() {
    if (activeMapGeneration) {
        toast('지도를 생성하는 동안에는 직전 지도를 되돌릴 수 없습니다.', 'info');
        return false;
    }

    const memory = ensureMemory();
    const snapshot = normalizePreviousMapSnapshot(memory.previousMap);
    if (!snapshot) {
        toast('되돌릴 직전 지도가 없습니다.', 'info');
        return false;
    }

    memory.map = clone(snapshot.map);
    memory.mapRevision = createMapRevisionToken();
    reconcileTransientDiscoveries(memory, memory.map);
    memory.selectedLocationId = snapshot.selectedLocationId || snapshot.map.currentLocationId || snapshot.map.locations[0]?.id || null;
    memory.generatedAt = snapshot.generatedAt || nowStamp();
    memory.lastAction = 'rollback-previous-map';
    // One-step rollback only. Once restored, the same snapshot cannot be
    // toggled back and forth or accidentally become a cross-chat history.
    memory.previousMap = null;

    await saveMemory(memory);
    syncExtensionPrompt();
    renderMapView();
    toast('직전 지도로 되돌렸습니다.', 'success');
    pushDebugLog('map.rollback.restore', '현재 채팅의 직전 지도 스냅샷을 복구했습니다.', {
        locations: memory.map.locations.length,
        reason: snapshot.reason || 'refresh',
    });
    return true;
}


function getCharacterNotebook(settings = getSettings(), key = getCurrentCharacterKey()) {
    if (!settings.characterNotebooks || typeof settings.characterNotebooks !== 'object' || Array.isArray(settings.characterNotebooks)) {
        settings.characterNotebooks = {};
    }
    if (!settings.characterNotebooks[key]) settings.characterNotebooks[key] = createEmptyNotebook();
    const notebook = normalizeNotebookShape(settings.characterNotebooks[key]);
    settings.characterNotebooks[key] = notebook;
    return { key, notebook };
}

function mergeMemoryIntoNotebook(notebook, memory) {
    if (!notebook || !memory) return notebook;
    notebook.managedItems = mergeArrayByIdentity(notebook.managedItems, memory.managedItems, Infinity, 'managed');
    notebook.footstepProfiles = { ...(notebook.footstepProfiles || {}), ...(memory.footstepProfiles || {}) };
    notebook.trackedPeople = mergeTrackedPeople(notebook.trackedPeople, memory.trackedPeople);
    notebook.recommendations = mergeArrayByIdentity(notebook.recommendations, memory.recommendations, Infinity, 'recommendation');
    notebook.searchResults = mergeArrayByIdentity(notebook.searchResults, memory.searchResults, Infinity, 'search');
    notebook.updatedAt = nowStamp();
    return normalizeNotebookShape(notebook);
}

function attachCharacterNotebook(memory) {
    const { key, notebook } = getCharacterNotebook();
    if (memory.sharedNotebookKey !== key && notebookHasData(memory)) {
        mergeMemoryIntoNotebook(notebook, memory);
        memory.sharedNotebookMigratedAt = nowStamp();
        pushDebugLog('notebook.migrate', `채팅 수첩을 캐릭터 공용 수첩으로 옮겼습니다: ${key}`, {
            managedItems: memory.managedItems?.length || 0,
            recommendations: memory.recommendations?.length || 0,
            searchResults: memory.searchResults?.length || 0,
            trackedPeople: Object.keys(memory.trackedPeople || {}).length,
        });
    }
    memory.sharedNotebookKey = key;
    memory.managedItems = notebook.managedItems;
    memory.footstepProfiles = notebook.footstepProfiles;
    memory.trackedPeople = notebook.trackedPeople;
    memory.recommendations = notebook.recommendations;
    memory.searchResults = notebook.searchResults;
    return notebook;
}

function persistCharacterNotebook(memory) {
    if (!memory || typeof memory !== 'object') return;
    const key = memory.sharedNotebookKey || getCurrentCharacterKey();
    const { notebook } = getCharacterNotebook(getSettings(), key);

    // v2.5.9: Persist the current notebook state as-is.
    // Older builds merged notebook data back into itself on every save. That was
    // safe for migration, but it also resurrected items after the user deleted
    // collected/reflected notebook entries. At this point ensureMemory() has
    // already attached the character notebook, so user actions should replace
    // the saved notebook state rather than merge deleted items back in.
    notebook.managedItems = Array.isArray(memory.managedItems) ? memory.managedItems : [];
    notebook.footstepProfiles = memory.footstepProfiles && typeof memory.footstepProfiles === 'object' && !Array.isArray(memory.footstepProfiles) ? memory.footstepProfiles : {};
    notebook.trackedPeople = memory.trackedPeople && typeof memory.trackedPeople === 'object' && !Array.isArray(memory.trackedPeople) ? memory.trackedPeople : {};
    notebook.recommendations = Array.isArray(memory.recommendations) ? memory.recommendations : [];
    notebook.searchResults = Array.isArray(memory.searchResults) ? memory.searchResults : [];
    delete notebook.lastMaps;
    delete notebook.activeMapBackups;
    notebook.updatedAt = nowStamp();
    normalizeNotebookShape(notebook);
    memory.sharedNotebookKey = key;
}


function enforceSingleQuestPerLocation(memory) {
    const map = memory?.map;
    if (!map || !Array.isArray(map.events)) return false;

    const managedEventIds = new Set((memory.managedItems || [])
        .filter(item => item?.status !== 'ignored' && String(item?.sourceId || '').startsWith('event:'))
        .map(item => String(item.sourceId).slice('event:'.length)));
    const selectedByLocation = new Map();
    const selectedEvents = [];
    const eventPriority = event => {
        if (managedEventIds.has(String(event?.id || ''))) return 3;
        if (['injected', 'held', 'observed'].includes(String(event?.status || ''))) return 2;
        if (String(event?.status || '') !== 'ignored') return 1;
        return 0;
    };

    for (const event of map.events) {
        if (!event || !event.locationId) continue;
        const locationId = String(event.locationId);
        const existing = selectedByLocation.get(locationId);
        if (!existing) {
            selectedByLocation.set(locationId, { index: selectedEvents.length, priority: eventPriority(event) });
            selectedEvents.push(event);
            continue;
        }
        const priority = eventPriority(event);
        if (priority > existing.priority) {
            selectedEvents[existing.index] = event;
            existing.priority = priority;
        }
    }

    const changed = selectedEvents.length !== map.events.length || selectedEvents.some((event, index) => event !== map.events[index]);
    if (changed) map.events = selectedEvents;
    if (Array.isArray(map.locations)) {
        for (const location of map.locations) {
            if (!location) continue;
            location.eventIds = selectedEvents.filter(event => event.locationId === location.id).map(event => event.id);
        }
    }
    return changed;
}

function ensureMemory() {
    const ctx = stContext();
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    if (!ctx.chatMetadata[METADATA_KEY]) ctx.chatMetadata[METADATA_KEY] = clone(EMPTY_MEMORY);
    const memory = ctx.chatMetadata[METADATA_KEY];
    for (const [key, value] of Object.entries(EMPTY_MEMORY)) {
        if (!Object.hasOwn(memory, key)) memory[key] = clone(value);
    }
    if (!Array.isArray(memory.managedItems)) memory.managedItems = [];
    if (!memory.footstepProfiles || typeof memory.footstepProfiles !== 'object' || Array.isArray(memory.footstepProfiles)) memory.footstepProfiles = {};
    if (!memory.trackedPeople || typeof memory.trackedPeople !== 'object' || Array.isArray(memory.trackedPeople)) memory.trackedPeople = {};
    if (!Array.isArray(memory.recommendations)) memory.recommendations = [];
    if (!Array.isArray(memory.searchResults)) memory.searchResults = [];
    if (!Array.isArray(memory.discoveries)) memory.discoveries = [];
    if (!Array.isArray(memory.discoveryHistory)) memory.discoveryHistory = [];
    if (isValidMapData(memory.map) && !memory.mapRevision) memory.mapRevision = createMapRevisionToken();
    const cleanedSharedNotebooks = purgeLegacySharedMapBackups();
    const cleanedCurrentChat = purgeLegacyMapBackupsFromChat(memory);
    memory.previousMap = normalizePreviousMapSnapshot(memory.previousMap);
    attachCharacterNotebook(memory);
    if (cleanedCurrentChat) scheduleLegacyChatMapCleanupSave(memory);
    if (cleanedSharedNotebooks || cleanedCurrentChat) {
        pushDebugLog('migration.mapScope.cleaned', '공용 지도 백업을 정리하고 지도 데이터를 채팅 전용으로 전환했습니다.', {
            sharedNotebooks: cleanedSharedNotebooks,
            currentChat: cleanedCurrentChat,
        });
    }
    // Migration from older versions.
    memory.managedItems.forEach(item => {
        if (item && item.status === 'observed') item.status = 'held';
    });
    if (memory.map?.events) {
        memory.map.events.forEach(event => {
            if (event && event.status === 'observed') event.status = 'held';
        });
        enforceSingleQuestPerLocation(memory);
    }
    const notebook = attachCharacterNotebook(memory);
    notebook.managedItems.forEach(item => {
        if (item && item.status === 'observed') item.status = 'held';
    });
    delete memory.logs;
    delete memory.injectionMode;
    return memory;
}

function getExistingMemory() {
    try {
        const ctx = safeContext();
        const memory = ctx?.chatMetadata?.[METADATA_KEY];
        return memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : null;
    } catch {
        return null;
    }
}

function saveMemory(memoryArg = null) {
    const contextAtQueue = safeContext();
    const metadataAtQueue = contextAtQueue?.chatMetadata || null;
    const chatSignatureAtQueue = getStableChatSignature();
    const sequence = ++saveMemorySequence;

    const write = async () => {
        try {
            const currentContext = safeContext();
            if (!currentContext || (metadataAtQueue && currentContext.chatMetadata !== metadataAtQueue)) {
                pushDebugLog('memory.save.skipped.chatChanged', '채팅이 바뀌어 이전 채팅의 저장 작업을 건너뛰었습니다.', { sequence });
                return false;
            }
            const currentSignature = getStableChatSignature();
            if (chatSignatureAtQueue && currentSignature && chatSignatureAtQueue !== currentSignature) {
                pushDebugLog('memory.save.skipped.chatChanged', '채팅 서명이 바뀌어 이전 채팅의 저장 작업을 건너뛰었습니다.', {
                    sequence,
                    queuedFor: chatSignatureAtQueue,
                    current: currentSignature,
                });
                return false;
            }

            const ctx = stContext();
            // Read the already-mutated chat memory directly. Re-running
            // ensureMemory() here can reattach an older notebook copy over a
            // just-edited array before persistence.
            const memory = memoryArg || ctx.chatMetadata?.[METADATA_KEY] || ensureMemory();
            persistCharacterNotebook(memory);
            saveSettings();
            if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
            else if (typeof ctx.saveChatMetadata === 'function') await ctx.saveChatMetadata();
            pushDebugLog('memory.save.success', '지도 메모리와 캐릭터 수첩을 저장했습니다.', {
                sequence,
                notebookKey: memory.sharedNotebookKey,
                managedItems: memory.managedItems?.length || 0,
                recommendations: memory.recommendations?.length || 0,
                searchResults: memory.searchResults?.length || 0,
                discoveries: memory.discoveries?.length || 0,
                discoveryHistory: memory.discoveryHistory?.length || 0,
                trackedPeople: Object.keys(memory.trackedPeople || {}).length,
            });
            return true;
        } catch (error) {
            pushDebugLog('memory.save.error', '메모리 저장 실패', { sequence, error: serializeForDebug(error) });
            console.warn('[MarauderMap] 메모리 저장 실패:', error);
            return false;
        }
    };

    // A rejected earlier save must not poison later writes. Each action still
    // resolves to its own success/failure result for callers that await it.
    const queued = saveMemoryQueue.then(write, write);
    saveMemoryQueue = queued.catch(() => false);
    return queued;
}

function getCurrentCharacterName() {
    try {
        const ctx = stContext();
        const char = Number.isInteger(ctx.characterId) ? ctx.characters?.[ctx.characterId] : null;
        return char?.name || ctx.name2 || '{{char}}';
    } catch {
        return '{{char}}';
    }
}

function getCurrentUserName() {
    try {
        const ctx = stContext();
        return ctx.name1 || '{{user}}';
    } catch {
        return '{{user}}';
    }
}

function getCharacterSummary() {
    try {
        const ctx = stContext();
        const char = Number.isInteger(ctx.characterId) ? ctx.characters?.[ctx.characterId] : null;
        const data = char?.data || char || {};
        const parts = [
            `Character name: ${char?.name || ctx.name2 || '{{char}}'}`,
            data.description ? `Description: ${stripLong(data.description, 2800)}` : '',
            data.personality ? `Personality: ${stripLong(data.personality, 2800)}` : '',
            data.scenario ? `Scenario: ${stripLong(data.scenario, 1400)}` : '',
        ].filter(Boolean);
        return parts.join('\n');
    } catch {
        return '';
    }
}

function getPersonaSummary() {
    try {
        const ctx = stContext();
        const description = ctx?.persona_description
            || ctx?.powerUser?.persona_description
            || globalThis.power_user?.persona_description
            || '';
        return [
            `Persona name: ${ctx?.name1 || '{{user}}'}`,
            description ? `Persona description: ${stripLong(description, 2200)}` : '',
        ].filter(Boolean).join('\n');
    } catch {
        return '';
    }
}

function getChatSnapshot(limit = 10) {
    try {
        const ctx = stContext();
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        return chat.slice(-limit).map((m, i) => {
            const name = m.name || (m.is_user ? getCurrentUserName() : getCurrentCharacterName());
            const role = m.is_user ? 'user' : 'character/narration';
            const text = stripLong(String(m.mes || m.message || ''), 1400);
            return `[${i + 1}] ${name} (${role}): ${text}`;
        }).join('\n\n');
    } catch {
        return '';
    }
}

function stripLong(text, max) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function safeId(text, fallback = 'loc') {
    const base = String(text || '').toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 52);
    return base || `${fallback}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStringArray(value, fallback = [], max = 16) {
    if (!Array.isArray(value)) return fallback;
    return value.map(v => typeof v === 'string' ? v : (v?.name || v?.label || JSON.stringify(v))).filter(Boolean).slice(0, max);
}

function uniqueStrings(values, max = 24) {
    const seen = new Set();
    const out = [];
    for (const raw of values || []) {
        const value = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length >= max) break;
    }
    return out;
}


function presentIdentityKey(value) {
    const raw = String(value || '')
        .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    if (!raw) return '';

    const aliases = [];
    for (const [pattern, key] of aliases) {
        if (pattern.test(raw)) return key;
    }
    return `text:${raw}`;
}

function uniquePresentStrings(values, max = 24) {
    const seen = new Set();
    const out = [];
    for (const raw of values || []) {
        const value = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!value) continue;
        const key = presentIdentityKey(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length >= max) break;
    }
    return out;
}

function isGenericPersonLabel(value) {
    return /^(주변 인물|가까운 주변 인물들|인물이 뚜렷하게 보이지 않음|사람들|몇몇 인물|여러 사람|students|people|npc)$/i.test(String(value || '').trim());
}


function exactPresentTextKey(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isCrowdSummaryLabel(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw.startsWith('👥')) return false;
    const body = raw.replace(/^👥\s*/, '').trim();
    if (!body || presentIdentityKey(body).startsWith('person:') || extractKnownNames(body).length) return false;
    return /(?:학생들|사람들|손님들|직원들|승객들|무리|일행|몇\s*명|여러\s*명|군중|관중|groups?|students?|people|guests?|staff|workers?|passengers?|crowd)/i.test(body);
}

function normalizePresentDisplayLabel(value) {
    let raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';

    if (raw.startsWith('👥') && !isCrowdSummaryLabel(raw)) {
        raw = raw.replace(/^👥\s*/, '').trim();
    }


    return raw;
}

function isAmbientPresenceLabel(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw || isGenericPersonLabel(raw)) return true;
    if (raw.startsWith('👥')) return isCrowdSummaryLabel(raw);

    // Existing aliases are used only to recognise a known person, never to
    // rewrite its displayed name. Named characters must come from the model.
    if (presentIdentityKey(raw).startsWith('person:')) return false;
    if (extractKnownNames(raw).length) return false;

    return /^(?:a|an|the|two|three|several|some|nearby|passing|busy|quiet|local|late|sleepy|hurried|watchful|worried|nervous|rain-soaked|half-asleep)\b/i.test(raw)
        || /\b(?:students?|people|person|group|crowd|passers?-?by|observer|visitors?|guests?|staff|workers?|players?|spectators?|authority figure|figure|prefect|professor|ghost|owl)\b/i.test(raw)
        || /(?:학생|사람|인물|무리|일행|행인|손님|직원|교직원|관찰자|목격자|교수|반장|유령|경비|시종|선수|관중|지나가는|주변|몇몇|두\s*사람|세\s*사람|발자국)/.test(raw);
}

function isNamedPresentLabel(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    return Boolean(raw) && !isAmbientPresenceLabel(raw) && !/^\?\?\?$/.test(raw);
}

function enforceExactNamedPersonLocations(locations) {
    const placements = new Map();
    for (const location of locations || []) {
        location.present = (location.present || []).filter(value => {
            if (!isNamedPresentLabel(value)) return true;
            const key = exactPresentTextKey(value);
            if (!key || placements.has(key)) return false;
            placements.set(key, location.id);
            return true;
        });
    }
    return placements;
}


function simplifyFootstepLabel(value) {
    let label = String(value || '').replace(/\s+/g, ' ').trim();
    if (!label) return '???';
    if (/^(\?\?\?|unknown|이름이 흐릿한 발자국|정체 불명|알 수 없는 사람)$/i.test(label)) return '???';

    // The map should show names/titles only. Remove activity/status fragments
    // such as "[busy]", "(carrying books)", "— whispering", or ": waiting".
    label = label
        .replace(/【[^】]*】/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\s+[—–]\s+.*$/g, '')
        .replace(/:\s+.*$/g, '')
        .replace(/,\s+.*$/g, '')
        .replace(/^\s*(?:a|an|the)\s+/i, '')
        .trim();

    const lower = label.toLowerCase();
    const roleMap = [
        [/professor|교수/, '교수'],
        [/student|학생/, '학생'],
        [/prefect|반장/, '반장'],
        [/ghost|유령/, '유령'],
        [/guard|경비|기사|병사/, '경비'],
        [/servant|시녀|하인/, '시종'],
    ];
    // If the model produced a full descriptive phrase instead of a name, reduce it
    // to a compact role label rather than letting a sentence clutter the parchment.
    if (label.split(/\s+/).length > 4 || /\b(carrying|walking|whispering|waiting|patrolling|crossing|busy|sleepy|arguing|holding|watching)\b/i.test(label)) {
        for (const [pattern, fallback] of roleMap) {
            if (pattern.test(lower) || pattern.test(label)) return fallback;
        }
    }

    return label.slice(0, 34) || '???';
}

function inferLocationIcon(name, situation = '') {
    const text = `${name} ${situation}`.toLowerCase();
    const rules = [
        [/도서관|library|서고|책장/, '📚'],
        [/대연회장|연회장|great hall|식당|dining|banquet|hall/, '🍽️'],
        [/주방|kitchen|부엌/, '🍲'],
        [/휴게실|common room|lounge|거실/, '🛋️'],
        [/교실|classroom|강의실|수업/, '🏫'],
        [/복도|corridor|hallway|통로/, '🚪'],
        [/지하|dungeon|cellar|basement|crypt|지하실/, '🕯️'],
        [/탑|tower|천문|astronomy|옥상|rooftop/, '🔭'],
        [/안뜰|courtyard|광장|yard/, '🏛️'],
        [/부엉이|owlery|owl/, '🦉'],
        [/운동장|퀴디치|pitch|stadium|arena|훈련장|training/, '🧹'],
        [/숲|forest|wood|grove/, '🌲'],
        [/호수|lake|river|바다|shore|부두/, '🌊'],
        [/정원|garden|greenhouse|온실/, '🌿'],
        [/기숙사|dormitory|침실|bedroom|방/, '🛏️'],
        [/사무실|office|교수실|집무실/, '🗄️'],
        [/술집|bar|tavern|pub|여관|inn/, '🍺'],
        [/상점|가게|shop|store|market|시장/, '🛍️'],
        [/의무실|병동|hospital|infirmary|clinic/, '🩹'],
        [/역|station|터미널|platform/, '🚉'],
    ];
    for (const [pattern, icon] of rules) if (pattern.test(text)) return icon;
    return '📍';
}

const KNOWN_NAME_PATTERNS = [];

function extractKnownNames(text) {
    const source = String(text || '');
    return KNOWN_NAME_PATTERNS.filter(name => source.includes(name));
}

function getArrayFromAliases(obj, keys) {
    for (const key of keys) {
        if (Array.isArray(obj?.[key])) return obj[key];
    }
    return null;
}


function locationCrowdMinimum(name, situation = '', map = {}) {
    // Do not auto-fill people by place type. The model must judge visible people
    // from the exact room/area, time, event, and density in the generation prompt.
    return 0;
}

function inferPeopleForLocation(name, situation = '', map = {}) {
    const text = `${name} ${situation} ${map.regionName || ''} ${map.worldSummary || ''}`;
    const lower = text.toLowerCase();
    const people = [];

    if (/도서관|library|서고/.test(lower)) people.push('사서', '책을 찾는 사람', '조용히 메모하는 인물', '구석 자리를 지키는 학생', '책장 사이를 맴도는 사람');
    else if (/연회|식당|hall|dining|banquet/.test(lower)) people.push('손님들', '서빙하는 사람', '입구를 살피는 인물', '낮게 대화하는 무리', '늦게 들어온 사람', '구석 테이블의 관찰자');
    else if (/복도|corridor|통로/.test(lower)) people.push('지나가는 사람', '순찰 중인 인물', '문가에 멈춘 발자국', '급히 속삭이는 두 사람', '벽 쪽에 선 목격자');
    else if (/사무실|office/.test(lower)) people.push('담당자', '서류를 든 직원', '기다리는 방문자', '문밖을 살피는 사람', '늦게 남은 보조 직원');
    else if (/시장|market|상점|shop|street/.test(lower)) people.push('상인', '물건을 고르는 손님', '골목을 살피는 사람', '지나가는 행인들', '가격을 두고 다투는 두 사람');
    else people.push('그 장소에 머무는 인물들', '지나가는 사람', '잠시 멈춘 발자국', '상황을 지켜보는 인물', '낮게 대화하는 두 사람');

    return uniqueStrings(people, 6);
}

function makeCrowdSummariesForLocation(name = '', situation = '', map = {}) {
    const text = `${name} ${situation} ${map.regionName || ''} ${map.worldSummary || ''}`;
    const lower = text.toLowerCase();

    if (/도서관|library/.test(lower)) return ['👥 책을 찾거나 과제를 정리하는 학생들 여러 명'];
    if (/대연회장|연회장|great hall|식당|dining|banquet/.test(lower)) return ['👥 식사와 잡담을 나누는 학생들 여러 명', '👥 테이블 사이를 오가는 학생 무리'];
    if (/주방|kitchen/.test(lower)) return ['👥 바쁘게 오가는 주방 사람들 여러 명'];
    if (/시장|market/.test(lower)) return ['👥 물건을 고르는 손님들 여러 명'];
    if (/술집|tavern|pub/.test(lower)) return ['👥 잔을 기울이며 수군대는 손님들 여러 명'];
    if (/역|station/.test(lower)) return ['👥 발걸음을 재촉하는 승객들 여러 명'];
    if (/교실|classroom/.test(lower)) return ['👥 수업 준비를 하는 학생들 여러 명'];
    if (/복도|corridor|hallway/.test(lower)) return ['👥 지나가며 속삭이는 학생들 여러 명'];
    return ['👥 주변에 머무는 사람들 여러 명'];
}

function makeCrowdSummaryForLocation(name = '', situation = '', map = {}) {
    return makeCrowdSummariesForLocation(name, situation, map)[0] || '👥 주변에 머무는 사람들 여러 명';
}

function normalizePresentForLocation(loc, map, fallback = [], max = 6) {
    const aliases = getArrayFromAliases(loc, ['present', 'people', 'characters', 'npcs', 'NPCs', 'occupants', 'presentPeople', 'peoplePresent', '인물', '주변인물']);
    // Keep model-chosen names exactly as written. Automatic crowd filling may add
    // only ambient/group descriptions; it never adds a named character on its own.
    let values = normalizeStringArray(aliases, [], max)
        .map(normalizePresentDisplayLabel)
        .filter(v => v && !isGenericPersonLabel(v));
    const crowdSummaries = makeCrowdSummariesForLocation(loc.name || '', loc.situation || '', map);
    const crowdSummary = crowdSummaries[0] || '👥 주변에 머무는 사람들 여러 명';
    const inferred = uniquePresentStrings([
        ...crowdSummaries,
        ...inferPeopleForLocation(loc.name || '', loc.situation || '', map)
            .map(normalizePresentDisplayLabel)
            .filter(isAmbientPresenceLabel),
    ], 4);
    const minimum = locationCrowdMinimum(loc.name || '', loc.situation || '', map);
    if (values.length < minimum) {
        const fillLimit = Math.min(max, Math.max(minimum, values.length));
        values = uniquePresentStrings([...values, ...inferred, ...fallback], fillLimit);
    }
    if (values.length < minimum) {
        const fillLimit = Math.min(max, Math.max(minimum, values.length));
        values = uniquePresentStrings([
            ...values,
            crowdSummary,
            '👥 근처에서 낮게 대화하는 사람들 여러 명',
            '👥 잠시 머무는 관찰자 몇 명',
            '👥 지나가는 사람들 여러 명',
        ], fillLimit);
    }
    const hasCrowdSummary = values.some(isCrowdSummaryLabel);
    const shouldAddCrowdSummary = minimum > 0 && values.length > 0 && values.length < max && !hasCrowdSummary;
    if (shouldAddCrowdSummary) {
        const addCount = /휴게실|공용실|common room/i.test(String(loc.name || '')) ? 2 : 1;
        values = uniquePresentStrings([...values, ...crowdSummaries], Math.min(max, values.length + addCount));
    }
    return uniquePresentStrings(values, max).slice(0, max);
}

function synthesizeFootsteps(map, locations, existingFootsteps, currentLocationId, namedPlacements = new Map()) {
    const out = [];
    const existingKey = new Set();
    const add = (label, locationId, status = '지도 위를 지나가는 중') => {
        if (out.length >= FOOTSTEP_LIMIT || !label || !locationId) return;

        const named = isNamedPresentLabel(label);
        const nameKey = exactPresentTextKey(label);
        const assignedLocation = named && namedPlacements.get(nameKey)
            ? namedPlacements.get(nameKey)
            : locationId;
        const key = named ? `named:${nameKey}` : `${label}|${assignedLocation}`;
        if (existingKey.has(key)) return;

        existingKey.add(key);
        out.push({
            id: `auto-foot-${safeId(label)}-${safeId(assignedLocation)}-${out.length}`,
            label,
            locationId: assignedLocation,
            status,
            visibleName: !/흐릿|이름 없는|unknown|\?\?\?/i.test(label),
        });
    };

    for (const fp of existingFootsteps || []) {
        add(fp.label, fp.locationId, fp.status || '지도 위를 지나가는 중');
    }

    const current = (locations || []).find(loc => loc.id === currentLocationId);
    if (current) {
        (current.present || []).filter(p => !isGenericPersonLabel(p)).slice(0, 3)
            .forEach(person => add(person, current.id, '현재 장면 근처에 머무름'));
    }

    for (const loc of locations || []) {
        if (out.length >= FOOTSTEP_LIMIT) break;
        const people = (loc.present || []).filter(p => !isGenericPersonLabel(p));
        const take = loc.id === currentLocationId ? 2 : 1;
        people.slice(0, take).forEach(person => add(person, loc.id, loc.id === currentLocationId ? '현재 장면 근처에 머무름' : `${loc.name} 근처에 있음`));
    }

    return out.slice(0, FOOTSTEP_LIMIT);
}


function firstMeaningfulSentence(text, fallback = '') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return fallback;
    const parts = clean.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [clean];
    return (parts[0] || clean).trim() || fallback;
}

function getMapTopFallbacks(map = {}, locations = []) {
    const currentRaw = String(map.currentLocation || map.currentRegion || map.region || map.place || '').trim();
    const firstLoc = locations[0] || {};
    const firstName = String(firstLoc.name || '').trim();
    const firstSituation = String(firstLoc.situation || '').trim();
    const firstDetails = String(firstLoc.details || '').trim();

    const regionName =
        String(map.regionName || '').trim() ||
        currentRaw ||
        firstName ||
        '현재 구역';

    const worldSummary =
        String(map.worldSummary || map.summary || map.areaSummary || '').trim() ||
        firstMeaningfulSentence(firstSituation || firstDetails, '현재 장면과 주변 장소의 상황이 이어지고 있습니다.');

    const timeHint =
        String(map.timeHint || map.currentTime || map.time || map.when || '').trim() ||
        '현재 장면 시점';

    return { regionName, worldSummary, timeHint };
}



function isPlaceholderLocationName(value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim();
    if (!name) return true;
    if (name.length > 80) return true;
    return /^(?:(?:장소|위치|로케이션|location|place)\s*#?\d*|unknown(?: location)?|알 수 없는 (?:장소|위치)|위치 (?:신호 )?흐림|(?:정확한 )?(?:장소|위치)(?:는|가)?\s*(?:불명|미상|모름|확인되지 않음|확인 불가)|추적 (?:불가|실패)|미상|불명)$/i.test(name)
        || /(?:어딘가|어느 곳|정확한 장소는? (?:불명|미상)|장소를? 알 수 없|위치를? 알 수 없|확실하지 않은 (?:장소|위치))/i.test(name);
}

function normalizeMap(raw, options = {}) {
    const userName = getCurrentUserName();
    const charName = getCurrentCharacterName();
    const map = raw && typeof raw === 'object' ? raw : {};
    const locations = Array.isArray(map.locations) ? map.locations : [];
    const discardedLocations = [];
    const usedLocationIds = new Set();
    const fullGeneration = options?.source === 'full-generation';
    const generationMode = normalizeOutputMode(options?.outputMode || 'basic');
    const locationLimit = fullGeneration ? (generationMode === 'saver' ? 7 : 9) : 12;
    const eventLimit = fullGeneration ? (generationMode === 'saver' ? 3 : 5) : 14;
    const normalizedLocations = locations.slice(0, locationLimit).map((loc, index) => {
        if (!loc || typeof loc !== 'object' || Array.isArray(loc)) {
            discardedLocations.push({ index, reason: 'invalid object' });
            return null;
        }
        const rawName = String(loc.name || loc.locationName || loc.title || loc.label || loc.place || '').trim();
        if (isPlaceholderLocationName(rawName)) {
            discardedLocations.push({ index, reason: 'placeholder name', name: rawName });
            return null;
        }
        const name = rawName;
        const baseId = String(loc.id || safeId(name, `loc-${index}`));
        let id = baseId;
        let suffix = 2;
        while (usedLocationIds.has(id)) id = `${baseId}-${suffix++}`;
        usedLocationIds.add(id);
        const situation = String(loc.situation || loc.currentSituation || loc.description || '이 장소의 현재 상황이 아직 또렷하지 않다.');
        const details = String(loc.details || loc.detail || loc.observation || loc.situation || '');
        const rawIcon = String(loc.icon || '').trim();
        const icon = (!rawIcon || rawIcon === '📍' || rawIcon === '핀' || rawIcon.toLowerCase() === 'pin') ? inferLocationIcon(name, situation) : rawIcon;
        const present = normalizePresentForLocation(loc, map, [index === 0 ? userName : '', index === 0 ? charName : ''].filter(Boolean), 6);
        return {
            id,
            name,
            icon,
            situation,
            details,
            present,
            clues: normalizeStringArray(loc.clues || loc.hooks || loc.signs || loc.events, [], 10),
            eventIds: [],
            injectionText: String(loc.injectionText || loc.injection || loc.roleplayContext || ''),
        };
    }).filter(Boolean);

    if (discardedLocations.length) {
        pushDebugLog('map.normalize.locations.discarded', '유효하지 않은 장소만 제외하고 나머지 지도를 사용합니다.', {
            discarded: discardedLocations,
            accepted: normalizedLocations.length,
        });
    }

    if (normalizedLocations.length === 0) {
        throw new Error('API 연결이 불안정합니다.');
    }

    const validIds = new Set(normalizedLocations.map(l => l.id));
    const locationIdByName = new Map(normalizedLocations.map(loc => [String(loc.name).trim().toLowerCase(), loc.id]));
    const resolveLocationId = (item = {}) => {
        if (validIds.has(item.locationId)) return item.locationId;
        const name = String(item.locationName || item.place || item.location || '').trim().toLowerCase();
        return locationIdByName.get(name) || '';
    };
    const requestedCurrentId = validIds.has(map.currentLocationId)
        ? map.currentLocationId
        : locationIdByName.get(String(map.currentLocationName || '').trim().toLowerCase());
    const currentLocationId = requestedCurrentId || normalizedLocations[0].id;
    const namedPlacements = enforceExactNamedPersonLocations(normalizedLocations);

    // Split quest collections are a full-map model-output contract only.
    // Saved maps and single-location refreshes continue to use legacy events[].
    const hasSeparatedQuestGroups = fullGeneration
        && (Array.isArray(map.worldEvents) || Array.isArray(map.personalEvents));
    const worldQuestLimit = generationMode === 'saver' ? 2 : 4;
    const separatedEvents = hasSeparatedQuestGroups
        ? [
            ...(Array.isArray(map.worldEvents) ? map.worldEvents.slice(0, worldQuestLimit).map(event => ({ ...event, questScope: 'world' })) : []),
            ...(Array.isArray(map.personalEvents) ? map.personalEvents.slice(0, 1).map(event => ({ ...event, questScope: 'personal' })) : []),
        ]
        : [];
    const rawEvents = hasSeparatedQuestGroups ? separatedEvents : (Array.isArray(map.events) ? map.events : []);
    const eventCandidates = rawEvents.slice(0, eventLimit).map((event, index) => {
        if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
        const rawSummary = String(event.summary || '').trim();
        const rawDetails = String(event.details || '').trim();
        if (!String(event.title || '').trim() && !rawSummary && !rawDetails) return null;
        const resolvedLocationId = resolveLocationId(event);
        // A newly generated split quest must point to one of the locations in
        // the same response. Do not silently move a world quest into the
        // protagonists' current location when the model misspells a place.
        if (hasSeparatedQuestGroups && (!resolvedLocationId || resolvedLocationId === currentLocationId)) return null;
        const locationId = resolvedLocationId || currentLocationId;
        const fallbackLocationName = normalizedLocations.find(l => l.id === locationId)?.name || '';
        const rawTitle = String(event.title || '').trim();
        const title = rawTitle && !isGenericEventTitle(rawTitle) ? rawTitle : (fallbackLocationName || `위치 ${index + 1}`);
        const id = String(event.id || `event-${safeId(title, `event-${index}`)}-${index + 1}`);
        return {
            id,
            title,
            locationId,
            summary: String(event.summary || '양피지 위에 희미한 사건의 흔적이 남아 있다.'),
            details: String(event.details || event.summary || ''),
            reward: String(event.reward || event.possibleReward || event.outcome || '보상 정보 없음'),
            questScope: String(event.questScope || event.scope || 'legacy'),
            severity: String(event.severity || '보통'),
            // New observations from the parchment never become active injections automatically.
            // User choices in the reflection panel are the only source of observed/held/injected states.
            status: 'available',
            injectionText: String(event.injectionText || ''),
        };
    }).filter(Boolean);
    const occupiedEventLocations = new Set();
    const events = eventCandidates.filter(event => {
        if (occupiedEventLocations.has(event.locationId)) return false;
        occupiedEventLocations.add(event.locationId);
        return true;
    });

    for (const event of events) {
        const loc = normalizedLocations.find(l => l.id === event.locationId);
        if (loc && !loc.eventIds.includes(event.id)) loc.eventIds.push(event.id);
    }

    let footsteps = Array.isArray(map.footsteps) ? map.footsteps.slice(0, FOOTSTEP_LIMIT).map((fp, index) => {
        if (!fp || typeof fp !== 'object' || Array.isArray(fp)) return null;
        const resolvedLocationId = resolveLocationId(fp);
        if (!resolvedLocationId) return null;
        return {
            id: String(fp.id || `foot-${safeId(fp.label || fp.name || fp.person || 'unknown')}-${index + 1}`),
            label: simplifyFootstepLabel(fp.label || fp.name || fp.person || '???'),
            locationId: resolvedLocationId,
            status: String(fp.status || fp.activity || '움직임이 희미하다.'),
            visibleName: fp.visibleName !== false && !/^\?\?\?$/.test(String(fp.label || fp.name || '')),
        };
    }).filter(Boolean) : [];

    footsteps = synthesizeFootsteps(map, normalizedLocations, footsteps, currentLocationId, namedPlacements);

    const top = getMapTopFallbacks(map, normalizedLocations);

    return {
        mapTitle: getThemeConfig().shortLabel,
        regionName: top.regionName,
        worldSummary: top.worldSummary,
        timeHint: top.timeHint,
        currentLocationId,
        locations: normalizedLocations,
        footsteps,
        events,
    };
}

const QUEST_SCHEMA_ITEM = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        locationName: { type: 'string' },
        summary: { type: 'string' },
        details: { type: 'string' },
        reward: { type: 'string' },
    },
    required: ['title', 'locationName', 'summary', 'details', 'reward'],
};

const MAP_SCHEMA = {
    name: 'RoleplayAreaModel',
    description: 'Structured Korean location and scene data for the supplied roleplay.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            regionName: { type: 'string' },
            worldSummary: { type: 'string' },
            timeHint: { type: 'string' },
            currentLocationName: { type: 'string' },
            locations: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        icon: { type: 'string' },
                        situation: { type: 'string' },
                        details: { type: 'string' },
                        present: { type: 'array', items: { type: 'string' } },
                        clues: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['name', 'icon', 'situation', 'details', 'present', 'clues'],
                },
            },
            footsteps: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        label: { type: 'string' },
                        locationName: { type: 'string' },
                        status: { type: 'string' },
                    },
                    required: ['label', 'locationName', 'status'],
                },
            },
            worldEvents: {
                type: 'array',
                items: QUEST_SCHEMA_ITEM,
            },
            personalEvents: {
                type: 'array',
                items: QUEST_SCHEMA_ITEM,
            },
        },
        required: ['regionName', 'worldSummary', 'timeHint', 'currentLocationName', 'locations', 'footsteps', 'worldEvents', 'personalEvents'],
    },
};

function getMapSchema(outputMode = getOutputModeKey()) {
    const mode = normalizeOutputMode(outputMode);
    const schema = clone(MAP_SCHEMA);
    schema.name = mode === 'saver' ? 'RoleplayAreaSaverModel' : 'RoleplayAreaBasicModel';
    schema.value.properties.locations.maxItems = mode === 'saver' ? 7 : 9;
    schema.value.properties.footsteps.maxItems = 10;
    schema.value.properties.worldEvents.maxItems = mode === 'saver' ? 2 : 4;
    schema.value.properties.personalEvents.maxItems = 1;
    return schema;
}

const LOCATION_SCHEMA = {
    name: 'RoleplayLocationRefreshModel',
    description: 'A refreshed single location and its nearby activity.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            location: MAP_SCHEMA.value.properties.locations.items,
            events: { type: 'array', items: QUEST_SCHEMA_ITEM },
            footsteps: MAP_SCHEMA.value.properties.footsteps,
        },
        required: ['location', 'events', 'footsteps'],
    },
};

const DISCOVERY_CATEGORIES = ['person', 'creature', 'object', 'message', 'place_change', 'incident'];
const DISCOVERY_CATEGORY_FALLBACK_EMOJI = {
    person: '👤',
    creature: '🐾',
    object: '📦',
    message: '✉️',
    place_change: '🚪',
    incident: '⚠️',
};

const DISCOVERY_ITEM_SCHEMA = {
    type: 'object',
    properties: {
        category: { type: 'string', enum: DISCOVERY_CATEGORIES },
        emoji: { type: 'string' },
        title: { type: 'string' },
        locationName: { type: 'string' },
        focus: { type: 'string' },
        focusContext: { type: 'string' },
        observation: { type: 'string' },
        stakes: { type: 'string' },
        interactions: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
        participants: { type: 'array', items: { type: 'string' } },
        sourceAnchors: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
        motifKey: { type: 'string' },
        continuationOf: { type: 'string' },
    },
    required: ['category', 'emoji', 'title', 'locationName', 'focus', 'focusContext', 'observation', 'stakes', 'interactions', 'participants', 'sourceAnchors', 'motifKey', 'continuationOf'],
};

function getDiscoverySchema(outputMode = getOutputModeKey()) {
    const mode = normalizeOutputMode(outputMode);
    return {
        name: mode === 'saver' ? 'MapDiscoveriesSaverModel' : 'MapDiscoveriesBasicModel',
        description: 'Concrete interactive discoveries newly revealed around the supplied roleplay map.',
        strict: true,
        value: {
            '$schema': 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    maxItems: mode === 'saver' ? 5 : 7,
                    items: DISCOVERY_ITEM_SCHEMA,
                },
            },
            required: ['items'],
        },
    };
}

function normalizeDiscoveryText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeLocationBaseName(value) {
    let base = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    let previous = '';
    while (base && base !== previous) {
        previous = base;
        base = base.replace(/\s*[\(\[][^\)\]]+[\)\]]\s*$/u, '').trim();
    }
    return normalizeDiscoveryText(base);
}

function findUnambiguousLocationNameMatch(locations = [], searchedName = '') {
    const searchedKey = normalizeDiscoveryText(searchedName);
    if (!searchedKey) return null;
    const exact = (locations || []).find(location => normalizeDiscoveryText(location?.name) === searchedKey);
    if (exact) return exact;

    const searchedBase = normalizeLocationBaseName(searchedName);
    if (!searchedBase) return null;
    const searchedIsQualified = searchedKey !== searchedBase;
    const candidates = (locations || []).filter(location => {
        const locationKey = normalizeDiscoveryText(location?.name);
        const locationBase = normalizeLocationBaseName(location?.name);
        if (!locationKey || !locationBase || locationBase !== searchedBase) return false;
        const locationIsQualified = locationKey !== locationBase;
        return searchedIsQualified !== locationIsQualified;
    });
    return candidates.length === 1 ? candidates[0] : null;
}

function normalizeDiscoveryCategory(value) {
    const key = normalizeDiscoveryText(value);
    const exact = DISCOVERY_CATEGORIES.find(category => key === category);
    if (exact) return exact;
    if (/인물|npc|person/.test(key)) return 'person';
    if (/동물|생물|크리처|creature|animal/.test(key)) return 'creature';
    if (/물건|아이템|object|item/.test(key)) return 'object';
    if (/메시지|연락|방문|배달|message|visit|delivery/.test(key)) return 'message';
    if (/장소|변화|place change|place/.test(key)) return 'place_change';
    if (/사건|사고|징후|소동|위험|incident|event|disturbance|hazard|signal/.test(key)) return 'incident';
    return '';
}

const DISCOVERY_EMOJI_FOCUS_RULES = [
    { pattern: /(?:고양이|길고양이|cat)/i, allowed: ['🐈', '🐈‍⬛', '🐱', '🐾'], fallback: '🐈' },
    { pattern: /(?:강아지|(?:검은|하얀|흰|갈색|다친|사나운|길 잃은)\s+개(?:가|는|를|와|과|에게|한테|$|[,.!?])|dog|puppy)/i, allowed: ['🐕', '🐶', '🐾'], fallback: '🐕' },
    { pattern: /(?:박쥐|bat)/i, allowed: ['🦇'], fallback: '🦇' },
    { pattern: /(?:조류|부엉이|올빼미|새끼\s*새|새\s+(?:한|두|세|네)\s*마리|(?:검은|하얀|흰|갈색|작은|다친|길 잃은)\s+새(?:가|는|를|의|떼|$|[,.!?])|(?:^|\s)새(?:가|를|의|떼)|bird|owl)/i, allowed: ['🐦', '🦉', '🦅', '🐥', '🪽', '🐾'], fallback: '🐦' },
    { pattern: /(?:편지|봉투|우편|서신|letter|envelope|mail)/i, allowed: ['✉️', '💌', '📩', '📨', '📧', '📮'], fallback: '✉️' },
    { pattern: /(?:소포|택배|꾸러미|배송 상자|package|parcel)/i, allowed: ['📦', '🎁'], fallback: '📦' },
    { pattern: /(?:출입문|비밀문|문짝|(?:^|\s)문(?:이|은|을|의|과|앞|뒤|틈|손잡이|\s|$)|door|gate)/i, allowed: ['🚪'], fallback: '🚪' },
    { pattern: /(?:열쇠|key)/i, allowed: ['🗝️', '🔑'], fallback: '🗝️' },
    { pattern: /(?:약병|물약|시약|medicine|potion|vial)/i, allowed: ['🧪', '💊', '⚗️'], fallback: '🧪' },
    { pattern: /(?:수첩|일지|(?:^|\s)책(?:이|은|을|의|과|속|\s|$)|book|notebook|journal)/i, allowed: ['📖', '📕', '📓', '📔'], fallback: '📖' },
    { pattern: /(?:전화|휴대전화|메시지|문자|phone|call|text message)/i, allowed: ['📱', '☎️', '📞', '💬'], fallback: '📱' },
    { pattern: /(?:양초|촛불|초의 불꽃|candle)/i, allowed: ['🕯️'], fallback: '🕯️' },
    { pattern: /(?:깃펜|펜촉|만년필|quill|fountain pen)/i, allowed: ['🪶', '🖋️', '✒️'], fallback: '🪶' },
    { pattern: /(?:오크통|술통|맥주통|barrel|cask)/i, allowed: ['🛢️', '🍺'], fallback: '🛢️' },
    { pattern: /(?:그림(?!자)|초상화|벽화|painting|portrait|mural)/i, allowed: ['🖼️'], fallback: '🖼️' },
    { pattern: /(?:불길|화재|불이 붙|fire|flame)/i, allowed: ['🔥', '🧯'], fallback: '🔥' },
];

function normalizeDiscoveryEmoji(value, category, focusText = '') {
    const compact = String(value || '').trim().replace(/\s+/g, '');
    const pictographs = compact.match(/\p{Extended_Pictographic}/gu) || [];
    let graphemeCount = Array.from(compact).length;
    try {
        graphemeCount = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(compact)].length;
    } catch {
        // Array.from remains a conservative fallback in older WebViews.
    }
    let candidate = compact && pictographs.length >= 1 && graphemeCount === 1 && Array.from(compact).length <= 8 && !/[a-z0-9가-힣]/iu.test(compact)
        ? compact
        : (DISCOVERY_CATEGORY_FALLBACK_EMOJI[normalizeDiscoveryCategory(category)] || '🔎');
    const focusRule = DISCOVERY_EMOJI_FOCUS_RULES.find(rule => rule.pattern.test(String(focusText || '')));
    if (focusRule && !focusRule.allowed.includes(candidate)) return focusRule.fallback;

    const normalizedCategory = normalizeDiscoveryCategory(category);
    const abstractMarkers = new Set(['🔎', '🔍', '✨', '⭐', '🌟', '💫', '❓', '❔', '🪢']);
    if (abstractMarkers.has(candidate)) {
        candidate = DISCOVERY_CATEGORY_FALLBACK_EMOJI[normalizedCategory] || '🔎';
    }
    if (normalizedCategory === 'message' && !['✉️', '💌', '📩', '📨', '📧', '📮', '📱', '☎️', '📞', '💬'].includes(candidate)) return '✉️';
    if (normalizedCategory === 'person' && ['🐾', '🐈', '🐕', '🐦', '✉️', '💌', '📦', '🚪', '⚠️'].includes(candidate)) return '👤';
    if (normalizedCategory === 'creature' && ['👤', '✉️', '💌', '📦', '🚪', '⚠️'].includes(candidate)) return '🐾';
    return candidate;
}

function makeDiscoveryFingerprint(item = {}) {
    const people = (item.participants || []).map(normalizeDiscoveryText).filter(Boolean).sort().slice(0, 4).join('+');
    const motif = normalizeDiscoveryText(item.motifKey || item.title).split(' ').slice(0, 12).join(' ');
    const location = normalizeDiscoveryText(item.locationName || item.locationId);
    const focus = normalizeDiscoveryText(item.focus || item.title).split(' ').slice(0, 10).join(' ');
    return [normalizeDiscoveryCategory(item.category), focus, people, location, motif].join('|');
}

function discoveryTextSimilarity(left, right) {
    const a = new Set(normalizeDiscoveryText(left).split(' ').filter(Boolean));
    const b = new Set(normalizeDiscoveryText(right).split(' ').filter(Boolean));
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach(token => { if (b.has(token)) overlap += 1; });
    return overlap / (a.size + b.size - overlap);
}

function isDuplicateDiscovery(candidate, previous) {
    if (!candidate || !previous) return false;
    if (makeDiscoveryFingerprint(candidate) === String(previous.fingerprint || makeDiscoveryFingerprint(previous))) return true;
    const sameCategory = normalizeDiscoveryCategory(candidate.category) === normalizeDiscoveryCategory(previous.category);
    const sameLocation = normalizeDiscoveryText(candidate.locationName) === normalizeDiscoveryText(previous.locationName);
    const candidatePeople = new Set((candidate.participants || []).map(normalizeDiscoveryText).filter(Boolean));
    const previousPeople = (previous.participants || previous.focalParticipants || []).map(normalizeDiscoveryText).filter(Boolean);
    const sharedPerson = previousPeople.some(person => candidatePeople.has(person));
    const premiseSimilarity = Math.max(
        discoveryTextSimilarity(candidate.motifKey || candidate.title, previous.motifKey || previous.titleKey),
        discoveryTextSimilarity(candidate.title, previous.title || previous.titleKey),
        discoveryTextSimilarity(candidate.observation, previous.observation || previous.body),
    );
    return premiseSimilarity >= 0.62 && ((sameCategory && sameLocation) || sharedPerson);
}

function discoveryContainmentSimilarity(left, right) {
    const a = new Set(normalizeDiscoveryText(left).split(' ').filter(token => token.length > 1));
    const b = new Set(normalizeDiscoveryText(right).split(' ').filter(token => token.length > 1));
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach(token => { if (b.has(token)) overlap += 1; });
    return overlap / Math.min(a.size, b.size);
}

function discoverySimilarity(left, right) {
    return Math.max(discoveryTextSimilarity(left, right), discoveryContainmentSimilarity(left, right));
}

function discoveryHasNamedProtagonistFocus(item = {}) {
    const names = [getCurrentUserName(), getCurrentCharacterName()].map(normalizeDiscoveryText).filter(Boolean);
    const focus = normalizeDiscoveryText(item.focus);
    const participants = (item.participants || []).map(normalizeDiscoveryText);
    return names.some(name => focus.includes(name) || participants.includes(name));
}

function discoveryIsCurrentSceneSummary(item = {}, map = {}) {
    if (String(item.locationId || '') !== String(map.currentLocationId || '')) return false;
    const names = [getCurrentUserName(), getCurrentCharacterName()].map(normalizeDiscoveryText).filter(Boolean);
    const focus = normalizeDiscoveryText(item.focus);
    const mentionsProtagonist = names.some(name => focus.includes(name));
    if (!mentionsProtagonist) return false;
    let remainder = ` ${focus} `;
    names.forEach(name => { remainder = remainder.replaceAll(name, ' '); });
    remainder = remainder.replace(/(두 사람|대화|관계|분위기|시선|표정|접촉|상황|사이의|사이|그들|그녀들|그들의|그녀들의)/g, ' ').replace(/\s+/g, ' ').trim();
    remainder = remainder.split(' ').filter(token => token.length > 1).join(' ');
    const concreteExternalState = /(불씨|화재|연기|파손|분실|도난|고장|붕괴|부상|혈흔|잠김|누출|알람|소포|편지|메시지|동물|생물|물건|장치|문|통로|사고|위험)/.test(normalizeDiscoveryText(`${item.focus} ${item.stakes}`));
    return item.category === 'person' || !remainder || (item.category === 'incident' && !concreteExternalState);
}

function discoveryLooksAnonymous(item = {}) {
    const focus = normalizeDiscoveryText(item.focus);
    const title = normalizeDiscoveryText(item.title);
    return /(^| )(?:누군가|정체불명|정체 모를|알 수 없는|이름 모를|낯선 인물|의문의 인물|감시자|그림자)(?: |$)/.test(`${focus} ${title}`);
}

function discoveryLooksLikeRoutineMovement(item = {}) {
    const text = normalizeDiscoveryText(`${item.title} ${item.focus} ${item.observation}`);
    const routine = /(분주한 발걸음|일상적인 이동|평범한 이동|오가는 사람|지나가는 사람|귀가하는|복귀하는|이동 중인 학생|통행 중인)/.test(text);
    const concreteChange = /(갇혀|다쳐|고장|사라져|깨져|잠겨|막혀|연기|화재|혈흔|도난|울려|흔들려|추격|위험|떨어져|찢어져|긴급|도움|충돌)/.test(text);
    return routine && !concreteChange;
}

function discoveryHasUsefulInteractions(interactions = []) {
    const lowValue = /^(지켜보기|관찰하기|무시하기|기다리기|아무것도 하지 않기|지켜본다|관찰한다|무시한다|기다린다)$/;
    return interactions.filter(value => !lowValue.test(normalizeDiscoveryText(value))).length >= 2;
}

function discoveryAnchorsHaveContinuitySupport(sourceAnchors = [], map = {}) {
    const continuity = [];
    (map.locations || []).forEach(location => {
        continuity.push(location.name, location.situation, location.details, ...(location.present || []), ...(location.clues || []));
    });
    (map.footsteps || []).forEach(footstep => continuity.push(footstep.label, footstep.status));
    (map.events || []).forEach(event => continuity.push(event.title, event.summary, event.details));
    continuity.push(getCharacterSummary(), getPersonaSummary(), ...getChatSnapshot(10).split(/\n\s*\n/));
    const usable = continuity.filter(Boolean);
    return sourceAnchors.some(anchor => usable.some(source => discoverySimilarity(anchor, source) >= 0.18));
}

function discoveryMatchesExistingMapContent(item, map) {
    const candidate = `${item.title} ${item.focus} ${item.observation} ${item.stakes}`;
    const location = (map.locations || []).find(entry => entry.id === item.locationId);
    const locationTexts = [location?.situation, location?.details].filter(Boolean);
    if (locationTexts.some(text => discoverySimilarity(candidate, text) >= 0.72)) return 'current location retelling';

    const questDuplicate = (map.events || []).some(event => {
        const eventText = `${event.title || ''} ${event.summary || ''} ${event.details || ''}`;
        return discoverySimilarity(candidate, eventText) >= 0.68;
    });
    if (questDuplicate) return 'existing quest duplicate';

    const focus = normalizeDiscoveryText(item.focus);
    const footstepDuplicate = (map.footsteps || []).some(footstep => {
        const label = normalizeDiscoveryText(footstep.label);
        if (!label || !(focus === label || focus.startsWith(`${label} `))) return false;
        return discoverySimilarity(item.observation, footstep.status) >= 0.74;
    });
    if (footstepDuplicate) return 'existing footstep duplicate';

    const recentMessages = getChatSnapshot(10).split(/\n\s*\n/).filter(Boolean);
    if (recentMessages.some(text => discoverySimilarity(candidate, text) >= 0.78)) return 'recent roleplay retelling';
    return '';
}

function discoveryFingerprintParts(item = {}) {
    return {
        id: String(item.id || item.historyId || ''),
        fingerprint: item.fingerprint || makeDiscoveryFingerprint(item),
        category: normalizeDiscoveryCategory(item.category),
        focus: String(item.focus || item.title || ''),
        focalParticipants: (item.participants || []).slice(0, 4),
        locationName: String(item.locationName || ''),
        motifKey: String(item.motifKey || item.title || ''),
        titleKey: normalizeDiscoveryText(item.title),
        observation: stripLong(item.observation || item.body || '', 320),
        stakes: stripLong(item.stakes || '', 160),
        createdAt: nowStamp(),
        outcome: String(item.outcome || 'shown'),
    };
}

function normalizeDiscoveries(raw, map, history = [], outputMode = getOutputModeKey()) {
    if (!isValidMapData(map)) throw new Error('주변 발견을 연결할 지도 정보가 없습니다.');
    const mode = normalizeOutputMode(outputMode);
    const maximum = mode === 'saver' ? 5 : 7;
    const source = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.discoveries) ? raw.discoveries : []);
    const locationById = new Map(map.locations.map(location => [String(location.id), location]));
    const locationByName = new Map(map.locations.map(location => [normalizeDiscoveryText(location.name), location]));
    const candidates = [];
    const rejected = [];
    const stamp = Date.now();
    const historyIds = new Map((history || []).filter(entry => entry?.id).map(entry => [String(entry.id), entry]));

    for (let index = 0; index < source.length; index++) {
        const item = source[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            rejected.push({ index, reason: 'invalid object' });
            continue;
        }
        const location = locationById.get(String(item.locationId || ''))
            || locationByName.get(normalizeDiscoveryText(item.locationName));
        const title = String(item.title || '').replace(/\s+/g, ' ').trim();
        const focus = String(item.focus || item.subject || '').replace(/\s+/g, ' ').trim();
        const focusContext = String(item.focusContext || item.subjectContext || item.identity || '').replace(/\s+/g, ' ').trim();
        const observation = String(item.observation || item.body || item.scene || item.details || '').replace(/\s+/g, ' ').trim();
        const stakes = String(item.stakes || item.unresolvedState || item.consequence || '').replace(/\s+/g, ' ').trim();
        const interactions = uniqueStrings(item.interactions || item.actions || item.options || [], 3).filter(value => value.length >= 3 && value.length <= 100);
        const rawParticipants = Array.isArray(item.participants) ? item.participants : (Array.isArray(item.people) ? item.people : []);
        const rawAnchors = Array.isArray(item.sourceAnchors) ? item.sourceAnchors : (Array.isArray(item.anchors) ? item.anchors : (Array.isArray(item.references) ? item.references : []));
        const participants = uniqueStrings(rawParticipants, 8);
        const sourceAnchors = uniqueStrings(rawAnchors, 4);
        const category = normalizeDiscoveryCategory(item.category);
        if (!category) {
            rejected.push({ index, reason: 'unsupported or abstract category' });
            continue;
        }
        if (!location || !title || !focus || !focusContext || !observation || !stakes) {
            rejected.push({ index, reason: !location ? 'unknown location' : (!title ? 'empty title' : (!focus ? 'empty focus' : (!focusContext ? 'empty focus context' : (!observation ? 'empty observation' : 'empty stakes')))) });
            continue;
        }
        if (observation.length < 60 || stakes.length < 12 || sourceAnchors.length < 1 || !discoveryHasUsefulInteractions(interactions)) {
            rejected.push({ index, reason: observation.length < 60 ? 'observation too thin' : (stakes.length < 12 ? 'stakes too thin' : (sourceAnchors.length < 1 ? 'missing source anchor' : 'no useful interactions')) });
            continue;
        }
        const continuationOf = String(item.continuationOf || '').trim();
        const continuedEntry = continuationOf ? historyIds.get(continuationOf) : null;
        if (continuationOf && !continuedEntry) {
            rejected.push({ index, reason: 'unknown continuation id', continuationOf });
            continue;
        }
        const normalized = {
            id: `discovery-${stamp}-${index + 1}-${safeId(title, 'scene')}`,
            type: 'discovery',
            category,
            emoji: normalizeDiscoveryEmoji(item.emoji, category, `${title} ${focus} ${focusContext}`),
            title,
            locationId: location.id,
            locationName: location.name,
            focus,
            focusContext,
            observation,
            stakes,
            interactions,
            participants,
            sourceAnchors,
            motifKey: String(item.motifKey || title).replace(/\s+/g, ' ').trim(),
            continuationOf,
            createdAt: nowStamp(),
        };
        if (discoveryLooksAnonymous(normalized)) {
            rejected.push({ index, reason: 'anonymous watcher or subject' });
            continue;
        }
        if (discoveryLooksLikeRoutineMovement(normalized)) {
            rejected.push({ index, reason: 'routine movement only' });
            continue;
        }
        if (discoveryIsCurrentSceneSummary(normalized, map)) {
            rejected.push({ index, reason: 'current protagonist scene summary' });
            continue;
        }
        if (!discoveryAnchorsHaveContinuitySupport(normalized.sourceAnchors, map)) {
            rejected.push({ index, reason: 'unsupported source anchors' });
            continue;
        }
        const existingMatch = discoveryMatchesExistingMapContent(normalized, map);
        if (existingMatch) {
            rejected.push({ index, reason: existingMatch });
            continue;
        }
        if (continuedEntry) {
            const relatedContinuation = normalizeDiscoveryText(continuedEntry.locationName) === normalizeDiscoveryText(normalized.locationName)
                || discoverySimilarity(continuedEntry.focus || '', normalized.focus) >= 0.45
                || discoverySimilarity(continuedEntry.motifKey || '', normalized.motifKey) >= 0.45;
            if (!relatedContinuation || discoverySimilarity(continuedEntry.observation || '', normalized.observation) >= 0.82) {
                rejected.push({ index, reason: !relatedContinuation ? 'unrelated continuation' : 'unchanged continuation', continuationOf });
                continue;
            }
        }
        normalized.fingerprint = makeDiscoveryFingerprint(normalized);
        const repeatedInBatch = candidates.some(previous => isDuplicateDiscovery(normalized, previous));
        const repeatedInHistory = !normalized.continuationOf && (history || []).some(previous => isDuplicateDiscovery(normalized, previous));
        const repeated = repeatedInBatch || repeatedInHistory;
        if (repeated) {
            rejected.push({ index, reason: 'duplicate', fingerprint: normalized.fingerprint });
            continue;
        }
        candidates.push(normalized);
    }

    const accepted = [];
    const usedCategories = new Set();
    const categoryCounts = new Map();
    const locationCounts = new Map();
    let protagonistFocused = 0;
    const canSelect = (item, distinctCategoryPass) => {
        if (accepted.length >= maximum) return false;
        if (distinctCategoryPass && usedCategories.has(item.category)) return false;
        if ((categoryCounts.get(item.category) || 0) >= 2) return false;
        if ((locationCounts.get(item.locationId) || 0) >= 2) return false;
        if (discoveryHasNamedProtagonistFocus(item) && protagonistFocused >= 1) return false;
        return true;
    };
    const select = item => {
        accepted.push(item);
        usedCategories.add(item.category);
        categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
        locationCounts.set(item.locationId, (locationCounts.get(item.locationId) || 0) + 1);
        if (discoveryHasNamedProtagonistFocus(item)) protagonistFocused += 1;
    };
    candidates.forEach(item => { if (canSelect(item, true)) select(item); });
    candidates.forEach(item => { if (!accepted.includes(item) && canSelect(item, false)) select(item); });

    if (rejected.length) {
        pushDebugLog('discovery.normalize.discarded', '중복되거나 실제 발견으로 사용할 수 없는 항목을 제외했습니다.', { rejected, accepted: accepted.length });
    }
    if (!accepted.length) throw new Error('사용할 수 있는 구체적인 발견을 읽지 못했습니다.');
    return accepted;
}

function appendDiscoveryHistory(memory, items) {
    const next = (items || []).map(discoveryFingerprintParts);
    const seen = new Set();
    memory.discoveryHistory = [...next, ...(memory.discoveryHistory || [])]
        .filter(entry => {
            const key = String(entry?.fingerprint || '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, DISCOVERY_HISTORY_LIMIT);
}

function reconcileTransientDiscoveries(memory, map) {
    if (!memory || !isValidMapData(map) || !Array.isArray(memory.discoveries)) return;
    const byId = new Map(map.locations.map(location => [String(location.id), location]));
    const byName = new Map(map.locations.map(location => [normalizeDiscoveryText(location.name), location]));
    memory.discoveries = memory.discoveries.map(item => {
        const location = byId.get(String(item.locationId || ''))
            || byName.get(normalizeDiscoveryText(item.locationName));
        return location ? { ...item, locationId: location.id, locationName: location.name } : null;
    }).filter(Boolean);
}

function updateDiscoveryHistoryOutcome(memory, discovery, outcome) {
    const fingerprint = discovery?.fingerprint || makeDiscoveryFingerprint(discovery || {});
    const entry = (memory.discoveryHistory || []).find(item => item?.fingerprint === fingerprint);
    if (entry) entry.outcome = String(outcome || entry.outcome || 'shown');
}

function getDiscoveryCategoryIcon(category) {
    return DISCOVERY_CATEGORY_FALLBACK_EMOJI[normalizeDiscoveryCategory(category)] || '🔎';
}

function buildDiscoveryPrompt(outputMode = getOutputModeKey()) {
    const memory = ensureMemory();
    const mode = normalizeOutputMode(outputMode);
    const config = OUTPUT_MODE_CONFIGS[mode];
    const map = memory.map;
    const mapContext = (map?.locations || []).map(location => {
        const footsteps = (map.footsteps || [])
            .filter(footstep => footstep.locationId === location.id)
            .map(footstep => `${footstep.label}: ${footstep.status}`);
        return `- ${location.name}\n  Known baseline: ${stripLong(location.situation, 300)}\n  Additional known details: ${stripLong(location.details, 220)}\n  Present: ${(location.present || []).join(', ') || '(none visible)'}\n  Movement already represented by footsteps: ${footsteps.join(' / ') || '(none)'}\n  Existing local anchors: ${(location.clues || []).join(' / ') || '(none)'}`;
    }).join('\n');
    const existingQuests = (map?.events || []).map(event => {
        const location = (map.locations || []).find(entry => entry.id === event.locationId);
        return `- ${event.title} @ ${location?.name || event.locationId || '(unknown)'}: ${stripLong(`${event.summary || ''} ${event.details || ''}`, 260)}`;
    }).join('\n');
    const history = (memory.discoveryHistory || []).slice(0, DISCOVERY_HISTORY_LIMIT).map(entry => ({
        id: entry.id,
        category: entry.category,
        focus: entry.focus,
        focalParticipants: entry.focalParticipants,
        locationName: entry.locationName,
        motifKey: entry.motifKey,
        titleKey: entry.titleKey,
        observation: entry.observation,
        stakes: entry.stakes,
        outcome: entry.outcome,
    }));
    return `
Create ${config.discoveryRange} distinct discoveries that become newly visible around the supplied roleplay map.

A discovery is one concrete person, creature, object, message, changed place, or sign of an incident that is not yet represented by the returned locations, footsteps, or quests. Treat the map, recent roleplay, character card, and persona as continuity evidence. Every result adds one new external state that follows from that evidence.

Every discovery must answer four practical questions:
1. focus and focusContext: exactly what was found, who or what it is, and why it belongs at this location;
2. observation: what is visibly or audibly happening now, in 2 to 4 natural Korean sentences with concrete sensory and behavioral details;
3. stakes: the concrete near-future change that will occur at this place if nobody intervenes;
4. interactions: 2 to 3 materially different things a character could attempt, inspect, ask, move, help, stop, open, follow, repair, deliver, or otherwise engage with.

Use sourceAnchors for 1 to 4 confirmed continuity facts that support the discovery. These are internal grounding data, so keep them concise and factual. Give every item one relevant, intuitive emoji for its actual focus, such as 🐈 or 🐾 for an animal, 💌 or ✉️ for a letter, 👤 or a fitting person emoji for a person, 🚪 for a door, or 📦 for a parcel. The emoji is a miniature label for the literal focus: a reader should be able to guess what was found without a category legend.

Set allocation:
- Use only person, creature, object, message, place_change, and incident categories.
- Use as many distinct categories, focal subjects, locations, and premises as the supplied continuity supports before repeating a category.
- Prefer a physically varied set with different practical roles: for example a living subject, a communication or delivery, a usable or misplaced object, a changed access point, or an incident already beginning. Choose only forms supported by the supplied continuity, and avoid filling the set with several similar loose props or decorative oddities.
- Choose the literal focus first, then assign the matching category and a single emoji that depicts that focus rather than its mood, importance, or effect.
- No location receives more than two discoveries.
- At most one discovery directly focuses on the Current user or Current character. Allocate the remaining discoveries to surrounding named people, specific creatures, known objects, incoming messages or visitors, changed places, and active incident signs elsewhere on the map.
- A person discovery contains a specific new problem, decision, exchange, mistake, opportunity, or change beyond that person's already shown location and movement.
- A newly introduced person has a specific name or clearly identified role, a concrete reason to be here now, and enough identity in focusContext for the user to understand them immediately.
- Ordinary movement and atmosphere stay in the map and footsteps. A discovery adds a concrete subject, a changing state, and useful ways to interact.

Use continuationOf only when this is a changed continuation of one exact discovery id supplied in Recent discovery history. Otherwise return an empty string. A continuation must advance that earlier state rather than repeat it.

Return category, emoji, title, locationName, focus, focusContext, observation, stakes, interactions, participants, sourceAnchors, motifKey, and continuationOf for every item. Internal IDs, marker placement, and roleplay reflection text are added locally.

Current user: ${getCurrentUserName()}
Current character: ${getCurrentCharacterName()}

[Current area]
Region: ${map?.regionName || ''}
Time: ${map?.timeHint || ''}
${mapContext || '(no locations)'}

[Quests already represented on the map]
${existingQuests || '(none)'}

[Reflected context]
${buildActiveInjectionSummary() || '(none)'}

[Recent discovery history]
${JSON.stringify(history, null, 2)}

[Character card]
${getCharacterSummary() || '(unavailable)'}

[Persona]
${getPersonaSummary() || '(unavailable)'}

[Recent roleplay]
${getChatSnapshot(10) || '(no recent roleplay)'}

Return JSON only.`;
}

const FOOTSTEP_PROFILE_SCHEMA = {
    name: 'RoleplayPersonStatusModel',
    description: 'A Korean character status card grounded in the supplied roleplay.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            name: { type: 'string' },
            gender: { type: 'string' },
            age: { type: 'string' },
            ageBasis: { type: 'string' },
            characterInfo: { type: 'string' },
            currentMood: { type: 'string' },
            currentLocation: { type: 'string' },
            currentActivity: { type: 'string' },
            relationshipWithUser: { type: 'string' },
            lastEncounterWithUser: { type: 'string' },
            currentTask: { type: 'string' },
            thoughts: { type: 'string' },
            pocketContents: { type: 'array', items: { type: 'string' } },
            hooks: { type: 'array', items: { type: 'string' } },
            injectionText: { type: 'string' },
        },
        required: ['name', 'gender', 'age', 'ageBasis', 'characterInfo', 'currentMood', 'currentLocation', 'currentActivity', 'relationshipWithUser', 'lastEncounterWithUser', 'currentTask', 'thoughts', 'pocketContents', 'hooks', 'injectionText'],
    },
};


function buildQuestContinuityRegistry(memory = ensureMemory()) {
    const map = memory?.map;
    const locationById = new Map((map?.locations || []).map(location => [String(location.id), location.name]));
    const peopleByLocation = new Map();
    const addPerson = (locationName, person) => {
        const place = String(locationName || '').trim();
        const name = String(person || '').replace(/\s+/g, ' ').trim();
        if (!place || !name || isGenericPersonLabel(name)) return;
        const names = peopleByLocation.get(place) || [];
        peopleByLocation.set(place, uniqueStrings([...names, name], 8));
    };

    for (const location of map?.locations || []) {
        for (const person of location.present || []) addPerson(location.name, person);
    }
    for (const footstep of map?.footsteps || []) {
        addPerson(locationById.get(String(footstep.locationId)), footstep.label);
    }

    const currentAreaLocations = (map?.locations || []).filter(location => location?.source !== 'person-search');
    const remoteSearchLocations = (map?.locations || []).filter(location => location?.source === 'person-search');
    const locationLines = currentAreaLocations.slice(0, 12).map(location => {
        const people = peopleByLocation.get(location.name) || [];
        return `- ${location.name}${people.length ? ` | associated people: ${people.join(', ')}` : ''}`;
    });
    const remoteLocationLines = remoteSearchLocations.slice(0, 12).map(location => {
        const people = peopleByLocation.get(location.name) || [];
        const observedState = stripLong(`${location.situation || ''} ${location.details || ''}`, 260);
        return `- ${location.name}${people.length ? ` | observed people: ${people.join(', ')}` : ''}${observedState ? ` | last observed state: ${observedState}` : ''}`;
    });
    const trackedLines = Object.values(memory?.trackedPeople || {}).slice(0, 12).map(person => {
        const name = String(person?.name || '').replace(/\s+/g, ' ').trim();
        if (!name) return '';
        const location = String(person?.lastLocation || '').replace(/\s+/g, ' ').trim();
        const role = stripLong(person?.summary || person?.lastActivity || '', 140);
        return `- ${name}${location ? ` | last known place: ${location}` : ''}${role ? ` | known context: ${role}` : ''}`;
    }).filter(Boolean);

    if (!locationLines.length && !remoteLocationLines.length && !trackedLines.length) return '(none available yet)';
    return [
        locationLines.length ? `Earlier current-area locations and associated people:\n${locationLines.join('\n')}` : '',
        remoteLocationLines.length ? `Remote person-search continuity leads at their own places:\n${remoteLocationLines.join('\n')}` : '',
        trackedLines.length ? `Tracked or previously identified people:\n${trackedLines.join('\n')}` : '',
    ].filter(Boolean).join('\n');
}

function buildMapPrompt(outputMode = getOutputModeKey()) {
    const memory = ensureMemory();
    const mode = normalizeOutputMode(outputMode);
    const config = OUTPUT_MODE_CONFIGS[mode];
    const densityRules = mode === 'saver'
        ? `Choose 4 to 7 locations, then use the matching density:\n- 4 locations: situation 8 to 10 Korean sentences; details 4 sentences.\n- 5 locations: situation 7 to 8 Korean sentences; details 3 to 4 sentences.\n- 6 locations: situation 5 to 7 Korean sentences; details 3 sentences.\n- 7 locations: situation 4 to 5 Korean sentences; details 3 sentences.`
        : `Create 6 to 9 locations. Each situation has 8 to 12 Korean sentences and each details field adds 4 to 6 Korean sentences. Balance the set so location count, prose density, footsteps, and quests do not all reach their maximum at once.`;
    const questAllocation = mode === 'saver'
        ? '- worldEvents: exactly 2 independent parallel-world quests.\n- personalEvents: 0 or 1 protagonist-linked quest.\n- Total: 2 to 3 quests.'
        : '- worldEvents: 3 to 4 independent parallel-world quests.\n- personalEvents: 0 or 1 protagonist-linked quest.\n- Total: 3 to 5 quests.';
    return `
Read the supplied roleplay context and return structured location data for the same world, time, and ongoing continuity.

Output density:
- Mode: ${config.label}
- Locations: ${config.locationRange}
- Location situation length: ${config.situationRange} Korean sentences; details: ${config.detailsRange} Korean sentences
- Footsteps or person movement signals: 6 to 10
- Quest allocation:
${questAllocation}
- Every quest summary and details field: 3 to 5 complete Korean sentences each
${densityRules}

Map structure:
- regionName is the concrete area covered by this snapshot.
- timeHint states the current time, scene phase, or immediate timing.
- worldSummary describes the active area in 1 to 2 Korean sentences.
- currentLocationName exactly matches one returned location name.
- Every location has a specific in-world name, a fitting emoji icon, a situation, details, present, and clues.
- Every footstep has a person name or established title, the exact returned locationName, and a concrete visible activity in status.
- Every worldEvents and personalEvents quest has a concrete title, the exact returned locationName, summary, details, and reward.

Location writing:
- Treat all locations as one simultaneous snapshot of the supplied roleplay.
- Keep each recurring person in one location and preserve the display spelling used in the roleplay.
- present contains only people or groups physically visible at that exact place and moment, from 0 to 6 entries.
- A visible group is one complete Korean phrase stating what kind of group is there, what they are doing or where they gather, and a plausible rough count.
- situation establishes the recognizable physical place: layout, entrances, surfaces, furniture or structures, light, air, sound, material, movement, and the activity already occurring there.
- details is a second view of the same place and moment. Add a distinct local beat, object, exchange, trace, risk, expectation, or change without repeating situation.
- Place named people through visible posture, movement, work, dialogue, objects, attention, avoidance, or interaction. Align their actions across situation, present, footsteps, and quests.
- Quiet places remain playable through a concrete routine, object, expectation, interruption, or unsettled detail. Busy places remain readable through the visible flow of people and competing activity.
- clues are short locally observable anchors that can help continue a scene.

Quest writing:
- The protagonists are the Current user and Current character named below. The protagonists' current activity belongs in currentLocationName, location.situation, and location.details.
- Across both quest arrays, use returned locations other than currentLocationName and assign at most one quest to each location.
- Every worldEvents quest is already unfolding at another returned location during the same time period. Its causal chain begins with a secondary character, named group, institution, community, environment, organization, or local system rather than the protagonists' latest conversation.
- Give every worldEvents quest a specific actor, immediate goal, active obstacle, meaningful consequence if unresolved, and a believable entry point through which the protagonists could hear about it, encounter it, join it, help it, oppose it, investigate it, compete, negotiate, or otherwise become involved.
- Prefer established secondary characters, groups, places, and unresolved world facts from the supplied continuity. When a new actor is useful, give that actor a specific name or clearly identified group role suited to the current setting.
- Diversify worldEvents across distinct forms suited to the supplied world: a secondary character's plan or problem; an open recruitment, contest, event, service, or commission; a change involving an institution, community, environment, organization, or local system; and a social, comic, practical, risky, or advantageous opportunity.
- Every worldEvents quest continues through its own actors and circumstances whether or not the protagonists arrive. Vary the central actor, location, objective, obstacle, tone, and kind of choice.
- Use personalEvents only when a confirmed earlier action by either protagonist has produced a concrete response elsewhere. Place that response in the hands of another named character or group who is waiting, searching, preparing, reacting, demanding, offering, concealing, confronting, or changing plans because of what occurred.
- A personalEvents quest creates a new external decision point. Return an empty personalEvents array when the supplied continuity does not support a specific external consequence.
- Give every quest an actionable objective, obstacle, entry point, consequence, and usable reward. Surrounding activity whose interest comes from observation alone belongs in the relevant location description.
- reward names a concrete, usable result that the people or situation can plausibly provide: a named item, key, equipment, access or use right, specific invitation or appointment, defined role or authority, one favor from a named NPC, or evidence or information with a clear subject and source.
- State any meaningful limit, target, or permitted use in the reward itself.

Names and continuity:
- Write descriptive content in natural Korean while preserving established character and place names in their current display form.
- Use confirmed roleplay facts as the primary source, followed by the character card and persona.
- Keep unknown identities hidden only when the supplied story has already made that uncertainty meaningful.
- Return only fields requested by the schema. IDs, internal status, map title, event links, visibility flags, and roleplay reflection text are added locally.

Current user: ${getCurrentUserName()}
Current character: ${getCurrentCharacterName()}

[Character card]
${getCharacterSummary() || '(unavailable)'}

[Persona]
${getPersonaSummary() || '(unavailable)'}

[Wider continuity leads]
${buildQuestContinuityRegistry(memory)}
Use these as continuity leads for recurring people and places. The recent roleplay decides which of them still belong in the current snapshot.
Remote person-search continuity leads describe separate places in the wider world. When one is included as a returned location, build its physical layout, sensory conditions, adjacency, people, and activity from that place's own observed state and established setting. Ground each other returned location in its own local evidence in the same way.

[Recent roleplay]
${getChatSnapshot(10) || '(no recent roleplay)'}

Return JSON only.`;
}

function buildLocationRefreshPrompt(location) {
    const memory = ensureMemory();
    return `
Re-observe one existing roleplay location using the supplied current continuity. Return only the refreshed location, zero or one quest for that location, and the people movement signals visible there.

Location to preserve: ${location.name}

Writing requirements:
- location.name remains exactly ${location.name}.
- Write natural Korean while preserving established character and place names in their current display form.
- location.situation is 8 to 12 complete Korean sentences. Establish the recognizable physical space, its atmosphere, people, current activity, and immediate tension through concrete observable details.
- location.details adds 4 to 6 complete Korean sentences from a distinct second angle in the same place and moment.
- location.present contains 0 to 6 people or complete group descriptions physically visible here.
- location.clues contains short locally observable anchors.
- Each footstep uses a person name or established title, locationName ${location.name}, and a concrete visible activity in status.
- Keep the protagonists' activity already under way in location.situation and location.details.
- Return zero or one quest. Include one only when a separate named person or group at this location has a specific aim, obstacle, consequence, and unresolved entry point through which the protagonists could become involved. Its summary and details each contain 3 to 5 complete Korean sentences.
- A quest reward is a concrete result the people or situation can plausibly provide: a named item, key, equipment, access or use right, specific invitation or appointment, defined role or authority, one favor from a named NPC, or evidence or information with a clear subject and source.
- Return only schema fields. Internal IDs, status, links, and roleplay reflection text are added locally.

[Location before refresh]
${JSON.stringify(location, null, 2)}

[Current area memory]
${summarizeMapMemory(memory)}

[Character card]
${getCharacterSummary() || '(unavailable)'}

[Persona]
${getPersonaSummary() || '(unavailable)'}

[Recent roleplay]
${getChatSnapshot(10) || '(no recent roleplay)'}

Return JSON only.`;
}

function buildFootstepProfilePrompt(footstep) {
    const memory = ensureMemory();
    const map = memory.map;
    const location = map?.locations?.find(l => l.id === footstep.locationId);
    const displayName = footstep.visibleName === false ? '???' : footstep.label;
    return `
You are a roleplay map extension. The user clicked one footstep / location signal.
Generate this character status card only now; do not pre-generate it during map generation.

Rules:
- Write ordinary descriptive text in Korean. Preserve recurring character and place names in the display form used by the current roleplay.
- Write injectionText only in English.
- Footstep name/title: ${displayName}
- Footstep location: ${location?.name || footstep.locationId || 'unknown location'}
- Footstep status hint: ${footstep.status || 'movement is faint'}
- If the name is ???, do not reveal the identity. Describe only traits supported by the visible signal and current setting.
- Determine gender from explicit roleplay facts, established identity, pronouns, title, or observable presentation. Never infer gender from the spelling of a name alone. If there is no sound basis, write "장면에서 확인되지 않음".
- Determine age in this order: an explicit age or birth date in the supplied continuity; a stated school year or life stage combined with the current map time; established setting chronology for a clearly identified recurring character; then an observable age band. Never infer age from a name alone.
- For a clearly identified established character, use well-established setting chronology even when the character card does not repeat their age. Compare the established birth period or life stage with the supplied map year/time and return the narrowest plausible numerical age or age band rather than collapsing every adult to "성인".
- When chronology is the basis, ageBasis must state the concrete years, school year, career stage, or other checkable calculation used. Do not write only "established chronology" or the person's name. Do not use "중년" or "노년" when a numerical range can be calculated.
- In a school setting, prefer a supported school year with a compatible age range, such as "5학년(15~16세)". A student or stated school year must never be described as middle-aged or elderly.
- If the evidence supports only a range, give the narrowest defensible range. If none of the supplied facts supports even a range, write "정확한 나이는 확인되지 않음" rather than inventing one.
- ageBasis is required and briefly names the fact used for age: explicit RP statement, school year, map date, established chronology, role/title, or visible clue. Do not cite the person's name by itself as evidence.
- characterInfo should explain who this person is and their visible role in the scene in 3 to 5 sentences.
- currentMood, currentLocation, and currentActivity must reflect recent roleplay when possible.
- currentActivity should be character-specific and scene-friendly: use believable visible habits, props, duties, quirks, or canon-flavored actions when they fit the scene. Do not reduce everyone to bland distant observation.
- relationshipWithUser should describe the current relationship, distance, tension, or possible connection with {{user}} in 3 to 5 sentences. Do not invent impossible direct contact or unsupported intimacy.
- lastEncounterWithUser must follow confirmed recent roleplay. A shared school, house, workplace, village, routine, or social circle does not by itself prove a direct meeting; when none is shown, state that no direct encounter is confirmed.
- currentActivity should be 5 to 8 sentences with concrete visible details: where they stand, what they hold, who they avoid or seek, and where they may move next.
- currentTask should name at least one thing they are trying to do, find, hide, or avoid.
- thoughts should be 4 to 6 sentences, inferred from observable behavior and current context. Do not become omniscient.
- pocketContents should include 3 to 6 items from pockets, bag, hand, coat, or nearby belongings. Give each item a short reason or hint.
- hooks should include 2 to 4 short clues that make the user want to follow this signal.
- injectionText must be English roleplay context that can be used in the next response.

[Current location]
${JSON.stringify(location || {}, null, 2)}

[Current world and time]
- Region: ${map?.regionName || '(not supplied)'}
- Map time: ${map?.timeHint || '(not supplied)'}
- Area state: ${map?.worldSummary || '(not supplied)'}

[Current map memory]
${summarizeMapMemory(memory)}

[Character card summary]
${getCharacterSummary() || '(unavailable)'}

[Persona]
${getPersonaSummary() || '(unavailable)'}

[Recent chat]
${getChatSnapshot() || '(no recent chat)'}

Return JSON only.`;
}



const PERSON_SEARCH_SCHEMA = {
    name: 'RoleplayPersonSearchModel',
    description: 'A Korean person search result grounded in the supplied roleplay.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            name: { type: 'string' },
            isOnMap: { type: 'boolean' },
            gender: { type: 'string' },
            age: { type: 'string' },
            ageBasis: { type: 'string' },
            characterInfo: { type: 'string' },
            currentMood: { type: 'string' },
            currentLocation: { type: 'string' },
            currentActivity: { type: 'string' },
            relationshipWithUser: { type: 'string' },
            lastEncounterWithUser: { type: 'string' },
            currentTask: { type: 'string' },
            thoughts: { type: 'string' },
            pocketContents: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string' },
            summary: { type: 'string' },
            reason: { type: 'string' },
            trackerReaction: { type: 'string' },
            hooks: { type: 'array', items: { type: 'string' } },
            injectionText: { type: 'string' },
        },
        required: ['name', 'isOnMap', 'gender', 'age', 'ageBasis', 'characterInfo', 'currentMood', 'currentLocation', 'currentActivity', 'relationshipWithUser', 'lastEncounterWithUser', 'currentTask', 'thoughts', 'pocketContents', 'confidence', 'summary', 'reason', 'trackerReaction', 'hooks', 'injectionText'],
    },
};

const AGE_EVIDENCE_SCHEMA = {
    name: 'RoleplayPersonAgeEvidenceModel',
    description: 'A compact age estimate with a checkable chronology basis.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            age: { type: 'string' },
            ageBasis: { type: 'string' },
        },
        required: ['age', 'ageBasis'],
    },
};

const TRACK_REFRESH_SCHEMA = {
    name: 'RoleplayTrackingRefreshModel',
    description: 'A Korean refreshed tracked person location/status card.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            name: { type: 'string' },
            currentLocation: { type: 'string' },
            movementSummary: { type: 'string' },
            currentActivity: { type: 'string' },
            trackerReaction: { type: 'string' },
            confidence: { type: 'string' },
            status: { type: 'string' },
            hooks: { type: 'array', items: { type: 'string' } },
            injectionText: { type: 'string' },
        },
        required: ['name', 'currentLocation', 'movementSummary', 'currentActivity', 'trackerReaction', 'confidence', 'status', 'hooks', 'injectionText'],
    },
};

const RECOMMENDATION_SCHEMA = {
    name: 'RoleplayPlaceRecommendationModel',
    description: 'A Korean list of place recommendations grounded in the supplied roleplay.',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            category: { type: 'string' },
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        emoji: { type: 'string' },
                        locationName: { type: 'string' },
                        shortReview: { type: 'string' },
                        whyFits: { type: 'string' },
                        sceneHook: { type: 'string' },
                        details: { type: 'string' },
                        famousFor: { type: 'string' },
                        signature: { type: 'string' },
                        miniReviews: { type: 'array', items: { type: 'string' } },
                        possibleScenes: { type: 'array', items: { type: 'string' } },
                        injectionText: { type: 'string' },
                    },
                    required: ['id', 'title', 'emoji', 'locationName', 'shortReview', 'whyFits', 'sceneHook', 'details', 'famousFor', 'signature', 'miniReviews', 'possibleScenes', 'injectionText'],
                },
            },
        },
        required: ['category', 'items'],
    },
};

function buildPersonSearchPrompt(query, knownMapResult = null) {
    const memory = ensureMemory();
    const map = memory.map;
    const knownMapRule = knownMapResult
        ? `The current map confirms this person at ${knownMapResult.currentLocation}. Return isOnMap as true and keep currentLocation at that confirmed place while expanding the person's concrete present state.`
        : 'The current map was checked before this request. Return isOnMap as false; this request is locating a person who does not already have a matching map signal.';
    return `
Use the supplied roleplay continuity to locate the person the user searched for and return one complete, scene-ready person signal. The result must be useful on its own; it will be cached and reused if the user places it on the map.
Search query: ${query}

Rules:
- Write ordinary descriptive text in Korean. Preserve recurring character and place names in the display form used by the current roleplay.
- Write injectionText only in English.
- ${knownMapRule}
- Use confirmed recent movement first. Otherwise infer the most plausible current location from the current time, established routine, role, obligations, unresolved events, last known place, and setting continuity. Do not move the person into the protagonists' current scene merely to make the result convenient.
- currentLocation must be a concrete place in the current world. confidence states how firm the location estimate is, and reason identifies the supplied facts that support it.
- summary and characterInfo together identify who this person is, why this location makes sense now, and what makes the signal worth opening. Do not merely say that a location was found.
- currentActivity is 4 to 6 concrete Korean sentences. Show where the person is positioned, what they are holding or handling, the specific person/object/problem receiving their attention, what they are trying to accomplish, and the next movement that is already becoming likely.
- currentTask names the immediate thing they are trying to finish, find, deliver, prevent, hide, decide, or avoid.
- currentMood and thoughts are evidence-bounded inferences from observable behavior. Do not write omniscient secrets or a deep inner confession.
- relationshipWithUser and lastEncounterWithUser use only confirmed continuity. Shared membership in a school, workplace, family, village, or social group does not prove a direct encounter.
- pocketContents contains 2 to 5 scene-relevant things in a hand, pocket, bag, clothing, or immediate belongings. Each item carries a brief concrete use or clue, not decorative filler.
- hooks contains 2 to 4 specific followable signals tied to this person, place, object, task, or next movement. Avoid generic possibilities such as "they may talk to someone" or unrelated background events.
- Determine gender from explicit roleplay facts, established identity, pronouns, title, or observable presentation. Never infer gender from the spelling of a name alone. If there is no sound basis, write "장면에서 확인되지 않음".
- Determine age in this order: an explicit age or birth date in the supplied continuity; a stated school year or life stage combined with the current map time; established setting chronology for a clearly identified recurring character; then an observable age band. Never infer age from a name alone.
- For a clearly identified established character, use well-established setting chronology even when the character card does not repeat their age. Compare the established birth period or life stage with the supplied map year/time and return the narrowest plausible numerical age or age band rather than collapsing every adult to "성인".
- When chronology is the basis, ageBasis must state the concrete years, school year, career stage, or other checkable calculation used. Do not write only "established chronology" or the person's name. Do not use "중년" or "노년" when a numerical range can be calculated.
- In a school setting, prefer a supported school year with a compatible age range, such as "5학년(15~16세)". A student or stated school year must never be described as middle-aged or elderly.
- If the evidence supports only a range, give the narrowest defensible range. If none of the supplied facts supports even a range, write "정확한 나이는 확인되지 않음" rather than inventing one.
- ageBasis briefly names the exact basis used for age. A person's name by itself is never age evidence.
- trackerReaction records only an already observable reaction to the signal or surveillance. If no reaction is established, write "아직 추적 반응 없음" without inventing one.
- injectionText preserves the location, visible activity, immediate task, relevant people/objects, and followable signals as English roleplay context.

[Current world and time]
- Region: ${map?.regionName || '(not supplied)'}
- Map time: ${map?.timeHint || '(not supplied)'}
- Area state: ${map?.worldSummary || '(not supplied)'}

[Current map memory]
${summarizeMapMemory(memory)}

[Confirmed map signal for this search]
${knownMapResult ? JSON.stringify({ name: knownMapResult.name, currentLocation: knownMapResult.currentLocation, currentActivity: knownMapResult.currentActivity, reason: knownMapResult.reason }, null, 2) : '(none; locate from continuity)'}

[Character card summary]
${getCharacterSummary() || '(unavailable)'}

[Persona]
${getPersonaSummary() || '(unavailable)'}

[Recent chat]
${getChatSnapshot(10) || '(no recent chat)'}

Return JSON only.`;
}

function ageBasisHasConcreteChronology(value) {
    const basis = String(value || '').replace(/\s+/g, ' ').trim();
    return /(?:^|[^0-9])(?:18|19|20)\d{2}(?:[^0-9]|$)|(?:^|[^0-9])(?:[1-9]\d?|1[01]\d|120)\s*(?:세|살)(?:[^0-9]|$)|(?:^|[^0-9])(?:[1-9]|1\d|20)\s*학년/.test(basis);
}

function ageEvidenceNeedsRepair(raw = {}) {
    const age = String(raw?.age || '').replace(/\s+/g, ' ').trim();
    const basis = String(raw?.ageBasis || '').replace(/\s+/g, ' ').trim();
    const unknown = !age || /(?:불명|미상|알 수 없음|알수없음|unknown|확인 불가|확인불가|정확한 나이는 확인되지 않음)/i.test(age);
    const chronologyClaim = /(?:확립|공식|원작|설정|연대기|출생|established|canon|chronolog|birth)/i.test(basis);
    return unknown || (chronologyClaim && !ageBasisHasConcreteChronology(basis));
}

function buildAgeEvidenceRepairPrompt(name, raw = {}) {
    const memory = ensureMemory();
    const map = memory.map;
    return `
Resolve the age evidence for this clearly identified roleplay person.
Target: ${name || raw?.name || '(unnamed target)'}
Previous age: ${raw?.age || '(not supplied)'}
Previous basis: ${raw?.ageBasis || '(not supplied)'}

Use the supplied roleplay facts first. If this is an established recurring character whose chronology is well established, use that established birth period or life stage even when the character card omits it, and calculate against the current world year or time. Return the narrowest defensible numerical age or range. ageBasis must show the checkable years, stated age, or school year used for the calculation. If no such evidence exists, return "정확한 나이는 확인되지 않음" and explain that no concrete basis is available.

[Current world and time]
- Region: ${map?.regionName || '(not supplied)'}
- Map time: ${map?.timeHint || '(not supplied)'}
- Area state: ${map?.worldSummary || '(not supplied)'}

[Character card]
${getCharacterSummary() || '(unavailable)'}

[Recent roleplay]
${getChatSnapshot(10) || '(no recent roleplay)'}

Return JSON only.`;
}

async function repairAgeEvidenceIfNeeded(raw, name = '') {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (!ageEvidenceNeedsRepair(obj)) return obj;
    try {
        const response = await generateQuietWithSelectedProfile(
            buildAgeEvidenceRepairPrompt(name || obj.name, obj),
            AGE_EVIDENCE_SCHEMA,
            { maxTokens: 700 },
        );
        const repaired = parseJson(response, 'person.age.repair');
        if (!repaired || !ageBasisHasConcreteChronology(repaired.ageBasis)) {
            pushDebugLog('person.age.repair.insufficient', '연령 재검증에서도 계산 가능한 근거를 확인하지 못했습니다.', {
                name: name || obj.name || '',
            });
            return obj;
        }
        return {
            ...obj,
            age: String(repaired.age || obj.age || ''),
            ageBasis: String(repaired.ageBasis || obj.ageBasis || ''),
        };
    } catch (error) {
        pushDebugLog('person.age.repair.error', '연령 근거 재검증 요청에 실패해 원래 결과를 사용합니다.', {
            name: name || obj.name || '',
            error: serializeForDebug(error),
        });
        return obj;
    }
}

function buildTrackRefreshPrompt(tracked) {
    const memory = ensureMemory();
    return `
Use the supplied roleplay continuity to refresh the tracked person's current location and activity.
Target: ${tracked.name}
Last known location: ${tracked.lastLocation || 'unknown'}
Last known status: ${tracked.lastActivity || tracked.summary || 'unknown'}

Rules:
- Write ordinary descriptive text in Korean. Preserve recurring character and place names in the display form used by the current roleplay.
- Write injectionText only in English.
- If recent roleplay reveals the target's movement, follow it first.
- If no movement is shown, infer a plausible location from personality, time, current scene, and last known location; lower confidence when uncertain.
- If hiding, disappearing, or failed tracking fits the story, set status to a Korean equivalent of "tracking unavailable" and explain why.
- trackerReaction should describe how the target reacts to being watched/tracked. Do not write a deep inner confession.

[Current map memory]
${summarizeMapMemory(memory)}

[Character card summary]
${getCharacterSummary() || '(unavailable)'}

[Recent chat]
${getChatSnapshot(10) || '(no recent chat)'}

Return JSON only.`;
}

function buildRecommendationPrompt(category) {
    const memory = ensureMemory();
    return `
Use the supplied roleplay continuity to recommend fitting places.
Search or recommendation request: ${category}

Rules:
- Write ordinary descriptive text in Korean. Preserve recurring character and place names in the display form used by the current roleplay.
- Write injectionText only in English.
- category must be exactly the user's selected/input request.
- title must be only the place name. Do not put the category, theme, or the word "recommendation" in the title.
- locationName is mandatory and uses a compact, specific district, street, building, floor, wing, or nearby landmark cue that exists naturally in the supplied world.
- Recommendations fit the actual world, era, and physical space established by the roleplay.
- If the request is for food, restaurants, cafes, bars, pubs, desserts, or snacks, recommend only places where food or drinks can actually be ordered/eaten.
- If the request is for hot places, landmarks, or date spots, recommend famous places, scenic points, walking spots, shops, festivals, exhibits, or secret spots that people in this world would actually visit.
- Use existing map locations when they fit the category. If not, create new places that naturally exist in the current world. Do not force an unrelated map location to fit.
- Do not invent regular-customer history, dates, gifts, confessions, or private memories with a specific person unless recent chat explicitly supports it.
- Write results like Korean place-search cards. shortReview should feel like "rating 4.x · one-line summary".
- miniReviews must be 2 plain Korean strings with fake handles, for example "@ink_frog · 조용해서 공부하기 좋음". Do not return review objects, JSON strings, handle/review fields, or raw source data.
- details should be 5 to 7 sentences describing structure, seats, light, smell, sound, busy hours, visitors, and atmosphere.
- famousFor explains why the place is known.
- signature is a signature menu for food places, or the main viewpoint/attraction for landmarks.
- possibleScenes should include 2 to 3 natural scene hooks for the place. Do not invent unsupported dates or memories.

[Current map memory]
${summarizeMapMemory(memory)}

[Character card summary]
${getCharacterSummary() || '(unavailable)'}

[Recent chat]
${getChatSnapshot(10) || '(no recent chat)'}

Return JSON only.`;
}

function getSchoolYearAgeLabel(grade, contextText = '') {
    const year = Number(grade);
    if (!Number.isFinite(year) || year < 1 || year > 20) return '학생 연령대';
    const schoolLabel = `${year}학년`;
    if (year <= 7 && /(?:호그와트|마법학교|wizarding school|magic school)/i.test(String(contextText || ''))) {
        return `${schoolLabel}(${year + 10}~${year + 11}세)`;
    }
    return `${schoolLabel}(학생 연령대)`;
}

function normalizePersonAge(rawAge, ageBasis, options = {}) {
    const raw = String(rawAge || '').replace(/\s+/g, ' ').trim();
    const basis = String(ageBasis || '').replace(/\s+/g, ' ').trim();
    const identity = String(options.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const mapContext = String(options.contextText || '').replace(/\s+/g, ' ').trim();
    const subjectText = String(options.subjectText || '').replace(/\s+/g, ' ').trim();
    const proofText = `${raw} ${basis}`.trim();
    const evidenceText = `${proofText} ${subjectText}`.trim();
    const gradeMatch = evidenceText.match(/(?:^|[^0-9])([1-9]|1\d|20)\s*학년/);
    const studentEvidence = Boolean(gradeMatch) || /(?:재학생|학생\s*신분|학생으로\s*재학|학생\s*나이|학생\s*연령대)/.test(evidenceText);
    const elderlyClaim = /(?:노년|노인|고령|elderly|(?:6|7|8|9)0\s*대|(?:[6-9]\d|1\d{2})\s*(?:세|살))/i.test(raw);
    const adultAgeClaim = /(?:중년|장년|성인|middle[ -]?aged|adult|40\s*대|50\s*대|(?:4|5)0\s*(?:세|살))/i.test(raw);
    const explicitAgeMatch = evidenceText.match(/(?:^|[^0-9])([1-9]\d?|1[01]\d|120)\s*(?:세|살)(?:[^0-9]|$)/);
    const explicitAge = explicitAgeMatch ? Number(explicitAgeMatch[1]) : null;
    const mapYearMatch = mapContext.match(/(?:^|[^0-9])((?:18|19|20)\d{2})\s*년?/);
    const birthYearMatch = evidenceText.match(/((?:18|19|20)\d{2})\s*년(?:생|에\s*태어)/);
    const calculatedAge = mapYearMatch && birthYearMatch
        ? Number(mapYearMatch[1]) - Number(birthYearMatch[1])
        : null;
    const decadeMatch = raw.match(/([1-9])0\s*대/);
    const claimedDecade = decadeMatch ? Number(decadeMatch[1]) * 10 : null;
    const schoolAgeContext = /(?:호그와트|마법학교|초등|중학교|고등학교|미성년|청소년|wizarding school|magic school|secondary school|high school)/i.test(`${mapContext} ${basis} ${subjectText}`);
    const youngStudentEvidence = studentEvidence && schoolAgeContext && (!gradeMatch || Number(gradeMatch[1]) <= 7);
    const nameOnlyBasis = Boolean(identity) && (
        basis.toLowerCase() === identity
        || (/(?:이름|name)/i.test(basis) && !/(?:학년|출생|태어|나이|연령|연대|외견|주름|백발|직함|역할)/.test(basis))
    );
    const supportsOlderAge = (
        (Number.isFinite(explicitAge) && explicitAge >= 60)
        || (Number.isFinite(calculatedAge) && calculatedAge >= 60)
        || /(?:(?:6|7|8|9)0\s*대|(?:[6-9]\d|1\d{2})\s*(?:세|살)|노인으로\s*명시|고령으로\s*명시|깊은\s*주름|백발)/i.test(`${basis} ${subjectText}`)
    );
    const unsupportedChronologyClaim = /(?:확립|공식|원작|설정|연대기|출생|established|canon|chronolog|birth)/i.test(basis)
        && !ageBasisHasConcreteChronology(basis);

    if (youngStudentEvidence && (adultAgeClaim || elderlyClaim)) {
        return gradeMatch
            ? getSchoolYearAgeLabel(gradeMatch[1], mapContext)
            : '학생 연령대(정확한 나이는 확인되지 않음)';
    }
    if (studentEvidence && elderlyClaim) {
        return gradeMatch
            ? getSchoolYearAgeLabel(gradeMatch[1], mapContext)
            : '학생 연령대(정확한 나이는 확인되지 않음)';
    }
    if (elderlyClaim && Number.isFinite(explicitAge) && explicitAge < 60) {
        return `${explicitAge}세`;
    }
    if (elderlyClaim && Number.isFinite(calculatedAge) && calculatedAge > 0 && calculatedAge < 60) {
        return `${Math.max(0, calculatedAge - 1)}~${calculatedAge}세`;
    }
    if (Number.isFinite(calculatedAge) && calculatedAge > 0 && calculatedAge < 121
        && Number.isFinite(claimedDecade)
        && (calculatedAge < claimedDecade || calculatedAge >= claimedDecade + 10)) {
        return `${Math.max(0, calculatedAge - 1)}~${calculatedAge}세`;
    }
    if (elderlyClaim && !supportsOlderAge) {
        return Number.isFinite(calculatedAge) && calculatedAge > 0
            ? `${Math.max(0, calculatedAge - 1)}~${calculatedAge}세`
            : '정확한 나이는 확인되지 않음';
    }
    if (unsupportedChronologyClaim) return '정확한 나이는 확인되지 않음';
    if (!raw || /(불명|미상|알 수 없음|알수없음|unknown|n\/a|확인 불가|확인불가)/i.test(raw) || nameOnlyBasis) {
        if (gradeMatch) return getSchoolYearAgeLabel(gradeMatch[1], mapContext);
        if (Number.isFinite(calculatedAge) && calculatedAge > 0 && calculatedAge < 121) {
            return `${Math.max(0, calculatedAge - 1)}~${calculatedAge}세`;
        }
        return '정확한 나이는 확인되지 않음';
    }
    return raw;
}

function normalizeSearchResult(raw, query, extra = {}) {
    const obj = raw && typeof raw === 'object' ? raw : {};
    const pick = (key, fallback = '') => extra[key] ?? obj[key] ?? fallback;
    const memory = ensureMemory();
    const map = memory.map;
    const name = String(pick('name', query));
    const ageBasis = String(pick('ageBasis', '별도 연령 근거가 확인되지 않음'));
    const ageContext = [
        map?.regionName,
        map?.timeHint,
        map?.worldSummary,
        pick('currentLocation'),
        pick('characterInfo'),
    ].filter(Boolean).join(' ');
    return {
        id: pick('id', `search:${safeId(query)}:${Date.now()}`),
        type: 'person-search',
        query,
        name,
        isOnMap: Boolean(pick('isOnMap', false)),
        footstepId: String(pick('footstepId', '')),
        locationId: String(pick('locationId', '')),
        gender: String(pick('gender', '장면에서 확인되지 않음')),
        age: normalizePersonAge(pick('age'), ageBasis, { name, contextText: ageContext, subjectText: pick('characterInfo') }),
        ageBasis,
        characterInfo: String(pick('characterInfo', pick('summary', `${name}에 대한 현재 신호를 확인하고 있다.`))),
        currentMood: String(pick('currentMood', '표정과 행동에서 뚜렷한 기분을 확인하기 어려움')),
        currentLocation: String(pick('currentLocation', '위치 신호 흐림')),
        currentActivity: String(pick('currentActivity', '현재 행동이 또렷하지 않음')),
        relationshipWithUser: String(pick('relationshipWithUser', '직접 확인된 관계 정보 없음')),
        lastEncounterWithUser: String(pick('lastEncounterWithUser', '최근 직접 마주친 기록은 확인되지 않음')),
        currentTask: String(pick('currentTask', '당장 하려는 일은 아직 또렷하지 않음')),
        thoughts: String(pick('thoughts', '관찰 가능한 행동만으로는 속내를 단정할 수 없음')),
        pocketContents: normalizeStringArray(pick('pocketContents', []), [], 6),
        confidence: String(pick('confidence', '중간')),
        summary: String(pick('summary', pick('characterInfo', '검색 결과가 아직 충분히 또렷하지 않다.'))),
        reason: String(pick('reason', '')),
        trackerReaction: String(pick('trackerReaction', '아직 추적 반응 없음')),
        hooks: normalizeStringArray(pick('hooks', []), [], 5),
        injectionText: String(pick('injectionText', '')),
        mapGeneratedAt: String(pick('mapGeneratedAt', getMapLinkStamp(memory))),
        createdAt: String(pick('createdAt', nowStamp())),
    };
}

function getMapLinkStamp(memory = ensureMemory(), mapOverride = null) {
    const map = mapOverride || memory?.map;
    if (!map) return '';
    if ((!mapOverride || mapOverride === memory?.map) && memory?.mapRevision) {
        return String(memory.mapRevision);
    }
    const source = JSON.stringify({
        regionName: map.regionName || '',
        timeHint: map.timeHint || '',
        currentLocationId: map.currentLocationId || '',
        locations: (map.locations || []).map(location => [
            location.id || '',
            location.name || '',
            location.situation || '',
            location.details || '',
        ]),
        footsteps: (map.footsteps || []).map(footstep => [
            footstep.id || '',
            footstep.label || '',
            footstep.locationId || '',
            footstep.status || '',
        ]),
    });
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${String(memory.generatedAt || 'undated')}|${(hash >>> 0).toString(36)}`;
}

function findPersonInMap(query) {
    const memory = ensureMemory();
    const map = memory.map;
    const needle = String(query || '').trim().toLowerCase();
    if (!needle || !map) return null;
    const footstep = (map.footsteps || []).find(fp => String(fp.label || '').toLowerCase().includes(needle));
    if (footstep) {
        const loc = map.locations.find(l => l.id === footstep.locationId);
        const savedProfile = memory.footstepProfiles?.[footstep.id] || null;
        const cached = savedProfile && isFootstepProfileCurrent(savedProfile, footstep, map) ? savedProfile : null;
        return normalizeSearchResult({}, query, {
            isOnMap: true,
            footstepId: footstep.id,
            locationId: footstep.locationId,
            name: cached?.name || (footstep.visibleName ? footstep.label : '???'),
            gender: cached?.gender,
            age: cached?.age,
            ageBasis: cached?.ageBasis,
            characterInfo: cached?.characterInfo || `${footstep.visibleName ? footstep.label : '이 인물'}의 위치 신호가 ${loc?.name || '현재 지도'}에서 직접 확인된다.`,
            currentMood: cached?.currentMood,
            currentLocation: cached?.currentLocation || loc?.name || '알 수 없는 위치',
            currentActivity: cached?.currentActivity || footstep.status || '지도 위에 위치 신호가 보임',
            relationshipWithUser: cached?.relationshipWithUser,
            lastEncounterWithUser: cached?.lastEncounterWithUser,
            currentTask: cached?.currentTask,
            thoughts: cached?.thoughts,
            pocketContents: cached?.pocketContents || [],
            confidence: '높음',
            summary: cached?.characterInfo || `${footstep.visibleName ? footstep.label : '???'}의 위치와 움직임이 현재 지도 위에서 직접 확인된다.`,
            reason: '현재 지도 발자국/위치 신호에서 직접 확인됨.',
            trackerReaction: cached?.trackerReaction || '아직 추적 반응 없음',
            hooks: cached?.hooks || loc?.clues || [],
            injectionText: cached?.injectionText || '',
        });
    }
    for (const loc of map.locations || []) {
        const person = (loc.present || []).find(p => String(p || '').toLowerCase().includes(needle));
        if (person) {
            return normalizeSearchResult({}, query, {
                isOnMap: true,
                locationId: loc.id,
                name: person,
                currentLocation: loc.name,
                characterInfo: `${person}은(는) ${loc.name}에 실제로 있는 인물로 확인된다. ${stripLong(loc.situation || '', 280)}`,
                currentActivity: stripLong(loc.details || loc.situation || `${loc.name}의 현장에 머물고 있다.`, 420),
                confidence: '중간',
                summary: `${person}은(는) 별도 발자국은 없지만 ${loc.name}의 현장 인물 목록에서 확인된다.`,
                reason: '현재 지도 장소 카드의 present 목록에서 확인됨.',
                currentTask: (loc.clues || [])[0] || `${loc.name}에서 진행 중인 상황에 관여하고 있다.`,
                hooks: loc.clues || [],
            });
        }
    }
    return null;
}

async function openPersonSearch() {
    renderRecommendationPanel('person');
}

async function handlePersonSearch(query) {
    try {
    const memory = ensureMemory();
    if (!memory.map) await generateMap(false);
    const startMap = memory.map;
    const startChatSignature = rememberCurrentChatSignature?.() || getStableChatSignature();
    let found = findPersonInMap(query);
    if (found) {
        if (found.footstepId) {
            const footstep = memory.map?.footsteps?.find(item => item.id === found.footstepId);
            const savedProfile = footstep ? memory.footstepProfiles?.[footstep.id] : null;
            if (footstep && (!savedProfile || !isFootstepProfileCurrent(savedProfile, footstep, memory.map))) {
                const profile = await getOrGenerateFootstepProfile(footstep.id);
                if (!profile) return;
                assertChatSignatureUnchanged(startChatSignature, 'search.person');
                assertMapSnapshotUnchanged(startMap, 'search.person', {
                    id: footstep.id,
                    locationId: footstep.locationId,
                    status: footstep.status,
                });
                if (profile) {
                    found = normalizeSearchResult(found, query, {
                        ...profile,
                        isOnMap: true,
                        footstepId: footstep.id,
                        locationId: footstep.locationId,
                        confidence: '높음',
                        summary: profile.characterInfo,
                        reason: '현재 지도 발자국/위치 신호와 상세 상태에서 확인됨.',
                    });
                }
            }
        } else if (found.locationId) {
            const confirmed = found;
            let enriched = false;
            await withLoader(`${query}의 현재 신호를 확인하는 중...`, async () => {
                const modeConfig = getOutputModeConfig();
                const rawText = await generateQuietWithSelectedProfile(buildPersonSearchPrompt(query, confirmed), PERSON_SEARCH_SCHEMA, { maxTokens: modeConfig.personSearchMaxTokens });
                assertChatSignatureUnchanged(startChatSignature, 'search.person');
                assertMapSnapshotUnchanged(startMap, 'search.person');
                const parsed = parseJson(rawText, 'search.person.map_present');
                if (!parsed) throw new Error('지도 인물 검색 응답을 JSON 형식으로 읽지 못했습니다.');
                const ageChecked = await repairAgeEvidenceIfNeeded(parsed, parsed.name || query);
                assertChatSignatureUnchanged(startChatSignature, 'search.person');
                assertMapSnapshotUnchanged(startMap, 'search.person');
                found = normalizeSearchResult(ageChecked, query, {
                    isOnMap: true,
                    footstepId: '',
                    locationId: confirmed.locationId,
                    currentLocation: confirmed.currentLocation,
                    confidence: '높음',
                    reason: [confirmed.reason, parsed.reason].filter(Boolean).join(' '),
                });
                enriched = true;
            });
            if (!enriched) return;
        }
        assertMapSnapshotUnchanged(startMap, 'search.person');
        memory.searchResults = [found, ...(memory.searchResults || [])];
        const saved = await saveMemory(memory);
        pushDebugLog(saved ? 'search.person.store.success' : 'search.person.store.save_failed', saved
            ? '지도에서 찾은 인물 검색 기록을 저장했습니다.'
            : '인물 검색 기록 저장을 확인하지 못했습니다.', {
            personSearchHistory: memory.searchResults?.length || 0,
            saved,
        });
        renderPersonSearchResultPanel(found, 'search');
        return;
    }

    let result = null;
    await withLoader(`${query}의 위치 신호를 찾는 중...`, async () => {
        let rawText = '';
        const modeConfig = getOutputModeConfig();
        rawText = await generateQuietWithSelectedProfile(buildPersonSearchPrompt(query), PERSON_SEARCH_SCHEMA, { maxTokens: modeConfig.personSearchMaxTokens });
        assertChatSignatureUnchanged(startChatSignature, 'search.person');
        assertMapSnapshotUnchanged(startMap, 'search.person');
        const parsed = parseJson(rawText, 'search.person');
        if (!parsed) throw new Error('인물 검색 응답을 JSON 형식으로 읽지 못했습니다.');
        const ageChecked = await repairAgeEvidenceIfNeeded(parsed, parsed.name || query);
        assertChatSignatureUnchanged(startChatSignature, 'search.person');
        assertMapSnapshotUnchanged(startMap, 'search.person');
        result = normalizeSearchResult(ageChecked, query, { isOnMap: false });
        memory.searchResults = [result, ...(memory.searchResults || [])];
        const saved = await saveMemory(memory);
        pushDebugLog(saved ? 'search.person.store.success' : 'search.person.store.save_failed', saved
            ? '인물 검색 기록을 저장했습니다.'
            : '인물 검색 기록 저장을 확인하지 못했습니다.', {
            personSearchHistory: memory.searchResults?.length || 0,
            saved,
        });
    });
    if (result) renderPersonSearchResultPanel(result, 'search');
    } catch (error) {
        if (isMapGenerationCancelledError(error)) return;
        throw error;
    }
}

function getLivePersonSearchLinks(result, memory = ensureMemory()) {
    const map = memory?.map;
    if (!map || !result) return { locationId: '', footstepId: '' };
    const resultMapGeneratedAt = String(result.mapGeneratedAt || '');
    const currentMapGeneratedAt = getMapLinkStamp(memory);
    if (!resultMapGeneratedAt || !currentMapGeneratedAt || resultMapGeneratedAt !== currentMapGeneratedAt) {
        return { locationId: '', footstepId: '' };
    }
    const locationId = (map.locations || []).some(location => location.id === result.locationId)
        ? String(result.locationId)
        : '';
    const footstep = (map.footsteps || []).find(item => item.id === result.footstepId);
    const expectedName = normalizeDiscoveryText(simplifyFootstepLabel(result.name));
    const liveName = normalizeDiscoveryText(footstep?.label);
    const samePerson = !expectedName || !liveName || expectedName === liveName || expectedName.includes(liveName) || liveName.includes(expectedName);
    const footstepId = footstep && samePerson && (!locationId || footstep.locationId === locationId)
        ? String(footstep.id)
        : '';
    return { locationId, footstepId };
}

function renderPersonSearchResultPanel(result, origin = 'search') {
    const panel = document.getElementById('mma-side-panel');
    if (!panel || !result) return;
    const backTitle = origin === 'notebook' ? '수첩으로 돌아가기' : '인물 찾기로 돌아가기';
    const liveLinks = getLivePersonSearchLinks(result);
    panel.innerHTML = `
        <div class="mma-action-panel mma-person-search-result-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">🔎</span><strong>인물 검색</strong></div>
                <button title="${escapeHtml(backTitle)}" data-action="back">↩️</button>
            </header>
            <article class="mma-event-card person-search-card">
                <div class="mma-event-title"><b>${escapeHtml(result.name)}</b><span>${result.isOnMap ? '지도 확인' : '추정'}</span></div>
                <div class="mma-person-signal-meta"><small class="mma-person-signal-status">${result.isOnMap ? '지도에서 확인' : '위치 추정'}</small><small>신뢰도 ${escapeHtml(result.confidence || '중간')}</small>${result.age ? `<small>${escapeHtml(result.age)}</small>` : ''}</div>
                <div class="mma-event-location">${isModernTheme() ? '●' : '📍'} ${escapeHtml(result.currentLocation)}</div>
                <p class="mma-person-signal-summary">${escapeHtml(result.characterInfo || result.summary)}</p>
                <section class="mma-person-signal-block">
                    <h4>인물 정보</h4>
                    <ul>
                        <li><b>성별:</b> ${escapeHtml(result.gender || '장면에서 확인되지 않음')}</li>
                        <li><b>나이:</b> ${escapeHtml(result.age || '정확한 나이는 확인되지 않음')}</li>
                        ${result.ageBasis ? `<li><b>나이 판단 근거:</b> ${escapeHtml(result.ageBasis)}</li>` : ''}
                        <li><b>현재 기분:</b> ${escapeHtml(result.currentMood || '뚜렷하게 확인되지 않음')}</li>
                    </ul>
                </section>
                <section class="mma-person-signal-block">
                    <h4>현재 신호</h4>
                    <p>${escapeHtml(result.currentActivity)}</p>
                    ${result.currentTask ? `<p><b>당장 하려는 일:</b> ${escapeHtml(result.currentTask)}</p>` : ''}
                </section>
                ${result.relationshipWithUser ? `<section class="mma-person-signal-block"><h4>유저와의 관계</h4><p>${escapeHtml(result.relationshipWithUser)}</p></section>` : ''}
                ${result.lastEncounterWithUser ? `<section class="mma-person-signal-block"><h4>가장 최근 마주친 순간</h4><p>${escapeHtml(result.lastEncounterWithUser)}</p></section>` : ''}
                ${result.thoughts ? `<section class="mma-person-signal-block"><h4>현재 생각</h4><p>${escapeHtml(result.thoughts)}</p></section>` : ''}
                ${result.pocketContents?.length ? `<section class="mma-person-signal-block"><h4>소지품</h4><ul>${result.pocketContents.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
                ${result.reason ? `<section class="mma-person-signal-block"><h4>판단 근거</h4><p>${escapeHtml(result.reason)}</p></section>` : ''}
                ${result.hooks?.length ? `<section class="mma-person-signal-block"><h4>따라갈 만한 단서</h4><ul>${result.hooks.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul></section>` : ''}
                <div class="mma-event-actions">
                    ${liveLinks.locationId ? '<button data-action="show-location">위치 보기</button>' : ''}
                    ${liveLinks.footstepId ? '<button data-action="open-footstep">상세 보기</button>' : '<button data-action="add-footstep">지도에 표시</button>'}
                    <button data-action="track-person" title="이 인물의 이후 위치 변화를 수첩에서 다시 확인합니다.">👁 이후 동선 추적</button>
                    <button data-action="open-search-history">📓 기록 보기</button>
                </div>
                <small class="mma-search-auto-save-note">검색 결과는 수첩에 자동 저장됩니다.</small>
            </article>
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => {
        if (origin === 'notebook') renderNotebookPanel();
        else renderRecommendationPanel('person');
    });
    panel.querySelector('[data-action="show-location"]')?.addEventListener('click', () => selectLocation(liveLinks.locationId));
    panel.querySelector('[data-action="open-footstep"]')?.addEventListener('click', () => handleFootstepClick(liveLinks.footstepId));
    panel.querySelector('[data-action="add-footstep"]')?.addEventListener('click', () => addSearchResultToMap(result));
    panel.querySelector('[data-action="track-person"]')?.addEventListener('click', () => trackPersonFromResult(result));
    panel.querySelector('[data-action="open-search-history"]')?.addEventListener('click', () => renderNotebookPanel());
}

async function addSearchResultToMap(result) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map || !result) return;
    const resultMapGeneratedAt = String(result.mapGeneratedAt || '');
    const currentMapGeneratedAt = getMapLinkStamp(memory);
    const belongsToCurrentMap = Boolean(resultMapGeneratedAt && currentMapGeneratedAt && resultMapGeneratedAt === currentMapGeneratedAt);
    let locationId = belongsToCurrentMap && (map.locations || []).some(location => location.id === result.locationId)
        ? result.locationId
        : '';
    if (!locationId) {
        const searchedLocation = String(result.currentLocation || '').replace(/\s+/g, ' ').trim();
        if (isPlaceholderLocationName(searchedLocation)) {
            toast('검색 결과에 지도에 표시할 구체적인 장소가 없습니다.', 'info');
            return;
        }
        const byName = findUnambiguousLocationNameMatch(map.locations || [], searchedLocation);
        if (byName) {
            locationId = byName.id;
        } else if ((map.locations || []).length < 12) {
            const location = {
                id: `search-loc-${safeId(searchedLocation, 'place')}-${Date.now()}`,
                name: searchedLocation,
                icon: '📍',
                situation: String(result.currentActivity || result.summary || `${result.name}의 현재 위치 신호가 이곳에서 확인된다.`).trim(),
                details: [result.characterInfo, result.currentTask ? `현재 하려는 일: ${result.currentTask}` : '', result.reason ? `위치 판단 근거: ${result.reason}` : ''].filter(Boolean).join(' '),
                present: uniqueStrings([result.name], 1),
                clues: uniqueStrings(result.hooks || [], 4),
                eventIds: [],
                injectionText: '',
                source: 'person-search',
                createdAt: nowStamp(),
            };
            map.locations.push(location);
            locationId = location.id;
        } else {
            toast(`현재 지도에는 장소를 최대 12개까지 표시할 수 있어 ${searchedLocation}을(를) 추가하지 못했습니다. 기존 장소를 다른 곳에 연결하지는 않았습니다.`, 'info');
            return;
        }
    }
    if (!locationId) return;
    const footstepLabel = simplifyFootstepLabel(result.name);
    const existingFootstep = (map.footsteps || []).find(item => item.locationId === locationId
        && String(item.label || '').toLowerCase() === String(footstepLabel || '').toLowerCase());
    const fp = existingFootstep || {
        id: `search-foot-${safeId(result.name)}-${Date.now()}`,
        label: footstepLabel,
        locationId,
        status: result.currentActivity || result.summary || '검색으로 추가된 위치 신호',
        visibleName: !/^\?\?\?$/.test(String(result.name || '')),
    };
    fp.status = result.currentActivity || result.summary || fp.status || '검색으로 추가된 위치 신호';
    map.footsteps = uniqueFootsteps([fp, ...(map.footsteps || []).filter(item => item.id !== fp.id)]);
    result.footstepId = fp.id;
    result.locationId = locationId;
    const cachedProfile = normalizeFootstepProfile({
        name: result.name,
        gender: result.gender,
        age: result.age,
        ageBasis: result.ageBasis,
        characterInfo: result.characterInfo || result.summary,
        currentMood: result.currentMood,
        currentLocation: result.currentLocation,
        currentActivity: result.currentActivity,
        relationshipWithUser: result.relationshipWithUser,
        lastEncounterWithUser: result.lastEncounterWithUser,
        currentTask: result.currentTask,
        thoughts: result.thoughts,
        pocketContents: result.pocketContents,
        hooks: result.hooks,
        injectionText: result.injectionText,
    }, fp);
    memory.footstepProfiles = { ...(memory.footstepProfiles || {}), [fp.id]: cachedProfile };
    result.mapGeneratedAt = getMapLinkStamp(memory);
    const saved = await saveMemory(memory);
    if (!saved) {
        toast('위치 신호를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'warning');
        return;
    }
    renderMapView();
    selectLocation(locationId);
    toast(isBonbonTheme()
        ? `${result.name}의 캐릭터 말을 게임판에 놓았습니다.`
        : `${result.name}의 위치 신호를 지도에 표시했습니다.`, 'success');
}

function uniqueFootsteps(list) {
    const seen = new Set();
    const out = [];
    for (const fp of list || []) {
        const key = `${String(fp.label || '').toLowerCase()}|${fp.locationId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(fp);
    }
    return out;
}

function trackFootstep(footstepId) {
    const memory = ensureMemory();
    const map = memory.map;
    const footstep = map?.footsteps?.find(fp => fp.id === footstepId);
    if (!footstep) return;
    const profile = memory.footstepProfiles?.[footstepId];
    const loc = map.locations.find(l => l.id === footstep.locationId);
    const tracked = {
        id: `track:${safeId(profile?.name || footstep.label)}:${Date.now()}`,
        name: profile?.name || footstep.label || '???',
        sourceFootstepId: footstepId,
        lastLocation: profile?.currentLocation || loc?.name || '알 수 없는 위치',
        lastActivity: profile?.currentActivity || footstep.status || '위치 신호 확인됨',
        summary: profile?.characterInfo || '',
        trackerReaction: '아직 추적 반응을 확인하지 않음',
        confidence: '높음',
        signalStatus: '지도에서 확인',
        hooks: profile?.hooks || [],
        injectionText: profile?.injectionText || '',
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
        history: [],
    };
    upsertTrackedPerson(tracked);
    saveMemory();
    toast(isBonbonTheme()
        ? `${tracked.name}의 동선 카드를 보관함에 넣었습니다.`
        : `${tracked.name}의 이후 동선을 수첩에서 추적합니다.`, 'success');
    renderNotebookPanel();
}

function trackPersonFromResult(result) {
    if (!result) return;
    const tracked = {
        id: `track:${safeId(result.name)}:${Date.now()}`,
        name: result.name,
        sourceFootstepId: result.footstepId || '',
        lastLocation: result.currentLocation || '위치 신호 흐림',
        lastActivity: result.currentActivity || result.summary || '검색 결과에서 추적 시작',
        summary: result.summary || '',
        trackerReaction: result.trackerReaction || '',
        confidence: result.confidence || '중간',
        signalStatus: result.isOnMap ? '지도에서 확인' : '위치 추정',
        hooks: result.hooks || [],
        injectionText: result.injectionText || '',
        createdAt: nowStamp(),
        updatedAt: nowStamp(),
        history: [],
    };
    upsertTrackedPerson(tracked);
    saveMemory();
    toast(isBonbonTheme()
        ? `${tracked.name}의 동선 카드를 보관함에 넣었습니다.`
        : `${tracked.name}의 이후 동선을 수첩에서 추적합니다.`, 'success');
    renderNotebookPanel();
}

function upsertTrackedPerson(tracked) {
    const memory = ensureMemory();
    const key = safeId(tracked.name, 'tracked');
    const previous = memory.trackedPeople[key] || {};
    memory.trackedPeople[key] = {
        ...previous,
        ...tracked,
        id: previous.id || tracked.id,
        createdAt: previous.createdAt || tracked.createdAt || nowStamp(),
        updatedAt: nowStamp(),
        history: Array.isArray(previous.history) ? previous.history : [],
    };
}

async function refreshTrackedPerson(key) {
    const memory = ensureMemory();
    const tracked = memory.trackedPeople?.[key];
    if (!tracked) return;
    await withLoader(`${tracked.name}의 현재 위치를 다시 찾는 중...`, async () => {
        let rawText = '';
        rawText = await generateQuietWithSelectedProfile(buildTrackRefreshPrompt(tracked), TRACK_REFRESH_SCHEMA, { maxTokens: 5000 });
        const parsed = parseJson(rawText);
        if (!parsed) return;
        tracked.history = Array.isArray(tracked.history) ? tracked.history : [];
        tracked.history.unshift({
            location: tracked.lastLocation,
            activity: tracked.lastActivity,
            reaction: tracked.trackerReaction,
            at: tracked.updatedAt || nowStamp(),
        });
        tracked.lastLocation = String(parsed.currentLocation || tracked.lastLocation || '위치 신호 흐림');
        tracked.lastActivity = String(parsed.currentActivity || parsed.movementSummary || tracked.lastActivity || '현재 행동 불명');
        tracked.summary = String(parsed.movementSummary || tracked.summary || '');
        tracked.trackerReaction = String(parsed.trackerReaction || tracked.trackerReaction || '추적 반응 흐림');
        tracked.confidence = String(parsed.confidence || '중간');
        tracked.status = String(parsed.status || '추적 중');
        tracked.hooks = normalizeStringArray(parsed.hooks || tracked.hooks || [], [], 6);
        tracked.injectionText = String(parsed.injectionText || tracked.injectionText || '');
        tracked.updatedAt = nowStamp();
        await saveMemory();
    });
    renderNotebookPanel();
}

async function removeTrackedPerson(key) {
    const memory = ensureMemory();
    delete memory.trackedPeople[key];
    await saveMemory();
    renderNotebookPanel();
}


function renderFailurePanel(title = '지도 생성 실패', detail = '처리 중 오류가 발생했습니다.') {
    const content = document.getElementById('mma-content');
    if (!content) return;
    pushDebugLog('render.failure', detail);
    const theme = getThemeConfig();
    content.innerHTML = `
        <section class="mma-spell-screen mma-failure-screen">
            <div class="mma-spell-top">
                <div class="mma-brand">${escapeHtml(theme.shortLabel)}</div>
                <div class="mma-spell-actions">
                    <button class="mma-managed-button mma-close-button" data-action="close" aria-label="${isBonbonTheme() ? '게임 상자 닫기' : '닫기'}" title="${isBonbonTheme() ? '게임 상자 닫기' : '닫기'}">${escapeHtml(theme.closeText)}</button>
                </div>
            </div>
            <div class="mma-parchment-center">
                <div class="mma-blank-note">${escapeHtml(title)}</div>
                <p class="mma-spell-hint">${escapeHtml(detail)}</p>
                <div class="mma-place-actions">
                    <button data-action="copy-debug">🐞 디버그 로그 복사</button>
                    <button data-action="retry-map">다시 시도</button>
                </div>
            </div>
        </section>
    `;
    content.querySelector('[data-action="close"]')?.addEventListener('click', () => closeMap('failure-close'));
    content.querySelector('[data-action="copy-debug"]')?.addEventListener('click', () => copyDebugLogsToClipboard());
    content.querySelector('[data-action="retry-map"]')?.addEventListener('click', () => generateMap(true));
}

function renderDebugPanel() {
    const panel = document.getElementById('mma-side-panel');
    const logs = getDebugLogs();
    const rows = logs.slice(0, 30).map(log => `
        <article class="mma-event-card mma-debug-entry">
            <div class="mma-event-title"><b>${escapeHtml(log.type || 'log')}</b><span>${escapeHtml(log.at || '')}</span></div>
            <p>${escapeHtml(log.message || '')}</p>
            ${log.data ? `<pre>${escapeHtml(typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2))}</pre>` : ''}
        </article>
    `).join('');
    const html = `
        <div class="mma-action-panel mma-debug-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">🐞</span><strong>디버그 로그</strong></div>
                <button title="돌아가기" data-action="back">↩️</button>
            </header>
            <p class="mma-panel-note">모바일에서 콘솔 확인이 어려울 때 이 내용을 복사해 보내주세요. 최근 오류와 API 호출 흐름만 기록합니다.</p>
            <div class="mma-place-actions">
                <button data-action="copy-debug">로그 복사</button>
                <button data-action="clear-debug">로그 비우기</button>
            </div>
            ${rows || '<p class="mma-empty">아직 기록된 오류가 없습니다.</p>'}
        </div>
    `;
    if (panel) {
        panel.innerHTML = html;
        panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(ensureMemory().selectedLocationId));
        panel.querySelector('[data-action="copy-debug"]')?.addEventListener('click', () => copyDebugLogsToClipboard());
        panel.querySelector('[data-action="clear-debug"]')?.addEventListener('click', () => { clearDebugLogs(); renderDebugPanel(); });
        return;
    }

    const content = document.getElementById('mma-content');
    if (!content) return;
    content.innerHTML = `<section class="mma-map-screen">${html}</section>`;
    content.querySelector('[data-action="back"]')?.addEventListener('click', renderSpellScreen);
    content.querySelector('[data-action="copy-debug"]')?.addEventListener('click', () => copyDebugLogsToClipboard());
    content.querySelector('[data-action="clear-debug"]')?.addEventListener('click', () => { clearDebugLogs(); renderDebugPanel(); });
}

function renderRecommendationPanel(activeTab = 'place') {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const selectedTab = activeTab === 'person' ? 'person' : 'place';
    const categories = ['맛집', '데이트 명소', '요즘 핫플레이스', '산책 코스'];
    const personPanel = `
        <p class="mma-panel-note">현재 지도에 표시된 인물을 먼저 확인합니다. 지도에 없으면 현재 RP를 바탕으로 위치를 별도로 찾습니다.</p>
        <div class="mma-custom-search mma-person-search-form">
            <input id="mma-person-search-query" class="text_pole" placeholder="찾을 인물 이름" autocomplete="off">
            <button type="button" data-action="person-search">찾기</button>
        </div>
    `;
    const placePanel = `
        <p class="mma-panel-note">어떤 장소를 검색해볼까요? 모든 검색 내역은 수첩 📓에 기록할 수 있습니다.</p>
        <div class="mma-recommend-buttons">
            ${categories.map(cat => `<button data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join('')}
        </div>
        <div class="mma-custom-search">
            <input id="mma-custom-recommend" class="text_pole" placeholder="예) 비 오는 날 데이트, 비밀 명소, 고백하기 좋은 곳">
            <button data-action="custom-recommend">검색</button>
        </div>
        <div id="mma-recommend-results">${renderRecommendationCards(ensureMemory().recommendations || [])}</div>
    `;
    panel.innerHTML = `
        <div class="mma-action-panel mma-search-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">🔎</span><strong>검색</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <div class="mma-search-tabs" role="tablist" aria-label="검색 종류">
                <button type="button" role="tab" data-search-tab="person" aria-selected="${selectedTab === 'person'}" class="${selectedTab === 'person' ? 'active' : ''}">인물 찾기</button>
                <button type="button" role="tab" data-search-tab="place" aria-selected="${selectedTab === 'place'}" class="${selectedTab === 'place' ? 'active' : ''}">장소 찾기</button>
            </div>
            ${selectedTab === 'person' ? personPanel : placePanel}
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(ensureMemory().selectedLocationId));
    panel.querySelectorAll('[data-search-tab]').forEach(button => button.addEventListener('click', () => renderRecommendationPanel(button.dataset.searchTab)));
    const submitPersonSearch = () => {
        const value = panel.querySelector('#mma-person-search-query')?.value?.trim();
        if (value) handlePersonSearch(value);
    };
    panel.querySelector('[data-action="person-search"]')?.addEventListener('click', submitPersonSearch);
    panel.querySelector('#mma-person-search-query')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') submitPersonSearch();
    });
    panel.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => generateRecommendations(button.dataset.category)));
    panel.querySelector('[data-action="custom-recommend"]')?.addEventListener('click', () => {
        const value = panel.querySelector('#mma-custom-recommend')?.value?.trim();
        if (value) generateRecommendations(value);
    });
    wireRecommendationButtons(panel);
}


function parseMaybeJsonValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function formatMiniReviewValue(value) {
    const parsed = parseMaybeJsonValue(value);
    if (Array.isArray(parsed)) {
        return parsed.map(formatMiniReviewValue).filter(Boolean).join(' / ');
    }
    if (parsed && typeof parsed === 'object') {
        const handle = String(parsed.handle || parsed.user || parsed.name || parsed.nickname || '').trim();
        const review = String(parsed.review || parsed.text || parsed.comment || parsed.body || parsed.content || '').trim();
        if (handle && review) return `${handle} · ${review}`;
        if (review) return review;
        if (handle) return handle;
        return '';
    }
    return String(parsed || '').trim();
}

function normalizeMiniReviewArray(value, max = 2) {
    const source = Array.isArray(value) ? value : (value ? [value] : []);
    const out = [];
    const add = (entry) => {
        const parsed = parseMaybeJsonValue(entry);
        if (Array.isArray(parsed)) {
            parsed.forEach(add);
            return;
        }
        const formatted = formatMiniReviewValue(parsed).replace(/\s+/g, ' ').trim();
        if (formatted) out.push(formatted);
    };
    source.forEach(add);
    return uniqueStrings(out, max);
}

function getRecommendationLocationLabel(item = {}) {
    const explicit = String(item.locationName || '').replace(/\s+/g, ' ').trim();
    if (explicit && !/^(?:알 수 없는 위치|unknown location|unknown|위치 미상)$/i.test(explicit)) return explicit;

    const title = String(item.title || '').trim();
    const mapRegion = String(ensureMemory()?.map?.regionName || '').trim();
    const source = `${title} ${mapRegion}`.toLowerCase();
    if (/honeydukes|허니듀크|호니듀크|호그스미드|hogsmeade/.test(source)) return '호그스미드 · 하이 스트리트';
    if (/다이애건|diagon/.test(source)) return '다이애건 앨리 · 상점가';
    if (/호그와트|hogwarts|그리핀도르|슬리데린|후플푸프|래번클로|기숙사|연회장|도서관/.test(source)) {
        const local = mapRegion && /호그와트|hogwarts/i.test(mapRegion) ? mapRegion.replace(/^호그와트\s*[··-]?\s*/i, '').trim() : '';
        return `호그와트 · ${local || '교내 구역'}`;
    }
    if (mapRegion) return `${mapRegion} · ${title || '주변'}`;
    return title ? `${title} 인근` : '현재 장면 인근';
}

function renderRecommendationCards(items) {
    const list = items || [];
    if (!list.length) return '<p class="mma-empty">아직 검색한 장소가 없습니다.</p>';
    return list.map(item => `
        <article class="mma-event-card recommendation-card" data-recommend-id="${escapeHtml(item.id)}">
            <div class="mma-event-title"><b>${escapeHtml(item.emoji || '⭐')} ${escapeHtml(item.title)}</b></div>
            <div class="mma-event-location">📍 ${escapeHtml(getRecommendationLocationLabel(item))}</div>
            <p class="mma-rating-line">${escapeHtml(item.shortReview || '')}</p>
            ${normalizeMiniReviewArray(item.miniReviews, 2).length ? `<ul class="mma-mini-reviews mma-review-list">${normalizeMiniReviewArray(item.miniReviews, 2).map(review => `<li>${escapeHtml(review)}</li>`).join('')}</ul>` : ''}
            ${item.details ? `<p class="mma-space-description">${escapeHtml(item.details)}</p>` : ''}
            <p class="mma-event-detail"><b>유명한 이유</b>: ${escapeHtml(item.famousFor || item.whyFits || '')}</p>
            <p class="mma-event-detail"><b>시그니처</b>: ${escapeHtml(item.signature || '아직 뚜렷하지 않음')}</p>
            <p class="mma-event-detail"><b>예상 시나리오</b>: ${escapeHtml(item.sceneHook || '')}</p>
            ${Array.isArray(item.possibleScenes) && item.possibleScenes.length ? `<ul class="mma-possible-scenes">${item.possibleScenes.slice(0, 3).map(scene => `<li>${escapeHtml(scene)}</li>`).join('')}</ul>` : ''}
            <div class="mma-event-actions">
                ${renderActionButtons('recommendation', item.id)}
                <button class="mma-recommend-delete" title="검색 결과를 완전히 삭제" aria-label="검색 결과 삭제" data-recommend-delete="${escapeHtml(item.id)}">🗑️</button>
            </div>
        </article>
    `).join('');
}

function isInteractiveRecommendationTarget(target) {
    return Boolean(target?.closest?.('button, input, select, textarea, a, summary, details'));
}

async function deleteRecommendation(id) {
    const memory = ensureMemory();
    const item = (memory.recommendations || []).find(x => x.id === id);
    if (!item) {
        pushDebugLog('search.place.delete.missing', '삭제 대상 검색 장소를 찾지 못했습니다.', {
            placeResults: memory.recommendations?.length || 0,
        });
        toast('이미 삭제되었거나 찾을 수 없는 검색 결과입니다.', 'warning');
        return false;
    }
    if (!window.confirm(`${item.title || '이 검색 장소'}을(를) 삭제할까요?\n수집/반영해 둔 동일 항목도 함께 해제됩니다.`)) return false;

    const before = {
        placeResults: memory.recommendations?.length || 0,
        managedItems: memory.managedItems?.length || 0,
        activeContexts: getActiveInjectionItems().length,
    };
    pushDebugLog('search.place.delete.start', '검색 장소 삭제를 시작했습니다.', before);

    const linkedManagedItems = (memory.managedItems || []).filter(x => x.sourceId === `recommendation:${id}` || x.id === `recommendation:${id}`);
    const removedInjectedContext = linkedManagedItems.some(x => ['injected', 'char_notice', 'user_notice'].includes(x.status));

    memory.recommendations = (memory.recommendations || []).filter(x => x.id !== id);
    memory.managedItems = (memory.managedItems || []).filter(x => x.sourceId !== `recommendation:${id}` && x.id !== `recommendation:${id}`);

    const saved = await saveMemory(memory);
    const { notebook } = getCharacterNotebook(getSettings(), memory.sharedNotebookKey || getCurrentCharacterKey());
    const removedFromChat = !(memory.recommendations || []).some(x => x.id === id);
    const removedFromNotebook = !(notebook.recommendations || []).some(x => x.id === id);
    const removedManaged = !(memory.managedItems || []).some(x => x.sourceId === `recommendation:${id}` || x.id === `recommendation:${id}`);
    const verified = Boolean(saved && removedFromChat && removedFromNotebook && removedManaged);

    pushDebugLog(verified ? 'search.place.delete.success' : 'search.place.delete.verify_failed', verified
        ? '검색 장소 삭제 저장을 확인했습니다.'
        : '검색 장소 삭제 저장 확인에 실패했습니다.', {
        before,
        after: {
            placeResults: memory.recommendations?.length || 0,
            managedItems: memory.managedItems?.length || 0,
            activeContexts: getActiveInjectionItems().length,
        },
        saved,
        removedFromChat,
        removedFromNotebook,
        removedManaged,
        removedInjectedContext,
    });

    // A plain search-result delete does not touch roleplay context at all.
    // Rebuild the hidden extension prompt only when this same item had been
    // explicitly set to inject / character notice / user notice.
    if (removedInjectedContext) syncExtensionPrompt();
    toast(verified ? '검색 내역을 완전히 삭제했습니다.' : '삭제 저장을 확인하지 못했습니다. 디버그 로그를 확인해 주세요.', verified ? 'success' : 'warning');
    const panel = document.getElementById('mma-side-panel');
    if (panel?.querySelector('#mma-recommend-results')) renderRecommendationPanel();
    else renderNotebookPanel();
    return verified;
}

function wireRecommendationButtons(root) {
    root.querySelectorAll('[data-recommend-delete]').forEach(button => {
        button.addEventListener('click', () => deleteRecommendation(button.dataset.recommendDelete));
    });
    root.querySelectorAll('[data-event-action]').forEach(button => {
        button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
    });
    root.querySelectorAll('[data-recommend-collect]').forEach(button => {
        button.addEventListener('click', async () => {
            const memory = ensureMemory();
            const item = memory.recommendations.find(x => x.id === button.dataset.recommendCollect);
            if (item) item.collected = true;
            const saved = await saveMemory(memory);
            pushDebugLog('search.place.collect', '검색 장소를 수첩에 수집했습니다.', {
                placeResults: memory.recommendations?.length || 0,
                collectedPlaces: (memory.recommendations || []).filter(entry => entry?.collected).length,
                saved,
            });
            toast(saved ? '검색 내역을 수첩에 기록했습니다.' : '수첩 저장을 확인하지 못했습니다. 디버그 로그를 확인해 주세요.', saved ? 'success' : 'warning');
            renderNotebookPanel();
        });
    });
    root.querySelectorAll('[data-recommend-id]').forEach(card => {
        let pressTimer = null;
        const clearPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
            pressTimer = null;
        };
        card.addEventListener('contextmenu', event => {
            if (isInteractiveRecommendationTarget(event.target)) return;
            event.preventDefault();
            deleteRecommendation(card.dataset.recommendId);
        });
        card.addEventListener('pointerdown', event => {
            if (isInteractiveRecommendationTarget(event.target)) return;
            clearPress();
            pressTimer = setTimeout(() => {
                pressTimer = null;
                deleteRecommendation(card.dataset.recommendId);
            }, 760);
        });
        ['pointerup', 'pointerleave', 'pointercancel', 'dragstart'].forEach(type => card.addEventListener(type, clearPress));
    });
}

async function generateRecommendations(category) {
    const memory = ensureMemory();
    pushDebugLog('search.place.generate.start', '장소 검색을 시작했습니다.', {
        placeResults: memory.recommendations?.length || 0,
    });
    await withLoader(`${category} 추천을 찾는 중...`, async () => {
        let rawText = '';
        rawText = await generateQuietWithSelectedProfile(buildRecommendationPrompt(category), RECOMMENDATION_SCHEMA, { maxTokens: 5000 });
        const parsed = parseJson(rawText);
        const items = (parsed?.items || []).map((item, index) => ({
            id: item.id ? `recommendation:${safeId(item.id)}:${Date.now()}-${index}` : `recommendation:${safeId(item.title || category)}:${Date.now()}-${index}`,
            category: category,
            title: String(item.title || `검색 장소 ${index + 1}`),
            emoji: String(item.emoji || '⭐'),
            locationName: getRecommendationLocationLabel(item),
            shortReview: String(item.shortReview || ''),
            whyFits: String(item.whyFits || ''),
            sceneHook: String(item.sceneHook || ''),
            details: String(item.details || ''),
            famousFor: String(item.famousFor || item.famousReason || ''),
            signature: String(item.signature || item.famousMenu || item.representativeMenu || item.signatureMenu || ''),
            miniReviews: normalizeMiniReviewArray(item.miniReviews || item.reviews || [], 2),
            possibleScenes: normalizeStringArray(item.possibleScenes || item.sceneHooks || [], [], 4),
            injectionText: String(item.injectionText || ''),
            collected: false,
            createdAt: nowStamp(),
        }));
        const existing = memory.recommendations || [];
        const collected = existing.filter(entry => entry?.collected);
        const transient = [...items, ...existing.filter(entry => !entry?.collected)]
            .slice(0, UNCOLLECTED_RECOMMENDATION_LIMIT);
        memory.recommendations = [...transient, ...collected];
        const saved = await saveMemory(memory);
        pushDebugLog(saved ? 'search.place.generate.success' : 'search.place.generate.save_failed', saved
            ? '장소 검색 결과를 저장했습니다.'
            : '장소 검색 결과 저장을 확인하지 못했습니다.', {
            added: items.length,
            placeResults: memory.recommendations?.length || 0,
            saved,
        });
    });
    renderRecommendationPanel();
}

function renderNotebookPanel() {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const managed = getManagedPanelItems();
    const trackedEntries = Object.entries(memory.trackedPeople || {});
    const searchHistory = memory.searchResults || [];
    const recommendations = (memory.recommendations || []).filter(x => x.collected);
    panel.innerHTML = `
        <div class="mma-action-panel mma-notebook-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">📓</span><strong>수첩</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <p class="mma-panel-note">반영 데이터, 추적 중인 인물, 수집한 장소를 한곳에서 볼 수 있습니다. 반영 데이터만 롤플에 반영되고 그 외 정보는 수첩에서만 볼 수 있습니다. 수집한 정보, 추적 중인 인물을 반영 데이터로 변경할 수 있습니다.</p>
            <details open class="mma-notebook-section"><summary>반영/수집 데이터 <small>${managed.length}</small></summary>${managed.length ? managed.map(item => renderManagedItemCard(item)).join('') : '<p class="mma-empty">반영 또는 수집 중인 항목이 없습니다.</p>'}</details>
            <details class="mma-notebook-section"><summary>추적 중인 인물 <small>${trackedEntries.length}</small></summary>${trackedEntries.length ? trackedEntries.map(([key, item]) => renderTrackedCard(key, item)).join('') : '<p class="mma-empty">아직 추적 중인 인물이 없다.</p>'}</details>
            <details class="mma-notebook-section"><summary>인물 검색 기록 <small>${searchHistory.length}</small></summary>${searchHistory.length ? searchHistory.map(result => renderSearchHistoryCard(result)).join('') : '<p class="mma-empty">아직 인물 검색 기록이 없습니다.</p>'}</details>
            <details class="mma-notebook-section"><summary>수집한 검색 장소 <small>${recommendations.length}</small></summary>${recommendations.length ? renderRecommendationCards(recommendations) : '<p class="mma-empty">수집한 검색 장소가 없다.</p>'}</details>
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(memory.selectedLocationId));
    panel.querySelectorAll('[data-event-action]').forEach(button => {
        button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
    });
    panel.querySelectorAll('[data-track-refresh]').forEach(button => button.addEventListener('click', () => refreshTrackedPerson(button.dataset.trackRefresh)));
    panel.querySelectorAll('[data-track-remove]').forEach(button => button.addEventListener('click', () => removeTrackedPerson(button.dataset.trackRemove)));
    panel.querySelectorAll('[data-search-open]').forEach(button => button.addEventListener('click', () => {
        const result = ensureMemory().searchResults?.find(entry => entry.id === button.dataset.searchOpen);
        if (result) renderPersonSearchResultPanel(result, 'notebook');
    }));
    panel.querySelectorAll('[data-search-delete]').forEach(button => button.addEventListener('click', () => deletePersonSearchResult(button.dataset.searchDelete)));
    wireRecommendationButtons(panel);
}

function renderTrackedCard(key, item) {
    const activityText = item.lastActivity || item.summary || '현재 행동이 또렷하지 않다.';
    const history = item.history?.length ? `<details class="mma-track-history"><summary>이전 동선</summary><ul>${item.history.map(h => `<li>${escapeHtml(h.at || '')} — ${escapeHtml(h.location || '')}: ${escapeHtml(h.activity || '')}</li>`).join('')}</ul></details>` : '';
    return `
        <article class="mma-event-card tracked-card">
            <div class="mma-event-title"><b>👁 ${escapeHtml(item.name)}</b><span>${escapeHtml(item.status || '추적 중')}</span></div>
            ${isModernTheme() ? `<div class="mma-person-signal-meta"><small class="mma-person-signal-status">${escapeHtml(item.status || '추적 중')}</small>${item.signalStatus ? `<small>${escapeHtml(item.signalStatus)}</small>` : ''}${item.confidence ? `<small>신뢰도 ${escapeHtml(item.confidence)}</small>` : ''}</div>` : ''}
            <div class="mma-event-location">${isModernTheme() ? '●' : '📍'} ${escapeHtml(item.lastLocation || '위치 신호 흐림')}</div>
            <div class="mma-scroll-text"><p>${escapeHtml(activityText)}</p></div>
            ${item.trackerReaction ? `<div class="mma-scroll-text small"><p><b>추적 반응</b>: ${escapeHtml(item.trackerReaction)}</p></div>` : ''}
            ${Array.isArray(item.hooks) && item.hooks.length ? `<ul class="mma-possible-scenes">${item.hooks.slice(0, 4).map(hook => `<li>${escapeHtml(hook)}</li>`).join('')}</ul>` : ''}
            <div class="mma-event-actions">
                <button data-track-refresh="${escapeHtml(key)}">지금 어디 있지?</button>
                ${renderActionButtons('tracked', key)}
                <button data-track-remove="${escapeHtml(key)}">추적 해제</button>
            </div>
            ${history}
        </article>
    `;
}

function renderSearchHistoryCard(result) {
    return `
        <article class="mma-event-card search-history-card">
            <div class="mma-event-title"><b>🔎 ${escapeHtml(result.name || result.query)}</b><span>${escapeHtml(result.confidence || '검색')}</span></div>
            ${isModernTheme() ? `<div class="mma-person-signal-meta"><small class="mma-person-signal-status">${result.isOnMap ? '지도에서 확인' : '위치 추정'}</small><small>신뢰도 ${escapeHtml(result.confidence || '중간')}</small></div>` : ''}
            <div class="mma-event-location">${isModernTheme() ? '●' : '📍'} ${escapeHtml(result.currentLocation || '위치 신호 흐림')}</div>
            <p>${escapeHtml(stripLong(result.summary || result.currentActivity || '', 220))}</p>
            <div class="mma-event-actions">
                <button data-search-open="${escapeHtml(result.id)}">다시 보기</button>
                <button data-search-delete="${escapeHtml(result.id)}">🗑️ 삭제</button>
            </div>
        </article>
    `;
}

async function deletePersonSearchResult(id) {
    const memory = ensureMemory();
    const exists = (memory.searchResults || []).some(result => result.id === id);
    if (!exists) {
        pushDebugLog('search.person.delete.missing', '삭제 대상 인물 검색 기록을 찾지 못했습니다.', {
            personSearchHistory: memory.searchResults?.length || 0,
        });
        toast('이미 삭제되었거나 찾을 수 없는 검색 기록입니다.', 'warning');
        return false;
    }
    if (!window.confirm('이 인물 검색 기록을 삭제할까요?\n추적 중인 인물이나 이미 반영한 데이터는 삭제되지 않습니다.')) return false;

    const before = memory.searchResults?.length || 0;
    memory.searchResults = (memory.searchResults || []).filter(result => result.id !== id);
    const saved = await saveMemory(memory);
    const { notebook } = getCharacterNotebook(getSettings(), memory.sharedNotebookKey || getCurrentCharacterKey());
    const removedFromChat = !(memory.searchResults || []).some(result => result.id === id);
    const removedFromNotebook = !(notebook.searchResults || []).some(result => result.id === id);
    const verified = Boolean(saved && removedFromChat && removedFromNotebook);
    pushDebugLog(verified ? 'search.person.delete.success' : 'search.person.delete.verify_failed', verified
        ? '인물 검색 기록 삭제와 수첩 동기화를 확인했습니다.'
        : '인물 검색 기록 삭제 후 수첩 동기화 확인에 실패했습니다.', {
        before,
        after: memory.searchResults?.length || 0,
        saved,
        removedFromChat,
        removedFromNotebook,
    });
    toast(verified ? '인물 검색 기록을 삭제했습니다.' : '삭제 저장을 확인하지 못했습니다. 디버그 로그를 확인해 주세요.', verified ? 'success' : 'warning');
    renderNotebookPanel();
    return verified;
}


async function getConnectionManagerRequestService() {
    try {
        const context = stContext ? stContext() : SillyTavern?.getContext?.();
        if (context?.ConnectionManagerRequestService?.sendRequest) return context.ConnectionManagerRequestService;
    } catch {
        // fall through
    }
    if (globalThis.ConnectionManagerRequestService?.sendRequest) return globalThis.ConnectionManagerRequestService;
    try {
        const mod = await import('/scripts/extensions/shared.js');
        return mod?.ConnectionManagerRequestService || null;
    } catch {
        return null;
    }
}

function getConnectionManagerProfilesRaw() {
    try {
        const ctx = stContext ? stContext() : SillyTavern?.getContext?.();
        const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(profiles) ? profiles : [];
    } catch {
        return [];
    }
}

function normalizeCmProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const id = String(profile.id || '').trim();
    const name = String(profile.name || '').trim();
    if (!id || !name) return null;
    return { ...profile, id, name };
}

function findCmProfile(value) {
    const wanted = String(value || '').trim();
    if (!wanted || wanted === 'main' || wanted === 'current') return null;
    return getConnectionManagerProfilesRaw().map(normalizeCmProfile).filter(Boolean).find(p => p.id === wanted || p.name === wanted) || null;
}

async function getSupportedConnectionProfilesForExtension() {
    const Service = await getConnectionManagerRequestService();
    if (Service?.getSupportedProfiles) {
        try {
            return Service.getSupportedProfiles().map(normalizeCmProfile).filter(Boolean);
        } catch {
            // fall through
        }
    }
    return getConnectionManagerProfilesRaw().map(normalizeCmProfile).filter(Boolean);
}

async function runSlash(command) {
    const ctx = stContext();
    const runner = globalThis.SillyTavern?.executeSlashCommandsWithOptions || ctx.executeSlashCommandsWithOptions;
    if (typeof runner !== 'function') return null;
    const result = await runner(command, { source: MODULE_NAME, handleExecutionErrors: false, handleParserErrors: false });
    return result?.pipe ?? result?.text ?? result;
}

function quoteSlashArg(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function getSavedConnectionProfiles() {
    return await getSupportedConnectionProfilesForExtension();
}


async function getCurrentProfileName() {
    try {
        const raw = await runSlash('/profile');
        if (!raw) return '';
        return String(raw).replace(/^Current profile:\s*/i, '').trim();
    } catch {
        return '';
    }
}

function getJsonOnlyInstruction(jsonSchema) {
    if (!jsonSchema) return '';
    return '\n\nImportant: Return exactly one valid JSON object only. Do not add markdown fences, comments, explanations, or any text before or after the JSON.';
}

function getSchemaAwareJsonInstruction(jsonSchema) {
    if (!jsonSchema) return '';
    if (String(jsonSchema?.name || '').startsWith('RoleplayArea')) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include these top-level fields:
- regionName: string
- timeHint: string
- worldSummary: string
- currentLocationName: string matching one returned location name
- locations: array of map locations
- footsteps: array of character/location signals visible in the current scene
- worldEvents: array of independent quests already unfolding elsewhere in the supplied world
- personalEvents: array containing 0 or 1 quest caused by or directed toward the protagonists
If locations is empty, the response is invalid.`;
    }
    if (jsonSchema === LOCATION_SCHEMA) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include location, events, and footsteps for the refreshed location.`;
    }
    if (jsonSchema === FOOTSTEP_PROFILE_SCHEMA) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include name, gender, age, ageBasis, characterInfo, currentMood, currentLocation, currentActivity, relationshipWithUser, lastEncounterWithUser, currentTask, thoughts, pocketContents, hooks, and injectionText.`;
    }
    if (jsonSchema === PERSON_SEARCH_SCHEMA) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include name, isOnMap, gender, age, ageBasis, characterInfo, currentMood, currentLocation, currentActivity, relationshipWithUser, lastEncounterWithUser, currentTask, thoughts, pocketContents, confidence, summary, reason, trackerReaction, hooks, and injectionText.`;
    }
    if (jsonSchema === TRACK_REFRESH_SCHEMA) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include name, currentLocation, movementSummary, currentActivity, trackerReaction, confidence, status, hooks, and injectionText.`;
    }
    if (jsonSchema === RECOMMENDATION_SCHEMA) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include category and items. Put at least 3 recommendation items in items.`;
    }
    if (/^(?:MapDiscoveries|SurroundingScenes)/.test(String(jsonSchema?.name || ''))) {
        return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}.
The JSON must include items. Each item includes category, emoji, title, locationName, focus, focusContext, observation, stakes, interactions, participants, sourceAnchors, motifKey, and continuationOf.`;
    }
    return `${getJsonOnlyInstruction(jsonSchema)}

Never return only an empty object {}. Return the required fields for the requested schema.`;
}

function extractGeneratedText(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') {
        if (typeof raw.assistantText === 'string') return raw.assistantText;
        if (typeof raw.content === 'string') return raw.content;
        if (typeof raw.text === 'string') return raw.text;
        if (typeof raw.response === 'string') return raw.response;
        if (typeof raw.message?.content === 'string') return raw.message.content;
        if (typeof raw.choices?.[0]?.message?.content === 'string') return raw.choices[0].message.content;
        if (typeof raw.choices?.[0]?.text === 'string') return raw.choices[0].text;
        if (typeof raw.candidates?.[0]?.content?.parts?.[0]?.text === 'string') return raw.candidates[0].content.parts[0].text;
        return JSON.stringify(raw);
    }
    return String(raw);
}

function isEmptyObjectResponse(text) {
    const parsed = parseJson(text);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
}

async function withGenerationTimeout(promise, ms, label = 'generation') {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), Math.max(1000, Number(ms || 0)));
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function createMapGenerationCancelledError(reason = 'cancelled') {
    const error = new Error(`Map generation cancelled: ${reason}`);
    error.name = 'AbortError';
    error.mmaGenerationCancelled = true;
    return error;
}

function isMapGenerationCancelledError(error) {
    return Boolean(error?.mmaGenerationCancelled);
}

function isMapOverlayVisible() {
    const overlay = document.getElementById('mma-overlay');
    return Boolean(overlay && !overlay.classList.contains('mma-hidden'));
}

function isViewingLocationPanel(locationId = '') {
    const panel = document.getElementById('mma-side-panel');
    if (!panel || !panel.querySelector('[data-action="refresh-location"]')) return false;
    if (!locationId) return true;
    const location = ensureMemory().map?.locations?.find(item => item.id === locationId);
    const title = panel.querySelector('.mma-place-header strong')?.textContent?.trim() || '';
    return Boolean(location && title === String(location.name || '').trim());
}

function refreshVisibleMapAfterBackgroundUpdate({ locationId = '', forceMapView = false } = {}) {
    if (!isMapOverlayVisible()) return false;
    const canvas = document.getElementById('mma-map-canvas');
    const panel = document.getElementById('mma-side-panel');
    if (forceMapView || !canvas || !panel) {
        renderMapView();
        return true;
    }

    // Keep the panel the user is currently reading. Only refresh that panel
    // when it is still the exact place which just finished updating.
    renderCanvas();
    refreshMapGenerationControls();
    if (locationId && isViewingLocationPanel(locationId)) {
        renderLocationPanel(locationId);
    } else if (!locationId && isViewingLocationPanel()) {
        const selectedLocationId = ensureMemory().selectedLocationId;
        if (selectedLocationId) renderLocationPanel(selectedLocationId);
    }
    return true;
}

function refreshMapGenerationControls() {
    const busy = Boolean(activeMapGeneration);
    document.querySelectorAll('[data-action="refresh-all"], [data-action="refresh-location"], [data-action="restore-previous-map"], [data-action="discover"]').forEach(button => {
        button.disabled = busy;
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
}

function beginMapGeneration(kind, locationId = '') {
    if (activeMapGeneration) {
        pushDebugLog('map.generate.ignored', '이미 진행 중인 지도 요청이 있어 새 요청을 시작하지 않았습니다.', {
            activeKind: activeMapGeneration.kind,
            requestedKind: kind,
            locationId,
        });
        toast('이미 지도 정보를 읽는 중입니다.', 'info');
        return null;
    }
    const job = {
        id: `map-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        locationId,
        controller: new AbortController(),
        cancelled: false,
        startedAt: Date.now(),
    };
    activeMapGeneration = job;
    refreshMapGenerationControls();
    pushDebugLog('map.generate.job.start', '지도 생성 작업을 시작했습니다.', { id: job.id, kind, locationId });
    return job;
}

function cancelActiveMapGeneration(reason = 'cancelled') {
    const job = activeMapGeneration;
    if (!job) return false;
    job.cancelled = true;
    try { job.controller.abort(createMapGenerationCancelledError(reason)); } catch { /* noop */ }
    if (activeMapGeneration === job) activeMapGeneration = null;
    refreshMapGenerationControls();
    pushDebugLog('map.generate.job.cancel', '진행 중인 지도 생성 작업을 취소했습니다.', { id: job.id, kind: job.kind, reason });
    return true;
}

function assertCurrentMapGeneration(job) {
    if (!job || job.cancelled || activeMapGeneration !== job || job.controller.signal.aborted) {
        throw createMapGenerationCancelledError(job?.cancelled ? 'cancelled' : 'stale response');
    }
}

function finishMapGeneration(job) {
    if (activeMapGeneration === job) activeMapGeneration = null;
    refreshMapGenerationControls();
    if (job) pushDebugLog('map.generate.job.end', '지도 생성 작업을 종료했습니다.', { id: job.id, kind: job.kind, cancelled: Boolean(job.cancelled) });
}

async function generateQuietWithSelectedProfile(quietPrompt, jsonSchema = null, options = {}) {
    const settings = getSettings();
    const prompt = String(quietPrompt || '');
    const maxTokens = Number(options.maxTokens || 5000);
    const externalSignal = options.signal || null;
    const target = String(settings.connectionProfile || 'main').trim();
    const ctx = stContext();

    if (externalSignal?.aborted) throw createMapGenerationCancelledError('request was cancelled before start');

    if (!target || target === 'main') {
        pushDebugLog('request.profile', '메인 API로 요청합니다.', { target: 'main', schema: Boolean(jsonSchema), maxTokens });
        try {
            const result = jsonSchema
                ? await ctx.generateQuietPrompt({
                    quietPrompt: prompt,
                    jsonSchema,
                    responseLength: maxTokens,
                    maxTokens,
                    max_tokens: maxTokens,
                })
                : await ctx.generateQuietPrompt({
                    quietPrompt: prompt,
                    responseLength: maxTokens,
                    maxTokens,
                    max_tokens: maxTokens,
                });
            if (externalSignal?.aborted) throw createMapGenerationCancelledError('request was cancelled before response commit');
            return result;
        } catch (error) {
            if (externalSignal?.aborted || isMapGenerationCancelledError(error)) throw createMapGenerationCancelledError('request was cancelled');
            if (jsonSchema) {
                pushDebugLog('request.main.structured.error', '메인 API 구조화 출력 실패, 일반 JSON 지시문으로 재시도합니다.', {
                    error: String(error?.message || error),
                });
                const fallback = await ctx.generateQuietPrompt({
                    quietPrompt: `${prompt}${getSchemaAwareJsonInstruction(jsonSchema)}`,
                    responseLength: maxTokens,
                    maxTokens,
                    max_tokens: maxTokens,
                });
                if (externalSignal?.aborted) throw createMapGenerationCancelledError('request was cancelled before fallback response commit');
                return fallback;
            }
            throw error;
        }
    }

    const Service = await getConnectionManagerRequestService();
    if (!Service?.sendRequest) {
        throw new Error('ConnectionManagerRequestService를 찾지 못해 확장 전용 프로필 요청을 보낼 수 없습니다.');
    }

    const profile = findCmProfile(target);
    if (!profile) {
        pushDebugLog('request.profile.missing', '선택한 확장 전용 프로필을 찾을 수 없습니다.', {
            target,
            available: getConnectionManagerProfilesRaw().map(p => ({ id: p.id, name: p.name })),
        });
        throw new Error(`선택한 확장 전용 프로필을 찾을 수 없습니다: ${target}`);
    }

    const finalPrompt = jsonSchema ? `${prompt}${getSchemaAwareJsonInstruction(jsonSchema)}` : prompt;
    const timeoutMs = 240000;
    const controller = new AbortController();
    const forwardExternalAbort = () => controller.abort(externalSignal?.reason || createMapGenerationCancelledError('request was cancelled'));
    if (externalSignal) externalSignal.addEventListener('abort', forwardExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Connection profile request timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
        pushDebugLog('request.profile.cm.try', 'ConnectionManagerRequestService로 확장 전용 프로필 요청을 보냅니다.', {
            profileId: profile.id,
            profileName: profile.name,
            maxTokens,
            schema: Boolean(jsonSchema),
            service: 'ConnectionManagerRequestService.sendRequest',
            includePreset: true,
            includeInstruct: false,
            timeoutMs,
        });

        const messages = [{ role: 'user', content: finalPrompt }];
        const result = await Service.sendRequest(
            profile.id,
            messages,
            maxTokens,
            {
                stream: false,
                signal: controller.signal,
                extractData: true,
                includePreset: true,
                includeInstruct: false,
            },
            {}
        );
        const text = extractGeneratedText(result);
        if (!String(text || '').trim()) throw new Error('No message generated');
        if (jsonSchema && isEmptyObjectResponse(text)) throw new Error('Empty object response');
        return text;
    } catch (error) {
        if (controller.signal.aborted || externalSignal?.aborted || isMapGenerationCancelledError(error)) {
            pushDebugLog('request.profile.cm.cancelled', '확장 전용 프로필 요청을 취소했습니다.', {
                profileId: profile.id,
                profileName: profile.name,
            });
            throw createMapGenerationCancelledError('connection profile request was cancelled');
        }
        pushDebugLog('request.profile.cm.error', '확장 전용 프로필 요청 실패', {
            profileId: profile.id,
            profileName: profile.name,
            error: String(error?.message || error),
        });
        throw error;
    } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', forwardExternalAbort);
    }
}


async function withConnectionProfile(fn) {
    // Deprecated in 2.5.3. Kept only so old helper references do not crash.
    return await fn();
}


async function generateMap(force = false) {
    const memory = ensureMemory();
    const hadMapBefore = isValidMapData(memory.map);
    if (memory.map && !force) {
        pushDebugLog('map.generate.skip', '저장된 지도 메모리를 사용합니다.');
        renderMapView();
        return;
    }

    const outputMode = getOutputModeKey();
    const modeConfig = OUTPUT_MODE_CONFIGS[outputMode];
    const mapSchema = getMapSchema(outputMode);
    const job = beginMapGeneration(force ? 'refresh-all' : 'generate-map');
    if (!job) return;
    // Keep the old map in-flight only. A failed refresh must not create a stale
    // ↩️ target; commit this snapshot only when the new map succeeds.
    const rollbackSnapshot = force && hadMapBefore
        ? createPreviousMapSnapshot(memory, 'refresh-all')
        : null;
    const startChatSignature = rememberCurrentChatSignature?.() || getStableChatSignature();
    pushDebugLog('map.generate.start', force ? 'force refresh' : 'open/generate', {
        jobId: job.id,
        notebookKey: getCurrentCharacterKey(),
        connectionProfile: getSettings().connectionProfile || 'main',
        outputMode,
        maxTokens: modeConfig.mapMaxTokens,
        chatSignature: startChatSignature || '(unknown)',
    });

    try {
        await withLoader(getThemeConfig().castingText, async () => {
            const prompt = buildMapPrompt(outputMode);
            pushDebugLog('request.start', '지도 생성 요청 시작', {
                jobId: job.id,
                promptLength: prompt.length,
                recentChatLimit: 10,
                schema: true,
                outputMode,
                maxTokens: modeConfig.mapMaxTokens,
                profile: getSettings().connectionProfile || 'main',
            });
            const rawText = await generateQuietWithSelectedProfile(prompt, mapSchema, { maxTokens: modeConfig.mapMaxTokens, signal: job.controller.signal });
            assertCurrentMapGeneration(job);
            pushDebugLog('response.received', `지도 생성 응답 수신: ${String(rawText || '').length}자`, {
                jobId: job.id,
                empty: !rawText,
                length: String(rawText || '').length,
            });
            const parsed = parseJson(rawText, 'map.generate');
            if (!parsed) throw new Error('모델 응답을 지도 JSON 형식으로 읽지 못했습니다.');
            const endChatSignature = getStableChatSignature();
            if (startChatSignature && endChatSignature && startChatSignature !== endChatSignature) {
                cancelActiveMapGeneration('chat changed during generation');
                throw createMapGenerationCancelledError('chat changed during generation');
            }
            assertCurrentMapGeneration(job);
            const normalizedMap = normalizeMap(parsed, { source: 'full-generation', outputMode });
            const freshMemory = ensureMemory();
            assertCurrentMapGeneration(job);
            if (rollbackSnapshot) commitPreviousMapSnapshot(freshMemory, rollbackSnapshot);
            freshMemory.map = normalizedMap;
            freshMemory.mapRevision = createMapRevisionToken();
            freshMemory.discoveries = [];
            freshMemory.selectedLocationId = normalizedMap.currentLocationId;
            freshMemory.generatedAt = nowStamp();
            freshMemory.lastAction = 'refresh-all';
            const questCounts = normalizedMap.events.reduce((counts, event) => {
                const scope = event?.questScope;
                if (scope === 'world') counts.worldEvents += 1;
                else if (scope === 'personal') counts.personalEvents += 1;
                else counts.legacyEvents += 1;
                return counts;
            }, { worldEvents: 0, personalEvents: 0, legacyEvents: 0 });
            pushDebugLog('map.generate.normalized', '지도 데이터 정규화 성공', {
                jobId: job.id,
                locations: normalizedMap?.locations?.length || 0,
                footsteps: normalizedMap?.footsteps?.length || 0,
                events: normalizedMap?.events?.length || 0,
                ...questCounts,
                outputMode,
                maxTokens: modeConfig.mapMaxTokens,
                notebookKey: freshMemory.sharedNotebookKey,
            });
            const minimums = outputMode === 'saver'
                ? { locations: 4, worldEvents: 2 }
                : { locations: 6, worldEvents: 3 };
            const worldQuestCount = questCounts.worldEvents || (questCounts.legacyEvents ? normalizedMap.events.length : 0);
            if (normalizedMap.locations.length < minimums.locations || worldQuestCount < minimums.worldEvents) {
                pushDebugLog('map.generate.partial', '목표 개수보다 적지만 유효한 지도 결과를 저장합니다.', {
                    outputMode,
                    locations: normalizedMap.locations.length,
                    events: normalizedMap.events.length,
                    ...questCounts,
                    targetMinimums: minimums,
                });
            }
            await saveMemory(freshMemory);
            assertCurrentMapGeneration(job);
            syncExtensionPrompt();
            const rendered = refreshVisibleMapAfterBackgroundUpdate({ forceMapView: !hadMapBefore });
            if (force || !rendered) {
                toast(isBonbonTheme()
                    ? (force ? '게임판을 새로 배치했습니다.' : '게임판 준비가 끝났습니다.')
                    : (force ? '지도 새로고침이 완료되었습니다.' : '지도 출력이 완료되었습니다.'), 'success');
            }
        });
    } finally {
        finishMapGeneration(job);
    }
}

function confirmDiscoveryGeneration() {
    const ui = getDiscoveryUiConfig();
    const host = document.getElementById('mma-window') || document.body;
    if (activeDiscoveryConfirm) activeDiscoveryConfirm(false);
    document.getElementById('mma-discovery-confirm')?.remove();
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = 'mma-discovery-confirm';
        overlay.className = 'mma-discovery-confirm-overlay';
        overlay.innerHTML = `
            <section class="mma-discovery-confirm" role="dialog" aria-modal="true" aria-labelledby="mma-discovery-confirm-title">
                <h3 id="mma-discovery-confirm-title">${escapeHtml(ui.question)}</h3>
                <div class="mma-discovery-confirm-actions">
                    <button type="button" data-discovery-cancel>취소</button>
                    <button type="button" data-discovery-confirm>${escapeHtml(ui.confirm)}</button>
                </div>
            </section>`;
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            if (activeDiscoveryConfirm === finish) activeDiscoveryConfirm = null;
            resolve(value);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        };
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(false);
        });
        overlay.querySelector('[data-discovery-cancel]')?.addEventListener('click', () => finish(false));
        overlay.querySelector('[data-discovery-confirm]')?.addEventListener('click', () => finish(true));
        document.addEventListener('keydown', onKeyDown, true);
        activeDiscoveryConfirm = finish;
        host.appendChild(overlay);
        overlay.querySelector('[data-discovery-confirm]')?.focus();
    });
}

async function requestDiscoveryGeneration() {
    if (activeMapGeneration) {
        toast('이미 지도 정보를 읽는 중입니다.', 'info');
        return;
    }
    if (!isValidMapData(ensureMemory().map)) {
        toast('먼저 지도를 생성해 주세요.', 'info');
        return;
    }
    if (await confirmDiscoveryGeneration()) await generateDiscoveries();
}

async function generateDiscoveries() {
    const outputMode = getOutputModeKey();
    const modeConfig = OUTPUT_MODE_CONFIGS[outputMode];
    const schema = getDiscoverySchema(outputMode);
    const ui = getDiscoveryUiConfig();
    const job = beginMapGeneration('discoveries');
    if (!job) return;
    const startChatSignature = rememberCurrentChatSignature?.() || getStableChatSignature();
    pushDebugLog('discovery.generate.start', '주변 발견 요청을 시작했습니다.', {
        jobId: job.id,
        outputMode,
        maxTokens: modeConfig.discoveryMaxTokens,
        chatSignature: startChatSignature || '(unknown)',
    });
    try {
        await withLoader(ui.loader, async () => {
            const prompt = buildDiscoveryPrompt(outputMode);
            const rawText = await generateQuietWithSelectedProfile(prompt, schema, {
                maxTokens: modeConfig.discoveryMaxTokens,
                signal: job.controller.signal,
            });
            assertCurrentMapGeneration(job);
            const parsed = parseJson(rawText, 'discovery.generate');
            if (!parsed) throw new Error('모델 응답을 주변 발견 JSON 형식으로 읽지 못했습니다.');
            const endChatSignature = getStableChatSignature();
            if (startChatSignature && endChatSignature && startChatSignature !== endChatSignature) {
                cancelActiveMapGeneration('chat changed during discovery generation');
                throw createMapGenerationCancelledError('chat changed during discovery generation');
            }
            assertCurrentMapGeneration(job);
            const memory = ensureMemory();
            const items = normalizeDiscoveries(parsed, memory.map, memory.discoveryHistory, outputMode);
            assertCurrentMapGeneration(job);
            memory.discoveries = items;
            memory.discoveryGeneratedAt = nowStamp();
            appendDiscoveryHistory(memory, items);
            memory.lastAction = 'discoveries';
            await saveMemory(memory);
            assertCurrentMapGeneration(job);
            const expectedMinimum = outputMode === 'saver' ? 3 : 5;
            if (items.length < expectedMinimum) {
                pushDebugLog('discovery.generate.partial', '목표 개수보다 적지만 유효한 주변 발견을 표시합니다.', {
                    outputMode,
                    accepted: items.length,
                    targetMinimum: expectedMinimum,
                });
            }
            if (isMapOverlayVisible()) {
                renderCanvas();
                renderDiscoveryListPanel();
            }
            toast(isBonbonTheme()
                ? `새로운 발견 ${items.length}개를 보드에 표시했습니다.`
                : `${ui.panelTitle} ${items.length}개를 표시했습니다.`, 'success');
            pushDebugLog('discovery.generate.success', '주변 발견을 저장했습니다.', {
                outputMode,
                count: items.length,
                history: memory.discoveryHistory.length,
            });
        }, { errorTitle: `${ui.name} 실패`, renderFailurePanel: false });
    } finally {
        finishMapGeneration(job);
    }
}

async function refreshLocation(locationId) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map) return;
    const location = map.locations.find(l => l.id === locationId);
    if (!location) return;

    const job = beginMapGeneration('refresh-location', locationId);
    if (!job) return;
    // Keep the complete pre-refresh map until this location update succeeds.
    const rollbackSnapshot = createPreviousMapSnapshot(memory, 'refresh-location');
    try {
        await withLoader('이 장소만 다시 살피는 중...', async () => {
            const rawText = await generateQuietWithSelectedProfile(
                buildLocationRefreshPrompt(location),
                LOCATION_SCHEMA,
                { maxTokens: 6500, signal: job.controller.signal }
            );
            assertCurrentMapGeneration(job);
            const parsed = parseJson(rawText, 'location.refresh');
            if (!parsed?.location) {
                toast('장소 새로고침에 실패했습니다. 다시 시도하십시오.', 'warning');
                return;
            }
            const normalized = normalizeMap({
                ...map,
                locations: map.locations.map(l => l.id === locationId ? { ...parsed.location, id: location.id, name: location.name } : l),
                events: mergeLocationEvents(map.events, parsed.events || [], locationId),
                footsteps: mergeLocationFootsteps(map.footsteps, parsed.footsteps || [], locationId),
            });
            assertCurrentMapGeneration(job);
            if (rollbackSnapshot) commitPreviousMapSnapshot(memory, rollbackSnapshot);
            memory.map = normalized;
            memory.mapRevision = createMapRevisionToken();
            // Do not pull the user back to this place if they chose another
            // location or opened the notebook while this request was running.
            if (!memory.selectedLocationId) memory.selectedLocationId = locationId;
            memory.generatedAt = nowStamp();
            memory.lastAction = 'refresh-location';
            await saveMemory(memory);
            assertCurrentMapGeneration(job);
            syncExtensionPrompt();
            refreshVisibleMapAfterBackgroundUpdate({ locationId });
            toast(isBonbonTheme()
                ? `${location.name} 타일을 새로 배치했습니다.`
                : `${location.name} 장소 새로고침이 완료되었습니다.`, 'success');
        });
    } finally {
        finishMapGeneration(job);
    }
}



function isFootstepProfileCurrent(profile, footstep, map = ensureMemory().map) {
    if (!profile || !footstep || !map) return false;
    const location = (map.locations || []).find(item => item.id === footstep.locationId);
    const sourceLocationId = String(profile.sourceLocationId || '');
    const hasSourceStatus = Object.prototype.hasOwnProperty.call(profile, 'sourceStatus');
    const sourceMapGeneratedAt = String(profile.sourceMapGeneratedAt || '');
    const sourceStatus = String(profile.sourceStatus || '').replace(/\s+/g, ' ').trim();
    const liveStatus = String(footstep.status || '').replace(/\s+/g, ' ').trim();
    // Profiles saved before source provenance existed must be refreshed once.
    // Otherwise an old activity at the same place can be mistaken for a current signal.
    if (!sourceLocationId || !hasSourceStatus || !sourceMapGeneratedAt) return false;
    if (sourceMapGeneratedAt !== getMapLinkStamp(ensureMemory(), map)) return false;
    if (sourceLocationId && sourceLocationId !== String(footstep.locationId || '')) return false;
    if (sourceStatus && liveStatus && sourceStatus !== liveStatus) return false;
    if (!sourceLocationId && profile.currentLocation && location?.name) {
        const cachedLocation = normalizeDiscoveryText(profile.currentLocation);
        const liveLocation = normalizeDiscoveryText(location.name);
        if (cachedLocation && liveLocation && cachedLocation !== liveLocation
            && !cachedLocation.includes(liveLocation) && !liveLocation.includes(cachedLocation)) return false;
    }
    return true;
}

function normalizeFootstepProfile(raw, footstep) {
    const map = ensureMemory().map;
    const location = map?.locations?.find(l => l.id === footstep.locationId);
    const obj = raw && typeof raw === 'object' ? raw : {};
    const fallbackName = footstep.visibleName === false ? '???' : footstep.label;
    const resolvedName = String(obj.name || fallbackName || '???');
    const ageBasis = String(obj.ageBasis || '별도 연령 근거가 확인되지 않음');
    const ageContext = [
        map?.regionName,
        map?.timeHint,
        map?.worldSummary,
        location?.name,
        location?.situation,
        obj.characterInfo,
    ].filter(Boolean).join(' ');
    return {
        id: footstep.id,
        footstepId: footstep.id,
        name: resolvedName,
        gender: String(obj.gender || '장면에서 확인되지 않음'),
        age: normalizePersonAge(obj.age, ageBasis, { name: resolvedName, contextText: ageContext, subjectText: obj.characterInfo }),
        ageBasis,
        characterInfo: String(obj.characterInfo || obj.info || obj.description || `${fallbackName || '이 인물'}에 대한 정보가 아직 또렷하게 읽히지 않는다.`),
        currentMood: String(obj.currentMood || obj.mood || '뚜렷하게 읽히지 않음'),
        currentLocation: String(obj.currentLocation || location?.name || '알 수 없는 위치'),
        currentActivity: String(obj.currentActivity || obj.activity || footstep.status || '지도 위에서 움직임이 희미하게 보인다.'),
        relationshipWithUser: String(obj.relationshipWithUser || obj.relationship || '직접적 접점 없음'),
        lastEncounterWithUser: String(obj.lastEncounterWithUser || obj.lastEncounter || obj.lastMetUser || '직접 마주친 기록은 아직 확인되지 않는다.'),
        currentTask: String(obj.currentTask || obj.task || '현재 목적이 또렷하게 드러나지 않음'),
        thoughts: String(obj.thoughts || obj.innerThoughts || '속내는 양피지 위에서 흐릿하게 번진다.'),
        pocketContents: normalizeStringArray(obj.pocketContents || obj.pockets || obj.items || [], ['흐릿하게 번진 작은 인벤토리'], 6),
        hooks: normalizeStringArray(obj.hooks || obj.clues || [], [], 4),
        injectionText: String(obj.injectionText || ''),
        sourceLocationId: String(obj.sourceLocationId || footstep.locationId || ''),
        sourceStatus: String(obj.sourceStatus || footstep.status || ''),
        sourceMapGeneratedAt: String(obj.sourceMapGeneratedAt || getMapLinkStamp()),
        generatedAt: nowStamp(),
    };
}

function getFootstepLoaderText(footstep) {
    const label = footstep?.visibleName === false ? '???' : (footstep?.label || '타겟');
    if (isModernTheme()) return `${label} 타겟의 정보를 파악하는 중...`;
    if (isBonbonTheme()) return `${label}의 캐릭터 말을 살펴보는 중...`;
    return `${label}의 발자국을 읽는 중...`;
}

async function getOrGenerateFootstepProfile(footstepId) {
    const memory = ensureMemory();
    const map = memory.map;
    const footstep = map?.footsteps?.find(fp => fp.id === footstepId);
    if (!footstep) return null;
    if (memory.footstepProfiles?.[footstepId] && isFootstepProfileCurrent(memory.footstepProfiles[footstepId], footstep, map)) {
        const saved = memory.footstepProfiles[footstepId];
        const normalized = normalizeFootstepProfile(saved, footstep);
        normalized.generatedAt = saved.generatedAt || normalized.generatedAt;
        memory.footstepProfiles = { ...(memory.footstepProfiles || {}), [footstepId]: normalized };
        return normalized;
    }

    let profile = null;
    const startChatSignature = rememberCurrentChatSignature?.() || getStableChatSignature();
    const footstepSnapshot = {
        id: footstep.id,
        locationId: footstep.locationId,
        status: footstep.status,
    };
    await withLoader(getFootstepLoaderText(footstep), async () => {
        let rawText = '';
        rawText = await generateQuietWithSelectedProfile(buildFootstepProfilePrompt(footstep), FOOTSTEP_PROFILE_SCHEMA, { maxTokens: 5000 });
        assertChatSignatureUnchanged(startChatSignature, 'footstep.profile');
        assertMapSnapshotUnchanged(map, 'footstep.profile', footstepSnapshot);
        const parsed = parseJson(rawText, 'footstep.profile');
        if (!parsed) throw new Error('인물 상태 응답을 JSON 형식으로 읽지 못했습니다.');
        const ageChecked = await repairAgeEvidenceIfNeeded(parsed, parsed.name || footstep.label);
        assertChatSignatureUnchanged(startChatSignature, 'footstep.profile');
        assertMapSnapshotUnchanged(map, 'footstep.profile', footstepSnapshot);
        profile = normalizeFootstepProfile(ageChecked, footstep);
        memory.footstepProfiles = { ...(memory.footstepProfiles || {}), [footstepId]: profile };
        const saved = await saveMemory(memory);
        if (!saved) throw new Error('인물 상태를 저장하지 못했습니다.');
    });
    return profile;
}


function getFootstepActivationHint(footstep) {
    if (!footstep) return '';
    const label = footstep.visibleName === false ? '???' : footstep.label;
    const status = String(footstep.status || '').replace(/\s+/g, ' ').trim();
    if (!status) return '';
    const compact = status.length > 95 ? `${status.slice(0, 95).trim()}…` : status;
    return `${label || '이 발자국'}: ${compact}`;
}

async function handleFootstepClick(footstepId) {
    const memory = ensureMemory();
    const footstep = memory.map?.footsteps?.find(fp => fp.id === footstepId);
    if (!footstep) return;
    if (memory.footstepProfiles?.[footstepId] && isFootstepProfileCurrent(memory.footstepProfiles[footstepId], footstep, memory.map)) {
        const profile = await getOrGenerateFootstepProfile(footstepId);
        if (profile) renderFootstepPanel(footstepId);
        return;
    }
    const label = footstep.visibleName === false ? '???' : footstep.label;
    const hint = getFootstepActivationHint(footstep);
    const message = hint
        ? `'${label}'의 현재 상태를 확인할까요?\n\n현재 신호: ${hint}`
        : `'${label}'의 현재 상태를 확인할까요?`;
    if (!window.confirm(message)) return;
    const profile = await getOrGenerateFootstepProfile(footstepId);
    if (profile) renderFootstepPanel(footstepId);
}


function cleanProfileDisplayValue(value, replacement) {
    const text = String(value || '').trim();
    if (!text || /(불명|미상|알 수 없음|알수없음|unknown|n\/a|확인 불가|확인불가)/i.test(text)) return replacement;
    return text;
}

function renderFootstepPanel(footstepId) {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const map = memory.map;
    const footstep = map?.footsteps?.find(fp => fp.id === footstepId);
    let profile = memory.footstepProfiles?.[footstepId];
    if (!footstep || !profile) return;
    if (!profile.characterInfo || !profile.lastEncounterWithUser || !Array.isArray(profile.pocketContents)) {
        profile = normalizeFootstepProfile(profile, footstep);
        memory.footstepProfiles[footstepId] = profile;
        saveMemory();
    }
    const location = map?.locations?.find(l => l.id === footstep.locationId);
    panel.innerHTML = `
        <div class="mma-place-card mma-footstep-card">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">${isModernTheme() ? '●' : (isBonbonTheme() ? '<span class="mma-bonbon-mini-pawn" aria-hidden="true">♟</span>' : '👣')}</span><strong>${escapeHtml(profile.name)}</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <section class="mma-info-block">
                <h4>🪪 정보</h4>
                <ul>
                    <li><b>이름</b>: ${escapeHtml(profile.name)}</li>
                    <li><b>성별</b>: ${escapeHtml(cleanProfileDisplayValue(profile.gender, '장면 기준 추정 필요'))}</li>
                    <li><b>나이</b>: ${escapeHtml(cleanProfileDisplayValue(profile.age, '장면 기준 나잇대 추정 필요'))}</li>
                    <li><b>현재 위치</b>: ${escapeHtml(profile.currentLocation || location?.name || '알 수 없음')}</li>
                    <li><b>현재 기분</b>: ${escapeHtml(profile.currentMood)}</li>
                </ul>
                <p>${escapeHtml(profile.characterInfo)}</p>
            </section>
            <section class="mma-info-block">
                <h4>🤝 유저와의 관계 및 친밀도</h4>
                <p>${escapeHtml(profile.relationshipWithUser)}</p>
            </section>
            <section class="mma-info-block">
                <h4>🕰️ 가장 최근 마주친 순간</h4>
                <p>${escapeHtml(profile.lastEncounterWithUser)}</p>
            </section>
            <section class="mma-info-block">
                <h4>🎭 지금 하고 있는 행동</h4>
                <p>${escapeHtml(profile.currentActivity)}</p>
            </section>
            <section class="mma-info-block">
                <h4>💭 지금 무슨 생각을 하는지</h4>
                <p>${escapeHtml(profile.thoughts)}</p>
            </section>
            <section class="mma-info-block">
                <h4>🎒 인벤토리</h4>
                <ul>${(profile.pocketContents || []).map(item => `<li>${escapeHtml(item)}</li>`).join('') || '<li>뚜렷하게 읽히지 않음</li>'}</ul>
            </section>
            ${profile.hooks?.length ? `<section class="mma-info-block"><h4>✨ 따라갈 만한 단서</h4><ul>${profile.hooks.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul></section>` : ''}
            <footer class="mma-place-actions">
                <button data-action="track" title="이 인물의 이후 위치 변화를 수첩에서 다시 확인합니다.">👁 이후 동선 추적</button>
                <button data-action="actions">📓 반영</button>
            </footer>
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(location?.id || memory.selectedLocationId));
    panel.querySelector('[data-action="track"]')?.addEventListener('click', () => trackFootstep(footstepId));
    panel.querySelector('[data-action="actions"]')?.addEventListener('click', () => renderFootstepActionPanel(footstepId));
}


function renderFootstepActionPanel(footstepId) {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const profile = memory.footstepProfiles?.[footstepId];
    const footstep = memory.map?.footsteps?.find(fp => fp.id === footstepId);
    if (!profile || !footstep) return;
    panel.innerHTML = `
        <div class="mma-action-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">📓</span><strong>수첩 반영</strong></div>
                <button title="발자국 상태로 돌아가기" data-action="back">↩️</button>
            </header>
            <p class="mma-panel-note">선택한 인물의 현재 상태, 행동, 생각 정보가 다음 응답부터 반영된다. 보류는 롤플에 반영되지 않고 나중에 다시 선택할 수 있도록 남는다.</p>
            <article class="mma-event-card footstep-manage">
                <div class="mma-event-title"><b>👣 ${escapeHtml(profile.name)}의 현재 상태</b><span>인물</span></div>
                <div class="mma-event-location">📍 ${escapeHtml(profile.currentLocation)}</div>
                <p>${escapeHtml(profile.currentActivity)}</p>
                <p class="mma-event-detail">💭 ${escapeHtml(stripLong(profile.thoughts, 420))}</p>
                <div class="mma-event-actions">
                    ${renderActionButtons('footstep', footstepId)}
                </div>
            </article>
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderFootstepPanel(footstepId));
    panel.querySelectorAll('[data-event-action]').forEach(button => {
        button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
    });
}


function isManagedSource(sourceId) {
    const memory = ensureMemory();
    return memory.managedItems.some(item => item.sourceId === sourceId && item.status !== 'ignored');
}

function mergeLocationEvents(oldEvents, newEvents, locationId) {
    const keep = (oldEvents || []).filter(e => e.locationId !== locationId || isManagedSource(`event:${e.id}`) || e.status === 'ignored');
    const keptAtLocation = keep.some(e => e.locationId === locationId && e.status !== 'ignored');
    const fresh = keptAtLocation ? [] : (newEvents || []).slice(0, 1).map((e, i) => ({ ...e, locationId: locationId, id: e.id || `${locationId}-event-${Date.now()}-${i}`, status: e.status || 'available' }));
    return [...keep, ...fresh].slice(0, 14);
}

function mergeLocationFootsteps(oldFootsteps, newFootsteps, locationId) {
    const keep = (oldFootsteps || []).filter(fp => fp.locationId !== locationId);
    const fresh = (newFootsteps || []).map((fp, i) => ({ ...fp, locationId: fp.locationId || locationId, id: fp.id || `${locationId}-foot-${Date.now()}-${i}` }));
    return [...keep, ...fresh].slice(0, FOOTSTEP_LIMIT);
}

function unwrapWholeJsonCodeFence(text) {
    const trimmed = String(text || '').trim();
    // Only remove a Markdown code fence when it wraps the entire response.
    // Plain JSON remains on the original parsing path unchanged.
    const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

function parseJson(text, label = '') {
    const raw = String(text || '');
    if (label) pushDebugLog(`${label}.parse.start`, `JSON 파싱 시작: ${raw.length}자`);
    if (!raw.trim()) {
        if (label) pushDebugLog(`${label}.parse.fail`, '응답이 비어 있습니다.');
        return null;
    }

    const candidate = unwrapWholeJsonCodeFence(raw);
    const unwrappedFence = candidate !== raw.trim();

    try {
        const parsed = JSON.parse(candidate);
        if (label) pushDebugLog(
            `${label}.parse.success`,
            unwrappedFence ? 'JSON 코드블록을 벗긴 뒤 파싱 성공' : '원본 응답 JSON 파싱 성공'
        );
        return parsed;
    } catch (firstError) {
        const match = candidate.match(/\{[\s\S]*\}/);
        if (!match) {
            const startsAsJson = /^\s*(?:```(?:json)?[ \t]*\r?\n)?\{/.test(raw);
            if (label) pushDebugLog(
                `${label}.parse.fail`,
                startsAsJson
                    ? '완전한 JSON 객체를 찾지 못했습니다. 모델 응답이 중간에 끊겼을 수 있습니다.'
                    : 'JSON 객체 영역을 찾지 못했습니다.',
                {
                    error: serializeForDebug(firstError),
                    length: raw.length,
                    codeFence: /^\s*```(?:json)?(?:[ \t]*\r?\n|\s*$)/i.test(raw),
                    looksIncomplete: startsAsJson,
                }
            );
            return null;
        }
        try {
            const parsed = JSON.parse(match[0]);
            if (label) pushDebugLog(`${label}.parse.success`, '본문 중 JSON 객체 추출 파싱 성공');
            return parsed;
        } catch (secondError) {
            if (label) pushDebugLog(`${label}.parse.fail`, 'JSON 추출 파싱 실패', {
                firstError: serializeForDebug(firstError),
                secondError: serializeForDebug(secondError),
                length: raw.length,
                codeFence: /^\s*```(?:json)?(?:[ \t]*\r?\n|\s*$)/i.test(raw),
            });
            return null;
        }
    }
}

function fallbackMap() {
    const userName = getCurrentUserName();
    const charName = getCurrentCharacterName();
    const theme = getThemeConfig();
    return {
        mapTitle: theme.shortLabel,
        regionName: '현재 장면 주변',
        worldSummary: '모델 응답이 흐릿해 기본 지도를 임시로 펼쳤다.',
        timeHint: '현재 장면 기준',
        currentLocationId: 'current-scene',
        locations: [
            {
                id: 'current-scene',
                name: '현재 장소',
                icon: '📍',
                situation: `${userName}와 ${charName}가 있는 현재 장소가 양피지 중앙에 떠오른다. 주변의 자세한 구조는 흐릿하지만, 두 사람의 발자국은 또렷하게 서로 가까운 곳에 멈춰 있다. 근처에는 이 장면을 지켜보는 듯한 희미한 발자국 몇 개가 천천히 번진다. 아직 세계관을 완전히 읽지 못해 넓은 구역은 드러나지 않았지만, 현재 장면과 이어진 통로 하나가 지도 가장자리에서 흔들리고 있다. 전체 새로고침을 누르면 현재 롤플 맥락을 다시 읽어 더 정확한 지도를 그릴 수 있다.`,
                details: '현재 장소만 임시로 표시된 상태다.',
                present: [userName, charName, '가까운 주변 인물들'],
                clues: ['잉크가 아직 주변 지형을 완전히 그리지 못했다.'],
                eventIds: [],
                injectionText: `Use the current location as a living map observation. ${userName} and ${charName} remain at the center of the scene, while nearby footsteps and half-revealed paths suggest that the area around them may contain people or minor disturbances worth noticing. Do not mention the map UI.`,
            },
            {
                id: 'nearby-passage',
                name: '가까운 통로',
                icon: '🕯️',
                situation: '현재 장소와 이어진 통로가 희미하게 나타난다. 누군가 지나간 듯한 잉크 자국이 바닥을 따라 끊겼다가 다시 이어진다. 이 통로는 복도일 수도 있고, 골목이나 정원길, 혹은 비밀문 뒤의 좁은 길일 수도 있다. 발자국 하나는 잠깐 멈췄다가 현재 장소 반대편으로 사라진다. 이곳은 장면을 다른 방향으로 옮기기에 적당한 길목처럼 보인다.',
                details: '구체적인 세계관 정보를 더 읽으면 이 통로는 현재 설정에 맞는 실제 장소로 바뀔 수 있다.',
                present: ['지나가는 인물', '이름이 흐릿한 발자국'],
                clues: ['발자국 하나가 잠시 멈췄다가 사라진다.'],
                eventIds: ['unknown-trail'],
                injectionText: 'Use the nearby passage as a subtle roleplay hook. A partially visible trail suggests someone has recently passed through or paused there, giving the current scene a natural direction to move without forcing the user to act.',
            },
        ],
        footsteps: [
            { id: 'user-foot', label: userName, locationId: 'current-scene', status: '현재 장면에 머무름', visibleName: true },
            { id: 'char-foot', label: charName, locationId: 'current-scene', status: '현재 장면에 머무름', visibleName: true },
            { id: 'passerby-foot', label: '지나가는 인물', locationId: 'nearby-passage', status: '통로를 따라 이동 중', visibleName: true },
        ],
        events: [
            {
                id: 'unknown-trail',
                title: '멈춘 발자국',
                locationId: 'nearby-passage',
                summary: '가까운 통로에 한 발자국이 잠깐 멈춰 있었다. 누군가 기다렸거나, 안쪽을 살피고 지나간 흔적처럼 보인다.',
                details: '아직 롤플에 반영되지 않은 지도상의 관찰이다.',
                severity: '수상함',
                status: 'available',
                injectionText: 'A set of footsteps briefly stopped in the nearby passage, suggesting that someone may have waited, listened, or watched before moving on.',
            },
        ],
    };
}

async function withLoader(message, fn, options = {}) {
    let handle = null;
    pushDebugLog('loader.start', message);
    try {
        const ctx = stContext();
        if (ctx.loader?.show) {
            handle = ctx.loader.show({ message, title: getThemeConfig().loaderTitle, blocking: false, toastMode: 'static' });
        } else {
            // Never cover the map in the fallback path. Browsing the current
            // map, notebook, and existing footstep information stays available.
            toast(message, 'info');
        }
        await fn();
    } catch (error) {
        if (isMapGenerationCancelledError(error)) {
            pushDebugLog('loader.cancelled', '지도 생성 작업이 취소되어 화면을 바꾸지 않았습니다.', {
                message: String(error?.message || error || ''),
            });
            return;
        }
        console.error('[MarauderMap]', error);
        pushDebugLog('loader.error', String(error?.message || error || ''), error);
        const errorText = String(error?.message || error || '');
        let userMessage = errorText || '알 수 없는 오류';
        if (/403|Forbidden|permission|권한/i.test(errorText)) {
            userMessage = '연결 프로필 권한을 확인해 주세요.';
        } else if (/empty|비어|응답 없음/i.test(errorText)) {
            userMessage = '모델 응답이 비어 있습니다.';
        } else if (/JSON|형식|parse|파싱|읽지 못/i.test(errorText) || errorText.includes('API 연결이 불안정합니다')) {
            userMessage = options.renderFailurePanel === false
                ? '모델 응답 형식을 읽지 못했습니다.'
                : '모델 응답을 지도 형식으로 읽지 못했습니다.';
        }
        toast(`${options.errorTitle || '지도 생성 실패'}:\n${userMessage}`, 'error');
        // A failed background task must not replace an already usable map or
        // whatever panel the user chose to browse while it was running.
        let hasExistingMap = false;
        try { hasExistingMap = isValidMapData(ensureMemory().map); } catch { /* noop */ }
        if (options.renderFailurePanel !== false && isMapOverlayVisible() && !hasExistingMap) {
            renderFailurePanel('지도 생성 실패', userMessage);
        }
    } finally {
        pushDebugLog('loader.end', message);
        if (handle?.hide) await handle.hide();
        setBusy(false);
    }
}

function showBonbonToast(message, type = 'info') {
    if (!isBonbonTheme()) return false;
    const layer = document.getElementById('mma-map-toast-layer');
    if (!layer) return false;
    const safeType = ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info';
    const item = document.createElement('div');
    item.className = `mma-map-toast mma-map-toast-bonbon mma-map-toast-${safeType} ${safeType}`;
    item.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
    item.textContent = String(message || '');
    layer.appendChild(item);
    while (layer.children.length > 3) layer.children[0]?.remove();
    requestAnimationFrame(() => item.classList.add('mma-map-toast-visible'));
    const visibleMs = safeType === 'error' ? 4800 : 3000;
    setTimeout(() => {
        item.classList.remove('mma-map-toast-visible');
        setTimeout(() => item.remove(), 220);
    }, visibleMs);
    return true;
}

function toast(message, type = 'info') {
    try {
        if (showBonbonToast(message, type)) return;
        const ctx = stContext();
        if (ctx.toastr?.[type]) ctx.toastr[type](message);
        else if (globalThis.toastr?.[type]) globalThis.toastr[type](message);
        else { /* console fallback intentionally muted */ }
    } catch {
        /* console fallback intentionally muted */
    }
}

function getViewportHeight() {
    return Math.max(320, window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 720);
}

function rememberMapCanvasBaseHeight(canvas) {
    const current = Math.round(canvas.getBoundingClientRect().height || 0);
    const stored = Number(canvas.dataset.mmaResizeBaseHeight || 0);
    if (!stored && current > 0) canvas.dataset.mmaResizeBaseHeight = String(current);
    return Number(canvas.dataset.mmaResizeBaseHeight || current || 320);
}

function resetMapCanvasHeight(canvas) {
    canvas.style.removeProperty('height');
    canvas.style.removeProperty('min-height');
    canvas.style.removeProperty('max-height');
    canvas.style.removeProperty('aspect-ratio');
    delete canvas.dataset.mmaUserResized;
    document.getElementById('mma-window')?.classList.remove('mma-map-expanded');
}

function applyMapCanvasHeight(canvas, height, maxHeight = null, minHeight = null) {
    const rounded = Math.round(height);
    const base = Math.round(minHeight || rememberMapCanvasBaseHeight(canvas));
    if (rounded <= base + 1) {
        resetMapCanvasHeight(canvas);
        return;
    }

    const value = `${rounded}px`;
    canvas.style.setProperty('height', value, 'important');
    canvas.style.setProperty('min-height', value, 'important');
    canvas.style.setProperty('max-height', maxHeight ? `${Math.round(maxHeight)}px` : 'none', 'important');
    canvas.style.setProperty('aspect-ratio', 'auto', 'important');
    canvas.dataset.mmaUserResized = 'true';
    document.getElementById('mma-window')?.classList.add('mma-map-expanded');
}

function beginMapResize(event) {
    const canvas = document.getElementById('mma-map-canvas');
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = canvas.getBoundingClientRect();
    const viewportHeight = getViewportHeight();
    const minHeight = rememberMapCanvasBaseHeight(canvas);
    const viewportLimitedMax = Math.round(viewportHeight - rect.top - 18);
    const maxHeight = Math.max(minHeight + 120, viewportLimitedMax);

    mapResizeState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: rect.height,
        minHeight,
        maxHeight,
        canvas,
    };

    canvas.classList.add('mma-map-resizing');
    document.addEventListener('pointermove', moveMapResize, { passive: false });
    document.addEventListener('pointerup', endMapResize, { passive: false });
    document.addEventListener('pointercancel', endMapResize, { passive: false });
    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
    pushDebugLog('map.resize.start', '지도판 세로 크기 조절 시작', {
        minHeight,
        startHeight: Math.round(rect.height),
        maxHeight,
    });
}

function moveMapResize(event) {
    if (!mapResizeState) return;
    event.preventDefault();
    const canvas = mapResizeState.canvas || document.getElementById('mma-map-canvas');
    if (!canvas) return;
    const deltaY = event.clientY - mapResizeState.startY;
    const nextHeight = Math.round(
        Math.min(mapResizeState.maxHeight, Math.max(mapResizeState.minHeight, mapResizeState.startHeight + deltaY))
    );
    applyMapCanvasHeight(canvas, nextHeight, mapResizeState.maxHeight, mapResizeState.minHeight);
}

function endMapResize(event) {
    if (!mapResizeState) return;
    const canvas = mapResizeState.canvas || document.getElementById('mma-map-canvas');
    try { event?.currentTarget?.releasePointerCapture?.(mapResizeState.pointerId); } catch { /* noop */ }
    document.removeEventListener('pointermove', moveMapResize);
    document.removeEventListener('pointerup', endMapResize);
    document.removeEventListener('pointercancel', endMapResize);
    pushDebugLog('map.resize.end', '지도판 세로 크기 조절 종료', {
        height: Math.round(canvas?.getBoundingClientRect?.().height || 0),
        minHeight: mapResizeState.minHeight,
        maxHeight: mapResizeState.maxHeight,
    });
    canvas?.classList.remove('mma-map-resizing');
    mapResizeState = null;
}

function wireMapResizeHandle(root = document) {
    const handle = root.querySelector?.('#mma-map-resize-handle');
    if (!handle || handle.dataset.mmaResizeBound === 'true') return;
    handle.dataset.mmaResizeBound = 'true';
    handle.addEventListener('pointerdown', beginMapResize, { passive: false });
}

function createRoot() {
    if (document.getElementById(EXTENSION_ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = EXTENSION_ROOT_ID;
    root.innerHTML = `
        <div id="mma-overlay" class="mma-hidden" aria-hidden="true">
            <div id="mma-window" role="dialog" aria-label="Map / S.H.I.E.L.D. Field Locator / Bonbon Board">
                <div id="mma-busy" class="mma-hidden"><span class="mma-spinner"></span><span id="mma-busy-text">지도 확인 중...</span></div>
                <div id="mma-content"></div>
            </div>
        </div>
        <div id="mma-map-toast-layer" class="mma-map-toast-layer" aria-live="polite" aria-atomic="false"></div>
    `;
    document.body.appendChild(root);
    setupOverlayDebugObserver();
    pushDebugLog('root.created', '확장 루트를 생성했습니다.');
    applyFontScale();
    applyThemeClass();

    document.getElementById('mma-overlay')?.addEventListener('click', (event) => {
        if (event.target.id === 'mma-overlay') closeMap('overlay-click');
    });
}

function openMap() {
    try {
        setupDebugHooks();
        pushDebugLog('openMap.start', '지도를 여는 중입니다.');
        if (!isContextReady()) {
            pushDebugLog('openMap.notReady', 'SillyTavern context is not ready yet.');
            console.warn('[MarauderMap] SillyTavern context is not ready yet.');
            return;
        }
        getSettings();
        createRoot();
        applyFontScale();
        applyThemeClass();
        const overlay = document.getElementById('mma-overlay');
        overlay?.classList.remove('mma-hidden');
        overlay?.setAttribute('aria-hidden', 'false');
        const memory = ensureMemory();
        pushDebugLog('openMap.visible', '지도 오버레이를 표시했습니다.', {
            theme: getThemeKey(),
            notebookKey: memory.sharedNotebookKey || getCurrentCharacterKey(),
            hasMap: isValidMapData(memory.map),
        });
        if (isValidMapData(memory.map)) renderMapView();
        else renderSpellScreen();
    } catch (error) {
        pushDebugLog('openMap.error', '지도 열기 실패', error);
        console.error('[MarauderMap] openMap failed:', error);
    }
}

function closeMap(reason = 'manual') {
    // Closing only hides the overlay. A requested map keeps generating in the
    // background and will be saved for the user to open after it completes.
    if (activeDiscoveryConfirm) activeDiscoveryConfirm(false);
    if (mapResizeState) endMapResize();
    const overlay = document.getElementById('mma-overlay');
    const generationContinues = Boolean(activeMapGeneration);
    pushDebugLog('closeMap', `지도 오버레이를 닫습니다: ${reason}`, {
        exists: Boolean(overlay),
        wasHidden: overlay?.classList?.contains('mma-hidden') ?? null,
        generationContinues,
    });
    overlay?.classList.add('mma-hidden');
    overlay?.setAttribute('aria-hidden', 'true');
    if (generationContinues) toast('지도는 백그라운드에서 계속 생성 중입니다.', 'info');
}

function setBusy(isBusy, text = '') {
    const busy = document.getElementById('mma-busy');
    const label = document.getElementById('mma-busy-text');
    if (!busy) return;
    busy.classList.toggle('mma-hidden', !isBusy);
    if (label && text) label.textContent = text;
}

function renderSpellScreen() {
    pushDebugLog('render.spell.start', '활성화 화면을 렌더링합니다.');
    const content = document.getElementById('mma-content');
    if (!content) {
        pushDebugLog('render.spell.missingContent', 'mma-content를 찾지 못했습니다.');
        return;
    }
    const memory = ensureMemory();
    const theme = getThemeConfig();
    const discoveryUi = getDiscoveryUiConfig();
    const modern = isModernTheme();
    const bonbon = isBonbonTheme();
    applyThemeClass();
    const activationNotice = modern ? `
                <div class="mma-tracker-warning" aria-label="S.H.I.E.L.D. Field Locator notice">
                    <div class="mma-warning-title">경 고 문</div>
                    <p class="mma-warning-copy">실제 사람의 위치를 수집·이용·제공하는 행위는 관련 법령과 서비스 약관의 적용을 받을 수 있습니다. 위치 추적 서비스를 이용할 때에는 목적, 보관 기간, 제공 범위를 사전에 고지하고, 당사자의 명시적인 동의를 받아야 합니다.</p>
                    <p class="mma-warning-copy">상대방의 동의 없이 위치를 확인하거나 제3자에게 공유하는 행위는 위치정보 관련 법령, 개인정보 보호 규정, 통신 관련 규정 등에 따라 법적 책임이 발생할 수 있습니다. 실제 서비스 이용 시에는 적법한 권한과 동의를 확보한 뒤 이용하시기 바랍니다.</p>
                    <p class="mma-warning-copy">S.H.I.E.L.D. Field Locator는 이 앱을 사용함으로써 발생하는 문제에 대하여 책임지지 않습니다.</p>
                    <p class="mma-warning-copy">RP 속 인물들은 허구의 인물이기에 처벌은 받지 않습니다.</p>
                    <p class="mma-warning-question">위치 추적을 활성화하시겠습니까?</p>
                </div>` : '';
    const activateText = bonbon
        ? (memory.map ? '봉봉보드 이어하기' : '봉봉보드 시작하기')
        : theme.activateText;
    const activationButton = `
                <button id="mma-spell-button" class="mma-spell-button" type="button">
                    <span>${escapeHtml(activateText)}</span>
                </button>`;
    const bonbonCover = bonbon ? `
                <div class="mma-bonbon-box-cover" aria-label="Bonbon Board 게임 상자 표지">
                    <div class="mma-bonbon-cover-pieces" aria-hidden="true">
                        <span class="mma-bonbon-cover-piece mma-bonbon-cover-piece-die">⚄</span>
                        <span class="mma-bonbon-cover-piece mma-bonbon-cover-piece-key-card">${escapeHtml(discoveryUi.icon)}</span>
                        <span class="mma-bonbon-cover-piece mma-bonbon-cover-piece-pawn"></span>
                        <span class="mma-bonbon-cover-piece mma-bonbon-cover-piece-tile"></span>
                    </div>
                    <div class="mma-bonbon-cover-title">BONBON BOARD</div>
                    <p class="mma-bonbon-cover-copy">상자를 열면 게임이 시작됩니다.</p>
                    <p class="mma-bonbon-cover-copy">주사위를 굴려 이야기를 확장해 보세요.</p>
                    <div class="mma-bonbon-cover-meta"><span>1인 이상</span><b aria-hidden="true">·</b><span>제한 시간 없음</span><b aria-hidden="true">·</b><span>정해진 경로 없음</span></div>
                    ${activationButton}
                </div>` : '';
    const readyHint = modern
        ? (memory.map ? '저장된 지도를 다시 펼칩니다.' : '현재 장면을 읽어 새 지도를 만듭니다.')
        : bonbon
            ? ''
            : `${theme.readyHint} ${memory.map ? '저장된 지도 메모리를 다시 펼칩니다.' : '현재 장면을 읽어 새 지도를 만듭니다.'}`;
    content.innerHTML = `
        <section class="mma-spell-screen">
            <div class="mma-spell-top">
                <div class="mma-brand">${escapeHtml(theme.shortLabel)}</div>
                <div class="mma-spell-actions">
                    ${hasPreviousMapSnapshot(memory) ? '<button class="mma-managed-button mma-restore-previous-button" data-action="restore-previous-map" title="이전 지도 불러오기" aria-label="이전 지도 불러오기">↩️</button>' : ''}
                    <button class="mma-managed-button mma-close-button" data-action="close" aria-label="${bonbon ? '게임 상자 닫기' : '닫기'}" title="${bonbon ? '게임 상자 닫기' : '닫기'}">${escapeHtml(theme.closeText)}</button>
                </div>
            </div>
            <div class="mma-parchment-center ${modern ? 'mma-tracker-center' : ''} ${bonbon ? 'mma-bonbon-center' : ''}">
                ${bonbon ? '' : `<div class="mma-blank-note">${escapeHtml(theme.idleNote)}</div>`}
                ${activationNotice}
                ${bonbonCover}
                ${bonbon ? '' : activationButton}
                ${readyHint ? `<p class="mma-spell-hint">${escapeHtml(readyHint)}</p>` : ''}
            </div>
        </section>
    `;
    content.querySelector('[data-action="close"]')?.addEventListener('click', () => closeMap('close-button'));
    content.querySelector('[data-action="restore-previous-map"]')?.addEventListener('click', () => restorePreviousMap());
    wireSpellButton();
    refreshMapGenerationControls();
    pushDebugLog('render.spell.success', '활성화 화면 렌더링 완료');
}

function wireSpellButton() {
    const button = document.getElementById('mma-spell-button');
    if (!button) return;
    if (activeMapGeneration) {
        button.disabled = true;
        button.classList.add('mma-casting');
        const pendingLabel = button.querySelector('span');
        if (pendingLabel) pendingLabel.textContent = getThemeConfig().castingText;
    }

    const activate = async (event) => {
        event?.preventDefault?.();
        if (spellCasting || button.disabled) return;
        spellCasting = true;
        button.disabled = true;
        button.classList.add('mma-casting');
        const label = button.querySelector('span');
        const theme = getThemeConfig();
        // Marauder's Map keeps its spell visible while the separate loader carries
        // the progress wording. The subtle ink-soak animation is enough feedback.
        if (label && !isMarauderTheme()) label.textContent = theme.castingText;
        try {
            const memory = ensureMemory();
            if (memory.map) renderMapView();
            else await generateMap(false);
            if (isValidMapData(ensureMemory().map) && isMapOverlayVisible()) toast(getMapActivationCompleteText(), 'success');
        } finally {
            spellCasting = false;
            const current = document.getElementById('mma-spell-button');
            if (current) {
                current.disabled = false;
                current.classList.remove('mma-casting');
                const currentLabel = current.querySelector('span');
                if (currentLabel) {
                    currentLabel.textContent = isBonbonTheme() && ensureMemory().map
                        ? '봉봉보드 이어하기'
                        : getThemeConfig().activateText;
                }
            }
        }
    };

    button.addEventListener('click', activate);
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
}

function stopHoldVisual() {
    document.getElementById('mma-spell-button')?.classList.remove('mma-holding');
}

function renderMapView() {
    pushDebugLog('render.map.start', '지도 화면을 렌더링합니다.');
    const content = document.getElementById('mma-content');
    if (!content) {
        pushDebugLog('render.map.missingContent', 'mma-content를 찾지 못했습니다.');
        return;
    }
    const memory = ensureMemory();
    const map = memory.map;
    const theme = getThemeConfig();
    applyThemeClass();
    if (!map) {
        pushDebugLog('render.map.noMap', '렌더링할 지도 데이터가 없습니다.');
        toast('지도 생성 실패:\n지도 데이터를 읽지 못했습니다.', 'error');
        renderFailurePanel('지도 생성 실패', '지도 데이터를 읽지 못했습니다.');
        return;
    }
    if (!memory.selectedLocationId || !map.locations.some(l => l.id === memory.selectedLocationId)) {
        memory.selectedLocationId = map.currentLocationId || map.locations[0]?.id || null;
    }
    const lastChecked = isModernTheme() && memory.generatedAt
        ? `<small class="mma-last-checked" title="${escapeHtml(memory.generatedAt)}">마지막 확인 ${escapeHtml(formatCompactMapTime(memory.generatedAt))}</small>`
        : '';

    content.innerHTML = `
        <section class="mma-map-screen">
            <header class="mma-toolbar">
                <div>
                    <div class="mma-brand small">${escapeHtml(theme.shortLabel)}${isBonbonTheme() ? '<span class="mma-bonbon-title-die" aria-hidden="true">🎲</span>' : ''}</div>
                    <div class="mma-region">${escapeHtml(map.regionName)} <span>${escapeHtml(map.timeHint || '')}</span>${lastChecked}</div>
                </div>
                <div class="mma-top-right">
                    <button class="mma-managed-button mma-close-button" data-action="close" aria-label="${isBonbonTheme() ? '게임 상자 닫기' : '닫기'}" title="${isBonbonTheme() ? '게임 상자 닫기' : '닫기'}">${escapeHtml(theme.closeText)}</button>
                    <nav class="mma-toolbar-actions" aria-label="지도 버튼">
                        <button title="현재 상황으로 전체 지도 새로고침" data-action="refresh-all">🔄</button>
                        <button title="이전 지도 불러오기" data-action="restore-previous-map" ${hasPreviousMapSnapshot(memory) ? '' : 'disabled'}>↩️</button>
                        <button title="검색" data-action="recommend">🔎</button>
                        <button title="수첩" data-action="notebook">📓</button>
                        <button title="지도 메모리 보기" data-action="memory">🧠</button>
                    </nav>
                </div>
            </header>
            <div class="mma-world-summary">${escapeHtml(map.worldSummary)}</div>
            <main class="mma-map-layout">
                <div class="mma-map-canvas" id="mma-map-canvas"><button id="mma-map-resize-handle" type="button" aria-label="지도판 세로 크기 조절" title="위아래로 드래그해 지도판 크기를 조절합니다."></button></div>
                <aside class="mma-side-panel" id="mma-side-panel"></aside>
            </main>
        </section>
    `;
    content.querySelector('[data-action="close"]')?.addEventListener('click', () => closeMap('close-button'));
    content.querySelector('[data-action="refresh-all"]')?.addEventListener('click', () => generateMap(true));
    content.querySelector('[data-action="restore-previous-map"]')?.addEventListener('click', () => restorePreviousMap());
    content.querySelector('[data-action="recommend"]')?.addEventListener('click', () => renderRecommendationPanel());
    content.querySelector('[data-action="notebook"]')?.addEventListener('click', renderNotebookPanel);
    content.querySelector('[data-action="memory"]')?.addEventListener('click', renderMemoryPanel);
    renderCanvas();
    selectLocation(memory.selectedLocationId);
    refreshMapGenerationControls();
    pushDebugLog('render.map.success', '지도 화면 렌더링 완료', {
        locations: map.locations?.length || 0,
        footsteps: map.footsteps?.length || 0,
        events: map.events?.length || 0,
        notebookKey: memory.sharedNotebookKey,
    });
}

function renderCanvas() {
    const canvas = document.getElementById('mma-map-canvas');
    if (!canvas) return;
    const memory = ensureMemory();
    const map = memory.map;
    const locations = map?.locations || [];
    const bonbonTrackMarkup = isBonbonTheme() ? `
        <div class="mma-bonbon-board-track" aria-hidden="true">
            <span class="mma-bonbon-board-rail mma-bonbon-board-rail-top"></span>
            <span class="mma-bonbon-board-rail mma-bonbon-board-rail-right"></span>
            <span class="mma-bonbon-board-rail mma-bonbon-board-rail-bottom"></span>
            <span class="mma-bonbon-board-rail mma-bonbon-board-rail-left"></span>
            <span class="mma-bonbon-board-corner mma-bonbon-board-corner-top-left"></span>
            <span class="mma-bonbon-board-corner mma-bonbon-board-corner-top-right"></span>
            <span class="mma-bonbon-board-corner mma-bonbon-board-corner-bottom-right"></span>
            <span class="mma-bonbon-board-corner mma-bonbon-board-corner-bottom-left"></span>
            <span class="mma-bonbon-board-mark"><b>BONBON</b><small>BOARD</small></span>
        </div>` : '';
    canvas.innerHTML = `${bonbonTrackMarkup}<button id="mma-map-resize-handle" type="button" aria-label="지도판 세로 크기 조절" title="위아래로 드래그해 지도판 크기를 조절합니다."></button>`;
    wireMapResizeHandle(canvas);
    requestAnimationFrame(() => rememberMapCanvasBaseHeight(canvas));

    const discoveryUi = getDiscoveryUiConfig();
    const discoverButton = document.createElement('button');
    discoverButton.type = 'button';
    discoverButton.className = `mma-map-discovery-trigger${isBonbonTheme() ? ' mma-board-key-card-trigger' : ''}`;
    discoverButton.dataset.action = 'discover';
    discoverButton.title = discoveryUi.name;
    discoverButton.setAttribute('aria-label', discoveryUi.name);
    discoverButton.disabled = Boolean(activeMapGeneration);
    discoverButton.innerHTML = `<span aria-hidden="true">${escapeHtml(discoveryUi.icon)}</span>`;
    discoverButton.addEventListener('click', event => {
        event.stopPropagation();
        requestDiscoveryGeneration();
    });
    canvas.appendChild(discoverButton);

    const positions = isBonbonTheme()
        ? getBonbonBoardPositions(locations.length)
        : getNodePositions(locations.length);
    locations.forEach((loc, index) => {
        const pos = positions[index] || { x: 50, y: 50 };
        const node = document.createElement('button');
        const selectedClass = loc.id === memory.selectedLocationId ? 'selected' : '';
        const currentClass = loc.id === map.currentLocationId ? 'current-location' : '';
        const bonbonClass = isBonbonTheme() ? 'mma-bonbon-location-card' : '';
        node.type = 'button';
        node.className = `mma-node ${bonbonClass} ${selectedClass} ${currentClass}`.trim();
        node.style.left = `${pos.x}%`;
        node.style.top = `${pos.y}%`;
        node.dataset.id = loc.id;
        const locationQuestCount = (map.events || []).filter(event => event.locationId === loc.id && event.status !== 'ignored').length;
        const locationLabel = [
            loc.name,
            currentClass ? '현재 위치' : '',
            locationQuestCount ? `퀘스트 ${locationQuestCount}개` : '',
        ].filter(Boolean).join(' — ');
        node.title = locationLabel;
        node.setAttribute('aria-label', locationLabel);
        if (currentClass) {
            node.setAttribute('aria-current', 'location');
        }
        node.innerHTML = `<b aria-hidden="true">${escapeHtml(loc.icon || '📍')}</b><span class="mma-node-label">${escapeHtml(loc.name)}</span>${eventBadgeForLocation(loc.id)}`;
        node.addEventListener('click', () => selectLocation(loc.id));
        canvas.appendChild(node);
    });

    const occupiedPoints = locations.map((loc, index) => {
        const pos = positions[index] || { x: 50, y: 50 };
        return { x: pos.x, y: pos.y, r: 13 };
    });
    occupiedPoints.push({ x: 95, y: 7, r: 10.5 });
    occupiedPoints.push({ x: 96, y: 94, r: 9 });
    const footstepCountByLocation = {};

    (map?.footsteps || []).forEach((fp, index) => {
        const locIndex = locations.findIndex(l => l.id === fp.locationId);
        if (locIndex < 0) return;
        const pos = positions[locIndex] || { x: 50, y: 50 };
        const localIndex = footstepCountByLocation[fp.locationId] || 0;
        footstepCountByLocation[fp.locationId] = localIndex + 1;
        const footPos = isBonbonTheme()
            ? getBonbonBoardPiecePosition(pos, localIndex, index, occupiedPoints, 'person')
            : getFootstepPosition(pos, localIndex, index, occupiedPoints);
        occupiedPoints.push({ x: footPos.x, y: footPos.y, r: isBonbonTheme() ? 15 : 8 });
        const foot = document.createElement('button');
        foot.type = 'button';
        foot.className = `mma-footstep ${isModernTheme() ? 'mma-modern-tracker' : (isBonbonTheme() ? `mma-bonbon-piece mma-bonbon-piece-${index % 4}` : '')}`.trim();
        foot.style.left = `${footPos.x}%`;
        foot.style.top = `${footPos.y}%`;
        if (isBonbonTheme()) {
            foot.style.setProperty('--mma-bonbon-sway-delay', `${-((index % 5) * 0.37)}s`);
        }
        foot.title = `${fp.visibleName ? fp.label : '???'} — ${fp.status || ''}`;
        foot.dataset.footstepId = fp.id;
        foot.innerHTML = isModernTheme()
            ? `<span class="mma-tracker-dot" aria-hidden="true"></span><em>${escapeHtml(fp.visibleName ? fp.label : '???')}</em>`
            : isBonbonTheme()
                ? `<span class="mma-bonbon-pawn" aria-hidden="true">♟</span><em>${escapeHtml(fp.visibleName ? fp.label : '???')}</em>`
                : `<span>👣</span><em>${escapeHtml(fp.visibleName ? fp.label : '???')}</em>`;
        foot.addEventListener('click', (event) => {
            event.stopPropagation();
            handleFootstepClick(fp.id);
        });
        canvas.appendChild(foot);
    });

    const discoveryCountByLocation = {};
    (memory.discoveries || []).forEach((item, index) => {
        const locIndex = locations.findIndex(location => location.id === item.locationId);
        if (locIndex < 0) return;
        const anchor = positions[locIndex] || { x: 50, y: 50 };
        const localIndex = discoveryCountByLocation[item.locationId] || 0;
        discoveryCountByLocation[item.locationId] = localIndex + 1;
        const markerPos = isBonbonTheme()
            ? getBonbonBoardPiecePosition(anchor, localIndex, index + 19, occupiedPoints, 'discovery')
            : getFootstepPosition(anchor, localIndex + 5, index + 19, occupiedPoints);
        occupiedPoints.push({ x: markerPos.x, y: markerPos.y, r: isBonbonTheme() ? 10 : 8 });
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'mma-discovery-marker';
        marker.style.left = `${markerPos.x}%`;
        marker.style.top = `${markerPos.y}%`;
        marker.style.setProperty('--mma-discovery-delay', `${-((index % 7) * 0.43)}s`);
        marker.dataset.discoveryId = item.id;
        marker.title = item.title;
        marker.setAttribute('aria-label', `${item.title} — ${item.locationName}`);
        marker.innerHTML = `<span aria-hidden="true">${escapeHtml(String(item.emoji || '').trim() || getDiscoveryCategoryIcon(item.category))}</span>`;
        marker.addEventListener('click', event => {
            event.stopPropagation();
            renderDiscoveryPanel(item.id);
        });
        canvas.appendChild(marker);
    });
}

function renderDiscoveryListPanel() {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const ui = getDiscoveryUiConfig();
    const items = memory.discoveries || [];
    panel.innerHTML = `
        <div class="mma-place-card mma-discovery-list-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">${escapeHtml(ui.icon)}</span><strong>${escapeHtml(ui.panelTitle)}</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <p class="mma-panel-note">${items.length ? `${items.length}개의 발견이 현재 지도에 표시됩니다.` : '현재 표시할 발견이 없습니다.'}</p>
            <div class="mma-discovery-list">
                ${items.map(item => {
                    const emoji = String(item.emoji || '').trim() || getDiscoveryCategoryIcon(item.category);
                    const observation = item.observation || item.body || item.summary || '';
                    return `
                    <button type="button" class="mma-discovery-list-card" data-discovery-open="${escapeHtml(item.id)}">
                        <span class="mma-discovery-card-icon">${escapeHtml(emoji)}</span>
                        <span><b>${escapeHtml(item.title)}</b><small>📍 ${escapeHtml(item.locationName)}</small><em>${escapeHtml(stripLong(observation, 150))}</em></span>
                    </button>`;
                }).join('') || '<p class="mma-empty">표시할 발견이 없습니다.</p>'}
            </div>
        </div>`;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(memory.selectedLocationId));
    panel.querySelectorAll('[data-discovery-open]').forEach(button => {
        button.addEventListener('click', () => renderDiscoveryPanel(button.dataset.discoveryOpen));
    });
}

function renderDiscoveryPanel(discoveryId) {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const item = (memory.discoveries || []).find(entry => entry.id === discoveryId);
    if (!item) {
        renderDiscoveryListPanel();
        return;
    }
    const ui = getDiscoveryUiConfig();
    const emoji = String(item.emoji || '').trim() || getDiscoveryCategoryIcon(item.category);
    const focus = item.focus || item.title;
    const focusContext = item.focusContext || '';
    const observation = item.observation || item.body || item.summary || '';
    const stakes = item.stakes || '';
    const interactions = uniqueStrings(item.interactions || [], 3);
    panel.innerHTML = `
        <div class="mma-place-card mma-discovery-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">${escapeHtml(emoji)}</span><strong>${escapeHtml(item.title)}</strong></div>
                <button title="${escapeHtml(ui.panelTitle)} 목록으로 돌아가기" data-action="back">↩️</button>
            </header>
            <div class="mma-event-location">📍 ${escapeHtml(item.locationName)}</div>
            <section class="mma-info-block mma-discovery-body">
                <h4>🔎 지금 발견한 것</h4>
                <p><b>${escapeHtml(focus)}</b>${focusContext ? ` — ${escapeHtml(focusContext)}` : ''}</p>
                <p>${escapeHtml(observation)}</p>
            </section>
            ${stakes ? `<section class="mma-info-block"><h4>⏳ 이대로 두면</h4><p>${escapeHtml(stakes)}</p></section>` : ''}
            ${interactions.length ? `<section class="mma-info-block"><h4>↗️ 해볼 수 있는 일</h4><ul>${interactions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}</ul></section>` : ''}
            ${item.participants?.length ? `<section class="mma-info-block"><h4>👥 관련 인물</h4><ul>${item.participants.map(person => `<li>${escapeHtml(person)}</li>`).join('')}</ul></section>` : ''}
            <footer class="mma-place-actions mma-discovery-actions">
                <div class="mma-event-actions">${renderActionButtons('discovery', item.id)}</div>
                <button type="button" class="mma-discovery-dismiss" data-discovery-dismiss="${escapeHtml(item.id)}">현재 지도에서 숨기기</button>
            </footer>
        </div>`;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', renderDiscoveryListPanel);
    panel.querySelectorAll('[data-event-action]').forEach(button => {
        button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
    });
    panel.querySelector('[data-discovery-dismiss]')?.addEventListener('click', () => dismissDiscovery(discoveryId));
}

async function dismissDiscovery(discoveryId) {
    const memory = ensureMemory();
    const item = (memory.discoveries || []).find(entry => entry.id === discoveryId);
    if (!item) return;
    updateDiscoveryHistoryOutcome(memory, item, 'excluded');
    memory.discoveries = memory.discoveries.filter(entry => entry.id !== discoveryId);
    await saveMemory(memory);
    renderCanvas();
    renderDiscoveryListPanel();
}

function eventBadgeForLocation(locationId) {
    const map = ensureMemory().map;
    const count = (map?.events || []).filter(e => e.locationId === locationId && e.status !== 'ignored').length;
    return count ? `<i class="mma-event-badge">${count}</i>` : '';
}

function getNodePositions(count) {
    const presets = {
        1: [{ x: 50, y: 48 }],
        2: [{ x: 36, y: 45 }, { x: 64, y: 52 }],
        3: [{ x: 50, y: 24 }, { x: 30, y: 62 }, { x: 70, y: 62 }],
        4: [{ x: 28, y: 28 }, { x: 68, y: 28 }, { x: 34, y: 68 }, { x: 72, y: 64 }],
        5: [{ x: 50, y: 18 }, { x: 24, y: 40 }, { x: 76, y: 42 }, { x: 34, y: 76 }, { x: 66, y: 74 }],
        6: [{ x: 50, y: 14 }, { x: 23, y: 32 }, { x: 76, y: 34 }, { x: 24, y: 68 }, { x: 76, y: 70 }, { x: 50, y: 84 }],
        7: [{ x: 50, y: 12 }, { x: 22, y: 28 }, { x: 78, y: 30 }, { x: 22, y: 58 }, { x: 78, y: 60 }, { x: 38, y: 84 }, { x: 64, y: 82 }],
        8: [{ x: 48, y: 11 }, { x: 21, y: 25 }, { x: 77, y: 25 }, { x: 18, y: 52 }, { x: 82, y: 52 }, { x: 28, y: 78 }, { x: 68, y: 80 }, { x: 50, y: 52 }],
        9: [{ x: 50, y: 10 }, { x: 22, y: 24 }, { x: 78, y: 24 }, { x: 16, y: 50 }, { x: 84, y: 50 }, { x: 24, y: 76 }, { x: 76, y: 76 }, { x: 50, y: 88 }, { x: 50, y: 50 }],
        10: [{ x: 50, y: 9 }, { x: 22, y: 22 }, { x: 78, y: 22 }, { x: 15, y: 47 }, { x: 85, y: 47 }, { x: 20, y: 72 }, { x: 80, y: 72 }, { x: 42, y: 86 }, { x: 62, y: 86 }, { x: 50, y: 50 }],
        11: [{ x: 50, y: 8 }, { x: 20, y: 20 }, { x: 80, y: 20 }, { x: 14, y: 42 }, { x: 86, y: 42 }, { x: 18, y: 68 }, { x: 82, y: 68 }, { x: 36, y: 86 }, { x: 64, y: 86 }, { x: 50, y: 50 }, { x: 50, y: 72 }],
        12: [{ x: 50, y: 8 }, { x: 20, y: 18 }, { x: 80, y: 18 }, { x: 13, y: 39 }, { x: 87, y: 39 }, { x: 15, y: 64 }, { x: 85, y: 64 }, { x: 32, y: 84 }, { x: 68, y: 84 }, { x: 50, y: 50 }, { x: 36, y: 58 }, { x: 64, y: 58 }],
    };
    return presets[count] || presets[12];
}

function getBonbonBoardPositions(count) {
    const nodeCount = Math.max(0, Math.floor(Number(count) || 0));
    if (!nodeCount) return [];

    const bounds = { left: 18, right: 82, top: 18, bottom: 78 };
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const sideCounts = { top: Math.floor(nodeCount / 4), right: Math.floor(nodeCount / 4), bottom: Math.floor(nodeCount / 4), left: Math.floor(nodeCount / 4) };
    const remainderOrder = ['top', 'bottom', 'right', 'left'];
    for (let index = 0; index < nodeCount % 4; index++) {
        sideCounts[remainderOrder[index]] += 1;
    }

    const positions = [];
    for (let index = 0; index < sideCounts.top; index++) {
        positions.push({ x: bounds.left + (width * ((index + 1) / (sideCounts.top + 1))), y: bounds.top });
    }
    for (let index = 0; index < sideCounts.right; index++) {
        positions.push({ x: bounds.right, y: bounds.top + (height * ((index + 1) / (sideCounts.right + 1))) });
    }
    for (let index = 0; index < sideCounts.bottom; index++) {
        positions.push({ x: bounds.right - (width * ((index + 1) / (sideCounts.bottom + 1))), y: bounds.bottom });
    }
    for (let index = 0; index < sideCounts.left; index++) {
        positions.push({ x: bounds.left, y: bounds.bottom - (height * ((index + 1) / (sideCounts.left + 1))) });
    }
    return positions;
}

function getBonbonBoardPiecePosition(anchor, localIndex, globalIndex, occupiedPoints, kind = 'person') {
    const bounds = { left: 18, right: 82, top: 18, bottom: 78 };
    const sideDistances = [
        { side: 'top', distance: Math.abs(anchor.y - bounds.top) },
        { side: 'right', distance: Math.abs(anchor.x - bounds.right) },
        { side: 'bottom', distance: Math.abs(anchor.y - bounds.bottom) },
        { side: 'left', distance: Math.abs(anchor.x - bounds.left) },
    ];
    const side = sideDistances.sort((a, b) => a.distance - b.distance)[0]?.side || 'top';
    const vectors = {
        top: { inwardX: 0, inwardY: 1, tangentX: 1, tangentY: 0 },
        right: { inwardX: -1, inwardY: 0, tangentX: 0, tangentY: 1 },
        bottom: { inwardX: 0, inwardY: -1, tangentX: -1, tangentY: 0 },
        left: { inwardX: 1, inwardY: 0, tangentX: 0, tangentY: -1 },
    };
    const vector = vectors[side];
    const slotOrder = [0, -1, 1, -2, 2, -3, 3];
    const discovery = kind === 'discovery';
    const direction = discovery ? -1 : 1;
    const baseDistance = discovery ? 14 : 15 + ((Math.abs(globalIndex) % 2) * 5);
    const laneStep = discovery ? 6 : 7;
    const tangentStep = discovery ? 11 : 14;
    const collisionDistance = discovery ? 9 : 15;

    for (let attempt = 0; attempt < 28; attempt++) {
        const placementIndex = Math.max(0, localIndex) + attempt;
        const lane = Math.floor(placementIndex / slotOrder.length);
        const tangentSlot = slotOrder[placementIndex % slotOrder.length];
        const inwardDistance = baseDistance + (lane * laneStep);
        const tangentOffset = tangentSlot * tangentStep;
        const x = clampPositionValue(
            anchor.x + (vector.inwardX * inwardDistance * direction) + (vector.tangentX * tangentOffset),
            discovery ? 6 : 8,
            discovery ? 94 : 92,
        );
        const y = clampPositionValue(
            anchor.y + (vector.inwardY * inwardDistance * direction) + (vector.tangentY * tangentOffset),
            discovery ? 8 : 10,
            discovery ? 92 : 90,
        );
        if (!hasFootstepCollision(x, y, occupiedPoints, collisionDistance)) return { x, y };
    }

    return getFootstepPosition(anchor, localIndex, globalIndex, occupiedPoints);
}


function clampPositionValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hasFootstepCollision(x, y, occupiedPoints, minDistance = 10.5) {
    return occupiedPoints.some(point => {
        const required = Math.max(minDistance, point.r || 0);
        const dx = x - point.x;
        const dy = y - point.y;
        return Math.sqrt((dx * dx) + (dy * dy)) < required;
    });
}

function getFootstepPosition(anchor, localIndex, globalIndex, occupiedPoints) {
    const angleSeeds = [225, 315, 150, 30, 265, 95, 195, 345, 120, 60, 285, 15];
    const centerCandidates = [
        { x: 50, y: 50 },
        { x: 42, y: 55 },
        { x: 58, y: 55 },
        { x: 50, y: 64 },
        { x: 36, y: 46 },
        { x: 64, y: 46 },
    ];

    for (let attempt = 0; attempt < 22; attempt++) {
        const ring = Math.floor((localIndex + attempt) / angleSeeds.length);
        const radius = 9 + (ring * 4) + ((globalIndex % 3) * 1.2);
        const angle = (angleSeeds[(localIndex + attempt) % angleSeeds.length] + ((globalIndex * 11) % 29)) * (Math.PI / 180);
        const x = clampPositionValue(anchor.x + (Math.cos(angle) * radius), 8, 92);
        const y = clampPositionValue(anchor.y + (Math.sin(angle) * radius), 10, 90);
        if (!hasFootstepCollision(x, y, occupiedPoints, 10.5)) return { x, y };
    }

    for (const candidate of centerCandidates) {
        if (!hasFootstepCollision(candidate.x, candidate.y, occupiedPoints, 10.5)) return candidate;
    }

    for (let y = 13; y <= 88; y += 7.5) {
        for (let x = 10; x <= 90; x += 7.5) {
            if (!hasFootstepCollision(x, y, occupiedPoints, 9)) return { x, y };
        }
    }

    return {
        x: clampPositionValue(anchor.x + (((globalIndex % 5) - 2) * 3), 8, 92),
        y: clampPositionValue(anchor.y + 12 + (((globalIndex % 4) - 1.5) * 3), 10, 90),
    };
}

function selectLocation(locationId) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map) return;
    const location = map.locations.find(l => l.id === locationId) || (!locationId ? map.locations[0] : null);
    if (!location) {
        toast('현재 지도에서 해당 위치를 찾을 수 없습니다.', 'info');
        return;
    }
    memory.selectedLocationId = location.id;
    saveMemory();
    document.querySelectorAll('.mma-node').forEach(node => node.classList.toggle('selected', node.dataset.id === location.id));
    renderLocationPanel(location.id);
}


function stripEventLinesFromLocationPalette(text) {
    return String(text || '')
        .split(/\n+/)
        .filter(line => !/^\s*(?:✨\s*)?(?:지도\s*)?사건\s*\d*\s*[—:-]/.test(line.trim()))
        .join('\n')
        .trim();
}

function splitKoreanSentences(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .match(/[^.!?。！？]+[.!?。！？]?/g) || [];
}

function isEventLikePaletteSentence(sentence, relatedEvents = []) {
    const s = String(sentence || '').trim();
    if (!s) return true;

    // Keep the place card rich. Only remove explicit event-heading lines that
    // belong in the dedicated ✨ section below; tension, rumors, clues, and
    // choices are exactly the flavor the 🎨 palette is meant to retain.
    if (/^(?:✨\s*)?(?:(?:지도\s*)?사건|map\s*event|event)\s*\d*\s*[—:-]/i.test(s)) return true;

    return (relatedEvents || []).some(event => {
        const title = String(event.title || '').trim();
        return title && new RegExp(`^(?:✨\\s*)?${escapeRegExp(title)}\\s*[—:-]`, 'i').test(s);
    });
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paletteComparisonKey(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/[“”"'‘’.,!?。！？…]/g, '')
        .trim()
        .toLowerCase();
}

function buildDisplaySituation(location, relatedEvents = []) {
    // situation is the primary scene card; details is the model's second local
    // beat. Show both when they are genuinely different so the palette keeps
    // its atmosphere, current action, and narrative aftertaste together.
    const situation = stripEventLinesFromLocationPalette(location?.situation);
    const palette = splitKoreanSentences(situation)
        .filter(sentence => !isEventLikePaletteSentence(sentence, relatedEvents))
        .join(' ')
        .trim();

    const rawDetails = stripEventLinesFromLocationPalette(location?.details);
    const companion = splitKoreanSentences(rawDetails)
        .filter(sentence => !isEventLikePaletteSentence(sentence, relatedEvents))
        .join(' ')
        .trim();

    const paletteKey = paletteComparisonKey(palette);
    const companionKey = paletteComparisonKey(companion);
    const hasDistinctCompanion = companionKey
        && companionKey !== paletteKey
        && !paletteKey.includes(companionKey)
        && !companionKey.includes(paletteKey);

    if (palette && hasDistinctCompanion) return `${palette}\n\n${companion}`;
    return palette || companion || '양피지가 아직 이 장소의 분위기를 충분히 그려내지 못하고 있다. 이 장소만 새로고침하면 현재 상황을 다시 읽을 수 있다.';
}

function isGenericEventTitle(title) {
    return /^\s*지도\s*사건\s*\d+\s*$/u.test(String(title || ''));
}

function getEventDisplayTitle(event, location = null) {
    const rawTitle = String(event?.title || '').trim();
    if (rawTitle && !isGenericEventTitle(rawTitle)) return rawTitle;
    const locationName = String(location?.name || event?.locationName || '').trim();
    return locationName || '현재 위치';
}

function getEventDisplayLocationName(event, location = null) {
    return String(location?.name || event?.locationName || '').trim() || '알 수 없는 위치';
}

function getEventRewardText(event) {
    return String(event?.reward || event?.possibleReward || event?.outcome || '보상 정보 없음').trim();
}

function renderQuestReward(event) {
    return `<p class="mma-event-detail mma-quest-reward"><b>🎁 예상 보상</b>: ${escapeHtml(getEventRewardText(event))}</p>`;
}

function renderLocationEventSummaryCard(event, location = null) {
    return `
        <article class="mma-event-card ${escapeHtml(event.status || 'available')}">
            <div class="mma-event-title"><b>${escapeHtml(getEventDisplayTitle(event, location))}</b><span>${statusLabel(event.status)}</span></div>
            <p>${escapeHtml(event.summary || '')}</p>
            ${event.details ? `<p class="mma-event-detail">${escapeHtml(event.details)}</p>` : ''}
            ${renderQuestReward(event)}
        </article>
    `;
}

function renderLocationPanel(locationId) {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const map = memory.map;
    const location = map?.locations.find(l => l.id === locationId);
    if (!location) return;
    const relatedEvents = (map.events || []).filter(e => e.locationId === location.id && e.status !== 'ignored');

    panel.innerHTML = `
        <div class="mma-place-card">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">${escapeHtml(location.icon || '📍')}</span><strong>${escapeHtml(location.name)}</strong></div>
                <button title="이 장소만 다시 새로고침" data-action="refresh-location">🔄</button>
            </header>
            <section class="mma-info-block">
                <h4>${escapeHtml(getThemeConfig().locationInfoIcon || '🎨')}</h4>
                <p>${escapeHtml(buildDisplaySituation(location, relatedEvents))}</p>
            </section>
            <section class="mma-info-block">
                <h4>👥</h4>
                <ul>${location.present.map(p => `<li>${escapeHtml(p)}</li>`).join('') || '<li>인물이 뚜렷하게 보이지 않음</li>'}</ul>
            </section>
            ${relatedEvents.length ? `
            <section class="mma-info-block">
                <h4>✨ 퀘스트</h4>
                <div class="mma-location-events">${relatedEvents.map(event => renderLocationEventSummaryCard(event, location)).join('')}</div>
            </section>` : ''}
            <footer class="mma-place-actions">
                <button data-action="actions">📓 반영</button>
            </footer>
        </div>
    `;
    panel.querySelector('[data-action="refresh-location"]')?.addEventListener('click', () => refreshLocation(location.id));
    panel.querySelector('[data-action="actions"]')?.addEventListener('click', () => renderActionPanel(location.id, false));
    refreshMapGenerationControls();
}

function statusLabel(status) {
    return {
        available: '진행 가능',
        observed: '수집',
        held: '수집',
        ignored: '제외',
        injected: '매번 반영',
        char_notice: '캐릭터 인지',
        user_notice: '유저 인지',
    }[status] || status;
}

function renderActionPanel(locationFilterId = null, globalView = false) {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const map = memory.map;

    if (globalView) {
        const active = getManagedPanelItems();
        panel.innerHTML = `
            <div class="mma-action-panel">
                <header class="mma-place-header">
                    <div><span class="mma-place-icon">📓</span><strong>수첩 반영</strong></div>
                    <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
                </header>
                <p class="mma-panel-note">반영 또는 수집으로 선택해 둔 항목만 표시됩니다. 여기에서 반영 방식 변경 또는 주입 해제를 처리할 수 있습니다.</p>
                ${active.length ? active.map(item => renderManagedItemCard(item)).join('') : '<p class="mma-empty">현재 반영 또는 수집 중인 항목이 없습니다.</p>'}
            </div>
        `;
        panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(memory.selectedLocationId));
        panel.querySelectorAll('[data-event-action]').forEach(button => {
            button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
        });
        return;
    }

    const selectedLocation = locationFilterId ? map?.locations.find(l => l.id === locationFilterId) : null;
    const events = (map?.events || []).filter(e => e.status !== 'ignored' && (!locationFilterId || e.locationId === locationFilterId));

    panel.innerHTML = `
        <div class="mma-action-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">📓</span><strong>수첩 반영</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <p class="mma-panel-note">장소와 퀘스트는 각각 따로 수집하거나 반영할 수 있습니다.</p>
            ${selectedLocation ? `<h4 class="mma-section-title">장소와 퀘스트를 반영할까요?</h4>${renderLocationManageCard(selectedLocation)}` : ''}
            ${events.length ? `<h4 class="mma-section-title">퀘스트만 반영할까요?</h4>${events.map(event => renderEventCard(event)).join('')}` : ''}
            ${!selectedLocation && !events.length ? '<p class="mma-empty">반영할 위치나 사건이 없습니다.</p>' : ''}
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(memory.selectedLocationId));
    panel.querySelectorAll('[data-event-action]').forEach(button => {
        button.addEventListener('click', () => handleManageAction(button.dataset.type, button.dataset.id, button.dataset.eventAction));
    });
}


function renderLocationManageCard(location) {
    return `
        <article class="mma-event-card location-manage">
            <div class="mma-event-title"><b>📍 ${escapeHtml(location.name)} 전체</b><span>장소</span></div>
            <p>${escapeHtml(stripLong(location.situation, 520))}</p>
            ${location.present?.length ? `<p class="mma-event-detail">👥 ${escapeHtml(location.present.join(', '))}</p>` : ''}
            <div class="mma-event-actions">
                ${renderActionButtons('location', location.id)}
            </div>
        </article>
    `;
}

function renderEventCard(event) {
    const location = ensureMemory().map?.locations.find(l => l.id === event.locationId);
    return `
        <article class="mma-event-card ${escapeHtml(event.status)}">
            <div class="mma-event-title"><b>${escapeHtml(getEventDisplayTitle(event, location))}</b><span>${statusLabel(event.status)}</span></div>
            <div class="mma-event-location">📍 ${escapeHtml(getEventDisplayLocationName(event, location))}</div>
            <p>${escapeHtml(event.summary)}</p>
            ${event.details ? `<p class="mma-event-detail">${escapeHtml(event.details)}</p>` : ''}
            ${renderQuestReward(event)}
            <div class="mma-event-actions">
                ${renderActionButtons('event', event.id)}
            </div>
        </article>
    `;
}

function renderManagedItemCard(item) {
    return `
        <article class="mma-event-card ${escapeHtml(item.status)}">
            <div class="mma-event-title"><b>${escapeHtml(getEventDisplayTitle(item))}</b><span>${statusLabel(item.status)}</span></div>
            <div class="mma-event-location">📍 ${escapeHtml(getEventDisplayLocationName(item))}</div>
            <p>${escapeHtml(stripLong(item.summary || item.situation || '', 420))}</p>
            ${item.details ? `<p class="mma-event-detail">${escapeHtml(item.details)}</p>` : ''}
            ${item.type === 'event' ? renderQuestReward(item) : ''}
            <div class="mma-event-actions">
                ${renderActionButtons('managed', item.id)}
            </div>
        </article>
    `;
}

function renderActionButtons(type, id) {
    const memory = ensureMemory();
    const safeType = escapeHtml(type);
    const safeId = escapeHtml(id);
    const activeItem = type === 'managed' ? memory.managedItems.find(x => x.id === id) : null;
    const button = (action, icon, title) => {
        const active = activeItem && activeItem.status === actionToStatus(action) ? ' active' : '';
        return `<button class="mma-action-choice${active}" title="${escapeHtml(title)}" data-type="${safeType}" data-id="${safeId}" data-event-action="${action}">${icon}</button>`;
    };

    if (type === 'managed') {
        return [
            button('inject', '🪄', '일반 반영으로 변경'),
            button('char', '👤', '캐릭터가 먼저 눈치챔으로 변경'),
            button('user', '🧍', '유저가 먼저 눈치챔으로 변경'),
            button('hold', '📓', '수집으로 변경'),
            button('remove', '🗑️', '반영 설정만 해제'),
        ].join('');
    }

    return [
        button('inject', '🪄', '다음 응답부터 일반 반영'),
        button('char', '👤', '캐릭터가 먼저 눈치챔'),
        button('user', '🧍', '유저가 먼저 눈치챔'),
        button('hold', '📓', '수첩에 수집'),
    ].join('');
}


function getManageTargetInfo(type, id) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map) return { title: '선택한 항목', locationName: '알 수 없는 위치', kind: '항목', subject: '선택한 항목' };
    if (type === 'managed') {
        const item = memory.managedItems.find(x => x.id === id);
        const kind = item?.type === 'location' || item?.type === 'recommendation'
            ? '장소'
            : item?.type === 'footstep' || item?.type === 'tracked'
                ? '인물'
                : item?.type === 'discovery'
                    ? '발견'
                    : '사건';
        return { title: item?.title || '선택한 항목', locationName: item?.locationName || '알 수 없는 위치', kind, subject: item?.title || '선택한 항목' };
    }
    if (type === 'location') {
        const loc = map.locations.find(l => l.id === id);
        return { title: loc?.name || '선택한 장소', locationName: loc?.name || '알 수 없는 위치', kind: '장소', subject: `${loc?.name || '선택한 장소'}의 상황` };
    }
    if (type === 'discovery') {
        const item = (memory.discoveries || []).find(entry => entry.id === id);
        return { title: item?.title || '선택한 발견', locationName: item?.locationName || '알 수 없는 위치', kind: '발견', subject: item?.title || '선택한 발견' };
    }
    if (type === 'recommendation') {
        const item = (memory.recommendations || []).find(x => x.id === id);
        return { title: item?.title || '검색 장소', locationName: getRecommendationLocationLabel(item || {}), kind: '장소', subject: item?.title || '검색 장소' };
    }
    if (type === 'tracked') {
        const tracked = memory.trackedPeople?.[id];
        return { title: `${tracked?.name || '추적 중인 인물'}의 동선`, locationName: tracked?.lastLocation || '위치 신호 흐림', kind: '인물', subject: `${tracked?.name || '추적 중인 인물'}의 동선` };
    }
    if (type === 'footstep') {
        const profile = memory.footstepProfiles?.[id];
        const footstep = map.footsteps?.find(fp => fp.id === id);
        const loc = map.locations.find(l => l.id === footstep?.locationId);
        const title = `${profile?.name || footstep?.label || '선택한 인물'}의 현재 상태`;
        return { title, locationName: profile?.currentLocation || loc?.name || '알 수 없는 위치', kind: '인물', subject: title };
    }
    const event = map.events.find(e => e.id === id);
    const loc = map.locations.find(l => l.id === event?.locationId);
    return { title: event?.title || '선택한 사건', locationName: loc?.name || '알 수 없는 위치', kind: '사건', subject: `${loc?.name || '알 수 없는 위치'}의 사건` };
}


function confirmManageAction(type, id, action) {
    const info = getManageTargetInfo(type, id);
    const charName = getCurrentCharacterName();
    const userName = getCurrentUserName();
    const subject = info.subject || info.title;
    const infoText = type === 'tracked'
        ? '이 인물의 최근 동선과 현재 위치 정보가 다음 응답의 배경으로 주입됩니다.'
        : info.kind === '발견'
            ? '이 발견의 대상, 현재 상태, 다음에 달라질 점이 다음 응답의 배경에 반영됩니다.'
        : info.kind === '인물'
            ? '이 인물의 현재 상태, 행동, 생각 정보가 주입됩니다.'
            : info.kind === '장소'
            ? '장소의 분위기, 인물, 사건 정보가 주입됩니다.'
            : '퀘스트가 벌어지는 위치의 분위기, 인물, 퀘스트 정보가 주입됩니다.';
    const injectQuestion = info.kind === '발견'
        ? '이 발견을 반영할까요?'
        : info.kind === '장소'
        ? '장소와 퀘스트를 반영할까요?'
        : info.kind === '사건'
            ? '퀘스트만 반영할까요?'
            : '이 정보를 반영할까요?';
    const charQuestion = info.kind === '발견'
        ? `이 발견을 ${charName}이(가) 먼저 눈치채도록 반영할까요?`
        : info.kind === '장소'
        ? `장소와 퀘스트를 ${charName}이(가) 먼저 눈치채도록 반영할까요?`
        : info.kind === '사건'
            ? `퀘스트만 ${charName}이(가) 먼저 눈치채도록 반영할까요?`
            : `이 정보를 ${charName}이(가) 먼저 눈치채도록 반영할까요?`;
    const userQuestion = info.kind === '발견'
        ? `이 발견을 ${userName}이(가) 먼저 눈치챌 수 있도록 반영할까요?`
        : info.kind === '장소'
        ? `장소와 퀘스트를 ${userName}이(가) 먼저 눈치챌 수 있도록 반영할까요?`
        : info.kind === '사건'
            ? `퀘스트만 ${userName}이(가) 먼저 눈치챌 수 있도록 반영할까요?`
            : `이 정보를 ${userName}이(가) 먼저 눈치챌 수 있도록 반영할까요?`;
    const messages = {
        hold: `${subject}을(를) 수첩에 기록합니다.\n롤플에는 바로 반영되지 않고 나중에 다시 반영할 수 있도록 남습니다.\n\n계속 진행할까요?`,
        inject: `${infoText}\n\n${injectQuestion}`,
        char: `${infoText}\n\n${charQuestion}`,
        user: `${infoText}\n\n${userQuestion}`,
        remove: `${info.title}의 주입 설정만 삭제합니다.\n지도에 표시된 장소, 인물, 퀘스트, 발견 자체는 사라지지 않습니다.\n\n삭제할까요?`,
    };
    return window.confirm(messages[action] || `${info.title} 항목을 처리할까요?`);
}

async function handleManageAction(type, id, action) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map) return;
    if (!confirmManageAction(type, id, action)) return;
    const shouldReturnToNotebook = Boolean(document.querySelector('.mma-notebook-panel'));

    if (type === 'managed') {
        const item = memory.managedItems.find(x => x.id === id);
        if (!item) return;
        if (action === 'remove') {
            memory.managedItems = memory.managedItems.filter(x => x.id !== id);
            markMapEventStatus(item.sourceId || '', 'available');
        } else {
            item.status = actionToStatus(action);
            item.updatedAt = nowStamp();
            markMapEventStatus(item.sourceId || '', item.status);
        }
    } else {
        const item = snapshotManagedItem(type, id, actionToStatus(action));
        if (!item) return;
        if (action === 'remove') {
            removeManagedBySource(item.sourceId);
        } else {
            if (type === 'recommendation' && action === 'hold') {
                const rec = (memory.recommendations || []).find(x => x.id === id);
                if (rec) rec.collected = true;
            }
            upsertManagedItem(item);
            markMapEventStatus(item.sourceId, item.status);
            if (type === 'discovery') {
                const discovery = (memory.discoveries || []).find(entry => entry.id === id);
                updateDiscoveryHistoryOutcome(memory, discovery, item.status);
            }
        }
    }

    await saveMemory();
    syncExtensionPrompt();
    renderMapView();
    if (shouldReturnToNotebook) {
        renderNotebookPanel();
    } else if (type === 'managed') {
        renderActionPanel(null, true);
    } else if (type === 'footstep') {
        renderFootstepPanel(id);
    } else if (type === 'recommendation' || type === 'tracked') {
        renderNotebookPanel();
    } else if (type === 'discovery') {
        renderDiscoveryPanel(id);
    } else {
        renderActionPanel(type === 'event' ? map.events.find(e => e.id === id)?.locationId : (type === 'location' ? id : null), false);
    }
}

function actionToStatus(action) {
    return {
        hold: 'held',
        inject: 'injected',
        char: 'char_notice',
        user: 'user_notice',
        remove: 'ignored',
    }[action] || 'held';
}

function snapshotManagedItem(type, id, status) {
    const memory = ensureMemory();
    const map = memory.map;
    if (!map) return null;
    if (type === 'location') {
        const loc = map.locations.find(l => l.id === id);
        if (!loc) return null;
        const events = (map.events || []).filter(e => e.locationId === loc.id && e.status !== 'ignored');
        return {
            id: `location:${loc.id}`,
            sourceId: `location:${loc.id}`,
            type: 'location',
            status,
            title: `${loc.name} 전체`,
            locationId: loc.id,
            locationName: loc.name,
            summary: loc.situation,
            details: loc.details,
            present: [...loc.present],
            clues: [...loc.clues],
            eventSnapshots: events.map(e => ({ title: e.title, summary: e.summary, details: e.details, reward: e.reward, injectionText: e.injectionText })),
            englishContext: loc.injectionText || buildLocationContextFallback(loc, events),
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    if (type === 'event') {
        const event = map.events.find(e => e.id === id);
        if (!event) return null;
        const loc = map.locations.find(l => l.id === event.locationId);
        return {
            id: `event:${event.id}`,
            sourceId: `event:${event.id}`,
            type: 'event',
            status,
            title: event.title,
            locationId: event.locationId,
            locationName: loc?.name || '알 수 없는 위치',
            summary: event.summary,
            details: event.details,
            reward: event.reward,
            injectionText: event.injectionText,
            situation: loc?.situation || '',
            present: loc ? [...loc.present] : [],
            clues: loc ? [...loc.clues] : [],
            eventSnapshots: [],
            englishContext: event.injectionText || buildEventContextFallback(event, loc),
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    if (type === 'discovery') {
        const item = (memory.discoveries || []).find(entry => entry.id === id);
        if (!item) return null;
        return {
            id: `discovery:${item.id}`,
            sourceId: `discovery:${item.id}`,
            type: 'discovery',
            status,
            title: item.title,
            locationId: item.locationId,
            locationName: item.locationName,
            summary: item.observation || item.body || item.summary || '',
            details: [
                `대상: ${item.focus || item.title}${item.focusContext ? ` — ${item.focusContext}` : ''}`,
                item.stakes ? `이대로 두면: ${item.stakes}` : '',
                item.interactions?.length ? `해볼 수 있는 일: ${item.interactions.join(' / ')}` : '',
            ].filter(Boolean).join('\n'),
            present: [...(item.participants || [])],
            clues: [],
            eventSnapshots: [],
            contextText: buildDiscoveryContext(item),
            fingerprint: item.fingerprint,
            category: item.category,
            emoji: item.emoji,
            focus: item.focus || item.title,
            focusContext: item.focusContext || '',
            observation: item.observation || item.body || item.summary || '',
            stakes: item.stakes || '',
            interactions: [...(item.interactions || [])],
            sourceAnchors: [...(item.sourceAnchors || item.anchors || [])],
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    if (type === 'recommendation') {
        const rec = (memory.recommendations || []).find(x => x.id === id);
        if (!rec) return null;
        return {
            id: `recommendation:${rec.id}`,
            sourceId: `recommendation:${rec.id}`,
            type: 'recommendation',
            status,
            title: rec.title,
            locationId: '',
            locationName: getRecommendationLocationLabel(rec),
            summary: rec.shortReview || rec.whyFits || '',
            details: `유명한 이유: ${rec.famousFor || ''}\n시그니처: ${rec.signature || ''}\n추천 이유: ${rec.whyFits || ''}\n예상 시나리오: ${rec.sceneHook || ''}\n추가 장면: ${(rec.possibleScenes || []).join(' / ')}\n상세: ${rec.details || ''}`,
            present: [],
            clues: [rec.sceneHook, rec.whyFits].filter(Boolean),
            eventSnapshots: [],
            englishContext: rec.injectionText || `Use this recommended place as a possible roleplay destination: ${rec.title} at ${getRecommendationLocationLabel(rec)}. ${rec.sceneHook || rec.whyFits || ''} Do not mention the map UI.`,
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    if (type === 'tracked') {
        const tracked = memory.trackedPeople?.[id];
        if (!tracked) return null;
        return {
            id: `tracked:${id}`,
            sourceId: `tracked:${id}`,
            type: 'tracked',
            status,
            title: `${tracked.name || '추적 중인 인물'}의 동선`,
            locationId: '',
            locationName: tracked.lastLocation || '위치 신호 흐림',
            summary: tracked.summary || tracked.lastActivity || '추적 중인 인물의 최근 동선이 기록되어 있다.',
            details: `현재 위치: ${tracked.lastLocation || '위치 신호 흐림'}\n현재 행동: ${tracked.lastActivity || '불명'}\n추적 반응: ${tracked.trackerReaction || '불명'}\n신뢰도: ${tracked.confidence || '불명'}\n최근 동선: ${(tracked.history || []).map(h => `${h.at || ''} ${h.location || ''} ${h.activity || ''}`).join(' / ')}`,
            present: [tracked.name].filter(Boolean),
            clues: [...(tracked.hooks || []), tracked.trackerReaction].filter(Boolean).slice(0, 8),
            eventSnapshots: [],
            englishContext: tracked.injectionText || `Use the tracked movement as background context. ${tracked.name || 'The tracked person'} is currently estimated near ${tracked.lastLocation || 'an unclear location'}. Their current activity: ${tracked.lastActivity || tracked.summary || 'unclear'}. Tracker reaction: ${tracked.trackerReaction || 'unclear'}. Integrate this naturally into the next roleplay response without mentioning the tracker UI.`,
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    if (type === 'footstep') {
        const footstep = map.footsteps?.find(fp => fp.id === id);
        const profile = memory.footstepProfiles?.[id];
        if (!footstep || !profile) return null;
        const loc = map.locations.find(l => l.id === footstep.locationId);
        return {
            id: `footstep:${footstep.id}`,
            sourceId: `footstep:${footstep.id}`,
            type: 'footstep',
            status,
            title: `${profile.name}의 현재 상태`,
            locationId: footstep.locationId,
            locationName: profile.currentLocation || loc?.name || '알 수 없는 위치',
            summary: profile.currentActivity,
            details: `인물 정보: ${profile.characterInfo}
현재 기분: ${profile.currentMood}
유저와의 관계 및 친밀도: ${profile.relationshipWithUser}
가장 최근 마주친 순간: ${profile.lastEncounterWithUser}
현재 해야 하는 일: ${profile.currentTask}
생각: ${profile.thoughts}
인벤토리: ${(profile.pocketContents || []).join(', ')}`,
            present: [profile.name],
            clues: [...(profile.hooks || []), ...(profile.pocketContents || []).map(x => `소지품: ${x}`)].slice(0, 8),
            eventSnapshots: [],
            englishContext: profile.injectionText || buildFootstepContextFallback(profile, loc),
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
        };
    }
    return null;
}

function upsertManagedItem(item) {
    const memory = ensureMemory();
    const index = memory.managedItems.findIndex(x => x.id === item.id || x.sourceId === item.sourceId);
    if (index >= 0) {
        memory.managedItems[index] = { ...memory.managedItems[index], ...item, createdAt: memory.managedItems[index].createdAt || item.createdAt, updatedAt: nowStamp() };
    } else {
        memory.managedItems.unshift(item);
    }
    memory.managedItems = memory.managedItems.filter(x => x.status !== 'ignored');
}

function removeManagedBySource(sourceId) {
    const memory = ensureMemory();
    memory.managedItems = memory.managedItems.filter(item => item.sourceId !== sourceId);
}

function markMapEventStatus(sourceId, status) {
    if (!sourceId.startsWith('event:')) return;
    const memory = ensureMemory();
    const eventId = sourceId.slice('event:'.length);
    const event = memory.map?.events.find(e => e.id === eventId);
    if (event) event.status = status;
}

function buildLocationContextFallback(loc, events = []) {
    const people = (loc.present || []).join(', ');
    const clues = (loc.clues || []).join('; ');
    const eventText = (events || []).map(e => `${e.title}: ${e.summary}`).join(' / ');
    return `Selected map location: ${loc.name}. Current atmosphere and situation: ${loc.situation} Additional observation: ${loc.details || ''} People present or nearby: ${people || 'not clearly identified'}. Notable clues: ${clues || 'none specified'}. Related hooks or events: ${eventText || 'none specified'}. When the roleplay scene is at, approaching, or naturally arrives at this location, allow fitting related quests to become playable scenes through observable dialogue, action, interruption, or discovery. Do not force the user to travel, speak, accept a quest, or take a specific action. Do not mention the map UI.`;
}

function buildEventContextFallback(event, loc) {
    const reward = event?.reward ? ` Potential reward after the event is meaningfully played out: ${event.reward}. Do not grant this reward before the scene is resolved.` : '';
    return `Selected map event: ${event.title}. Location: ${loc?.name || 'unknown'}. Location atmosphere: ${loc?.situation || ''} People present or nearby: ${(loc?.present || []).join(', ') || 'not clearly identified'}. Event details: ${event.summary} ${event.details || ''}. When the roleplay scene is at, approaching, or naturally arrives at this location, treat this selected quest as an active scene opportunity: let it begin through observable dialogue, action, interruption, or discovery involving the relevant people. Keep it unresolved until roleplay actions address it. Do not force the user to travel, speak, accept the quest, or take a specific action.${reward} Do not mention the map UI.`;
}

function buildFootstepContextFallback(profile, loc) {
    return `Selected map footstep status: ${profile.name}. Character info: ${profile.characterInfo || 'unknown'}. Current location: ${profile.currentLocation || loc?.name || 'unknown'}. Current mood: ${profile.currentMood}. Current activity: ${profile.currentActivity}. Relationship and closeness with the user: ${profile.relationshipWithUser}. Most recent encounter with the user: ${profile.lastEncounterWithUser || 'unknown'}. Current task: ${profile.currentTask}. Current thoughts: ${profile.thoughts}. Inventory items in their bag, pockets, on their person, or in their hands: ${(profile.pocketContents || []).join(', ') || 'unknown'}. Integrate this naturally as background context without mentioning the map UI.`;
}

function buildDiscoveryContext(item) {
    const focus = item.focus || item.title || 'an identified discovery';
    const focusContext = item.focusContext || '';
    const observation = item.observation || item.body || item.summary || '';
    const stakes = item.stakes || '';
    const interactions = uniqueStrings(item.interactions || [], 3);
    const sourceAnchors = uniqueStrings(item.sourceAnchors || item.anchors || [], 4);
    return `Selected map discovery: ${item.title}
Location: ${item.locationName}
Focus: ${focus}${focusContext ? ` — ${focusContext}` : ''}
People present: ${(item.participants || item.present || []).join(', ')}
What is currently observable: ${observation}
If nobody intervenes, what changes next: ${stakes}
Possible ways characters may engage: ${interactions.join(' / ')}
Continuity basis: ${sourceAnchors.join(' / ')}

Maintain this as a current world state at the stated location. When the roleplay reaches this location or naturally connects to its focus, make the observable state available through concrete action, sound, dialogue, movement, or physical detail. Let the state develop from the characters' actual responses, using the listed interactions as possibilities.`;
}

function buildActiveInjectionSummary() {
    const active = getActiveInjectionItems();
    if (!active.length) return '';
    return active.map(item => `${statusLabel(item.status)} · ${item.title} @ ${item.locationName}`).join('\n');
}

function getActiveInjectionItems(memory = null) {
    const target = memory || ensureMemory();
    return (target.managedItems || []).filter(item => ['injected', 'char_notice', 'user_notice'].includes(item.status));
}

function getManagedPanelItems() {
    const memory = ensureMemory();
    return (memory.managedItems || []).filter(item => ['held', 'injected', 'char_notice', 'user_notice'].includes(item.status));
}

function buildExtensionPrompt(memory = null) {
    const active = getActiveInjectionItems(memory);
    if (!active.length) return '';
    const userName = getCurrentUserName();
    const charName = getCurrentCharacterName();
    const lines = active.map((item, index) => {
        const mode = item.status === 'char_notice'
            ? `${charName} should notice or react to this map context first if it fits the scene.`
            : item.status === 'user_notice'
                ? `The narration may make this map context available for ${userName} to notice first without forcing an action.`
                : 'Let this selected map context subtly influence the next response and future responses until removed.';
        if (item.type === 'discovery') {
            const context = item.contextText || buildDiscoveryContext(item);
            return `${index + 1}. ${context}\n\nMode: ${mode}`;
        }
        const people = (item.present || []).length ? `People present or nearby: ${(item.present || []).join(', ')}.` : '';
        const clues = (item.clues || []).length ? `Notable clues: ${(item.clues || []).join('; ')}.` : '';
        const events = (item.eventSnapshots || []).length ? `Related events: ${item.eventSnapshots.map(e => `${e.title}: ${e.injectionText || e.summary}`).join(' / ')}.` : '';
        const arrivalRule = item.type === 'event'
            ? `Quest activation rule: when the roleplay scene is at, approaching, or naturally arrives at this location, treat this selected quest as an active scene opportunity. Let it start through observable dialogue, action, interruption, or discovery involving the relevant people. Keep it unresolved until roleplay actions address it. Do not force the user to travel, speak, accept the quest, or take a specific action.${item.reward ? ` Potential reward after meaningful resolution: ${item.reward}. Do not award it before the scene is resolved.` : ''}`
            : item.type === 'location' && (item.eventSnapshots || []).length
                ? `Location event rule: when the roleplay scene is at, approaching, or naturally arrives at this location, the related quests listed above may become playable scenes through observable dialogue, action, interruption, or discovery. Use the quest that fits the immediate scene; do not force the user to travel, speak, accept a quest, or take a specific action.`
                : '';
        const context = item.englishContext || buildLocationContextFallback({ name: item.locationName, situation: item.situation || item.summary, details: item.details, present: item.present || [], clues: item.clues || [] }, item.eventSnapshots || []);
        const typeLabel = item.type === 'location'
            ? 'Selected location'
            : item.type === 'footstep'
                ? 'Selected character/footstep status'
                : item.type === 'recommendation'
                    ? 'Selected place recommendation'
                    : item.type === 'tracked'
                        ? 'Selected tracked person status'
                        : 'Selected event';
        return `${index + 1}. ${typeLabel}: ${item.title}\nLocation: ${item.locationName}.\nEnglish map context:\n${context}\n${people}\n${clues}\n${events}\n${arrivalRule}\nMode: ${mode}`;
    }).join('\n\n');
    return `[Selected roleplay context]\nThe user selected the following map observations to be reflected in future roleplay responses. Do not mention the extension, buttons, UI, or that this is injected context. Integrate the information naturally with the current scene, tone, and character behavior. Do not override the user's agency. Treat this as background context, not as a message from the user.\n\n${lines}`;
}

function syncExtensionPrompt(options = {}) {
    try {
        const ctx = stContext();
        const createMemory = options?.createMemory !== false;
        const memory = createMemory ? ensureMemory() : getExistingMemory();
        const prompt = memory ? buildExtensionPrompt(memory) : '';
        if (typeof ctx.setExtensionPrompt === 'function') {
            const promptTypes = ctx.extension_prompt_types || globalThis.extension_prompt_types || {};
            const promptRoles = ctx.extension_prompt_roles || globalThis.extension_prompt_roles || {};
            ctx.setExtensionPrompt(
                EXTENSION_PROMPT_KEY,
                prompt,
                promptTypes.IN_CHAT ?? 1,
                0,
                false,
                promptRoles.SYSTEM ?? 0,
            );
        }
    } catch (error) {
        if (shouldPrintDebugToConsole()) console.warn('[MarauderMap] 확장 프롬프트 동기화 실패:', error);
    }
}

function renderMemoryPanel() {
    const panel = document.getElementById('mma-side-panel');
    if (!panel) return;
    const memory = ensureMemory();
    const map = memory.map;
    const locations = map?.locations || [];
    const events = map?.events || [];
    const managed = (memory.managedItems || []).filter(item => item.status !== 'ignored');
    const activeCount = getActiveInjectionItems(memory).length;
    const discoveryCount = (memory.discoveries || []).length;
    panel.innerHTML = `
        <div class="mma-memory-panel">
            <header class="mma-place-header">
                <div><span class="mma-place-icon">🧠</span><strong>지도 메모리</strong></div>
                <button title="위치 카드로 돌아가기" data-action="back">↩️</button>
            </header>
            <section class="mma-info-block">
                <h4>📜</h4>
                <p><b>현재 지도:</b> ${escapeHtml(map?.regionName || '없음')}</p>
                <p><b>생성 시각:</b> ${escapeHtml(memory.generatedAt || '아직 없음')}</p>
                <p><b>현재 위치:</b> ${escapeHtml(locations.find(l => l.id === map?.currentLocationId)?.name || '알 수 없음')}</p>
                <p><b>주변 발견:</b> ${discoveryCount}개</p>
                <p><b>저장된 반영 데이터:</b> ${managed.length}개 · <b>활성:</b> ${activeCount}개</p>
            </section>
            <section class="mma-info-block">
                <h4>📍</h4>
                <ul>${locations.map(l => `<li>${escapeHtml(l.icon || '📍')} ${escapeHtml(l.name)}</li>`).join('') || '<li>기록된 위치 없음</li>'}</ul>
            </section>
            <section class="mma-info-block">
                <h4>✨</h4>
                <ul>${events.map(e => `<li><span class="mma-status ${escapeHtml(e.status)}">${statusLabel(e.status)}</span> ${escapeHtml(e.title)} — ${escapeHtml(stripLong(e.summary, 120))}</li>`).join('') || '<li>기록된 사건 없음</li>'}</ul>
            </section>
            <section class="mma-info-block">
                <h4>🪄</h4>
                <ul>${managed.map(item => `<li><span class="mma-status ${escapeHtml(item.status)}">${statusLabel(item.status)}</span> ${escapeHtml(item.title)} <small>(${escapeHtml(item.locationName || '')})</small></li>`).join('') || '<li>반영 중인 항목 없음</li>'}</ul>
            </section>
        </div>
    `;
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => renderLocationPanel(memory.selectedLocationId));
}

function summarizeMapMemory(memory) {
    const map = memory.map;
    if (!map) return '지도 메모리 없음';
    const locations = map.locations.map(l => `- ${l.name}: ${stripLong(l.situation, 260)}`).join('\n');
    const events = map.events.map(e => `- [${e.status}] ${e.title}: ${stripLong(e.summary, 220)}`).join('\n');
    const managed = (memory.managedItems || []).map(item => `- [${item.status}] ${item.title} @ ${item.locationName}`).join('\n');
    return `구역: ${map.regionName}\n현재 위치: ${map.currentLocationId}\n위치들:\n${locations}\n사건들:\n${events}\n반영:\n${managed || '(없음)'}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setupExtensionButtonInSettings() {
    const settingsContainer = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!settingsContainer || document.getElementById('mma-settings-block')) return;
    const settings = getSettings();
    const block = document.createElement('div');
    block.id = 'mma-settings-block';
    block.className = 'inline-drawer';
    block.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🗺️ 지도</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content mma-settings-content" style="display:none;">
            <div class="mma-settings-inner">
            <div class="mma-settings-grid">
                <div class="mma-settings-field mma-settings-profile-field">
                    <label class="mma-settings-label" for="mma-connection-profile">연결 프로필</label>
                    <select id="mma-connection-profile" class="text_pole">
                        <option value="main">메인 API</option>
                    </select>
                    <p class="mma-settings-note">메인 API 외 별도 프로필 사용을 추천합니다.</p>
                </div>
                <div class="mma-settings-field mma-settings-theme-field">
                    <label class="mma-settings-label" for="mma-theme-setting">Theme</label>
                    <select id="mma-theme-setting" class="text_pole">
                        <option value="marauder" ${getThemeKey() === 'marauder' ? 'selected' : ''}>Marauder's Map (HP AU)</option>
                        <option value="modern" ${getThemeKey() === 'modern' ? 'selected' : ''}>S.H.I.E.L.D. Field Locator (MCU AU)</option>
                        <option value="bonbon" ${getThemeKey() === 'bonbon' ? 'selected' : ''}>Bonbon Board</option>
                    </select>
                </div>
                <div class="mma-settings-field mma-settings-output-field">
                    <label class="mma-settings-label" for="mma-output-mode">출력 모드</label>
                    <select id="mma-output-mode" class="text_pole">
                        <option value="basic" ${getOutputModeKey() === 'basic' ? 'selected' : ''}>기본</option>
                        <option value="saver" ${getOutputModeKey() === 'saver' ? 'selected' : ''}>절약</option>
                    </select>
                </div>
                <div class="mma-settings-field mma-settings-font-field">
                    <label class="mma-settings-label" for="mma-font-scale">지도 글씨 크기</label>
                    <div class="mma-font-scale-row">
                        <input id="mma-font-scale" class="text_pole mma-font-scale-input" type="number" min="10" max="24" step="1" value="${normalizeFontScale(settings.fontScale)}">
                        <span id="mma-font-scale-value">px</span>
                    </div>
                </div>
                <div class="mma-settings-field mma-settings-debug-field">
                    <button id="mma-open-debug" type="button" class="menu_button mma-debug-settings-button">🐞 <span>디버그 로그</span></button>
                </div>
                <div id="mma-settings-debug-panel" class="mma-settings-debug-panel" style="display:none;">
                    <div class="mma-debug-actions">
                        <button id="mma-copy-debug" type="button" class="menu_button">로그 복사</button>
                        <button id="mma-clear-debug" type="button" class="menu_button">로그 비우기</button>
                    </div>
                    <textarea id="mma-settings-debug-output" readonly rows="8" placeholder="디버그 로그 버튼을 누르면 최근 지도 요청 로그와 설정 정보가 여기에 표시됩니다."></textarea>
                </div>
            </div>
            </div>
        </div>
    `;
    settingsContainer.appendChild(block);

    block.querySelector('#mma-theme-setting')?.addEventListener('change', (event) => {
        setTheme(event.target.value, false);
    });
    block.querySelector('#mma-output-mode')?.addEventListener('change', (event) => {
        settings.outputMode = normalizeOutputMode(event.target.value);
        event.target.value = settings.outputMode;
        saveSettings();
    });
    const fontScaleInput = block.querySelector('#mma-font-scale');
    const fontScaleValue = block.querySelector('#mma-font-scale-value');
    fontScaleInput?.addEventListener('input', (event) => {
        const value = normalizeFontScale(event.target.value);
        settings.fontScale = value;
        if (fontScaleValue) fontScaleValue.textContent = 'px';
        applyFontScale();
        saveSettings();
    });
    block.querySelector('#mma-connection-profile')?.addEventListener('change', (event) => {
        settings.connectionProfile = event.target.value || 'main';
        saveSettings();
    });
    block.querySelector('#mma-open-debug')?.addEventListener('click', toggleMapSettingsDebugDump);
    block.querySelector('#mma-copy-debug')?.addEventListener('click', copyMapSettingsDebugDump);
    block.querySelector('#mma-clear-debug')?.addEventListener('click', clearMapSettingsDebugDump);
    populateConnectionProfileSelect();
}

async function populateConnectionProfileSelect() {
    const select = document.getElementById('mma-connection-profile');
    if (!select) return;
    const settings = getSettings();
    const profiles = await getSavedConnectionProfiles();
    const currentRaw = settings.connectionProfile || 'main';
    const legacyProfile = profiles.find(p => p.id === currentRaw || p.name === currentRaw);
    const current = currentRaw === 'main' ? 'main' : (legacyProfile?.id || 'main');

    select.innerHTML = `<option value="main">메인 API</option>${profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join('')}`;
    select.value = current;

    // Hydrating the profile selector is not a user change. Updating the in-memory
    // value is enough here; the change handler above persists explicit selections.
    // Avoiding a boot-time save prevents SillyTavern's "Settings not ready" warning.
    if (settings.connectionProfile !== current) {
        settings.connectionProfile = current;
    }
}


function ensureExtensionsMenuButton() {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('mma-extension-menu-button')) return true;

    const button = document.createElement('div');
    button.id = 'mma-extension-menu-button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.title = getThemeConfig().menuTitle || getThemeConfig().shortLabel;
    button.innerHTML = `<span class="mma-menu-icon extensionsMenuExtensionButton">${getExtensionMenuIcon()}</span><span class="mma-menu-label">지도</span>`;
    button.addEventListener('click', () => {
        openMap();
    });
    menu.appendChild(button);
    return true;
}

function safeInitStep(label, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`[MarauderMap] init step failed: ${label}`, error);
    }
}

function handleMapChatChanged() {
    if (!initialized) return;

    const beforeSignature = lastKnownChatSignature || '';
    const currentSignature = getStableChatSignature();

    if (shouldIgnoreChatChanged()) {
        pushDebugLog('chat.changed.ignored', '연결 프로필 전환 중 발생한 CHAT_CHANGED라 닫지 않습니다.', {
            depth: profileSwitchDepth,
            suppressMs: Math.max(0, suppressChatChangeUntil - Date.now()),
        });
        if (currentSignature) lastKnownChatSignature = currentSignature;
        setTimeout(() => syncExtensionPrompt({ createMemory: false }), 0);
        return;
    }

    if (!beforeSignature && currentSignature) {
        lastKnownChatSignature = currentSignature;
        pushDebugLog('chat.changed.ignored.initial', '초기 채팅 서명 확보용 CHAT_CHANGED라 닫지 않습니다.', {
            signature: currentSignature,
        });
        setTimeout(() => syncExtensionPrompt({ createMemory: false }), 0);
        return;
    }

    if (beforeSignature && currentSignature && beforeSignature === currentSignature) {
        pushDebugLog('chat.changed.ignored.sameChat', '같은 채팅에서 발생한 CHAT_CHANGED라 닫지 않습니다.', {
            signature: currentSignature,
        });
        setTimeout(() => syncExtensionPrompt({ createMemory: false }), 0);
        return;
    }

    pushDebugLog('chat.changed', '실제 채팅 변경 이벤트를 감지했습니다.', {
        beforeSignature,
        currentSignature,
    });
    lastKnownChatSignature = currentSignature || '';
    // A real chat switch is different from merely closing the map.
    // Stop the old chat's request so it cannot save into the new one.
    cancelActiveMapGeneration('chat changed');
    closeMap('chat.changed');
    setTimeout(() => syncExtensionPrompt({ createMemory: false }), 0);
}

function isAppUiReady() {
    return Boolean(
        document.body &&
        document.getElementById('extensionsMenu') &&
        (document.getElementById('extensions_settings') || document.getElementById('extensions_settings2'))
    );
}

function handleMapLifecycleReady() {
    if (!lifecycleEnabled || initialized) return;
    if (isContextReady() && isAppUiReady()) init();
}

function bindAppLifecycleHooks() {
    if (appLifecycleHooksBound) return;
    const context = safeContext();
    const eventSource = context?.eventSource;
    const eventTypes = context?.event_types || context?.eventTypes || {};
    if (!eventSource?.on) return;

    const seen = new Set();
    const handlers = [];
    for (const key of ['APP_INITIALIZED', 'APP_READY']) {
        const eventName = eventTypes[key];
        if (!eventName || seen.has(eventName)) continue;
        seen.add(eventName);
        const handler = () => handleMapLifecycleReady();
        eventSource.on(eventName, handler);
        handlers.push({ eventName, handler });
    }
    appLifecycleHandlers = handlers;
    appLifecycleHooksBound = handlers.length > 0;
}

function unbindAppLifecycleHooks() {
    if (!appLifecycleHooksBound && !appLifecycleHandlers.length) return;
    const context = safeContext();
    const eventSource = context?.eventSource;
    for (const { eventName, handler } of appLifecycleHandlers) {
        try {
            if (typeof eventSource?.off === 'function') eventSource.off(eventName, handler);
            else if (typeof eventSource?.removeListener === 'function') eventSource.removeListener(eventName, handler);
        } catch { /* noop */ }
    }
    appLifecycleHandlers = [];
    appLifecycleHooksBound = false;
}

function init() {
    if (!lifecycleEnabled || initialized || !isContextReady()) return;

    initialized = true;
    safeInitStep('setupExtensionButtonInSettings', setupExtensionButtonInSettings);
    safeInitStep('ensureExtensionsMenuButton', ensureExtensionsMenuButton);
    // Restore an already-existing injected map prompt quietly, but do not create
    // map DOM, run migrations, or touch chat memory during SillyTavern boot.
    safeInitStep('syncExtensionPromptExistingOnly', () => syncExtensionPrompt({ createMemory: false }));

    safeInitStep('event hooks', () => {
        if (chatChangedHooked) return;
        const { eventSource, event_types } = stContext();
        if (eventSource?.on && event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, handleMapChatChanged);
            chatChangedHooked = true;
        }
    });
}

function startLifecycleInit() {
    if (!lifecycleEnabled || initialized) return;
    bindAppLifecycleHooks();

    // Re-enabling after SillyTavern is already ready should initialize immediately.
    // During normal startup, APP_INITIALIZED / APP_READY perform the setup instead.
    if (document.readyState !== 'loading' && isContextReady() && isAppUiReady()) {
        handleMapLifecycleReady();
        return;
    }

    // One standard DOM readiness callback is retained only for clients where the
    // extension activate hook runs before the document is interactive.
    if (document.readyState === 'loading' && !initDomReadyHandler) {
        initDomReadyHandler = () => {
            initDomReadyHandler = null;
            bindAppLifecycleHooks();
            if (isContextReady() && isAppUiReady()) handleMapLifecycleReady();
        };
        document.addEventListener('DOMContentLoaded', initDomReadyHandler, { once: true });
    }
}

export function onActivate() {
    lifecycleEnabled = true;
    startLifecycleInit();
}

export function onEnable() {
    lifecycleEnabled = true;
    startLifecycleInit();
}

export function onDisable() {
    lifecycleEnabled = false;
    initialized = false;
    if (activeDiscoveryConfirm) activeDiscoveryConfirm(false);
    cancelActiveMapGeneration('extension disabled');
    if (mapResizeState) endMapResize();
    pushDebugLog('extension.disable', '확장이 비활성화됩니다.');
    try {
        safeContext()?.setExtensionPrompt?.(EXTENSION_PROMPT_KEY, '');
    } catch { /* noop */ }
    try {
        const { eventSource, event_types } = stContext();
        if (chatChangedHooked && typeof eventSource?.off === 'function' && event_types?.CHAT_CHANGED) {
            eventSource.off(event_types.CHAT_CHANGED, handleMapChatChanged);
            chatChangedHooked = false;
        }
    } catch { /* noop */ }
    lastKnownChatSignature = '';
    unbindAppLifecycleHooks();
    if (initDomReadyHandler) {
        try { document.removeEventListener('DOMContentLoaded', initDomReadyHandler); } catch { /* noop */ }
        initDomReadyHandler = null;
    }
    document.getElementById(EXTENSION_ROOT_ID)?.remove();
    document.getElementById('mma-extension-menu-button')?.remove();
}
