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

export class OraclePGVectorStore implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Oracle PG Vector Store',
    name: 'oraclePGVectorStore',
    icon: 'file:oracle.svg',
    group: ['transform'],
    version: 1,
    description:
			'Gerenciamento de vector store usando Oracle Database com PG Vector compatibilidade',
    defaults: {
      name: 'Oracle PG Vector Store',
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
        default: 'addDocument',
        options: [
          { name: 'Setup Collection', value: 'setup' },
          { name: 'Add Document', value: 'addDocument' },
          { name: 'Search Similarity', value: 'searchSimilarity' },
          { name: 'Delete Document', value: 'deleteDocument' },
          { name: 'Update Document', value: 'updateDocument' },
          { name: 'Get Document', value: 'getDocument' },
          { name: 'List Collections', value: 'listCollections' },
        ],
        description: 'Operação a ser executada no vector store',
      },
      {
        displayName: 'Collection Name',
        name: 'collectionName',
        type: 'string',
        default: 'vector_documents',
        description: 'Nome da coleção/tabela para armazenar os documentos vetoriais',
        displayOptions: {
          hide: {
            operation: ['listCollections'],
          },
        },
      },
      {
        displayName: 'Vector Dimension',
        name: 'vectorDimension',
        type: 'number',
        default: 1536,
        description: 'Dimensão dos vetores (ex: 1536 para OpenAI embeddings)',
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
        description: 'ID único do documento',
        displayOptions: {
          show: {
            operation: ['deleteDocument', 'updateDocument', 'getDocument'],
          },
        },
      },
      {
        displayName: 'Search Vector',
        name: 'searchVector',
        type: 'string',
        default: '',
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
    ],
  };

  // ✅ MÉTODO EXECUTE CORRIGIDO
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('oracleCredentials');
    const operation = this.getNodeParameter('operation', 0) as string;
    const collectionName = this.getNodeParameter('collectionName', 0) as string;

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

      // ✅ CORREÇÃO: Criar instância da classe para acessar métodos
      const vectorStoreInstance = new OraclePGVectorStore();

      switch (operation) {
      case 'setup':
        returnData = await vectorStoreInstance.setupCollection(connection, collectionName, this);
        break;
      case 'addDocument':
        returnData = await vectorStoreInstance.addDocument(connection, collectionName, this);
        break;
      case 'searchSimilarity':
        returnData = await vectorStoreInstance.searchSimilarity(connection, collectionName, this);
        break;
      case 'deleteDocument':
        returnData = await vectorStoreInstance.deleteDocument(connection, collectionName, this);
        break;
      case 'updateDocument':
        returnData = await vectorStoreInstance.updateDocument(connection, collectionName, this);
        break;
      case 'getDocument':
        returnData = await vectorStoreInstance.getDocument(connection, collectionName, this);
        break;
      case 'listCollections':
        returnData = await vectorStoreInstance.listCollections(connection, this);
        break;
      default:
        throw new NodeOperationError(this.getNode(), `Operação "${operation}" não suportada`);
      }
    } catch (error) {
      throw new NodeOperationError(this.getNode(), `Vector Store Error: ${error}`);
    } finally {
      if (connection) {
        await connection.close();
      }
    }

    // ✅ RETORNO CORRIGIDO: Array de arrays
    return [returnData];
  }

  // ✅ MÉTODOS PRIVADOS DA CLASSE COM CORREÇÕES
  private async setupCollection(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const vectorDimension = executeFunctions.getNodeParameter('vectorDimension', 0) as number;

      // Criar tabela se não existir (Oracle 23ai com suporte a VECTOR)
      const createTableSQL = `
        BEGIN
          EXECUTE IMMEDIATE '
            CREATE TABLE ${collectionName} (
              id VARCHAR2(255) PRIMARY KEY,
              content CLOB NOT NULL,
              embedding VECTOR(${vectorDimension}, FLOAT32),
              metadata CLOB,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          ';
          DBMS_OUTPUT.PUT_LINE('Tabela ${collectionName} criada com sucesso');
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE = -955 THEN
              DBMS_OUTPUT.PUT_LINE('Tabela ${collectionName} já existe');
            ELSE
              RAISE;
            END IF;
        END;
      `;

      await connection.execute(createTableSQL);

      // Criar índice vetorial para busca de similaridade
      const createIndexSQL = `
        BEGIN
          EXECUTE IMMEDIATE 'CREATE VECTOR INDEX idx_${collectionName}_embedding ON ${collectionName}(embedding) 
            ORGANIZATION NEIGHBOR PARTITIONS 
            DISTANCE COSINE 
            WITH TARGET ACCURACY 95';
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE != -955 THEN
              RAISE;
            END IF;
        END;
      `;

      await connection.execute(createIndexSQL);
      await connection.commit();

      return executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          message: `Coleção ${collectionName} configurada com sucesso`,
          vectorDimension,
          operation: 'setup',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao configurar coleção: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async addDocument(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const inputData = executeFunctions.getInputData();
      const documentData = inputData[0]?.json;

      if (!documentData) {
        throw new Error('Nenhum dado de documento fornecido no input');
      }

      const documentId = documentData.id != null ? String(documentData.id) : String(Date.now());
      const content = documentData.content != null ? String(documentData.content) : '';
      const embedding = documentData.embedding || documentData.vector;

      const metadataObj =
				documentData && typeof documentData.metadata === 'object' && documentData.metadata !== null
				  ? documentData.metadata
				  : {};

      const metadata = JSON.stringify({
        timestamp: new Date().toISOString(),
        nodeId: executeFunctions.getNode().id,
        ...metadataObj,
      });

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Embedding/vector é obrigatório e deve ser um array');
      }

      const insertSQL = `
        INSERT INTO ${collectionName} (id, content, embedding, metadata)
        VALUES (:id, :content, :embedding, :metadata)
      `;

      const bindParams = {
        id: String(documentId),
        content: String(content),
        embedding: { type: oracledb.DB_TYPE_VECTOR, val: embedding },
        metadata: String(metadata),
      };

      const result = await connection.execute(insertSQL, bindParams, {
        autoCommit: true,
      });

      return executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          documentId: String(documentId),
          content: String(content),
          embeddingDimension: embedding.length,
          rowsAffected: result.rowsAffected,
          operation: 'addDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao adicionar documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async searchSimilarity(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const searchVectorParam = executeFunctions.getNodeParameter('searchVector', 0) as string;
      const limit = executeFunctions.getNodeParameter('limit', 0) as number;
      const threshold = executeFunctions.getNodeParameter('threshold', 0) as number;

      let searchVector: number[];
      try {
        searchVector = JSON.parse(searchVectorParam);
      } catch {
        throw new Error('Search vector deve ser um JSON array válido');
      }

      if (!Array.isArray(searchVector)) {
        throw new Error('Search vector deve ser um array de números');
      }

      // ✅ CORREÇÃO: Query SQL única e correta
      const searchSQL = `
        SELECT 
          id,
          content,
          metadata,
          created_at,
          VECTOR_DISTANCE(embedding, :searchVector, COSINE) as distance,
          (1 - VECTOR_DISTANCE(embedding, :searchVector, COSINE)) as similarity
        FROM ${collectionName} 
        WHERE (1 - VECTOR_DISTANCE(embedding, :searchVector, COSINE)) >= :threshold
        ORDER BY similarity DESC
        FETCH FIRST :limit ROWS ONLY
      `;

      const bindParams = {
        searchVector: { type: oracledb.DB_TYPE_VECTOR, val: searchVector },
        threshold: Number(threshold),
        limit: Number(limit),
      };

      // ✅ CORREÇÃO: Uma única query execute
      const result = await connection.execute(searchSQL, bindParams, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const documents = (result.rows as any[]).map(row => ({
        id: row.ID,
        content: row.CONTENT,
        metadata: row.METADATA ? JSON.parse(row.METADATA) : null,
        createdAt: row.CREATED_AT,
        distance: row.DISTANCE,
        similarity: row.SIMILARITY,
      }));

      return executeFunctions.helpers.returnJsonArray(documents);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao buscar similaridade: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async deleteDocument(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;

      const deleteSQL = `DELETE FROM ${collectionName} WHERE id = :documentId`;

      // ✅ CORREÇÃO: Garantir tipo string
      const result = await connection.execute(
        deleteSQL,
        {
          documentId: String(documentId),
        },
        {
          autoCommit: true,
        },
      );

      return executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          documentId: String(documentId),
          rowsDeleted: result.rowsAffected,
          operation: 'deleteDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao deletar documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async updateDocument(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;
      const inputData = executeFunctions.getInputData();
      const updateData = inputData[0]?.json;

      if (!updateData) {
        throw new Error('Nenhum dado para atualização fornecido no input');
      }

      // ✅ CORREÇÃO: Garantir tipos string e tratamento seguro de metadata
      const content = updateData.content != null ? String(updateData.content) : null;
      const embedding = updateData.embedding || updateData.vector;

      const metadataObj =
				updateData && typeof updateData.metadata === 'object' && updateData.metadata !== null
				  ? updateData.metadata
				  : {};

      const metadata = JSON.stringify({
        timestamp: new Date().toISOString(),
        nodeId: executeFunctions.getNode().id,
        updated: true,
        ...metadataObj,
      });

      let updateSQL = `UPDATE ${collectionName} SET updated_at = CURRENT_TIMESTAMP`;
      const bindParams: { [key: string]: any } = {};

      if (content !== null) {
        updateSQL += ', content = :content';
        bindParams.content = String(content);
      }

      if (embedding && Array.isArray(embedding)) {
        updateSQL += ', embedding = :embedding';
        bindParams.embedding = embedding;
      }

      updateSQL += ', metadata = :metadata WHERE id = :documentId';
      bindParams.metadata = String(metadata);
      bindParams.documentId = String(documentId);

      const result = await connection.execute(updateSQL, bindParams, {
        autoCommit: true,
      });

      return executeFunctions.helpers.returnJsonArray([
        {
          success: true,
          documentId: String(documentId),
          rowsUpdated: result.rowsAffected,
          operation: 'updateDocument',
        },
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao atualizar documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getDocument(
    connection: Connection,
    collectionName: string,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const documentId = executeFunctions.getNodeParameter('documentId', 0) as string;

      const selectSQL = `
        SELECT id, content, embedding, metadata, created_at, updated_at
        FROM ${collectionName} 
        WHERE id = :documentId
      `;

      // ✅ CORREÇÃO: Garantir tipo string
      const result = await connection.execute(
        selectSQL,
        {
          documentId: String(documentId),
        },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      if (!result.rows || result.rows.length === 0) {
        return executeFunctions.helpers.returnJsonArray([
          {
            success: false,
            error: 'Documento não encontrado',
            documentId: String(documentId),
          },
        ]);
      }

      const row = result.rows[0] as any;
      const document = {
        id: row.ID,
        content: row.CONTENT,
        embedding: Array.from(row.EMBEDDING || []), // Convert to array if needed
        metadata: row.METADATA ? JSON.parse(row.METADATA) : null,
        createdAt: row.CREATED_AT,
        updatedAt: row.UPDATED_AT,
      };

      return executeFunctions.helpers.returnJsonArray([document]);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao obter documento: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async listCollections(
    connection: Connection,
    executeFunctions: IExecuteFunctions,
  ): Promise<INodeExecutionData[]> {
    try {
      const listSQL = `
        SELECT table_name
        FROM user_tables 
        WHERE table_name LIKE '%VECTOR%' OR table_name LIKE '%EMBEDDING%'
        ORDER BY table_name
      `;

      const result = await connection.execute(
        listSQL,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      const collections = (result.rows as any[]).map(row => ({
        collectionName: row.TABLE_NAME,
        type: 'vector_store',
      }));

      return executeFunctions.helpers.returnJsonArray(collections);
    } catch (error: unknown) {
      throw new Error(
        `Erro ao listar coleções: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
