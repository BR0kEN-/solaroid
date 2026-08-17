import { EMAIL_INGEST_MAX_SIZE } from './config.ts'
import { isAllowedEnvelopeSender, isEmailRelayRequest, receiveEmail } from './email.ts'

const RELAY_TOKEN = 'relay-secret'
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n')
const OTHER_PDF = new TextEncoder().encode('%PDF-1.4\nunrelated\n%%EOF\n')
const SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const REPORT: Solaroid.Supabase.Document.GreenTariffReport = {
  account: 'synthetic-account',
  eic: '00X0000000000000',
  actDate: '2026-05-31',
  energy: {
    grid: {
      importKwh: 286,
      exportKwh: 2440,
    },
    payable: {
      consumerKwh: 0,
      supplierKwh: 2154,
    },
  },
  purchase: {
    greenTariff: {
      kwh: 2154,
      priceKopPerKwh: 669.44,
      amountUah: 14419.74,
    },
    weightedPrice: {
      kwh: 0,
      priceKopPerKwh: 0,
      amountUah: 0,
    },
  },
  payment: {
    grossUah: 14419.74,
    taxes: {
      personalIncomeUah: 2595.55,
      militaryLevyUah: 720.99,
    },
    netUah: 11103.2,
  },
}

interface TestAttachment {
  readonly contentType: string
  readonly filename: string
  readonly content: Uint8Array
}

interface RequestOptions {
  readonly contentType?: string
  readonly plantId?: string
  readonly rawSize?: string
  readonly recipient?: string
  readonly sender?: string
}

class FakeStorage implements Solaroid.Supabase.Email.Storage {
  documents: Solaroid.Supabase.Email.Document[] = []
  error?: Error

  uploadFile(document: Solaroid.Supabase.Email.Document): Promise<void> {
    if (this.error) return Promise.reject(this.error)

    this.documents.push(document)
    return Promise.resolve()
  }

  getUploadedFiles(): Promise<readonly Solaroid.Supabase.Upload.File[]> {
    return Promise.resolve([])
  }

  getUploadFilePresignedUrl(): Promise<string> {
    return Promise.resolve('https://example.com/document')
  }
}

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
}

function attachment(value: TestAttachment): string {
  return [
    '--solaroid-boundary',
    `Content-Type: ${value.contentType}`,
    `Content-Disposition: attachment; filename="${value.filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64(value.content),
  ].join('\r\n')
}

function mime(attachments: readonly TestAttachment[]): Uint8Array {
  const parts = [
    'From: Supplier <supplier@example.com>',
    'To: docs+demo-plant@example.com',
    'Subject: Synthetic document',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="solaroid-boundary"',
    '',
    '--solaroid-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Synthetic fixture.',
    ...attachments.map(attachment),
    '--solaroid-boundary--',
    '',
  ]

  return new TextEncoder().encode(parts.join('\r\n'))
}

function defaultAttachments(): readonly TestAttachment[] {
  return [
    { contentType: 'text/plain', filename: 'notes.txt', content: new TextEncoder().encode('notes') },
    { contentType: 'application/pdf', filename: 'other.pdf', content: OTHER_PDF },
    { contentType: 'application/pdf', filename: 'report.pdf', content: PDF },
    { contentType: 'application/octet-stream', filename: 'report.pdf.signature', content: SIGNATURE },
  ]
}

function request(raw: Uint8Array, options: RequestOptions = {}): Request {
  const body = new ArrayBuffer(raw.byteLength)
  new Uint8Array(body).set(raw)

  return new Request('https://example.supabase.co/functions/v1/ingest', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': options.contentType ?? 'message/rfc822',
      'X-Solaroid-Envelope-From': options.sender ?? 'supplier@example.com',
      'X-Solaroid-Plant-Id': options.plantId ?? 'demo-plant',
      'X-Solaroid-Raw-Size': options.rawSize ?? String(raw.byteLength),
      'X-Solaroid-Recipient': options.recipient ?? 'docs+demo-plant@example.com',
    },
  })
}

function knownAnalysis(attachmentIndex = 1): Solaroid.Supabase.Email.Analysis {
  return {
    attachmentIndex,
    document: {
      type: 'green-tariff-receipt',
      month: '2026-05',
      report: REPORT,
    },
  }
}

async function expectFailure(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run()
  } catch {
    return
  }

  throw new Error(message)
}

Deno.test('email receiver analyzes generic attachments and stores the selected report pair', async () => {
  const storage = new FakeStorage()
  let analyzed: Solaroid.Supabase.Email.AnalysisInput | undefined
  const analyzer: Solaroid.Supabase.Email.Analyzer = (input) => {
    analyzed = input
    return Promise.resolve(knownAnalysis())
  }

  await receiveEmail(request(mime(defaultAttachments())), RELAY_TOKEN, storage, RELAY_TOKEN, analyzer)

  if (analyzed?.pdfs.length !== 2) throw new Error('PDF candidates mismatch')
  if (analyzed.subject !== 'Synthetic document') throw new Error('email subject mismatch')
  if (storage.documents.length !== 1) throw new Error('document was not stored')

  const document = storage.documents[0]

  if (document.plantId !== 'demo-plant') throw new Error('plant id mismatch')
  if (document.type !== 'green-tariff-receipt') throw new Error('document type mismatch')
  if (document.month !== '2026-05') throw new Error('document month mismatch')
  if (document.report !== REPORT) throw new Error('report metadata mismatch')
  if (new Uint8Array(document.pdf).some((byte, index) => byte !== PDF[index])) {
    throw new Error('selected PDF bytes changed')
  }
  if (!document.signature) throw new Error('signature was not stored')
  if (new Uint8Array(document.signature.content).some((byte, index) => byte !== SIGNATURE[index])) {
    throw new Error('signature bytes changed')
  }
})

Deno.test('email receiver accepts unrelated attachment shapes but rejects unsupported analysis', async () => {
  const storage = new FakeStorage()
  const raw = mime([
    { contentType: 'text/csv', filename: 'data.csv', content: new TextEncoder().encode('a,b') },
    { contentType: 'application/pdf', filename: 'broken.pdf', content: new TextEncoder().encode('not pdf') },
  ])

  await expectFailure(
    () => receiveEmail(
      request(raw),
      RELAY_TOKEN,
      storage,
      RELAY_TOKEN,
      (input) => {
        if (input.pdfs.length) throw new Error('invalid PDF was analyzed')
        return Promise.resolve({})
      },
    ),
    'unsupported email accepted',
  )

  if (storage.documents.length) throw new Error('unsupported email was stored')
})

Deno.test('email receiver accepts a selected PDF without a signature attachment', async () => {
  const storage = new FakeStorage()
  const attachments = defaultAttachments().filter((item) => !item.filename.endsWith('.signature'))

  await receiveEmail(
    request(mime(attachments)),
    RELAY_TOKEN,
    storage,
    RELAY_TOKEN,
    () => Promise.resolve(knownAnalysis()),
  )

  if (storage.documents[0].signature) throw new Error('unexpected signature stored')
})

Deno.test('email receiver rejects ambiguous signature attachments', async () => {
  const storage = new FakeStorage()
  const attachments = [
    ...defaultAttachments(),
    { contentType: 'application/octet-stream', filename: 'report.pdf.second', content: SIGNATURE },
  ]

  await expectFailure(
    () => receiveEmail(
      request(mime(attachments)),
      RELAY_TOKEN,
      storage,
      RELAY_TOKEN,
      () => Promise.resolve(knownAnalysis()),
    ),
    'ambiguous signatures accepted',
  )

  if (storage.documents.length) throw new Error('ambiguous document was stored')
})

Deno.test('email receiver rejects invalid analysis selection', async () => {
  await expectFailure(
    () => receiveEmail(
      request(mime(defaultAttachments())),
      RELAY_TOKEN,
      new FakeStorage(),
      RELAY_TOKEN,
      () => Promise.resolve(knownAnalysis(9)),
    ),
    'invalid attachment selection accepted',
  )
})

Deno.test('email receiver requires the dedicated relay token', async () => {
  const storage = new FakeStorage()

  await expectFailure(
    () => receiveEmail(
      request(mime(defaultAttachments())),
      'plant-token',
      storage,
      RELAY_TOKEN,
      () => Promise.resolve(knownAnalysis()),
    ),
    'invalid relay token accepted',
  )

  if (storage.documents.length) throw new Error('unauthorized document was stored')
})

Deno.test('email receiver accepts only exact configured envelope senders', async () => {
  const allowedDomains = new Set(['supplier.example', 'testing.example'])
  const allowedAddresses = new Set(['tester@gmail.com'])

  if (!isAllowedEnvelopeSender('Reports@Supplier.Example', allowedDomains, allowedAddresses)) {
    throw new Error('configured sender domain rejected')
  }

  if (!isAllowedEnvelopeSender('Tester@Gmail.com', allowedDomains, allowedAddresses)) {
    throw new Error('configured sender address rejected')
  }

  for (const sender of [
    'other@gmail.com',
    'reports@sub.supplier.example',
    'reports@supplier.example.attacker.test',
    'reports@attacker-supplier.example',
    'reports@@supplier.example',
    'Reports <reports@supplier.example>',
  ]) {
    if (isAllowedEnvelopeSender(sender, allowedDomains, allowedAddresses)) {
      throw new Error(`invalid sender accepted: ${sender}`)
    }
  }

  let analyzed = false

  await expectFailure(
    () => receiveEmail(
      request(mime(defaultAttachments()), { sender: 'reports@attacker.test' }),
      RELAY_TOKEN,
      new FakeStorage(),
      RELAY_TOKEN,
      () => {
        analyzed = true
        return Promise.resolve(knownAnalysis())
      },
      allowedDomains,
      allowedAddresses,
    ),
    'unknown sender accepted',
  )

  if (analyzed) throw new Error('unknown sender reached document analysis')
})

Deno.test('email receiver rejects invalid relay metadata and body size', async () => {
  const raw = mime(defaultAttachments())
  const invalidRequests = [
    request(raw, { plantId: 'INVALID' }),
    request(raw, { rawSize: '0' }),
    request(raw, { rawSize: String(raw.byteLength + 1) }),
    request(raw, { recipient: ' ' }),
    request(raw, { sender: ' ' }),
  ]

  for (const invalidRequest of invalidRequests) {
    await expectFailure(
      () => receiveEmail(
        invalidRequest,
        RELAY_TOKEN,
        new FakeStorage(),
        RELAY_TOKEN,
        () => Promise.resolve(knownAnalysis()),
      ),
      'invalid relay request accepted',
    )
  }
})

Deno.test('email receiver rejects oversized messages before analysis', async () => {
  await expectFailure(
    () => receiveEmail(
      request(mime(defaultAttachments()), { rawSize: String(EMAIL_INGEST_MAX_SIZE + 1) }),
      RELAY_TOKEN,
      new FakeStorage(),
      RELAY_TOKEN,
      () => Promise.resolve(knownAnalysis()),
    ),
    'oversized email accepted',
  )
})

Deno.test('only message/rfc822 POST requests use email relay auth', () => {
  if (!isEmailRelayRequest(request(mime(defaultAttachments())))) throw new Error('raw email POST not detected')
  if (isEmailRelayRequest(request(mime(defaultAttachments()), { contentType: 'application/json' }))) {
    throw new Error('telemetry request detected as raw email')
  }
})

Deno.test('email receiver does not acknowledge storage failures', async () => {
  const storage = new FakeStorage()
  storage.error = new Error('storage unavailable')

  await expectFailure(
    () => receiveEmail(
      request(mime(defaultAttachments())),
      RELAY_TOKEN,
      storage,
      RELAY_TOKEN,
      () => Promise.resolve(knownAnalysis()),
    ),
    'storage failure acknowledged',
  )
})
