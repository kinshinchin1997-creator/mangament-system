import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

export class CreatePaymentDto {
  @ApiProperty({ description: '学员ID' })
  @IsString()
  @IsNotEmpty({ message: '学员不能为空' })
  studentId: string;

  @ApiProperty({ description: '校区ID' })
  @IsString()
  @IsNotEmpty({ message: '校区不能为空' })
  campusId: string;

  @ApiProperty({ description: '课包ID' })
  @IsString()
  @IsNotEmpty({ message: '课包不能为空' })
  packageId: string;

  @ApiPropertyOptional({ description: '优惠金额', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: '支付方式',
    enum: ['CASH', 'WECHAT', 'ALIPAY', 'BANK', 'POS'],
  })
  @IsString()
  @IsNotEmpty({ message: '支付方式不能为空' })
  payMethod: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class QueryPaymentDto extends PaginationDto {
  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '支付方式' })
  @IsOptional()
  @IsString()
  payMethod?: string;

  @ApiPropertyOptional({ description: '收款类型', enum: ['SIGN', 'INSTALLMENT', 'RENEWAL'] })
  @IsOptional()
  @IsString()
  paymentType?: string;

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

