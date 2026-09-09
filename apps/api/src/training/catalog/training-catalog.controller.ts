import {
  Inject,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CreateTrainingClassDto,
  CreateTrainingProductDto,
  UpdateTrainingProductDto,
} from '../training.dto.js';
import { TrainingCatalogService } from './training-catalog.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingCatalogController {
  constructor(
    @Inject(TrainingCatalogService)
    private readonly catalog: TrainingCatalogService,
  ) {}

  @Get('products')
  products(@CurrentUser() actor: AuthUser) {
    return this.catalog.listProducts(actor);
  }

  @Post('products')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProduct(
    @Body() dto: CreateTrainingProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalog.createProduct(dto, actor);
  }

  @Patch('products/:id')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateTrainingProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalog.updateProduct(id, dto, actor);
  }

  @Post('classes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createClass(
    @Body() dto: CreateTrainingClassDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalog.createClass(dto, actor);
  }
}
