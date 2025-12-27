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
 * 1. 收款记录查询（通过Payment表）
 * 2. 退费记录查询（通过Refund表）
 * 3. 现金流汇总分析
 * 4. 预收款余额计算
 */
@Injectable()
export class CashflowService {
  constructor(private prisma: PrismaService) {}

  /**
   * 记录资金流入（收款）
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
   * 记录资金流出（退费）- 通过Refund表完成
   */
  async recordOutflow(tx: Prisma.TransactionClient, data: RecordOutflowDto) {
    // 退费通过Refund表的状态更新完成，不需要单独的现金流出记录
    // 此方法保留接口兼容性
    return { success: true };
  }

  /**
   * 获取收款流水（Payment）
   */
  async getPaymentRecords(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate, keyword } = query;

    const where: any = { status: 1 };

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
        lte: new Date(endDate),
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
   * 获取退费流水（Refund）
   */
  async getRefundRecords(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate, keyword } = query;

    const where: any = { status: 3 }; // 已完成的退费

    if (campusId) where.campusId = campusId;
    if (keyword) {
      where.OR = [
        { refundNo: { contains: keyword } },
      ];
    }
    if (startDate && endDate) {
      where.refundedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
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

    const paymentWhere: any = { status: 1 };
    const refundWhere: any = { status: 3 };
    
    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }
    if (startDate && endDate) {
      paymentWhere.paidAt = { gte: new Date(startDate), lte: new Date(endDate) };
      refundWhere.refundedAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // 收款统计
    const inflowStats = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    // 退费统计
    const outflowStats = await this.prisma.refund.aggregate({
      where: refundWhere,
      _sum: { actualAmount: true },
      _count: true,
    });

    const totalInflow = inflowStats._sum.amount || 0;
    const totalOutflow = outflowStats._sum.actualAmount || 0;
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

    const paymentWhere: any = { status: 1, paidAt: { gte: startDate } };
    const refundWhere: any = { status: 3, refundedAt: { gte: startDate } };
    
    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    // 获取收款数据
    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      select: { amount: true, paidAt: true },
      orderBy: { paidAt: 'asc' },
    });

    // 获取退费数据
    const refunds = await this.prisma.refund.findMany({
      where: refundWhere,
      select: { actualAmount: true, refundedAt: true },
      orderBy: { refundedAt: 'asc' },
    });

    // 按日期分组
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
   * 按校区分组统计
   */
  async groupByCampus(startDate: string, endDate: string) {
    const paymentWhere: any = {
      status: 1,
      paidAt: { gte: new Date(startDate), lte: new Date(endDate) },
    };
    const refundWhere: any = {
      status: 3,
      refundedAt: { gte: new Date(startDate), lte: new Date(endDate) },
    };

    const paymentResult = await this.prisma.payment.groupBy({
      by: ['campusId'],
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    const refundResult = await this.prisma.refund.groupBy({
      by: ['campusId'],
      where: refundWhere,
      _sum: { actualAmount: true },
      _count: true,
    });

    // 获取校区信息
    const allCampusIds = [...new Set([
      ...paymentResult.map((r) => r.campusId),
      ...refundResult.map((r) => r.campusId),
    ])];
    
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: allCampusIds } },
      select: { id: true, name: true },
    });
    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));

    // 合并结果
    const resultMap = new Map<string, { campusId: string; campusName: string; inflow: number; outflow: number; inflowCount: number; outflowCount: number }>();

    paymentResult.forEach((p) => {
      if (!resultMap.has(p.campusId)) {
        resultMap.set(p.campusId, {
          campusId: p.campusId,
          campusName: campusMap.get(p.campusId) || '未知',
          inflow: 0,
          outflow: 0,
          inflowCount: 0,
          outflowCount: 0,
        });
      }
      const item = resultMap.get(p.campusId)!;
      item.inflow = Number(p._sum.amount || 0);
      item.inflowCount = p._count;
    });

    refundResult.forEach((r) => {
      if (!resultMap.has(r.campusId)) {
        resultMap.set(r.campusId, {
          campusId: r.campusId,
          campusName: campusMap.get(r.campusId) || '未知',
          inflow: 0,
          outflow: 0,
          inflowCount: 0,
          outflowCount: 0,
        });
      }
      const item = resultMap.get(r.campusId)!;
      item.outflow = Number(r._sum.actualAmount || 0);
      item.outflowCount = r._count;
    });

    return Array.from(resultMap.values()).map((item) => ({
      ...item,
      net: item.inflow - item.outflow,
    }));
  }

  /**
   * 获取预收款余额（未消课金额）
   */
  async getPrepaidBalance(campusId?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.aggregate({
      where,
      _sum: { unearned: true, paidAmount: true },
      _count: true,
    });

    // 按校区分组
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
      totalUnearned: contracts._sum.unearned || 0,
      totalPaid: contracts._sum.paidAmount || 0,
      contractCount: contracts._count,
      byCampus: byCampus.map((c) => ({
        campusId: c.campusId,
        campusName: campusMap.get(c.campusId) || '未知',
        unearned: c._sum.unearned || 0,
        contractCount: c._count,
      })),
    };
  }

  /**
   * 获取现金流记录列表（收款+退费综合）
   */
  async findAll(query: QueryCashflowDto) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate, keyword, flowType } = query;

    // 根据 flowType 决定返回什么类型的记录
    if (flowType === 'inflow' || !flowType) {
      return this.getPaymentRecords(query);
    } else if (flowType === 'outflow') {
      return this.getRefundRecords(query);
    }

    // 综合查询：返回收款和退费的综合视图
    // 创建大页查询对象以获取所有记录
    const largeQuery = Object.assign(Object.create(Object.getPrototypeOf(query)), query, { pageSize: 1000 });
    const [payments, refunds] = await Promise.all([
      this.getPaymentRecords(largeQuery),
      this.getRefundRecords(largeQuery),
    ]);

    // 合并并按时间排序
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
    const paymentWhere: any = {
      status: 1,
      paidAt: { gte: new Date(startDate), lte: new Date(endDate) },
    };
    if (campusId) paymentWhere.campusId = campusId;

    // 按收款类型分组
    const byPaymentType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

    // 按支付方式分组
    const byPayMethod = await this.prisma.payment.groupBy({
      by: ['payMethod'],
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    });

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
