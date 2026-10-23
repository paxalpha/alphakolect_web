import path from 'node:path';
import ts from 'typescript';

// The repository-transaction classifier of the lock-order guard (P5 plan §7.2 R17, R22, R27). Every repository
// transaction in apps/api/src — the callback of a `db.transaction` or `withTenant` — is followed through everything
// it calls with the transaction: a repository bound to it (`identity.within(tx)`), a function or method that receives
// it or such a repository, and a function-typed parameter (resolved at its call sites, one variant per call site).
// What it collects is what reaches the database through the transaction — every SQL statement, with constant
// template substitutions folded (a constant map expands to its finite set of values, the statement's alternatives:
// one of them runs, never all), and every audit entry-point call. Anything it cannot resolve is recorded and fails classification: non-constant SQL, a query on another
// connection, a call that receives the transaction but cannot be resolved.

export type AuditEntry = 'mutateAudited' | 'recordWithin' | 'recordBestEffort';
export type RepoTransaction = {
  /** `Class.method` of the transaction (a variant: the call site's `Class.method` it was resolved through). */
  name: string;
  at: string;
  /** Each SQL text; `stmt` numbers the statement it is an alternative of (one query call, one value at run time). */
  sql: { text: string; at: string; stmt: number }[];
  audit: { entry: AuditEntry; pairs: string[] | null; at: string }[];
  unresolved: string[];
};

const AUDIT_ENTRIES: ReadonlySet<string> = new Set(['mutateAudited', 'recordWithin', 'recordBestEffort']);

type Ctx = {
  tx: Set<string>;
  repos: Set<string>;
  /** Inside a method of a repository bound to the transaction: `this.db` is the transaction. */
  bound: boolean;
  /** Function-typed parameters bound to the arguments of one call site (variants). */
  bindings: Map<string, { fn: ts.ArrowFunction | ts.FunctionExpression; site: string }>;
};

export function repositoryTransactions(
  program: ts.Program,
  sources: string[],
  root: string,
): RepoTransaction[] {
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((s) => sources.includes(s.fileName));
  let statements = 0;
  const rel = (n: ts.Node) => path.relative(root, n.getSourceFile().fileName).replace(/\\/g, '/');
  const at = (n: ts.Node) =>
    `${rel(n)}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const enclosingFn = (node: ts.Node): ts.FunctionLikeDeclaration | undefined => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) return n;
    }
    return undefined;
  };
  const nameOf = (fn: ts.FunctionLikeDeclaration | undefined): string => {
    if (!fn) return '<module>';
    if (ts.isMethodDeclaration(fn) && ts.isClassDeclaration(fn.parent))
      return `${fn.parent.name?.text}.${fn.name.getText()}`;
    if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? '<anonymous>';
    return '<function>';
  };

  // Call sites of every function or method, for function-typed parameters.
  const callSites = new Map<ts.Node, ts.CallExpression[]>();
  for (const sf of files) {
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const decl = checker.getResolvedSignature(n)?.getDeclaration();
        if (decl) callSites.set(decl, [...(callSites.get(decl) ?? []), n]);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const declOf = (expr: ts.Expression): ts.Declaration | undefined => {
    const target = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
    let sym = checker.getSymbolAtLocation(target);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym?.valueDeclaration ?? sym?.declarations?.[0];
  };
  const functionOf = (decl: ts.Declaration | undefined) => {
    if (!decl) return undefined;
    if (
      (ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isFunctionExpression(decl) ||
        ts.isArrowFunction(decl)) &&
      decl.body
    )
      return decl;
    if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) && decl.initializer) {
      const init = decl.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
    }
    return undefined;
  };

  // ── constant folding of SQL ──
  function foldValue(expr: ts.Expression): string[] | null {
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr))
      return foldValue(expr.expression);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
    if (ts.isTemplateExpression(expr)) {
      let out = [expr.head.text];
      for (const span of expr.templateSpans) {
        const values = foldValue(span.expression);
        if (!values) return null;
        out = out.flatMap((v) => values.map((x) => v + x + span.literal.text));
      }
      return out;
    }
    if (ts.isIdentifier(expr)) {
      const decl = declOf(expr);
      if (
        decl &&
        ts.isVariableDeclaration(decl) &&
        decl.initializer &&
        ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const
      )
        return foldValue(decl.initializer);
      return null;
    }
    if (ts.isElementAccessExpression(expr) || ts.isPropertyAccessExpression(expr)) {
      const base = ts.isElementAccessExpression(expr) ? expr.expression : expr.expression;
      if (!ts.isIdentifier(base)) return null;
      const decl = declOf(base);
      if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return null;
      let init: ts.Expression = decl.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))
        init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) return null;
      const props = init.properties.filter(ts.isPropertyAssignment);
      const pick = ts.isPropertyAccessExpression(expr)
        ? props.filter((p) => p.name.getText() === expr.name.text)
        : props;
      const values = pick.map((p) => foldValue(p.initializer));
      return values.some((v) => !v) ? null : [...new Set(values.flat() as string[])];
    }
    return null;
  }

  // ── pairs of an audit call, from the literal types of its event argument ──
  const literals = (type: ts.Type): string[] | null => {
    const parts = type.isUnion() ? type.types : [type];
    const values = parts.map((t) => (t.isStringLiteral() ? t.value : null));
    return values.includes(null) ? null : (values as string[]);
  };
  const pairsOf = (arg: ts.Expression | undefined): string[] | null => {
    if (!arg) return null;
    const type = checker.getTypeAtLocation(arg);
    const out: string[] = [];
    for (const member of type.isUnion() ? type.types : [type]) {
      const prop = (name: string) => {
        const symbol = checker.getPropertyOfType(member, name);
        return symbol ? literals(checker.getTypeOfSymbolAtLocation(symbol, arg)) : null;
      };
      const actions = prop('action');
      const outcomes = prop('outcome');
      if (!actions || !outcomes) return null;
      for (const a of actions) for (const o of outcomes) out.push(`${a}/${o}`);
    }
    return [...new Set(out)];
  };

  function walk(node: ts.Node, ctx: Ctx, out: RepoTransaction, seen: Set<string>) {
    const isTx = (e: ts.Expression): boolean =>
      (ts.isIdentifier(e) && ctx.tx.has(e.text)) ||
      (ctx.bound &&
        ts.isPropertyAccessExpression(e) &&
        e.expression.kind === ts.SyntaxKind.ThisKeyword &&
        e.name.text === 'db');
    const isRepo = (e: ts.Expression): boolean =>
      (ts.isIdentifier(e) && ctx.repos.has(e.text)) ||
      (ts.isCallExpression(e) &&
        ts.isPropertyAccessExpression(e.expression) &&
        e.expression.name.text === 'within' &&
        e.arguments.some(isTx)) ||
      (ctx.bound && e.kind === ts.SyntaxKind.ThisKeyword);

    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        if (isRepo(n.initializer)) ctx.repos.add(n.name.text);
        if (isTx(n.initializer)) ctx.tx.add(n.name.text);
      }
      if (!ts.isCallExpression(n)) {
        ts.forEachChild(n, visit);
        return;
      }
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        const receiverType = checker.typeToString(checker.getTypeAtLocation(callee.expression));
        if (AUDIT_ENTRIES.has(name) && receiverType.includes('AuditLog')) {
          out.audit.push({
            entry: name as AuditEntry,
            pairs: pairsOf(n.arguments[name === 'recordBestEffort' ? 0 : 1]),
            at: at(n),
          });
          return;
        }
        if (name === 'query') {
          if (isTx(callee.expression)) {
            const values = n.arguments[0] ? foldValue(n.arguments[0]) : null;
            const stmt = statements++;
            if (values) for (const text of values) out.sql.push({ text, at: at(n), stmt });
            else out.unresolved.push(`${at(n)}: SQL that is not a constant`);
          } else {
            out.unresolved.push(
              `${at(n)}: a query on another connection inside the transaction (${callee.expression.getText()})`,
            );
          }
          n.arguments.forEach(visit);
          return;
        }
        if (name === 'within' && n.arguments.some(isTx)) return; // binds a repository; nothing runs yet
      }
      const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : undefined;
      const onBoundRepo = !!receiver && isRepo(receiver);
      const passes = n.arguments.some((a) => isTx(a) || isRepo(a));
      const binding = ts.isIdentifier(callee) ? ctx.bindings.get(callee.text) : undefined;
      if (binding) {
        enter(binding.fn, n, ctx, false);
      } else if (onBoundRepo || passes) {
        const decl = declOf(callee);
        // Library code (a .d.ts declaration: WeakSet.has, Object.freeze, …) cannot run SQL on the transaction.
        if (decl?.getSourceFile().isDeclarationFile) {
          n.arguments.forEach(visit);
          return;
        }
        const fn = functionOf(decl);
        if (!fn)
          out.unresolved.push(
            `${at(n)}: ${callee.getText()} receives the transaction but cannot be resolved`,
          );
        else enter(fn, n, ctx, onBoundRepo);
      }
      n.arguments.forEach(visit);
      if (!ts.isPropertyAccessExpression(callee)) return;
      visit(callee.expression);
    };

    function enter(fn: ts.FunctionLikeDeclaration, call: ts.CallExpression, outer: Ctx, bound: boolean) {
      const inner: Ctx = { tx: new Set(), repos: new Set(), bound, bindings: outer.bindings };
      fn.parameters.forEach((p, i) => {
        const arg = call.arguments[i];
        if (!arg || !ts.isIdentifier(p.name)) return;
        if (isTx(arg)) inner.tx.add(p.name.text);
        if (isRepo(arg)) inner.repos.add(p.name.text);
      });
      const key = `${at(fn)}|${[...inner.tx].join()}|${[...inner.repos].join()}|${bound}`;
      if (seen.has(key)) return;
      seen.add(key);
      // A function-typed parameter called inside, other than one already bound, cannot be followed from here.
      if (fn.body) walk(fn.body, inner, out, seen);
    }

    visit(node);
  }

  const result: RepoTransaction[] = [];
  for (const sf of files) {
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const opener =
          (ts.isPropertyAccessExpression(callee) && callee.name.text === 'transaction') ||
          (ts.isIdentifier(callee) && callee.text === 'withTenant');
        const cb = n.arguments.find(
          (a): a is ts.ArrowFunction | ts.FunctionExpression =>
            ts.isArrowFunction(a) || ts.isFunctionExpression(a),
        );
        const owner = enclosingFn(n);
        // withTenant's own implementation is the mechanism, not a repository transaction: its callers' callbacks are.
        const mechanism = owner && ts.isFunctionDeclaration(owner) && owner.name?.text === 'withTenant';
        if (opener && cb && !mechanism) {
          const param = cb.parameters[0];
          const txName = param && ts.isIdentifier(param.name) ? param.name.text : undefined;
          // Function-typed parameters of the enclosing method used in the callback: one variant per call site.
          const fnParams = (owner?.parameters ?? []).filter((p) => {
            const t = checker.getTypeAtLocation(p);
            return (
              ts.isIdentifier(p.name) &&
              t.getCallSignatures().length > 0 &&
              cb.getText().includes(p.name.text)
            );
          });
          const sites = owner && fnParams.length ? (callSites.get(owner) ?? []) : [];
          const variants = fnParams.length ? sites : [undefined];
          if (fnParams.length && sites.length === 0) {
            result.push({
              name: nameOf(owner),
              at: at(n),
              sql: [],
              audit: [],
              unresolved: [`${at(n)}: a function-typed parameter with no call site`],
            });
          }
          for (const site of variants) {
            const bindings = new Map<
              string,
              { fn: ts.ArrowFunction | ts.FunctionExpression; site: string }
            >();
            const unresolved: string[] = [];
            if (site && owner) {
              for (const p of fnParams) {
                const arg = site.arguments[owner.parameters.indexOf(p)];
                if (
                  arg &&
                  (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
                  ts.isIdentifier(p.name)
                )
                  bindings.set(p.name.text, { fn: arg, site: nameOf(enclosingFn(site)) });
                else
                  unresolved.push(
                    `${at(site)}: ${p.name.getText()} is not a function written at the call site`,
                  );
              }
            }
            const tx: RepoTransaction = {
              name: site ? nameOf(enclosingFn(site)) : nameOf(owner),
              at: at(n),
              sql: [],
              audit: [],
              unresolved,
            };
            if (txName)
              walk(
                cb.body,
                { tx: new Set([txName]), repos: new Set(), bound: false, bindings },
                tx,
                new Set(),
              );
            result.push(tx);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // Several transactions in one method: number them in source order.
  const counts = new Map<string, number>();
  for (const t of result) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const t of result) {
    if ((counts.get(t.name) ?? 0) > 1) {
      const i = (seen.get(t.name) ?? 0) + 1;
      seen.set(t.name, i);
      t.name = `${t.name} #${i}`;
    }
  }
  return result;
}

// ── classification ──────────────────────────────────────────────────────────────────────────────────────────────────

export type SqlFunctionClass = { class: string };
export type ClassRules = {
  /** The SQL guard's class of every function (test/support/lock-plan.ts CLASSES). */
  classes: Readonly<Record<string, SqlFunctionClass>>;
  /** Per function, every table it writes and where (the SQL analysis, R22). */
  reachableWrites: ReadonlyMap<string, { table: string; via: string }[]>;
  /** Functions with an unapproved write (the SQL analysis' R22 findings). */
  unapproved: ReadonlySet<string>;
  /** The nested-writer table (R27): a T2 flow, the pattern-A function it reaches, the pair it writes. */
  nestedWriters: readonly { flow: string; fn: string; pair: string }[];
  /** An audit pair's class and writer pattern (the event catalog). */
  pairOf: (pair: string) => { class: string; pattern: string | null } | undefined;
  /** The designated sensitive-read functions (lock-plan SENSITIVE_READS): a T4 transaction calls one of them. */
  sensitiveReads: ReadonlySet<string>;
};

export type Classification = {
  tx: RepoTransaction;
  cls: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | null;
  problems: string[];
};

const strip = (sql: string) => sql.toLowerCase().replace(/'(?:[^']|'')*'/g, "''");

export function classify(tx: RepoTransaction, rules: ClassRules): Classification {
  const problems = [...tx.unresolved];
  const definers = new Set<string>();
  /** Per statement, the functions each of its alternatives calls. */
  const calls = new Map<number, string[][]>();
  const directWrites: string[] = [];
  let locks = false;
  for (const { text, stmt } of tx.sql) {
    const s = strip(text);
    // A schema-qualified name followed by "(" is a call — in any schema but pg_catalog, so a function of a schema
    // the guard does not know is an unclassified function, never unseen — unless it is the table of INSERT INTO t (…).
    const called: string[] = [];
    for (const m of s.matchAll(/(?<![a-z0-9_.])(?<!\binto\s+)([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/g))
      if (m[1] !== 'pg_catalog') called.push(`${m[1]}.${m[2]}`);
    for (const fn of called) definers.add(fn);
    calls.set(stmt, [...(calls.get(stmt) ?? []), called]);
    for (const m of s.matchAll(
      /\b(insert\s+into|delete\s+from|(?<!(?:for|key|do)\s)update)\s+([a-z_]+\.[a-z_][a-z0-9_]*)/g,
    ))
      directWrites.push(m[2]!);
    if (/\bfor\s+(no\s+key\s+update|update|key\s+share|share)\b/.test(s)) locks = true;
  }
  const classOf = (fn: string) => rules.classes[fn]?.class;
  for (const fn of definers) if (!classOf(fn)) problems.push(`${fn} is not a classified function`);
  const nonReaders = [...definers].filter((fn) => classOf(fn) !== 'reader');
  // One privileged operation per transaction, counted per statement: a statement folded from a constant map runs one
  // of its alternatives, so it is one operation if each alternative calls exactly one (a branch-or-role writer), and
  // two statements that each call one are two operations.
  const writingStatements = [...calls.values()]
    .map((alternatives) => alternatives.map((c) => c.filter((fn) => classOf(fn) !== 'reader')))
    .filter((alternatives) => alternatives.some((c) => c.length > 0));
  const oneOperation =
    writingStatements.length === 1 &&
    writingStatements[0]!.every((c) => c.length === 1 && classOf(c[0]!) === 'operation');
  // A sensitive read is an operation by its locks (the reader's authority row) and its one write (the read event), but
  // a class of its own: one call of one designated function, nothing else in the transaction (P5.7).
  const sensitiveRead =
    oneOperation &&
    writingStatements[0]!.every((c) => rules.sensitiveReads.has(c[0]!)) &&
    definers.size === 1;
  const audits = tx.audit;
  for (const a of audits) {
    if (!a.pairs) problems.push(`${a.at}: an audit pair the guard cannot resolve`);
    for (const p of a.pairs ?? [])
      if (rules.pairOf(p)?.class === 'sensitive_read')
        problems.push(`${a.at}: ${p} is a sensitive read, written only by its function`);
  }
  const r22 = nonReaders.filter((fn) => rules.unapproved.has(fn));
  for (const fn of r22) problems.push(`${fn} reaches an unapproved write (R22)`);
  const only = (entry: AuditEntry) => audits.length > 0 && audits.every((a) => a.entry === entry);

  const fits: Classification['cls'][] = [];
  // T5 — best-effort audit: one insert into the activity record, nothing else.
  if (
    audits.length === 0 &&
    definers.size === 0 &&
    !locks &&
    directWrites.length === 1 &&
    directWrites[0] === 'audit.audit_events' &&
    tx.sql.filter((q) => !/set_config\(/.test(strip(q.text))).length === 1
  )
    fits.push('T5');
  // T1 — privileged write: one planned operation, its audit rows written by itself (pattern A).
  if (
    audits.length === 0 &&
    directWrites.length === 0 &&
    !locks &&
    oneOperation &&
    !writingStatements[0]!.some((c) => rules.sensitiveReads.has(c[0]!))
  )
    fits.push('T1');
  // T4 — sensitive read: one call of one designated read function, which records the read and returns the rows.
  if (audits.length === 0 && directWrites.length === 0 && !locks && sensitiveRead) fits.push('T4');
  // T2 — pattern-B audited write: identity definer calls and mutateAudited for approved pattern-B pairs.
  if (
    only('mutateAudited') &&
    directWrites.length === 0 &&
    !locks &&
    nonReaders.every(
      (fn) =>
        ['flow', 'identity'].includes(classOf(fn) ?? '') ||
        rules.nestedWriters.some((w) => w.flow === tx.name && classOf(fn) === 'operation'),
    )
  ) {
    const badPairs = audits.flatMap((a) =>
      (a.pairs ?? []).filter((p) => {
        const c = rules.pairOf(p);
        return !c || c.class !== 'atomic' || c.pattern !== 'B';
      }),
    );
    if (badPairs.length)
      problems.push(`mutateAudited with a pair that is not pattern-B atomic: ${badPairs.join(', ')}`);
    // R27: every audit insert reachable from its definer calls is a nested-writer entry of this flow.
    const nested = nonReaders.flatMap((fn) =>
      (rules.reachableWrites.get(fn) ?? []).filter((w) => w.table === 'audit.audit_events'),
    );
    for (const w of nested)
      if (!rules.nestedWriters.some((e) => e.flow === tx.name && e.fn === w.via))
        problems.push(
          `a nested audit insert by ${w.via} that the nested-writer table does not list for ${tx.name} (R27)`,
        );
    if (!badPairs.length) fits.push('T2');
  }
  // T3 — read-only: scoped reads and lock-free readers only.
  if (audits.length === 0 && directWrites.length === 0 && !locks && nonReaders.length === 0) fits.push('T3');

  if (fits.length !== 1) {
    const what = [
      definers.size ? `calls ${[...definers].join(', ')}` : '',
      directWrites.length ? `writes ${[...new Set(directWrites)].join(', ')} directly` : '',
      locks ? 'takes a locking clause' : '',
      audits.length ? `audits through ${[...new Set(audits.map((a) => a.entry))].join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    problems.push(
      fits.length
        ? `matches more than one class (${fits.join(', ')})`
        : `matches no class: ${what || 'does nothing'}`,
    );
  }
  return { tx, cls: fits.length === 1 && problems.length === 0 ? fits[0]! : null, problems };
}

/** R27: every entry's function is reachable from its flow's definer calls. */
export function unreachableNestedWriters(transactions: RepoTransaction[], rules: ClassRules): string[] {
  return rules.nestedWriters
    .filter((w) => {
      const flow = transactions.find((t) => t.name === w.flow);
      if (!flow) return true;
      const definers = new Set(
        flow.sql.flatMap((q) =>
          [
            ...strip(q.text).matchAll(
              /(?<![a-z0-9_.])(?<!\binto\s+)([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/g,
            ),
          ]
            .filter((m) => m[1] !== 'pg_catalog')
            .map((m) => `${m[1]}.${m[2]}`),
        ),
      );
      return ![...definers].some((fn) =>
        (rules.reachableWrites.get(fn) ?? []).some((x) => x.via === w.fn && x.table === 'audit.audit_events'),
      );
    })
    .map((w) => `${w.flow} → ${w.fn} (${w.pair}): not reachable from the flow`);
}
