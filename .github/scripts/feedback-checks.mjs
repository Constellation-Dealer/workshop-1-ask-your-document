// The shared body of the feedback browser check. Identical in every workshop repo;
// each supplies a small adapter for the seams that genuinely differ (how its SSE
// reader is called, how its config is named). Driven in real headless Chrome,
// because every bug this guards against lives in DOM wiring, not in a function.
import { goto, evaluate, consoleLogs, close } from './cdp.mjs';

export async function run(a) {
  const ok = [], bad = [];
  const check = (n, c, d = '') => (c ? ok : bad).push(`${n}${d ? ' — ' + d : ''}`);
  const pause = () => new Promise(r => setTimeout(r, 400));

  await goto(process.env.APP_URL, a.readyExpr);
  await evaluate(a.setConfig);

  check('#answerFeedback exists in the markup', await evaluate(`!!document.getElementById('answerFeedback')`));

  // ── the turn id comes from a REAL `complete` payload, not an assignment ──
  // Assigning _lastTurnId directly tested the renderer and nothing else: deleting
  // the assistantTurnId capture entirely would have left the suite green.
  const captured = await evaluate(a.feedSse(13901));
  check('turn id is captured from an actual SSE `complete` event', captured === 13901, String(captured));

  // ── absent turn id: an explanation, never a dead button ─────────────────
  await evaluate(`_lastTurnId = null; showAnswer('no turn'); return 1`);
  check('no turn id explains itself instead of rendering buttons',
    await evaluate(`document.querySelectorAll('#answerFeedback .fb-btn').length === 0`)
    && await evaluate(`/not persisted/.test(document.getElementById('answerFeedback').textContent)`));

  // ── the live region is PERSISTENT and correctly marked ──────────────────
  await evaluate(`${a.captureTurn(13901)} showAnswer('An answer.'); return 1`);
  check('thumb row renders two labelled buttons',
    await evaluate(`document.querySelectorAll('#answerFeedback .fb-btn').length === 2`)
    && await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].every(b => b.getAttribute('aria-label'))`));
  check('status is a polite, atomic live region',
    await evaluate(`(el => el && el.getAttribute('role')==='status' && el.getAttribute('aria-live')==='polite' && el.getAttribute('aria-atomic')==='true')(document.querySelector('#answerFeedback .fb-status'))`),
    await evaluate(`(el=>el?[el.getAttribute('role'),el.getAttribute('aria-live'),el.getAttribute('aria-atomic')].join('/'):'MISSING')(document.querySelector('#answerFeedback .fb-status'))`));

  // The region must be the SAME NODE across state changes. A live region that is
  // replaced when its text changes is announced to nobody, because a screen reader
  // was never watching the new node.
  await evaluate(`window.__node = document.querySelector('#answerFeedback .fb-status'); return 1`);
  await evaluate(`window.__calls=[]; window.fetch = async (url,opts) => {
      window.__calls.push({url, body: JSON.parse(opts.body), authz: opts.headers.Authorization});
      await new Promise(r=>setTimeout(r,80));
      return { ok:true, status:200, text: async()=>'' }; }; return 1`);
  await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/Yes/.test(b.textContent)).click(); return 1`);
  check('"Sending" appears in the same live-region node',
    await evaluate(`/Sending/.test(window.__node.textContent) && window.__node === document.querySelector('#answerFeedback .fb-status')`),
    await evaluate(`JSON.stringify(window.__node.textContent)`));
  check('controls are disabled while in flight',
    await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].every(b => b.disabled)`));
  await pause();
  check('success reuses the same live-region node',
    await evaluate(`window.__node === document.querySelector('#answerFeedback .fb-status') && /Recorded against turn 13901/.test(window.__node.textContent)`),
    await evaluate(`JSON.stringify(window.__node.textContent)`));
  check('focus lands on the status line, not on a removed button',
    await evaluate(`document.activeElement === document.querySelector('#answerFeedback .fb-status')`),
    await evaluate(`document.activeElement ? document.activeElement.className || document.activeElement.tagName : 'none'`));

  // ── the request itself, pinned WHOLE ────────────────────────────────────
  // An earlier version accepted any URL ending in /feedback and any truthy
  // Authorization header, so an empty dealer guid and a wrong token both passed.
  const c = JSON.parse(await evaluate(`JSON.stringify(window.__calls[0])`) || '{}');
  check('POSTs the fully-formed dealer-scoped URL', c.url === a.expectedUrl, c.url);
  check('sends exactly the workshop bearer token', c.authz === 'Bearer test-token', c.authz);
  check('thumbs-up sends score 1 against the captured turn',
    c.body?.score === 1 && c.body?.conversationTurnId === 13901 && c.body?.comment === null, JSON.stringify(c.body));

  // ── thumbs-down: comment, Enter-to-submit ───────────────────────────────
  await evaluate(`window.fetch = async (url,opts)=>{ window.__calls.push({url, body: JSON.parse(opts.body)}); return {ok:true,status:200,text:async()=>''};};
    window.__calls=[]; ${a.captureTurn(13901)} showAnswer('x');
    [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/No/.test(b.textContent)).click(); return 1`);
  check('thumbs-down reveals a labelled, capped comment field',
    await evaluate(`(i => i && i.maxLength === 4000 && !!document.querySelector('label[for="fbComment"]'))(document.getElementById('fbComment'))`));
  check('the comment field takes focus', await evaluate(`document.activeElement === document.getElementById('fbComment')`));
  await evaluate(`document.getElementById('fbComment').value = 'Cited a page that does not exist.';
    document.getElementById('fbComment').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1`);
  await pause();
  const dn = JSON.parse(await evaluate(`JSON.stringify(window.__calls[0])`) || '{}');
  check('Enter submits score 0 with the comment',
    dn.body?.score === 0 && dn.body?.comment === 'Cited a page that does not exist.', JSON.stringify(dn.body));

  // ── failure is surfaced, and the SAME button is retryable ───────────────
  // The blur is FORCED here. Chrome does not blur a focused element when it is
  // disabled, so without this the "focus came back" assertion passes even with the
  // restore deleted -- it never left. Other engines (and some assistive tech) do blur
  // on disable, which is the case the restore exists for, so simulate it.
  await evaluate(`window.fetch = async () => { document.activeElement?.blur();
      return {ok:false, status:403, statusText:'Forbidden', text:async()=>'dealer mismatch'}; };
    ${a.captureTurn(13901)} showAnswer('y');
    const b = [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/Yes/.test(b.textContent));
    window.__btn = b; b.focus(); b.click(); return 1`);
  await pause();
  check('a 403 is surfaced in the live region',
    await evaluate(`/Could not record that/.test(document.querySelector('#answerFeedback .fb-status').textContent)`),
    await evaluate(`JSON.stringify(document.querySelector('#answerFeedback .fb-status').textContent.slice(0,80))`));
  check('a failure is not styled as success', await evaluate(`!document.querySelector('#answerFeedback .fb-ok')`));
  check('the button that failed is re-enabled and focus returns to it',
    await evaluate(`!window.__btn.disabled && document.activeElement === window.__btn`),
    await evaluate(`'disabled=' + window.__btn.disabled + ' focused=' + (document.activeElement === window.__btn)`));

  // ── a new run cannot leave a thumb pointing at the old answer ───────────
  // Exercised through the real reset seam the run path calls, so deleting it fails.
  await evaluate(`${a.captureTurn(13901)} showAnswer('old'); ${a.resetExpr} return 1`);
  await pause();
  check('the run reset clears both the turn id and the row',
    await evaluate(`_lastTurnId === null && document.getElementById('answerFeedback').textContent === ''`),
    await evaluate(`'_lastTurnId=' + _lastTurnId + ' row=' + JSON.stringify(document.getElementById('answerFeedback').textContent.slice(0,40))`));

  // ── layout ──────────────────────────────────────────────────────────────
  await evaluate(`${a.captureTurn(13901)} showAnswer('z');
    [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/No/.test(b.textContent)).click();
    document.getElementById('fbComment').value='x'.repeat(400); return 1`);
  check('a long comment does not scroll the page sideways',
    await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`),
    await evaluate(`document.documentElement.scrollWidth + ' vs ' + document.documentElement.clientWidth`));

  console.log('PASS (' + ok.length + ')'); ok.forEach(s => console.log('  ✓ ' + s));
  if (bad.length) { console.log('\nFAIL (' + bad.length + ')'); bad.forEach(s => console.log('  ✗ ' + s)); }
  const errs = consoleLogs().filter(l => /pageerror|\[error\]/.test(l));
  if (errs.length) { console.log('\nconsole errors:'); errs.forEach(e => console.log('  ' + e)); }
  close();
  process.exit(bad.length ? 1 : 0);
}
