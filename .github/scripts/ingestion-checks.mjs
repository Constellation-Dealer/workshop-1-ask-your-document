// Shared ingestion-poll checks. Two things, both about a hang rather than an error.
//
// 1. isIngestionInFlight must be TOTAL: it answers "keep waiting" only for the
//    statuses UMH uses while it is still working, and "stop" for everything
//    else -- including a status this repo has never heard of. Written as a
//    property, not a list of known-bad values, because the bug it guards was
//    exactly a list that did not mention Skipped.
//
// 2. runAgenticLoop must SETTLE, whatever the status does — resolve or reject,
//    just never spin. The unimplemented skeleton rejects immediately and passes,
//    and the finished loop passes only if it treats a terminal status as
//    terminal AND keeps a deadline over a status that never leaves the in-flight
//    set. Where ingestion really did complete, an implemented loop must also
//    SUCCEED and render the answer — "settled" alone would accept a loop that
//    threw on a perfectly good file. The skeleton is exempted from that by its
//    own condition (it never created a poll step), not by a branch name, so the
//    one check still runs on both branches with nothing skipped.
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
  // "Settles" (resolve OR reject, just never spin) is the only assertion that
  // can hold for BOTH the unimplemented skeleton and the finished solution, so
  // it is what makes one check cover both branches with nothing skipped.
  //
  // On its own it is too weak, though: a loop that wrongly REJECTS a perfectly
  // good Completed file also settles. So every run reports whether the loop is
  // even implemented -- structurally, by whether it got as far as creating a
  // poll step -- and the Completed cases below demand a real success from any
  // loop that is.
  const sequences = [
    [['Skipped'], 'ingestion stays Skipped', {}],
    [['Failed'], 'ingestion stays Failed', {}],
    [['Quarantined'], 'ingestion stays at an unknown status', {}],
    // Permanently in flight. Without a deadline the loop is CORRECT to keep
    // waiting and will therefore spin forever, so this is the case that makes
    // the deadline load-bearing rather than decorative. The clock is
    // fast-forwarded because a two-minute budget cannot be waited out here.
    [['Pending'], 'ingestion never leaves Pending', { fastClock: true }],
    [['Completed'], 'ingestion is already Completed', { expectSuccess: true }],
    [['Pending', 'Extracting', 'Embedding', 'Completed'], 'ingestion works through to Completed', { expectSuccess: true }],
  ];

  let sawImplemented = false;
  for (const [statuses, label, opts] of sequences) {
    const r = await evaluate(settleExpr(statuses, opts));
    const settled = r.outcome !== 'TIMEOUT';
    check(`runAgenticLoop settles when ${label}`, settled,
      settled ? String(r.outcome).slice(0, 105) : 'it never settled — the poll loop is spinning');
    if (!r.unimplemented) sawImplemented = true;

    // A loop that exists must SUCCEED on a file that really did finish, and put
    // the answer on the page. Only a loop that never started polling is excused,
    // and that exemption is the skeleton's own condition, not a branch name.
    if (opts.expectSuccess && settled) {
      const ok = r.unimplemented || (r.outcome === 'resolved' && r.answered === true);
      check(`...and succeeds, rendering the answer, when ${label}`, ok,
        r.unimplemented
          ? 'loop not implemented on this branch — exempt'
          : `outcome=${r.outcome} answered=${r.answered}`);
    }
  }

  // Say which branch this was, so a run that silently exempted everything is
  // visible in the log rather than reading as a clean pass.
  console.log(`  note  loop is ${sawImplemented ? 'IMPLEMENTED — success assertions applied' : 'the unimplemented skeleton — success assertions exempt'}`);

  const errs = consoleLogs().filter(l => l.startsWith('[pageerror]'));
  if (errs.length) console.log('\npage errors:\n' + errs.join('\n'));

  close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n` + failures.map(f => ' - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nall ingestion-poll checks passed');
}
