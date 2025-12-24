import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryCashflowDto, CashflowSummaryDto, RecordInflowDto, RecordOutflowDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { Prisma } from '@prisma/client';

/**
 * 现金流核心服务
 * 
 * 核心职责：
 * 1. 记录资金流入（合同收款）
 * 2. 记录资金流出（退费）
 * 3. 现金流查询与分析
 * 4. 预收款 -> 确认收入 转换计算
 */
@Injectable()
export class CashflowService {
  constructor(private prisma: PrismaService) {}

  /**
   * 记录资金流入（内部调用，事务中使用）
   * 
   * @param tx Prisma事务
   * @param data 流入数据
   */
  async recordInflow(tx: Prisma.TransactionClient, data: RecordInflowDto) {
    const flowNo = NumberGenerator.generateCashFlowNo();

    return tx.cashFlow.create({
      data: {
        flowNo,
        direction: 1, // 流入
        bizType: data.bizType,
        bizId: data.bizId,
        bizNo: data.bizNo,
        contractId: data.contractId,
        amount: data.amount,
        payMethod: data.payMethod,
        campusId: data.campusId,
        createdById: data.createdById,
        remark: data.remark,
        snapshotData: data.snapshotData || {},
      },
    });
  }

  /**
   * 记录资金流出（内部调用，事务中使用）
   * 
   * @param tx Prisma事务
   * @param data 流出数据
   */
  async recordOutflow(tx: Prisma.TransactionClient, data: RecordOutflowDto) {
    const flowNo = NumberGenerator.generateCashFlowNo();

    return tx.cashFlow.create({
      data: {
        flowNo,
        direction: -1, // 流出
        bizType: data.bizType,
        bizId: data.bizId,
        bizNo: data.bizNo,
        contractId: data.contractId,
        refundId: data.refundId,
        amount: data.amount,
        payMethod: data.payMethod,
        campusId: data.campusId,
        createdById: data.createdById,
        remark: data.remark,
        snapshotData: data.snapshotData || {},
      },
    });
  }

  /**
   * 查询现金流记录
   */
  async findAll(query: QueryCashflowDto) {
    const {
      page = 1,
      pageSize = 20,
      campusId,
      direction,
      bizType,
      startDate,
      endDate,
      keyword,
    } = query;

    const where: any = {};

    if (campusId) where.campusId = campusId;
    if (direction) where.direction = direction;
    if (bizType) where.bizType = bizType;

    if (keyword) {
      where.OR = [
        { flowNo: { contains: keyword } },
        { bizNo: { contains: keyword } },
        { remark: { contains: keyword } },
      ];
    }

    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.cashFlow.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: {
            include: {
              student: { select: { id: true, name: true } },
            },
          },
          refund: true,
          campus: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cashFlow.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 现金流汇总
   */
  async getSummary(query: CashflowSummaryDto) {
    const { campusId, startDate, endDate } = query;

    const where: any = {};
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // 流入总额
    const inflowStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: 1 },
      _sum: { amount: true },
      _count: true,
    });

    // 流出总额
    const outflowStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: -1 },
      _sum: { amount: true },
      _count: true,
    });

    const totalInflow = inflowStats._sum.amount || 0;
    const totalOutflow = outflowStats._sum.amount || 0;
    const netCashflow = DecimalUtil.subtract(totalInflow.toString(), totalOutflow.toString());

    return {
      totalInflow: DecimalUtil.toNumber(totalInflow.toString()),
      inflowCount: inflowStats._count,
      totalOutflow: DecimalUtil.toNumber(totalOutflow.toString()),
      outflowCount: outflowStats._count,
      netCashflow: DecimalUtil.toNumber(netCashflow),
    };
  }

  /**
   * 现金流趋势
   */
  async getCashflowTrend(period: 'day' | 'week' | 'month', days: number, campusId?: string) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: any = {
      createdAt: { gte: startDate },
    };
    if (campusId) where.campusId = campusId;

    // 获取原始数据
    const records = await this.prisma.cashFlow.findMany({
      where,
      select: {
        direction: true,
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 按日期分组
    const dateMap = new Map<string, { inflow: number; outflow: number }>();

    records.forEach((r) => {
      const dateKey = r.createdAt.toISOString().slice(0, 10);
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { inflow: 0, outflow: 0 });
      }
      const stat = dateMap.get(dateKey)!;
      const amount = Number(r.amount);
      if (r.direction === 1) {
        stat.inflow = DecimalUtil.toNumber(DecimalUtil.add(stat.inflow.toString(), amount.toString()));
      } else {
        stat.outflow = DecimalUtil.toNumber(DecimalUtil.add(stat.outflow.toString(), amount.toString()));
      }
    });

    // 转换为数组
    const trend = Array.from(dateMap.entries())
      .map(([date, stats]) => ({
        date,
        inflow: stats.inflow,
        outflow: stats.outflow,
        net: DecimalUtil.toNumber(DecimalUtil.subtract(stats.inflow.toString(), stats.outflow.toString())),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return trend;
  }

  /**
   * 按业务类型分组统计
   */
  async groupByBizType(startDate: string, endDate: string, campusId?: string) {
    const where: any = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };
    if (campusId) where.campusId = campusId;

    const result = await this.prisma.cashFlow.groupBy({
      by: ['bizType', 'direction'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const bizTypeNames: Record<string, string> = {
      CONTRACT: '合同收款',
      REFUND: '退费',
      LESSON: '消课确收',
    };

    return result.map((r) => ({
      bizType: r.bizType,
      bizTypeName: bizTypeNames[r.bizType] || r.bizType,
      direction: r.direction === 1 ? '流入' : '流出',
      count: r._count,
      amount: r._sum.amount,
    }));
  }

  /**
   * 按校区分组统计
   */
  async groupByCampus(startDate: string, endDate: string) {
    const where: any = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    const result = await this.prisma.cashFlow.groupBy({
      by: ['campusId', 'direction'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    // 获取校区信息
    const campusIds = [...new Set(result.map((r) => r.campusId))];
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: campusIds } },
      select: { id: true, name: true },
    });

    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));

    return result.map((r) => ({
      campusId: r.campusId,
      campusName: campusMap.get(r.campusId) || '未知',
      direction: r.direction === 1 ? '流入' : '流出',
      count: r._count,
      amount: r._sum.amount,
    }));
  }
}

