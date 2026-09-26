// Shared Prettier preset.
/** @type {import('prettier').Config} */
export default {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 110,
  // Working copies may be CRLF on Windows (core.autocrlf); git stores LF.
  endOfLine: 'auto',
};
