import { Module, forwardRef } from '@nestjs/common';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { CashflowModule } from '../cashflow/cashflow.module';

/**
 * 退费模块（资金流出）
 * 
 * 职责：
 * - 退费申请与审批
 * - 退费金额计算
 * - 退费打款确认
 * - 产生资金流出记录
 * 
 * 财务意义：
 * 退费是教培行业主要的资金流出渠道
 * 退费 = 预收款负债减少 + 现金流出
 */
@Module({
  imports: [forwardRef(() => CashflowModule)],
  controllers: [RefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
