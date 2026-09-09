import type { PrismaService } from '../../src/database/prisma.service.js';
import { InventoryCatalogService } from '../../src/inventory/catalog/inventory-catalog.service.js';
import { InventoryTransactionsService } from '../../src/inventory/transactions/inventory-transactions.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class InventoryService {
  private readonly domain0: InventoryCatalogService;
  private readonly domain1: InventoryTransactionsService;
  constructor(prisma: PrismaService) {
    this.domain0 = new InventoryCatalogService(prisma);
    this.domain1 = new InventoryTransactionsService(prisma);
  }
  list(...args: Parameters<InventoryCatalogService['list']>) {
    return this.domain0.list(...args);
  }
  detail(...args: Parameters<InventoryCatalogService['detail']>) {
    return this.domain0.detail(...args);
  }
  lowStock(...args: Parameters<InventoryCatalogService['lowStock']>) {
    return this.domain0.lowStock(...args);
  }
  awardOptions(...args: Parameters<InventoryCatalogService['awardOptions']>) {
    return this.domain0.awardOptions(...args);
  }
  create(...args: Parameters<InventoryCatalogService['create']>) {
    return this.domain0.create(...args);
  }
  update(...args: Parameters<InventoryCatalogService['update']>) {
    return this.domain0.update(...args);
  }
  setStatus(...args: Parameters<InventoryCatalogService['setStatus']>) {
    return this.domain0.setStatus(...args);
  }
  transact(...args: Parameters<InventoryTransactionsService['transact']>) {
    return this.domain1.transact(...args);
  }
}
