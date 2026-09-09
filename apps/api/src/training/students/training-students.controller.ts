import {
  Inject,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { CreateStudentDto, UpdateStudentDto } from '../training.dto.js';
import { TrainingStudentsService } from './training-students.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingStudentsController {
  constructor(
    @Inject(TrainingStudentsService)
    private readonly studentsService: TrainingStudentsService,
  ) {}

  @Get('students')
  students(@CurrentUser() actor: AuthUser) {
    return this.studentsService.listStudents(actor);
  }

  @Get('admin/students')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  allStudents(
    @CurrentUser() actor: AuthUser,
    @Query('guardianId') guardianId?: string,
  ) {
    return this.studentsService.listStudents(actor, true, guardianId);
  }

  @Post('students')
  createStudent(@Body() dto: CreateStudentDto, @CurrentUser() actor: AuthUser) {
    return this.studentsService.createStudent(dto, actor);
  }

  @Patch('students/:studentId')
  updateStudent(
    @Param('studentId') studentId: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.studentsService.updateStudent(studentId, dto, actor);
  }
}
