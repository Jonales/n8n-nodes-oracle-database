/**
* Oracle Vector Store Node para n8n
* Gerenciamento de vector store usando Oracle Database 23ai
*
* @author Jônatas Meireles Sousa Vieira
* @version 1.1.0
*/

//import { IExecuteFunctions } from "n8n-core";
import {
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
  NodeOperationError,
  IExecuteFunctions,
} from 'n8n-workflow';
import oracledb, { Connection } from 'oracledb';
import { OracleConnectionPool } from './core/connectionPool';

export class OracleVectorStore implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Oracle Vector Store',
    name: 'oracleVectorStore',
    icon: 'file:oracle.svg',
    group: ['transform'],
    version: 1,
    description: 'Gerenciamento de vector store usando Oracle Database 23ai com suporte nativo a vetores',
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
            description: 'Criar tabela e índices para armazenamento de vetores'
          },
          {
            name: 'Add Document',
            value: 'addDocument',
            description: 'Adicionar documento com embedding'
          },
          {
            name: 'Search Similarity',
            value: 'searchSimilarity',
            description: 'Buscar documentos similares usando embeddings'
          },
          {
            name: 'Delete Document',
            value: 'deleteDocument',
            description: 'Remover documento por ID'
          },
          {
            name: 'Update Document',
            value: 'updateDocument',
            description: 'Atualizar documento existente'
          },
          {
            name: 'Get Document',
            value: 'getDocument',
            description: 'Obter documento por ID'
          },
          {
            name: 'List Collections',
            value: 'listCollections',
            description: 'Listar tabelas de vector store'
          },
        ],
        description: 'Operação a ser executada no vector store',
      },
      // Collection Name
      {
        displayName: 'Collection Name',
        name: 'collectionName',
        type: 'string',
        default: 'vector_documents',
        required: true,
        description: 'Nome da tabela para armazenar os documentos vetoriais',
        displayOptions: {
          hide: {
            operation: ['listCollections'],
          },
        },
      },
      // Setup Operation Fields
      {
        displayName: 'Vector Dimension',
        name: 'vectorDimension',
        type: 'number',
        default: 1536,
        required: true,
        description: 'Dimensão dos vetores (ex: 1536 para OpenAI embeddings, 1024 para Google)',
        displayOptions: {
          show: {
            operation: ['setup'],
          },
        },
      },
      // Document Operations Fields
      {
        displayName: 'Document ID',
        name: 'documentId',
        type: 'string',
        default: '',
        required: true,
        description: 'ID único do documento',
        displayOptions: {
          show: {
            operation: ['deleteDocument', 'updateDocument', 'getDocument'],
          },
        },
      },
      // Search Fields
      {
        displayName: 'Search Vector',
        name: 'searchVector',
        type: 'string',
        default: '',
        required: true,
        description: 'Vetor de busca como string JSON array (ex: [0.1, 0.2, 0.3])',
        displayOptions: {
          show: {
            operation: ['searchSimilarity'],
          },
        },
      },
      {
        displayName: 'Limit Results',
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
        displayName: 'Similarity Threshold',
        name: 'threshold',
        type: 'number',
        default: 0.7,
        description: 'Limite mínimo de similaridade (0-1)',
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

    // Validar credenciais
    if (!credentials.user || !credentials.password || !credentials.connectionString) {
      throw new NodeOperationError(
        this.getNode(),
        'Credenciais Oracle incompletas. Verifique user, password e connectionString.'
      );
    }

    const oracleCredentials = {
      user: String(credentials.user),
      password: String(credentials.password),
      connectionString: String(credentials.connectionString),
    };

    let connection: Connection | undefined;
    let returnData: INodeExecutionData[] = [];

    try {
      const pool = await OracleConnectionPool.getPool(oracleCredentials);
      connection = await pool.getConnection();

      const oracleVectorStore = new OracleVectorStore();

      switch (operation) {
        case 'setup':
          returnData = await oracleVectorStore.setupCollection(connection, this);
          break;
        case 'addDocument':
          returnData = await oracleVectorStore.addDocument(connection, this);
          break;
        case 'searchSimilarity':
          returnData = await oracleVectorStore.searchSimilarity(connection, this);
          break;
        case 'deleteDocument':
          returnData = await oracleVectorStore.deleteDocument(connection, this);
          break;
        case 'updateDocument':
          returnData = await oracleVectorStore.updateDocument(connection, this);
          break;
        case 'getDocument':
          returnData = await oracleVectorStore.getDocument(connection, this);
          break;
        case 'listCollections':
          returnData = await oracleVectorStore.listCollections(connection, this);
          break;
        default:
          throw new NodeOperationError(this.getNode(), `Operação "${operation}" não suportada`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new NodeOperationError(this.getNode(), `Oracle Vector Store Error: ${errorMessage}`);
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (error) {
          console.warn('Erro ao fechar conexão:', error);
        }
      }
    }

    return [returnData];
  }

  private async setupCollection(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const vectorDimension = executeFunctions.getNodeParameter('vectorDimension', 0) as number;

    // Validações
    if (!collectionName.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
      throw new Error('Nome da coleção deve conter apenas letras, números e underscore, iniciando com letra');
    }

    if (vectorDimension <= 0 || vectorDimension > 65536) {
      throw new Error('Dimensão do vetor deve estar entre 1 e 65536');
    }

    try {
      // Criar tabela se não existir
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

      // Criar índice vetorial para busca de similaridade
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

      return executeFunctions.helpers.returnJsonArray([
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
        `Erro ao configurar coleção: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async addDocument(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const inputData = executeFunctions.getInputData();

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
        const documentId = documentData.id != null ? String(documentData.id) : String(Date.now() + i);
        const content = documentData.content != null ? String(documentData.content) : '';
        const embedding = documentData.embedding || documentData.vector;

        // Validações
        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Embedding/vector é obrigatório e deve ser um array');
        }

        if (embedding.some(val => typeof val !== 'number' || isNaN(val))) {
          throw new Error('Embedding deve conter apenas números válidos');
        }

        const metadataObj = documentData.metadata && typeof documentData.metadata === 'object'
          ? documentData.metadata
          : {};

        const metadata = JSON.stringify({
          timestamp: new Date().toISOString(),
          nodeId: executeFunctions.getNode().id,
          workflowId: executeFunctions.getWorkflow().id,
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

    return executeFunctions.helpers.returnJsonArray(results);
  }

  private async searchSimilarity(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const searchVectorParam = executeFunctions.getNodeParameter('searchVector', 0) as string;
    const limit = Math.max(1, Math.min(1000, executeFunctions.getNodeParameter('limit', 0) as number)); // Limit entre 1 e 1000
    const threshold = Math.max(0, Math.min(1, executeFunctions.getNodeParameter('threshold', 0) as number)); // Threshold entre 0 e 1
    const distanceMetric = executeFunctions.getNodeParameter('distanceMetric', 0, 'COSINE') as string;

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

      const documents = (result.rows as any[] || []).map(row => ({
        id: row.ID,
        content: row.CONTENT,
        metadata: row.METADATA ? JSON.parse(row.METADATA) : null,
        createdAt: row.CREATED_AT,
        updatedAt: row.UPDATED_AT,
        distance: Number(row.DISTANCE),
        similarity: Number(row.SIMILARITY),
      }));

      return executeFunctions.helpers.returnJsonArray(documents);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao buscar similaridade: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async deleteDocument(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;

    if (!documentId.trim()) {
      throw new Error('Document ID é obrigatório');
    }

    try {
      const deleteSQL = `DELETE FROM ${collectionName} WHERE id = :documentId`;
      const result = await connection.execute(
        deleteSQL,
        { documentId: documentId.trim() },
        { autoCommit: true }
      );

      return executeFunctions.helpers.returnJsonArray([
        {
          success: result.rowsAffected ? result.rowsAffected > 0 : false,
          documentId: documentId.trim(),
          rowsDeleted: result.rowsAffected || 0,
          operation: 'deleteDocument',
          message: result.rowsAffected === 0 ? 'Documento não encontrado' : 'Documento removido com sucesso',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao deletar documento: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async updateDocument(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;
    const inputData = executeFunctions.getInputData();

    if (!documentId.trim()) {
      throw new Error('Document ID é obrigatório');
    }

    if (!inputData || inputData.length === 0) {
      throw new Error('Nenhum dado para atualização fornecido no input');
    }

    const updateData = inputData[0]?.json;
    if (!updateData) {
      throw new Error('Nenhum dado para atualização fornecido no input');
    }

    try {
      const content = updateData.content != null ? String(updateData.content) : null;
      const embedding = updateData.embedding || updateData.vector;
      const metadataObj = updateData.metadata && typeof updateData.metadata === 'object'
        ? updateData.metadata
        : {};

      const metadata = JSON.stringify({
        timestamp: new Date().toISOString(),
        nodeId: executeFunctions.getNode().id,
        workflowId: executeFunctions.getWorkflow().id,
        updated: true,
        ...metadataObj,
      });

      let updateSQL = `UPDATE ${collectionName} SET updated_at = CURRENT_TIMESTAMP`;
      const bindParams: { [key: string]: any } = {};

      if (content !== null) {
        updateSQL += ', content = :content';
        bindParams.content = content;
      }

      if (embedding && Array.isArray(embedding)) {
        if (embedding.some(val => typeof val !== 'number' || isNaN(val))) {
          throw new Error('Embedding deve conter apenas números válidos');
        }

        updateSQL += ', embedding = :embedding';
        bindParams.embedding = { type: oracledb.DB_TYPE_VECTOR, val: embedding };
      }

      updateSQL += ', metadata = :metadata WHERE id = :documentId';
      bindParams.metadata = metadata;
      bindParams.documentId = documentId.trim();

      const result = await connection.execute(updateSQL, bindParams, { autoCommit: true });

      return executeFunctions.helpers.returnJsonArray([
        {
          success: result.rowsAffected ? result.rowsAffected > 0 : false,
          documentId: documentId.trim(),
          rowsUpdated: result.rowsAffected || 0,
          operation: 'updateDocument',
          message: result.rowsAffected === 0 ? 'Documento não encontrado' : 'Documento atualizado com sucesso',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao atualizar documento: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async getDocument(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    const collectionName = executeFunctions.getNodeParameter('collectionName', 0) as string;
    const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;

    if (!documentId.trim()) {
      throw new Error('Document ID é obrigatório');
    }

    try {
      const selectSQL = `
        SELECT id, content, embedding, metadata, created_at, updated_at
        FROM ${collectionName}
        WHERE id = :documentId
      `;

      const result = await connection.execute(
        selectSQL,
        { documentId: documentId.trim() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (!result.rows || result.rows.length === 0) {
        return executeFunctions.helpers.returnJsonArray([
          {
            success: false,
            error: 'Documento não encontrado',
            documentId: documentId.trim(),
          },
        ]);
      }

      const row = result.rows[0] as any;
      const document = {
        success: true,
        id: row.ID,
        content: row.CONTENT,
        embedding: row.EMBEDDING ? Array.from(row.EMBEDDING) : null,
        metadata: row.METADATA ? JSON.parse(row.METADATA) : null,
        createdAt: row.CREATED_AT,
        updatedAt: row.UPDATED_AT,
      };

      return executeFunctions.helpers.returnJsonArray([document]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao obter documento: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async listCollections(
    connection: Connection,
    executeFunctions: IExecuteFunctions
  ): Promise<INodeExecutionData[]> {
    try {
      const listSQL = `
        SELECT
          t.table_name,
          t.created,
          c.column_name,
          c.data_type,
          CASE
            WHEN c.data_type LIKE 'VECTOR%' THEN 'true'
            ELSE 'false'
          END as has_vector_column
        FROM user_tables t
        LEFT JOIN user_tab_columns c ON t.table_name = c.table_name AND c.data_type LIKE 'VECTOR%'
        WHERE EXISTS (
          SELECT 1 FROM user_tab_columns tc
          WHERE tc.table_name = t.table_name
          AND tc.data_type LIKE 'VECTOR%'
        )
        ORDER BY t.table_name
      `;

      const result = await connection.execute(listSQL, {}, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const collections = (result.rows as any[] || []).map(row => ({
        collectionName: row.TABLE_NAME,
        created: row.CREATED,
        vectorColumn: row.COLUMN_NAME,
        dataType: row.DATA_TYPE,
        hasVectorColumn: row.HAS_VECTOR_COLUMN === 'true',
        type: 'vector_store',
      }));

      return executeFunctions.helpers.returnJsonArray(collections);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao listar coleções: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}