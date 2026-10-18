import { readFileSync, statSync } from 'node:fs';
import { evaluateExpansionReview } from '../packages/domain/expansion-readiness.ts';

// Offline only. Prints bounded validation results, never record contents or credentials.
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--record')) throw new Error('Use --record PATH or no arguments for the checked-in review.');
  const path = args[1] ?? new URL('../deploy/expansion-readiness.json', import.meta.url);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 32_768) throw new Error('Use a regular review file within 32 KiB.');
  const result = evaluateExpansionReview(JSON.parse(readFileSync(path, 'utf8')));
  console.log(JSON.stringify({ decision: result.decision, version: result.record?.version ?? null, blockers: result.blockers, externalEvidenceVerified: false, deploymentAuthorized: false }));
  process.exitCode = result.decision === 'GO' ? 0 : 1;
} catch { console.error(JSON.stringify({ decision: 'NO_GO', error: 'The local expansion review could not be validated.' })); process.exitCode = 1; }
