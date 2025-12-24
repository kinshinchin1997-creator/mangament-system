import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';

@ApiTags('学员管理')
@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Post()
  @ApiOperation({ summary: '创建学员' })
  async create(@Body() createDto: any) {
    return this.studentService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: '获取学员列表' })
  async findAll(@Query() query: any) {
    return this.studentService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取学员详情' })
  async findOne(@Param('id') id: string) {
    return this.studentService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新学员' })
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.studentService.update(id, updateDto);
  }

  @Get(':id/contracts')
  @ApiOperation({ summary: '获取学员的合同列表' })
  async getContracts(@Param('id') id: string) {
    return this.studentService.getContracts(id);
  }
}

