<script setup lang="ts">
import {useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>load())
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, onMounted, onUnmounted } from 'vue'
import { getPublicTeam } from '@/services/content'
import type { PublicTeam } from '@/domain/content'
import { positionLabel } from '@/domain/team'
import { useFavorites } from '@/composables/useFavorites'
import { favoriteTeam } from '@/domain/favorites'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ id: string }>()
const badgeFailed=ref(false)
const team = ref<PublicTeam | null>(null), busy = ref(false), error = ref('')
const { owner, favoriteIds, busy: favoriteBusy, ready, error: favoriteError, notice, storageError, refresh, toggle } = useFavorites()
function follow() { if (team.value) void toggle(favoriteTeam(team.value)) }
let generation = 0
async function load() { const serial = ++generation; badgeFailed.value=false; team.value = null; busy.value = true; error.value = ''; try { const t = await getPublicTeam(props.id); if (serial === generation) team.value = t } catch (e) { if (serial === generation) error.value = e instanceof Error ? e.message : '球队资料暂不可用。' } finally { if (serial === generation) busy.value = false } }
function player(id: string) { uni.navigateTo({ url: `/pages/player/detail?id=${id}&teamId=${props.id}` }) }
onMounted(() => { void load(); void refresh() }); onUnmounted(() => { generation++ })
</script>
<template><view class="inner-page public-team-profile"><template v-if="team"><view class="page-heading public-team-heading"><view class="team-default-crest"><image v-if="team.badgeUrl&&!badgeFailed" :src="team.badgeUrl" mode="aspectFit" aria-label="球队队徽" @error="badgeFailed=true"/><text v-else>{{ team.name.slice(0,1) }}</text></view><view class="public-team-heading-copy"><text class="eyebrow">{{ team.district }}</text><text class="page-title">{{ team.name }}</text><text class="page-description">公开参赛球队</text></view></view><button v-if="team.hasBadge&&(!team.badgeUrl||badgeFailed)" class="ui-button outline-button" :disabled="busy" @click="load">重新加载队徽</button><view class="public-team-follow"><button id="public-team-follow" role="button" tabindex="0" hover-class="none" class="ui-button primary-button" :disabled="favoriteBusy || (!!owner && !ready)" :aria-pressed="favoriteIds.includes(id)" @click="follow"><AppIcon :name="favoriteIds.includes(id) ? 'check' : 'heart'" tone="white" :size="18"/>{{ favoriteBusy ? '正在同步收藏…' : favoriteIds.includes(id) ? '已关注 · 点击取消' : '关注这支球队' }}</button><text class="muted small-text">{{ owner ? '收藏随当前微信账号保存，可在其他设备恢复' : '游客关注保存在本机，登录后可手动合并' }}</text><text v-if="favoriteError || storageError" class="favorites-error" role="alert">{{ favoriteError || storageError }}</text><text v-if="notice" class="favorites-notice" role="status">{{ notice }}</text><button v-if="favoriteError" role="button" tabindex="0" class="ui-button text-button" :disabled="favoriteBusy" @click="refresh">重新同步收藏</button></view><view class="panel content-profile-about"><text>{{ team.description || '球队暂未填写介绍。' }}</text></view><view class="section-heading"><text class="section-title">球队名单</text><text class="muted">{{ team.players.length }}人</text></view><view v-if="!team.players.length" class="empty-state"><text>暂无公开球员名单</text></view><view class="roster-grid"><button role="button" tabindex="0" v-for="p in team.players" :key="p.id" class="ui-button panel roster-card" @click="player(p.id)"><text class="jersey-number">{{ p.number }}</text><view><text class="h3">{{ p.name }}</text><text class="muted small-text">{{ positionLabel(p.position) }}</text></view></button></view></template><view v-else class="empty-state"><text>{{ error || (busy ? '正在读取球队…' : '暂无球队资料') }}</text><button role="button" tabindex="0" v-if="error" class="ui-button outline-button" @click="load">重新读取球队</button></view></view></template>
