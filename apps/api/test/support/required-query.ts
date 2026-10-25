/**
 * The query string an endpoint requires before any check can answer it, for tests that call every endpoint of the
 * registry: the activity-record reads take a window (O4) — here the hour either side of now; the ledger's statement
 * and reports a period or a day (P6). Empty for every other endpoint.
 */
export function requiredQuery(id: string): string {
  // P6: a statement and the profit and loss take a period, the trial balance and the balance sheet a day.
  const today = new Date().toISOString().slice(0, 10);
  if (id === 'getAccountStatement' || id === 'getProfitAndLoss') return `?from=2000-01-01&to=${today}`;
  if (id === 'getTrialBalance' || id === 'getBalanceSheet') return `?asOf=${today}`;
  if (id !== 'listMerchantAuditEvents' && id !== 'listPlatformAuditEvents') return '';
  const from = new Date(Date.now() - 3_600_000).toISOString();
  const to = new Date(Date.now() + 3_600_000).toISOString();
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
