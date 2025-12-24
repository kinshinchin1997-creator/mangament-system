import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportQueryDto } from '../dto';
import { DecimalUtil } from '../../../common/utils';

/**
 * 收入确认报表服务
 * 
 * 消课 = 收入确认
 * 每次消课都是将预收款转为已确认收入
 */
@Injectable()
export class RevenueRecognitionService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取收入确认汇总
   */
  async getSummary(query: ReportQueryDto) {
    const where = this.buildWhere(query);

    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
    });

    return {
      totalRecords: summary._count,
      totalLessons: summary._sum.lessonCount?.toNumber() || 0,
      totalRevenue: DecimalUtil.format((summary._sum.lessonAmount?.toNumber() || 0).toString()),
    };
  }

  /**
   * 按日期趋势统计
   */
  async getByDate(query: ReportQueryDto) {
    const where = this.buildWhere(query);

    const records = await this.prisma.lessonRecord.groupBy({
      by: ['lessonDate'],
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
      orderBy: { lessonDate: 'asc' },
    });

    return records.map((r) => ({
      date: r.lessonDate,
      recordCount: r._count,
      lessonCount: r._sum.lessonCount?.toNumber() || 0,
      revenue: DecimalUtil.format((r._sum.lessonAmount?.toNumber() || 0).toString()),
    }));
  }

  /**
   * 按课包分类统计
   */
  async getByPackage(query: ReportQueryDto) {
    const where = this.buildWhere(query);

    const records = await this.prisma.lessonRecord.findMany({
      where,
      include: {
        contract: {
          include: {
            package: { select: { id: true, name: true, category: true } },
          },
        },
      },
    });

    const categoryMap = new Map<string, any>();

    for (const record of records) {
      const category = record.contract.package.category;

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          category,
          recordCount: 0,
          lessonCount: 0,
          revenue: 0,
        });
      }

      const cat = categoryMap.get(category);
      cat.recordCount++;
      cat.lessonCount += record.lessonCount.toNumber();
      cat.revenue += record.lessonAmount.toNumber();
    }

    return Array.from(categoryMap.values()).map((cat) => ({
      ...cat,
      revenue: DecimalUtil.format(cat.revenue.toString()),
    }));
  }

  /**
   * 获取今日收入
   */
  async getToday(campusId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = {
      status: 1,
      lessonDate: { gte: today, lt: tomorrow },
    };
    if (campusId) where.contract = { campusId };

    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
    });

    return {
      date: today.toISOString().slice(0, 10),
      recordCount: summary._count,
      lessonCount: summary._sum.lessonCount?.toNumber() || 0,
      revenue: DecimalUtil.format((summary._sum.lessonAmount?.toNumber() || 0).toString()),
    };
  }

  /**
   * 获取本月收入
   */
  async getThisMonth(campusId?: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const where: any = {
      status: 1,
      lessonDate: { gte: startOfMonth, lt: startOfNextMonth },
    };
    if (campusId) where.contract = { campusId };

    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
    });

    return {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      recordCount: summary._count,
      lessonCount: summary._sum.lessonCount?.toNumber() || 0,
      revenue: DecimalUtil.format((summary._sum.lessonAmount?.toNumber() || 0).toString()),
    };
  }

  private buildWhere(query: ReportQueryDto) {
    const where: any = { status: 1 };

    if (query.campusId) {
      where.contract = { campusId: query.campusId };
    }

    if (query.startDate && query.endDate) {
      where.lessonDate = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    return where;
  }
}

