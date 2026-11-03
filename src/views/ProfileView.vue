<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import type { Tournament, Tab } from '@/domain/types'
import { useFavorites } from '@/composables/useFavorites'
import AppIcon from '@/components/AppIcon.vue'
import TeamBadge from '@/components/TeamBadge.vue'
const props = defineProps<{ data: Tournament }>()
const emit = defineEmits<{ navigate: [tab: Tab, view?: string] }>()
const { favoriteIds, toggle } = useFavorites()
const favorites = computed(() => props.data.teams.filter(t => favoriteIds.value.includes(t.id)))
function open(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${id}` }) }
</script>
<template><view class="inner-page profile-page"><view class="profile-header"><view class="profile-avatar"><AppIcon name="user" tone="white" :size="38"/></view><view><text class="eyebrow">WELCOME TO YOUR HOME GROUND</text><text class="page-title">你好，绿茵同路人。</text><text class="muted">游客体验 · 无需登录，先找到你的球队</text></view></view><view class="panel favorites-panel"><view class="section-heading"><view><text class="section-title">我的主队</text><text class="section-subtitle">关注 {{ favorites.length }} 支球队 · 仅保存在本机</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'tournament', 'teams')">发现球队<AppIcon name="arrow" :size="17"/></button></view><view v-if="!favorites.length" class="empty-state"><AppIcon name="heart" :size="40" tone="muted"/><text class="h3">你的主场，等你入座</text><text class="muted">关注一支社区球队，把热爱留在这里。</text><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="emit('navigate', 'tournament', 'teams')">认识参赛球队</button></view><view v-else><view v-for="team in favorites" :key="team.id" class="favorite-row"><button hover-class="none" role="button" tabindex="0" class="ui-button" @click="open(team.id)"><TeamBadge :team="team" :size="40"/><view><text class="h3">{{ team.name }}</text><text class="muted small-text">{{ team.district }}</text></view></button><button hover-class="none" role="button" tabindex="0" class="ui-button follow-button followed" @click="toggle(team.id)">取消关注</button></view></view></view><view class="prototype-note"><AppIcon name="info" tone="green" :size="24"/><view><text class="h3">这是我们的第一声开场哨</text><text>目前是前端交互原型，所有比赛与新闻均为演示内容。登录、报名、消息提醒与后台管理将在确认页面体验后接入。关注记录不会上传服务器。</text></view></view></view></template>
