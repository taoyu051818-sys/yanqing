import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateMembershipProductDto,
  CreateMembershipProductVersionDto,
  SetMembershipProductStatusDto,
} from '../memberships.dto.js';
import {
  products,
  manageProducts,
  createProduct,
  createProductVersion,
  setProductStatus,
} from './memberships-products.commands.js';

@Injectable()
export class MembershipProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  products() {
    return products(this.prisma);
  }
  manageProducts(actor: AuthUser) {
    return manageProducts(this.prisma, actor);
  }
  createProduct(dto: CreateMembershipProductDto, actor: AuthUser) {
    return createProduct(this.prisma, dto, actor);
  }
  async createProductVersion(
    sourceProductId: string,
    dto: CreateMembershipProductVersionDto,
    actor: AuthUser,
  ) {
    return createProductVersion(this.prisma, sourceProductId, dto, actor);
  }
  async setProductStatus(
    productId: string,
    dto: SetMembershipProductStatusDto,
    actor: AuthUser,
  ) {
    return setProductStatus(this.prisma, productId, dto, actor);
  }
}
