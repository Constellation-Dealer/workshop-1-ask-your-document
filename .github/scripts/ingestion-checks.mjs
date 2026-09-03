// Shared ingestion-poll checks. Everything here is about a HANG or a false
// success rather than a visible error.
//
// 1. isIngestionInFlight must be TOTAL: it answers "keep waiting" only for the
//    statuses UMH uses while it is still working, and "stop" for everything
//    else -- including a status this repo has never heard of. Written as a
//    property, not a list of known-bad values, because the bug it guards was
//    exactly a list that did not mention Skipped.
//
// 2. runAgenticLoop must settle AND reach the right outcome. "It settled" alone
//    accepts a loop that throws on a good file, and "it rejected" alone accepts
//    a loop that silently gives up on one still being ingested. So each case
//    below carries what an implemented loop must actually do:
//      - ingestion completed  -> resolve, having polled, with the answer rendered
//      - ingestion stopped    -> reject, render nothing, and NAME the status
//
//    The exercise skeleton is exempt, identified by the stub step it renders
//    itself (`addStep('todo', 'Not Implemented Yet', ...)`). That is a POSITIVE
//    marker on purpose: keying the exemption on "no poll step appeared" would
//    excuse a solution that returns before it ever polls, which is the same
//    false pass in a new shape.
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
  check('in-flight match ignores case', await evaluate(`isIngestionInFlight('pending') === true && isIngestionInFlight('EMBEDDING') === true`));

  // ── 2. explainIngestionStop only stays silent for success ────────────────
  check('explainIngestionStop("Completed") is null', await evaluate(`explainIngestionStop('Completed') === null`));
  for (const s of ['Failed', 'Skipped', 'Quarantined', '', 'undefined']) {
    const expr = s === 'undefined' ? 'explainIngestionStop(undefined)' : `explainIngestionStop(${JSON.stringify(s)})`;
    check(`explainIngestionStop(${JSON.stringify(s)}) explains itself`, await evaluate(`typeof (${expr}) === 'string' && (${expr}).length > 30`));
  }
  check('the Skipped message names the cause a participant can act on',
    await evaluate(`/text layer|scan/i.test(explainIngestionStop('Skipped'))`));

  // ── 3. the loop settles, and settles the RIGHT way ──────────────────────
  const sequences = [
    { statuses: ['Skipped'], label: 'ingestion stays Skipped', expect: 'stopped', names: 'Skipped' },
    { statuses: ['Failed'], label: 'ingestion stays Failed', expect: 'stopped', names: 'Failed' },
    { statuses: ['Quarantined'], label: 'ingestion stays at an unknown status', expect: 'stopped', names: 'Quarantined' },
    // Permanently in flight. Without a deadline the loop is CORRECT to keep
    // waiting and so spins forever; with a deadline that `return`s instead of
    // throwing it reports success for a file that never finished. Both are
    // covered because this case demands a REJECTION that names the status.
    { statuses: ['Pending'], label: 'ingestion never leaves Pending', expect: 'stopped', names: 'Pending', fastClock: true },
    { statuses: ['Completed'], label: 'ingestion is already Completed', expect: 'success' },
    { statuses: ['Pending', 'Extracting', 'Embedding', 'Completed'], label: 'ingestion works through to Completed', expect: 'success' },
  ];

  let sawImplemented = false;
  for (const seq of sequences) {
    const r = await evaluate(settleExpr(seq.statuses, { fastClock: Boolean(seq.fastClock) }));
    const settled = r.outcome !== 'TIMEOUT';
    check(`runAgenticLoop settles when ${seq.label}`, settled,
      settled ? String(r.outcome).slice(0, 100) : 'it never settled — the poll loop is spinning');
    if (!settled) continue;

    if (r.unimplemented) {
      console.log(`  ok   ...exercise skeleton, so no outcome is required of it (${seq.label})`);
      continue;
    }
    sawImplemented = true;

    if (seq.expect === 'success') {
      // Must succeed, must have actually polled to get there, must show the answer.
      check(`...and succeeds, having polled, rendering the answer, when ${seq.label}`,
        r.outcome === 'resolved' && r.polled === true && r.answered === true,
        `outcome=${r.outcome} polled=${r.polled} answered=${r.answered}`);
    } else {
      // Must fail LOUDLY: reject, show no answer, and say which status stopped
      // it. The status is the test's own input, so this asserts the diagnostic
      // is present without pinning the implementation's wording.
      const rejected = String(r.outcome).startsWith('rejected');
      check(`...and rejects, rendering no answer, when ${seq.label}`,
        rejected && r.answered === false,
        `outcome=${r.outcome} answered=${r.answered}`);
      check(`...and the error names "${seq.names}" so the cause is visible`,
        rejected && String(r.outcome).includes(seq.names),
        String(r.outcome).slice(0, 100));
    }
  }

  console.log(`  note  loop is ${sawImplemented ? 'IMPLEMENTED — outcome assertions applied' : 'the unimplemented skeleton — outcome assertions exempt'}`);

  const errs = consoleLogs().filter(l => l.startsWith('[pageerror]'));
  if (errs.length) console.log('\npage errors:\n' + errs.join('\n'));

  close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n` + failures.map(f => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nall ingestion-poll checks passed');
}
