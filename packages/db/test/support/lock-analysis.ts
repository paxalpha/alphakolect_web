import type pg from 'pg';

// The lock-order analysis behind the lock-order guard (P5 plan §7.2: L1–L6, the category order, the planned
// footprints, "What the guard can analyse, and failing closed outside it"). It reads function bodies as the catalog
// stores them (pg_get_functiondef) and computes, for every function in scope, its **waiting footprint**: explicit
// locking clauses (NOWAIT and SKIP LOCKED never wait), the implicit row locks of UPDATE and DELETE, inserts under a
// contested unique key, the helper calls (one sorted acquisition each) and — recursively — the footprint of every
// function it calls and of every trigger its writes fire. The closed set of constructs it understands is: LANGUAGE sql
// and plpgsql with static SQL, schema-qualified calls, control flow. Anything else is a finding, never skipped.
//
// Analysis rules (stated so a reviewer can check them):
// - Order is textual: every branch counts, in the order written. A loop body counts twice (a second iteration).
// - A row write (UPDATE, DELETE, INSERT … ON CONFLICT DO UPDATE) or a lock on a table whose rows this transaction has
//   already locked FOR NO KEY UPDATE is a write to held rows and waits for nothing new. This is a table-level
//   approximation: the planned footprints name every row they hold, and the two-connection tests are the adversarial
//   evidence that the rows written are the rows held.
// - A direct locking statement must pin one row by its primary key or a single-column unique key ("row rule");
//   several rows of a category are locked by one helper call (L5).
// - Foreign-key checks are not counted (L2): they never wait while L1 holds, which the analysis verifies.

/** The global category order (§7.2 "Categories (global order)"). */
export const CATEGORY: Readonly<Record<string, number>> = {
  'audit.purge_reservation': 0,
  // the containment switch's one row (§11.1): operator-only, like the purge reservation; no request path locks it
  'util.authorization_containment': 0,
  'identity.platform_memberships': 1,
  'tenancy.merchants': 2,
  'tenancy.merchant_memberships': 3,
  'tenancy.invitations': 4,
  'identity.one_time_tokens': 5,
  'identity.membership_selection_challenges': 5,
  'identity.mfa_challenges': 5,
  'identity.refresh_tokens': 5,
  'identity.identities': 6,
  'identity.totp_credentials': 6,
  'identity.recovery_codes': 6,
  'tenancy.roles': 7,
  'tenancy.branches': 8,
  'tenancy.role_permissions': 9,
  'identity.platform_membership_grants': 9,
  'identity.sessions': 10,
};

/** The lock helpers (migration 20261013000900): one sorted acquisition of a category per call. */
export const HELPERS: Readonly<Record<string, string>> = {
  'identity.lock_platform_memberships': 'identity.platform_memberships',
  'tenancy.lock_merchants': 'tenancy.merchants',
  'tenancy.lock_memberships': 'tenancy.merchant_memberships',
  'tenancy.lock_invitations': 'tenancy.invitations',
  'identity.lock_one_time_tokens': 'identity.one_time_tokens',
  'tenancy.lock_roles': 'tenancy.roles',
  'tenancy.lock_branches': 'tenancy.branches',
};

/**
 * How each function is checked. Every function of the analysed schemas must be classified: an unclassified one fails
 * the guard (it is never assumed safe).
 */
export type FnClass =
  /** A privileged operation of the planned-footprint table: its token sequence must equal `planned` exactly. */
  | { class: 'operation'; planned: string[]; writes: string[] }
  /** An identity flow of the table ("identity flows: …"): every category it waits for is one of `categories`. */
  | { class: 'flow'; categories: number[]; writes: string[] }
  /** Any other identity function: the category order and L1–L6 apply. */
  | { class: 'identity'; writes: string[] }
  /** A lock helper: exactly one FOR SHARE and one FOR NO KEY UPDATE of its table, one row per statement, in a loop. */
  | { class: 'helper' }
  /** A `…_locked` inner function (L6): waits for nothing, never executable by the app. */
  | { class: 'locked'; writes: string[] }
  /** A nested re-check (tenancy.assert_authority): NOWAIT locks only, no writes, never executable by the app. */
  | { class: 'nested-check' }
  /** A lock-free reader: no lock, no write, anywhere in its footprint. */
  | { class: 'reader' }
  /** A trigger function: locks and writes nothing (L4). */
  | { class: 'trigger' }
  /** A request-path function called in its own statement, never inside a transaction (the rate limiter). */
  | { class: 'standalone'; writes: string[] }
  /** A function the planned footprints replace: its existence is a finding. */
  | { class: 'retired'; replacedBy: string };

export type FindingKind = 'L1' | 'order' | 'footprint' | 'L3' | 'L4' | 'L6' | 'fail-closed' | 'schema';
export type Finding = { kind: FindingKind; fn: string; detail: string };
/** The identity of a finding for the reconciliation lists: kind and function (L1: and the clause's body line). */
export const findingKey = (f: Finding) =>
  `${f.kind} ${f.fn}${f.kind === 'L1' ? ` ${f.detail.split(' ')[0]}` : ''}`;

// ── catalog ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FnRow = {
  schema: string;
  name: string;
  args: string;
  lang: string;
  definer: boolean;
  executors: string[];
  def: string;
};
type TriggerRow = { table: string; name: string; fn: string; events: string[] };
type IndexRow = { table: string; name: string; columns: string[]; expression: boolean; partial: boolean };

export type Catalog = {
  functions: FnRow[];
  triggers: TriggerRow[];
  uniqueIndexes: IndexRow[];
  /** Columns with a uuid_v7() default (fresh values: never contested). */
  freshColumns: Set<string>;
  /** Tables some foreign key references. */
  referenced: Set<string>;
  /** Function names of pg_catalog (built-ins), for the unrecognised-call check. */
  builtins: Set<string>;
};

export const FUNCTION_QUERY = `
  SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
         l.lanname AS lang, p.prosecdef AS definer,
         coalesce((SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r
                    WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')
                      AND r.rolname IN ('alphakolect_app', 'alphakolect_readonly')), '{}'::text[]) AS executors,
         pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = ANY ($1) AND p.prokind = 'f'
   ORDER BY 1, 2, 3`;

/** Reads what the analysis needs from the catalog: the functions of `schemas`, and the tables of every schema. */
export async function loadCatalog(client: pg.Client, schemas: string[]): Promise<Catalog> {
  const functions = (await client.query<FnRow>(FUNCTION_QUERY, [schemas])).rows;
  const triggers = (
    await client.query<TriggerRow>(`
      SELECT tn.nspname || '.' || c.relname AS table, t.tgname AS name, fn.nspname || '.' || f.proname AS fn,
             array_remove(ARRAY[
               CASE WHEN t.tgtype & 4 <> 0 THEN 'insert' END,
               CASE WHEN t.tgtype & 8 <> 0 THEN 'delete' END,
               CASE WHEN t.tgtype & 16 <> 0 THEN 'update' END,
               CASE WHEN t.tgtype & 32 <> 0 THEN 'truncate' END], NULL)::text[] AS events
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace tn ON tn.oid = c.relnamespace
        JOIN pg_proc f ON f.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = f.pronamespace
       WHERE NOT t.tgisinternal`)
  ).rows;
  const uniqueIndexes = (
    await client.query<IndexRow>(`
      SELECT n.nspname || '.' || c.relname AS table, ic.relname AS name,
             coalesce((SELECT array_agg(a.attname::text ORDER BY k.ord)
                         FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
                        WHERE k.attnum > 0), '{}'::text[]) AS columns,
             (0 = ANY (i.indkey::int2[])) AS expression, (i.indpred IS NOT NULL) AS partial
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE i.indisunique AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`)
  ).rows;
  const freshColumns = new Set(
    (
      await client.query<{ col: string }>(`
        SELECT n.nspname || '.' || c.relname || '.' || a.attname AS col
          FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE pg_get_expr(d.adbin, d.adrelid) = 'util.uuid_v7()'`)
    ).rows.map((r) => r.col),
  );
  const referenced = new Set(
    (
      await client.query<{ t: string }>(`
        SELECT DISTINCT n.nspname || '.' || c.relname AS t
          FROM pg_constraint k JOIN pg_class c ON c.oid = k.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE k.contype = 'f'`)
    ).rows.map((r) => r.t),
  );
  const builtins = new Set(
    (
      await client.query<{ name: string }>(`
        SELECT DISTINCT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'pg_catalog'`)
    ).rows.map((r) => r.name),
  );
  return { functions, triggers, uniqueIndexes, freshColumns, referenced, builtins };
}

/** A unique index is contested unless one of its columns holds fresh values (L3): a uuid_v7() id or a *_hash. */
export function contestedIndexes(catalog: Catalog): IndexRow[] {
  return catalog.uniqueIndexes.filter(
    (ix) =>
      ix.columns.length > 0 &&
      !ix.columns.some((c) => catalog.freshColumns.has(`${ix.table}.${c}`) || /(^|_)hash$/.test(c)),
  );
}

// ── parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Lock = 'update' | 'no key update' | 'share' | 'key share';
type Own =
  | { t: 'lock'; table: string; mode: Lock; wait: boolean; line: number; pinned: boolean; actor: boolean }
  | { t: 'update'; table: string; line: number; keyColumns: string[]; upsert: boolean }
  | { t: 'delete'; table: string; line: number }
  | { t: 'insert'; table: string; line: number }
  | { t: 'call'; target: string; line: number; args: string[]; actor: boolean };

type Parsed = { key: string; events: Own[]; problems: string[] };

/** SQL and PL/pgSQL words that may precede "(" without being a function call. */
const KEYWORDS = new Set(
  (
    'all and any array as asc between by case cast check coalesce conflict desc distinct do else elsif end exists ' +
    'filter from greatest grouping if ilike in into is join least like lateral limit not nullif on or order over ' +
    'partition perform raise return returning returns row select set similar some table then union using values ' +
    'when where while with within query loop foreach exit continue strict ' +
    'varchar char character numeric decimal interval timestamp timestamptz time bit varbit extract position ' +
    'overlay substring trim treat'
  ).split(' '),
);

/** Comments blanked; string contents blanked in `text` and kept in `raw`; quoted identifiers unquoted; lower case. */
function normalize(body: string): { text: string; raw: string } {
  let text = '';
  let raw = '';
  const put = (t: string, r = t) => {
    text += t;
    raw += r;
  };
  for (let i = 0; i < body.length;) {
    const c = body[i]!;
    const two = body.slice(i, i + 2);
    if (two === '--') {
      while (i < body.length && body[i] !== '\n') {
        put(' ');
        i++;
      }
    } else if (two === '/*') {
      let depth = 0;
      do {
        if (body.slice(i, i + 2) === '/*') {
          depth++;
          put('  ');
          i += 2;
        } else if (body.slice(i, i + 2) === '*/') {
          depth--;
          put('  ');
          i += 2;
        } else {
          put(body[i] === '\n' ? '\n' : ' ');
          i++;
        }
      } while (depth > 0 && i < body.length);
    } else if (c === "'") {
      const escaped = /[eE]/.test(body[i - 1] ?? '') && !/[a-z0-9_]/i.test(body[i - 2] ?? '');
      put("'");
      i++;
      while (i < body.length) {
        if (escaped && body[i] === '\\') {
          put('  ', body.slice(i, i + 2));
          i += 2;
        } else if (body[i] === "'" && body[i + 1] === "'") {
          put('  ', "''");
          i += 2;
        } else if (body[i] === "'") {
          break;
        } else {
          put(body[i] === '\n' ? '\n' : ' ', body[i]);
          i++;
        }
      }
      put("'");
      i++;
    } else if (c === '$' && /^\$[a-z_]*\$/i.test(body.slice(i))) {
      const tag = body.slice(i).match(/^\$[a-z_]*\$/i)![0];
      const end = body.indexOf(tag, i + tag.length);
      const stop = end < 0 ? body.length : end + tag.length;
      const chunk = body.slice(i, stop);
      put(chunk.replace(/[^\n]/g, ' '), chunk);
      i = stop;
    } else if (c === '"') {
      const end = body.indexOf('"', i + 1);
      const ident = body.slice(i + 1, end).toLowerCase();
      put(ident);
      i = end + 1;
    } else {
      put(c.toLowerCase(), c.toLowerCase());
      i++;
    }
  }
  return { text, raw };
}

/** Paren depth at every position (the depth *inside* a paren includes it). */
function depths(text: string): Int32Array {
  const d = new Int32Array(text.length + 1);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    d[i] = depth;
    if (text[i] === ')') depth--;
  }
  d[text.length] = depth;
  return d;
}

const lineAt = (text: string, pos: number) => text.slice(0, pos).split('\n').length;

/** Where the statement or parenthesised expression containing `start` ends: a ';' at its depth, or a ')' below it. */
function clauseEnd(text: string, d: Int32Array, start: number, depth: number): number {
  for (let i = start; i < text.length; i++) {
    if (d[i]! < depth) return i;
    if (text[i] === ';' && d[i] === depth) return i;
  }
  return text.length;
}

function topLevelSplit(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0) {
      const m = s.slice(i).match(sep);
      if (m && m.index === 0) {
        parts.push(s.slice(last, i));
        i += m[0].length - 1;
        last = i + 1;
      }
    }
  }
  parts.push(s.slice(last));
  return parts;
}

/** The tables of the FROM list that a locking clause at `forPos` applies to, with how they are filtered. */
function lockedTables(text: string, d: Int32Array, forPos: number, of: string[] | null) {
  const depth = d[forPos]!;
  // The nearest FROM before the clause at the same depth, inside the same statement and the same parentheses.
  let from = -1;
  for (let i = forPos - 1; i >= 0; i--) {
    if (d[i]! < depth || (text[i] === ';' && d[i] === depth)) break;
    if (d[i] === depth && /\bfrom\b/.test(text.slice(i, i + 5)) && /[^a-z0-9_]/.test(text[i - 1] ?? ' ')) {
      if (!/\bdistinct\s+$/.test(text.slice(Math.max(0, i - 12), i))) {
        from = i;
        break;
      }
    }
  }
  if (from < 0) return null;
  const segment = text.slice(from + 4, forPos);
  const cut = segment.search(/\b(where|group\s+by|having|order\s+by|limit|offset|window)\b/);
  const fromList = cut >= 0 ? segment.slice(0, cut) : segment;
  const where = cut >= 0 && /^where\b/.test(segment.slice(cut)) ? segment.slice(cut + 5) : '';
  const items = topLevelSplit(
    fromList,
    /^(,|(left\s+|right\s+|full\s+|inner\s+|cross\s+)?(outer\s+)?join\b)/,
  );
  const tables: { table: string; alias: string }[] = [];
  for (const item of items) {
    const head = item.replace(/\bon\b[\s\S]*$/, '').trim();
    const m = head.match(
      /^(?:lateral\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*(\()?\s*(?:as\s+)?([a-z_][a-z0-9_]*)?/,
    );
    if (!m || m[3]) continue; // a function scan or a subquery: not a locked table
    tables.push({ table: `${m[1]}.${m[2]}`, alias: m[4] ?? m[2]! });
  }
  const chosen = of
    ? tables.filter((t) => of.includes(t.alias) || of.includes(t.table.split('.')[1]!))
    : tables;
  return { tables: chosen, where, all: tables };
}

/** Does the WHERE clause pin one row of `alias` by equality on one of `keys` (an AND-ed conjunct)? */
function pinsOneRow(where: string, alias: string, keys: string[], single: boolean): boolean {
  return topLevelSplit(where, /^\band\b/).some((conj) => {
    const c = conj.trim().replace(/^\(\s*/, '');
    return keys.some(
      (k) =>
        new RegExp(`^(${alias}\\.)${single ? '?' : ''}${k}\\s*=[^=]`).test(c) ||
        new RegExp(`=\\s*(${alias}\\.)${single ? '?' : ''}${k}\\s*$`).test(c),
    );
  });
}

function balancedArgs(text: string, open: number): { args: string[]; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        const inner = text.slice(open + 1, i);
        return { args: inner.trim() === '' ? [] : topLevelSplit(inner, /^,/).map((a) => a.trim()), end: i };
      }
    }
  }
  return { args: [], end: text.length };
}

/** Parses one function definition into its own events, in textual order, with loop bodies counted twice. */
type ParseContext = {
  known: Set<string>;
  appNames: Set<string>;
  schemas: Set<string>;
  builtins: Set<string>;
  /** Per table: the columns that identify one row (the primary key and single-column unique keys). */
  rowKeys: Map<string, string[]>;
  /** Per table: every column of a unique index a foreign key could use (an UPDATE of one is a key update, L1). */
  keyColumns: Map<string, string[]>;
};

function parse(f: FnRow, ctx: ParseContext): Parsed {
  const key = `${f.schema}.${f.name}`;
  const problems: string[] = [];
  if (f.lang !== 'sql' && f.lang !== 'plpgsql') problems.push(`language ${f.lang} cannot be analysed`);
  const startTag = f.def.indexOf('$function$');
  const endTag = f.def.lastIndexOf('$function$');
  const body = startTag >= 0 && endTag > startTag ? f.def.slice(startTag + 10, endTag) : '';
  const { text, raw } = normalize(body);
  const d = depths(text);
  const found: (Own & { pos: number })[] = [];
  const actors = actorReferences(text);
  const mentionsActor = (s: string) =>
    actors.some((a) => new RegExp(`(^|[^a-z0-9_.])${a.replace(/\./g, '\\.')}(?![a-z0-9_])`).test(s));

  for (const m of text.matchAll(
    /\bfor\s+(no\s+key\s+update|update|key\s+share|share)\b(\s+of\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*))?(\s+(nowait|skip\s+locked))?/g,
  )) {
    const mode = m[1]!.replace(/\s+/g, ' ') as Lock;
    const of = m[3] ? m[3].split(',').map((s) => s.trim()) : null;
    const located = lockedTables(text, d, m.index!, of);
    if (!located || located.tables.length === 0) {
      problems.push(`line ${lineAt(text, m.index!)}: a locking clause whose tables cannot be resolved`);
      continue;
    }
    for (const { table, alias } of located.tables) {
      const single = located.all.length === 1;
      found.push({
        t: 'lock',
        table,
        mode,
        wait: !m[5],
        line: lineAt(text, m.index!),
        pinned: pinsOneRow(located.where, alias, ctx.rowKeys.get(table) ?? ['id'], single),
        actor: mentionsActor(located.where),
        pos: m.index!,
      });
    }
  }
  for (const m of text.matchAll(/\bupdate\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    const before = text.slice(Math.max(0, m.index! - 8), m.index!);
    if (/(for|key|do)\s+$/.test(before)) continue;
    const table = `${m[1]}.${m[2]}`;
    const setAt = text.indexOf(' set ', m.index!);
    const end = clauseEnd(text, d, setAt, d[m.index!]!);
    const setClause = text.slice(setAt + 5, end).split(/\b(where|from|returning)\b/)[0]!;
    const columns = topLevelSplit(setClause, /^,/).map((a) =>
      a
        .split('=')[0]!
        .trim()
        .replace(/^[a-z_]+\./, ''),
    );
    const keys = ctx.keyColumns.get(table) ?? [];
    found.push({
      t: 'update',
      table,
      line: lineAt(text, m.index!),
      keyColumns: columns.filter((c) => keys.includes(c)),
      upsert: false,
      pos: m.index!,
    });
  }
  for (const m of text.matchAll(/\bdelete\s+from\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    found.push({ t: 'delete', table: `${m[1]}.${m[2]}`, line: lineAt(text, m.index!), pos: m.index! });
  }
  for (const m of text.matchAll(/\binsert\s+into\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    const table = `${m[1]}.${m[2]}`;
    const end = clauseEnd(text, d, m.index!, d[m.index!]!);
    const statement = text.slice(m.index!, end);
    const conflict = statement.match(/\bon\s+conflict\b[\s\S]*?\bdo\s+(nothing|update)\b/);
    if (conflict?.[1] === 'update') {
      found.push({
        t: 'update',
        table,
        line: lineAt(text, m.index!),
        keyColumns: [],
        upsert: true,
        pos: m.index!,
      });
    } else {
      found.push({ t: 'insert', table, line: lineAt(text, m.index!), pos: m.index! });
    }
  }
  // Lookbehinds, not a consumed preceding character: a call directly inside another call's parenthesis is still found.
  for (const m of text.matchAll(/(?<![a-z0-9_.$])()([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/g)) {
    const at = m.index! + m[1]!.length;
    if (/\binto\s+$/.test(text.slice(Math.max(0, at - 8), at))) continue; // INSERT INTO t (columns)
    if (m[2] === 'pg_catalog') continue; // a qualified built-in
    if (!ctx.schemas.has(m[2]!)) {
      problems.push(`line ${lineAt(text, at)}: call of ${m[2]}.${m[3]}, outside the analysed schemas`);
      continue;
    }
    const target = `${m[2]}.${m[3]}`;
    if (!ctx.known.has(target)) {
      problems.push(
        `line ${lineAt(text, at)}: call of ${target}, which is not a function of the analysed schemas`,
      );
      continue;
    }
    const open = text.indexOf('(', at);
    const { args } = balancedArgs(raw, open);
    found.push({
      t: 'call',
      target,
      line: lineAt(text, at),
      args,
      actor: mentionsActor(args.join(' ')),
      pos: at,
    });
  }
  for (const m of text.matchAll(/(?<![a-z0-9_.$%])()([a-z_][a-z0-9_]*)\s*\(/g)) {
    const name = m[2]!;
    if (KEYWORDS.has(name)) continue;
    const line = lineAt(text, m.index! + m[1]!.length);
    if (ctx.appNames.has(name)) problems.push(`line ${line}: unqualified call of ${name}`);
    else if (!ctx.builtins.has(name)) problems.push(`line ${line}: unrecognised call ${name}(…)`);
  }
  for (const [re, what] of [
    [/\bexecute\b/, 'dynamic SQL (EXECUTE)'],
    [/\block\s+(table\s+)?[a-z_]+\.[a-z_]/, 'LOCK TABLE'],
    [/\bpg_(try_)?advisory/, 'an advisory lock'],
    [/(^|;|\bbegin\b|\bthen\b|\belse\b|\bloop\b)\s*call\s+/, 'CALL'],
    [/(^|;)\s*copy\s/, 'COPY'],
  ] as const) {
    const m = text.match(re);
    if (m) problems.push(`line ${lineAt(text, m.index!)}: ${what}`);
  }

  // Loop bodies count twice: a second iteration follows the first.
  found.sort((a, b) => a.pos - b.pos);
  const loops: { start: number; end: number }[] = [];
  const stack: number[] = [];
  for (const m of text.matchAll(/\bend\s+loop\b|\bloop\b/g)) {
    if (m[0].startsWith('end')) {
      const start = stack.pop();
      if (start !== undefined) loops.push({ start, end: m.index! });
    } else stack.push(m.index! + 4);
  }
  let events: (Own & { pos: number })[] = found;
  for (const loop of loops.sort((a, b) => a.end - b.end)) {
    const inside = events.filter((e) => e.pos > loop.start && e.pos < loop.end);
    if (inside.length === 0) continue;
    const at = events.findIndex((e) => e.pos >= loop.end);
    const copies = inside.map((e) => ({ ...e, pos: loop.end }));
    events = at < 0 ? [...events, ...copies] : [...events.slice(0, at), ...copies, ...events.slice(at)];
  }
  return { key, events: events.map(({ pos: _pos, ...e }) => e as Own), problems };
}

// ── analysis ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Step =
  | {
      t: 'wait';
      category: number;
      mode: string;
      table: string;
      via: string;
      line: number;
      pinned: boolean;
      helper: boolean;
      actor: boolean;
    }
  | { t: 'insert'; category: number; table: string; via: string; line: number }
  | { t: 'nowait'; table: string; via: string; line: number; mode: 'S' | 'NKU' }
  /** Every row write, waiting or not — for the approved-writes check (R22). */
  | { t: 'write'; table: string; via: string; line: number };

export type Analysis = {
  findings: Finding[];
  footprints: Map<string, string[]>;
  /** Every table a function in scope inserts into, updates or deletes from (the schema-level check's scope). */
  writtenTables: Set<string>;
  /** Per function: every table it writes, directly or through any call or trigger, and where (R22). */
  reachableWrites: Map<string, { table: string; via: string }[]>;
};

/**
 * Analyses every function of `catalog.functions` (and any function they call) against its class. `classes` must
 * classify every one of them.
 */
export function analyse(
  catalog: Catalog,
  classes: Readonly<Record<string, FnClass>>,
  schemas: string[],
): Analysis {
  const findings: Finding[] = [];
  const add = (kind: FindingKind, fn: string, detail: string) => findings.push({ kind, fn, detail });
  const byKey = new Map<string, FnRow[]>();
  for (const f of catalog.functions)
    byKey.set(`${f.schema}.${f.name}`, [...(byKey.get(`${f.schema}.${f.name}`) ?? []), f]);
  const rowKeys = new Map<string, string[]>();
  for (const ix of catalog.uniqueIndexes) {
    if (ix.expression || ix.partial || ix.columns.length !== 1) continue;
    rowKeys.set(ix.table, [...(rowKeys.get(ix.table) ?? []), ix.columns[0]!]);
  }
  const keyColumns = new Map<string, string[]>();
  for (const ix of catalog.uniqueIndexes) {
    if (ix.expression || ix.partial) continue;
    keyColumns.set(ix.table, [...new Set([...(keyColumns.get(ix.table) ?? []), ...ix.columns])]);
  }
  const contested = new Set(contestedIndexes(catalog).map((ix) => ix.table));
  const ctx: ParseContext = {
    known: new Set(byKey.keys()),
    appNames: new Set([...byKey.keys()].map((k) => k.split('.')[1]!)),
    schemas: new Set(schemas),
    builtins: catalog.builtins,
    rowKeys,
    keyColumns,
  };
  const parsed = new Map<string, Parsed>();
  for (const [key, overloads] of byKey) {
    const merged: Parsed = { key, events: [], problems: [] };
    for (const f of overloads) {
      const p = parse(f, ctx);
      merged.events.push(...p.events);
      merged.problems.push(...p.problems);
    }
    parsed.set(key, merged);
  }
  const classOf = (key: string): FnClass | undefined => classes[key];

  // Flattened steps of a function: its own events with every call and every fired trigger expanded.
  const memo = new Map<string, Step[]>();
  function steps(key: string, path: string[]): Step[] {
    if (memo.has(key)) return memo.get(key)!;
    if (path.includes(key)) {
      add('fail-closed', key, `recursive call through ${path.join(' → ')}`);
      return [];
    }
    const out: Step[] = [];
    const p = parsed.get(key);
    if (!p) return out;
    const via = key;
    for (const e of p.events) {
      if (e.t === 'lock') {
        const category = CATEGORY[e.table];
        if (!e.wait)
          out.push({
            t: 'nowait',
            table: e.table,
            via,
            line: e.line,
            mode: e.mode === 'share' || e.mode === 'key share' ? 'S' : 'NKU',
          });
        else
          out.push({
            t: 'wait',
            category: category ?? -1,
            mode: e.mode === 'share' || e.mode === 'key share' ? 'S' : 'NKU',
            table: e.table,
            via,
            line: e.line,
            pinned: e.pinned,
            helper: false,
            actor: e.actor,
          });
      } else if (e.t === 'update' || e.t === 'delete') {
        const category = CATEGORY[e.table];
        out.push({ t: 'write', table: e.table, via, line: e.line });
        out.push({
          t: 'wait',
          category: category ?? -1,
          mode: 'W',
          table: e.table,
          via,
          line: e.line,
          pinned: true,
          helper: false,
          actor: false,
        });
        out.push(
          ...triggerSteps(e.table, e.t === 'delete' ? 'delete' : e.upsert ? 'insert' : 'update', [
            ...path,
            key,
          ]),
        );
      } else if (e.t === 'insert') {
        out.push({ t: 'write', table: e.table, via, line: e.line });
        if (contested.has(e.table)) {
          const category = CATEGORY[e.table];
          out.push({ t: 'insert', category: category ?? -1, table: e.table, via, line: e.line });
        }
        out.push(...triggerSteps(e.table, 'insert', [...path, key]));
      } else {
        const target = e.target;
        const cls = classOf(target);
        if (HELPERS[target]) {
          const table = HELPERS[target]!;
          const empty = (a: string | undefined) =>
            !a || /^(null|'\{\}'|array\[\])(::uuid\[\])?$/.test(a.replace(/\s+/g, ''));
          const modes = [...(empty(e.args[0]) ? [] : ['S']), ...(empty(e.args[1]) ? [] : ['NKU'])];
          out.push({
            t: 'wait',
            category: CATEGORY[table]!,
            mode: modes.join('+') || 'none',
            table,
            via,
            line: e.line,
            pinned: true,
            helper: true,
            actor: e.actor,
          });
        } else if (cls?.class === 'reader') {
          continue; // lock-free, verified on its own
        } else {
          out.push(...steps(target, [...path, key]));
        }
      }
    }
    memo.set(key, out);
    return out;
  }
  function triggerSteps(table: string, op: string, path: string[]): Step[] {
    return catalog.triggers
      .filter((t) => t.table === table && t.events.includes(op))
      .flatMap((t) => steps(t.fn, path));
  }

  /** The waiting acquisitions, after removing locks and writes on rows already held FOR NO KEY UPDATE. */
  function waits(all: Step[]) {
    const held = new Map<string, 'S' | 'NKU'>();
    const out: Step[] = [];
    for (const s of all) {
      if (s.t === 'nowait' || s.t === 'write') {
        // A NOWAIT re-assertion (L6) holds its row in its mode without waiting.
        if (s.t === 'nowait' && (s.mode === 'NKU' || !held.has(s.table))) held.set(s.table, s.mode);
        continue;
      }
      if (s.t === 'insert') {
        out.push(s);
        continue;
      }
      // A write to rows already held FOR NO KEY UPDATE waits for nothing new; an explicit lock always counts.
      if (s.mode === 'W' && held.get(s.table) === 'NKU') continue;
      out.push(s);
      if (s.mode === 'NKU' || s.mode === 'W' || s.mode.includes('NKU')) held.set(s.table, 'NKU');
      else if (!held.has(s.table)) held.set(s.table, 'S');
    }
    return out;
  }
  const token = (s: Step) =>
    s.t === 'insert'
      ? `+${s.category}`
      : s.t === 'wait'
        ? `${s.actor ? 'A' : ''}${s.category}:${s.mode}`
        : '';

  const footprints = new Map<string, string[]>();
  const reachableWrites = new Map<string, { table: string; via: string }[]>();
  for (const [key, p] of parsed) {
    const cls = classOf(key);
    for (const problem of p.problems) add('fail-closed', key, problem);
    if (!cls) {
      add('fail-closed', key, 'not classified: every analysed function needs a class');
      continue;
    }
    if (cls.class !== 'standalone') {
      for (const e of p.events) {
        if ((e.t === 'lock' || e.t === 'update' || e.t === 'delete') && CATEGORY[e.table] === undefined)
          add(
            'fail-closed',
            key,
            `line ${e.line}: ${e.t === 'lock' ? 'a lock on' : 'a write to'} ${e.table}, which has no category`,
          );
        if (e.t === 'insert' && contested.has(e.table) && CATEGORY[e.table] === undefined)
          add(
            'fail-closed',
            key,
            `line ${e.line}: a contested insert into ${e.table}, which has no category`,
          );
      }
    }
    const fn = byKey.get(key)!;
    const appExecutable = fn.some((f) => f.executors.includes('alphakolect_app'));

    // L1 on the function's own clauses (each FOR UPDATE once; key updates; deletes of referenced tables).
    for (const e of p.events) {
      if (e.t === 'lock' && e.mode === 'update') add('L1', key, `${e.line} FOR UPDATE on ${e.table}`);
      if (e.t === 'update' && e.keyColumns.length)
        add('L1', key, `${e.line} key update of ${e.table} (${e.keyColumns.join(', ')})`);
      if (e.t === 'delete' && catalog.referenced.has(e.table))
        add('L1', key, `${e.line} DELETE of ${e.table}, which a foreign key references`);
    }
    const own = steps(key, []);
    const w = waits(own);
    footprints.set(key, w.map(token));
    const written = own
      .filter((s): s is Extract<Step, { t: 'write' }> => s.t === 'write')
      .map((s) => ({ table: s.table, via: s.via }))
      .filter((x, i, xs) => xs.findIndex((y) => y.table === x.table && y.via === x.via) === i);
    reachableWrites.set(key, written);
    // R22: every table written, directly or through any call or trigger, is one this function's class approves.
    if ('writes' in cls) {
      for (const x of written.filter((x) => !cls.writes.includes(x.table)))
        add('footprint', key, `an unapproved write to ${x.table} (at ${x.via})`);
    }

    if (cls.class === 'reader') {
      if (own.length)
        add(
          'fail-closed',
          key,
          `a lock-free reader that locks or writes: ${own.map((s) => `${s.t} ${s.table}`).join(', ')}`,
        );
      continue;
    }
    if (cls.class === 'trigger') {
      if (own.length)
        add(
          'L4',
          key,
          `a trigger function that locks or writes: ${own.map((s) => `${s.t} ${s.table}`).join(', ')}`,
        );
      continue;
    }
    if (cls.class === 'helper') {
      const table = HELPERS[key];
      // Distinct statements (a loop body is counted twice for the order; here each statement once).
      const statements = p.events.filter(
        (e, i, xs) => xs.findIndex((x) => x.t === e.t && x.line === e.line) === i,
      );
      const ownLocks = statements.filter((e) => e.t === 'lock');
      const ok =
        table &&
        statements.length === 2 &&
        ownLocks.length === 2 &&
        ownLocks.every((e) => e.t === 'lock' && e.table === table && e.wait && e.pinned) &&
        new Set(ownLocks.map((e) => (e as { mode: string }).mode)).size === 2 &&
        ownLocks.every((e) => e.t === 'lock' && (e.mode === 'share' || e.mode === 'no key update'));
      if (!ok)
        add(
          'fail-closed',
          key,
          'not the helper shape: one FOR SHARE and one FOR NO KEY UPDATE of its table by id',
        );
      if (appExecutable) add('fail-closed', key, 'a lock helper the app can execute');
      continue;
    }
    if (cls.class === 'nested-check') {
      if (own.some((s) => s.t !== 'nowait'))
        add(
          'L6',
          key,
          `a nested check that waits or writes: ${own
            .filter((s) => s.t !== 'nowait')
            .map((s) => `${s.t} ${s.table}`)
            .join(', ')}`,
        );
      if (appExecutable) add('L6', key, 'a nested check the app can execute');
      continue;
    }
    if (cls.class === 'retired') {
      add('footprint', key, `replaced by ${cls.replacedBy} in the planned footprints (L5, L6)`);
    }
    if (cls.class === 'locked') {
      if (!key.endsWith('_locked')) add('L6', key, 'an inner function must be named …_locked');
      const waiting = w.filter((s) => s.t === 'wait');
      if (waiting.length) add('L6', key, `waits for ${waiting.map(token).join(' ')}`);
      if (appExecutable) add('L6', key, 'executable by the app');
    }
    // The category order: waiting acquisitions (not contested inserts) never go back to an earlier category.
    const seq = w.filter((s): s is Extract<Step, { t: 'wait' }> => s.t === 'wait');
    for (let i = 1; i < seq.length; i++) {
      if (seq[i]!.category < seq[i - 1]!.category) {
        add(
          'order',
          key,
          `${seq.map(token).join(' → ')} (category ${seq[i]!.category} at ${seq[i]!.via}:${seq[i]!.line} after ${seq[i - 1]!.category})`,
        );
        break;
      }
    }
    // L3: nothing is waited for after a contested insert.
    const firstInsert = w.findIndex((s) => s.t === 'insert');
    if (firstInsert >= 0) {
      const after = w.slice(firstInsert + 1).filter((s) => s.t === 'wait');
      if (after.length)
        add(
          'L3',
          key,
          `waits for ${after.map(token).join(' ')} after a contested insert into ${(w[firstInsert] as { table: string }).table}`,
        );
    }
    if (cls.class === 'operation') {
      const actual = collapseInserts(w.map(token));
      const rowRule = seq.filter((s) => !s.pinned).map((s) => `${s.via}:${s.line} ${s.table}`);
      if (actual.join(' ') !== cls.planned.join(' ') || rowRule.length) {
        add(
          'footprint',
          key,
          `${actual.join(' ') || '(nothing)'} — planned ${cls.planned.join(' ')}${rowRule.length ? `; several rows locked without a helper at ${rowRule.join(', ')}` : ''}`,
        );
      }
    }
    if (cls.class === 'flow') {
      const outside = seq.filter((s) => !cls.categories.includes(s.category));
      if (outside.length)
        add(
          'footprint',
          key,
          `waits for ${outside.map(token).join(' ')} outside its planned categories ${cls.categories.join(' → ')}`,
        );
    }
  }
  const writtenTables = new Set(
    [...parsed.values()].flatMap((p) =>
      p.events.filter((e) => e.t !== 'lock' && e.t !== 'call').map((e) => (e as { table: string }).table),
    ),
  );
  return { findings: dedupe(findings), footprints, writtenTables, reachableWrites };
}

function collapseInserts(tokens: string[]): string[] {
  return tokens.filter((t, i) => !(t.startsWith('+') && tokens[i - 1] === t));
}
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.kind}|${f.fn}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Where a function holds the calling session's membership — the actor (§7.2 "authority lock"): the variables a
 * `SELECT … membership_id … INTO …` from identity.validate_session or identity.session_authority fills, or
 * `<record>.membership_id` for a `SELECT v.* INTO <record>` from them.
 */
function actorReferences(text: string): string[] {
  const actors: string[] = [];
  const re =
    /\bselect\s+((?:(?!\bselect\b|;)[\s\S])+?)\s+into\s+(?:strict\s+)?([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)\s+from\s+identity\.(validate_session|session_authority)\s*\(/g;
  for (const m of text.matchAll(re)) {
    const items = topLevelSplit(m[1]!, /^,/).map((s) => s.trim());
    const vars = m[2]!.split(',').map((s) => s.trim());
    if (items.length === 1 && /(^|\.)\*$/.test(items[0]!)) actors.push(`${vars[0]}.membership_id`);
    else
      items.forEach((item, i) => (/(^|\.)membership_id$/.test(item) && vars[i] ? actors.push(vars[i]!) : 0));
  }
  return actors;
}

// ── schema-level expressions ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The functions a schema-level expression may call (§7.2 "Schema-level expressions"): each is lock-free. Anything else
 * in a default, generated column, CHECK, index expression or predicate, or RLS policy of a table in scope fails the
 * guard until it is classified and tested.
 */
export const LOCK_FREE_EXPRESSION_FUNCTIONS: ReadonlySet<string> = new Set([
  'util.uuid_v7',
  'util.current_merchant_id',
  'btrim',
  'length',
  'char_length',
  'lower',
  'jsonb_typeof',
]);

/**
 * Every schema-level expression and construct of `tables` that is not lock-free, as findings — and every function
 * the expressions call (`seen`), so a test can show the check reads them.
 */
export async function schemaFindings(
  client: pg.Client,
  tables: string[],
  allowlist: ReadonlySet<string> = LOCK_FREE_EXPRESSION_FUNCTIONS,
): Promise<{ findings: Finding[]; seen: Set<string> }> {
  const { rows } = await client.query<{ table: string; kind: string; expr: string | null }>(
    `WITH t AS (
       SELECT c.oid, n.nspname || '.' || c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname || '.' || c.relname = ANY ($1))
     SELECT t.name AS table, 'default' AS kind, pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM t JOIN pg_attrdef d ON d.adrelid = t.oid
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE a.attgenerated = ''
     UNION ALL
     SELECT t.name, 'generated column', pg_get_expr(d.adbin, d.adrelid)
       FROM t JOIN pg_attrdef d ON d.adrelid = t.oid
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE a.attgenerated <> ''
     UNION ALL
     SELECT t.name, 'check', pg_get_constraintdef(k.oid) FROM t JOIN pg_constraint k ON k.conrelid = t.oid
      WHERE k.contype = 'c'
     UNION ALL
     SELECT t.name, 'exclusion constraint', pg_get_constraintdef(k.oid) FROM t JOIN pg_constraint k ON k.conrelid = t.oid
      WHERE k.contype = 'x'
     UNION ALL
     SELECT t.name, 'foreign-key action', pg_get_constraintdef(k.oid) FROM t JOIN pg_constraint k
         ON k.conrelid = t.oid OR k.confrelid = t.oid
      WHERE k.contype = 'f' AND (k.confdeltype NOT IN ('a', 'r') OR k.confupdtype NOT IN ('a', 'r'))
     UNION ALL
     SELECT t.name, 'index', concat_ws(' WHERE ', pg_get_expr(i.indexprs, i.indrelid), pg_get_expr(i.indpred, i.indrelid))
       FROM t JOIN pg_index i ON i.indrelid = t.oid WHERE i.indexprs IS NOT NULL OR i.indpred IS NOT NULL
     UNION ALL
     SELECT t.name, 'policy', concat_ws(' WITH CHECK ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
       FROM t JOIN pg_policy p ON p.polrelid = t.oid
     UNION ALL
     SELECT t.name, 'rule', r.rulename FROM t JOIN pg_rewrite r ON r.ev_class = t.oid WHERE r.rulename <> '_RETURN'
     UNION ALL
     SELECT t.name, 'domain column', a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
       FROM t JOIN pg_attribute a ON a.attrelid = t.oid JOIN pg_type ty ON ty.oid = a.atttypid
      WHERE a.attnum > 0 AND NOT a.attisdropped AND ty.typtype = 'd'`,
    [tables],
  );
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const { table, kind, expr } of rows) {
    if (
      ['generated column', 'exclusion constraint', 'foreign-key action', 'rule', 'domain column'].includes(
        kind,
      )
    ) {
      findings.push({
        kind: 'schema',
        fn: table,
        detail: `a ${kind}: ${expr} — not analysable as lock-free`,
      });
      continue;
    }
    const text = (expr ?? '').toLowerCase().replace(/'(?:[^']|'')*'/g, "''");
    for (const m of text.matchAll(/(?<![a-z0-9_.$])()((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\(/g)) {
      const name = m[2]!.replace(/^pg_catalog\./, '');
      if (KEYWORDS.has(name)) continue;
      seen.add(name);
      if (allowlist.has(name)) continue;
      findings.push({
        kind: 'schema',
        fn: table,
        detail: `a ${kind} calls ${name}, which is not on the lock-free allowlist`,
      });
    }
  }
  return { findings: dedupe(findings), seen };
}

// ── the SQL authority guard ─────────────────────────────────────────────────────────────────────────────────────────

/** Membership kinds and platform roles: a comparison with one of these decides by a literal. */
const KIND_AND_ROLE_VALUES = new Set([
  'owner',
  'staff',
  'agent',
  'super_admin',
  'support',
  'verification',
  'finance',
]);

/**
 * Every comparison (or assignment) of a membership kind or platform role with a literal, in every function except
 * those in `exempt` (the resolver): `<x>.kind = 'owner'`, `kind IN ('owner', 'staff')`, `pm.role = 'super_admin'`,
 * `p_kind = 'agent'`, … As `fn: comparison`, whitespace collapsed, so a guard can compare them with an explicit list of
 * data rules (P5 plan §10 P5.5 "SQL authority guard"): outside the resolver, authority comes only from the resolver's
 * permission set; a literal names the kind or role of a target or of stored rows, never the caller's authority.
 */
export function authorityLiterals(functions: FnRow[], exempt: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const f of functions) {
    const key = `${f.schema}.${f.name}`;
    if (exempt.has(key)) continue;
    const start = f.def.indexOf('$function$');
    const end = f.def.lastIndexOf('$function$');
    const { raw } = normalize(start >= 0 && end > start ? f.def.slice(start + 10, end) : '');
    const re =
      /((?:[a-z_][a-z0-9_]*\.)?(?:kind|role|p_kind|p_role)\b)\s*(=|<>|!=|\bnot\s+in\b|\bin\b)\s*(\(\s*'[^']*'(?:\s*,\s*'[^']*')*\s*\)|'[^']*')/g;
    for (const m of raw.matchAll(re)) {
      const values = [...m[3]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!);
      if (!values.some((v) => KIND_AND_ROLE_VALUES.has(v))) continue;
      out.push(
        `${key}: ${`${m[1]} ${m[2]} ${m[3]}`.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')}`,
      );
    }
  }
  return out.sort();
}

// ── the merchant-scope guard (R19; P5 plan §8.5; the reviewer's condition for P5.8) ────────────────────────────────

/**
 * The tenant tables and the column that names a row's business: every table with a merchant_id column, and
 * tenancy.merchants itself (its id).
 */
export async function tenantTables(client: pg.Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ t: string }>(`
    SELECT DISTINCT c.table_schema || '.' || c.table_name AS t
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'merchant_id' AND t.table_type = 'BASE TABLE'
       AND c.table_schema NOT IN ('pg_catalog', 'information_schema')`);
  const map = new Map(rows.map((r) => [r.t, 'merchant_id']));
  map.set('tenancy.merchants', 'id');
  return map;
}

/** Words that can follow a FROM or JOIN item where an alias would stand. */
const NOT_AN_ALIAS = new Set(
  (
    'on where join left right inner full cross natural order group limit offset using union intersect except ' +
    'having window for returning lateral into as set values select and or'
  ).split(' '),
);
/** The session resolvers, called with the function's own session: the one source of a merchant-scoped business. */
const SESSION_SOURCE =
  /\bidentity\.(?:validate_session|session_authority)\s*\(\s*p_session_id\s*\)\s*(?:as\s+)?([a-z_][a-z0-9_]*)/g;

/** Splits at top-level occurrences of a whole word (`and`, `or`), never inside parentheses or another word. */
function splitWord(s: string, word: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (
      depth === 0 &&
      s.startsWith(word, i) &&
      !/[a-z0-9_]/.test(s[i - 1] ?? ' ') &&
      !/[a-z0-9_]/.test(s[i + word.length] ?? ' ')
    ) {
      parts.push(s.slice(last, i));
      last = i + word.length;
      i += word.length - 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

/** Strips parentheses that wrap the whole of `s`. */
function unwrap(s: string): string {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      if (depth === 0 && i < t.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

const IDENT = '[a-z_][a-z0-9_]*(?:\\.[a-z_][a-z0-9_]*)?';
const EQUALITY = new RegExp(`^(${IDENT})\\s*=\\s*(${IDENT})$`);

/**
 * R19 (P5 plan §8.5; the reviewer's condition at the P5.7 gate): a merchant-scoped definer function filters every
 * tenant table it reads by the business its own session gives — never by row-level security, which a definer function
 * bypasses, and never by a parameter or a cursor. Every reference to a tenant table must be a FROM or JOIN item whose
 * business column (merchant_id; the id of tenancy.merchants) is equal — in an AND-ed conjunct of a WHERE or an inner
 * join's ON clause of its own query, not inside an OR or a deeper subquery — to a session-derived value:
 *   - the merchant_id of identity.validate_session(p_session_id) or identity.session_authority(p_session_id), a FROM
 *     item of this query or of an enclosing one;
 *   - a variable a statement selected INTO from such a call's merchant_id;
 *   - the business column of another table of this query or an enclosing one that is itself so bound.
 * A LEFT JOIN's ON clause binds only the item it joins. A right or full outer join, a comma join, or any other mention
 * of a tenant table is a finding: the check fails closed on whatever it cannot read.
 */
export function merchantScopeFindings(f: FnRow, tenant: ReadonlyMap<string, string>): string[] {
  const key = `${f.schema}.${f.name}`;
  const s0 = f.def.indexOf('$function$');
  const e0 = f.def.lastIndexOf('$function$');
  const { text } = normalize(s0 >= 0 && e0 > s0 ? f.def.slice(s0 + 10, e0) : '');
  const d = depths(text);
  const findings: string[] = [];
  const at = (pos: number) => `line ${lineAt(text, pos)}`;

  // Variables holding the session's business: SELECT …, x.merchant_id, … INTO …, v, … FROM <resolver>(p_session_id) x
  const sessionVars = new Set<string>();
  for (const m of text.matchAll(
    /\bselect\s+([^;]*?)\s+into\s+(?:strict\s+)?([^;]*?)\s+from\s+identity\.(?:validate_session|session_authority)\s*\(\s*p_session_id\s*\)\s*(?:as\s+)?([a-z_][a-z0-9_]*)/g,
  )) {
    const exprs = topLevelSplit(m[1]!, /^,/);
    const vars = m[2]!.split(',').map((v) => v.trim());
    exprs.forEach((e, i) => {
      if (e.trim() === `${m[3]}.merchant_id` && vars[i]) sessionVars.add(vars[i]!);
    });
  }

  // Query blocks: each statement, and each parenthesised subquery, with its enclosing block.
  type Block = { start: number; end: number; parent: Block | null };
  const blocks: Block[] = [];
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || (text[i] === ';' && d[i] === 0)) {
      blocks.push({ start: from, end: i, parent: null });
      from = i + 1;
    }
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(' || !/^\s*(select|with)\b/.test(text.slice(i + 1, i + 64))) continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    blocks.push({ start: i + 1, end: j, parent: null });
  }
  blocks.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const b of blocks)
    b.parent =
      blocks
        .filter((p) => p !== b && p.start <= b.start && b.end <= p.end)
        .sort((x, y) => x.end - x.start - (y.end - y.start))[0] ?? null;

  const boundOf = new Map<Block, Set<string>>();
  for (const b of blocks) {
    // This block's own text: its nested subqueries blanked out (they are blocks of their own).
    let own = text.slice(b.start, b.end);
    for (const c of blocks.filter((x) => x.parent === b))
      own = own.slice(0, c.start - b.start) + ' '.repeat(c.end - c.start) + own.slice(c.end - b.start);
    const od = depths(own);

    // FROM and JOIN items: tenant tables (with their aliases) and session resolvers.
    const refs: { table: string; alias: string; pos: number }[] = [];
    /** Where each FROM or JOIN item names its table or function: mentions the check has read. */
    const itemAt = new Set<number>();
    const sessionAliases = [...own.matchAll(SESSION_SOURCE)]
      .map((m) => m[1]!)
      .filter((a) => !NOT_AN_ALIAS.has(a));
    type Join = { pos: number; type: string; alias: string };
    const joins: Join[] = [];
    for (const m of own.matchAll(
      /\b(from|(?:(left|right|full|inner|cross)\s+(?:outer\s+)?)?join)\s+(?:only\s+|lateral\s+)?([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g,
    )) {
      let k = m.index! + m[0].length;
      itemAt.add(k - m[3]!.length - 1 - m[4]!.length);
      const isCall = /^\s*\(/.test(own.slice(k));
      if (isCall) {
        let depth = 0;
        for (; k < own.length; k++) {
          if (own[k] === '(') depth++;
          else if (own[k] === ')' && --depth === 0) {
            k++;
            break;
          }
        }
      }
      const a = own.slice(k).match(/^\s+(?:as\s+)?([a-z_][a-z0-9_]*)/);
      const alias = a && !NOT_AN_ALIAS.has(a[1]!) ? a[1]! : m[4]!;
      const type = m[1] === 'from' ? 'from' : (m[2] ?? 'inner');
      if (m[1] !== 'from') joins.push({ pos: m.index!, type, alias });
      const table = `${m[3]}.${m[4]}`;
      if (isCall || !tenant.has(table)) continue;
      if (type === 'right' || type === 'full')
        findings.push(
          `${key}: ${at(b.start + m.index!)}: ${table} in a ${type} outer join, which the check does not read`,
        );
      refs.push({ table, alias, pos: m.index! });
    }
    // Any other mention of a tenant table (a comma join, a write, …) is one the check cannot read.
    for (const table of tenant.keys()) {
      const re = new RegExp(`\\b${table.replace('.', '\\.')}\\b(?!\\s*\\()`, 'g');
      for (const m of own.matchAll(re))
        if (!itemAt.has(m.index!))
          findings.push(`${key}: ${at(b.start + m.index!)}: a reference to ${table} the check cannot read`);
    }

    // AND-ed equalities of the WHERE and ON clauses at this block's own level; a LEFT JOIN's ON binds only its item.
    const symmetric: [string, string][] = [];
    const directed: { into: string; eq: [string, string] }[] = [];
    const STOP =
      /\b(join|left|right|inner|full|cross|natural|where|on|group|order|limit|offset|having|window|union|intersect|except|returning|into|for|loop|then)\b/g;
    for (const m of own.matchAll(/\b(where|on)\b/g)) {
      if (od[m.index!] !== 0) continue;
      const startAt = m.index! + m[0].length;
      STOP.lastIndex = startAt;
      let stopAt = own.length;
      for (let n = STOP.exec(own); n; n = STOP.exec(own))
        if (od[n.index] === 0) {
          stopAt = n.index;
          break;
        }
      const clause = own.slice(startAt, stopAt);
      const join = m[1] === 'on' ? [...joins].reverse().find((j) => j.pos < m.index!) : undefined;
      for (const conjunct of splitWord(clause, 'and')) {
        const c = unwrap(conjunct);
        if (splitWord(c, 'or').length > 1) continue;
        const eq = c.match(EQUALITY);
        if (!eq) continue;
        const pair: [string, string] = [eq[1]!, eq[2]!];
        if (join?.type === 'left') directed.push({ into: join.alias, eq: pair });
        else symmetric.push(pair);
      }
    }

    // The bound values: the enclosing block's, the session variables, this block's resolvers; then a fixpoint.
    const bound = new Set<string>([...(b.parent ? boundOf.get(b.parent)! : []), ...sessionVars]);
    for (const a of sessionAliases) bound.add(`${a}.merchant_id`);
    for (let changed = true; changed;) {
      changed = false;
      for (const [x, y] of symmetric) {
        if (bound.has(x) !== bound.has(y)) {
          bound.add(x);
          bound.add(y);
          changed = true;
        }
      }
      for (const { into, eq } of directed) {
        for (const [x, y] of [eq, [eq[1], eq[0]] as const])
          if (bound.has(y) && !bound.has(x) && x.startsWith(`${into}.`)) {
            bound.add(x);
            changed = true;
          }
      }
    }
    boundOf.set(b, bound);
    for (const r of refs)
      if (!bound.has(`${r.alias}.${tenant.get(r.table)}`))
        findings.push(
          `${key}: ${at(b.start + r.pos)}: ${r.table} ${r.alias} is not filtered by the session's business`,
        );
  }
  return [...new Set(findings)];
}
