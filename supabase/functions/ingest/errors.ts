class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
  }
}

class ForbiddenError extends Error {
  constructor() {
    super('Forbidden')
  }
}

class MethodNotAllowedError extends Error {
  constructor() {
    super('Method Not Allowed')
  }
}

export {
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
}
