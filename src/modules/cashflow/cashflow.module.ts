import { Module, forwardRef } from '@nestjs/common';
import { CashflowController } from './cashflow.controller';
import { CashflowService } from './cashflow.service';
import { DailySettlementService } from './services/daily-settlement.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import { PaymentModule } from '../payment/payment.module';

/**
 * 现金流核心模块
 * 
 * 职责：核心财务引擎
 * - 资金流入/流出记录
 * - 预收款管理
 * - 确认收入管理
 * - 日结核算
 * - 现金流分析
 */
@Module({
  imports: [forwardRef(() => PaymentModule)],
  controllers: [CashflowController],
  providers: [
    CashflowService,
    DailySettlementService,
    RevenueRecognitionService,
  ],
  exports: [CashflowService, DailySettlementService, RevenueRecognitionService],
})
export class CashflowModule {}

