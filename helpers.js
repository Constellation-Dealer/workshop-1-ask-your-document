// ═══════════════════════════════════════════════════════════════
//  CONFIGURATION — loaded from .env (see .env.example)
//
//  CONTRACT
//  - helpers.js owns config loading, auth, API calls, SSE parsing, and UI primitives
//  - loop.js owns the workflow and decides when to call these helpers
//  - addStep/updateStep/showAnswer update the page only; they do not trigger APIs
//
//  TODO: Copy .env.example to .env and fill in ALL values:
//    - IDMS_URL       → Token endpoint base URL (for authentication)
//    - GATEWAY_URL    → TargetMCP Gateway (for chat/streaming)
//    - UMH_URL        → TargetUMH (for upload and media status)
//    - DEALER_GUID    → Dealer identifier for API calls
//    - USERNAME       → IDMS username
//    - PASSWORD       → IDMS password
//    - CLIENT_SECRET  → IDMS client secret
//
// ═══════════════════════════════════════════════════════════════

let DEALER_GUID = '';
let IDMS_URL = '';
let GATEWAY_URL = '';
let UMH_URL = '';
const APP_VERSION = window.__APP_VERSION__ || 'dev';

let _authToken = null;
let _reloadScheduled = false;

// The assistant turn the Gateway just persisted. A thumb is feedback ON A TURN, so
// there is nothing to attach one to until the Gateway tells us which turn it wrote —
// it arrives on the `complete` event as response.assistantTurnId. Null when the
// Gateway did not persist the turn, and the UI says so rather than showing a button
// that cannot work.
let _lastTurnId = null;

// Config loaded from .env file
let _config = { username: '', password: '', clientSecret: '' };

function getToken() {
  return _authToken;
}

function getDealerGuid() {
  return DEALER_GUID;
}

/**
 * Show the error banner: what happened, and what to do next.
 * `next` is optional; pass it when there is a clear next move.
 */
function showBanner(message, next, heading) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = '';

  const title = document.createElement('span');
  title.className = 'banner-title';
  title.textContent = heading || 'That run stopped';

  const detail = document.createElement('span');
  detail.className = 'banner-detail';
  detail.textContent = message;

  banner.appendChild(title);
  banner.appendChild(detail);

  if (next) {
    const hint = document.createElement('span');
    hint.className = 'banner-next';
    hint.textContent = next;
    banner.appendChild(hint);
  }

  banner.classList.add('visible');
}

function hideBanner() {
  document.getElementById('errorBanner').classList.remove('visible');
}

async function checkForAppUpdate() {
  if (_reloadScheduled) return true;

  try {
    const res = await fetch(`app-version.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;

    const data = await res.json();
    if (!data?.version || data.version === APP_VERSION) return false;

    _reloadScheduled = true;
    showBanner(
      'A newer version of this workshop app is available.',
      'Reloading now so you get the latest Gateway response handling.',
      'New version available'
    );
    setTimeout(() => window.location.reload(), 1200);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  .env LOADER
// ═══════════════════════════════════════════════════════════════

async function loadEnv() {
  try {
    const res = await fetch(`.env?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key === 'IDMS_URL') IDMS_URL = value;
      if (key === 'GATEWAY_URL') GATEWAY_URL = value;
      if (key === 'UMH_URL') UMH_URL = value;
      if (key === 'DEALER_GUID') DEALER_GUID = value;
      if (key === 'USERNAME') _config.username = value;
      if (key === 'PASSWORD') _config.password = value;
      if (key === 'CLIENT_SECRET') _config.clientSecret = value;
    }
  } catch {
    // Keep the setup hint visible when .env is missing or incomplete.
  }

  renderConnection();
  updateRunAvailability();
}

// ═══════════════════════════════════════════════════════════════
//  CONNECTION PANEL — shows where the calls go and whether
//  credentials loaded. Never prints a secret.
// ═══════════════════════════════════════════════════════════════

function _hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
}

function _environmentLabel() {
  const host = _hostOf(GATEWAY_URL).toLowerCase();
  if (!host) return '';
  if (host.includes('test')) return 'TEST';
  if (host.includes('prod')) return 'PROD';
  return 'DEV';
}

function isConfigComplete() {
  return Boolean(
    IDMS_URL && GATEWAY_URL && UMH_URL && DEALER_GUID &&
    _config.username && _config.password && _config.clientSecret
  );
}

function renderConnection() {
  const configHint = document.getElementById('configHint');
  const configStatus = document.getElementById('configStatus');
  const ready = isConfigComplete();

  configHint.classList.toggle('hidden', ready);
  configStatus.classList.toggle('hidden', !ready);

  const chip = document.getElementById('envChip');
  const env = _environmentLabel();
  chip.textContent = env || 'NO ENV';
  if (env) {
    chip.setAttribute('data-env', env);
  } else {
    chip.removeAttribute('data-env');
  }

  const state = document.getElementById('connectionState');
  state.textContent = ready ? 'credentials loaded' : 'not configured';
  state.setAttribute('data-ok', String(ready));

  const rows = [
    ['Gateway', _hostOf(GATEWAY_URL), Boolean(GATEWAY_URL)],
    ['Media hub', _hostOf(UMH_URL), Boolean(UMH_URL)],
    ['Identity', _hostOf(IDMS_URL), Boolean(IDMS_URL)],
    ['Dealer', DEALER_GUID, Boolean(DEALER_GUID)],
    ['Username', _config.username, Boolean(_config.username)],
    ['Password', _config.password ? '••••••• loaded' : '', Boolean(_config.password)],
    ['Secret', _config.clientSecret ? '••••••• loaded' : '', Boolean(_config.clientSecret)]
  ];

  const list = document.getElementById('connectionList');
  list.textContent = '';

  for (const [label, value, ok] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = ok ? value : 'missing from .env';
    dd.setAttribute('data-ok', String(ok));
    list.appendChild(dt);
    list.appendChild(dd);
  }

  if (!ready) document.getElementById('connectionPanel').open = true;
}

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS — Do NOT modify.
// ═══════════════════════════════════════════════════════════════

/**
 * Authenticate with IDMS to get a bearer token.
 * Reads credentials from the loaded .env config.
 * Returns the JWT token string.
 */
async function authenticate() {
  const username = _config.username.trim();
  const password = _config.password.trim();
  const clientSecret = _config.clientSecret.trim();

  if (!IDMS_URL || !GATEWAY_URL || !UMH_URL || !DEALER_GUID) {
    throw new Error('Missing API config. Copy .env.example to .env and fill in IDMS_URL, GATEWAY_URL, UMH_URL, and DEALER_GUID.');
  }

  if (!username || !password || !clientSecret) {
    throw new Error('Missing credentials. Fill in USERNAME, PASSWORD, and CLIENT_SECRET in .env.');
  }

  const res = await fetch(`${IDMS_URL}/api/v1/Account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ClientId: 'ChampionWorkshop',
      ClientSecret: clientSecret,
      UserName: username,
      Password: password,
      ProductId: 'B3AD4A3C-71B1-43C4-3EF5-08DE4D806118',
      DmsDealerId: 199111001,
      LoginResolutionPolicy: 'DealerId'
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Authentication failed while getting an IDMS token. Check USERNAME, PASSWORD, CLIENT_SECRET, and the ChampionWorkshop client setup.${text ? ' Details: ' + text : ''}`);
  }

  const data = await res.json();
  _authToken = data.access_token || data.token;

  if (!_authToken) {
    throw new Error('Authentication succeeded, but IDMS did not return an access token. The loop cannot continue without a bearer token.');
  }

  return _authToken;
}

/**
 * Upload a PDF file. Returns { id, ingestionStatus, ... }
 */
async function uploadPdf(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('allowUnassigned', 'true');
  formData.append('generateEmbedding', 'true');
  formData.append('description', 'Uploaded for RAG exercise');

  const res = await fetch(`${UMH_URL}/api/v1/${getDealerGuid()}/media/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: formData
  });

  if (!res.ok) throw new Error(`Upload failed, so the document cannot be indexed for retrieval. Check UMH auth, dealer access, and file size/type. (${res.status} ${res.statusText})`);
  return await res.json();
}

/**
 * Poll the ingestion status of a media file. Returns { ingestionStatus, ... }
 */
async function getMediaStatus(mediaFileId) {
  const res = await fetch(`${UMH_URL}/api/v1/${getDealerGuid()}/media/${mediaFileId}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  if (!res.ok) throw new Error(`Status check failed, so the app cannot tell whether embeddings are ready. Check UMH availability and token validity. (${res.status} ${res.statusText})`);
  return await res.json();
}

/**
 * The ingestion statuses that mean UMH is still working on the file.
 *
 * Everything NOT in this list is terminal, and that is the point of expressing
 * it this way round. UMH's status enum is Pending, Processing, Extracting,
 * Embedding, Completed, Failed, Skipped -- and a poll loop written as
 * "break on Completed, throw on Failed" hangs forever on Skipped, which is not
 * a rare edge: UMH returns Skipped for a PDF with no text layer, i.e. a scan.
 * Most service manuals and invoices a dealership actually holds are scans.
 *
 * Waiting only on the in-flight set means a status nobody here has heard of
 * stops the loop instead of hanging it.
 */
const INGESTION_IN_FLIGHT = ['Pending', 'Processing', 'Extracting', 'Embedding'];

/**
 * Is UMH still ingesting this file? Keep polling while this is true.
 *
 * Compared case-insensitively on purpose: the API title-cases the status
 * ("Skipped") while the database stores it lower ("skipped"), so an exact
 * match is one serializer change away from hanging the loop again.
 */
function isIngestionInFlight(status) {
  const s = String(status ?? '').toLowerCase();
  return INGESTION_IN_FLIGHT.some(known => known.toLowerCase() === s);
}

/**
 * Explain a terminal status that is not success, so the loop can say something
 * useful instead of just stopping. Returns null when the file is ready.
 */
function explainIngestionStop(status) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'completed') return null;
  if (s === 'skipped') {
    return `TargetUMH skipped indexing this file (status: ${status}), so there is nothing for the ` +
      `agent to retrieve. The usual cause is a PDF with no text layer -- a scan. ` +
      `Try a PDF whose text you can select in a PDF reader.`;
  }
  if (s === 'failed') {
    return `TargetUMH failed to ingest this file (status: ${status}), so no embeddings exist for it. ` +
      `Check the file is a readable PDF and try the upload again.`;
  }
  return `TargetUMH stopped at an unrecognised ingestion status (${status}), so it is not safe to ` +
    `assume embeddings are ready.`;
}

/**
 * Chat with the Gateway using SSE streaming.
 *
 * @param {string} message       - The user's question/message
 * @param {function} onToolStart    - Called with (toolName, description) when a tool starts
 * @param {function} onToolComplete - Called with (toolName, success, summary) when a tool finishes
 * @param {function} onThinking     - Called with (message) when the LLM is thinking
 * @returns {Promise<{message: string, toolCalls: Array}>} The final answer and tool call log
 */
async function chatWithGateway(message, onToolStart, onToolComplete, onThinking) {
  const res = await fetch(`${GATEWAY_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gateway request failed, so the agent could not plan tool calls or compose an answer.${text ? ' Details: ' + text : ` (${res.status} ${res.statusText})`}`);
  }

  return _parseSseStream(res.body, onToolStart, onToolComplete, onThinking);
}

/**
 * Parse an SSE stream from the Gateway.
 */
async function _parseSseStream(body, onToolStart, onToolComplete, onThinking) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalMessage = '';
  const toolCalls = [];
  let eventType = null;
  let assistantTurnId = null;
  let sessionId = null;

  // Gateway events are not perfectly uniform. Normalize the common
  // shapes so the teaching app can focus on the loop, not event plumbing.
  function getEventText(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    return data.message || data.content || data.response?.message || data.response?.content || '';
  }

  function processLine(line) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
      return;
    }

    if (!line.startsWith('data: ') || !eventType) return;

    const dataStr = line.slice(6);
    let data;
    try { data = JSON.parse(dataStr); } catch { data = dataStr; }

    switch (eventType) {
      case 'tool_start':
        if (onToolStart) onToolStart(data.toolName || data.name, data.description || '');
        toolCalls.push({ name: data.toolName || data.name, status: 'started' });
        break;
      case 'tool_complete':
        if (onToolComplete) onToolComplete(data.toolName || data.name, data.success !== false, data.summary || '');
        break;
      case 'thinking':
        if (onThinking) onThinking(getEventText(data));
        break;
      case 'message':
        finalMessage += getEventText(data);
        break;
      case 'complete':
        finalMessage = getEventText(data) || finalMessage;
        // The id of the assistant turn the Gateway persisted, which is what a thumb
        // attaches to. Additive on the Gateway side, so treat it as optional.
        if (data && typeof data === 'object' && data.response) {
          assistantTurnId = data.response.assistantTurnId ?? assistantTurnId;
          sessionId = data.response.sessionId ?? sessionId;
        }
        break;
    }

    eventType = null;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      processLine(line);
    }
  }

  // Some Gateway responses end immediately after the final data line.
  // Flush any remaining partial event so the answer still renders.
  if (buffer.trim()) {
    processLine(buffer.trim());
  }

  _lastTurnId = assistantTurnId;
  return { message: finalMessage, toolCalls, assistantTurnId, sessionId };
}

// ═══════════════════════════════════════════════════════════════
//  TRACE RENDERING — the timing rail
//
//  addStep(id, title, detail, status) and updateStep(id, detail, status)
//  are the contract loop.js writes against. Everything below is how
//  they draw: a step is a row on the rail carrying its elapsed time,
//  and a step started while another step is still running is drawn as
//  a child of that step — which is exactly what a tool call is.
// ═══════════════════════════════════════════════════════════════

// Statuses loop.js uses, mapped to the four visual states.
const STEP_STATES = {
  thinking: 'running',
  waiting: 'running',
  complete: 'done',
  error: 'failed'
};

// _steps is keyed by a UNIQUE occurrence key and iterated in insertion order,
// so every loop over it walks the trace chronologically. _byId maps the LOGICAL
// id a caller passes (`poll`, `tool-get_artifact`, `thinking`) to each occurrence
// of it, newest last, so updateStep can find the right row when an id repeats.
const _steps = new Map();
const _byId = new Map();
let _traceStart = 0;
let _stepNumber = 0;
let _traceTicker = null;

function _visualState(status) {
  return STEP_STATES[status] || 'idle';
}

function _formatSeconds(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

function _reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function _scrollIntoView(el) {
  el.scrollIntoView({ behavior: _reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

/** Clear the trace and restart the clock. Called when a run starts. */
function resetTrace() {
  document.getElementById('loopTrace').textContent = '';
  document.getElementById('traceTotal').textContent = '';
  document.getElementById('traceEmpty').style.display = 'none';
  _steps.clear();
  _byId.clear();
  _stepNumber = 0;
  _traceStart = performance.now();
  _resetFeedback();
  _stopTicker();
}

function _stopTicker() {
  if (_traceTicker !== null) {
    clearInterval(_traceTicker);
    _traceTicker = null;
  }
}

/**
 * A run finished: stop the clock. Steps that never reported a result keep
 * their colour but stop pulsing — no completion event arrived for them.
 */
function freezeTrace() {
  const now = performance.now();
  for (const step of _steps.values()) {
    if (step.endedAt === null) {
      step.el.setAttribute('data-settled', 'true');
      step.durationEl.textContent = _formatSeconds(now - step.startedAt);
    }
  }
  _stopTicker();
}

/** A run ended early: freeze the clock and mark whatever was in flight. */
function haltTrace() {
  for (const step of _steps.values()) {
    if (step.endedAt === null) {
      step.el.setAttribute('data-state', 'failed');
      step.endedAt = performance.now();
      step.durationEl.textContent = _formatSeconds(step.endedAt - step.startedAt);
    }
  }
  _stopTicker();
}

/** Keep every running step's duration honest while it runs. */
function _tick() {
  const now = performance.now();
  let running = false;

  for (const step of _steps.values()) {
    if (step.endedAt === null) {
      running = true;
      step.durationEl.textContent = _formatSeconds(now - step.startedAt);
    }
  }

  document.getElementById('traceTotal').textContent =
    _steps.size ? `total ${_formatSeconds(now - _traceStart)}` : '';

  if (!running) _stopTicker();
}

function _startTicker() {
  if (_traceTicker === null) _traceTicker = setInterval(_tick, 100);
  _tick();
}

/** The step a new step belongs under: the deepest top-level step still running. */
// The two ids the Gateway's streamed events arrive under. These nest inside the
// step that was running when they arrived; anything else is a workflow step of
// the participant's own loop and stays top-level. Pass options.nest to override.
function _isStreamedEvent(id) {
  const s = String(id);
  return s.startsWith('tool-') || s === 'thinking';
}

// The row a caller means when they name an id: the newest occurrence still open,
// else the newest overall. An id that has never been added returns undefined.
function _latestFor(id) {
  const list = _byId.get(id);
  if (!list || !list.length) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].endedAt === null) return list[i];
  }
  return list[list.length - 1];
}

function _openParent() {
  let parent = null;
  for (const step of _steps.values()) {
    if (step.depth === 0 && step.endedAt === null) parent = step;
  }
  return parent;
}

/**
 * Payload rendering for a nested tool call: one collapsed line, expandable
 * to the whole body. Long or multi-line text gets the toggle; short text
 * just shows.
 */
function _renderDetail(step, detail) {
  const text = detail === undefined || detail === null ? '' : String(detail);
  step.detailText = text;

  if (step.depth === 0) {
    step.detailEl.textContent = text;
    return;
  }

  const expandable = text.length > 72 || text.includes('\n') || text.includes('{');
  step.body.querySelectorAll('.step-summary, .step-payload, .expand-btn').forEach(el => el.remove());
  if (!text) return;

  if (!expandable) {
    const summary = document.createElement('div');
    summary.className = 'step-summary';
    summary.textContent = text;
    step.body.insertBefore(summary, step.children);
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'step-summary';
  summary.textContent = text;

  const payload = document.createElement('pre');
  payload.className = 'step-payload';
  payload.textContent = text;
  payload.hidden = !step.expanded;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'expand-btn';
  toggle.setAttribute('aria-expanded', String(Boolean(step.expanded)));

  function paint() {
    summary.hidden = Boolean(step.expanded);
    payload.hidden = !step.expanded;
    toggle.textContent = step.expanded ? 'hide payload' : 'show payload';
    toggle.setAttribute('aria-expanded', String(Boolean(step.expanded)));
  }

  toggle.addEventListener('click', () => {
    step.expanded = !step.expanded;
    paint();
  });

  paint();
  step.body.insertBefore(summary, step.children);
  step.body.insertBefore(payload, step.children);
  step.body.insertBefore(toggle, step.children);
}

/**
 * A "thinking" note is a moment between tool calls, not a span the Gateway
 * ever closes. The next event under the same step ends it.
 */
function _settleThoughts(parent) {
  if (!parent) return;
  const now = performance.now();
  for (const step of _steps.values()) {
    if (step.parent === parent && step.kind === 'think' && step.endedAt === null) {
      step.endedAt = now;
      step.el.setAttribute('data-state', 'idle');
      step.durationEl.textContent = _formatSeconds(step.endedAt - step.startedAt);
    }
  }
}

function _applyState(step, status) {
  const state = _visualState(status);
  step.el.setAttribute('data-state', state);
  if (state !== 'running' && state !== 'idle') _settleThoughts(step);

  if (state === 'running') {
    if (step.endedAt !== null) {
      step.endedAt = null;
      step.startedAt = performance.now();
    }
    _startTicker();
  } else if (state !== 'idle' && step.endedAt === null) {
    step.endedAt = performance.now();
    step.durationEl.textContent = _formatSeconds(step.endedAt - step.startedAt);
  }
}

/**
 * Add a new step to the loop trace.
 *
 * @param {string} id      - Stable id; updateStep(id, ...) targets the same step
 * @param {string} title   - Step name, or the tool name for a tool call
 * @param {string} detail  - Body text; tool payloads collapse behind a toggle
 * @param {string} status  - thinking | waiting | complete | error
 * @param {object} [options] - Optional. { parent: 'step-id' } to force nesting.
 */
function addStep(id, title, detail, status, options) {
  if (!_traceStart) _traceStart = performance.now();
  document.getElementById('traceEmpty').style.display = 'none';

  // Only streamed Gateway events nest. Inferring a parent from "something is
  // still open" put a half-finished learner loop into a wrong shape: add `poll`,
  // forget to complete it, add `gateway`, and Gateway became a CHILD of Poll --
  // and because only depth-0 rows are candidates, every later tool event then
  // hung off Poll too. A workflow step is now always top-level.
  const nestable = options && typeof options.nest === 'boolean'
    ? options.nest
    : _isStreamedEvent(id);
  const forcedParent = options && options.parent ? _latestFor(options.parent) : undefined;
  const parent = forcedParent !== undefined
    ? forcedParent
    : (nestable ? _openParent() : null);
  const depth = parent ? 1 : 0;
  const isTool = String(id).startsWith('tool-');
  _settleThoughts(parent);

  // The first occurrence keeps the plain `step-<id>` element id, so code that
  // looks a step up by name (the exercise skeleton checks for `step-poll`) still
  // finds it; later occurrences are suffixed so ids stay unique in the document.
  const occurrence = (_byId.get(id) || []).length;
  const el = document.createElement('div');
  el.className = 'step';
  el.id = occurrence === 0 ? `step-${id}` : `step-${id}--${occurrence + 1}`;
  el.setAttribute('data-depth', String(depth));
  el.setAttribute('data-kind', depth === 0 ? 'step' : (isTool ? 'tool' : 'think'));

  const rail = document.createElement('div');
  rail.className = 'step-rail';
  const marker = document.createElement('span');
  marker.className = 'step-marker';
  rail.appendChild(marker);

  const timeEl = document.createElement('div');
  timeEl.className = 'step-time';
  timeEl.textContent = _formatSeconds(performance.now() - _traceStart);

  const body = document.createElement('div');
  body.className = 'step-body';

  const head = document.createElement('div');
  head.className = 'step-head';

  if (depth === 0) {
    _stepNumber += 1;
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = String(_stepNumber);
    head.appendChild(num);
  }

  const titleEl = document.createElement('span');
  titleEl.className = depth === 0 ? 'step-title' : 'tool-name';
  titleEl.textContent = title;
  head.appendChild(titleEl);

  const durationEl = document.createElement('span');
  durationEl.className = 'step-dur';
  head.appendChild(durationEl);

  const detailEl = document.createElement('div');
  detailEl.className = 'step-detail';

  const children = document.createElement('div');
  children.className = 'step-children';

  body.appendChild(head);
  if (depth === 0) body.appendChild(detailEl);
  body.appendChild(children);

  el.appendChild(rail);
  el.appendChild(timeEl);
  el.appendChild(body);

  const step = {
    el, body, head, titleEl, detailEl, durationEl, children, depth, timeEl,
    parent: parent || null,
    kind: depth === 0 ? 'step' : (isTool ? 'tool' : 'think'),
    startedAt: performance.now(),
    endedAt: null,
    expanded: false,
    detailText: ''
  };

  step.logicalId = id;
  _steps.set(occurrence === 0 ? id : `${id}#${occurrence + 1}`, step);
  if (!_byId.has(id)) _byId.set(id, []);
  _byId.get(id).push(step);
  (parent ? parent.children : document.getElementById('loopTrace')).appendChild(el);

  _applyState(step, status);
  _renderDetail(step, detail);
  _scrollIntoView(el);
}

/**
 * Update an existing step's detail text and status.
 *
 * @param {string} id     - The id passed to addStep
 * @param {string} detail - New body text
 * @param {string} status - thinking | waiting | complete | error
 */
function updateStep(id, detail, status) {
  const step = _latestFor(id);
  if (!step) return;

  _applyState(step, status);
  _renderDetail(step, detail);
}

/**
 * Display the final answer in the answer section.
 */
function showAnswer(html) {
  const section = document.getElementById('answerSection');
  const box = document.getElementById('answerBox');
  box.innerHTML = html || '<em>The Gateway returned no final answer.</em>';
  section.classList.add('visible');
  _renderFeedback();
  _scrollIntoView(section);
}

// ═══════════════════════════════════════════════════════════════
//  FEEDBACK — was that answer any good?
//
//  A thumb is not decoration. It is the signal the platform's review queue is
//  built on: the Gateway stores it against the assistant turn, and it then shows
//  up in the operator console's eval-review queue for whoever is triaging this
//  product. Workshop 3 is about judging answers at scale; this is where the
//  judgements come from in the first place.
//
//  It attaches to A TURN, not to a session and not to the text on screen, which
//  is why it cannot render until the Gateway has told us which turn it persisted.
// ═══════════════════════════════════════════════════════════════

/**
 * Render the thumb row under the answer, or say why there is none.
 */
/**
 * Clear the previous run's rating state. Its own function because it is a GUARD, and a
 * guard buried inside handleRun cannot be tested without running the whole loop -- so
 * it was untested, and deleting it left every check green while showAnswer would have
 * offered a thumb still pointing at the previous run's turn.
 */
function _resetFeedback() {
  _lastTurnId = null;
  _feedbackHost()?.replaceChildren();
}

function _feedbackHost() {
  const host = document.getElementById('answerFeedback');
  if (!host) console.error('No #answerFeedback element, so the thumb row cannot render.');
  return host;
}

/**
 * The status line, created ONCE and never replaced.
 *
 * A live region has to already be in the document when its text changes, or a
 * screen reader has nothing to watch and the change is announced to nobody. The
 * first version of this rebuilt the whole row on every state change, which meant
 * "Sending", "Recorded" and "Could not record that" were all silent -- on a
 * feature whose entire point was that a failure must not pass unnoticed.
 */
function _feedbackStatus() {
  const host = _feedbackHost();
  if (!host) return null;
  let el = host.querySelector('.fb-status');
  if (!el) {
    el = document.createElement('span');
    el.className = 'fb-status fb-note';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');   // read the whole line, not the diff
    el.tabIndex = -1;                         // so focus can be parked here
    host.appendChild(el);
  }
  return el;
}

function _controls() {
  const host = _feedbackHost();
  if (!host) return null;
  let el = host.querySelector('.fb-controls');
  if (!el) {
    el = document.createElement('span');
    el.className = 'fb-controls';
    host.insertBefore(el, host.firstChild);
  }
  return el;
}

/**
 * Is the row still the one this request started against? A `false` here is not a
 * failure -- the POST landed and the rating is recorded; the user has simply moved on
 * to another answer, and writing this result over their new row would be a lie about
 * which turn it belongs to.
 */
function _stillOwns(node) {
  const host = document.getElementById('answerFeedback');
  return !!host && !!node && host.querySelector('.fb-status') === node;
}

function _setStatus(text, kind) {
  const el = _feedbackStatus();
  if (!el) return;
  el.className = 'fb-status fb-note' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

/** Render the thumb row under the answer, or say why there is none. */
function _renderFeedback() {
  const host = _feedbackHost();
  if (!host) return;
  host.textContent = '';
  const controls = _controls();
  _setStatus('', null);

  // No turn id means the Gateway did not persist this turn (storage off, or the
  // write failed). Say that, rather than offering a button that would 404 -- a
  // missing control with no explanation reads as a broken page.
  if (!_lastTurnId) {
    _setStatus('This answer was not persisted, so there is no turn to attach feedback to.', null);
    return;
  }

  const label = document.createElement('span');
  label.className = 'fb-label';
  label.textContent = 'Was this answer useful?';

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'fb-btn';
  up.setAttribute('aria-label', 'Yes, this answer was useful');
  up.textContent = '\u{1F44D} Yes';

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'fb-btn';
  down.setAttribute('aria-label', 'No, this answer was not useful');
  down.textContent = '\u{1F44E} No';

  up.addEventListener('click', () => _sendFeedback(1, '', up));
  // A thumbs-down with no comment is a number; with a comment it is something a
  // reviewer can act on. Ask, but never require it.
  down.addEventListener('click', () => _promptForComment());

  controls.append(label, up, down);
}

/** Thumbs-down: offer one line of "what was wrong", then send. */
function _promptForComment() {
  const controls = _controls();
  if (!controls) return;
  controls.textContent = '';

  const label = document.createElement('label');
  label.className = 'fb-label';
  label.setAttribute('for', 'fbComment');
  label.textContent = 'What was wrong with it?';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'fbComment';
  input.className = 'fb-input';
  input.maxLength = 4000;   // the Gateway rejects anything longer
  input.placeholder = 'Optional \u2014 this is what a reviewer reads';

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'fb-btn';
  send.textContent = 'Send';

  const submit = () => _sendFeedback(0, input.value.trim(), send);
  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  controls.append(label, input, send);
  input.focus();
}

/**
 * POST the thumb to the Gateway. Feedback lands against the assistant turn, and a
 * thumbs-down enters the product's triage queue.
 *
 * `trigger` is the button that was pressed. On failure it is re-enabled and refocused,
 * so retrying is the same button the user already had -- rather than a new control
 * appearing somewhere after their focus had been thrown to the top of the document.
 */
async function _sendFeedback(score, comment, trigger) {
  const host = _feedbackHost();
  if (!host) return;
  const turnId = _lastTurnId;
  const buttons = [...host.querySelectorAll('.fb-btn')];
  const field = host.querySelector('.fb-input');
  // The status node THIS request owns. Everything below happens after an await, and by
  // then the row may belong to a different answer: start a new run while a thumb is in
  // flight and the old response would remove the new answer's buttons and report the
  // old turn's result over them. A reset or a re-render rebuilds these nodes, so node
  // identity is what says "still mine" -- and it needs no counter anyone must remember
  // to bump.
  const owned = _feedbackStatus();

  buttons.forEach(b => { b.disabled = true; });
  if (field) field.disabled = true;
  _setStatus('Sending\u2026', null);

  try {
    const res = await fetch(`${GATEWAY_URL}/api/v1/${DEALER_GUID}/feedback`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversationTurnId: turnId,
        score,                             // 1 = up, 0 = down. The Gateway takes no other value.
        comment: comment || null
      })
    });

    if (!res.ok) {
      // Surface it. A thumb that silently fails to record is worse than no thumb,
      // because the review queue then under-reports and nobody knows why.
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${detail ? ' \u2014 ' + detail.slice(0, 300) : ''}`);
    }

    if (!_stillOwns(owned)) {
      console.debug(`Feedback for turn ${turnId} recorded, but a newer answer is on screen -- not touching it.`);
      return;
    }

    // Done: the controls go, and focus moves to the line that says what happened,
    // so a keyboard user is not left on a button that no longer exists.
    _controls()?.replaceChildren();
    _setStatus(score === 1
      ? '\u{1F44D} Recorded against turn ' + turnId + '.'
      : '\u{1F44E} Recorded against turn ' + turnId + ' and queued for review.', 'fb-ok');
    _feedbackStatus()?.focus();
  } catch (err) {
    if (!_stillOwns(owned)) {
      console.debug(`Feedback for turn ${turnId} failed (${err.message}), but a newer answer is on screen -- not touching it.`);
      return;
    }
    _setStatus(`Could not record that: ${err.message} \u2014 try again.`, 'fb-err');
    buttons.forEach(b => { b.disabled = false; });
    if (field) field.disabled = false;
    (trigger && host.contains(trigger) ? trigger : buttons[0])?.focus();
  }
}

/**
 * Async sleep helper.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
//  UI WIRING — handles clicks, drag-drop, run button
// ═══════════════════════════════════════════════════════════════

let selectedFile = null;

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileNameEl = document.getElementById('fileName');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) selectFile(fileInput.files[0]);
});

function selectFile(file) {
  if (file.type !== 'application/pdf') {
    showBanner('That file is not a PDF.', 'Pick a PDF and try again.', 'Wrong file type');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showBanner('That PDF is larger than 10 MB.', 'Pick a smaller document and try again.', 'File too large');
    return;
  }
  hideBanner();
  selectedFile = file;
  uploadArea.classList.add('has-file');
  fileNameEl.textContent = file.name;
  updateRunAvailability();
}

/** The run button says what is missing rather than failing on click. */
function updateRunAvailability() {
  const btn = document.getElementById('runBtn');
  const reason = document.getElementById('runReason');
  if (btn.dataset.running === 'true') return;

  const question = document.getElementById('questionInput').value.trim();

  let blocker = '';
  if (!isConfigComplete()) blocker = 'Fill in .env to run the loop.';
  else if (!selectedFile) blocker = 'Choose a PDF to run the loop.';
  else if (!question) blocker = 'Type a question to run the loop.';

  btn.disabled = Boolean(blocker);
  reason.textContent = blocker;
}

document.getElementById('questionInput').addEventListener('input', updateRunAvailability);

// Run button
async function handleRun() {
  const question = document.getElementById('questionInput').value.trim();
  if (!question || !selectedFile) { updateRunAvailability(); return; }

  if (await checkForAppUpdate()) return;

  const btn = document.getElementById('runBtn');
  btn.dataset.running = 'true';
  btn.disabled = true;
  btn.textContent = 'Running the loop…';
  document.getElementById('runReason').textContent = '';
  resetTrace();
  document.getElementById('answerSection').classList.remove('visible');
  hideBanner();

  try {
    await authenticate();
    await runAgenticLoop(selectedFile, question);
  } catch (err) {
    haltTrace();
    showBanner(err.message, 'Fix the cause above, then run the loop again.');
    console.error(err);
  } finally {
    freezeTrace();
    btn.dataset.running = 'false';
    btn.textContent = 'Run the loop';
    updateRunAvailability();
  }
}

// Load .env on page load
loadEnv();
updateRunAvailability();
