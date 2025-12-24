import { Injectable } from '@nestjs/common';
import { BossMetricsService } from './services/boss-metrics.service';
import { CampusMetricsService } from './services/campus-metrics.service';
import { FinanceMetricsService } from './services/finance-metrics.service';

/**
 * 仪表盘服务
 * 
 * 根据用户角色返回不同的概览数据
 */
@Injectable()
export class DashboardService {
  constructor(
    private bossMetrics: BossMetricsService,
    private campusMetrics: CampusMetricsService,
    private financeMetrics: FinanceMetricsService,
  ) {}

  /**
   * 获取概览数据
   * 根据用户角色返回不同视图
   */
  async getOverview(user: any) {
    const roles = user.roles || [];

    // 老板视图
    if (roles.includes('BOSS')) {
      return {
        role: 'BOSS',
        data: await this.getBossOverview(),
      };
    }

    // 财务视图
    if (roles.includes('FINANCE')) {
      return {
        role: 'FINANCE',
        data: await this.getFinanceOverview(),
      };
    }

    // 校区负责人视图
    if (roles.includes('CAMPUS_MANAGER')) {
      return {
        role: 'CAMPUS_MANAGER',
        data: await this.getCampusOverview(user.campusId),
      };
    }

    // 默认视图
    return {
      role: 'UNKNOWN',
      data: {},
    };
  }

  /**
   * 老板概览
   */
  private async getBossOverview() {
    const [summary, kpi] = await Promise.all([
      this.bossMetrics.getSummary(),
      this.bossMetrics.getKPI(),
    ]);

    return {
      summary,
      kpi,
    };
  }

  /**
   * 财务概览
   */
  private async getFinanceOverview() {
    const [today, settlementStatus, prepaid] = await Promise.all([
      this.financeMetrics.getTodayMetrics(),
      this.financeMetrics.getSettlementStatus(),
      this.financeMetrics.getPrepaidMetrics(),
    ]);

    return {
      today,
      settlementStatus,
      prepaid,
    };
  }

  /**
   * 校区概览
   */
  private async getCampusOverview(campusId: string) {
    const [summary, students, contracts] = await Promise.all([
      this.campusMetrics.getSummary(campusId),
      this.campusMetrics.getStudentMetrics(campusId),
      this.campusMetrics.getContractMetrics(campusId),
    ]);

    return {
      summary,
      students,
      contracts,
    };
  }
}

