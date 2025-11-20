const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz2kTp_RynPKZptrLJrsv_DvS_-el2bzBz8Jc_QaEej2nHop5iABnMcuEa5pff2No9W8g/exec';
const TURNSTILE_SITE_KEY = '0x4AAAAAAB2kYqJ0EOGNbli7';
const STORAGE_KEY = 'mftnb-estimate-v3';
const TURNSTILE_INIT_RETRY_DELAY = 250;
const TURNSTILE_MAX_INIT_ATTEMPTS = 20;
const TURNSTILE_LOADING_MESSAGE = 'Loading human verification…';
const TURNSTILE_FAILED_MESSAGE = 'Cloudflare Turnstile could not load. Refresh the page or allow the widget to run, then try again.';

const questions = [
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    placeholder: 'Jane Smith',
    autocomplete: 'name',
    prompt: () => '👋 Hi there! What is your name?',
    helper: 'We will use it to personalize your estimate.'
  },
  {
    id: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    placeholder: 'you@example.com',
    autocomplete: 'email',
    prompt: state => `Nice to meet you${state.name ? `, ${state.name}` : ''}! What email should we send confirmations to?`
  },
  {
    id: 'phone',
    label: 'Phone',
    type: 'tel',
    required: true,
    placeholder: '(587) 555-1234',
    autocomplete: 'tel',
    inputmode: 'tel',
    prompt: () => 'What phone number can we call or text if we have questions about your move?'
  },
  {
    id: 'fromAddress',
    label: 'Moving from',
    type: 'textarea',
    required: true,
    placeholder: '123 Main Street, Red Deer, AB',
    autocomplete: 'street-address',
    prompt: () => 'Where are you moving from? Please include the full address and city.'
  },
  {
    id: 'toAddress',
    label: 'Moving to',
    type: 'textarea',
    required: true,
    placeholder: '456 New Place, Lacombe, AB',
    prompt: () => 'Great! What is the destination address?'
  },
  {
    id: 'homeType',
    label: 'Home type',
    type: 'select',
    required: true,
    prompt: () => 'What type of home are you moving from?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'Apartment / condo', label: 'Apartment / condo' },
      { value: 'Townhouse / duplex', label: 'Townhouse / duplex' },
      { value: 'Single-family home', label: 'Single-family home' },
      { value: 'Acreage / farm', label: 'Acreage / farm' },
      { value: 'Office / commercial', label: 'Office / commercial' },
      { value: 'Storage unit', label: 'Storage unit' }
    ]
  },
  {
    id: 'bedrooms',
    label: 'Bedrooms or main rooms',
    type: 'select',
    required: true,
    prompt: () => 'How many bedrooms or primary rooms should we plan for?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'Studio / bachelor', label: 'Studio / bachelor' },
      { value: '1 bedroom', label: '1 bedroom' },
      { value: '2 bedrooms', label: '2 bedrooms' },
      { value: '3 bedrooms', label: '3 bedrooms' },
      { value: '4+ bedrooms', label: '4+ bedrooms' }
    ]
  },
  {
    id: 'boxCount',
    label: 'Boxes or totes',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'Roughly how many packed boxes or totes will movers handle?'
  },
  {
    id: 'smallItemCount',
    label: 'Small loose items',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'How many small loose items or bags need moving (kitchen appliances, art, lamps)?'
  },
  {
    id: 'twoPersonItems',
    label: 'Two-person items',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'How many heavy items will need two movers (dressers, sofas, appliances)?'
  },
  {
    id: 'fragileItems',
    label: 'Fragile or delicate pieces',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'Count delicate or fragile pieces needing extra padding (glass cabinets, antiques, art).'
  },
  {
    id: 'carryDistance',
    label: 'Longest carry distance (m)',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'What is the longest carry distance from truck to door at either home (in meters)?'
  },
  {
    id: 'stairsFrom',
    label: 'Stairs leaving home',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'How many flights of stairs leaving your current place (total up or down)?'
  },
  {
    id: 'stairsTo',
    label: 'Stairs entering new home',
    type: 'number',
    required: true,
    min: 0,
    prompt: () => 'How many flights of stairs into the destination space?'
  },
  {
    id: 'elevatorAccess',
    label: 'Elevator access',
    type: 'select',
    required: true,
    prompt: () => 'Is there elevator access at either location?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'None', label: 'No elevator access' },
      { value: 'Shared elevator', label: 'Shared elevator available' },
      { value: 'Booked elevator', label: 'Booked / dedicated elevator' }
    ]
  },
  {
    id: 'parkingDistance',
    label: 'Parking distance & clearance',
    type: 'textarea',
    required: true,
    placeholder: 'Loading bay, underground clearance, street parking time limits…',
    prompt: () => 'Tell us about parking distance, loading bays, and overhead clearance at each address.'
  },
  {
    id: 'accessDetails',
    label: 'Access details',
    type: 'textarea',
    required: true,
    placeholder: 'Loading dock timing, tight hallways, floor numbers, service entrances…',
    prompt: () => 'Share any other access logistics (service elevator bookings, gate codes, floor numbers).'
  },
  {
    id: 'stackingComfort',
    label: 'Stacking comfort',
    type: 'select',
    required: true,
    prompt: () => 'How comfortable are you with stacking boxes and furniture to speed the move?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'Tight stacking okay', label: 'Tight stacking okay to save trips' },
      { value: 'Moderate stacking', label: 'Moderate stacking with clear pathways' },
      { value: 'Minimal stacking', label: 'Minimal stacking—keep things low' }
    ]
  },
  {
    id: 'overheadRisks',
    label: 'Overhead & fragile risks',
    type: 'textarea',
    required: false,
    placeholder: 'Low ceilings, sprinkler heads, chandeliers, narrow halls…',
    prompt: () => 'Any low ceilings, sprinklers, or tight turns that need extra care overhead?'
  },
  {
    id: 'moveDate',
    label: 'Preferred move date',
    type: 'date',
    required: true,
    prompt: () => 'What date would you like to move?'
  },
  {
    id: 'moveTime',
    label: 'Preferred time',
    type: 'select',
    required: false,
    prompt: () => 'Do you have a preferred time of day?',
    options: [
      { value: '', label: 'Select an option (or leave blank)' },
      { value: 'Morning (8–10 a.m.)', label: 'Morning (8–10 a.m.)' },
      { value: 'Late morning (10 a.m.–12 p.m.)', label: 'Late morning (10 a.m.–12 p.m.)' },
      { value: 'Afternoon (12–3 p.m.)', label: 'Afternoon (12–3 p.m.)' },
      { value: 'Late afternoon (after 3 p.m.)', label: 'Late afternoon (after 3 p.m.)' },
      { value: 'Flexible / unsure', label: 'Flexible / unsure' }
    ],
    helper: 'Skip if you are flexible—we will confirm a window with you.'
  },
  {
    id: 'season',
    label: 'Season or weather',
    type: 'select',
    required: true,
    prompt: () => 'What season or weather should we plan for?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'Peak summer', label: 'Peak summer' },
      { value: 'Winter / icy', label: 'Winter / icy' },
      { value: 'Shoulder season', label: 'Spring / fall shoulder season' }
    ]
  },
  {
    id: 'prioritySlider',
    label: 'Budget vs speed slider',
    type: 'range',
    required: true,
    min: 1,
    max: 10,
    step: 1,
    prompt: () => 'Slide toward 1 for budget-friendly pacing, or toward 10 for fastest completion.',
    helper: 'We will balance crew size and pace based on this.'
  },
  {
    id: 'priorityQuiz',
    label: 'Customer priority quiz',
    type: 'select',
    required: true,
    prompt: () => 'Which statement best matches your move?',
    options: [
      { value: '', label: 'Select an option' },
      { value: 'Keep costs lean, I can help carry', label: 'Keep costs lean, I can help carry' },
      { value: 'Balance care and speed', label: 'Balance care and speed' },
      { value: 'Finish fast with full-service help', label: 'Finish fast with full-service help' }
    ]
  },
  {
    id: 'specialItems',
    label: 'Special items',
    type: 'textarea',
    required: false,
    placeholder: 'Piano, gun safe, large plants, fragile heirlooms…',
    prompt: () => 'List any large or specialty items we should prepare extra equipment for.'
  },
  {
    id: 'extraServices',
    label: 'Extra services',
    type: 'multiselect',
    required: false,
    prompt: () => 'Would you like help with any of these extras?',
    helper: 'Choose all that apply or leave blank if not needed.',
    options: [
      { value: 'Packing & unpacking support', label: 'Packing & unpacking support' },
      { value: 'Packing supplies delivered', label: 'Packing supplies delivered' },
      { value: 'Furniture assembly / disassembly', label: 'Furniture assembly / disassembly' },
      { value: 'Cleaning or junk removal', label: 'Cleaning or junk removal' },
      { value: 'Storage solutions', label: 'Storage solutions' }
    ]
  },
  {
    id: 'notes',
    label: 'Additional notes',
    type: 'textarea',
    required: false,
    placeholder: 'Timeline preferences, gate codes, who to contact onsite…',
    prompt: () => 'Anything else we should know to make move day smooth?'
  }
];

const summaryDefinitions = [
  { id: 'name', label: 'Name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'fromAddress', label: 'Moving from' },
  { id: 'toAddress', label: 'Moving to' },
  {
    id: 'inventory',
    label: 'Inventory snapshot',
    formatter: state => {
      const parts = [];
      const boxCount = numericField(state.boxCount);
      const smallItems = numericField(state.smallItemCount);
      const twoPerson = numericField(state.twoPersonItems);
      const fragile = numericField(state.fragileItems);
      if (boxCount > 0) parts.push(`${boxCount} boxes/totes`);
      if (smallItems > 0) parts.push(`${smallItems} small loose items`);
      if (twoPerson > 0) parts.push(`${twoPerson} two-person items`);
      if (fragile > 0) parts.push(`${fragile} fragile pieces`);
      return parts.length ? parts.join(' · ') : 'Pending—add box counts and specialty items.';
    }
  },
  {
    id: 'schedule',
    label: 'Move date & time',
    formatter: state => {
      if (!state.moveDate) return 'Choose a date that fits your plans.';
      const formatted = formatDate(state.moveDate);
      const time = state.moveTime ? ` · ${state.moveTime}` : '';
      return `${formatted}${time}`;
    }
  },
  {
    id: 'homeDetails',
    label: 'Home details',
    formatter: state => {
      const pieces = [state.homeType, state.bedrooms].filter(Boolean);
      return pieces.length ? pieces.join(' · ') : 'Describe the type of home and number of rooms.';
    }
  },
  {
    id: 'accessProfile',
    label: 'Access profile',
    formatter: state => {
      const distance = numericField(state.carryDistance);
      const stairs = numericField(state.stairsFrom) + numericField(state.stairsTo);
      const elevator = state.elevatorAccess || 'Pending elevator details';
      const stacking = state.stackingComfort || 'Stacking preference pending';
      const parts = [];
      if (distance) parts.push(`Longest carry ~${distance} m`);
      if (stairs) parts.push(`${stairs} total flights`);
      parts.push(elevator);
      parts.push(stacking);
      return parts.filter(Boolean).join(' · ');
    }
  },
  {
    id: 'accessDetails',
    label: 'Access & parking',
    formatter: state => state.accessDetails || 'Let us know about stairs, elevators, or parking instructions.'
  },
  {
    id: 'parkingDistance',
    label: 'Parking & clearance notes',
    formatter: state => state.parkingDistance || 'Share parking distance, overhead clearance, or time limits.'
  },
  {
    id: 'specialItems',
    label: 'Large or specialty items',
    formatter: state => {
      if (state.specialItems) return state.specialItems;
      if (Object.prototype.hasOwnProperty.call(state, 'specialItems')) {
        return 'None noted.';
      }
      return 'List heavy or fragile items so we can plan ahead.';
    }
  },
  {
    id: 'extraServices',
    label: 'Extra services',
    formatter: state => {
      if (Array.isArray(state.extraServices) && state.extraServices.length) {
        return state.extraServices.join('\n');
      }
      if (Object.prototype.hasOwnProperty.call(state, 'extraServices')) {
        return 'No extra services selected.';
      }
      return 'Choose all that apply or leave blank if not needed.';
    }
  },
  {
    id: 'prioritySummary',
    label: 'Priorities',
    formatter: state => {
      const slider = numericField(state.prioritySlider);
      const quiz = state.priorityQuiz;
      const season = state.season;
      const parts = [];
      if (slider) parts.push(`Pace slider: ${slider}/10`);
      if (quiz) parts.push(`Quiz: ${quiz}`);
      if (season) parts.push(season);
      return parts.length ? parts.join(' · ') : 'Tell us how to balance budget, speed, and weather.';
    }
  },
  {
    id: 'notes',
    label: 'Additional notes',
    formatter: state => {
      if (state.notes) return state.notes;
      if (Object.prototype.hasOwnProperty.call(state, 'notes')) {
        return 'No additional notes.';
      }
      return 'Add timing requests, storage needs, or anything else.';
    }
  }
];

let estimateState = loadState();
let estimateTurnstileToken = null;
let estimateWidgetId = null;
let quickTurnstileToken = null;
let quickWidgetId = null;
let turnstileRetryHandle = null;
let turnstileInitAttempts = 0;
let isSubmittingEstimate = false;

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const promptText = document.getElementById('promptText');
const promptHelper = document.getElementById('promptHelper');
const inputHolder = document.getElementById('inputHolder');
const inputError = document.getElementById('inputError');
const chatSubmit = document.getElementById('chatSubmit');
const chatCompleteNote = document.getElementById('chatCompleteNote');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const summaryList = document.getElementById('summaryList');
const consentCheckbox = document.getElementById('consent');
const sendEstimateBtn = document.getElementById('sendEstimate');
const restartBtn = document.getElementById('restartEstimate');
const estimateStatus = document.getElementById('estimateStatus');
const estimatedTimeEl = document.getElementById('estimatedTime');
const estimatedCostEl = document.getElementById('estimatedCost');
const crewRecommendationEl = document.getElementById('crewRecommendation');
const costBreakdownEl = document.getElementById('costBreakdown');
const cheatSheetTextEl = document.getElementById('cheatSheetText');
const cheatSheetDownloadBtn = document.getElementById('downloadCheatSheet');
const quickForm = document.getElementById('quickForm');
const quickStatus = document.getElementById('quickStatus');
const quickNameInput = document.getElementById('quickName');
const quickEmailInput = document.getElementById('quickEmail');
const quickPhoneInput = document.getElementById('quickPhone');
const quickMessageInput = document.getElementById('quickMessage');
const currentYearEl = document.getElementById('currentYear');

let activeQuestionIndex = findNextQuestionIndex();
let activeInputElement = null;

if (currentYearEl) {
  currentYearEl.textContent = new Date().getFullYear();
}

if (chatForm) {
  renderEstimator();
  chatForm.addEventListener('submit', handleChatSubmit);
}

if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    estimateState = {};
    saveState();
    clearStatus(estimateStatus);
    consentCheckbox.checked = false;
    if (estimateWidgetId && window.turnstile) {
      window.turnstile.reset(estimateWidgetId);
    }
    estimateTurnstileToken = null;
    renderEstimator();
  });
}

if (consentCheckbox) {
  consentCheckbox.addEventListener('change', updateSubmitAvailability);
}

if (sendEstimateBtn) {
  sendEstimateBtn.addEventListener('click', submitEstimate);
}

if (quickForm) {
  quickForm.addEventListener('submit', submitQuickMessage);
}

if (cheatSheetDownloadBtn) {
  cheatSheetDownloadBtn.addEventListener('click', downloadCheatSheet);
}

function initializeTurnstileWidgets() {
  const turnstileApi = window.turnstile;

  if (!turnstileApi || typeof turnstileApi.render !== 'function') {
    if (turnstileInitAttempts === 0) {
      showTurnstileLoadingNotice();
    }
    if (turnstileInitAttempts >= TURNSTILE_MAX_INIT_ATTEMPTS) {
      showTurnstileFailureNotice();
      return;
    }
    turnstileInitAttempts += 1;
    if (!turnstileRetryHandle) {
      turnstileRetryHandle = window.setTimeout(() => {
        turnstileRetryHandle = null;
        initializeTurnstileWidgets();
      }, TURNSTILE_INIT_RETRY_DELAY);
    }
    return;
  }

  turnstileInitAttempts = 0;
  clearTurnstileNotices();

  if (turnstileRetryHandle) {
    window.clearTimeout(turnstileRetryHandle);
    turnstileRetryHandle = null;
  }

  if (document.getElementById('estimateTurnstile') && !estimateWidgetId) {
    estimateWidgetId = turnstileApi.render('#estimateTurnstile', {
      sitekey: TURNSTILE_SITE_KEY,
      action: 'estimate',
      theme: 'light',
      callback: token => {
        estimateTurnstileToken = token;
        updateSubmitAvailability();
      },
      'error-callback': () => {
        estimateTurnstileToken = null;
        updateSubmitAvailability();
      },
      'expired-callback': () => {
        estimateTurnstileToken = null;
        updateSubmitAvailability();
      }
    });
  }

  if (document.getElementById('quickTurnstile') && !quickWidgetId) {
    quickWidgetId = turnstileApi.render('#quickTurnstile', {
      sitekey: TURNSTILE_SITE_KEY,
      action: 'quick_message',
      theme: 'light',
      size: 'compact',
      callback: token => {
        quickTurnstileToken = token;
      },
      'error-callback': () => {
        quickTurnstileToken = null;
      },
      'expired-callback': () => {
        quickTurnstileToken = null;
      }
    });
  }
}

function showTurnstileLoadingNotice() {
  if (
    estimateStatus &&
    !estimateStatus.textContent &&
    !estimateStatus.classList.contains('error') &&
    !estimateStatus.classList.contains('success')
  ) {
    setStatus(estimateStatus, null, TURNSTILE_LOADING_MESSAGE);
  }
  if (
    quickStatus &&
    !quickStatus.textContent &&
    !quickStatus.classList.contains('error') &&
    !quickStatus.classList.contains('success')
  ) {
    setStatus(quickStatus, null, TURNSTILE_LOADING_MESSAGE);
  }
}

function showTurnstileFailureNotice() {
  if (estimateStatus && !estimateStatus.classList.contains('success')) {
    setStatus(estimateStatus, 'error', TURNSTILE_FAILED_MESSAGE);
  }
  if (quickStatus && !quickStatus.classList.contains('success')) {
    setStatus(quickStatus, 'error', TURNSTILE_FAILED_MESSAGE);
  }
}

function clearTurnstileNotices() {
  if (estimateStatus && (estimateStatus.textContent === TURNSTILE_LOADING_MESSAGE || estimateStatus.textContent === TURNSTILE_FAILED_MESSAGE)) {
    clearStatus(estimateStatus);
  }
  if (quickStatus && (quickStatus.textContent === TURNSTILE_LOADING_MESSAGE || quickStatus.textContent === TURNSTILE_FAILED_MESSAGE)) {
    clearStatus(quickStatus);
  }
}

if (typeof window !== 'undefined') {
  const previousOnloadTurnstile = window.onloadTurnstileCallback;
  window.onloadTurnstileCallback = () => {
    if (typeof previousOnloadTurnstile === 'function') {
      try {
        previousOnloadTurnstile();
      } catch (err) {
        // ignore callback errors and continue with initialization
      }
    }
    turnstileInitAttempts = 0;
    initializeTurnstileWidgets();
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTurnstileWidgets, { once: true });
} else {
  initializeTurnstileWidgets();
}

function renderEstimator() {
  activeQuestionIndex = findNextQuestionIndex();
  renderChatLog();
  renderPrompt();
  renderSummary();
  updateProgress();
  updateSubmitAvailability();
}

function renderChatLog() {
  if (!chatLog) return;
  chatLog.innerHTML = '';
  appendSystemBubble('👋 Hello! Let’s build your moving estimate together.');
  questions.forEach(question => {
    if (Object.prototype.hasOwnProperty.call(estimateState, question.id)) {
      appendSystemBubble(formatPrompt(question));
      appendUserBubble(formatAnswer(question, estimateState[question.id]));
    }
  });
  if (activeQuestionIndex === -1) {
    appendSystemBubble('That covers everything. Review your summary and press “Send to MFTNB” when you’re ready.');
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderPrompt() {
  if (!chatForm) return;
  clearError();
  const question = activeQuestionIndex === -1 ? null : questions[activeQuestionIndex];
  if (!question) {
    promptText.textContent = 'All set! Review the summary on the right to submit.';
    promptHelper.textContent = '';
    inputHolder.innerHTML = '';
    chatSubmit.textContent = 'Next';
    chatSubmit.disabled = true;
    chatCompleteNote.hidden = false;
    return;
  }

  chatCompleteNote.hidden = true;
  promptText.textContent = formatPrompt(question);
  promptHelper.textContent = question.helper || '';
  buildInputForQuestion(question);

  if (answeredCount() === 0 && activeQuestionIndex === 0) {
    chatSubmit.textContent = 'Next';
  } else if (activeQuestionIndex === questions.length - 1) {
    chatSubmit.textContent = 'Review summary';
  } else {
    chatSubmit.textContent = 'Next';
  }
}

function buildInputForQuestion(question) {
  inputHolder.innerHTML = '';
  activeInputElement = null;
  let element;

  if (question.type === 'multiselect') {
    const grid = document.createElement('div');
    grid.className = 'checkbox-grid';
    question.options.forEach(opt => {
      const label = document.createElement('label');
      label.className = 'checkbox-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = opt.value;
      checkbox.name = question.id;
      if (Array.isArray(estimateState[question.id]) && estimateState[question.id].includes(opt.value)) {
        checkbox.checked = true;
      }
      label.appendChild(checkbox);
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.appendChild(span);
      grid.appendChild(label);
    });
    inputHolder.appendChild(grid);
    activeInputElement = grid;
    chatSubmit.disabled = false;
    return;
  }

  if (question.type === 'textarea') {
    element = document.createElement('textarea');
    element.className = 'input-field';
    element.rows = 4;
  } else if (question.type === 'number') {
    element = document.createElement('input');
    element.type = 'number';
    element.className = 'input-field';
    if (typeof question.min !== 'undefined') element.min = question.min;
    if (typeof question.max !== 'undefined') element.max = question.max;
    if (typeof question.step !== 'undefined') element.step = question.step;
    if (estimateState[question.id] || estimateState[question.id] === 0) {
      element.value = estimateState[question.id];
    }
  } else if (question.type === 'range') {
    const wrapper = document.createElement('div');
    wrapper.className = 'range-wrap';
    const valueLabel = document.createElement('div');
    valueLabel.className = 'range-value';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'input-range';
    slider.min = question.min ?? 0;
    slider.max = question.max ?? 10;
    slider.step = question.step ?? 1;
    slider.value = estimateState[question.id] || slider.min;
    valueLabel.textContent = `Now: ${slider.value}`;
    slider.addEventListener('input', () => {
      valueLabel.textContent = `Now: ${slider.value}`;
    });
    wrapper.appendChild(slider);
    wrapper.appendChild(valueLabel);
    inputHolder.appendChild(wrapper);
    activeInputElement = slider;
    chatSubmit.disabled = false;
    return;
  } else if (question.type === 'select') {
    element = document.createElement('select');
    element.className = 'input-field';
    question.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (estimateState[question.id] === opt.value) {
        option.selected = true;
      }
      element.appendChild(option);
    });
  } else if (question.type === 'date') {
    element = document.createElement('input');
    element.type = 'date';
    element.className = 'input-field';
    element.min = new Date().toISOString().split('T')[0];
    if (estimateState[question.id]) {
      element.value = estimateState[question.id];
    }
  } else {
    element = document.createElement('input');
    element.type = question.type === 'email' ? 'email' : (question.type === 'tel' ? 'tel' : 'text');
    element.className = 'input-field';
    if (estimateState[question.id]) {
      element.value = estimateState[question.id];
    }
  }

  element.id = `input-${question.id}`;
  element.name = question.id;
  if (question.placeholder) element.placeholder = question.placeholder;
  if (question.autocomplete) element.autocomplete = question.autocomplete;
  if (question.inputmode) element.inputMode = question.inputmode;
  if (question.type === 'text') {
    element.autocapitalize = 'words';
  }

  inputHolder.appendChild(element);
  activeInputElement = element;
  element.focus();

  if (question.type === 'select') {
    chatSubmit.disabled = question.required && !element.value;
    element.addEventListener('change', () => {
      chatSubmit.disabled = question.required && !element.value;
    });
  } else if (question.type === 'textarea' || question.type === 'text' || question.type === 'email' || question.type === 'tel' || question.type === 'date' || question.type === 'number') {
    chatSubmit.disabled = question.required && !element.value;
    element.addEventListener('input', () => {
      chatSubmit.disabled = question.required && !element.value;
    });
  }
}

function handleChatSubmit(event) {
  event.preventDefault();
  clearError();
  const question = activeQuestionIndex === -1 ? null : questions[activeQuestionIndex];
  if (!question) {
    return;
  }

  let value;
  if (question.type === 'multiselect') {
    const selected = Array.from(inputHolder.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    value = selected;
  } else if (activeInputElement) {
    value = activeInputElement.value.trim();
  } else {
    value = '';
  }

  if (question.type === 'select' && activeInputElement) {
    value = activeInputElement.value;
  }

  if ((question.type === 'date' || question.type === 'range') && activeInputElement) {
    value = activeInputElement.value;
  }

  if (question.type === 'number') {
    const parsed = Number(value);
    value = Number.isFinite(parsed) ? parsed : '';
  }

  if (question.type === 'range') {
    const parsed = Number(value);
    value = Number.isFinite(parsed) ? parsed : '';
  }

  if (question.required) {
    if (question.type === 'multiselect' && Array.isArray(value) && value.length === 0) {
      // Allow empty selection on required multiselect because question encourages but does not force.
      value = [];
    }
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    const isEmptyValue = value === '' || value === null || typeof value === 'undefined';
    if (isEmptyArray || isEmptyValue) {
      setError('Please provide an answer to continue.');
      return;
    }
  }

  if (question.type === 'email' && value) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) {
      setError('Enter a valid email address.');
      return;
    }
  }

  if (question.type === 'tel' && value) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7) {
      setError('Enter a phone number with at least 7 digits.');
      return;
    }
  }

  if (question.type === 'multiselect') {
    estimateState[question.id] = Array.isArray(value) ? value : [];
  } else if (question.type === 'date') {
    estimateState[question.id] = value;
  } else if (question.type === 'number' || question.type === 'range') {
    estimateState[question.id] = value === '' ? '' : Number(value);
  } else {
    estimateState[question.id] = value;
  }

  saveState();
  renderEstimator();
}

function renderSummary() {
  if (!summaryList) return;
  summaryList.innerHTML = '';
  summaryDefinitions.forEach(item => {
    let value;
    if (item.formatter) {
      value = item.formatter(estimateState);
    } else {
      value = estimateState[item.id] || '';
    }
    if (!value) {
      value = 'Pending—answer this in the chat.';
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'summary-item';
    wrapper.setAttribute('role', 'listitem');
    const labelEl = document.createElement('div');
    labelEl.className = 'summary-item-label';
    labelEl.textContent = item.label;
    const valueEl = document.createElement('div');
    valueEl.className = 'summary-item-value';
    valueEl.textContent = value;
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    summaryList.appendChild(wrapper);
  });

  const model = computeMoveModel(estimateState);
  updateEstimateOutputs(model);
}

function updateProgress() {
  if (!progressBar || !progressText) return;
  const answered = answeredCount();
  const totalQuestions = questions.length;
  const totalSteps = totalQuestions + 1; // includes review
  const progressPercent = Math.min(100, Math.round((answered / totalQuestions) * 100));
  progressBar.style.width = `${progressPercent}%`;
  if (answered >= totalQuestions) {
    progressText.textContent = `Step ${totalSteps} of ${totalSteps} · Review & submit`;
  } else {
    progressText.textContent = `Step ${answered + 1} of ${totalSteps}`;
  }
}

function updateSubmitAvailability() {
  if (!sendEstimateBtn) return;
  const answeredAll = questions.every(q => Object.prototype.hasOwnProperty.call(estimateState, q.id));
  const ready = answeredAll && consentCheckbox && consentCheckbox.checked && !!estimateTurnstileToken && !isSubmittingEstimate;
  sendEstimateBtn.disabled = !ready;
}

function updateEstimateOutputs(model) {
  const formattedHours = `${model.productiveHours.toFixed(1)} hrs (${model.paddedHours[0].toFixed(1)}–${model.paddedHours[1].toFixed(1)} hrs range)`;
  if (estimatedTimeEl) {
    estimatedTimeEl.textContent = formattedHours;
  }
  if (crewRecommendationEl) {
    crewRecommendationEl.textContent = `${model.crewSize} movers · ${model.costRange}`;
  }
  if (estimatedCostEl) {
    estimatedCostEl.textContent = `$${model.estimatedCost.toLocaleString()}`;
  }
  if (costBreakdownEl) {
    const speedNote = estimateState.priorityQuiz || 'Balanced pace';
    costBreakdownEl.textContent = `Includes travel fee $${model.travelFee} and per-mover rate $${model.perMoverRate}/hr · ${speedNote}`;
  }
  if (cheatSheetTextEl) {
    cheatSheetTextEl.textContent = generateCheatSheet(estimateState, model);
  }
}

function findNextQuestionIndex() {
  for (let i = 0; i < questions.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(estimateState, questions[i].id)) {
      return i;
    }
  }
  return -1;
}

function answeredCount() {
  return questions.reduce((count, question) => {
    if (Object.prototype.hasOwnProperty.call(estimateState, question.id)) {
      return count + 1;
    }
    return count;
  }, 0);
}

function formatPrompt(question) {
  try {
    return typeof question.prompt === 'function' ? question.prompt(estimateState) : question.prompt;
  } catch (err) {
    return typeof question.prompt === 'string' ? question.prompt : 'Next question';
  }
}

function formatAnswer(question, value) {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : 'None';
  }
  if (question.type === 'date' && value) {
    return formatDate(value);
  }
  if (!value && value !== 0) {
    if (question.required) {
      return 'Provided';
    }
    return 'No additional details';
  }
  return value;
}

function formatDate(value) {
  const parts = value.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  return value;
}

function numericField(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function appendSystemBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble system';
  bubble.textContent = text;
  chatLog.appendChild(bubble);
}

function appendUserBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble user';
  bubble.textContent = text;
  chatLog.appendChild(bubble);
}

function setError(message) {
  if (!inputError) return;
  inputError.textContent = message;
}

function clearError() {
  if (!inputError) return;
  inputError.textContent = '';
}

function loadState() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  } catch (err) {
    return {};
  }
}

function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(estimateState));
  } catch (err) {
    // ignore storage errors
  }
}

function clearStatus(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.remove('success', 'error');
}

function computeMoveModel(state) {
  const boxCount = numericField(state.boxCount);
  const smallItems = numericField(state.smallItemCount);
  const twoPersonItems = numericField(state.twoPersonItems);
  const fragileItems = numericField(state.fragileItems);
  const totalUnits = boxCount + smallItems + twoPersonItems + fragileItems;
  const baseMinutes = boxCount * 3 + smallItems * 5 + twoPersonItems * 12 + fragileItems * 8;
  const flights = numericField(state.stairsFrom) + numericField(state.stairsTo);
  const distanceFactor = 1 + Math.min(0.6, numericField(state.carryDistance) / 50);
  const elevatorFactor = state.elevatorAccess === 'Booked elevator' ? 0.85 : (state.elevatorAccess === 'Shared elevator' ? 0.95 : 1.15);
  const stackingFactor = state.stackingComfort === 'Tight stacking okay' ? 0.92 : (state.stackingComfort === 'Minimal stacking' ? 1.1 : 1);
  const seasonFactor = state.season === 'Winter / icy' ? 1.1 : (state.season === 'Peak summer' ? 1.05 : 1);
  const prioritySlider = numericField(state.prioritySlider);
  const paceFactor = prioritySlider ? Math.min(1.15, Math.max(0.85, 1 - (prioritySlider - 5) * 0.03)) : 1;
  const stairMinutes = totalUnits * flights * 0.4;
  const heavyBias = twoPersonItems > 4 ? 1.1 : 1;
  const totalMinutes = (baseMinutes * distanceFactor * elevatorFactor * stackingFactor * seasonFactor * paceFactor * heavyBias) + stairMinutes;
  const baseHours = totalMinutes / 60;

  let crewSize = 2;
  if (baseHours > 6 || totalUnits > 80) crewSize = 3;
  if (baseHours > 9 || totalUnits > 140) crewSize = 4;
  const productiveHours = Math.max(2, baseHours * (2 / crewSize));
  const perMoverRate = 85;
  const travelFee = 120;
  const estimatedCost = Math.round(productiveHours * crewSize * perMoverRate + travelFee);
  const paddedHoursLow = Math.max(2, productiveHours - 0.5);
  const paddedHoursHigh = productiveHours + 0.75;
  const costLow = Math.round(paddedHoursLow * crewSize * perMoverRate + travelFee);
  const costHigh = Math.round(paddedHoursHigh * crewSize * perMoverRate + travelFee);

  return {
    crewSize,
    baseHours,
    productiveHours,
    estimatedCost,
    costRange: `$${costLow.toLocaleString()}–$${costHigh.toLocaleString()}`,
    perMoverRate,
    travelFee,
    totalUnits,
    flights,
    factors: { distanceFactor, elevatorFactor, stackingFactor, seasonFactor, paceFactor, heavyBias },
    paddedHours: [paddedHoursLow, paddedHoursHigh]
  };
}

function generateCheatSheet(state, model) {
  const lines = [];
  lines.push(`Crew: ${model.crewSize} movers with ${model.perMoverRate}/hr rate; travel fee $${model.travelFee}.`);
  lines.push(`Inventory: ${numericField(state.boxCount)} boxes, ${numericField(state.smallItemCount)} small items, ${numericField(state.twoPersonItems)} two-person items, ${numericField(state.fragileItems)} fragile.`);
  lines.push(`Access: carry ${numericField(state.carryDistance)} m, ${numericField(state.stairsFrom)} flights out / ${numericField(state.stairsTo)} in, elevator: ${state.elevatorAccess || 'n/a'}.`);
  if (state.parkingDistance) lines.push(`Parking/clearance: ${state.parkingDistance}`);
  if (state.overheadRisks) lines.push(`Overhead risks: ${state.overheadRisks}`);
  lines.push(`Stacking: ${state.stackingComfort || 'standard'}; pace slider ${numericField(state.prioritySlider) || 'n/a'}.`);
  if (state.specialItems) lines.push(`Specialty items: ${state.specialItems}`);
  if (state.extraServices && state.extraServices.length) lines.push(`Extras: ${state.extraServices.join(', ')}`);
  lines.push(`Estimate: ${model.productiveHours.toFixed(1)} hrs with ${model.costRange} range.`);
  return lines.join('\n');
}

function submitEstimate() {
  if (!sendEstimateBtn || sendEstimateBtn.disabled || isSubmittingEstimate) return;
  const payload = buildEstimatePayload();
  if (!payload.turnstileToken) {
    setStatus(estimateStatus, 'error', 'Please complete the Turnstile check.');
    return;
  }

  isSubmittingEstimate = true;
  updateSubmitAvailability();
  sendEstimateBtn.textContent = 'Sending…';
  sendEstimateBtn.setAttribute('aria-busy', 'true');
  setStatus(estimateStatus, null, 'Sending your estimate securely…');

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload)
  })
    .then(async response => {
      const data = await safeParseJson(response);
      if (!response.ok || !data || data.ok === false) {
        const message = data && data.error ? data.error : 'We could not submit your estimate. Please try again.';
        throw new Error(message);
      }
      return data;
    })
    .then(() => {
      setStatus(estimateStatus, 'success', 'Thank you! Your estimate was sent successfully. Watch for your confirmation email shortly.');
      estimateState = {};
      saveState();
      consentCheckbox.checked = false;
      estimateTurnstileToken = null;
      if (window.turnstile && estimateWidgetId) {
        window.turnstile.reset(estimateWidgetId);
      }
      renderEstimator();
    })
    .catch(error => {
      setStatus(estimateStatus, 'error', error.message || 'We could not send your estimate. Please try again or call us at (587) 731-0695.');
    })
    .finally(() => {
      isSubmittingEstimate = false;
      sendEstimateBtn.textContent = 'Send to MFTNB';
      sendEstimateBtn.removeAttribute('aria-busy');
      updateSubmitAvailability();
    });
}

function buildEstimatePayload() {
  const model = computeMoveModel(estimateState);
  const cheatSheet = generateCheatSheet(estimateState, model);
  const extras = Array.isArray(estimateState.extraServices) ? estimateState.extraServices : [];
  return {
    formType: 'estimate',
    submittedAt: new Date().toISOString(),
    name: estimateState.name || '',
    email: estimateState.email || '',
    phone: estimateState.phone || '',
    pickup: estimateState.fromAddress || '',
    dropoff: estimateState.toAddress || '',
    moveDate: estimateState.moveDate || '',
    timeWindow: estimateState.moveTime || '',
    homeType: estimateState.homeType || '',
    homeSize: estimateState.bedrooms || '',
    bedrooms: estimateState.bedrooms || '',
    access: estimateState.accessDetails || '',
    parking: estimateState.parkingDistance || '',
    stairsFrom: estimateState.stairsFrom || '',
    stairsTo: estimateState.stairsTo || '',
    carryDistance: estimateState.carryDistance || '',
    elevatorAccess: estimateState.elevatorAccess || '',
    stackingComfort: estimateState.stackingComfort || '',
    overheadRisks: estimateState.overheadRisks || '',
    season: estimateState.season || '',
    inventory: estimateState.specialItems || '',
    boxCount: estimateState.boxCount || '',
    smallItemCount: estimateState.smallItemCount || '',
    twoPersonItems: estimateState.twoPersonItems || '',
    fragileItems: estimateState.fragileItems || '',
    prioritySlider: estimateState.prioritySlider || '',
    priorityQuiz: estimateState.priorityQuiz || '',
    extras,
    notes: estimateState.notes || '',
    estimatedHours: model.productiveHours,
    estimatedCost: model.estimatedCost,
    costRange: model.costRange,
    crewSize: model.crewSize,
    cheatSheet,
    source: 'website-chat-estimator',
    turnstileToken: estimateTurnstileToken,
    consent: !!(consentCheckbox && consentCheckbox.checked)
  };
}

function downloadCheatSheet() {
  const model = computeMoveModel(estimateState);
  const cheatSheet = generateCheatSheet(estimateState, model);
  const blob = new Blob([cheatSheet], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mftnb-move-notes.txt';
  link.click();
  URL.revokeObjectURL(url);
}

function submitQuickMessage(event) {
  event.preventDefault();
  if (!quickForm) return;
  const name = quickNameInput ? quickNameInput.value.trim() : '';
  const email = quickEmailInput ? quickEmailInput.value.trim() : '';
  const phone = quickPhoneInput ? quickPhoneInput.value.trim() : '';
  const message = quickMessageInput ? quickMessageInput.value.trim() : '';

  clearStatus(quickStatus);

  if (!name) {
    setStatus(quickStatus, 'error', 'Please add your name.');
    return;
  }
  if (!message) {
    setStatus(quickStatus, 'error', 'Let us know how we can help.');
    return;
  }
  if (!email && !phone) {
    setStatus(quickStatus, 'error', 'Add an email or phone number so we can reach you.');
    return;
  }
  if (!quickTurnstileToken) {
    setStatus(quickStatus, 'error', 'Please complete the Turnstile check.');
    return;
  }

  const payload = {
    formType: 'quick-message',
    submittedAt: new Date().toISOString(),
    name,
    email,
    phone,
    message,
    source: 'website-quick-message',
    turnstileToken: quickTurnstileToken
  };

  setStatus(quickStatus, null, 'Sending your message…');

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload)
  })
    .then(async response => {
      const data = await safeParseJson(response);
      if (!response.ok || !data || data.ok === false) {
        const messageText = data && data.error ? data.error : 'We could not send your message. Please try again.';
        throw new Error(messageText);
      }
      return data;
    })
    .then(() => {
      setStatus(quickStatus, 'success', 'Thank you! We received your note and will reach out soon.');
      quickForm.reset();
      if (quickNameInput) quickNameInput.focus();
      quickTurnstileToken = null;
      if (window.turnstile && quickWidgetId) {
        window.turnstile.reset(quickWidgetId);
      }
    })
    .catch(error => {
      setStatus(quickStatus, 'error', error.message || 'We could not send your message. Please call (587) 731-0695.');
    });
}

function setStatus(element, state, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('success', 'error');
  if (state === 'success') {
    element.classList.add('success');
  } else if (state === 'error') {
    element.classList.add('error');
  }
}

function safeParseJson(response) {
  return response.text().then(text => {
    try {
      return text ? JSON.parse(text) : {};
    } catch (err) {
      return {};
    }
  });
}
