import { IsString, IsOptional, IsNumber, IsDateString, IsInt, IsObject, IsEnum } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

/**
 * 时间周期枚举
 */
export enum TimePeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
  YEAR = 'year',
}

/**
 * 现金流类型枚举
 */
export enum CashflowType {
  INFLOW = 'inflow',   // 资金流入（收款）
  OUTFLOW = 'outflow', // 资金流出（退费）
  ALL = 'all',         // 全部
}

// ============================================
// 查询 DTO
// ============================================

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

  @ApiPropertyOptional({ description: '流向类型', enum: CashflowType })
  @IsOptional()
  @IsEnum(CashflowType)
  flowType?: CashflowType;

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

/**
 * 滚动表查询 DTO
 */
export class RollingTableQueryDto {
  @ApiProperty({ description: '开始日期 (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期 (YYYY-MM-DD)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '时间粒度', enum: TimePeriod, default: TimePeriod.DAY })
  @IsOptional()
  @IsEnum(TimePeriod)
  granularity?: TimePeriod;
}

/**
 * 周度/月度汇总查询 DTO
 */
export class PeriodSummaryQueryDto {
  @ApiProperty({ description: '开始日期 (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: '结束日期 (YYYY-MM-DD)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;
}

// ============================================
// 内部使用 DTO（非API参数）
// ============================================

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

// ============================================
// 返回结果类型定义
// ============================================

/**
 * 经营现金流结果
 */
export interface OperatingCashflowResult {
  period: {
    startDate: string;
    endDate: string;
  };
  // 现金流入（来自 Payment）
  cashInflow: {
    total: number;
    byType: {
      sign: number;       // 新招收款
      renewal: number;    // 续费收款
      installment: number; // 分期付款
    };
    count: number;
  };
  // 现金流出（来自 Refund）
  cashOutflow: {
    total: number;
    byType: {
      normal: number;     // 正常退费
      transfer: number;   // 转校退
      terminate: number;  // 终止退
    };
    count: number;
  };
  // 净经营现金流
  netOperatingCashflow: number;
  // 非现金变动（来自 Lesson）
  nonCashChanges: {
    revenueRecognized: number; // 确认收入（消课）
    lessonCount: number;
  };
}

/**
 * 滚动表行
 */
export interface RollingTableRow {
  periodKey: string;        // 时间标识 (日期/周/月)
  periodLabel: string;      // 显示标签
  
  // 期初余额
  openingBalance: number;
  
  // 本期变动（来自 Payment）
  periodIncome: number;     // 本期收款
  incomeCount: number;
  
  // 本期消课（来自 Lesson）
  periodConsumed: number;   // 本期消课确认收入
  consumedLessons: number;
  
  // 本期退费（来自 Refund）
  periodRefund: number;     // 本期退费
  refundCount: number;
  
  // 期末余额
  closingBalance: number;
  
  // 余额变动
  balanceChange: number;
}

/**
 * 周度/月度汇总结果
 */
export interface PeriodSummaryResult {
  periodType: 'week' | 'month';
  periods: Array<{
    periodKey: string;
    periodLabel: string;
    startDate: string;
    endDate: string;
    
    // 现金流入
    totalIncome: number;
    incomeCount: number;
    
    // 现金流出
    totalRefund: number;
    refundCount: number;
    
    // 净现金流
    netCashflow: number;
    
    // 确认收入
    recognizedRevenue: number;
    lessonCount: number;
    
    // 预收余额变动
    prepaidChange: number;
  }>;
  
  // 总计
  summary: {
    totalIncome: number;
    totalRefund: number;
    netCashflow: number;
    recognizedRevenue: number;
  };
}
