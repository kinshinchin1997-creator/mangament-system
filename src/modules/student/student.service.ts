import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator } from '../../common/utils';

@Injectable()
export class StudentService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: any) {
    const code = NumberGenerator.generateStudentCode();
    return this.prisma.student.create({
      data: { ...createDto, code },
      include: { campus: { select: { id: true, name: true } } },
    });
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, status } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
        { parentPhone: { contains: keyword } },
      ];
    }
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          campus: { select: { id: true, name: true } },
          _count: { select: { contracts: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.student.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        campus: true,
        contracts: {
          where: { status: 1 },
          include: { package: { select: { id: true, name: true } } },
        },
      },
    });
    if (!student) throw new NotFoundException('学员不存在');
    return student;
  }

  async update(id: string, updateDto: any) {
    await this.findOne(id);
    return this.prisma.student.update({
      where: { id },
      data: updateDto,
      include: { campus: { select: { id: true, name: true } } },
    });
  }

  async getContracts(studentId: string) {
    await this.findOne(studentId);
    return this.prisma.contract.findMany({
      where: { studentId },
      include: { package: true, campus: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

