import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportQueryDto } from '../dto';
import { DecimalUtil } from '../../../common/utils';

/**
 * 校区对比报表服务
 */
@Injectable()
export class CampusComparisonService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取校区综合对比
   */
  async getComparison(query: ReportQueryDto) {
    const campuses = await this.prisma.campus.findMany({
      where: { status: 1 },
    });

    const dateFilter = this.buildDateFilter(query);

    const result = await Promise.all(
      campuses.map(async (campus) => {
        // 新签合同
        const contracts = await this.prisma.contract.aggregate({
          where: { campusId: campus.id, ...dateFilter },
          _count: true,
          _sum: { paidAmount: true },
        });

        // 消课（确认收入）
        const lessons = await this.prisma.lessonRecord.aggregate({
          where: {
            campusId: campus.id,
            status: 1,
            ...(dateFilter.createdAt ? { attendDate: dateFilter.createdAt } : {}),
          },
          _count: true,
          _sum: { consumedCount: true, consumedAmount: true },
        });

        // 退费
        const refunds = await this.prisma.refund.aggregate({
          where: {
            campusId: campus.id,
            status: 3, // 已完成
            ...dateFilter,
          },
          _count: true,
          _sum: { actualAmount: true },
        });

        // 当前预收款余额
        const activeContracts = await this.prisma.contract.findMany({
          where: { campusId: campus.id, status: 1 },
          select: { paidAmount: true, totalLessons: true, remainLessons: true },
        });

        let prepaidBalance = 0;
        for (const c of activeContracts) {
          const unitPrice = c.paidAmount.toNumber() / c.totalLessons;
          prepaidBalance += unitPrice * c.remainLessons;
        }

        return {
          campusId: campus.id,
          campusName: campus.name,
          // 新签
          newContracts: contracts._count,
          contractAmount: DecimalUtil.format((contracts._sum.paidAmount?.toNumber() || 0).toString()),
          // 消课
          lessonRecords: lessons._count,
          lessonCount: lessons._sum?.consumedCount || 0,
          lessonAmount: DecimalUtil.format((lessons._sum?.consumedAmount?.toNumber() || 0).toString()),
          // 退费
          refundCount: refunds._count,
          refundAmount: DecimalUtil.format((refunds._sum.actualAmount?.toNumber() || 0).toString()),
          // 预收款余额
          prepaidBalance: DecimalUtil.format(prepaidBalance.toString()),
        };
      }),
    );

    return result;
  }

  /**
   * 获取校区排名
   */
  async getRanking(query: ReportQueryDto, metric: string = 'revenue') {
    const comparison = await this.getComparison(query);

    // 根据指标排序
    const sorted = [...comparison].sort((a, b) => {
      switch (metric) {
        case 'revenue':
          return parseFloat(b.lessonAmount) - parseFloat(a.lessonAmount);
        case 'contracts':
          return b.newContracts - a.newContracts;
        case 'contractAmount':
          return parseFloat(b.contractAmount) - parseFloat(a.contractAmount);
        case 'prepaidBalance':
          return parseFloat(b.prepaidBalance) - parseFloat(a.prepaidBalance);
        default:
          return parseFloat(b.lessonAmount) - parseFloat(a.lessonAmount);
      }
    });

    return sorted.map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
  }

  private buildDateFilter(query: ReportQueryDto) {
    const filter: any = {};
    if (query.startDate && query.endDate) {
      filter.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }
    return filter;
  }
}
