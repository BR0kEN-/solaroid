import PostalMime, { type Attachment } from 'postal-mime'
import { EMAIL_ALLOWED_SENDER_DOMAINS, EMAIL_INGEST_MAX_SIZE, EMAIL_INGEST_TOKEN } from './config.ts'
import { analyzeEmail } from './email_analysis.ts'
import { ForbiddenError, PayloadTooLargeError, UnauthorizedError } from './errors.ts'
import { Hash } from './utils/crypto.ts'

const PLANT_ID_PATTERN = /^[a-z0-9_-]{1,59}$/
const RAW_SIZE_PATTERN = /^[1-9][0-9]*$/

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

function isAllowedEnvelopeSender(sender: string, allowedDomains: ReadonlySet<string>): boolean {
  const normalized = sender.trim().toLowerCase()
  const separator = normalized.indexOf('@')

  if (
    separator <= 0 ||
    separator !== normalized.lastIndexOf('@') ||
    /[<>\s]/.test(normalized)
  ) {
    return false
  }

  return allowedDomains.has(normalized.slice(separator + 1))
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
  allowedSenderDomains: ReadonlySet<string> = EMAIL_ALLOWED_SENDER_DOMAINS,
): Promise<Solaroid.Supabase.Json> {
  if (!(await Hash.eq(bearer, expectedToken))) throw new UnauthorizedError()

  const plantId = requiredHeader(request, 'X-Solaroid-Plant-Id')
  const rawSizeValue = requiredHeader(request, 'X-Solaroid-Raw-Size')
  const sender = requiredHeader(request, 'X-Solaroid-Envelope-From')

  requiredHeader(request, 'X-Solaroid-Recipient')

  if (!isAllowedEnvelopeSender(sender, allowedSenderDomains)) throw new ForbiddenError()

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
