import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Permission } from '../../common/enums/permission.enum';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];
}
