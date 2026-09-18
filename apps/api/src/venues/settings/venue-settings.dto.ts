import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CourtUsage, CourtZone } from '../../generated/prisma/enums.js';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class SaveVenueSettingsDto {
  @IsOptional() @IsString() revision?: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @Transform(trim) @IsString() @MaxLength(300) address: string;
  @Transform(trim) @IsString() @MaxLength(40) contactPhone: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @IsInt() @Min(0) @Max(23) opensAtHour: number;
  @IsInt() @Min(1) @Max(24) closesAtHour: number;
}
export class CreateVenueCourtDto {
  @Transform(trim) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/) code: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsEnum(CourtZone) zone: CourtZone;
  @IsEnum(CourtUsage) usage: CourtUsage;
  @IsBoolean() enabled: boolean;
  @IsInt() @Min(0) @Max(10000) sortOrder: number;
}
