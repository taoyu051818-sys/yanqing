import { Body, Controller, Delete, Param, Get, Inject, Post } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { CreateVenueCourtDto, SaveVenueSettingsDto } from './venue-settings.dto.js';
import { VenueSettingsService } from './venue-settings.service.js';

@Controller('venues')
export class VenueSettingsController {
  constructor(@Inject(VenueSettingsService) private readonly settingsService: VenueSettingsService) {}
  @Get('profile') @Public()
  profile() { return this.settingsService.publicProfile(); }
  @Get('settings') @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  settings(@CurrentUser() actor: AuthUser) { return this.settingsService.settings(actor); }
  @Post('settings') @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  save(@Body() dto: SaveVenueSettingsDto, @CurrentUser() actor: AuthUser) { return this.settingsService.save(dto, actor); }
  @Delete('courts/:id') @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  deleteCourt(@Param('id') id: string, @CurrentUser() actor: AuthUser) { return this.settingsService.deleteCourt(id, actor); }
  @Post('courts') @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createCourt(@Body() dto: CreateVenueCourtDto, @CurrentUser() actor: AuthUser) { return this.settingsService.createCourt(dto, actor); }
}
