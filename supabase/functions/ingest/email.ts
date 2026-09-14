import PostalMime, { type Attachment } from 'postal-mime'
import {
  EMAIL_ALLOWED_SENDER_ADDRESSES,
  EMAIL_ALLOWED_SENDER_DOMAINS,
  EMAIL_INGEST_MAX_SIZE,
  EMAIL_INGEST_TOKEN,
} from './config.ts'
import { analyzeEmail } from './email_analysis.ts'
import { ForbiddenError, PayloadTooLargeError, UnauthorizedError } from './errors.ts'
import { Hash } from './utils/crypto.ts'

const PLANT_ID_PATTERN = /^[a-z0-9_-]{1,59}$/
const RAW_SIZE_PATTERN = /^[1-9][0-9]*$/
const GMAIL_FORWARDING_MARKER = '+caf_='

interface Mailbox {
  readonly domain: string
  readonly local: string
}

function mediaType(request: Request): string {
  return request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() || ''
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim()

  if (!value) throw new Error('Invalid email relay metadata')

  return value
}

function attachmentName(attachment: Attachment): string {
  return attachment.filename?.trim().toLowerCase() || ''
}

function attachmentBytes(attachment: Attachment): ArrayBuffer {
  if (attachment.content instanceof ArrayBuffer) return attachment.content

  if (ArrayBuffer.isView(attachment.content)) {
    const copy = new ArrayBuffer(attachment.content.byteLength)
    new Uint8Array(copy).set(new Uint8Array(
      attachment.content.buffer,
      attachment.content.byteOffset,
      attachment.content.byteLength,
    ))
    return copy
  }

  throw new Error('Invalid email attachment')
}

function mailbox(value: string): Mailbox | undefined {
  const normalized = value.trim().toLowerCase()
  const separator = normalized.indexOf('@')

  if (
    separator <= 0 ||
    separator !== normalized.lastIndexOf('@') ||
    /[<>\s]/.test(normalized)
  ) {
    return undefined
  }

  return {
    local: normalized.slice(0, separator),
    domain: normalized.slice(separator + 1),
  }
}

function gmailForwarderAddress(sender: Mailbox, recipient: string): string | undefined {
  const markerIndex = sender.local.lastIndexOf(GMAIL_FORWARDING_MARKER)
  const target = mailbox(recipient)

  if (markerIndex <= 0 || !target) return undefined

  const encodedTarget = sender.local.slice(markerIndex + GMAIL_FORWARDING_MARKER.length)

  if (encodedTarget !== `${target.local}=${target.domain}`) return undefined

  return `${sender.local.slice(0, markerIndex)}@${sender.domain}`
}

function isAllowedEnvelopeSender(
  sender: string,
  allowedDomains: readonly string[],
  allowedAddresses: readonly string[] = [],
  recipient = '',
): boolean {
  const parsed = mailbox(sender)

  if (!parsed) return false

  const normalized = `${parsed.local}@${parsed.domain}`

  if (allowedAddresses.includes(normalized) || allowedDomains.includes(parsed.domain)) return true

  const forwarder = gmailForwarderAddress(parsed, recipient)

  return Boolean(forwarder && allowedAddresses.includes(forwarder))
}

function matchingSignature(attachments: readonly Attachment[], pdf: Attachment): Attachment | undefined {
  const prefix = `${attachmentName(pdf)}.`
  const signatures = attachments.filter((attachment) => (
    attachment !== pdf && attachmentName(attachment).startsWith(prefix)
  ))

  if (signatures.length > 1) throw new Error('Selected PDF has ambiguous signature attachments')

  return signatures[0]
}

function isPdf(pdf: ArrayBuffer): boolean {
  return new TextDecoder().decode(pdf.slice(0, 5)) === '%PDF-'
}

function isEmailRelayRequest(request: Request): boolean {
  return request.method === 'POST' && mediaType(request) === 'message/rfc822'
}

async function receiveEmail(
  request: Request,
  bearer: string,
  storage: Solaroid.Supabase.Email.Storage,
  expectedToken = EMAIL_INGEST_TOKEN,
  analyzer: Solaroid.Supabase.Email.Analyzer = analyzeEmail,
  allowedSenderDomains: readonly string[] = EMAIL_ALLOWED_SENDER_DOMAINS,
  allowedSenderAddresses: readonly string[] = EMAIL_ALLOWED_SENDER_ADDRESSES,
): Promise<Solaroid.Supabase.Json> {
  if (!(await Hash.eq(bearer, expectedToken))) throw new UnauthorizedError()

  const plantId = requiredHeader(request, 'X-Solaroid-Plant-Id')
  const rawSizeValue = requiredHeader(request, 'X-Solaroid-Raw-Size')
  const sender = requiredHeader(request, 'X-Solaroid-Envelope-From')
  const recipient = requiredHeader(request, 'X-Solaroid-Recipient')

  if (!isAllowedEnvelopeSender(sender, allowedSenderDomains, allowedSenderAddresses, recipient)) throw new ForbiddenError()

  if (!PLANT_ID_PATTERN.test(plantId) || !RAW_SIZE_PATTERN.test(rawSizeValue)) {
    throw new Error('Invalid email relay metadata')
  }

  const rawSize = Number(rawSizeValue)

  if (!Number.isSafeInteger(rawSize)) throw new Error('Invalid email relay metadata')
  if (rawSize > EMAIL_INGEST_MAX_SIZE) throw new PayloadTooLargeError()

  const raw = await request.arrayBuffer()

  if (raw.byteLength !== rawSize) throw new Error('Email size mismatch')

  const parsed = await PostalMime.parse(raw)
  const candidates = parsed.attachments.flatMap((attachment) => {
    if (!attachmentName(attachment).endsWith('.pdf')) return []

    const content = attachmentBytes(attachment)

    if (!isPdf(content)) return []

    return [{
      attachment,
      pdf: {
        filename: attachment.filename || 'document.pdf',
        content,
      },
    }]
  })
  const pdfs = candidates.map((candidate) => candidate.pdf)
  const analysis = await analyzer({
    subject: parsed.subject || '',
    text: parsed.text || '',
    pdfs,
  })

  if (!analysis.document || analysis.attachmentIndex === undefined) {
    throw new Error('Unsupported email document')
  }

  const candidate = candidates[analysis.attachmentIndex]

  if (!candidate) throw new Error('Document analyzer selected an invalid attachment')

  const pdf = candidate.pdf.content
  const signatureAttachment = matchingSignature(parsed.attachments, candidate.attachment)
  const signature = signatureAttachment
    ? {
      content: attachmentBytes(signatureAttachment),
      contentType: signatureAttachment.mimeType || 'application/octet-stream',
    }
    : undefined

  if (signature && !signature.content.byteLength) throw new Error('Invalid signature attachment')

  await storage.uploadFile({
    type: analysis.document.type,
    month: analysis.document.month,
    pdf,
    plantId,
    report: analysis.document.report,
    signature,
  })

  return {}
}

export {
  isAllowedEnvelopeSender,
  isEmailRelayRequest,
  receiveEmail,
}
