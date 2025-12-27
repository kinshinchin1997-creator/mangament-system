import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  CreatePaymentDto, 
  QueryPaymentDto, 
  PaymentTypeEnum, 
  PayMethodEnum,
  PrepaidSummaryDto 
} from './dto';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { Prisma } from '@prisma/client';

/**
 * ============================================
 * 收款服务 - Payment Service
 * ============================================
 * 
 * 核心职责：
 * 1. 新招收款：新学员首次购买课包，创建合同 + 收款记录
 * 2. 续费收款：老学员续购课包，创建新合同 + 收款记录
 * 3. 自动计算预收款相关金额
 * 
 * 业务规则：
 * - 每笔收款必须绑定【合同】和【课包】
 * - 收款产生预收款（负债），消课确认收入
 * - 预收款余额 = 已收金额 - 已消课金额 = 剩余课时 × 课单价
 */
@Injectable()
export class PaymentService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // 一、核心收款业务
  // ============================================

  /**
   * 创建收款（统一入口，支持新招/续费）
   * 
   * ┌─────────────────────────────────────────────────────────────┐
   * │                    收款业务流程图                             │
   * ├─────────────────────────────────────────────────────────────┤
   * │  1. 前置校验                                                 │
   * │     ├── 校验课包是否存在且在售                                │
   * │     ├── 新招：校验学员是否存在                                │
   * │     └── 续费：校验原合同是否存在且有效                         │
   * │                                                             │
   * │  2. 金额计算                                                 │
   * │     ├── 合同金额 = 课包原价 - 优惠金额                        │
   * │     ├── 课单价 = 合同金额 / 总课时                            │
   * │     └── 未消课金额(预收余额) = 合同金额（初始等于合同金额）      │
   * │                                                             │
   * │  3. 事务操作                                                 │
   * │     ├── 创建合同记录（绑定学员、课包）                         │
   * │     ├── 创建收款记录（绑定合同）                               │
   * │     └── 更新相关统计（可选）                                   │
   * │                                                             │
   * │  4. 返回结果                                                 │
   * │     └── 返回合同 + 收款详情                                   │
   * └─────────────────────────────────────────────────────────────┘
   */
  async createPayment(createDto: CreatePaymentDto, currentUser: any) {
    // 根据收款类型分发处理
    if (createDto.paymentType === PaymentTypeEnum.SIGN) {
      return this.createSignPayment(createDto, currentUser);
    } else if (createDto.paymentType === PaymentTypeEnum.RENEWAL) {
      return this.createRenewalPayment(createDto, currentUser);
    } else {
      throw new BadRequestException('无效的收款类型');
    }
  }

  /**
   * 新招收款（新学员首次购买）
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION createSignPayment(dto, user):
   *   // 1. 前置校验
   *   课包 = 查询课包(dto.packageId)
   *   IF 课包不存在 OR 课包已停售:
   *     抛出异常("课包不可用")
   *   
   *   学员 = 查询学员(dto.studentId)
   *   IF 学员不存在:
   *     抛出异常("学员不存在")
   *   
   *   // 2. 计算金额
   *   优惠金额 = dto.discountAmount OR 0
   *   合同金额 = 课包总价 - 优惠金额
   *   课单价 = 合同金额 / 课包总课时
   *   未消课金额 = 合同金额  // 初始状态，未消课 = 全部预收
   *   
   *   // 3. 事务操作
   *   BEGIN TRANSACTION:
   *     // 3.1 创建合同
   *     合同 = INSERT Contract {
   *       contractNo: 生成合同编号(),
   *       studentId: dto.studentId,
   *       campusId: dto.campusId,
   *       packageId: dto.packageId,
   *       originalAmount: 课包总价,
   *       discountAmount: 优惠金额,
   *       contractAmount: 合同金额,
   *       paidAmount: 合同金额,      // 已收=合同金额（全款）
   *       totalLessons: 课包总课时,
   *       usedLessons: 0,            // 已消课=0
   *       remainLessons: 课包总课时, // 剩余=全部
   *       unitPrice: 课单价,
   *       unearned: 未消课金额,      // 预收余额
   *       startDate: dto.startDate,
   *       endDate: startDate + 课包有效天数,
   *       status: 正常,
   *       createdById: user.id
   *     }
   *     
   *     // 3.2 创建收款记录
   *     收款 = INSERT Payment {
   *       paymentNo: 生成收款单号(),
   *       contractId: 合同.id,       // 绑定合同
   *       campusId: dto.campusId,
   *       amount: 合同金额,
   *       payMethod: dto.payMethod,
   *       paymentType: 'SIGN',       // 新招类型
   *       paidAt: NOW(),
   *       createdById: user.id
   *     }
   *   COMMIT
   *   
   *   RETURN { 合同, 收款 }
   * ```
   */
  async createSignPayment(createDto: CreatePaymentDto, currentUser: any) {
    // ====== 1. 前置校验 ======
    
    // 1.1 校验课包
    const coursePackage = await this.prisma.coursePackage.findUnique({
      where: { id: createDto.packageId },
    });
    if (!coursePackage) {
      throw new NotFoundException('课包不存在');
    }
    if (coursePackage.status !== 1) {
      throw new BadRequestException('该课包已停售，无法购买');
    }

    // 1.2 校验学员
    const student = await this.prisma.student.findUnique({
      where: { id: createDto.studentId },
    });
    if (!student) {
      throw new NotFoundException('学员不存在');
    }

    // 1.3 校验校区
    const campus = await this.prisma.campus.findUnique({
      where: { id: createDto.campusId },
    });
    if (!campus) {
      throw new NotFoundException('校区不存在');
    }

    // ====== 2. 计算金额 ======
    const discountAmount = createDto.discountAmount || 0;
    
    // 合同金额 = 课包原价 - 优惠
    const contractAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(
        coursePackage.totalAmount.toString(), 
        discountAmount.toString()
      )
    );
    
    // 课单价 = 合同金额 / 总课时
    const unitPrice = DecimalUtil.toNumber(
      DecimalUtil.divide(
        contractAmount.toString(), 
        coursePackage.totalLessons.toString()
      )
    );
    
    // 未消课金额 = 合同金额（初始时全部为预收）
    const unearnedAmount = contractAmount;

    // ====== 3. 事务操作 ======
    const result = await this.prisma.$transaction(async (tx) => {
      // 3.1 创建合同
      const contractNo = NumberGenerator.generateContractNo();
      const startDate = createDto.startDate ? new Date(createDto.startDate) : new Date();
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + coursePackage.validDays);

      const contract = await tx.contract.create({
        data: {
          contractNo,
          studentId: createDto.studentId!,
          campusId: createDto.campusId!,
          packageId: createDto.packageId,
          originalAmount: coursePackage.totalAmount,
          discountAmount,
          contractAmount,
          paidAmount: contractAmount,           // 全款支付
          totalLessons: coursePackage.totalLessons,
          usedLessons: 0,
          remainLessons: coursePackage.totalLessons,
          unitPrice,
          unearned: unearnedAmount,             // 预收款余额
          startDate,
          endDate,
          status: 1,                            // 正常状态
          signedAt: new Date(),
          createdById: currentUser.userId,
          snapshotData: {
            package: {
              id: coursePackage.id,
              name: coursePackage.name,
              totalLessons: coursePackage.totalLessons,
              totalAmount: Number(coursePackage.totalAmount),
            },
            student: {
              id: student.id,
              name: student.name,
              code: student.code,
            },
          },
          remark: createDto.remark,
        },
      });

      // 3.2 创建收款记录
      const payment = await this.createPaymentRecord(tx, {
        contractId: contract.id,
        campusId: createDto.campusId!,
        amount: contractAmount,
        payMethod: createDto.payMethod,
        paymentType: PaymentTypeEnum.SIGN,
        transactionNo: createDto.transactionNo,
        createdById: currentUser.userId,
        remark: createDto.remark,
      });

      return { contract, payment };
    });

    // ====== 4. 返回结果 ======
    return {
      message: '新招收款成功',
      data: result,
      summary: {
        contractNo: result.contract.contractNo,
        paymentNo: result.payment.paymentNo,
        studentName: student.name,
        packageName: coursePackage.name,
        totalPrepaid: contractAmount,           // 总预收金额
        totalUnearned: unearnedAmount,          // 未消课金额（初始等于预收）
      },
    };
  }

  /**
   * 续费收款（老学员续购课包）
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION createRenewalPayment(dto, user):
   *   // 1. 前置校验
   *   原合同 = 查询合同(dto.originalContractId)
   *   IF 原合同不存在:
   *     抛出异常("原合同不存在")
   *   
   *   课包 = 查询课包(dto.packageId)
   *   IF 课包不存在 OR 课包已停售:
   *     抛出异常("课包不可用")
   *   
   *   // 2. 计算金额（同新招）
   *   优惠金额 = dto.discountAmount OR 0
   *   合同金额 = 课包总价 - 优惠金额
   *   课单价 = 合同金额 / 课包总课时
   *   
   *   // 3. 续费策略选择
   *   IF 原合同还有剩余课时:
   *     // 方案A：创建新合同，保留原合同继续消课
   *     // 方案B：合并到原合同（本实现采用方案A）
   *   
   *   // 4. 事务操作
   *   BEGIN TRANSACTION:
   *     // 创建新续费合同
   *     新合同 = INSERT Contract {
   *       ...（同新招逻辑）
   *       studentId: 原合同.studentId,  // 继承学员
   *       campusId: 原合同.campusId,    // 继承校区
   *       remark: "续费自合同: " + 原合同.contractNo
   *     }
   *     
   *     // 创建收款记录
   *     收款 = INSERT Payment {
   *       ...
   *       paymentType: 'RENEWAL'  // 续费类型
   *     }
   *   COMMIT
   *   
   *   RETURN { 新合同, 收款 }
   * ```
   */
  async createRenewalPayment(createDto: CreatePaymentDto, currentUser: any) {
    // ====== 1. 前置校验 ======
    
    // 1.1 校验原合同
    const originalContract = await this.prisma.contract.findUnique({
      where: { id: createDto.originalContractId },
      include: { student: true, campus: true },
    });
    if (!originalContract) {
      throw new NotFoundException('原合同不存在');
    }

    // 1.2 校验课包
    const coursePackage = await this.prisma.coursePackage.findUnique({
      where: { id: createDto.packageId },
    });
    if (!coursePackage) {
      throw new NotFoundException('续费课包不存在');
    }
    if (coursePackage.status !== 1) {
      throw new BadRequestException('该课包已停售');
    }

    // ====== 2. 计算金额 ======
    const discountAmount = createDto.discountAmount || 0;
    const contractAmount = DecimalUtil.toNumber(
      DecimalUtil.subtract(
        coursePackage.totalAmount.toString(), 
        discountAmount.toString()
      )
    );
    const unitPrice = DecimalUtil.toNumber(
      DecimalUtil.divide(
        contractAmount.toString(), 
        coursePackage.totalLessons.toString()
      )
    );

    // ====== 3. 事务操作 ======
    const result = await this.prisma.$transaction(async (tx) => {
      // 3.1 创建续费合同（新合同）
      const contractNo = NumberGenerator.generateContractNo();
      const startDate = createDto.startDate ? new Date(createDto.startDate) : new Date();
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + coursePackage.validDays);

      const newContract = await tx.contract.create({
        data: {
          contractNo,
          studentId: originalContract.studentId,    // 继承学员
          campusId: originalContract.campusId,      // 继承校区
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
            package: {
              id: coursePackage.id,
              name: coursePackage.name,
              totalLessons: coursePackage.totalLessons,
              totalAmount: Number(coursePackage.totalAmount),
            },
            student: {
              id: originalContract.student.id,
              name: originalContract.student.name,
              code: originalContract.student.code,
            },
            renewalFrom: {
              contractId: originalContract.id,
              contractNo: originalContract.contractNo,
            },
          },
          remark: `续费自合同: ${originalContract.contractNo}${createDto.remark ? ' - ' + createDto.remark : ''}`,
        },
      });

      // 3.2 创建收款记录
      const payment = await this.createPaymentRecord(tx, {
        contractId: newContract.id,
        campusId: originalContract.campusId,
        amount: contractAmount,
        payMethod: createDto.payMethod,
        paymentType: PaymentTypeEnum.RENEWAL,
        transactionNo: createDto.transactionNo,
        createdById: currentUser.userId,
        remark: `续费收款 - 原合同: ${originalContract.contractNo}`,
      });

      return { contract: newContract, payment, originalContract };
    });

    // ====== 4. 返回结果 ======
    return {
      message: '续费收款成功',
      data: {
        contract: result.contract,
        payment: result.payment,
      },
      summary: {
        contractNo: result.contract.contractNo,
        paymentNo: result.payment.paymentNo,
        studentName: originalContract.student.name,
        packageName: coursePackage.name,
        totalPrepaid: contractAmount,
        totalUnearned: contractAmount,
        renewedFrom: result.originalContract.contractNo,
      },
    };
  }

  /**
   * 创建收款记录（事务内调用，供其他模块使用）
   * 
   * @description 用于在事务中创建收款记录，通常由 ContractService 调用
   */
  async createPaymentInTransaction(
    tx: Prisma.TransactionClient,
    data: {
      contractId: string;
      campusId: string;
      amount: number;
      payMethod: string;
      paymentType: string;
      transactionNo?: string;
      createdById: string;
      remark?: string;
    }
  ) {
    const paymentNo = NumberGenerator.generateCashFlowNo();

    return tx.payment.create({
      data: {
        paymentNo,
        contractId: data.contractId,
        campusId: data.campusId,
        amount: data.amount,
        payMethod: data.payMethod,
        paymentType: data.paymentType,
        transactionNo: data.transactionNo,
        status: 1,
        paidAt: new Date(),
        createdById: data.createdById,
        remark: data.remark,
      },
    });
  }

  /**
   * 创建收款记录（内部方法，事务中调用）
   */
  private async createPaymentRecord(
    tx: Prisma.TransactionClient,
    data: {
      contractId: string;
      campusId: string;
      amount: number;
      payMethod: PayMethodEnum;
      paymentType: PaymentTypeEnum;
      transactionNo?: string;
      createdById: string;
      remark?: string;
    }
  ) {
    return this.createPaymentInTransaction(tx, data);
  }

  // ============================================
  // 二、预收款统计
  // ============================================

  /**
   * 获取预收款汇总统计
   * 
   * 伪代码逻辑：
   * ```
   * FUNCTION getPrepaidSummary(campusId?):
   *   // 查询所有有效合同
   *   合同列表 = SELECT * FROM Contract WHERE status = 正常
   *   
   *   FOR EACH 合同 IN 合同列表:
   *     总预收金额 += 合同.paidAmount
   *     未消课金额 += 合同.unearned
   *     已确认收入 += (合同.paidAmount - 合同.unearned)
   *   
   *   RETURN {
   *     totalPrepaid: 总预收金额,
   *     totalUnearned: 未消课金额,
   *     totalEarned: 已确认收入,
   *     activeContractCount: 合同列表.length
   *   }
   * ```
   */
  async getPrepaidSummary(campusId?: string): Promise<PrepaidSummaryDto> {
    const where: any = { status: 1 };
    if (campusId) where.campusId = campusId;

    // 查询合同统计
    const contractStats = await this.prisma.contract.aggregate({
      where,
      _sum: {
        paidAmount: true,
        unearned: true,
      },
      _count: true,
    });

    const totalPrepaid = Number(contractStats._sum.paidAmount || 0);
    const totalUnearned = Number(contractStats._sum.unearned || 0);
    const totalEarned = totalPrepaid - totalUnearned;

    // 按校区分组统计
    const byCampusStats = await this.prisma.contract.groupBy({
      by: ['campusId'],
      where,
      _sum: {
        paidAmount: true,
        unearned: true,
      },
      _count: true,
    });

    // 获取校区名称
    const campusIds = byCampusStats.map((s) => s.campusId);
    const campuses = await this.prisma.campus.findMany({
      where: { id: { in: campusIds } },
      select: { id: true, name: true },
    });
    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));

    return {
      totalPrepaid,
      totalUnearned,
      totalEarned,
      activeContractCount: contractStats._count,
      byCampus: byCampusStats.map((s) => {
        const prepaid = Number(s._sum.paidAmount || 0);
        const unearned = Number(s._sum.unearned || 0);
        return {
          campusId: s.campusId,
          campusName: campusMap.get(s.campusId) || '未知',
          prepaid,
          unearned,
          earned: prepaid - unearned,
          contractCount: s._count,
        };
      }),
    };
  }

  // ============================================
  // 三、收款查询
  // ============================================

  /**
   * 获取收款记录列表
   */
  async findAll(query: QueryPaymentDto) {
    const { 
      page = 1, 
      pageSize = 20, 
      campusId, 
      payMethod, 
      paymentType, 
      contractId,
      studentId,
      startDate, 
      endDate, 
      keyword 
    } = query;

    const where: any = { status: 1 };

    if (campusId) where.campusId = campusId;
    if (payMethod) where.payMethod = payMethod;
    if (paymentType) where.paymentType = paymentType;
    if (contractId) where.contractId = contractId;

    // 按学员查询需要通过合同关联
    if (studentId) {
      where.contract = { studentId };
    }

    if (keyword) {
      where.OR = [
        { paymentNo: { contains: keyword } },
        { remark: { contains: keyword } },
        { transactionNo: { contains: keyword } },
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
              package: { select: { id: true, name: true, category: true } },
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

    if (!payment) {
      throw new NotFoundException('收款记录不存在');
    }

    // 计算合同的预收款情况
    const contract = payment.contract;
    const prepaidInfo = {
      totalPrepaid: Number(contract.paidAmount),
      usedLessons: contract.usedLessons,
      remainLessons: contract.remainLessons,
      unearned: Number(contract.unearned),
      earned: Number(contract.paidAmount) - Number(contract.unearned),
    };

    return {
      ...payment,
      prepaidInfo,
    };
  }

  // ============================================
  // 四、收款统计
  // ============================================

  /**
   * 收款统计（按时间、类型、支付方式）
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

    // 总体统计
    const paymentStats = await this.prisma.payment.aggregate({
      where,
      _count: true,
      _sum: { amount: true },
    });

    // 按收款类型分组（新招 vs 续费）
    const byPaymentType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
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

    return {
      summary: {
        totalPayments: paymentStats._count,
        totalAmount: Number(paymentStats._sum.amount || 0),
      },
      byPaymentType: byPaymentType.map((t) => ({
        paymentType: t.paymentType,
        paymentTypeName: this.getPaymentTypeName(t.paymentType),
        count: t._count,
        amount: Number(t._sum.amount || 0),
        percentage: paymentStats._count > 0 
          ? Math.round((t._count / paymentStats._count) * 100) 
          : 0,
      })),
      byPayMethod: byPayMethod.map((p) => ({
        payMethod: p.payMethod,
        payMethodName: this.getPayMethodName(p.payMethod),
        count: p._count,
        amount: Number(p._sum.amount || 0),
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

    // 分新招/续费统计
    const byType = await this.prisma.payment.groupBy({
      by: ['paymentType'],
      where,
      _count: true,
      _sum: { amount: true },
    });

    return {
      date: today.toISOString().slice(0, 10),
      paymentCount: stats._count,
      totalAmount: Number(stats._sum.amount || 0),
      byType: byType.map((t) => ({
        type: t.paymentType,
        typeName: this.getPaymentTypeName(t.paymentType),
        count: t._count,
        amount: Number(t._sum.amount || 0),
      })),
    };
  }

  // ============================================
  // 五、辅助方法
  // ============================================

  /**
   * 获取支付方式列表
   */
  getPaymentMethods() {
    return [
      { code: PayMethodEnum.CASH, name: '现金' },
      { code: PayMethodEnum.WECHAT, name: '微信支付' },
      { code: PayMethodEnum.ALIPAY, name: '支付宝' },
      { code: PayMethodEnum.BANK, name: '银行转账' },
      { code: PayMethodEnum.POS, name: 'POS刷卡' },
    ];
  }

  /**
   * 获取收款类型列表
   */
  getPaymentTypes() {
    return [
      { code: PaymentTypeEnum.SIGN, name: '新招' },
      { code: PaymentTypeEnum.RENEWAL, name: '续费' },
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
      SIGN: '新招',
      RENEWAL: '续费',
    };
    return types[code] || code;
  }
}
