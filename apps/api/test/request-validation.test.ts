import { defineEndpoint, ErrorResponse, Id } from '@alphakolect/contracts';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../src/platform/http/error-handler.js';
import { resolveRequestId } from '../src/platform/http/request-id.js';
import { needsValidation, validateRequest } from '../src/platform/http/validate.js';

// Contract-driven request validation (§17). A synthetic endpoint isolates the middleware.

const SECRET = 'correct horse battery staple';

const endpoint = defineEndpoint({
  id: 'validationProbe',
  method: 'post',
  path: '/v1/test/validation',
  audience: 'public',
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
      needsValidation(defineEndpoint({ ...endpoint, request: { query: z.object({ q: z.string() }) } })),
    ).toThrow(/request\.query validation is not implemented/);
  });
});

describe('path parameter validation', () => {
  const withParams = defineEndpoint({
    id: 'paramsProbe',
    method: 'get',
    path: '/v1/test/things/{thingId}',
    audience: 'public',
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

  it('is required for contracts with path parameters', () => {
    expect(needsValidation(withParams)).toBe(true);
  });
});
