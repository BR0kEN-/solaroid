import { z } from 'zod'
import { HttpError, MethodNotAllowedError, UnauthorizedError } from './errors.ts'
import { CORS_HEADERS } from './config.ts'
import { SupabaseClient } from './client.ts'

const BEARER_PREFIX = 'Bearer '

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
    let status = 400
    let data

    if (error instanceof HttpError) {
      status = error.code
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
      const accessToken = await client.getAccessToken(bearerToken(request))

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
