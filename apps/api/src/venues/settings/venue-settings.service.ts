import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, ParameterType, Prisma, SlotPeriod } from '../../generated/prisma/client.js';
import type { CreateVenueCourtDto, SaveVenueSettingsDto } from './venue-settings.dto.js';

const SETTINGS_KEY = 'venue.public-settings';
const courtSelect = { id: true, code: true, name: true, zone: true, usage: true, enabled: true, sortOrder: true, updatedAt: true } as const;
type SettingsDb = Pick<Prisma.TransactionClient, 'systemParameter' | 'timeSlot' | 'court'>;
function assertAdmin(actor: AuthUser) {
  if (!actor.roles.some(role => role === AppRole.ADMIN || role === AppRole.SUPER_ADMIN)) throw new ForbiddenException('仅管理员可修改球馆设置');
}

@Injectable()
export class VenueSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async read(db: SettingsDb) {
    const [saved, slots, courtCount] = await Promise.all([
      db.systemParameter.findFirst({ where: { key: SETTINGS_KEY }, orderBy: { effectiveFrom: 'desc' } }),
      db.timeSlot.findMany({ where: { enabled: true }, select: { startMinutes: true, endMinutes: true } }),
      db.court.count({ where: { enabled: true, deletedAt: null } }),
    ]);
    const value = (saved?.value || {}) as Record<string, unknown>;
    return {
      revision: saved?.id || '',
      name: typeof value.name === 'string' ? value.name : '延庆金羽羽毛球馆',
      address: typeof value.address === 'string' ? value.address : '',
      contactPhone: typeof value.contactPhone === 'string' ? value.contactPhone : '',
      latitude: typeof value.latitude === 'number' ? value.latitude : null,
      longitude: typeof value.longitude === 'number' ? value.longitude : null,
      opensAtHour: typeof value.opensAtHour === 'number' ? value.opensAtHour : slots.length ? Math.min(...slots.map(s => s.startMinutes)) / 60 : null,
      closesAtHour: typeof value.closesAtHour === 'number' ? value.closesAtHour : slots.length ? Math.max(...slots.map(s => s.endMinutes)) / 60 : null,
      courtCount,
    };
  }
  async publicProfile() {
    const { revision: _revision, ...profile } = await this.read(this.prisma);
    return profile;
  }
  async settings(actor: AuthUser) {
    assertAdmin(actor);
    const [profile, courts] = await Promise.all([this.read(this.prisma), this.prisma.court.findMany({ where: { deletedAt: null }, select: courtSelect, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] })]);
    return { ...profile, courts };
  }
  async save(dto: SaveVenueSettingsDto, actor: AuthUser) {
    assertAdmin(actor);
    if (dto.opensAtHour >= dto.closesAtHour) throw new BadRequestException('结束时间须晚于开始时间，最晚可选24:00');
    if ((dto.latitude == null) !== (dto.longitude == null)) throw new BadRequestException('经纬度需一起填写或一起清空');
    const value = { name: dto.name, address: dto.address, contactPhone: dto.contactPhone, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, opensAtHour: dto.opensAtHour, closesAtHour: dto.closesAtHour };
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('venue.public-settings'))`;
      const before = await this.read(tx);
      if ((dto.revision || '') !== before.revision) throw new ConflictException('球馆设置已被修改，请重新加载后再保存');
      // Update availability atomically with the public hours. Preserve slot IDs,
      // historical prices and bookings; extended hours remain unpriced until configured.
      const selectedSlots: string[] = [];
      const now = new Date();
      for (let hour = dto.opensAtHour; hour < dto.closesAtHour; hour++) {
        const existing = await tx.timeSlot.findFirst({ where: { startMinutes: hour * 60, endMinutes: (hour + 1) * 60 }, orderBy: { createdAt: 'asc' } });
        if (existing) {
          selectedSlots.push(existing.id);
          if (!existing.enabled) await tx.timeSlot.update({ where: { id: existing.id }, data: { enabled: true, updatedAt: now } });
        } else { const created = await tx.timeSlot.create({ data: {
          createdAt: now, updatedAt: now,
          code: `H${String(hour).padStart(2, '0')}`, label: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
          startMinutes: hour * 60, endMinutes: (hour + 1) * 60, sortOrder: hour * 60,
          period: hour < 9 ? SlotPeriod.EARLY : hour < 17 ? SlotPeriod.DAYTIME : SlotPeriod.PRIME,
        } }); selectedSlots.push(created.id); }
      }
      await tx.timeSlot.updateMany({ where: { enabled: true, id: { notIn: selectedSlots } }, data: { enabled: false, updatedAt: now } });
      await tx.systemParameter.updateMany({ where: { key: SETTINGS_KEY, effectiveTo: null }, data: { effectiveTo: now } });
      const saved = await tx.systemParameter.create({ data: { key: SETTINGS_KEY, value, type: ParameterType.JSON, description: '球馆公开信息和每日营业时间，请通过球馆设置维护', locked: true, effectiveFrom: now, createdById: actor.sub } });
      await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: 'VENUE_SETTINGS_UPDATED', objectType: 'SystemParameter', objectId: saved.id, oldValue: before as Prisma.InputJsonValue, newValue: value } });
      return { ...value, revision: saved.id, courtCount: before.courtCount };
    });
  }
  async deleteCourt(id: string, actor: AuthUser) {
    assertAdmin(actor);
    return this.prisma.$transaction(async tx => {
      // Serialize edits/deletion against booking's shared court lock.
      await tx.$queryRaw`SELECT "id" FROM "Court" WHERE "id" = ${id} FOR UPDATE`;
      const before = await tx.court.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('场地不存在');
      if (before.deletedAt) return { id, deleted: true };
      const deletedAt = new Date(Math.max(Date.now(), +before.updatedAt + 1));
      const after = await tx.court.update({ where: { id }, data: { deletedAt, updatedAt: deletedAt, enabled: false } });
      await tx.auditLog.create({ data: {
        actorId: actor.sub, actorRole: actor.roles[0], action: 'COURT_DELETED', objectType: 'Court', objectId: id,
        oldValue: { name: before.name, code: before.code, enabled: before.enabled },
        newValue: { name: after.name, code: after.code, enabled: false, deletedAt: after.deletedAt!.toISOString() },
      } });
      return { id, deleted: true };
    });
  }
  async createCourt(dto: CreateVenueCourtDto, actor: AuthUser) {
    assertAdmin(actor);
    try {
      return await this.prisma.$transaction(async tx => {
        const court = await tx.court.create({ data: dto, select: courtSelect });
        await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: 'COURT_CREATED', objectType: 'Court', objectId: court.id, newValue: { ...court, updatedAt: court.updatedAt.toISOString() } } });
        return court;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('场地编号已存在，请刷新列表或使用其他编号');
      throw error;
    }
  }
}
