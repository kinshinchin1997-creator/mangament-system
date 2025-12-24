import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator, DecimalUtil } from '../../common/utils';
import { ContractService } from '../contract/contract.service';

/**
 * 消课服务
 * 
 * 核心职责：
 * 1. 记录学员消课
 * 2. 扣减合同剩余课时
 * 3. 计算消课金额（收入确认）
 * 4. 消课撤销
 */
@Injectable()
export class LessonService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ContractService))
    private contractService: ContractService,
  ) {}

  /**
   * 创建消课记录
   * 
   * 业务流程：
   * 1. 校验合同状态、剩余课时
   * 2. 校验教师状态
   * 3. 计算消课金额（课单价 × 消课数）
   * 4. 创建消课记录
   * 5. 扣减合同课时
   */
  async create(createDto: any, currentUser: any) {
    // 1. 校验合同
    const contract = await this.prisma.contract.findUnique({
      where: { id: createDto.contractId },
      include: { student: true, package: true, campus: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    if (contract.status !== 1) throw new BadRequestException('该合同不是正常状态，无法消课');
    if (contract.remainLessons < createDto.lessonCount) {
      throw new BadRequestException(`剩余课时不足，当前剩余 ${contract.remainLessons} 课时`);
    }

    // 2. 校验教师
    const teacher = await this.prisma.teacher.findUnique({ where: { id: createDto.teacherId } });
    if (!teacher) throw new NotFoundException('教师不存在');
    if (teacher.status !== 1) throw new BadRequestException('该教师已离职');

    // 3. 计算金额
    const unitPrice = DecimalUtil.divide(contract.paidAmount.toString(), contract.totalLessons.toString());
    const consumedAmount = DecimalUtil.multiply(unitPrice, createDto.lessonCount.toString());
    const recordNo = NumberGenerator.generateLessonRecordNo();

    // 4. 事务处理
    const lessonRecord = await this.prisma.$transaction(async (tx) => {
      // 创建消课记录
      const record = await tx.lessonRecord.create({
        data: {
          recordNo,
          contractId: createDto.contractId,
          studentId: contract.studentId,
          campusId: contract.campusId,
          teacherId: createDto.teacherId,
          attendDate: new Date(createDto.attendDate || new Date()),
          consumedCount: createDto.lessonCount,
          consumedAmount: DecimalUtil.toNumber(consumedAmount),
          unitPrice: DecimalUtil.toNumber(unitPrice),
          beforeRemain: contract.remainLessons,
          afterRemain: contract.remainLessons - createDto.lessonCount,
          status: 1, // 已完成
          createdById: currentUser.userId,
          remark: createDto.remark,
          snapshotData: {
            contract: {
              id: contract.id,
              contractNo: contract.contractNo,
            },
            student: {
              id: contract.student.id,
              name: contract.student.name,
            },
            teacher: {
              id: teacher.id,
              name: teacher.name,
            },
            unitPrice: DecimalUtil.toNumber(unitPrice),
          },
        },
      });

      // 扣减合同课时
      await this.contractService.updateLessonsAfterConsumption(createDto.contractId, createDto.lessonCount, tx);

      return record;
    });

    return this.findOne(lessonRecord.id);
  }

  /**
   * 查询消课记录列表
   */
  async findAll(query: any) {
    const { page = 1, pageSize = 20, contractId, studentId, teacherId, campusId, startDate, endDate, status } = query;
    const where: any = {};

    if (contractId) where.contractId = contractId;
    if (studentId) where.studentId = studentId;
    if (teacherId) where.teacherId = teacherId;
    if (campusId) where.campusId = campusId;
    if (startDate && endDate) {
      where.attendDate = { gte: new Date(startDate), lte: new Date(endDate) };
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
          campus: { select: { id: true, name: true } },
          createdBy: { select: { id: true, realName: true } },
        },
        orderBy: { attendDate: 'desc' },
      }),
      this.prisma.lessonRecord.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取消课详情
   */
  async findOne(id: string) {
    const record = await this.prisma.lessonRecord.findUnique({
      where: { id },
      include: {
        student: true,
        teacher: true,
        campus: true,
        contract: { include: { package: true } },
        createdBy: { select: { id: true, realName: true } },
      },
    });
    if (!record) throw new NotFoundException('消课记录不存在');
    return record;
  }

  /**
   * 撤销消课
   * 
   * 业务逻辑：
   * 1. 标记消课记录为已撤销
   * 2. 恢复合同课时
   */
  async revoke(id: string, reason: string, currentUser: any) {
    const record = await this.findOne(id);
    if (record.status !== 1) throw new BadRequestException('该消课记录已被撤销');

    await this.prisma.$transaction(async (tx) => {
      // 标记撤销
      await tx.lessonRecord.update({
        where: { id },
        data: {
          status: 2, // 已撤销
          revokeReason: reason,
          revokedAt: new Date(),
          revokedById: currentUser.userId,
        },
      });

      // 恢复合同课时
      const contract = await tx.contract.findUnique({ where: { id: record.contractId } });
      if (contract) {
        await tx.contract.update({
          where: { id: record.contractId },
          data: {
            usedLessons: contract.usedLessons - record.consumedCount,
            remainLessons: contract.remainLessons + record.consumedCount,
            // 如果合同是已耗尽状态，恢复为正常
            status: contract.status === 2 ? 1 : contract.status,
          },
        });
      }
    });

    return this.findOne(id);
  }

  /**
   * 消课统计
   */
  async getStatistics(query: { campusId?: string; teacherId?: string; startDate?: string; endDate?: string }) {
    const { campusId, teacherId, startDate, endDate } = query;
    const where: any = { status: 1 };

    if (campusId) where.campusId = campusId;
    if (teacherId) where.teacherId = teacherId;
    if (startDate && endDate) {
      where.attendDate = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: { consumedCount: true, consumedAmount: true },
    });

    // 按教师统计
    const byTeacher = await this.prisma.lessonRecord.groupBy({
      by: ['teacherId'],
      where,
      _count: true,
      _sum: { consumedCount: true, consumedAmount: true },
    });

    // 获取教师名称
    const teacherIds = byTeacher.map((t) => t.teacherId);
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t.name]));

    return {
      summary: {
        totalRecords: summary._count,
        totalLessons: summary._sum.consumedCount || 0,
        totalAmount: summary._sum.consumedAmount || 0,
      },
      byTeacher: byTeacher.map((t) => ({
        teacherId: t.teacherId,
        teacherName: teacherMap.get(t.teacherId) || '未知',
        recordCount: t._count,
        lessonCount: t._sum.consumedCount || 0,
        amount: t._sum.consumedAmount || 0,
      })),
    };
  }
}
