import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CashflowService } from './cashflow.service';
import { DailySettlementService } from './services/daily-settlement.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import { QueryCashflowDto, DailySettlementDto, CashflowSummaryDto } from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

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

  // ==================== 现金流记录 ====================

  @Get()
  @ApiOperation({ summary: '获取现金流记录列表' })
  async findAll(@Query() query: QueryCashflowDto, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({ summary: '现金流汇总（流入/流出/净现金流）' })
  async getSummary(@Query() query: CashflowSummaryDto, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashflowService.getSummary(query);
  }

  @Get('trend')
  @ApiOperation({ summary: '现金流趋势（按日/周/月）' })
  async getTrend(
    @Query('period') period: 'day' | 'week' | 'month' = 'day',
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowService.getCashflowTrend(period, days, campusId);
  }

  // ==================== 预收款 & 确认收入 ====================

  @Get('prepaid-balance')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '预收款余额（负债）' })
  async getPrepaidBalance(@Query('campusId') campusId?: string) {
    return this.revenueRecognition.getPrepaidBalance(campusId);
  }

  @Get('recognized-revenue')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '已确认收入（消课转化）' })
  async getRecognizedRevenue(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueRecognition.getRecognizedRevenue(startDate, endDate, campusId);
  }

  // ==================== 日结 ====================

  @Post('daily-settle')
  @RequirePermissions('finance:settle')
  @ApiOperation({ summary: '执行日结' })
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

  // ==================== 分类统计 ====================

  @Get('by-type')
  @ApiOperation({ summary: '按业务类型统计' })
  async getByBizType(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowService.groupByBizType(startDate, endDate, campusId);
  }

  @Get('by-campus')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '按校区统计（仅老板可见）' })
  async getByCampus(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.cashflowService.groupByCampus(startDate, endDate);
  }
}

