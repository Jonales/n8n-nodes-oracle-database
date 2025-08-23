import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
  NodeOperationError,
} from 'n8n-workflow';
import oracledb, { Connection } from 'oracledb';
import { OracleConnectionPool } from './core/connectionPool';

export class OracleVectorStoreOperations {
  private executeFunctions: IExecuteFunctions;

  constructor(executeFunctions: IExecuteFunctions) {
    this.executeFunctions = executeFunctions;
  }

  async setupCollection(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const vectorDimension = this.executeFunctions.getNodeParameter('vectorDimension', 0) as number;

    if (!collectionName.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
      throw new Error(
        'Nome da coleção deve conter apenas letras, números e underscore, iniciando com letra',
      );
    }

    if (vectorDimension <= 0 || vectorDimension > 65536) {
      throw new Error('Dimensão do vetor deve estar entre 1 e 65536');
    }

    try {
      const createTableSQL = `
        DECLARE
          table_exists NUMBER;
        BEGIN
          SELECT COUNT(*) INTO table_exists FROM user_tables WHERE table_name = UPPER('${collectionName}');
          IF table_exists = 0 THEN
            EXECUTE IMMEDIATE '
              CREATE TABLE ${collectionName} (
                id VARCHAR2(255) PRIMARY KEY,
                content CLOB NOT NULL,
                embedding VECTOR(${vectorDimension}, FLOAT32),
                metadata CLOB CHECK (metadata IS JSON),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )
            ';
            DBMS_OUTPUT.PUT_LINE('Tabela ${collectionName} criada com sucesso');
          ELSE
            DBMS_OUTPUT.PUT_LINE('Tabela ${collectionName} já existe');
          END IF;
        END;
      `;

      await connection.execute(createTableSQL);

      const createIndexSQL = `
        DECLARE
          index_exists NUMBER;
        BEGIN
          SELECT COUNT(*) INTO index_exists
          FROM user_indexes
          WHERE index_name = UPPER('idx_${collectionName}_embedding');
          IF index_exists = 0 THEN
            EXECUTE IMMEDIATE '
              CREATE VECTOR INDEX idx_${collectionName}_embedding
              ON ${collectionName}(embedding)
              ORGANIZATION NEIGHBOR PARTITIONS
              DISTANCE COSINE
              WITH TARGET ACCURACY 95
            ';
            DBMS_OUTPUT.PUT_LINE('Índice vetorial criado com sucesso');
          ELSE
            DBMS_OUTPUT.PUT_LINE('Índice vetorial já existe');
          END IF;
        END;
      `;

      await connection.execute(createIndexSQL);
      await connection.commit();

      return this.executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          message: `Coleção ${collectionName} configurada com sucesso`,
          collectionName,
          vectorDimension,
          operation: 'setup',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao configurar coleção: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async addDocument(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const inputData = this.executeFunctions.getInputData();

    if (!inputData || inputData.length === 0) {
      throw new Error('Nenhum dado de entrada fornecido');
    }

    const results: any[] = [];
    for (let i = 0; i < inputData.length; i++) {
      const documentData = inputData[i]?.json;

      if (!documentData) {
        results.push({
          success: false,
          error: `Item ${i}: Nenhum dado de documento fornecido`,
          index: i,
        });
        continue;
      }

      try {
        const documentId =
          documentData.id != null ? String(documentData.id) : String(Date.now() + i);
        const content = documentData.content != null ? String(documentData.content) : '';
        const embedding = documentData.embedding || documentData.vector;

        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Embedding/vector é obrigatório e deve ser um array');
        }

        if (embedding.some(val => typeof val !== 'number' || isNaN(val))) {
          throw new Error('Embedding deve conter apenas números válidos');
        }

        const metadataObj =
          documentData.metadata && typeof documentData.metadata === 'object'
            ? documentData.metadata
            : {};

        const metadata = JSON.stringify({
          timestamp: new Date().toISOString(),
          nodeId: this.executeFunctions.getNode().id,
          workflowId: this.executeFunctions.getWorkflow().id,
          ...metadataObj,
        });

        const insertSQL = `
          INSERT INTO ${collectionName} (id, content, embedding, metadata)
          VALUES (:id, :content, :embedding, :metadata)
        `;

        const bindParams = {
          id: documentId,
          content: content,
          embedding: { type: oracledb.DB_TYPE_VECTOR, val: embedding },
          metadata: metadata,
        };

        const result = await connection.execute(insertSQL, bindParams, { autoCommit: true });

        results.push({
          success: true,
          documentId,
          content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
          embeddingDimension: embedding.length,
          rowsAffected: result.rowsAffected,
          operation: 'addDocument',
          index: i,
        });
      } catch (error: unknown) {
        results.push({
          success: false,
          error: `Item ${i}: ${error instanceof Error ? error.message : String(error)}`,
          index: i,
        });
      }
    }

    return this.executeFunctions.helpers.returnJsonArray(results);
  }

  async searchSimilarity(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const searchVectorParam = this.executeFunctions.getNodeParameter('searchVector', 0) as string;
    const limit = Math.max(
      1,
      Math.min(1000, this.executeFunctions.getNodeParameter('limit', 0) as number),
    );
    const threshold = Math.max(
      0,
      Math.min(1, this.executeFunctions.getNodeParameter('threshold', 0) as number),
    );
    const distanceMetric = this.executeFunctions.getNodeParameter(
      'distanceMetric',
      0,
      'COSINE',
    ) as string;

    let searchVector: number[];
    try {
      searchVector = JSON.parse(searchVectorParam);
    } catch {
      throw new Error('Search vector deve ser um JSON array válido');
    }

    if (!Array.isArray(searchVector) || searchVector.length === 0) {
      throw new Error('Search vector deve ser um array de números não vazio');
    }

    if (searchVector.some(val => typeof val !== 'number' || isNaN(val))) {
      throw new Error('Search vector deve conter apenas números válidos');
    }

    try {
      const searchSQL = `
        SELECT
          id,
          content,
          metadata,
          created_at,
          updated_at,
          VECTOR_DISTANCE(embedding, :searchVector, ${distanceMetric}) as distance,
          (1 - VECTOR_DISTANCE(embedding, :searchVector, ${distanceMetric})) as similarity
        FROM ${collectionName}
        WHERE (1 - VECTOR_DISTANCE(embedding, :searchVector, ${distanceMetric})) >= :threshold
        ORDER BY similarity DESC
        FETCH FIRST :limit ROWS ONLY
      `;

      const bindParams = {
        searchVector: { type: oracledb.DB_TYPE_VECTOR, val: searchVector },
        threshold: threshold,
        limit: limit,
      };

      const result = await connection.execute(searchSQL, bindParams, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const documents = ((result.rows as any[]) || []).map(row => ({
        id: row.ID,
        content: row.CONTENT,
        metadata: row.METADATA ? JSON.parse(row.METADATA) : null,
        createdAt: row.CREATED_AT,
        updatedAt: row.UPDATED_AT,
        distance: Number(row.DISTANCE),
        similarity: Number(row.SIMILARITY),
      }));

      return this.executeFunctions.helpers.returnJsonArray(documents);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao buscar similaridade: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteDocument(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = this.executeFunctions.getNodeParameter('documentId', 0) as string;

    try {
      const deleteSQL = `DELETE FROM ${collectionName} WHERE id = :documentId`;
      const result = await connection.execute(deleteSQL, { documentId }, { autoCommit: true });

      return this.executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          documentId,
          rowsAffected: result.rowsAffected,
          operation: 'deleteDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao deletar documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateDocument(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = this.executeFunctions.getNodeParameter('documentId', 0) as string;
    const inputData = this.executeFunctions.getInputData();

    if (!inputData || inputData.length === 0) {
      throw new Error('Nenhum dado de entrada fornecido para atualização');
    }

    const documentData = inputData[0]?.json;
    if (!documentData) {
      throw new Error('Nenhum dado de documento fornecido para atualização');
    }

    try {
      const content = documentData.content != null ? String(documentData.content) : undefined;
      const embedding = documentData.embedding || documentData.vector;
      const metadataObj =
        documentData.metadata && typeof documentData.metadata === 'object'
          ? documentData.metadata
          : undefined;

      if (!content && !embedding && !metadataObj) {
        throw new Error('Pelo menos um campo (content, embedding, metadata) deve ser fornecido para atualização');
      }

      const updateFields: string[] = [];
      const bindParams: { [key: string]: any } = { documentId };

      if (content !== undefined) {
        updateFields.push('content = :content');
        bindParams.content = content;
      }
      if (embedding !== undefined) {
        if (!Array.isArray(embedding) || embedding.some(val => typeof val !== 'number' || isNaN(val))) {
          throw new Error('Embedding deve ser um array de números válidos para atualização');
        }
        updateFields.push('embedding = :embedding');
        bindParams.embedding = { type: oracledb.DB_TYPE_VECTOR, val: embedding };
      }
      if (metadataObj !== undefined) {
        updateFields.push('metadata = :metadata');
        bindParams.metadata = JSON.stringify(metadataObj);
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP');

      const updateSQL = `UPDATE ${collectionName} SET ${updateFields.join(', ')} WHERE id = :documentId`;

      const result = await connection.execute(updateSQL, bindParams, { autoCommit: true });

      return this.executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          documentId,
          rowsAffected: result.rowsAffected,
          operation: 'updateDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao atualizar documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getDocument(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    const collectionName = this.executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = this.executeFunctions.getNodeParameter('documentId', 0) as string;

    try {
      const selectSQL = `
        SELECT id, content, embedding, metadata, created_at, updated_at
        FROM ${collectionName}
        WHERE id = :documentId
      `;

      const result = await connection.execute(selectSQL, { documentId }, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const document = result.rows?.[0] as any;

      if (!document) {
        return this.executeFunctions.helpers.returnJsonArray([
          {
            success: false,
            message: `Documento com ID ${documentId} não encontrado`,
            operation: 'getDocument',
          },
        ]);
      }

      return this.executeFunctions.helpers.returnJsonArray([
        {
          id: document.ID,
          content: document.CONTENT,
          embedding: document.EMBEDDING ? JSON.parse(document.EMBEDDING) : null,
          metadata: document.METADATA ? JSON.parse(document.METADATA) : null,
          createdAt: document.CREATED_AT,
          updatedAt: document.UPDATED_AT,
          operation: 'getDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao obter documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async listCollections(
    connection: Connection,
  ): Promise<INodeExecutionData[]> {
    try {
      const selectSQL = `
        SELECT table_name
        FROM user_tables
        WHERE table_name LIKE 'VECTOR_%'
        ORDER BY table_name
      `;

      const result = await connection.execute(selectSQL, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const collections = ((result.rows as any[]) || []).map(row => ({
        name: row.TABLE_NAME,
      }));

      return this.executeFunctions.helpers.returnJsonArray(collections);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao listar coleções: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export class OracleVectorStore implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Oracle Vector Store',
    name: 'oracleVectorStore',
    icon: 'file:oracle.svg',
    group: ['transform'],
    version: 1,
    description:
      'Gerenciamento de vector store usando Oracle Database 23ai com suporte nativo a vetores',
    defaults: {
      name: 'Oracle Vector Store',
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
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'addDocument',
        options: [
          {
            name: 'Setup Collection',
            value: 'setup',
            description: 'Criar tabela e índices para armazenamento de vetores',
          },
          {
            name: 'Add Document',
            value: 'addDocument',
            description: 'Adicionar documento com embedding',
          },
          {
            name: 'Search Similarity',
            value: 'searchSimilarity',
            description: 'Buscar documentos similares usando embeddings',
          },
          {
            name: 'Delete Document',
            value: 'deleteDocument',
            description: 'Remover documento por ID',
          },
          {
            name: 'Update Document',
            value: 'updateDocument',
            description: 'Atualizar documento existente',
          },
          {
            name: 'Get Document',
            value: 'getDocument',
            description: 'Obter documento por ID',
          },
          {
            name: 'List Collections',
            value: 'listCollections',
            description: 'Listar tabelas de vector store',
          },
        ],
        description: 'Operação a ser executada no vector store',
      },
      {
        displayName: 'Collection Name',
        name: 'collectionName',
        type: 'string',
        default: 'VECTOR_STORE',
        description: 'Nome da coleção (tabela) no banco de dados Oracle',
      },
      {
        displayName: 'Vector Dimension',
        name: 'vectorDimension',
        type: 'number',
        default: 1536,
        description: 'Dimensão do vetor (número de elementos no embedding)',
        displayOptions: {
          show: {
            operation: ['setup'],
          },
        },
      },
      {
        displayName: 'Document ID',
        name: 'documentId',
        type: 'string',
        default: '',
        description: 'ID do documento a ser operado',
        displayOptions: {
          show: {
            operation: ['deleteDocument', 'updateDocument', 'getDocument'],
          },
        },
      },
      {
        displayName: 'Search Vector (JSON Array)',
        name: 'searchVector',
        type: 'string',
        default: '[0.1, 0.2, 0.3]',
        description: 'Vetor de busca no formato JSON array (ex: [0.1, 0.2, 0.3])',
        displayOptions: {
          show: {
            operation: ['searchSimilarity'],
          },
        },
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 10,
        description: 'Número máximo de resultados a retornar',
        displayOptions: {
          show: {
            operation: ['searchSimilarity'],
          },
        },
      },
      {
        displayName: 'Threshold',
        name: 'threshold',
        type: 'number',
        default: 0.7,
        description: 'Limiar de similaridade (0.0 a 1.0)',
        displayOptions: {
          show: {
            operation: ['searchSimilarity'],
          },
        },
      },
      {
        displayName: 'Distance Metric',
        name: 'distanceMetric',
        type: 'options',
        default: 'COSINE',
        options: [
          { name: 'Cosine', value: 'COSINE' },
          { name: 'Euclidean', value: 'EUCLIDEAN' },
          { name: 'Dot Product', value: 'DOT' },
        ],
        description: 'Métrica de distância para busca de similaridade',
        displayOptions: {
          show: {
            operation: ['searchSimilarity'],
          },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('oracleCredentials');
    const operation = this.getNodeParameter('operation', 0) as string;

    const oracleCredentials = {
      user: String(credentials.user),
      password: String(credentials.password),
      connectionString: String(credentials.connectionString),
      thinMode: Boolean(credentials.thinMode),
    };

    let connection: Connection | undefined;
    let returnData: INodeExecutionData[] = [];
    const vectorStoreOps = new OracleVectorStoreOperations(this);

    try {
      const pool = await OracleConnectionPool.getPool(oracleCredentials);
      connection = await pool.getConnection();

      switch (operation) {
      case 'setup':
        returnData = await vectorStoreOps.setupCollection(connection);
        break;
      case 'addDocument':
        returnData = await vectorStoreOps.addDocument(connection);
        break;
      case 'searchSimilarity':
        returnData = await vectorStoreOps.searchSimilarity(connection);
        break;
      case 'deleteDocument':
        returnData = await vectorStoreOps.deleteDocument(connection);
        break;
      case 'updateDocument':
        returnData = await vectorStoreOps.updateDocument(connection);
        break;
      case 'getDocument':
        returnData = await vectorStoreOps.getDocument(connection);
        break;
      case 'listCollections':
        returnData = await vectorStoreOps.listCollections(connection);
        break;
      default:
        throw new NodeOperationError(this.getNode(), `Operação "${operation}" não suportada`);
      }
    } catch (error) {
      throw new NodeOperationError(this.getNode(), `Oracle Vector Store Error: ${error}`);
    } finally {
      if (connection) {
        await connection.close();
      }
    }

    return [returnData];
  }
}


