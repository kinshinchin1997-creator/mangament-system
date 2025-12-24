import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto, QueryRoleDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto';

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建角色
   */
  async create(createDto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { code: createDto.code },
    });
    if (existing) {
      throw new ConflictException('角色编码已存在');
    }

    const role = await this.prisma.role.create({
      data: {
        code: createDto.code,
        name: createDto.name,
        description: createDto.description,
      },
    });

    // 如果有权限ID，分配权限
    if (createDto.permissionIds?.length) {
      await this.assignPermissions(role.id, createDto.permissionIds);
    }

    return this.findOne(role.id);
  }

  /**
   * 查询角色列表
   */
  async findAll(query: QueryRoleDto) {
    const { page = 1, pageSize = 20, keyword } = query;
    const where: any = {};

    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { userRoles: true, permissions: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.role.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取角色详情（含权限列表）
   */
  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: { select: { userRoles: true } },
      },
    });

    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    return {
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    };
  }

  /**
   * 更新角色
   */
  async update(id: string, updateDto: UpdateRoleDto) {
    await this.findOne(id);

    // 检查编码唯一性
    if (updateDto.code) {
      const existing = await this.prisma.role.findFirst({
        where: { code: updateDto.code, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException('角色编码已存在');
      }
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        code: updateDto.code,
        name: updateDto.name,
        description: updateDto.description,
      },
    });

    // 如果有权限ID，更新权限
    if (updateDto.permissionIds) {
      await this.assignPermissions(id, updateDto.permissionIds);
    }

    return this.findOne(id);
  }

  /**
   * 删除角色
   */
  async remove(id: string) {
    const role = await this.findOne(id);

    // 检查是否有用户使用此角色
    if (role._count.userRoles > 0) {
      throw new BadRequestException('该角色下有用户，无法删除');
    }

    // 系统内置角色不允许删除
    const builtInRoles = ['BOSS', 'FINANCE', 'CAMPUS_MANAGER', 'TEACHER'];
    if (builtInRoles.includes(role.code)) {
      throw new BadRequestException('系统内置角色不允许删除');
    }

    // 删除角色权限关联
    await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });

    // 删除角色
    return this.prisma.role.delete({ where: { id } });
  }

  /**
   * 分配权限给角色
   */
  async assignPermissions(roleId: string, permissionIds: string[]) {
    await this.findOne(roleId);

    // 删除现有权限
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });

    // 分配新权限
    if (permissionIds.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }

    return this.findOne(roleId);
  }
}

