import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';

@Injectable()
export class CampusService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: any, createdById: string) {
    const existing = await this.prisma.campus.findUnique({
      where: { code: createDto.code },
    });
    if (existing) throw new ConflictException('校区编码已存在');

    return this.prisma.campus.create({
      data: { ...createDto, createdBy: createdById },
    });
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, status } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
      ];
    }
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.campus.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.campus.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findOne(id: string) {
    const campus = await this.prisma.campus.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, teachers: true, students: true, contracts: true } },
      },
    });
    if (!campus) throw new NotFoundException('校区不存在');
    return campus;
  }

  async update(id: string, updateDto: any) {
    await this.findOne(id);
    return this.prisma.campus.update({ where: { id }, data: updateDto });
  }
}

