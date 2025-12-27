import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AlertRuleService } from './services/alert-rule.service';
import { AlertEventService } from './services/alert-event.service';
import { MetricCalculatorService } from './services/metric-calculator.service';
import {
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
  QueryAlertRuleDto,
  QueryAlertEventDto,
  HandleAlertEventDto,
  MetricType,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, RequireRoles, CurrentUser } from '../../common/decorators';

/**
 * ============================================
 * 现金流预警控制器
 * ============================================
 * 
 * 核心功能：
 * 1. 预警规则配置（阈值可调）
 * 2. 预警事件管理
 * 3. 指标实时计算
 * 4. 手动触发检查
 * 
 * 预置规则示例：
 * - 未来8周现金为负
 * - 退费率 > 10%
 * - 预收覆盖月数 < 3
 */
@ApiTags('现金流预警')
@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class AlertController {
  constructor(
    private readonly ruleService: AlertRuleService,
    private readonly eventService: AlertEventService,
    private readonly metricCalculator: MetricCalculatorService,
  ) {}

  // ============================================
  // 一、预警规则管理
  // ============================================

  @Post('rules')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({
    summary: '创建预警规则',
    description: `
      创建自定义预警规则，支持配置：
      - 指标类型（现金流、退费率、预收覆盖月数等）
      - 比较运算符（大于、小于等）
      - 阈值
      - 预警级别
      - 通知配置
    `,
  })
  async createRule(@Body() createDto: CreateAlertRuleDto) {
    return this.ruleService.create(createDto);
  }

  @Get('rules')
  @ApiOperation({ summary: '获取预警规则列表' })
  async getRules(@Query() query: QueryAlertRuleDto) {
    return this.ruleService.findAll(query);
  }

  @Get('rules/:id')
  @ApiOperation({ summary: '获取预警规则详情' })
  async getRule(@Param('id') id: string) {
    return this.ruleService.findOne(id);
  }

  @Put('rules/:id')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({
    summary: '更新预警规则',
    description: '修改规则的阈值、级别、通知配置等',
  })
  async updateRule(
    @Param('id') id: string,
    @Body() updateDto: UpdateAlertRuleDto,
  ) {
    return this.ruleService.update(id, updateDto);
  }

  @Delete('rules/:id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '删除预警规则' })
  async deleteRule(@Param('id') id: string) {
    await this.ruleService.delete(id);
    return { success: true, message: '规则已删除' };
  }

  @Put('rules/:id/enable')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '启用预警规则' })
  async enableRule(@Param('id') id: string) {
    return this.ruleService.setEnabled(id, true);
  }

  @Put('rules/:id/disable')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '禁用预警规则' })
  async disableRule(@Param('id') id: string) {
    return this.ruleService.setEnabled(id, false);
  }

  @Post('rules/reset')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '重置为默认规则' })
  async resetRules() {
    await this.ruleService.resetToDefault();
    return { success: true, message: '已重置为默认规则' };
  }

  @Get('rules/export')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '导出规则配置' })
  async exportRules() {
    return this.ruleService.exportRules();
  }

  // ============================================
  // 二、预警事件管理
  // ============================================

  @Post('check')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({
    summary: '手动执行预警检查',
    description: '立即执行所有启用的预警规则检查',
  })
  async runCheck(@Query('campusId') campusId?: string) {
    return this.eventService.runAllChecks(campusId);
  }

  @Get('events')
  @ApiOperation({ summary: '获取预警事件列表' })
  async getEvents(
    @Query() query: QueryAlertEventDto,
    @CurrentUser() user: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.eventService.findAll(query);
  }

  @Get('events/active')
  @ApiOperation({ summary: '获取活跃预警' })
  async getActiveEvents(
    @Query('campusId') campusId?: string,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.eventService.getActiveAlerts(campusId);
  }

  @Get('events/statistics')
  @ApiOperation({ summary: '获取预警统计' })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.eventService.getStatistics(campusId);
  }

  @Get('events/:id')
  @ApiOperation({ summary: '获取预警事件详情' })
  async getEvent(@Param('id') id: string) {
    return this.eventService.findOne(id);
  }

  @Put('events/:id/handle')
  @ApiOperation({
    summary: '处理预警事件',
    description: `
      处理动作：
      - acknowledge: 确认（处理中）
      - resolve: 解决
      - ignore: 忽略
    `,
  })
  async handleEvent(
    @Param('id') id: string,
    @Body() handleDto: HandleAlertEventDto,
    @CurrentUser() user: any,
  ) {
    return this.eventService.handleEvent(id, handleDto, user.userId);
  }

  @Post('events/batch-acknowledge')
  @ApiOperation({ summary: '批量确认预警' })
  async batchAcknowledge(
    @Body('ids') ids: string[],
    @CurrentUser() user: any,
  ) {
    const count = await this.eventService.batchAcknowledge(ids, user.userId);
    return { success: true, acknowledgedCount: count };
  }

  // ============================================
  // 三、指标查询
  // ============================================

  @Get('metrics')
  @ApiOperation({
    summary: '获取所有指标当前值',
    description: '计算并返回所有预警指标的当前值',
  })
  async getAllMetrics(@Query('campusId') campusId?: string) {
    return this.metricCalculator.calculateAll(campusId);
  }

  @Get('metrics/:metric')
  @ApiOperation({ summary: '获取单个指标值' })
  async getMetric(
    @Param('metric') metric: MetricType,
    @Query('campusId') campusId?: string,
    @Query('periodDays') periodDays?: number,
    @Query('forecastWeeks') forecastWeeks?: number,
  ) {
    return this.metricCalculator.calculate(metric, campusId, {
      periodDays,
      forecastWeeks,
    });
  }

  // ============================================
  // 四、仪表盘数据
  // ============================================

  @Get('dashboard')
  @ApiOperation({
    summary: '预警仪表盘',
    description: '返回预警概览数据，包括活跃预警、统计、最新事件等',
  })
  async getDashboard(
    @Query('campusId') campusId?: string,
    @CurrentUser() user?: any,
  ) {
    if (user?.roles?.includes('CAMPUS_MANAGER') && !user?.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }

    const [activeAlerts, statistics, rules] = await Promise.all([
      this.eventService.getActiveAlerts(campusId),
      this.eventService.getStatistics(campusId),
      this.ruleService.findAll({ enabled: true, campusId }),
    ]);

    return {
      activeAlerts: activeAlerts.slice(0, 10), // 最新10条活跃预警
      statistics,
      enabledRulesCount: rules.length,
      lastCheckTime: new Date(), // 实际应从缓存或数据库读取
    };
  }
}

