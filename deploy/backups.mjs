import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { backup, DatabaseSync } from 'node:sqlite';
import { assertDatabaseIntegrity, assertNoDemoData, assertProductionBinding, assertRequiredSchema, buildId, keyFingerprint, privateDirectory, privateFile, readReadyDatabase, SCHEMA_REVISION, schemaFingerprint, syncDirectory, syncFile } from './lib.mjs';

const FORMAT = 'comground-encrypted-backup-v1';
export function backupKey(value = process.env.COMGROUND_BACKUP_KEY) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) throw new Error('Backup operations require a separate 32-byte base64 COMGROUND_BACKUP_KEY.');
  return Buffer.from(value, 'base64');
}
const fingerprint = key => createHash('sha256').update(key).digest('hex');
async function checksum(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function removeOwnedPartial(path) { if (existsSync(path)) unlinkSync(path); }

export async function backupDatabase(config, destination, { key = backupKey(), allowUnprepared = false } = {}) {
  if (!isAbsolute(destination) || resolve(destination) === dirname(config.dbPath)) throw new Error('Use a new absolute backup directory.');
  if (fingerprint(key) === keyFingerprint(config)) throw new Error('Use a separate backup encryption key, distinct from the outbox key.');
  privateDirectory(dirname(destination)); privateFile(config.dbPath);
  const db = allowUnprepared ? new DatabaseSync(config.dbPath, { readOnly: true }) : readReadyDatabase(config, { full: true });
  let snapshot, staging;
  try {
    assertProductionBinding(db, { allowMigration: allowUnprepared }); assertNoDemoData(db); assertDatabaseIntegrity(db, true);
    // mkdir is exclusive: a previous backup is never overwritten, including incomplete backups.
    mkdirSync(destination, { mode: 0o700 });
    // The container mounts /tmp as tmpfs. Plaintext never enters the backup volume.
    staging = mkdtempSync(join(tmpdir(), 'comground-backup-'));
    snapshot = join(staging, 'snapshot.sqlite');
    const meta = { format: FORMAT, createdAt: new Date().toISOString(), schemaRevision: SCHEMA_REVISION, schemaFingerprint: schemaFingerprint(db), outboxKeyFingerprint: keyFingerprint(config), backupKeyFingerprint: fingerprint(key), buildId: buildId() };
    await backup(db, snapshot);
    const copy = new DatabaseSync(snapshot);
    try { copy.exec('PRAGMA journal_mode=DELETE;'); assertDatabaseIntegrity(copy, true); } finally { copy.close(); }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(meta)));
    const encrypted = join(destination, 'database.sqlite.enc');
    await pipeline(createReadStream(snapshot), cipher, createWriteStream(encrypted, { flags: 'wx', mode: 0o600 }));
    syncFile(encrypted);
    const manifest = { ...meta, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertextSha256: await checksum(encrypted) };
    // Completeness marker appears only after authenticated ciphertext has been flushed.
    writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    syncFile(join(destination, 'manifest.json')); syncDirectory(destination); syncDirectory(dirname(destination));
    return manifest;
  } finally { db.close(); if (snapshot) { removeOwnedPartial(snapshot); removeOwnedPartial(`${snapshot}-wal`); removeOwnedPartial(`${snapshot}-shm`); } if (staging) rmdirSync(staging); }
}

export async function restoreBackup(config, source, target, { key = backupKey() } = {}) {
  if (!isAbsolute(source) || !isAbsolute(target) || resolve(target) === resolve(config.dbPath)) throw new Error('Restore to a new absolute database path, never the configured live path.');
  privateDirectory(source); privateDirectory(dirname(target));
  if ([target, `${target}-wal`, `${target}-shm`].some(existsSync)) throw new Error('Restore target or SQLite sidecars already exist; choose a new path.');
  const manifestPath = join(source, 'manifest.json'), encrypted = join(source, 'database.sqlite.enc');
  privateFile(manifestPath); privateFile(encrypted);
  if (statSync(manifestPath).size > 16_384) throw new Error('Backup manifest is too large.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { iv, tag, ciphertextSha256, ...meta } = manifest;
  if (meta.format !== FORMAT || meta.schemaRevision !== SCHEMA_REVISION || !/^[a-f0-9]{64}$/.test(ciphertextSha256 ?? '') || !/^[A-Za-z0-9+/]{16}$/.test(iv ?? '') || !/^[A-Za-z0-9+/]{22}==$/.test(tag ?? '')) throw new Error('Unsupported or malformed encrypted backup.');
  if (meta.backupKeyFingerprint !== fingerprint(key) || meta.outboxKeyFingerprint !== keyFingerprint(config)) throw new Error('Backup or outbox key does not match this backup. Keep the original keys.');
  if (await checksum(encrypted) !== ciphertextSha256) throw new Error('Backup ciphertext checksum does not match.');
  const partial = `${target}.restoring-${randomUUID()}`;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(meta))); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    await pipeline(createReadStream(encrypted), decipher, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    const db = new DatabaseSync(partial);
    try {
      assertProductionBinding(db); assertRequiredSchema(db); assertNoDemoData(db); assertDatabaseIntegrity(db, true);
      if (schemaFingerprint(db) !== meta.schemaFingerprint) throw new Error('Restored schema differs from the authenticated snapshot.');
      db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;');
      try {
        db.exec("DELETE FROM deployment_meta WHERE key IN ('restore_data_reconciled_reference','restore_data_reconciled_at','restore_deletion_register_reviewed_through','restore_retention_policy','restore_reconciliation_reference','restore_reconciled_at')");
        db.prepare("INSERT INTO deployment_meta(key,value) VALUES('restore_quarantined','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
        db.prepare("INSERT INTO deployment_meta(key,value) VALUES('restore_backup_sha256',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(ciphertextSha256);
        db.prepare("INSERT INTO deployment_meta(key,value) VALUES('restore_snapshot_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(meta.createdAt);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
    syncFile(partial);
    // Hard-link publication is atomic and fails if the target was created meanwhile.
    linkSync(partial, target); syncDirectory(dirname(target));
    return { target, quarantined: true, schemaRevision: meta.schemaRevision };
  } finally { removeOwnedPartial(partial); removeOwnedPartial(`${partial}-wal`); removeOwnedPartial(`${partial}-shm`); }
}
