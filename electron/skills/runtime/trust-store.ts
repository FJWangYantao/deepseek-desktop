/**
 * Skill Trust Store。
 *
 * P2 决策 4：首次执行时用户批准，记住选择（per-skill）。
 *
 * 不参与执行决策的"硬"判断（那是 script-run 的边界、bins 白名单）。
 * 只回答："这个 skill 当前有没有用户授权能执行 bin？"
 *
 * 文件：userData/skills-trust.json
 *   {
 *     "version": 1,
 *     "entries": {
 *       "todoist-cli": {
 *         "decision": "trusted" | "denied",
 *         "scope": "always",
 *         "decidedAt": 1733...,
 *         "version": "1.0.9"        // 决策当时的版本，version 变了会重新询问
 *       }
 *     }
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type TrustDecision = 'trusted' | 'denied'

export interface TrustEntry {
  decision: TrustDecision
  scope: 'always'
  decidedAt: number
  /** 用户做决定时的 skill 版本；version 升级后清回 pending */
  version?: string
}

export interface TrustStore {
  version: 1
  entries: Record<string, TrustEntry>
}

const FILE_NAME = 'skills-trust.json'

export function trustPath(userDataDir: string): string {
  return join(userDataDir, FILE_NAME)
}

function fresh(): TrustStore {
  return { version: 1, entries: {} }
}

export function loadTrustStore(userDataDir: string): TrustStore {
  const path = trustPath(userDataDir)
  if (!existsSync(path)) return fresh()
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (data && typeof data === 'object' && data.version === 1 && data.entries && typeof data.entries === 'object') {
      return data as TrustStore
    }
  } catch { /* ignore */ }
  return fresh()
}

export function saveTrustStore(userDataDir: string, store: TrustStore): void {
  writeFileSync(trustPath(userDataDir), JSON.stringify(store, null, 2), 'utf-8')
}

export type TrustCheck =
  | { state: 'trusted' }
  | { state: 'denied' }
  | { state: 'pending', reason: string }

/**
 * 检查 skill 当前是否已被信任。
 * 'pending' 的两种触发：从来没决策过 / 决策当时的版本与当前不一致（升级后重新询问）。
 */
export function checkTrust(store: TrustStore, skillId: string, currentVersion?: string): TrustCheck {
  const entry = store.entries[skillId]
  if (!entry) return { state: 'pending', reason: '该 Skill 从未被授权执行外部命令' }
  if (entry.decision === 'denied') return { state: 'denied' }
  if (currentVersion && entry.version && entry.version !== currentVersion) {
    return { state: 'pending', reason: `Skill 已从 v${entry.version} 升级到 v${currentVersion}，需要重新授权` }
  }
  return { state: 'trusted' }
}

export function recordDecision(userDataDir: string, skillId: string, decision: TrustDecision, version?: string): void {
  const store = loadTrustStore(userDataDir)
  store.entries[skillId] = {
    decision,
    scope: 'always',
    decidedAt: Date.now(),
    version,
  }
  saveTrustStore(userDataDir, store)
}

export function revokeTrust(userDataDir: string, skillId: string): boolean {
  const store = loadTrustStore(userDataDir)
  if (!store.entries[skillId]) return false
  delete store.entries[skillId]
  saveTrustStore(userDataDir, store)
  return true
}