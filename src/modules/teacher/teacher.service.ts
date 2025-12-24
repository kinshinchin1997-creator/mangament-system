import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';
import { NumberGenerator } from '../../common/utils';

@Injectable()
export class TeacherService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: any) {
    const code = NumberGenerator.generateTeacherCode();
    return this.prisma.teacher.create({
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
      ];
    }
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { campus: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.teacher.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findOne(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
      include: { campus: true },
    });
    if (!teacher) throw new NotFoundException('教师不存在');
    return teacher;
  }

  async update(id: string, updateDto: any) {
    await this.findOne(id);
    return this.prisma.teacher.update({
      where: { id },
      data: updateDto,
      include: { campus: { select: { id: true, name: true } } },
    });
  }
}

