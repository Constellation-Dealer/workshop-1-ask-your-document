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
  // Returns three things about the run:
  //   outcome       'resolved' | 'rejected: …' | 'TIMEOUT'
  //   answered      did the answer actually reach the page
  //   unimplemented did the loop never even create a poll step — which is the
  //                 skeleton's OWN test for "steps 2-4 are still TODO"
  //                 (loop.js: `if (!document.getElementById('step-poll'))`), so
  //                 the exemption tracks the code rather than a branch name.
  //
  // sleep() is shortened so a loop polling once a second does not need a
  // ten-second deadline to prove that it terminates.
  //
  // fastClock winds Date.now forward on every read, so a loop carrying a
  // two-minute budget reaches it inside this test instead of really waiting.
  // Only the loop's own deadline arithmetic reads that clock; the race below
  // uses setTimeout, which is untouched real time.
  settleExpr: (statuses, { fastClock = false } = {}) => `
    const queue = ${JSON.stringify(statuses)};
    let i = 0;
    uploadPdf = async () => ({ id: 'stub-media-id', ingestionStatus: 'Pending' });
    getMediaStatus = async () => ({ ingestionStatus: queue[Math.min(i++, queue.length - 1)] });
    chatWithGateway = async () => ({ message: 'stub answer', toolCalls: [] });
    sleep = () => new Promise(r => setTimeout(r, 5));

    let answered = false;
    const realShowAnswer = showAnswer;
    showAnswer = (...args) => { answered = true; return realShowAnswer(...args); };

    const realNow = Date.now;
    if (${fastClock}) {
      let fake = realNow();
      Date.now = () => (fake += 5000);
    }

    resetTrace();
    const settled = runAgenticLoop(new File(['x'], 'x.pdf'), 'what is the torque?')
      .then(() => 'resolved')
      .catch(e => 'rejected: ' + (e && e.message ? e.message : e));
    const timeout = new Promise(r => setTimeout(() => r('TIMEOUT'), 4000));
    const outcome = await Promise.race([settled, timeout]);

    Date.now = realNow;
    showAnswer = realShowAnswer;
    const unimplemented = !document.getElementById('step-poll');
    return { outcome, answered, unimplemented };`,
});
