import { describe, expect, it, vi } from 'vitest'
import { AdminAuthService, hashSecret } from './admin-auth.service.js'
import { AppRole, UserStatus } from '../generated/prisma/enums.js'
const token='a'.repeat(43)
const user={id:'admin',displayName:'管理员',status:UserStatus.ACTIVE,deletedAt:null,primaryRole:AppRole.SUPER_ADMIN,roles:[{role:AppRole.MEMBER}]}
const setup=(overrides:Record<string,unknown>={})=>{
 const prisma={adminBrowserSession:{findUnique:vi.fn(async()=>({id:'session',expiresAt:new Date(Date.now()+10000),revokedAt:null,user,...overrides}))}}
 const config={get:(key:string)=>key==='ADMIN_CONSOLE_ORIGIN'?'https://api.example.test':undefined,getOrThrow:()=> 'isolated-test-key'}
 return {service:new AdminAuthService(prisma as never,config as never),prisma}
}
describe('admin browser authentication boundary',()=>{
 it('rejects non-ASCII csrf input without a comparison exception',async()=>{const{service}=setup();await expect(service.authenticate({method:'POST',headers:{origin:'https://api.example.test',cookie:`__Host-yanqing-admin-session=${token}`,'x-csrf-token':'é'.repeat(64)}} as never)).rejects.toThrow('页面校验')})
 it('does not store bearer material in a lookup key',()=>expect(hashSecret(token)).not.toContain(token))
 it('requires an exact trusted origin',()=>{const {service}=setup();expect(()=>service.assertOrigin({headers:{origin:'https://api.example.test.evil'}} as never)).toThrow();expect(()=>service.assertOrigin({headers:{}} as never)).toThrow()})
 it('rejects duplicate cookies and malformed cookie values',()=>{const {service}=setup();expect(service.cookie({headers:{cookie:`__Host-yanqing-admin-session=${token}; __Host-yanqing-admin-session=${token}`}},'session')).toBeUndefined();expect(service.cookie({headers:{cookie:'__Host-yanqing-admin-session=broken'}},'session')).toBeUndefined()})
 it.each([{revokedAt:new Date()},{expiresAt:new Date(0)},{user:{...user,status:UserStatus.DISABLED}},{user:{...user,deletedAt:new Date()}},{user:{...user,primaryRole:AppRole.MEMBER,roles:[]}}])('rejects revoked/expired/disabled/deleted/unprivileged identities: %j',async overrides=>{const{service}=setup(overrides);await expect(service.sessionInfo(token)).rejects.toThrow()})
 it('checks current database roles and requires csrf for unsafe requests',async()=>{const{service}=setup();const headers={cookie:`__Host-yanqing-admin-session=${token}`};const safe=await service.authenticate({method:'GET',headers} as never);expect(safe.roles).toEqual([AppRole.SUPER_ADMIN,AppRole.MEMBER]);expect(safe.adminSessionId).toBe('session');await expect(service.authenticate({method:'POST',headers:{...headers,origin:'https://api.example.test'}} as never)).rejects.toThrow('页面校验');const info=await service.sessionInfo(token);await expect(service.authenticate({method:'POST',headers:{...headers,origin:'https://api.example.test','x-csrf-token':info.csrfToken}} as never)).resolves.toMatchObject({loginMethod:'admin'})})
 it.each(['development','admin',undefined])('cannot approve a QR with login source %s',async loginMethod=>{const{service}=setup();await expect(service.inspectChallenge('id',token,{sub:'admin',displayName:'管理员',roles:[AppRole.SUPER_ADMIN],loginMethod} as never)).rejects.toThrow('真实微信登录')})
 it('rejects foreign-origin reads even if a cookie is attached',async()=>{const{service,prisma}=setup();await expect(service.authenticate({method:'GET',headers:{origin:'https://foreign.test',cookie:`__Host-yanqing-admin-session=${token}`}} as never)).rejects.toThrow();expect(prisma.adminBrowserSession.findUnique).not.toHaveBeenCalled()})
})
