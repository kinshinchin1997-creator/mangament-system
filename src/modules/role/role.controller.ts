import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleDto, QueryRoleDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('角色管理')
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '创建角色' })
  async create(@Body() createDto: CreateRoleDto) {
    return this.roleService.create(createDto);
  }

  @Get()
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取角色列表' })
  async findAll(@Query() query: QueryRoleDto) {
    return this.roleService.findAll(query);
  }

  @Get(':id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '获取角色详情（含权限列表）' })
  async findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Put(':id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '更新角色' })
  async update(@Param('id') id: string, @Body() updateDto: UpdateRoleDto) {
    return this.roleService.update(id, updateDto);
  }

  @Delete(':id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '删除角色' })
  async remove(@Param('id') id: string) {
    return this.roleService.remove(id);
  }

  @Post(':id/permissions')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '分配权限给角色' })
  async assignPermissions(
    @Param('id') id: string,
    @Body('permissionIds') permissionIds: string[],
  ) {
    return this.roleService.assignPermissions(id, permissionIds);
  }
}

