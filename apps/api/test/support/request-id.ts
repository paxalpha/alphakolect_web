import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER, type RequestIdSource } from '../../src/platform/http/request-id.js';

// Tests only. The server ignores an incoming X-Request-ID (P5 plan §8.6, P5.8): its own id is in the response header.
// A test that must find the activity rows of a request — or inject a failure into one request's audit insert — needs
// the id before it sends the request, so the tests' app takes a plain caller-supplied id, as the server did before
// P5.8. It lives here, outside src, so production code can never use it; the tests of the server's own behaviour build
// their app without it (createTestApp({ serverRequestIds: true })).

const PLAIN_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const honourRequestId: RequestIdSource = (req, res) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && PLAIN_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
};
