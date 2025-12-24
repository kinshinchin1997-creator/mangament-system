import { Module, forwardRef } from '@nestjs/common';
import { LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';
import { ContractModule } from '../contract/contract.module';
import { CashflowModule } from '../cashflow/cashflow.module';

/**
 * 消课模块（收入确认）
 * 
 * 职责：
 * - 记录学员上课消耗
 * - 计算消课金额（预收款 → 确认收入）
 * - 教师课时统计
 * - 消课撤销
 * 
 * 财务意义：
 * 消课是教培行业收入确认的核心动作
 * 每次消课 = 预收款负债减少 + 确认收入增加
 */
@Module({
  imports: [
    forwardRef(() => ContractModule),
    forwardRef(() => CashflowModule),
  ],
  controllers: [LessonController],
  providers: [LessonService],
  exports: [LessonService],
})
export class LessonModule {}
