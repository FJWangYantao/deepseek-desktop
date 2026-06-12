/**
 * 手动 e2e：连真实 ClawHub registry，跑通 探测 → 安装 → 依赖体检 → 卸载 整条链路。
 * 用法：npx tsx tests/e2e-clawhub.ts [slug]
 * 不依赖 Electron；skillsDir 用临时目录，userData 用临时目录。
 */
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ClawHubClient } from '../electron/skills/clawhub/client'
import { installFromClawHub, uninstallClawHubSkill, listInstalled } from '../electron/skills/clawhub/installer'
import { parseFrontmatter, extractOpenClawMetadata } from '../electron/skills/frontmatter'
import { checkBin } from '../electron/skills/runtime/bin-resolver'
import { runScript } from '../electron/skills/runtime/script-run'
import type { SkillRuntimeMetadata } from '../src/types/skills'

function log(...a: unknown[]) { console.log('[e2e]', ...a) }

async function main() {
  const c = new ClawHubClient()
  log('registry baseUrl =', c.baseUrl)

  // 1. 列表探测
  let slug = process.argv[2]
  try {
    const list = await c.listSkills({ limit: 10 })
    const items = (list as any).items ?? (list as any).skills ?? []
    log('listSkills OK, 拿到', items.length, '条')
    for (const it of items.slice(0, 10)) {
      log('  -', it.slug ?? it.name ?? JSON.stringify(it).slice(0, 80))
    }
    if (!slug && items.length) slug = items[0].slug ?? items[0].name
  } catch (e) {
    log('listSkills 失败：', (e as Error).message)
  }

  if (!slug) {
    log('没有可用 slug，结束。可手动传：npx tsx tests/e2e-clawhub.ts <slug>')
    return
  }
  log('目标 slug =', slug)

  // 2. 元信息 + 版本 manifest
  try {
    const meta = await c.getSkill(slug)
    const v = (meta as any).latestVersion?.version ?? (meta as any).skill?.tags?.latest
    log('getSkill OK, latestVersion =', v)
    if (v) {
      const detail = await c.getVersion(slug, v)
      log('getVersion OK, files =', detail.version.files?.length, 'sha256hash =', detail.version.security?.sha256hash?.slice(0, 16))
    }
  } catch (e) {
    log('getSkill/getVersion 失败：', (e as Error).message)
  }

  // 3. 安装到临时目录
  const skillsDir = mkdtempSync(join(tmpdir(), 'clawhub-e2e-'))
  log('skillsDir =', skillsDir)
  try {
    const res = await installFromClawHub({ slug, skillsDir })
    log('install 结果：', JSON.stringify(res))
    if (res.ok) {
      const dir = join(skillsDir, slug)
      log('落盘文件：', existsSync(dir) ? readdirSync(dir) : '(目录不存在)')
      const originPath = join(dir, '.clawhub', 'origin.json')
      if (existsSync(originPath)) log('origin.json =', readFileSync(originPath, 'utf-8'))
      log('lock =', JSON.stringify(listInstalled(skillsDir).entries[slug]))

      // 4. 解析装出来的 SKILL.md → runtime 声明
      const skillMdPath = join(dir, 'SKILL.md')
      let runtime: SkillRuntimeMetadata | undefined
      if (existsSync(skillMdPath)) {
        const parsed = parseFrontmatter(readFileSync(skillMdPath, 'utf-8'))
        const oc = parsed ? extractOpenClawMetadata(parsed.meta) : undefined
        runtime = oc as SkillRuntimeMetadata | undefined
        log('frontmatter 解析 OK, runtime =', JSON.stringify(oc ?? '(无 openclaw 元数据)'))
      } else {
        log('⚠ 没有 SKILL.md，跳过执行层验证')
      }

      // 5. 依赖体检（复刻 deps-check 判定，绕开 electron app）
      const reqBins = runtime?.requires?.bins ?? []
      const anyBins = runtime?.requires?.anyBins ?? []
      for (const b of [...reqBins, ...anyBins]) {
        const r = checkBin(b)
        log(`  bin "${b}": ${r.found ? '✓ ' + r.path : '✗ 未在 PATH'}`)
      }

      // 6. 执行层验证
      //    a) 白名单拦截：未声明的命令必须被拒
      if (runtime) {
        const blocked = await runScript({
          skillId: slug, runtime, command: '__definitely_not_declared__',
          args: [], requiredEnv: [], optionalEnv: [],
        })
        log(`  白名单拦截未声明命令：${!blocked.ok && blocked.errorCode === 'command-not-allowed' ? '✓' : '✗ ' + JSON.stringify(blocked)}`)
      }

      //    b) 真实执行 + ${ENV} 占位符展开：构造一个声明了 node 的临时 runtime，
      //       跑 `node -e` 回显被占位符替换后的值，证明执行链路与 env 注入可用。
      const probeBin = process.platform === 'win32' ? 'node' : 'node'
      const probe = checkBin(probeBin)
      if (probe.found) {
        process.env.E2E_PROBE_SECRET = 'injected-value-42'
        const probeRuntime = { requires: { bins: ['node'] } } as SkillRuntimeMetadata
        const exec = await runScript({
          skillId: slug, runtime: probeRuntime, command: 'node',
          args: ['-e', 'process.stdout.write(process.argv[1])', '${E2E_PROBE_SECRET}'],
          requiredEnv: [], optionalEnv: ['E2E_PROBE_SECRET'],
        })
        const okExpand = exec.ok && exec.stdout.trim() === 'injected-value-42'
        log(`  执行 node + 占位符展开：${okExpand ? '✓ stdout=' + exec.stdout.trim() : '✗ ' + JSON.stringify(exec)}`)
        delete process.env.E2E_PROBE_SECRET
      } else {
        log('  ⚠ 系统无 node，跳过真实执行验证')
      }

      // 7. 卸载
      const un = uninstallClawHubSkill(skillsDir, slug)
      log('uninstall =', un, '剩余目录存在？', existsSync(dir))
    }
  } catch (e) {
    log('install 抛错：', (e as Error).stack || (e as Error).message)
  } finally {
    rmSync(skillsDir, { recursive: true, force: true })
    log('临时目录已清理')
  }
}

main().then(() => log('done')).catch(e => { console.error('[e2e] fatal', e); process.exit(1) })
