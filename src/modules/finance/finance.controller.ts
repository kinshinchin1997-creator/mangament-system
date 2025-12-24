import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CashFlowService } from './cash-flow.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles, CurrentUser } from '../../common/decorators';

@ApiTags('财务管理')
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FinanceController {
  constructor(private readonly cashFlowService: CashFlowService) {}

  @Get('cash-flows')
  @RequireRoles('BOSS', 'FINANCE', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '获取现金流水列表' })
  async getCashFlows(@Query() query: any, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.cashFlowService.findAll(query);
  }

  @Get('cash-flows/statistics')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '获取现金流汇总统计' })
  async getCashFlowSummary(
    @Query('campusId') campusId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cashFlowService.getSummary(campusId, startDate, endDate);
  }

  @Get('reports/prepaid-balance')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '获取预收款余额报表' })
  async getPrepaidBalanceReport(@Query('campusId') campusId?: string) {
    return this.cashFlowService.getPrepaidBalanceReport(campusId);
  }

  @Get('reports/revenue-recognition')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '获取收入确认报表（消课=确认收入）' })
  async getRevenueRecognitionReport(
    @Query('campusId') campusId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cashFlowService.getRevenueRecognitionReport(campusId, startDate, endDate);
  }
}

