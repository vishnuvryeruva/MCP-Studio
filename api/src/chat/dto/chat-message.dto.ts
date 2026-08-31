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
}
