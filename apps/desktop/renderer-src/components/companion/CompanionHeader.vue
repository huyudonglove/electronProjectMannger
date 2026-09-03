<script setup lang="ts">
import UiIconButton from '../ui/UiIconButton.vue'

const props = defineProps<{
  title: string
  subtitle: string
  canGoBack: boolean
  busy: boolean
  pinned: boolean
  switching: boolean
}>()

const emit = defineEmits<{
  back: []
  create: []
  togglePinned: []
  refresh: []
  restore: []
}>()
</script>

<template>
  <header class="companion-header">
    <div class="companion-identity">
      <UiIconButton v-if="props.canGoBack" icon="cornerUpLeft" label="返回" variant="ghost" size="sm" @click="emit('back')" />
      <span v-else class="companion-mark">T</span>
      <span>
        <strong>{{ props.title }}</strong>
        <small>{{ props.subtitle }}</small>
      </span>
    </div>
    <div class="companion-actions">
      <UiIconButton class="companion-create" icon="plus" label="新增记录" variant="ghost" size="sm" :disabled="props.busy" @click="emit('create')" />
      <UiIconButton :icon="props.pinned ? 'pinOff' : 'pin'" :label="props.pinned ? '取消窗口置顶' : '窗口置顶'" variant="ghost" size="sm" :disabled="props.switching" @click="emit('togglePinned')" />
      <UiIconButton icon="refresh" label="刷新记录" variant="ghost" size="sm" :disabled="props.busy" @click="emit('refresh')" />
      <UiIconButton icon="maximize" label="恢复完整模式" variant="ghost" size="sm" :disabled="props.switching" @click="emit('restore')" />
    </div>
  </header>
</template>
