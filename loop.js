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

  // Wait only while UMH says it is still working. Everything else is terminal.
  //
  // Writing it the other way round -- break on Completed, throw on Failed --
  // leaves Skipped matching neither branch, and Skipped is what UMH returns for
  // a PDF with no text layer, i.e. a scan. The loop would then spin forever
  // with `ingestionStatus: Skipped` ticking on screen and no error at all.
  const deadline = Date.now() + 120000;
  let status = await getMediaStatus(upload.id);

  while (isIngestionInFlight(status.ingestionStatus)) {
    updateStep('poll', `ingestionStatus: ${status.ingestionStatus}`, 'waiting');

    if (Date.now() > deadline) {
      throw new Error(
        `TargetUMH is still at ${status.ingestionStatus} after two minutes, so the answer would ` +
        `have nothing to retrieve. Check the media pipeline before retrying.`
      );
    }

    await sleep(1000);
    status = await getMediaStatus(upload.id);
  }

  // Not in flight any more, so it either succeeded or it stopped for a reason
  // worth telling the participant about.
  const problem = explainIngestionStop(status.ingestionStatus);
  if (problem) throw new Error(problem);

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
