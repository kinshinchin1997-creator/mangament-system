import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TeacherService } from './teacher.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('教师管理')
@Controller('teachers')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Post()
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '创建教师' })
  async create(@Body() createDto: any) {
    return this.teacherService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: '获取教师列表' })
  async findAll(@Query() query: any) {
    return this.teacherService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取教师详情' })
  async findOne(@Param('id') id: string) {
    return this.teacherService.findOne(id);
  }

  @Put(':id')
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '更新教师' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.teacherService.update(id, updateDto);
  }
}

