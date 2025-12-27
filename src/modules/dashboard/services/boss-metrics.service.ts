import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 老板看板指标服务
 */
@Injectable()
export class BossMetricsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 全局汇总
   */
  async getSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // 今日收款
    const todayIncome = await this.prisma.payment.aggregate({
      where: { status: 1, paidAt: { gte: today } },
      _sum: { amount: true },
    });

    // 本月收款
    const monthIncome = await this.prisma.payment.aggregate({
      where: { status: 1, paidAt: { gte: thisMonth } },
      _sum: { amount: true },
    });

    // 上月收款（用于环比）
    const lastMonthIncome = await this.prisma.payment.aggregate({
      where: {
        status: 1,
        paidAt: { gte: lastMonth, lte: lastMonthEnd },
      },
      _sum: { amount: true },
    });

    // 本月退费
    const monthRefund = await this.prisma.refund.aggregate({
      where: { status: 3, refundedAt: { gte: thisMonth } },
      _sum: { actualAmount: true },
    });

    // 本月消课金额
    const monthLesson = await this.prisma.lesson.aggregate({
      where: { status: 1, lessonDate: { gte: thisMonth } },
      _sum: { lessonAmount: true },
    });

    // 预收余额
    const contracts = await this.prisma.contract.aggregate({
      where: { status: 1 },
      _sum: { unearned: true },
    });

    const prepaidBalance = Number(contracts._sum.unearned || 0);

    // 校区数量
    const campusCount = await this.prisma.campus.count({ where: { status: 1 } });

    // 活跃学员数
    const activeStudents = await this.prisma.contract.groupBy({
      by: ['studentId'],
      where: { status: 1, remainLessons: { gt: 0 } },
    });

    const currentMonthIncome = Number(monthIncome._sum.amount || 0);
    const previousMonthIncome = Number(lastMonthIncome._sum.amount || 0);
    const momGrowth = previousMonthIncome > 0
      ? ((currentMonthIncome - previousMonthIncome) / previousMonthIncome) * 100
      : 0;

    return {
      todayIncome: Number(todayIncome._sum.amount || 0),
      monthIncome: currentMonthIncome,
      monthRefund: Number(monthRefund._sum.actualAmount || 0),
      monthNetIncome: currentMonthIncome - Number(monthRefund._sum.actualAmount || 0),
      monthLesson: Number(monthLesson._sum.lessonAmount || 0),
      prepaidBalance,
      campusCount,
      activeStudentCount: activeStudents.length,
      momGrowth: Math.round(momGrowth * 100) / 100,
    };
  }

  /**
   * 校区对比
   */
  async getCampusComparison(startDate: string, endDate: string) {
    const campuses = await this.prisma.campus.findMany({
      where: { status: 1 },
      select: { id: true, name: true },
    });

    const comparison = await Promise.all(
      campuses.map(async (campus) => {
        const paymentWhere = {
          campusId: campus.id,
          status: 1,
          paidAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        };

        const refundWhere = {
          campusId: campus.id,
          status: 3,
          refundedAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        };

        const lessonWhere = {
          campusId: campus.id,
          status: 1,
          lessonDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        };

        const [income, refund, lessons] = await Promise.all([
          this.prisma.payment.aggregate({
            where: paymentWhere,
            _sum: { amount: true },
            _count: true,
          }),
          this.prisma.refund.aggregate({
            where: refundWhere,
            _sum: { actualAmount: true },
            _count: true,
          }),
          this.prisma.lesson.aggregate({
            where: lessonWhere,
            _sum: { lessonAmount: true, lessonCount: true },
          }),
        ]);

        return {
          campusId: campus.id,
          campusName: campus.name,
          income: Number(income._sum.amount || 0),
          incomeCount: income._count,
          refund: Number(refund._sum.actualAmount || 0),
          refundCount: refund._count,
          netIncome: Number(income._sum.amount || 0) - Number(refund._sum.actualAmount || 0),
          lessonAmount: Number(lessons._sum.lessonAmount || 0),
          lessonCount: lessons._sum.lessonCount || 0,
        };
      })
    );

    // 按收入排序
    comparison.sort((a, b) => b.income - a.income);

    return comparison;
  }

  /**
   * 业绩趋势
   */
  async getTrend(period: 'week' | 'month' | 'quarter') {
    let days: number;
    switch (period) {
      case 'week': days = 7; break;
      case 'month': days = 30; break;
      case 'quarter': days = 90; break;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 获取收款数据
    const payments = await this.prisma.payment.findMany({
      where: { status: 1, paidAt: { gte: startDate } },
      select: { amount: true, paidAt: true },
    });

    // 获取退费数据
    const refunds = await this.prisma.refund.findMany({
      where: { status: 3, refundedAt: { gte: startDate } },
      select: { actualAmount: true, refundedAt: true },
    });

    // 按日期分组
    const dailyData = new Map<string, { income: number; refund: number }>();

    payments.forEach((p) => {
      const date = p.paidAt.toISOString().slice(0, 10);
      if (!dailyData.has(date)) {
        dailyData.set(date, { income: 0, refund: 0 });
      }
      const data = dailyData.get(date)!;
      data.income += Number(p.amount);
    });

    refunds.forEach((r) => {
      if (r.refundedAt) {
        const date = r.refundedAt.toISOString().slice(0, 10);
        if (!dailyData.has(date)) {
          dailyData.set(date, { income: 0, refund: 0 });
        }
        const data = dailyData.get(date)!;
        data.refund += Number(r.actualAmount);
      }
    });

    const trend = Array.from(dailyData.entries())
      .map(([date, data]) => ({
        date,
        income: data.income,
        refund: data.refund,
        net: data.income - data.refund,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return trend;
  }

  /**
   * 核心KPI
   */
  async getKPI() {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    // 新签合同数
    const newContracts = await this.prisma.contract.count({
      where: { createdAt: { gte: thisMonth } },
    });

    // 退费率
    const monthIncome = await this.prisma.payment.aggregate({
      where: { status: 1, paidAt: { gte: thisMonth } },
      _sum: { amount: true },
    });
    const monthRefund = await this.prisma.refund.aggregate({
      where: { status: 3, refundedAt: { gte: thisMonth } },
      _sum: { actualAmount: true },
    });
    const income = Number(monthIncome._sum.amount || 0);
    const refund = Number(monthRefund._sum.actualAmount || 0);
    const refundRate = income > 0 ? (refund / income) * 100 : 0;

    // 平均客单价
    const avgContractValue = await this.prisma.contract.aggregate({
      where: { createdAt: { gte: thisMonth } },
      _avg: { paidAmount: true },
    });

    // 消课率（本月消课金额 / 预收余额）
    const monthLesson = await this.prisma.lesson.aggregate({
      where: { status: 1, lessonDate: { gte: thisMonth } },
      _sum: { lessonAmount: true },
    });

    return {
      newContracts,
      refundRate: Math.round(refundRate * 100) / 100,
      avgContractValue: Number(avgContractValue._avg.paidAmount || 0),
      monthLessonAmount: Number(monthLesson._sum.lessonAmount || 0),
    };
  }
}
