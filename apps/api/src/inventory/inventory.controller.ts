import { Inject } from '@nestjs/common';
import { InventoryCatalogService } from './catalog/inventory-catalog.service.js';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service.js';
import { InventorySuppliersService } from './suppliers/inventory-operations-suppliers.service.js';
import { InventoryLocationsService } from './locations/inventory-operations-locations.service.js';
import { InventoryPurchasingService } from './purchasing/inventory-operations-purchasing.service.js';
import { InventoryStocktakingService } from './stocktaking/inventory-operations-stocktaking.service.js';
import { InventoryMovementsService } from './movements/inventory-operations-movements.service.js';
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

@ApiTags('商品库存')
@ApiBearerAuth()
@Controller('inventory')
@Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class InventoryController {
  constructor(
    @Inject(InventoryCatalogService)
    private readonly inventoryInventoryCatalog: InventoryCatalogService,
    @Inject(InventoryTransactionsService)
    private readonly inventoryInventoryTransactions: InventoryTransactionsService,
    @Inject(InventorySuppliersService)
    private readonly operationsInventorySuppliers: InventorySuppliersService,
    @Inject(InventoryLocationsService)
    private readonly operationsInventoryLocations: InventoryLocationsService,
    @Inject(InventoryPurchasingService)
    private readonly operationsInventoryPurchasing: InventoryPurchasingService,
    @Inject(InventoryStocktakingService)
    private readonly operationsInventoryStocktaking: InventoryStocktakingService,
    @Inject(InventoryMovementsService)
    private readonly operationsInventoryMovements: InventoryMovementsService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.inventoryInventoryCatalog.list(actor);
  }

  @Get('low-stock')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  lowStock(@CurrentUser() actor: AuthUser) {
    return this.inventoryInventoryCatalog.lowStock(actor);
  }

  @Get('award-options')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.EVENT_MANAGER,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  awardOptions(@CurrentUser() actor: AuthUser) {
    return this.inventoryInventoryCatalog.awardOptions(actor);
  }

  @Get('items/:id')
  itemDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.inventoryInventoryCatalog.detail(id, actor);
  }

  @Get('suppliers')
  suppliers(@CurrentUser() actor: AuthUser) {
    return this.operationsInventorySuppliers.suppliers(actor);
  }

  @Get('suppliers/:id')
  supplierDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventorySuppliers.supplierDetail(id, actor);
  }

  @Post('suppliers')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventorySuppliers.createSupplier(dto, actor);
  }

  @Post('suppliers/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventorySuppliers.updateSupplier(id, dto, actor);
  }

  @Post('suppliers/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setSupplierStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventorySuppliers.setSupplierStatus(id, dto, actor);
  }

  @Get('locations')
  locations(@CurrentUser() actor: AuthUser) {
    return this.operationsInventoryLocations.locations(actor);
  }

  @Get('locations/:id')
  locationDetail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryLocations.locationDetail(id, actor);
  }

  @Post('locations')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createLocation(
    @Body() dto: CreateInventoryLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryLocations.createLocation(dto, actor);
  }

  @Post('locations/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateLocation(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryLocationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryLocations.updateLocation(id, dto, actor);
  }

  @Post('locations/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setLocationStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryLocations.setLocationStatus(id, dto, actor);
  }

  @Get('purchase-orders')
  purchaseOrders(@CurrentUser() actor: AuthUser) {
    return this.operationsInventoryPurchasing.purchaseOrders(actor);
  }

  @Post('purchase-orders')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPurchaseOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryPurchasing.createPurchaseOrder(dto, actor);
  }

  @Post('purchase-orders/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitPurchaseOrder(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryPurchasing.submitPurchaseOrder(id, actor);
  }

  @Post('purchase-orders/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approvePurchaseOrder(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryPurchasing.approvePurchaseOrder(id, actor);
  }

  @Post('purchase-orders/:id/receive')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  receivePurchaseOrder(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryPurchasing.receivePurchaseOrder(
      id,
      dto,
      actor,
    );
  }

  @Post('purchase-orders/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryPurchasing.cancelPurchaseOrder(
      id,
      dto,
      actor,
    );
  }

  @Get('stocktakes')
  stocktakes(@CurrentUser() actor: AuthUser) {
    return this.operationsInventoryStocktaking.stocktakes(actor);
  }

  @Post('stocktakes')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createStocktake(
    @Body() dto: CreateStocktakeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryStocktaking.createStocktake(dto, actor);
  }

  @Post('stocktakes/:id/start')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  startStocktake(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryStocktaking.startStocktake(id, actor);
  }

  @Post('stocktakes/:id/lines/:lineId/count')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  countStocktakeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: CountStocktakeLineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryStocktaking.countStocktakeLine(
      id,
      lineId,
      dto,
      actor,
    );
  }

  @Post('stocktakes/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitStocktake(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryStocktaking.submitStocktake(id, actor);
  }

  @Post('stocktakes/:id/post')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  postStocktake(
    @Param('id') id: string,
    @Body() dto: PostStocktakeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryStocktaking.postStocktake(id, dto, actor);
  }

  @Get('operations')
  operationDocuments(@CurrentUser() actor: AuthUser) {
    return this.operationsInventoryMovements.operations(actor);
  }

  @Post('operations')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createOperation(
    @Body() dto: CreateInventoryOperationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryMovements.createOperation(dto, actor);
  }

  @Post('operations/:id/submit')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  submitOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryMovements.submitOperation(id, actor);
  }

  @Post('operations/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveOperation(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.operationsInventoryMovements.approveOperation(id, actor);
  }

  @Post('operations/:id/post')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  postOperation(
    @Param('id') id: string,
    @Body() dto: PostInventoryOperationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryMovements.postOperation(id, dto, actor);
  }

  @Post('operations/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelOperation(
    @Param('id') id: string,
    @Body() dto: CancelDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.operationsInventoryMovements.cancelOperation(id, dto, actor);
  }

  @Post()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateInventoryItemDto, @CurrentUser() actor: AuthUser) {
    return this.inventoryInventoryCatalog.create(dto, actor);
  }

  @Post('items/:id/update')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventoryInventoryCatalog.update(id, dto, actor);
  }

  @Post('items/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setItemStatus(
    @Param('id') id: string,
    @Body() dto: SetMasterDataStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventoryInventoryCatalog.setStatus(id, dto, actor);
  }

  @Post(':id/transactions')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  transact(
    @Param('id') id: string,
    @Body() dto: InventoryTransactionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.inventoryInventoryTransactions.transact(id, dto, actor);
  }
}
