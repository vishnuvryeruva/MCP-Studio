import { IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { DESTINATION_TRANSPORTS } from '../../models/sap-destination.model';
import type { DestinationTransport } from '../../models/sap-destination.model';

const isCapFacade = (dto: CreateSapDestinationDto) => dto.transport === 'cap_facade';
const isDirect = (dto: CreateSapDestinationDto) => dto.transport !== 'cap_facade';

export class CreateSapDestinationDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Omitted means 'direct_fmcall', so existing clients keep working unchanged.
  @IsOptional()
  @IsIn(DESTINATION_TRANSPORTS)
  transport?: DestinationTransport;

  // Not @IsUrl: SAP Cloud Connector virtual hosts can contain underscores
  // (e.g. http://hmf2023_https:44300), which @IsUrl rejects. Require only an
  // http(s) scheme + host, allowing underscores in the host.
  @Matches(/^https?:\/\/[^\s/$.?#].[^\s]*$/, {
    message: 'url must be a valid http(s) URL (Cloud Connector virtual hosts allowed)',
  })
  url: string;

  // ── direct_fmcall only ─────────────────────────────────────────────────────────
  // Optional SAP Cloud Connector Location ID; falls back to the app-wide default when omitted.
  @IsOptional()
  @IsString()
  cloudConnectorLocationId?: string;

  // SAP_USER
  @ValidateIf(isDirect)
  @IsString()
  @MinLength(1)
  sapUser?: string;

  // SAP_PWD
  @ValidateIf(isDirect)
  @IsString()
  @MinLength(1)
  sapPassword?: string;

  // ── cap_facade only ────────────────────────────────────────────────────────────
  // Defaults to /integration/execute when omitted.
  @IsOptional()
  @IsString()
  capExecutePath?: string;

  @ValidateIf(isCapFacade)
  @Matches(/^https?:\/\/\S+$/, { message: 'capTokenUrl must be an http(s) URL' })
  capTokenUrl?: string;

  @ValidateIf(isCapFacade)
  @IsString()
  @MinLength(1)
  capClientId?: string;

  @ValidateIf(isCapFacade)
  @IsString()
  @MinLength(1)
  capClientSecret?: string;
}
