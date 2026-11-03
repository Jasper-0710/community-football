<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, ref } from 'vue'
import type { Tournament, Match, Tab } from '@/domain/types'
import { dateLabel } from '@/domain/tournament'
import MatchCard from '@/components/MatchCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import StandingsTable from '@/components/StandingsTable.vue'
import TeamBadge from '@/components/TeamBadge.vue'
const props = defineProps<{ data: Tournament; matches: Match[] }>()
const emit = defineEmits<{ navigate: [tab: Tab, view?: string] }>()
const group = ref<'A' | 'B'>('A')
const matchday = computed(() => props.matches.filter(m => m.date === props.data.demoDate))
const liveCount = computed(() => matchday.value.filter(m => m.status === 'live').length)
const stories = computed(() => props.data.articles.filter(a => a.image).slice(0, 2))
function article(id: string) { uni.navigateTo({ url: `/pages/article/detail?id=${id}` }) }
</script>
<template>
  <view class="home-view">
    <view class="welcome-line"><text>周末，把时间留给足球。</text><view class="season-label"><view class="tiny-dot" />2026 赛季 · 淘汰赛阶段</view></view>
    <view class="hero">
      <image class="hero-image" src="/static/images/stadium.jpg" mode="aspectFill" />
      <view class="hero-shade" /><view class="hero-pitch-mark" />
      <view class="hero-content"><view class="hero-eyebrow"><view class="eyebrow-line" />中社超 · 上海赛区</view><view class="hero-title">属于我们的<text>主场。</text></view><view class="hero-description">从街坊到队友，从社区到球场。<text>让每一份平凡的热爱，都有回响。</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button hero-button" @click="emit('navigate', 'tournament')">去看比赛<AppIcon name="arrow" :size="18" /></button><view class="hero-facts"><view><text class="fact-number">08</text><text>社区球队</text></view><view class="fact-divider"/><view><text class="fact-number">{{ data.matches.length }}</text><text>场绿茵相遇</text></view><view class="fact-divider"/><view><text class="fact-number">01</text><text>份共同热爱</text></view></view></view>
      <view class="hero-side-label"><text>OUR COMMUNITY.</text><text>OUR HOME GROUND.</text><view /><text class="hero-location"><AppIcon name="pin" :size="13" tone="white" />球场照片为视觉示意</text></view>
      <view class="hero-season"><text>20</text><text>26</text></view>
    </view>
    <button hover-class="none" role="button" tabindex="0" class="ui-button announcement" @click="article('notice')"><view class="announcement-label"><AppIcon name="bell" :size="17" tone="green" /><text>赛事公告</text></view><text class="announcement-text">淘汰赛观赛指南：这个周末，来为邻里球队加油</text><text class="announcement-date">10.24</text><AppIcon name="chevron" :size="17" tone="green" /></button>
    <view class="home-section">
      <view class="section-heading"><view class="heading-with-sub"><view class="heading-title-row"><text class="section-title">比赛日</text><text class="date-badge">10.25 / 周日</text><view v-if="liveCount" class="live-caption"><view class="live-dot"/>{{ liveCount }} 场模拟进行中</view></view><text class="section-subtitle">球场上的每一刻，都值得被看见</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'tournament')">全部赛程<AppIcon name="arrow" :size="17" /></button></view>
      <scroll-view scroll-x class="matches-strip"><view class="home-matches"><MatchCard v-for="match in matchday" :key="match.id" :match="match" :data="data" compact /></view></scroll-view>
    </view>
    <view class="home-lower-grid">
      <view class="stories-section"><view class="section-heading"><view><text class="section-title">绿茵场内外</text><text class="section-subtitle">比赛有终场，故事不散场</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'news')">更多动态<AppIcon name="arrow" :size="17" /></button></view><view class="story-grid"><button hover-class="none" role="button" tabindex="0" v-for="story in stories" :key="story.id" class="ui-button story-card" @click="article(story.id)"><view class="story-image-wrap"><image :src="story.image" mode="aspectFill" class="story-image" /><text class="story-category">{{ story.category }}</text><view class="story-image-arrow"><AppIcon name="external" tone="white" :size="20" /></view></view><view class="story-content"><text class="story-title">{{ story.title }}</text><text class="story-excerpt">{{ story.excerpt }}</text><view class="story-meta"><text>{{ story.author }}</text><text>{{ dateLabel(story.date) }}</text></view></view></button></view></view>
      <view class="home-standings"><view class="section-heading"><text class="section-title">积分榜</text><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'stats')">完整榜单<AppIcon name="arrow" :size="17" /></button></view><view class="standings-panel"><view class="standings-group-tabs"><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: group === 'A' }" @click="group = 'A'">A 组</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: group === 'B' }" @click="group = 'B'">B 组</button><text>小组赛 · 最终积分</text></view><StandingsTable :data="data" :group="group" compact /><view class="standings-note"><view class="rank-marker"/>按积分、净胜球、进球数排序</view></view></view>
    </view>
    <view class="community-banner"><view class="community-copy"><text class="community-eyebrow">MEET YOUR NEIGHBOURS</text><text class="community-title">一座城，八支队，无数份热爱。</text><text class="muted">认识身边的球队，找到属于你的主场。</text></view><view class="community-badges"><TeamBadge v-for="team in data.teams.slice(0, 5)" :key="team.id" :team="team" :size="42" /></view><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="emit('navigate', 'tournament', 'teams')">认识球队<AppIcon name="arrow" :size="17" /></button></view>
    <view class="demo-footnote"><AppIcon name="info" :size="14" tone="muted" /><text>当前为交互原型，固定演示日期为 2026 年 10 月 25 日。球队、赛果与新闻均为模拟数据。</text></view>
  </view>
</template>
