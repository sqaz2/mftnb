'use strict';

// Public quote requests are not calibrated price estimates. See docs/ESTIMATOR-AUDIT.md.
const ESTIMATOR_VERSION = '2026-09-11-review-first';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz2kTp_RynPKZptrLJrsv_DvS_-el2bzBz8Jc_QaEej2nHop5iABnMcuEa5pff2No9W8g/exec';
const TURNSTILE_SITE_KEY = '0x4AAAAAAB2kYqJ0EOGNbli7';
const STORAGE_KEY = 'mftnb-estimate-v4';
const LEGACY_STORAGE_KEY = 'mftnb-estimate-v3';
const MOVE_TYPES = Object.freeze({
  'same-property': 'Within the same property (no transport between addresses)',
  transport: 'Moving between addresses with transport',
  'load-only': 'Loading help only (your truck or container)',
  'unload-only': 'Unloading help only (your truck or container)'
});
const COUNT_FIELDS = ['boxCount', 'smallItemCount', 'twoPersonItems', 'fragileItems'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const text = v => typeof v === 'string' ? v.trim() : '';

function numericField(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || text(value) === 'unknown') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function normalizeAddress(value) {
  // Conservative comparison only: do not strip unit numbers or infer locations from city names.
  return text(value).normalize('NFKC').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}
function addressesMatch(a, b) {
  const value = normalizeAddress(a);
  return value.length >= 8 && /\d/.test(value) && value === normalizeAddress(b);
}
function computeMoveModel(state = {}) {
  const type = has(MOVE_TYPES, state.moveType) ? state.moveType : null;
  const counts = Object.fromEntries(COUNT_FIELDS.map(key => [key, numericField(state[key])]));
  const errors = [];
  COUNT_FIELDS.forEach(key => {
    if (has(state, key) && state[key] !== 'unknown' &&
      (counts[key] === null || !Number.isInteger(counts[key]) || counts[key] > 10000)) {
      errors.push(`${key}: use a whole number from 0 to 10000, or choose Not sure.`);
    }
  });
  ['carryDistance', 'stairsFrom', 'stairsTo'].forEach(key => {
    if (!has(state, key) || state[key] === 'unknown') return;
    const n = numericField(state[key]);
    const max = key === 'carryDistance' ? 1000 : 100;
    if (n === null || n > max || !Number.isInteger(n * 2)) errors.push(`${key}: enter a valid non-negative half-step value.`);
  });
  const base = [counts.boxCount, counts.smallItemCount, counts.twoPersonItems];
  const totalUnits = base.every(n => n !== null) ? base.reduce((a, b) => a + b, 0) : null;
  if (totalUnits !== null && counts.fragileItems !== null && counts.fragileItems > totalUnits) {
    errors.push('Fragile pieces are part of the inventory above, not additional items. Please check the counts.');
  }
  const sameAddress = addressesMatch(state.fromAddress, state.toAddress);
  if (type === 'transport' && sameAddress) {
    errors.push('The two addresses match. Choose within the same property, or correct the destination.');
  }
  const reviewReasons = ['The team must confirm crew size, time, the applicable rate and any charges before you book.'];
  if (!type) reviewReasons.push('Select the kind of work required.');
  if (totalUnits === null) reviewReasons.push('Inventory is incomplete or includes quantities marked Not sure.');
  if (totalUnits === 0) reviewReasons.push('No moving inventory listed. Clarify whether you need another service.');
  if (text(state.specialItems)) reviewReasons.push('Specialty items need an equipment and access review.');
  if (Array.isArray(state.extraServices) && state.extraServices.length) reviewReasons.push('Extra services must be scoped and priced separately.');
  return {
    version: ESTIMATOR_VERSION, status: errors.length ? 'needs-correction' : 'review-required',
    moveType: type, sameAddress, counts, totalUnits, errors, reviewReasons,
    transportBetweenAddresses: type ? type === 'transport' : null,
    travelNote: !type ? 'Travel requirements not confirmed.' : type === 'transport'
      ? 'Route, driving time and any transport or crew call-out charge require review; no flat fee has been added.'
      : 'No transport between addresses requested. Any crew call-out or depot travel charge must be confirmed separately; no flat fee has been added.',
    crewSize: null, productiveHours: null, estimatedCost: null, costRange: null,
    perMoverRate: null, travelFee: null
  };
}

// Arithmetic for a STAFF-REVIEWED plan, never a time prediction from item counts.
// Not called by the public form. Amounts are CAD; tax and each fee must be explicit.
function priceReviewedPlan(plan) {
  if (!plan || !text(plan.approvedBy) || !text(plan.evidenceRef)) throw new Error('A reviewed plan and rate source are required.');
  const required = ['crewSize', 'crewHours', 'hourlyRate', 'minimumHours', 'billingIncrementMinutes', 'betweenAddressDriveHours', 'depotDriveHours', 'callOutFee', 'transportFee', 'taxRate'];
  required.forEach(key => { if (typeof plan[key] !== 'number' || !Number.isFinite(plan[key]) || plan[key] < 0) throw new Error(`Invalid ${key}`); });
  if (!has(MOVE_TYPES, plan.moveType) || !['per-crew', 'per-mover'].includes(plan.rateBasis)) throw new Error('Specify move type and rate basis.');
  if (!Number.isInteger(plan.crewSize) || plan.crewSize < 1 || plan.crewHours <= 0 || plan.hourlyRate <= 0 || plan.billingIncrementMinutes <= 0 || plan.taxRate > 1) throw new Error('Invalid crew, duration, billing increment or tax.');
  if (plan.moveType !== 'transport' && (plan.betweenAddressDriveHours !== 0 || plan.transportFee !== 0)) throw new Error('This scope does not include inter-address transport.');
  const crewRate = plan.hourlyRate * (plan.rateBasis === 'per-mover' ? plan.crewSize : 1);
  const actualCrewHours = plan.crewHours + plan.betweenAddressDriveHours + plan.depotDriveHours;
  const step = plan.billingIncrementMinutes / 60;
  const billedCrewHours = Math.ceil((Math.max(actualCrewHours, plan.minimumHours) - 1e-9) / step) * step;
  const labourCents = Math.round(billedCrewHours * crewRate * 100);
  const callOutCents = Math.round(plan.callOutFee * 100);
  const transportCents = Math.round(plan.transportFee * 100);
  const subtotalCents = labourCents + callOutCents + transportCents;
  const taxCents = Math.round(subtotalCents * plan.taxRate);
  if (![labourCents, callOutCents, transportCents, subtotalCents, taxCents, subtotalCents + taxCents].every(Number.isSafeInteger)) throw new Error('Amount out of range.');
  return { currency: 'CAD', rateBasis: plan.rateBasis, crewRate, billedCrewHours,
    onSiteWorkerHours: plan.crewHours * plan.crewSize, labourCents, callOutCents,
    transportCents, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

const select = (id, label, prompt, values, extra = {}) => ({ id, label, prompt, type: 'select', required: true, options: values.map(v => typeof v === 'string' ? { value: v, label: v } : v), ...extra });
const count = (id, label, prompt, extra = {}) => ({ id, label, prompt, type: 'number', required: true, min: 0, max: 10000, step: 1, unknown: true, ...extra });
const questionList = [
  select('moveType', 'Kind of move', 'First, what kind of moving help do you need?', Object.entries(MOVE_TYPES).map(([value, label]) => ({ value, label }))),
  { id: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name', prompt: 'What is your name?' },
  { id: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email', prompt: 'What email should we use for your request?' },
  { id: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel', prompt: 'What phone number can we call or text about your move?' },
  { id: 'fromAddress', label: 'Pickup / work address', type: 'textarea', required: true, prompt: s => s.moveType === 'transport' ? 'Where are you moving from? Include the address, unit and city.' : 'Where will the work take place? Include the address, unit and city.' },
  { id: 'toAddress', label: 'Destination address', type: 'textarea', required: true, when: s => s.moveType === 'transport', prompt: 'What is the destination address, including the unit and city?' },
  { id: 'onSiteDetails', label: 'On-site route', type: 'textarea', required: true, when: s => s.moveType === 'same-property', prompt: 'Where are the items moving within the property? For example, basement to garage, or one unit to another.' },
  select('homeType', 'Home / property type', 'What kind of property are we working at?', ['Apartment / condo', 'Townhouse / duplex', 'Single-family home', 'Acreage / farm', 'Office / commercial', 'Storage unit', 'Other / unsure']),
  select('bedrooms', 'Rooms involved', 'How many rooms are involved? Count only the rooms you need help with.', ['A few items only', 'Studio / bachelor', '1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms', 'Other / unsure']),
  count('boxCount', 'Boxes or totes', 'How many packed boxes or totes need moving? Count each item only once across the next three questions.'),
  count('smallItemCount', 'Other one-person items', 'How many other items can one mover carry? Do not include boxes or items needing two movers.'),
  count('twoPersonItems', 'Two-person items', 'How many items need two movers, such as sofas, dressers or appliances? Do not count them again elsewhere.'),
  count('fragileItems', 'Fragile subset', 'Of the items already counted, how many are fragile and need extra care?', { helper: 'This marks existing items for care; it does not add extra items to your inventory.' }),
  count('carryDistance', 'Longest carry (metres)', s => s.moveType === 'same-property' ? 'About how far is the longest carry within the property, in metres?' : 'About how far is the longest carry between the vehicle and the door, in metres?', { max: 1000, step: 0.5 }),
  count('stairsFrom', 'Stair flights to carry', s => s.moveType === 'transport' ? 'How many flights must items be carried over at pickup?' : 'How many flights must items be carried over along the work route?', { max: 100, step: 0.5, helper: 'Use 0 for a step-free route. Half-flights are allowed. Do not count floors covered by an elevator.' }),
  count('stairsTo', 'Destination stair flights', 'How many flights must items be carried over at the destination?', { max: 100, step: 0.5, when: s => s.moveType === 'transport', helper: 'Count only stairs actually carried, not floors covered by an elevator.' }),
  select('elevatorAccess', 'Elevator use', 'Will the move use an elevator?', ['Not needed / ground floor', 'None — using stairs', 'Shared elevator', 'Booked elevator', 'Not sure']),
  { id: 'parkingDistance', label: 'Parking / vehicle access', type: 'textarea', required: false, prompt: 'Any parking, loading bay, vehicle-height or time-limit restrictions? Leave blank if none.' },
  { id: 'accessDetails', label: 'Other access details', type: 'textarea', required: false, prompt: 'Any tight turns, narrow halls or elevator booking details? Include which location. Do not enter security codes here.' },
  { id: 'moveDate', label: 'Preferred date', type: 'date', required: true, prompt: 'What date would you prefer? This is a request, not a confirmed booking.' },
  select('moveTime', 'Preferred time', 'What time of day works for you?', ['Morning', 'Afternoon', 'Flexible / unsure']),
  select('season', 'Expected conditions', 'Any weather or access conditions the team should plan for?', ['Normal / not sure', 'Winter / icy', 'Hot weather', 'Other — described in notes'], { helper: 'Conditions help us prepare; this answer does not add an automatic surcharge.' }),
  select('priorityQuiz', 'Your priority', 'What matters most for this move?', ['Keep costs lean', 'Balance care and speed', 'Finish as quickly as practical'], { helper: 'We will discuss crew options. Choosing a budget does not make the estimated work slower.' }),
  { id: 'specialItems', label: 'Specialty items', type: 'textarea', required: false, prompt: 'Any pianos, safes, oversized furniture, delicate pieces or items needing dismantling? Describe them; do not add them again to the item counts.' },
  { id: 'extraServices', label: 'Extra services', type: 'multiselect', required: false, prompt: 'Would you like any extra services? Select all that apply, or continue with none.', options: ['Packing & unpacking support', 'Packing supplies delivered', 'Furniture assembly / disassembly', 'Cleaning or junk removal', 'Storage solutions'].map(value => ({ value, label: value })) },
  { id: 'notes', label: 'Additional notes', type: 'textarea', required: false, prompt: 'Anything else the team needs to know? Leave blank if none. Do not enter access codes or sensitive personal details.' }
];
function visibleQuestions(state) { return questionList.filter(q => !q.when || q.when(state)); }
function localToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function validateAnswer(q, value, state = {}) {
  if (q.unknown && value === 'unknown') return '';
  if (q.type === 'multiselect') return Array.isArray(value) && value.length <= q.options.length && new Set(value).size === value.length && value.every(v => q.options.some(o => o.value === v)) ? '' : 'Choose valid services.';
  if (typeof value !== 'string' && typeof value !== 'number') return 'Please provide an answer.';
  if (String(value).length > 2000) return 'Please keep this answer under 2,000 characters.';
  if (String(value).trim() === '') return q.required ? 'Please provide an answer, or choose Not sure where available.' : '';
  if (q.type === 'number') {
    const n = numericField(value);
    if (n === null || n < q.min || n > q.max || !Number.isInteger(n / q.step)) return `Use a number from ${q.min} to ${q.max} in steps of ${q.step}.`;
    if (q.id === 'fragileItems') {
      const total = ['boxCount', 'smallItemCount', 'twoPersonItems'].map(k => numericField(state[k]));
      if (total.every(v => v !== null) && n > total.reduce((a, b) => a + b, 0)) return 'Fragile pieces must be part of the items already counted. Please check your inventory.';
    }
  }
  if (q.type === 'select' && !q.options.some(o => o.value === value)) return 'Please select one of the listed options.';
  if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Enter a valid email address.';
  if (q.type === 'tel' && String(value).replace(/\D/g, '').length < 7) return 'Enter a phone number with at least 7 digits.';
  if (q.type === 'date') {
    const s = String(value), d = new Date(`${s}T12:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.getFullYear() !== Number(s.slice(0, 4)) || d.getMonth() + 1 !== Number(s.slice(5, 7)) || d.getDate() !== Number(s.slice(8, 10)) || s < localToday()) return 'Choose a valid date that is not in the past.';
  }
  if (q.id === 'toAddress' && state.moveType === 'transport' && addressesMatch(state.fromAddress, value)) return 'These addresses match. Select within the same property, or enter a different destination.';
  return '';
}
function answerText(q, value) {
  if (value === 'unknown') return 'Not sure — please review';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None requested';
  if (q.options) return q.options.find(o => o.value === value)?.label || String(value);
  return String(value ?? '').trim() || 'None noted';
}
function generateCheatSheet(state, model = computeMoveModel(state)) {
  const lines = ['MOVE PLAN — QUOTE REQUEST, NOT A CONFIRMED BOOKING', `Estimator version: ${ESTIMATOR_VERSION}`];
  visibleQuestions(state).filter(q => !['name', 'email', 'phone'].includes(q.id)).forEach(q => {
    lines.push(`${q.label}: ${has(state, q.id) ? answerText(q, state[q.id]) : 'Not supplied'}`);
  });
  lines.push(`Inventory total: ${model.totalUnits === null ? 'Not confirmed' : model.totalUnits} (fragile pieces are a subset, not extra items).`);
  lines.push('Crew size, on-site time and price: awaiting team review. No automatic price or duration has been calculated.');
  lines.push(model.travelNote);
  model.errors.forEach(e => lines.push(`Please correct: ${e}`));
  return lines.join('\n');
}
function buildEstimatePayload(state, token, consent) {
  const model = computeMoveModel(state);
  const plan = generateCheatSheet(state, model);
  // The deployed Apps Script saves/emails `notes`, not all newer structured fields.
  // Carry the complete plan in that existing field until the backend is migrated.
  const payload = {
    formType: 'estimate', submittedAt: new Date().toISOString(), source: 'website-quote-request-v4',
    estimatorVersion: ESTIMATOR_VERSION, estimateStatus: model.status,
    name: text(state.name), email: text(state.email), phone: text(state.phone),
    pickup: text(state.fromAddress), dropoff: state.moveType === 'transport' ? text(state.toAddress) : text(state.fromAddress),
    moveType: state.moveType, moveDate: text(state.moveDate), timeWindow: text(state.moveTime),
    homeType: text(state.homeType), homeSize: text(state.bedrooms), bedrooms: text(state.bedrooms),
    access: text(state.accessDetails), parking: text(state.parkingDistance), inventory: text(state.specialItems),
    extras: Array.isArray(state.extraServices) ? state.extraServices.slice() : [],
    notes: plan, customerNotes: text(state.notes), cheatSheet: plan,
    estimatedHours: null, estimatedCost: null, costRange: null, crewSize: null,
    turnstileToken: token, consent: consent === true
  };
  ['boxCount', 'smallItemCount', 'twoPersonItems', 'fragileItems', 'carryDistance', 'stairsFrom', 'elevatorAccess', 'priorityQuiz', 'season', 'onSiteDetails'].forEach(k => { payload[k] = state[k] ?? ''; });
  payload.stairsTo = state.moveType === 'transport' ? (state.stairsTo ?? '') : '';
  return payload;
}
function sanitizeDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const draft = {};
  questionList.forEach(q => { if (has(value, q.id) && !validateAnswer(q, value[q.id], value)) draft[q.id] = value[q.id]; });
  return draft;
}
async function safeParseJson(response) {
  try { const data = JSON.parse(await response.text()); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; }
  catch { return null; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { computeMoveModel, priceReviewedPlan, numericField, normalizeAddress, addressesMatch, validateAnswer, questionList, visibleQuestions, generateCheatSheet, buildEstimatePayload, sanitizeDraft, safeParseJson, localToday };

if (typeof document !== 'undefined') initializePage();
function initializePage() {
  const $ = id => document.getElementById(id);
  const form = $('chatForm');
  if (!form) return;
  let state = {}, editingId = null, active = null, pending = false, quickPending = false;
  const widgets = { estimate: { id: null, token: null }, quick_message: { id: null, token: null } };
  try {
    state = sanitizeDraft(JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'));
    if (!Object.keys(state).length) {
      const old = sanitizeDraft(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}'));
      // Old counts used overlapping categories. Ask again rather than silently reinterpreting them.
      [...COUNT_FIELDS, 'carryDistance', 'stairsFrom', 'stairsTo', 'elevatorAccess', 'priorityQuiz', 'season'].forEach(k => delete old[k]);
      state = old;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch { /* Storage can be unavailable. The form still works in memory. */ }
  function save() { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
  function status(id, message, kind = '') { const el = $(id); if (!el) return; el.textContent = message; el.classList.remove('error', 'success'); if (kind) el.classList.add(kind); }
  function button(label, handler, className = 'btn-link') { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = label; b.addEventListener('click', handler); return b; }
  function eligible(q) { return has(state, q.id) && !validateAnswer(q, state[q.id], state); }
  function ready() { return visibleQuestions(state).every(eligible) && !computeMoveModel(state).errors.length; }
  function availability() { $('sendEstimate').disabled = pending || !ready() || !$('consent').checked || !widgets.estimate.token; }
  function edit(id) { if (pending) return; editingId = id; render(true); }
  function bubble(message, kind) { const el = document.createElement('div'); el.className = `chat-bubble ${kind}`; el.textContent = message; $('chatLog').append(el); return el; }
  function render(focus = false) {
    const visible = visibleQuestions(state);
    active = visible.find(q => q.id === editingId) || visible.find(q => !eligible(q)) || null;
    $('chatLog').replaceChildren();
    bubble('Let’s prepare your move details for a reviewed quote. You can edit any answer.', 'system');
    visible.filter(q => has(state, q.id)).forEach(q => {
      bubble(typeof q.prompt === 'function' ? q.prompt(state) : q.prompt, 'system');
      const el = bubble(answerText(q, state[q.id]), 'user');
      el.append(document.createTextNode(' '), button('Edit', () => edit(q.id)));
      el.lastChild.setAttribute('aria-label', `Edit ${q.label}`);
    });
    $('inputError').textContent = '';
    $('inputHolder').replaceChildren();
    $('chatCompleteNote').hidden = !!active;
    $('chatCompleteNote').textContent = 'Review your summary below (or beside the chat), then verify and send your request.';
    $('promptText').textContent = active ? (typeof active.prompt === 'function' ? active.prompt(state) : active.prompt) : 'Your move plan is ready for review.';
    $('promptHelper').textContent = active?.helper || '';
    $('chatSubmit').disabled = !active || pending;
    $('chatSubmit').textContent = editingId ? 'Save answer' : 'Next';
    form.querySelectorAll('[data-extra-action]').forEach(el => el.remove());
    const actions = $('chatSubmit').parentElement;
    const previous = active ? visible[visible.indexOf(active) - 1] : visible[visible.length - 1];
    if (previous) { const b = button('Back', () => edit(previous.id)); b.dataset.extraAction = 'true'; actions.prepend(b); }
    if (active) {
      const q = active;
      if (q.type === 'multiselect') {
        const grid = document.createElement('div'); grid.className = 'checkbox-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', 'promptText');
        q.options.forEach(o => { const label = document.createElement('label'); label.className = 'checkbox-option'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = o.value; cb.checked = Array.isArray(state[q.id]) && state[q.id].includes(o.value); label.append(cb, document.createTextNode(o.label)); grid.append(label); });
        $('inputHolder').append(grid);
      } else {
        const el = document.createElement(q.type === 'select' ? 'select' : q.type === 'textarea' ? 'textarea' : 'input');
        if (q.type === 'select') {
          el.add(new Option('Select an option', ''));
          q.options.forEach(o => el.add(new Option(o.label, o.value)));
        } else if (q.type === 'textarea') { el.rows = 3; el.maxLength = 2000; }
        else { el.type = q.type; if (q.type === 'number') { el.min = q.min; el.max = q.max; el.step = q.step; el.inputMode = q.step < 1 ? 'decimal' : 'numeric'; } if (q.type === 'date') el.min = localToday(); }
        el.id = `input-${q.id}`; el.name = q.id; el.className = 'input-field'; el.setAttribute('aria-labelledby', 'promptText'); el.setAttribute('aria-describedby', 'promptHelper inputError'); el.required = !!q.required;
        if (q.autocomplete) el.autocomplete = q.autocomplete;
        if (has(state, q.id) && state[q.id] !== 'unknown') el.value = state[q.id];
        $('inputHolder').append(el);
        if (focus) el.focus({ preventScroll: true });
      }
      if (q.unknown) { const b = button('Not sure', () => accept('unknown')); b.dataset.extraAction = 'true'; actions.append(b); }
    }
    $('summaryList').replaceChildren();
    visible.filter(q => has(state, q.id)).forEach(q => {
      const row = document.createElement('div'); row.className = 'summary-item'; row.setAttribute('role', 'listitem');
      const label = document.createElement('div'); label.className = 'summary-item-label'; label.textContent = q.label;
      const value = document.createElement('div'); value.className = 'summary-item-value'; value.textContent = answerText(q, state[q.id]);
      const b = button('Edit', () => edit(q.id)); b.setAttribute('aria-label', `Edit ${q.label} in summary`); row.append(label, value, b); $('summaryList').append(row);
    });
    const answered = visible.filter(eligible).length;
    $('progressBar').style.width = `${Math.round(answered / visible.length * 100)}%`;
    $('progressText').textContent = ready() ? 'Ready to review and send' : `${answered} of ${visible.length} answers complete`;
    const model = computeMoveModel(state);
    $('estimatedTime').textContent = model.errors.length ? 'Check your answers' : 'Confirmed after review';
    $('crewRecommendation').textContent = 'Crew size and on-site hours are not assigned automatically.';
    $('estimatedCost').textContent = 'Quote after review';
    $('costBreakdown').textContent = model.errors.length ? model.errors.join(' ') : model.travelNote;
    $('cheatSheetText').textContent = generateCheatSheet(state, model);
    availability();
    if (focus) { $('chatLog').scrollTop = $('chatLog').scrollHeight; $('promptText').scrollIntoView({ block: 'nearest' }); }
  }
  function accept(value) {
    if (!active || pending) return;
    const error = validateAnswer(active, value, state);
    if (error) { $('inputError').textContent = error; $(`input-${active.id}`)?.setAttribute('aria-invalid', 'true'); return; }
    state[active.id] = active.type === 'number' && value !== 'unknown' ? Number(value) : value;
    editingId = null; save(); render(true);
  }
  form.addEventListener('submit', e => { e.preventDefault(); if (!active) return; accept(active.type === 'multiselect' ? Array.from($('inputHolder').querySelectorAll('input:checked'), el => el.value) : $(`input-${active.id}`).value.trim()); });
  $('consent').addEventListener('change', availability);
  $('restartEstimate').addEventListener('click', () => {
    if (pending) return;
    if (Object.keys(state).length && !window.confirm('Clear your saved move details in this tab?')) return;
    state = {}; editingId = null; save(); $('consent').checked = false; resetWidget('estimate'); status('estimateStatus', ''); render(true);
  });
  $('downloadCheatSheet').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([generateCheatSheet(state)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'mftnb-move-plan.txt'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function resetWidget(kind) { const w = widgets[kind]; w.token = null; if (w.id !== null && window.turnstile) { try { window.turnstile.reset(w.id); } catch {} } availability(); }
  async function send(payload) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), signal: controller.signal });
      const data = await safeParseJson(response);
      if (!response.ok || !data || data.ok !== true) throw new Error(typeof data?.error === 'string' ? data.error : 'Receipt could not be confirmed. Your details are preserved. Contact us before resending if you are unsure.');
      return data;
    } finally { clearTimeout(timeout); }
  }
  $('sendEstimate').addEventListener('click', async () => {
    if (pending || !ready() || !$('consent').checked || !widgets.estimate.token) return;
    pending = true; availability(); $('sendEstimate').textContent = 'Sending…'; $('sendEstimate').setAttribute('aria-busy', 'true');
    status('estimateStatus', 'Sending your quote request…');
    try {
      await send(buildEstimatePayload(state, widgets.estimate.token, true));
      state = {}; editingId = null; save(); $('consent').checked = false;
      status('estimateStatus', 'Your request was received. The team will review it; no price or booking is confirmed yet.', 'success');
    } catch (err) { status('estimateStatus', `${err.message || 'Receipt could not be confirmed.'} Call (587) 731-0695 for help.`, 'error'); }
    finally { pending = false; resetWidget('estimate'); $('sendEstimate').textContent = 'Send to MFTNB'; $('sendEstimate').removeAttribute('aria-busy'); render(); }
  });
  $('quickForm')?.addEventListener('submit', async e => {
    e.preventDefault(); if (quickPending) return;
    const payload = { formType: 'quick-message', source: 'website-quick-message', submittedAt: new Date().toISOString(), name: text($('quickName').value), email: text($('quickEmail').value), phone: text($('quickPhone').value), message: text($('quickMessage').value), turnstileToken: widgets.quick_message.token };
    let error = !payload.name || !payload.message ? 'Please add your name and message.' : !payload.email && !payload.phone ? 'Add an email or phone number.' : '';
    if (!error && payload.email) error = validateAnswer(questionList.find(q => q.id === 'email'), payload.email);
    if (!error && payload.phone) error = validateAnswer(questionList.find(q => q.id === 'phone'), payload.phone);
    if (!error && !payload.turnstileToken) error = 'Please complete the human verification check.';
    if (error) { status('quickStatus', error, 'error'); return; }
    const submit = $('quickForm').querySelector('button[type="submit"]'); quickPending = true; submit.disabled = true; status('quickStatus', 'Sending your message…');
    try { await send(payload); $('quickForm').reset(); status('quickStatus', 'Your message was received. Thank you.', 'success'); }
    catch (err) { status('quickStatus', `${err.message || 'Receipt could not be confirmed.'} Call (587) 731-0695 for help.`, 'error'); }
    finally { quickPending = false; submit.disabled = false; resetWidget('quick_message'); }
  });
  let attempts = 0, timer = null;
  function initializeVerification() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!window.turnstile || typeof window.turnstile.render !== 'function') {
      if (attempts++ < 40) timer = setTimeout(initializeVerification, 250);
      else ['estimateStatus', 'quickStatus'].forEach(id => { if ($(id) && !$(id).textContent) status(id, 'Human verification could not load. Refresh, or call (587) 731-0695.', 'error'); });
      return;
    }
    [['estimate', 'estimateTurnstile'], ['quick_message', 'quickTurnstile']].forEach(([kind, id]) => {
      if (!$(id) || widgets[kind].id !== null) return;
      try {
        widgets[kind].id = window.turnstile.render(`#${id}`, { sitekey: TURNSTILE_SITE_KEY, action: kind, theme: 'light', size: 'compact',
          callback: token => { widgets[kind].token = token; availability(); },
          'expired-callback': () => { widgets[kind].token = null; availability(); },
          'error-callback': () => { widgets[kind].token = null; availability(); }
        });
      } catch { status(kind === 'estimate' ? 'estimateStatus' : 'quickStatus', 'Verification could not start. Refresh, or call (587) 731-0695.', 'error'); }
    });
  }
  if ($('currentYear')) $('currentYear').textContent = new Date().getFullYear();
  window.onloadTurnstileCallback = initializeVerification;
  document.querySelector('script[src*="turnstile/v0/api.js"]')?.addEventListener('load', initializeVerification);
  render(); initializeVerification();
}
