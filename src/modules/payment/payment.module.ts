import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { CashflowModule } from '../cashflow/cashflow.module';

/**
 * 支付/收款模块
 * 
 * 职责：处理所有收款相关业务
 * - 合同签约收款（预收款入口）
 * - 支付方式管理
 * - 收款记录查询
 * - 收款统计
 */
@Module({
  imports: [forwardRef(() => CashflowModule)],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}

