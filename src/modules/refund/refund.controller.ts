import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { RefundService } from './refund.service';
import {
  CreateRefundDto,
  ApproveRefundDto,
  CompleteRefundDto,
  QueryRefundDto,
  RefundPreviewDto,
  RefundStatisticsDto,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequireRoles, RequirePermissions, CurrentUser } from '../../common/decorators';

/**
 * 退费管理控制器
 * 
 * 审批流程：
 * 1. 前台申请退费 -> 创建退费申请（状态：待审批）
 * 2. 财务/老板审批 -> 更新状态（通过/驳回）
 * 3. 财务打款确认 -> 更新状态（已完成）
 * 
 * 权限要求：
 * - 创建退费：refund:create
 * - 审批退费：refund:approve（需要 BOSS 或 FINANCE 角色）
 * - 确认打款：refund:complete（需要 BOSS 或 FINANCE 角色）
 */
@ApiTags('退费管理')
@Controller('refunds')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  // ============================================
  // 退费预览
  // ============================================

  @Post('preview')
  @ApiOperation({ summary: '退费预览（计算可退金额）' })
  @ApiResponse({
    status: 200,
    description: '返回可退金额、风控检查结果等信息',
  })
  async preview(@Body() previewDto: RefundPreviewDto) {
    return this.refundService.preview(previewDto);
  }

  // ============================================
  // 创建退费申请
  // ============================================

  @Post()
  @RequirePermissions('refund:create')
  @ApiOperation({ summary: '创建退费申请' })
  @ApiResponse({
    status: 201,
    description: '创建成功，进入审批流程',
  })
  async create(@Body() createDto: CreateRefundDto, @CurrentUser() user: any) {
    return this.refundService.create(createDto, user);
  }

  // ============================================
  // 查询退费列表
  // ============================================

  @Get()
  @ApiOperation({ summary: '获取退费申请列表' })
  async findAll(@Query() query: QueryRefundDto, @CurrentUser() user: any) {
    // 校区管理员只能查看本校区数据
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.refundService.findAll(query);
  }

  @Get('pending')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '获取待审批的退费申请' })
  async findPending() {
    return this.refundService.findPending();
  }

  // ============================================
  // 统计与报表
  // ============================================

  @Get('stats/summary')
  @ApiOperation({ summary: '退费统计汇总' })
  async getStatistics(
    @Query() query: RefundStatisticsDto,
    @CurrentUser() user: any,
  ) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.refundService.getStatistics(
      query.campusId,
      query.startDate,
      query.endDate,
    );
  }

  @Get('stats/rate-report')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '退费率报表（各校区退费率对比）' })
  async getRefundRateReport(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.refundService.getRefundRateReport(startDate, endDate);
  }

  // ============================================
  // 退费详情
  // ============================================

  @Get(':id')
  @ApiOperation({ summary: '获取退费申请详情' })
  async findOne(@Param('id') id: string) {
    return this.refundService.findOne(id);
  }

  // ============================================
  // 审批操作
  // ============================================

  @Put(':id/approve')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('refund:approve')
  @ApiOperation({ summary: '审批退费申请（通过/驳回）' })
  @ApiResponse({
    status: 200,
    description: '审批成功',
  })
  async approve(
    @Param('id') id: string,
    @Body() approveDto: ApproveRefundDto,
    @CurrentUser() user: any,
  ) {
    return this.refundService.approve(id, approveDto, user);
  }

  @Put(':id/complete')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('refund:complete')
  @ApiOperation({ summary: '完成退费（确认打款）' })
  @ApiResponse({
    status: 200,
    description: '打款确认成功，退费流程完结',
  })
  async complete(
    @Param('id') id: string,
    @Body() completeDto: CompleteRefundDto,
    @CurrentUser() user: any,
  ) {
    return this.refundService.complete(id, completeDto, user);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: '取消退费申请（仅待审批状态可取消）' })
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.refundService.cancel(id, user);
  }
}
