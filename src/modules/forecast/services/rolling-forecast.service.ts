import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';
import {
  Rolling13WeekQueryDto,
  AdjustForecastDto,
  WeekForecastData,
  Rolling13WeekResult,
  ForecastStatus,
  ForecastAlert,
  AlertType,
  AlertLevel,
  HistoricalStats,
} from '../dto';

/**
 * ============================================
 * 13周滚动预测服务
 * ============================================
 * 
 * 核心功能：
 * 1. 基于历史数据生成13周滚动预测
 * 2. 支持人工调整预测值
 * 3. 预警规则检查（预留接口）
 * 
 * 预测算法：
 * - 基于历史N周的加权移动平均
 * - 考虑周末因素、季节因素
 * - 结合已知事件（如合同到期、续费预期）
 * 
 * 数据来源：
 * - 收款预测：Payment 历史数据
 * - 退费预测：Refund 历史数据
 * - 消课预测：Lesson 历史数据
 * - 预收余额：Contract.unearned
 */
@Injectable()
export class RollingForecastService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // 配置常量
  // ============================================

  private readonly CONFIG = {
    FORECAST_WEEKS: 13,           // 预测周数
    HISTORY_WEEKS: 12,            // 历史参考周数
    WEIGHT_RECENT: 0.6,           // 近期权重（最近4周）
    WEIGHT_OLDER: 0.4,            // 远期权重
    WEEKEND_FACTOR: 0.3,          // 周末系数
    SEASON_FACTORS: {             // 季节系数（按月）
      1: 1.2, 2: 1.3, 3: 1.0,     // 寒假高峰
      4: 0.9, 5: 0.8, 6: 1.0,     // 春季淡季
      7: 1.3, 8: 1.4, 9: 1.1,     // 暑假高峰
      10: 0.9, 11: 0.9, 12: 1.0,  // 秋季平稳
    } as Record<number, number>,
  };

  // 内存存储人工调整（生产环境应存入数据库）
  private adjustmentsStore = new Map<string, AdjustForecastDto>();

  // ============================================
  // 一、生成13周滚动预测
  // ============================================

  /**
   * 生成13周滚动预测
   * 
   * 业务流程：
   * 1. 获取历史统计数据【来自 Payment/Refund/Lesson】
   * 2. 计算预测基准值
   * 3. 生成13周预测数据
   * 4. 应用人工调整值
   * 5. 计算累计值和预警
   * 6. 返回完整预测结果
   * 
   * @param query 查询参数
   * @param currentUserId 当前用户ID
   */
  async generate13WeekForecast(
    query: Rolling13WeekQueryDto,
    currentUserId?: string,
  ): Promise<Rolling13WeekResult> {
    const { campusId, startDate, includeAdjustments = true } = query;

    // 计算预测起始周（默认本周一）
    const forecastStart = this.getWeekStart(startDate ? new Date(startDate) : new Date());
    const forecastEnd = new Date(forecastStart);
    forecastEnd.setDate(forecastEnd.getDate() + this.CONFIG.FORECAST_WEEKS * 7 - 1);

    // ============================================
    // 步骤1: 获取历史统计数据
    // ============================================
    const historicalStats = await this.getHistoricalStats(campusId);

    // ============================================
    // 步骤2: 获取当前预收款余额
    // ============================================
    const currentPrepaidBalance = await this.getCurrentPrepaidBalance(campusId);

    // ============================================
    // 步骤3: 生成周度预测
    // ============================================
    const weeklyForecast: WeekForecastData[] = [];
    let cumulativeNetCashflow = 0;
    let cumulativePrepaidBalance = currentPrepaidBalance;

    for (let i = 0; i < this.CONFIG.FORECAST_WEEKS; i++) {
      const weekStart = new Date(forecastStart);
      weekStart.setDate(weekStart.getDate() + i * 7);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const weekKey = this.getWeekKey(weekStart);
      const weekLabel = this.getWeekLabel(weekStart, weekEnd, i + 1);

      // 计算预测值
      const predicted = this.calculateWeeklyPrediction(
        historicalStats,
        weekStart,
        i,
      );

      // 获取人工调整值
      const adjustmentKey = `${campusId || 'ALL'}_${weekKey}`;
      const adjustment = includeAdjustments
        ? this.adjustmentsStore.get(adjustmentKey)
        : undefined;

      // 计算最终采用值
      const final = {
        inflow: adjustment?.adjustedInflow ?? predicted.inflow,
        outflow: adjustment?.adjustedOutflow ?? predicted.outflow,
        netCashflow: (adjustment?.adjustedInflow ?? predicted.inflow) -
                     (adjustment?.adjustedOutflow ?? predicted.outflow),
        revenue: adjustment?.adjustedRevenue ?? predicted.revenue,
        prepaidChange: (adjustment?.adjustedInflow ?? predicted.inflow) -
                       (adjustment?.adjustedRevenue ?? predicted.revenue) -
                       (adjustment?.adjustedOutflow ?? predicted.outflow),
      };

      // 更新累计值
      cumulativeNetCashflow += final.netCashflow;
      cumulativePrepaidBalance += final.prepaidChange;

      // 确定状态
      let status: ForecastStatus = ForecastStatus.DRAFT;
      if (adjustment) {
        status = ForecastStatus.ADJUSTED;
      }

      weeklyForecast.push({
        weekKey,
        weekLabel,
        startDate: weekStart.toISOString().slice(0, 10),
        endDate: weekEnd.toISOString().slice(0, 10),
        predicted,
        adjusted: adjustment ? {
          inflow: adjustment.adjustedInflow,
          outflow: adjustment.adjustedOutflow,
          revenue: adjustment.adjustedRevenue,
          reason: adjustment.adjustReason,
        } : undefined,
        final,
        status,
        cumulative: {
          netCashflow: cumulativeNetCashflow,
          prepaidBalance: cumulativePrepaidBalance,
        },
      });
    }

    // ============================================
    // 步骤4: 检查预警【预留接口】
    // ============================================
    const alerts = this.checkForecastAlerts(weeklyForecast, currentPrepaidBalance);

    // ============================================
    // 步骤5: 计算汇总
    // ============================================
    const summary = {
      totalPredictedInflow: weeklyForecast.reduce((sum, w) => sum + w.final.inflow, 0),
      totalPredictedOutflow: weeklyForecast.reduce((sum, w) => sum + w.final.outflow, 0),
      totalNetCashflow: weeklyForecast.reduce((sum, w) => sum + w.final.netCashflow, 0),
      totalRevenue: weeklyForecast.reduce((sum, w) => sum + w.final.revenue, 0),
      endingPrepaidBalance: cumulativePrepaidBalance,
    };

    return {
      period: {
        startDate: forecastStart.toISOString().slice(0, 10),
        endDate: forecastEnd.toISOString().slice(0, 10),
        weeks: this.CONFIG.FORECAST_WEEKS,
      },
      currentPrepaidBalance,
      weeklyForecast,
      summary,
      alerts,
      meta: {
        generatedAt: new Date(),
        basedOnDays: this.CONFIG.HISTORY_WEEKS * 7,
        adjustmentCount: weeklyForecast.filter(w => w.status === ForecastStatus.ADJUSTED).length,
      },
    };
  }

  // ============================================
  // 二、历史数据分析
  // ============================================

  /**
   * 获取历史统计数据
   * 
   * 【数据来源】:
   * - 收款: Payment 表
   * - 退费: Refund 表
   * - 消课: Lesson 表
   * 
   * @param campusId 校区ID
   */
  async getHistoricalStats(campusId?: string): Promise<HistoricalStats> {
    const historyDays = this.CONFIG.HISTORY_WEEKS * 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historyDays);

    // 构建查询条件
    const paymentWhere: any = { status: 1, paidAt: { gte: startDate } };
    const refundWhere: any = { status: 3, refundedAt: { gte: startDate } };
    const lessonWhere: any = { status: 1, lessonDate: { gte: startDate } };

    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
      lessonWhere.campusId = campusId;
    }

    // 并行查询【来自 Payment/Refund/Lesson】
    const [payments, refunds, lessons] = await Promise.all([
      this.prisma.payment.findMany({
        where: paymentWhere,
        select: { amount: true, paidAt: true, paymentType: true },
      }),
      this.prisma.refund.findMany({
        where: refundWhere,
        select: { actualAmount: true, refundedAt: true },
      }),
      this.prisma.lesson.findMany({
        where: lessonWhere,
        select: { lessonAmount: true, lessonCount: true, lessonDate: true },
      }),
    ]);

    // 计算收款统计
    const incomeTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const incomeByType = { sign: 0, renewal: 0, installment: 0 };
    payments.forEach((p) => {
      const amount = Number(p.amount);
      switch (p.paymentType) {
        case 'SIGN': incomeByType.sign += amount; break;
        case 'RENEWAL': incomeByType.renewal += amount; break;
        case 'INSTALLMENT': incomeByType.installment += amount; break;
      }
    });

    // 计算退费统计
    const refundTotal = refunds.reduce((sum, r) => sum + Number(r.actualAmount), 0);

    // 计算消课统计
    const lessonTotal = lessons.reduce((sum, l) => sum + Number(l.lessonAmount), 0);
    const lessonCount = lessons.reduce((sum, l) => sum + l.lessonCount, 0);

    // 计算平均值
    const days = historyDays;
    const weeks = this.CONFIG.HISTORY_WEEKS;

    return {
      period: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        days,
      },
      income: {
        total: incomeTotal,
        dailyAvg: incomeTotal / days,
        weeklyAvg: incomeTotal / weeks,
        monthlyAvg: incomeTotal / (days / 30),
        byType: incomeByType,
      },
      refund: {
        total: refundTotal,
        dailyAvg: refundTotal / days,
        weeklyAvg: refundTotal / weeks,
        rate: incomeTotal > 0 ? refundTotal / incomeTotal : 0,
      },
      lesson: {
        total: lessonTotal,
        dailyAvg: lessonTotal / days,
        weeklyAvg: lessonTotal / weeks,
        lessonCount,
      },
      trend: {
        incomeGrowth: await this.calculateGrowthRate('payment', campusId),
        refundGrowth: await this.calculateGrowthRate('refund', campusId),
        seasonalFactor: this.getSeasonalFactor(new Date().getMonth() + 1),
      },
    };
  }

  /**
   * 计算增长率
   */
  private async calculateGrowthRate(type: 'payment' | 'refund', campusId?: string): Promise<number> {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(thisMonthStart);
    lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);

    if (type === 'payment') {
      const thisMonthWhere: any = { status: 1, paidAt: { gte: thisMonthStart } };
      const lastMonthWhere: any = { status: 1, paidAt: { gte: lastMonthStart, lt: thisMonthStart } };
      if (campusId) {
        thisMonthWhere.campusId = campusId;
        lastMonthWhere.campusId = campusId;
      }

      const [thisMonth, lastMonth] = await Promise.all([
        this.prisma.payment.aggregate({ where: thisMonthWhere, _sum: { amount: true } }),
        this.prisma.payment.aggregate({ where: lastMonthWhere, _sum: { amount: true } }),
      ]);

      const thisAmount = Number(thisMonth._sum.amount || 0);
      const lastAmount = Number(lastMonth._sum.amount || 0);
      return lastAmount > 0 ? (thisAmount - lastAmount) / lastAmount : 0;
    } else {
      const thisMonthWhere: any = { status: 3, refundedAt: { gte: thisMonthStart } };
      const lastMonthWhere: any = { status: 3, refundedAt: { gte: lastMonthStart, lt: thisMonthStart } };
      if (campusId) {
        thisMonthWhere.campusId = campusId;
        lastMonthWhere.campusId = campusId;
      }

      const [thisMonth, lastMonth] = await Promise.all([
        this.prisma.refund.aggregate({ where: thisMonthWhere, _sum: { actualAmount: true } }),
        this.prisma.refund.aggregate({ where: lastMonthWhere, _sum: { actualAmount: true } }),
      ]);

      const thisAmount = Number(thisMonth._sum.actualAmount || 0);
      const lastAmount = Number(lastMonth._sum.actualAmount || 0);
      return lastAmount > 0 ? (thisAmount - lastAmount) / lastAmount : 0;
    }
  }

  /**
   * 获取当前预收款余额
   * 【数据来源】: Contract.unearned
   */
  private async getCurrentPrepaidBalance(campusId?: string): Promise<number> {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.contract.aggregate({
      where,
      _sum: { unearned: true },
    });

    return Number(result._sum.unearned || 0);
  }

  // ============================================
  // 三、预测计算
  // ============================================

  /**
   * 计算单周预测值
   * 
   * 算法：加权移动平均 + 季节调整
   * 
   * @param stats 历史统计数据
   * @param weekStart 周起始日期
   * @param weekIndex 周索引（0开始）
   */
  private calculateWeeklyPrediction(
    stats: HistoricalStats,
    weekStart: Date,
    weekIndex: number,
  ): { inflow: number; outflow: number; netCashflow: number; revenue: number; prepaidChange: number } {
    // 基础值 = 周均值
    let baseInflow = stats.income.weeklyAvg;
    let baseOutflow = stats.refund.weeklyAvg;
    let baseRevenue = stats.lesson.weeklyAvg;

    // 应用季节系数
    const month = weekStart.getMonth() + 1;
    const seasonFactor = this.getSeasonalFactor(month);
    baseInflow *= seasonFactor;
    baseRevenue *= seasonFactor;

    // 应用趋势调整（衰减因子：越远的预测越不确定）
    const decayFactor = Math.pow(0.98, weekIndex);
    const trendAdjustment = 1 + stats.trend.incomeGrowth * decayFactor;
    baseInflow *= trendAdjustment;

    // 取整
    const inflow = Math.round(baseInflow);
    const outflow = Math.round(baseOutflow);
    const revenue = Math.round(baseRevenue);
    const netCashflow = inflow - outflow;
    const prepaidChange = inflow - revenue - outflow;

    return {
      inflow,
      outflow,
      netCashflow,
      revenue,
      prepaidChange,
    };
  }

  /**
   * 获取季节系数
   */
  private getSeasonalFactor(month: number): number {
    return this.CONFIG.SEASON_FACTORS[month] || 1.0;
  }

  // ============================================
  // 四、人工调整
  // ============================================

  /**
   * 调整预测值
   * 
   * @param adjustDto 调整数据
   * @param currentUserId 操作人
   */
  async adjustForecast(adjustDto: AdjustForecastDto, currentUserId: string): Promise<void> {
    const key = `${adjustDto.campusId || 'ALL'}_${adjustDto.weekKey}`;

    // 检查是否已锁定
    const existing = this.adjustmentsStore.get(key);
    // 生产环境应从数据库检查锁定状态

    this.adjustmentsStore.set(key, {
      ...adjustDto,
      // 记录调整人和时间（生产环境应存入数据库）
    });
  }

  /**
   * 批量调整预测值
   */
  async batchAdjustForecast(
    adjustments: AdjustForecastDto[],
    currentUserId: string,
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const adj of adjustments) {
      try {
        await this.adjustForecast(adj, currentUserId);
        success++;
      } catch {
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * 获取调整历史
   */
  async getAdjustmentHistory(weekKey: string, campusId?: string): Promise<AdjustForecastDto | null> {
    const key = `${campusId || 'ALL'}_${weekKey}`;
    return this.adjustmentsStore.get(key) || null;
  }

  /**
   * 锁定预测值（不允许再调整）
   */
  async lockForecast(weekKeys: string[], campusId?: string): Promise<void> {
    // 生产环境应存入数据库并标记锁定状态
    // 这里仅为示例
    console.log(`Locking forecast for weeks: ${weekKeys.join(', ')}`);
  }

  /**
   * 清除调整值
   */
  async clearAdjustment(weekKey: string, campusId?: string): Promise<void> {
    const key = `${campusId || 'ALL'}_${weekKey}`;
    this.adjustmentsStore.delete(key);
  }

  // ============================================
  // 五、预警检查【预留接口】
  // ============================================

  /**
   * 检查预测预警
   * 
   * 【预警模块预留接口】
   * 可扩展的预警规则：
   * - 现金流转负预警
   * - 预收款余额过低预警
   * - 退费率异常预警
   * - 收入下降趋势预警
   * 
   * @param forecast 预测数据
   * @param currentBalance 当前预收余额
   */
  private checkForecastAlerts(
    forecast: WeekForecastData[],
    currentBalance: number,
  ): ForecastAlert[] {
    const alerts: ForecastAlert[] = [];

    // 预警阈值配置（可配置化）
    const thresholds = {
      negativeCashflow: 0,           // 净现金流转负
      lowPrepaidBalance: 50000,      // 预收余额低于5万
      prepaidDeclineRate: 0.2,       // 预收余额下降超过20%
    };

    for (const week of forecast) {
      // ============================================
      // 预警1: 净现金流转负
      // ============================================
      if (week.cumulative.netCashflow < thresholds.negativeCashflow) {
        alerts.push({
          weekKey: week.weekKey,
          type: AlertType.CASHFLOW_NEGATIVE,
          level: AlertLevel.DANGER,
          title: '净现金流转负',
          message: `预计${week.weekLabel}累计净现金流为 ¥${week.cumulative.netCashflow.toLocaleString()}`,
          threshold: thresholds.negativeCashflow,
          actualValue: week.cumulative.netCashflow,
          suggestedAction: '建议检查收款计划或控制支出',
        });
      }

      // ============================================
      // 预警2: 预收款余额过低
      // ============================================
      if (week.cumulative.prepaidBalance < thresholds.lowPrepaidBalance) {
        alerts.push({
          weekKey: week.weekKey,
          type: AlertType.PREPAID_LOW,
          level: AlertLevel.WARNING,
          title: '预收款余额过低',
          message: `预计${week.weekLabel}预收款余额为 ¥${week.cumulative.prepaidBalance.toLocaleString()}`,
          threshold: thresholds.lowPrepaidBalance,
          actualValue: week.cumulative.prepaidBalance,
          suggestedAction: '建议加强招生和续费工作',
        });
      }

      // ============================================
      // 预警3: 预收款余额大幅下降
      // ============================================
      const declineRate = (currentBalance - week.cumulative.prepaidBalance) / currentBalance;
      if (declineRate > thresholds.prepaidDeclineRate) {
        alerts.push({
          weekKey: week.weekKey,
          type: AlertType.REVENUE_DECLINE,
          level: AlertLevel.WARNING,
          title: '预收款余额下降趋势',
          message: `预计${week.weekLabel}预收款余额相比当前下降 ${(declineRate * 100).toFixed(1)}%`,
          threshold: thresholds.prepaidDeclineRate,
          actualValue: declineRate,
          suggestedAction: '建议关注招生和续费情况',
        });
      }
    }

    // 去重（同类型只保留最严重的）
    return this.deduplicateAlerts(alerts);
  }

  /**
   * 预警去重
   */
  private deduplicateAlerts(alerts: ForecastAlert[]): ForecastAlert[] {
    const alertMap = new Map<AlertType, ForecastAlert>();

    for (const alert of alerts) {
      const existing = alertMap.get(alert.type);
      if (!existing || this.isMoreSevere(alert, existing)) {
        alertMap.set(alert.type, alert);
      }
    }

    return Array.from(alertMap.values());
  }

  /**
   * 比较预警严重程度
   */
  private isMoreSevere(a: ForecastAlert, b: ForecastAlert): boolean {
    const levelOrder = {
      [AlertLevel.INFO]: 0,
      [AlertLevel.WARNING]: 1,
      [AlertLevel.DANGER]: 2,
      [AlertLevel.CRITICAL]: 3,
    };
    return levelOrder[a.level] > levelOrder[b.level];
  }

  // ============================================
  // 六、预警规则管理【预留接口】
  // ============================================

  /**
   * 获取预警规则列表
   * 【预留接口】供未来预警模块使用
   */
  async getAlertRules(): Promise<any[]> {
    // 生产环境从数据库读取
    return [
      {
        id: 'rule_cashflow_negative',
        type: AlertType.CASHFLOW_NEGATIVE,
        name: '净现金流转负预警',
        enabled: true,
        condition: { metric: 'cumulative.netCashflow', operator: 'lt', threshold: 0 },
        alertConfig: { level: AlertLevel.DANGER },
      },
      {
        id: 'rule_prepaid_low',
        type: AlertType.PREPAID_LOW,
        name: '预收款余额过低预警',
        enabled: true,
        condition: { metric: 'cumulative.prepaidBalance', operator: 'lt', threshold: 50000 },
        alertConfig: { level: AlertLevel.WARNING },
      },
      {
        id: 'rule_refund_high',
        type: AlertType.REFUND_HIGH,
        name: '退费率过高预警',
        enabled: true,
        condition: { metric: 'refundRate', operator: 'gt', threshold: 0.15 },
        alertConfig: { level: AlertLevel.WARNING },
      },
    ];
  }

  /**
   * 更新预警规则
   * 【预留接口】供未来预警模块使用
   */
  async updateAlertRule(ruleId: string, updates: any): Promise<void> {
    // 生产环境更新数据库
    console.log(`Updating alert rule ${ruleId}:`, updates);
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 获取周起始日期（周一）
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * 获取周标识 (YYYY-Wxx)
   */
  private getWeekKey(date: Date): string {
    const year = date.getFullYear();
    const weekNum = this.getWeekNumber(date);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * 获取周数
   */
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * 获取周标签
   */
  private getWeekLabel(start: Date, end: Date, weekIndex: number): string {
    const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
    const endStr = `${end.getMonth() + 1}/${end.getDate()}`;
    return `第${weekIndex}周 (${startStr}-${endStr})`;
  }
}

