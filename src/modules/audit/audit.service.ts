import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryAuditDto } from './dto';
import { PaginatedResponseDto } from '../../common/dto';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取操作日志列表
   */
  async getLogs(query: QueryAuditDto) {
    const { page = 1, pageSize = 20, userId, module, action, bizType, startDate, endDate } = query;

    const where: any = {};

    if (userId) where.userId = userId;
    if (module) where.module = module;
    if (action) where.action = action;
    if (bizType) where.bizType = bizType;

    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    return new PaginatedResponseDto(data, total, page, pageSize);
  }

  /**
   * 获取操作日志详情
   */
  async getLogDetail(id: string) {
    const log = await this.prisma.operationLog.findUnique({
      where: { id },
    });

    if (!log) {
      throw new NotFoundException('日志不存在');
    }

    return log;
  }

  /**
   * 获取指定用户的操作日志
   */
  async getLogsByUser(userId: string, query: QueryAuditDto) {
    return this.getLogs({ ...query, userId });
  }

  /**
   * 获取指定业务对象的操作日志
   */
  async getLogsByBusiness(bizType: string, bizId: string) {
    return this.prisma.operationLog.findMany({
      where: { bizType, bizId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建操作日志
   */
  async createLog(data: {
    userId: string;
    userName: string;
    module: string;
    action: string;
    bizType?: string;
    bizId?: string;
    beforeData?: any;
    afterData?: any;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.operationLog.create({ data });
  }

  /**
   * 获取审计统计
   */
  async getStatistics(query: QueryAuditDto) {
    const where: any = {};

    if (query.startDate && query.endDate) {
      where.createdAt = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    // 按模块统计
    const byModule = await this.prisma.operationLog.groupBy({
      by: ['module'],
      where,
      _count: true,
    });

    // 按操作类型统计
    const byAction = await this.prisma.operationLog.groupBy({
      by: ['action'],
      where,
      _count: true,
    });

    // 按用户统计（Top 10）
    const byUser = await this.prisma.operationLog.groupBy({
      by: ['userId', 'userName'],
      where,
      _count: true,
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // 总数
    const total = await this.prisma.operationLog.count({ where });

    return {
      total,
      byModule: byModule.map((m) => ({
        module: m.module,
        moduleName: this.getModuleName(m.module),
        count: m._count,
      })),
      byAction: byAction.map((a) => ({
        action: a.action,
        actionName: this.getActionName(a.action),
        count: a._count,
      })),
      byUser: byUser.map((u) => ({
        userId: u.userId,
        userName: u.userName,
        count: u._count,
      })),
    };
  }

  /**
   * 获取所有模块列表
   */
  async getModules() {
    const modules = await this.prisma.operationLog.findMany({
      select: { module: true },
      distinct: ['module'],
    });

    return modules.map((m) => ({
      code: m.module,
      name: this.getModuleName(m.module),
    }));
  }

  /**
   * 获取模块中文名称
   */
  private getModuleName(module: string): string {
    const moduleNames: Record<string, string> = {
      auth: '认证',
      user: '用户管理',
      role: '角色管理',
      campus: '校区管理',
      teacher: '教师管理',
      student: '学员管理',
      'course-package': '课包管理',
      contract: '合同管理',
      lesson: '消课管理',
      refund: '退费管理',
      finance: '财务管理',
    };
    return moduleNames[module] || module;
  }

  /**
   * 获取操作类型中文名称
   */
  private getActionName(action: string): string {
    const actionNames: Record<string, string> = {
      CREATE: '创建',
      UPDATE: '更新',
      DELETE: '删除',
      LOGIN: '登录',
      LOGOUT: '登出',
      APPROVE: '审批',
      REVOKE: '撤销',
      COMPLETE: '完成',
    };
    return actionNames[action] || action;
  }
}

