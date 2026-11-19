<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import {computed} from 'vue'
import {usePersonalAppearance} from '@/composables/usePersonalAppearance'
const props=withDefaults(defineProps<{ name: string; tone?: 'ink' | 'green' | 'white' | 'muted' | 'gold'; size?: number; preserveTone?:boolean }>(), { tone: 'ink', size: 20, preserveTone:false })
const appearance=usePersonalAppearance()
const iconTone=computed(()=>!props.preserveTone&&appearance.effective.value.mode==='dark'&&['ink','muted','green'].includes(props.tone)?'white':props.tone)
</script>
<template><image class="app-icon" :src="`/static/icons/${name}-${iconTone}.png`" :style="{ width: `${size}px`, height: `${size}px` }" mode="aspectFit" aria-hidden="true" /></template>
