export class AppError extends Error {
  constructor(code, message, status = 400, retryAfter = 0) {
    super(message); Object.assign(this, { code, status, retryAfter });
  }
}
export function publicError(error) {
  return error instanceof AppError
    ? { code: error.code, message: error.message, retryAfter: error.retryAfter }
    : { code: 'UNEXPECTED', message: 'Something went wrong. Your photos have not been saved to disk.' };
}
