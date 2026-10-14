import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Read only files whose resolved targets remain in the configured migration root. */
export async function readMigrationFile(migrationsDir: string, filePath: string): Promise<string> {
  const root = await realpath(migrationsDir);
  const resolved = await realpath(filePath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    // Do not disclose the external target's path in reports.
    throw new Error('File resolves outside the configured migrations directory.');
  }
  // O_NONBLOCK prevents a file replaced with a FIFO after realpath from
  // hanging inspection. fstat rejects FIFOs, devices, sockets, and dirs.
  // O_NOFOLLOW prevents a final-component symlink swap after containment.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(resolved, flags);
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error('Migration path is not a regular file.');
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}
