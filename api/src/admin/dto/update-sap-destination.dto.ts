import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSapDestinationDto } from './create-sap-destination.dto';

export class UpdateSapDestinationDto extends PartialType(CreateSapDestinationDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
