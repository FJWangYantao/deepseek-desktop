<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DSLStep, DSLPromptStep, DSLConditionStep, DSLToolStep, DSLInputStep, DSLOutputStep, DSLLoopStep } from '@/types/dsl'

const props = defineProps<{
  steps: DSLStep[]
}>()

const emit = defineEmits<{
  'update:steps': [steps: DSLStep[]]
}>()

const expanded = ref<Set<number>>(new Set())

const typeLabels: Record<DSLStep['type'], string> = {
  prompt: 'Prompt', condition: '条件', tool: '工具', input: '输入', output: '输出', loop: '循环',
}

const typeColors: Record<DSLStep['type'], string> = {
  prompt: 'bg-blue-100 text-blue-700', condition: 'bg-amber-100 text-amber-700', tool: 'bg-purple-100 text-purple-700',
  input: 'bg-cyan-100 text-cyan-700', output: 'bg-emerald-100 text-emerald-700', loop: 'bg-rose-100 text-rose-700',
}

function toggle(idx: number) {
  if (expanded.value.has(idx)) expanded.value.delete(idx)
  else expanded.value.add(idx)
}

function updateStep(idx: number, patch: Partial<DSLStep>) {
  const updated = [...props.steps]
  updated[idx] = { ...updated[idx], ...patch } as DSLStep
  emit('update:steps', updated)
}

function removeStep(idx: number) {
  const updated = [...props.steps]
  updated.splice(idx, 1)
  expanded.value.delete(idx)
  emit('update:steps', updated)
}

function addStep(type: DSLStep['type']) {
  const base = { stage: `step_${props.steps.length + 1}` }
  const newStep: DSLStep = (() => {
    switch (type) {
      case 'prompt': return { ...base, type, prompt: '' } as DSLPromptStep
      case 'condition': return { ...base, type, condition: '', then: [] } as DSLConditionStep
      case 'tool': return { ...base, type, tool: '', params: {} } as DSLToolStep
      case 'input': return { ...base, type, input: '' } as DSLInputStep
      case 'output': return { ...base, type, output: { format: 'markdown', template: '' } } as DSLOutputStep
      case 'loop': return { ...base, type, loop: { as: 'i' }, steps: [] } as DSLLoopStep
    }
  })()
  emit('update:steps', [...props.steps, newStep])
}

function updateNested(idx: number, steps: DSLStep[]) {
  const updated = [...props.steps]
  const s = updated[idx]
  if (s.type === 'condition') { (s as any).then = steps }
  else if (s.type === 'loop') { (s as any).steps = steps }
  emit('update:steps', updated)
}
</script>

<template>
  <div class="space-y-2">
    <!-- Add buttons -->
    <div class="flex flex-wrap items-center gap-1 mb-3">
      <span class="text-[10px] text-app-muted mr-1">添加步骤：</span>
      <button v-for="t in (['prompt','condition','tool','input','output','loop'] as const)" :key="t"
        @click="addStep(t)"
        class="text-[10px] px-2 py-0.5 rounded border transition-colors"
        :class="typeColors[t].replace('text-', 'border-').split(' ')[0] + ' text-app-muted hover:' + typeColors[t]"
      >+ {{ typeLabels[t] }}</button>
    </div>

    <!-- Step list -->
    <div v-for="(step, idx) in steps" :key="idx"
      class="border border-app-border rounded-lg overflow-hidden bg-app-card"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-app-hover/50 transition-colors"
        @click="toggle(idx)"
      >
        <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0" :class="typeColors[step.type]">
          {{ typeLabels[step.type] }}
        </span>
        <input :value="step.stage" @input.stop @click.stop
          @change="updateStep(idx, { stage: ($event.target as HTMLInputElement).value } as any)"
          placeholder="stage 名称"
          class="flex-1 text-xs px-1.5 py-0.5 rounded bg-transparent text-app-text border border-transparent
                 hover:border-app-border focus:border-app-accent focus:outline-none transition-colors"
        />
        <button @click.stop="removeStep(idx)" class="text-[10px] text-app-muted hover:text-red-500 shrink-0">✕</button>
      </div>

      <!-- Body -->
      <div v-if="expanded.has(idx)" class="px-3 pb-3 space-y-2 border-t border-app-border/50 pt-2">

        <template v-if="step.type === 'prompt'">
          <textarea :value="(step as DSLPromptStep).prompt" @input="updateStep(idx, { prompt: ($event.target as HTMLTextAreaElement).value } as any)"
            placeholder="输入 prompt 模板内容，支持 {{变量}} 插值..."
            rows="4"
            class="w-full px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-bg text-app-text font-mono
                   focus:outline-none focus:border-app-accent resize-y"
          ></textarea>
        </template>

        <template v-if="step.type === 'condition'">
          <div>
            <label class="text-[10px] text-app-muted block mb-1">条件表达式</label>
            <input :value="(step as DSLConditionStep).condition" @input="updateStep(idx, { condition: ($event.target as HTMLInputElement).value } as any)"
              placeholder="例：{{step.output}} 包含 错误"
              class="w-full px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-bg text-app-text
                     focus:outline-none focus:border-app-accent"
            />
          </div>
          <div>
            <label class="text-[10px] text-app-muted block mb-1">Then 分支</label>
            <DSLStepEditor :steps="(step as DSLConditionStep).then" @update:steps="(s: any) => { const u = {...step}; (u as any).then = s; updateStep(idx, u) }" />
          </div>
          <div>
            <label class="text-[10px] text-app-muted block mb-1">Else 分支（可选）</label>
            <DSLStepEditor :steps="(step as DSLConditionStep).else || []" @update:steps="(s: any) => { const u = {...step}; (u as any).else = s; updateStep(idx, u) }" />
          </div>
        </template>

        <template v-if="step.type === 'tool'">
          <div>
            <label class="text-[10px] text-app-muted block mb-1">工具标识（mcp:server_id/tool_name）</label>
            <input :value="(step as DSLToolStep).tool" @input="updateStep(idx, { tool: ($event.target as HTMLInputElement).value } as any)"
              placeholder="mcp:context7/query-docs"
              class="w-full px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-bg text-app-text font-mono
                     focus:outline-none focus:border-app-accent"
            />
          </div>
        </template>

        <template v-if="step.type === 'input'">
          <div>
            <label class="text-[10px] text-app-muted block mb-1">提示文本</label>
            <input :value="(step as DSLInputStep).input" @input="updateStep(idx, { input: ($event.target as HTMLInputElement).value } as any)"
              placeholder="给用户的提示：请输入...?"
              class="w-full px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-bg text-app-text
                     focus:outline-none focus:border-app-accent"
            />
          </div>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="text-[10px] text-app-muted block mb-1">默认值</label>
              <input :value="(step as DSLInputStep).default" @input="updateStep(idx, { default: ($event.target as HTMLInputElement).value } as any)"
                class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-app-text focus:outline-none focus:border-app-accent"
              />
            </div>
            <div class="flex-1">
              <label class="text-[10px] text-app-muted block mb-1">校验正则</label>
              <input :value="(step as DSLInputStep).validate" @input="updateStep(idx, { validate: ($event.target as HTMLInputElement).value } as any)"
                placeholder="/\\w+/"
                class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-app-text font-mono focus:outline-none focus:border-app-accent"
              />
            </div>
          </div>
        </template>

        <template v-if="step.type === 'output'">
          <div class="flex gap-2 items-center mb-2">
            <label class="text-[10px] text-app-muted">格式：</label>
            <select :value="(step as DSLOutputStep).output.format" @change="updateStep(idx, { output: { ...(step as DSLOutputStep).output, format: ($event.target as HTMLSelectElement).value } } as any)"
              class="text-xs px-2 py-1 rounded border border-app-border bg-app-bg text-app-text focus:outline-none focus:border-app-accent"
            >
              <option value="markdown">Markdown</option>
              <option value="text">Text</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div>
            <label class="text-[10px] text-app-muted block mb-1">输出模板</label>
            <textarea :value="(step as DSLOutputStep).output.template" @input="updateStep(idx, { output: { ...(step as DSLOutputStep).output, template: ($event.target as HTMLTextAreaElement).value } } as any)"
              rows="3"
              class="w-full px-2.5 py-1.5 text-xs rounded border border-app-border bg-app-bg text-app-text font-mono
                     focus:outline-none focus:border-app-accent resize-y"
            ></textarea>
          </div>
        </template>

        <template v-if="step.type === 'loop'">
          <div class="space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex-1 min-w-[80px]">
                <label class="text-[10px] text-app-muted block mb-0.5">次数 (times)</label>
                <input :value="(step as DSLLoopStep).loop.times" @input="updateStep(idx, { loop: { ...(step as DSLLoopStep).loop, times: parseInt(($event.target as HTMLInputElement).value) || undefined } } as any)"
                  type="number" min="1"
                  class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
              <div class="flex-1 min-w-[120px]">
                <label class="text-[10px] text-app-muted block mb-0.5">停止条件 (until)</label>
                <input :value="(step as DSLLoopStep).loop.until" @input="updateStep(idx, { loop: { ...(step as DSLLoopStep).loop, until: ($event.target as HTMLInputElement).value } } as any)"
                  placeholder="{{output}} 不包含 错误"
                  class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
              <div class="flex-1 min-w-[100px]">
                <label class="text-[10px] text-app-muted block mb-0.5">遍历 (each)</label>
                <input :value="(step as DSLLoopStep).loop.each" @input="updateStep(idx, { loop: { ...(step as DSLLoopStep).loop, each: ($event.target as HTMLInputElement).value } } as any)"
                  placeholder="{{files}}"
                  class="w-full px-2 py-1 text-xs rounded border border-app-border bg-app-bg text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
            </div>
            <div>
              <label class="text-[10px] text-app-muted block mb-1">子步骤</label>
              <DSLStepEditor :steps="(step as DSLLoopStep).steps" @update:steps="(s: any) => { const u = {...step}; (u as any).steps = s; updateStep(idx, u) }" />
            </div>
          </div>
        </template>

      </div>
    </div>

    <div v-if="steps.length === 0" class="text-xs text-app-muted text-center py-6">
      暂无步骤。点击上方按钮添加第一个步骤。
    </div>
  </div>
</template>
