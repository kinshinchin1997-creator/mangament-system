import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 校区看板指标服务
 */
@Injectable()
export class CampusMetricsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 校区汇总
   */
  async getSummary(campusId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // 今日收款
    const todayIncome = await this.prisma.payment.aggregate({
      where: { campusId, status: 1, paidAt: { gte: today } },
      _sum: { amount: true },
      _count: true,
    });

    // 本月收款
    const monthIncome = await this.prisma.payment.aggregate({
      where: { campusId, status: 1, paidAt: { gte: thisMonth } },
      _sum: { amount: true },
    });

    // 本月消课
    const monthLesson = await this.prisma.lesson.aggregate({
      where: { campusId, status: 1, lessonDate: { gte: thisMonth } },
      _sum: { lessonAmount: true, lessonCount: true },
    });

    // 活跃学员数
    const activeContracts = await this.prisma.contract.groupBy({
      by: ['studentId'],
      where: { campusId, status: 1, remainLessons: { gt: 0 } },
    });

    // 教师数
    const teacherCount = await this.prisma.teacher.count({
      where: { campusId, status: 1 },
    });

    return {
      todayIncome: Number(todayIncome._sum.amount || 0),
      todayContractCount: todayIncome._count,
      monthIncome: Number(monthIncome._sum.amount || 0),
      monthLessonAmount: Number(monthLesson._sum.lessonAmount || 0),
      monthLessonCount: monthLesson._sum.lessonCount || 0,
      activeStudentCount: activeContracts.length,
      teacherCount,
    };
  }

  /**
   * 学员指标
   */
  async getStudentMetrics(campusId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 学员总数
    const totalStudents = await this.prisma.student.count({
      where: { campusId },
    });

    // 活跃学员（有有效合同且剩余课时>0）
    const activeContracts = await this.prisma.contract.groupBy({
      by: ['studentId'],
      where: { campusId, status: 1, remainLessons: { gt: 0 } },
    });

    // 近30天新增学员
    const newStudents = await this.prisma.student.count({
      where: { campusId, createdAt: { gte: thirtyDaysAgo } },
    });

    // 课时即将耗尽学员（<= 5节）
    const lowBalance = await this.prisma.contract.groupBy({
      by: ['studentId'],
      where: {
        campusId,
        status: 1,
        remainLessons: { gt: 0, lte: 5 },
      },
    });

    return {
      totalStudents,
      activeStudents: activeContracts.length,
      newStudents,
      lowBalanceStudents: lowBalance.length,
    };
  }

  /**
   * 教师绩效
   */
  async getTeacherMetrics(campusId: string) {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const teachers = await this.prisma.teacher.findMany({
      where: { campusId, status: 1 },
      select: { id: true, name: true },
    });

    const metrics = await Promise.all(
      teachers.map(async (teacher) => {
        const lessons = await this.prisma.lesson.aggregate({
          where: {
            teacherId: teacher.id,
            lessonDate: { gte: thisMonth },
            status: 1,
          },
          _sum: { lessonAmount: true, lessonCount: true },
          _count: true,
        });

        return {
          teacherId: teacher.id,
          teacherName: teacher.name,
          lessonRecordCount: lessons._count,
          consumedLessons: lessons._sum.lessonCount || 0,
          consumedAmount: Number(lessons._sum.lessonAmount || 0),
        };
      })
    );

    // 按消课金额排序
    metrics.sort((a, b) => b.consumedAmount - a.consumedAmount);

    return metrics;
  }

  /**
   * 合同指标
   */
  async getContractMetrics(campusId: string) {
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

    // 有效合同数
    const activeContracts = await this.prisma.contract.count({
      where: { campusId, status: 1 },
    });

    // 本月新签
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const newContracts = await this.prisma.contract.count({
      where: { campusId, createdAt: { gte: thisMonth } },
    });

    // 即将到期（30天内）
    const expiringContracts = await this.prisma.contract.count({
      where: {
        campusId,
        status: 1,
        endDate: { gte: today, lte: thirtyDaysLater },
        remainLessons: { gt: 0 },
      },
    });

    // 总剩余课时
    const remainingLessons = await this.prisma.contract.aggregate({
      where: { campusId, status: 1 },
      _sum: { remainLessons: true },
    });

    // 总剩余金额（使用unearned字段）
    const unearnedSum = await this.prisma.contract.aggregate({
      where: { campusId, status: 1 },
      _sum: { unearned: true },
    });

    return {
      activeContracts,
      newContracts,
      expiringContracts,
      totalRemainingLessons: remainingLessons._sum.remainLessons || 0,
      totalRemainingValue: Number(unearnedSum._sum.unearned || 0),
    };
  }
}
