import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';

@Injectable()
export class CashFlowService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建合同收款流水（收入）
   */
  async createContractInflow(tx: any, contract: any, userId: string) {
    const lastFlow = await tx.cashFlow.findFirst({
      where: { campusId: contract.campusId },
      orderBy: { createdAt: 'desc' },
    });

    const beforeBalance = lastFlow?.afterBalance?.toNumber() || 0;
    const afterBalance = DecimalUtil.add(beforeBalance.toString(), contract.paidAmount.toString());
    const flowNo = NumberGenerator.generateCashFlowNo();

    return tx.cashFlow.create({
      data: {
        flowNo,
        bizType: 'CONTRACT',
        bizId: contract.id,
        bizNo: contract.contractNo,
        contractId: contract.id,
        direction: 1,
        amount: contract.paidAmount,
        beforeBalance,
        afterBalance: DecimalUtil.toNumber(afterBalance),
        payMethod: contract.payMethod,
        campusId: contract.campusId,
        createdById: userId,
        remark: `合同收款: ${contract.contractNo}`,
      },
    });
  }

  /**
   * 创建退费流水（支出）
   */
  async createRefundOutflow(tx: any, refund: any, userId: string) {
    const contract = refund.contract;

    const lastFlow = await tx.cashFlow.findFirst({
      where: { campusId: contract.campusId },
      orderBy: { createdAt: 'desc' },
    });

    const beforeBalance = lastFlow?.afterBalance?.toNumber() || 0;
    const afterBalance = DecimalUtil.subtract(beforeBalance.toString(), refund.actualAmount.toString());
    const flowNo = NumberGenerator.generateCashFlowNo();

    return tx.cashFlow.create({
      data: {
        flowNo,
        bizType: 'REFUND',
        bizId: refund.id,
        bizNo: refund.refundNo,
        contractId: contract.id,
        refundId: refund.id,
        direction: -1,
        amount: refund.actualAmount,
        beforeBalance,
        afterBalance: DecimalUtil.toNumber(afterBalance),
        payMethod: refund.refundMethod,
        campusId: contract.campusId,
        createdById: userId,
        remark: `退费支出: ${refund.refundNo}`,
      },
    });
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, campusId, bizType, direction, startDate, endDate } = query;
    const where: any = {};

    if (campusId) where.campusId = campusId;
    if (bizType) where.bizType = bizType;
    if (direction !== undefined) where.direction = direction;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [data, total] = await Promise.all([
      this.prisma.cashFlow.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: { select: { id: true, contractNo: true, student: { select: { id: true, name: true } } } },
          refund: { select: { id: true, refundNo: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cashFlow.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async getSummary(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const incomeStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: 1 },
      _count: true,
      _sum: { amount: true },
    });

    const expenseStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: -1 },
      _count: true,
      _sum: { amount: true },
    });

    const latestFlow = await this.prisma.cashFlow.findFirst({
      where: campusId ? { campusId } : {},
      orderBy: { createdAt: 'desc' },
    });

    return {
      income: { count: incomeStats._count, total: incomeStats._sum.amount || 0 },
      expense: { count: expenseStats._count, total: expenseStats._sum.amount || 0 },
      netFlow: DecimalUtil.subtract(
        (incomeStats._sum.amount || 0).toString(),
        (expenseStats._sum.amount || 0).toString(),
      ),
      currentBalance: latestFlow?.afterBalance || 0,
    };
  }

  async getPrepaidBalanceReport(campusId?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    const contracts = await this.prisma.contract.findMany({
      where,
      include: { campus: { select: { id: true, name: true } } },
    });

    let totalPrepaidBalance = 0;
    const details = contracts.map((c) => {
      const unitPrice = c.paidAmount.toNumber() / c.totalLessons;
      const prepaidBalance = unitPrice * c.remainLessons;
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

  async getRevenueRecognitionReport(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 1 };
    if (campusId) where.contract = { campusId };
    if (startDate && endDate) {
      where.lessonDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
    });

    return {
      totalRecords: summary._count,
      totalLessons: summary._sum.lessonCount || 0,
      totalRevenue: summary._sum.lessonAmount || 0,
    };
  }
}

