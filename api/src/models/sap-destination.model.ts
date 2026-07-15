import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { Organization } from './organization.model';
import { User } from './user.model';
import { FunctionModule } from './function-module.model';

@Table({
  tableName: 'sap_destinations',
  timestamps: true,
  indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
})
export class SapDestination extends Model {
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

  // Name of the BTP destination, e.g. as configured in the SAP BTP cockpit
  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare description: string | null;

  // Base URL of the SAP system / BTP destination
  @Column({ type: DataType.STRING, allowNull: false })
  declare url: string;

  // AES-256-GCM encrypted "iv:authTag:ciphertext" hex string. Never store SAP_USER/SAP_PWD in plaintext.
  @Column({ type: DataType.TEXT, allowNull: false })
  declare encryptedSapUser: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare encryptedSapPassword: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare createdByUserId: string;

  @BelongsTo(() => User)
  declare createdBy: User;

  @HasMany(() => FunctionModule)
  declare functionModules: FunctionModule[];
}
