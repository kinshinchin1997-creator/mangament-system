import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('权限管理')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取所有权限列表' })
  async findAll() {
    return this.permissionService.findAll();
  }

  @Get('tree')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取权限树（按模块分组）' })
  async getTree() {
    return this.permissionService.getTree();
  }

  @Get('modules')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取所有模块列表' })
  async getModules() {
    return this.permissionService.getModules();
  }
}

