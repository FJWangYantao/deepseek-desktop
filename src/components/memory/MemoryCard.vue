<script setup lang="ts">
import { ref } from 'vue'
import type { MemoryItem, MemoryLayer } from '@/types/memory'

const props = defineProps<{
  item: MemoryItem
}>()

const emit = defineEmits<{
  update: [id: string, updates: Partial<Pick<MemoryItem, 'content' | 'layer' | 'category'>>]
  delete: [id: string]
}>()

const editing = ref(false)
const editContent = ref('')
const editLayer = ref<MemoryLayer>('short')
const editCategory = ref('')

const layerLabels: Record<MemoryLayer, string> = { short: '短期', medium: '中期', long: '长期' }

function startEdit() {
  editContent.value = props.item.content
  editLayer.value = props.item.layer
  editCategory.value = props.item.category
  editing.value = true
}

function save() {
  emit('update', props.item.id, {
    content: editContent.value.trim(),
    layer: editLayer.value,
    category: editCategory.value.trim() || '未分类',
  })
  editing.value = false
}

function cancel() {
  editing.value = false
}

function confirmDelete() {
  if (confirm('确定删除这条记忆？')) {
    emit('delete', props.item.id)
  }
}
</script>

<template>
  <div class="bg-app-card border border-app-border rounded-lg px-3.5 py-3 group hover:border-app-accent-soft-border transition-colors">
    <template v-if="editing">
      <div class="flex flex-col gap-2">
        <textarea
          v-model="editContent"
          rows="2"
          class="w-full px-2.5 py-1.5 text-sm rounded border border-app-border bg-app-input
                 text-app-text focus:outline-none focus:border-app-accent resize-none"
        ></textarea>
        <div class="flex items-center gap-2">
          <select
            v-model="editLayer"
            class="text-xs px-2 py-1 rounded border border-app-border bg-app-input text-app-text"
          >
            <option value="short">短期</option>
            <option value="medium">中期</option>
            <option value="long">长期</option>
          </select>
          <input
            v-model="editCategory"
            placeholder="分类名称"
            class="flex-1 text-xs px-2 py-1 rounded border border-app-border bg-app-input text-app-text focus:outline-none focus:border-app-accent"
          />
          <button @click="save" class="text-xs px-2 py-1 rounded bg-app-accent text-white hover:bg-app-accent-hover">保存</button>
          <button @click="cancel" class="text-xs px-2 py-1 rounded text-app-muted hover:text-app-text">取消</button>
        </div>
      </div>
    </template>
    <template v-else>
      <p class="text-sm text-app-text leading-relaxed">{{ item.content }}</p>
      <div class="flex items-center justify-between mt-2">
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            :class="{
              'bg-blue-100 text-blue-700': item.layer === 'short',
              'bg-amber-100 text-amber-700': item.layer === 'medium',
              'bg-emerald-100 text-emerald-700': item.layer === 'long',
            }"
          >{{ layerLabels[item.layer] }}</span>
          <span class="text-[10px] text-app-muted">{{ item.category }}</span>
          <span class="text-[10px] text-app-muted">
            {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
          </span>
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            @click="startEdit"
            class="w-6 h-6 flex items-center justify-center rounded text-app-muted hover:text-app-text hover:bg-app-hover"
            title="编辑"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            @click="confirmDelete"
            class="w-6 h-6 flex items-center justify-center rounded text-app-muted hover:text-red-500 hover:bg-red-50"
            title="删除"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
