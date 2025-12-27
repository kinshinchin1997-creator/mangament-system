import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsNumber,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ============================================
// 枚举定义
// ============================================

/**
 * 预测粒度
 */
export enum ForecastGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

/**
 * 预测状态
 */
export enum ForecastStatus {
  DRAFT = 'draft',       // 草稿（自动生成）
  ADJUSTED = 'adjusted', // 已调整（人工修改）
  LOCKED = 'locked',     // 已锁定（不可修改）
}

/**
 * 预警级别
 */
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  DANGER = 'danger',
  CRITICAL = 'critical',
}

/**
 * 预警类型
 */
export enum AlertType {
  CASHFLOW_NEGATIVE = 'CASHFLOW_NEGATIVE',     // 现金流转负
  PREPAID_LOW = 'PREPAID_LOW',                 // 预收款余额过低
  REFUND_HIGH = 'REFUND_HIGH',                 // 退费率过高
  CONTRACT_EXPIRING = 'CONTRACT_EXPIRING',     // 合同即将到期
  STUDENT_INACTIVE = 'STUDENT_INACTIVE',       // 学员休眠
  REVENUE_DECLINE = 'REVENUE_DECLINE',         // 收入下降趋势
  LESSON_LOW = 'LESSON_LOW',                   // 课时余额不足
}

// ============================================
// 查询 DTO
// ============================================

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

/**
 * 13周滚动预测查询 DTO
 */
export class Rolling13WeekQueryDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '起始日期（默认本周一）' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '是否包含人工调整值', default: true })
  @IsOptional()
  @IsBoolean()
  includeAdjustments?: boolean;
}

/**
 * 人工调整预测 DTO
 */
export class AdjustForecastDto {
  @ApiProperty({ description: '周标识 (YYYY-Wxx)' })
  @IsString()
  weekKey: string;

  @ApiPropertyOptional({ description: '校区ID（空为全公司）' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '调整后的预计收款' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustedInflow?: number;

  @ApiPropertyOptional({ description: '调整后的预计退费' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustedOutflow?: number;

  @ApiPropertyOptional({ description: '调整后的预计消课收入' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustedRevenue?: number;

  @ApiPropertyOptional({ description: '调整原因' })
  @IsOptional()
  @IsString()
  adjustReason?: string;
}

/**
 * 批量调整预测 DTO
 */
export class BatchAdjustForecastDto {
  @ApiProperty({ description: '调整项列表', type: [AdjustForecastDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustForecastDto)
  adjustments: AdjustForecastDto[];
}

/**
 * 锁定预测 DTO
 */
export class LockForecastDto {
  @ApiProperty({ description: '周标识列表 (YYYY-Wxx)' })
  @IsArray()
  @IsString({ each: true })
  weekKeys: string[];

  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;
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

// ============================================
// 返回结果类型定义
// ============================================

/**
 * 单周预测数据
 */
export interface WeekForecastData {
  weekKey: string;           // 周标识 2024-W01
  weekLabel: string;         // 显示标签 "第1周 (1/1-1/7)"
  startDate: string;         // 周起始日期
  endDate: string;           // 周结束日期
  
  // 系统预测值（基于历史数据）
  predicted: {
    inflow: number;          // 预计收款
    outflow: number;         // 预计退费
    netCashflow: number;     // 预计净现金流
    revenue: number;         // 预计消课收入
    prepaidChange: number;   // 预计预收余额变动
  };
  
  // 人工调整值（可选）
  adjusted?: {
    inflow?: number;
    outflow?: number;
    revenue?: number;
    adjustedBy?: string;
    adjustedAt?: Date;
    reason?: string;
  };
  
  // 最终采用值（优先用调整值）
  final: {
    inflow: number;
    outflow: number;
    netCashflow: number;
    revenue: number;
    prepaidChange: number;
  };
  
  // 状态
  status: ForecastStatus;
  
  // 累计值（滚动计算）
  cumulative: {
    netCashflow: number;     // 累计净现金流
    prepaidBalance: number;  // 累计预收款余额
  };
}

/**
 * 13周滚动预测结果
 */
export interface Rolling13WeekResult {
  // 预测期间
  period: {
    startDate: string;
    endDate: string;
    weeks: number;
  };
  
  // 当前预收款余额（起始点）
  currentPrepaidBalance: number;
  
  // 周度预测数据
  weeklyForecast: WeekForecastData[];
  
  // 汇总
  summary: {
    totalPredictedInflow: number;
    totalPredictedOutflow: number;
    totalNetCashflow: number;
    totalRevenue: number;
    endingPrepaidBalance: number;
  };
  
  // 预警（预留接口）
  alerts: ForecastAlert[];
  
  // 元数据
  meta: {
    generatedAt: Date;
    basedOnDays: number;     // 基于多少天历史数据
    adjustmentCount: number; // 人工调整数量
  };
}

/**
 * 预测预警（预留接口）
 */
export interface ForecastAlert {
  weekKey: string;
  type: AlertType;
  level: AlertLevel;
  title: string;
  message: string;
  threshold?: number;
  actualValue?: number;
  suggestedAction?: string;
}

/**
 * 历史数据统计
 */
export interface HistoricalStats {
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
  
  // 收款统计
  income: {
    total: number;
    dailyAvg: number;
    weeklyAvg: number;
    monthlyAvg: number;
    byType: {
      sign: number;
      renewal: number;
      installment: number;
    };
  };
  
  // 退费统计
  refund: {
    total: number;
    dailyAvg: number;
    weeklyAvg: number;
    rate: number;
  };
  
  // 消课统计
  lesson: {
    total: number;
    dailyAvg: number;
    weeklyAvg: number;
    lessonCount: number;
  };
  
  // 趋势
  trend: {
    incomeGrowth: number;    // 收入增长率
    refundGrowth: number;    // 退费增长率
    seasonalFactor: number;  // 季节系数
  };
}

/**
 * 预警规则接口（预留）
 */
export interface AlertRule {
  id: string;
  type: AlertType;
  name: string;
  description: string;
  enabled: boolean;
  
  // 触发条件
  condition: {
    metric: string;          // 指标名称
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    unit?: string;
  };
  
  // 预警配置
  alertConfig: {
    level: AlertLevel;
    recipients?: string[];   // 通知对象
    channels?: string[];     // 通知渠道
  };
}
