import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TrainingBatchItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  enrollmentId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class TrainingBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique((item: TrainingBatchItemDto) => item?.enrollmentId)
  @ValidateNested({ each: true })
  @Type(() => TrainingBatchItemDto)
  items: TrainingBatchItemDto[];
}
