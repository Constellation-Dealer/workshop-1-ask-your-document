// ═══════════════════════════════════════════════════════════════
//
//  loop.js — THE AGENTIC LOOP
//
//  This is the ONLY file you need to edit.
//
//  Your job: implement Steps 2–4 below using the helper functions
//  defined in helpers.js. Step 1 is done for you as an example.
//
//  Available helpers (see helpers.js for full docs):
//    uploadPdf(file)          → { id, ingestionStatus, ... }
//    getMediaStatus(id)       → { ingestionStatus, ... }
//    chatWithGateway(message, onToolStart, onToolComplete, onThinking)
//                             → { message, toolCalls }
//    addStep(id, title, detail, status)   → adds a card to the trace
//    updateStep(id, detail, status)       → updates an existing card
//    showAnswer(html)         → displays the answer section
//    sleep(ms)                → async wait
//
//  Status values: "thinking", "waiting", "complete", "error"
//
// ═══════════════════════════════════════════════════════════════

async function runAgenticLoop(file, question) {

  // ── Step 1: Upload the PDF ────────────────────────────────
  // (Done for you — this shows how the helpers work)

  addStep('upload', 'Upload + Index', `Uploading ${file.name}...`, 'thinking');

  const upload = await uploadPdf(file);

  updateStep('upload', `Uploaded! ID: ${upload.id}\ningestionStatus: ${upload.ingestionStatus}`, 'complete');


  // ── Step 2: Poll until embeddings are ready ───────────────
  //
  // TODO: YOUR CODE HERE
  //
  // 1. Call addStep('poll', 'Poll until ready', 'Checking ingestion status...', 'waiting')
  //    to add a "polling" card to the trace.
  //
  // 2. Write a while loop that:
  //    a. Calls:  const status = await getMediaStatus(upload.id)
  //    b. Calls:  updateStep('poll', `ingestionStatus: ${status.ingestionStatus}`, 'waiting')
  //       to update the card with the current status.
  //    c. If status.ingestionStatus === 'Completed', break out of the loop.
  //    d. If status.ingestionStatus === 'Failed', throw an error.
  //    e. Otherwise, call:  await sleep(1000)  to wait 1 second before checking again.
  //
  // 3. After the loop, call:
  //    updateStep('poll', 'Embeddings ready!', 'complete')
  //


  // ── Step 3: Ask the Gateway ────────────────────────────────
  //
  // TODO: YOUR CODE HERE
  //
  // Instead of calling vector_search_media and get_document_chunks
  // separately, you send ONE message to the Gateway. The LLM agent
  // inside the Gateway calls the tools automatically — you just
  // watch the agentic loop happen in real time via SSE callbacks.
  //
  // 1. Call addStep('gateway', 'Ask Gateway', 'Sending question to the LLM agent...', 'thinking')
  //
  // 2. Call chatWithGateway with your question and three callbacks:
  //
  //    const response = await chatWithGateway(
  //      `Based on the uploaded document (file ID: ${upload.id}), ${question}`,
  //      (toolName, desc) => addStep(`tool-${toolName}`, toolName, desc, 'thinking'),
  //      (toolName, success, summary) => updateStep(`tool-${toolName}`, summary, success ? 'complete' : 'error'),
  //      (msg) => addStep('thinking', 'Thinking', msg, 'thinking')
  //    );
  //
  // 3. After the call completes:
  //    updateStep('gateway', 'Agent finished!', 'complete')
  //


  // ── Step 4: Show the answer ────────────────────────────────
  //
  // TODO: YOUR CODE HERE
  //
  // 1. Call addStep('answer', 'Compose Answer', 'Rendering the response...', 'thinking')
  //
  // 2. The response object from Step 3 has a `message` property
  //    containing the LLM's composed answer (already HTML-formatted).
  //    Call: showAnswer(response.message)
  //
  // 3. Update the step:
  //    updateStep('answer', 'Done!', 'complete')
  //

  // ── If you haven't written any code yet, this message will appear ──
  // (Remove this check once you implement Steps 2-4 above)
  if (!document.getElementById('step-poll')) {
    addStep('todo', 'Not Implemented Yet', 'Steps 2-4 need your code! Open loop.js and look for the TODO comments.', 'error');
    throw new Error('Steps 2-4 are not implemented yet. Open loop.js, find the TODO comments, and write the loop logic.');
  }
}
