<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type { Tab } from '@/domain/types'
import { useCompetitions } from '@/composables/useCompetitions'
import { useFavorites } from '@/composables/useFavorites'
import AppShell from '@/components/AppShell.vue'
import HomeView from '@/views/HomeView.vue'
import TournamentView from '@/views/TournamentView.vue'
import NewsView from '@/views/NewsView.vue'
import StatsView from '@/views/StatsView.vue'
import ProfileView from '@/views/ProfileView.vue'
const active = ref<Tab>('home'), tournamentView = ref('competitions'), contentEpoch = ref(0)
const { load: refreshCompetitions } = useCompetitions()
onShow(() => { contentEpoch.value++; void refreshCompetitions(); if (active.value === 'profile') void useFavorites().refresh() })
const validTabs = ['home', 'tournament', 'news', 'stats', 'profile']
onLoad(query => { if (query?.tab && validTabs.includes(query.tab)) active.value = query.tab as Tab })
function navigate(tab: Tab, view?: string) { active.value = tab; if (tab === 'tournament') tournamentView.value = view || 'competitions'; uni.pageScrollTo({ scrollTop: 0, duration: 0 }) }
</script>
<template><AppShell :active="active" root @navigate="navigate"><HomeView :key="`home-${contentEpoch}`" v-if="active === 'home'" @navigate="navigate"/><TournamentView v-else-if="active === 'tournament'" :initial-view="tournamentView"/><NewsView :key="`news-${contentEpoch}`" v-else-if="active === 'news'"/><StatsView v-else-if="active === 'stats'"/><ProfileView v-else @navigate="navigate"/></AppShell></template>
