import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FunctionModuleParamDto } from './function-module-param.dto';

export class CreateFunctionModuleDto {
  @IsUUID()
  sapDestinationId: string;

  // Tool name exposed to Claude
  @IsString()
  @MinLength(2)
  name: string;

  // Tool description exposed to Claude, used to pick the right tool for a request
  @IsString()
  @MinLength(2)
  description: string;

  // Underlying SAP function module name, e.g. BAPI_SALESORDER_GETLIST
  @IsString()
  @MinLength(1)
  fmName: string;

  // fmcall URL/path to invoke on the SAP destination
  @IsString()
  @MinLength(1)
  fmcallUrl: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FunctionModuleParamDto)
  parameters: FunctionModuleParamDto[];

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
