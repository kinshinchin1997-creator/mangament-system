import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// ============================================
// 基础设施层
// ============================================
import { PrismaModule } from './prisma/prisma.module';

// ============================================
// 系统管理模块
// ============================================
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { PermissionModule } from './modules/permission/permission.module';

// ============================================
// 业务基础模块
// ============================================
import { CampusModule } from './modules/campus/campus.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { StudentModule } from './modules/student/student.module';
import { CoursePackageModule } from './modules/course-package/course-package.module';

// ============================================
// 核心财务模块 ⭐
// ============================================
import { ContractModule } from './modules/contract/contract.module';
import { LessonModule } from './modules/lesson/lesson.module';
import { RefundModule } from './modules/refund/refund.module';
import { FinanceModule } from './modules/finance/finance.module';

// ============================================
// 报表与审计模块
// ============================================
import { ReportModule } from './modules/report/report.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // ======== 基础设施 ========
    PrismaModule,

    // ======== 系统管理 ========
    AuthModule,
    UserModule,
    RoleModule,
    PermissionModule,

    // ======== 业务基础 ========
    CampusModule,
    TeacherModule,
    StudentModule,
    CoursePackageModule,

    // ======== 核心财务 ⭐ ========
    ContractModule,   // 预收款入口
    LessonModule,     // 收入确认
    RefundModule,     // 资金流出
    FinanceModule,    // 资金追踪

    // ======== 报表与审计 ========
    ReportModule,
    AuditModule,
  ],
})
export class AppModule {}
