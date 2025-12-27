import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DecimalUtil } from '../../../common/utils';

/**
 * 现金流预测服务
 * 
 * 预测逻辑：
 * 1. 基于历史趋势进行移动平均预测
 * 2. 考虑季节性因素
 * 3. 结合已知事件（如预约续费）
 */
@Injectable()
export class CashflowForecastService {
  constructor(private prisma: PrismaService) {}

  /**
   * 短期现金流预测（按日）
   * 
   * 算法：基于近30天数据的移动平均
   */
  async forecast(futureDays: number, campusId?: string) {
    // 获取历史数据（近60天）
    const historyDays = 60;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - historyDays);

    const paymentWhere: any = { status: 1, paidAt: { gte: startDate } };
    const refundWhere: any = { status: 3, refundedAt: { gte: startDate } };
    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    // 获取收款记录
    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      select: { amount: true, paidAt: true },
      orderBy: { paidAt: 'asc' },
    });

    // 获取退费记录
    const refunds = await this.prisma.refund.findMany({
      where: refundWhere,
      select: { actualAmount: true, refundedAt: true },
      orderBy: { refundedAt: 'asc' },
    });

    // 按日汇总
    const dailyStats = new Map<string, { inflow: number; outflow: number }>();
    
    payments.forEach((p) => {
      const dateKey = p.paidAt.toISOString().slice(0, 10);
      if (!dailyStats.has(dateKey)) {
        dailyStats.set(dateKey, { inflow: 0, outflow: 0 });
      }
      const stat = dailyStats.get(dateKey)!;
      stat.inflow += Number(p.amount);
    });

    refunds.forEach((r) => {
      if (r.refundedAt) {
        const dateKey = r.refundedAt.toISOString().slice(0, 10);
        if (!dailyStats.has(dateKey)) {
          dailyStats.set(dateKey, { inflow: 0, outflow: 0 });
        }
        const stat = dailyStats.get(dateKey)!;
        stat.outflow += Number(r.actualAmount);
      }
    });

    // 计算平均值
    const dailyData = Array.from(dailyStats.values());
    const avgInflow = dailyData.length > 0
      ? dailyData.reduce((sum, d) => sum + d.inflow, 0) / dailyData.length
      : 0;
    const avgOutflow = dailyData.length > 0
      ? dailyData.reduce((sum, d) => sum + d.outflow, 0) / dailyData.length
      : 0;

    // 生成预测数据
    const forecast: Array<{
      date: string;
      predictedInflow: number;
      predictedOutflow: number;
      predictedNet: number;
    }> = [];

    for (let i = 1; i <= futureDays; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);

      // 简单移动平均预测，可加入更复杂的模型
      const dayOfWeek = date.getDay();
      const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.3 : 1.0;

      const predictedInflow = DecimalUtil.toNumber(
        DecimalUtil.multiply(avgInflow.toFixed(2), weekendFactor.toFixed(2))
      );
      const predictedOutflow = DecimalUtil.toNumber(
        DecimalUtil.multiply(avgOutflow.toFixed(2), weekendFactor.toFixed(2))
      );
      const predictedNet = DecimalUtil.toNumber(
        DecimalUtil.subtract(predictedInflow.toFixed(2), predictedOutflow.toFixed(2))
      );

      forecast.push({
        date: dateStr,
        predictedInflow,
        predictedOutflow,
        predictedNet,
      });
    }

    // 汇总
    const summary = {
      totalPredictedInflow: forecast.reduce((sum, f) => sum + f.predictedInflow, 0),
      totalPredictedOutflow: forecast.reduce((sum, f) => sum + f.predictedOutflow, 0),
      totalPredictedNet: forecast.reduce((sum, f) => sum + f.predictedNet, 0),
      avgDailyInflow: avgInflow,
      avgDailyOutflow: avgOutflow,
    };

    return {
      forecast,
      summary,
      basedOnDays: historyDays,
    };
  }

  /**
   * 月度现金流预测
   */
  async forecastMonthly(months: number, campusId?: string) {
    // 获取历史月度数据（近12个月）
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 12);

    const paymentWhere: any = { status: 1, paidAt: { gte: startDate } };
    const refundWhere: any = { status: 3, refundedAt: { gte: startDate } };
    if (campusId) {
      paymentWhere.campusId = campusId;
      refundWhere.campusId = campusId;
    }

    // 获取收款记录
    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      select: { amount: true, paidAt: true },
    });

    // 获取退费记录
    const refunds = await this.prisma.refund.findMany({
      where: refundWhere,
      select: { actualAmount: true, refundedAt: true },
    });

    // 按月汇总
    const monthlyStats = new Map<string, { inflow: number; outflow: number }>();
    
    payments.forEach((p) => {
      const monthKey = p.paidAt.toISOString().slice(0, 7);
      if (!monthlyStats.has(monthKey)) {
        monthlyStats.set(monthKey, { inflow: 0, outflow: 0 });
      }
      const stat = monthlyStats.get(monthKey)!;
      stat.inflow += Number(p.amount);
    });

    refunds.forEach((r) => {
      if (r.refundedAt) {
        const monthKey = r.refundedAt.toISOString().slice(0, 7);
        if (!monthlyStats.has(monthKey)) {
          monthlyStats.set(monthKey, { inflow: 0, outflow: 0 });
        }
        const stat = monthlyStats.get(monthKey)!;
        stat.outflow += Number(r.actualAmount);
      }
    });

    // 计算月均值
    const monthlyData = Array.from(monthlyStats.values());
    const avgMonthlyInflow = monthlyData.length > 0
      ? monthlyData.reduce((sum, d) => sum + d.inflow, 0) / monthlyData.length
      : 0;
    const avgMonthlyOutflow = monthlyData.length > 0
      ? monthlyData.reduce((sum, d) => sum + d.outflow, 0) / monthlyData.length
      : 0;

    // 生成月度预测
    const forecast: Array<{
      month: string;
      predictedInflow: number;
      predictedOutflow: number;
      predictedNet: number;
    }> = [];

    for (let i = 1; i <= months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);
      const monthStr = date.toISOString().slice(0, 7);

      // 考虑季节因素（简化版：假设寒暑假收款较高）
      const month = date.getMonth();
      let seasonFactor = 1.0;
      if (month === 0 || month === 1 || month === 6 || month === 7) { // 1-2月, 7-8月
        seasonFactor = 1.3; // 寒暑假报名高峰
      } else if (month === 4 || month === 9) { // 5月, 10月
        seasonFactor = 0.8; // 假期淡季
      }

      const predictedInflow = Math.round(avgMonthlyInflow * seasonFactor);
      const predictedOutflow = Math.round(avgMonthlyOutflow * 0.9); // 退费相对稳定
      const predictedNet = predictedInflow - predictedOutflow;

      forecast.push({
        month: monthStr,
        predictedInflow,
        predictedOutflow,
        predictedNet,
      });
    }

    return {
      forecast,
      avgMonthlyInflow,
      avgMonthlyOutflow,
    };
  }
}
