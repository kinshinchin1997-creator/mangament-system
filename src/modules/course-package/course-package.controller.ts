import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CoursePackageService } from './course-package.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RequireRoles } from '../../common/decorators';

@ApiTags('课包管理')
@Controller('course-packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CoursePackageController {
  constructor(private readonly coursePackageService: CoursePackageService) {}

  @Post()
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '创建课包' })
  async create(@Body() createDto: any) {
    return this.coursePackageService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: '获取课包列表' })
  async findAll(@Query() query: any) {
    return this.coursePackageService.findAll(query);
  }

  @Get('available')
  @ApiOperation({ summary: '获取可用课包（用于签约）' })
  async findAvailable(@Query('campusId') campusId: string) {
    return this.coursePackageService.findAvailable(campusId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取课包详情' })
  async findOne(@Param('id') id: string) {
    return this.coursePackageService.findOne(id);
  }

  @Put(':id')
  @RequireRoles('BOSS', 'CAMPUS_MANAGER')
  @ApiOperation({ summary: '更新课包' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.coursePackageService.update(id, updateDto);
  }
}

