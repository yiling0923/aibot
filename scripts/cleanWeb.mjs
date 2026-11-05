// Clears the old front end build before a new one. On Windows a file can be locked (a running server, antivirus, an open window);
// then we carry on instead of stopping: the new build uses new file names, so old files left behind do no harm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
try {
  fs.rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (e) {
  console.warn(`Could not clear ${dist} (${e.code}). Carrying on; close other windows that use it to clean it up.`);
}
