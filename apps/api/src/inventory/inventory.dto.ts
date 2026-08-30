import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsObject,
  MinLength,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  InventoryMode,
  InventoryOperationType,
  InventoryTxnType,
  SupplierType,
} from '../generated/prisma/enums.js';

export class MasterDataCommandDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class VersionedMasterDataCommandDto extends MasterDataCommandDto {
  @IsDateString()
  expectedUpdatedAt: string;
}

export class CreateInventoryItemDto extends MasterDataCommandDto {
  @IsString()
  @MaxLength(60)
  sku: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(80)
  category: string;

  @IsEnum(InventoryMode)
  mode: InventoryMode;

  @IsString()
  supplierId: string;

  @IsString()
  defaultLocationId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  purchasePriceCents: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  salePriceCents: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  safeStock = 0;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  batchCode?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateInventoryItemDto extends VersionedMasterDataCommandDto {
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsEnum(InventoryMode) mode?: InventoryMode;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() defaultLocationId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  purchasePriceCents?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) salePriceCents?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) safeStock?: number;
  @IsOptional() @IsString() @MaxLength(80) batchCode?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class SetMasterDataStatusDto extends VersionedMasterDataCommandDto {
  @IsBoolean()
  enabled: boolean;
}

export class InventoryTransactionDto {
  @IsEnum(InventoryTxnType)
  type: InventoryTxnType;

  @Type(() => Number)
  @IsInt()
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCostCents?: number;

  @IsOptional()
  @IsString()
  orderItemId?: string;

  /**
   * Business evidence for non-sale consumption. Training and event usage
   * must carry the source object so a stock movement can be reconciled back
   * to a class session or tournament prize record.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class CreateSupplierDto extends MasterDataCommandDto {
  @IsString() @MinLength(2) @MaxLength(40) code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(SupplierType) type: SupplierType;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsObject() settlementRule: Record<string, unknown>;
}

export class UpdateSupplierDto extends VersionedMasterDataCommandDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(SupplierType) type?: SupplierType;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsObject() settlementRule?: Record<string, unknown>;
}

export class CreateInventoryLocationDto extends MasterDataCommandDto {
  @IsString() @MinLength(2) @MaxLength(40) code: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
}

export class UpdateInventoryLocationDto extends VersionedMasterDataCommandDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
}

export class PurchaseOrderLineDto {
  @IsString() itemId: string;
  @IsString() locationId: string;
  @Type(() => Number) @IsInt() @Min(1) orderedQuantity: number;
  @Type(() => Number) @IsInt() @Min(0) unitCostCents: number;
  @IsOptional() @IsString() @MaxLength(80) batchCode?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() supplierId: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
  @IsOptional() @IsString() @MaxLength(300) remark?: string;
}

export class ReceivePurchaseLineDto {
  @IsString() lineId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseLineDto)
  lines: ReceivePurchaseLineDto[];
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey: string;
}

export class CancelDocumentDto {
  @IsString() @MinLength(2) @MaxLength(300) reason: string;
}

export class CreateStocktakeDto {
  @IsString() locationId: string;
  @IsString() @MinLength(2) @MaxLength(300) reason: string;
}

export class CountStocktakeLineDto {
  @Type(() => Number) @IsInt() @Min(0) countedQuantity: number;
}

export class PostStocktakeDto {
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey: string;
}

export class CreateInventoryOperationDto {
  @IsEnum(InventoryOperationType) type: InventoryOperationType;
  @IsString() itemId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
  @IsString() sourceLocationId: string;
  @IsOptional() @IsString() targetLocationId?: string;
  @IsOptional() @IsString() @MaxLength(80) batchCode?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsString() @MinLength(2) @MaxLength(300) reason: string;
  @IsOptional() @IsString() @MaxLength(80) referenceType?: string;
  @IsOptional() @IsString() @MaxLength(120) referenceId?: string;
}

export class PostInventoryOperationDto {
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey: string;
}
