<script setup lang="ts">
import type { SavedResult } from '../../src/domain/standings'
defineProps<{ result: SavedResult | null; homeTeamId: string | null; homeTeamName: string; awayTeamName: string }>()
const stats = [{ id: 'possession', label: '控球率', unit: '%' }, { id: 'shots', label: '射门', unit: '' }, { id: 'shotsOnTarget', label: '射正', unit: '' }, { id: 'corners', label: '角球', unit: '' }, { id: 'fouls', label: '犯规', unit: '' }, { id: 'offsides', label: '越位', unit: '' }] as const
</script>

<template>
  <div class="result-snapshot">
    <template v-if="result">
      <p class="snapshot-score">{{ result.homeScore }} : {{ result.awayScore }} <span class="muted">{{ result.state === 'live' ? '进行中' : '已完赛' }}{{ result.minute == null ? '' : ` · ${result.minute}′` }}</span></p>
      <p v-if="result.penalties">点球 {{ result.penalties.join(' : ') }}</p>
      <h4>进球</h4><p v-if="!result.goals.length" class="muted">无进球事件</p>
      <p v-for="(goal, index) in result.goals" :key="`goal-${index}`">{{ goal.minute }}′ {{ goal.teamId === homeTeamId ? homeTeamName : awayTeamName }} · {{ goal.ownGoal ? '乌龙球（受益方）' : `${goal.scorer?.number}号 ${goal.scorer?.name}` }}<span v-if="goal.assist"> · 助攻 {{ goal.assist.number }}号 {{ goal.assist.name }}</span></p>
      <h4>红黄牌</h4><p v-if="!result.cards.length" class="muted">无红黄牌</p>
      <p v-for="(card, index) in result.cards" :key="`card-${index}`">{{ card.minute }}′ {{ card.teamId === homeTeamId ? homeTeamName : awayTeamName }} · {{ card.kind === 'red' ? '红牌' : '黄牌' }} · {{ card.player.number }}号 {{ card.player.name }}</p>
      <h4>换人</h4><p v-if="!result.substitutions.length" class="muted">无换人记录</p>
      <p v-for="(change, index) in result.substitutions" :key="`sub-${index}`">{{ change.minute }}′ {{ change.teamId === homeTeamId ? homeTeamName : awayTeamName }} · 换入 {{ change.playerIn.number }}号 {{ change.playerIn.name }} · 换出 {{ change.playerOut.number }}号 {{ change.playerOut.name }}</p>
      <h4>技术统计</h4><p v-if="!result.stats" class="muted">未发布技术统计</p>
      <dl v-else class="snapshot-stats"><template v-for="stat in stats" :key="stat.id"><dt>{{ stat.label }}（主 / 客）</dt><dd>{{ result.stats[stat.id][0] }}{{ stat.unit }} / {{ result.stats[stat.id][1] }}{{ stat.unit }}</dd></template></dl>
    </template>
    <p v-else class="muted">当前未发布赛果。</p>
  </div>
</template>

<style scoped>
.result-snapshot { min-width: 0; overflow-wrap: anywhere; }
.result-snapshot p { margin: 8px 0; line-height: 1.7; }
.result-snapshot h4 { margin: 20px 0 8px; }
.snapshot-score { font-weight: 700; font-size: 22px; }
.snapshot-score span { font-size: 13px; font-weight: 400; }
.snapshot-stats { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px 12px; font-size: 13px; }
.snapshot-stats dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
