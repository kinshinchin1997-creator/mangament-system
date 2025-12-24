import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { CashFlowService } from '../finance/cash-flow.service';

@Injectable()
export class RefundService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => CashFlowService))
    private cashFlowService: CashFlowService,
  ) {}

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
      },
      calculation: {
        totalLessons: contract.totalLessons,
        usedLessons: contract.usedLessons,
        remainLessons: contract.remainLessons,
        paidAmount: contract.paidAmount,
        unitPrice,
        refundableAmount,
      },
    };
  }

  async create(createDto: any, currentUser: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { student: true, package: true, campus: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态，无法退费');

    const existingRefund = await this.prisma.refund.findFirst({
      where: { contractId: createDto.contractId, status: { in: [0, 1] } },
    });
    if (existingRefund) throw new BadRequestException('该合同已有进行中的退费申请');

    const unitPrice = DecimalUtil.divide(contract.paidAmount.toString(), contract.totalLessons.toString());
    const refundableAmount = DecimalUtil.multiply(unitPrice, contract.remainLessons.toString());
    const deductAmount = createDto.deductAmount || 0;
    const actualAmount = DecimalUtil.subtract(refundableAmount, deductAmount.toString());

    if (DecimalUtil.lt(actualAmount, '0')) throw new BadRequestException('扣除金额不能大于可退金额');

    const refundNo = NumberGenerator.generateRefundNo();
    const refund = await this.prisma.refund.create({
      data: {
        refundNo,
        contractId: createDto.contractId,
        remainLessons: contract.remainLessons,
        unitPrice: DecimalUtil.toNumber(unitPrice),
        refundablAmount: DecimalUtil.toNumber(refundableAmount),
        deductAmount: DecimalUtil.toNumber(deductAmount.toString()),
        actualAmount: DecimalUtil.toNumber(actualAmount),
        reason: createDto.reason,
        refundType: createDto.refundType,
        status: 0,
        snapshotData: { contract, student: contract.student, package: contract.package },
      },
    });

    return this.findOne(refund.id);
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, status, refundType, startDate, endDate } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { refundNo: { contains: keyword } },
        { contract: { contractNo: { contains: keyword } } },
      ];
    }
    if (campusId) where.contract = { ...where.contract, campusId };
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
              campus: { select: { id: true, name: true } },
              package: { select: { id: true, name: true } },
            },
          },
          approvedBy: { select: { id: true, realName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

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

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        contract: { include: { student: true, campus: true, package: true } },
        approvedBy: { select: { id: true, realName: true } },
      },
    });
    if (!refund) throw new NotFoundException('退费申请不存在');
    return refund;
  }

  async approve(id: string, approveDto: any, currentUser: any) {
    const refund = await this.findOne(id);
    if (refund.status !== 0) throw new BadRequestException('该退费申请不是待审批状态');

    const newStatus = approveDto.approved ? 1 : 2;
    return this.prisma.refund.update({
      where: { id },
      data: {
        status: newStatus,
        approvedAt: new Date(),
        approvedById: currentUser.userId,
        approveRemark: approveDto.remark,
        actualAmount: approveDto.actualAmount ? DecimalUtil.toNumber(approveDto.actualAmount.toString()) : undefined,
      },
    });
  }

  async complete(id: string, completeDto: any, currentUser: any) {
    const refund = await this.findOne(id);
    if (refund.status !== 1) throw new BadRequestException('该退费申请不是已通过待打款状态');

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id },
        data: {
          status: 3,
          refundMethod: completeDto.refundMethod,
          refundAccount: completeDto.refundAccount,
          refundTime: new Date(),
        },
      });

      await tx.contract.update({
        where: { id: refund.contractId },
        data: { status: 3 },
      });

      await this.cashFlowService.createRefundOutflow(tx, refund, currentUser.userId);
    });

    return this.findOne(id);
  }
}

