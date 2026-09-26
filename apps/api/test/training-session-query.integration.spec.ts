import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { TrainingScheduleService } from '../src/training/schedule/training-schedule.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('session queries on PostgreSQL', () => {
  let db: PrismaService, service: TrainingScheduleService;
  const key=randomUUID();
  const coach={sub:`query-coach-${key}`,roles:['COACH']} as AuthUser;
  const stranger={sub:`other-${key}`,roles:['COACH']} as AuthUser;
  const administrator={sub:`admin-${key}`,roles:['ADMIN']} as AuthUser;
  let productId:string, classId:string, todayId:string;
  const date='2030-09-26';
  beforeAll(async()=>{
    const target=new URL(url!);
    if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw new Error('Isolated local test database required');
    db=new PrismaService(new ConfigService({DATABASE_URL:url})); await db.$connect();
    service=new TrainingScheduleService(db);
    const product=await db.trainingProduct.create({data:{code:key,name:'分页测试',audience:'ADULT',totalSessions:1,validityDays:30,priceCents:100,unitRevenueCents:100,refundRule:{}}}); productId=product.id;
    const group=await db.trainingClass.create({data:{code:key,productId,name:`分页班-${key}`,coachId:coach.sub,schedule:{},capacity:10}}); classId=group.id;
    const first=new Date(`${date}T10:00:00+08:00`);
    const rows=Array.from({length:102},(_,index)=>{const startsAt=new Date(+first+index*86400000);return {id:`${key}-${index}`,classId,startsAt,endsAt:new Date(+startsAt+3600000),courtCount:1,occupiedCourtHours:1};});
    todayId=rows[0].id; await db.trainingSession.createMany({data:rows});
  });
  afterAll(async()=>{
    if(classId){await db.trainingSession.deleteMany({where:{classId}});await db.trainingClass.delete({where:{id:classId}});}
    if(productId)await db.trainingProduct.delete({where:{id:productId}});
    await db?.$disconnect();
  });
  it('finds today before applying a limit even with 101 later records',async()=>{
    const result=await service.searchSessions({date,page:1,pageSize:50},coach);
    expect(result.items.map(row=>row.id)).toEqual([todayId]); expect(result.hasMore).toBe(false);
  });
  it('pages through the full set with stable ordering and no repeated rows',async()=>{
    const pages=[];
    for(let page=1;page<=3;page++)pages.push(await service.searchSessions({page,pageSize:50,search:key},administrator));
    expect(pages.map(page=>page.items.length)).toEqual([50,50,2]);
    expect(pages.map(page=>page.hasMore)).toEqual([true,true,false]);
    expect(new Set(pages.flatMap(page=>page.items.map(row=>row.id))).size).toBe(102);
  });
  it('opens an older detail and denies the same ID to another coach',async()=>{
    const record=await service.getSession(todayId,coach); expect(record.id).toBe(todayId);
    expect(record).not.toHaveProperty('coachCostCents');
    await expect(service.getSession(todayId,stranger)).rejects.toThrow('无权查看');
    expect((await service.searchSessions({page:1,pageSize:50,date},stranger)).items).toEqual([]);
  });
});
