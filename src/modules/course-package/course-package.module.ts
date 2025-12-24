import { Module } from '@nestjs/common';
import { CoursePackageController } from './course-package.controller';
import { CoursePackageService } from './course-package.service';

@Module({
  controllers: [CoursePackageController],
  providers: [CoursePackageService],
  exports: [CoursePackageService],
})
export class CoursePackageModule {}

