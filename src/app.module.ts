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
import { ContractModule } from './modules/contract/contract.module';

// ============================================
// 核心财务模块 ⭐ (教培现金流核心)
// ============================================
import { PaymentModule } from './modules/payment/payment.module';       // 收款管理
import { LessonModule } from './modules/lesson/lesson.module';          // 消课管理
import { RefundModule } from './modules/refund/refund.module';          // 退费管理
import { CashflowModule } from './modules/cashflow/cashflow.module';    // 现金流核心引擎
import { ForecastModule } from './modules/forecast/forecast.module';    // 财务预测
import { AlertModule } from './modules/alert/alert.module';            // 现金流预警
import { DashboardModule } from './modules/dashboard/dashboard.module'; // 仪表盘

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
    ContractModule,

    // ======== 核心财务模块 ⭐ ========
    // 现金流模型: 预收款(Payment) -> 消课确收(Lesson) -> 退费(Refund)
    PaymentModule,    // 收款入口（合同收款）→ 产生预收款
    LessonModule,     // 消课记录 → 预收款转确认收入
    RefundModule,     // 退费管理 → 资金流出
    CashflowModule,   // 现金流核心 → 资金追踪、日结、收入确认
    ForecastModule,   // 财务预测 → 现金流/收入预测、风险预警
    AlertModule,      // 现金流预警 → 规则配置、实时监控
    DashboardModule,  // 仪表盘 → 多角色数据看板

    // ======== 报表与审计 ========
    ReportModule,
    AuditModule,
  ],
})
export class AppModule {}
