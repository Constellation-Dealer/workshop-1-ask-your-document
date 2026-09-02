// Workshop 1's adapter for the shared feedback check. Only the seams that really
// differ between repos live here; everything asserted lives in feedback-checks.mjs.
import { run } from './feedback-checks.mjs';

const GATEWAY = 'https://targetmcp-gateway.azurewebsites.net';
const DEALER  = '23f9cad3-175b-4ff9-b0bf-c49c35c7245e';

await run({
  readyExpr: 'typeof showAnswer === "function" && !!document.getElementById("answerFeedback")',
  setConfig: `GATEWAY_URL='${GATEWAY}'; DEALER_GUID='${DEALER}'; _authToken='test-token'; return 1`,
  expectedUrl: `${GATEWAY}/api/v1/${DEALER}/feedback`,
  // Feed a real Gateway `complete` frame through the repo's own SSE reader.
  feedSse: turn => `
    _lastTurnId = null;
    const body = new Blob(['event: complete\\ndata: {"response":{"message":"42 Nm.","assistantTurnId":TURN,"sessionId":"s1"}}\\n\\n'.replace('TURN', '${turn}')]).stream();
    await _parseSseStream(body, null, null, null);
    return _lastTurnId`,
  captureTurn: turn => `_lastTurnId = ${turn};`,
  // Through handleRun, the real run path: stub out the update check, auth and the
  // loop so it returns immediately, and assert the previous answer's rating state is
  // gone. Calling _resetFeedback() directly would pass even if handleRun stopped
  // calling it -- which is precisely the regression this is here to catch.
  resetExpr: `
    checkForAppUpdate = async () => false;
    authenticate = async () => { throw new Error('stub'); };
    selectedFile = new File(['x'], 'x.pdf');
    document.getElementById('questionInput').value = 'q';
    await handleRun();`,
});
