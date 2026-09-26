// Standard error envelope (TARGET_ARCHITECTURE §17):
//   { error: { code, message, details?, requestId } }
// `code` is a stable, machine-readable identifier clients (web and mobile) can rely on.

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'Route not found') => new AppError(404, 'NOT_FOUND', message);

export function errorBody(err: Pick<AppError, 'code' | 'message' | 'details'>, requestId: string): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
      requestId,
    },
  };
}
