import type { Tournament, Team, Player, Match, MatchEvent } from '@/domain/types'

const teamSeeds = [
  ['jiangwan', '江湾联队', '江湾', '虹口区', 'A', '#1a6846', 2019, '从江湾的街坊邻居，到每个周日并肩作战的队友。我们相信，足球让社区更亲近。'],
  ['xuhui', '徐汇星火', '星火', '徐汇区', 'A', '#c54f39', 2020, '在城市的烟火气里，保留一份对绿茵场的热爱。星火虽小，也能点亮主场。'],
  ['pudong', '浦东锋芒', '锋芒', '浦东新区', 'A', '#2964a3', 2018, '工作日认真生活，周末全力奔跑。来自浦东的我们，用默契迎接每一次挑战。'],
  ['putuo', '普陀追风', '追风', '普陀区', 'A', '#95583c', 2021, '一群爱踢球的普通人，一支不普通的社区球队。追风而行，快乐第一。'],
  ['songjiang', '松江山鹰', '山鹰', '松江区', 'B', '#5d4b96', 2017, '从佘山脚下出发，用一场场比赛记录社区的活力。我们的故事，仍在继续。'],
  ['yangpu', '杨浦青年', '青年', '杨浦区', 'B', '#b88926', 2021, '年轻不是年龄，而是对每一次开球的期待。欢迎来杨浦，和我们一起踢球。'],
  ['minhang', '闵行飞翼', '飞翼', '闵行区', 'B', '#36848c', 2019, '不同职业，相同热爱。每一次传球都连接着邻里之间的信任。'],
  ['jingan', '静安远航', '远航', '静安区', 'B', '#3e536d', 2022, '相聚于静安，奔跑在绿茵。带上你的球鞋，一起去更远的地方。'],
] as const
const teams: Team[] = teamSeeds.map(([id, name, shortName, district, group, color, founded, description]) => ({ id, name, shortName, district, group, color, founded, description, badge: `/static/teams/${id}.png` }))
const names = [['陈宇', '周子航', '李泽'], ['王晨', '徐一鸣', '赵磊'], ['刘洋', '沈浩', '黄凯'], ['吴昊', '朱涛', '孙杰'], ['张远', '陆川', '顾辰'], ['林浩', '许言', '郑斌'], ['杨帆', '蒋旭', '程翔'], ['何川', '马骏', '方宁']]
const players: Player[] = teams.flatMap((team, i) => names[i].map((name, j) => ({ id: `${team.id}-${j}`, teamId: team.id, name, number: [9, 10, 7][j], position: ['前锋', '中场', '边锋'][j] })))
const venues = ['江湾体育场', '源深体育中心', '松江体育中心', '杨浦白洋淀足球场']
// Demo match events are authored together with demo results, never invented from a real result.
function demoEvents(id: string, home: string, away: string, hs: number, as: number): MatchEvent[] {
  const events: MatchEvent[] = []
  for (let i = 0; i < hs; i++) events.push({ id: `${id}-h${i}`, minute: [18, 47, 73, 84][i], kind: 'goal', teamId: home, playerId: `${home}-${i % 3}`, assistPlayerId: `${home}-${(i + 1) % 3}` })
  for (let i = 0; i < as; i++) events.push({ id: `${id}-a${i}`, minute: [32, 59, 80][i], kind: 'goal', teamId: away, playerId: `${away}-${i % 3}`, assistPlayerId: `${away}-${(i + 1) % 3}` })
  return events.sort((a, b) => a.minute - b.minute)
}
function played(id: string, homeId: string, awayId: string, homeScore: number, awayScore: number, date: string, stage: Match['stage'] = 'group', status: Match['status'] = 'finished'): Match {
  return { id, stage, date, time: '14:00', venue: venues[Number(id.replace(/\D/g, '')) % 4], status, homeId, awayId, homeScore, awayScore,
    events: demoEvents(id, homeId, awayId, homeScore, awayScore), stats: { possession: [56, 44], shots: [12, 8], shotsOnTarget: [5, 3], corners: [4, 2] } }
}
const groupResults: [string, string, number, number][] = [
  ['jiangwan', 'xuhui', 2, 1], ['pudong', 'putuo', 2, 0], ['songjiang', 'yangpu', 2, 0], ['minhang', 'jingan', 1, 1],
  ['jiangwan', 'pudong', 1, 1], ['xuhui', 'putuo', 2, 0], ['songjiang', 'minhang', 1, 1], ['yangpu', 'jingan', 2, 0],
  ['jiangwan', 'putuo', 3, 0], ['xuhui', 'pudong', 1, 0], ['songjiang', 'jingan', 2, 0], ['yangpu', 'minhang', 1, 0],
]
const matches: Match[] = groupResults.map(([h, a, hs, as], i) => played(`g${i + 1}`, h, a, hs, as, ['2026-10-04', '2026-10-11', '2026-10-18'][Math.floor(i / 4)]))
matches.push(
  { ...played('q1', 'jiangwan', 'jingan', 2, 1, '2026-10-25', 'quarter'), time: '10:00', venue: venues[0] },
  { ...played('q2', 'xuhui', 'minhang', 1, 0, '2026-10-25', 'quarter', 'live'), time: '14:00', venue: venues[0], minute: 36, stats: { possession: [54, 46], shots: [6, 3], shotsOnTarget: [3, 1], corners: [2, 1] } },
  { id: 'q3', stage: 'quarter', date: '2026-10-25', time: '16:00', venue: venues[2], status: 'scheduled', homeId: 'songjiang', awayId: 'putuo', homeScore: null, awayScore: null, events: [] },
  { id: 'q4', stage: 'quarter', date: '2026-10-25', time: '19:00', venue: venues[3], status: 'scheduled', homeId: 'yangpu', awayId: 'pudong', homeScore: null, awayScore: null, events: [] },
  { id: 's1', stage: 'semi', date: '2026-11-01', time: '14:00', venue: venues[0], status: 'scheduled', homeId: null, awayId: null, homeFrom: 'q1', awayFrom: 'q2', homeScore: null, awayScore: null, events: [] },
  { id: 's2', stage: 'semi', date: '2026-11-01', time: '16:00', venue: venues[0], status: 'scheduled', homeId: null, awayId: null, homeFrom: 'q3', awayFrom: 'q4', homeScore: null, awayScore: null, events: [] },
  { id: 'f1', stage: 'final', date: '2026-11-08', time: '15:00', venue: venues[0], status: 'scheduled', homeId: null, awayId: null, homeFrom: 's1', awayFrom: 's2', homeScore: null, awayScore: null, events: [] },
)
export const mockTournament: Tournament = {
  id: 'sh-community-2026', name: '中社超上海赛区', season: '2026', demoDate: '2026-10-25', updatedAt: '2026-10-25 14:36', teams, players, matches,
  articles: [
    { id: 'notice', category: '公告', featured: true, title: '淘汰赛观赛指南：这个周末，来为邻里球队加油', excerpt: '八强集结，主场见！赛程、场地与观赛须知，一篇看明白。', date: '2026-10-24', author: '赛事组委会', paragraphs: ['以下为前端原型演示公告，不构成真实赛事活动通知。', '小组赛的热烈告一段落，八支社区球队即将开启淘汰赛旅程。10 月 25 日，四场四分之一决赛依次展开，欢迎带上家人朋友，一起走进球场。', '演示赛程：江湾联队对阵静安远航、徐汇星火对阵闵行飞翼、松江山鹰对阵普陀追风、杨浦青年对阵浦东锋芒。具体时间和场地请查看赛事页。', '请文明观赛，尊重球员与裁判。未成年人建议在监护人陪同下参与，垃圾随身带走，让每一座社区球场都成为温暖的主场。', '遇到天气或场地变化，请以正式上线后的组委会公告为准。当前页面的比赛、人员与数据均为虚构演示。'] },
    { id: 'story', category: '故事', featured: true, title: '下班后，他们把热爱踢进了周末', excerpt: '没有职业球星，只有身边的你我。这是江湾联队的故事，也是每一支社区球队的故事。', date: '2026-10-23', author: '绿茵编辑部', image: '/static/images/stadium.jpg', paragraphs: ['本文为演示内容，球队人物与故事均为虚构。', '周五傍晚，群聊里的消息开始密集起来。「明天几点集合？」「老地方，记得带球衣。」一周的疲惫，在这几句简单的问候里慢慢散去。', '他们是工程师、老师、店主，也是球场上的前锋、中场和后卫。职业不同，年龄不同，但站在同一条边线旁时，大家有了共同的名字：队友。', '有人为进球欢呼，有人为一次漂亮的抢断鼓掌。场边的孩子跟着奔跑，邻居分享着带来的饮料。比赛之外，这才是社区足球最动人的部分。', '输赢值得认真，热爱更值得长久。下一次开球，我们还会在这里。'] },
    { id: 'report', category: '战报', title: '江湾联队 2:1 静安远航，率先挺进四强', excerpt: '一场势均力敌的交锋，两支球队用全力奔跑致敬每一位支持者。', date: '2026-10-25', author: '赛事记录员', image: '/static/images/football.jpg', paragraphs: ['本篇战报对应原型中的模拟比赛 q1，并非真实赛果。', '比赛第 18 分钟，江湾联队率先破门。静安远航在第 32 分钟扳平，双方以 1:1 结束上半场。', '第 47 分钟，江湾联队再度取得领先，最终将 2:1 的比分保持到终场。根据演示签位，江湾联队将在半决赛等待徐汇星火与闵行飞翼之间的胜者。', '感谢两支球队带来的精彩比赛。你可以点击赛事页，查看这场比赛的事件时间轴与模拟技术统计。'] },
    { id: 'brief', category: '快讯', title: '从小组赛到淘汰赛，八支球队准备好了', excerpt: '新的阶段，同样的热爱。2026 社区联赛进入八强争夺。', date: '2026-10-22', author: '赛事组委会', paragraphs: ['这是一条用于展示新闻分类功能的模拟快讯。', '小组赛积分榜已经在数据页整理完毕。八支演示球队全部进入淘汰赛阶段，对阵图展示从四分之一决赛到决赛的完整晋级路线。', '关注你喜欢的球队，收藏这个周末的绿茵时刻。'] },
  ],
}
