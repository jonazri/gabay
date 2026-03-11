/**
 * import-whatsapp-backup.ts
 *
 * One-time script to import an iPhone WhatsApp backup (ChatStorage.sqlite) into:
 *   Phase 1 — Qdrant RAG database (all chats, with embeddings)
 *   Phase 2 — NanoClaw SQLite DB (registered chats only: backfill + augment reply context)
 *
 * Usage:
 *   npx tsx scripts/import-whatsapp-backup.ts --backup-path /path/to/ChatStorage.sqlite [--dry-run]
 *
 * Prerequisites:
 *   - Qdrant running (docker compose up -d in rag-system/docker/)
 *   - RAG service built (cd rag-system && npm install && npx tsc)
 *   - OPENAI_API_KEY in environment
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// --- Mac epoch conversion ---
// iPhone timestamps are seconds since 2001-01-01 00:00:00 UTC
const MAC_EPOCH_OFFSET = 978307200; // Unix timestamp of 2001-01-01

function macTimeToIso(macTime: number): string {
  return new Date((macTime + MAC_EPOCH_OFFSET) * 1000).toISOString();
}

// --- Arg parsing ---
const args = process.argv.slice(2);
const backupPathIndex = args.indexOf('--backup-path');
const backupPathArg =
  args.find((a) => a.startsWith('--backup-path='))?.split('=')[1] ||
  (backupPathIndex >= 0 && backupPathIndex + 1 < args.length
    ? args[backupPathIndex + 1]
    : undefined);
const dryRun = args.includes('--dry-run');

if (!backupPathArg) {
  console.error(
    'Usage: npx tsx scripts/import-whatsapp-backup.ts --backup-path /path/to/ChatStorage.sqlite [--dry-run]',
  );
  process.exit(1);
}

const backupPath = path.resolve(backupPathArg);
if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

// --- Dynamic imports for RAG service (optional, only available when whatsapp-search skill is installed) ---
async function importRagDeps() {
  const { getConfig, loadConfig } = await import('../rag-system/src/config.js');
  const { initialize: initEmbeddings, embedBatch } =
    await import('../rag-system/src/embeddings.js');
  const { qdrantClient, messageIdToUuid } =
    await import('../rag-system/src/database/qdrant-client.js');
  return {
    getConfig,
    loadConfig,
    initEmbeddings,
    embedBatch,
    qdrantClient,
    messageIdToUuid,
  };
}

interface BackupMessage {
  stanza_id: string;
  text: string | null;
  is_from_me: number;
  mac_timestamp: number;
  chat_jid: string;
  chat_name: string | null;
  sender_jid: string | null;
  sender_name: string | null;
  quoted_stanza_id: string | null;
  quoted_text: string | null;
  quoted_sender_jid: string | null;
}

function queryBackupMessages(
  db: Database.Database,
  afterMacTime: number,
  limit: number,
): BackupMessage[] {
  return db
    .prepare(
      `
    SELECT
      m.ZSTANZAID       AS stanza_id,
      m.ZTEXT           AS text,
      m.ZISFROMME       AS is_from_me,
      m.ZTIMESTAMP      AS mac_timestamp,
      cs.ZCONTACTJID    AS chat_jid,
      cs.ZPARTNERNAME   AS chat_name,
      gm.ZMEMBERJID     AS sender_jid,
      gm.ZFULLNAME      AS sender_name,
      qm.ZSTANZAID      AS quoted_stanza_id,
      qm.ZTEXT          AS quoted_text,
      qgm.ZMEMBERJID    AS quoted_sender_jid
    FROM ZWAMESSAGE m
    JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
    LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
    LEFT JOIN ZWAMESSAGE qm ON qm.Z_PK = m.ZQUOTEDMESSAGE
    LEFT JOIN ZWAGROUPMEMBER qgm ON qgm.Z_PK = qm.ZGROUPMEMBER
    WHERE m.ZTIMESTAMP > ?
      AND m.ZTEXT IS NOT NULL
      AND m.ZTEXT != ''
      AND m.ZSTANZAID IS NOT NULL
      AND cs.ZCONTACTJID IS NOT NULL
    ORDER BY m.ZTIMESTAMP ASC
    LIMIT ?
  `,
    )
    .all(afterMacTime, limit) as BackupMessage[];
}

const WATERMARK_PATH = path.join(
  process.cwd(),
  'rag-system',
  'data',
  'backup-import-watermark.json',
);
const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 1000;

function readWatermark(): number {
  try {
    if (fs.existsSync(WATERMARK_PATH)) {
      return (
        JSON.parse(fs.readFileSync(WATERMARK_PATH, 'utf-8')).lastMacTime ?? 0
      );
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function writeWatermark(lastMacTime: number): void {
  fs.mkdirSync(path.dirname(WATERMARK_PATH), { recursive: true });
  fs.writeFileSync(WATERMARK_PATH, JSON.stringify({ lastMacTime }));
}

async function phase1RagImport(
  backupDb: Database.Database,
  deps: Awaited<ReturnType<typeof importRagDeps>>,
): Promise<void> {
  console.log('\n=== Phase 1: RAG import (all chats) ===');

  const { embedBatch, qdrantClient, messageIdToUuid } = deps;
  let lastMacTime = readWatermark();
  let totalUpserted = 0;
  let batchNum = 0;

  while (true) {
    const messages = queryBackupMessages(backupDb, lastMacTime, BATCH_SIZE);
    if (messages.length === 0) break;

    batchNum++;
    const texts = messages.map((m) => {
      const sender =
        m.sender_name ||
        m.sender_jid?.split('@')[0] ||
        (m.is_from_me ? 'Me' : 'Unknown');
      const group = m.chat_name ? ` [${m.chat_name}]` : '';
      return `${sender}${group}: ${m.text}`;
    });

    lastMacTime = messages[messages.length - 1].mac_timestamp;
    totalUpserted += messages.length;

    if (!dryRun) {
      const vectors = await embedBatch(texts);
      const embeddings = messages.map((m, i) => ({
        id: messageIdToUuid(m.stanza_id, m.chat_jid),
        vector: vectors[i],
        payload: {
          message_id: m.stanza_id,
          chat_jid: m.chat_jid,
          sender: m.sender_jid || '',
          sender_name: m.sender_name || m.sender_jid?.split('@')[0] || '',
          content: m.text || '',
          timestamp: macTimeToIso(m.mac_timestamp),
          group_name: m.chat_name || undefined,
          replied_to_id: m.quoted_stanza_id || undefined,
          replied_to_sender: m.quoted_sender_jid || undefined,
          replied_to_content: m.quoted_text || undefined,
        },
      }));
      await qdrantClient.upsertEmbeddings(embeddings);
      writeWatermark(lastMacTime);
    }

    console.log(
      `  Batch ${batchNum}: ${messages.length} messages (up to ${macTimeToIso(messages[messages.length - 1].mac_timestamp)})`,
    );

    if (messages.length === BATCH_SIZE) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  console.log(
    `Phase 1 complete: ${totalUpserted} messages ${dryRun ? '(dry run)' : 'upserted to Qdrant'}`,
  );
}

async function phase2NanoclawAugment(
  backupDb: Database.Database,
): Promise<void> {
  console.log(
    '\n=== Phase 2: NanoClaw DB augmentation (registered chats only) ===',
  );

  // Dynamically load NanoClaw DB path
  const { STORE_DIR } = await import('../src/config.js');
  const dbPath = path.join(STORE_DIR, 'messages.db');
  if (!fs.existsSync(dbPath)) {
    console.log('NanoClaw DB not found, skipping Phase 2');
    return;
  }

  const nanoclawDb = new Database(dbPath);

  // Get registered group JIDs from NanoClaw
  const registeredJids: Set<string> = new Set(
    (
      nanoclawDb.prepare('SELECT jid FROM registered_groups').all() as {
        jid: string;
      }[]
    ).map((r) => r.jid),
  );
  console.log(
    `  Found ${registeredJids.size} registered groups: ${[...registeredJids].join(', ')}`,
  );

  if (registeredJids.size === 0) {
    console.log('  No registered groups found, skipping Phase 2');
    return;
  }

  // Query backup messages for registered chats only
  const backupRegistered = backupDb
    .prepare(
      `
    SELECT
      m.ZSTANZAID       AS stanza_id,
      m.ZTEXT           AS text,
      m.ZISFROMME       AS is_from_me,
      m.ZTIMESTAMP      AS mac_timestamp,
      cs.ZCONTACTJID    AS chat_jid,
      gm.ZMEMBERJID     AS sender_jid,
      gm.ZFULLNAME      AS sender_name,
      qm.ZSTANZAID      AS quoted_stanza_id,
      qm.ZTEXT          AS quoted_text,
      qgm.ZMEMBERJID    AS quoted_sender_jid
    FROM ZWAMESSAGE m
    JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
    LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
    LEFT JOIN ZWAMESSAGE qm ON qm.Z_PK = m.ZQUOTEDMESSAGE
    LEFT JOIN ZWAGROUPMEMBER qgm ON qgm.Z_PK = qm.ZGROUPMEMBER
    WHERE m.ZSTANZAID IS NOT NULL
      AND cs.ZCONTACTJID IN (${[...registeredJids].map(() => '?').join(',')})
    ORDER BY m.ZTIMESTAMP ASC
  `,
    )
    .all(...registeredJids) as BackupMessage[];

  console.log(
    `  Found ${backupRegistered.length} messages in registered chats from backup`,
  );

  let updated = 0;
  let inserted = 0;
  let skipped = 0;

  const updateStmt = nanoclawDb.prepare(`
    UPDATE messages
    SET replied_to_id = ?, replied_to_sender = ?, replied_to_content = ?
    WHERE id = ? AND chat_jid = ?
  `);

  const insertStmt = nanoclawDb.prepare(`
    INSERT OR IGNORE INTO messages
      (id, chat_jid, sender, sender_name, content, timestamp, is_from_me,
       replied_to_id, replied_to_sender, replied_to_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of backupRegistered) {
    if (!m.text) {
      skipped++;
      continue;
    }
    const ts = macTimeToIso(m.mac_timestamp);
    const sender = m.sender_jid || m.chat_jid;
    const senderName = m.sender_name || sender.split('@')[0];

    if (!dryRun) {
      if (m.quoted_stanza_id) {
        const result = updateStmt.run(
          m.quoted_stanza_id,
          m.quoted_sender_jid || null,
          m.quoted_text || null,
          m.stanza_id,
          m.chat_jid,
        );
        if (result.changes > 0) updated++;
      }

      // Insert missing messages (pre-registration history)
      const insertResult = insertStmt.run(
        m.stanza_id,
        m.chat_jid,
        sender,
        senderName,
        m.text,
        ts,
        m.is_from_me ? 1 : 0,
        m.quoted_stanza_id || null,
        m.quoted_sender_jid || null,
        m.quoted_text || null,
      );
      if (insertResult.changes > 0) inserted++;
    } else {
      if (m.quoted_stanza_id) updated++;
      inserted++;
    }
  }

  nanoclawDb.close();
  console.log(
    `Phase 2 complete: ${updated} updated, ${inserted} inserted, ${skipped} skipped ${dryRun ? '(dry run)' : ''}`,
  );
}

async function main(): Promise<void> {
  console.log(`Opening backup: ${backupPath}`);
  const backupDb = new Database(backupPath, { readonly: true });

  // Verify expected table exists
  const tables = backupDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ZWAMESSAGE'`,
    )
    .get();
  if (!tables) {
    console.error(
      'ZWAMESSAGE table not found — is this an iPhone WhatsApp backup (ChatStorage.sqlite)?',
    );
    process.exit(1);
  }

  try {
    const deps = await importRagDeps();
    deps.loadConfig();
    deps.initEmbeddings();
    await deps.qdrantClient.initializeCollection();

    await phase1RagImport(backupDb, deps);
    await phase2NanoclawAugment(backupDb);
  } finally {
    backupDb.close();
  }

  console.log('\nImport complete.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
