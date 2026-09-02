// Minimal CDP driver: open a page, run expressions, report. No dependencies.
const base = process.env.CDP_URL || 'http://127.0.0.1:9333';
const tabs = await (await fetch(`${base}/json/list`)).json();
let page = tabs.find(t => t.type === 'page');
if (!page) { page = await (await fetch(`${base}/json/new`)).json(); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled')
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('[pageerror] ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Runtime.enable');
await send('Page.enable');
// Serve nothing from cache. `python3 -m http.server` sends no cache headers, so Chrome
// happily reuses a previous helpers.js -- which makes a test run report on code that is
// no longer on disk. Mutations "passed" that way before this line existed.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

export async function goto(url, readyExpr = 'document.readyState === "complete"') {
  await send('Page.navigate', { url });
  // readyState alone is not enough: the page's own boot can schedule a reload
  // (version check), which tears down the context mid-test. Wait for the thing
  // the test actually needs to exist.
  for (let i = 0; i < 150; i++) {
    try { if (await evaluate(readyExpr)) return; } catch { /* context swapping */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('page never became ready: ' + readyExpr);
}
export async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr.includes('return') ? expr : 'return ('+expr+')'}})()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval threw');
  return r.result?.result?.value;
}
export const consoleLogs = () => logs.slice();
export const close = () => ws.close();
