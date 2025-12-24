import { Module } from '@nestjs/common';
import { ForecastController } from './forecast.controller';
import { CashflowForecastService } from './services/cashflow-forecast.service';
import { RevenueForecastService } from './services/revenue-forecast.service';
import { RiskAlertService } from './services/risk-alert.service';

/**
 * 预测模块
 * 
 * 职责：基于历史数据进行财务预测
 * - 现金流预测
 * - 收入预测
 * - 风险预警（合同到期、余额预警等）
 */
@Module({
  controllers: [ForecastController],
  providers: [
    CashflowForecastService,
    RevenueForecastService,
    RiskAlertService,
  ],
  exports: [CashflowForecastService, RevenueForecastService, RiskAlertService],
})
export class ForecastModule {}

