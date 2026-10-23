// The containment switch (P5 plan §11.1). Operator use only — the incident procedure says when to set and lift it.
//
//   pnpm --filter @alphakolect/api admin:containment -- --status
//   pnpm --filter @alphakolect/api admin:containment -- --merchant on|off --platform on|off --reason "<why>"
//
// Both flags are always given, so lifting one never lifts the other by accident. Needs DATABASE_MIGRATOR_URL (the
// migrator role: the API's own role cannot do this). Prints the flags only.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { readContainment, setContainment, type ContainmentState } from '../src/platform/containment.js';
import { createDb } from '../src/platform/db.js';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const USAGE =
  'Usage: admin:containment -- --status\n' +
  '       admin:containment -- --merchant on|off --platform on|off --reason "<why>"';

// pnpm passes the `--` separator through to the script; drop it, or every option would count as positional.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    status: { type: 'boolean', default: false },
    merchant: { type: 'string' },
    platform: { type: 'string' },
    reason: { type: 'string' },
  },
});
const flag = (value: string | undefined) => (value === 'on' ? true : value === 'off' ? false : undefined);
const merchant = flag(values.merchant);
const platform = flag(values.platform);
const changing =
  values.merchant !== undefined || values.platform !== undefined || values.reason !== undefined;
if (values.status === changing) fail(USAGE);
if (changing && (merchant === undefined || platform === undefined || !values.reason?.trim())) fail(USAGE);

const env = z
  .object({ DATABASE_MIGRATOR_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .safeParse(process.env);
// Names only: the value (which holds credentials) is never printed.
if (!env.success) fail('Invalid configuration: DATABASE_MIGRATOR_URL');

const stateLine = (s: ContainmentState) =>
  `merchant grants ${s.merchantGrantsSuspended ? 'SUSPENDED' : 'in effect'}, ` +
  `platform grants ${s.platformGrantsSuspended ? 'SUSPENDED' : 'in effect'}`;

const db = createDb(env.data!.DATABASE_MIGRATOR_URL);
try {
  if (values.status) {
    const state = await readContainment(db);
    process.stdout.write(`${stateLine(state)} (since ${state.updatedAt.toISOString()}).\n`);
  } else {
    const state = await setContainment({
      migrator: db,
      merchantGrantsSuspended: merchant!,
      platformGrantsSuspended: platform!,
      reason: values.reason!,
    });
    process.stdout.write(
      `Containment set and recorded: ${stateLine(state)}. It applies from the next request.\n`,
    );
  }
} catch (err) {
  // Database refusals carry safe messages; anything else is summarised.
  const message =
    err instanceof Error && 'code' in err && err.code === '23514' ? err.message : 'see the error name';
  fail(`Containment failed: ${message} (${err instanceof Error ? err.name : 'unknown'})`);
} finally {
  await db.close();
}
