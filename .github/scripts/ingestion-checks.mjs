// Shared ingestion-poll checks. Two things, both about a hang rather than an error.
//
// 1. isIngestionInFlight must be TOTAL: it answers "keep waiting" only for the
//    statuses UMH uses while it is still working, and "stop" for everything
//    else -- including a status this repo has never heard of. Written as a
//    property, not a list of known-bad values, because the bug it guards was
//    exactly a list that did not mention Skipped.
//
// 2. runAgenticLoop must SETTLE when the status never becomes Completed. It may
//    resolve or reject; what it must not do is spin. The unimplemented skeleton
//    on `main` rejects immediately and passes this, and the finished loop on
//    `solution` passes only if it treats a terminal status as terminal. So the
//    same check runs on both branches with nothing skipped.
import { goto, evaluate, consoleLogs, close } from './cdp.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5199/';

// UMH's IngestionStatus enum (TargetUMH.Domain/Enums/IngestionStatus.cs), plus
// values that are not in it at all.
const IN_FLIGHT = ['Pending', 'Processing', 'Extracting', 'Embedding'];
const TERMINAL  = ['Completed', 'Failed', 'Skipped'];
const UNKNOWN   = ['Quarantined', 'completed', 'skipped', '', 'null'];

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

export async function run({ readyExpr, settleExpr }) {
  await goto(APP_URL, readyExpr);

  // ── 1. the predicate is total ────────────────────────────────────────────
  for (const s of IN_FLIGHT) {
    check(`isIngestionInFlight("${s}") is true`, await evaluate(`isIngestionInFlight(${JSON.stringify(s)}) === true`));
  }
  for (const s of [...TERMINAL, ...UNKNOWN]) {
    check(`isIngestionInFlight(${JSON.stringify(s)}) is false`, await evaluate(`isIngestionInFlight(${JSON.stringify(s)}) === false`));
  }
  for (const v of ['undefined', 'null']) {
    check(`isIngestionInFlight(${v}) is false`, await evaluate(`isIngestionInFlight(${v}) === false`));
  }

  // Case-insensitive, so the API's "Skipped" and the database's "skipped" agree.
  check('in-flight match ignores case', await evaluate(`isIngestionInFlight('pending') === true && isIngestionInFlight('EMBEDDING') === true`));

  // ── 2. explainIngestionStop only stays silent for success ────────────────
  check('explainIngestionStop("Completed") is null', await evaluate(`explainIngestionStop('Completed') === null`));
  for (const s of ['Failed', 'Skipped', 'Quarantined', '', 'undefined']) {
    const expr = s === 'undefined' ? 'explainIngestionStop(undefined)' : `explainIngestionStop(${JSON.stringify(s)})`;
    check(`explainIngestionStop(${JSON.stringify(s)}) explains itself`, await evaluate(`typeof (${expr}) === 'string' && (${expr}).length > 30`));
  }
  check('the Skipped message names the cause a participant can act on',
    await evaluate(`/text layer|scan/i.test(explainIngestionStop('Skipped'))`));

  // ── 3. the loop always settles, whatever the status does ────────────────
  //
  // Both the stuck cases AND the happy path: a loop that never re-polls, or
  // one that re-polls forever after Completed, hangs just as silently as the
  // Skipped bug. The assertion is only "it settled", which the unimplemented
  // skeleton satisfies by rejecting -- so this runs on both branches.
  const sequences = [
    [['Skipped'], 'ingestion stays Skipped'],
    [['Failed'], 'ingestion stays Failed'],
    [['Quarantined'], 'ingestion stays at an unknown status'],
    [['Completed'], 'ingestion is already Completed'],
    [['Pending', 'Extracting', 'Embedding', 'Completed'], 'ingestion works through to Completed'],
  ];
  for (const [statuses, label] of sequences) {
    const outcome = await evaluate(settleExpr(statuses));
    check(`runAgenticLoop settles when ${label}`, outcome !== 'TIMEOUT',
      outcome === 'TIMEOUT' ? 'it never settled — the poll loop is spinning' : String(outcome).slice(0, 110));
  }

  // Whenever the loop DOES run to completion, the answer has to reach the page.
  // Scoped to "if it resolved" so the skeleton, which rejects, is not asked to
  // render anything -- but a finished loop that silently drops the answer fails.
  const happy = await evaluate(settleExpr(['Pending', 'Completed'], { trackAnswer: true }));
  check('a loop that runs to completion renders the answer',
    happy.outcome !== 'resolved' || happy.answered === true,
    `outcome=${happy.outcome} answered=${happy.answered}`);

  const errs = consoleLogs().filter(l => l.startsWith('[pageerror]'));
  if (errs.length) console.log('\npage errors:\n' + errs.join('\n'));

  close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n` + failures.map(f => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nall ingestion-poll checks passed');
}
