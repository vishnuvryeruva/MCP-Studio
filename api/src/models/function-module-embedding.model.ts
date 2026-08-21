import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { FunctionModule } from './function-module.model';

// The semantic vector for one whitelisted function module, used to shortlist
// tools for a question and to flag near-duplicate descriptions.
//
// Kept in its own table rather than as a column on function_modules so the
// vectors never ride along in the admin API payloads (a few thousand floats per
// row) and so a provider change can be cleared without touching the whitelist.
@Table({
  tableName: 'function_module_embeddings',
  timestamps: true,
})
export class FunctionModuleEmbedding extends Model {
  @ForeignKey(() => FunctionModule)
  @Column({ type: DataType.UUID, primaryKey: true })
  declare functionModuleId: string;

  @BelongsTo(() => FunctionModule, { onDelete: 'CASCADE' })
  declare functionModule: FunctionModule;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare vector: number[];

  // "provider:model" of whatever produced this vector. Cosine similarity across
  // two different models is meaningless, so a mismatch forces a re-embed.
  @Column({ type: DataType.STRING, allowNull: false })
  declare embeddingModel: string;

  // Hash of the exact text that was embedded, so an edit to the tool's name,
  // description, or parameters invalidates the vector.
  @Column({ type: DataType.STRING, allowNull: false })
  declare sourceHash: string;
}
