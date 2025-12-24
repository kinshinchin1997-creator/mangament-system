import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';

@Injectable()
export class CoursePackageService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: any) {
    const existing = await this.prisma.coursePackage.findUnique({
      where: { code: createDto.code },
    });
    if (existing) throw new ConflictException('课包编码已存在');

    return this.prisma.coursePackage.create({
      data: createDto,
      include: { campus: { select: { id: true, name: true } } },
    });
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, category, status } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
      ];
    }
    if (campusId) where.campusId = campusId;
    if (category) where.category = category;
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.coursePackage.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { campus: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.coursePackage.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  async findAvailable(campusId: string) {
    return this.prisma.coursePackage.findMany({
      where: {
        status: 1,
        OR: [{ campusId: null }, { campusId }],
      },
      orderBy: [{ campusId: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const pkg = await this.prisma.coursePackage.findUnique({
      where: { id },
      include: { campus: true },
    });
    if (!pkg) throw new NotFoundException('课包不存在');
    return pkg;
  }

  async update(id: string, updateDto: any) {
    await this.findOne(id);
    return this.prisma.coursePackage.update({
      where: { id },
      data: updateDto,
      include: { campus: { select: { id: true, name: true } } },
    });
  }
}

