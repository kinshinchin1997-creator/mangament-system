import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';

/**
 * 现金流服务
 * 
 * 使用 Payment 和 Refund 表替代独立的 CashFlow 表
 * - 流入：Payment 表记录
 * - 流出：Refund 表记录
 */
@Injectable()
export class CashFlowService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建合同收款流水（收入）- 内部使用
   */
  async createContractInflow(tx: any, contract: any, userId: string) {
    const paymentNo = NumberGenerator.generateCashFlowNo();

    return tx.payment.create({
      data: {
        paymentNo,
        contractId: contract.id,
        campusId: contract.campusId,
        amount: contract.paidAmount,
        payMethod: contract.payMethod || 'CASH',
        paymentType: 'SIGN',
        status: 1,
        paidAt: new Date(),
        createdById: userId,
        remark: `合同收款: ${contract.contractNo}`,
      },
    });
  }

  /**
   * 创建退费流水（支出）- 内部使用
   * 退费通过 Refund 表的状态完成，不需要单独创建记录
   */
  async createRefundOutflow(tx: any, refund: any, userId: string) {
    // 退费记录已在 Refund 表中，此方法保留接口兼容性
    return { success: true, refundId: refund.id };
  }

  /**
   * 查询现金流记录（合并 Payment 和 Refund）
   */
  async findAll(query: any) {
    const { page = 1, pageSize = 20, campusId, bizType, direction, startDate, endDate } = query;

    // 根据 direction 决定查询什么
    if (direction === 1 || bizType === 'CONTRACT') {
      // 只查收款
      return this.findPayments(query);
    } else if (direction === -1 || bizType === 'REFUND') {
      // 只查退费
      return this.findRefunds(query);
    }

    // 综合查询
    const [payments, refunds] = await Promise.all([
      this.findPaymentsRaw(campusId, startDate, endDate),
      this.findRefundsRaw(campusId, startDate, endDate),
    ]);

    const allRecords = [
      ...payments.map((p: any) => ({
        id: p.id,
        flowNo: p.paymentNo,
        bizType: 'CONTRACT',
        bizId: p.contractId,
        bizNo: p.paymentNo,
        direction: 1,
        amount: p.amount,
        payMethod: p.payMethod,
        campusId: p.campusId,
        createdAt: p.paidAt,
        contract: p.contract,
      })),
      ...refunds.map((r: any) => ({
        id: r.id,
        flowNo: r.refundNo,
        bizType: 'REFUND',
        bizId: r.id,
        bizNo: r.refundNo,
        direction: -1,
        amount: r.actualAmount,
        payMethod: r.refundMethod,
        campusId: r.campusId,
        createdAt: r.refundedAt,
        contract: r.contract,
        refund: r,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const startIdx = (page - 1) * pageSize;
    const paginatedRecords = allRecords.slice(startIdx, startIdx + pageSize);

    return new PaginatedResponseDto(paginatedRecords, allRecords.length, page, pageSize);
  }

  private async findPayments(query: any) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate } = query;
    const where: any = { status: 1 };

    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.paidAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: { select: { id: true, contractNo: true, student: { select: { id: true, name: true } } } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  private async findRefunds(query: any) {
    const { page = 1, pageSize = 20, campusId, startDate, endDate } = query;
    const where: any = { status: 3 }; // 已完成的退费

    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.refundedAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: { select: { id: true, contractNo: true, student: { select: { id: true, name: true } } } },
        },
        orderBy: { refundedAt: 'desc' },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  private async findPaymentsRaw(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.paidAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    return this.prisma.payment.findMany({
      where,
      include: {
        contract: { select: { id: true, contractNo: true, student: { select: { id: true, name: true } } } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  private async findRefundsRaw(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 3 };
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.refundedAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    return this.prisma.refund.findMany({
      where,
      include: {
        contract: { select: { id: true, contractNo: true, student: { select: { id: true, name: true } } } },
      },
      orderBy: { refundedAt: 'desc' },
    });
  }

  /**
   * 现金流汇总
   */
  async getSummary(campusId?: string, startDate?: string, endDate?: string) {
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

    const incomeStats = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _count: true,
      _sum: { amount: true },
    });

    const expenseStats = await this.prisma.refund.aggregate({
      where: refundWhere,
      _count: true,
      _sum: { actualAmount: true },
    });

    const netFlow = DecimalUtil.subtract(
      (incomeStats._sum.amount || 0).toString(),
      (expenseStats._sum.actualAmount || 0).toString(),
    );

    return {
      income: { count: incomeStats._count, total: incomeStats._sum.amount || 0 },
      expense: { count: expenseStats._count, total: expenseStats._sum.actualAmount || 0 },
      netFlow: DecimalUtil.toNumber(netFlow),
    };
  }

  /**
   * 预收款余额报表
   */
  async getPrepaidBalanceReport(campusId?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      include: { campus: { select: { id: true, name: true } } },
    });

    let totalPrepaidBalance = 0;
    const details = contracts.map((c) => {
      const prepaidBalance = Number(c.unearned);
      totalPrepaidBalance += prepaidBalance;
      return {
        contractNo: c.contractNo,
        campusName: c.campus.name,
        remainLessons: c.remainLessons,
        prepaidBalance: DecimalUtil.format(prepaidBalance.toString()),
      };
    });

    return {
      totalPrepaidBalance: DecimalUtil.format(totalPrepaidBalance.toString()),
      totalContracts: contracts.length,
      details,
    };
  }

  /**
   * 收入确认报表
   */
  async getRevenueRecognitionReport(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.lessonDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const summary = await this.prisma.lesson.aggregate({
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
    });

    return {
      totalRecords: summary._count,
      totalLessons: summary._sum?.lessonCount || 0,
      totalRevenue: summary._sum?.lessonAmount || 0,
    };
  }
}
