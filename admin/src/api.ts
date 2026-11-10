import {parseCleanupResult} from './registration-maintenance'
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
    async cleanupRegistrationFiles(token:string,dryRun=true,cursor?:string) { const r=await request('registrations.cleanup',{dryRun,...(cursor?{cursor}:{})},token);if(r.dryRun!==dryRun)throw new AdminApiError('INVALID_RESPONSE','材料维护返回异常，请重新检查。');return parseCleanupResult(r) },
    async registrations(token:string,competitionId:string,status?:string,cursor?:string) { const r=await request('registrations.listAdmin',{competitionId,...(status?{status}:{}),...(cursor?{cursor}:{})},token);return {...parseRegistrationPage(r),stats:parseRegistrationStats(r.stats)} },
    async registration(token:string,id:string) { return parseRegistration((await request('registrations.getAdmin',{id},token)).registration) },
    async reviewRegistration(token:string,id:string,expectedVersion:number,requestId:string,decision:'approved'|'rejected',reason:string,playerCount:number|null) { return parseRegistration((await request('registrations.review',{id,expectedVersion,requestId,decision,reason,playerCount},token)).registration) },
    async registrationFile(token:string,id:string,fileId:string) { return parseFileLink(await request('registrations.fileLink',{id,fileId},token)) },
    async teams(token: string, cursor?: string) { return parseTeamPage(await request('teams.listAdmin', cursor ? { cursor } : {}, token)) },
    async team(token: string, id: string) { return parseManagedTeam((await request('teams.getAdmin', { id }, token)).team) },
    async competitions(token: string, cursor?: string) { return parseCompetitionPage(await request('competitions.listAdmin', cursor ? { cursor } : {}, token), true) },
    async createCompetition(token: string, requestId: string, form: CompetitionForm) { return parseCompetition((await request('competitions.create', { requestId, form }, token)).competition, true) },
    async updateCompetition(token: string, id: string, expectedVersion: number, form: CompetitionForm) { return parseCompetition((await request('competitions.update', { id, expectedVersion, form }, token)).competition, true) },
    async competitionSwitch(token: string, id: string, expectedVersion: number, kind: 'visibility' | 'registration', enabled: boolean) { return parseCompetition((await request(`competitions.${kind}`, { id, expectedVersion, enabled }, token)).competition, true) },
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
import { parseCompetition, parseCompetitionPage, type CompetitionForm } from '../../src/domain/competition'

import { parseTeamPage, parseManagedTeam } from '../../src/domain/team'
import {parseRegistration,parseRegistrationPage,parseFileLink} from '../../src/domain/registration'
import {parseRegistrationStats} from '../../src/domain/competition'
