import { IsOptional, IsString } from 'class-validator';

export class TestSapConnectionDto {
  // Optional fmcall path to test instead of just the destination's base URL
  @IsOptional()
  @IsString()
  path?: string;
}
