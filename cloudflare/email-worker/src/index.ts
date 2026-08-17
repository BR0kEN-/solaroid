const RELAY_TIMEOUT_MS = 15_000
const PLANT_ID_PATTERN = /^[a-z0-9_-]{1,59}$/

interface Env {
  readonly EMAIL_INGEST_URL?: string
  readonly EMAIL_INGEST_TOKEN?: string
  readonly EMAIL_RECIPIENT_PATTERN?: string
  readonly FALLBACK_ADDRESS?: string
}

interface EmailMessage {
  readonly from: string
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  readonly to: string
  forward(recipient: string): Promise<unknown>
  setReject(reason: string): void
}

interface EmailWorker {
  email(message: EmailMessage, env: Env): Promise<void>
}

interface RelayConfiguration {
  readonly fallbackAddress: string
  readonly ingestToken: string
  readonly ingestUrl: URL
  readonly recipientPattern: RegExp
}

class ConfigurationError extends Error {}

class DownstreamError extends Error {
  readonly status: number

  constructor(status: number) {
    super('Downstream rejected email')
    this.status = status
  }
}

function compileRecipientPattern(source: string): RegExp {
  if (!source.startsWith('^') || !source.endsWith('$')) {
    throw new ConfigurationError('Email recipient pattern must match the complete address')
  }

  try {
    return new RegExp(source)
  } catch {
    throw new ConfigurationError('Email recipient pattern is invalid')
  }
}

function plantIdFromRecipient(recipient: string, pattern: RegExp): string | undefined {
  const plantId = pattern.exec(recipient)?.[1]
  return plantId && PLANT_ID_PATTERN.test(plantId) ? plantId : undefined
}

function configuration(env: Env): RelayConfiguration {
  if (!env.EMAIL_INGEST_URL || !env.EMAIL_INGEST_TOKEN || !env.EMAIL_RECIPIENT_PATTERN || !env.FALLBACK_ADDRESS) {
    throw new ConfigurationError('Email Worker is not configured')
  }

  const ingestUrl = new URL(env.EMAIL_INGEST_URL)

  if (ingestUrl.protocol !== 'https:') {
    throw new ConfigurationError('Email ingest URL must use HTTPS')
  }

  return {
    fallbackAddress: env.FALLBACK_ADDRESS,
    ingestToken: env.EMAIL_INGEST_TOKEN,
    ingestUrl,
    recipientPattern: compileRecipientPattern(env.EMAIL_RECIPIENT_PATTERN),
  }
}

function relayHeaders(
  message: EmailMessage,
  plantId: string,
  ingestToken: string,
): Headers {
  return new Headers({
    Authorization: `Bearer ${ingestToken}`,
    'Content-Type': 'message/rfc822',
    'X-Solaroid-Envelope-From': message.from,
    'X-Solaroid-Plant-Id': plantId,
    'X-Solaroid-Raw-Size': String(message.rawSize),
    'X-Solaroid-Recipient': message.to,
  })
}

async function relay(
  message: EmailMessage,
  configuration: RelayConfiguration,
  plantId: string,
): Promise<void> {
  const response = await fetch(configuration.ingestUrl, {
    method: 'POST',
    body: message.raw,
    headers: relayHeaders(message, plantId, configuration.ingestToken),
    redirect: 'error',
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
  })
  const status = response.status

  await response.body?.cancel().catch(() => undefined)

  if (!response.ok) throw new DownstreamError(status)
}

function logRelayFailure(error: unknown): void {
  if (error instanceof DownstreamError) {
    console.error('Email relay failed', { category: 'downstream', status: error.status })
    return
  }

  if (error instanceof ConfigurationError) {
    console.error('Email relay failed', { category: 'configuration' })
    return
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    console.error('Email relay failed', { category: 'timeout' })
    return
  }

  console.error('Email relay failed', { category: 'network' })
}

async function forwardToFallback(
  message: EmailMessage,
  fallbackAddress: string | undefined,
): Promise<void> {
  if (!fallbackAddress) {
    console.error('Email fallback failed', { category: 'configuration' })
    message.setReject('Document processing unavailable')
    return
  }

  try {
    await message.forward(fallbackAddress)
  } catch {
    console.error('Email fallback failed', { category: 'delivery' })
    message.setReject('Document processing unavailable')
  }
}

async function handleEmail(message: EmailMessage, env: Env): Promise<void> {
  let config: RelayConfiguration

  try {
    config = configuration(env)
  } catch (error) {
    logRelayFailure(error)
    await forwardToFallback(message, env.FALLBACK_ADDRESS)
    return
  }

  const plantId = plantIdFromRecipient(message.to, config.recipientPattern)

  if (!plantId) {
    message.setReject('Invalid document recipient')
    return
  }

  try {
    await relay(message, config, plantId)
  } catch (error) {
    logRelayFailure(error)
    await forwardToFallback(message, env.FALLBACK_ADDRESS)
  }
}

export default {
  email: handleEmail,
} satisfies EmailWorker

export {
  RELAY_TIMEOUT_MS,
  type EmailMessage,
  handleEmail,
  plantIdFromRecipient,
}
