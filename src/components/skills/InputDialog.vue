<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { DSLPauseInfo } from '@/types/dsl'

const props = defineProps<{
  pauseInfo: DSLPauseInfo | null
}>()

const emit = defineEmits<{
  submit: [value: string]
  cancel: []
}>()

const inputValue = ref('')
const validationError = ref('')
const visible = ref(false)

watch(() => props.pauseInfo, (info) => {
  if (info) {
    inputValue.value = info.default || ''
    validationError.value = ''
    visible.value = true
  } else {
    visible.value = false
  }
})

function validate(): boolean {
  if (!props.pauseInfo?.validate) return true
  try {
    const re = new RegExp(props.pauseInfo.validate)
    const ok = re.test(inputValue.value)
    if (!ok) validationError.value = '输入格式不匹配'
    else validationError.value = ''
    return ok
  } catch {
    validationError.value = ''
    return true
  }
}

function handleSubmit() {
  if (!validate()) return
  emit('submit', inputValue.value)
  visible.value = false
}

function handleCancel() {
  emit('cancel')
  visible.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') handleSubmit()
  if (e.key === 'Escape') handleCancel()
}
</script>

<template>
  <div
    v-if="visible && pauseInfo"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="handleCancel"
  >
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
      <h3 class="text-sm font-semibold text-gray-900 mb-1">{{ pauseInfo.stage }}</h3>
      <p class="text-sm text-gray-600 mb-4">{{ pauseInfo.prompt }}</p>

      <input
        v-model="inputValue"
        :placeholder="pauseInfo.default || '请输入...'"
        class="w-full px-3 py-2 text-sm border rounded-lg border-gray-300 focus:outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent/30 transition-colors"
        autofocus
        @keydown="handleKeydown"
      />

      <p v-if="validationError" class="text-xs text-red-500 mt-1.5">{{ validationError }}</p>

      <div class="flex items-center justify-end gap-2 mt-5">
        <button
          @click="handleCancel"
          class="text-xs px-4 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >取消</button>
        <button
          @click="handleSubmit"
          class="text-xs px-4 py-1.5 rounded-lg bg-app-accent text-white hover:bg-app-accent-hover transition-colors"
        >确认</button>
      </div>
    </div>
  </div>
</template>
