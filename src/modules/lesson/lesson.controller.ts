import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LessonService } from './lesson.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../../common/guards';
import { RequirePermissions, CurrentUser } from '../../common/decorators';

@ApiTags('消课管理')
@Controller('lessons')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@ApiBearerAuth()
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  @Post()
  @RequirePermissions('lesson:create')
  @ApiOperation({ summary: '创建消课记录' })
  async create(@Body() createDto: any, @CurrentUser() user: any) {
    return this.lessonService.create(createDto, user);
  }

  @Get()
  @ApiOperation({ summary: '获取消课记录列表' })
  async findAll(@Query() query: any) {
    return this.lessonService.findAll(query);
  }

  @Get('statistics')
  @ApiOperation({ summary: '获取消课统计' })
  async getStatistics(
    @Query('campusId') campusId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.lessonService.getStatistics(campusId, teacherId, startDate, endDate);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取消课记录详情' })
  async findOne(@Param('id') id: string) {
    return this.lessonService.findOne(id);
  }

  @Put(':id/revoke')
  @RequirePermissions('lesson:revoke')
  @ApiOperation({ summary: '撤销消课记录' })
  async revoke(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: any) {
    return this.lessonService.revoke(id, reason, user);
  }
}

