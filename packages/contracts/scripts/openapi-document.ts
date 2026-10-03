// Builds the OpenAPI 3.1 document from the endpoint registry (dev-only: zod-openapi is a dev dependency,
// so this lives outside src/ and is never part of the runtime package).
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
} from 'zod-openapi';
import {
  AUTH_COOKIES,
  CSRF_HEADER,
  endpoints,
  ErrorResponse,
  Id,
  Money,
  type EndpointContract,
} from '../src/index.js';

export const OPENAPI_PATH = new URL('../openapi/v1.json', import.meta.url);

function operation(e: EndpointContract): ZodOpenApiOperationObject {
  // Keyed by HTTP status (plus "default"); zod-openapi types the keys as status patterns.
  const responses: Record<string, ZodOpenApiResponseObject> = {};
  for (const [status, r] of Object.entries(e.responses)) {
    if (!r) continue;
    responses[status] = {
      description: r.description,
      ...(r.schema ? { content: { 'application/json': { schema: r.schema } } } : {}),
      ...(r.headers ? { headers: r.headers } : {}),
    };
  }
  // Every endpoint can fail with the standard envelope (§17), e.g. 400 INVALID_JSON or 500 INTERNAL_ERROR.
  responses.default = {
    description: 'Error (standard error envelope)',
    content: { 'application/json': { schema: ErrorResponse } },
  };

  // Any one listed scheme authenticates. Cookie sessions also need the CSRF header on state changes (D7).
  const security = e.security?.map((scheme) =>
    scheme === 'cookieSession' && e.method !== 'get'
      ? { cookieSession: [], csrfToken: [] }
      : { [scheme]: [] },
  );

  const { params, query, headers, body } = e.request ?? {};
  return {
    operationId: e.id,
    summary: e.summary,
    tags: [e.audience],
    'x-audience': e.audience,
    ...(e.sessionScope ? { 'x-session-scope': e.sessionScope } : {}),
    ...(security ? { security } : {}),
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

export function buildDocument(registry: Record<string, EndpointContract> = endpoints) {
  const paths: ZodOpenApiPathsObject = {};
  for (const e of Object.values(registry)) {
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
    components: {
      // Published from day one so clients see the money and id formats before endpoints use them.
      schemas: { Id, Money },
      securitySchemes: {
        cookieSession: {
          type: 'apiKey',
          in: 'cookie',
          name: AUTH_COOKIES.access,
          description: 'Web audiences (platform, merchant): HttpOnly access-token cookie (ADR-14 D7)',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: CSRF_HEADER,
          description: `Echo of the ${AUTH_COOKIES.csrf} cookie, required on state-changing cookie requests`,
        },
        bearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Mobile audiences (agent, customer): EdDSA-signed access token (ADR-14 D6)',
        },
      },
    },
  });
}

/** The committed file's exact text: 2-space JSON plus a trailing newline. */
export const renderDocument = () => `${JSON.stringify(buildDocument(), null, 2)}\n`;
