import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { ContractService } from '../contract/contract.service';

@Injectable()
export class LessonService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ContractService))
    private contractService: ContractService,
  ) {}

  /**
   * 创建消课记录
   */
  async create(createDto: any, currentUser: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { student: true, package: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态，无法消课');
    if (contract.remainLessons < createDto.lessonCount) {
      throw new BadRequestException(`剩余课时不足，当前剩余 ${contract.remainLessons} 课时`);
    }

    const teacher = await this.prisma.teacher.findUnique({ where: { id: createDto.teacherId } });
    if (!teacher) throw new NotFoundException('教师不存在');
    if (teacher.status !== 1) throw new BadRequestException('该教师已离职');

    const unitPrice = DecimalUtil.divide(contract.paidAmount.toString(), contract.totalLessons.toString());
    const lessonAmount = DecimalUtil.multiply(unitPrice, createDto.lessonCount.toString());
    const recordNo = NumberGenerator.generateLessonRecordNo();

    const lessonRecord = await this.prisma.$transaction(async (tx) => {
      const record = await tx.lessonRecord.create({
        data: {
          recordNo,
          contractId: createDto.contractId,
          studentId: contract.studentId,
          teacherId: createDto.teacherId,
          lessonDate: new Date(createDto.lessonDate),
          lessonCount: createDto.lessonCount,
          lessonAmount: DecimalUtil.toNumber(lessonAmount),
          unitPrice: DecimalUtil.toNumber(unitPrice),
          beforeRemain: contract.remainLessons,
          afterRemain: contract.remainLessons - createDto.lessonCount,
          createdById: currentUser.userId,
          remark: createDto.remark,
        },
      });

      await this.contractService.updateLessonsAfterConsumption(createDto.contractId, createDto.lessonCount, tx);
      return record;
    });

    return this.findOne(lessonRecord.id);
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, contractId, studentId, teacherId, campusId, startDate, endDate, status } = query;
    const where: any = {};

    if (contractId) where.contractId = contractId;
    if (studentId) where.studentId = studentId;
    if (teacherId) where.teacherId = teacherId;
    if (campusId) where.contract = { campusId };
    if (startDate && endDate) {
      where.lessonDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.lessonRecord.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          student: { select: { id: true, name: true, code: true } },
          teacher: { select: { id: true, name: true } },
          contract: { select: { id: true, contractNo: true } },
          createdBy: { select: { id: true, realName: true } },
        },
        orderBy: { lessonDate: 'desc' },
      }),
      this.prisma.lessonRecord.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findOne(id: string) {
    const record = await this.prisma.lessonRecord.findUnique({
      where: { id },
      include: {
        student: true,
        teacher: true,
        contract: { include: { package: true, campus: true } },
        createdBy: { select: { id: true, realName: true } },
      },
    });
    if (!record) throw new NotFoundException('消课记录不存在');
    return record;
  }

  async revoke(id: string, reason: string, currentUser: any) {
    const record = await this.findOne(id);
    if (record.status !== 1) throw new BadRequestException('该消课记录已被撤销');

    await this.prisma.$transaction(async (tx) => {
      await tx.lessonRecord.update({
        where: { id },
        data: { status: 2, revokeReason: reason, revokedAt: new Date() },
      });

      const contract = await tx.contract.findUnique({ where: { id: record.contractId } });
      if (contract) {
        await tx.contract.update({
          where: { id: record.contractId },
          data: {
            usedLessons: contract.usedLessons - record.lessonCount.toNumber(),
            remainLessons: contract.remainLessons + record.lessonCount.toNumber(),
            status: contract.status === 2 ? 1 : contract.status,
          },
        });
      }
    });

    return this.findOne(id);
  }

  async getStatistics(campusId?: string, teacherId?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 1 };
    if (campusId) where.contract = { campusId };
    if (teacherId) where.teacherId = teacherId;
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
      totalAmount: summary._sum.lessonAmount || 0,
    };
  }
}

