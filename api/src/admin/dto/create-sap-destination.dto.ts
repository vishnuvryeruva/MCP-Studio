import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateSapDestinationDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl({ require_tld: false })
  url: string;

  // SAP_USER
  @IsString()
  @MinLength(1)
  sapUser: string;

  // SAP_PWD
  @IsString()
  @MinLength(1)
  sapPassword: string;
}
