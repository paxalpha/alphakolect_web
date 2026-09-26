// Resolve the client IP without trusting spoofable headers.
//
// In production the API sits behind nginx on the same host, which appends the real peer
// address to X-Forwarded-For ($proxy_add_x_forwarded_for). We only honour that header when the
// TCP peer is loopback (i.e. the request really came through the local proxy), and then take
// the LAST entry — the one nginx added. A direct client cannot influence the result.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const getClientIp = (req) => {
  const peer = (req.socket && req.socket.remoteAddress) || '';
  const forwarded = req.headers['x-forwarded-for'];

  if (LOOPBACK.has(peer) && forwarded) {
    const hops = String(forwarded).split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return peer || 'unknown';
};

module.exports = { getClientIp };
