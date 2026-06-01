<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
</script>

<template>
  <div class="h-full flex">
    <Sidebar />
    <router-view />
  </div>
</template>
