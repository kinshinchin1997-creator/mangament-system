import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { LessonService } from './lesson.service';
import {
  CreateLessonDto,
  QueryLessonDto,
  RevokeLessonDto,
  BatchAttendanceDto,
  LessonStatusEnum,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

/**
 * ============================================
 * 消课管理控制器
 * ============================================
 * 
 * 提供消课相关的所有 API 接口：
 * - 上课签到 → 消课
 * - 批量签到消课
 * - 消课撤销
 * - 消课统计
 * 
 * 业务流程：
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    上课 → 签到 → 消课 流程                    │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │   ┌─────────┐     ┌─────────┐     ┌─────────┐              │
 * │   │  排课   │ ──> │  上课   │ ──> │  签到   │              │
 * │   └─────────┘     └─────────┘     └────┬────┘              │
 * │                                        │                    │
 * │                    ┌───────────────────┼───────────────┐   │
 * │                    │                   │               │   │
 * │                    v                   v               v   │
 * │              ┌─────────┐        ┌─────────┐     ┌─────────┐│
 * │              │正常签到 │        │  请假   │     │  缺勤   ││
 * │              │(ATTENDED)│       │ (LEAVE) │     │(ABSENT) ││
 * │              └────┬────┘        └────┬────┘     └────┬────┘│
 * │                   │                  │               │     │
 * │                   v                  v               v     │
 * │              ┌─────────┐        ┌─────────┐    ┌─────────┐ │
 * │              │  消课   │        │不扣课时 │    │根据策略 │ │
 * │              │扣课时   │        │安排补课 │    │决定处理 │ │
 * │              │确认收入 │        └─────────┘    └─────────┘ │
 * │              └─────────┘                                   │
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 */
@ApiTags('消课管理')
@Controller('lessons')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  // ============================================
  // 一、消课操作
  // ============================================

  /**
   * 创建消课记录（单个学员）
   */
  @Post()
  @RequirePermissions('lesson:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '创建消课记录',
    description: `
### 消课业务说明

每次消课会自动：
1. 扣减合同剩余课时
2. 减少未消课金额（预收款余额）
3. 增加已确认收入

### 金额计算规则
- 消课金额 = 消耗课时数 × 课单价
- 新未消课金额 = (剩余课时 - 消耗课时) × 课单价

**【重要】金额只能通过消课操作变化，不接受外部传入！**
    `,
  })
  @ApiResponse({ status: 201, description: '消课成功' })
  @ApiResponse({ status: 400, description: '课时不足/合同状态异常' })
  @ApiResponse({ status: 404, description: '合同/教师不存在' })
  async create(
    @Body() createDto: CreateLessonDto,
    @CurrentUser() user: any,
  ) {
    return this.lessonService.create(createDto, user);
  }

  /**
   * 批量签到消课
   * 
   * 适用场景：教师上完一节课，为所有学员批量签到
   */
  @Post('batch-attendance')
  @RequirePermissions('lesson:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '批量签到消课',
    description: `
### 批量签到场景

教师上完一节课后，为所有学员批量签到：

| 签到状态 | 说明 | 是否扣课时 |
|---------|------|-----------|
| ATTENDED | 正常签到 | ✅ 扣课时 |
| LEAVE | 请假 | ❌ 不扣课时 |
| ABSENT | 缺勤 | ⚠️ 根据策略 |
| MAKEUP | 补课 | ✅ 扣课时 |

### 请假处理
- 请假不扣课时
- 可后续安排补课

### 缺勤处理（默认仁慈模式）
- 缺勤不自动扣课时
- 管理员可手动处理
    `,
  })
  async batchAttendance(
    @Body() dto: BatchAttendanceDto,
    @CurrentUser() user: any,
  ) {
    return this.lessonService.batchAttendance(dto, user);
  }

  /**
   * 撤销消课
   * 
   * 撤销后自动恢复：课时 + 未消课金额
   */
  @Put(':id/revoke')
  @RequirePermissions('lesson:revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '撤销消课',
    description: `
### 撤销消课说明

撤销消课会自动：
1. 恢复合同剩余课时
2. 恢复未消课金额
3. 如合同已完结，恢复为正常状态

**必须提供撤销原因！**
    `,
  })
  @ApiParam({ name: 'id', description: '消课记录ID' })
  @ApiResponse({ status: 200, description: '撤销成功' })
  @ApiResponse({ status: 400, description: '已撤销，无法重复操作' })
  async revoke(
    @Param('id') id: string,
    @Body() dto: RevokeLessonDto,
    @CurrentUser() user: any,
  ) {
    return this.lessonService.revoke(id, dto, user);
  }

  // ============================================
  // 二、消课查询
  // ============================================

  /**
   * 获取消课记录列表
   */
  @Get()
  @ApiOperation({ summary: '获取消课记录列表' })
  @ApiQuery({ name: 'status', enum: LessonStatusEnum, required: false, description: '状态：1-正常 2-已撤销' })
  async findAll(
    @Query() query: QueryLessonDto,
    @CurrentUser() user: any,
  ) {
    // 校区负责人只能查看本校区
    if (user.roles?.includes('CAMPUS_MANAGER') && !user.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.lessonService.findAll(query);
  }

  /**
   * 获取消课详情
   */
  @Get(':id')
  @ApiOperation({ summary: '获取消课详情' })
  @ApiParam({ name: 'id', description: '消课记录ID' })
  async findOne(@Param('id') id: string) {
    return this.lessonService.findOne(id);
  }

  /**
   * 获取合同的消课历史
   */
  @Get('contract/:contractId')
  @ApiOperation({
    summary: '获取合同消课历史',
    description: '查看某个合同的所有消课记录和课时消耗情况',
  })
  @ApiParam({ name: 'contractId', description: '合同ID' })
  async getContractLessons(@Param('contractId') contractId: string) {
    return this.lessonService.getContractLessons(contractId);
  }

  // ============================================
  // 三、消课统计
  // ============================================

  /**
   * 消课统计
   */
  @Get('stats/summary')
  @ApiOperation({ summary: '消课统计' })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.lessonService.getStatistics({
      campusId,
      teacherId,
      startDate,
      endDate,
    });
  }

  /**
   * 今日消课汇总
   */
  @Get('stats/today')
  @ApiOperation({ summary: '今日消课汇总' })
  async getTodayStatistics(
    @Query('campusId') campusId?: string,
    @CurrentUser() user: any = {},
  ) {
    // 校区负责人只能查看本校区
    if (user.roles?.includes('CAMPUS_MANAGER') && !user.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.lessonService.getTodayStatistics(campusId);
  }
}
