import {parseManagedTeam,TeamClientError,type ManagedTeam,type TeamForm,type PlayerForm} from './team'

export interface LeaderOption {id:string;nickname:string;phoneHint:string;available:boolean;reason:string}
export type TeamMutation =
 | {action:'teams.createAdmin';requestId:string;leaderId:string;form:TeamForm}
 | {action:'teams.updateAdmin';requestId:string;id:string;expectedVersion:number;form:TeamForm}
 | {action:'teams.savePlayerAdmin';requestId:string;id:string;expectedVersion:number;playerId:string;form:PlayerForm}
 | {action:'teams.removePlayerAdmin';requestId:string;id:string;expectedVersion:number;playerId:string;confirmName:string}
 | {action:'teams.assignLeaderAdmin';requestId:string;id:string;expectedVersion:number;leaderId:string;confirmName:string}
 | {action:'teams.dissolveAdmin';requestId:string;id:string;expectedVersion:number;confirmName:string}
const invalid=():never=>{throw new TeamClientError('INVALID_RESPONSE','球队管理返回异常，请重新读取。')}
export function parseLeaderPage(v:any):{leaders:LeaderOption[];nextCursor:string|null}{
 if(!v||v.ok!==true||!Array.isArray(v.leaders)||v.leaders.length>20||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^[a-f0-9]{64}$/.test(v.nextCursor)))return invalid()
 const ids=new Set<string>()
 const leaders=v.leaders.map((u:any):LeaderOption=>{
  if(!u||typeof u.id!=='string'||!/^[a-f0-9]{64}$/.test(u.id)||ids.has(u.id)||typeof u.nickname!=='string'||typeof u.phoneHint!=='string'||typeof u.available!=='boolean'||typeof u.reason!=='string'||u.available&&(!u.nickname.trim()||!!u.reason)||!u.available&&!u.reason)return invalid()
  ids.add(u.id);return {id:u.id,nickname:u.nickname,phoneHint:u.phoneHint,available:u.available,reason:u.reason}
 })
 return {leaders,nextCursor:v.nextCursor}
}
export function parseTeamMutation(v:any,request:TeamMutation):ManagedTeam{
 if(!v||v.ok!==true||v.action!==request.action||v.requestId!==request.requestId)return invalid()
 const team=parseManagedTeam(v.team)
 if(request.action==='teams.createAdmin'){if(typeof v.created!=='boolean')return invalid()}
 else if(team.id!==request.id||team.version<=request.expectedVersion)return invalid()
 if(request.action==='teams.dissolveAdmin'&&team.status!=='dissolved')return invalid()
 return team
}
