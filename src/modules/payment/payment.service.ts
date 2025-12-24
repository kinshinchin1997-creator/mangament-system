import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto, QueryPaymentDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { CashflowService } from '../cashflow/cashflow.service';

/**
 * 收款服务
 * 
 * 处理所有收款业务逻辑：
 * 1. 合同签约收款（产生预收款）
 * 2. 收款记录管理
 * 3. 收款统计
 */
@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => CashflowService))
    private cashflowService: CashflowService,
  ) {}

  /**
   * 合同收款（签约/续费）
   * 
   * 业务流程：
   * 1. 校验学员、课包
   * 2. 计算金额（课包总价 - 优惠）
   * 3. 创建合同记录
   * 4. 生成现金流入记录
   * 5. 保存数据快照
   */
  async createContractPayment(createDto: CreatePaymentDto, currentUser: any) {
    // 1. 校验学员
    const student = await this.prisma.student.findUnique({
      where: { id: createDto.studentId },
    });
    if (!student) throw new NotFoundException('学员不存在');

    // 2. 校验课包
    const coursePackage = await this.prisma.coursePackage.findUnique({
      where: { id: createDto.packageId },
    });
    if (!coursePackage) throw new NotFoundException('课包不存在');
    if (coursePackage.status !== 1) throw new BadRequestException('该课包已停售');

    // 3. 计算金额
    const totalAmount = coursePackage.totalAmount;
    const discountAmount = createDto.discountAmount || 0;
    const paidAmount = DecimalUtil.subtract(totalAmount.toString(), discountAmount.toString());

    if (DecimalUtil.lt(paidAmount, '0')) {
      throw new BadRequestException('优惠金额不能大于课包总价');
    }

    // 4. 计算有效期
    const startDate = new Date(createDto.startDate || new Date());
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + coursePackage.validDays);

    // 5. 生成合同编号
    const contractNo = NumberGenerator.generateContractNo();

    // 6. 事务处理
    const contract = await this.prisma.$transaction(async (tx) => {
      // 创建合同
      const newContract = await tx.contract.create({
        data: {
          contractNo,
          studentId: createDto.studentId,
          campusId: createDto.campusId,
          packageId: createDto.packageId,
          totalAmount: DecimalUtil.toNumber(totalAmount.toString()),
          paidAmount: DecimalUtil.toNumber(paidAmount),
          discountAmount: DecimalUtil.toNumber(discountAmount.toString()),
          totalLessons: coursePackage.totalLessons,
          usedLessons: 0,
          remainLessons: coursePackage.totalLessons,
          startDate,
          endDate,
          payMethod: createDto.payMethod,
          payTime: new Date(),
          createdById: currentUser.userId,
          snapshotData: {
            coursePackage: {
              id: coursePackage.id,
              name: coursePackage.name,
              standardPrice: coursePackage.standardPrice,
              totalLessons: coursePackage.totalLessons,
              totalAmount: coursePackage.totalAmount,
            },
            student: {
              id: student.id,
              name: student.name,
              code: student.code,
            },
          },
        },
      });

      // 生成现金流入记录
      await this.cashflowService.recordInflow(tx, {
        bizType: 'CONTRACT',
        bizId: newContract.id,
        bizNo: newContract.contractNo,
        contractId: newContract.id,
        amount: newContract.paidAmount,
        payMethod: newContract.payMethod,
        campusId: newContract.campusId,
        createdById: currentUser.userId,
        remark: `合同收款: ${newContract.contractNo}`,
      });

      return newContract;
    });

    return this.findOne(contract.id);
  }

  /**
   * 获取收款记录列表
   */
  async findAll(query: QueryPaymentDto) {
    const { page = 1, pageSize = 20, campusId, payMethod, startDate, endDate, keyword } = query;

    const where: any = { direction: 1 }; // 只查收入

    if (campusId) where.campusId = campusId;
    if (payMethod) where.payMethod = payMethod;

    if (keyword) {
      where.OR = [
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
              student: { select: { id: true, name: true, code: true } },
              package: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cashFlow.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取收款详情
   */
  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        student: true,
        campus: true,
        package: true,
        createdBy: { select: { id: true, realName: true } },
      },
    });

    if (!contract) throw new NotFoundException('收款记录不存在');

    return contract;
  }

  /**
   * 收款统计
   */
  async getStatistics(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // 合同收款统计
    const contractStats = await this.prisma.contract.aggregate({
      where,
      _count: true,
      _sum: { paidAmount: true, discountAmount: true },
    });

    // 按支付方式分组
    const byPayMethod = await this.prisma.contract.groupBy({
      by: ['payMethod'],
      where,
      _count: true,
      _sum: { paidAmount: true },
    });

    return {
      summary: {
        totalContracts: contractStats._count,
        totalPaidAmount: contractStats._sum.paidAmount || 0,
        totalDiscountAmount: contractStats._sum.discountAmount || 0,
      },
      byPayMethod: byPayMethod.map((p) => ({
        payMethod: p.payMethod,
        payMethodName: this.getPayMethodName(p.payMethod),
        count: p._count,
        amount: p._sum.paidAmount || 0,
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
      createdAt: { gte: today, lt: tomorrow },
    };
    if (campusId) where.campusId = campusId;

    const stats = await this.prisma.contract.aggregate({
      where,
      _count: true,
      _sum: { paidAmount: true },
    });

    return {
      date: today.toISOString().slice(0, 10),
      contractCount: stats._count,
      totalAmount: stats._sum.paidAmount || 0,
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
}

