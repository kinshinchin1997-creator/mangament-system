import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('用户管理')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '创建用户' })
  async create(@Body() createDto: any) {
    return this.userService.create(createDto);
  }

  @Get()
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '获取用户列表' })
  async findAll(@Query() query: any) {
    return this.userService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取用户详情' })
  async findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Put(':id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '更新用户' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.userService.update(id, updateDto);
  }

  @Post(':id/reset-password')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '重置密码' })
  async resetPassword(@Param('id') id: string) {
    return this.userService.resetPassword(id);
  }
}

