import { z } from 'zod'
import { ForbiddenError, MethodNotAllowedError, UnauthorizedError } from './errors.ts'
import { CORS_HEADERS } from './config.ts'
import { SupabaseClient } from './client.ts'

const BEARER_PREFIX = 'Bearer '

class Responder {
  protected readonly methods!: string

  constructor(methods: readonly string[]) {
    this.methods = methods.join(', ')
  }

  text(data: string, status = 200) {
    return new Response(
      data,
      {
        status,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Allow-Methods': this.methods,
        },
      },
    )
  }

  json(body: Solaroid.Supabase.Json, status = 200) {
    return this.text(JSON.stringify(body), status)
  }

  error(error: unknown) {
    let status = 400
    let data

    if (error instanceof UnauthorizedError) {
      status = 401
    } else if (error instanceof ForbiddenError) {
      status = 403
    } else if (error instanceof MethodNotAllowedError) {
      status = 405
    } else if (error instanceof z.ZodError) {
      status = 422
      data = {
        ok: false,
        message: 'Invalid payload',
        issues: error.issues,
      }
    }

    return this.json(
      data || {
        ok: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      status,
    )
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')

  if (!authorization?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError()
  }

  return authorization.slice(BEARER_PREFIX.length)
}

async function tokenHash(request: Request) {
  const token = bearerToken(request)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function serve(
  handlers: Record<Solaroid.Supabase.Http.Method, Solaroid.Supabase.Http.Handler>,
) {
  const responder = new Responder(Object.keys(handlers))

  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
      return responder.text('ok')
    }

    const handler = handlers[request.method]

    try {
      if (!handler) {
        throw new MethodNotAllowedError()
      }

      const client = new SupabaseClient()
      const accessToken = await client.getAccessToken(await tokenHash(request))

      if (!accessToken) {
        throw new UnauthorizedError()
      }

      return responder.json({ ok: true, ...await handler(request, accessToken, client) })
    } catch (error) {
      console.error(error)
      return responder.error(error)
    }
  })
}

export {
  serve,
}
