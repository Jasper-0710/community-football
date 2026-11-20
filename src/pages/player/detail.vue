<script setup lang="ts">
import {useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>load())
import { ref, onUnmounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPublicPlayer } from '@/services/content'
import type { PlayerProfile } from '@/domain/content'
import { positionLabel } from '@/domain/team'
import AppShell from '@/components/AppShell.vue'
const id = ref(''), teamId = ref(''), player = ref<PlayerProfile | null>(null), busy = ref(false), error = ref('')
let generation = 0
async function load() { const serial = ++generation; player.value = null; busy.value = true; error.value = ''; try { const p = await getPublicPlayer(id.value, teamId.value); if (serial === generation) player.value = p } catch (e) { if (serial === generation) error.value = e instanceof Error ? e.message : '球员资料暂不可用。' } finally { if (serial === generation) busy.value = false } }
onLoad(query => { id.value = query?.id || ''; teamId.value = query?.teamId || '' }); onShow(() => { void load() }); onUnmounted(() => { generation++ })
function team() { uni.navigateTo({ url: `/pages/team/detail?id=${teamId.value}` }) }
</script>
<template><AppShell active="tournament" detail live><view class="inner-page player-profile"><template v-if="player"><view class="page-heading"><view><text class="eyebrow">球员档案</text><text class="page-title">{{ player.name }}</text><text class="page-description">{{ player.teamName }} · {{ player.district }}</text></view><text class="jersey-number">{{ player.number }}</text></view><view class="panel content-profile-about"><text>场上位置：{{ positionLabel(player.position) }}</text><button role="button" tabindex="0" class="ui-button outline-button" @click="team">查看所属球队</button></view></template><view v-else class="empty-state"><text>{{ error || (busy ? '正在读取球员…' : '暂无球员资料') }}</text><button role="button" tabindex="0" v-if="error" class="ui-button outline-button" @click="load">重新读取球员</button></view></view></AppShell></template>
