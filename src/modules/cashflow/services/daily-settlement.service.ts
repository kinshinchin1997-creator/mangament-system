import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 日结服务
 * 
 * 职责：
 * 1. 每日财务日结
 * 2. 生成日结报表
 * 3. 校验现金流完整性
 */
@Injectable()
export class DailySettlementService {
  constructor(private prisma: PrismaService) {}

  /**
   * 执行日结
   * 
   * 业务逻辑：
   * 1. 统计当日流入（合同收款）
   * 2. 统计当日流出（退费）
   * 3. 统计当日消课（确认收入）
   * 4. 计算当日预收余额变动
   * 5. 生成日结快照
   */
  async settle(settleDate: string, campusId: string, operatorId: string) {
    const date = new Date(settleDate);
    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    // 检查是否已日结
    const existing = await this.prisma.dailyReport.findFirst({
      where: {
        reportDate: date,
        campusId,
      },
    });
    if (existing) {
      throw new BadRequestException('该日期已完成日结');
    }

    // 统计当日流入
    const inflowStats = await this.prisma.cashFlow.aggregate({
      where: {
        campusId,
        direction: 1,
        createdAt: { gte: date, lt: nextDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    // 统计当日流出
    const outflowStats = await this.prisma.cashFlow.aggregate({
      where: {
        campusId,
        direction: -1,
        createdAt: { gte: date, lt: nextDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    // 统计当日消课（确认收入）
    const lessonStats = await this.prisma.lessonRecord.aggregate({
      where: {
        campusId,
        attendDate: { gte: date, lt: nextDate },
      },
      _sum: { consumedAmount: true },
      _count: true,
    });

    // 计算各项金额
    const totalIncome = inflowStats._sum.amount || 0;
    const totalRefund = outflowStats._sum.amount || 0;
    const confirmedRevenue = lessonStats._sum.consumedAmount || 0;
    const netIncome = DecimalUtil.toNumber(
      DecimalUtil.subtract(totalIncome.toString(), totalRefund.toString())
    );

    // 创建日结报表
    const report = await this.prisma.dailyReport.create({
      data: {
        reportDate: date,
        campusId,
        totalIncome: DecimalUtil.toNumber(totalIncome.toString()),
        totalRefund: DecimalUtil.toNumber(totalRefund.toString()),
        netIncome,
        confirmedRevenue: DecimalUtil.toNumber(confirmedRevenue.toString()),
        contractCount: inflowStats._count,
        refundCount: outflowStats._count,
        lessonCount: lessonStats._count,
        settledById: operatorId,
        settledAt: new Date(),
        snapshotData: {
          settleDate,
          inflowDetails: inflowStats,
          outflowDetails: outflowStats,
          lessonDetails: lessonStats,
        },
      },
    });

    return {
      message: '日结成功',
      report,
    };
  }

  /**
   * 获取日结报表列表
   */
  async getReports(startDate: string, endDate: string, campusId?: string) {
    const where: any = {
      reportDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };
    if (campusId) where.campusId = campusId;

    const reports = await this.prisma.dailyReport.findMany({
      where,
      include: {
        campus: { select: { id: true, name: true } },
        settledBy: { select: { id: true, realName: true } },
      },
      orderBy: { reportDate: 'desc' },
    });

    // 计算汇总
    const summary = {
      totalIncome: 0,
      totalRefund: 0,
      netIncome: 0,
      confirmedRevenue: 0,
    };

    reports.forEach((r) => {
      summary.totalIncome = DecimalUtil.toNumber(
        DecimalUtil.add(summary.totalIncome.toString(), r.totalIncome.toString())
      );
      summary.totalRefund = DecimalUtil.toNumber(
        DecimalUtil.add(summary.totalRefund.toString(), r.totalRefund.toString())
      );
      summary.netIncome = DecimalUtil.toNumber(
        DecimalUtil.add(summary.netIncome.toString(), r.netIncome.toString())
      );
      summary.confirmedRevenue = DecimalUtil.toNumber(
        DecimalUtil.add(summary.confirmedRevenue.toString(), r.confirmedRevenue.toString())
      );
    });

    return {
      reports,
      summary,
    };
  }
}

