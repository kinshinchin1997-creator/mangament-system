import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 收入确认服务
 * 
 * 职责：
 * 1. 计算预收款余额（负债）
 * 2. 计算已确认收入（消课转化）
 * 3. 收入确认分析
 */
@Injectable()
export class RevenueRecognitionService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取预收款余额（负债）
   * 
   * 计算逻辑：
   * 预收款余额 = 总收款金额 - 总退费金额 - 总消课金额
   */
  async getPrepaidBalance(campusId?: string) {
    const where: any = { status: 1 }; // 有效合同
    if (campusId) where.campusId = campusId;

    // 获取所有有效合同
    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        campus: { select: { id: true, name: true } },
      },
    });

    // 按校区汇总
    const campusStats = new Map<string, {
      campusId: string;
      campusName: string;
      totalPaid: number;
      totalConsumed: number;
      prepaidBalance: number;
    }>();

    contracts.forEach((c) => {
      const campusKey = c.campus.id;
      if (!campusStats.has(campusKey)) {
        campusStats.set(campusKey, {
          campusId: c.campus.id,
          campusName: c.campus.name,
          totalPaid: 0,
          totalConsumed: 0,
          prepaidBalance: 0,
        });
      }

      const stats = campusStats.get(campusKey)!;

      // 每节课单价
      const unitPrice = DecimalUtil.toNumber(
        DecimalUtil.divide(c.paidAmount.toString(), c.totalLessons.toString())
      );

      // 已消费金额
      const consumedAmount = DecimalUtil.toNumber(
        DecimalUtil.multiply(unitPrice.toString(), c.usedLessons.toString())
      );

      stats.totalPaid = DecimalUtil.toNumber(
        DecimalUtil.add(stats.totalPaid.toString(), c.paidAmount.toString())
      );
      stats.totalConsumed = DecimalUtil.toNumber(
        DecimalUtil.add(stats.totalConsumed.toString(), consumedAmount.toString())
      );
    });

    // 计算预收余额
    campusStats.forEach((stats) => {
      stats.prepaidBalance = DecimalUtil.toNumber(
        DecimalUtil.subtract(stats.totalPaid.toString(), stats.totalConsumed.toString())
      );
    });

    const result = Array.from(campusStats.values());

    // 总计
    const total = {
      totalPaid: 0,
      totalConsumed: 0,
      prepaidBalance: 0,
    };

    result.forEach((r) => {
      total.totalPaid = DecimalUtil.toNumber(
        DecimalUtil.add(total.totalPaid.toString(), r.totalPaid.toString())
      );
      total.totalConsumed = DecimalUtil.toNumber(
        DecimalUtil.add(total.totalConsumed.toString(), r.totalConsumed.toString())
      );
      total.prepaidBalance = DecimalUtil.toNumber(
        DecimalUtil.add(total.prepaidBalance.toString(), r.prepaidBalance.toString())
      );
    });

    return {
      byCampus: result,
      total,
    };
  }

  /**
   * 获取已确认收入（消课转化）
   */
  async getRecognizedRevenue(startDate: string, endDate: string, campusId?: string) {
    const where: any = {
      lessonDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
      status: 1, // 正常状态
    };
    if (campusId) where.campusId = campusId;

    // 获取消课记录
    const lessons = await this.prisma.lesson.findMany({
      where,
      include: {
        campus: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
      },
    });

    // 按校区汇总
    const campusStats = new Map<string, {
      campusId: string;
      campusName: string;
      lessonCount: number;
      recognizedRevenue: number;
    }>();

    lessons.forEach((l) => {
      const campusKey = l.campus.id;
      if (!campusStats.has(campusKey)) {
        campusStats.set(campusKey, {
          campusId: l.campus.id,
          campusName: l.campus.name,
          lessonCount: 0,
          recognizedRevenue: 0,
        });
      }

      const stats = campusStats.get(campusKey)!;
      stats.lessonCount += l.lessonCount;
      stats.recognizedRevenue = DecimalUtil.toNumber(
        DecimalUtil.add(stats.recognizedRevenue.toString(), l.lessonAmount.toString())
      );
    });

    const result = Array.from(campusStats.values());

    // 总计
    const total = {
      lessonCount: 0,
      recognizedRevenue: 0,
    };

    result.forEach((r) => {
      total.lessonCount += r.lessonCount;
      total.recognizedRevenue = DecimalUtil.toNumber(
        DecimalUtil.add(total.recognizedRevenue.toString(), r.recognizedRevenue.toString())
      );
    });

    return {
      byCampus: result,
      total,
      period: { startDate, endDate },
    };
  }
}

