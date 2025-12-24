import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CampusService } from './campus.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles, CurrentUser } from '../../common/decorators';

@ApiTags('校区管理')
@Controller('campus')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CampusController {
  constructor(private readonly campusService: CampusService) {}

  @Post()
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '创建校区' })
  async create(@Body() createDto: any, @CurrentUser() user: any) {
    return this.campusService.create(createDto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取校区列表' })
  async findAll(@Query() query: any) {
    return this.campusService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取校区详情' })
  async findOne(@Param('id') id: string) {
    return this.campusService.findOne(id);
  }

  @Put(':id')
  @RequireRoles('BOSS')
  @ApiOperation({ summary: '更新校区' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.campusService.update(id, updateDto);
  }
}

