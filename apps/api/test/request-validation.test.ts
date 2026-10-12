import { defineEndpoint, ErrorResponse, Id } from '@alphakolect/contracts';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../src/platform/http/error-handler.js';
import { resolveRequestId } from '../src/platform/http/request-id.js';
import { validateRequest } from '../src/platform/http/validate.js';

// Contract-driven request validation (§17). Synthetic endpoints isolate the middleware.

const SECRET = 'correct horse battery staple';

const endpoint = defineEndpoint({
  id: 'validationProbe',
  method: 'post',
  path: '/v1/test/validation',
  audience: 'public',
  authorization: { class: 'public' },
  summary: 'probe',
  request: { body: z.object({ email: z.email(), password: z.string().min(12).max(20) }) },
  responses: { 200: { description: 'ok' } },
});

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
app.post(endpoint.path, validateRequest(endpoint), (req, res) => {
  res.json(req.body);
});
app.use(errorHandler);

describe('request body validation', () => {
  it('passes the parsed body on, with unknown fields stripped', async () => {
    const res = await request(app)
      .post(endpoint.path)
      .send({ email: 'a@example.test', password: 'twelve chars!', isAdmin: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'a@example.test', password: 'twelve chars!' });
  });

  it.each([
    ['a missing body', undefined],
    ['a wrong type', { email: 'a@example.test', password: 42 }],
    ['an invalid field', { email: 'not-an-email', password: 'twelve chars!' }],
  ])('refuses %s with 400 VALIDATION_ERROR in the standard envelope', async (_label, body) => {
    const res = await request(app).post(endpoint.path).send(body);
    expect(res.status).toBe(400);
    expect(ErrorResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('names the field but never echoes the submitted value', async () => {
    const res = await request(app)
      .post(endpoint.path)
      .send({ email: 'a@example.test', password: `${SECRET} that is far too long` });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues).toEqual([{ path: 'password', message: expect.any(String) }]);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('refuses at startup a contract with request parts it does not check yet', () => {
    expect(() =>
      validateRequest(
        defineEndpoint({ ...endpoint, request: { headers: z.object({ 'x-thing': z.string() }) } }),
      ),
    ).toThrow(/request\.headers validation is not implemented/);
  });
});

describe('path parameter validation', () => {
  const withParams = defineEndpoint({
    id: 'paramsProbe',
    method: 'get',
    path: '/v1/test/things/{thingId}',
    audience: 'public',
    authorization: { class: 'public' },
    summary: 'probe',
    request: { params: z.object({ thingId: Id }) },
    responses: { 200: { description: 'ok' } },
  });
  const paramsApp = express();
  paramsApp.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
  paramsApp.get('/v1/test/things/:thingId', validateRequest(withParams), (req, res) => {
    res.json({ thingId: req.params.thingId });
  });
  paramsApp.use(errorHandler);

  it('passes a well-formed id through', async () => {
    const id = '01900000-0000-7000-8000-00000000000a';
    const res = await request(paramsApp).get(`/v1/test/things/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ thingId: id });
  });

  it('refuses a malformed id with 400 naming the parameter, without echoing it', async () => {
    const res = await request(paramsApp).get('/v1/test/things/not-an-id-drop-table');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.issues).toEqual([{ path: 'params.thingId', message: expect.any(String) }]);
    expect(JSON.stringify(res.body)).not.toContain('drop-table');
  });
});

// P5.3: contracts may declare `query`; the values are validated from the contract like bodies and path parameters,
// unknown parameters are refused, and a contract without `query` receives none — the prerequisite for the paginated
// reads of P5.7 and P5.8.
describe('query parameter validation (P5.3)', () => {
  const listing = defineEndpoint({
    id: 'queryProbe',
    method: 'get',
    path: '/v1/test/listing',
    audience: 'public',
    authorization: { class: 'public' },
    summary: 'probe',
    request: {
      query: z.object({
        status: z.enum(['open', 'all']).default('open'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
      }),
    },
    responses: { 200: { description: 'ok' } },
  });
  const plain = defineEndpoint({
    id: 'noQueryProbe',
    method: 'get',
    path: '/v1/test/plain',
    audience: 'public',
    authorization: { class: 'public' },
    summary: 'probe',
    responses: { 200: { description: 'ok' } },
  });

  let handlerRuns = 0;
  const queryApp = express();
  queryApp.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: resolveRequestId }));
  for (const e of [listing, plain]) {
    queryApp.get(e.path, validateRequest(e), (req, res) => {
      handlerRuns += 1;
      const query = req.query as Record<string, unknown>;
      res.json({ query, limitType: typeof query.limit, frozen: Object.isFrozen(query) });
    });
  }
  queryApp.use(errorHandler);

  it('valid values reach the handler parsed and typed — coerced, defaults applied, read-only', async () => {
    const given = await request(queryApp).get(`${listing.path}?status=all&limit=10&cursor=abc`);
    expect(given.status).toBe(200);
    expect(given.body).toEqual({
      query: { status: 'all', limit: 10, cursor: 'abc' },
      limitType: 'number',
      frozen: true,
    });
    const defaults = await request(queryApp).get(listing.path);
    expect(defaults.body.query).toEqual({ status: 'open', limit: 50 });
  });

  it.each([
    ['a value out of range', 'limit=0'],
    ['a value of the wrong type', 'limit=ten'],
    ['a value outside the enum', 'status=closed'],
    ['a repeated parameter', 'limit=10&limit=20'],
    ['an empty cursor', 'cursor='],
    ['an unknown parameter', 'limit=10&include=everything'],
  ])('refuses %s with 400 VALIDATION_ERROR, before the handler runs', async (_label, qs) => {
    const before = handlerRuns;
    const res = await request(queryApp).get(`${listing.path}?${qs}`);
    expect(res.status).toBe(400);
    expect(ErrorResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(handlerRuns).toBe(before);
  });

  it('names an unknown parameter without echoing its value', async () => {
    const res = await request(queryApp).get(`${listing.path}?token=${encodeURIComponent(SECRET)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues).toEqual([
      { path: 'query.token', message: 'Unknown query parameter' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('horse');
  });

  it('a contract without query receives none, whatever the URL carries', async () => {
    const res = await request(queryApp).get(`${plain.path}?status=all&admin=true`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: {}, limitType: 'undefined', frozen: true });
  });
});
