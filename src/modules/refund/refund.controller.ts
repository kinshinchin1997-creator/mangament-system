import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RefundService } from './refund.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequireRoles, RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('退费管理')
@Controller('refunds')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Post()
  @RequirePermissions('refund:create')
  @ApiOperation({ summary: '创建退费申请' })
  async create(@Body() createDto: any, @CurrentUser() user: any) {
    return this.refundService.create(createDto, user);
  }

  @Get()
  @ApiOperation({ summary: '获取退费申请列表' })
  async findAll(@Query() query: any) {
    return this.refundService.findAll(query);
  }

  @Get('pending')
  @RequireRoles('BOSS', 'FINANCE')
  @ApiOperation({ summary: '获取待审批的退费申请' })
  async findPending() {
    return this.refundService.findPending();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取退费申请详情' })
  async findOne(@Param('id') id: string) {
    return this.refundService.findOne(id);
  }

  @Get(':contractId/preview')
  @ApiOperation({ summary: '预览退费计算' })
  async preview(@Param('contractId') contractId: string) {
    return this.refundService.preview(contractId);
  }

  @Put(':id/approve')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('refund:approve')
  @ApiOperation({ summary: '审批退费申请' })
  async approve(@Param('id') id: string, @Body() approveDto: any, @CurrentUser() user: any) {
    return this.refundService.approve(id, approveDto, user);
  }

  @Put(':id/complete')
  @RequireRoles('BOSS', 'FINANCE')
  @RequirePermissions('refund:complete')
  @ApiOperation({ summary: '完成退费（确认打款）' })
  async complete(@Param('id') id: string, @Body() completeDto: any, @CurrentUser() user: any) {
    return this.refundService.complete(id, completeDto, user);
  }
}

