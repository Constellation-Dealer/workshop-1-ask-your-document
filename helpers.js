// ═══════════════════════════════════════════════════════════════
//  CONFIGURATION — DO NOT MODIFY
// ═══════════════════════════════════════════════════════════════

const DEALER_GUID = '23f9cad3-175b-4ff9-b0bf-c49c35c7245e';
const IDMS_URL = 'https://identitymanagementdev.azurewebsites.net';
const GATEWAY_URL = 'https://targetmcp-gateway.azurewebsites.net';
const UMH_URL = 'https://app-targetumh-dev.azurewebsites.net';

let _authToken = null;

function isLiveMode() {
  return document.getElementById('modeToggle').checked;
}

function getToken() {
  return _authToken;
}

function getDealerGuid() {
  return DEALER_GUID;
}

// ═══════════════════════════════════════════════════════════════
//  MOCK DATA — realistic responses for offline development
// ═══════════════════════════════════════════════════════════════

const MOCK = {
  upload: {
    id: 'a1b2c3d4-5678-9abc-def0-123456789abc',
    name: 'sample-manual.pdf',
    contentType: 'application/pdf',
    size: 2458624,
    ingestionStatus: 'Pending',
    hasEmbedding: false,
    dateAdded: new Date().toISOString()
  },

  // Polling returns these in sequence: Pending → Processing → Completed
  pollSequence: [
    { id: 'a1b2c3d4-5678-9abc-def0-123456789abc', ingestionStatus: 'Processing', hasEmbedding: false },
    { id: 'a1b2c3d4-5678-9abc-def0-123456789abc', ingestionStatus: 'Processing', hasEmbedding: false },
    { id: 'a1b2c3d4-5678-9abc-def0-123456789abc', ingestionStatus: 'Completed', hasEmbedding: true }
  ],

  // Mock answer text (same safety warnings as before)
  gatewayAnswer: `<p>Based on the document, I found the following safety warnings:</p>
<p><span class="page-ref">Page 12</span> <strong>SAFETY WARNING #1 — VENTILATION</strong><br>
Do not operate this equipment in enclosed or poorly ventilated spaces. Carbon monoxide from engine exhaust is odorless and can cause serious injury or death. Ensure adequate airflow of at least 500 CFM when operating indoors. Install carbon monoxide detectors in all enclosed workspaces where this equipment is used.</p>
<p><span class="page-ref">Page 15</span> <strong>SAFETY WARNING #2 — PROTECTIVE EQUIPMENT</strong><br>
Always wear protective equipment including safety goggles, heat-resistant gloves, and steel-toed boots when operating or servicing this equipment. Hearing protection is required when noise levels exceed 85 dB. Loose clothing must be secured before approaching moving parts.</p>
<p><span class="page-ref">Page 22</span> <strong>SAFETY WARNING #3 — ELECTRICAL HAZARD</strong><br>
Disconnect the battery and wait a minimum of 5 minutes before servicing any electrical components. Capacitors may retain charge after power is disconnected. Use an insulated voltage tester to verify zero energy state. Only qualified technicians should perform electrical repairs.</p>`
};

let mockPollIndex = 0;

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS — These are provided for you. Do NOT modify.
// ═══════════════════════════════════════════════════════════════

/**
 * Authenticate with IDMS to get a bearer token.
 * Reads credentials from the Live Mode config panel.
 * Returns the JWT token string.
 */
async function authenticate() {
  if (!isLiveMode()) {
    _authToken = 'mock-token';
    return _authToken;
  }

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const clientSecret = document.getElementById('clientSecret').value.trim();

  if (!username || !password || !clientSecret) {
    throw new Error('Please fill in Username, Password, and Client Secret in the Live Mode config panel.');
  }

  const res = await fetch(`${IDMS_URL}/api/v1/Account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ClientId: 'TargetDMS',
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
  if (!isLiveMode()) {
    await sleep(800);
    return { ...MOCK.upload, name: file.name };
  }

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
  if (!isLiveMode()) {
    await sleep(1000);
    const response = MOCK.pollSequence[Math.min(mockPollIndex, MOCK.pollSequence.length - 1)];
    mockPollIndex++;
    return { ...response };
  }

  const res = await fetch(`${UMH_URL}/api/v1/${getDealerGuid()}/media/${mediaFileId}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  if (!res.ok) throw new Error(`Status check failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Chat with the Gateway using SSE streaming.
 *
 * Sends a message to the Gateway's streaming Chat API and processes
 * server-sent events in real time. Tool calls made by the LLM agent
 * are reported via callbacks so you can render them in the loop trace.
 *
 * @param {string} message       - The user's question/message
 * @param {function} onToolStart    - Called with (toolName, description) when a tool starts
 * @param {function} onToolComplete - Called with (toolName, success, summary) when a tool finishes
 * @param {function} onThinking     - Called with (message) when the LLM is thinking
 * @returns {Promise<{message: string, toolCalls: Array}>} The final answer and tool call log
 */
async function chatWithGateway(message, onToolStart, onToolComplete, onThinking) {
  if (!isLiveMode()) {
    return _mockChatStream(onToolStart, onToolComplete, onThinking);
  }

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
 * Events: tool_start, tool_complete, thinking, message, complete
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
    buffer = lines.pop(); // keep incomplete line in buffer

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
      } else if (line === '' || line.startsWith(':')) {
        // empty line (event boundary) or comment — ignore
      }
    }
  }

  return { message: finalMessage, toolCalls };
}

/**
 * Mock SSE stream with realistic delays for offline development.
 */
async function _mockChatStream(onToolStart, onToolComplete, onThinking) {
  await sleep(500);
  if (onToolStart) onToolStart('vector_search_media', 'Searching for relevant document chunks...');

  await sleep(1000);
  if (onToolComplete) onToolComplete('vector_search_media', true, 'Found 3 matching chunks from pages 12, 15, 22');

  await sleep(500);
  if (onToolStart) onToolStart('get_document_chunks', 'Retrieving full text from matched pages...');

  await sleep(500);
  if (onToolComplete) onToolComplete('get_document_chunks', true, 'Retrieved 3 chunks');

  await sleep(500);
  if (onThinking) onThinking('Composing answer from retrieved chunks...');

  await sleep(500);
  return {
    message: MOCK.gatewayAnswer,
    toolCalls: [
      { name: 'vector_search_media', status: 'complete' },
      { name: 'get_document_chunks', status: 'complete' }
    ]
  };
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
//  UI WIRING — handles clicks, drag-drop, mode toggle
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

function getMockFile() {
  return new File(['mock'], 'sample-manual.pdf', { type: 'application/pdf' });
}

// Mode toggle
const modeToggle = document.getElementById('modeToggle');
const liveConfig = document.getElementById('liveConfig');
const mockLabel = document.getElementById('mockLabel');
const liveLabel = document.getElementById('liveLabel');

modeToggle.addEventListener('change', () => {
  const isLive = modeToggle.checked;
  liveConfig.classList.toggle('visible', isLive);
  mockLabel.classList.toggle('active', !isLive);
  liveLabel.classList.toggle('active', isLive);
});

// Run button
async function handleRun() {
  const question = document.getElementById('questionInput').value.trim();
  if (!question) { alert('Please enter a question.'); return; }

  const file = selectedFile || (!isLiveMode() ? getMockFile() : null);
  if (!file) { alert('Please select a PDF file.'); return; }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('loopTrace').innerHTML = '';
  document.getElementById('answerSection').classList.remove('visible');
  document.getElementById('errorBanner').classList.remove('visible');
  mockPollIndex = 0;

  try {
    // Authenticate first (in live mode, gets a real IDMS token)
    await authenticate();
    await runAgenticLoop(file, question);
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
