import { hasAnyRole } from '../training-access.js';
import {
  Inject,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, UserStatus } from '../../generated/prisma/client.js';
import type { CreateStudentDto, UpdateStudentDto } from '../training.dto.js';

const STUDENT_STAFF_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

@Injectable()
export class TrainingStudentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listStudents(actor: AuthUser, all = false, guardianId?: string) {
    if (all && !hasAnyRole(actor, STUDENT_STAFF_ROLES)) {
      throw new ForbiddenException('仅前台或管理员可查看全部学员档案');
    }
    const normalizedGuardianId = guardianId?.trim();
    if (guardianId !== undefined && !normalizedGuardianId) {
      throw new BadRequestException('监护人账号不能为空');
    }
    return this.prisma.student.findMany({
      where: all
        ? normalizedGuardianId
          ? { guardianId: normalizedGuardianId }
          : undefined
        : { guardianId: actor.sub },
      include: { guardian: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStudent(dto: CreateStudentDto, actor: AuthUser) {
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('学员姓名不能为空');
    const guardianId = dto.guardianId?.trim() || actor.sub;
    const actingForAnotherGuardian = guardianId !== actor.sub;
    if (actingForAnotherGuardian && !hasAnyRole(actor, STUDENT_STAFF_ROLES)) {
      throw new ForbiddenException('只能为自己的监护账号创建学员');
    }
    const authorizationNote = dto.authorizationNote?.trim();
    if (
      actingForAnotherGuardian &&
      dto.guardianConsentStatus &&
      !authorizationNote
    ) {
      throw new BadRequestException('代监护人登记授权时必须填写授权凭证说明');
    }
    const birthMonth = this.normalizeBirthMonth(dto.birthMonth);

    return this.prisma.$transaction(async (tx) => {
      const guardian = await tx.user.findFirst({
        where: { id: guardianId, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true },
      });
      if (!guardian) throw new NotFoundException('监护人账号不存在或不可用');
      const student = await tx.student.create({
        data: {
          guardianId,
          displayName,
          birthMonth,
          guardianConsentStatus: dto.guardianConsentStatus,
          authorizationNote:
            authorizationNote ||
            (dto.guardianConsentStatus
              ? '监护人通过小程序确认授权'
              : undefined),
        },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_STUDENT_CREATED',
          objectType: 'Student',
          objectId: student.id,
          reason: authorizationNote || '创建培训学员档案',
          oldValue: { exists: false } as never,
          newValue: {
            guardianId,
            displayName,
            birthMonth: birthMonth?.toISOString(),
            guardianConsentStatus: dto.guardianConsentStatus,
          } as never,
        },
      });
      return student;
    });
  }

  async updateStudent(
    studentId: string,
    dto: UpdateStudentDto,
    actor: AuthUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.student.findUnique({
        where: { id: studentId },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      if (!current) throw new NotFoundException('学员档案不存在');
      const actingForAnotherGuardian = current.guardianId !== actor.sub;
      if (actingForAnotherGuardian && !hasAnyRole(actor, STUDENT_STAFF_ROLES)) {
        throw new ForbiddenException('只能修改自己监护的学员档案');
      }
      const displayName =
        dto.displayName === undefined ? undefined : dto.displayName.trim();
      if (displayName !== undefined && !displayName)
        throw new BadRequestException('学员姓名不能为空');
      const authorizationNote = dto.authorizationNote?.trim();
      if (
        actingForAnotherGuardian &&
        dto.guardianConsentStatus === true &&
        !current.guardianConsentStatus &&
        !authorizationNote
      ) {
        throw new BadRequestException('代监护人确认授权时必须填写授权凭证说明');
      }
      const birthMonth =
        dto.birthMonth === undefined
          ? undefined
          : this.normalizeBirthMonth(dto.birthMonth);
      const nextAuthorizationNote =
        authorizationNote ||
        (!actingForAnotherGuardian &&
        dto.guardianConsentStatus === true &&
        !current.guardianConsentStatus
          ? '监护人通过小程序确认授权'
          : undefined);
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          displayName,
          birthMonth,
          guardianConsentStatus: dto.guardianConsentStatus,
          authorizationNote: nextAuthorizationNote,
        },
        include: { guardian: { select: { id: true, displayName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_STUDENT_UPDATED',
          objectType: 'Student',
          objectId: studentId,
          reason: authorizationNote || '更新培训学员档案',
          oldValue: {
            displayName: current.displayName,
            birthMonth: current.birthMonth?.toISOString(),
            guardianConsentStatus: current.guardianConsentStatus,
            authorizationNote: current.authorizationNote,
          } as never,
          newValue: {
            displayName: updated.displayName,
            birthMonth: updated.birthMonth?.toISOString(),
            guardianConsentStatus: updated.guardianConsentStatus,
            authorizationNote: updated.authorizationNote,
          } as never,
        },
      });
      return updated;
    });
  }

  private normalizeBirthMonth(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException('出生月份格式无效');
    const normalized = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1),
    );
    const currentMonth = new Date();
    const currentMonthStart = new Date(
      Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1),
    );
    if (normalized > currentMonthStart)
      throw new BadRequestException('出生月份不能晚于当前月份');
    if (normalized.getUTCFullYear() < 1900)
      throw new BadRequestException('出生月份超出合理范围');
    return normalized;
  }
}
