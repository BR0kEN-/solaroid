import { OpenAIEmailAnalyzer } from './email_analysis.ts'

const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n').buffer
const REPORT = {
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

function apiResponse(output: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify(output),
        }],
      }],
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

function knownOutput(overrides: Record<string, unknown> = {}) {
  return {
    attachmentIndex: 0,
    document: {
      type: 'green-tariff-receipt',
      month: '2026-05',
      report: REPORT,
      ...overrides,
    },
  }
}

function input(): Solaroid.Supabase.Email.AnalysisInput {
  return {
    subject: 'Synthetic subject',
    text: 'Synthetic email body',
    pdfs: [{ filename: 'receipt.pdf', content: PDF }],
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

Deno.test('OpenAI analyzer sends inline PDFs and returns structured report data', async () => {
  let authorization = ''
  let requestBody = ''
  const fetcher = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    authorization = new Headers(init?.headers).get('Authorization') || ''
    requestBody = String(init?.body || '')
    return Promise.resolve(apiResponse(knownOutput()))
  }
  const analyzer = new OpenAIEmailAnalyzer({
    apiKey: 'openai-test-key',
    model: 'test-model',
    fetcher,
  })

  const analysis = await analyzer.analyze(input())
  const body = JSON.parse(requestBody)
  const file = body.input[0].content.find((item: Record<string, unknown>) => item.type === 'input_file')

  if (authorization !== 'Bearer openai-test-key') throw new Error('API authorization mismatch')
  if (body.model !== 'test-model') throw new Error('model mismatch')
  if (body.store !== false) throw new Error('response storage was not disabled')
  if (!file.file_data.startsWith('data:application/pdf;base64,JVBER')) {
    throw new Error('PDF was not sent inline')
  }
  if (file.detail !== 'high') throw new Error('PDF detail mismatch')
  if (body.text.format.strict !== true) throw new Error('structured output is not strict')
  if (analysis.document?.type !== 'green-tariff-receipt') throw new Error('document type mismatch')
  if (analysis.document.month !== '2026-05') throw new Error('month mismatch')
  if (analysis.document.report.payment.netUah !== 11103.2) throw new Error('report data mismatch')
})

Deno.test('OpenAI analyzer preserves unknown document classification', async () => {
  const analyzer = new OpenAIEmailAnalyzer({
    apiKey: 'test',
    fetcher: () => Promise.resolve(apiResponse({
      attachmentIndex: null,
      document: null,
    })),
  })

  const analysis = await analyzer.analyze(input())

  if (analysis.document) throw new Error('unknown document was accepted')
})

Deno.test('OpenAI analyzer skips API call without PDF candidates', async () => {
  let called = false
  const analyzer = new OpenAIEmailAnalyzer({
    apiKey: 'test',
    fetcher: () => {
      called = true
      return Promise.resolve(apiResponse(knownOutput()))
    },
  })

  const analysis = await analyzer.analyze({ subject: '', text: '', pdfs: [] })

  if (called) throw new Error('API called without a PDF')
  if (analysis.document) throw new Error('empty email was accepted')
})

Deno.test('OpenAI analyzer rejects malformed or inconsistent results', async () => {
  const outputs = [
    { ...knownOutput(), attachmentIndex: 5 },
    knownOutput({ month: '2026-06' }),
    knownOutput({ report: null }),
    knownOutput({
      report: {
        ...REPORT,
        payment: {
          ...REPORT.payment,
          netUah: -1,
        },
      },
    }),
    { attachmentIndex: 0, document: null },
  ]

  for (const output of outputs) {
    const analyzer = new OpenAIEmailAnalyzer({
      apiKey: 'test',
      fetcher: () => Promise.resolve(apiResponse(output)),
    })

    await expectFailure(() => analyzer.analyze(input()), 'invalid analysis accepted')
  }
})

Deno.test('OpenAI analyzer rejects API failures and missing output', async () => {
  const responses = [
    new Response('', { status: 503 }),
    new Response(JSON.stringify({ output: [] }), { status: 200 }),
  ]

  for (const response of responses) {
    const analyzer = new OpenAIEmailAnalyzer({
      apiKey: 'test',
      fetcher: () => Promise.resolve(response),
    })

    await expectFailure(() => analyzer.analyze(input()), 'failed analysis accepted')
  }
})
