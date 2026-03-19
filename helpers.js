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

// Config loaded from .env file
let _config = { username: '', password: '', clientSecret: '' };

function getToken() {
  return _authToken;
}

function getDealerGuid() {
  return DEALER_GUID;
}

function showBanner(message) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = message;
  banner.classList.add('visible');
}

async function checkForAppUpdate() {
  if (_reloadScheduled) return true;

  try {
    const res = await fetch(`app-version.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;

    const data = await res.json();
    if (!data?.version || data.version === APP_VERSION) return false;

    _reloadScheduled = true;
    showBanner('A newer version of this workshop app is available. Reloading so you get the latest Gateway response handling...');
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
  const configHint = document.getElementById('configHint');
  const configStatus = document.getElementById('configStatus');

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

  if (IDMS_URL && GATEWAY_URL && UMH_URL && DEALER_GUID &&
      _config.username && _config.password && _config.clientSecret) {
    configHint.classList.add('hidden');
    configStatus.classList.remove('hidden');
  } else {
    configHint.classList.remove('hidden');
    configStatus.classList.add('hidden');
  }
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

  return { message: finalMessage, toolCalls };
}

/**
 * Add a new step card to the loop trace.
 */
function addStep(id, title, detail, status) {
  const trace = document.getElementById('loopTrace');
  const card = document.createElement('div');
  card.className = `step-card ${status}`;
  card.id = `step-${id}`;

  const statusIcons = { thinking: '...', waiting: '&#8987;', complete: '&#10003;', error: '&#10007;' };

  card.innerHTML = `
    <div class="step-title">
      ${title}
      <span class="step-status-icon">${statusIcons[status] || ''}</span>
    </div>
    <div class="step-detail">${detail}</div>
  `;

  trace.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Update an existing step card's detail text and status.
 */
function updateStep(id, detail, status) {
  const card = document.getElementById(`step-${id}`);
  if (!card) return;

  card.className = `step-card ${status}`;
  const statusIcons = { thinking: '...', waiting: '&#8987;', complete: '&#10003;', error: '&#10007;' };
  card.querySelector('.step-status-icon').innerHTML = statusIcons[status] || '';
  card.querySelector('.step-detail').textContent = detail;
}

/**
 * Display the final answer in the answer section.
 */
function showAnswer(html) {
  const section = document.getElementById('answerSection');
  const box = document.getElementById('answerBox');
  box.innerHTML = html || '<em>No final answer was returned by the Gateway.</em>';
  section.classList.add('visible');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  if (file.type !== 'application/pdf') { alert('Please select a PDF file.'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('File too large. Maximum size is 10 MB.'); return; }
  selectedFile = file;
  uploadArea.classList.add('has-file');
  fileNameEl.textContent = file.name;
}

// Run button
async function handleRun() {
  const question = document.getElementById('questionInput').value.trim();
  if (!question) { alert('Please enter a question.'); return; }
  if (!selectedFile) { alert('Please select a PDF file.'); return; }

  if (await checkForAppUpdate()) return;

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('loopTrace').innerHTML = '';
  document.getElementById('answerSection').classList.remove('visible');
  document.getElementById('errorBanner').classList.remove('visible');

  try {
    await authenticate();
    await runAgenticLoop(selectedFile, question);
  } catch (err) {
    const banner = document.getElementById('errorBanner');
    banner.textContent = `Error: ${err.message}`;
    banner.classList.add('visible');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// Load .env on page load
loadEnv();
