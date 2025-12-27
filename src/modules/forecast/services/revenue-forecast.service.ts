import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 收入预测服务
 * 
 * 职责：
 * 1. 基于剩余课时预测未来确认收入
 * 2. 分析即将过期的合同
 * 3. 续费潜力分析
 */
@Injectable()
export class RevenueForecastService {
  constructor(private prisma: PrismaService) {}

  /**
   * 确认收入预测
   * 
   * 逻辑：
   * 1. 统计所有有效合同的剩余课时
   * 2. 按历史消课速度预测未来N个月的确认收入
   */
  async forecastRecognition(months: number, campusId?: string) {
    const where: any = { status: 1 }; // 有效合同
    if (campusId) where.campusId = campusId;

    // 获取有效合同
    const contracts = await this.prisma.contract.findMany({
      where,
      select: {
        id: true,
        paidAmount: true,
        totalLessons: true,
        remainLessons: true,
        unearned: true,
        startDate: true,
        endDate: true,
      },
    });

    // 计算剩余价值（使用 unearned 字段）
    let totalRemainValue = 0;
    contracts.forEach((c) => {
      totalRemainValue += Number(c.unearned);
    });

    // 获取历史月均消课速度
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const lessonWhere: any = { status: 1, lessonDate: { gte: sixMonthsAgo } };
    if (campusId) lessonWhere.campusId = campusId;

    const lessonStats = await this.prisma.lesson.aggregate({
      where: lessonWhere,
      _sum: { lessonAmount: true },
    });

    const totalConsumed = Number(lessonStats._sum.lessonAmount || 0);
    const monthlyConsumeRate = totalConsumed / 6;

    // 生成预测
    const forecast: Array<{
      month: string;
      predictedRevenue: number;
      cumulativeRevenue: number;
    }> = [];

    let cumulative = 0;
    let remainingValue = totalRemainValue;

    for (let i = 1; i <= months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);
      const monthStr = date.toISOString().slice(0, 7);

      // 当月可确认收入 = min(月均消课, 剩余价值)
      const monthRevenue = Math.min(monthlyConsumeRate, remainingValue);
      remainingValue -= monthRevenue;
      cumulative += monthRevenue;

      forecast.push({
        month: monthStr,
        predictedRevenue: Math.round(monthRevenue),
        cumulativeRevenue: Math.round(cumulative),
      });
    }

    return {
      forecast,
      summary: {
        totalRemainValue: Math.round(totalRemainValue),
        monthlyConsumeRate: Math.round(monthlyConsumeRate),
        activeContracts: contracts.length,
      },
    };
  }

  /**
   * 获取即将过期的合同（潜在收入流失）
   */
  async getExpiringContracts(days: number, campusId?: string) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const where: any = {
      status: 1,
      endDate: {
        gte: now,
        lte: futureDate,
      },
      remainLessons: { gt: 0 },
    };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, parentPhone: true } },
        campus: { select: { id: true, name: true } },
        package: { select: { id: true, name: true } },
      },
      orderBy: { endDate: 'asc' },
    });

    // 计算潜在流失金额
    let totalLostValue = 0;
    const result = contracts.map((c) => {
      const lostValue = Number(c.unearned);
      totalLostValue += lostValue;

      return {
        ...c,
        unitPrice: Number(c.unitPrice),
        lostValue: Math.round(lostValue),
        daysToExpire: Math.ceil((c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

    return {
      contracts: result,
      summary: {
        totalContracts: contracts.length,
        totalRemainLessons: contracts.reduce((sum, c) => sum + c.remainLessons, 0),
        totalLostValue: Math.round(totalLostValue),
      },
    };
  }
}
