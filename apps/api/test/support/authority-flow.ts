import path from 'node:path';
import ts from 'typescript';

// The strengthened source guard (P5.6 precondition; the reviewer's condition at the P5.4 gate): an authority decision
// by the caller's membership kind or platform role may not hide in an indirect form outside the policy module — a
// lookup table or map keyed by kind or role, a helper that returns one (or returns the kind itself), or a comparison
// through a variable. The P5.4 guard (authorization-policy.test.ts) finds literal comparisons on 'owner' and
// 'super_admin'; this one follows values through the compiler's type checker.
//
// Sources — values that carry the caller's kind or role:
//   - the `kind` or `role` property of AuthContext or TenantContext (found by the property's declaration, not by its
//     name, so unrelated `.kind` discriminants such as a login result's are not sources);
//   - any other expression whose type admits the literal 'owner' or 'super_admin' (MembershipKind, a row typed with
//     those kinds, a constant `const OWNER = 'owner'`) — literals themselves are left to the P5.4 guard;
//   - and, transitively, a variable initialised from a source (destructuring included), a function that returns one,
//     and a template, concatenation, conditional, `??`/`||` or array built from one.
// A source may be copied into data — an object literal's property, a type assertion, a variable — but it may not reach
// a decision: either side of an equality, the left of `in`, a `switch`, an element-access key (a lookup table), or an
// argument of any call or `new` (a map's get/has, a set's has, an array's includes, or a helper that decides). An
// object literal does not carry taint: `{ kind }` handed to a function is data, as the responses and audit summaries
// are. No guard of this kind is complete; it catches these forms, and a value it cannot type is not assumed safe — an
// `any`-typed `.kind` or `.role` is a source too.

const AUTHORITY_LITERALS = new Set(['owner', 'super_admin']);
const CALLER_TYPES = new Set(['AuthContext', 'TenantContext']);
const CALLER_PROPERTIES = new Set(['kind', 'role']);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

export type Finding = { file: string; line: number; form: string; text: string };

/** The API's program (src/), plus virtual files given as path → text (for the mutation probes). */
export function apiProgram(apiRoot: string, extra: Record<string, string> = {}) {
  const config = ts.readConfigFile(path.join(apiRoot, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  const sources = parsed.fileNames.filter((f) =>
    path.relative(apiRoot, f).replace(/\\/g, '/').startsWith('src/'),
  );
  const virtual = new Map(Object.entries(extra).map(([f, text]) => [path.resolve(f), text]));
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language) => {
    const text = virtual.get(path.resolve(fileName));
    return text !== undefined
      ? ts.createSourceFile(fileName, text, language, true)
      : getSourceFile(fileName, language);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => virtual.has(path.resolve(f)) || fileExists(f);
  const roots = [...sources, ...Object.keys(extra).map((f) => f.replace(/\\/g, '/'))];
  return ts.createProgram(roots, parsed.options, host);
}

/**
 * Every place in `files` (paths relative to apiRoot) where the caller's kind or role reaches a decision, except in
 * the files of `exempt` (the policy module).
 */
export function authorityFlows(
  program: ts.Program,
  apiRoot: string,
  files: (rel: string) => boolean,
  exempt: ReadonlySet<string>,
): Finding[] {
  const checker = program.getTypeChecker();
  const rel = (sf: ts.SourceFile) => path.relative(apiRoot, sf.fileName).replace(/\\/g, '/');
  const sourceFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && files(rel(sf)));

  const unwrap = (e: ts.Expression): ts.Expression => {
    while (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e)
    )
      e = e.expression;
    return e;
  };
  const symbolOf = (n: ts.Node): ts.Symbol | undefined => {
    const s = checker.getSymbolAtLocation(n);
    return s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  };

  /** A property symbol declared on AuthContext or TenantContext (through Readonly<…> too). */
  const isCallerProperty = (symbol: ts.Symbol | undefined): boolean =>
    !!symbol &&
    CALLER_PROPERTIES.has(symbol.name) &&
    (symbol.declarations ?? []).some((d) => {
      for (let p: ts.Node | undefined = d.parent; p; p = p.parent)
        if (ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
          return CALLER_TYPES.has(p.name.text);
      return false;
    });
  const admitsAuthorityLiteral = (type: ts.Type): boolean => {
    const t = checker.getNonNullableType(type);
    const parts = t.isUnion() ? t.types : [t];
    return parts.some((p) => p.isStringLiteral() && AUTHORITY_LITERALS.has(p.value));
  };
  const isAny = (type: ts.Type) => (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;

  const taintedSymbols = new Set<ts.Symbol>(); // variables and functions that carry the caller's kind or role

  const tainted = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return false; // the P5.4 guard's
    if (ts.isObjectLiteralExpression(e)) return false; // data
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const name = ts.isPropertyAccessExpression(e)
        ? e.name.text
        : ts.isStringLiteral(e.argumentExpression)
          ? e.argumentExpression.text
          : undefined;
      if (name && CALLER_PROPERTIES.has(name)) {
        const symbol = ts.isPropertyAccessExpression(e)
          ? symbolOf(e.name)
          : checker.getTypeAtLocation(e.expression).getProperty(name);
        if (isCallerProperty(symbol)) return true;
        if (isAny(checker.getTypeAtLocation(e))) return true; // cannot be typed: not assumed safe
      }
    }
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const symbol = symbolOf(ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : e);
      if (symbol && taintedSymbols.has(symbol)) return true;
      if (admitsAuthorityLiteral(checker.getTypeAtLocation(e))) return true;
    }
    if (ts.isCallExpression(e)) {
      const callee = symbolOf(ts.isPropertyAccessExpression(e.expression) ? e.expression.name : e.expression);
      if (callee && taintedSymbols.has(callee)) return true;
      if (admitsAuthorityLiteral(checker.getTypeAtLocation(e))) return true;
    }
    if (ts.isTemplateExpression(e)) return e.templateSpans.some((s) => tainted(s.expression));
    if (ts.isBinaryExpression(e))
      return (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.CommaToken,
        ].includes(e.operatorToken.kind) &&
        (tainted(e.left) || tainted(e.right))
      );
    if (ts.isConditionalExpression(e)) return tainted(e.whenTrue) || tainted(e.whenFalse);
    if (ts.isArrayLiteralExpression(e))
      return e.elements.some((x) => (ts.isSpreadElement(x) ? tainted(x.expression) : tainted(x)));
    return false;
  };

  // Propagate to a fixpoint: variables initialised from a source, functions returning one.
  const functionSymbol = (fn: ts.SignatureDeclaration): ts.Symbol | undefined => {
    if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return symbolOf(fn.name);
    const p = fn.parent;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return symbolOf(p.name);
    if (p && ts.isPropertyAssignment(p)) return symbolOf(p.name);
    return undefined;
  };
  const returnsTainted = (fn: ts.FunctionLikeDeclaration): boolean => {
    if (!fn.body) return false;
    if (!ts.isBlock(fn.body)) return tainted(fn.body);
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isFunctionLike(n) && n !== fn) return; // a nested function's returns are its own
      if (ts.isReturnStatement(n) && n.expression && tainted(n.expression)) found = true;
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(fn.body, visit);
    return found;
  };
  const isCallerTyped = (expr: ts.Expression) => {
    const t = checker.getNonNullableType(checker.getTypeAtLocation(expr));
    const alias = t.aliasSymbol?.name ?? t.getSymbol()?.name;
    return (
      (alias !== undefined && CALLER_TYPES.has(alias)) || t.getProperties().some((p) => isCallerProperty(p))
    );
  };
  for (let changed = true; changed;) {
    changed = false;
    const mark = (s: ts.Symbol | undefined) => {
      if (s && !taintedSymbols.has(s)) {
        taintedSymbols.add(s);
        changed = true;
      }
    };
    for (const sf of sourceFiles) {
      const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && n.initializer) {
          if (ts.isIdentifier(n.name) && tainted(n.initializer)) mark(symbolOf(n.name));
          if (ts.isObjectBindingPattern(n.name) && isCallerTyped(n.initializer))
            for (const b of n.name.elements) {
              const prop = b.propertyName ?? b.name;
              if (ts.isIdentifier(prop) && CALLER_PROPERTIES.has(prop.text) && ts.isIdentifier(b.name))
                mark(symbolOf(b.name));
            }
        }
        if (
          (ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n)) &&
          returnsTainted(n)
        )
          mark(functionSymbol(n));
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }

  // The decisions.
  const findings: Finding[] = [];
  for (const sf of sourceFiles) {
    const file = rel(sf);
    if (exempt.has(file)) continue;
    const add = (n: ts.Node, form: string) =>
      findings.push({
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        form,
        text: n.getText(sf).replace(/\s+/g, ' '),
      });
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n)) {
        if (EQUALITY.has(n.operatorToken.kind) && (tainted(n.left) || tainted(n.right))) add(n, 'comparison');
        if (n.operatorToken.kind === ts.SyntaxKind.InKeyword && tainted(n.left)) add(n, 'in');
      }
      if (ts.isSwitchStatement(n) && tainted(n.expression)) add(n.expression, 'switch');
      if (ts.isElementAccessExpression(n) && tainted(n.argumentExpression)) add(n, 'lookup key');
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && (n.arguments ?? []).some((a) => tainted(a)))
        add(n, 'call argument');
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return findings;
}
