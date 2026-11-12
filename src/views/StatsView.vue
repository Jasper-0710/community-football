<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import PublicStandings from '@/components/PublicStandings.vue'
import AppIcon from '@/components/AppIcon.vue'
</script>
<template><view class="inner-page"><view class="page-heading"><view><text class="eyebrow">EVERY EFFORT COUNTS</text><text class="page-title">让每份努力，被看见。</text><text class="page-description">查看公开赛事的积分、个人表现与晋级之路。</text></view><view class="page-emblem"><AppIcon name="trophy" tone="green" :size="44" /></view></view><PublicStandings /></view></template>
