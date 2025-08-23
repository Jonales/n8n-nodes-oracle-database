import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import oracledb from 'oracledb';
import { OracleConnection } from './core/connection';

export class OracleDatabaseOperations {
  async executeOperation(
    executeFunctions: IExecuteFunctions,
    credentials: IDataObject,
  ): Promise<INodeExecutionData[]> {
    const oracleCredentials = {
      user: String(credentials.user),
      password: String(credentials.password),
      connectionString: String(credentials.connectionString),
      thinMode: Boolean(credentials.thinMode),
    };

    const db = new OracleConnection(oracleCredentials);
    const connection = await db.getConnection();
    let returnItems: INodeExecutionData[] = [];

    try {
      let query = executeFunctions.getNodeParameter('query', 0) as string;
      const parameterIDataObjectList =
        ((executeFunctions.getNodeParameter('params', 0, {}) as IDataObject).values as {
          name: string;
          value: string | number;
          datatype: string;
          parseInStatement: boolean;
        }[]) || [];

      const bindParameters: { [key: string]: oracledb.BindParameter } =
        parameterIDataObjectList.reduce(
          (result: { [key: string]: oracledb.BindParameter }, item) => {
            let datatype: oracledb.DbType | undefined = undefined;
            if (item.datatype && item.datatype === 'number') {
              datatype = oracledb.NUMBER;
            } else {
              datatype = oracledb.STRING;
            }

            if (!item.parseInStatement) {
              result[item.name] = {
                type: datatype,
                val:
                  item.datatype && item.datatype === 'number'
                    ? Number(item.value)
                    : String(item.value),
              };
              return result;
            } else {
              const valList = item.value.toString().split(',');
              let generatedSqlString = '(';
              const crypto = require('crypto');

              for (let i = 0; i < valList.length; i++) {
                const uniqueId: String = crypto.randomUUID().replaceAll('-', '_');
                const newParamName = item.name + uniqueId;

                result[newParamName] = {
                  type: datatype,
                  val:
                    item.datatype && item.datatype === 'number'
                      ? Number(valList[i])
                      : String(valList[i]),
                };

                generatedSqlString += `:${newParamName},`;
              }

              generatedSqlString = generatedSqlString.slice(0, -1) + ')';
              query = query.replaceAll(':' + item.name, generatedSqlString);
              return result;
            }
          },
          {},
        );

      const result = await connection.execute(query, bindParameters, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });

      returnItems = executeFunctions.helpers.returnJsonArray(result as unknown as IDataObject[]);
    } catch (error) {
      throw new NodeOperationError(executeFunctions.getNode(), (error as Error).message);
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (error) {
          console.error(`OracleDB: Failed to close the database connection: ${error}`);
        }
      }
    }

    return returnItems;
  }
}

export class OracleDatabase implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Oracle Database',
    name: 'Oracle Database',
    icon: 'file:oracle.svg',
    group: ['input'],
    version: 1,
    description: 'Upsert, get, add and update data in Oracle database',
    defaults: {
      name: 'Oracle Database',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'oracleCredentials',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'SQL Statement',
        name: 'query',
        type: 'string',
        typeOptions: {
          alwaysOpenEditWindow: true,
        },
        default: '',
        placeholder: 'SELECT id, name FROM product WHERE id < :param_name',
        required: true,
        description: 'The SQL query to execute',
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
                placeholder: 'e.g. param_name',
                hint: 'Do not start with ":"',
                required: true,
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                placeholder: 'Example: 12345',
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
                ],
              },
              {
                displayName: 'Parse for IN statement',
                name: 'parseInStatement',
                type: 'options',
                required: true,
                default: false,
                hint: 'If "Yes" the "Value" field should be a string of comma-separated values. i.e: 1,2,3 or str1,str2,str3',
                options: [
                  { name: 'No', value: false },
                  { name: 'Yes', value: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('oracleCredentials');
    const oracleDatabaseOps = new OracleDatabaseOperations();
    const returnData = await oracleDatabaseOps.executeOperation(this, credentials);
    return [returnData];
  }
}


