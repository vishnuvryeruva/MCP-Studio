import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class FunctionModuleParamDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['string', 'number', 'boolean', 'date'])
  type: 'string' | 'number' | 'boolean' | 'date';

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
