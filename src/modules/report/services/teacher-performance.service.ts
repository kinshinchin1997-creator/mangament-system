import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportQueryDto } from '../dto';
import { DecimalUtil } from '../../../common/utils';

/**
 * 教师绩效报表服务
 */
@Injectable()
export class TeacherPerformanceService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取教师绩效统计
   */
  async getPerformance(query: ReportQueryDto) {
    const where = this.buildWhere(query);

    // 按教师分组统计
    const stats = await this.prisma.lessonRecord.groupBy({
      by: ['teacherId'],
      where,
      _count: true,
      _sum: {
        lessonCount: true,
        lessonAmount: true,
      },
    });

    // 获取教师信息
    const teacherIds = stats.map((s) => s.teacherId);
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      include: { campus: { select: { id: true, name: true } } },
    });
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));

    const result = stats.map((s) => {
      const teacher = teacherMap.get(s.teacherId);
      const lessonCount = s._sum.lessonCount?.toNumber() || 0;
      const lessonAmount = s._sum.lessonAmount?.toNumber() || 0;
      const hourlyRate = teacher?.hourlyRate?.toNumber() || 0;
      const teacherFee = lessonCount * hourlyRate;

      return {
        teacherId: s.teacherId,
        teacherName: teacher?.name || '未知',
        campusName: teacher?.campus?.name || '未知',
        hourlyRate: DecimalUtil.format(hourlyRate.toString()),
        recordCount: s._count,
        lessonCount,
        lessonAmount: DecimalUtil.format(lessonAmount.toString()),
        teacherFee: DecimalUtil.format(teacherFee.toString()),
        // 贡献毛利 = 消课金额 - 教师课时费
        grossProfit: DecimalUtil.format((lessonAmount - teacherFee).toString()),
      };
    });

    return result;
  }

  /**
   * 获取教师排名
   */
  async getRanking(query: ReportQueryDto) {
    const performance = await this.getPerformance(query);

    // 按消课金额降序排列
    const sorted = [...performance].sort(
      (a, b) => parseFloat(b.lessonAmount) - parseFloat(a.lessonAmount),
    );

    return sorted.map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
  }

  /**
   * 获取单个教师绩效详情
   */
  async getTeacherDetail(teacherId: string, query: ReportQueryDto) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { campus: true },
    });

    if (!teacher) {
      return null;
    }

    const where: any = { teacherId, status: 1 };
    if (query.startDate && query.endDate) {
      where.lessonDate = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    // 汇总统计
    const summary = await this.prisma.lessonRecord.aggregate({
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
    });

    // 按日期明细
    const byDate = await this.prisma.lessonRecord.groupBy({
      by: ['lessonDate'],
      where,
      _count: true,
      _sum: { lessonCount: true, lessonAmount: true },
      orderBy: { lessonDate: 'desc' },
    });

    const lessonCount = summary._sum.lessonCount?.toNumber() || 0;
    const hourlyRate = teacher.hourlyRate.toNumber();
    const teacherFee = lessonCount * hourlyRate;

    return {
      teacher: {
        id: teacher.id,
        name: teacher.name,
        campusName: teacher.campus.name,
        hourlyRate: DecimalUtil.format(hourlyRate.toString()),
      },
      summary: {
        recordCount: summary._count,
        lessonCount,
        lessonAmount: DecimalUtil.format((summary._sum.lessonAmount?.toNumber() || 0).toString()),
        teacherFee: DecimalUtil.format(teacherFee.toString()),
      },
      byDate: byDate.map((d) => ({
        date: d.lessonDate,
        recordCount: d._count,
        lessonCount: d._sum.lessonCount?.toNumber() || 0,
        lessonAmount: DecimalUtil.format((d._sum.lessonAmount?.toNumber() || 0).toString()),
      })),
    };
  }

  private buildWhere(query: ReportQueryDto) {
    const where: any = { status: 1 };

    if (query.campusId) {
      where.contract = { campusId: query.campusId };
    }

    if (query.startDate && query.endDate) {
      where.lessonDate = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    return where;
  }
}

