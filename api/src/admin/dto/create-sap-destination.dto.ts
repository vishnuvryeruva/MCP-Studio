import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateSapDestinationDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Not @IsUrl: SAP Cloud Connector virtual hosts can contain underscores
  // (e.g. http://hmf2023_https:44300), which @IsUrl rejects. Require only an
  // http(s) scheme + host, allowing underscores in the host.
  @Matches(/^https?:\/\/[^\s/$.?#].[^\s]*$/, {
    message: 'url must be a valid http(s) URL (Cloud Connector virtual hosts allowed)',
  })
  url: string;

  // Optional SAP Cloud Connector Location ID; falls back to the app-wide default when omitted.
  @IsOptional()
  @IsString()
  cloudConnectorLocationId?: string;

  // SAP_USER
  @IsString()
  @MinLength(1)
  sapUser: string;

  // SAP_PWD
  @IsString()
  @MinLength(1)
  sapPassword: string;
}
