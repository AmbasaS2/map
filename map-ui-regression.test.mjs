import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
function part(from, to) {
    const i = source.indexOf(from), j = source.indexOf(to, i + from.length);
    assert.ok(i >= 0 && j > i, 'missing source snippet: ' + from);
    return source.slice(i, j);
}
const browser = [process.env.MAP_TEST_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && existsSync(p));

test('native Chromium DOM: localized changes, font protection, marker identity, panel identity, resize and close', { skip: !browser && 'Set MAP_TEST_CHROME to a Chromium executable' }, () => {
    const code = [
        part('function isKoreanMapLocale()', 'function getMapNarrativeLanguage('),
        part('function localizeMapUiText(', 'function stContext('),
        part('const MARAUDER_SERIF_FONT', 'function applyThemeClass('),
        part("let visibleTrackedRouteKey = '';", 'function renderTrackedCard('),
        part('function isMapOverlayVisible()', 'function beginMapGeneration('),
        part('function setupDebugHooks()', 'function setupOverlayDebugObserver('),
        part('function getViewportHeight()', 'function createRoot('),
        part('function closeMap(', 'function setBusy('),
        part('const mapCanvasLayoutKeys', 'function renderDiscoveryListPanel('),
        part('async function dismissDiscovery(', 'function stripEventLinesFromLocationPalette('),
        part('function stripEventLinesFromLocationPalette(', 'function renderActionPanel('),
    ].join('\n');
    const harness = `
const EXTENSION_ROOT_ID = 'mma-test-root';
const mapLocaleObservers = new Map();
const ENGLISH_UI = { '닫기': 'Close', '검색': 'Search', '수첩': 'Notebook' };
let locale = 'ko-kr', theme = 'modern', activeMapGeneration = null, mapResizeState = null, activeMapConfirmation = null;
let saves = 0, memory, fullViewCalls = 0;
const getCurrentLocale = () => locale;
const getThemeKey = () => theme;
const isModernTheme = () => theme === 'modern';
const isBonbonTheme = () => theme === 'bonbon';
const isMarauderTheme = () => theme === 'marauder';
const getThemeConfig = () => ({ key: theme, locationInfoIcon: '🎨' });
const getDiscoveryUiConfig = () => ({ name: '검색' });
const getDiscoveryCategoryIcon = () => '🔎';
const mapControlIcon = () => '<i class="fa-solid"></i>';
const isRenderableMapFootstep = fp => !!fp?.label;
const isValidMapData = map => !!map?.locations?.length;
const findUnambiguousLocationNameMatch = (locations, name) => {
    const matches = locations.filter(loc => loc.name === name);
    return matches.length === 1 ? matches[0] : null;
};
const ensureMemory = () => memory;
const getExistingMemory = () => memory;
const saveMemory = () => { saves++; return Promise.resolve(true); };
const renderMapView = () => { fullViewCalls++; throw Error('Unexpected full map render'); };
const renderDiscoveryListPanel = () => { document.getElementById('mma-side-panel').innerHTML = '<div>list</div>'; };
const pushDebugLog = () => {};
const toast = () => {};
const cancelActiveMapGeneration = () => {};
const updateDiscoveryHistoryOutcome = () => {};
const requestDiscoveryGeneration = () => {};
const handleFootstepClick = () => {};
const renderDiscoveryPanel = () => {};
const refreshLocation = () => {};
const renderActionPanel = () => {};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const assert = (value, message) => { if (!value) throw Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const el = id => document.getElementById(id);
const q = selector => document.querySelector(selector);
${code}
function reset(nextTheme) {
    stopMarauderSerifProtection();
    stopMapUiLocaleObservers();
    visibleTrackedRouteKey = '';
    theme = nextTheme;
    el(EXTENSION_ROOT_ID).innerHTML = '<div id="mma-overlay"><div id="mma-window" class="mma-theme-' + theme + '"><nav class="mma-toolbar-actions"><button data-action="recommend">검색</button></nav><div id="mma-map-canvas"></div><aside id="mma-side-panel"></aside></div></div>';
    memory = {
        selectedLocationId: 'a',
        map: { currentLocationId: 'a', locations: [
            { id:'a', name:'Same', icon:'A', situation:'first', present:['검색'] },
            { id:'b', name:'Same', icon:'B', situation:'second', present:[] },
            { id:'c', name:'Third', icon:'C', situation:'third', present:[] },
        ], events:[{ id:'e', locationId:'a', title:'quest', status:'available' }],
        footsteps:[{ id:'p', locationId:'a', label:'Person', visibleName:true, status:'old' }] },
        discoveries:[{ id:'d1', locationId:'a', title:'one', locationName:'Same', emoji:'🔎' }, { id:'d2', locationId:'c', title:'two', locationName:'Third', emoji:'🔎' }],
        trackedPeople:{ t:{ name:'Tracker', lastLocation:'Third', confidence:'high', history:[{ location:'Unique', confidence:'high' }] } },
    };
    memory.map.locations[0].name = 'Unique';
}
async function fontTest() {
    reset('modern');
    const root = el('mma-window');
    root.insertAdjacentHTML('beforeend','<div id="font-parent"><span id="font-text" style="font-family:monospace">text</span><i id="font-icon" class="fa-solid" style="font-family:IconFont">icon</i></div>');
    const target = el('font-text'), parent = el('font-parent'), icon = el('font-icon');
    const originalQuery = root.querySelectorAll.bind(root);
    let rootScans = 0;
    root.querySelectorAll = (...args) => { rootScans++; return originalQuery(...args); };
    startMarauderSerifProtection();
    const initial = rootScans;
    assert(sameProtectedFontFamily(target.style.fontFamily, SHIELD_SANS_FONT), 'Shield initial font');
    assert(icon.style.fontFamily === 'IconFont', 'icon font overridden');
    target.style.width = '12px';
    target.classList.add('selected');
    target.textContent = 'new text';
    await tick();
    assert(rootScans === initial, 'unrelated class/style/text re-scanned root');
    target.style.setProperty('font-family','serif','important');
    await tick();
    assert(sameProtectedFontFamily(target.style.fontFamily, SHIELD_SANS_FONT), 'external font override not repaired');
    assert(rootScans === initial, 'external font override re-scanned root');
    parent.insertAdjacentHTML('beforeend','<span id="new-font">new</span>');
    await tick();
    assert(sameProtectedFontFamily(el('new-font').style.fontFamily, SHIELD_SANS_FONT), 'new subtree not protected');
    parent.classList.add('fa-solid');
    await tick();
    assert(target.style.fontFamily === 'monospace', 'font not restored on icon ancestry');
    parent.classList.remove('fa-solid');
    await tick();
    assert(sameProtectedFontFamily(target.style.fontFamily, SHIELD_SANS_FONT), 'font not restored after icon ancestry removed');
    root.className = 'mma-theme-bonbon';
    startMarauderSerifProtection();
    assert(!marauderSerifObserver && target.style.fontFamily === 'monospace', 'Bonbon should restore and not observe fonts');
    target.style.fontFamily = 'cursive';
    await tick();
    assert(target.style.fontFamily === 'cursive', 'Bonbon inherited font overwritten');
    root.className = 'mma-theme-marauder';
    root.insertAdjacentHTML('beforeend','<button class="mma-spell-button"><span id="spell-text">spell</span></button><p id="plain">plain</p>');
    startMarauderSerifProtection();
    assert(sameProtectedFontFamily(el('spell-text').style.fontFamily, MARAUDER_SERIF_FONT), 'Marauder spell span not protected');
    assert(!el('plain').style.fontFamily, 'Marauder overbroad');
    el('spell-text').parentElement.classList.remove('mma-spell-button');
    await tick();
    assert(!el('spell-text').style.fontFamily, 'removed spell class retained protected font');
    closeMap();
    assert(!marauderSerifObserver && protectedOriginalFonts.size === 0, 'close did not stop font observer');
}
async function localeTest() {
    locale = 'en';
    const root = document.createElement('section');
    root.innerHTML = '<button id="locale-button" title="닫기">검색</button><span data-mma-no-translate>검색</span><span class="mma-node-label">수첩</span>';
    document.body.append(root);
    let rootWalks = 0, walks = 0;
    const walker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (node, ...args) => { walks++; if (node === root) rootWalks++; return walker(node, ...args); };
    observeMapUiLocale(root);
    assert(el('locale-button').textContent === 'Search' && el('locale-button').title === 'Close', 'initial translation');
    assert(root.querySelector('[data-mma-no-translate]').textContent === '검색' && root.querySelector('.mma-node-label').textContent === '수첩', 'narrative/name translated');
    const initial = walks;
    el('locale-button').firstChild.data = '수첩';
    el('locale-button').title = '검색';
    await tick();
    assert(el('locale-button').textContent === 'Notebook' && el('locale-button').title === 'Search', 'local text/attribute changes not translated');
    assert(walks === initial, 'text or attribute traversed subtree');
    const child = document.createElement('div');
    child.innerHTML = '<button>닫기</button>';
    root.append(child);
    await tick();
    assert(child.textContent === 'Close' && rootWalks === 1 && walks === initial + 1, 'addition should traverse only new subtree');
    child.remove();
    await tick();
    assert(walks === initial + 1, 'removal triggered walk');
    stopMapUiLocaleObservers();
    assert(mapLocaleObservers.size === 0, 'locale observers remain');
    document.createTreeWalker = walker;
    root.remove();
    locale = 'ko-kr';
}
async function renderTest(nextTheme) {
    reset(nextTheme);
    renderCanvas(memory);
    selectLocation('a',memory);
    const canvas = el('mma-map-canvas'), panel = el('mma-side-panel'), card = panel.firstElementChild;
    const node = q('.mma-node[data-id="a"]'), foot = q('.mma-footstep'), marker = q('.mma-discovery-marker[data-discovery-id="d1"]'), handle = el('mma-map-resize-handle');
    const savesBefore = saves;
    selectLocation('a',memory);
    assert(panel.firstElementChild === card && saves === savesBefore, nextTheme + ' repeat selection rebuilt/saved');
    panel.innerHTML = '<div class="mma-notebook-panel">Notebook</div>';
    const notebook = panel.firstElementChild;
    showTrackedRoute('t');
    const route = q('.mma-tracked-route-layer');
    assert(route && q('.mma-tracked-route-legend') && q('[data-action="clear-route"]'), 'route did not appear');
    assert(panel.firstElementChild === notebook && q('.mma-node[data-id="a"]') === node && q('.mma-footstep') === foot && el('mma-map-resize-handle') === handle, 'route replaced unrelated DOM');
    refreshMapCanvasMarkers(memory);
    assert(q('.mma-tracked-route-layer') === route, 'unchanged route rebuilt');
    q('[data-action="clear-route"]').click();
    assert(!q('.mma-tracked-route-layer') && !q('[data-action="clear-route"]') && q('.mma-node[data-id="a"]') === node, 'clear route changed map');
    selectLocation('a',memory);
    assert(isViewingLocationPanel('a') && panel.firstElementChild !== notebook && saves === savesBefore, 'same location from notebook did not open');
    memory.map.locations[0].name = memory.map.locations[1].name;
    refreshMapCanvasMarkers(memory);
    renderLocationPanel('a',memory);
    assert(isViewingLocationPanel('a') && !isViewingLocationPanel('b'), 'duplicate names confused panel identity');
    selectLocation('b',memory);
    assert(isViewingLocationPanel('b') && saves === savesBefore + 1 && q('.mma-node[data-id="b"]').classList.contains('selected') && !node.classList.contains('selected'), 'real selection did not persist or update markers');
    const cardB = panel.firstElementChild;
    memory.map.locations[1].situation = 'new AI content';
    memory.map.footsteps[0].status = 'new';
    memory.map.events[0].status = 'ignored';
    refreshVisibleMapAfterBackgroundUpdate({locationId:'b'});
    assert(panel.firstElementChild !== cardB && panel.textContent.includes('new AI content'), 'changed location did not refresh');
    assert(q('.mma-node[data-id="a"]') === node && !node.querySelector('.mma-event-badge') && q('.mma-footstep') === foot && foot.title.endsWith('new'), 'badge/footstep change rebuilt unchanged markers');
    await dismissDiscovery('d2');
    assert(!q('.mma-discovery-marker[data-discovery-id="d2"]') && q('.mma-discovery-marker[data-discovery-id="d1"]') === marker && el('mma-map-resize-handle') === handle, 'last discovery removal rebuilt unrelated elements');
    memory.map.footsteps.push({id:'p2',locationId:'a',label:'New',visibleName:true});
    refreshMapCanvasMarkers(memory);
    assert(q('.mma-footstep[data-footstep-id="p2"]') && el('mma-map-resize-handle') === handle, 'collision layout or resize handle failed');
    assert(fullViewCalls === 0, 'whole map render called');
    await tick();
    if (nextTheme === 'modern') {
        let measurements = 0;
        canvas.getBoundingClientRect = () => { measurements++; return {height:1000, top:10}; };
        canvas.dataset.mmaUserResized = 'true';
        canvas.dataset.mmaResizeBaseHeight = '100';
        setupDebugHooks();
        window.visualViewport.dispatchEvent(new Event('resize'));
        assert(measurements === 1, 'viewport resize measured more than once');
        closeMap();
        const closedMeasurements = measurements;
        window.visualViewport.dispatchEvent(new Event('resize'));
        const hiddenCard = panel.firstElementChild;
        refreshVisibleMapAfterBackgroundUpdate({locationId:'b'});
        assert(measurements === closedMeasurements && panel.firstElementChild === hiddenCard, 'closed map measured or rendered');
    }
}
(async () => {
    try {
        await fontTest();
        await localeTest();
        for (const current of ['marauder','modern','bonbon']) await renderTest(current);
        document.body.dataset.result = 'pass';
    } catch (error) {
        document.body.dataset.result = 'fail';
        document.getElementById('result').textContent = error.stack || String(error);
    }
})();
`;
    const dir = mkdtempSync(join(tmpdir(), 'map-ui-test-'));
    try {
        const html = join(dir, 'test.html');
        writeFileSync(html, '<!doctype html><meta charset="utf-8"><body><div id="mma-test-root"></div><pre id="result"></pre><script>' + harness + '</script>');
        const args = ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
            '--user-data-dir=' + join(dir, 'profile'), '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(html).href];
        if (process.getuid?.() === 0) args.unshift('--no-sandbox');
        const result = spawnSync(browser, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        assert.equal(result.status, 0, result.error?.message || result.stderr?.slice(-2000));
        const failure = result.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
        assert.ok(result.stdout.includes('data-result="pass"'), failure || 'Browser test did not finish');
    } finally {
        rmSync(dir, {recursive:true,force:true});
    }
});
