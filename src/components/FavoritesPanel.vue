<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, onMounted } from 'vue'
import type { Team } from '@/domain/types'
import { useFavorites } from '@/composables/useFavorites'
import { useDemoFavorites } from '@/composables/useDemoFavorites'
import AppIcon from './AppIcon.vue'
import TeamBadge from './TeamBadge.vue'

const props = defineProps<{ demoTeams: Team[] }>()
const emit = defineEmits<{ discover: [] }>()
const { owner, teams, guestTeams, loading, saving, busy, ready, error, notice, storageError, refresh, toggle, mergeGuest, removeGuest } = useFavorites()
const demo = useDemoFavorites()
const demoFavorites = computed(() => props.demoTeams.filter(t => demo.favoriteIds.value.includes(t.id)))
function open(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${encodeURIComponent(id)}` }) }
onMounted(() => { void refresh() })
</script>
<template>
  <view class="panel favorites-panel">
    <view class="section-heading favorites-heading">
      <view><text class="section-title">我的主队</text><text class="section-subtitle">关注 {{ teams.length }} 支球队 · {{ owner ? '微信账号云端收藏' : '游客收藏仅保存在本机' }}</text></view>
      <button role="button" tabindex="0" hover-class="none" class="ui-button text-button" @click="emit('discover')">发现球队<AppIcon name="arrow" :size="17"/></button>
    </view>
    <view class="favorites-sync-bar"><text class="muted small-text">{{ loading ? '正在读取最新收藏…' : saving ? '正在保存收藏…' : owner ? ready ? '已同步当前账号的云端收藏' : '请重新同步确认最新收藏' : '登录微信后可手动合并游客收藏' }}</text><button role="button" tabindex="0" class="ui-button text-button" :disabled="busy" @click="refresh">{{ owner ? '重新同步收藏' : '刷新球队状态' }}</button></view>
    <text v-if="error" class="favorites-error" role="alert">{{ error }}</text>
    <text v-if="storageError" class="favorites-error" role="alert">{{ storageError }}</text>
    <text v-if="notice" class="favorites-notice" role="status">{{ notice }}</text>
    <view v-if="owner && guestTeams.length" class="guest-favorites-merge">
      <text class="h3">本机还有 {{ guestTeams.length }} 支游客收藏</text>
      <text class="muted small-text">合并会添加到当前微信账号；成功后清除本机游客记录。演示球队不参与合并。</text>
      <view v-for="team in guestTeams" :key="team.id" class="guest-favorite-row"><text>{{ team.available ? team.name : '球队暂不可用' }}</text><button role="button" tabindex="0" class="ui-button text-button" :disabled="busy" :aria-label="`移除游客收藏 ${team.name || team.id}`" @click="removeGuest(team.id)">移除</button></view>
      <button id="favorites-merge" role="button" tabindex="0" class="ui-button outline-button" :disabled="busy || !ready" @click="mergeGuest">合并游客收藏到当前账号</button>
    </view>
    <view v-if="!teams.length" class="empty-state">
      <AppIcon name="heart" :size="36" tone="muted"/><text class="h3">{{ loading ? '正在寻找你的主场…' : error ? '收藏暂未读取成功' : '你的主场，等你入座' }}</text>
      <text class="muted">{{ owner ? '在公开球队主页关注，收藏会随微信账号保存。' : '查找真实参赛球队，进入球队主页即可关注。' }}</text>
      <button role="button" tabindex="0" hover-class="none" class="ui-button primary-button" @click="emit('discover')">认识参赛球队</button>
    </view>
    <view v-for="team in teams" :key="team.id" class="favorite-row" :data-favorite-id="team.id">
      <button role="button" tabindex="0" hover-class="none" class="ui-button favorite-team-link" :disabled="!team.available" @click="open(team.id)"><view class="favorite-initial">{{ team.available ? team.name.slice(0, 1) : '?' }}</view><view class="favorite-team-copy"><text class="h3">{{ team.available ? team.name : '球队暂不可用' }}</text><text class="muted small-text">{{ team.available ? team.district : '已下架、解散或暂未公开，可取消关注' }}</text></view></button>
      <button role="button" tabindex="0" hover-class="none" class="ui-button follow-button followed" :disabled="busy || (!!owner && !ready)" :aria-label="`取消关注 ${team.name || '不可用球队'}`" @click="toggle(team)">取消关注</button>
    </view>
    <view v-if="demoFavorites.length" class="demo-favorites"><text class="h3">演示球队收藏</text><text class="muted small-text">仅用于体验，按本机账号分开保存，不上传云端。</text><view v-for="team in demoFavorites" :key="team.id" class="favorite-row"><button role="button" tabindex="0" class="ui-button" @click="open(team.id)"><TeamBadge :team="team" :size="36"/><view><text class="h3">{{ team.name }}</text><text class="muted small-text">演示资料</text></view></button><button role="button" tabindex="0" class="ui-button follow-button followed" @click="demo.toggle(team.id)">取消关注</button></view></view>
  </view>
</template>
