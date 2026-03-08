#!/usr/bin/env node
/**
 * CLI tool: list events for a date range.
 *
 * Reads from the events_view which already handles:
 *   - RRULE expansion (via event_instances, populated by daemon)
 *   - Cross-calendar dedup (GROUP BY title + start)
 *   - Filtering out cancelled and declined events
 *
 * Usage:
 *   node list-events.js <start> <end>
 *   node list-events.js 2026-03-08 2026-03-14
 *
 * Reads $AKIFLOW_DB (or --db <path>). Outputs a markdown table.
 */
import Database from 'better-sqlite3';

interface EventRow {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  calendar: string;
  description: string;
  status: string;
  recurring: number;
  organizer: string;
  account: string;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: list-events [--db <path>] <start-date> <end-date>');
  console.log('List calendar events in a date range as a markdown table.');
  console.log('');
  console.log('Arguments:');
  console.log('  start-date   Start date (YYYY-MM-DD)');
  console.log('  end-date     End date, inclusive (YYYY-MM-DD)');
  console.log('');
  console.log('Options:');
  console.log('  --db <path>  Path to SQLite database (default: $AKIFLOW_DB)');
  console.log('  --help, -h   Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  list-events 2026-03-08 2026-03-14');
  console.log('  list-events --db /path/to/akiflow.db 2026-03-01 2026-03-31');
  process.exit(0);
}

let dbPath = process.env.AKIFLOW_DB ?? '';
let startArg = '';
let endArg = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db' && args[i + 1]) {
    dbPath = args[++i];
  } else if (!startArg) {
    startArg = args[i];
  } else if (!endArg) {
    endArg = args[i];
  }
}

if (!startArg || !endArg) {
  console.error('Usage: list-events <start-date> <end-date>');
  console.error('  e.g. list-events 2026-03-08 2026-03-14');
  process.exit(1);
}
if (!dbPath) {
  console.error('Error: AKIFLOW_DB not set and no --db flag provided');
  process.exit(1);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(startArg) || !DATE_RE.test(endArg)) {
  console.error('Error: dates must be YYYY-MM-DD');
  process.exit(1);
}

// End date is inclusive — query up to end+1 day
const endPlusOne = new Date(endArg + 'T00:00:00Z');
endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
const endExclusive = endPlusOne.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    `
  SELECT id, title, start, end, timezone, calendar,
         description, status, recurring, organizer, account
  FROM events_view
  WHERE start >= ? AND start < ?
  ORDER BY start ASC
`,
  )
  .all(startArg, endExclusive) as EventRow[];

db.close();

// ---------------------------------------------------------------------------
// Output markdown
// ---------------------------------------------------------------------------

if (rows.length === 0) {
  console.log('No events found.');
  process.exit(0);
}

function formatTime(iso: string, tz: string): string {
  try {
    const d = new Date(iso);
    if (tz) {
      return d.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    return d.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

console.log('| When | Duration | Title | Account | Recurring | ID |');
console.log('|------|----------|-------|---------|-----------|----|');
for (const ev of rows) {
  const when = formatTime(ev.start, ev.timezone);
  const dur = ev.end ? formatDuration(ev.start, ev.end) : '';
  const titleClean = (ev.title ?? '').replace(/\|/g, '/');
  const acct = ev.account ?? '';
  const rec = ev.recurring ? 'Y' : '';
  console.log(
    `| ${when} | ${dur} | ${titleClean} | ${acct} | ${rec} | ${ev.id} |`,
  );
}
