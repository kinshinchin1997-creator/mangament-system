import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { CashFlowService } from './cash-flow.service';

@Module({
  controllers: [FinanceController],
  providers: [CashFlowService],
  exports: [CashFlowService],
})
export class FinanceModule {}

