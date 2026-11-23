<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, ref, watch } from 'vue'
import type { StandingsSnapshot } from '@/domain/standings'
import { buildBracket, bracketGeometry as geometry } from '@/domain/bracket'
import { matchStatusLabels, matchTime } from '@/domain/match'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ snapshot: StandingsSnapshot }>()
const graph = computed(() => buildBracket(props.snapshot))
const scrollLeft = ref(0)
watch(() => props.snapshot.competitionId, () => { scrollLeft.value = 0 })
function open(id: string) { uni.navigateTo({ url: `/pages/match/detail?id=${encodeURIComponent(id)}` }) }
function position(x: number, y: number) { return { left: `${x}px`, top: `${y}px` } }
function rememberScroll(event: { detail: { scrollLeft: number } }) { scrollLeft.value = event.detail.scrollLeft }
</script>

<template>
  <view v-if="!graph.nodes.length" class="panel competition-empty"><text class="h3">尚无淘汰赛对阵</text><text class="muted">循环赛可查看积分榜；淘汰赛排赛后在这里显示。</text></view>
  <view v-else class="knockout panel">
    <view class="knockout-toolbar">
      <view class="knockout-title"><AppIcon name="bracket" tone="green" :size="22"/><view><text class="h3">通往冠军的每一步</text><text class="muted small-text">左右滑动查看完整签位 · 点击比赛查看详情</text></view></view>
      <view class="knockout-jumps"><button v-for="column in graph.columns" :key="column.stage" role="button" tabindex="0" class="ui-button knockout-jump" @click="scrollLeft = column.x - geometry.padding">{{ column.label }}</button><button v-if="graph.champion" role="button" tabindex="0" class="ui-button knockout-jump" @click="scrollLeft = graph.champion.x - geometry.padding">冠军</button></view>
    </view>
    <scroll-view scroll-x :scroll-left="scrollLeft" scroll-with-animation class="knockout-scroll" @scroll="rememberScroll">
      <view class="knockout-canvas" :style="{ width: `${graph.width}px`, height: `${graph.height}px` }">
        <view v-for="column in graph.columns" :key="column.stage" class="knockout-heading" :style="position(column.x, geometry.padding)"><text>{{ column.label }}</text><text class="muted small-text">{{ column.count }} 场比赛</text></view>
        <view v-if="graph.champion" class="knockout-heading" :style="position(graph.champion.x, geometry.padding)"><text>冠军</text><text class="muted small-text">决赛胜者</text></view>
        <view v-for="edge in graph.edges" :key="edge.id" class="knockout-edge" :class="{ confirmed: edge.confirmed }" :data-from="edge.from" :data-to="edge.to" :data-side="edge.side" aria-hidden="true"><view v-for="(line, index) in edge.segments" :key="index" class="knockout-line" :style="{ ...position(line.x, line.y), width: `${line.width}px`, height: `${line.height}px` }"/></view>
        <button v-for="node in graph.nodes" :key="node.match.id" role="button" tabindex="0" hover-class="none" class="ui-button live-bracket-match knockout-match" :class="{ 'is-live': node.match.status === 'live', 'is-final': node.match.stage === 'final' }" :data-match-id="node.match.id" :style="position(node.x, node.y + geometry.heading)" :aria-label="`${node.participants.map(p => p.name + (p.source ? '，' + p.source : '')).join(' 对 ')}，${matchStatusLabels[node.match.status]}，查看比赛详情`" @click="open(node.match.id)">
          <view class="knockout-meta"><text>{{ node.match.slot === null ? `第${node.match.round}轮 · 签位未编号` : `第${node.match.slot}场` }}</text><text class="knockout-status">{{ matchStatusLabels[node.match.status] }}</text></view>
          <view class="knockout-sides"><view v-for="participant in node.participants" :key="participant.side" class="knockout-side" :class="{ 'is-winner': participant.winner, 'is-pending': participant.pending }"><view class="knockout-participant"><text class="knockout-name">{{ participant.name }}</text><text class="knockout-source">{{ participant.source || (participant.pending ? '等待排定球队' : '已确定球队') }}</text></view><text v-if="participant.winner" class="knockout-winner" aria-label="胜者">胜</text><text class="knockout-score">{{ participant.score ?? '—' }}</text></view></view>
          <text class="knockout-outcome">{{ node.match.penalties ? `点球 ${node.match.penalties[0]} : ${node.match.penalties[1]}` : node.match.status === 'live' ? '当前比分 · 尚未决出胜者' : node.winnerId ? '已决出胜者' : '等待比赛结果' }}</text>
          <view class="knockout-time"><text>{{ matchTime(node.match.scheduledAt) }} 北京时间</text><text class="knockout-venue">{{ node.match.venue }}</text></view>
          <view class="knockout-detail"><text>比赛详情</text><AppIcon name="arrow" tone="green" :size="14"/></view>
        </button>
        <view v-if="graph.champion" class="knockout-champion" :aria-label="graph.champion.name ? `本届冠军：${graph.champion.name}` : '冠军待定'" :class="{ 'live-champion': graph.champion.name }" :style="position(graph.champion.x, graph.champion.y + geometry.heading)"><AppIcon name="trophy" tone="gold" :size="44"/><text class="knockout-champion-caption">{{ graph.champion.name ? '本届冠军' : '冠军待定' }}</text><text class="knockout-champion-name">{{ graph.champion.name || '静待最后的胜者' }}</text><text class="muted small-text">{{ graph.champion.name ? '决赛结果已确认' : '决赛完赛后在这里揭晓' }}</text></view>
      </view>
    </scroll-view>
    <view class="knockout-legend"><view><text class="knockout-key confirmed"/>已确认晋级</view><view><text class="knockout-key"/>等待前轮结果</view><text>所有时间为北京时间</text></view>
  </view>
</template>

<style scoped>
.knockout { min-width:0; overflow:hidden; }
.knockout-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; padding:20px; border-bottom:1px solid var(--line); }
.knockout-title { display:flex; align-items:center; gap:12px; min-width:0; }
.knockout-title text { display:block; }
.knockout-jumps { display:flex; flex-wrap:wrap; gap:8px; }
.knockout-jump { font-size:12px; padding:6px 10px; border:1px solid var(--line); border-radius:6px; color:var(--green); }
.knockout-scroll { width:100%; min-width:0; }
.knockout-canvas { position:relative; background:var(--surface-soft, #f3f6f1); }
.knockout-heading { position:absolute; width:264px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-weight:650; }
.knockout-heading .small-text { font-weight:400; }
.knockout-line { position:absolute; background:var(--line); pointer-events:none; }
.confirmed .knockout-line { background:var(--green); }
.knockout-match { position:absolute; display:grid; grid-template-rows:18px 128px 20px 36px 20px; gap:8px; width:264px; height:288px; margin:0; padding:16px; border:1px solid var(--line); border-radius:var(--radius, 12px); background:var(--surface, #fff); color:var(--ink); text-align:left; white-space:normal; }
.knockout-match.is-live { border-color:var(--green); box-shadow:0 0 0 1px var(--green); }
.knockout-match.is-final { border-top:3px solid var(--green); padding-top:14px; }
.knockout-meta { display:flex; justify-content:space-between; gap:8px; line-height:18px; font-size:12px; color:var(--muted); }
.knockout-status { color:var(--green); }
.knockout-side { height:64px; display:flex; align-items:center; gap:7px; border-bottom:1px solid var(--line); }
.knockout-participant { min-width:0; flex:1; }
.knockout-name { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:15px; line-height:20px; font-weight:600; overflow-wrap:anywhere; }
.knockout-source { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:16px; font-size:11px; color:var(--muted); margin-top:3px; }
.knockout-score { flex:none; font-size:22px; line-height:28px; font-weight:650; font-variant-numeric:tabular-nums; }
.knockout-winner { font-size:10px; color:var(--green); }
.is-winner .knockout-name,.is-winner .knockout-score { color:var(--green); }
.is-pending .knockout-name { color:var(--muted); font-weight:400; }
.knockout-outcome { font-size:12px; line-height:20px; color:var(--muted); }
.knockout-time { font-size:11px; line-height:18px; color:var(--muted); }
.knockout-time text { display:block; }
.knockout-venue { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.knockout-detail { display:flex; align-items:center; justify-content:flex-end; gap:5px; font-size:12px; line-height:20px; color:var(--green); }
.knockout-champion { position:absolute; width:264px; height:288px; padding:24px; border:1px dashed var(--line); border-radius:var(--radius, 12px); background:var(--surface, #fff); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; }
.knockout-champion.live-champion { margin:0; border-style:solid; border-color:var(--green); background:var(--surface, #fff); }
.knockout-champion-caption { font-size:12px; letter-spacing:3px; color:var(--muted); }
.knockout-champion-name { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; font-size:22px; line-height:1.5; font-weight:650; overflow-wrap:anywhere; }
.knockout-legend { display:flex; flex-wrap:wrap; gap:12px 20px; padding:16px 20px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
.knockout-legend > view { display:flex; align-items:center; gap:7px; }
.knockout-key { width:18px; height:2px; background:var(--line); }
.knockout-key.confirmed { background:var(--green); }
@media(max-width:600px) { .knockout-toolbar { padding:16px; } .knockout-legend { padding:16px; } }
</style>
