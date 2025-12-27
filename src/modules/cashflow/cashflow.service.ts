import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QueryCashflowDto,
  CashflowSummaryDto,
  RecordInflowDto,
  RecordOutflowDto,
  RollingTableQueryDto,
  PeriodSummaryQueryDto,
  TimePeriod,
  CashflowType,
  OperatingCashflowResult,
  RollingTableRow,
  PeriodSummaryResult,
} from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { Prisma } from '@prisma/client';

/**
 * ============================================
 * 现金流核心服务
 * ============================================
 * 
 * 数据来源说明：
 * ┌──────────────┬───────────────────────────────────────────┐
 * │ 数据表        │ 提供的数据                                  │
 * ├──────────────┼───────────────────────────────────────────┤
 * │ Payment      │ 现金流入（收款）: 新招、续费、分期            │
 * │ Lesson       │ 收入确认（消课）: 预收款转确认收入            │
 * │ Refund       │ 现金流出（退费）: 正常退费、转校退、终止退     │
 * │ Contract     │ 预收款余额（未消课金额）                      │
 * └──────────────┴───────────────────────────────────────────┘
 * 
 * 核心公式：
 * - 净经营现金流 = 现金流入 - 现金流出
 * - 预收款余额 = 期初余额 + 本期收款 - 本期消课 - 本期退费
 * - 确认收入 = 消课金额 = 消课课时 × 课时单价
 */
@Injectable()
export class CashflowService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // 一、现金流基础查询
  // ============================================

  /**
   * 记录资金流入（收款）
   * 【数据来源】: 写入 Payment 表
   */
  async recordInflow(tx: Prisma.TransactionClient, data: RecordInflowDto) {
    const paymentNo = NumberGenerator.generateCashFlowNo();

    return tx.payment.create({
      data: {
        paymentNo,
        contractId: data.contractId,
        campusId: data.campusId,
        amount: data.amount,
        payMethod: data.payMethod,
        paymentType: 'SIGN',
        status: 1,
        paidAt: new Date(),
        createdById: data.createdById,
        remark: data.remark,
      },
    });
  }

  /**
   * 记录资金流出（退费）
   * 【数据来源】: 通过 Refund 表完成
   */
  async recordOutflow(_tx: Prisma.TransactionClient, _data: RecordOutflowDto) {
    // 退费通过Refund表的状态更新完成，不需要单独的现金流出记录
    return { success: true };
  }

  // ============================================
  // 二、经营现金流计算
  // ============================================

  /**
   * 计算经营现金流
   * 
   * 业务逻辑：
   * 1. 统计现金流入（来自 Payment 表）
   * 2. 统计现金流出（来自 Refund 表）
   * 3. 统计收入确认（来自 Lesson 表）
   * 4. 计算净经营现金流
   * 
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param campusId 校区ID（可选）
   */
  async calculateOperatingCashflow(
    startDate: string,
    endDate: string,
    campusId?: string,
  ): Promise<OperatingCashflowResult> {
    const start = new Date(startDate);
    const end = new Date(endDate + 'T23:59:59');

    // ============================================
    // 步骤1: 统计现金流入（来自 Payment）
    // ============================================
    const cashInflow = await this.getCashInflow(start, end, campusId);

    // ============================================
    // 步骤2: 统计现金流出（来自 Refund）
    // ============================================
    const cashOutflow = await this.getCashOutflow(start, end, campusId);

    // ============================================
    // 步骤3: 统计收入确认（来自 Lesson）
    // ============================================
    const revenueRecognized = await this.getRevenueRecognized(start, end, campusId);

    // ============================================
    // 步骤4: 计算净经营现金流
    // ============================================
    const netOperatingCashflow = DecimalUtil.toNumber(
      DecimalUtil.subtract(cashInflow.total.toString(), cashOutflow.total.toString())
    );

    return {
      period: { startDate, endDate },
      cashInflow,
      cashOutflow,
      netOperatingCashflow,
      nonCashChanges: revenueRecognized,
    };
  }

  /**
   * 获取现金流入详情
   * 【数据来源】: Payment 表
   * 
   * @param start 开始时间
   * @param end 结束时间
   * @param campusId 校区ID
   */
  private async getCashInflow(start: Date, end: Date, campusId?: string) {
    const where: Prisma.PaymentWhereInput = {
      status: 1,
      paidAt: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    // 按收款类型分组统计
    const byType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    // 汇总
    const typeStats: { sign: number; renewal: number; installment: number } = {
      sign: 0,
      renewal: 0,
      installment: 0,
    };

    let total = 0;
    let count = 0;

    byType.forEach((t) => {
      const amount = Number(t._sum.amount || 0);
      total += amount;
      count += t._count;

      switch (t.paymentType) {
        case 'SIGN':
          typeStats.sign = amount;
          break;
        case 'RENEWAL':
          typeStats.renewal = amount;
          break;
        case 'INSTALLMENT':
          typeStats.installment = amount;
          break;
      }
    });

    return {
      total,
      byType: typeStats,
      count,
    };
  }

  /**
   * 获取现金流出详情
   * 【数据来源】: Refund 表（status=3 已完成）
   * 
   * @param start 开始时间
   * @param end 结束时间
   * @param campusId 校区ID
   */
  private async getCashOutflow(start: Date, end: Date, campusId?: string) {
    const where: Prisma.RefundWhereInput = {
      status: 3, // 已完成
      refundedAt: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    // 按退费类型分组统计
    const byType = await this.prisma.refund.groupBy({
      by: ['refundType'],
      where,
      _sum: { actualAmount: true },
      _count: true,
    });

    // 汇总
    const typeStats: { normal: number; transfer: number; terminate: number } = {
      normal: 0,
      transfer: 0,
      terminate: 0,
    };

    let total = 0;
    let count = 0;

    byType.forEach((t) => {
      const amount = Number(t._sum.actualAmount || 0);
      total += amount;
      count += t._count;

      switch (t.refundType) {
        case 'NORMAL':
          typeStats.normal = amount;
          break;
        case 'TRANSFER':
          typeStats.transfer = amount;
          break;
        case 'TERMINATE':
          typeStats.terminate = amount;
          break;
      }
    });

    return {
      total,
      byType: typeStats,
      count,
    };
  }

  /**
   * 获取确认收入（消课金额）
   * 【数据来源】: Lesson 表（status=1 正常）
   * 
   * @param start 开始时间
   * @param end 结束时间
   * @param campusId 校区ID
   */
  private async getRevenueRecognized(start: Date, end: Date, campusId?: string) {
    const where: Prisma.LessonWhereInput = {
      status: 1,
      lessonDate: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    const stats = await this.prisma.lesson.aggregate({
      where,
      _sum: { lessonAmount: true, lessonCount: true },
    });

    return {
      revenueRecognized: Number(stats._sum.lessonAmount || 0),
      lessonCount: stats._sum.lessonCount || 0,
    };
  }

  // ============================================
  // 三、预收-消课-退费滚动表
  // ============================================

  /**
   * 生成预收-消课-退费滚动表
   * 
   * 业务逻辑：
   * 1. 计算期初预收款余额（来自 Contract.unearned）
   * 2. 按时间粒度（日/周/月）分组统计：
   *    - 本期收款（来自 Payment）
   *    - 本期消课（来自 Lesson）
   *    - 本期退费（来自 Refund）
   * 3. 计算期末余额：期初 + 收款 - 消课 - 退费
   * 
   * @param query 查询参数
   */
  async generateRollingTable(query: RollingTableQueryDto): Promise<RollingTableRow[]> {
    const { startDate, endDate, campusId, granularity = TimePeriod.DAY } = query;

    // ============================================
    // 步骤1: 计算期初预收款余额
    // 【数据来源】: 合并计算 Payment - Lesson - Refund
    // ============================================
    const openingBalance = await this.calculateOpeningBalance(startDate, campusId);

    // ============================================
    // 步骤2: 获取期间内各类流水
    // ============================================
    const start = new Date(startDate);
    const end = new Date(endDate + 'T23:59:59');

    // 获取收款记录【来自 Payment】
    const payments = await this.getPaymentsByPeriod(start, end, campusId);

    // 获取消课记录【来自 Lesson】
    const lessons = await this.getLessonsByPeriod(start, end, campusId);

    // 获取退费记录【来自 Refund】
    const refunds = await this.getRefundsByPeriod(start, end, campusId);

    // ============================================
    // 步骤3: 按时间粒度分组
    // ============================================
    const periodMap = this.groupByPeriod(
      payments,
      lessons,
      refunds,
      startDate,
      endDate,
      granularity,
    );

    // ============================================
    // 步骤4: 计算滚动余额
    // ============================================
    const result: RollingTableRow[] = [];
    let runningBalance = openingBalance;

    const sortedKeys = Array.from(periodMap.keys()).sort();

    for (const periodKey of sortedKeys) {
      const data = periodMap.get(periodKey)!;

      const periodIncome = data.income;
      const periodConsumed = data.consumed;
      const periodRefund = data.refund;

      // 期末余额 = 期初 + 收款 - 消课 - 退费
      const closingBalance = DecimalUtil.toNumber(
        DecimalUtil.subtract(
          DecimalUtil.add(
            runningBalance.toString(),
            periodIncome.toString()
          ),
          DecimalUtil.add(periodConsumed.toString(), periodRefund.toString())
        )
      );

      const balanceChange = DecimalUtil.toNumber(
        DecimalUtil.subtract(closingBalance.toString(), runningBalance.toString())
      );

      result.push({
        periodKey,
        periodLabel: this.formatPeriodLabel(periodKey, granularity),
        openingBalance: runningBalance,
        periodIncome,
        incomeCount: data.incomeCount,
        periodConsumed,
        consumedLessons: data.consumedLessons,
        periodRefund,
        refundCount: data.refundCount,
        closingBalance,
        balanceChange,
      });

      runningBalance = closingBalance;
    }

    return result;
  }

  /**
   * 计算期初预收款余额
   * 【数据来源】: 综合计算
   * 
   * 计算逻辑：
   * 期初余额 = 截止开始日期前的（总收款 - 总消课 - 总退费）
   * 
   * @param startDate 开始日期
   * @param campusId 校区ID
   */
  private async calculateOpeningBalance(startDate: string, campusId?: string): Promise<number> {
    const beforeDate = new Date(startDate);

    const paymentWhere: Prisma.PaymentWhereInput = {
      status: 1,
      paidAt: { lt: beforeDate },
    };
    const lessonWhere: Prisma.LessonWhereInput = {
      status: 1,
      lessonDate: { lt: beforeDate },
    };
    const refundWhere: Prisma.RefundWhereInput = {
      status: 3,
      refundedAt: { lt: beforeDate },
    };

    if (campusId) {
      paymentWhere.campusId = campusId;
      lessonWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    // 截止日期前总收款【来自 Payment】
    const totalPayments = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
    });

    // 截止日期前总消课【来自 Lesson】
    const totalLessons = await this.prisma.lesson.aggregate({
      where: lessonWhere,
      _sum: { lessonAmount: true },
    });

    // 截止日期前总退费【来自 Refund】
    const totalRefunds = await this.prisma.refund.aggregate({
      where: refundWhere,
      _sum: { actualAmount: true },
    });

    const payments = Number(totalPayments._sum.amount || 0);
    const lessons = Number(totalLessons._sum.lessonAmount || 0);
    const refunds = Number(totalRefunds._sum.actualAmount || 0);

    // 期初余额 = 总收款 - 总消课 - 总退费
    return DecimalUtil.toNumber(
      DecimalUtil.subtract(
        payments.toString(),
        DecimalUtil.add(lessons.toString(), refunds.toString())
      )
    );
  }

  /**
   * 获取期间内收款记录
   * 【数据来源】: Payment 表
   */
  private async getPaymentsByPeriod(start: Date, end: Date, campusId?: string) {
    const where: Prisma.PaymentWhereInput = {
      status: 1,
      paidAt: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.payment.findMany({
      where,
      select: { amount: true, paidAt: true },
      orderBy: { paidAt: 'asc' },
    });
  }

  /**
   * 获取期间内消课记录
   * 【数据来源】: Lesson 表
   */
  private async getLessonsByPeriod(start: Date, end: Date, campusId?: string) {
    const where: Prisma.LessonWhereInput = {
      status: 1,
      lessonDate: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.lesson.findMany({
      where,
      select: { lessonAmount: true, lessonCount: true, lessonDate: true },
      orderBy: { lessonDate: 'asc' },
    });
  }

  /**
   * 获取期间内退费记录
   * 【数据来源】: Refund 表
   */
  private async getRefundsByPeriod(start: Date, end: Date, campusId?: string) {
    const where: Prisma.RefundWhereInput = {
      status: 3,
      refundedAt: { gte: start, lte: end },
    };
    if (campusId) where.campusId = campusId;

    return this.prisma.refund.findMany({
      where,
      select: { actualAmount: true, refundedAt: true },
      orderBy: { refundedAt: 'asc' },
    });
  }

  /**
   * 按时间粒度分组
   */
  private groupByPeriod(
    payments: Array<{ amount: Prisma.Decimal; paidAt: Date }>,
    lessons: Array<{ lessonAmount: Prisma.Decimal; lessonCount: number; lessonDate: Date }>,
    refunds: Array<{ actualAmount: Prisma.Decimal; refundedAt: Date | null }>,
    startDate: string,
    endDate: string,
    granularity: TimePeriod,
  ): Map<string, { income: number; incomeCount: number; consumed: number; consumedLessons: number; refund: number; refundCount: number }> {
    const map = new Map<string, { income: number; incomeCount: number; consumed: number; consumedLessons: number; refund: number; refundCount: number }>();

    // 初始化所有期间
    this.initializePeriods(map, startDate, endDate, granularity);

    // 分组收款
    payments.forEach((p) => {
      const key = this.getPeriodKey(p.paidAt, granularity);
      if (map.has(key)) {
        const data = map.get(key)!;
        data.income = DecimalUtil.toNumber(DecimalUtil.add(data.income.toString(), p.amount.toString()));
        data.incomeCount++;
      }
    });

    // 分组消课
    lessons.forEach((l) => {
      const key = this.getPeriodKey(l.lessonDate, granularity);
      if (map.has(key)) {
        const data = map.get(key)!;
        data.consumed = DecimalUtil.toNumber(DecimalUtil.add(data.consumed.toString(), l.lessonAmount.toString()));
        data.consumedLessons += l.lessonCount;
      }
    });

    // 分组退费
    refunds.forEach((r) => {
      if (r.refundedAt) {
        const key = this.getPeriodKey(r.refundedAt, granularity);
        if (map.has(key)) {
          const data = map.get(key)!;
          data.refund = DecimalUtil.toNumber(DecimalUtil.add(data.refund.toString(), r.actualAmount.toString()));
          data.refundCount++;
        }
      }
    });

    return map;
  }

  /**
   * 初始化期间 Map
   */
  private initializePeriods(
    map: Map<string, { income: number; incomeCount: number; consumed: number; consumedLessons: number; refund: number; refundCount: number }>,
    startDate: string,
    endDate: string,
    granularity: TimePeriod,
  ) {
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const key = this.getPeriodKey(current, granularity);
      if (!map.has(key)) {
        map.set(key, { income: 0, incomeCount: 0, consumed: 0, consumedLessons: 0, refund: 0, refundCount: 0 });
      }

      // 递增日期
      switch (granularity) {
        case TimePeriod.DAY:
          current.setDate(current.getDate() + 1);
          break;
        case TimePeriod.WEEK:
          current.setDate(current.getDate() + 7);
          break;
        case TimePeriod.MONTH:
          current.setMonth(current.getMonth() + 1);
          break;
        default:
          current.setDate(current.getDate() + 1);
      }
    }
  }

  /**
   * 获取时间周期 Key
   */
  private getPeriodKey(date: Date, granularity: TimePeriod): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    switch (granularity) {
      case TimePeriod.DAY:
        return `${year}-${month}-${day}`;
      case TimePeriod.WEEK:
        const weekNum = this.getWeekNumber(date);
        return `${year}-W${String(weekNum).padStart(2, '0')}`;
      case TimePeriod.MONTH:
        return `${year}-${month}`;
      case TimePeriod.QUARTER:
        const quarter = Math.ceil((date.getMonth() + 1) / 3);
        return `${year}-Q${quarter}`;
      case TimePeriod.YEAR:
        return `${year}`;
      default:
        return `${year}-${month}-${day}`;
    }
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
   * 格式化周期标签
   */
  private formatPeriodLabel(key: string, granularity: TimePeriod): string {
    switch (granularity) {
      case TimePeriod.DAY:
        return key;
      case TimePeriod.WEEK:
        return `第${key.split('-W')[1]}周`;
      case TimePeriod.MONTH:
        return `${key.split('-')[1]}月`;
      case TimePeriod.QUARTER:
        return key;
      case TimePeriod.YEAR:
        return `${key}年`;
      default:
        return key;
    }
  }

  // ============================================
  // 四、周度/月度现金流汇总
  // ============================================

  /**
   * 获取周度现金流汇总
   * 
   * 业务逻辑：
   * 按自然周分组统计现金流入、流出、净现金流
   * 
   * 【数据来源】:
   * - 现金流入: Payment 表
   * - 现金流出: Refund 表
   * - 确认收入: Lesson 表
   * 
   * @param query 查询参数
   */
  async getWeeklySummary(query: PeriodSummaryQueryDto): Promise<PeriodSummaryResult> {
    return this.getPeriodSummary(query, 'week');
  }

  /**
   * 获取月度现金流汇总
   * 
   * 业务逻辑：
   * 按自然月分组统计现金流入、流出、净现金流
   * 
   * 【数据来源】:
   * - 现金流入: Payment 表
   * - 现金流出: Refund 表
   * - 确认收入: Lesson 表
   * 
   * @param query 查询参数
   */
  async getMonthlySummary(query: PeriodSummaryQueryDto): Promise<PeriodSummaryResult> {
    return this.getPeriodSummary(query, 'month');
  }

  /**
   * 获取周期汇总（通用方法）
   * 
   * @param query 查询参数
   * @param periodType 周期类型
   */
  private async getPeriodSummary(
    query: PeriodSummaryQueryDto,
    periodType: 'week' | 'month',
  ): Promise<PeriodSummaryResult> {
    const { startDate, endDate, campusId } = query;

    // 生成周期列表
    const periods = this.generatePeriods(startDate, endDate, periodType);

    // 统计各周期数据
    const periodStats = await Promise.all(
      periods.map(async (period) => {
        const start = new Date(period.startDate);
        const end = new Date(period.endDate + 'T23:59:59');

        // 收款统计【来自 Payment】
        const paymentWhere: Prisma.PaymentWhereInput = {
          status: 1,
          paidAt: { gte: start, lte: end },
        };
        if (campusId) paymentWhere.campusId = campusId;

        const paymentStats = await this.prisma.payment.aggregate({
          where: paymentWhere,
          _sum: { amount: true },
          _count: true,
        });

        // 退费统计【来自 Refund】
        const refundWhere: Prisma.RefundWhereInput = {
          status: 3,
          refundedAt: { gte: start, lte: end },
        };
        if (campusId) refundWhere.campusId = campusId;

        const refundStats = await this.prisma.refund.aggregate({
          where: refundWhere,
          _sum: { actualAmount: true },
          _count: true,
        });

        // 消课统计【来自 Lesson】
        const lessonWhere: Prisma.LessonWhereInput = {
          status: 1,
          lessonDate: { gte: start, lte: end },
        };
        if (campusId) lessonWhere.campusId = campusId;

        const lessonStats = await this.prisma.lesson.aggregate({
          where: lessonWhere,
          _sum: { lessonAmount: true, lessonCount: true },
        });

        const totalIncome = Number(paymentStats._sum.amount || 0);
        const totalRefund = Number(refundStats._sum.actualAmount || 0);
        const recognizedRevenue = Number(lessonStats._sum.lessonAmount || 0);

        return {
          periodKey: period.key,
          periodLabel: period.label,
          startDate: period.startDate,
          endDate: period.endDate,
          totalIncome,
          incomeCount: paymentStats._count,
          totalRefund,
          refundCount: refundStats._count,
          netCashflow: DecimalUtil.toNumber(
            DecimalUtil.subtract(totalIncome.toString(), totalRefund.toString())
          ),
          recognizedRevenue,
          lessonCount: lessonStats._sum.lessonCount || 0,
          prepaidChange: DecimalUtil.toNumber(
            DecimalUtil.subtract(
              totalIncome.toString(),
              DecimalUtil.add(recognizedRevenue.toString(), totalRefund.toString())
            )
          ),
        };
      })
    );

    // 计算总计
    const summary = periodStats.reduce(
      (acc, p) => ({
        totalIncome: acc.totalIncome + p.totalIncome,
        totalRefund: acc.totalRefund + p.totalRefund,
        netCashflow: acc.netCashflow + p.netCashflow,
        recognizedRevenue: acc.recognizedRevenue + p.recognizedRevenue,
      }),
      { totalIncome: 0, totalRefund: 0, netCashflow: 0, recognizedRevenue: 0 }
    );

    return {
      periodType,
      periods: periodStats,
      summary,
    };
  }

  /**
   * 生成周期列表
   */
  private generatePeriods(
    startDate: string,
    endDate: string,
    periodType: 'week' | 'month',
  ): Array<{ key: string; label: string; startDate: string; endDate: string }> {
    const periods: Array<{ key: string; label: string; startDate: string; endDate: string }> = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    if (periodType === 'week') {
      // 按周分组
      while (current <= end) {
        const weekStart = new Date(current);
        const dayOfWeek = weekStart.getDay();
        const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        weekStart.setDate(diff);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const weekNum = this.getWeekNumber(current);
        const year = current.getFullYear();

        periods.push({
          key: `${year}-W${String(weekNum).padStart(2, '0')}`,
          label: `${year}年第${weekNum}周`,
          startDate: weekStart.toISOString().slice(0, 10),
          endDate: weekEnd > end ? end.toISOString().slice(0, 10) : weekEnd.toISOString().slice(0, 10),
        });

        current.setDate(current.getDate() + 7);
      }
    } else {
      // 按月分组
      while (current <= end) {
        const year = current.getFullYear();
        const month = current.getMonth();

        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0);

        periods.push({
          key: `${year}-${String(month + 1).padStart(2, '0')}`,
          label: `${year}年${month + 1}月`,
          startDate: monthStart.toISOString().slice(0, 10),
          endDate: monthEnd > end ? end.toISOString().slice(0, 10) : monthEnd.toISOString().slice(0, 10),
        });

        current.setMonth(current.getMonth() + 1);
      }
    }

    return periods;
  }

  // ============================================
  // 五、现金流记录查询（原有功能保留）
  // ============================================

  /**
   * 获取收款流水
   * 【数据来源】: Payment 表
   */
  async getPaymentRecords(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate, keyword } = query;

    const where: Prisma.PaymentWhereInput = { status: 1 };

    if (campusId) where.campusId = campusId;
    if (keyword) {
      where.OR = [
        { paymentNo: { contains: keyword } },
        { remark: { contains: keyword } },
      ];
    }
    if (startDate && endDate) {
      where.paidAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59'),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: {
            include: {
              student: { select: { id: true, name: true } },
            },
          },
          campus: { select: { id: true, name: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取退费流水
   * 【数据来源】: Refund 表
   */
  async getRefundRecords(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate, keyword } = query;

    const where: Prisma.RefundWhereInput = { status: 3 };

    if (campusId) where.campusId = campusId;
    if (keyword) {
      where.OR = [{ refundNo: { contains: keyword } }];
    }
    if (startDate && endDate) {
      where.refundedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59'),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: {
            include: {
              student: { select: { id: true, name: true } },
            },
          },
          campus: { select: { id: true, name: true } },
        },
        orderBy: { refundedAt: 'desc' },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 现金流汇总
   */
  async getSummary(query: CashflowSummaryDto) {
    const { campusId, startDate, endDate } = query;

    const paymentWhere: Prisma.PaymentWhereInput = { status: 1 };
    const refundWhere: Prisma.RefundWhereInput = { status: 3 };

    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }
    if (startDate && endDate) {
      paymentWhere.paidAt = { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') };
      refundWhere.refundedAt = { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') };
    }

    const inflowStats = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    const outflowStats = await this.prisma.refund.aggregate({
      where: refundWhere,
      _sum: { actualAmount: true },
      _count: true,
    });

    const totalInflow = Number(inflowStats._sum.amount || 0);
    const totalOutflow = Number(outflowStats._sum.actualAmount || 0);
    const netCashflow = DecimalUtil.toNumber(
      DecimalUtil.subtract(totalInflow.toString(), totalOutflow.toString())
    );

    return {
      totalInflow,
      inflowCount: inflowStats._count,
      totalOutflow,
      outflowCount: outflowStats._count,
      netCashflow,
    };
  }

  /**
   * 现金流趋势
   */
  async getCashflowTrend(period: 'day' | 'week' | 'month', days: number, campusId?: string) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const paymentWhere: Prisma.PaymentWhereInput = { status: 1, paidAt: { gte: startDate } };
    const refundWhere: Prisma.RefundWhereInput = { status: 3, refundedAt: { gte: startDate } };

    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      select: { amount: true, paidAt: true },
      orderBy: { paidAt: 'asc' },
    });

    const refunds = await this.prisma.refund.findMany({
      where: refundWhere,
      select: { actualAmount: true, refundedAt: true },
      orderBy: { refundedAt: 'asc' },
    });

    const dateMap = new Map<string, { inflow: number; outflow: number }>();

    payments.forEach((p) => {
      const dateKey = p.paidAt.toISOString().slice(0, 10);
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { inflow: 0, outflow: 0 });
      }
      const stat = dateMap.get(dateKey)!;
      stat.inflow = DecimalUtil.toNumber(DecimalUtil.add(stat.inflow.toString(), p.amount.toString()));
    });

    refunds.forEach((r) => {
      if (r.refundedAt) {
        const dateKey = r.refundedAt.toISOString().slice(0, 10);
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, { inflow: 0, outflow: 0 });
        }
        const stat = dateMap.get(dateKey)!;
        stat.outflow = DecimalUtil.toNumber(DecimalUtil.add(stat.outflow.toString(), r.actualAmount.toString()));
      }
    });

    return Array.from(dateMap.entries())
      .map(([date, stats]) => ({
        date,
        inflow: stats.inflow,
        outflow: stats.outflow,
        net: DecimalUtil.toNumber(DecimalUtil.subtract(stats.inflow.toString(), stats.outflow.toString())),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * 按校区分组统计
   */
  async groupByCampus(startDate: string, endDate: string) {
    const paymentWhere: Prisma.PaymentWhereInput = {
      status: 1,
      paidAt: { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') },
    };
    const refundWhere: Prisma.RefundWhereInput = {
      status: 3,
      refundedAt: { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') },
    };

    const [paymentResult, refundResult] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['campusId'],
        where: paymentWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.groupBy({
        by: ['campusId'],
        where: refundWhere,
        _sum: { actualAmount: true },
        _count: true,
      }),
    ]);

    const allCampusIds = [...new Set([
      ...paymentResult.map((r) => r.campusId),
      ...refundResult.map((r) => r.campusId),
    ])];

    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: allCampusIds } },
      select: { id: true, name: true },
    });
    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));

    const resultMap = new Map<string, {
      campusId: string;
      campusName: string;
      inflow: number;
      outflow: number;
      inflowCount: number;
      outflowCount: number;
    }>();

    paymentResult.forEach((p) => {
      resultMap.set(p.campusId, {
        campusId: p.campusId,
        campusName: campusMap.get(p.campusId) || '未知',
        inflow: Number(p._sum.amount || 0),
        outflow: 0,
        inflowCount: p._count,
        outflowCount: 0,
      });
    });

    refundResult.forEach((r) => {
      if (resultMap.has(r.campusId)) {
        const item = resultMap.get(r.campusId)!;
        item.outflow = Number(r._sum.actualAmount || 0);
        item.outflowCount = r._count;
      } else {
        resultMap.set(r.campusId, {
          campusId: r.campusId,
          campusName: campusMap.get(r.campusId) || '未知',
          inflow: 0,
          outflow: Number(r._sum.actualAmount || 0),
          inflowCount: 0,
          outflowCount: r._count,
        });
      }
    });

    return Array.from(resultMap.values()).map((item) => ({
      ...item,
      net: item.inflow - item.outflow,
    }));
  }

  /**
   * 获取预收款余额
   * 【数据来源】: Contract.unearned
   */
  async getPrepaidBalance(campusId?: string) {
    const where: Prisma.ContractWhereInput = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.aggregate({
      where,
      _sum: { unearned: true, paidAmount: true },
      _count: true,
    });

    const byCampus = await this.prisma.contract.groupBy({
      by: ['campusId'],
      where,
      _sum: { unearned: true },
      _count: true,
    });

    const campusIds = byCampus.map((c) => c.campusId);
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: campusIds } },
      select: { id: true, name: true },
    });
    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));

    return {
      totalUnearned: Number(contracts._sum.unearned || 0),
      totalPaid: Number(contracts._sum.paidAmount || 0),
      contractCount: contracts._count,
      byCampus: byCampus.map((c) => ({
        campusId: c.campusId,
        campusName: campusMap.get(c.campusId) || '未知',
        unearned: Number(c._sum.unearned || 0),
        contractCount: c._count,
      })),
    };
  }

  /**
   * 获取现金流记录列表
   */
  async findAll(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, flowType, campusId, startDate, endDate, keyword } = query;

    if (flowType === CashflowType.INFLOW) {
      return this.getPaymentRecords(query);
    } else if (flowType === CashflowType.OUTFLOW) {
      return this.getRefundRecords(query);
    }

    // 构造大容量查询参数
    const largeQueryParams = {
      page: 1,
      pageSize: 1000,
      campusId,
      startDate,
      endDate,
      keyword,
    };

    const [payments, refunds] = await Promise.all([
      this.getPaymentRecords(largeQueryParams as QueryCashflowDto),
      this.getRefundRecords(largeQueryParams as QueryCashflowDto),
    ]);

    const allRecords = [
      ...payments.data.map((p: any) => ({ ...p, type: 'inflow', recordTime: p.paidAt })),
      ...refunds.data.map((r: any) => ({ ...r, type: 'outflow', recordTime: r.refundedAt })),
    ].sort((a, b) => new Date(b.recordTime).getTime() - new Date(a.recordTime).getTime());

    const startIdx = (page - 1) * pageSize;
    const paginatedRecords = allRecords.slice(startIdx, startIdx + pageSize);

    return new PaginatedResponseDto(paginatedRecords, allRecords.length, page, pageSize);
  }

  /**
   * 按业务类型分组统计
   */
  async groupByBizType(startDate: string, endDate: string, campusId?: string) {
    const paymentWhere: Prisma.PaymentWhereInput = {
      status: 1,
      paidAt: { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59') },
    };
    if (campusId) paymentWhere.campusId = campusId;

    const [byPaymentType, byPayMethod] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['paymentType'],
        where: paymentWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['payMethod'],
        where: paymentWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      byPaymentType: byPaymentType.map((t) => ({
        bizType: t.paymentType,
        bizTypeName: this.getPaymentTypeName(t.paymentType),
        amount: Number(t._sum.amount || 0),
        count: t._count,
      })),
      byPayMethod: byPayMethod.map((m) => ({
        payMethod: m.payMethod,
        payMethodName: this.getPayMethodName(m.payMethod),
        amount: Number(m._sum.amount || 0),
        count: m._count,
      })),
    };
  }

  private getPaymentTypeName(code: string): string {
    const types: Record<string, string> = {
      SIGN: '签约首付',
      INSTALLMENT: '分期付款',
      RENEWAL: '续费',
    };
    return types[code] || code;
  }

  private getPayMethodName(code: string): string {
    const methods: Record<string, string> = {
      CASH: '现金',
      WECHAT: '微信支付',
      ALIPAY: '支付宝',
      BANK: '银行转账',
      POS: 'POS刷卡',
    };
    return methods[code] || code;
  }
}
