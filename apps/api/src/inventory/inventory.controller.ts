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
  SetMasterDataStatusDto,
  UpdateInventoryItemDto,
  UpdateInventoryLocationDto,
  UpdateSupplierDto,
} from './inventory.dto.js';
import { InventoryOperationsService } from './inventory-operations.service.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('商品库存')
@ApiBearerAuth()
@Controller('inventory')
@Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly operations: InventoryOperationsService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.inventory.list(actor);
  }

  @Get('low-stock')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  lowStock(@CurrentUser() actor: AuthUser) {
    return this.inventory.lowStock(actor);
  }

  @Get('award-options')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.EVENT_MANAGER,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  awardOptions(@CurrentUser() actor: AuthUser) {
    return this.inventory.awardOptions(actor);
  }

  @Get('items/:id')
  itemDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.inventory.detail(id, actor);
  }

  @Get('suppliers')
  suppliers(@CurrentUser() actor: AuthUser) {
    return this.operations.suppliers(actor);
  }

  @Get('suppliers/:id')
  supplierDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.supplierDetail(id, actor);
  }

  @Post('suppliers')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createSupplier(dto, actor);
  }

  @Post('suppliers/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.updateSupplier(id, dto, actor);
  }

  @Post('suppliers/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setSupplierStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.setSupplierStatus(id, dto, actor);
  }

  @Get('locations')
  locations(@CurrentUser() actor: AuthUser) {
    return this.operations.locations(actor);
  }

  @Get('locations/:id')
  locationDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.locationDetail(id, actor);
  }

  @Post('locations')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createLocation(
    @Body() dto: CreateInventoryLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createLocation(dto, actor);
  }

  @Post('locations/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateLocation(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.updateLocation(id, dto, actor);
  }

  @Post('locations/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setLocationStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.setLocationStatus(id, dto, actor);
  }

  @Get('purchase-orders')
  purchaseOrders(@CurrentUser() actor: AuthUser) {
    return this.operations.purchaseOrders(actor);
  }

  @Post('purchase-orders')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPurchaseOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createPurchaseOrder(dto, actor);
  }

  @Post('purchase-orders/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
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
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
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
  stocktakes(@CurrentUser() actor: AuthUser) {
    return this.operations.stocktakes(actor);
  }

  @Post('stocktakes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createStocktake(
    @Body() dto: CreateStocktakeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createStocktake(dto, actor);
  }

  @Post('stocktakes/:id/start')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  startStocktake(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.startStocktake(id, actor);
  }

  @Post('stocktakes/:id/lines/:lineId/count')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  countStocktakeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: CountStocktakeLineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.countStocktakeLine(id, lineId, dto, actor);
  }

  @Post('stocktakes/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
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
  operationDocuments(@CurrentUser() actor: AuthUser) {
    return this.operations.operations(actor);
  }

  @Post('operations')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createOperation(
    @Body() dto: CreateInventoryOperationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operations.createOperation(dto, actor);
  }

  @Post('operations/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.submitOperation(id, actor);
  }

  @Post('operations/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operations.approveOperation(id, actor);
  }

  @Post('operations/:id/post')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
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
  create(@Body() dto: CreateInventoryItemDto, @CurrentUser() actor: AuthUser) {
    return this.inventory.create(dto, actor);
  }

  @Post('items/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventory.update(id, dto, actor);
  }

  @Post('items/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setItemStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventory.setStatus(id, dto, actor);
  }

  @Post(':id/transactions')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  transact(
    @Param('id') id: string,
    @Body() dto: InventoryTransactionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventory.transact(id, dto, actor);
  }
}
