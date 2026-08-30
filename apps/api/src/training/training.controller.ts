import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  AttendanceActionDto,
  ConfirmTrainingConsumeDto,
  CreateTrainingConsumeCorrectionDto,
  ConsumeTrainingDto,
  CreateStudentDto,
  CreateTrainingClassDto,
  CreateTrainingProductDto,
  CreateTrainingSessionDto,
  CreateTrainingSettlementDto,
  DecideTrainingConsumeCorrectionDto,
  ListTrainingSettlementsDto,
  MakeupAttendanceDto,
  PurchaseTrainingDto,
  TrainingSessionActionDto,
  TrainingSettlementActionDto,
  UpdateTrainingProductDto,
  UpdateStudentDto,
} from './training.dto.js';
import { TrainingService } from './training.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('products')
  products() {
    return this.training.listProducts();
  }

  @Post('products')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProduct(
    @Body() dto: CreateTrainingProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.createProduct(dto, actor);
  }

  @Patch('products/:id')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateTrainingProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.updateProduct(id, dto, actor);
  }

  @Post('classes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createClass(
    @Body() dto: CreateTrainingClassDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.createClass(dto, actor);
  }

  @Get('students')
  students(@CurrentUser() actor: AuthUser) {
    return this.training.listStudents(actor);
  }

  @Get('admin/students')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  allStudents(
    @CurrentUser() actor: AuthUser,
    @Query('guardianId') guardianId?: string,
  ) {
    return this.training.listStudents(actor, true, guardianId);
  }

  @Post('students')
  createStudent(@Body() dto: CreateStudentDto, @CurrentUser() actor: AuthUser) {
    return this.training.createStudent(dto, actor);
  }

  @Patch('students/:studentId')
  updateStudent(
    @Param('studentId') studentId: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.updateStudent(studentId, dto, actor);
  }

  @Post('purchase')
  purchase(@Body() dto: PurchaseTrainingDto, @CurrentUser() actor: AuthUser) {
    return this.training.purchase(dto, actor);
  }

  @Get('enrollments')
  myEnrollments(@CurrentUser() actor: AuthUser) {
    return this.training.listEnrollments(actor);
  }

  @Get('admin/enrollments')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  allEnrollments(@CurrentUser() actor: AuthUser) {
    return this.training.listEnrollments(actor, true);
  }

  @Get('sessions')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  sessions(@CurrentUser() actor: AuthUser) {
    return this.training.listSessions(actor);
  }

  @Post('sessions')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createSession(
    @Body() dto: CreateTrainingSessionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.createSession(dto, actor);
  }

  @Post('sessions/:sessionId/consume')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  consume(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConsumeTrainingDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.consume(sessionId, dto, actor);
  }

  @Post('sessions/:sessionId/consume/confirm')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmConsume(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConfirmTrainingConsumeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.confirmConsume(sessionId, dto, actor);
  }

  @Get('consume-corrections')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  consumeCorrections(@CurrentUser() actor: AuthUser) {
    return this.training.listConsumeCorrections(actor);
  }

  @Post('consume-corrections')
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  requestConsumeCorrection(
    @Body() dto: CreateTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.requestConsumeCorrection(dto, actor);
  }

  @Post('consume-corrections/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveConsumeCorrection(
    @Param('id') id: string,
    @Body() dto: DecideTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.approveConsumeCorrection(id, dto, actor);
  }

  @Post('consume-corrections/:id/reject')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  rejectConsumeCorrection(
    @Param('id') id: string,
    @Body() dto: DecideTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.rejectConsumeCorrection(id, dto, actor);
  }

  @Post('sessions/:sessionId/attendance')
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  markAttendance(
    @Param('sessionId') sessionId: string,
    @Body() dto: AttendanceActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.markAttendance(sessionId, dto, actor);
  }

  @Post('sessions/:sessionId/attendance/makeup')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  scheduleMakeup(
    @Param('sessionId') sessionId: string,
    @Body() dto: MakeupAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.scheduleMakeup(sessionId, dto, actor);
  }

  @Post('sessions/:sessionId/complete')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  complete(
    @Param('sessionId') sessionId: string,
    @CurrentUser() actor: AuthUser,
    @Body() dto: TrainingSessionActionDto = {},
  ) {
    return this.training.completeSession(sessionId, actor, dto);
  }

  @Get('financial-summary')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  summary(
    @Query('periodStart') start: string,
    @Query('periodEnd') end: string,
  ) {
    return this.training.financialSummary(new Date(start), new Date(end));
  }

  @Post('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlement(
    @Body() dto: CreateTrainingSettlementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.createSettlement(dto, actor);
  }

  @Get('settlements')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settlements(
    @Query() query: ListTrainingSettlementsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.listSettlements(query, actor);
  }

  @Post('settlements/:id/submit')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.submitSettlement(id, dto, actor);
  }

  @Post('settlements/:id/confirm')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.confirmSettlement(id, dto, actor);
  }

  @Post('settlements/:id/settle')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settleSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.settleSettlement(id, dto, actor);
  }

  @Post('settlements/:id/return')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  returnSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.returnSettlement(id, dto, actor);
  }

  @Post('settlements/:id/void')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  voidSettlement(
    @Param('id') id: string,
    @Body() dto: TrainingSettlementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.training.voidSettlement(id, dto, actor);
  }
}
