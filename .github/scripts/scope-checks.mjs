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
//
// 4. The card must be wrong in NEITHER direction. Green on a turn that went
//    wide teaches that steering is enforced; red on a turn that was scoped
//    teaches that it never works, and the participant has no way to tell the
//    card is lying. So every call that is not document retrieval is checked
//    twice — beside a scoped run, and alone — and must move the verdict neither
//    way. See RETRIEVAL_TOOLS in helpers.js for the rule these check.
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

// Fixtures carry serverName because the Gateway really sends it on
// response.toolCalls[]; the verdict keys on the tool NAME, per RETRIEVAL_TOOLS.
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
// Pinned to one file AND carrying a query — searching WITHIN a document the
// agent already chose. This is the only shape the mediaFileId guard actually
// decides: without it the query alone reads as a corpus search and the call is
// accused of going wide, when it never left the one file.
const mediaSearchWithinOneFile = {
  toolName: 'get_document_chunks', serverName: 'media',
  arguments: { dealerGuid: 'd', mediaFileId: 'abc-123', query: 'torque' }
};
// Reads the entity VOCABULARY, not documents. Both real shapes of it: the
// second carries `tags`, which an argument-shape rule read as a corpus filter
// and so as a wide search, on a run that was scoped.
const mediaNonSearch = {
  toolName: 'list_media_entity_values', serverName: 'media',
  arguments: { dealerGuid: 'd', entityType: 'Model' }
};
const mediaNonSearchTagged = {
  toolName: 'list_media_entity_values', serverName: 'media',
  arguments: { dealerGuid: 'd', entityType: 'Model', tags: ['manual'] }
};
// PROCESSING, not retrieval, in either direction. `mediaFileIds` is a
// different parameter from `mediaFileId`, and a pattern match on the key read
// this as "the agent read your document by id" and painted it green.
const mediaProcessing = {
  toolName: 'generate_embeddings', serverName: 'media',
  arguments: { dealerGuid: 'd', mediaFileIds: ['abc-123', 'def-456'] }
};
// A tool this page has never heard of, with a shape it has never seen. It must
// land neutral rather than being guessed into a verdict.
const unknownTool = {
  toolName: 'summarise_service_history', serverName: 'media',
  arguments: { dealerGuid: 'd', horizonDays: 90, includeDrafts: true }
};
// Unrecognised, and with no serverName to retire it to `aside` either. Absent
// evidence is not evidence of absence: it stays uncertain rather than cleared.
const unknownToolNoServer = {
  toolName: 'summarise_service_history',
  arguments: { dealerGuid: 'd', horizonDays: 90 }
};
// A recognised by-id read that did not actually name a document — it carries
// the PLURAL key, the same near-miss that fooled the old rule. Recognising the
// tool is not enough; the call has to have done what the tool is for, so this
// falls back to neutral rather than being assumed to be a tight read.
const pinnedWithoutAnId = {
  toolName: 'get_media_metadata', serverName: 'media',
  arguments: { dealerGuid: 'd', mediaFileIds: ['abc-123'] }
};
// Carries a query, never reads this corpus.
const otherServer = {
  toolName: 'tavily_search', serverName: 'research',
  arguments: { query: 'axle torque' }
};
// The agent re-cased the entity. TargetUMH matches it anyway (measured on DEV),
// so the retrieval really was scoped and the card must say so.
const mediaScopedRecased = {
  toolName: 'vector_search_media', serverName: 'media',
  arguments: { dealerGuid: 'd', query: 'torque', entityType: 'model', entityId: 'First-Last' }
};
// Somebody else's handle. Folding case must not fold this into a match.
const mediaSomeoneElse = {
  toolName: 'vector_search_media', serverName: 'media',
  arguments: { dealerGuid: 'd', query: 'torque', entityType: 'Model', entityId: 'other-person' }
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

const accused = card => card?.state === 'failed' && /WITHOUT your entity/.test(card?.text || '');

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

// ── 5. the other half of the property: over-flagging teaches a wrong thing too ──
// A run whose retrieval WAS scoped, told by the only observable in the exercise
// that it was not, is worse than no card: the participant has no way to tell the
// card is wrong. Each of these three is a call the entity could never have
// narrowed, and none of them may drag the verdict off green.
const withOtherTools = await chatRun('First.Last@constellationdealer.com',
  [mediaScoped, mediaByFileId, mediaNonSearch, otherServer]);
check('a call already pinned to one media file does not count as unscoped',
  withOtherTools.card?.state === 'done', withOtherTools.card?.state);
check('a NON-SEARCH media tool does not count as an unscoped corpus read',
  withOtherTools.card?.state === 'done' &&
  !/list_media_entity_values[\s\S]*WITHOUT/.test(withOtherTools.card?.text || ''),
  withOtherTools.card?.text?.slice(0, 260));
check('a tool on another server does not count as an unscoped corpus read',
  (withOtherTools.card?.text || '').includes('1 of 1 corpus searches'),
  withOtherTools.card?.text?.slice(0, 200));

// Each on its own too. In the combined fixture above these three share one
// verdict, so any of them breaking fails all three assertions and none of them
// is really pinned — the standalone runs are what hold each exclusion down.

const nonSearchOnly = await chatRun('First.Last@constellationdealer.com', [mediaNonSearch]);
check('a non-search media tool alone is not accused of going wide',
  !accused(nonSearchOnly.card), `${nonSearchOnly.card?.state} — ${nonSearchOnly.card?.text?.slice(0, 160)}`);

// Seen live on DEV: handed the file id by the loop, the agent skipped searching
// entirely and read that one file. That is the TIGHTEST run the exercise can
// produce, and an earlier version of this card painted it red.
const byFileIdOnly = await chatRun('First.Last@constellationdealer.com', [mediaByFileId]);
check('a call pinned to one media file alone is not accused of going wide',
  !accused(byFileIdOnly.card), `${byFileIdOnly.card?.state} — ${byFileIdOnly.card?.text?.slice(0, 160)}`);
check('a turn that read the document by id is GREEN, not "no scope applied"',
  byFileIdOnly.card?.state === 'done' && /by id/i.test(byFileIdOnly.card?.text || ''),
  `${byFileIdOnly.card?.state} — ${byFileIdOnly.card?.text?.slice(0, 200)}`);

const withinOneFile = await chatRun('First.Last@constellationdealer.com',
  [mediaScoped, mediaSearchWithinOneFile]);
check('searching WITHIN one already-chosen document is not a corpus search',
  withinOneFile.card?.state === 'done' &&
  (withinOneFile.card?.text || '').includes('1 of 1 corpus searches'),
  `${withinOneFile.card?.state} — ${withinOneFile.card?.text?.slice(0, 200)}`);

// ── 5b. known-not-retrieval leaves a green verdict intact ────────────────────
// These are real TargetUMH operations we can NAME and can say did not search
// the corpus. Beside a scoped run they must leave a clean, confident "every".
for (const [label, fixture] of [
  ['list_media_entity_values({ entityType })', mediaNonSearch],
  ['list_media_entity_values({ entityType, tags })', mediaNonSearchTagged],
  ['generate_embeddings({ mediaFileIds })', mediaProcessing],
  ['a tool the Gateway ran on another server', otherServer]
]) {
  const alongside = await chatRun('First.Last@constellationdealer.com', [mediaScoped, fixture]);
  check(`${label} leaves a CONFIDENT green beside a scoped search`,
    alongside.card?.state === 'done' &&
    /Every corpus search carried your entity/.test(alongside.card?.text || ''),
    `${alongside.card?.state} — ${alongside.card?.text?.slice(0, 170)}`);
  check(`${label} is shown but not counted`,
    /not counted either way/i.test(alongside.card?.text || '') &&
    (alongside.card?.text || '').includes(fixture.toolName),
    alongside.card?.text?.slice(0, 220));

  const alone = await chatRun('First.Last@constellationdealer.com', [fixture]);
  check(`${label} alone is neither green nor an accusation`,
    alone.card?.state !== 'done' && alone.card?.state !== 'failed' && !accused(alone.card),
    `${alone.card?.state} — ${alone.card?.text?.slice(0, 170)}`);
}

// ── 5c. an UNRECOGNISED call costs the card its "every" ──────────────────────
// The distinction 5b is missing on its own. A tool we cannot name, running
// where the media tools run, might have searched wide — we do not know. So the
// card may not make a universal claim about the turn. Not red: an unrecognised
// call is no more evidence of a wide search than of a scoped one. Qualified.
for (const [label, fixture] of [
  ['an unrecognised tool', unknownTool],
  ['an unrecognised tool with no serverName', unknownToolNoServer],
  ['a by-id read that named no document', pinnedWithoutAnId]
]) {
  const alongside = await chatRun('First.Last@constellationdealer.com', [mediaScoped, fixture]);
  check(`${label} does NOT let the card claim "every"`,
    !/Every corpus search/.test(alongside.card?.text || '') &&
    alongside.card?.state !== 'done',
    `${alongside.card?.state} — ${alongside.card?.text?.slice(0, 170)}`);
  check(`${label} still reports what WAS verified`,
    /can account for carried your entity/.test(alongside.card?.text || '') &&
    (alongside.card?.text || '').includes('1 of 1 corpus searches'),
    alongside.card?.text?.slice(0, 200));
  check(`${label} is named, and named as unrecognised rather than cleared`,
    /NOT RECOGNISED/.test(alongside.card?.text || '') &&
    (alongside.card?.text || '').includes(fixture.toolName),
    alongside.card?.text?.slice(0, 260));
  check(`${label} does not make the turn red`,
    alongside.card?.state !== 'failed' && !accused(alongside.card), alongside.card?.state);

  const alone = await chatRun('First.Last@constellationdealer.com', [fixture]);
  check(`${label} alone is neither green nor an accusation`,
    alone.card?.state !== 'done' && alone.card?.state !== 'failed' && !accused(alone.card),
    `${alone.card?.state} — ${alone.card?.text?.slice(0, 170)}`);
}

// The two facts must READ differently. If these cards are the same, the
// distinction between "we know it did not search" and "we cannot tell" is not
// implemented, whatever the individual assertions above say.
const withKnownAside = await chatRun('First.Last@constellationdealer.com', [mediaScoped, mediaProcessing]);
const withUnknown = await chatRun('First.Last@constellationdealer.com', [mediaScoped, unknownTool]);
check('a known-not-retrieval aside and an unrecognised call produce DIFFERENT cards',
  withKnownAside.card?.text !== withUnknown.card?.text &&
  withKnownAside.card?.state !== withUnknown.card?.state,
  `${withKnownAside.card?.state} vs ${withUnknown.card?.state}`);

// A by-id run makes a universal claim too, and loses it the same way.
const directWithUnknown = await chatRun('First.Last@constellationdealer.com', [mediaByFileId, unknownTool]);
check('a read-by-id turn also stops claiming "no corpus search was needed"',
  !/No corpus search was needed/.test(directWithUnknown.card?.text || '') &&
  directWithUnknown.card?.state !== 'done' && directWithUnknown.card?.state !== 'failed',
  `${directWithUnknown.card?.state} — ${directWithUnknown.card?.text?.slice(0, 170)}`);

// The neutral card is a FINISHED step, not one left ticking.
//
// Asserting a duration is on screen proves nothing — the row is given one the
// moment it is drawn, settled or not. What separates the two is whether the
// step ended itself: freezeTrace stamps data-settled on rows that never did,
// which is what every run does when it finishes. So run that, and require the
// stamp to be absent.
await chatRun('First.Last@constellationdealer.com', [mediaProcessing]);
const settling = await evaluate(`
  freezeTrace();
  const card = document.getElementById('step-scope');
  return { state: card.getAttribute('data-state'), settled: card.getAttribute('data-settled') };`);
check('the neutral card ends itself rather than being mopped up at the end of the run',
  settling.settled === null, JSON.stringify(settling));
check('and it is drawn in the neutral state, not a colour',
  settling.state === 'idle', settling.state);

// ── 6. casing — TargetUMH matches entity type and id without regard to case ──
// Measured on DEV: a file stored as Model/CaseProbe-MiXeD-0903 was found by all
// six casings via GET /media/entity, and retrieved through vector_search_media
// with the id lowercased and with the type lowercased. So a re-cased entity WAS
// honoured, and calling it unscoped would be a red card on a correct run.
const recased = await chatRun('First.Last@constellationdealer.com', [mediaScopedRecased]);
check('an entity the agent re-cased still counts as carried, as UMH treats it',
  recased.card?.state === 'done', `${recased.card?.state} — ${recased.card?.text?.slice(0, 200)}`);

// The other direction: folding case must not fold two different people together.
const someoneElse = await chatRun('First.Last@constellationdealer.com', [mediaSomeoneElse]);
check('a different handle is still not a match',
  someoneElse.card?.state === 'failed', someoneElse.card?.state);
const mixedByCase = await chatRun('First.Last@constellationdealer.com',
  [mediaScopedRecased, mediaSomeoneElse]);
check('case folding does not hide a genuinely mixed turn',
  mixedByCase.card?.state === 'failed' && /mixed/i.test(mixedByCase.card?.text || ''),
  mixedByCase.card?.state);

// Nothing retrieved at all is not a scope success either — the answer came from
// somewhere other than these documents, which is worth a colour of its own.
const nothingVisible = await chatRun('First.Last@constellationdealer.com', [otherServer]);
check('a turn with no recognised retrieval does not claim a scope',
  nothingVisible.card?.state !== 'done' &&
  /nothing to judge|nothing was retrieved/i.test(nothingVisible.card?.text || ''),
  `${nothingVisible.card?.state} — ${nothingVisible.card?.text?.slice(0, 160)}`);
check('...and it is not accused of going wide either',
  !accused(nothingVisible.card), nothingVisible.card?.text?.slice(0, 160));
check('...and the card says so plainly rather than guessing',
  nothingVisible.card?.state !== 'failed', nothingVisible.card?.state);

// No entity to ask for at all: the request must go out exactly as it always did.
const bare = await chatRun('', [mediaScoped]);
check('with no handle the request body is unchanged from before this feature',
  Object.keys(bare.body).length === 1 && bare.body.message === 'what is the torque?',
  JSON.stringify(bare.body));
check('and no scope card claims a scope that was never asked for', bare.card === null);

close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
