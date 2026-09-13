import { publicGameList } from './public-game-list.query.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type CreateGameDto, type PublishGameDto } from '../games.dto.js';
import {
  detail,
  participants,
  list,
  managed,
  create,
  publish,
} from './games-catalog.commands.js';

@Injectable()
export class GameCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async detail(id: string) {
    return detail(this.prisma, id);
  }
  async participants(id: string, actor: AuthUser) {
    return participants(this.prisma, id, actor);
  }
  async publicList() {
    return publicGameList(this.prisma);
  }
  async list(actor: AuthUser) {
    return list(this.prisma, actor);
  }
  async managed(actor: AuthUser) {
    return managed(this.prisma, actor);
  }
  async create(dto: CreateGameDto, actor: AuthUser) {
    return create(this.prisma, dto, actor);
  }
  async publish(
    gameId: string,
    dto: PublishGameDto | undefined,
    actor: AuthUser,
  ) {
    return publish(this.prisma, gameId, dto, actor);
  }
}
