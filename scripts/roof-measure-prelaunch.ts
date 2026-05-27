/**
 * Launch gate for roof measure tool. Exit 0 = all automated checks passed.
 * Usage: npm run roof-measure:prelaunch
 */
import { execSync } from 'node:child_process'

const steps: Array<{ name: string; cmd: string }> = [
  { name: 'TypeScript', cmd: 'npx tsc --noEmit' },
  {
    name: 'Roof measure unit tests',
    cmd: 'npm test -- --testPathPattern="roof-measure|roof-edge|roof-face|aurora-roof-summary-mapper|hip-ridge-cap" --passWithNoTests',
  },
  { name: 'Edge classify golden', cmd: 'npm run roof-measure:classify' },
]

let failed = 0
for (const step of steps) {
  process.stdout.write(`▶ ${step.name}… `)
  try {
    execSync(step.cmd, { stdio: 'pipe', encoding: 'utf8' })
    console.log('OK')
  } catch (e) {
    console.log('FAIL')
    const err = e as { stdout?: string; stderr?: string }
    if (err.stderr) console.error(err.stderr.slice(0, 2000))
    if (err.stdout) console.error(err.stdout.slice(0, 2000))
    failed++
  }
}

console.log('')
if (failed > 0) {
  console.error(`${failed} prelaunch check(s) failed.`)
  process.exit(1)
}
console.log('All automated roof-measure prelaunch checks passed.')
console.log('Manual: complete docs/roof-measure-launch-checklist.md in browser before production.')
