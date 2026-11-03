<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
withDefaults(defineProps<{ name: string; tone?: 'ink' | 'green' | 'white' | 'muted' | 'gold'; size?: number }>(), { tone: 'ink', size: 20 })
</script>
<template><image class="app-icon" :src="`/static/icons/${name}-${tone}.png`" :style="{ width: `${size}px`, height: `${size}px` }" mode="aspectFit" aria-hidden="true" /></template>
