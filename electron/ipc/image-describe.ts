import { ipcMain, app, nativeImage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { extname, join } from 'path'
import * as https from 'https'

const IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

const MAX_WIDTH = 1280
const JPEG_QUALITY = 80

function httpsPost(url: string, body: string, headers: Record<string, string>, timeout = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const data = Buffer.from(body, 'utf-8')
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsPost(res.headers.location, body, headers, timeout).then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`请求超时（${timeout / 1000}s）`)) })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

/** 用 nativeImage 缩放并压缩为 JPEG */
function compressImage(filePath: string): { base64: string; originalSize: number; compressedSize: number } {
  const originalBuf = readFileSync(filePath)
  const originalSize = originalBuf.length

  const img = nativeImage.createFromBuffer(originalBuf)
  if (img.isEmpty()) {
    // SVG 等格式 nativeImage 可能无法处理，直接用原始 base64
    return { base64: originalBuf.toString('base64'), originalSize, compressedSize: originalSize }
  }

  const [w, h] = [img.getSize().width, img.getSize().height]

  // 宽度不超过 MAX_WIDTH 时不缩放，但仍转 JPEG 压缩
  let processed = img
  if (w > MAX_WIDTH) {
    const scale = MAX_WIDTH / w
    processed = img.resize({ width: MAX_WIDTH, height: Math.round(h * scale) })
  }

  const jpegBuf = processed.toJPEG(JPEG_QUALITY)
  return {
    base64: jpegBuf.toString('base64'),
    originalSize,
    compressedSize: jpegBuf.length,
  }
}

export function registerImageDescribeHandlers() {
  // 剪贴板图片保存为临时文件
  ipcMain.handle('image:saveClipboard', async (_event, data: { base64: string; ext: string }): Promise<string> => {
    const tmpDir = join(app.getPath('temp'), 'deepseek-chat-images')
    mkdirSync(tmpDir, { recursive: true })
    const name = `clipboard_${Date.now()}${data.ext}`
    const filePath = join(tmpDir, name)
    writeFileSync(filePath, Buffer.from(data.base64, 'base64'))
    console.log(`[image:saveClipboard] 保存到 ${filePath}`)
    return filePath
  })

  ipcMain.handle('image:describe', async (_event, config: {
    path: string
    apiKey: string
    baseUrl: string
    model: string
  }): Promise<{ description: string; error?: string }> => {
    try {
      const t0 = Date.now()
      const ext = extname(config.path).toLowerCase()
      if (!IMAGE_EXTS[ext]) {
        return { description: '', error: `不支持的图片格式: ${ext}` }
      }

      // 压缩图片
      const { base64, originalSize, compressedSize } = compressImage(config.path)
      const t1 = Date.now()
      console.log(`[image:describe] 压缩: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${t1 - t0}ms)`)

      const requestBody = JSON.stringify({
        model: config.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请详细描述这张图片的内容，包括所有可见的文本、物体、场景、颜色、布局、数据等细节。如果图片中有文字，请完整转述。' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          ],
        }],
      })

      const baseUrl = config.baseUrl.replace(/\/+$/, '')
      const bodySize = (Buffer.byteLength(requestBody, 'utf-8') / 1024).toFixed(0)
      console.log(`[image:describe] POST ${baseUrl}/chat/completions, model=${config.model}, body=${bodySize}KB`)

      const t2 = Date.now()
      const raw = await httpsPost(
        `${baseUrl}/chat/completions`,
        requestBody,
        { 'Authorization': `Bearer ${config.apiKey}` },
        60000,
      )
      const t3 = Date.now()
      console.log(`[image:describe] API 响应: ${(t3 - t2) / 1000}s, ${(raw.length / 1024).toFixed(0)}KB`)

      const resp = JSON.parse(raw)
      if (resp.error) {
        return { description: '', error: `API 错误: ${resp.error.message || JSON.stringify(resp.error)}` }
      }
      const description = resp?.choices?.[0]?.message?.content?.trim()
      if (!description) {
        return { description: '', error: `API 返回为空: ${raw.slice(0, 200)}` }
      }

      console.log(`[image:describe] 总耗时 ${(t3 - t0) / 1000}s (压缩 ${t1 - t0}ms + API ${t3 - t2}ms), 描述 ${description.length} chars`)
      return { description }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误'
      console.error('[image:describe] 失败:', msg)
      return { description: '', error: msg }
    }
  })
}
