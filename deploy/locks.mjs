import { closeSync, existsSync, fstatSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { privateDirectory, syncDirectory } from './lib.mjs';

// A shared local filesystem is the coordination boundary, not container PIDs.
// Never infer staleness from a PID/time or steal a lock after an arbitrary timeout.
function exclusiveFile(path, operation) {
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('An operational lock already exists. Check running services and jobs before manual stale-lock recovery.'); throw error; }
  try { writeFileSync(fd, JSON.stringify({ operation, createdAt: new Date().toISOString() })); }
  catch (error) { closeSync(fd); unlinkSync(path); throw error; }
  const owned = fstatSync(fd); let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      // A replacement lock is never removed by the old owner.
      const current = lstatSync(path);
      if (current.dev !== owned.dev || current.ino !== owned.ino) throw new Error('Operational lock ownership changed. Preserve the lock and investigate.');
      unlinkSync(path); syncDirectory(dirname(path));
    } finally { closeSync(fd); }
  };
}

export function assertNoMaintenance(config) {
  if (existsSync(`${config.dbPath}.maintenance-lock`)) throw new Error('Database maintenance is in progress.');
}

/** All shipped mutation commands take this non-waiting lock before opening SQLite. */
export async function withOperationLock(config, operation, action, { stopped = false } = {}) {
  privateDirectory(dirname(config.dbPath));
  const release = exclusiveFile(`${config.dbPath}.operation-lock`, operation);
  let releaseMaintenance;
  try {
    assertNoMaintenance(config);
    if (stopped) {
      if (existsSync(`${config.dbPath}.service-lock`)) throw new Error('The managed application is running or its service lock needs recovery. Stop it before offline maintenance.');
      releaseMaintenance = exclusiveFile(`${config.dbPath}.maintenance-lock`, operation);
    }
    return await action();
  } finally { try { releaseMaintenance?.(); } finally { release(); } }
}

/** Called only while holding the operation lock, retained until the app child exits. */
export function acquireServiceLease(config) {
  assertNoMaintenance(config);
  return exclusiveFile(`${config.dbPath}.service-lock`, 'application');
}
