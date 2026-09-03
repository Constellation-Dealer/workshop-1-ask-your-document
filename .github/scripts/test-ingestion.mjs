// Workshop 1's adapter for the shared ingestion-poll check. Only the seams that
// differ between repos live here; everything asserted lives in
// ingestion-checks.mjs.
import { run } from './ingestion-checks.mjs';

await run({
  readyExpr: 'typeof isIngestionInFlight === "function" && typeof runAgenticLoop === "function"',

  // Drive the REAL runAgenticLoop with UMH stubbed to walk a given sequence of
  // statuses (the last one repeating forever), and race it against a deadline.
  // 'TIMEOUT' means the loop never settled, which is the hang being guarded.
  //
  // sleep() is shortened so a loop polling once a second does not need a
  // ten-second deadline to prove that it terminates.
  settleExpr: (statuses, { trackAnswer = false } = {}) => `
    const queue = ${JSON.stringify(statuses)};
    let i = 0;
    uploadPdf = async () => ({ id: 'stub-media-id', ingestionStatus: 'Pending' });
    getMediaStatus = async () => ({ ingestionStatus: queue[Math.min(i++, queue.length - 1)] });
    chatWithGateway = async () => ({ message: 'stub answer', toolCalls: [] });
    sleep = () => new Promise(r => setTimeout(r, 5));
    let answered = false;
    const realShowAnswer = showAnswer;
    showAnswer = (...args) => { answered = true; return realShowAnswer(...args); };
    resetTrace();
    const settled = runAgenticLoop(new File(['x'], 'x.pdf'), 'what is the torque?')
      .then(() => 'resolved')
      .catch(e => 'rejected: ' + (e && e.message ? e.message : e));
    const timeout = new Promise(r => setTimeout(() => r('TIMEOUT'), 4000));
    const outcome = await Promise.race([settled, timeout]);
    showAnswer = realShowAnswer;
    return ${trackAnswer ? '{ outcome, answered }' : 'outcome'};`,
});
