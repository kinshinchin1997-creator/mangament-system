import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AlertRuleService } from './alert-rule.service';
import { MetricCalculatorService } from './metric-calculator.service';
import {
  AlertRule,
  AlertEvent,
  AlertCheckResult,
  AlertStatistics,
  QueryAlertEventDto,
  HandleAlertEventDto,
  AlertType,
  AlertLevel,
  AlertStatus,
  CompareOperator,
  NotifyChannel,
} from '../dto';
import { randomUUID } from 'crypto';

/**
 * ============================================
 * 预警事件服务
 * ============================================
 * 
 * 职责：
 * 1. 执行预警规则检查
 * 2. 生成预警事件
 * 3. 管理预警事件生命周期
 * 4. 发送通知（预留）
 * 
 * 预警事件生命周期：
 * ACTIVE → ACKNOWLEDGED → RESOLVED
 *    ↓
 * IGNORED
 */
@Injectable()
export class AlertEventService {
  constructor(
    private prisma: PrismaService,
    private ruleService: AlertRuleService,
    private metricCalculator: MetricCalculatorService,
  ) {}

  // 内存存储（生产环境应改为数据库）
  private events = new Map<string, AlertEvent>();

  // 通知冷却记录
  private notifyCooldown = new Map<string, Date>();

  // ============================================
  // 一、执行预警检查
  // ============================================

  /**
   * 执行所有预警规则检查
   * 
   * 业务流程：
   * 1. 获取所有启用的规则
   * 2. 对每个规则计算指标值
   * 3. 比较指标值与阈值
   * 4. 触发的规则生成预警事件
   * 5. 返回检查结果
   * 
   * @param campusId 校区ID（可选）
   */
  async runAllChecks(campusId?: string): Promise<{
    checkedRules: number;
    triggeredAlerts: AlertEvent[];
    checkResults: AlertCheckResult[];
  }> {
    const rules = await this.ruleService.getEnabledRules(campusId);
    const triggeredAlerts: AlertEvent[] = [];
    const checkResults: AlertCheckResult[] = [];

    for (const rule of rules) {
      const result = await this.checkRule(rule, campusId);
      checkResults.push(result);

      if (result.triggered) {
        // 检查冷却时间
        if (!this.isInCooldown(rule.id, campusId)) {
          const event = await this.createEvent(rule, result, campusId);
          triggeredAlerts.push(event);

          // 发送通知
          await this.sendNotifications(event, rule);
        }
      }
    }

    return {
      checkedRules: rules.length,
      triggeredAlerts,
      checkResults,
    };
  }

  /**
   * 检查单个规则
   */
  async checkRule(rule: AlertRule, campusId?: string): Promise<AlertCheckResult> {
    const { condition } = rule;

    // 计算指标值
    const metricValue = await this.metricCalculator.calculate(
      condition.metric,
      campusId,
      {
        periodDays: condition.periodDays,
        forecastWeeks: condition.forecastWeeks,
      },
    );

    // 比较阈值
    const triggered = this.compareValue(
      metricValue.value,
      condition.operator,
      condition.threshold,
    );

    // 生成消息
    const message = triggered
      ? this.generateAlertMessage(rule, metricValue.value)
      : undefined;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      triggered,
      currentValue: metricValue.value,
      threshold: condition.threshold,
      operator: condition.operator,
      level: rule.level,
      message,
    };
  }

  /**
   * 比较值与阈值
   */
  private compareValue(
    value: number,
    operator: CompareOperator,
    threshold: number,
  ): boolean {
    switch (operator) {
      case CompareOperator.GT:
        return value > threshold;
      case CompareOperator.GTE:
        return value >= threshold;
      case CompareOperator.LT:
        return value < threshold;
      case CompareOperator.LTE:
        return value <= threshold;
      case CompareOperator.EQ:
        return value === threshold;
      case CompareOperator.NEQ:
        return value !== threshold;
      default:
        return false;
    }
  }

  /**
   * 生成预警消息
   */
  private generateAlertMessage(rule: AlertRule, currentValue: number): string {
    const { condition } = rule;
    const operatorText = this.getOperatorText(condition.operator);
    const unit = condition.unit || '';

    return `${rule.name}: 当前值 ${currentValue.toFixed(2)}${unit} ${operatorText} 阈值 ${condition.threshold}${unit}`;
  }

  /**
   * 获取运算符文本
   */
  private getOperatorText(operator: CompareOperator): string {
    const texts: Record<CompareOperator, string> = {
      [CompareOperator.GT]: '大于',
      [CompareOperator.GTE]: '大于等于',
      [CompareOperator.LT]: '小于',
      [CompareOperator.LTE]: '小于等于',
      [CompareOperator.EQ]: '等于',
      [CompareOperator.NEQ]: '不等于',
    };
    return texts[operator];
  }

  // ============================================
  // 二、预警事件管理
  // ============================================

  /**
   * 创建预警事件
   */
  async createEvent(
    rule: AlertRule,
    checkResult: AlertCheckResult,
    campusId?: string,
  ): Promise<AlertEvent> {
    const id = randomUUID();
    const now = new Date();

    // 获取校区名称
    let campusName: string | undefined;
    if (campusId) {
      const campus = await this.prisma.campus.findUnique({
        where: { id: campusId },
        select: { name: true },
      });
      campusName = campus?.name;
    }

    const event: AlertEvent = {
      id,
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      level: rule.level,
      status: AlertStatus.ACTIVE,
      triggeredAt: now,
      triggeredValue: checkResult.currentValue,
      threshold: checkResult.threshold,
      operator: checkResult.operator,
      campusId,
      campusName,
      title: rule.name,
      message: checkResult.message || '',
      suggestedAction: rule.suggestedAction,
      details: {
        metric: rule.condition.metric,
        periodDays: rule.condition.periodDays,
        forecastWeeks: rule.condition.forecastWeeks,
      },
    };

    this.events.set(id, event);

    // 记录冷却时间
    this.setCooldown(rule.id, campusId, rule.notifyConfig?.cooldownHours || 24);

    return event;
  }

  /**
   * 获取预警事件列表
   */
  async findAll(query?: QueryAlertEventDto): Promise<AlertEvent[]> {
    let events = Array.from(this.events.values());

    // 筛选
    if (query?.campusId) {
      events = events.filter((e) => e.campusId === query.campusId);
    }
    if (query?.type) {
      events = events.filter((e) => e.type === query.type);
    }
    if (query?.level) {
      events = events.filter((e) => e.level === query.level);
    }
    if (query?.status) {
      events = events.filter((e) => e.status === query.status);
    }
    if (query?.startDate && query?.endDate) {
      const start = new Date(query.startDate);
      const end = new Date(query.endDate + 'T23:59:59');
      events = events.filter(
        (e) => e.triggeredAt >= start && e.triggeredAt <= end,
      );
    }

    // 按时间倒序
    return events.sort(
      (a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime(),
    );
  }

  /**
   * 获取活跃预警
   */
  async getActiveAlerts(campusId?: string): Promise<AlertEvent[]> {
    return this.findAll({ campusId, status: AlertStatus.ACTIVE });
  }

  /**
   * 获取预警详情
   */
  async findOne(id: string): Promise<AlertEvent> {
    const event = this.events.get(id);
    if (!event) {
      throw new NotFoundException('预警事件不存在');
    }
    return event;
  }

  /**
   * 处理预警事件
   */
  async handleEvent(
    id: string,
    handleDto: HandleAlertEventDto,
    userId: string,
  ): Promise<AlertEvent> {
    const event = await this.findOne(id);
    const now = new Date();

    // 获取用户名
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { realName: true },
    });

    switch (handleDto.action) {
      case 'acknowledge':
        event.status = AlertStatus.ACKNOWLEDGED;
        event.acknowledgedAt = now;
        event.acknowledgedById = userId;
        event.acknowledgedBy = user?.realName;
        break;

      case 'resolve':
        event.status = AlertStatus.RESOLVED;
        event.resolvedAt = now;
        event.resolvedById = userId;
        event.resolvedBy = user?.realName;
        break;

      case 'ignore':
        event.status = AlertStatus.IGNORED;
        break;
    }

    event.handleRemark = handleDto.remark;
    this.events.set(id, event);

    return event;
  }

  /**
   * 批量确认预警
   */
  async batchAcknowledge(ids: string[], userId: string): Promise<number> {
    let count = 0;
    for (const id of ids) {
      try {
        await this.handleEvent(id, { action: 'acknowledge' }, userId);
        count++;
      } catch {
        // 忽略错误继续处理
      }
    }
    return count;
  }

  /**
   * 获取预警统计
   */
  async getStatistics(campusId?: string): Promise<AlertStatistics> {
    const events = await this.findAll({ campusId });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats: AlertStatistics = {
      total: events.length,
      byLevel: {
        [AlertLevel.INFO]: 0,
        [AlertLevel.WARNING]: 0,
        [AlertLevel.DANGER]: 0,
        [AlertLevel.CRITICAL]: 0,
      },
      byType: {} as Record<AlertType, number>,
      byStatus: {
        [AlertStatus.ACTIVE]: 0,
        [AlertStatus.ACKNOWLEDGED]: 0,
        [AlertStatus.RESOLVED]: 0,
        [AlertStatus.IGNORED]: 0,
      },
      activeCount: 0,
      resolvedToday: 0,
      avgResolutionHours: 0,
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    events.forEach((e) => {
      // 按级别统计
      stats.byLevel[e.level]++;

      // 按类型统计
      if (!stats.byType[e.type]) {
        stats.byType[e.type] = 0;
      }
      stats.byType[e.type]++;

      // 按状态统计
      stats.byStatus[e.status]++;

      // 活跃数
      if (e.status === AlertStatus.ACTIVE) {
        stats.activeCount++;
      }

      // 今日解决数
      if (e.resolvedAt && e.resolvedAt >= today) {
        stats.resolvedToday++;
      }

      // 平均解决时间
      if (e.resolvedAt) {
        totalResolutionTime += e.resolvedAt.getTime() - e.triggeredAt.getTime();
        resolvedCount++;
      }
    });

    stats.avgResolutionHours = resolvedCount > 0
      ? totalResolutionTime / resolvedCount / (1000 * 60 * 60)
      : 0;

    return stats;
  }

  // ============================================
  // 三、通知发送（预留）
  // ============================================

  /**
   * 发送通知
   */
  private async sendNotifications(
    event: AlertEvent,
    rule: AlertRule,
  ): Promise<void> {
    if (!rule.notifyConfig) return;

    const { channels, recipientIds, recipientRoles, webhookUrl } = rule.notifyConfig;

    for (const channel of channels) {
      try {
        switch (channel) {
          case NotifyChannel.SYSTEM:
            await this.sendSystemNotification(event, recipientIds, recipientRoles);
            break;

          case NotifyChannel.EMAIL:
            await this.sendEmailNotification(event, recipientIds, recipientRoles);
            break;

          case NotifyChannel.SMS:
            await this.sendSmsNotification(event, recipientIds, recipientRoles);
            break;

          case NotifyChannel.WECHAT:
            await this.sendWechatNotification(event, recipientIds, recipientRoles);
            break;

          case NotifyChannel.WEBHOOK:
            if (webhookUrl) {
              await this.sendWebhookNotification(event, webhookUrl);
            }
            break;
        }

        // 记录已发送的通知渠道
        if (!event.notifiedChannels) {
          event.notifiedChannels = [];
        }
        event.notifiedChannels.push(channel);
        event.lastNotifiedAt = new Date();
      } catch (error) {
        console.error(`发送通知失败 [${channel}]:`, error);
      }
    }

    this.events.set(event.id, event);
  }

  /**
   * 发送系统内通知
   * 【预留接口】可对接内部消息系统
   */
  private async sendSystemNotification(
    event: AlertEvent,
    recipientIds?: string[],
    recipientRoles?: string[],
  ): Promise<void> {
    console.log('发送系统通知:', {
      eventId: event.id,
      title: event.title,
      recipientIds,
      recipientRoles,
    });
    // TODO: 实现系统内通知
  }

  /**
   * 发送邮件通知
   * 【预留接口】可对接邮件服务
   */
  private async sendEmailNotification(
    event: AlertEvent,
    recipientIds?: string[],
    recipientRoles?: string[],
  ): Promise<void> {
    console.log('发送邮件通知:', {
      eventId: event.id,
      title: event.title,
      message: event.message,
    });
    // TODO: 实现邮件通知
  }

  /**
   * 发送短信通知
   * 【预留接口】可对接短信服务
   */
  private async sendSmsNotification(
    event: AlertEvent,
    recipientIds?: string[],
    recipientRoles?: string[],
  ): Promise<void> {
    console.log('发送短信通知:', {
      eventId: event.id,
      title: event.title,
    });
    // TODO: 实现短信通知
  }

  /**
   * 发送微信通知
   * 【预留接口】可对接微信企业号/公众号
   */
  private async sendWechatNotification(
    event: AlertEvent,
    recipientIds?: string[],
    recipientRoles?: string[],
  ): Promise<void> {
    console.log('发送微信通知:', {
      eventId: event.id,
      title: event.title,
    });
    // TODO: 实现微信通知
  }

  /**
   * 发送 Webhook 通知
   * 【预留接口】可对接第三方系统
   */
  private async sendWebhookNotification(
    event: AlertEvent,
    webhookUrl: string,
  ): Promise<void> {
    console.log('发送Webhook通知:', {
      eventId: event.id,
      webhookUrl,
    });
    // TODO: 实现 Webhook 通知
    // await fetch(webhookUrl, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(event),
    // });
  }

  // ============================================
  // 四、冷却时间管理
  // ============================================

  /**
   * 检查是否在冷却期
   */
  private isInCooldown(ruleId: string, campusId?: string): boolean {
    const key = `${ruleId}_${campusId || 'ALL'}`;
    const cooldownUntil = this.notifyCooldown.get(key);

    if (!cooldownUntil) return false;
    return new Date() < cooldownUntil;
  }

  /**
   * 设置冷却时间
   */
  private setCooldown(ruleId: string, campusId: string | undefined, hours: number): void {
    const key = `${ruleId}_${campusId || 'ALL'}`;
    const cooldownUntil = new Date();
    cooldownUntil.setHours(cooldownUntil.getHours() + hours);
    this.notifyCooldown.set(key, cooldownUntil);
  }

  /**
   * 清除冷却时间
   */
  clearCooldown(ruleId: string, campusId?: string): void {
    const key = `${ruleId}_${campusId || 'ALL'}`;
    this.notifyCooldown.delete(key);
  }

  /**
   * 清除所有预警事件（用于测试）
   */
  clearAll(): void {
    this.events.clear();
    this.notifyCooldown.clear();
  }
}

