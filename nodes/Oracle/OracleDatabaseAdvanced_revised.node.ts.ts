/**
 * Oracle Database Advanced Node para n8n
 * Suporte completo para modo thin (padrão) e thick com Oracle Client
 * Recursos avançados para cargas pesadas e Oracle 19c+
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.1.0
 */

import { NodeOperationError } from 'n8n-workflow';
import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';

import oracledb, { Connection, Pool } from 'oracledb';

// Core modules
import { AQOperations } from './core/aqOperations';
import { BulkOperationsFactory } from './core/bulkOperations';
import { OracleConnectionPool } from './core/connectionPool';
import { PLSQLExecutorFactory } from './core/plsqlExecutor';
import { TransactionManagerFactory } from './core/transactionManager';

// Credentials and connection
import { OracleConnection } from '../connection';
import {
	OracleCredentials,
	OracleCredentialsUtils,
	isThickModeCredentials,
	isThinModeCredentials,
} from '../types/oracle.credentials.type';

/**
 * Interface para parâmetros dos nodes
 */
interface NodeParameterItem {
	name: string;
	value: string | number;
	datatype: string;
}

/**
 * Interface para resultado de execução
 */
interface ExecutionResult {
	success: boolean;
	data?: any[];
	message?: string;
	rowsAffected?: number;
	executionTime?: number;
}

/**
 * Enum para tipos de operação
 */
enum OperationType {
	QUERY = 'query',
	PLSQL = 'plsql',
	PROCEDURE = 'procedure',
	FUNCTION = 'function',
	BULK = 'bulk',
	TRANSACTION = 'transaction',
	QUEUE = 'queue',
}

/**
 * Enum para tipos de pool de conexão
 */
enum ConnectionPoolType {
	STANDARD = 'standard',
	HIGH_VOLUME = 'highvolume',
	OLTP = 'oltp',
	ANALYTICS = 'analytics',
	SINGLE = 'single',
}

export class OracleDatabaseAdvanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oracle Database Advanced',
		name: 'oracleDatabaseAdvanced',
		icon: 'file:oracle.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operationType"]}} ({{$parameter["connectionPool"]}})',
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
				displayOptions: {
					show: {},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation Type',
				name: 'operationType',
				type: 'options',
				noDataExpression: true,
				default: OperationType.QUERY,
				options: [
					{
						name: 'SQL Query',
						value: OperationType.QUERY,
						description: 'Execute SELECT statements and DML operations',
					},
					{
						name: 'PL/SQL Block',
						value: OperationType.PLSQL,
						description: 'Execute anonymous PL/SQL blocks',
					},
					{
						name: 'Stored Procedure',
						value: OperationType.PROCEDURE,
						description: 'Call stored procedures with parameters',
					},
					{
						name: 'Function',
						value: OperationType.FUNCTION,
						description: 'Execute Oracle functions and return values',
					},
					{
						name: 'Bulk Operations',
						value: OperationType.BULK,
						description: 'High-performance bulk insert/update operations',
					},
					{
						name: 'Transaction Block',
						value: OperationType.TRANSACTION,
						description: 'Execute multiple statements in a transaction',
					},
					{
						name: 'Oracle AQ',
						value: OperationType.QUEUE,
						description: 'Advanced Queuing operations',
					},
				],
			},

			// SQL/PL/SQL Statement
			{
				displayName: 'SQL Statement',
				name: 'statement',
				type: 'string',
				typeOptions: {
					editor: 'sqlEditor',
					alwaysOpenEditWindow: true,
					rows: 10,
				},
				default: '',
				required: true,
				description: 'SQL query to execute',
				displayOptions: {
					show: {
						operationType: [OperationType.QUERY],
					},
				},
			},
			{
				displayName: 'PL/SQL Block',
				name: 'statement',
				type: 'string',
				typeOptions: {
					editor: 'sqlEditor',
					alwaysOpenEditWindow: true,
					rows: 10,
				},
				default: 'BEGIN\n  -- Your PL/SQL code here\n  NULL;\nEND;',
				required: true,
				description: 'PL/SQL anonymous block to execute',
				displayOptions: {
					show: {
						operationType: [OperationType.PLSQL],
					},
				},
			},
			{
				displayName: 'Procedure Name',
				name: 'procedureName',
				type: 'string',
				default: '',
				required: true,
				description: 'Name of the stored procedure to call',
				displayOptions: {
					show: {
						operationType: [OperationType.PROCEDURE],
					},
				},
			},
			{
				displayName: 'Function Name',
				name: 'functionName',
				type: 'string',
				default: '',
				required: true,
				description: 'Name of the function to execute',
				displayOptions: {
					show: {
						operationType: [OperationType.FUNCTION],
					},
				},
			},
			{
				displayName: 'Target Table',
				name: 'targetTable',
				type: 'string',
				default: '',
				required: true,
				description: 'Table name for bulk operations',
				displayOptions: {
					show: {
						operationType: [OperationType.BULK],
					},
				},
			},
			{
				displayName: 'Transaction Statements',
				name: 'statement',
				type: 'string',
				typeOptions: {
					editor: 'sqlEditor',
					alwaysOpenEditWindow: true,
					rows: 15,
				},
				default: '-- Statement 1;\n-- Statement 2;\n-- Statement 3;',
				required: true,
				description: 'Multiple SQL statements separated by semicolons',
				displayOptions: {
					show: {
						operationType: [OperationType.TRANSACTION],
					},
				},
			},
			{
				displayName: 'Queue Name',
				name: 'queueName',
				type: 'string',
				default: 'DEFAULT_QUEUE',
				required: true,
				description: 'Oracle AQ queue name',
				displayOptions: {
					show: {
						operationType: [OperationType.QUEUE],
					},
				},
			},

			// Connection Pool Configuration
			{
				displayName: 'Connection Pool',
				name: 'connectionPool',
				type: 'options',
				default: ConnectionPoolType.STANDARD,
				options: [
					{
						name: 'Standard Pool',
						value: ConnectionPoolType.STANDARD,
						description: 'Default connection pool for general use',
					},
					{
						name: 'High Volume Pool',
						value: ConnectionPoolType.HIGH_VOLUME,
						description: 'Optimized for high-volume operations',
					},
					{
						name: 'OLTP Pool',
						value: ConnectionPoolType.OLTP,
						description: 'Optimized for transactional workloads',
					},
					{
						name: 'Analytics Pool',
						value: ConnectionPoolType.ANALYTICS,
						description: 'Optimized for long-running analytics queries',
					},
					{
						name: 'Single Connection',
						value: ConnectionPoolType.SINGLE,
						description: 'Use single connection (not pooled)',
					},
				],
				description: 'Choose the appropriate connection pool type for your workload',
			},

			// Parameters Configuration
			{
				displayName: 'Parameters',
				name: 'params',
				placeholder: 'Add Parameter',
				type: 'fixedCollection',
				typeOptions: {
					multipleValueButtonText: 'Add Parameter',
					multipleValues: true,
				},
				default: {},
				description: 'Bind parameters for your SQL/PL/SQL statements',
				options: [
					{
						displayName: 'Parameter',
						name: 'values',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								required: true,
								description: 'Parameter name (without colon prefix)',
								placeholder: 'param_name',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								required: true,
								description: 'Parameter value',
							},
							{
								displayName: 'Data Type',
								name: 'datatype',
								type: 'options',
								required: true,
								default: 'string',
								options: [
									{ name: 'String (VARCHAR2)', value: 'string' },
									{ name: 'Number', value: 'number' },
									{ name: 'Date/Timestamp', value: 'date' },
									{ name: 'CLOB', value: 'clob' },
									{ name: 'BLOB', value: 'blob' },
									{ name: 'Boolean', value: 'boolean' },
									{ name: 'OUT Parameter', value: 'out' },
									{ name: 'IN OUT Parameter', value: 'inout' },
								],
							},
							{
								displayName: 'Max Size',
								name: 'maxSize',
								type: 'number',
								default: 4000,
								description: 'Maximum size for OUT parameters and CLOBs',
								displayOptions: {
									show: {
										datatype: ['out', 'inout', 'clob'],
									},
								},
							},
						],
					},
				],
			},

			// Advanced Options
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Auto Commit',
						name: 'autoCommit',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically commit transactions',
					},
					{
						displayName: 'Fetch Array Size',
						name: 'fetchArraySize',
						type: 'number',
						default: 100,
						description: 'Number of rows to fetch at a time',
					},
					{
						displayName: 'Query Timeout (seconds)',
						name: 'queryTimeout',
						type: 'number',
						default: 60,
						description: 'Maximum time to wait for query execution',
					},
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						default: 5000,
						description: 'Batch size for bulk operations',
						displayOptions: {
							show: {
								'/operationType': [OperationType.BULK],
							},
						},
					},
					{
						displayName: 'Continue On Error',
						name: 'continueOnError',
						type: 'boolean',
						default: false,
						description: 'Continue processing even if some operations fail',
						displayOptions: {
							show: {
								'/operationType': [OperationType.BULK, OperationType.TRANSACTION],
							},
						},
					},
					{
						displayName: 'Return Metadata',
						name: 'returnMetadata',
						type: 'boolean',
						default: false,
						description: 'Include query metadata in results',
					},
				],
			},
		],
	};

	/**
	 * Preparar e validar credenciais Oracle
	 */
	private prepareOracleCredentials(rawCredentials: any): OracleCredentials {
		try {
			const credentials: OracleCredentials = {
				user: String(rawCredentials.user || '').trim(),
				password: String(rawCredentials.password || ''),
				connectionString: String(rawCredentials.connectionString || '').trim(),
				thinMode: rawCredentials.thinMode !== false, // Default true
				libDir: rawCredentials.libDir ? String(rawCredentials.libDir).trim() : undefined,
				configDir: rawCredentials.configDir ? String(rawCredentials.configDir).trim() : undefined,
				errorUrl: rawCredentials.errorUrl ? String(rawCredentials.errorUrl).trim() : undefined,
			};

			// Validar credenciais
			const validation = OracleCredentialsUtils.validateCredentials(credentials);
			if (!validation.isValid) {
				throw new Error(`Invalid credentials: ${validation.errorMessage}`);
			}

			return credentials;
		} catch (error) {
			throw new Error(`Failed to prepare Oracle credentials: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Inicializar Oracle Client para modo thick
	 */
	private async initializeOracleClient(credentials: OracleCredentials): Promise<void> {
		if (!isThickModeCredentials(credentials)) {
			console.log('✅ Using thin mode (pure JavaScript driver)');
			return;
		}

		try {
			// Verificar se já foi inicializado
			if (oracledb.thin !== false) {
				const initConfig: any = {
					libDir: credentials.libDir,
				};

				if (credentials.configDir) {
					initConfig.configDir = credentials.configDir;
				}

				if (credentials.errorUrl) {
					initConfig.errorUrl = credentials.errorUrl;
				}

				oracledb.initOracleClient(initConfig);
				console.log(`✅ Oracle Client initialized in thick mode: ${credentials.libDir}`);
			} else {
				console.log('✅ Oracle Client already initialized in thick mode');
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to initialize Oracle Client: ${errorMessage}`);
		}
	}

	/**
	 * Processar parâmetros de entrada
	 */
	private processParameters(executeFunctions: IExecuteFunctions, itemIndex: number = 0): { [key: string]: any } {
		try {
			const parameterList = (
				(executeFunctions.getNodeParameter('params', itemIndex, {}) as IDataObject).values as NodeParameterItem[]
			) || [];

			const bindParameters: { [key: string]: any } = {};

			for (const param of parameterList) {
				if (!param.name?.trim()) {
					console.warn('⚠️ Skipping parameter with empty name');
					continue;
				}

				const paramName = param.name.trim();
				let value: any = param.value;

				try {
					switch (param.datatype) {
						case 'number':
							value = param.value === '' ? null : Number(param.value);
							if (isNaN(value)) {
								throw new Error(`Invalid number value: ${param.value}`);
							}
							break;

						case 'date':
							value = param.value === '' ? null : new Date(param.value);
							if (value && isNaN(value.getTime())) {
								throw new Error(`Invalid date value: ${param.value}`);
							}
							break;

						case 'boolean':
							value = param.value === 'true' || param.value === '1' || param.value === 'yes';
							break;

						case 'out':
							value = {
								dir: oracledb.BIND_OUT,
								type: oracledb.STRING,
								maxSize: (param as any).maxSize || 4000,
							};
							break;

						case 'inout':
							value = {
								dir: oracledb.BIND_INOUT,
								type: oracledb.STRING,
								val: String(param.value),
								maxSize: (param as any).maxSize || 4000,
							};
							break;

						case 'clob':
							value = {
								type: oracledb.CLOB,
								val: String(param.value),
							};
							break;

						case 'blob':
							// Assumindo que o valor é base64 encoded
							value = {
								type: oracledb.BLOB,
								val: Buffer.from(String(param.value), 'base64'),
							};
							break;

						default: // string
							value = param.value === null || param.value === undefined ? null : String(param.value);
					}

					bindParameters[paramName] = value;
				} catch (paramError) {
					throw new Error(`Error processing parameter '${paramName}': ${paramError instanceof Error ? paramError.message : String(paramError)}`);
				}
			}

			return bindParameters;
		} catch (error) {
			throw new Error(`Failed to process parameters: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Obter configuração do pool de conexão
	 */
	private getPoolConfig(poolType: string): any {
		switch (poolType) {
			case ConnectionPoolType.HIGH_VOLUME:
				return OracleConnectionPool.getHighVolumeConfig();
			case ConnectionPoolType.OLTP:
				return OracleConnectionPool.getOLTPConfig();
			case ConnectionPoolType.ANALYTICS:
				return OracleConnectionPool.getAnalyticsConfig();
			default:
				return {};
		}
	}

	/**
	 * Obter configuração avançada
	 */
	private getAdvancedOptions(executeFunctions: IExecuteFunctions, itemIndex: number = 0) {
		const advancedOptions = executeFunctions.getNodeParameter('advancedOptions', itemIndex, {}) as IDataObject;
		
		return {
			autoCommit: advancedOptions.autoCommit !== false, // Default true
			fetchArraySize: Number(advancedOptions.fetchArraySize) || 100,
			queryTimeout: Number(advancedOptions.queryTimeout) || 60,
			batchSize: Number(advancedOptions.batchSize) || 5000,
			continueOnError: Boolean(advancedOptions.continueOnError),
			returnMetadata: Boolean(advancedOptions.returnMetadata),
		};
	}

	/**
	 * Executar query SQL
	 */
	private async executeQuery(
		connection: Connection,
		executeFunctions: IExecuteFunctions,
		itemIndex: number = 0,
	): Promise<INodeExecutionData[]> {
		const statement = executeFunctions.getNodeParameter('statement', itemIndex) as string;
		const bindParameters = this.processParameters(executeFunctions, itemIndex);
		const options = this.getAdvancedOptions(executeFunctions, itemIndex);

		if (!statement?.trim()) {
			throw new Error('SQL statement cannot be empty');
		}

		const executeOptions: any = {
			outFormat: oracledb.OUT_FORMAT_OBJECT,
			autoCommit: options.autoCommit,
			fetchArraySize: options.fetchArraySize,
		};

		const startTime = Date.now();
		const result = await connection.execute(statement, bindParameters, executeOptions);
		const executionTime = Date.now() - startTime;

		const returnData: IDataObject[] = [];

		if (Array.isArray(result.rows) && result.rows.length > 0) {
			returnData.push(...(result.rows as IDataObject[]));
		}

		// Adicionar metadata se solicitado
		if (options.returnMetadata) {
			const metadata: IDataObject = {
				__metadata: {
					rowsAffected: result.rowsAffected || 0,
					executionTime,
					outBinds: result.outBinds || {},
					statement: statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
				},
			};
			
			if (returnData.length === 0) {
				returnData.push(metadata);
			} else {
				returnData[0] = { ...returnData[0], ...metadata };
			}
		}

		return executeFunctions.helpers.returnJsonArray(returnData);
	}

	/**
	 * Executar bloco PL/SQL
	 */
	private async executePLSQL(
		connection: Connection,
		executeFunctions: IExecuteFunctions,
		itemIndex: number = 0,
	): Promise<INodeExecutionData[]> {
		const statement = executeFunctions.getNodeParameter('statement', itemIndex) as string;
		const bindParameters = this.processParameters(executeFunctions, itemIndex);
		const options = this.getAdvancedOptions(executeFunctions, itemIndex);

		if (!statement?.trim()) {
			throw new Error('PL/SQL block cannot be empty');
		}

		const executor = PLSQLExecutorFactory.createProductionExecutor(connection);
		const startTime = Date.now();
		
		const result = await executor.executeAnonymousBlock(statement, bindParameters, {
			autoCommit: options.autoCommit,
		});
		
		const executionTime = Date.now() - startTime;

		const returnData: IDataObject = {
			success: true,
			outBinds: result.outBinds || {},
			...(options.returnMetadata && {
				__metadata: {
					executionTime,
					statement: statement.substring(0, 100) + (statement.length > 100 ? '...' : ''),
				},
			}),
		};

		return executeFunctions.helpers.returnJsonArray([returnData]);
	}

	/**
	 * Executar operações em lote (bulk)
	 */
	private async executeBulkOperations(
		connection: Connection,
		executeFunctions: IExecuteFunctions,
		itemIndex: number = 0,
	): Promise<INodeExecutionData[]> {
		const targetTable = executeFunctions.getNodeParameter('targetTable', itemIndex) as string;
		const options = this.getAdvancedOptions(executeFunctions, itemIndex);
		
		if (!targetTable?.trim()) {
			throw new Error('Target table name cannot be empty');
		}

		const inputData = executeFunctions.getInputData();
		const data = inputData.map((item: INodeExecutionData) => item.json);

		if (data.length === 0) {
			throw new Error('No input data provided for bulk operations');
		}

		const bulkOps = BulkOperationsFactory.createHighVolumeOperations(connection);
		const startTime = Date.now();
		
		const result = await bulkOps.bulkInsert(targetTable, data, {
			batchSize: options.batchSize,
			continueOnError: options.continueOnError,
			autoCommit: options.autoCommit,
		});
		
		const executionTime = Date.now() - startTime;

		const returnData: IDataObject = {
			success: true,
			rowsProcessed: data.length,
			rowsInserted: result.rowsAffected || 0,
			...(options.returnMetadata && {
				__metadata: {
					executionTime,
					targetTable,
					batchSize: options.batchSize,
				},
			}),
		};

		return executeFunctions.helpers.returnJsonArray([returnData]);
	}

	/**
	 * Executar transação
	 */
	private async executeTransaction(
		connection: Connection,
		executeFunctions: IExecuteFunctions,
		itemIndex: number = 0,
	): Promise<INodeExecutionData[]> {
		const statement = executeFunctions.getNodeParameter('statement', itemIndex) as string;
		const bindParameters = this.processParameters(executeFunctions, itemIndex);
		const options = this.getAdvancedOptions(executeFunctions, itemIndex);

		if (!statement?.trim()) {
			throw new Error('Transaction statements cannot be empty');
		}

		const txManager = TransactionManagerFactory.createBatchManager(connection);
		const startTime = Date.now();

		await txManager.beginTransaction();
		try {
			const statements = statement
				.split(';')
				.map(s => s.trim())
				.filter(s => s.length > 0);

			if (statements.length === 0) {
				throw new Error('No valid SQL statements found in transaction block');
			}

			const operations = statements.map(sql => ({
				sql,
				binds: bindParameters,
			}));

			const results = await txManager.executeBatch(operations, {
				savepointPerOperation: true,
				stopOnError: !options.continueOnError,
			});

			await txManager.commit();
			const executionTime = Date.now() - startTime;

			const returnData: IDataObject = {
				success: true,
				statementsExecuted: statements.length,
				results: results,
				...(options.returnMetadata && {
					__metadata: {
						executionTime,
						transactionMode: 'batch',
					},
				}),
			};

			return executeFunctions.helpers.returnJsonArray([returnData]);
		} catch (error) {
			await txManager.rollback();
			throw error;
		}
	}

	/**
	 * Executar operações AQ
	 */
	private async executeAQOperations(
		connection: Connection,
		executeFunctions: IExecuteFunctions,
		itemIndex: number = 0,
	): Promise<INodeExecutionData[]> {
		const queueName = executeFunctions.getNodeParameter('queueName', itemIndex) as string;
		
		if (!queueName?.trim()) {
			throw new Error('Queue name cannot be empty');
		}

		const aqOps = new AQOperations(connection);
		const result = await aqOps.getQueueInfo(queueName);

		return executeFunctions.helpers.returnJsonArray([result as unknown as IDataObject]);
	}

	/**
	 * Validar operação para o modo de conexão
	 */
	private validateOperationMode(operationType: string, credentials: OracleCredentials): void {
		// Operações que podem ter limitações no modo thin
		const thickPreferredOperations = [OperationType.QUEUE];

		if (thickPreferredOperations.includes(operationType as OperationType) && isThinModeCredentials(credentials)) {
			console.warn(`⚠️ Operation '${operationType}' may have limited functionality in thin mode`);
		}

		// Log de informações do modo
		const mode = isThinModeCredentials(credentials) ? 'thin' : 'thick';
		const details = isThickModeCredentials(credentials)
			? `(Oracle Client: ${credentials.libDir})`
			: '(Pure JavaScript)';

		console.log(`🔧 Executing operation '${operationType}' in ${mode} mode ${details}`);
	}

	/**
	 * Método principal de execução
	 */
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Obter e preparar credenciais uma vez
		const rawCredentials = await this.getCredentials('oracleCredentials');
		const credentials = this.prepareOracleCredentials(rawCredentials);

		// Inicializar Oracle Client se necessário
		await this.initializeOracleClient(credentials);

		// Obter configurações globais
		const operationType = this.getNodeParameter('operationType', 0) as OperationType;
		const connectionPoolType = this.getNodeParameter('connectionPool', 0) as ConnectionPoolType;

		// Validar operação para o modo
		this.validateOperationMode(operationType, credentials);

		let connection: Connection | undefined;
		let pool: Pool | undefined;

		try {
			// Configurar conexão
			const connectionConfig = OracleCredentialsUtils.createConnectionConfig(credentials);

			if (connectionPoolType === ConnectionPoolType.SINGLE) {
				// Conexão única
				const oracleConnection = new OracleConnection(credentials, connectionConfig);
				connection = await oracleConnection.getConnection();
			} else {
				// Pool de conexões
				const poolConfig = this.getPoolConfig(connectionPoolType);
				pool = await OracleConnectionPool.getPool(credentials, poolConfig, connectionConfig);
				connection = await pool.getConnection();
			}

			// Processar items (para operações que processam múltiplos items)
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					let itemResults: INodeExecutionData[] = [];

					// Executar operação baseada no tipo
					switch (operationType) {
						case OperationType.QUERY:
							itemResults = await this.executeQuery(connection, this, itemIndex);
							break;

						case OperationType.PLSQL:
							itemResults = await this.executePLSQL(connection, this, itemIndex);
							break;

						case OperationType.PROCEDURE:
							// TODO: Implementar chamada de procedure
							throw new Error('Stored procedure operations not yet implemented');

						case OperationType.FUNCTION:
							// TODO: Implementar chamada de function
							throw new Error('Function operations not yet implemented');

						case OperationType.BULK:
							// Bulk operations processam todos os items de uma vez
							if (itemIndex === 0) {
								itemResults = await this.executeBulkOperations(connection, this, itemIndex);
							}
							break;

						case OperationType.TRANSACTION:
							itemResults = await this.executeTransaction(connection, this, itemIndex);
							break;

						case OperationType.QUEUE:
							itemResults = await this.executeAQOperations(connection, this, itemIndex);
							break;

						default:
							throw new Error(`Unsupported operation type: ${operationType}`);
					}

					returnData.push(...itemResults);

					// Para bulk operations, processar apenas o primeiro item
					if (operationType === OperationType.BULK) {
						break;
					}
				} catch (itemError) {
					const errorMessage = itemError instanceof Error ? itemError.message : String(itemError);
					
					// Adicionar contexto do item ao erro
					throw new NodeOperationError(
						this.getNode(),
						`Error processing item ${itemIndex}: ${errorMessage}`,
						{
							itemIndex,
							description: 'Check your SQL/PL/SQL syntax and parameters',
						},
					);
				}
			}

			// Log de estatísticas
			const mode = isThinModeCredentials(credentials) ? 'thin' : 'thick';
			console.log(`✅ Operation completed in ${mode} mode: ${returnData.length} items returned`);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const mode = isThinModeCredentials(credentials) ? 'thin' : 'thick';

			// Se já é um NodeOperationError, apenas re-lançar
			if (error instanceof NodeOperationError) {
				throw error;
			}

			// Criar novo NodeOperationError com contexto
			throw new NodeOperationError(
				this.getNode(),
				`Oracle Advanced Error (${mode} mode): ${errorMessage}`,
				{
					description: 'Verify your credentials, mode settings, and SQL/PL/SQL commands',
					itemIndex: 0,
				},
			);
		} finally {
			// Limpar recursos
			if (connection) {
				try {
					await connection.close();
					console.log('🔐 Connection closed successfully');
				} catch (closeError) {
					const closeErrorMessage = closeError instanceof Error ? closeError.message : String(closeError);
					console.error(`❌ Failed to close connection: ${closeErrorMessage}`);
				}
			}

			// Pool será fechado automaticamente pelo OracleConnectionPool
			if (pool) {
				console.log('📊 Pool connection returned');
			}
		}

		return this.prepareOutputData(returnData);
	}

	/**
	 * Método para verificar conectividade (usado pelo n8n para teste)
	 */
	async testConnection(this: IExecuteFunctions): Promise<boolean> {
		try {
			const rawCredentials = await this.getCredentials('oracleCredentials');
			const credentials = this.prepareOracleCredentials(rawCredentials);

			await this.initializeOracleClient(credentials);

			const connectionConfig = OracleCredentialsUtils.createConnectionConfig(credentials);
			const oracleConnection = new OracleConnection(credentials, connectionConfig);
			
			const connection = await oracleConnection.getConnection();
			
			// Testar com uma query simples
			const result = await connection.execute('SELECT 1 FROM DUAL');
			await connection.close();

			const mode = isThinModeCredentials(credentials) ? 'thin' : 'thick';
			console.log(`✅ Connection test successful in ${mode} mode`);
			
			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`❌ Connection test failed: ${errorMessage}`);
			return false;
		}
	}

	/**
	 * Método para obter informações do schema (usado para auto-complete)
	 */
	async getSchemaInfo(this: IExecuteFunctions, objectType: 'tables' | 'views' | 'procedures' | 'functions' = 'tables'): Promise<string[]> {
		try {
			const rawCredentials = await this.getCredentials('oracleCredentials');
			const credentials = this.prepareOracleCredentials(rawCredentials);

			await this.initializeOracleClient(credentials);

			const connectionConfig = OracleCredentialsUtils.createConnectionConfig(credentials);
			const oracleConnection = new OracleConnection(credentials, connectionConfig);
			const connection = await oracleConnection.getConnection();

			let query: string;
			switch (objectType) {
				case 'tables':
					query = `
						SELECT table_name 
						FROM user_tables 
						WHERE table_name NOT LIKE 'BIN$%' 
						ORDER BY table_name
					`;
					break;
				case 'views':
					query = `
						SELECT view_name as table_name 
						FROM user_views 
						ORDER BY view_name
					`;
					break;
				case 'procedures':
					query = `
						SELECT object_name as table_name 
						FROM user_objects 
						WHERE object_type = 'PROCEDURE' 
						ORDER BY object_name
					`;
					break;
				case 'functions':
					query = `
						SELECT object_name as table_name 
						FROM user_objects 
						WHERE object_type = 'FUNCTION' 
						ORDER BY object_name
					`;
					break;
				default:
					query = 'SELECT 1 FROM DUAL';
			}

			const result = await connection.execute(query);
			await connection.close();

			return Array.isArray(result.rows) 
				? result.rows.map((row: any) => row.TABLE_NAME || row.table_name)
				: [];
		} catch (error) {
			console.error(`Failed to get schema info: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		}
	}

	/**
	 * Método para validar SQL syntax (básico)
	 */
	private validateSQLSyntax(sql: string, operationType: OperationType): string[] {
		const warnings: string[] = [];
		const sqlUpper = sql.toUpperCase().trim();

		// Validações básicas
		if (!sql.trim()) {
			warnings.push('SQL statement cannot be empty');
			return warnings;
		}

		// Verificar se o tipo de operação condiz com o SQL
		switch (operationType) {
			case OperationType.QUERY:
				if (!sqlUpper.startsWith('SELECT') && 
					!sqlUpper.startsWith('WITH') && 
					!sqlUpper.startsWith('INSERT') && 
					!sqlUpper.startsWith('UPDATE') && 
					!sqlUpper.startsWith('DELETE')) {
					warnings.push('Query operation should start with SELECT, WITH, INSERT, UPDATE, or DELETE');
				}
				break;

			case OperationType.PLSQL:
				if (!sqlUpper.includes('BEGIN') || !sqlUpper.includes('END')) {
					warnings.push('PL/SQL block should contain BEGIN...END structure');
				}
				break;

			case OperationType.TRANSACTION:
				if (!sql.includes(';')) {
					warnings.push('Transaction block should contain multiple statements separated by semicolons');
				}
				break;
		}

		// Verificar parênteses balanceados
		const openParens = (sql.match(/\(/g) || []).length;
		const closeParens = (sql.match(/\)/g) || []).length;
		if (openParens !== closeParens) {
			warnings.push('Unbalanced parentheses in SQL statement');
		}

		// Verificar aspas balanceadas
		const singleQuotes = (sql.match(/'/g) || []).length;
		if (singleQuotes % 2 !== 0) {
			warnings.push('Unbalanced single quotes in SQL statement');
		}

		return warnings;
	}

	/**
	 * Método para logging de performance
	 */
	private logPerformanceMetrics(
		operationType: OperationType,
		executionTime: number,
		rowsProcessed: number,
		credentials: OracleCredentials,
	): void {
		const mode = isThinModeCredentials(credentials) ? 'thin' : 'thick';
		
		console.log(`📊 Performance Metrics:
			Operation: ${operationType}
			Mode: ${mode}
			Execution Time: ${executionTime}ms
			Rows Processed: ${rowsProcessed}
			Throughput: ${rowsProcessed > 0 ? Math.round(rowsProcessed / (executionTime / 1000)) : 0} rows/sec
		`);

		// Log de warning para operações lentas
		if (executionTime > 30000) { // 30 seconds
			console.warn(`⚠️ Slow operation detected: ${executionTime}ms for ${operationType}`);
		}

		// Log de info para operações de alto volume
		if (rowsProcessed > 10000) {
			console.log(`🚀 High volume operation: ${rowsProcessed} rows processed`);
		}
	}

	/**
	 * Método para cleanup de recursos em caso de erro
	 */
	private async cleanupResources(connection?: Connection, pool?: Pool): Promise<void> {
		const cleanupPromises: Promise<void>[] = [];

		if (connection) {
			cleanupPromises.push(
				connection.close().catch((error) => {
					console.error(`Failed to close connection: ${error instanceof Error ? error.message : String(error)}`);
				})
			);
		}

		if (pool) {
			cleanupPromises.push(
				pool.close(0).catch((error) => {
					console.error(`Failed to close pool: ${error instanceof Error ? error.message : String(error)}`);
				})
			);
		}

		await Promise.all(cleanupPromises);
	}

	/**
	 * Método para obter estatísticas de conexão
	 */
	private getConnectionStats(): IDataObject {
		return {
			poolsCreated: OracleConnectionPool.getPoolStats?.()?.poolsCreated || 0,
			activeConnections: OracleConnectionPool.getPoolStats?.()?.activeConnections || 0,
			totalConnections: OracleConnectionPool.getPoolStats?.()?.totalConnections || 0,
			oracleClientMode: oracledb.thin === false ? 'thick' : 'thin',
			oracleClientVersion: oracledb.versionString,
		};
	}
}