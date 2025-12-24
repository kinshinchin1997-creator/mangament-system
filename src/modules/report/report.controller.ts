import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrepaidBalanceService } from './services/prepaid-balance.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import { CampusComparisonService } from './services/campus-comparison.service';
import { TeacherPerformanceService } from './services/teacher-performance.service';
import { ReportQueryDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('报表中心')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ReportController {
  constructor(
    private readonly prepaidBalanceService: PrepaidBalanceService,
    private readonly revenueRecognitionService: RevenueRecognitionService,
    private readonly campusComparisonService: CampusComparisonService,
    private readonly teacherPerformanceService: TeacherPerformanceService,
  ) {}

  // ==================== 预收款余额报表 ====================

  @Get('prepaid-balance')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '预收款余额报表 - 汇总' })
  async getPrepaidBalanceSummary(@Query('campusId') campusId?: string) {
    return this.prepaidBalanceService.getSummary(campusId);
  }

  @Get('prepaid-balance/by-campus')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '预收款余额报表 - 按校区' })
  async getPrepaidBalanceByCampus() {
    return this.prepaidBalanceService.getByCampus();
  }

  @Get('prepaid-balance/by-package')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '预收款余额报表 - 按课包' })
  async getPrepaidBalanceByPackage(@Query('campusId') campusId?: string) {
    return this.prepaidBalanceService.getByPackage(campusId);
  }

  // ==================== 收入确认报表 ====================

  @Get('revenue-recognition')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '收入确认报表 - 汇总（消课=确认收入）' })
  async getRevenueRecognitionSummary(@Query() query: ReportQueryDto) {
    return this.revenueRecognitionService.getSummary(query);
  }

  @Get('revenue-recognition/by-date')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '收入确认报表 - 按日期趋势' })
  async getRevenueRecognitionByDate(@Query() query: ReportQueryDto) {
    return this.revenueRecognitionService.getByDate(query);
  }

  @Get('revenue-recognition/by-package')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '收入确认报表 - 按课包分类' })
  async getRevenueRecognitionByPackage(@Query() query: ReportQueryDto) {
    return this.revenueRecognitionService.getByPackage(query);
  }

  // ==================== 校区对比报表 ====================

  @Get('campus-comparison')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '校区对比报表 - 综合对比' })
  async getCampusComparison(@Query() query: ReportQueryDto) {
    return this.campusComparisonService.getComparison(query);
  }

  @Get('campus-comparison/ranking')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '校区对比报表 - 排名' })
  async getCampusRanking(
    @Query() query: ReportQueryDto,
    @Query('metric') metric: string = 'revenue',
  ) {
    return this.campusComparisonService.getRanking(query, metric);
  }

  // ==================== 教师绩效报表 ====================

  @Get('teacher-performance')
  @RequireRoles('BOSS', 'FINANCE', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '教师绩效报表 - 课时统计' })
  async getTeacherPerformance(@Query() query: ReportQueryDto) {
    return this.teacherPerformanceService.getPerformance(query);
  }

  @Get('teacher-performance/ranking')
  @RequireRoles('BOSS', 'FINANCE', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '教师绩效报表 - 排名' })
  async getTeacherRanking(@Query() query: ReportQueryDto) {
    return this.teacherPerformanceService.getRanking(query);
  }

  // ==================== 综合仪表盘 ====================

  @Get('dashboard')
  @RequireRoles('BOSS', 'FINANCE', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '综合仪表盘数据' })
  async getDashboard(@Query('campusId') campusId?: string) {
    const [prepaidBalance, todayRevenue, monthRevenue] = await Promise.all([
      this.prepaidBalanceService.getSummary(campusId),
      this.revenueRecognitionService.getToday(campusId),
      this.revenueRecognitionService.getThisMonth(campusId),
    ]);

    return {
      prepaidBalance,
      todayRevenue,
      monthRevenue,
    };
  }
}

