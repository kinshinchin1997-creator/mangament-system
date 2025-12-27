import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';
import { MetricType, MetricValue } from '../dto';

/**
 * ============================================
 * 指标计算服务
 * ============================================
 * 
 * 职责：
 * 计算各类预警指标的当前值
 * 
 * 数据来源：
 * - Payment: 现金流入指标
 * - Refund: 退费指标
 * - Lesson: 消课指标
 * - Contract: 合同、预收款指标
 * - Student: 学员指标
 */
@Injectable()
export class MetricCalculatorService {
  constructor(private prisma: PrismaService) {}

  /**
   * 计算指标值
   * 
   * @param metric 指标类型
   * @param campusId 校区ID（可选）
   * @param options 额外参数
   */
  async calculate(
    metric: MetricType,
    campusId?: string,
    options?: {
      periodDays?: number;
      forecastWeeks?: number;
      threshold?: number;
    },
  ): Promise<MetricValue> {
    const periodDays = options?.periodDays || 30;
    const forecastWeeks = options?.forecastWeeks || 8;
    const threshold = options?.threshold || 5;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    const endDate = new Date();

    let value: number;
    let unit: string | undefined;
    let breakdown: Record<string, number> | undefined;

    switch (metric) {
      // ============================================
      // 现金流指标
      // ============================================

      case MetricType.NET_CASHFLOW:
        // 净现金流 = 流入 - 流出
        // 如果指定了 forecastWeeks，则计算预测值
        if (forecastWeeks) {
          value = await this.calculateForecastNetCashflow(forecastWeeks, campusId);
        } else {
          value = await this.calculateNetCashflow(startDate, endDate, campusId);
        }
        unit = '元';
        break;

      case MetricType.CASH_INFLOW:
        // 现金流入【来自 Payment】
        value = await this.calculateCashInflow(startDate, endDate, campusId);
        unit = '元';
        break;

      case MetricType.CASH_OUTFLOW:
        // 现金流出【来自 Refund】
        value = await this.calculateCashOutflow(startDate, endDate, campusId);
        unit = '元';
        break;

      // ============================================
      // 预收款指标
      // ============================================

      case MetricType.PREPAID_BALANCE:
        // 预收款余额【来自 Contract.unearned】
        value = await this.calculatePrepaidBalance(campusId);
        unit = '元';
        break;

      case MetricType.PREPAID_COVERAGE_MONTHS:
        // 预收覆盖月数 = 预收余额 / 月均消课金额
        value = await this.calculatePrepaidCoverageMonths(campusId, periodDays);
        unit = '月';
        break;

      // ============================================
      // 退费指标
      // ============================================

      case MetricType.REFUND_RATE:
        // 退费率 = 退费金额 / 收款金额 × 100%
        const { rate, inflow, outflow } = await this.calculateRefundRate(startDate, endDate, campusId);
        value = rate;
        unit = '%';
        breakdown = { inflow, outflow };
        break;

      case MetricType.REFUND_AMOUNT:
        // 退费金额【来自 Refund】
        value = await this.calculateCashOutflow(startDate, endDate, campusId);
        unit = '元';
        break;

      case MetricType.REFUND_COUNT:
        // 退费笔数【来自 Refund】
        value = await this.calculateRefundCount(startDate, endDate, campusId);
        unit = '笔';
        break;

      // ============================================
      // 合同指标
      // ============================================

      case MetricType.EXPIRING_CONTRACTS:
        // 即将过期合同数【来自 Contract】
        value = await this.calculateExpiringContracts(periodDays, campusId);
        unit = '份';
        break;

      case MetricType.EXPIRED_CONTRACTS:
        // 已过期合同数【来自 Contract】
        value = await this.calculateExpiredContracts(campusId);
        unit = '份';
        break;

      // ============================================
      // 学员指标
      // ============================================

      case MetricType.INACTIVE_STUDENTS:
        // 休眠学员数【来自 Lesson + Contract + Student】
        value = await this.calculateInactiveStudents(periodDays, campusId);
        unit = '人';
        break;

      case MetricType.LOW_BALANCE_CONTRACTS:
        // 低余额合同数【来自 Contract】
        value = await this.calculateLowBalanceContracts(threshold, campusId);
        unit = '份';
        break;

      // ============================================
      // 收入指标
      // ============================================

      case MetricType.RECOGNIZED_REVENUE:
        // 确认收入【来自 Lesson】
        value = await this.calculateRecognizedRevenue(startDate, endDate, campusId);
        unit = '元';
        break;

      case MetricType.REVENUE_GROWTH:
        // 收入增长率
        value = await this.calculateRevenueGrowth(campusId);
        unit = '%';
        break;

      default:
        throw new Error(`未知指标类型: ${metric}`);
    }

    return {
      metric,
      value,
      unit,
      calculatedAt: new Date(),
      period: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        days: periodDays,
      },
      breakdown,
    };
  }

  // ============================================
  // 具体指标计算方法
  // ============================================

  /**
   * 计算净现金流
   * 【数据来源】: Payment - Refund
   */
  private async calculateNetCashflow(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<number> {
    const inflow = await this.calculateCashInflow(startDate, endDate, campusId);
    const outflow = await this.calculateCashOutflow(startDate, endDate, campusId);
    return inflow - outflow;
  }

  /**
   * 计算预测净现金流（未来N周）
   * 基于历史数据的简单移动平均预测
   */
  private async calculateForecastNetCashflow(
    weeks: number,
    campusId?: string,
  ): Promise<number> {
    // 获取历史周均数据
    const historyDays = 12 * 7; // 过去12周
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historyDays);

    const weeklyInflow = (await this.calculateCashInflow(startDate, new Date(), campusId)) / 12;
    const weeklyOutflow = (await this.calculateCashOutflow(startDate, new Date(), campusId)) / 12;

    // 预测未来N周累计净现金流
    const weeklyNet = weeklyInflow - weeklyOutflow;
    return weeklyNet * weeks;
  }

  /**
   * 计算现金流入
   * 【数据来源】: Payment 表
   */
  private async calculateCashInflow(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<number> {
    const where: any = {
      status: 1,
      paidAt: { gte: startDate, lte: endDate },
    };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.payment.aggregate({
      where,
      _sum: { amount: true },
    });

    return Number(result._sum.amount || 0);
  }

  /**
   * 计算现金流出
   * 【数据来源】: Refund 表
   */
  private async calculateCashOutflow(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<number> {
    const where: any = {
      status: 3, // 已完成
      refundedAt: { gte: startDate, lte: endDate },
    };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.refund.aggregate({
      where,
      _sum: { actualAmount: true },
    });

    return Number(result._sum.actualAmount || 0);
  }

  /**
   * 计算预收款余额
   * 【数据来源】: Contract.unearned
   */
  private async calculatePrepaidBalance(campusId?: string): Promise<number> {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.contract.aggregate({
      where,
      _sum: { unearned: true },
    });

    return Number(result._sum.unearned || 0);
  }

  /**
   * 计算预收覆盖月数
   * 预收覆盖月数 = 预收余额 / 月均消课金额
   * 【数据来源】: Contract.unearned + Lesson.lessonAmount
   */
  private async calculatePrepaidCoverageMonths(
    campusId?: string,
    periodDays: number = 90,
  ): Promise<number> {
    // 获取预收余额
    const prepaidBalance = await this.calculatePrepaidBalance(campusId);

    // 获取月均消课金额
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const lessonWhere: any = {
      status: 1,
      lessonDate: { gte: startDate },
    };
    if (campusId) lessonWhere.campusId = campusId;

    const lessonResult = await this.prisma.lesson.aggregate({
      where: lessonWhere,
      _sum: { lessonAmount: true },
    });

    const totalLesson = Number(lessonResult._sum.lessonAmount || 0);
    const monthlyLesson = totalLesson / (periodDays / 30);

    // 计算覆盖月数
    if (monthlyLesson <= 0) return 999; // 无消课则无限覆盖
    return prepaidBalance / monthlyLesson;
  }

  /**
   * 计算退费率
   * 退费率 = 退费金额 / 收款金额 × 100%
   * 【数据来源】: Payment + Refund
   */
  private async calculateRefundRate(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<{ rate: number; inflow: number; outflow: number }> {
    const inflow = await this.calculateCashInflow(startDate, endDate, campusId);
    const outflow = await this.calculateCashOutflow(startDate, endDate, campusId);

    const rate = inflow > 0 ? (outflow / inflow) * 100 : 0;

    return { rate, inflow, outflow };
  }

  /**
   * 计算退费笔数
   * 【数据来源】: Refund
   */
  private async calculateRefundCount(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<number> {
    const where: any = {
      status: 3,
      refundedAt: { gte: startDate, lte: endDate },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.refund.count({ where });
  }

  /**
   * 计算即将过期合同数
   * 【数据来源】: Contract
   */
  private async calculateExpiringContracts(
    days: number,
    campusId?: string,
  ): Promise<number> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const where: any = {
      status: 1,
      endDate: { gte: now, lte: futureDate },
      remainLessons: { gt: 0 },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.contract.count({ where });
  }

  /**
   * 计算已过期合同数
   * 【数据来源】: Contract
   */
  private async calculateExpiredContracts(campusId?: string): Promise<number> {
    const now = new Date();

    const where: any = {
      status: 1,
      endDate: { lt: now },
      remainLessons: { gt: 0 },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.contract.count({ where });
  }

  /**
   * 计算休眠学员数
   * 【数据来源】: Contract + Lesson
   */
  private async calculateInactiveStudents(
    days: number,
    campusId?: string,
  ): Promise<number> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - days);

    // 查找有有效合同的学员
    const contractWhere: any = {
      status: 1,
      remainLessons: { gt: 0 },
    };
    if (campusId) contractWhere.campusId = campusId;

    const activeContracts = await this.prisma.contract.findMany({
      where: contractWhere,
      select: { studentId: true },
    });

    const studentIds = [...new Set(activeContracts.map((c) => c.studentId))];

    // 检查这些学员最近是否有上课记录
    let inactiveCount = 0;

    for (const studentId of studentIds) {
      const recentLesson = await this.prisma.lesson.findFirst({
        where: {
          studentId,
          status: 1,
          lessonDate: { gte: thresholdDate },
        },
      });

      if (!recentLesson) {
        inactiveCount++;
      }
    }

    return inactiveCount;
  }

  /**
   * 计算低余额合同数
   * 【数据来源】: Contract
   */
  private async calculateLowBalanceContracts(
    threshold: number,
    campusId?: string,
  ): Promise<number> {
    const where: any = {
      status: 1,
      remainLessons: { gt: 0, lte: threshold },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.contract.count({ where });
  }

  /**
   * 计算确认收入
   * 【数据来源】: Lesson
   */
  private async calculateRecognizedRevenue(
    startDate: Date,
    endDate: Date,
    campusId?: string,
  ): Promise<number> {
    const where: any = {
      status: 1,
      lessonDate: { gte: startDate, lte: endDate },
    };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.lesson.aggregate({
      where,
      _sum: { lessonAmount: true },
    });

    return Number(result._sum.lessonAmount || 0);
  }

  /**
   * 计算收入增长率
   * 【数据来源】: Payment
   */
  private async calculateRevenueGrowth(campusId?: string): Promise<number> {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

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

    if (lastAmount <= 0) return 0;
    return ((thisAmount - lastAmount) / lastAmount) * 100;
  }

  /**
   * 批量计算所有指标
   */
  async calculateAll(campusId?: string): Promise<Record<MetricType, MetricValue>> {
    const metrics = Object.values(MetricType);
    const results: Record<string, MetricValue> = {};

    for (const metric of metrics) {
      try {
        results[metric] = await this.calculate(metric, campusId);
      } catch (error) {
        console.error(`计算指标 ${metric} 失败:`, error);
      }
    }

    return results as Record<MetricType, MetricValue>;
  }
}

