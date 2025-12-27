import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
  QueryAlertRuleDto,
  AlertRule,
  AlertType,
  AlertLevel,
  MetricType,
  CompareOperator,
  NotifyChannel,
} from '../dto';
import { randomUUID } from 'crypto';

/**
 * ============================================
 * 预警规则服务
 * ============================================
 * 
 * 职责：
 * 1. 预警规则的增删改查
 * 2. 预置规则初始化
 * 3. 规则启用/禁用
 * 
 * 规则存储：
 * - 生产环境应存入数据库（可使用 SystemConfig 表或新建 AlertRule 表）
 * - 当前使用内存存储作为示例
 */
@Injectable()
export class AlertRuleService {
  constructor(private prisma: PrismaService) {
    // 初始化预置规则
    this.initDefaultRules();
  }

  // 内存存储（生产环境应改为数据库）
  private rules = new Map<string, AlertRule>();

  // ============================================
  // 一、预置规则初始化
  // ============================================

  /**
   * 初始化默认预警规则
   * 
   * 包含用户要求的三个示例规则：
   * 1. 未来8周现金为负
   * 2. 退费率 > 10%
   * 3. 预收覆盖月数 < 3
   */
  private initDefaultRules() {
    const defaultRules: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
      // ============================================
      // 规则1: 未来8周现金流为负
      // ============================================
      {
        name: '未来8周现金流为负',
        description: '预测未来8周内累计净现金流将变为负数，需要关注资金安全',
        type: AlertType.CASHFLOW_NEGATIVE,
        level: AlertLevel.DANGER,
        condition: {
          metric: MetricType.NET_CASHFLOW,
          operator: CompareOperator.LT,
          threshold: 0,
          unit: '元',
          forecastWeeks: 8,
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM, NotifyChannel.EMAIL],
          recipientRoles: ['BOSS', 'FINANCE'],
          cooldownHours: 24,
        },
        suggestedAction: '1. 检查收款计划是否正常执行\n2. 评估大额支出是否可延期\n3. 加强招生和续费工作',
        enabled: true,
        priority: 10,
      },

      // ============================================
      // 规则2: 退费率 > 10%
      // ============================================
      {
        name: '退费率超过10%',
        description: '近30天退费金额占收款金额比例超过10%，需要分析退费原因',
        type: AlertType.REFUND_RATE_HIGH,
        level: AlertLevel.WARNING,
        condition: {
          metric: MetricType.REFUND_RATE,
          operator: CompareOperator.GT,
          threshold: 10,
          unit: '%',
          periodDays: 30,
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM],
          recipientRoles: ['BOSS', 'FINANCE', 'CAMPUS_MANAGER'],
          cooldownHours: 48,
        },
        suggestedAction: '1. 分析退费原因分布\n2. 检查课程质量反馈\n3. 跟进高退费率校区/教师',
        enabled: true,
        priority: 20,
      },

      // ============================================
      // 规则3: 预收覆盖月数 < 3
      // ============================================
      {
        name: '预收覆盖月数不足3个月',
        description: '当前预收款余额按月均消课速度计算，不足以支撑3个月运营',
        type: AlertType.PREPAID_COVERAGE_LOW,
        level: AlertLevel.WARNING,
        condition: {
          metric: MetricType.PREPAID_COVERAGE_MONTHS,
          operator: CompareOperator.LT,
          threshold: 3,
          unit: '月',
          periodDays: 90, // 基于近90天消课速度
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM, NotifyChannel.EMAIL],
          recipientRoles: ['BOSS', 'FINANCE'],
          cooldownHours: 72,
        },
        suggestedAction: '1. 加强招生工作，增加新签合同\n2. 推进续费工作\n3. 评估运营成本优化空间',
        enabled: true,
        priority: 15,
      },

      // ============================================
      // 其他预置规则
      // ============================================

      // 规则4: 预收款余额过低
      {
        name: '预收款余额过低',
        description: '预收款余额低于设定阈值',
        type: AlertType.PREPAID_LOW,
        level: AlertLevel.DANGER,
        condition: {
          metric: MetricType.PREPAID_BALANCE,
          operator: CompareOperator.LT,
          threshold: 50000,
          unit: '元',
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM, NotifyChannel.EMAIL, NotifyChannel.SMS],
          recipientRoles: ['BOSS'],
          cooldownHours: 12,
        },
        suggestedAction: '紧急启动招生计划，确保资金安全',
        enabled: true,
        priority: 5,
      },

      // 规则5: 合同即将过期
      {
        name: '合同即将过期',
        description: '有合同将在30天内到期且仍有剩余课时',
        type: AlertType.CONTRACT_EXPIRING,
        level: AlertLevel.INFO,
        condition: {
          metric: MetricType.EXPIRING_CONTRACTS,
          operator: CompareOperator.GT,
          threshold: 0,
          unit: '份',
          periodDays: 30,
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM],
          recipientRoles: ['CAMPUS_MANAGER'],
          cooldownHours: 24,
        },
        suggestedAction: '联系学员家长安排续费或加快消课',
        enabled: true,
        priority: 50,
      },

      // 规则6: 学员休眠
      {
        name: '休眠学员过多',
        description: '超过30天未上课的在读学员数量超过阈值',
        type: AlertType.STUDENT_INACTIVE,
        level: AlertLevel.WARNING,
        condition: {
          metric: MetricType.INACTIVE_STUDENTS,
          operator: CompareOperator.GT,
          threshold: 10,
          unit: '人',
          periodDays: 30,
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM],
          recipientRoles: ['CAMPUS_MANAGER'],
          cooldownHours: 48,
        },
        suggestedAction: '电话回访休眠学员，了解原因并安排复课',
        enabled: true,
        priority: 40,
      },

      // 规则7: 课时余额不足
      {
        name: '课时余额不足',
        description: '有合同剩余课时不足5节',
        type: AlertType.LESSON_BALANCE_LOW,
        level: AlertLevel.INFO,
        condition: {
          metric: MetricType.LOW_BALANCE_CONTRACTS,
          operator: CompareOperator.GT,
          threshold: 0,
          unit: '份',
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM],
          recipientRoles: ['CAMPUS_MANAGER'],
          cooldownHours: 24,
        },
        suggestedAction: '提醒学员续费',
        enabled: true,
        priority: 60,
      },

      // 规则8: 退费金额过高
      {
        name: '单日退费金额过高',
        description: '单日退费金额超过阈值',
        type: AlertType.REFUND_AMOUNT_HIGH,
        level: AlertLevel.DANGER,
        condition: {
          metric: MetricType.REFUND_AMOUNT,
          operator: CompareOperator.GT,
          threshold: 10000,
          unit: '元',
          periodDays: 1,
        },
        notifyConfig: {
          channels: [NotifyChannel.SYSTEM, NotifyChannel.EMAIL],
          recipientRoles: ['BOSS', 'FINANCE'],
          cooldownHours: 12,
        },
        suggestedAction: '检查大额退费原因，评估是否存在系统性问题',
        enabled: true,
        priority: 10,
      },
    ];

    // 添加到存储
    const now = new Date();
    defaultRules.forEach((rule) => {
      const id = randomUUID();
      this.rules.set(id, {
        id,
        ...rule,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  // ============================================
  // 二、规则 CRUD
  // ============================================

  /**
   * 创建预警规则
   */
  async create(createDto: CreateAlertRuleDto): Promise<AlertRule> {
    const id = randomUUID();
    const now = new Date();

    const rule: AlertRule = {
      id,
      name: createDto.name,
      description: createDto.description,
      type: createDto.type,
      level: createDto.level,
      condition: createDto.condition,
      notifyConfig: createDto.notifyConfig,
      suggestedAction: createDto.suggestedAction,
      enabled: createDto.enabled ?? true,
      campusIds: createDto.campusIds,
      priority: createDto.priority ?? 100,
      createdAt: now,
      updatedAt: now,
    };

    this.rules.set(id, rule);
    return rule;
  }

  /**
   * 获取所有规则
   */
  async findAll(query?: QueryAlertRuleDto): Promise<AlertRule[]> {
    let rules = Array.from(this.rules.values());

    // 筛选
    if (query?.type) {
      rules = rules.filter((r) => r.type === query.type);
    }
    if (query?.enabled !== undefined) {
      rules = rules.filter((r) => r.enabled === query.enabled);
    }
    if (query?.campusId) {
      rules = rules.filter(
        (r) => !r.campusIds || r.campusIds.length === 0 || r.campusIds.includes(query.campusId!)
      );
    }

    // 按优先级排序
    return rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取单个规则
   */
  async findOne(id: string): Promise<AlertRule> {
    const rule = this.rules.get(id);
    if (!rule) {
      throw new NotFoundException('预警规则不存在');
    }
    return rule;
  }

  /**
   * 更新规则
   */
  async update(id: string, updateDto: UpdateAlertRuleDto): Promise<AlertRule> {
    const rule = await this.findOne(id);

    const updated: AlertRule = {
      ...rule,
      ...updateDto,
      condition: updateDto.condition ?? rule.condition,
      notifyConfig: updateDto.notifyConfig ?? rule.notifyConfig,
      updatedAt: new Date(),
    };

    this.rules.set(id, updated);
    return updated;
  }

  /**
   * 删除规则
   */
  async delete(id: string): Promise<void> {
    if (!this.rules.has(id)) {
      throw new NotFoundException('预警规则不存在');
    }
    this.rules.delete(id);
  }

  /**
   * 启用/禁用规则
   */
  async setEnabled(id: string, enabled: boolean): Promise<AlertRule> {
    return this.update(id, { enabled });
  }

  /**
   * 获取启用的规则
   */
  async getEnabledRules(campusId?: string): Promise<AlertRule[]> {
    return this.findAll({ enabled: true, campusId });
  }

  /**
   * 重置为默认规则
   */
  async resetToDefault(): Promise<void> {
    this.rules.clear();
    this.initDefaultRules();
  }

  /**
   * 导出规则配置
   */
  async exportRules(): Promise<AlertRule[]> {
    return Array.from(this.rules.values());
  }

  /**
   * 导入规则配置
   */
  async importRules(rules: CreateAlertRuleDto[], replace: boolean = false): Promise<number> {
    if (replace) {
      this.rules.clear();
    }

    let count = 0;
    for (const rule of rules) {
      await this.create(rule);
      count++;
    }
    return count;
  }
}

