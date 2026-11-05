export const teamDistricts = ['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区','浦东新区','闵行区','宝山区','嘉定区','金山区','松江区','青浦区','奉贤区','崇明区']
export const playerPositions = [
  { value:'goalkeeper', label:'门将' }, { value:'defender', label:'后卫' },
  { value:'midfielder', label:'中场' }, { value:'forward', label:'前锋' },
] as const
export type PlayerPosition = typeof playerPositions[number]['value']
export interface TeamForm { name:string; district:string; description:string; contactPhone:string }
export interface PlayerForm { name:string; number:number; position:PlayerPosition }
export interface TeamPlayer extends PlayerForm { id:string }
export interface TeamSummary extends TeamForm {
  status:'active'|'dissolved'; dissolvedAt:string|null
  id:string; version:number; playerCount:number; badgeUploadEnabled:boolean; badgeUrl:string; createdAt:string; updatedAt:string
}
export interface ManagedTeam extends TeamSummary { leaderNickname:string; players:TeamPlayer[] }
export class TeamClientError extends Error { constructor(public readonly code:string,message:string) { super(message);this.name='TeamClientError' } }
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const invalid=():never=>{throw new TeamClientError('INVALID_RESPONSE','球队资料返回异常，请重新读取。')}
export function positionLabel(value:string){return playerPositions.find(p=>p.value===value)?.label||'未设置'}
export function parseTeamSummary(v:unknown):TeamSummary {
  if(!object(v)||typeof v.id!=='string'||!/^t_[a-f0-9]{64}$/.test(v.id)
    ||typeof v.name!=='string'||!v.name.trim()||typeof v.district!=='string'||!teamDistricts.includes(v.district)
    ||typeof v.description!=='string'||typeof v.contactPhone!=='string'||!v.contactPhone
    ||!Number.isSafeInteger(v.version)||v.version<1||!Number.isInteger(v.playerCount)||v.playerCount<0||v.playerCount>99
    ||v.badgeUploadEnabled!==false||v.badgeUrl!==''
    ||![undefined,'active','dissolved'].includes(v.status)
    ||(v.status==='dissolved'?(typeof v.dissolvedAt!=='string'||!Number.isFinite(Date.parse(v.dissolvedAt))):v.dissolvedAt!=null)
    ||typeof v.createdAt!=='string'||!Number.isFinite(Date.parse(v.createdAt))||typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt))) return invalid()
  return {id:v.id,status:v.status||'active',dissolvedAt:v.dissolvedAt||null,name:v.name,district:v.district,description:v.description,contactPhone:v.contactPhone,version:v.version,playerCount:v.playerCount,badgeUploadEnabled:v.badgeUploadEnabled,badgeUrl:v.badgeUrl,createdAt:v.createdAt,updatedAt:v.updatedAt}
}
export function parseManagedTeam(v:unknown):ManagedTeam {
  const summary=parseTeamSummary(v)
  if(!object(v)||typeof v.leaderNickname!=='string'||!Array.isArray(v.players)||v.players.length!==summary.playerCount)return invalid()
  const ids=new Set<string>(),numbers=new Set<number>()
  const players=v.players.map((p:any):TeamPlayer=>{
    if(!object(p)||typeof p.id!=='string'||!/^p_[a-f0-9]{32}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()
      ||!Number.isInteger(p.number)||p.number<1||p.number>99||numbers.has(p.number)||!playerPositions.some(o=>o.value===p.position))return invalid()
    ids.add(p.id);numbers.add(p.number);return {id:p.id,name:p.name,number:p.number,position:p.position}
  })
  return {...summary,leaderNickname:v.leaderNickname,players}
}
export function parseTeamPage(v:unknown):{teams:TeamSummary[];nextCursor:string|null}{
 if(!object(v)||v.ok!==true||!Array.isArray(v.teams)||v.teams.length>20||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^t_[a-f0-9]{64}$/.test(v.nextCursor)))return invalid()
 const teams=v.teams.map(parseTeamSummary)
 if(new Set(teams.map(t=>t.id)).size!==teams.length)return invalid()
 return {teams,nextCursor:v.nextCursor}
}
// Request identifiers are for retry deduplication, never for identity or authorization.
export function teamRequestId(){return Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('')}
