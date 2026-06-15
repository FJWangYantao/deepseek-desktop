<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import InputDialog from '@/components/skills/InputDialog.vue'
import ToolConfirmDialog from '@/components/chat/ToolConfirmDialog.vue'
import PlanConfirmDialog from '@/components/chat/PlanConfirmDialog.vue'
import { useDSLRunner } from '@/composables/useDSLRunner'

const sessionStore = useSessionStore()
const chatStore = useChatStore()
const dslRunner = useDSLRunner()

function handleDSLResume(value: string) {
  dslRunner.resume(value)
}

function handleDSLCancel() {
  dslRunner.abort()
}

function handleToolApprove() {
  chatStore.resolveApproval(true)
}

function handleToolDeny() {
  chatStore.resolveApproval(false)
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <MessageList />
    <ToolConfirmDialog
      :info="chatStore.pendingApproval"
      @approve="handleToolApprove"
      @deny="handleToolDeny"
    />
    <PlanConfirmDialog
      :visible="chatStore.pendingPlanApproval"
      @confirm="chatStore.resolvePlanApproval"
      @cancel="chatStore.dismissPlanApproval"
    />
    <ChatInput />
    <InputDialog
      :pause-info="dslRunner.pauseInfo.value"
      @submit="handleDSLResume"
      @cancel="handleDSLCancel"
    />
  </div>
</template>
