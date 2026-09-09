import { normaliseText } from '../shared/event-command-support.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '../../generated/prisma/client.js';

export function assertSignupContact(name: string, phone: string) {
  if (!normaliseText(name) || !/^1[3-9]\d{9}$/.test(phone))
    throw new BadRequestException('两位选手均须填写姓名和11位联系电话');
}

export async function assertPhoneAvailable(
  tx: Prisma.TransactionClient,
  eventId: string,
  phones: string[],
  userIds: string[] = [],
) {
  const contacts = phones.filter(Boolean);
  if (!contacts.length) return;
  if (new Set(contacts).size !== contacts.length)
    throw new ConflictException('两位选手不能使用相同的联系电话');
  // Compare with both guest contact snapshots and existing account-linked
  // registrations. A supplied phone never grants access to that account.
  const users = await tx.user.findMany({
    where: { phone: { in: contacts } },
    select: { id: true },
  });
  const ids = [...new Set([...userIds, ...users.map((user) => user.id)])];
  const existing = await tx.eventTeam.findFirst({
    where: {
      eventId,
      status: {
        notIn: [RegistrationStatus.CANCELLED, RegistrationStatus.REFUNDED],
      },
      OR: [
        { playerAPhone: { in: contacts } },
        { playerBPhone: { in: contacts } },
        ...ids.flatMap((id) => [{ playerAUserId: id }, { playerBUserId: id }]),
      ],
    },
    select: { id: true },
  });
  if (existing)
    throw new ConflictException(
      '其中一位选手已报名本赛事或正在候补，请勿重复提交',
    );
}
