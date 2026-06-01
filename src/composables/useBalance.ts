import { ref } from 'vue'
import type { BalanceInfo } from '@/types'

export function useBalance() {
  const balance = ref<BalanceInfo[]>([])
  const loading = ref(false)
  const error = ref('')

  async function fetchBalance(apiKey: string) {
    if (!apiKey) return
    loading.value = true
    error.value = ''
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      balance.value = data.balance_infos ?? []
    } catch (e) {
      error.value = e instanceof Error ? e.message : '查询失败'
    } finally {
      loading.value = false
    }
  }

  return { balance, loading, error, fetchBalance }
}
