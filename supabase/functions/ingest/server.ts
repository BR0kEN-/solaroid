import { z } from 'zod'
import { CORS_HEADERS } from './config.ts'
import { SupabaseClient } from './client.ts'
import { isEmailRelayRequest } from './email.ts'
import { HttpError, MethodNotAllowedError, UnauthorizedError } from './errors.ts'

const BEARER_PREFIX = 'Bearer '

interface ProviderErrorDetails {
  readonly code: string
  readonly message: string
  readonly details: unknown
  readonly hint: unknown
}

interface ErrorResponse {
  readonly status: number
  readonly body: Solaroid.Supabase.Json
}

function getProviderError(error: unknown): ProviderErrorDetails | undefined {
  const seen = new Set<unknown>()
  let current = error

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const candidate = current as {
      readonly cause?: unknown
      readonly code?: unknown
      readonly details?: unknown
      readonly hint?: unknown
      readonly message?: unknown
    }

    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        message: candidate.message,
        details: candidate.details ?? null,
        hint: candidate.hint ?? null,
      }
    }

    current = candidate.cause
  }

  return undefined
}

function isTransientProviderError(error: ProviderErrorDetails | undefined): boolean {
  if (!error) return false

  return /^PGRST00[0-3]$/.test(error.code)
    || /^(08|53)/.test(error.code)
    || (error.code === 'PGRST303' && error.message === 'JWT issued at future')
}

function errorResponse(error: unknown): ErrorResponse {
  if (error instanceof HttpError) {
    return {
      status: error.code,
      body: { ok: false, message: error.message },
    }
  }

  if (error instanceof z.ZodError) {
    return {
      status: 422,
      body: {
        ok: false,
        message: 'Invalid payload',
        issues: error.issues,
      },
    }
  }

  if (isTransientProviderError(getProviderError(error))) {
    return {
      status: 503,
      body: { ok: false, message: 'Temporary backend failure' },
    }
  }

  return {
    status: 500,
    body: { ok: false, message: 'Internal server error' },
  }
}

function logError(error: unknown) {
  const provider = getProviderError(error)
  console.error('Ingest request failed', {
    operation: error instanceof Error ? error.message : 'Unknown error',
    provider,
    stack: error instanceof Error ? error.stack : undefined,
  })
}

class Responder {
  protected readonly methods!: string

  constructor(methods: readonly string[]) {
    this.methods = methods.join(', ')
  }

  text(data: string, status = 200, contentType?: string) {
    return new Response(
      data,
      {
        status,
        headers: {
          ...CORS_HEADERS,
          ...(contentType ? { 'Content-Type': contentType } : {}),
          'Access-Control-Allow-Methods': this.methods,
        },
      },
    )
  }

  json(body: Solaroid.Supabase.Json, status = 200) {
    return this.text(JSON.stringify(body), status, 'application/json')
  }

  error(error: unknown) {
    const response = errorResponse(error)
    return this.json(response.body, response.status)
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')

  if (!authorization?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError()
  }

  return authorization.slice(BEARER_PREFIX.length)
}

function serve(
  handlers: Record<Solaroid.Supabase.Http.Method, Solaroid.Supabase.Http.Handler>,
  emailHandler: Solaroid.Supabase.Email.Handler,
) {
  const responder = new Responder(Object.keys(handlers))

  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
      return responder.text('ok')
    }

    const handler = handlers[request.method]

    try {
      const client = new SupabaseClient()

      if (isEmailRelayRequest(request)) {
        return responder.json({ ok: true, ...await emailHandler(request, bearerToken(request), client) })
      }

      if (!handler) {
        throw new MethodNotAllowedError()
      }

      const accessToken = await client.getAccessToken(bearerToken(request))

      if (!accessToken) {
        throw new UnauthorizedError()
      }

      return responder.json({ ok: true, ...await handler(request, accessToken, client) })
    } catch (error) {
      logError(error)
      return responder.error(error)
    }
  })
}

export {
  errorResponse,
  getProviderError,
  isTransientProviderError,
  serve,
}
