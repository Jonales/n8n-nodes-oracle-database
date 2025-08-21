/**
 * Tipos de credenciais Oracle para n8n-nodes
 * Suporte para modo thin (padrão) e thick com Oracle Client
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.0.0
 */

//import { IExecuteFunctions } from "n8n-core";

import {
  NodeOperationError,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
  IExecuteFunctions,
} from 'n8n-workflow';
import oracledb, { Connection } from 'oracledb';

import { AQOperations } from './core/aqOperations';
import { BulkOperationsFactory } from './core/bulkOperations';
import { OracleConnectionPool } from './core/connectionPool';
import { PLSQLExecutorFactory } from './core/plsqlExecutor';
import { TransactionManagerFactory } from './core/transactionManager';


import { OracleConnection, ConnectionConfig } from './core/connection';
import { OracleCredentials } from './core/types/oracle.credentials.type';

/**
 * Interface para parâmetros dos nodes
 */
interface NodeParameterItem {
    name: string;
    value: string | number;
    datatype: string;
}

export class OracleDatabaseAdvanced implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Oracle Database Advanced',
    name: 'oracleDatabaseAdvanced',
    icon: 'file:oracle.svg',
    group: ['transform'],
    version: 1,
    description:
            'Oracle Database com recursos avançados para cargas pesadas e Oracle 19c+. Suporte para thin/thick mode.',
    defaults: {
      name: 'Oracle Database Advanced',
    },
    inputs: ['main' as NodeConnectionType],
    outputs: ['main' as NodeConnectionType],
    credentials: [
      {
        name: 'oracleCredentials',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation Type',
        name: 'operationType',
        type: 'options',
        default: 'query',
        options: [
          { name: 'SQL Query', value: 'query' },
          { name: 'PL/SQL Block', value: 'plsql' },
          { name: 'Stored Procedure', value: 'procedure' },
          { name: 'Function', value: 'function' },
          { name: 'Bulk Operations', value: 'bulk' },
          { name: 'Transaction Block', value: 'transaction' },
          { name: 'Oracle AQ', value: 'queue' },
        ],
      },
      {
        displayName: 'SQL/PL/SQL Statement',
        name: 'statement',
        type: 'string',
        typeOptions: {
          alwaysOpenEditWindow: true,
          rows: 10,
        },
        default: '',
        description: 'SQL query ou PL/SQL block para executar',
      },
      {
        displayName: 'Connection Pool',
        name: 'connectionPool',
        type: 'options',
        default: 'standard',
        options: [
          { name: 'Standard Pool', value: 'standard' },
          { name: 'High Volume Pool', value: 'highvolume' },
          { name: 'OLTP Pool', value: 'oltp' },
          { name: 'Analytics Pool', value: 'analytics' },
          { name: 'Single Connection', value: 'single' },
        ],
      },
      {
        displayName: 'Parameters',
        name: 'params',
        placeholder: 'Add Parameter',
        type: 'fixedCollection',
        typeOptions: {
          multipleValueButtonText: 'Add another Parameter',
          multipleValues: true,
        },
        default: {},
        options: [
          {
            displayName: 'Values',
            name: 'values',
            values: [
              {
                displayName: 'Name',
                name: 'name',
                type: 'string',
                default: '',
                required: true,
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                required: true,
              },
              {
                displayName: 'Data Type',
                name: 'datatype',
                type: 'options',
                required: true,
                default: 'string',
                options: [
                  { name: 'String', value: 'string' },
                  { name: 'Number', value: 'number' },
                  { name: 'Date', value: 'date' },
                  { name: 'CLOB', value: 'clob' },
                  { name: 'OUT Parameter', value: 'out' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };




  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

    const rawCredentials = await this.getCredentials('oracleCredentials');
    const credentials: OracleCredentials = {
      user: String(rawCredentials.user),
      password: String(rawCredentials.password),
      connectionString: String(rawCredentials.connectionString),
      thinMode: rawCredentials.thinMode !== false, // Default true
      libDir: rawCredentials.libDir ? String(rawCredentials.libDir) : undefined,
      configDir: rawCredentials.configDir ? String(rawCredentials.configDir) : undefined,
      errorUrl: rawCredentials.errorUrl ? String(rawCredentials.errorUrl) : undefined,
    };

    const operationType = this.getNodeParameter('operationType', 0) as string;
    const connectionPoolType = this.getNodeParameter('connectionPool', 0) as string;


    let connection: Connection | null = null;
    let returnItems: INodeExecutionData[] = [];

    try {

      const connectionConfig: ConnectionConfig = {
        mode: credentials.thinMode !== false ? 'thin' : 'thick',
        libDir: credentials.libDir,
        configDir: credentials.configDir,
        errorUrl: credentials.errorUrl,
      };

      // Função auxiliar para configuração de pool
      const getPoolConfig = (poolType: string) => {
        switch (poolType) {
        case 'highvolume':
          return OracleConnectionPool.getHighVolumeConfig();
        case 'oltp':
          return OracleConnectionPool.getOLTPConfig();
        case 'analytics':
          return OracleConnectionPool.getAnalyticsConfig();
        default:
          return {};
        }
      };

      // Função auxiliar para processamento de parâmetros
      const processParameters = (): { [key: string]: any } => {
        const parameterList =
                    ((this.getNodeParameter('params', 0, {}) as IDataObject).values as NodeParameterItem[]) ||
                    [];

        const bindParameters: { [key: string]: any } = {};

        for (const param of parameterList) {
          let value: any = param.value;

          switch (param.datatype) {
          case 'number':
            value = Number(param.value);
            break;
          case 'date':
            value = new Date(param.value);
            break;
          case 'out':
            value = {
              dir: oracledb.BIND_OUT,
              type: oracledb.STRING,
              maxSize: 4000,
            };
            break;
          case 'clob':
            value = { type: oracledb.CLOB, val: param.value };
            break;
          default:
            value = String(param.value);
          }

          bindParameters[param.name] = value;
        }

        return bindParameters;
      };

      // Função auxiliar para executar query
      const executeQuery = async (conn: Connection): Promise<INodeExecutionData[]> => {
        const statement = this.getNodeParameter('statement', 0) as string;
        const bindParameters = processParameters();

        const result = await conn.execute(statement, bindParameters, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          autoCommit: true,
        });

        return this.helpers.returnJsonArray(result.rows as IDataObject[]);
      };

      // Função auxiliar para executar PL/SQL
      const executePLSQL = async (conn: Connection): Promise<INodeExecutionData[]> => {
        const statement = this.getNodeParameter('statement', 0) as string;
        const bindParameters = processParameters();

        const executor = PLSQLExecutorFactory.createProductionExecutor(conn);
        const result = await executor.executeAnonymousBlock(statement, bindParameters);

        return this.helpers.returnJsonArray([result as unknown as IDataObject]);
      };

      // Função auxiliar para bulk operations
      const executeBulkOperations = async (conn: Connection): Promise<INodeExecutionData[]> => {
        const inputData = this.getInputData();
        const data = inputData.map((item: INodeExecutionData) => item.json);

        const bulkOps = BulkOperationsFactory.createHighVolumeOperations(conn);
        const result = await bulkOps.bulkInsert('target_table', data, {
          batchSize: 5000,
          continueOnError: true,
          autoCommit: true,
        });

        return this.helpers.returnJsonArray([result as unknown as IDataObject]);
      };

      // Função auxiliar para transações
      const executeTransaction = async (conn: Connection): Promise<INodeExecutionData[]> => {
        const statement = this.getNodeParameter('statement', 0) as string;
        const txManager = TransactionManagerFactory.createBatchManager(conn);

        await txManager.beginTransaction();
        try {
          const operations = statement
            .split(';')
            .filter(s => s.trim())
            .map(sql => ({
              sql: sql.trim(),
              binds: processParameters(),
            }));

          const results = await txManager.executeBatch(operations, {
            savepointPerOperation: true,
            stopOnError: true,
          });

          await txManager.commit();
          return this.helpers.returnJsonArray([{ success: true, results }]);
        } catch (error) {
          await txManager.rollback();
          throw error;
        }
      };

      // Função auxiliar para AQ operations
      const executeAQOperations = async (conn: Connection): Promise<INodeExecutionData[]> => {
        const aqOps = new AQOperations(conn);
        const queueName = this.getNodeParameter('queueName', 0, 'DEFAULT_QUEUE') as string;
        const result = await aqOps.getQueueInfo(queueName);

        return this.helpers.returnJsonArray([result as unknown as IDataObject]);
      };


      if (connectionPoolType === 'single') {
        const oracleConnection = new OracleConnection(credentials, connectionConfig);
        connection = await oracleConnection.getConnection();
      } else {
        const poolConfig = getPoolConfig(connectionPoolType);
        const pool = await OracleConnectionPool.getPool(credentials, poolConfig);
        connection = await pool.getConnection();
      }


      if (!connection) {
        throw new Error('Falha ao obter conexão com o banco de dados');
      }

      // Executar operação baseada no tipo
      switch (operationType) {
      case 'query':
        returnItems = await executeQuery(connection);
        break;
      case 'plsql':
        returnItems = await executePLSQL(connection);
        break;
      case 'bulk':
        returnItems = await executeBulkOperations(connection);
        break;
      case 'transaction':
        returnItems = await executeTransaction(connection);
        break;
      case 'queue':
        returnItems = await executeAQOperations(connection);
        break;
      default:
        throw new Error(`Tipo de operação não suportado: ${operationType}`);
      }

      // Log de estatísticas de conexão
      const mode = credentials.thinMode !== false ? 'thin' : 'thick';
      console.log(`Operação concluída em modo ${mode}: ${returnItems.length} itens retornados`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const mode = credentials.thinMode !== false ? 'thin' : 'thick';

      throw new NodeOperationError(
        this.getNode(),
        `Oracle Advanced Error (modo ${mode}): ${errorMessage}`,
        {
          description: 'Verifique suas credenciais, configurações de modo e comandos SQL/PL/SQL',
        },
      );
    } finally {

      if (connection) {
        try {
          await connection.close();
        } catch (closeError: unknown) {
          const closeErrorMessage =
                        closeError instanceof Error ? closeError.message : String(closeError);
          console.error(`Falha ao fechar conexão: ${closeErrorMessage}`);
        }
      }
    }

    return this.prepareOutputData(returnItems);
  }
}