// ═══════════════════════════════════════════════════════════════
//
//  loop.js — THE AGENTIC LOOP
//
//  CONTRACT
//  - loop.js owns the workflow: upload -> wait -> ask Gateway -> render answer
//  - helpers.js owns auth, API calls, SSE parsing, and DOM primitives
//  - addStep/updateStep only update the trace UI; they do not call the Gateway
//  - chatWithGateway is the actual Gateway API call and streams tool activity
//
// ═══════════════════════════════════════════════════════════════

async function runAgenticLoop(file, question) {

  // ── Step 1: Upload the PDF ────────────────────────────────
  addStep('upload', 'Upload + Index', `Uploading ${file.name}...`, 'thinking');

  const upload = await uploadPdf(file);

  updateStep('upload', `Uploaded! ID: ${upload.id}\ningestionStatus: ${upload.ingestionStatus}`, 'complete');


  // ── Step 2: Poll until embeddings are ready ───────────────
  addStep('poll', 'Poll until ready', 'Checking ingestion status...', 'waiting');

  while (true) {
    const status = await getMediaStatus(upload.id);
    updateStep('poll', `ingestionStatus: ${status.ingestionStatus}`, 'waiting');

    if (status.ingestionStatus === 'Completed') {
      break;
    }

    if (status.ingestionStatus === 'Failed') {
      throw new Error(`Media ingestion failed for ${upload.id}`);
    }

    await sleep(1000);
  }

  updateStep('poll', 'Embeddings ready!', 'complete');


  // ── Step 3: Ask the Gateway ────────────────────────────────
  addStep('gateway', 'Ask Gateway', 'Sending question to the LLM agent...', 'thinking');

  const response = await chatWithGateway(
    // This is the handoff from deterministic app code to the Gateway agent.
    `Based on the uploaded document (file ID: ${upload.id}), ${question}`,
    (toolName, desc) => addStep(`tool-${toolName}`, toolName, desc, 'thinking'),
    (toolName, success, summary) => updateStep(`tool-${toolName}`, summary, success ? 'complete' : 'error'),
    (msg) => addStep('thinking', 'Thinking', msg, 'thinking')
  );

  updateStep('gateway', 'Agent finished!', 'complete');


  // ── Step 4: Show the answer ────────────────────────────────
  addStep('answer', 'Compose Answer', 'Rendering the response...', 'thinking');
  if (!response.message) {
    throw new Error('Gateway finished, but no final answer was returned. Refresh the page to pick up the latest app code and try again.');
  }
  showAnswer(response.message);
  updateStep('answer', 'Done!', 'complete');
}
