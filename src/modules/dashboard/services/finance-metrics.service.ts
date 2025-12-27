import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 财务看板指标服务
 */
@Injectable()
export class FinanceMetricsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 今日收支
   */
  async getTodayMetrics(campusId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const paymentWhere: any = { status: 1, paidAt: { gte: today } };
    const refundWhere: any = { status: 3, refundedAt: { gte: today } };
    const lessonWhere: any = { status: 1, lessonDate: { gte: today } };

    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
      lessonWhere.campusId = campusId;
    }

    // 今日收入
    const income = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    // 今日退费
    const refund = await this.prisma.refund.aggregate({
      where: refundWhere,
      _sum: { actualAmount: true },
      _count: true,
    });

    // 今日消课
    const lessons = await this.prisma.lesson.aggregate({
      where: lessonWhere,
      _sum: { lessonAmount: true, lessonCount: true },
    });

    // 按支付方式统计
    const byPayMethod = await this.prisma.payment.groupBy({
      by: ['payMethod'],
      where: paymentWhere,
      _sum: { amount: true },
    });

    return {
      date: today.toISOString().slice(0, 10),
      income: {
        amount: Number(income._sum.amount || 0),
        count: income._count,
      },
      refund: {
        amount: Number(refund._sum.actualAmount || 0),
        count: refund._count,
      },
      net: Number(income._sum.amount || 0) - Number(refund._sum.actualAmount || 0),
      lessons: {
        amount: Number(lessons._sum.lessonAmount || 0),
        count: lessons._sum.lessonCount || 0,
      },
      byPayMethod: byPayMethod.map((p) => ({
        method: p.payMethod,
        amount: Number(p._sum.amount || 0),
      })),
    };
  }

  /**
   * 现金流指标
   */
  async getCashflowMetrics(startDate: string, endDate: string, campusId?: string) {
    const paymentWhere: any = {
      status: 1,
      paidAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };
    const refundWhere: any = {
      status: 3,
      refundedAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    // 总流入（收款）
    const inflow = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    // 总流出（退费）
    const outflow = await this.prisma.refund.aggregate({
      where: refundWhere,
      _sum: { actualAmount: true },
      _count: true,
    });

    // 按收款类型统计
    const byPaymentType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
      where: paymentWhere,
      _sum: { amount: true },
    });

    return {
      period: { startDate, endDate },
      inflow: {
        amount: Number(inflow._sum.amount || 0),
        count: inflow._count,
      },
      outflow: {
        amount: Number(outflow._sum.actualAmount || 0),
        count: outflow._count,
      },
      net: Number(inflow._sum.amount || 0) - Number(outflow._sum.actualAmount || 0),
      byBizType: byPaymentType.map((b) => ({
        bizType: b.paymentType,
        direction: 'inflow',
        amount: Number(b._sum.amount || 0),
      })),
    };
  }

  /**
   * 预收款负债
   */
  async getPrepaidMetrics(campusId?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      select: { paidAmount: true, unearned: true, totalLessons: true, usedLessons: true, remainLessons: true },
    });

    let totalPaid = 0;
    let totalConsumed = 0;
    let totalRemainValue = 0;

    contracts.forEach((c) => {
      totalPaid += Number(c.paidAmount);
      totalConsumed += Number(c.paidAmount) - Number(c.unearned);
      totalRemainValue += Number(c.unearned);
    });

    return {
      totalPaid: Math.round(totalPaid),
      totalConsumed: Math.round(totalConsumed),
      prepaidBalance: Math.round(totalRemainValue),
      contractCount: contracts.length,
      consumptionRate: totalPaid > 0 ? Math.round((totalConsumed / totalPaid) * 100) : 0,
    };
  }

  /**
   * 日结状态
   */
  async getSettlementStatus(campusId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const where: any = {};
    if (campusId) where.campusId = campusId;

    // 获取所有校区
    const campuses = await this.prisma.campus.findMany({
      where: { status: 1, ...where },
      select: { id: true, name: true },
    });

    const status = await Promise.all(
      campuses.map(async (campus) => {
        // 查询昨日是否已日结
        const yesterdayReport = await this.prisma.dailyReport.findFirst({
          where: {
            campusId: campus.id,
            reportDate: yesterday,
          },
        });

        // 查询最后一次日结
        const lastReport = await this.prisma.dailyReport.findFirst({
          where: { campusId: campus.id },
          orderBy: { reportDate: 'desc' },
        });

        return {
          campusId: campus.id,
          campusName: campus.name,
          yesterdaySettled: !!yesterdayReport,
          lastSettleDate: lastReport?.reportDate?.toISOString()?.slice(0, 10) || null,
          pendingDays: lastReport
            ? Math.floor((today.getTime() - lastReport.reportDate.getTime()) / (1000 * 60 * 60 * 24)) - 1
            : null,
        };
      })
    );

    // 未日结的校区
    const pendingCampuses = status.filter((s) => !s.yesterdaySettled);

    return {
      campuses: status,
      pendingCount: pendingCampuses.length,
      allSettled: pendingCampuses.length === 0,
    };
  }
}
