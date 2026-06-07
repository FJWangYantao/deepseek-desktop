import { execSync, spawn } from 'child_process'

// Windows: 先在当前终端设置 UTF-8 编码，再启动 vite
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
}

const child = spawn('vite', [], { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
