<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { Tab } from '@/domain/types'
import type { PublicHome } from '@/domain/directory'
import { getPublicHome } from '@/services/directory'
import { useRecoveryRefresh } from '@/services/public-data'
import CompetitionList from '@/components/CompetitionList.vue'
import PublicMatchCard from '@/components/PublicMatchCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import ExternalEntries from '@/components/ExternalEntries.vue'
import PublicStandings from '@/components/PublicStandings.vue'
import { useNews } from '@/composables/useNews'
const emit = defineEmits<{ navigate: [tab: Tab, view?: string] }>()
const home = ref<PublicHome | null>(null), busy = ref(false), error = ref(''), failedBadges = ref<string[]>([])
let generation = 0
async function load() {
  const serial = ++generation; home.value = null; busy.value = true; error.value = ''; failedBadges.value = []
  try { const result = await getPublicHome(); if (serial === generation) home.value = result }
  catch (e) { if (serial === generation) error.value = e instanceof Error ? e.message : '首页资料暂不可用。' }
  finally { if (serial === generation) busy.value = false }
}
const dateLabel = computed(() => home.value?.matchday.date ? `${home.value.matchday.date.slice(5).replace('-', '.')} / ${['周日','周一','周二','周三','周四','周五','周六'][new Date(`${home.value.matchday.date}T12:00:00+08:00`).getUTCDay()]}` : '待发布')
const matchdayHint = computed(() => !home.value?.matchday.date ? '公开赛程发布后会自动展示' : home.value.matchday.date === home.value.today ? '今日赛程 · 时间均为北京时间' : home.value.matchday.date > home.value.today ? '下一个比赛日 · 时间均为北京时间' : '最近比赛日 · 时间均为北京时间')
const year = new Date().getFullYear().toString()
function team(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${id}` }) }
onMounted(() => { void load() }); onUnmounted(() => { generation++ }); useRecoveryRefresh(() => load())
const { articles: news, error: newsError, busy: newsBusy, load: reloadNews } = useNews()
const { articles: announcements } = useNews('公告')
const stories = computed(() => news.value.slice(0, 2))
const announcement = computed(() => announcements.value[0])
const newsDate = (value: string | null) => value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10) : ''
function article(id: string) { uni.navigateTo({ url: `/pages/article/detail?id=${id}` }) }
</script>
<template>
  <view class="home-view">
    <view class="welcome-line"><text>周末，把时间留给足球。</text><view class="season-label"><view class="tiny-dot" />社区足球 · 公开赛事</view></view>
    <view class="hero">
      <image class="hero-image" src="/static/images/stadium.jpg" mode="aspectFill" />
      <view class="hero-shade" /><view class="hero-pitch-mark" />
      <view class="hero-content"><view class="hero-eyebrow"><view class="eyebrow-line" />社区联赛 · 为热爱相聚</view><view class="hero-title">属于我们的<text>主场。</text></view><view class="hero-description">从街坊到队友，从社区到球场。<text>让每一份平凡的热爱，都有回响。</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button hero-button" @click="emit('navigate', 'tournament', 'live-schedule')">去看比赛<AppIcon name="arrow" :size="18" /></button><view class="hero-facts"><view><text class="fact-number" data-home-count="teams">{{ home?.counts.teams ?? '—' }}</text><text>公开球队</text></view><view class="fact-divider"/><view><text class="fact-number" data-home-count="matches">{{ home?.counts.matches ?? '—' }}</text><text>场绿茵相遇</text></view><view class="fact-divider"/><view><text class="fact-number" data-home-count="competitions">{{ home?.counts.competitions ?? '—' }}</text><text>项公开赛事</text></view></view></view>
      <view class="hero-side-label"><text>OUR COMMUNITY.</text><text>OUR HOME GROUND.</text><view /><text class="hero-location"><AppIcon name="pin" :size="13" tone="white" />球场照片为视觉示意</text></view>
      <view class="hero-season"><text>{{ year.slice(0,2) }}</text><text>{{ year.slice(2) }}</text></view>
    </view>
    <button role="button" tabindex="0" v-if="announcement" hover-class="none" class="ui-button announcement" @click="article(announcement.id)"><view class="announcement-label"><AppIcon name="bell" :size="17" tone="green"/><text>赛事公告</text></view><text class="announcement-text">{{ announcement.title }}</text><text class="announcement-date">{{ newsDate(announcement.publishedAt) }}</text><AppIcon name="chevron" :size="17" tone="green"/></button>
    <CompetitionList compact @explore="emit('navigate', 'tournament', 'competitions')"/>
    <view class="home-section">
      <view class="section-heading"><view class="heading-with-sub"><view class="heading-title-row"><text class="section-title">比赛日</text><text v-if="home" class="date-badge">{{ dateLabel }}</text><view v-if="home?.matchday.live" class="live-caption"><view class="live-dot"/>{{ home.matchday.live }} 场进行中</view></view><text class="section-subtitle">{{ matchdayHint }}</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'tournament', 'live-schedule')">全部赛程<AppIcon name="arrow" :size="17" /></button></view>
      <view v-if="error" class="panel empty-state home-data-error" role="alert"><text>{{ error }}</text><button role="button" tabindex="0" class="ui-button outline-button" @click="load()">重新读取首页</button></view>
      <view v-else-if="busy" class="panel empty-state"><text>正在读取首页赛程与球队…</text></view>
      <view v-else-if="!home?.matchday.matches.length" class="panel empty-state"><AppIcon name="calendar" tone="muted" :size="30"/><text class="h3">暂无公开赛程</text><text class="muted">比赛安排发布后，在这里相聚。</text></view>
      <template v-else><scroll-view scroll-x class="matches-strip"><view class="home-matches"><view v-for="entry in home.matchday.matches" :key="entry.match.id" class="home-match-wrap"><PublicMatchCard :entry="entry"/></view></view></scroll-view><text class="home-match-caption muted small-text">本比赛日共 {{ home.matchday.total }} 场{{ home.matchday.total > 6 ? '，首页展示前 6 场，更多请查看全部赛程' : '' }}</text></template>
    </view>
    <view class="home-lower-grid">
      <view class="stories-section"><view class="section-heading"><view><text class="section-title">绿茵场内外</text><text class="section-subtitle">比赛有终场，故事不散场</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'news')">更多动态<AppIcon name="arrow" :size="17" /></button></view><view v-if="newsError" class="empty-state"><text>{{ newsError }}</text><button role="button" tabindex="0" class="ui-button text-button" @click="reloadNews()">重新加载资讯</button></view><view v-else-if="!stories.length" class="empty-state"><text>{{ newsBusy ? '正在加载资讯…' : '暂无已发布内容' }}</text></view><view class="story-grid"><button hover-class="none" role="button" tabindex="0" v-for="story in stories" :key="story.id" class="ui-button story-card" @click="article(story.id)"><view class="story-image-wrap"><image :src="story.coverUrl || '/static/images/football.jpg'" mode="aspectFill" class="story-image" /><text class="story-category">{{ story.category }}</text><view class="story-image-arrow"><AppIcon name="external" tone="white" :size="20" /></view></view><view class="story-content"><text class="story-title">{{ story.title }}</text><text class="story-excerpt">{{ story.excerpt }}</text><view class="story-meta"><text>{{ story.author }}</text><text>{{ newsDate(story.publishedAt) }}</text></view></view></button></view></view>
      <view class="home-standings"><PublicStandings compact /><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="emit('navigate', 'stats')">查看完整榜单<AppIcon name="arrow" :size="17" /></button></view>
    </view>
    <view class="community-banner home-community"><view class="community-copy"><text class="community-eyebrow">MEET YOUR NEIGHBOURS</text><text class="community-title">身边的球队，共同的热爱。</text><text class="muted">认识身边的球队，找到属于你的主场。</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="emit('navigate', 'tournament', 'real-teams')">认识球队<AppIcon name="arrow" :size="17" /></button><view v-if="home?.teams.length" class="home-team-previews"><button v-for="item in home.teams" :key="item.id" role="button" tabindex="0" hover-class="none" class="ui-button home-team-preview" @click="team(item.id)"><view class="home-team-crest"><image v-if="item.badgeUrl && !failedBadges.includes(item.id)" :src="item.badgeUrl" mode="aspectFit" @error="failedBadges.push(item.id)"/><text v-else>{{ item.name.slice(0,1) }}</text></view><view><text class="h3">{{ item.name }}</text><text class="muted small-text">{{ item.district }} · {{ item.playerCount }} 人</text></view><AppIcon name="chevron" tone="green" :size="16"/></button></view><text v-else class="muted home-team-state">{{ busy ? '正在读取公开球队…' : error ? '球队资料暂未读取成功，可在比赛日区域重试。' : '暂无公开参赛球队，报名通过并公开赛事后将在这里展示。' }}</text></view>
    <ExternalEntries />
    <view class="demo-footnote"><AppIcon name="info" :size="14" tone="muted" /><text>赛程、球队与资讯均来自公开业务内容；标有“验收”的内容为模拟业务资料。头图仅为视觉示意。</text></view>
  </view>
</template>
<style scoped>
.home-match-wrap { width:320px; min-width:280px; flex:1; }
.home-match-caption { display:block; margin-top:12px; }
.home-community { flex-wrap:wrap; }
.home-team-previews { width:100%; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:8px; }
.home-team-preview { display:flex; align-items:center; gap:12px; min-width:0; padding:14px; border:1px solid var(--line); border-radius:10px; background:var(--white); }
.home-team-preview > view:nth-child(2) { min-width:0; flex:1; overflow-wrap:anywhere; }
.home-team-preview .h3 { font-size:15px; }
.home-team-crest { width:42px; height:46px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:8px; background:var(--surface-soft, #e7eddf); color:var(--green); font-size:22px; font-weight:600; }
.home-team-crest image { width:100%; height:100%; }
.home-team-state { width:100%; line-height:1.8; }
@media(max-width:760px) { .home-team-previews { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; } .home-match-wrap { flex:none; width:280px; } .home-team-preview { padding:12px; } }
@media(max-width:480px) { .home-team-previews { grid-template-columns:minmax(0,1fr); } .home-team-preview .h3 { font-size:16px; } }
</style>
