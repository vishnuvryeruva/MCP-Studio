import {
  Column,
  DataType,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './user.model';
import { Role } from './role.model';
import { SapDestination } from './sap-destination.model';
import { FunctionModule } from './function-module.model';

@Table({ tableName: 'organizations', timestamps: true })
export class Organization extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @HasMany(() => User)
  declare users: User[];

  @HasMany(() => Role)
  declare roles: Role[];

  @HasMany(() => SapDestination)
  declare sapDestinations: SapDestination[];

  @HasMany(() => FunctionModule)
  declare functionModules: FunctionModule[];
}
