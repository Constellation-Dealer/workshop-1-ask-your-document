// Per-participant entity scoping. Three failures, none of which announce itself.
//
// 1. The upload tag is ENFORCED by TargetUMH: entityType and entityId must
//    travel together, and one without the other is a 400 at upload — which for
//    a participant is a dead exercise, not a warning. So the checks are written
//    as "both or neither", never "entityId is present".
//
// 2. The handle must be STABLE. A handle that varies between runs still
//    uploads and still answers; it just quietly stops finding what the same
//    participant uploaded an hour ago. Nothing on screen says so.
//
// 3. The scope card is the only place the agent's ACTUAL tool arguments are
//    visible — the tool_start event carries a name and a description and no
//    arguments at all. If the card stops rendering, the exercise still runs and
//    the one observable it is teaching is simply gone.
import { goto, evaluate, close } from './cdp.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5197/';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

await goto(APP_URL, 'typeof participantEntityId === "function" && typeof uploadPdf === "function"');

// Set the username the way .env would have, and read back what the exercise derives.
const handleFor = async username => evaluate(`
  const saved = _config.username;
  _config.username = ${JSON.stringify(username)};
  const id = participantEntityId();
  _config.username = saved;
  return id;`);

// ── 1. the handle ────────────────────────────────────────────────────────────
check('derives from the local part of the IDMS email',
  await handleFor('First.Last@constellationdealer.com') === 'first-last');
check('keeps the +tag rather than stripping it (two tagged accounts are two people)',
  await handleFor('first.last+perseus@constellationdealer.com') === 'first-last-perseus');
check('normalises to an id-safe slug with no leading or trailing separator',
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(await handleFor('__Weird..Name__@x.com')));
check('is within the entityId length UMH accepts',
  (await handleFor('a'.repeat(400) + '@x.com')).length <= 256);

// Stability is the property, so assert it as one: the same input, twice, with
// a real interval between the reads.
const first = await handleFor('someone.else@constellationdealer.com');
await new Promise(r => setTimeout(r, 1100));
const second = await handleFor('someone.else@constellationdealer.com');
check('the same username gives the same handle on a later run', first === second, `${first} vs ${second}`);
check('different usernames give different handles',
  await handleFor('a.person@x.com') !== await handleFor('b.person@x.com'));

check('no username means no handle, and no entity at all',
  await evaluate(`
    const saved = _config.username;
    _config.username = '';
    const out = participantEntityId() === '' && participantEntity() === null;
    _config.username = saved;
    return out;`));

// ── 2. the upload sends both fields or neither ───────────────────────────────
const uploadFields = async username => evaluate(`
  const savedFetch = window.fetch;
  const savedUser = _config.username;
  _config.username = ${JSON.stringify(username)};
  let sent = null;
  window.fetch = async (url, opts) => {
    sent = [...opts.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '<file>']);
    return new Response('{"id":"stub","ingestionStatus":"Pending"}', { status: 200 });
  };
  try {
    await uploadPdf(new File(['x'], 'x.pdf', { type: 'application/pdf' }));
  } finally {
    window.fetch = savedFetch;
    _config.username = savedUser;
  }
  return Object.fromEntries(sent);`);

const tagged = await uploadFields('First.Last@constellationdealer.com');
check('upload sends entityType', tagged.entityType === 'Model', JSON.stringify(tagged));
check('upload sends entityId matching the derived handle', tagged.entityId === 'first-last');
check('upload still sends the fields it always sent',
  tagged.allowUnassigned === 'true' && tagged.generateEmbedding === 'true' && 'description' in tagged);

const untagged = await uploadFields('');
check('with no handle the upload sends NEITHER entity field, not one of them',
  !('entityType' in untagged) && !('entityId' in untagged), JSON.stringify(untagged));

// ── 3. the query asks for the same entity, and the card reports what came back ──
// A canned SSE turn: one tool call, with whatever arguments the case wants.
const chatRun = async (username, toolCalls) => evaluate(`
  const savedFetch = window.fetch;
  const savedUser = _config.username;
  _config.username = ${JSON.stringify(username)};
  let body = null;
  const sse =
    'event: tool_start\\ndata: {"toolName":"vector_search_media","description":"Executing vector_search_media..."}\\n\\n' +
    'event: complete\\ndata: ' + JSON.stringify({
      response: {
        message: 'stub answer',
        assistantTurnId: 1,
        toolCalls: ${JSON.stringify(toolCalls)}
      }
    }) + '\\n\\n';
  window.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(sse, { status: 200 });
  };
  resetTrace();
  try {
    await chatWithGateway('what is the torque?');
  } finally {
    window.fetch = savedFetch;
    _config.username = savedUser;
  }
  const card = document.getElementById('step-scope');
  return {
    body,
    card: card ? { state: card.getAttribute('data-state'), text: card.textContent } : null
  };`);

// serverName is what the Gateway really sends on response.toolCalls[]; it is how
// a corpus read is told apart from a tool that never touched these documents.
const mediaScoped = {
  toolName: 'vector_search_media', serverName: 'media',
  arguments: { dealerGuid: 'd', query: 'torque', entityType: 'Model', entityId: 'first-last' }
};
const mediaWide = {
  toolName: 'search_media', serverName: 'media',
  arguments: { dealerGuid: 'd', fileType: 'documents' }
};
// Already pinned to one file, so the entity has nothing to narrow.
const mediaByFileId = {
  toolName: 'get_document_chunks', serverName: 'media',
  arguments: { dealerGuid: 'd', mediaFileId: 'abc-123' }
};
// Carries a query, never reads this corpus.
const otherServer = {
  toolName: 'tavily_search', serverName: 'research',
  arguments: { query: 'axle torque' }
};

const honoured = await chatRun('First.Last@constellationdealer.com', [mediaScoped]);

check('the question carries the entity the upload was tagged with',
  honoured.body.message.includes('Model') && honoured.body.message.includes('first-last'),
  honoured.body.message);
check('the question as typed is what gets persisted, not the scope plumbing',
  honoured.body.displayMessage === 'what is the torque?');
check('the structured context names the same entity',
  honoured.body.context?.activeEntity?.type === 'Model' &&
  honoured.body.context?.activeEntity?.id === 'first-last');

check('a scope card is rendered', honoured.card !== null);
check('the card reports the scope as applied', honoured.card?.state === 'done', honoured.card?.state);
check('the card shows the arguments the agent actually passed, not just the tool name',
  honoured.card?.text.includes('entityId') && honoured.card?.text.includes('first-last'),
  honoured.card?.text?.slice(0, 200));

// The case that matters: the agent ignored the entity. The run succeeds, the
// answer renders, and the ONLY thing that says retrieval went wide is this card.
const ignored = await chatRun('First.Last@constellationdealer.com', [mediaWide]);
check('an unscoped tool call is reported as such, not silently passed',
  ignored.card !== null && ignored.card.state === 'failed', ignored.card?.state);
check('and the card says the search went wide rather than blaming the loop',
  /did NOT pass|whole shared corpus/i.test(ignored.card?.text || ''), ignored.card?.text?.slice(0, 300));

// ── 4. a MIXED turn ──────────────────────────────────────────────────────────
// A turn is not one search. If ANY corpus read went out without the entity, the
// card must not read as scoped — that reading is the single piece of evidence a
// participant has, and getting it wrong teaches the opposite of the lesson.
const mixed = await chatRun('First.Last@constellationdealer.com', [mediaScoped, mediaWide]);
check('a mixed turn is NOT reported as scoped', mixed.card?.state !== 'done', mixed.card?.state);
check('a mixed turn is called out as mixed, not just "not scoped"',
  /mixed/i.test(mixed.card?.text || ''), mixed.card?.text?.slice(0, 160));
check('the count agrees with the listing rather than contradicting it',
  (mixed.card?.text || '').includes('1 of 2 corpus searches carried it'),
  mixed.card?.text?.slice(0, 200));
check('the call that went out wide is named, since that is the actionable part',
  (mixed.card?.text || '').includes('search_media'), mixed.card?.text?.slice(0, 300));
check('a mixed turn reads differently from a fully unscoped one',
  mixed.card?.text !== ignored.card?.text);

// The other half of the same property: over-flagging teaches the wrong thing too.
const withOtherTools = await chatRun('First.Last@constellationdealer.com',
  [mediaScoped, mediaByFileId, otherServer]);
check('a call already pinned to one media file does not count as unscoped',
  withOtherTools.card?.state === 'done', withOtherTools.card?.state);
check('a tool on another server does not count as an unscoped corpus read',
  (withOtherTools.card?.text || '').includes('1 of 1 corpus searches carried it'),
  withOtherTools.card?.text?.slice(0, 200));

// No corpus read visible at all must not read as scoped either.
const nothingVisible = await chatRun('First.Last@constellationdealer.com', [otherServer]);
check('a turn with no corpus search does not claim a scope',
  nothingVisible.card?.state !== 'done' && /no search of the shared corpus/i.test(nothingVisible.card?.text || ''),
  nothingVisible.card?.text?.slice(0, 160));

// No entity to ask for at all: the request must go out exactly as it always did.
const bare = await chatRun('', [mediaScoped]);
check('with no handle the request body is unchanged from before this feature',
  Object.keys(bare.body).length === 1 && bare.body.message === 'what is the torque?',
  JSON.stringify(bare.body));
check('and no scope card claims a scope that was never asked for', bare.card === null);

close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
