import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { BossMetricsService } from './services/boss-metrics.service';
import { CampusMetricsService } from './services/campus-metrics.service';
import { FinanceMetricsService } from './services/finance-metrics.service';

/**
 * 仪表盘模块
 * 
 * 职责：提供各角色的数据概览
 * - 老板看板：全局财务概览、多校区对比
 * - 财务看板：收支明细、日结状态
 * - 校区看板：校区业绩、学员情况
 */
@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    BossMetricsService,
    CampusMetricsService,
    FinanceMetricsService,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}

