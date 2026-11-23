let check: () => void = () => {}
export function setRecoveryWriteCheck(value: () => void) { check = value }
export function assertRecoveryWritable(name: string, data: Record<string,unknown>) {
 const action=String(data.action||'')
 if(name==='publicRead')return
 if(name==='adminAuth'&&(/\.(getPublic|listPublic)$/.test(action)||['search.public','search.suggestions','directory.teamPublic','directory.playerPublic','directory.homePublic','directory.teamProfilePublic','directory.playerProfilePublic'].includes(action)))return
 if(name==='teamManagement'&&['mine','checkDissolution','registrations.prepare','registrations.listMine','registrations.getMine','registrations.fileLink','badges.config','badges.get'].includes(action))return
 if(name==='userProfile'&&action==='favorites.get')return
 check()
}
