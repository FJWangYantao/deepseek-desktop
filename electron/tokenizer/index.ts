import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

let tokenizer: { encode(text: string): { length: number } } | null = null
let initFailed = false

function fallbackCount(text: string): number {
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  return Math.ceil(chinese * 1.5 + english * 1.3)
}

function loadTokenizer() {
  if (tokenizer || initFailed) return
  try {
    const { Tokenizer } = require('@huggingface/tokenizers')
    const tokenizerPath = path.join(__dirname, 'tokenizer.json')
    if (!fs.existsSync(tokenizerPath)) {
      console.warn('[Tokenizer] tokenizer.json not found:', tokenizerPath)
      initFailed = true
      return
    }
    tokenizer = Tokenizer.fromFile(tokenizerPath)
    console.log('[Tokenizer] loaded successfully')
  } catch (e) {
    console.warn('[Tokenizer] failed to load, using fallback:', (e as Error).message)
    initFailed = true
  }
}

export function countTokens(text: string): number {
  loadTokenizer()
  if (!tokenizer) return fallbackCount(text)
  try {
    return tokenizer.encode(text).length
  } catch {
    return fallbackCount(text)
  }
}
