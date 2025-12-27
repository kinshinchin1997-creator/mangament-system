import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto, QueryPaymentDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { Prisma } from '@prisma/client';

/**
 * 收款服务
 * 
 * 处理所有收款业务逻辑：
 * 1. 合同签约收款（产生预收款）
 * 2. 分期付款
 * 3. 续费收款
 */
@Injectable()
export class PaymentService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建收款记录（内部使用，事务中调用）
   */
  async createPayment(tx: Prisma.TransactionClient, data: {
    contractId: string;
    campusId: string;
    amount: number;
    payMethod: string;
    paymentType: string;
    createdById: string;
    remark?: string;
    transactionNo?: string;
  }) {
    const paymentNo = NumberGenerator.generateCashFlowNo();

    return tx.payment.create({
      data: {
        paymentNo,
        contractId: data.contractId,
        campusId: data.campusId,
        amount: data.amount,
        payMethod: data.payMethod,
        paymentType: data.paymentType,
        status: 1,
        paidAt: new Date(),
        createdById: data.createdById,
        remark: data.remark,
        transactionNo: data.transactionNo,
      },
    });
  }

  /**
   * 合同收款（签约/续费）- 创建合同并收款
   */
  async createContractPayment(createDto: CreatePaymentDto, currentUser: any) {
    // 获取课包信息
    const coursePackage = await this.prisma.coursePackage.findUnique({
      where: { id: createDto.packageId },
    });
    if (!coursePackage) throw new NotFoundException('课包不存在');
    if (coursePackage.status !== 1) throw new BadRequestException('该课包已停售');

    // 获取学员信息
    const student = await this.prisma.student.findUnique({
      where: { id: createDto.studentId },
    });
    if (!student) throw new NotFoundException('学员不存在');

    // 计算金额
    const discountAmount = createDto.discountAmount || 0;
    const contractAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(coursePackage.totalAmount.toString(), discountAmount.toString())
    );
    const unitPrice = DecimalUtil.toNumber(
      DecimalUtil.divide(contractAmount.toString(), coursePackage.totalLessons.toString())
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // 创建合同
      const contractNo = NumberGenerator.generateContractNo();
      const startDate = createDto.startDate ? new Date(createDto.startDate) : new Date();
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + coursePackage.validDays);

      const contract = await tx.contract.create({
        data: {
          contractNo,
          studentId: createDto.studentId,
          campusId: createDto.campusId,
          packageId: createDto.packageId,
          originalAmount: coursePackage.totalAmount,
          discountAmount,
          contractAmount,
          paidAmount: contractAmount,
          totalLessons: coursePackage.totalLessons,
          usedLessons: 0,
          remainLessons: coursePackage.totalLessons,
          unitPrice,
          unearned: contractAmount,
          startDate,
          endDate,
          status: 1,
          signedAt: new Date(),
          createdById: currentUser.userId,
          snapshotData: {
            package: coursePackage,
            student,
          },
          remark: createDto.remark,
        },
      });

      // 创建收款记录
      const payment = await this.createPayment(tx, {
        contractId: contract.id,
        campusId: createDto.campusId,
        amount: contractAmount,
        payMethod: createDto.payMethod,
        paymentType: 'SIGN',
        createdById: currentUser.userId,
        remark: createDto.remark,
      });

      return { contract, payment };
    });

    return result;
  }

  /**
   * 添加收款（合同分期/续费）
   */
  async addPayment(createDto: any, currentUser: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { student: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态');

    const remainingAmount = DecimalUtil.subtract(
      contract.contractAmount.toString(),
      contract.paidAmount.toString()
    );

    if (DecimalUtil.gt(createDto.amount.toString(), remainingAmount)) {
      throw new BadRequestException(`收款金额不能超过待收金额 ${remainingAmount}`);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      // 创建收款记录
      const newPayment = await this.createPayment(tx, {
        contractId: createDto.contractId,
        campusId: contract.campusId,
        amount: createDto.amount,
        payMethod: createDto.payMethod,
        paymentType: createDto.paymentType || 'INSTALLMENT',
        createdById: currentUser.userId,
        remark: createDto.remark,
        transactionNo: createDto.transactionNo,
      });

      // 更新合同已收金额
      const newPaidAmount = DecimalUtil.add(contract.paidAmount.toString(), createDto.amount.toString());
      
      // 更新未消课金额（如果之前未消课金额为0，现在收款后需要计算）
      const currentUnearned = contract.unearned.toNumber();
      let newUnearned = currentUnearned;
      
      if (currentUnearned === 0 && contract.remainLessons > 0) {
        // 首次收款或之前未设置未消课金额
        newUnearned = DecimalUtil.toNumber(
          DecimalUtil.multiply(contract.unitPrice.toString(), contract.remainLessons.toString())
        );
      }

      await tx.contract.update({
        where: { id: createDto.contractId },
        data: {
          paidAmount: DecimalUtil.toNumber(newPaidAmount),
          unearned: newUnearned,
        },
      });

      return newPayment;
    });

    return this.findOne(payment.id);
  }

  /**
   * 获取收款记录列表
   */
  async findAll(query: QueryPaymentDto) {
    const { page = 1, pageSize = 20, campusId, payMethod, paymentType, startDate, endDate, keyword } = query;

    const where: any = { status: 1 };

    if (campusId) where.campusId = campusId;
    if (payMethod) where.payMethod = payMethod;
    if (paymentType) where.paymentType = paymentType;

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
              student: { select: { id: true, name: true, code: true } },
              package: { select: { id: true, name: true } },
            },
          },
          campus: { select: { id: true, name: true } },
          createdBy: { select: { id: true, realName: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取收款详情
   */
  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            student: true,
            package: true,
          },
        },
        campus: true,
        createdBy: { select: { id: true, realName: true } },
      },
    });

    if (!payment) throw new NotFoundException('收款记录不存在');
    return payment;
  }

  /**
   * 收款统计
   */
  async getStatistics(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.paidAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // 收款统计
    const paymentStats = await this.prisma.payment.aggregate({
      where,
      _count: true,
      _sum: { amount: true },
    });

    // 按支付方式分组
    const byPayMethod = await this.prisma.payment.groupBy({
      by: ['payMethod'],
      where,
      _count: true,
      _sum: { amount: true },
    });

    // 按收款类型分组
    const byPaymentType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
      where,
      _count: true,
      _sum: { amount: true },
    });

    return {
      summary: {
        totalPayments: paymentStats._count,
        totalAmount: paymentStats._sum.amount || 0,
      },
      byPayMethod: byPayMethod.map((p) => ({
        payMethod: p.payMethod,
        payMethodName: this.getPayMethodName(p.payMethod),
        count: p._count,
        amount: p._sum.amount || 0,
      })),
      byPaymentType: byPaymentType.map((t) => ({
        paymentType: t.paymentType,
        paymentTypeName: this.getPaymentTypeName(t.paymentType),
        count: t._count,
        amount: t._sum.amount || 0,
      })),
    };
  }

  /**
   * 今日收款汇总
   */
  async getTodayPayments(campusId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: any = {
      status: 1,
      paidAt: { gte: today, lt: tomorrow },
    };
    if (campusId) where.campusId = campusId;

    const stats = await this.prisma.payment.aggregate({
      where,
      _count: true,
      _sum: { amount: true },
    });

    return {
      date: today.toISOString().slice(0, 10),
      paymentCount: stats._count,
      totalAmount: stats._sum.amount || 0,
    };
  }

  /**
   * 获取支付方式列表
   */
  getPaymentMethods() {
    return [
      { code: 'CASH', name: '现金' },
      { code: 'WECHAT', name: '微信支付' },
      { code: 'ALIPAY', name: '支付宝' },
      { code: 'BANK', name: '银行转账' },
      { code: 'POS', name: 'POS刷卡' },
    ];
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

  private getPaymentTypeName(code: string): string {
    const types: Record<string, string> = {
      SIGN: '签约首付',
      INSTALLMENT: '分期付款',
      RENEWAL: '续费',
    };
    return types[code] || code;
  }
}
