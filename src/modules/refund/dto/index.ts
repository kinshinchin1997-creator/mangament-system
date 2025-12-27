import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsInt,
  IsBoolean,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

/**
 * 退费类型枚举
 */
export enum RefundType {
  NORMAL = 'NORMAL',       // 正常退费
  TRANSFER = 'TRANSFER',   // 转校退
  TERMINATE = 'TERMINATE', // 终止合作
}

/**
 * 退费状态枚举
 * 审批流状态：待审批 -> 已通过/已驳回 -> 已完成
 */
export enum RefundStatus {
  PENDING = 0,    // 待审批（已提交，等待财务/老板审批）
  APPROVED = 1,   // 已通过（审批通过，等待打款）
  REJECTED = 2,   // 已驳回（审批不通过）
  COMPLETED = 3,  // 已完成（已打款，退费结束）
  CANCELLED = 4,  // 已取消（申请人主动取消）
}

/**
 * 创建退费申请 DTO
 */
export class CreateRefundDto {
  @ApiProperty({ description: '合同ID' })
  @IsString()
  @IsNotEmpty({ message: '合同ID不能为空' })
  contractId: string;

  @ApiProperty({ description: '退费原因' })
  @IsString()
  @IsNotEmpty({ message: '退费原因不能为空' })
  reason: string;

  @ApiPropertyOptional({ description: '退费类型', enum: RefundType, default: RefundType.NORMAL })
  @IsOptional()
  @IsEnum(RefundType)
  refundType?: RefundType;

  @ApiPropertyOptional({ description: '扣除金额（违约金等）', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deductAmount?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

/**
 * 退费预览请求 DTO
 */
export class RefundPreviewDto {
  @ApiProperty({ description: '合同ID' })
  @IsString()
  @IsNotEmpty({ message: '合同ID不能为空' })
  contractId: string;

  @ApiPropertyOptional({ description: '预计扣除金额', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deductAmount?: number;
}

/**
 * 审批退费 DTO
 */
export class ApproveRefundDto {
  @ApiProperty({ description: '是否通过' })
  @IsBoolean()
  approved: boolean;

  @ApiPropertyOptional({ description: '审批备注' })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ description: '调整后的实退金额（仅审批时可调整）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualAmount?: number;
}

/**
 * 完成退费打款 DTO
 */
export class CompleteRefundDto {
  @ApiProperty({ description: '退款方式', enum: ['CASH', 'WECHAT', 'ALIPAY', 'BANK'] })
  @IsString()
  @IsNotEmpty({ message: '退款方式不能为空' })
  refundMethod: string;

  @ApiPropertyOptional({ description: '退款账户信息' })
  @IsOptional()
  @IsString()
  refundAccount?: string;

  @ApiPropertyOptional({ description: '交易流水号' })
  @IsOptional()
  @IsString()
  transactionNo?: string;
}

/**
 * 查询退费列表 DTO
 */
export class QueryRefundDto extends PaginationDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '退费状态', enum: RefundStatus })
  @IsOptional()
  @IsInt()
  status?: number;

  @ApiPropertyOptional({ description: '退费类型', enum: RefundType })
  @IsOptional()
  @IsEnum(RefundType)
  refundType?: RefundType;

  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;

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
 * 退费统计查询 DTO
 */
export class RefundStatisticsDto {
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

/**
 * 风控检查结果
 */
export interface RiskCheckResult {
  passed: boolean;           // 是否通过风控
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';  // 风险等级
  warnings: string[];        // 警告信息
  studentRefundRate?: number; // 学员退费率
  campusRefundRate?: number;  // 校区退费率
  details: {
    studentHistory: {
      totalContracts: number;
      refundedContracts: number;
      totalPaid: number;
      totalRefunded: number;
    };
    campusHistory: {
      periodContracts: number;
      periodRefunds: number;
      periodPaidAmount: number;
      periodRefundAmount: number;
    };
  };
}

