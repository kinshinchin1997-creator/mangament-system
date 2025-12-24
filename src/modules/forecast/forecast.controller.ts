import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CashflowForecastService } from './services/cashflow-forecast.service';
import { RevenueForecastService } from './services/revenue-forecast.service';
import { RiskAlertService } from './services/risk-alert.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('财务预测')
@Controller('forecast')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class ForecastController {
  constructor(
    private readonly cashflowForecast: CashflowForecastService,
    private readonly revenueForecast: RevenueForecastService,
    private readonly riskAlert: RiskAlertService,
  ) {}

  // ==================== 现金流预测 ====================

  @Get('cashflow')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '现金流预测（未来N天）' })
  async forecastCashflow(
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowForecast.forecast(days, campusId);
  }

  @Get('cashflow/monthly')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '月度现金流预测' })
  async forecastMonthlyCashflow(
    @Query('months') months: number = 6,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowForecast.forecastMonthly(months, campusId);
  }

  // ==================== 收入预测 ====================

  @Get('revenue')
  @RequirePermissions('finance:view')
  @ApiOperation({ summary: '确认收入预测（基于剩余课时消耗预估）' })
  async forecastRevenue(
    @Query('months') months: number = 3,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueForecast.forecastRecognition(months, campusId);
  }

  @Get('revenue/expiring')
  @ApiOperation({ summary: '预计收入流失（即将过期合同）' })
  async getExpiringRevenue(
    @Query('days') days: number = 90,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueForecast.getExpiringContracts(days, campusId);
  }

  // ==================== 风险预警 ====================

  @Get('alerts')
  @ApiOperation({ summary: '获取风险预警列表' })
  async getAlerts(@Query('campusId') campusId?: string, @CurrentUser() user?: any) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.riskAlert.getAlerts(campusId);
  }

  @Get('alerts/expiring-contracts')
  @ApiOperation({ summary: '合同到期预警' })
  async getExpiringContractAlerts(
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.riskAlert.getExpiringContractAlerts(days, campusId);
  }

  @Get('alerts/low-balance')
  @ApiOperation({ summary: '课时余额不足预警' })
  async getLowBalanceAlerts(
    @Query('threshold') threshold: number = 5,
    @Query('campusId') campusId?: string,
  ) {
    return this.riskAlert.getLowBalanceAlerts(threshold, campusId);
  }

  @Get('alerts/inactive-students')
  @ApiOperation({ summary: '休眠学员预警' })
  async getInactiveStudentAlerts(
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.riskAlert.getInactiveStudentAlerts(days, campusId);
  }
}

