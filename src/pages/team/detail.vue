<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useTournament } from '@/composables/useTournament'
import { useFavorites } from '@/composables/useFavorites'
import { findTeam, dateLabel } from '@/domain/tournament'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import TeamBadge from '@/components/TeamBadge.vue'
import MatchCard from '@/components/MatchCard.vue'
const { data, matches, error, load } = useTournament()
const { favoriteIds, toggle } = useFavorites()
const id = ref('')
onLoad(query => { id.value = query?.id || '' })
const team = computed(() => data.value ? findTeam(data.value, id.value) : undefined)
const teamMatches = computed(() => matches.value.filter(m => m.homeId === id.value || m.awayId === id.value).sort((a, b) => b.date.localeCompare(a.date)))
const completed = computed(() => teamMatches.value.filter(m => m.status === 'finished'))
const won = computed(() => completed.value.filter(m => m.homeId === id.value ? m.homeScore! > m.awayScore! : m.awayScore! > m.homeScore!).length)
const members = computed(() => data.value?.players.filter(p => p.teamId === id.value) || [])
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index?tab=tournament' }) }) }
</script>
<template><AppShell active="tournament" detail><view v-if="team && data" class="inner-page"><button hover-class="none" role="button" tabindex="0" class="ui-button breadcrumb" @click="back"><AppIcon name="back" :size="15"/>返回赛事<text>/ 球队主页</text></button><view class="team-detail-header"><TeamBadge :team="team" :size="93"/><view class="team-detail-copy"><text class="eyebrow">{{ team.district }} · EST. {{ team.founded }}</text><text class="page-title">{{ team.name }}</text><text class="muted">2026 中国社超上海赛区 · {{ team.group }} 组</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="toggle(team.id)"><AppIcon :name="favoriteIds.includes(team.id) ? 'check' : 'heart'" tone="white" :size="17"/>{{ favoriteIds.includes(team.id) ? '已关注 · 点击取消' : '关注这支球队' }}</button></view><view class="team-summary"><view class="panel team-about"><text class="section-title">身边的球队，自己的主场</text><text>{{ team.description }}</text><text class="muted small-text">球队、球员与介绍均为演示资料，非真实组织信息。</text></view><view class="panel team-numbers"><view><text>{{ completed.length }}</text><text>已赛场次</text></view><view><text>{{ won }}</text><text>获胜场次</text></view><view><text>{{ members.length }}</text><text>示例球员</text></view></view></view><view class="home-section"><view class="section-heading"><text class="section-title">绿茵阵容</text><text class="muted small-text">仅展示部分演示球员</text></view><view class="roster-grid"><view v-for="player in members" :key="player.id" class="panel roster-card"><text class="jersey-number" :style="{ color: team.color }">{{ player.number }}</text><view><text class="h3">{{ player.name }}</text><text class="muted small-text">{{ player.position }}</text></view></view></view></view><view class="home-section"><view class="section-heading"><text class="section-title">球队赛程</text><text class="muted small-text">{{ teamMatches.length }} 场比赛</text></view><view class="team-match-grid"><view v-for="match in teamMatches" :key="match.id"><text class="team-match-date">{{ dateLabel(match.date) }}</text><MatchCard :data="data" :match="match"/></view></view></view></view><view v-else class="empty-state"><text>{{ error || (data ? '没有找到这支球队' : '正在加载球队…') }}</text><button hover-class="none" role="button" tabindex="0" v-if="error" class="ui-button primary-button" @click="load">重新加载</button><button hover-class="none" role="button" tabindex="0" v-else-if="data" class="ui-button outline-button" @click="back">返回赛事</button></view></AppShell></template>
