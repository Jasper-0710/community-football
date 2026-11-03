<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Team } from '@/domain/types'
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
const props = withDefaults(defineProps<{ team?: Team; size?: number }>(), { size: 44 })
const failed = ref(false)
watch(() => props.team?.badge, () => { failed.value = false })
</script>
<template><image v-if="team && !failed" class="team-badge" :src="team.badge" :style="{ width: `${size}px`, height: `${size * 1.06}px` }" :aria-label="team.name" mode="aspectFit" @error="failed = true" /><view v-else class="unknown-badge" :style="{ width: `${size}px`, height: `${size}px`, fontSize: team ? `${Math.max(10, size / 3)}px` : `${size / 2}px` }">{{ team?.shortName || '?' }}</view></template>
