import { describe, expect, it, vi } from 'vitest';
import { useTrainingSessionList } from './session-list';
import { useCoachTeachingData } from './teaching';
import { endpoints } from '../../../../../services/api';
vi.mock('../../../../../services/api',()=>({ endpoints: { trainingSessionPage:vi.fn(), trainingSession:vi.fn(), trainingSessions:vi.fn(), adminEnrollments:vi.fn(), trainingConsumeCorrections:vi.fn() } }));
const page = (ids:string[], number=1, hasMore=false) => ({items:ids.map(id=>({id})),page:number,pageSize:50,hasMore});
describe('session pagination ownership',()=>{
  it('discards a previous date response and preserves the next page on failed load-more',async()=>{
    let date='2026-09-26'; const list=useTrainingSessionList(()=> 'coach',()=>({date}));
    let resolveOld!:(value:any)=>void;
    vi.mocked(endpoints.trainingSessionPage).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}));
    const old=list.refresh(); date='2026-09-27'; list.reset();
    vi.mocked(endpoints.trainingSessionPage).mockResolvedValueOnce(page(['new'],1,true) as never); await list.refresh();
    resolveOld(page(['old'])); await old;
    expect(list.items.value.map(item=>item.id)).toEqual(['new']);
    vi.mocked(endpoints.trainingSessionPage).mockRejectedValueOnce(new Error('断网')); await list.more();
    expect(list.error.value).toBe('断网'); expect(list.hasMore.value).toBe(true);
    vi.mocked(endpoints.trainingSessionPage).mockResolvedValueOnce(page(['next'],2) as never); await list.more();
    expect(endpoints.trainingSessionPage).toHaveBeenLastCalledWith(expect.objectContaining({date:'2026-09-27',page:2}));
    expect(list.items.value.map(item=>item.id)).toEqual(['new','next']);
  });
  it('hides account-owned pages immediately when accounts change',async()=>{
    let actor='admin'; const list=useTrainingSessionList(()=>actor,()=>({}));
    vi.mocked(endpoints.trainingSessionPage).mockResolvedValueOnce(page(['private']) as never); await list.refresh();
    actor='coach'; expect(list.items.value).toEqual([]);
  });
  it('keeps old session details independent of today and upcoming choices',async()=>{
    vi.mocked(endpoints.trainingSessionPage).mockResolvedValue(page(['today']) as never);
    vi.mocked(endpoints.trainingSessions).mockResolvedValue([{id:'future'}] as never);
    vi.mocked(endpoints.trainingSession).mockResolvedValue({id:'history'} as never);
    vi.mocked(endpoints.adminEnrollments).mockResolvedValue([]);
    vi.mocked(endpoints.trainingConsumeCorrections).mockResolvedValue([]);
    const data=useCoachTeachingData(()=> 'coach',()=>({date:'2026-09-26'}),()=>({id:'history'}));
    await data.refresh();
    expect(data.list.items.value.map(item=>item.id)).toEqual(['today']);
    expect(data.lessons.value.map(item=>item.id)).toEqual(['today','future','history']);
    expect(endpoints.trainingSession).toHaveBeenCalledWith('history');
    expect(endpoints.trainingSessions).toHaveBeenCalledWith({upcoming:'true'});
  });
});

it('keeps a list failure in the list retry state instead of leaving a stale page-wide error', async () => {
  vi.mocked(endpoints.trainingSessionPage).mockRejectedValueOnce(new Error('课表加载失败'));
  vi.mocked(endpoints.trainingSessions).mockResolvedValue([]);
  vi.mocked(endpoints.adminEnrollments).mockResolvedValue([]);
  vi.mocked(endpoints.trainingConsumeCorrections).mockResolvedValue([]);
  const data = useCoachTeachingData(() => 'coach'); await data.refresh();
  expect(data.list.error.value).toBe('课表加载失败'); expect(data.error.value).toBe('');
  vi.mocked(endpoints.trainingSessionPage).mockResolvedValueOnce(page(['recovered']) as never);
  await data.list.retry(); expect(data.list.error.value).toBe(''); expect(data.error.value).toBe('');
});
