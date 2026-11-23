<script setup lang="ts">
import {useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>load())
import { computed, ref, onUnmounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPlayerProfile } from '@/services/directory'
import type { PlayerProfileData } from '@/domain/directory'
import { positionLabel } from '@/domain/team'
import AppShell from '@/components/AppShell.vue'
import PublicProfileRecords from '@/components/PublicProfileRecords.vue'
const id = ref(''), teamId = ref(''), profile = ref<PlayerProfileData | null>(null), busy = ref(false), error = ref(''), selected = ref('')
const player = computed(() => profile.value?.player)
let generation = 0
let initialized = false, shown = false
async function load(more = false) {
  if (!initialized) return
  if (!id.value || !teamId.value) { profile.value = null; error.value = '球员链接不完整，请返回球队重新进入。'; busy.value = false; return }
  if (more && (busy.value || !profile.value?.record.nextCursor)) return
  const serial = ++generation, cursor = more ? profile.value?.record.nextCursor || undefined : undefined
  if (!more) profile.value = null
  busy.value = true; error.value = ''
  try {
    const result = await getPlayerProfile(id.value, teamId.value, selected.value || undefined, cursor)
    if (serial !== generation) return
    if (more && profile.value) {
      if (result.record.nextCursor === cursor || result.record.matches.some(row => profile.value!.record.matches.some(old => old.match.id === row.match.id))) throw new Error('比赛记录已变化，请刷新档案。')
      result.record.matches = [...profile.value.record.matches, ...result.record.matches]
    }
    profile.value = result
  } catch (e: any) { if (serial === generation) { if (!more || ['NOT_FOUND','FORBIDDEN'].includes(e?.code)) profile.value = null; error.value = e instanceof Error ? e.message : '球员资料暂不可用。' } }
  finally { if (serial === generation) busy.value = false }
}
function choose(value: string) { selected.value = value; void load() }
onLoad(query => { id.value = query?.id || ''; teamId.value = query?.teamId || ''; initialized = true; void load() })
onShow(() => { if (shown) void load(); shown = true })
onUnmounted(() => { generation++; initialized = false })
function team() { uni.navigateTo({ url: `/pages/team/detail?id=${teamId.value}` }) }
</script>
<template><AppShell active="tournament" detail live><view class="inner-page player-profile"><template v-if="player && profile"><view class="page-heading"><view><text class="eyebrow">球员档案</text><text class="page-title">{{ player.name }}</text><text class="page-description">{{ player.teamName }} · {{ player.district }}</text></view><text class="jersey-number">{{ player.number }}</text></view><view class="panel content-profile-about"><text>场上位置：{{ positionLabel(player.position) }}</text><button role="button" tabindex="0" class="ui-button outline-button" @click="team">查看所属球队</button></view><PublicProfileRecords :record="profile.record" :busy="busy" :error="error" :selected="selected" player @select="choose" @more="load(true)" @refresh="load()"/></template><view v-else class="empty-state"><text>{{ error || (busy ? '正在读取球员…' : '暂无球员资料') }}</text><button role="button" tabindex="0" v-if="error" class="ui-button outline-button" @click="load()">重新读取球员</button><button v-if="error && selected" role="button" tabindex="0" class="ui-button text-button" @click="choose('')">查看全部公开赛事</button></view></view></AppShell></template>
