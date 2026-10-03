// Generate or verify packages/contracts/openapi/v1.json.
//   pnpm --filter @alphakolect/contracts openapi:generate   write the file
//   pnpm --filter @alphakolect/contracts openapi:check      fail if the committed file is stale
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OPENAPI_PATH, renderDocument } from './openapi-document.js';

const file = fileURLToPath(OPENAPI_PATH);
const expected = renderDocument();

if (process.argv.includes('--check')) {
  // Normalise line endings: a Windows checkout may be CRLF (core.autocrlf); git stores LF.
  const committed = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  if (committed !== expected) {
    process.stderr.write(
      'openapi/v1.json is out of date with the contracts.\n' +
        'Run: pnpm --filter @alphakolect/contracts openapi:generate, then commit the result.\n',
    );
    process.exit(1);
  }
  process.stdout.write('openapi/v1.json is up to date.\n');
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, expected);
  process.stdout.write(`Wrote ${path.relative(process.cwd(), file)}\n`);
}
