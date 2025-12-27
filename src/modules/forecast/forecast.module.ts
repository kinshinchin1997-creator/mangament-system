import { Module } from '@nestjs/common';
import { ForecastController } from './forecast.controller';
import { CashflowForecastService } from './services/cashflow-forecast.service';
import { RevenueForecastService } from './services/revenue-forecast.service';
import { RiskAlertService } from './services/risk-alert.service';
import { RollingForecastService } from './services/rolling-forecast.service';

/**
 * ============================================
 * 预测模块
 * ============================================
 * 
 * 职责：基于历史数据进行财务预测
 * - 13周滚动预测（核心功能）
 * - 现金流预测
 * - 收入预测
 * - 风险预警
 * - 人工调整支持
 * 
 * ============================================
 * 功能架构
 * ============================================
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    ForecastModule                           │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │  ┌─────────────────────┐   ┌─────────────────────┐         │
 * │  │ RollingForecastSvc  │   │ CashflowForecastSvc │         │
 * │  │ 13周滚动预测        │   │ 现金流预测          │         │
 * │  │ - 基于历史数据      │   │ - 短期预测          │         │
 * │  │ - 人工调整         │   │ - 月度预测          │         │
 * │  │ - 预警检查         │   │                     │         │
 * │  └─────────────────────┘   └─────────────────────┘         │
 * │                                                             │
 * │  ┌─────────────────────┐   ┌─────────────────────┐         │
 * │  │ RevenueForecastSvc  │   │ RiskAlertService    │         │
 * │  │ 收入预测            │   │ 风险预警            │         │
 * │  │ - 消课速度预测      │   │ - 合同到期预警      │         │
 * │  │ - 过期合同分析      │   │ - 余额不足预警      │         │
 * │  │                     │   │ - 休眠学员预警      │         │
 * │  └─────────────────────┘   └─────────────────────┘         │
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * ============================================
 * 数据来源
 * ============================================
 * 
 * ┌────────────┬──────────────────────────────────────────┐
 * │ 数据表      │ 用途                                      │
 * ├────────────┼──────────────────────────────────────────┤
 * │ Payment    │ 现金流入历史 → 预测收款                   │
 * │ Refund     │ 现金流出历史 → 预测退费                   │
 * │ Lesson     │ 消课历史 → 预测确认收入                   │
 * │ Contract   │ 剩余课时/未消课金额 → 预收款余额          │
 * └────────────┴──────────────────────────────────────────┘
 * 
 * ============================================
 * 13周滚动预测算法
 * ============================================
 * 
 * 1. 基准值计算：
 *    - 收集最近12周历史数据
 *    - 计算加权移动平均
 * 
 * 2. 调整因子：
 *    - 季节系数（寒暑假高峰）
 *    - 趋势系数（增长/衰退）
 *    - 衰减系数（越远越不确定）
 * 
 * 3. 人工调整：
 *    - 支持覆盖预测值
 *    - 记录调整原因
 *    - 可锁定已确认预测
 * 
 * 4. 预警检查：
 *    - 净现金流转负
 *    - 预收款余额过低
 *    - 余额下降趋势
 * 
 * ============================================
 * API 接口
 * ============================================
 * 
 * 13周滚动预测：
 *   GET  /forecast/rolling-13-week        获取预测
 *   GET  /forecast/rolling-13-week/history  历史数据
 *   POST /forecast/rolling-13-week/adjust   调整预测
 *   POST /forecast/rolling-13-week/batch-adjust  批量调整
 *   POST /forecast/rolling-13-week/lock     锁定预测
 * 
 * 现金流预测：
 *   GET  /forecast/cashflow            短期预测
 *   GET  /forecast/cashflow/monthly    月度预测
 * 
 * 收入预测：
 *   GET  /forecast/revenue             确认收入预测
 *   GET  /forecast/revenue/expiring    过期合同分析
 * 
 * 风险预警：
 *   GET  /forecast/alerts              全部预警
 *   GET  /forecast/alerts/*            分类预警
 *   GET  /forecast/alert-rules         预警规则【预留】
 *   PUT  /forecast/alert-rules/:id     更新规则【预留】
 */
@Module({
  controllers: [ForecastController],
  providers: [
    RollingForecastService,
    CashflowForecastService,
    RevenueForecastService,
    RiskAlertService,
  ],
  exports: [
    RollingForecastService,
    CashflowForecastService,
    RevenueForecastService,
    RiskAlertService,
  ],
})
export class ForecastModule {}
