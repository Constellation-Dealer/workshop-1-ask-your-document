import { goto, evaluate, consoleLogs, close } from './cdp.mjs';
const ok = [], bad = [];
const check = (name, cond, detail='') => (cond ? ok : bad).push(`${name}${detail ? ' — ' + detail : ''}`);

await goto(process.env.APP_URL, 'typeof showAnswer === "function" && !!document.getElementById("answerFeedback")');

// The page needs no .env for this: we drive showAnswer directly, which is exactly what
// the participant's loop.js step 4 does.
check('page loaded', await evaluate(`document.title.length > 0`));
check('#answerFeedback exists in the markup', await evaluate(`!!document.getElementById('answerFeedback')`));

// ── 1. No turn id -> an explanation, never a dead button ──────────────────
await evaluate(`showAnswer('An answer with no persisted turn.'); return 1`);
check('no turn id renders an explanation, not buttons',
  await evaluate(`document.querySelectorAll('#answerFeedback .fb-btn').length === 0`)
  && await evaluate(`/not persisted/.test(document.getElementById('answerFeedback').textContent)`),
  await evaluate(`JSON.stringify(document.getElementById('answerFeedback').textContent.slice(0,70))`));

// ── 2. With a turn id -> the thumb row ────────────────────────────────────
await evaluate(`_lastTurnId = 13833; showAnswer('A real answer.'); return 1`);
check('thumb row renders two buttons',
  await evaluate(`document.querySelectorAll('#answerFeedback .fb-btn').length === 2`),
  await evaluate(`JSON.stringify([...document.querySelectorAll('#answerFeedback .fb-btn')].map(b=>b.textContent))`));
check('buttons carry accessible labels',
  await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].every(b => b.getAttribute('aria-label'))`));

// ── 3. Thumbs up posts the right body ─────────────────────────────────────
await evaluate(`
  window.__calls = [];
  window.fetch = async (url, opts) => { window.__calls.push({url, body: JSON.parse(opts.body), method: opts.method, auth: !!opts.headers.Authorization});
    return { ok: true, status: 200, text: async()=>'' }; };
  return 1`);
await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/Yes/.test(b.textContent)).click(); return 1`);
await new Promise(r=>setTimeout(r,400));
const up = await evaluate(`JSON.stringify(window.__calls[0])`);
check('thumbs-up POSTs score 1 with the turn id', (()=>{ const c=JSON.parse(up||'{}');
  return c.method==='POST' && c.body?.score===1 && c.body?.conversationTurnId===13833 && /\/feedback$/.test(c.url||'') && c.auth; })(), up);
check('thumbs-up confirms in the UI',
  await evaluate(`/Recorded against turn 13833/.test(document.getElementById('answerFeedback').textContent)`),
  await evaluate(`JSON.stringify(document.getElementById('answerFeedback').textContent.slice(0,60))`));

// ── 4. Thumbs down asks for a comment first, then sends it ────────────────
await evaluate(`window.__calls = []; _lastTurnId = 13833; showAnswer('Another answer.'); return 1`);
await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/No/.test(b.textContent)).click(); return 1`);
check('thumbs-down reveals a comment field', await evaluate(`!!document.getElementById('fbComment')`));
check('comment field is capped at the Gateway limit', await evaluate(`document.getElementById('fbComment').maxLength === 4000`));
check('comment field is labelled', await evaluate(`!!document.querySelector('label[for="fbComment"]')`));
await evaluate(`document.getElementById('fbComment').value = 'Cited a page that does not exist.';
  [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/Send/.test(b.textContent)).click(); return 1`);
await new Promise(r=>setTimeout(r,400));
const dn = await evaluate(`JSON.stringify(window.__calls[0])`);
check('thumbs-down POSTs score 0 with the comment', (()=>{ const c=JSON.parse(dn||'{}');
  return c.body?.score===0 && c.body?.comment==='Cited a page that does not exist.' && c.body?.conversationTurnId===13833; })(), dn);
check('thumbs-down says it is queued for review',
  await evaluate(`/queued for review/.test(document.getElementById('answerFeedback').textContent)`));

// ── 5. Enter submits, so the field is not a dead end ─────────────────────
await evaluate(`window.__calls=[]; _lastTurnId=13833; showAnswer('x');
  [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/No/.test(b.textContent)).click();
  document.getElementById('fbComment').value='typed then Enter';
  document.getElementById('fbComment').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1`);
await new Promise(r=>setTimeout(r,400));
check('Enter in the comment field submits',
  await evaluate(`window.__calls.length===1 && window.__calls[0].body.comment==='typed then Enter'`));

// ── 6. A failure is SURFACED, not swallowed ──────────────────────────────
await evaluate(`
  window.fetch = async () => ({ ok:false, status:404, statusText:'Not Found', text: async()=>'conversationTurnId not found.' });
  _lastTurnId = 999999; showAnswer('Doomed.');
  [...document.querySelectorAll('#answerFeedback .fb-btn')].find(b=>/Yes/.test(b.textContent)).click(); return 1`);
await new Promise(r=>setTimeout(r,400));
check('a failed POST shows the error', await evaluate(`/Could not record that/.test(document.getElementById('answerFeedback').textContent)`),
  await evaluate(`JSON.stringify(document.getElementById('answerFeedback').textContent.slice(0,90))`));
check('a failed POST offers a retry', await evaluate(`[...document.querySelectorAll('#answerFeedback .fb-btn')].some(b=>/Try again/.test(b.textContent))`));
check('a failed POST is not styled as success', await evaluate(`!document.querySelector('#answerFeedback .fb-ok')`));

// ── 7. A new run cannot leave a thumb pointing at the old answer ─────────
await evaluate(`_lastTurnId = 13833; showAnswer('first'); resetTrace(); return 1`);
check('resetTrace clears the turn id and the row',
  await evaluate(`_lastTurnId === null && document.getElementById('answerFeedback').textContent === ''`));

// ── 8. No horizontal overflow (the standing Yaksha-host rule) ───────────
await evaluate(`_lastTurnId=13833; showAnswer('y');
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
