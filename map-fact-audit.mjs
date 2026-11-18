// Pure, report-only checks adapted from the supplied D0 audit kit.
const key = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const visible = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const evidenceSections = new Set(['character', 'persona', 'roleplay', 'lore']);

const issue = (severity, code, path, detail, evidence = '') => ({ severity, code, path, detail, evidence });
const matched = (a, b, aliases = {}) => {
  const k = key(a);
  if (k === key(b)) return true;
  const aKey = key(aliases[k] || '');
  return !!aKey && aKey === key(b);
};

/**
 * Bind a human-reviewed fact to exact excerpts from this request's source
 * sections. Bindings describe what the cited text means; they never come from
 * the generated map. A missing excerpt leaves the binding unverified.
 */
export function buildSourceFactContract(sections, bindings = []) {
    const contract = { version: 1, name: 'transmitted-source-review', scope: { kind: 'unspecified' }, facts: {}, evidence: [], unverified: [] };
    const active = [];
    for (const binding of bindings) {
        const { kind, status, value, sources } = binding ?? {};
        if (!kind || !['confirmed', 'unconfirmed', 'scheduled', 'completed'].includes(status)
            || !Array.isArray(sources) || !sources.length || !sources.every(source =>
                source && evidenceSections.has(source.section) && typeof sections[source.section] === 'string'
                && typeof source.quote === 'string' && source.quote.trim() && sections[source.section].includes(source.quote))) {
            contract.unverified.push({ kind });
            continue;
        }
        active.push({ kind, status, value, sources });
    }
    contract.evidence = active;
    const anchor = row => row.sources.map(({ section, quote }) => `${section}: ${quote}`).join('\n');
    const confirmed = kind => active.filter(row => row.kind === kind && row.status === 'confirmed');
    const clock = confirmed('currentClock');
    if (clock.length === 1 && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(clock[0].value)
        && anchor(clock[0]).includes(clock[0].value)) {
        contract.facts.currentClock = clock[0].value;
        contract.facts.currentClockSource = anchor(clock[0]);
    }
    const scopes = confirmed('scope');
    if (scopes.length === 1 && scopes[0].value === 'open') contract.scope = { kind: 'open', sourceAnchor: anchor(scopes[0]) };
    if (scopes.length === 1 && Array.isArray(scopes[0].value) && scopes[0].value.length
        && scopes[0].value.every(name => key(name) && key(anchor(scopes[0])).includes(key(name)))) {
        contract.scope = { kind: 'closed', allowedNames: scopes[0].value, sourceAnchor: anchor(scopes[0]) };
    }
    contract.placeAliases = Object.fromEntries(confirmed('alias').filter(row => Array.isArray(row.value) && row.value.length === 2
        && row.value.every(name => key(name) && key(anchor(row)).includes(key(name))))
        .map(row => [key(row.value[0]), row.value[1]]));
    for (const [kind, status, field, fieldSource] of [
        ['quest', 'completed', 'completedQuestTitles', 'completedQuestSource'],
        ['absent', 'confirmed', 'absentPeople', 'absentPeopleSource'],
    ]) {
        const rows = active.filter(row => row.kind === kind && row.status === status && typeof row.value === 'string'
            && key(row.value) && key(anchor(row)).includes(key(row.value)));
        if (!rows.length) continue;
        contract.facts[field] = rows.map(row => row.value);
        contract.facts[fieldSource] = rows.map(anchor).join('\n');
    }
    contract.facts.confirmedConflicts = confirmed('contradiction')
        .flatMap(row => (Array.isArray(row.value) ? row.value : [])
            .filter(phrase => typeof phrase === 'string' && phrase.trim())
            .map(phrase => ({ phrase, sourceAnchor: anchor(row) })));
    const walkableArea = confirmed('walkableArea').find(row => typeof row.value === 'string'
        && key(row.value) && key(anchor(row)).includes(key(row.value)));
    if (walkableArea) contract.facts.walkableAreaSource = anchor(walkableArea);
    return contract;
}

const explicitRemote = /(?:걸어\s*(?:갈|올|다닐)\s*수\s*없|직접\s*닿을\s*수\s*없는\s*먼\s*곳|도보\s*(?:구역|범위|권)\s*(?:의\s*)?밖|도보\s*구역(?:이|은)\s*아니|\b(?:cannot|can.t)\s+(?:be\s+)?(?:walk(?:ed)?|reach(?:ed)? on foot)|\b(?:outside|beyond) (?:the )?(?:walking|pedestrian) (?:area|boundary|zone))/iu;
const tentativeRoute = /(?:없는지|아닌지|없다면|아니라면|없을지도|라는 소문|\b(?:if|whether|might|rumou?r)\b|[?？])/iu;
function describesPin(excerpt, pin) {
    const text = key(excerpt);
    if (/^(?:이곳(?:은|이|에서는)|이 장소(?:는|가)|this (?:place|location) )/u.test(text)) return true;
    const name = key(pin);
    return Boolean(name && text.startsWith(name) && /^(?:[은는이가](?:\s|$)|[\s,:])/u.test(text.slice(name.length)));
}
export function auditMapFacts(rawMap, rawContract) {
  const map = rawMap && typeof rawMap === 'object' ? rawMap : {};
  const contract = rawContract && typeof rawContract === 'object' ? rawContract : {};
  const issues = [];
  const locations = Array.isArray(map.locations) ? map.locations : [];
  const facts = contract.facts && typeof contract.facts === 'object' ? contract.facts : {};
  const aliases = (contract.placeAliases && typeof contract.placeAliases === 'object') ? contract.placeAliases : {};

  // Only source-confirmed *closed* scopes may restrict map locations.
  const scope = contract.scope && typeof contract.scope === 'object' ? contract.scope : {};
  if (scope.kind === 'closed') {
    const allowed = Array.isArray(scope.allowedNames) ? scope.allowedNames : [];
    if (!allowed.length || !visible(scope.sourceAnchor)) {
      issues.push(issue('review', 'UNVERIFIABLE_SCOPE', 'contract.scope', 'Closed scope lacks independently sourced allowedNames/sourceAnchor; not enforced.'));
    } else {
      locations.forEach((loc, i) => {
        const name = visible(loc?.name);
        if (name && !allowed.some(x => matched(name, x, aliases))) {
          issues.push(issue('block', 'OUT_OF_SCOPE_LOCATION', `locations[${i}].name`, `Location ${JSON.stringify(name)} is outside the explicitly closed area.`, scope.sourceAnchor));
        }
      });
    }
  }
  // Open or unspecified scope: novel local places are part of the product.
  // An independently cited walking boundary can coexist with unnamed local
  // sites. Flag only a pin whose own prose explicitly puts it outside.
  if (visible(facts.walkableAreaSource)) locations.forEach((loc, index) => {
    for (const field of ['situation', 'details']) {
      const passages = Array.isArray(loc?.[field]) ? loc[field] : [loc?.[field]];
      const excerpt = passages.filter(x => typeof x === 'string').flatMap(x => x.split(/(?<=[.!?。！？])\s+/u))
        .find(x => describesPin(x, loc?.name) && explicitRemote.test(x) && !tentativeRoute.test(x));
      if (!excerpt) continue;
      issues.push({ ...issue('review', 'PIN_OUTSIDE_WALKABLE_AREA', 'locations[' + index + '].' + field,
          'Check a pin that describes its location as outside the cited walking boundary.', facts.walkableAreaSource), excerpt });
      break;
    }
  });

  const locKeys = new Set(locations.map(x => key(x?.name)).filter(Boolean));
  const curr = key(map.currentLocationName);
  if (curr && !locKeys.has(curr)) {
    issues.push(issue('block', 'CURRENT_LOCATION_NOT_RETURNED', 'currentLocationName', 'Current location does not match any returned location.'));
  }
  for (const groupName of ['worldEvents', 'personalEvents', 'events', 'footsteps']) {
    const group = Array.isArray(map[groupName]) ? map[groupName] : [];
    group.forEach((record, i) => {
      const name = visible(record?.locationName);
      if (name && !locKeys.has(key(name))) {
        issues.push(issue('block', 'REFERENCE_NOT_RETURNED', `${groupName}[${i}].locationName`, `${JSON.stringify(name)} is not a returned map location.`));
      }
    });
  }

  // Only exact independently-confirmed facts can be hard structural blockers.
  const completed = Array.isArray(facts.completedQuestTitles) ? facts.completedQuestTitles : [];
  if (completed.length && visible(facts.completedQuestSource)) {
    for (const groupName of ['worldEvents', 'personalEvents', 'events']) {
      (Array.isArray(map[groupName]) ? map[groupName] : []).forEach((event, i) => {
        if (completed.some(title => key(title) && key(title) === key(event?.title))) {
          issues.push(issue('block', 'COMPLETED_QUEST_REOFFERED', `${groupName}[${i}].title`, `Known completed quest ${JSON.stringify(event?.title)} was offered again.`, facts.completedQuestSource));
        }
      });
    }
  }

  const absent = Array.isArray(facts.absentPeople) ? facts.absentPeople : [];
  if (absent.length && visible(facts.absentPeopleSource)) {
    const checkPerson = (name, path) => {
      if (absent.some(item => key(item) && key(item) === key(name))) {
        issues.push(issue('block', 'ABSENT_PERSON_PRESENT', path, `A confirmed-absent person ${JSON.stringify(name)} is listed as present.`, facts.absentPeopleSource));
      }
    };
    locations.forEach((loc, i) => (Array.isArray(loc?.present) ? loc.present : []).forEach((x, j) => checkPerson(x, `locations[${i}].present[${j}]`)));
    (Array.isArray(map.footsteps) ? map.footsteps : []).forEach((x, i) => checkPerson(x?.label, `footsteps[${i}].label`));
  }

  const knownClock = visible(facts.currentClock);
  if (knownClock && visible(facts.currentClockSource)) {
    const allClockTokens = (String(map.timeHint || '').match(/(?:^|\D)([01]?\d|2[0-3]):[0-5]\d\b/g) || [])
      .map(x => x.match(/\d{1,2}:\d{2}/)?.[0]).filter(Boolean)
      .map(x => x.padStart(5,'0'));
    const expectedClock = knownClock.padStart(5,'0');
    if (!allClockTokens.includes(expectedClock)) {
      issues.push(issue('review', 'CURRENT_CLOCK_NOT_EXPLICIT', 'timeHint', `Source confirms current time ${expectedClock}; model timeHint does not explicitly repeat it.`, facts.currentClockSource));
    }
  }

  // Only reviewed contradictions of established facts are eligible here.
  // A new detail in the map is not a claim about the source transcript.
  const contradictions = Array.isArray(facts.confirmedConflicts) ? facts.confirmedConflicts : [];
  if (contradictions.length) {
    const inspect = (value, path) => {
      if (typeof value === 'string') {
        for (const excerpt of visible(value).split(/(?<=[.!?。！？])\s+/u)) {
          for (const row of contradictions) {
            if (!visible(row?.phrase) || !visible(row?.sourceAnchor) || !key(excerpt).includes(key(row.phrase))) continue;
            issues.push({ ...issue('review', 'CONFIRMED_FACT_CONFLICT_CANDIDATE', path,
                'Compare this wording with the cited established fact and its context.', row.sourceAnchor), excerpt });
          }
        }
        return;
      }
      if (Array.isArray(value)) value.forEach((item, i) => inspect(item, path + '[' + i + ']'));
      else if (value && typeof value === 'object') for (const [field, item] of Object.entries(value)) inspect(item, path + '.' + field);
    };
    inspect({ timeHint: map.timeHint, worldSummary: map.worldSummary, locations, worldEvents: map.worldEvents,
      personalEvents: map.personalEvents, events: map.events, footsteps: map.footsteps }, 'map');
  }

  return {
    meta: { auditVersion: 1, mode: 'report-only', sourceContract: contract.name || 'unidentified', scopeKind: scope.kind || 'unspecified', locations: locations.length },
    passedHardChecks: !issues.some(x=>x.severity==='block'),
    blockers: issues.filter(x=>x.severity==='block'),
    review: issues.filter(x=>x.severity==='review'),
    note: 'No map data was altered. Phrase matches are review hints, not reliable factual classifiers. Review does not imply proof of hallucination.',
  };
}
