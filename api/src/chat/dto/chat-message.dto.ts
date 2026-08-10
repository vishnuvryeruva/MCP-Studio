import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatHistoryTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(20000)
  content: string;
}

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  // Prior turns for follow-up context. Bounded so a client can't push an
  // unlimited transcript into the model on every request.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryTurnDto)
  history?: ChatHistoryTurnDto[];
}
