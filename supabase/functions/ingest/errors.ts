abstract class HttpError extends Error {
  protected constructor(
    message: string,
    public readonly code: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

class UnauthorizedError extends HttpError {
  constructor(options?: ErrorOptions) {
    super('Unauthorized', 401, options)
  }
}

class ForbiddenError extends HttpError {
  constructor(options?: ErrorOptions) {
    super('Forbidden', 403, options)
  }
}

class MethodNotAllowedError extends HttpError {
  constructor(options?: ErrorOptions) {
    super('Method Not Allowed', 405, options)
  }
}

export {
  HttpError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
}
