import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import {
  AppRole,
  EventStatus,
  SourceChannel,
  TeamCategory,
} from '../generated/prisma/enums.js';
import { EventsService, eventPointRecipientIds } from './events.service.js';
import {
  RegisterEventTeamDto,
  AcceptEventTeamInviteDto,
} from './events.dto.js';

const captain = {
  sub: 'captain',
  displayName: '队长昵称',
  roles: [AppRole.MEMBER],
};
const partner = {
  sub: 'partner',
  displayName: '搭档昵称',
  roles: [AppRole.MEMBER],
};
const stranger = {
  sub: 'stranger',
  displayName: '其他人',
  roles: [AppRole.MEMBER],
};
const manual = {
  registrationMode: 'MANUAL' as const,
  captainPlays: true,
  consent: true,
  name: '双人队',
  playerAName: '张甲',
  playerAPhone: '13810000001',
  playerBName: '李乙',
  playerBPhone: '13810000002',
  category: TeamCategory.MIXED_DOUBLES,
  sourceChannel: SourceChannel.MINI_PROGRAM,
};
const invitation = {
  name: manual.name,
  playerAName: manual.playerAName,
  playerAPhone: manual.playerAPhone,
  category: manual.category,
  consent: true,
};
const acceptCommand = {
  partnerInviteCode: 'EP_test_invitation_1234567890',
  playerBName: manual.playerBName,
  playerBPhone: manual.playerBPhone,
  consent: true,
};
const event = {
  id: 'event',
  name: '金羽双打赛',
  code: 'EVENT-TEST',
  status: EventStatus.OPEN,
  startsAt: new Date('2099-09-02T10:00:00Z'),
  registrationEndsAt: new Date('2099-09-02T09:00:00Z'),
  capacityPeople: 24,
  minimumPeople: 24,
  totalRounds: 5,
  feeCents: 8800,
  memberFeeCents: null,
};
function fixture() {
  let record: any = {
    id: 'invite',
    eventId: event.id,
    captainId: captain.sub,
    partnerId: null,
    tokenHash: createHash('sha256')
      .update(acceptCommand.partnerInviteCode)
      .digest('hex'),
    teamName: manual.name,
    category: manual.category,
    playerAName: manual.playerAName,
    playerAPhone: manual.playerAPhone,
    expiresAt: new Date(Date.now() + 3600000),
    revokedAt: null,
    consumedAt: null,
    acceptedAt: null,
    event,
    captain: {
      ...captain,
      id: captain.sub,
      status: 'ACTIVE',
      deletedAt: null,
      avatarUrl: '/uploads/captain.jpg',
    },
    partner: null,
  };
  const tx = {
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    memberProfile: {
      findUnique: vi.fn().mockResolvedValue({ id: 'profile', level: 'NORMAL' }),
    },
    eventTeam: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }) => ({ id: 'team-wait', ...data })),
    },
    eventPartnerInvite: {
      findUnique: vi.fn(async () => record),
      create: vi.fn(async ({ data }) => ({ id: 'new-invite', ...data })),
      updateMany: vi.fn(async ({ data }) => {
        Object.assign(record, data);
        if (data.partnerId)
          record.partner = {
            id: data.partnerId,
            displayName: partner.displayName,
            status: 'ACTIVE',
            deletedAt: null,
            avatarUrl: '/uploads/partner.jpg',
            memberProfile: { id: 'profile' },
          };
        return { count: 1 };
      }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(async ({ data }) => ({
        id: 'order',
        orderNo: 'EV-TEST',
        eventTeam: { id: 'team', ...data.eventTeam.create },
        ...Object.fromEntries(
          Object.entries(data).filter(([key]) => key !== 'eventTeam'),
        ),
      })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (work: any) => work(tx)) };
  return { service: new EventsService(prisma as never), tx, prisma, record };
}
describe('two-person signup without a second login', () => {
  it('requires two names, normalized valid phones and consent', async () => {
    for (const change of [
      { playerBName: '' },
      { playerBPhone: '' },
      { consent: false },
      { playerBPhone: manual.playerAPhone },
    ]) {
      const { service, tx } = fixture();
      await expect(
        service.register('event', { ...manual, ...change }, captain),
      ).rejects.toThrow();
      expect(tx.order.create).not.toHaveBeenCalled();
    }
    const dto = plainToInstance(RegisterEventTeamDto, {
      ...manual,
      playerAPhone: '+86 138-1000-0001',
    });
    expect(dto.playerAPhone).toBe('13810000001');
    expect(await validate(dto)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(AcceptEventTeamInviteDto, {
          ...acceptCommand,
          playerBPhone: '123',
        }),
      ),
    ).not.toHaveLength(0);
  });
  it('creates one team order with a guest contact, never a guest account', async () => {
    const { service, tx } = fixture();
    const result: any = await service.register('event', manual, captain);
    expect(result.id).toBe('order');
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.memberId).toBe(captain.sub);
    expect(data.payableCents).toBe(8800);
    expect(data.eventTeam.create).toMatchObject({
      ...Object.fromEntries(
        ['playerAName', 'playerBName', 'playerAPhone', 'playerBPhone'].map(
          (key) => [key, manual[key as keyof typeof manual]],
        ),
      ),
      playerAUserId: captain.sub,
      playerBUserId: null,
      registrationMode: 'MANUAL',
      captainPlays: true,
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.eventPartnerInvite.findUnique).not.toHaveBeenCalled();
  });
  it('keeps a non-playing payer out of participant accounts and points', async () => {
    const { service, tx } = fixture();
    await service.register(
      'event',
      { ...manual, captainPlays: false },
      captain,
    );
    const team = tx.order.create.mock.calls[0][0].data.eventTeam.create;
    expect(team).toMatchObject({
      captainId: captain.sub,
      captainPlays: false,
      playerAUserId: null,
      playerBUserId: null,
    });
    expect(eventPointRecipientIds(team)).toEqual([]);
    expect(
      eventPointRecipientIds({ ...team, playerAUserId: 'actual-player' }),
    ).toEqual(['actual-player']);
    expect(
      eventPointRecipientIds({
        ...team,
        captainPlays: true,
        playerAUserId: captain.sub,
      }),
    ).toEqual([captain.sub]);
  });
  it('allows distinct people with the same name and different phone numbers', async () => {
    const { service } = fixture();
    await expect(
      service.register(
        'event',
        { ...manual, playerBName: manual.playerAName },
        captain,
      ),
    ).resolves.toBeTruthy();
  });
  it('rejects direct binding to another user or mixing manual and invite paths', async () => {
    const { service } = fixture();
    for (const change of [
      { playerBUserId: 'victim' },
      { playerAUserId: 'victim' },
      { partnerInviteCode: acceptCommand.partnerInviteCode },
    ]) {
      await expect(
        service.register('event', { ...manual, ...change }, captain),
      ).rejects.toThrow();
    }
  });
  it('checks contacts against active guest entries and phone-linked existing accounts', async () => {
    const { service, tx } = fixture();
    tx.user.findMany.mockResolvedValue([{ id: 'existing-account' }] as never);
    tx.eventTeam.findFirst.mockImplementation(async ({ where }: any) =>
      where.OR.some((item: any) => item.playerAPhone)
        ? { id: 'already-entered' }
        : null,
    );
    await expect(service.register('event', manual, captain)).rejects.toThrow(
      '重复提交',
    );
    expect(
      tx.eventTeam.findFirst.mock.calls.some(([query]) =>
        JSON.stringify(query).includes('existing-account'),
      ),
    ).toBe(true);
    expect(tx.order.create).not.toHaveBeenCalled();
  });
  it('creates a waitlist entry with both contacts without charging', async () => {
    const { service, tx } = fixture();
    tx.eventTeam.count.mockResolvedValue(12);
    const result: any = await service.register('event', manual, captain);
    expect(result.status).toBe('WAITLISTED');
    expect(tx.eventTeam.create.mock.calls[0][0].data).toMatchObject({
      playerAPhone: manual.playerAPhone,
      playerBPhone: manual.playerBPhone,
    });
    expect(tx.order.create).not.toHaveBeenCalled();
  });
  it('hashes both phones and payer participation in idempotency commands', async () => {
    const { service, tx } = fixture();
    await service.register(
      'event',
      { ...manual, creationIdempotencyKey: 'create-manual-unique' },
      captain,
    );
    const stored = tx.order.create.mock.calls[0][0].data.eventTeam.create;
    tx.eventTeam.findUnique.mockResolvedValue({
      ...stored,
      id: 'team',
      orderId: 'order',
    } as never);
    tx.order.findUniqueOrThrow.mockResolvedValue({ id: 'order' });
    await expect(
      service.register(
        'event',
        { ...manual, creationIdempotencyKey: 'create-manual-unique' },
        captain,
      ),
    ).resolves.toMatchObject({ id: 'order' });
    await expect(
      service.register(
        'event',
        {
          ...manual,
          playerBPhone: '13810000003',
          creationIdempotencyKey: 'create-manual-unique',
        },
        captain,
      ),
    ).rejects.toThrow('幂等键');
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });
});
describe('captain-issued share invitations', () => {
  it('stores only an opaque token hash with event-limited expiry, not the raw code', async () => {
    const { service, tx } = fixture();
    const created = await service.createTeamInvite(
      'event',
      invitation,
      captain,
    );
    expect(created.partnerInviteCode).toMatch(/^EP_[A-Za-z0-9_-]{32}$/);
    const data = tx.eventPartnerInvite.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      captainId: captain.sub,
      playerAPhone: manual.playerAPhone,
    });
    expect(data.tokenHash).toBe(
      createHash('sha256').update(created.partnerInviteCode).digest('hex'),
    );
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 86400000,
    );
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      manual.playerAPhone,
    );
    expect(JSON.stringify(data)).not.toContain(created.partnerInviteCode);
  });
  it('public preview contains inviter nickname/avatar but no contact or account information', async () => {
    const { service, record } = fixture();
    record.partnerId = partner.sub;
    record.acceptedAt = new Date();
    record.playerBName = '私有姓名';
    record.playerBPhone = manual.playerBPhone;
    const view = await service.previewTeamInvite(
      'event',
      acceptCommand.partnerInviteCode,
    );
    expect(view.captain).toEqual({
      displayName: captain.displayName,
      avatarUrl: '/uploads/captain.jpg',
    });
    expect(view.role).toBe('VISITOR');
    expect(JSON.stringify(view)).not.toMatch(
      /Phone|UserId|captainId|partnerId|tokenHash|私有姓名|138100000/,
    );
  });
  it('accepts once, preserves consented participant info, and does not enroll or pay yet', async () => {
    const { service, tx } = fixture();
    const view = await service.acceptTeamInvite(
      'event',
      acceptCommand,
      partner,
    );
    expect(view).toMatchObject({
      status: 'ACCEPTED',
      role: 'PARTNER',
      playerBName: manual.playerBName,
    });
    await service.acceptTeamInvite('event', acceptCommand, partner);
    expect(tx.eventPartnerInvite.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.order.create).not.toHaveBeenCalled();
    await expect(
      service.acceptTeamInvite('event', acceptCommand, stranger),
    ).rejects.toThrow('其他搭档');
    await expect(
      service.acceptTeamInvite(
        'event',
        { ...acceptCommand, playerBName: '换名字' },
        partner,
      ),
    ).rejects.toThrow('不能覆盖');
  });
  it('rejects self-acceptance, expired, revoked, cross-event and duplicate-phone invitations', async () => {
    const first = fixture();
    await expect(
      first.service.acceptTeamInvite('event', acceptCommand, captain),
    ).rejects.toThrow('自己');
    await expect(
      first.service.acceptTeamInvite(
        'event',
        { ...acceptCommand, playerBPhone: manual.playerAPhone },
        partner,
      ),
    ).rejects.toThrow('相同');
    first.record.expiresAt = new Date(0);
    await expect(
      first.service.acceptTeamInvite('event', acceptCommand, partner),
    ).rejects.toThrow('过期');
    const second = fixture();
    await expect(
      second.service.previewTeamInvite(
        'other-event',
        acceptCommand.partnerInviteCode,
      ),
    ).rejects.toThrow('无效');
    second.record.revokedAt = new Date();
    await expect(
      second.service.previewTeamInvite(
        'event',
        acceptCommand.partnerInviteCode,
      ),
    ).rejects.toThrow('撤回');
  });
  it('uses accepted names/contacts from the server and binds both accounts on captain submission', async () => {
    const { service, tx } = fixture();
    await service.acceptTeamInvite('event', acceptCommand, partner);
    await service.register(
      'event',
      {
        ...manual,
        registrationMode: 'INVITE',
        partnerInviteCode: acceptCommand.partnerInviteCode,
        playerBName: 'tampered',
      },
      captain,
    );
    expect(
      tx.order.create.mock.calls[0][0].data.eventTeam.create,
    ).toMatchObject({
      playerAName: manual.playerAName,
      playerBName: manual.playerBName,
      playerAPhone: manual.playerAPhone,
      playerBPhone: manual.playerBPhone,
      playerAUserId: captain.sub,
      playerBUserId: partner.sub,
    });
    expect(tx.eventPartnerInvite.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consumedTeamId: 'team' }),
      }),
    );
  });
  it('blocks unaccepted invites, stolen invites and modified category/team names', async () => {
    const { service } = fixture();
    const command = {
      name: manual.name,
      registrationMode: 'INVITE' as const,
      partnerInviteCode: acceptCommand.partnerInviteCode,
      category: manual.category,
      sourceChannel: manual.sourceChannel,
    };
    await expect(service.register('event', command, captain)).rejects.toThrow(
      '尚未确认',
    );
    await service.acceptTeamInvite('event', acceptCommand, partner);
    await expect(service.register('event', command, stranger)).rejects.toThrow(
      '队长',
    );
    await expect(
      service.register('event', { ...command, name: '被修改队名' }, captain),
    ).rejects.toThrow('不一致');
  });
  it('maps serialization races to retryable conflicts, never a generic server failure', async () => {
    const { service, prisma } = fixture();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(
      service.createTeamInvite('event', invitation, captain),
    ).rejects.toThrow('并发变化');
    await expect(
      service.acceptTeamInvite('event', acceptCommand, partner),
    ).rejects.toThrow('刷新后重试');
  });
  it('fails closed if the conditional invite claim loses a race', async () => {
    const { service, tx } = fixture();
    tx.eventPartnerInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.acceptTeamInvite('event', acceptCommand, partner),
    ).rejects.toThrow('状态已变化');
  });
});
