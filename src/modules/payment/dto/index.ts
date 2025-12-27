import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

// ============================================
// 收款类型枚举
// ============================================

/**
 * 收款类型
 * - SIGN: 新招（首次签约）
 * - RENEWAL: 续费（老学员续课）
 */
export enum PaymentTypeEnum {
  SIGN = 'SIGN',           // 新招 - 新学员首次购买课包
  RENEWAL = 'RENEWAL',     // 续费 - 老学员续购课包
}

/**
 * 支付方式
 */
export enum PayMethodEnum {
  CASH = 'CASH',           // 现金
  WECHAT = 'WECHAT',       // 微信支付
  ALIPAY = 'ALIPAY',       // 支付宝
  BANK = 'BANK',           // 银行转账
  POS = 'POS',             // POS刷卡
}

// ============================================
// 新招收款 DTO（创建新合同 + 收款）
// ============================================

export class CreateSignPaymentDto {
  @ApiProperty({ description: '收款类型', enum: PaymentTypeEnum, example: 'SIGN' })
  @IsEnum(PaymentTypeEnum, { message: '收款类型只能是 SIGN 或 RENEWAL' })
  paymentType: PaymentTypeEnum;

  @ApiProperty({ description: '学员ID' })
  @IsString()
  @IsNotEmpty({ message: '学员ID不能为空' })
  studentId: string;

  @ApiProperty({ description: '校区ID' })
  @IsString()
  @IsNotEmpty({ message: '校区ID不能为空' })
  campusId: string;

  @ApiProperty({ description: '课包ID（必须绑定课包）' })
  @IsString()
  @IsNotEmpty({ message: '课包ID不能为空' })
  packageId: string;

  @ApiPropertyOptional({ description: '优惠金额', default: 0, example: 200 })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: '优惠金额不能为负数' })
  discountAmount?: number;

  @ApiPropertyOptional({ description: '合同生效日期（默认当天）', example: '2024-12-27' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '支付方式', enum: PayMethodEnum, example: 'WECHAT' })
  @IsEnum(PayMethodEnum, { message: '无效的支付方式' })
  payMethod: PayMethodEnum;

  @ApiPropertyOptional({ description: '第三方交易流水号' })
  @IsOptional()
  @IsString()
  transactionNo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

// ============================================
// 续费收款 DTO（基于现有合同续费）
// ============================================

export class CreateRenewalPaymentDto {
  @ApiProperty({ description: '收款类型', enum: [PaymentTypeEnum.RENEWAL], example: 'RENEWAL' })
  @IsEnum(PaymentTypeEnum, { message: '续费收款类型必须是 RENEWAL' })
  paymentType: PaymentTypeEnum;

  @ApiProperty({ description: '原合同ID（续费基于哪个合同）' })
  @IsString()
  @IsNotEmpty({ message: '原合同ID不能为空' })
  originalContractId: string;

  @ApiProperty({ description: '续费课包ID（可以与原课包不同）' })
  @IsString()
  @IsNotEmpty({ message: '续费课包ID不能为空' })
  packageId: string;

  @ApiPropertyOptional({ description: '优惠金额', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiProperty({ description: '支付方式', enum: PayMethodEnum })
  @IsEnum(PayMethodEnum)
  payMethod: PayMethodEnum;

  @ApiPropertyOptional({ description: '第三方交易流水号' })
  @IsOptional()
  @IsString()
  transactionNo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

// ============================================
// 统一收款请求 DTO（兼容新招和续费）
// ============================================

export class CreatePaymentDto {
  @ApiProperty({ description: '收款类型', enum: PaymentTypeEnum })
  @IsEnum(PaymentTypeEnum, { message: '收款类型只能是 SIGN 或 RENEWAL' })
  paymentType: PaymentTypeEnum;

  // ====== 新招时必填 ======
  @ApiPropertyOptional({ description: '学员ID（新招时必填）' })
  @ValidateIf((o) => o.paymentType === PaymentTypeEnum.SIGN)
  @IsString()
  @IsNotEmpty({ message: '新招时学员ID不能为空' })
  studentId?: string;

  @ApiPropertyOptional({ description: '校区ID（新招时必填）' })
  @ValidateIf((o) => o.paymentType === PaymentTypeEnum.SIGN)
  @IsString()
  @IsNotEmpty({ message: '新招时校区ID不能为空' })
  campusId?: string;

  // ====== 续费时必填 ======
  @ApiPropertyOptional({ description: '原合同ID（续费时必填）' })
  @ValidateIf((o) => o.paymentType === PaymentTypeEnum.RENEWAL)
  @IsString()
  @IsNotEmpty({ message: '续费时原合同ID不能为空' })
  originalContractId?: string;

  // ====== 通用字段 ======
  @ApiProperty({ description: '课包ID（必须绑定课包）' })
  @IsString()
  @IsNotEmpty({ message: '课包ID不能为空' })
  packageId: string;

  @ApiPropertyOptional({ description: '优惠金额', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: '合同生效日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '支付方式', enum: PayMethodEnum })
  @IsEnum(PayMethodEnum)
  payMethod: PayMethodEnum;

  @ApiPropertyOptional({ description: '第三方交易流水号' })
  @IsOptional()
  @IsString()
  transactionNo?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

// ============================================
// 收款查询 DTO
// ============================================

export class QueryPaymentDto extends PaginationDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '支付方式', enum: PayMethodEnum })
  @IsOptional()
  @IsEnum(PayMethodEnum)
  payMethod?: PayMethodEnum;

  @ApiPropertyOptional({ description: '收款类型', enum: PaymentTypeEnum })
  @IsOptional()
  @IsEnum(PaymentTypeEnum)
  paymentType?: PaymentTypeEnum;

  @ApiPropertyOptional({ description: '合同ID' })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiPropertyOptional({ description: '学员ID' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional({ description: '搜索关键词（单号/备注）' })
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

// ============================================
// 预收款统计响应 DTO
// ============================================

export class PrepaidSummaryDto {
  /** 总预收金额（累计所有收款） */
  totalPrepaid: number;

  /** 未消课金额（预收款余额，即还欠学员的课时价值） */
  totalUnearned: number;

  /** 已确认收入（已消课金额） */
  totalEarned: number;

  /** 有效合同数 */
  activeContractCount: number;

  /** 按校区分组的预收款统计 */
  byCampus: Array<{
    campusId: string;
    campusName: string;
    prepaid: number;
    unearned: number;
    earned: number;
    contractCount: number;
  }>;
}
