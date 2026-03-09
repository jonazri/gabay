import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { initDb } from '../db.js';
import { formatTaskText, formatEventText, pointId, ensureCollection } from '../indexer.js';

const BATCH_SIZE = 100;
const DELAY_MS = 1000;

async function main() {
  const dbPath = process.env.AKIFLOW_DB_PATH;
  if (!dbPath) throw new Error('AKIFLOW_DB_PATH not set');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const db = initDb(dbPath);
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
  const openai = new OpenAI({ apiKey });

  await ensureCollection(qdrant);

  // Backfill tasks
  const tasks = db.prepare(`
    SELECT id, title, status, done, label, org, scheduled_date,
      datetime, priority, description, deleted_at
    FROM tasks_display
    WHERE deleted_at IS NULL
  `).all() as Record<string, unknown>[];

  console.log(`Backfilling ${tasks.length} tasks...`);
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((row) => formatTaskText(row));
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    const vectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    const points = batch.map((row, j) => ({
      id: pointId('task', String(row.id)),
      vector: vectors[j],
      payload: {
        entity_type: 'task',
        entity_id: String(row.id),
        title: String(row.title || ''),
        label: row.label ? String(row.label) : null,
        org: row.org ? String(row.org) : null,
        account: null,
        status: String(row.status || 'unknown'),
        scheduled_date: row.scheduled_date ? String(row.scheduled_date) : null,
        start_time: null,
        priority: Number(row.priority || 0),
        done: Boolean(row.done),
        deleted: false,
        updated_at: Date.now(),
      } as Record<string, unknown>,
    }));

    await qdrant.upsert('akiflow_entities', { points, wait: true });
    console.log(`  Tasks ${i + 1}-${Math.min(i + BATCH_SIZE, tasks.length)}`);
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // Backfill events
  const events = db.prepare(`
    SELECT id, title, start, end, account, description, status, recurring
    FROM events_view
  `).all() as Record<string, unknown>[];

  console.log(`Backfilling ${events.length} events...`);
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const texts = batch.map((row) => formatEventText(row));
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    const vectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    const points = batch.map((row, j) => ({
      id: pointId('event', String(row.id)),
      vector: vectors[j],
      payload: {
        entity_type: 'event',
        entity_id: String(row.id),
        title: String(row.title || ''),
        label: null,
        org: null,
        account: row.account ? String(row.account) : null,
        status: String(row.status || ''),
        scheduled_date: null,
        start_time: row.start ? String(row.start) : null,
        priority: 0,
        done: false,
        deleted: false,
        updated_at: Date.now(),
      } as Record<string, unknown>,
    }));

    await qdrant.upsert('akiflow_entities', { points, wait: true });
    console.log(`  Events ${i + 1}-${Math.min(i + BATCH_SIZE, events.length)}`);
    if (i + BATCH_SIZE < events.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log('Backfill complete.');
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
