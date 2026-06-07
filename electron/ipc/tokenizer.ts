import { ipcMain } from 'electron'
import { countTokens } from '../tokenizer'

export function registerTokenizerHandlers() {
  ipcMain.handle('tokenizer:count', async (_event, text: string): Promise<number> => {
    return countTokens(text)
  })
}
