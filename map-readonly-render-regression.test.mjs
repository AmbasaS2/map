import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');
function section(start, end) {
    const at = source.indexOf(start);
    const next = source.indexOf(end, at + start.length);
    assert.ok(at >= 0 && next > at, 'Missing source region: ' + start);
    return source.slice(at, next);
}

const selectionCode = section('function selectLocation(locationId, memoryArg = null) {', 'function stripEventLinesFromLocationPalette(');
const badgeCode = section('function eventBadgeForLocation(locationId, map = ensureMemory().map, count = null) {', 'function getNodePositions(');
const viewCode = section('function renderMapView() {', 'function renderCanvas(');
const canvasCode = section('function renderCanvas(memoryArg = null) {', 'function eventBadgeForLocation(');

function selectionFixture() {
    const state = {
        selectedLocationId: 'locA',
        map: { locations: [{ id: 'locA' }, { id: 'locB' }] },
    };
    const stats = { saves: 0, rendered: [], alerts: [], toggles: [] };
    const nodes = [{ dataset: { id: 'locA' } }, { dataset: { id: 'locB' } }];
    nodes.forEach(node => {
        node.classList = { add(key) { stats.toggles.push([node.dataset.id, key, true]); }, remove(key) { stats.toggles.push([node.dataset.id, key, false]); } };
    });
    const factory = new Function('ensureMemory', 'saveMemory', 'document', 'renderLocationPanel', 'toast', 'isMapOverlayVisible', 'CSS',
        selectionCode + '\nreturn selectLocation;');
    const select = factory(
        () => state,
        () => { stats.saves++; },
        { getElementById: () => ({ querySelectorAll: () => nodes.slice(0, 1), querySelector: () => nodes[1] }) },
        id => stats.rendered.push(id),
        value => stats.alerts.push(value),
        () => true, { escape: String },
    );
    return { select, state, stats };
}

test('selecting already-selected location avoids marker writes and saving JSONL', () => {
    const f = selectionFixture();
    f.select('locA');
    assert.equal(f.stats.saves, 0);
    assert.deepEqual(f.stats.rendered, ['locA']);
    assert.equal(f.stats.toggles.length, 0);
});

test('genuine user location change persists exactly once', () => {
    const f = selectionFixture();
    f.select('locB');
    assert.equal(f.state.selectedLocationId, 'locB');
    assert.equal(f.stats.saves, 1);
    f.select('locB');
    assert.equal(f.stats.saves, 1);
    assert.deepEqual(f.stats.rendered, ['locB', 'locB']);
});

test('invalid location cannot alter saved selection', () => {
    const f = selectionFixture();
    f.select('missing');
    assert.equal(f.stats.saves, 0);
    assert.equal(f.state.selectedLocationId, 'locA');
    assert.equal(f.stats.alerts.length, 1);
});

test('map view reuses memory and saves only if missing/stale selection is initialized', () => {
    assert.match(viewCode, /renderCanvas\(memory\);/);
    assert.match(viewCode, /selectLocation\(memory\.selectedLocationId, memory\);/);
    assert.match(viewCode, /const previousSelection = memory\.selectedLocationId;/);
    assert.match(viewCode, /if \(memory\.selectedLocationId !== previousSelection\) saveMemory\(memory\);/);
    assert.equal((viewCode.match(/saveMemory\(/g) || []).length, 1);
});

test('canvas receives existing memory, avoiding a second full hydration', () => {
    assert.match(canvasCode, /function renderCanvas\(memoryArg = null\)/);
    assert.match(canvasCode, /const memory = memoryArg \|\| ensureMemory\(\)/);
    assert.match(canvasCode, /drawTrackedRoute\(canvas, map, positions, memory\)/);
    assert.match(canvasCode, /eventBadgeForLocation\(loc\.id, map, locationQuestCount\)/);
});

test('badge calculation reads provided map and does not call ensureMemory', () => {
    let reads = 0;
    const map = { events: [
        { locationId: 'a', status: 'held' },
        { locationId: 'a', status: 'ignored' },
        { locationId: 'b', status: 'held' },
    ] };
    const badge = new Function('ensureMemory', badgeCode + '\nreturn eventBadgeForLocation;')(
        () => { reads++; return { map }; },
    );
    assert.match(badge('a', map), />1<\/i>/);
    assert.equal(reads, 0);
    assert.match(badge('a', map, 2), />2<\/i>/);
    assert.equal(badge('x', map), '');
    assert.equal(reads, 0);
    assert.match(badge('b'), />1<\/i>/);
    assert.equal(reads, 1);
});

test('legacy memory migrations, rollback, and notebook saves remain untouched', () => {
    assert.match(source, /function attachCharacterNotebook\(/);
    assert.match(source, /function runLegacySharedNotebookCleanupOnce\(/);
    assert.match(source, /function restorePreviousMap\(/);
    assert.match(source, /const sharedNotebookChanged = persistCharacterNotebook\(memory\)/);
    assert.match(source, /await saveSillyTavernSettings\(\)/);
    assert.match(source, /if \(typeof ctx\.saveMetadata === 'function'\) await ctx\.saveMetadata\(\)/);
});
