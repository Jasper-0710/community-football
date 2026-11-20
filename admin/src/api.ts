import {parseBackup,parseBackupStatus,parseRestorePlan,BackupClientError} from '../../src/domain/recovery'
import {parseBadgeCleanup} from '../../src/domain/team-badge'
import {parsePlatformSettings,type PlatformForm} from '../../src/domain/platform-settings'
import {parseCleanupResult} from './registration-maintenance'
import { parseMatch, parseMatchPage, type MatchScheduleForm } from '../../src/domain/match'
import { parseStandings, parseResultHistory, type StandingsRules, type ResultInput } from '../../src/domain/standings'
import type { GroupQualification } from '../../src/domain/match'
import { parseNewsArticle, parseNewsPage, parseSearchPage, parseContentOverview, type NewsForm, type ContentCategory, type SearchKind } from '../../src/domain/content'
import { parseNewsImage, parseNewsImageConfig, parseNewsImageUpload, parseNewsImageCleanup } from '../../src/domain/news-image'
import { parseLiveEntry, parseLivePage, parseLiveUploadedImage, parseLiveImageUpload, parseLiveImageCleanup, type LiveForm } from '../../src/domain/match-live'
import { parseEvaluationAdmin, parseEvaluationConfig, type EvaluationAdmin, type EvaluationConfig } from '../../src/domain/evaluation'
export interface AdminSession {
  admin: { username: string; displayName: string; role: 'admin' }
  expiresAt: string
}
export interface AdminOverview extends AdminSession { availableModules: string[]; serverTime: string }
export class AdminApiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AdminApiError' }
}

function checkSession(value: any): AdminSession {
  if (!value || !value.admin || typeof value.admin.username !== 'string'
    || typeof value.admin.displayName !== 'string' || value.admin.role !== 'admin'
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new AdminApiError('INVALID_RESPONSE', '管理服务返回异常，请重试。')
  }
  return { admin: { username: value.admin.username, displayName: value.admin.displayName, role: 'admin' }, expiresAt: value.expiresAt }
}

export function createAdminApi(baseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  async function request(action: string, fields: Record<string, unknown> = {}, token?: string): Promise<any> {
    let url: URL
    try {
      url = new URL(baseUrl)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback) || url.username || url.password || url.hash || url.search) throw new Error()
    } catch { throw new AdminApiError('NOT_CONFIGURED', '管理服务尚未配置，请联系平台负责人。') }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(url.toString(), {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, ...fields }),
      })
      if (response.status === 413) throw new AdminApiError('PAYLOAD_TOO_LARGE', '上传请求超过云网关大小限制，请刷新后台后重新选择图片；如仍失败，请更新云函数。')
      let data: any
      try { data = await response.json() } catch { throw new AdminApiError('INVALID_RESPONSE', '管理服务返回异常，请重试。') }
      if (data?.ok === false && typeof data.error?.code === 'string' && typeof data.error?.message === 'string') {
        throw new AdminApiError(data.error.code, data.error.message)
      }
      if (!response.ok || data?.ok !== true) throw new AdminApiError('INVALID_RESPONSE', '管理服务返回异常，请重试。')
      return data
    } catch (error) {
      if (error instanceof AdminApiError) throw error
      throw new AdminApiError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        controller.signal.aborted ? '请求超时，请重试。退出操作需再次确认成功。' : '暂时无法连接管理服务，请检查网络后重试。')
    } finally { clearTimeout(timer) }
  }
  return {
    async backupStatus(token:string){return parseBackupStatus(await request('backup.status',{},token))},
    async backups(token:string){const r=await request('backup.list',{},token);if(!Array.isArray(r.backups)||r.backups.length>30)throw new BackupClientError();return r.backups.map(parseBackup)},
    async createBackup(token:string,requestId:string){return parseBackup((await request('backup.create',{requestId},token)).backup)},
    async backupChunk(token:string,id:string,digest:string,index:number):Promise<{index:number;total:number;data:string}>{return request('backup.chunk',{id,digest,index},token)},
    async previewBackup(token:string,id:string,digest:string){return parseRestorePlan((await request('backup.preview',{id,digest},token)).plan)},
    async applyBackup(token:string,planId:string,confirmation:string):Promise<{applied:boolean;rollbackId:string;completedAt:string}>{const r=await request('backup.apply',{planId,confirmation},token);if(typeof r.applied!=='boolean'||!/^b_[a-f0-9]{32}$/.test(r.rollbackId)||typeof r.completedAt!=='string'||!Number.isFinite(Date.parse(r.completedAt)))throw new BackupClientError();return r},
    async backupResult(token:string,planId:string):Promise<{status:'preview'|'completed';rollbackId:string|null;completedAt:string|null}>{const r=await request('backup.result',{planId},token);if(!['preview','completed'].includes(r.status)||r.status==='completed'&&(!/^b_[a-f0-9]{32}$/.test(r.rollbackId)||typeof r.completedAt!=='string'||!Number.isFinite(Date.parse(r.completedAt))))throw new BackupClientError();return r},
    async liveEntries(token: string, matchId: string, cursor?: string) { return parseLivePage(await request('live.listAdmin', { matchId, ...(cursor ? { cursor } : {}) }, token), true, matchId) },
    async publishLive(token: string, matchId: string, requestId: string, form: LiveForm) { return parseLiveEntry((await request('live.publish', { matchId, requestId, form }, token)).entry, true) },
    async correctLive(token: string, matchId: string, id: string, expectedVersion: number, requestId: string, form: LiveForm) { return parseLiveEntry((await request('live.correct', { matchId, id, expectedVersion, requestId, form }, token)).entry, true) },
    async deleteLive(token: string, matchId: string, id: string, expectedVersion: number, requestId: string) { await request('live.delete', { matchId, id, expectedVersion, requestId }, token) },
    async liveImageConfig(token: string) { return parseNewsImageConfig(await request('live.images.config', {}, token)) },
    async startLiveImage(token: string, fields: {entryId: string; requestId: string; name: string; size: number; mime: string; sha256: string}) { return parseLiveImageUpload(await request('live.images.start', fields, token)) },
    async liveImageChunk(token: string, id: string, index: number, data: string) { const r = await request('live.images.chunk', { id, index, data }, token); if (r.index !== index) throw new AdminApiError('INVALID_RESPONSE', '图片分片回执异常，请重试。') },
    async finishLiveImage(token: string, id: string) { return parseLiveUploadedImage((await request('live.images.finish', { id }, token)).image) },
    async liveImage(token: string, id: string, entryId: string) { return parseLiveUploadedImage((await request('live.images.get', { id, entryId }, token)).image) },
    async cleanupLiveImages(token: string, dryRun = true, cursor?: string) { const r = parseLiveImageCleanup(await request('live.images.cleanup', { dryRun, ...(cursor ? { cursor } : {}) }, token)); if (r.dryRun !== dryRun) throw new AdminApiError('INVALID_RESPONSE', '直播图片清理回执异常。'); return r },
    async platformSettings(token:string){return parsePlatformSettings((await request('settings.getAdmin',{},token)).settings)},
    async savePlatformSettings(token:string,expectedVersion:number,requestId:string,form:PlatformForm){return parsePlatformSettings((await request('settings.update',{expectedVersion,requestId,form},token)).settings)},
    async newsImageConfig(token: string) { return parseNewsImageConfig(await request('news.images.config',{},token)) },
    async startNewsImage(token: string, fields: {articleId:string;requestId:string;name:string;size:number;mime:string;sha256:string}) { return parseNewsImageUpload(await request('news.images.start',fields,token)) },
    async newsImageChunk(token: string, id: string, index: number, data: string) { const r = await request('news.images.chunk',{id,index,data},token); if (r.index !== index) throw new AdminApiError('INVALID_RESPONSE','图片分片回执异常，请重试。') },
    async finishNewsImage(token: string, id: string) { return parseNewsImage((await request('news.images.finish',{id},token)).image) },
    async newsImage(token: string, id: string, articleId: string) { return parseNewsImage((await request('news.images.get',{id,articleId},token)).image) },
    async cleanupNewsImages(token: string, dryRun = true, cursor?: string) { const r = parseNewsImageCleanup(await request('news.images.cleanup',{dryRun,...(cursor?{cursor}:{})},token)); if (r.dryRun !== dryRun) throw new AdminApiError('INVALID_RESPONSE','图片清理回执异常，请重新检查。'); return r },
    async news(token: string, category?: ContentCategory, cursor?: string) { return parseNewsPage(await request('news.listAdmin', { ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) }, token), true) },
    async article(token: string, id: string) { return parseNewsArticle((await request('news.getAdmin', { id }, token)).article, true, true) },
    async createNews(token: string, requestId: string, form: NewsForm) { return parseNewsArticle((await request('news.create', { requestId, form }, token)).article, true, true) },
    async updateNews(token: string, id: string, expectedVersion: number, form: NewsForm) { return parseNewsArticle((await request('news.update', { id, expectedVersion, form }, token)).article, true, true) },
    async deleteNews(token: string, id: string, expectedVersion: number) { await request('news.delete', { id, expectedVersion }, token) },
    async search(token: string, query: string, kind: 'all' | SearchKind = 'all', cursor?: string) { return parseSearchPage(await request('search.admin', { query, kind, ...(cursor ? { cursor } : {}) }, token)) },
    async contentOverview(token: string) { return parseContentOverview(await request('content.overview', {}, token)) },
    async standings(token: string, competitionId: string) { return parseStandings(await request('standings.getAdmin', { competitionId }, token), true) },
    async updateStandingsRules(token: string, competitionId: string, expectedRevision: number, rules: StandingsRules) { await request('standings.updateRules', { competitionId, expectedRevision, rules }, token) },
    async bindQualification(token: string, competitionId: string, id: string, expectedVersion: number, expectedRevision: number, homeQualification: GroupQualification | null, awayQualification: GroupQualification | null) { await request('standings.bindMatch', { competitionId, id, expectedVersion, expectedRevision, homeQualification, awayQualification }, token) },
    async saveResult(token: string, competitionId: string, id: string, expectedVersion: number, expectedRevision: number, requestId: string, reason: string, result: ResultInput) { await request('standings.saveResult', { competitionId, id, expectedVersion, expectedRevision, requestId, reason, result }, token) },
    async revokeResult(token: string, competitionId: string, id: string, expectedVersion: number, expectedRevision: number, requestId: string, reason: string) { await request('standings.revokeResult', { competitionId, id, expectedVersion, expectedRevision, requestId, reason }, token) },
    async resultHistory(token: string, competitionId: string, id: string, beforeVersion?: number) { return parseResultHistory(await request('standings.history', { competitionId, id, ...(beforeVersion ? { beforeVersion } : {}) }, token)) },
    async cleanupRegistrationFiles(token:string,dryRun=true,cursor?:string) { const r=await request('registrations.cleanup',{dryRun,...(cursor?{cursor}:{})},token);if(r.dryRun!==dryRun)throw new AdminApiError('INVALID_RESPONSE','材料维护返回异常，请重新检查。');return parseCleanupResult(r) },
    async registrations(token:string,competitionId:string,status?:string,cursor?:string) { const r=await request('registrations.listAdmin',{competitionId,...(status?{status}:{}),...(cursor?{cursor}:{})},token);return {...parseRegistrationPage(r),stats:parseRegistrationStats(r.stats)} },
    async registration(token:string,id:string) { return parseRegistration((await request('registrations.getAdmin',{id},token)).registration) },
    async reviewRegistration(token:string,id:string,expectedVersion:number,requestId:string,decision:'approved'|'rejected',reason:string,playerCount:number|null) { return parseRegistration((await request('registrations.review',{id,expectedVersion,requestId,decision,reason,playerCount},token)).registration) },
    async registrationFile(token:string,id:string,fileId:string) { return parseFileLink(await request('registrations.fileLink',{id,fileId},token)) },
    async cleanupTeamBadges(token:string,dryRun=true,cursor?:string) {const result=parseBadgeCleanup(await request('teams.badges.cleanup',{dryRun,...(cursor?{cursor}:{})},token));if(result.dryRun!==dryRun)throw new AdminApiError('INVALID_RESPONSE','队徽清理回执异常。');return result},
    async teams(token: string, cursor?: string) { return parseTeamPage(await request('teams.listAdmin', cursor ? { cursor } : {}, token)) },
    async team(token: string, id: string) { return parseManagedTeam((await request('teams.getAdmin', { id }, token)).team) },
    async competitions(token: string, cursor?: string) { return parseCompetitionPage(await request('competitions.listAdmin', cursor ? { cursor } : {}, token), true) },
    async createCompetition(token: string, requestId: string, form: CompetitionForm) { return parseCompetition((await request('competitions.create', { requestId, form }, token)).competition, true) },
    async updateCompetition(token: string, id: string, expectedVersion: number, form: CompetitionForm) { return parseCompetition((await request('competitions.update', { id, expectedVersion, form }, token)).competition, true) },
    async competitionSwitch(token: string, id: string, expectedVersion: number, kind: 'visibility' | 'registration', enabled: boolean) { return parseCompetition((await request(`competitions.${kind}`, { id, expectedVersion, enabled }, token)).competition, true) },
    async matches(token: string, competitionId: string, cursor?: string, teamId?: string) {
      const fields = { competitionId, ...(cursor ? { cursor } : {}), ...(teamId ? { teamId } : {}) }
      return parseMatchPage(await request('matches.listAdmin', fields, token), true)
    },
    async createMatch(token: string, requestId: string, form: MatchScheduleForm) {
      return parseMatch((await request('matches.create', { requestId, form }, token)).match, true)
    },
    async updateMatch(token: string, id: string, expectedVersion: number, form: MatchScheduleForm) {
      return parseMatch((await request('matches.update', { id, expectedVersion, form }, token)).match, true)
    },
    async evaluation(token: string, matchId: string): Promise<EvaluationAdmin> { return parseEvaluationAdmin(await request('evaluation.getAdmin', { matchId }, token)) },
    async configureEvaluation(token: string, competitionId: string, expectedVersion: number, requestId: string, config: Omit<EvaluationConfig, 'competitionId' | 'version' | 'updatedAt'>) {
      return parseEvaluationConfig((await request('evaluation.configure', { competitionId, expectedVersion, requestId, config }, token)).config)
    },
    async publishEvaluationAwards(token: string, matchId: string, expectedVersion: number, requestId: string, awards: { type: 'mvp' | 'lineup'; playerId: string; position: string | null; rank: number }[]) {
      return request('evaluation.publishAwards', { matchId, expectedVersion, requestId, awards }, token)
    },
    async moderateEvaluationComment(token: string, id: string, hidden: boolean, expectedVersion: number) { return request('evaluation.moderateComment', { id, hidden, expectedVersion }, token) },
    async login(username: string, password: string): Promise<AdminSession & { token: string }> {
      const value = await request('login', { username, password })
      const session = checkSession(value)
      if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) throw new AdminApiError('INVALID_RESPONSE', '管理服务返回异常，请重试。')
      return { ...session, token: value.token }
    },
    async session(token: string) { return checkSession(await request('session', {}, token)) },
    async logout(token: string) { await request('logout', {}, token) },
    async overview(token: string): Promise<AdminOverview> {
      const value = await request('overview', {}, token)
      const session = checkSession(value)
      if (!Array.isArray(value.availableModules) || !value.availableModules.every((x: unknown) => typeof x === 'string')
        || typeof value.serverTime !== 'string' || !Number.isFinite(Date.parse(value.serverTime))) throw new AdminApiError('INVALID_RESPONSE', '管理服务返回异常，请重试。')
      return { ...session, availableModules: value.availableModules, serverTime: value.serverTime }
    },
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>

// Auth retains the API object created at login. Replacing only this module
// cannot add new methods to that object; reload to recreate it from current code.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
import { parseCompetition, parseCompetitionPage, type CompetitionForm } from '../../src/domain/competition'

import { parseTeamPage, parseManagedTeam } from '../../src/domain/team'
import {parseRegistration,parseRegistrationPage,parseFileLink} from '../../src/domain/registration'
import {parseRegistrationStats} from '../../src/domain/competition'
