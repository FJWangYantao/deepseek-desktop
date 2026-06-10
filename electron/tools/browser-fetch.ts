import { BrowserWindow } from 'electron'

let hiddenWin: BrowserWindow | null = null

function getHiddenWindow(): BrowserWindow {
  if (hiddenWin && !hiddenWin.isDestroyed()) return hiddenWin

  hiddenWin = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  hiddenWin.on('closed', () => { hiddenWin = null })
  return hiddenWin
}

/**
 * 使用 Electron 内置浏览器渲染页面后提取文本内容
 * 适用于反爬严格的网站（知乎等）——真实 Chromium 渲染，JS 完全执行
 */
export async function browserFetch(url: string, timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    const win = getHiddenWindow()
    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { win.webContents.stop() } catch {}
      resolve('') // 超时返回空
    }, timeout)

    // 页面加载完成
    const onFinish = () => {
      if (done) return
      done = true
      clearTimeout(timer)

      // 等待 500ms 让动态内容渲染
      setTimeout(async () => {
        try {
          const text = await win.webContents.executeJavaScript(`
            (function() {
              // 移除干扰元素
              const remove = 'script,style,nav,footer,header,noscript,iframe,aside,[role="navigation"],.sidebar,.nav,.footer,.header,.ad,.advertisement,.menu,[aria-hidden="true"],.modal,.overlay,.popup,.login,.signin'
              document.querySelectorAll(remove).forEach(el => el.remove())
              // 获取主要内容区域或 body 文本
              const main = document.querySelector('article,main,.content,.post,.article,[role="main"],#content,.RichText,.Post-RichText') || document.body
              return (main.textContent || main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim()
            })()
          `)
          resolve(text || '')
        } catch {
          resolve('')
        }
      }, 500)
    }

    const onFail = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve('')
    }

    try {
      win.webContents.loadURL(url, { httpReferrer: 'https://www.google.com/' })
      win.webContents.once('did-finish-load', onFinish)
      win.webContents.once('did-fail-load', onFail)
    } catch {
      onFail()
    }
  })
}

export function destroyBrowserFetcher() {
  if (hiddenWin && !hiddenWin.isDestroyed()) {
    hiddenWin.close()
    hiddenWin = null
  }
}
