import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AttendanceStatus } from '../../generated/prisma/enums.js';
import { TrainingAttendanceService } from '../attendance/training-attendance.service.js';
import { TrainingConsumptionService } from '../consumption/training-consumption.service.js';
import type { TrainingBatchDto } from './training-batch.dto.js';

export type TrainingBatchAction = 'attendance' | 'proposal' | 'confirmation';

@Injectable()
export class TrainingBatchService {
  constructor(
    @Inject(TrainingAttendanceService)
    private readonly attendance: TrainingAttendanceService,
    @Inject(TrainingConsumptionService)
    private readonly consumption: TrainingConsumptionService,
  ) {}

  // Reuse each domain command's authorization and transaction. Partial success
  // is explicit, so a failed item cannot hide the outcome of its neighbours.
  async execute(
    sessionId: string,
    action: TrainingBatchAction,
    dto: TrainingBatchDto,
    actor: AuthUser,
  ) {
    if (
      !dto.items?.length ||
      dto.items.length > 50 ||
      new Set(dto.items.map((item) => item.enrollmentId)).size !==
        dto.items.length
    )
      throw new BadRequestException('请选择 1–50 位不同学员');
    const results: {
      enrollmentId: string;
      status: 'SUCCEEDED' | 'FAILED';
      message?: string;
    }[] = [];
    for (const item of dto.items) {
      try {
        if (action === 'attendance') {
          await this.attendance.markAttendance(
            sessionId,
            {
              enrollmentId: item.enrollmentId,
              status: AttendanceStatus.ATTENDED,
              reason: '逐人核对后批量登记到场',
            },
            actor,
            { allowHistoricalOverride: false },
          );
        } else if (action === 'proposal') {
          // consume() also supports admin posting; a proposal must never do so.
          await this.consumption.proposeConsume(
            sessionId,
            { enrollmentId: item.enrollmentId },
            actor,
          );
        } else {
          await this.consumption.confirmConsume(
            sessionId,
            {
              enrollmentId: item.enrollmentId,
              idempotencyKey: item.idempotencyKey,
              reason: '核对所选学员后批量确认消课',
            },
            actor,
            { allowHistoricalOverride: false },
          );
        }
        results.push({ enrollmentId: item.enrollmentId, status: 'SUCCEEDED' });
      } catch (error) {
        results.push({
          enrollmentId: item.enrollmentId,
          status: 'FAILED',
          message:
            error instanceof HttpException && error.getStatus() < 500
              ? error.message
              : '处理未完成，请刷新核对后重试',
        });
      }
    }
    return { results };
  }
}
