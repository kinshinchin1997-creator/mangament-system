import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { CashflowService } from '../cashflow/cashflow.service';

/**
 * 退费服务
 * 
 * 核心职责：
 * 1. 退费预览（计算可退金额）
 * 2. 退费申请
 * 3. 退费审批
 * 4. 退费打款确认
 * 5. 生成资金流出记录
 */
@Injectable()
export class RefundService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => CashflowService))
    private cashflowService: CashflowService,
  ) {}

  /**
   * 退费预览
   * 
   * 计算公式：
   * 可退金额 = 剩余课时 × 课单价
   * 课单价 = 实付金额 / 总课时
   */
  async preview(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { student: true, package: true, campus: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态，无法退费');

    const unitPrice = DecimalUtil.divide(contract.paidAmount.toString(), contract.totalLessons.toString());
    const refundableAmount = DecimalUtil.multiply(unitPrice, contract.remainLessons.toString());

    return {
      contract: {
        id: contract.id,
        contractNo: contract.contractNo,
        studentName: contract.student.name,
        packageName: contract.package.name,
        campusName: contract.campus.name,
      },
      calculation: {
        totalLessons: contract.totalLessons,
        usedLessons: contract.usedLessons,
        remainLessons: contract.remainLessons,
        paidAmount: Number(contract.paidAmount),
        unitPrice: DecimalUtil.toNumber(unitPrice),
        refundableAmount: DecimalUtil.toNumber(refundableAmount),
      },
    };
  }

  /**
   * 创建退费申请
   */
  async create(createDto: any, currentUser: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { student: true, package: true, campus: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态，无法退费');

    // 检查是否有进行中的退费
    const existingRefund = await this.prisma.refund.findFirst({
      where: { contractId: createDto.contractId, status: { in: [0, 1] } },
    });
    if (existingRefund) throw new BadRequestException('该合同已有进行中的退费申请');

    // 计算金额
    const unitPrice = DecimalUtil.divide(contract.paidAmount.toString(), contract.totalLessons.toString());
    const refundableAmount = DecimalUtil.multiply(unitPrice, contract.remainLessons.toString());
    const deductAmount = createDto.deductAmount || 0;
    const actualAmount = DecimalUtil.subtract(refundableAmount, deductAmount.toString());

    if (DecimalUtil.lt(actualAmount, '0')) {
      throw new BadRequestException('扣除金额不能大于可退金额');
    }

    const refundNo = NumberGenerator.generateRefundNo();

    const refund = await this.prisma.refund.create({
      data: {
        refundNo,
        contractId: createDto.contractId,
        campusId: contract.campusId,
        remainLessons: contract.remainLessons,
        unitPrice: DecimalUtil.toNumber(unitPrice),
        refundableAmount: DecimalUtil.toNumber(refundableAmount),
        deductAmount: DecimalUtil.toNumber(deductAmount.toString()),
        actualAmount: DecimalUtil.toNumber(actualAmount),
        reason: createDto.reason,
        refundType: createDto.refundType || 'NORMAL',
        status: 0, // 待审批
        createdById: currentUser.userId,
        snapshotData: {
          contract: {
            id: contract.id,
            contractNo: contract.contractNo,
            paidAmount: contract.paidAmount,
            totalLessons: contract.totalLessons,
            remainLessons: contract.remainLessons,
          },
          student: {
            id: contract.student.id,
            name: contract.student.name,
          },
          package: {
            id: contract.package.id,
            name: contract.package.name,
          },
        },
      },
    });

    return this.findOne(refund.id);
  }

  /**
   * 查询退费列表
   */
  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, status, refundType, startDate, endDate } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { refundNo: { contains: keyword } },
        { contract: { contractNo: { contains: keyword } } },
      ];
    }
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;
    if (refundType) where.refundType = refundType;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contract: {
            include: {
              student: { select: { id: true, name: true, code: true } },
              package: { select: { id: true, name: true } },
            },
          },
          campus: { select: { id: true, name: true } },
          createdBy: { select: { id: true, realName: true } },
          approvedBy: { select: { id: true, realName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取待审批列表
   */
  async findPending() {
    return this.prisma.refund.findMany({
      where: { status: 0 },
      include: {
        contract: {
          include: {
            student: { select: { id: true, name: true, code: true } },
            campus: { select: { id: true, name: true } },
            package: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 获取退费详情
   */
  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        contract: { include: { student: true, campus: true, package: true } },
        campus: true,
        createdBy: { select: { id: true, realName: true } },
        approvedBy: { select: { id: true, realName: true } },
      },
    });
    if (!refund) throw new NotFoundException('退费申请不存在');
    return refund;
  }

  /**
   * 审批退费
   */
  async approve(id: string, approveDto: any, currentUser: any) {
    const refund = await this.findOne(id);
    if (refund.status !== 0) throw new BadRequestException('该退费申请不是待审批状态');

    const newStatus = approveDto.approved ? 1 : 2; // 1=已通过 2=已拒绝

    return this.prisma.refund.update({
      where: { id },
      data: {
        status: newStatus,
        approvedAt: new Date(),
        approvedById: currentUser.userId,
        approveRemark: approveDto.remark,
        // 允许调整实际退款金额
        actualAmount: approveDto.actualAmount
          ? DecimalUtil.toNumber(approveDto.actualAmount.toString())
          : undefined,
      },
    });
  }

  /**
   * 完成退费打款
   * 
   * 业务流程：
   * 1. 标记退费完成
   * 2. 更新合同状态为已退费
   * 3. 生成资金流出记录
   */
  async complete(id: string, completeDto: any, currentUser: any) {
    const refund = await this.findOne(id);
    if (refund.status !== 1) throw new BadRequestException('该退费申请不是已通过待打款状态');

    await this.prisma.$transaction(async (tx) => {
      // 更新退费状态
      await tx.refund.update({
        where: { id },
        data: {
          status: 3, // 已完成
          refundMethod: completeDto.refundMethod,
          refundAccount: completeDto.refundAccount,
          refundTime: new Date(),
        },
      });

      // 更新合同状态
      await tx.contract.update({
        where: { id: refund.contractId },
        data: { status: 3 }, // 已退费
      });

      // 生成资金流出记录
      await this.cashflowService.recordOutflow(tx, {
        bizType: 'REFUND',
        bizId: refund.id,
        bizNo: refund.refundNo,
        contractId: refund.contractId,
        refundId: refund.id,
        amount: Number(refund.actualAmount),
        payMethod: completeDto.refundMethod,
        campusId: refund.campusId,
        createdById: currentUser.userId,
        remark: `退费: ${refund.refundNo}`,
        snapshotData: refund.snapshotData as Record<string, any> | undefined,
      });
    });

    return this.findOne(id);
  }

  /**
   * 退费统计
   */
  async getStatistics(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 3 }; // 只统计已完成

    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.refundTime = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const stats = await this.prisma.refund.aggregate({
      where,
      _count: true,
      _sum: { actualAmount: true, remainLessons: true },
    });

    // 按退费类型统计
    const byType = await this.prisma.refund.groupBy({
      by: ['refundType'],
      where,
      _count: true,
      _sum: { actualAmount: true },
    });

    return {
      summary: {
        totalCount: stats._count,
        totalAmount: stats._sum.actualAmount || 0,
        totalLessons: stats._sum.remainLessons || 0,
      },
      byType: byType.map((t) => ({
        type: t.refundType,
        typeName: this.getRefundTypeName(t.refundType),
        count: t._count,
        amount: t._sum.actualAmount || 0,
      })),
    };
  }

  private getRefundTypeName(type: string): string {
    const types: Record<string, string> = {
      NORMAL: '正常退费',
      TRANSFER: '转校退',
      TERMINATE: '终止合作',
    };
    return types[type] || type;
  }
}
