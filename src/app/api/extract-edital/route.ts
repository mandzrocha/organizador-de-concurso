import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { extractTextFromPdf } from '@/lib/pdf'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Arquivo muito grande (máx 10MB)' }, { status: 400 })

    const pdfText = await extractTextFromPdf(file)
    if (!pdfText || pdfText.length < 100) {
      return NextResponse.json({ error: 'Não foi possível extrair texto do PDF. O arquivo pode ser uma imagem escaneada sem texto.' }, { status: 400 })
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
      },
    })

    const result = await model.generateContent(`Você é um especialista em editais de concursos públicos brasileiros. O texto abaixo foi extraído de um PDF e pode conter MUITO conteúdo irrelevante (Diário Oficial, despachos, regras de inscrição, etc.). Sua tarefa é localizar a seção de CONTEÚDO PROGRAMÁTICO / PROGRAMA DAS PROVAS / ANEXO de matérias e extrair o programa de estudos completo.

CONTEÚDO DO EDITAL (texto completo extraído do PDF):
${pdfText.slice(0, 400000)}

---

Localize a seção do programa das provas (geralmente perto do fim do documento, podendo estar dividida em BLOCOS) e extraia TODAS as matérias (disciplinas) e seus respectivos tópicos.

ATENÇÃO:
- O documento pode ter uma tabela-resumo das matérias E uma seção detalhada com os tópicos. Use sempre a versão DETALHADA (com a lista numerada de tópicos).
- Se as matérias estiverem agrupadas em "BLOCOS" (ex: "BLOCO II: Conhecimentos em Direito" contendo Direito Penal, Direito Processual Penal, etc.), trate cada disciplina interna como uma MATÉRIA separada — não use o nome do bloco como matéria.
- Inclua TODAS as matérias, sem exceção (Língua Portuguesa, todas as de Direito, Atualidades, Matemática, Informática, Raciocínio Lógico, etc.).
- Liste TODOS os tópicos de cada matéria, na ordem em que aparecem.

Retorne APENAS um JSON válido neste formato exato:
{"subjects":[{"name":"Nome da Matéria","topics":["Tópico 1","Tópico 2"]}]}

Regras:
- Cada tópico deve ser uma string. Se for muito longo (>180 caracteres), resuma mantendo o sentido e referências legais (artigos, leis).
- Ignore cargos, salários, vagas, inscrições, cronograma, locais de prova, despachos e demais conteúdos administrativos.
- NÃO invente matérias ou tópicos que não estejam no texto.`)

    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('AI response:', text)
      throw new Error('A IA não retornou um JSON válido. Tente novamente.')
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.subjects || !Array.isArray(parsed.subjects)) {
      throw new Error('Estrutura JSON inválida na resposta da IA.')
    }

    return NextResponse.json(parsed)
  } catch (e: any) {
    console.error('extract-edital error:', e)
    return NextResponse.json({ error: e.message || 'Erro ao processar edital' }, { status: 500 })
  }
}
