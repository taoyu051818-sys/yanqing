import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateInventoryLocationDto,
  SetMasterDataStatusDto,
  UpdateInventoryLocationDto,
} from '../inventory.dto.js';
import {
  locations,
  locationDetail,
  createLocation,
  updateLocation,
  setLocationStatus,
} from './inventory-operations-locations.commands.js';

@Injectable()
export class InventoryLocationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  locations(actor: AuthUser) {
    return locations(this.prisma, actor);
  }
  async locationDetail(id: string, actor: AuthUser) {
    return locationDetail(this.prisma, id, actor);
  }
  async createLocation(dto: CreateInventoryLocationDto, actor: AuthUser) {
    return createLocation(this.prisma, dto, actor);
  }
  async updateLocation(
    id: string,
    dto: UpdateInventoryLocationDto,
    actor: AuthUser,
  ) {
    return updateLocation(this.prisma, id, dto, actor);
  }
  async setLocationStatus(
    id: string,
    dto: SetMasterDataStatusDto,
    actor: AuthUser,
  ) {
    return setLocationStatus(this.prisma, id, dto, actor);
  }
}
