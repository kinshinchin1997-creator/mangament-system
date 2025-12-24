import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto';

export class CreateRoleDto {
  @ApiProperty({ description: '角色编码', example: 'SALES' })
  @IsString()
  @IsNotEmpty({ message: '角色编码不能为空' })
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: '角色名称', example: '销售' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: '角色描述' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ description: '权限ID列表' })
  @IsArray()
  @IsOptional()
  permissionIds?: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class QueryRoleDto extends PaginationDto {
  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

