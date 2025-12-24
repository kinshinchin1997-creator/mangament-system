import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('审计日志')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取操作日志列表' })
  async getLogs(@Query() query: QueryAuditDto) {
    return this.auditService.getLogs(query);
  }

  @Get('logs/:id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取操作日志详情' })
  async getLogDetail(@Param('id') id: string) {
    return this.auditService.getLogDetail(id);
  }

  @Get('logs/user/:userId')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取指定用户的操作日志' })
  async getLogsByUser(
    @Param('userId') userId: string,
    @Query() query: QueryAuditDto,
  ) {
    return this.auditService.getLogsByUser(userId, query);
  }

  @Get('logs/business/:bizType/:bizId')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取指定业务对象的操作日志' })
  async getLogsByBusiness(
    @Param('bizType') bizType: string,
    @Param('bizId') bizId: string,
  ) {
    return this.auditService.getLogsByBusiness(bizType, bizId);
  }

  @Get('statistics')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取审计统计' })
  async getStatistics(@Query() query: QueryAuditDto) {
    return this.auditService.getStatistics(query);
  }

  @Get('modules')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取所有模块列表' })
  async getModules() {
    return this.auditService.getModules();
  }
}

