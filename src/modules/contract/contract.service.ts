import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class ContractService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentService))
    private paymentService: PaymentService,
  ) {}

  /**
   * 创建合同（预收款核心逻辑）
   */
  async create(createDto: any, currentUser: any) {
    const student = await this.prisma.student.findUnique({ where: { id: createDto.studentId } });
    if (!student) throw new NotFoundException('学员不存在');

    const coursePackage = await this.prisma.coursePackage.findUnique({ where: { id: createDto.packageId } });
    if (!coursePackage) throw new NotFoundException('课包不存在');
    if (coursePackage.status !== 1) throw new BadRequestException('该课包已停售');

    const originalAmount = coursePackage.totalAmount;
    const discountAmount = createDto.discountAmount || 0;
    const contractAmount = DecimalUtil.subtract(originalAmount.toString(), discountAmount.toString());

    if (DecimalUtil.lt(contractAmount, '0')) throw new BadRequestException('优惠金额不能大于课包总价');

    // 计算课时单价 = 合同金额 / 总课时
    const unitPrice = DecimalUtil.divide(contractAmount, coursePackage.totalLessons.toString());

    const startDate = new Date(createDto.startDate || new Date());
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + coursePackage.validDays);

    const contractNo = NumberGenerator.generateContractNo();

    const contract = await this.prisma.$transaction(async (tx) => {
      const newContract = await tx.contract.create({
        data: {
          contractNo,
          studentId: createDto.studentId,
          campusId: createDto.campusId,
          packageId: createDto.packageId,
          originalAmount: DecimalUtil.toNumber(originalAmount.toString()),
          discountAmount: DecimalUtil.toNumber(discountAmount.toString()),
          contractAmount: DecimalUtil.toNumber(contractAmount),
          paidAmount: 0, // 初始已收金额为0，通过Payment记录
          totalLessons: coursePackage.totalLessons,
          usedLessons: 0,
          remainLessons: coursePackage.totalLessons,
          unitPrice: DecimalUtil.toNumber(unitPrice),
          unearned: 0, // 初始未消课金额为0，收款后更新
          startDate,
          endDate,
          signedAt: new Date(),
          createdById: currentUser.userId,
          remark: createDto.remark,
          snapshotData: { coursePackage, student },
        },
      });

      // 如果有首付金额，创建收款记录
      if (createDto.paidAmount && DecimalUtil.gt(createDto.paidAmount.toString(), '0')) {
        await this.paymentService.createPayment(tx, {
          contractId: newContract.id,
          campusId: newContract.campusId,
          amount: createDto.paidAmount,
          payMethod: createDto.payMethod || 'CASH',
          paymentType: 'SIGN',
          createdById: currentUser.userId,
          remark: `签约首付: ${contractNo}`,
        });

        // 更新合同已收金额和未消课金额
        const paidAmount = DecimalUtil.toNumber(createDto.paidAmount.toString());
        const unearned = DecimalUtil.multiply(unitPrice, coursePackage.totalLessons.toString());
        
        await tx.contract.update({
          where: { id: newContract.id },
          data: {
            paidAmount,
            unearned: DecimalUtil.toNumber(unearned),
          },
        });
      }

      return newContract;
    });

    return this.findOne(contract.id);
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, studentId, status, startDate, endDate } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { contractNo: { contains: keyword } },
        { student: { name: { contains: keyword } } },
      ];
    }
    if (campusId) where.campusId = campusId;
    if (studentId) where.studentId = studentId;
    if (status !== undefined) where.status = status;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          student: { select: { id: true, name: true, code: true } },
          campus: { select: { id: true, name: true } },
          package: { select: { id: true, name: true, category: true } },
          createdBy: { select: { id: true, realName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        student: true,
        campus: true,
        package: true,
        createdBy: { select: { id: true, realName: true } },
        payments: { orderBy: { paidAt: 'desc' } },
        lessons: { where: { status: 1 }, orderBy: { lessonDate: 'desc' }, take: 10 },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    return contract;
  }

  async complete(id: string) {
    const contract = await this.findOne(id);
    if (contract.status !== 1) throw new BadRequestException('只有正常状态的合同才能完结');
    return this.prisma.contract.update({ where: { id }, data: { status: 2 } });
  }

  async getStatistics(campusId?: string, startDate?: string, endDate?: string) {
    const where: any = {};
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const summary = await this.prisma.contract.aggregate({
      where,
      _count: true,
      _sum: { paidAmount: true, usedLessons: true, remainLessons: true, unearned: true },
    });

    return {
      totalContracts: summary._count,
      totalPaidAmount: summary._sum.paidAmount || 0,
      totalUsedLessons: summary._sum.usedLessons || 0,
      totalRemainLessons: summary._sum.remainLessons || 0,
      totalUnearned: summary._sum.unearned || 0,
    };
  }

  async updateLessonsAfterConsumption(contractId: string, lessonCount: number, tx?: any) {
    const prisma = tx || this.prisma;
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('合同不存在');

    const newUsedLessons = contract.usedLessons + lessonCount;
    const newRemainLessons = contract.remainLessons - lessonCount;
    if (newRemainLessons < 0) throw new BadRequestException('剩余课时不足');

    const newUnearned = DecimalUtil.multiply(contract.unitPrice.toString(), newRemainLessons.toString());
    const newStatus = newRemainLessons === 0 ? 2 : contract.status;

    return prisma.contract.update({
      where: { id: contractId },
      data: {
        usedLessons: newUsedLessons,
        remainLessons: newRemainLessons,
        unearned: DecimalUtil.toNumber(newUnearned),
        status: newStatus,
      },
    });
  }
}
