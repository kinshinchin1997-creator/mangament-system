import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ForecastQueryDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '预测天数', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ description: '预测月数', default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;
}

export class RiskAlertQueryDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '预警阈值天数', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ description: '课时阈值', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  threshold?: number;
}

