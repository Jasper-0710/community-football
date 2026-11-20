import { callWechatCloudFunction } from './wechat-cloud'
import { EvaluationClientError, parseEvaluationPublic, type EvaluationPublic } from '@/domain/evaluation'
import { MatchClientError } from '@/domain/match'
import { requestMatchData } from './matches'

export async function getPublicEvaluation(matchId: string): Promise<EvaluationPublic> {
  return parseEvaluationPublic(await requestMatchData({ action: 'evaluation.getPublic', matchId }))
}

export async function submitPlayerRating(matchId: string, playerId: string, score: number, requestId: string) {
  const result = await callWechatCloudFunction<any>('adminAuth', { action: 'evaluation.rate', matchId, playerId, score, requestId })
  if (!result?.ok) throw new MatchClientError(result?.error?.code || 'SERVICE_UNAVAILABLE', result?.error?.message || '评分提交失败，请重试。')
  if (typeof result.applied !== 'boolean' || !Number.isInteger(result.score) || result.score < 1 || result.score > 10) throw new EvaluationClientError('INVALID_RESPONSE', '评分保存回执异常，请刷新后确认。')
  return result
}

export async function submitPlayerComment(matchId: string, playerId: string, content: string, requestId: string) {
  const result = await callWechatCloudFunction<any>('adminAuth', { action: 'evaluation.comment', matchId, playerId, content, requestId })
  if (!result?.ok) throw new MatchClientError(result?.error?.code || 'SERVICE_UNAVAILABLE', result?.error?.message || '评论提交失败，请重试。')
  if (typeof result.applied !== 'boolean' || !/^ec_[a-f0-9]{32}$/.test(result.commentId)) throw new EvaluationClientError('INVALID_RESPONSE', '评论保存回执异常，请刷新后确认。')
  return result
}
