import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8');
function part(from, to) {
  const begin = source.indexOf(from);
  const end = source.indexOf(to, begin + from.length);
  assert.ok(begin >= 0 && end > begin, 'missing source snippet: ' + from);
  return source.slice(begin, end);
}
const view = part('function renderMapView() {', 'function renderCanvas(');
const selector = part('function selectLocation(locationId, memoryArg = null) {', 'function stripEventLinesFromLocationPalette(');
const panel = part('function renderLocationPanel(locationId, memoryArg = null) {', 'function statusLabel(');

function fixture() {
  const memory = { map: { locations: [{ id: 'A' }, { id: 'B' }] }, selectedLocationId: 'A' };
  let ensureCalls = 0;
  let saves = 0;
  const rendered = [];
  const nodes = [{ dataset: { id: 'A' } }, { dataset: { id: 'B' } }];
  for (const node of nodes) node.classList = { toggle() {} };
  const fn = new Function('ensureMemory','saveMemory','document','renderLocationPanel','toast',
    selector + '\nreturn selectLocation;')(
    () => { ensureCalls++; return memory; },
    () => { saves++; },
    { querySelectorAll: () => nodes },
    (...args) => rendered.push(args),
    () => {},
  );
  return { fn, memory, rendered, get ensureCalls() { return ensureCalls; }, get saves() { return saves; } };
}

test('pass-through selection avoids second ensureMemory and saves nothing on no-op', () => {
  const f = fixture();
  f.fn('A', f.memory);
  assert.equal(f.ensureCalls, 0);
  assert.equal(f.saves, 0);
  assert.equal(f.rendered.length, 1);
  assert.strictEqual(f.rendered[0][1], f.memory);
});

test('real changed selection still saves while reusing the same memory', () => {
  const f = fixture();
  f.fn('B', f.memory);
  assert.equal(f.saves, 1);
  assert.equal(f.ensureCalls, 0);
  assert.equal(f.memory.selectedLocationId, 'B');
  assert.strictEqual(f.rendered[0][1], f.memory);
});

test('direct selection entrypoint retains original memory fallback', () => {
  const f = fixture();
  f.fn('A');
  assert.equal(f.ensureCalls, 1);
  assert.equal(f.saves, 0);
});

test('map view passes memory through canvas and location selection', () => {
  assert.match(view, /renderCanvas\(memory\);/);
  assert.match(view, /selectLocation\(memory\.selectedLocationId, memory\);/);
});

test('location panel reuses supplied memory and preserves direct fallback', () => {
  assert.match(panel, /const memory = memoryArg \|\| ensureMemory\(\);/);
  assert.match(panel, /renderLocationEventSummaryCard\(event, location\)/);
  assert.match(panel, /renderActionPanel\(location\.id, false\)/);
});

test('rollback, persistence and notebook structures remain intact', () => {
  assert.match(source, /function restorePreviousMap\(/);
  assert.match(source, /const sharedNotebookChanged = persistCharacterNotebook\(memory\)/);
  assert.match(source, /function attachCharacterNotebook\(/);
});
