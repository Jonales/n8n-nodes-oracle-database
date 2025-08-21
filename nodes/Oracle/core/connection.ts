/**
 * Oracle Vector Store Node para n8n
 * Gerenciamento de vector store usando Oracle Database 23ai
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.1.0
 */

import oracledb, { Connection, ConnectionAttributes } from 'oracledb';

import { DatabaseConnection } from './interfaces/database.interface';
import { OracleCredentials } from './types/oracle.credentials.type';

export class OracleConnection implements DatabaseConnection<Connection> {
  private databaseConfig: ConnectionAttributes;

  constructor(credentials: OracleCredentials, useThinMode = true) {
    const { user, password, connectionString } = credentials;
    this.databaseConfig = {
      user,
      password,
      connectionString,
    } as ConnectionAttributes;

    if (!useThinMode) {
      oracledb.initOracleClient({ libDir: process.env.LD_LIBRARY_PATH });
    }

    oracledb.fetchAsString = [ oracledb.CLOB ];
  }

  async getConnection(): Promise<Connection> {
    return await oracledb.getConnection(this.databaseConfig);
  }
}
