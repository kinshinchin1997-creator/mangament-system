import { IsString, IsOptional, IsNumber, IsDateString, IsInt, IsObject } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

export class QueryCashflowDto extends PaginationDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '方向: 1=流入, -1=流出' })
  @IsOptional()
  @IsInt()
  direction?: number;

  @ApiPropertyOptional({ description: '业务类型' })
  @IsOptional()
  @IsString()
  bizType?: string;

  @ApiPropertyOptional({ description: '流向类型: inflow=收款, outflow=退费', enum: ['inflow', 'outflow'] })
  @IsOptional()
  @IsString()
  flowType?: 'inflow' | 'outflow';

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: '关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class CashflowSummaryDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class DailySettlementDto {
  @ApiProperty({ description: '日结日期 (YYYY-MM-DD)' })
  @IsDateString()
  settleDate: string;

  @ApiProperty({ description: '校区ID' })
  @IsString()
  campusId: string;
}

// ====== 内部使用DTO（非API参数） ======

export class RecordInflowDto {
  bizType: string;
  bizId: string;
  bizNo: string;
  contractId: string;
  amount: number;
  payMethod: string;
  campusId: string;
  createdById: string;
  remark?: string;
  snapshotData?: Record<string, any>;
}

export class RecordOutflowDto {
  bizType: string;
  bizId: string;
  bizNo: string;
  contractId: string;
  refundId?: string;
  amount: number;
  payMethod: string;
  campusId: string;
  createdById: string;
  remark?: string;
  snapshotData?: Record<string, any>;
}

