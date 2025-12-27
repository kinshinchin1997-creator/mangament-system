import { Module } from '@nestjs/common';
import { AlertController } from './alert.controller';
import { AlertRuleService } from './services/alert-rule.service';
import { AlertEventService } from './services/alert-event.service';
import { MetricCalculatorService } from './services/metric-calculator.service';

/**
 * ============================================
 * 现金流预警模块
 * ============================================
 * 
 * 职责：现金流风险预警与监控
 * - 预警规则配置（阈值可调）
 * - 指标实时计算
 * - 预警事件生成与管理
 * - 通知发送（预留）
 * 
 * ============================================
 * 预置规则示例
 * ============================================
 * 
 * 1. 未来8周现金流为负
 *    指标: NET_CASHFLOW
 *    条件: < 0
 *    级别: DANGER
 * 
 * 2. 退费率 > 10%
 *    指标: REFUND_RATE
 *    条件: > 10%
 *    级别: WARNING
 * 
 * 3. 预收覆盖月数 < 3
 *    指标: PREPAID_COVERAGE_MONTHS
 *    条件: < 3
 *    级别: WARNING
 * 
 * ============================================
 * 预警事件结构
 * ============================================
 * 
 * {
 *   id: "uuid",
 *   ruleId: "规则ID",
 *   ruleName: "规则名称",
 *   type: "CASHFLOW_NEGATIVE",
 *   level: "danger",
 *   status: "active",
 *   
 *   triggeredAt: "2024-01-01T10:00:00Z",
 *   triggeredValue: -50000,
 *   threshold: 0,
 *   operator: "lt",
 *   
 *   campusId: "校区ID",
 *   campusName: "总部校区",
 *   
 *   title: "未来8周现金流为负",
 *   message: "预测累计净现金流为 -50000元",
 *   suggestedAction: "检查收款计划...",
 *   
 *   details: {
 *     metric: "net_cashflow",
 *     forecastWeeks: 8,
 *     relatedData: {...}
 *   },
 *   
 *   acknowledgedAt: null,
 *   resolvedAt: null,
 *   notifiedChannels: ["system", "email"]
 * }
 * 
 * ============================================
 * 功能架构
 * ============================================
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                     AlertModule                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │  ┌─────────────────────┐   ┌─────────────────────┐         │
 * │  │ AlertRuleService    │   │ AlertEventService   │         │
 * │  │ 规则管理            │   │ 事件管理            │         │
 * │  │ - 规则 CRUD         │   │ - 执行检查          │         │
 * │  │ - 预置规则          │   │ - 生成事件          │         │
 * │  │ - 启用/禁用         │   │ - 事件生命周期      │         │
 * │  │ - 导入/导出         │   │ - 发送通知          │         │
 * │  └─────────────────────┘   └─────────────────────┘         │
 * │                                                             │
 * │  ┌─────────────────────────────────────────────────────┐   │
 * │  │ MetricCalculatorService                             │   │
 * │  │ 指标计算                                            │   │
 * │  │ - 现金流指标 (Payment/Refund)                       │   │
 * │  │ - 预收款指标 (Contract.unearned)                    │   │
 * │  │ - 退费指标 (Refund)                                 │   │
 * │  │ - 合同指标 (Contract)                               │   │
 * │  │ - 学员指标 (Student/Lesson)                         │   │
 * │  └─────────────────────────────────────────────────────┘   │
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * ============================================
 * API 接口
 * ============================================
 * 
 * 规则管理：
 *   POST   /alerts/rules           创建规则
 *   GET    /alerts/rules           规则列表
 *   GET    /alerts/rules/:id       规则详情
 *   PUT    /alerts/rules/:id       更新规则
 *   DELETE /alerts/rules/:id       删除规则
 *   PUT    /alerts/rules/:id/enable   启用
 *   PUT    /alerts/rules/:id/disable  禁用
 *   POST   /alerts/rules/reset     重置默认
 * 
 * 事件管理：
 *   POST   /alerts/check           执行检查
 *   GET    /alerts/events          事件列表
 *   GET    /alerts/events/active   活跃事件
 *   GET    /alerts/events/:id      事件详情
 *   PUT    /alerts/events/:id/handle  处理事件
 *   POST   /alerts/events/batch-acknowledge  批量确认
 * 
 * 指标查询：
 *   GET    /alerts/metrics         所有指标
 *   GET    /alerts/metrics/:metric 单个指标
 * 
 * 仪表盘：
 *   GET    /alerts/dashboard       预警概览
 */
@Module({
  controllers: [AlertController],
  providers: [
    AlertRuleService,
    AlertEventService,
    MetricCalculatorService,
  ],
  exports: [
    AlertRuleService,
    AlertEventService,
    MetricCalculatorService,
  ],
})
export class AlertModule {}

