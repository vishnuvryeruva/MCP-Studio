import { PartialType } from '@nestjs/mapped-types';
import { CreateFunctionModuleDto } from './create-function-module.dto';

export class UpdateFunctionModuleDto extends PartialType(CreateFunctionModuleDto) {}
