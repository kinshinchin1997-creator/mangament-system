import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// 基础模块
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';

// 业务模块
import { CampusModule } from './modules/campus/campus.module';
import { UserModule } from './modules/user/user.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { StudentModule } from './modules/student/student.module';
import { CoursePackageModule } from './modules/course-package/course-package.module';
import { ContractModule } from './modules/contract/contract.module';
import { LessonModule } from './modules/lesson/lesson.module';
import { RefundModule } from './modules/refund/refund.module';
import { FinanceModule } from './modules/finance/finance.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // 基础设施
    PrismaModule,
    AuthModule,

    // 业务模块
    CampusModule,
    UserModule,
    TeacherModule,
    StudentModule,
    CoursePackageModule,
    ContractModule,
    LessonModule,
    RefundModule,
    FinanceModule,
  ],
})
export class AppModule {}

