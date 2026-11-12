/** @jest-environment node */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Light-gray text on light surfaces comes back every time a builder copies an old class list. This fails with the file list;
// fix with `node scripts/contrast-sweep.mjs` (it is idempotent and skips dark surfaces, disabled states, icons and PDFs).
test('no light-gray text classes left on light surfaces', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'contrast-sweep.mjs'), '--check'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${r.stderr}${r.stdout}`)
}, 60_000)
