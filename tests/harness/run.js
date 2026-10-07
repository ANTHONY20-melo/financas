// Roda os harnesses de fluxo em sequência e encerra com exit code agregado.
// Uso: node tests/harness/run.js   (ou: npm run test:harness)
const { spawnSync } = require('child_process');
const path = require('path');

const flows = ['flow2.js', 'flow3.js', 'flow4.js'];
let failed = 0;

for (const f of flows) {
  const file = path.join(__dirname, f);
  process.stdout.write(`\n=== ${f} ===\n`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    process.stdout.write(`[${f}] FALHOU (exit ${r.status})\n`);
  }
}

process.stdout.write(`\n${failed === 0 ? 'TODOS OS HARNESSES PASSARAM' : `${failed} harness(es) FALHARAM`}\n`);
process.exit(failed ? 1 : 0);