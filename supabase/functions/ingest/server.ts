import { z } from 'zod'
import { INGEST_TOKEN, CORS_HEADERS } from './config.ts'

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
  }
}

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

function serve(
  handlers: Record<Solaroid.Supabase.Http.Method, Solaroid.Supabase.Http.Handler>,
) {
  const responder = new Responder(Object.keys(handlers))

  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
      return responder.text('ok')
    }

    const handler = handlers[request.method]

    if (!handler) {
      return responder.json({ ok: false, error: 'Method not allowed' }, 405)
    }

    if (`Bearer ${INGEST_TOKEN}` !== request.headers.get('Authorization')) {
      return responder.error(new UnauthorizedError())
    }

    try {
      return responder.json({ ok: true, ...await handler(await request.json()) })
    } catch (error) {
      console.error(error)
      return responder.error(error)
    }
  })
}

export {
  serve,
}
