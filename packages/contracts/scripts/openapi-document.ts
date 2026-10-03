// Builds the OpenAPI 3.1 document from the endpoint registry (dev-only: zod-openapi is a dev dependency,
// so this lives outside src/ and is never part of the runtime package).
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
} from 'zod-openapi';
import { endpoints, ErrorResponse, Id, Money, type EndpointContract } from '../src/index.js';

export const OPENAPI_PATH = new URL('../openapi/v1.json', import.meta.url);

function operation(e: EndpointContract): ZodOpenApiOperationObject {
  // Keyed by HTTP status (plus "default"); zod-openapi types the keys as status patterns.
  const responses: Record<string, ZodOpenApiResponseObject> = {};
  for (const [status, r] of Object.entries(e.responses)) {
    if (!r) continue;
    responses[status] = r.schema
      ? { description: r.description, content: { 'application/json': { schema: r.schema } } }
      : { description: r.description };
  }
  // Every endpoint can fail with the standard envelope (§17), e.g. 400 INVALID_JSON or 500 INTERNAL_ERROR.
  responses.default = {
    description: 'Error (standard error envelope)',
    content: { 'application/json': { schema: ErrorResponse } },
  };

  const { params, query, headers, body } = e.request ?? {};
  return {
    operationId: e.id,
    summary: e.summary,
    tags: [e.audience],
    'x-audience': e.audience,
    ...(params || query || headers
      ? {
          requestParams: {
            ...(params ? { path: params } : {}),
            ...(query ? { query } : {}),
            ...(headers ? { header: headers } : {}),
          },
        }
      : {}),
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
    responses: responses as ZodOpenApiOperationObject['responses'],
  };
}

export function buildDocument() {
  const paths: ZodOpenApiPathsObject = {};
  for (const e of Object.values(endpoints) as EndpointContract[]) {
    paths[e.path] = { ...paths[e.path], [e.method]: operation(e) };
  }

  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'AlphaKolect API',
      version: 'v1',
      description:
        'Generated from packages/contracts — do not edit by hand. Money amounts are kobo as exact decimal digit strings (e.g. "150000" = ₦1,500.00).',
    },
    paths,
    // Published from day one so clients see the money and id formats before endpoints use them.
    components: { schemas: { Id, Money } },
  });
}

/** The committed file's exact text: 2-space JSON plus a trailing newline. */
export const renderDocument = () => `${JSON.stringify(buildDocument(), null, 2)}\n`;
