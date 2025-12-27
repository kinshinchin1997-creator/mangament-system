import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { CashflowService } from './cashflow.service';
import { DailySettlementService } from './services/daily-settlement.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import {
  QueryCashflowDto,
  DailySettlementDto,
  CashflowSummaryDto,
  RollingTableQueryDto,
  PeriodSummaryQueryDto,
  TimePeriod,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, RequireRoles, CurrentUser } from '../../common/decorators';

/**
 * 现金流管理控制器
 * 
 * ============================================
 * 数据来源说明：
 * ============================================
 * 
 * ┌─────────────────┬────────────────────────────────────┐
 * │ 接口             │ 数据来源                            │
 * ├─────────────────┼────────────────────────────────────┤
 * │ 经营现金流       │ Payment + Refund + Lesson          │
 * │ 滚动表          │ Payment + Refund + Lesson          │
 * │ 周度/月度汇总    │ Payment + Refund + Lesson          │
 * │ 现金流记录       │ Payment (流入) / Refund (流出)      │
 * │ 预收款余额       │ Contract.unearned                  │
 * │ 确认收入        │ Lesson.lessonAmount                │
 * └─────────────────┴────────────────────────────────────┘
 */
@ApiTags('现金流管理（核心财务）')
@Controller('cashflow')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class CashflowController {
  constructor(
    private readonly cashflowService: CashflowService,
    private readonly dailySettlement: DailySettlementService,
    private readonly revenueRecognition: RevenueRecognitionService,
  ) {}

  // ============================================
  // 一、经营现金流计算
  // ============================================

  @Get('operating')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '经营现金流计算',
    description: `
      计算指定期间的经营现金流
      
      数据来源：
      - 现金流入：Payment 表（新招、续费、分期）
      - 现金流出：Refund 表（正常退费、转校退、终止退）
      - 收入确认：Lesson 表（消课金额）
      
      返回：
      - 现金流入明细（按类型分组）
      - 现金流出明细（按类型分组）
      - 净经营现金流
      - 非现金变动（确认收入）
    `,
  })
  @ApiResponse({
    status: 200,
    description: '返回经营现金流计算结果',
  })
  async getOperatingCashflow(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
    @CurrentUser() user?: any,
  ) {
    // 校区管理员只能查看本校区数据
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.cashflowService.calculateOperatingCashflow(startDate, endDate, campusId);
  }

  // ============================================
  // 二、预收-消课-退费滚动表
  // ============================================

  @Get('rolling-table')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '预收-消课-退费滚动表',
    description: `
      生成预收款余额滚动表，展示每个时间周期的：
      - 期初余额
      - 本期收款（来自 Payment）
      - 本期消课（来自 Lesson）
      - 本期退费（来自 Refund）
      - 期末余额
      
      支持按日/周/月粒度查看
    `,
  })
  async getRollingTable(
    @Query() query: RollingTableQueryDto,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.generateRollingTable(query);
  }

  // ============================================
  // 三、周度/月度现金流汇总
  // ============================================

  @Get('weekly-summary')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '周度现金流汇总',
    description: `
      按自然周分组统计：
      - 本周收款（来自 Payment）
      - 本周退费（来自 Refund）
      - 本周净现金流
      - 本周确认收入（来自 Lesson）
      - 本周预收余额变动
    `,
  })
  async getWeeklySummary(
    @Query() query: PeriodSummaryQueryDto,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.getWeeklySummary(query);
  }

  @Get('monthly-summary')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '月度现金流汇总',
    description: `
      按自然月分组统计：
      - 本月收款（来自 Payment）
      - 本月退费（来自 Refund）
      - 本月净现金流
      - 本月确认收入（来自 Lesson）
      - 本月预收余额变动
    `,
  })
  async getMonthlySummary(
    @Query() query: PeriodSummaryQueryDto,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.getMonthlySummary(query);
  }

  // ============================================
  // 四、现金流记录查询
  // ============================================

  @Get()
  @ApiOperation({
    summary: '获取现金流记录列表',
    description: '支持按流向类型（inflow/outflow）筛选',
  })
  async findAll(@Query() query: QueryCashflowDto, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({
    summary: '现金流汇总（流入/流出/净现金流）',
  })
  async getSummary(@Query() query: CashflowSummaryDto, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.getSummary(query);
  }

  @Get('trend')
  @ApiOperation({
    summary: '现金流趋势（按日/周/月）',
    description: '获取指定天数内的现金流趋势数据',
  })
  async getTrend(
    @Query('period') period: 'day' | 'week' | 'month' = 'day',
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowService.getCashflowTrend(period, days, campusId);
  }

  // ============================================
  // 五、预收款 & 确认收入
  // ============================================

  @Get('prepaid-balance')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '预收款余额（负债）',
    description: '【数据来源】: Contract.unearned',
  })
  async getPrepaidBalance(@Query('campusId') campusId?: string) {
    return this.revenueRecognition.getPrepaidBalance(campusId);
  }

  @Get('recognized-revenue')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '已确认收入（消课转化）',
    description: '【数据来源】: Lesson.lessonAmount',
  })
  async getRecognizedRevenue(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueRecognition.getRecognizedRevenue(startDate, endDate, campusId);
  }

  // ============================================
  // 六、日结
  // ============================================

  @Post('daily-settle')
  @RequirePermissions('finance:settle')
  @ApiOperation({
    summary: '执行日结',
    description: `
      日结会汇总当日：
      - 收款（来自 Payment）
      - 退费（来自 Refund）
      - 消课（来自 Lesson）
    `,
  })
  async doDailySettlement(@Body() dto: DailySettlementDto, @CurrentUser() user: any) {
    return this.dailySettlement.settle(dto.settleDate, dto.campusId, user.userId);
  }

  @Get('daily-reports')
  @ApiOperation({ summary: '获取日结报表列表' })
  async getDailyReports(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.dailySettlement.getReports(startDate, endDate, campusId);
  }

  // ============================================
  // 七、分类统计
  // ============================================

  @Get('by-type')
  @ApiOperation({
    summary: '按业务类型统计',
    description: '按收款类型、支付方式分组统计',
  })
  async getByBizType(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowService.groupByBizType(startDate, endDate, campusId);
  }

  @Get('by-campus')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({
    summary: '按校区统计（仅老板/财务可见）',
  })
  async getByCampus(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.cashflowService.groupByCampus(startDate, endDate);
  }
}
