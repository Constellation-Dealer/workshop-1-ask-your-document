// ═══════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const DEALER_GUID = '23f9cad3-175b-4ff9-b0bf-c49c35c7245e';
const IDMS_URL = 'https://identitymanagementdev.azurewebsites.net';
const GATEWAY_URL = 'https://targetmcp-gateway.azurewebsites.net';
const UMH_URL = 'https://app-targetumh-dev.azurewebsites.net';

let _authToken = null;

// Credentials loaded from .env file
let _config = { username: '', password: '', clientSecret: '' };

function getToken() {
  return _authToken;
}

function getDealerGuid() {
  return DEALER_GUID;
}

// ═══════════════════════════════════════════════════════════════
//  .env LOADER
// ═══════════════════════════════════════════════════════════════

async function loadEnv() {
  try {
    const res = await fetch('.env');
    if (!res.ok) throw new Error();
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key === 'USERNAME') _config.username = value;
      if (key === 'PASSWORD') _config.password = value;
      if (key === 'CLIENT_SECRET') _config.clientSecret = value;
    }
  } catch {
    // .env not found — credentials must be entered in the config panel
  }

  // Prefill the config panel from .env values
  if (_config.username) document.getElementById('username').value = _config.username;
  if (_config.password) document.getElementById('password').value = _config.password;
  if (_config.clientSecret) document.getElementById('clientSecret').value = _config.clientSecret;

  // Hide the setup hint if all credentials are loaded
  if (_config.username && _config.password && _config.clientSecret) {
    document.getElementById('configHint').classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS — Do NOT modify.
// ═══════════════════════════════════════════════════════════════

/**
 * Authenticate with IDMS to get a bearer token.
 * Reads credentials from the config panel (prefilled from .env).
 * Returns the JWT token string.
 */
async function authenticate() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const clientSecret = document.getElementById('clientSecret').value.trim();

  if (!username || !password || !clientSecret) {
    throw new Error('Missing credentials. Fill in .env (see .env.example) or enter them in the config panel above.');
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
    throw new Error(`Authentication failed: ${res.status} ${res.statusText}${text ? ' — ' + text : ''}`);
  }

  const data = await res.json();
  _authToken = data.token;
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

  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Poll the ingestion status of a media file. Returns { ingestionStatus, ... }
 */
async function getMediaStatus(mediaFileId) {
  const res = await fetch(`${UMH_URL}/api/v1/${getDealerGuid()}/media/${mediaFileId}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  if (!res.ok) throw new Error(`Status check failed: ${res.status} ${res.statusText}`);
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
    throw new Error(`Gateway chat failed: ${res.status} ${res.statusText}${text ? ' — ' + text : ''}`);
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    let eventType = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && eventType) {
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
            if (onThinking) onThinking(data.message || data);
            break;
          case 'message':
            finalMessage += (typeof data === 'string' ? data : data.content || data.message || '');
            break;
          case 'complete':
            finalMessage = (typeof data === 'string' ? data : data.message || data.content || finalMessage);
            break;
        }
        eventType = null;
      }
    }
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
  box.innerHTML = html;
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
