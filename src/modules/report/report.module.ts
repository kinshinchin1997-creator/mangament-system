import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { PrepaidBalanceService } from './services/prepaid-balance.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import { CampusComparisonService } from './services/campus-comparison.service';
import { TeacherPerformanceService } from './services/teacher-performance.service';

@Module({
  controllers: [ReportController],
  providers: [
    PrepaidBalanceService,
    RevenueRecognitionService,
    CampusComparisonService,
    TeacherPerformanceService,
  ],
  exports: [
    PrepaidBalanceService,
    RevenueRecognitionService,
    CampusComparisonService,
    TeacherPerformanceService,
  ],
})
export class ReportModule {}

