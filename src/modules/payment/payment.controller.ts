import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { 
  CreatePaymentDto, 
  QueryPaymentDto,
  PaymentTypeEnum,
} from './dto';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

/**
 * ============================================
 * 收款管理控制器
 * ============================================
 * 
 * 提供收款相关的所有 API 接口：
 * - 新招收款（新学员首次购买）
 * - 续费收款（老学员续购）
 * - 收款记录查询
 * - 预收款统计
 */
@ApiTags('收款管理')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  // ============================================
  // 一、收款操作
  // ============================================

  /**
   * 创建收款（统一接口，支持新招/续费）
   * 
   * @description 
   * 根据 paymentType 字段自动分发到对应的处理逻辑：
   * - SIGN: 新招收款，创建新合同并收款
   * - RENEWAL: 续费收款，基于原合同创建新续费合同并收款
   */
  @Post()
  @RequirePermissions('payment:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: '创建收款（新招/续费）',
    description: `
### 收款类型说明

| 类型 | 说明 | 必填字段 |
|------|------|----------|
| SIGN | 新招 - 新学员首次购买课包 | studentId, campusId, packageId |
| RENEWAL | 续费 - 老学员续购课包 | originalContractId, packageId |

### 业务规则
1. 每笔收款必须绑定课包
2. 收款后自动创建合同
3. 自动计算预收款和未消课金额
    `
  })
  @ApiResponse({ status: 201, description: '收款成功' })
  @ApiResponse({ status: 400, description: '参数错误' })
  @ApiResponse({ status: 404, description: '学员/课包/合同不存在' })
  async createPayment(
    @Body() createDto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentService.createPayment(createDto, user);
  }

  /**
   * 新招收款（便捷接口）
   */
  @Post('sign')
  @RequirePermissions('payment:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: '新招收款',
    description: '新学员首次购买课包，创建合同并收款'
  })
  async createSignPayment(
    @Body() createDto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    // 强制设置为新招类型
    createDto.paymentType = PaymentTypeEnum.SIGN;
    return this.paymentService.createPayment(createDto, user);
  }

  /**
   * 续费收款（便捷接口）
   */
  @Post('renewal')
  @RequirePermissions('payment:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: '续费收款',
    description: '老学员续购课包，基于原合同创建新合同并收款'
  })
  async createRenewalPayment(
    @Body() createDto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    // 强制设置为续费类型
    createDto.paymentType = PaymentTypeEnum.RENEWAL;
    return this.paymentService.createPayment(createDto, user);
  }

  // ============================================
  // 二、收款查询
  // ============================================

  /**
   * 获取收款记录列表
   */
  @Get()
  @ApiOperation({ summary: '获取收款记录列表' })
  @ApiQuery({ name: 'paymentType', enum: PaymentTypeEnum, required: false, description: '收款类型' })
  async findAll(
    @Query() query: QueryPaymentDto, 
    @CurrentUser() user: any
  ) {
    // 校区负责人只能查看本校区数据
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.paymentService.findAll(query);
  }

  /**
   * 获取收款详情
   */
  @Get(':id')
  @ApiOperation({ summary: '获取收款详情' })
  @ApiParam({ name: 'id', description: '收款记录ID' })
  @ApiResponse({ status: 200, description: '返回收款详情，包含合同和预收款信息' })
  async findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  // ============================================
  // 三、预收款统计
  // ============================================

  /**
   * 获取预收款汇总
   * 
   * @description
   * 返回预收款相关核心指标：
   * - 总预收金额：累计收款总额
   * - 未消课金额：预收款余额（还欠学员的课时价值）
   * - 已确认收入：已消课金额
   */
  @Get('stats/prepaid')
  @RequirePermissions('finance:view')
  @ApiOperation({ 
    summary: '预收款汇总',
    description: '获取预收款相关核心财务指标'
  })
  @ApiQuery({ name: 'campusId', required: false, description: '校区ID（不传则查询全部）' })
  async getPrepaidSummary(@Query('campusId') campusId?: string) {
    return this.paymentService.getPrepaidSummary(campusId);
  }

  /**
   * 收款统计（按类型/支付方式）
   */
  @Get('stats/summary')
  @ApiOperation({ 
    summary: '收款统计',
    description: '按收款类型和支付方式统计收款数据'
  })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.paymentService.getStatistics(campusId, startDate, endDate);
  }

  /**
   * 今日收款汇总
   */
  @Get('stats/today')
  @ApiOperation({ summary: '今日收款汇总' })
  async getTodayPayments(
    @Query('campusId') campusId?: string,
    @CurrentUser() user: any = {}
  ) {
    // 校区负责人只能查看本校区
    if (user.roles?.includes('CAMPUS_MANAGER') && !user.roles?.includes('BOSS')) {
      campusId = user.campusId;
    }
    return this.paymentService.getTodayPayments(campusId);
  }

  // ============================================
  // 四、基础数据
  // ============================================

  /**
   * 获取支付方式列表
   */
  @Get('options/pay-methods')
  @ApiOperation({ summary: '获取支付方式列表' })
  async getPaymentMethods() {
    return this.paymentService.getPaymentMethods();
  }

  /**
   * 获取收款类型列表
   */
  @Get('options/payment-types')
  @ApiOperation({ summary: '获取收款类型列表' })
  async getPaymentTypes() {
    return this.paymentService.getPaymentTypes();
  }
}
