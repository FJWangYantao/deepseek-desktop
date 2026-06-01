<script setup lang="ts">
defineProps<{
  title: string
  value: string
  sub?: string
  accent?: boolean
}>()
</script>

<template>
  <div
    class="rounded-xl border p-4"
    :class="accent ? 'border-app-accent bg-app-accent-soft' : 'border-app-border bg-app-card'"
  >
    <p class="text-xs text-app-muted mb-1">{{ title }}</p>
    <p class="text-2xl font-semibold" :class="accent ? 'text-app-accent' : 'text-app-text'">{{ value }}</p>
    <p v-if="sub" class="text-xs text-app-muted mt-1">{{ sub }}</p>
  </div>
</template>
