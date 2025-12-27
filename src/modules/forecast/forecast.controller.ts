import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { CashflowForecastService } from './services/cashflow-forecast.service';
import { RevenueForecastService } from './services/revenue-forecast.service';
import { RiskAlertService } from './services/risk-alert.service';
import { RollingForecastService } from './services/rolling-forecast.service';
import {
  Rolling13WeekQueryDto,
  AdjustForecastDto,
  BatchAdjustForecastDto,
  LockForecastDto,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, RequireRoles, CurrentUser } from '../../common/decorators';

/**
 * ============================================
 * 财务预测控制器
 * ============================================
 * 
 * 核心功能：
 * 1. 13周滚动预测
 * 2. 现金流预测
 * 3. 收入预测
 * 4. 风险预警
 * 5. 人工调整预测
 * 
 * 数据来源：
 * - Payment: 现金流入预测
 * - Refund: 现金流出预测
 * - Lesson: 确认收入预测
 * - Contract: 预收款余额
 */
@ApiTags('财务预测')
@Controller('forecast')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class ForecastController {
  constructor(
    private readonly cashflowForecast: CashflowForecastService,
    private readonly revenueForecast: RevenueForecastService,
    private readonly riskAlert: RiskAlertService,
    private readonly rollingForecast: RollingForecastService,
  ) {}

  // ============================================
  // 一、13周滚动预测（核心功能）
  // ============================================

  @Get('rolling-13-week')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '13周滚动预测',
    description: `
      生成未来13周的现金流预测，包括：
      - 每周预计收款（来自 Payment 历史）
      - 每周预计退费（来自 Refund 历史）
      - 每周预计消课收入（来自 Lesson 历史）
      - 累计净现金流
      - 累计预收款余额
      
      支持人工调整预测值
    `,
  })
  @ApiResponse({
    status: 200,
    description: '返回13周滚动预测数据',
  })
  async get13WeekForecast(
    @Query() query: Rolling13WeekQueryDto,
    @CurrentUser() user: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.rollingForecast.generate13WeekForecast(query, user?.userId);
  }

  @Get('rolling-13-week/history')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '获取历史统计数据',
    description: '用于13周滚动预测的历史基准数据',
  })
  async getHistoricalStats(@Query('campusId') campusId?: string) {
    return this.rollingForecast.getHistoricalStats(campusId);
  }

  // ============================================
  // 二、人工调整预测
  // ============================================

  @Post('rolling-13-week/adjust')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('forecast:adjust')
  @ApiOperation({
    summary: '调整预测值',
    description: `
      人工调整某一周的预测值。调整后的值将优先于系统预测值使用。
      
      调整内容：
      - adjustedInflow: 调整后的预计收款
      - adjustedOutflow: 调整后的预计退费
      - adjustedRevenue: 调整后的预计消课收入
      - adjustReason: 调整原因
    `,
  })
  async adjustForecast(
    @Body() adjustDto: AdjustForecastDto,
    @CurrentUser() user: any,
  ) {
    await this.rollingForecast.adjustForecast(adjustDto, user.userId);
    return { success: true, message: '预测值调整成功' };
  }

  @Post('rolling-13-week/batch-adjust')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('forecast:adjust')
  @ApiOperation({
    summary: '批量调整预测值',
    description: '一次性调整多周的预测值',
  })
  async batchAdjustForecast(
    @Body() batchDto: BatchAdjustForecastDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.rollingForecast.batchAdjustForecast(
      batchDto.adjustments,
      user.userId,
    );
    return {
      message: `成功调整 ${result.success} 条，失败 ${result.failed} 条`,
      successCount: result.success,
      failedCount: result.failed,
    };
  }

  @Get('rolling-13-week/adjustment')
  @ApiOperation({ summary: '获取某周的调整记录' })
  async getAdjustment(
    @Query('weekKey') weekKey: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.rollingForecast.getAdjustmentHistory(weekKey, campusId);
  }

  @Post('rolling-13-week/lock')
  @RequireRoles('BOSS')
  @ApiOperation({
    summary: '锁定预测值',
    description: '锁定后不允许再调整（通常用于月度预算确认）',
  })
  async lockForecast(@Body() lockDto: LockForecastDto, @CurrentUser() user: any) {
    await this.rollingForecast.lockForecast(lockDto.weekKeys, lockDto.campusId);
    return { success: true, message: `已锁定 ${lockDto.weekKeys.length} 周的预测` };
  }

  // ============================================
  // 三、现金流预测
  // ============================================

  @Get('cashflow')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '现金流预测（未来N天）',
    description: '基于历史数据预测未来N天的现金流入和流出',
  })
  async forecastCashflow(
    @Query('days') days: number = 30,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowForecast.forecast(days, campusId);
  }

  @Get('cashflow/monthly')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '月度现金流预测',
    description: '基于历史月度数据预测未来N个月的现金流',
  })
  async forecastMonthlyCashflow(
    @Query('months') months: number = 6,
    @Query('campusId') campusId?: string,
  ) {
    return this.cashflowForecast.forecastMonthly(months, campusId);
  }

  // ============================================
  // 四、收入预测
  // ============================================

  @Get('revenue')
  @RequirePermissions('finance:view')
  @ApiOperation({
    summary: '确认收入预测',
    description: '基于剩余课时和消课速度预测未来确认收入',
  })
  async forecastRevenue(
    @Query('months') months: number = 3,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueForecast.forecastRecognition(months, campusId);
  }

  @Get('revenue/expiring')
  @ApiOperation({
    summary: '预计收入流失（即将过期合同）',
    description: '列出即将过期且仍有剩余课时的合同',
  })
  async getExpiringRevenue(
    @Query('days') days: number = 90,
    @Query('campusId') campusId?: string,
  ) {
    return this.revenueForecast.getExpiringContracts(days, campusId);
  }

  // ============================================
  // 五、风险预警【预留接口】
  // ============================================

  @Get('alerts')
  @ApiOperation({
    summary: '获取风险预警列表',
    description: '返回所有类型的风险预警',
  })
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

  // ============================================
  // 六、预警规则管理【预留接口】
  // ============================================

  @Get('alert-rules')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({
    summary: '获取预警规则列表',
    description: '【预留接口】获取所有预警规则配置',
  })
  async getAlertRules() {
    return this.rollingForecast.getAlertRules();
  }

  @Put('alert-rules/:ruleId')
  @RequireRoles('BOSS')
  @ApiOperation({
    summary: '更新预警规则',
    description: '【预留接口】更新预警规则配置',
  })
  async updateAlertRule(
    @Query('ruleId') ruleId: string,
    @Body() updates: any,
  ) {
    await this.rollingForecast.updateAlertRule(ruleId, updates);
    return { success: true, message: '预警规则更新成功' };
  }
}
