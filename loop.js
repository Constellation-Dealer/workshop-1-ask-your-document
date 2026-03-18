// ═══════════════════════════════════════════════════════════════
//
//  loop.js — THE AGENTIC LOOP (SOLUTION)
//
//  This is the completed version with all steps implemented.
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

    if (status.ingestionStatus === 'Completed') break;
    if (status.ingestionStatus === 'Failed') throw new Error('Embedding ingestion failed');

    await sleep(1000);
  }

  updateStep('poll', 'Embeddings ready!', 'complete');


  // ── Step 3: Semantic search ───────────────────────────────

  addStep('search', 'Semantic Search', 'Searching for relevant chunks...', 'thinking');

  const searchResult = await callTool('vector_search_media', {
    query: question,
    fileType: 'pdfs',
    useChunks: true,
    topK: 5
  });

  updateStep('search',
    `Found ${searchResult.results.length} chunks: pages ${searchResult.results.map(r => r.pageNumber).join(', ')}`,
    'complete');


  // ── Step 4: Retrieve the full chunk text ──────────────────

  addStep('chunks', 'Retrieve Chunks', 'Fetching full text from matched pages...', 'thinking');

  const chunkIndexes = searchResult.results.map(r => r.chunkIndex);

  const chunkResult = await callTool('get_document_chunks', {
    mediaFileId: upload.id,
    chunkIndexes: chunkIndexes
  });

  updateStep('chunks', `Retrieved ${chunkResult.chunks.length} chunks`, 'complete');


  // ── Step 5: Compose the answer ────────────────────────────

  addStep('answer', 'Compose Answer', 'Formatting answer with page citations...', 'thinking');

  let answerHtml = `<p>Based on the document, here's what I found for "<em>${question}</em>":</p>`;
  for (const chunk of chunkResult.chunks) {
    answerHtml += `<p><span class="page-ref">Page ${chunk.pageNumber}</span> ${chunk.text}</p>`;
  }

  showAnswer(answerHtml);
  updateStep('answer', 'Done!', 'complete');
}
