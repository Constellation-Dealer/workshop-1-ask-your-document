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
  // TODO:
  // - add the poll step to the trace
  // - loop on getMediaStatus(upload.id)
  // - keep waiting only while isIngestionInFlight(status.ingestionStatus),
  //   sleep(1000) between checks, and give the loop a deadline
  // - anything not in flight is terminal: Completed means ready, and
  //   explainIngestionStop(...) tells you what to throw for the rest
  // - mark the step complete when embeddings are ready
  //
  // Do NOT write `break on Completed, throw on Failed`. UMH also returns
  // Skipped -- for a PDF with no text layer, i.e. a scan -- and that matches
  // neither branch, so the loop spins forever with no error on screen.


  // ── Step 3: Ask the Gateway ────────────────────────────────
  // TODO:
  // - add the gateway step to the trace
  // - call chatWithGateway(...) with the upload id and question
  // - pass callbacks that turn streamed tool/thinking events into trace cards
  // - update the gateway step when the agent finishes
  //
  // The addStep/updateStep calls are only for the trace UI.
  // chatWithGateway(...) is the actual API call to the Gateway agent.


  // ── Step 4: Show the answer ────────────────────────────────
  // TODO:
  // - add the answer step to the trace
  // - render response.message with showAnswer(...)
  // - mark the answer step complete

  if (!document.getElementById('step-poll')) {
    addStep('todo', 'Not Implemented Yet', 'Steps 2-4 still need your code. Follow the TODOs in loop.js.', 'error');
    throw new Error('Steps 2-4 are not implemented yet. Complete the TODOs in loop.js and run the flow again.');
  }
}
