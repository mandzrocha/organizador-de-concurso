// pdf-parse@1.1.1 is CommonJS — use require for Turbopack/ESM compatibility
/* eslint-disable @typescript-eslint/no-require-imports */

export async function extractTextFromPdf(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
    buffer: Buffer,
    options?: Record<string, unknown>
  ) => Promise<{ text: string; numpages: number }>

  const data = await pdfParse(buffer)
  return data.text.trim()
}
