import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RiskAlert {
  type: 'CONTRACT_EXPIRING' | 'LOW_BALANCE' | 'INACTIVE_STUDENT' | 'HIGH_REFUND';
  level: 'warning' | 'danger';
  title: string;
  description: string;
  count: number;
  relatedIds?: string[];
}

/**
 * 风险预警服务
 * 
 * 职责：
 * 1. 合同到期预警
 * 2. 课时余额不足预警
 * 3. 休眠学员预警
 * 4. 退费异常预警
 */
@Injectable()
export class RiskAlertService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取所有预警
   */
  async getAlerts(campusId?: string): Promise<RiskAlert[]> {
    const alerts: RiskAlert[] = [];

    // 1. 合同到期预警（30天内）
    const expiringAlerts = await this.getExpiringContractAlerts(30, campusId);
    if (expiringAlerts.count > 0) {
      alerts.push(expiringAlerts);
    }

    // 2. 课时余额不足预警
    const lowBalanceAlerts = await this.getLowBalanceAlerts(5, campusId);
    if (lowBalanceAlerts.count > 0) {
      alerts.push(lowBalanceAlerts);
    }

    // 3. 休眠学员预警（30天未上课）
    const inactiveAlerts = await this.getInactiveStudentAlerts(30, campusId);
    if (inactiveAlerts.count > 0) {
      alerts.push(inactiveAlerts);
    }

    // 4. 高退费率预警
    const refundAlerts = await this.getHighRefundAlert(campusId);
    if (refundAlerts.count > 0) {
      alerts.push(refundAlerts);
    }

    return alerts;
  }

  /**
   * 合同到期预警
   */
  async getExpiringContractAlerts(days: number, campusId?: string): Promise<RiskAlert> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const where: any = {
      status: 1,
      endDate: { gte: now, lte: futureDate },
      remainLessons: { gt: 0 },
    };
    if (campusId) where.campusId = campusId;

    const count = await this.prisma.contract.count({ where });

    return {
      type: 'CONTRACT_EXPIRING',
      level: count > 10 ? 'danger' : 'warning',
      title: '合同即将到期',
      description: `${count}份合同将在${days}天内到期，且仍有剩余课时`,
      count,
    };
  }

  /**
   * 课时余额不足预警
   */
  async getLowBalanceAlerts(threshold: number, campusId?: string): Promise<RiskAlert> {
    const where: any = {
      status: 1,
      remainLessons: { gt: 0, lte: threshold },
    };
    if (campusId) where.campusId = campusId;

    const count = await this.prisma.contract.count({ where });

    return {
      type: 'LOW_BALANCE',
      level: count > 20 ? 'danger' : 'warning',
      title: '课时余额不足',
      description: `${count}份合同剩余课时不足${threshold}节，需提醒续费`,
      count,
    };
  }

  /**
   * 休眠学员预警
   */
  async getInactiveStudentAlerts(days: number, campusId?: string): Promise<RiskAlert> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - days);

    // 查找有有效合同但长期未上课的学员
    const activeContracts = await this.prisma.contract.findMany({
      where: {
        status: 1,
        remainLessons: { gt: 0 },
        ...(campusId ? { campusId } : {}),
      },
      select: { studentId: true },
    });

    const studentIds = [...new Set(activeContracts.map((c) => c.studentId))];

    // 检查这些学员最近是否有上课记录
    let inactiveCount = 0;

    for (const studentId of studentIds) {
      const recentLesson = await this.prisma.lessonRecord.findFirst({
        where: {
          studentId,
          attendDate: { gte: thresholdDate },
        },
      });

      if (!recentLesson) {
        inactiveCount++;
      }
    }

    return {
      type: 'INACTIVE_STUDENT',
      level: inactiveCount > 15 ? 'danger' : 'warning',
      title: '休眠学员',
      description: `${inactiveCount}名学员超过${days}天未上课`,
      count: inactiveCount,
    };
  }

  /**
   * 高退费率预警
   */
  async getHighRefundAlert(campusId?: string): Promise<RiskAlert> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const where: any = { createdAt: { gte: thirtyDaysAgo } };
    if (campusId) where.campusId = campusId;

    // 统计收入
    const incomeStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: 1 },
      _sum: { amount: true },
    });

    // 统计退费
    const refundStats = await this.prisma.cashFlow.aggregate({
      where: { ...where, direction: -1 },
      _sum: { amount: true },
    });

    const totalIncome = Number(incomeStats._sum.amount || 0);
    const totalRefund = Number(refundStats._sum.amount || 0);

    const refundRate = totalIncome > 0 ? (totalRefund / totalIncome) * 100 : 0;

    return {
      type: 'HIGH_REFUND',
      level: refundRate > 15 ? 'danger' : 'warning',
      title: '退费率偏高',
      description: `近30天退费率${refundRate.toFixed(1)}%（退费${totalRefund}元/收入${totalIncome}元）`,
      count: refundRate > 10 ? 1 : 0,
    };
  }
}

