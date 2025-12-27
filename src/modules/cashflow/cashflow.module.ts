import { Module, forwardRef } from '@nestjs/common';
import { CashflowController } from './cashflow.controller';
import { CashflowService } from './cashflow.service';
import { DailySettlementService } from './services/daily-settlement.service';
import { RevenueRecognitionService } from './services/revenue-recognition.service';
import { PaymentModule } from '../payment/payment.module';

/**
 * ============================================
 * 现金流核心模块
 * ============================================
 * 
 * 职责：核心财务引擎
 * - 经营现金流计算
 * - 预收-消课-退费滚动表
 * - 周度/月度现金流汇总
 * - 资金流入/流出记录
 * - 预收款管理
 * - 确认收入管理
 * - 日结核算
 * 
 * ============================================
 * 数据来源架构
 * ============================================
 * 
 *                    ┌─────────────────────────────────────┐
 *                    │         CashflowService             │
 *                    │     (现金流核心计算引擎)              │
 *                    └─────────────────────────────────────┘
 *                                     │
 *          ┌──────────────────────────┼──────────────────────────┐
 *          │                          │                          │
 *          ▼                          ▼                          ▼
 *   ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
 *   │  Payment    │           │   Lesson    │           │   Refund    │
 *   │  收款表     │           │   消课表     │           │   退费表    │
 *   └─────────────┘           └─────────────┘           └─────────────┘
 *          │                          │                          │
 *          ▼                          ▼                          ▼
 *   ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
 *   │ 现金流入    │           │ 收入确认    │           │ 现金流出    │
 *   │ (预收增加)  │           │ (预收转收入) │           │ (预收减少)  │
 *   └─────────────┘           └─────────────┘           └─────────────┘
 * 
 * ============================================
 * 核心公式
 * ============================================
 * 
 * 1. 净经营现金流 = 现金流入(Payment) - 现金流出(Refund)
 * 
 * 2. 预收款余额变动 = 收款 - 消课 - 退费
 *    期末余额 = 期初余额 + 收款 - 消课 - 退费
 * 
 * 3. 确认收入 = 消课金额 = 消课课时 × 课时单价
 * 
 * ============================================
 * API 接口分类
 * ============================================
 * 
 * 1. 经营现金流
 *    GET /cashflow/operating
 * 
 * 2. 滚动表
 *    GET /cashflow/rolling-table
 * 
 * 3. 周度/月度汇总
 *    GET /cashflow/weekly-summary
 *    GET /cashflow/monthly-summary
 * 
 * 4. 基础查询
 *    GET /cashflow
 *    GET /cashflow/summary
 *    GET /cashflow/trend
 * 
 * 5. 预收款 & 确认收入
 *    GET /cashflow/prepaid-balance
 *    GET /cashflow/recognized-revenue
 * 
 * 6. 日结
 *    POST /cashflow/daily-settle
 *    GET /cashflow/daily-reports
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
