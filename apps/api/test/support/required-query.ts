/**
 * The query string an endpoint requires before any check can answer it, for tests that call every endpoint of the
 * registry: the activity-record reads take a window (O4) — here the hour either side of now. Empty for every other
 * endpoint.
 */
export function requiredQuery(id: string): string {
  if (id !== 'listMerchantAuditEvents' && id !== 'listPlatformAuditEvents') return '';
  const from = new Date(Date.now() - 3_600_000).toISOString();
  const to = new Date(Date.now() + 3_600_000).toISOString();
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
