<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'

const sessionStore = useSessionStore()
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <ChatHeader />
    <MessageList />
    <ChatInput />
  </div>
</template>
