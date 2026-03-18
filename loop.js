// ═══════════════════════════════════════════════════════════════
//
//  loop.js — THE AGENTIC LOOP
//
//  This is the ONLY file you need to edit.
//
//  Your job: implement Steps 2–5 below using the helper functions
//  defined in helpers.js. Step 1 is done for you as an example.
//
//  Available helpers (see helpers.js for full docs):
//    uploadPdf(file)          → { id, ingestionStatus, ... }
//    getMediaStatus(id)       → { ingestionStatus, ... }
//    callTool(name, args)     → tool result object
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


  // ── Step 3: Semantic search ───────────────────────────────
  //
  // TODO: YOUR CODE HERE
  //
  // 1. Call addStep('search', 'Semantic Search', 'Searching for relevant chunks...', 'thinking')
  //
  // 2. Call: const searchResult = await callTool('vector_search_media', {
  //      query: question,
  //      fileType: 'pdfs',
  //      useChunks: true,
  //      topK: 5
  //    })
  //
  // 3. The result has a `results` array. Each item has: chunkIndex, pageNumber, score, preview
  //    Update the step:
  //    updateStep('search',
  //      `Found ${searchResult.results.length} chunks: pages ${searchResult.results.map(r => r.pageNumber).join(', ')}`,
  //      'complete')
  //


  // ── Step 4: Retrieve the full chunk text ──────────────────
  //
  // TODO: YOUR CODE HERE
  //
  // 1. Call addStep('chunks', 'Retrieve Chunks', 'Fetching full text from matched pages...', 'thinking')
  //
  // 2. Extract chunk indexes from step 3's results:
  //    const chunkIndexes = searchResult.results.map(r => r.chunkIndex)
  //
  // 3. Call: const chunkResult = await callTool('get_document_chunks', {
  //      mediaFileId: upload.id,
  //      chunkIndexes: chunkIndexes
  //    })
  //
  // 4. Update the step:
  //    updateStep('chunks', `Retrieved ${chunkResult.chunks.length} chunks`, 'complete')
  //


  // ── Step 5: Compose the answer ────────────────────────────
  //
  // TODO: YOUR CODE HERE
  //
  // 1. Call addStep('answer', 'Compose Answer', 'Formatting answer with page citations...', 'thinking')
  //
  // 2. Build an HTML string from the chunks. Each chunk has: pageNumber, text
  //    For example:
  //    let answerHtml = '<p>Based on the document:</p>';
  //    for (const chunk of chunkResult.chunks) {
  //      answerHtml += `<p><span class="page-ref">Page ${chunk.pageNumber}</span> ${chunk.text}</p>`;
  //    }
  //
  // 3. Call: showAnswer(answerHtml)
  //
  // 4. Update the step:
  //    updateStep('answer', 'Done!', 'complete')
  //

  // ── If you haven't written any code yet, this message will appear ──
  // (Remove this check once you implement Steps 2-5 above)
  if (!document.getElementById('step-poll')) {
    addStep('todo', 'Not Implemented Yet', 'Steps 2-5 need your code! Open loop.js and look for the TODO comments.', 'error');
    throw new Error('Steps 2-5 are not implemented yet. Open loop.js, find the TODO comments, and write the loop logic.');
  }
}
