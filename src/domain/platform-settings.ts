import schema from './platform-settings-schema.json'
export const themes=schema.themes
export const navigationIcons=schema.icons
export type NavigationTarget='home'|'tournament'|'news'|'stats'|'search'|'profile'
export interface NavigationItem {id:NavigationTarget;label:string;icon:string}
export interface PlatformForm {title:string;subtitle:string;theme:string;customColor:string;mode:'light'|'dark';radius:'square'|'soft'|'round';navigation:NavigationItem[]}
export interface PlatformSettings {version:number;updatedAt:string|null;form:PlatformForm}
export class SettingsClientError extends Error {constructor(public readonly code:string,message:string){super(message);this.name='SettingsClientError'}}
export const defaultPlatformForm=():PlatformForm=>JSON.parse(JSON.stringify(schema.defaults))
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const text=(v:any,max:number)=>typeof v==='string'&&v.length>0&&v.trim()===v&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)
export function parsePlatformForm(v:any):PlatformForm {
 const invalid=()=>{throw new SettingsClientError('INVALID_RESPONSE','平台设置格式异常，请重新读取。')}
 if(!object(v)||!text(v.title,16)||!text(v.subtitle,24)||!['custom',...themes.map(t=>t.id)].includes(v.theme)||typeof v.customColor!=='string'||!/^#[a-fA-F0-9]{6}$/.test(v.customColor)||!['light','dark'].includes(v.mode)||!['square','soft','round'].includes(v.radius))return invalid()
 if(!Array.isArray(v.navigation)||v.navigation.length!==6||v.navigation.some((n:any)=>!object(n)||!schema.defaults.navigation.some(s=>s.id===n.id)||!text(n.label,4)||!navigationIcons.includes(n.icon))||new Set(v.navigation.map((n:any)=>n.id)).size!==6)return invalid()
 return {title:v.title,subtitle:v.subtitle,theme:v.theme,customColor:v.customColor.toLowerCase(),mode:v.mode,radius:v.radius,navigation:v.navigation.map((n:any)=>({id:n.id,label:n.label,icon:n.icon}))}
}
export function parsePlatformSettings(v:any):PlatformSettings {
 if(!object(v)||!Number.isSafeInteger(v.version)||v.version<0||(v.version===0?v.updatedAt!==null:typeof v.updatedAt!=='string'||!Number.isFinite(Date.parse(v.updatedAt))))throw new SettingsClientError('INVALID_RESPONSE','平台设置版本异常，请重新读取。')
 return {version:v.version,updatedAt:v.updatedAt,form:parsePlatformForm(v.form)}
}
export function themeTokens(form:PlatformForm):Record<string,string> {
 const candidate=form.theme==='custom'?form.customColor:themes.find(t=>t.id===form.theme)?.color
 // The editor previews partially entered values; only a complete hex color is applied.
 const accent=candidate&&/^#[a-fA-F0-9]{6}$/.test(candidate)?candidate:themes[0].color
 const dark=form.mode==='dark', rgb=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16))
 const luminance=(values:number[])=>values.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0)
 const lum=luminance(rgb)
 const mix=(base:number[],weight:number)=>'#'+rgb.map((v,i)=>Math.round(v*weight+base[i]*(1-weight)).toString(16).padStart(2,'0')).join('')
 // A readable accent is separate from the chosen button background.
 const base=dark?[255,255,255]:[0,0,0],backgrounds=dark?[[20,27,35],[32,42,53],[40,52,64]]:[[255,255,255],[242,245,240],[255,255,255].map((v,i)=>Math.round(rgb[i]*0.08+v*0.92))]
 let weight=1
 while(weight>0&&backgrounds.some(bg=>{const a=luminance(rgb.map((v,i)=>Math.round(v*weight+base[i]*(1-weight)))),b=luminance(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)<4.5}))weight=Math.max(0,weight-0.025)
 const link=mix(base,weight)
 return {'--green':link,'--accent':accent,'--on-accent':lum>0.179?'#000000':'#ffffff','--ink':dark?'#edf1f5':'#233a2e','--muted':dark?'#b9c3cd':'#526657','--paper':dark?'#141b23':'#f2f5f0','--white':dark?'#202a35':'#ffffff','--surface':dark?'#202a35':'#ffffff','--surface-soft':dark?'#283440':mix([255,255,255],0.08),'--line':dark?'#485766':'#d7e1d5','--radius':form.radius==='square'?'0px':form.radius==='round'?'20px':'10px','--small-radius':form.radius==='square'?'0px':form.radius==='round'?'12px':'6px','--theme-hero':mix([0,0,0],dark?0.30:0.35)}
}
