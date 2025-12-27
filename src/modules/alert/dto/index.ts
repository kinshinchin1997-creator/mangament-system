import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ============================================
// 枚举定义
// ============================================

/**
 * 预警类型
 */
export enum AlertType {
  // 现金流预警
  CASHFLOW_NEGATIVE = 'CASHFLOW_NEGATIVE',           // 现金流转负
  CASHFLOW_DECLINE = 'CASHFLOW_DECLINE',             // 现金流下降趋势
  
  // 预收款预警
  PREPAID_LOW = 'PREPAID_LOW',                       // 预收款余额过低
  PREPAID_COVERAGE_LOW = 'PREPAID_COVERAGE_LOW',     // 预收覆盖月数不足
  PREPAID_DECLINE = 'PREPAID_DECLINE',               // 预收款下降趋势
  
  // 退费预警
  REFUND_RATE_HIGH = 'REFUND_RATE_HIGH',             // 退费率过高
  REFUND_AMOUNT_HIGH = 'REFUND_AMOUNT_HIGH',         // 退费金额过高
  REFUND_SPIKE = 'REFUND_SPIKE',                     // 退费突增
  
  // 合同预警
  CONTRACT_EXPIRING = 'CONTRACT_EXPIRING',           // 合同即将到期
  CONTRACT_EXPIRED = 'CONTRACT_EXPIRED',             // 合同已过期
  
  // 学员预警
  STUDENT_INACTIVE = 'STUDENT_INACTIVE',             // 学员休眠
  LESSON_BALANCE_LOW = 'LESSON_BALANCE_LOW',         // 课时余额不足
  
  // 收入预警
  REVENUE_DECLINE = 'REVENUE_DECLINE',               // 收入下降趋势
  REVENUE_TARGET_MISS = 'REVENUE_TARGET_MISS',       // 未达收入目标
}

/**
 * 预警级别
 */
export enum AlertLevel {
  INFO = 'info',           // 信息提示
  WARNING = 'warning',     // 警告
  DANGER = 'danger',       // 危险
  CRITICAL = 'critical',   // 严重
}

/**
 * 预警状态
 */
export enum AlertStatus {
  ACTIVE = 'active',       // 活跃（未处理）
  ACKNOWLEDGED = 'acknowledged', // 已确认（处理中）
  RESOLVED = 'resolved',   // 已解决
  IGNORED = 'ignored',     // 已忽略
}

/**
 * 比较运算符
 */
export enum CompareOperator {
  GT = 'gt',               // 大于
  GTE = 'gte',             // 大于等于
  LT = 'lt',               // 小于
  LTE = 'lte',             // 小于等于
  EQ = 'eq',               // 等于
  NEQ = 'neq',             // 不等于
}

/**
 * 指标类型
 */
export enum MetricType {
  // 现金流指标
  NET_CASHFLOW = 'net_cashflow',                     // 净现金流
  CASH_INFLOW = 'cash_inflow',                       // 现金流入
  CASH_OUTFLOW = 'cash_outflow',                     // 现金流出
  
  // 预收款指标
  PREPAID_BALANCE = 'prepaid_balance',               // 预收款余额
  PREPAID_COVERAGE_MONTHS = 'prepaid_coverage_months', // 预收覆盖月数
  
  // 退费指标
  REFUND_RATE = 'refund_rate',                       // 退费率
  REFUND_AMOUNT = 'refund_amount',                   // 退费金额
  REFUND_COUNT = 'refund_count',                     // 退费笔数
  
  // 合同指标
  EXPIRING_CONTRACTS = 'expiring_contracts',         // 即将过期合同数
  EXPIRED_CONTRACTS = 'expired_contracts',           // 已过期合同数
  
  // 学员指标
  INACTIVE_STUDENTS = 'inactive_students',           // 休眠学员数
  LOW_BALANCE_CONTRACTS = 'low_balance_contracts',   // 低余额合同数
  
  // 收入指标
  RECOGNIZED_REVENUE = 'recognized_revenue',         // 确认收入
  REVENUE_GROWTH = 'revenue_growth',                 // 收入增长率
}

/**
 * 通知渠道
 */
export enum NotifyChannel {
  SYSTEM = 'system',       // 系统内通知
  EMAIL = 'email',         // 邮件
  SMS = 'sms',             // 短信
  WECHAT = 'wechat',       // 微信
  WEBHOOK = 'webhook',     // Webhook
}

// ============================================
// 规则配置 DTO
// ============================================

/**
 * 预警条件配置
 */
export class AlertConditionDto {
  @ApiProperty({ description: '指标类型', enum: MetricType })
  @IsEnum(MetricType)
  metric: MetricType;

  @ApiProperty({ description: '比较运算符', enum: CompareOperator })
  @IsEnum(CompareOperator)
  operator: CompareOperator;

  @ApiProperty({ description: '阈值' })
  @IsNumber()
  threshold: number;

  @ApiPropertyOptional({ description: '单位', example: '%' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '时间范围（天）', default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  periodDays?: number;

  @ApiPropertyOptional({ description: '预测周数（用于预测类指标）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  forecastWeeks?: number;
}

/**
 * 通知配置
 */
export class NotifyConfigDto {
  @ApiProperty({ description: '通知渠道', enum: NotifyChannel, isArray: true })
  @IsArray()
  @IsEnum(NotifyChannel, { each: true })
  channels: NotifyChannel[];

  @ApiPropertyOptional({ description: '接收人ID列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recipientIds?: string[];

  @ApiPropertyOptional({ description: '接收角色列表', example: ['BOSS', 'FINANCE'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recipientRoles?: string[];

  @ApiPropertyOptional({ description: 'Webhook URL' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ description: '通知冷却时间（小时）', default: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  cooldownHours?: number;
}

/**
 * 创建预警规则 DTO
 */
export class CreateAlertRuleDto {
  @ApiProperty({ description: '规则名称' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '规则描述' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: '预警类型', enum: AlertType })
  @IsEnum(AlertType)
  type: AlertType;

  @ApiProperty({ description: '预警级别', enum: AlertLevel })
  @IsEnum(AlertLevel)
  level: AlertLevel;

  @ApiProperty({ description: '触发条件', type: AlertConditionDto })
  @ValidateNested()
  @Type(() => AlertConditionDto)
  condition: AlertConditionDto;

  @ApiPropertyOptional({ description: '通知配置', type: NotifyConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotifyConfigDto)
  notifyConfig?: NotifyConfigDto;

  @ApiPropertyOptional({ description: '建议处理措施' })
  @IsOptional()
  @IsString()
  suggestedAction?: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '适用校区ID列表（空为全部）' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  campusIds?: string[];

  @ApiPropertyOptional({ description: '优先级（数字越小越优先）', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}

/**
 * 更新预警规则 DTO
 */
export class UpdateAlertRuleDto {
  @ApiPropertyOptional({ description: '规则名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '规则描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '预警级别', enum: AlertLevel })
  @IsOptional()
  @IsEnum(AlertLevel)
  level?: AlertLevel;

  @ApiPropertyOptional({ description: '触发条件' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AlertConditionDto)
  condition?: AlertConditionDto;

  @ApiPropertyOptional({ description: '通知配置' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotifyConfigDto)
  notifyConfig?: NotifyConfigDto;

  @ApiPropertyOptional({ description: '建议处理措施' })
  @IsOptional()
  @IsString()
  suggestedAction?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 查询预警规则 DTO
 */
export class QueryAlertRuleDto {
  @ApiPropertyOptional({ description: '预警类型', enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;
}

/**
 * 查询预警事件 DTO
 */
export class QueryAlertEventDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '预警类型', enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional({ description: '预警级别', enum: AlertLevel })
  @IsOptional()
  @IsEnum(AlertLevel)
  level?: AlertLevel;

  @ApiPropertyOptional({ description: '预警状态', enum: AlertStatus })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/**
 * 处理预警事件 DTO
 */
export class HandleAlertEventDto {
  @ApiProperty({ description: '处理动作', enum: ['acknowledge', 'resolve', 'ignore'] })
  @IsString()
  action: 'acknowledge' | 'resolve' | 'ignore';

  @ApiPropertyOptional({ description: '处理备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

// ============================================
// 返回结果类型定义
// ============================================

/**
 * 预警规则
 */
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  type: AlertType;
  level: AlertLevel;
  condition: {
    metric: MetricType;
    operator: CompareOperator;
    threshold: number;
    unit?: string;
    periodDays?: number;
    forecastWeeks?: number;
  };
  notifyConfig?: {
    channels: NotifyChannel[];
    recipientIds?: string[];
    recipientRoles?: string[];
    webhookUrl?: string;
    cooldownHours?: number;
  };
  suggestedAction?: string;
  enabled: boolean;
  campusIds?: string[];
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 预警事件
 */
export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  type: AlertType;
  level: AlertLevel;
  status: AlertStatus;
  
  // 触发信息
  triggeredAt: Date;
  triggeredValue: number;
  threshold: number;
  operator: CompareOperator;
  
  // 上下文信息
  campusId?: string;
  campusName?: string;
  
  // 描述
  title: string;
  message: string;
  suggestedAction?: string;
  
  // 详情数据
  details?: {
    metric: MetricType;
    periodDays?: number;
    forecastWeeks?: number;
    relatedData?: any;
  };
  
  // 处理信息
  acknowledgedAt?: Date;
  acknowledgedById?: string;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedById?: string;
  resolvedBy?: string;
  handleRemark?: string;
  
  // 通知状态
  notifiedChannels?: NotifyChannel[];
  lastNotifiedAt?: Date;
}

/**
 * 预警检查结果
 */
export interface AlertCheckResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  currentValue: number;
  threshold: number;
  operator: CompareOperator;
  level: AlertLevel;
  message?: string;
}

/**
 * 指标计算结果
 */
export interface MetricValue {
  metric: MetricType;
  value: number;
  unit?: string;
  calculatedAt: Date;
  period?: {
    startDate: string;
    endDate: string;
    days: number;
  };
  breakdown?: Record<string, number>;
}

/**
 * 预警统计
 */
export interface AlertStatistics {
  total: number;
  byLevel: Record<AlertLevel, number>;
  byType: Record<AlertType, number>;
  byStatus: Record<AlertStatus, number>;
  activeCount: number;
  resolvedToday: number;
  avgResolutionHours: number;
}

