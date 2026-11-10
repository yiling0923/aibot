// Prepares the folder for a new front end build.
// Normally that is web/dist: the old build is cleared first. On Windows this can fail (a running server, antivirus, or the folder
// belongs to another Windows user because it was once built from an Administrator window). Then the build goes into a new folder
// (web/dist-<number>) and web/.outdir remembers its name, so both the build and the server use it. Nothing for the person to do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const dist = path.join(web, 'dist'), marker = path.join(web, '.outdir');

const writable = (dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `.w${process.pid}`); fs.writeFileSync(f, 'x'); fs.rmSync(f); return true; } catch { return false; }
};
const tryRemove = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return true; } catch { return false; } };

tryRemove(dist);
// Something may be left that cannot be deleted (a file Windows will not let this person touch). The new build would then fail on
// the file with the same name, so a folder that is not empty after clearing is not usable.
const leftOver = () => { try { return fs.existsSync(dist) && fs.readdirSync(dist).length > 0; } catch { return true; } };
if (!leftOver() && writable(dist) && writable(path.join(dist, 'assets'))) {
  tryRemove(marker);                                                                      // the normal folder works again
  for (const f of fs.readdirSync(web)) if (/^dist-\d+$/.test(f)) tryRemove(path.join(web, f));   // leftovers of an earlier fallback
} else {
  const name = `dist-${Date.now()}`;
  fs.writeFileSync(marker, name);
  console.warn(`web/dist cannot be written (it may belong to another Windows user). Building into web/${name} instead. Nothing for you to do.`);
  for (const f of fs.readdirSync(web)) if (/^dist-\d+$/.test(f) && f !== name) tryRemove(path.join(web, f));
}
