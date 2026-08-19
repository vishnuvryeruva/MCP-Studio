import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Organization } from './organization.model';
import { Role } from './role.model';
import type { LlmProviderName } from '../llm/llm-provider.interface';

@Table({
  tableName: 'users',
  timestamps: true,
  indexes: [{ unique: true, fields: ['email'] }],
})
export class User extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Organization)
  @Column({ type: DataType.UUID, allowNull: false })
  declare organizationId: string;

  @BelongsTo(() => Organization)
  declare organization: Organization;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare email: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare passwordHash: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isOwner: boolean;

  @ForeignKey(() => Role)
  @Column({ type: DataType.UUID, allowNull: true })
  declare roleId: string | null;

  @BelongsTo(() => Role)
  declare role: Role | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isActive: boolean;

  @Column({
    type: DataType.ENUM('anthropic', 'openai', 'gemini'),
    allowNull: false,
    defaultValue: 'anthropic',
  })
  declare llmProvider: LlmProviderName;
}
