(function (root) {
  'use strict';
  const UNAVAILABLE = 'Travel estimate unavailable—staff review required';
  const MAX_AGE_MS = 60 * 60 * 1000;
  const string = value => typeof value === 'string' ? value.trim() : '';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const ids = state => state.moveType === 'transport' ? ['fromAddress', 'toAddress'] : ['fromAddress'];
  const locationField = id => id === 'toAddress' ? 'toLocation' : 'fromLocation';
  function config() {
    return root.MFTNB_MAPS_CONFIG || (typeof module !== 'undefined' && module.exports ? require('./maps-config.js') : { browserKey: '', shop: {} });
  }
  function hasPin(loc) {
    return !!loc && finite(loc.lat) && finite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180;
  }
  function locationKey(loc) {
    return JSON.stringify([loc.provider, loc.formattedAddress, loc.municipality, loc.unit, loc.placeId, loc.lat, loc.lng]);
  }
  function cleanLocation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const loc = {};
    for (const key of ['formattedAddress', 'municipality', 'unit', 'placeId', 'confirmedAt']) {
      loc[key] = string(value[key]).slice(0, key === 'formattedAddress' ? 2000 : 250);
    }
    if (!loc.formattedAddress) return null;
    loc.provider = value.provider === 'google' ? 'google' : 'manual';
    loc.lat = hasPin(value) ? value.lat : null;
    loc.lng = hasPin(value) ? value.lng : null;
    if (loc.provider !== 'google') { loc.placeId = ''; loc.lat = null; loc.lng = null; }
    loc.confirmed = value.confirmed === true && !!loc.municipality &&
      Number.isFinite(Date.parse(loc.confirmedAt)) && Date.parse(loc.confirmedAt) <= Date.now() + 60000 &&
      value.confirmedKey === locationKey(loc);
    loc.confirmedKey = loc.confirmed ? locationKey(loc) : '';
    return loc;
  }
  function confirmLocation(loc) {
    return cleanLocation({ ...loc, confirmed: true, confirmedKey: locationKey(loc), confirmedAt: new Date().toISOString() });
  }
  function isConfirmed(state, id) {
    const loc = cleanLocation(state[locationField(id)]);
    return !!loc?.confirmed && string(state[id]) === loc.formattedAddress;
  }
  function invalidate(state, id) {
    const key = locationField(id);
    if (state[key]) state[key] = { ...state[key], confirmed: false, confirmedKey: '', confirmedAt: '' };
    delete state.travel;
  }
  function mapsLink(loc) {
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1');
    url.searchParams.set('query', hasPin(loc) ? `${loc.lat},${loc.lng}` : [loc.formattedAddress, loc.municipality].filter(Boolean).join(', '));
    if (loc.provider === 'google' && loc.placeId) url.searchParams.set('query_place_id', loc.placeId);
    return url.href;
  }
  function shopLocation(settings) {
    const shop = settings?.shop;
    if (!shop || shop.confirmed !== true || !string(shop.confirmedBy) || !Number.isFinite(Date.parse(shop.confirmedAt)) ||
      !string(shop.formattedAddress) || !string(shop.municipality) || !hasPin(shop)) return null;
    return { ...shop, provider: 'google' };
  }
  function routeSpec(state, settings = config()) {
    if (!['transport', 'same-property', 'load-only', 'unload-only'].includes(state.moveType)) return null;
    const shop = shopLocation(settings);
    if (!shop || !ids(state).every(id => isConfirmed(state, id))) return null;
    const locations = ids(state).map(id => cleanLocation(state[locationField(id)]));
    if (locations.some(loc => loc.provider !== 'google' || !loc.placeId || !hasPin(loc))) return null;
    const stops = [shop, ...locations, shop];
    const labels = state.moveType === 'transport' ? ['Shop → pickup', 'Pickup → drop-off', 'Drop-off → shop'] :
      ['Shop → work address', 'Work address → shop'];
    const fingerprint = JSON.stringify([state.moveType, string(state.moveDate), string(state.moveTime),
      shop.confirmedAt, ...stops.map(locationKey), ...locations.map(loc => loc.confirmedAt)]);
    return { stops, labels, fingerprint };
  }
  function routeResult(spec, route, now = Date.now()) {
    if (!spec || !Array.isArray(route?.legs) || route.legs.length !== spec.labels.length) throw new Error(UNAVAILABLE);
    const legs = route.legs.map((leg, i) => {
      if (!finite(leg.durationMillis) || leg.durationMillis < 0 || !finite(leg.distanceMeters) || leg.distanceMeters < 0) throw new Error(UNAVAILABLE);
      return { label: spec.labels[i], durationSeconds: leg.durationMillis / 1000, distanceMeters: leg.distanceMeters };
    });
    const totalSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
    if (!finite(totalSeconds) || totalSeconds <= 0) throw new Error(UNAVAILABLE);
    return { status: 'available', fingerprint: spec.fingerprint, calculatedAt: new Date(now).toISOString(),
      source: 'Google Maps', traffic: 'TRAFFIC_UNAWARE', legs, totalSeconds,
      betweenAddressDriveHours: legs.length === 3 ? legs[1].durationSeconds / 3600 : 0,
      depotDriveHours: (legs[0].durationSeconds + legs[legs.length - 1].durationSeconds) / 3600 };
  }
  function currentTravel(state, settings = config(), now = Date.now()) {
    const saved = state.travel, spec = routeSpec(state, settings);
    if (!spec || saved?.status !== 'available' || saved.fingerprint !== spec.fingerprint) return null;
    const timestamp = Date.parse(saved.calculatedAt);
    if (!finite(timestamp) || now - timestamp > MAX_AGE_MS || timestamp > now + 60000) return null;
    // Recompute totals from the legs. Never trust client-provided totals or default missing values to zero.
    try {
      const result = routeResult(spec, { legs: saved.legs.map(leg => ({ durationMillis: leg.durationSeconds * 1000, distanceMeters: leg.distanceMeters })) }, timestamp);
      result.warnings = Array.isArray(saved.warnings) ? saved.warnings.map(string) : [];
      return result;
    }
    catch { return null; }
  }
  function reviewedJobHours(state, reviewed, settings = config()) {
    if (!reviewed || !string(reviewed.approvedBy) || !string(reviewed.evidenceRef) ||
      !finite(reviewed.onSiteHours) || reviewed.onSiteHours <= 0) throw new Error('Staff-reviewed on-site hours and evidence are required.');
    const travel = currentTravel(state, settings);
    if (!travel) throw new Error(UNAVAILABLE);
    return { onSiteHours: reviewed.onSiteHours, estimatedBillableJobHours: reviewed.onSiteHours + travel.totalSeconds / 3600,
      betweenAddressDriveHours: travel.betweenAddressDriveHours, depotDriveHours: travel.depotDriveHours };
  }
  function duration(seconds) {
    if (!finite(seconds) || seconds < 0) return 'Unavailable';
    if (seconds > 0 && seconds < 60) return '<1 min';
    const minutes = Math.round(seconds / 60), hours = Math.floor(minutes / 60);
    return hours ? `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  }
  function planLines(state, settings = config()) {
    const lines = ['LOCATIONS & TRAVEL'];
    ids(state).forEach(id => {
      const loc = cleanLocation(state[locationField(id)]);
      const label = id === 'toAddress' ? 'Destination' : state.moveType === 'transport' ? 'Pickup' : 'Work location';
      if (!loc || string(state[id]) !== loc.formattedAddress) { lines.push(`${label}: address/pin confirmation required.`); return; }
      lines.push(`${label}: ${loc.formattedAddress}`, `Municipality: ${loc.municipality || 'Not confirmed'}; Unit / lot: ${loc.unit || 'None supplied'}`,
        `Customer confirmation: ${isConfirmed(state, id) ? `confirmed ${loc.confirmedAt}` : 'not confirmed'}`,
        `Location source: ${loc.provider === 'google' ? `Google Maps; place ID ${loc.placeId}; pin ${loc.lat}, ${loc.lng}` : 'Manually entered; pin unverified—staff review required'}`,
        `Google Maps: ${mapsLink(loc)}`);
    });
    const shop = shopLocation(settings);
    lines.push(shop ? `Shop: ${shop.formattedAddress}; unit / lot: ${shop.unit || 'None'}; pin ${shop.lat}, ${shop.lng}; ${mapsLink(shop)}` :
      'Shop pin: awaiting owner confirmation.');
    const travel = currentTravel(state, settings);
    if (travel) {
      travel.legs.forEach(leg => lines.push(`${leg.label}: ${duration(leg.durationSeconds)} (${(leg.distanceMeters / 1000).toFixed(1)} km)`));
      (travel.warnings || []).forEach(warning => lines.push(`Google Maps note: ${warning}`));
      lines.push(`Total estimated travel: ${duration(travel.totalSeconds)}. Google Maps, calculated ${travel.calculatedAt}.`,
        'Driving estimate excludes live traffic, loading and unloading. Staff must check vehicle access and road restrictions.');
    } else lines.push(UNAVAILABLE);
    lines.push(state.moveType === 'transport'
      ? 'Estimated billable job hours = shop → pickup + loading/work + pickup → drop-off + unloading/work + drop-off → shop.'
      : 'Estimated billable job hours = shop → work address + on-site work + work address → shop.',
    `Staff-reviewed on-site hours: pending. Total estimated billable job hours: pending${travel ? ' on-site review' : ' travel and on-site review'}.`);
    return lines;
  }
  function fromGoogle(place, unit = '') {
    const components = place.addressComponents || [];
    const component = type => components.find(c => c.types?.includes(type))?.longText || '';
    const municipality = component('locality') || component('postal_town') || component('administrative_area_level_3') || component('administrative_area_level_2');
    const specific = component('street_number') || (place.types || []).some(type => ['premise', 'subpremise', 'establishment', 'point_of_interest'].includes(type));
    const lat = place.location?.lat(), lng = place.location?.lng();
    if (!specific || !place.id || !place.formattedAddress || !municipality || !hasPin({ lat, lng })) {
      throw new Error('Choose a specific street address, building or rural site. You can also enter the address manually for staff review.');
    }
    return cleanLocation({ provider: 'google', formattedAddress: place.formattedAddress, municipality,
      unit: string(unit) || component('subpremise'), placeId: place.id, lat, lng });
  }
  function withTimeout(promise, milliseconds = 12000) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(UNAVAILABLE)), milliseconds); })]).finally(() => clearTimeout(timer));
  }
  let googlePromise;
  function loadGoogle(settings = config()) {
    if (!string(settings.browserKey)) return Promise.reject(new Error('Google Maps is not configured.'));
    if (root.google?.maps?.importLibrary) return Promise.resolve(root.google.maps);
    if (googlePromise) return googlePromise;
    googlePromise = withTimeout(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      Object.entries({ key: settings.browserKey, v: 'weekly', loading: 'async', callback: '__mftnbMapsReady', region: 'CA', language: 'en' }).forEach(([k, v]) => url.searchParams.set(k, v));
      root.__mftnbMapsReady = () => resolve(root.google.maps);
      const oldFailure = root.gm_authFailure;
      root.gm_authFailure = () => { reject(new Error(UNAVAILABLE)); root.dispatchEvent(new Event('mftnb-maps-error')); if (oldFailure) oldFailure(); };
      script.src = url.href; script.async = true; script.onerror = () => reject(new Error(UNAVAILABLE)); document.head.append(script);
    }));
    return googlePromise;
  }
  async function calculate(state, settings = config()) {
    const spec = routeSpec(state, settings);
    if (!spec) throw new Error(UNAVAILABLE);
    const maps = await loadGoogle(settings);
    const [{ Route }, { Place }] = await withTimeout(Promise.all([maps.importLibrary('routes'), maps.importLibrary('places')]));
    const shop = { lat: spec.stops[0].lat, lng: spec.stops[0].lng };
    const response = await withTimeout(Route.computeRoutes({ origin: shop, destination: shop,
      intermediates: spec.stops.slice(1, -1).map(loc => ({ location: new Place({ id: loc.placeId }), via: false })),
      travelMode: 'DRIVING', routingPreference: 'TRAFFIC_UNAWARE', optimizeWaypointOrder: false,
      units: 'METRIC', region: 'ca', fields: ['legs', 'warnings'] }));
    const result = routeResult(spec, response.routes?.[0]);
    result.warnings = Array.isArray(response.routes?.[0]?.warnings) ? response.routes[0].warnings.map(string) : [];
    return result;
  }

  // One address control lives inside the estimator's existing question composer.
  function mountAddress({ container, id, state, onInvalidate, settings = config() }) {
    let alive = true, revision = 0, candidate = cleanLocation(state[locationField(id)]), widget, selectedValue = '';
    let mode = settings.browserKey ? 'google' : 'manual';
    const make = (tag, className, value) => { const el = document.createElement(tag); el.className = className || ''; if (value) el.textContent = value; return el; };
    const host = make('div', 'address-control'); container.append(host);
    const searchHost = make('div', 'address-search');
    const note = make('p', 'address-note'); note.setAttribute('role', 'status');
    const manual = make('div', 'address-manual');
    function input(parent, name, label, value, autocomplete) {
      const wrap = make('label', 'address-field', label), el = make('input', 'input-field');
      el.type = 'text'; el.id = name; if (name === `input-${id}`) el.name = id; el.value = value || ''; el.maxLength = name.includes('municipality') || name.includes('unit') ? 250 : 2000;
      el.autocomplete = autocomplete; wrap.append(el); parent.append(wrap); return el;
    }
    const address = input(manual, `input-${id}`, 'Street / rural address (without unit or lot)', state[id], 'street-address');
    const town = input(manual, `municipality-${id}`, 'City / town / municipality', candidate?.municipality, 'address-level2');
    const unit = input(host, `unit-${id}`, 'Unit / lot number (optional)', candidate?.unit, 'off');
    const toggle = make('button', 'btn-link'); toggle.type = 'button';
    const card = make('div', 'address-card');
    const checkLabel = make('label', 'address-confirm'), check = make('input'); check.type = 'checkbox'; check.id = `confirm-${id}`;
    const checkText = make('span'); checkLabel.append(check, checkText);
    host.prepend(searchHost, manual); host.append(note, toggle, card, checkLabel);
    function invalidateCandidate(keepPin = false) {
      revision++; check.checked = false;
      if (!keepPin) candidate = null;
      else if (candidate) candidate = { ...candidate, confirmed: false, confirmedAt: '', confirmedKey: '', unit: unit.value.trim() };
      onInvalidate();
    }
    function manualCandidate() {
      const entered = address.value.trim(), municipality = town.value.trim();
      // Bind the separate municipality into the legacy full-address field too.
      // Identical street numbers in different towns must never compare as one address.
      const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedTown = normalize(municipality);
      const escapedTown = normalizedTown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const province = '(?:ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt|alberta|british columbia|manitoba|new brunswick|newfoundland and labrador|nova scotia|northwest territories|nunavut|ontario|prince edward island|quebec|saskatchewan|yukon)';
      const suffix = new RegExp(`(?:^| )${escapedTown}(?: ${province})?(?: [a-z][0-9][a-z] ?[0-9][a-z][0-9])?(?: canada)?$`);
      const includesTown = entered.split(',').some(part => normalize(part) === normalizedTown) || suffix.test(normalize(entered));
      const formattedAddress = entered && municipality && !includesTown ? `${entered}, ${municipality}` : entered;
      return cleanLocation({ provider: 'manual', formattedAddress, municipality, unit: unit.value.trim() });
    }
    function draw() {
      if (!alive) return;
      manual.hidden = mode !== 'manual'; searchHost.hidden = mode !== 'google';
      toggle.hidden = !settings.browserKey;
      toggle.textContent = mode === 'google' ? 'Enter address manually' : 'Search with Google Maps';
      card.replaceChildren();
      const loc = mode === 'manual' ? manualCandidate() : candidate;
      check.disabled = !loc?.formattedAddress || !loc?.municipality;
      checkText.textContent = mode === 'google' ? 'I checked the map pin and municipality. This is the correct location.' : 'I confirm the full address and municipality above are correct.';
      if (!loc) return;
      card.append(make('strong', 'address-municipality', loc.municipality || 'Add the municipality'), make('p', 'address-full', loc.formattedAddress));
      if (loc.unit) card.append(make('p', 'address-unit', `Unit / lot: ${loc.unit}`));
      const link = make('a', 'address-map-link', mode === 'google' ? 'Open this pin in Google Maps ↗' : 'Check this address in Google Maps ↗');
      link.href = mapsLink(loc); link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
      if (mode === 'google' && hasPin(loc) && settings.browserKey) {
        const map = make('iframe', 'address-map'); map.title = `Map pin for ${loc.formattedAddress}`; map.loading = 'lazy';
        map.referrerPolicy = 'strict-origin-when-cross-origin';
        const url = new URL('https://www.google.com/maps/embed/v1/place');
        url.searchParams.set('key', settings.browserKey); url.searchParams.set('q', `place_id:${loc.placeId}`); url.searchParams.set('zoom', '17');
        map.src = url.href; card.append(map);
      } else card.append(make('p', 'address-note', 'Pin unverified—staff will check this location.'));
    }
    function useManual(message) {
      if (!alive) return;
      invalidateCandidate(); mode = 'manual'; note.textContent = message || 'Enter the full address and municipality. Staff will verify the pin and travel.'; draw();
    }
    [address, town].forEach(el => el.addEventListener('input', () => { invalidateCandidate(); draw(); }));
    unit.addEventListener('input', () => { invalidateCandidate(true); draw(); });
    check.addEventListener('change', () => {
      if (!check.checked) { invalidateCandidate(true); draw(); return; }
      candidate = confirmLocation(mode === 'manual' ? manualCandidate() : { ...candidate, unit: unit.value.trim() });
    });
    toggle.addEventListener('click', () => {
      if (mode === 'google') useManual();
      else { invalidateCandidate(); mode = 'google'; note.textContent = 'Select a Google result, then check the municipality and pin.'; if (widget) widget.value = ''; draw(); }
    });
    function onAuthFailure() { useManual('Google Maps could not load. Enter your address below; travel estimate unavailable—staff review required.'); }
    root.addEventListener('mftnb-maps-error', onAuthFailure);
    if (candidate && candidate.formattedAddress !== string(state[id])) candidate = null;
    if (candidate?.provider === 'manual') mode = 'manual';
    check.checked = isConfirmed(state, id);
    note.textContent = settings.browserKey ? 'Select a Google result, then check the municipality and pin.' :
      'Enter the full address and municipality. Travel estimate unavailable—staff review required.';
    draw();
    if (settings.browserKey) {
      loadGoogle(settings).then(maps => withTimeout(maps.importLibrary('places'))).then(({ PlaceAutocompleteElement }) => {
        if (!alive) return;
        widget = new PlaceAutocompleteElement({ includedRegionCodes: ['ca'], requestedRegion: 'ca', placeholder: 'Search street address and town' });
        widget.setAttribute('aria-label', id === 'toAddress' ? 'Search destination address' : 'Search pickup or work address');
        widget.value = candidate?.provider === 'google' ? candidate.formattedAddress : ''; selectedValue = widget.value;
        searchHost.append(widget);
        widget.addEventListener('input', () => { invalidateCandidate(); note.textContent = 'Select an address from the Google results.'; draw(); });
        widget.addEventListener('gmp-error', onAuthFailure);
        widget.addEventListener('gmp-select', async event => {
          invalidateCandidate(); const requestedRevision = revision;
          note.textContent = 'Loading the selected location…'; draw();
          try {
            const place = event.placePrediction.toPlace();
            await withTimeout(place.fetchFields({ fields: ['id', 'formattedAddress', 'location', 'addressComponents', 'types'] }));
            if (!alive || revision !== requestedRevision || mode !== 'google') return;
            candidate = fromGoogle(place, unit.value);
            unit.value = candidate.unit; address.value = candidate.formattedAddress; town.value = candidate.municipality;
            widget.value = candidate.formattedAddress; selectedValue = widget.value;
            note.textContent = 'Check the town and pin below before confirming.'; draw();
          } catch (error) { if (alive && revision === requestedRevision) useManual(error.message || UNAVAILABLE); }
        });
      }).catch(onAuthFailure);
    }
    return {
      read() {
        if (mode === 'google' && (!widget || widget.value !== selectedValue)) {
          invalidateCandidate(); draw(); return { error: 'Select an address from Google Maps and confirm its pin, or enter it manually for staff review.' };
        }
        const loc = mode === 'manual' ? manualCandidate() : candidate;
        if (!loc?.formattedAddress || !loc.municipality) return { error: 'Enter the full address and its municipality.' };
        if (!check.checked) return { error: 'Please confirm the address and municipality before continuing.' };
        return { location: confirmLocation({ ...loc, unit: unit.value.trim() }) };
      },
      focus() { if (mode === 'manual') address.focus({ preventScroll: true }); else widget?.focus(); },
      dispose() { alive = false; revision++; root.removeEventListener('mftnb-maps-error', onAuthFailure); }
    };
  }
  const api = { UNAVAILABLE, MAX_AGE_MS, config, ids, locationField, locationKey, cleanLocation, confirmLocation, isConfirmed, invalidate,
    mapsLink, hasPin, shopLocation, routeSpec, routeResult, currentTravel, reviewedJobHours, duration, planLines, fromGoogle, calculate, mountAddress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MFTNBTravel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
