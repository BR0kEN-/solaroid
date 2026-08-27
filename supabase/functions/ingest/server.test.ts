import { deepStrictEqual } from 'node:assert/strict'
import { z } from 'zod'
import {
  ForbiddenError,
  MethodNotAllowedError,
  PayloadTooLargeError,
  UnauthorizedError,
} from './errors.ts'
import { errorResponse, getProviderError, isTransientProviderError } from './server.ts'

function wrappedProviderError(code: string, message = 'provider failure') {
  return new Error('access token lookup failed', {
    cause: { code, details: 'details', hint: 'hint', message },
  })
}

Deno.test('extracts a provider error from nested causes', () => {
  const error = new Error('outer', { cause: wrappedProviderError('PGRST001') })

  deepStrictEqual(getProviderError(error), {
    code: 'PGRST001',
    details: 'details',
    hint: 'hint',
    message: 'provider failure',
  })
})

Deno.test('classifies known transient provider failures', () => {
  for (const code of ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '08006', '53300']) {
    deepStrictEqual(isTransientProviderError(getProviderError(wrappedProviderError(code))), true)
    deepStrictEqual(errorResponse(wrappedProviderError(code)), {
      status: 503,
      body: { ok: false, message: 'Temporary backend failure' },
    })
  }
})

Deno.test('classifies the future-issued gateway JWT failure as transient', () => {
  const error = wrappedProviderError('PGRST303', 'JWT issued at future')

  deepStrictEqual(isTransientProviderError(getProviderError(error)), true)
  deepStrictEqual(errorResponse(error), {
    status: 503,
    body: { ok: false, message: 'Temporary backend failure' },
  })
})

Deno.test('does not treat other PGRST303 failures as transient', () => {
  deepStrictEqual(
    isTransientProviderError(getProviderError(wrappedProviderError('PGRST303', 'JWT expired'))),
    false,
  )
})

Deno.test('defaults unknown internal failures to 500', () => {
  deepStrictEqual(errorResponse(new Error('database implementation leaked')), {
    status: 500,
    body: { ok: false, message: 'Internal server error' },
  })
})

Deno.test('preserves explicit HTTP errors', () => {
  for (const [error, status, message] of [
    [new UnauthorizedError(), 401, 'Unauthorized'],
    [new ForbiddenError(), 403, 'Forbidden'],
    [new MethodNotAllowedError(), 405, 'Method Not Allowed'],
    [new PayloadTooLargeError(), 413, 'Payload Too Large'],
  ] as const) {
    deepStrictEqual(errorResponse(error), {
      status,
      body: { ok: false, message },
    })
  }
})

Deno.test('preserves validation details with 422', () => {
  let validationError: z.ZodError | undefined
  try {
    z.object({ value: z.number() }).parse({ value: 'wrong' })
  } catch (error) {
    if (error instanceof z.ZodError) validationError = error
  }

  if (!validationError) throw new Error('Expected validation failure')
  const response = errorResponse(validationError)

  deepStrictEqual(response.status, 422)
  deepStrictEqual(response.body.ok, false)
  deepStrictEqual(response.body.message, 'Invalid payload')
  deepStrictEqual(response.body.issues, validationError.issues)
})
