<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Tab } from '@/domain/types'
import { useTournament } from '@/composables/useTournament'
import AppShell from '@/components/AppShell.vue'
import HomeView from '@/views/HomeView.vue'
import TournamentView from '@/views/TournamentView.vue'
import NewsView from '@/views/NewsView.vue'
import StatsView from '@/views/StatsView.vue'
import ProfileView from '@/views/ProfileView.vue'
const active = ref<Tab>('home'), tournamentView = ref('schedule')
const { data, matches, error, load } = useTournament()
const validTabs = ['home', 'tournament', 'news', 'stats', 'profile']
onLoad(query => { if (query?.tab && validTabs.includes(query.tab)) active.value = query.tab as Tab })
function navigate(tab: Tab, view?: string) { active.value = tab; if (tab === 'tournament') tournamentView.value = view || 'schedule'; uni.pageScrollTo({ scrollTop: 0, duration: 0 }) }
</script>
<template><AppShell :active="active" root @navigate="navigate"><template v-if="data"><HomeView v-if="active === 'home'" :data="data" :matches="matches" @navigate="navigate"/><TournamentView v-else-if="active === 'tournament'" :data="data" :matches="matches" :initial-view="tournamentView"/><NewsView v-else-if="active === 'news'" :data="data"/><StatsView v-else-if="active === 'stats'" :data="data"/><ProfileView v-else :data="data" @navigate="navigate"/></template><view v-else-if="error" class="empty-state"><text>{{ error }}</text><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="load">重新加载</button></view><view v-else class="loading-state"><view class="skeleton skeleton-hero"/><view class="skeleton skeleton-line"/><text class="muted">正在准备你的主场…</text></view></AppShell></template>
