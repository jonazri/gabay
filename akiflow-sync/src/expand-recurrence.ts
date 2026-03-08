import type Database from 'better-sqlite3';
import rrulePkg from 'rrule';
const { RRule, rrulestr } = rrulePkg;
import { logger } from './logger.js';

/** Rolling window: expand recurring events from MONTHS_BACK to MONTHS_AHEAD. */
const MONTHS_BACK = 1;
const MONTHS_AHEAD = 3;

/** Proximity threshold for deduplicating stale recurring masters (ms). */
const DEDUP_PROXIMITY_MS = 30 * 60_000; // 30 minutes

interface RecurringEvent {
  id: string;
  data: string;
}

interface ParsedMaster {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  recurrence: string[];
  calendar_id: string | null;
  origin_calendar_id: string | null;
  start_datetime_tz: string | null;
  description: string | null;
  status: string | null;
  declined: boolean;
  organizer_id: string | null;
  updated_at: string | null;
}

/**
 * Deduplicate recurring masters: group by title + recurrence rule,
 * keep only the most recently updated master per group.
 * Also collapses cross-calendar dupes (same title + same rule on different calendars).
 */
function deduplicateMasters(masters: ParsedMaster[]): ParsedMaster[] {
  // Key: title + rrule string (normalized)
  const groups = new Map<string, ParsedMaster>();

  for (const m of masters) {
    const rruleStr = m.recurrence
      .filter((r) => r.startsWith('RRULE:') || r.startsWith('FREQ='))
      .join('|');
    const key = `${m.title}\0${rruleStr}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, m);
    } else {
      // Keep the most recently updated one (likely has the current time)
      const existingTs = existing.updated_at
        ? new Date(existing.updated_at).getTime()
        : 0;
      const newTs = m.updated_at ? new Date(m.updated_at).getTime() : 0;
      if (newTs > existingTs) {
        groups.set(key, m);
      }
    }
  }

  return [...groups.values()];
}

/**
 * Expand all recurring events into concrete instances in event_instances table.
 * Deduplicates stale recurring masters before expansion.
 * Called after each event sync cycle.
 */
export function expandRecurringEvents(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_instances (
      instance_id   TEXT PRIMARY KEY,
      master_id     TEXT NOT NULL,
      title         TEXT,
      start_time    TEXT,
      end_time      TEXT,
      timezone      TEXT,
      calendar_id   TEXT,
      calendar_name TEXT,
      description   TEXT,
      status        TEXT,
      declined      INTEGER DEFAULT 0,
      organizer     TEXT,
      expanded_at   INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_instances_start
      ON event_instances(start_time)
  `);

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - MONTHS_BACK);
  const windowEnd = new Date(now);
  windowEnd.setMonth(windowEnd.getMonth() + MONTHS_AHEAD);

  // Fetch recurring masters
  const rawMasters = db
    .prepare(
      `
    SELECT id, data FROM events
    WHERE json_extract(data, '$.recurrence') IS NOT NULL
      AND json_extract(data, '$.recurrence') != '[]'
      AND json_extract(data, '$.deleted_at') IS NULL
  `,
    )
    .all() as RecurringEvent[];

  // Parse into structured objects
  const parsed: ParsedMaster[] = [];
  for (const raw of rawMasters) {
    try {
      const d = JSON.parse(raw.data);
      if (!d.start_time) continue;
      const recurrence: string[] = Array.isArray(d.recurrence)
        ? d.recurrence
        : [];
      if (!recurrence.length) continue;

      parsed.push({
        id: raw.id,
        title: d.title ?? '',
        start_time: d.start_time,
        end_time: d.end_time ?? null,
        recurrence,
        calendar_id: d.calendar_id ?? null,
        origin_calendar_id: d.origin_calendar_id ?? null,
        start_datetime_tz: d.start_datetime_tz ?? null,
        description: d.description ?? null,
        status: d.status ?? null,
        declined: d.declined === true || d.declined === 1,
        organizer_id: d.organizer_id ?? null,
        updated_at: d.updated_at ?? null,
      });
    } catch {
      continue;
    }
  }

  // Deduplicate masters before expanding
  const dedupedMasters = deduplicateMasters(parsed);

  // Clear and rebuild
  db.exec('DELETE FROM event_instances');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO event_instances
      (instance_id, master_id, title, start_time, end_time, timezone,
       calendar_id, calendar_name, description, status, declined, organizer, expanded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const row of rows) {
      insert.run(...row);
    }
  });

  const allRows: unknown[][] = [];
  let expandedCount = 0;
  const expandedAt = Date.now();

  for (const master of dedupedMasters) {
    try {
      const masterStartDate = new Date(master.start_time);
      const masterEndDate = master.end_time ? new Date(master.end_time) : null;
      const durationMs = masterEndDate
        ? masterEndDate.getTime() - masterStartDate.getTime()
        : 3600_000;

      let rule: InstanceType<typeof RRule> | null = null;
      for (const rStr of master.recurrence) {
        if (!rStr.startsWith('RRULE:') && !rStr.startsWith('FREQ=')) continue;
        try {
          const rruleString = rStr.startsWith('RRULE:') ? rStr.slice(6) : rStr;
          rule = new RRule({
            ...RRule.parseString(rruleString),
            dtstart: masterStartDate,
          });
          break;
        } catch {
          try {
            const dtstart = masterStartDate
              .toISOString()
              .replace(/[-:]/g, '')
              .replace(/\.\d{3}/, '');
            rule = rrulestr(`DTSTART:${dtstart}\n${rStr}`) as InstanceType<
              typeof RRule
            >;
            break;
          } catch {
            continue;
          }
        }
      }

      if (!rule) continue;

      const occurrences = rule.between(windowStart, windowEnd, true);
      for (const occ of occurrences) {
        const occEnd = new Date(occ.getTime() + durationMs);
        const instanceId = `${master.id}_${occ.toISOString()}`;

        allRows.push([
          instanceId,
          master.id,
          master.title,
          occ.toISOString(),
          occEnd.toISOString(),
          master.start_datetime_tz,
          master.calendar_id,
          master.origin_calendar_id,
          master.description,
          master.status,
          master.declined ? 1 : 0,
          master.organizer_id,
          expandedAt,
        ]);
        expandedCount++;
      }
    } catch (e) {
      logger.warn(`[expand] failed to expand event ${master.id}: ${e}`);
    }
  }

  if (allRows.length > 0) {
    insertMany(allRows);
  }

  logger.info(
    `[expand] ${rawMasters.length} masters → ${dedupedMasters.length} after dedup → ${expandedCount} instances ` +
      `(${windowStart.toISOString().slice(0, 10)} to ${windowEnd.toISOString().slice(0, 10)})`,
  );
}
