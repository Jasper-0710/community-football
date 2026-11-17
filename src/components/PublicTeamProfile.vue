<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, onMounted, onUnmounted } from 'vue'
import { getPublicTeam } from '@/services/content'
import type { PublicTeam } from '@/domain/content'
import { positionLabel } from '@/domain/team'
const props = defineProps<{ id: string }>()
const badgeFailed=ref(false)
const team = ref<PublicTeam | null>(null), busy = ref(false), error = ref('')
let generation = 0
async function load() { const serial = ++generation; badgeFailed.value=false; team.value = null; busy.value = true; error.value = ''; try { const t = await getPublicTeam(props.id); if (serial === generation) team.value = t } catch (e) { if (serial === generation) error.value = e instanceof Error ? e.message : '球队资料暂不可用。' } finally { if (serial === generation) busy.value = false } }
function player(id: string) { uni.navigateTo({ url: `/pages/player/detail?id=${id}&teamId=${props.id}` }) }
onMounted(() => { void load() }); onUnmounted(() => { generation++ })
</script>
<template><view class="inner-page public-team-profile"><template v-if="team"><view class="page-heading public-team-heading"><view class="team-default-crest"><image v-if="team.badgeUrl&&!badgeFailed" :src="team.badgeUrl" mode="aspectFit" aria-label="球队队徽" @error="badgeFailed=true"/><text v-else>{{ team.name.slice(0,1) }}</text></view><view class="public-team-heading-copy"><text class="eyebrow">{{ team.district }}</text><text class="page-title">{{ team.name }}</text><text class="page-description">公开参赛球队</text></view></view><button v-if="team.hasBadge&&(!team.badgeUrl||badgeFailed)" class="ui-button outline-button" :disabled="busy" @click="load">重新加载队徽</button><view class="panel content-profile-about"><text>{{ team.description || '球队暂未填写介绍。' }}</text></view><view class="section-heading"><text class="section-title">球队名单</text><text class="muted">{{ team.players.length }}人</text></view><view v-if="!team.players.length" class="empty-state"><text>暂无公开球员名单</text></view><view class="roster-grid"><button role="button" tabindex="0" v-for="p in team.players" :key="p.id" class="ui-button panel roster-card" @click="player(p.id)"><text class="jersey-number">{{ p.number }}</text><view><text class="h3">{{ p.name }}</text><text class="muted small-text">{{ positionLabel(p.position) }}</text></view></button></view></template><view v-else class="empty-state"><text>{{ error || (busy ? '正在读取球队…' : '暂无球队资料') }}</text><button role="button" tabindex="0" v-if="error" class="ui-button outline-button" @click="load">重新读取球队</button></view></view></template>
