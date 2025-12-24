import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponseDto } from '../../common/dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: any) {
    const existing = await this.prisma.user.findUnique({
      where: { username: createDto.username },
    });
    if (existing) throw new ConflictException('用户名已存在');

    const hashedPassword = await bcrypt.hash(createDto.password, 10);
    const user = await this.prisma.user.create({
      data: { ...createDto, password: hashedPassword },
    });

    if (createDto.roleIds?.length > 0) {
      await this.assignRoles(user.id, createDto.roleIds);
    }
    return this.findOne(user.id);
  }

  async findAll(query: any) {
    const { page = 1, pageSize = 20, keyword, campusId, status } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { realName: { contains: keyword } },
      ];
    }
    if (campusId) where.campusId = campusId;
    if (status !== undefined) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          campus: { select: { id: true, name: true } },
          userRoles: { include: { role: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    const safeData = data.map(({ password, ...rest }) => rest);
    return new PaginatedResponseDto(safeData, total, page, pageSize);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        campus: true,
        userRoles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const { password, ...safeUser } = user;
    return safeUser;
  }

  async update(id: string, updateDto: any) {
    await this.findOne(id);
    const { roleIds, ...userData } = updateDto;

    if (userData.password) {
      userData.password = await bcrypt.hash(userData.password, 10);
    }

    await this.prisma.user.update({ where: { id }, data: userData });
    if (roleIds) await this.assignRoles(id, roleIds);
    return this.findOne(id);
  }

  async resetPassword(id: string) {
    await this.findOne(id);
    const defaultPassword = await bcrypt.hash('123456', 10);
    await this.prisma.user.update({ where: { id }, data: { password: defaultPassword } });
    return { message: '密码已重置为123456' };
  }

  async assignRoles(userId: string, roleIds: string[]) {
    await this.prisma.userRole.deleteMany({ where: { userId } });
    if (roleIds.length > 0) {
      await this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId })),
      });
    }
  }
}

