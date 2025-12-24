import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContractService } from './contract.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequireRoles, RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('合同管理（预收款）')
@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @Post()
  @RequirePermissions('contract:create')
  @ApiOperation({ summary: '创建合同（新签/续费）' })
  async create(@Body() createDto: any, @CurrentUser() user: any) {
    return this.contractService.create(createDto, user);
  }

  @Get()
  @ApiOperation({ summary: '获取合同列表' })
  async findAll(@Query() query: any, @CurrentUser() user: any) {
    if (user.roles.includes('CAMPUS_MANAGER') && !user.roles.includes('BOSS')) {
      query.campusId = user.campusId;
    }
    return this.contractService.findAll(query);
  }

  @Get('statistics')
  @RequireRoles('BOSS', 'FINANCE', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '获取合同统计' })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.contractService.getStatistics(campusId, startDate, endDate);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取合同详情' })
  async findOne(@Param('id') id: string) {
    return this.contractService.findOne(id);
  }

  @Put(':id/complete')
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '完结合同' })
  async complete(@Param('id') id: string) {
    return this.contractService.complete(id);
  }
}

