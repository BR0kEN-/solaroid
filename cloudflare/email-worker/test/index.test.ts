import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { RELAY_TIMEOUT_MS, plantIdFromRecipient, type EmailMessage } from '../src/index'

interface TestMessage {
  readonly forward: ReturnType<typeof vi.fn>
  readonly message: EmailMessage
  readonly reject: ReturnType<typeof vi.fn>
}

const rawEmail = readFileSync('test/fixtures/signed-document.eml')
const env = {
  EMAIL_INGEST_URL: 'https://example.supabase.co/functions/v1/email-ingest',
  EMAIL_INGEST_TOKEN: 'worker-secret',
  EMAIL_RECIPIENT_PATTERN: '^docs\\+([a-z0-9_-]{1,59})@solaroid\\.app$',
  FALLBACK_ADDRESS: 'fallback@example.com',
}
const recipientPattern = new RegExp(env.EMAIL_RECIPIENT_PATTERN)

function testMessage(to = 'docs+bondas@solaroid.app'): TestMessage {
  const forward = vi.fn().mockResolvedValue(undefined)
  const reject = vi.fn()
  const message = {
    canBeForwarded: true,
    forward,
    from: 'forwarder@example.com',
    headers: new Headers(),
    raw: new Blob([rawEmail]).stream(),
    rawSize: rawEmail.byteLength,
    reply: vi.fn(),
    setReject: reject,
    to,
  } as unknown as EmailMessage

  return { forward, message, reject }
}

describe('plantIdFromRecipient', () => {
  it('extracts a lowercase plant slug', () => {
    expect(plantIdFromRecipient('docs+plant_1-test@solaroid.app', recipientPattern)).toBe('plant_1-test')
  })

  it.each([
    'docs@solaroid.app',
    'docs+@solaroid.app',
    'docs+Plant@solaroid.app',
    'docs+plant@example.com',
    'receipts+plant@solaroid.app',
    `docs+${'a'.repeat(60)}@solaroid.app`,
  ])('rejects %s', (recipient) => {
    expect(plantIdFromRecipient(recipient, recipientPattern)).toBeUndefined()
  })
})

describe('email handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('relays the raw message and routing metadata unchanged', async () => {
    const { message, forward, reject } = testMessage()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const relayed = new Uint8Array(await new Response(init?.body).arrayBuffer())
      expect(relayed).toEqual(new Uint8Array(rawEmail))

      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer worker-secret')
      expect(headers.get('Content-Type')).toBe('message/rfc822')
      expect(headers.get('X-Solaroid-Plant-Id')).toBe('bondas')
      expect(headers.get('X-Solaroid-Recipient')).toBe('docs+bondas@solaroid.app')
      expect(headers.get('X-Solaroid-Envelope-From')).toBe('forwarder@example.com')
      expect(headers.get('X-Solaroid-Raw-Size')).toBe(String(rawEmail.byteLength))
      expect(init?.redirect).toBe('manual')
      expect(init?.signal).toBeInstanceOf(AbortSignal)

      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await worker.email(message, env)

    expect(fetchMock).toHaveBeenCalledWith(new URL(env.EMAIL_INGEST_URL), expect.objectContaining({ method: 'POST' }))
    expect(forward).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('rejects malformed recipients without calling downstream', async () => {
    const { message, forward, reject } = testMessage('docs@solaroid.app')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await worker.email(message, env)

    expect(reject).toHaveBeenCalledWith('Invalid document recipient')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
  })

  it('uses the configured recipient pattern', async () => {
    const { message, forward, reject } = testMessage('receipts+levched@example.com')
    const customEnv = {
      ...env,
      EMAIL_RECIPIENT_PATTERN: '^receipts\\+([a-z0-9_-]{1,59})@example\\.com$',
    }
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Solaroid-Plant-Id')).toBe('levched')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await worker.email(message, customEnv)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(forward).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
  })

  it.each([
    ['downstream response', async () => new Response(null, { status: 503 })],
    ['redirect response', async () => new Response(null, { status: 302 })],
    ['network failure', async () => { throw new TypeError('network unavailable') }],
    ['timeout', async () => { throw new DOMException('timed out', 'TimeoutError') }],
  ])('forwards to fallback after %s', async (_label, fetchImplementation) => {
    const { message, forward, reject } = testMessage()
    vi.stubGlobal('fetch', vi.fn(fetchImplementation))

    await worker.email(message, env)

    expect(forward).toHaveBeenCalledWith(env.FALLBACK_ADDRESS)
    expect(reject).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('logs a privacy-safe network reason', async () => {
    const { message } = testMessage()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network connection lost.') }))

    await worker.email(message, env)

    expect(console.error).toHaveBeenCalledWith('Email relay failed', {
      category: 'network',
      reason: 'connection',
    })
  })

  it.each([
    [{ ...env, EMAIL_INGEST_URL: undefined }, 'missing URL'],
    [{ ...env, EMAIL_INGEST_TOKEN: undefined }, 'missing token'],
    [{ ...env, EMAIL_RECIPIENT_PATTERN: undefined }, 'missing recipient pattern'],
    [{ ...env, EMAIL_RECIPIENT_PATTERN: 'docs\\+([a-z0-9_-]+)@solaroid\\.app' }, 'unanchored recipient pattern'],
    [{ ...env, EMAIL_RECIPIENT_PATTERN: '^docs\\+([a-z0-9_-]+@solaroid\\.app$' }, 'invalid recipient pattern'],
    [{ ...env, EMAIL_INGEST_URL: 'http://example.com/email' }, 'non-HTTPS URL'],
  ])('uses fallback for invalid configuration: %s', async (invalidEnv, _label) => {
    const { message, forward, reject } = testMessage()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await worker.email(message, invalidEnv)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith(env.FALLBACK_ADDRESS)
    expect(reject).not.toHaveBeenCalled()
  })

  it('rejects when fallback configuration is missing', async () => {
    const { message, forward, reject } = testMessage()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await worker.email(message, { ...env, FALLBACK_ADDRESS: undefined })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledWith('Document processing unavailable')
  })

  it('rejects when fallback delivery fails', async () => {
    const { message, forward, reject } = testMessage()
    forward.mockRejectedValueOnce(new Error('delivery unavailable'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))

    await worker.email(message, env)

    expect(reject).toHaveBeenCalledWith('Document processing unavailable')
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('allows enough time for downstream document analysis', () => {
    expect(RELAY_TIMEOUT_MS).toBe(60_000)
  })
})
