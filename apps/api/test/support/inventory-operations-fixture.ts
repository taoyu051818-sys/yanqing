import type { PrismaService } from '../../src/database/prisma.service.js';
import { InventorySuppliersService } from '../../src/inventory/suppliers/inventory-operations-suppliers.service.js';
import { InventoryLocationsService } from '../../src/inventory/locations/inventory-operations-locations.service.js';
import { InventoryPurchasingService } from '../../src/inventory/purchasing/inventory-operations-purchasing.service.js';
import { InventoryStocktakingService } from '../../src/inventory/stocktaking/inventory-operations-stocktaking.service.js';
import { InventoryMovementsService } from '../../src/inventory/movements/inventory-operations-movements.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class InventoryOperationsService {
  private readonly domain0: InventorySuppliersService;
  private readonly domain1: InventoryLocationsService;
  private readonly domain2: InventoryPurchasingService;
  private readonly domain3: InventoryStocktakingService;
  private readonly domain4: InventoryMovementsService;
  constructor(prisma: PrismaService) {
    this.domain0 = new InventorySuppliersService(prisma);
    this.domain1 = new InventoryLocationsService(prisma);
    this.domain2 = new InventoryPurchasingService(prisma);
    this.domain3 = new InventoryStocktakingService(prisma);
    this.domain4 = new InventoryMovementsService(prisma);
  }
  suppliers(...args: Parameters<InventorySuppliersService['suppliers']>) {
    return this.domain0.suppliers(...args);
  }
  supplierDetail(
    ...args: Parameters<InventorySuppliersService['supplierDetail']>
  ) {
    return this.domain0.supplierDetail(...args);
  }
  createSupplier(
    ...args: Parameters<InventorySuppliersService['createSupplier']>
  ) {
    return this.domain0.createSupplier(...args);
  }
  updateSupplier(
    ...args: Parameters<InventorySuppliersService['updateSupplier']>
  ) {
    return this.domain0.updateSupplier(...args);
  }
  setSupplierStatus(
    ...args: Parameters<InventorySuppliersService['setSupplierStatus']>
  ) {
    return this.domain0.setSupplierStatus(...args);
  }
  locations(...args: Parameters<InventoryLocationsService['locations']>) {
    return this.domain1.locations(...args);
  }
  locationDetail(
    ...args: Parameters<InventoryLocationsService['locationDetail']>
  ) {
    return this.domain1.locationDetail(...args);
  }
  createLocation(
    ...args: Parameters<InventoryLocationsService['createLocation']>
  ) {
    return this.domain1.createLocation(...args);
  }
  updateLocation(
    ...args: Parameters<InventoryLocationsService['updateLocation']>
  ) {
    return this.domain1.updateLocation(...args);
  }
  setLocationStatus(
    ...args: Parameters<InventoryLocationsService['setLocationStatus']>
  ) {
    return this.domain1.setLocationStatus(...args);
  }
  purchaseOrders(
    ...args: Parameters<InventoryPurchasingService['purchaseOrders']>
  ) {
    return this.domain2.purchaseOrders(...args);
  }
  createPurchaseOrder(
    ...args: Parameters<InventoryPurchasingService['createPurchaseOrder']>
  ) {
    return this.domain2.createPurchaseOrder(...args);
  }
  submitPurchaseOrder(
    ...args: Parameters<InventoryPurchasingService['submitPurchaseOrder']>
  ) {
    return this.domain2.submitPurchaseOrder(...args);
  }
  approvePurchaseOrder(
    ...args: Parameters<InventoryPurchasingService['approvePurchaseOrder']>
  ) {
    return this.domain2.approvePurchaseOrder(...args);
  }
  receivePurchaseOrder(
    ...args: Parameters<InventoryPurchasingService['receivePurchaseOrder']>
  ) {
    return this.domain2.receivePurchaseOrder(...args);
  }
  cancelPurchaseOrder(
    ...args: Parameters<InventoryPurchasingService['cancelPurchaseOrder']>
  ) {
    return this.domain2.cancelPurchaseOrder(...args);
  }
  stocktakes(...args: Parameters<InventoryStocktakingService['stocktakes']>) {
    return this.domain3.stocktakes(...args);
  }
  createStocktake(
    ...args: Parameters<InventoryStocktakingService['createStocktake']>
  ) {
    return this.domain3.createStocktake(...args);
  }
  startStocktake(
    ...args: Parameters<InventoryStocktakingService['startStocktake']>
  ) {
    return this.domain3.startStocktake(...args);
  }
  countStocktakeLine(
    ...args: Parameters<InventoryStocktakingService['countStocktakeLine']>
  ) {
    return this.domain3.countStocktakeLine(...args);
  }
  submitStocktake(
    ...args: Parameters<InventoryStocktakingService['submitStocktake']>
  ) {
    return this.domain3.submitStocktake(...args);
  }
  postStocktake(
    ...args: Parameters<InventoryStocktakingService['postStocktake']>
  ) {
    return this.domain3.postStocktake(...args);
  }
  operations(...args: Parameters<InventoryMovementsService['operations']>) {
    return this.domain4.operations(...args);
  }
  createOperation(
    ...args: Parameters<InventoryMovementsService['createOperation']>
  ) {
    return this.domain4.createOperation(...args);
  }
  submitOperation(
    ...args: Parameters<InventoryMovementsService['submitOperation']>
  ) {
    return this.domain4.submitOperation(...args);
  }
  approveOperation(
    ...args: Parameters<InventoryMovementsService['approveOperation']>
  ) {
    return this.domain4.approveOperation(...args);
  }
  postOperation(
    ...args: Parameters<InventoryMovementsService['postOperation']>
  ) {
    return this.domain4.postOperation(...args);
  }
  cancelOperation(
    ...args: Parameters<InventoryMovementsService['cancelOperation']>
  ) {
    return this.domain4.cancelOperation(...args);
  }
}
