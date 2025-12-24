import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取所有权限列表
   */
  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * 获取权限树（按模块分组）
   */
  async getTree() {
    const permissions = await this.findAll();

    // 按模块分组
    const moduleMap = new Map<string, any[]>();

    for (const permission of permissions) {
      const module = permission.module;
      if (!moduleMap.has(module)) {
        moduleMap.set(module, []);
      }
      moduleMap.get(module)!.push(permission);
    }

    // 转换为树形结构
    const tree = [];
    for (const [module, perms] of moduleMap) {
      tree.push({
        module,
        moduleName: this.getModuleName(module),
        permissions: perms,
      });
    }

    return tree;
  }

  /**
   * 获取所有模块列表
   */
  async getModules() {
    const permissions = await this.prisma.permission.findMany({
      select: { module: true },
      distinct: ['module'],
    });

    return permissions.map((p) => ({
      code: p.module,
      name: this.getModuleName(p.module),
    }));
  }

  /**
   * 获取模块中文名称
   */
  private getModuleName(module: string): string {
    const moduleNames: Record<string, string> = {
      contract: '合同管理',
      lesson: '消课管理',
      refund: '退费管理',
      finance: '财务管理',
      user: '用户管理',
      campus: '校区管理',
      teacher: '教师管理',
      student: '学员管理',
      'course-package': '课包管理',
      role: '角色管理',
      permission: '权限管理',
      report: '报表管理',
      audit: '审计日志',
    };
    return moduleNames[module] || module;
  }

  /**
   * 初始化权限数据（用于 seed）
   */
  async initPermissions() {
    const permissions = [
      // 合同权限
      { code: 'contract:create', name: '创建合同', module: 'contract' },
      { code: 'contract:read', name: '查看合同', module: 'contract' },
      { code: 'contract:update', name: '更新合同', module: 'contract' },
      { code: 'contract:complete', name: '完结合同', module: 'contract' },

      // 消课权限
      { code: 'lesson:create', name: '创建消课', module: 'lesson' },
      { code: 'lesson:read', name: '查看消课', module: 'lesson' },
      { code: 'lesson:revoke', name: '撤销消课', module: 'lesson' },

      // 退费权限
      { code: 'refund:create', name: '申请退费', module: 'refund' },
      { code: 'refund:read', name: '查看退费', module: 'refund' },
      { code: 'refund:approve', name: '审批退费', module: 'refund' },
      { code: 'refund:complete', name: '完成退费', module: 'refund' },

      // 财务权限
      { code: 'finance:read', name: '查看财务', module: 'finance' },
      { code: 'finance:report', name: '财务报表', module: 'finance' },
      { code: 'finance:settlement', name: '日结管理', module: 'finance' },

      // 用户权限
      { code: 'user:create', name: '创建用户', module: 'user' },
      { code: 'user:read', name: '查看用户', module: 'user' },
      { code: 'user:update', name: '更新用户', module: 'user' },
      { code: 'user:delete', name: '删除用户', module: 'user' },

      // 校区权限
      { code: 'campus:create', name: '创建校区', module: 'campus' },
      { code: 'campus:read', name: '查看校区', module: 'campus' },
      { code: 'campus:update', name: '更新校区', module: 'campus' },
      { code: 'campus:delete', name: '删除校区', module: 'campus' },

      // 教师权限
      { code: 'teacher:create', name: '创建教师', module: 'teacher' },
      { code: 'teacher:read', name: '查看教师', module: 'teacher' },
      { code: 'teacher:update', name: '更新教师', module: 'teacher' },

      // 学员权限
      { code: 'student:create', name: '创建学员', module: 'student' },
      { code: 'student:read', name: '查看学员', module: 'student' },
      { code: 'student:update', name: '更新学员', module: 'student' },

      // 课包权限
      { code: 'course-package:create', name: '创建课包', module: 'course-package' },
      { code: 'course-package:read', name: '查看课包', module: 'course-package' },
      { code: 'course-package:update', name: '更新课包', module: 'course-package' },

      // 角色权限
      { code: 'role:create', name: '创建角色', module: 'role' },
      { code: 'role:read', name: '查看角色', module: 'role' },
      { code: 'role:update', name: '更新角色', module: 'role' },
      { code: 'role:delete', name: '删除角色', module: 'role' },

      // 审计权限
      { code: 'audit:read', name: '查看审计日志', module: 'audit' },
    ];

    for (const permission of permissions) {
      await this.prisma.permission.upsert({
        where: { code: permission.code },
        update: {},
        create: permission,
      });
    }

    return { message: '权限初始化完成', count: permissions.length };
  }
}

