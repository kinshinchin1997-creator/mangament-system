import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, QueryPaymentDto } from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('收款管理')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('contract')
  @RequirePermissions('contract:create')
  @ApiOperation({ summary: '合同收款（签约/续费）' })
  async createContractPayment(
    @Body() createDto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentService.createContractPayment(createDto, user);
  }

  @Get()
  @ApiOperation({ summary: '获取收款记录列表' })
  async findAll(@Query() query: QueryPaymentDto, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.paymentService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: '收款统计' })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.paymentService.getStatistics(campusId, startDate, endDate);
  }

  @Get('today')
  @ApiOperation({ summary: '今日收款汇总' })
  async getTodayPayments(@Query('campusId') campusId?: string) {
    return this.paymentService.getTodayPayments(campusId);
  }

  @Get('methods')
  @ApiOperation({ summary: '获取支付方式列表' })
  async getPaymentMethods() {
    return this.paymentService.getPaymentMethods();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取收款详情' })
  async findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }
}

