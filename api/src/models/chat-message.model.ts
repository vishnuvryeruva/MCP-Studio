import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { ChatThread } from './chat-thread.model';
import type { ChatToolInvocation } from '../chat/chat.service';

@Table({
  tableName: 'chat_messages',
  timestamps: true,
  indexes: [{ fields: ['threadId', 'createdAt'] }],
})
export class ChatMessage extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => ChatThread)
  @Column({ type: DataType.UUID, allowNull: false })
  declare threadId: string;

  @BelongsTo(() => ChatThread)
  declare thread: ChatThread;

  @Column({ type: DataType.ENUM('user', 'assistant'), allowNull: false })
  declare role: 'user' | 'assistant';

  @Column({ type: DataType.TEXT, allowNull: false })
  declare content: string;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare toolInvocations: ChatToolInvocation[] | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare failed: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare answeredWithoutSap: boolean;
}
