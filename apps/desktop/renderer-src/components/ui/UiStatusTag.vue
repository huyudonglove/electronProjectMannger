<script setup lang="ts">
import { computed } from 'vue'
import {
  statusPresentation,
  type StatusLabelDomain,
} from '../../utils/record-presentation'
import UiTag from './UiTag.vue'

const props = withDefaults(defineProps<{
  status?: string | null
  domain?: StatusLabelDomain
  label?: string
}>(), {
  status: '',
  domain: 'record',
})

const presentation = computed(() => statusPresentation(props.status, {
  domain: props.domain,
  labelOverride: props.label,
}))
</script>

<template>
  <UiTag
    :label="presentation.label"
    :tone="presentation.tone"
    :icon-name="presentation.icon"
    variant="status"
  />
</template>
