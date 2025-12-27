import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsEnum,
  IsInt,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

// ============================================
// 消课状态枚举
// ============================================

/**
 * 消课记录状态
 */
export enum LessonStatusEnum {
  NORMAL = 1,     // 正常（已签到消课）
  REVOKED = 2,    // 已撤销
}

/**
 * 签到状态（用于排课签到流程）
 */
export enum AttendanceStatusEnum {
  PENDING = 'PENDING',       // 待签到
  ATTENDED = 'ATTENDED',     // 已签到（正常出席）
  ABSENT = 'ABSENT',         // 缺勤（未请假）
  LEAVE = 'LEAVE',           // 请假
  MAKEUP = 'MAKEUP',         // 补课
}

/**
 * 消课类型
 */
export enum LessonTypeEnum {
  NORMAL = 'NORMAL',         // 正常消课（签到后消课）
  ABSENCE_DEDUCT = 'ABSENCE_DEDUCT',  // 缺勤扣课（无故缺勤扣课时）
  MAKEUP = 'MAKEUP',         // 补课消课
  TRIAL = 'TRIAL',           // 试听课（可能不扣课时）
}

// ============================================
// 签到 DTO（上课→签到→消课流程）
// ============================================

/**
 * 单个学员签到信息
 */
export class StudentAttendanceDto {
  @ApiProperty({ description: '合同ID' })
  @IsString()
  @IsNotEmpty()
  contractId: string;

  @ApiProperty({ description: '签到状态', enum: AttendanceStatusEnum })
  @IsEnum(AttendanceStatusEnum)
  status: AttendanceStatusEnum;

  @ApiPropertyOptional({ description: '消耗课时数（默认1）', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  lessonCount?: number;

  @ApiPropertyOptional({ description: '备注（请假原因/补课说明等）' })
  @IsOptional()
  @IsString()
  remark?: string;
}

/**
 * 批量签到 DTO（一节课多个学员）
 */
export class BatchAttendanceDto {
  @ApiProperty({ description: '上课日期', example: '2024-12-27' })
  @IsDateString()
  lessonDate: string;

  @ApiPropertyOptional({ description: '上课时间段', example: '14:00-15:30' })
  @IsOptional()
  @IsString()
  lessonTime?: string;

  @ApiPropertyOptional({ description: '课程时长（分钟）', example: 90 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(300)
  duration?: number;

  @ApiProperty({ description: '授课教师ID' })
  @IsString()
  @IsNotEmpty()
  teacherId: string;

  @ApiProperty({ description: '校区ID' })
  @IsString()
  @IsNotEmpty()
  campusId: string;

  @ApiProperty({ description: '学员签到列表', type: [StudentAttendanceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentAttendanceDto)
  attendances: StudentAttendanceDto[];
}

// ============================================
// 单个消课 DTO
// ============================================

/**
 * 创建消课记录 DTO
 */
export class CreateLessonDto {
  @ApiProperty({ description: '合同ID（必须绑定合同）' })
  @IsString()
  @IsNotEmpty({ message: '合同ID不能为空' })
  contractId: string;

  @ApiProperty({ description: '授课教师ID' })
  @IsString()
  @IsNotEmpty({ message: '教师ID不能为空' })
  teacherId: string;

  @ApiProperty({ description: '上课日期', example: '2024-12-27' })
  @IsDateString()
  lessonDate: string;

  @ApiPropertyOptional({ description: '上课时间段', example: '14:00-15:30' })
  @IsOptional()
  @IsString()
  lessonTime?: string;

  @ApiPropertyOptional({ description: '课程时长（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(15)
  duration?: number;

  @ApiProperty({ description: '消耗课时数', minimum: 1, example: 1 })
  @IsInt()
  @Min(1, { message: '消耗课时数至少为1' })
  @Max(10, { message: '单次消课不能超过10课时' })
  lessonCount: number;

  @ApiPropertyOptional({ description: '消课类型', enum: LessonTypeEnum, default: LessonTypeEnum.NORMAL })
  @IsOptional()
  @IsEnum(LessonTypeEnum)
  lessonType?: LessonTypeEnum;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

// ============================================
// 撤销消课 DTO
// ============================================

export class RevokeLessonDto {
  @ApiProperty({ description: '撤销原因' })
  @IsString()
  @IsNotEmpty({ message: '撤销原因不能为空' })
  reason: string;
}

// ============================================
// 查询 DTO
// ============================================

export class QueryLessonDto extends PaginationDto {
  @ApiPropertyOptional({ description: '合同ID' })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiPropertyOptional({ description: '学员ID' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional({ description: '教师ID' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ description: '校区ID' })
  @IsOptional()
  @IsString()
  campusId?: string;

  @ApiPropertyOptional({ description: '状态', enum: LessonStatusEnum })
  @IsOptional()
  @IsInt()
  status?: LessonStatusEnum;

  @ApiPropertyOptional({ description: '消课类型', enum: LessonTypeEnum })
  @IsOptional()
  @IsEnum(LessonTypeEnum)
  lessonType?: LessonTypeEnum;

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
// 响应 DTO
// ============================================

/**
 * 消课结果（包含金额变化）
 */
export class LessonResultDto {
  /** 消课单号 */
  lessonNo: string;

  /** 学员姓名 */
  studentName: string;

  /** 消耗课时 */
  lessonCount: number;

  /** 消课金额（本次确认收入） */
  lessonAmount: number;

  /** 消课前剩余课时 */
  beforeRemain: number;

  /** 消课后剩余课时 */
  afterRemain: number;

  /** 消课前未消课金额 */
  beforeUnearned: number;

  /** 消课后未消课金额 */
  afterUnearned: number;
}

/**
 * 批量签到结果
 */
export class BatchAttendanceResultDto {
  /** 成功消课数 */
  successCount: number;

  /** 请假数 */
  leaveCount: number;

  /** 缺勤数 */
  absentCount: number;

  /** 消课详情列表 */
  results: LessonResultDto[];

  /** 失败记录（如课时不足） */
  failures: Array<{
    contractId: string;
    reason: string;
  }>;
}

