import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { BossMetricsService } from './services/boss-metrics.service';
import { CampusMetricsService } from './services/campus-metrics.service';
import { FinanceMetricsService } from './services/finance-metrics.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequireRoles, RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('仪表盘')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly bossMetrics: BossMetricsService,
    private readonly campusMetrics: CampusMetricsService,
    private readonly financeMetrics: FinanceMetricsService,
  ) {}

  // ==================== 通用概览 ====================

  @Get('overview')
  @ApiOperation({ summary: '获取概览数据（根据角色返回不同数据）' })
  async getOverview(@CurrentUser() user: any) {
    return this.dashboardService.getOverview(user);
  }

  // ==================== 老板看板 ====================

  @Get('boss/summary')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '老板看板：全局汇总' })
  async getBossSummary() {
    return this.bossMetrics.getSummary();
  }

  @Get('boss/campus-comparison')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '老板看板：校区对比' })
  async getCampusComparison(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.bossMetrics.getCampusComparison(startDate, endDate);
  }

  @Get('boss/trend')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '老板看板：业绩趋势' })
  async getBossTrend(@Query('period') period: 'week' | 'month' | 'quarter' = 'month') {
    return this.bossMetrics.getTrend(period);
  }

  @Get('boss/kpi')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '老板看板：核心KPI' })
  async getBossKPI() {
    return this.bossMetrics.getKPI();
  }

  // ==================== 财务看板 ====================

  @Get('finance/today')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '财务看板：今日收支' })
  async getFinanceToday(@Query('campusId') campusId?: string) {
    return this.financeMetrics.getTodayMetrics(campusId);
  }

  @Get('finance/cashflow')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '财务看板：现金流概览' })
  async getFinanceCashflow(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.financeMetrics.getCashflowMetrics(startDate, endDate, campusId);
  }

  @Get('finance/prepaid')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '财务看板：预收款负债' })
  async getFinancePrepaid(@Query('campusId') campusId?: string) {
    return this.financeMetrics.getPrepaidMetrics(campusId);
  }

  @Get('finance/settlement-status')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '财务看板：日结状态' })
  async getSettlementStatus(@Query('campusId') campusId?: string) {
    return this.financeMetrics.getSettlementStatus(campusId);
  }

  // ==================== 校区看板 ====================

  @Get('campus/summary')
  @ApiOperation({ summary: '校区看板：校区汇总' })
  async getCampusSummary(@Query('campusId') campusId: string, @CurrentUser() user: any) {
    // 校区负责人只能看自己的校区
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.campusMetrics.getSummary(campusId);
  }

  @Get('campus/students')
  @ApiOperation({ summary: '校区看板：学员概况' })
  async getCampusStudents(@Query('campusId') campusId: string, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.campusMetrics.getStudentMetrics(campusId);
  }

  @Get('campus/teachers')
  @ApiOperation({ summary: '校区看板：教师绩效' })
  async getCampusTeachers(@Query('campusId') campusId: string, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.campusMetrics.getTeacherMetrics(campusId);
  }

  @Get('campus/contracts')
  @ApiOperation({ summary: '校区看板：合同概况' })
  async getCampusContracts(@Query('campusId') campusId: string, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.campusMetrics.getContractMetrics(campusId);
  }
}

