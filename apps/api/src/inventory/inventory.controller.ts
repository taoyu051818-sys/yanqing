import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CancelDocumentDto,
  CountStocktakeLineDto,
  CreateInventoryItemDto,
  CreateInventoryLocationDto,
  CreateInventoryOperationDto,
  CreatePurchaseOrderDto,
  CreateStocktakeDto,
  CreateSupplierDto,
  InventoryTransactionDto,
  PostInventoryOperationDto,
  PostStocktakeDto,
  ReceivePurchaseOrderDto,
} from './inventory.dto.js';
import { InventoryOperationsService } from './inventory-operations.service.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('商品库存')
@ApiBearerAuth()
@Controller('inventory')
@Roles(
  AppRole.FRONT_DESK,
  AppRole.COACH,
  AppRole.EVENT_MANAGER,
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly operations: InventoryOperationsService,
  ) {}

  @Get()
  list() {
    return this.inventory.list();
  }

  @Get('low-stock')
  lowStock() {
    return this.inventory.lowStock();
  }

  @Get('suppliers')
  suppliers() {
    return this.operations.suppliers();
  }

  @Post('suppliers')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createSupplier(dto, actor);
  }

  @Get('locations')
  locations() {
    return this.operations.locations();
  }

  @Post('locations')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createLocation(
    @Body() dto: CreateInventoryLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createLocation(dto, actor);
  }

  @Get('purchase-orders')
  purchaseOrders() {
    return this.operations.purchaseOrders();
  }

  @Post('purchase-orders')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPurchaseOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createPurchaseOrder(dto, actor);
  }

  @Post('purchase-orders/:id/submit')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitPurchaseOrder(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.submitPurchaseOrder(id, actor);
  }

  @Post('purchase-orders/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approvePurchaseOrder(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.approvePurchaseOrder(id, actor);
  }

  @Post('purchase-orders/:id/receive')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  receivePurchaseOrder(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.receivePurchaseOrder(id, dto, actor);
  }

  @Post('purchase-orders/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.cancelPurchaseOrder(id, dto, actor);
  }

  @Get('stocktakes')
  stocktakes() {
    return this.operations.stocktakes();
  }

  @Post('stocktakes')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createStocktake(
    @Body() dto: CreateStocktakeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createStocktake(dto, actor);
  }

  @Post('stocktakes/:id/start')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  startStocktake(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.startStocktake(id, actor);
  }

  @Post('stocktakes/:id/lines/:lineId/count')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  countStocktakeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: CountStocktakeLineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.countStocktakeLine(id, lineId, dto, actor);
  }

  @Post('stocktakes/:id/submit')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitStocktake(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.submitStocktake(id, actor);
  }

  @Post('stocktakes/:id/post')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  postStocktake(
    @Param('id') id: string,
    @Body() dto: PostStocktakeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.postStocktake(id, dto, actor);
  }

  @Get('operations')
  operationDocuments() {
    return this.operations.operations();
  }

  @Post('operations')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createOperation(
    @Body() dto: CreateInventoryOperationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createOperation(dto, actor);
  }

  @Post('operations/:id/submit')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.submitOperation(id, actor);
  }

  @Post('operations/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.approveOperation(id, actor);
  }

  @Post('operations/:id/post')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  postOperation(
    @Param('id') id: string,
    @Body() dto: PostInventoryOperationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.postOperation(id, dto, actor);
  }

  @Post('operations/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelOperation(
    @Param('id') id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.cancelOperation(id, dto, actor);
  }

  @Post()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateInventoryItemDto) {
    return this.inventory.create(dto);
  }

  @Post(':id/transactions')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.COACH,
    AppRole.EVENT_MANAGER,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  transact(
    @Param('id') id: string,
    @Body() dto: InventoryTransactionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventory.transact(id, dto, actor);
  }
}
