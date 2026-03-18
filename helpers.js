// ═══════════════════════════════════════════════════════════════
//  CONFIGURATION — DO NOT MODIFY
// ═══════════════════════════════════════════════════════════════

const DEALER_GUID = '23f9cad3-175b-4ff9-b0bf-c49c35c7245e';

function isLiveMode() {
  return document.getElementById('modeToggle').checked;
}

function getBaseUrl() {
  return document.getElementById('baseUrl').value.replace(/\/+$/, '');
}

function getToken() {
  return document.getElementById('bearerToken').value.trim();
}

function getDealerGuid() {
  return document.getElementById('dealerGuid').value.trim() || DEALER_GUID;
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

  vectorSearch: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [
              { mediaFileId: 'a1b2c3d4-5678-9abc-def0-123456789abc', chunkIndex: 2, pageNumber: 12, score: 0.92, preview: 'WARNING: Do not operate this equipment in enclosed or poorly ventilated spaces...' },
              { mediaFileId: 'a1b2c3d4-5678-9abc-def0-123456789abc', chunkIndex: 5, pageNumber: 15, score: 0.87, preview: 'CAUTION: Always wear protective equipment including safety goggles and gloves when...' },
              { mediaFileId: 'a1b2c3d4-5678-9abc-def0-123456789abc', chunkIndex: 8, pageNumber: 22, score: 0.83, preview: 'DANGER: Disconnect the battery and wait 5 minutes before servicing any electrical...' }
            ],
            totalMatches: 3
          })
        }
      ]
    }
  },

  getChunks: {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            chunks: [
              {
                chunkIndex: 2,
                pageNumber: 12,
                text: 'SAFETY WARNING #1 — VENTILATION\n\nDo not operate this equipment in enclosed or poorly ventilated spaces. Carbon monoxide from engine exhaust is odorless and can cause serious injury or death. Ensure adequate airflow of at least 500 CFM when operating indoors. Install carbon monoxide detectors in all enclosed workspaces where this equipment is used.'
              },
              {
                chunkIndex: 5,
                pageNumber: 15,
                text: 'SAFETY WARNING #2 — PROTECTIVE EQUIPMENT\n\nAlways wear protective equipment including safety goggles, heat-resistant gloves, and steel-toed boots when operating or servicing this equipment. Hearing protection is required when noise levels exceed 85 dB. Loose clothing must be secured before approaching moving parts.'
              },
              {
                chunkIndex: 8,
                pageNumber: 22,
                text: 'SAFETY WARNING #3 — ELECTRICAL HAZARD\n\nDisconnect the battery and wait a minimum of 5 minutes before servicing any electrical components. Capacitors may retain charge after power is disconnected. Use an insulated voltage tester to verify zero energy state. Only qualified technicians should perform electrical repairs.'
              }
            ]
          })
        }
      ]
    }
  }
};

let mockPollIndex = 0;

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS — These are provided for you. Do NOT modify.
// ═══════════════════════════════════════════════════════════════

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

  const res = await fetch(`${getBaseUrl()}/api/v1/${getDealerGuid()}/media/upload`, {
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

  const res = await fetch(`${getBaseUrl()}/api/v1/${getDealerGuid()}/media/${mediaFileId}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  if (!res.ok) throw new Error(`Status check failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Call an MCP tool via JSON-RPC. Returns the tool result.
 *
 * @param {string} toolName - e.g. "vector_search_media" or "get_document_chunks"
 * @param {object} args     - the arguments object for the tool
 * @returns {object} parsed result from the MCP response
 */
async function callTool(toolName, args) {
  if (!isLiveMode()) {
    await sleep(600);
    if (toolName === 'vector_search_media') {
      return JSON.parse(MOCK.vectorSearch.result.content[0].text);
    }
    if (toolName === 'get_document_chunks') {
      return JSON.parse(MOCK.getChunks.result.content[0].text);
    }
    throw new Error(`Unknown mock tool: ${toolName}`);
  }

  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: { dealerGuid: getDealerGuid(), ...args }
    }
  };

  const res = await fetch(`${getBaseUrl()}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`MCP call failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`MCP error: ${json.error.message}`);
  return JSON.parse(json.result.content[0].text);
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

  if (isLiveMode()) {
    if (!getBaseUrl()) { alert('Please enter the API Base URL in the Live Mode config panel.'); return; }
    if (!getToken()) { alert('Please paste your Bearer token in the Live Mode config panel.'); return; }
  }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('loopTrace').innerHTML = '';
  document.getElementById('answerSection').classList.remove('visible');
  document.getElementById('errorBanner').classList.remove('visible');
  mockPollIndex = 0;

  try {
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
