import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  // Existing thread to continue; omitted to create a new chat.
  @IsOptional()
  @IsUUID('4')
  threadId?: string;

  // Which SAP destination this turn should query. Required so a user with several
  // connections cannot accidentally mix tools from two systems in one request.
  @IsUUID('4')
  sapDestinationId: string;
}
