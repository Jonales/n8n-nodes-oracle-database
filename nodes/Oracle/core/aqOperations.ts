import oracledb, { Connection } from 'oracledb';

/**
 * Tipos de payload suportados pelo Oracle AQ
 */
export type AQPayloadType = 'TEXT' | 'JSON' | 'RAW' | 'OBJECT';

/**
 * Interface para mensagem Oracle AQ
 */
export interface AQMessage {
	payload: any;
	messageId?: string;
	correlationId?: string;
	delay?: number; // segundos
	expiration?: number; // segundos
	priority?: number; // 1-10 (1 = alta prioridade)
	properties?: Record<string, any>;
}

/**
 * Opções para enfileiramento de mensagens
 */
export interface AQEnqueueOptions {
	visibility?: 'IMMEDIATE' | 'ON_COMMIT';
	deliveryMode?: 'PERSISTENT' | 'BUFFERED';
	transformation?: string;
	sequence?: number;
	payloadType?: AQPayloadType;
	autoCommit?: boolean;
}

/**
 * Opções para desenfileiramento de mensagens
 */
export interface AQDequeueOptions {
	consumerName?: string;
	dequeueMode?: 'BROWSE' | 'LOCKED' | 'REMOVE';
	navigation?: 'FIRST_MESSAGE' | 'NEXT_MESSAGE' | 'NEXT_TRANSACTION';
	visibility?: 'IMMEDIATE' | 'ON_COMMIT';
	waitTime?: number; // segundos
	correlationId?: string;
	condition?: string;
	transformation?: string;
	msgIdToDequeue?: string;
	autoCommit?: boolean;
}

/**
 * Informações da fila Oracle AQ
 */
export interface AQQueueInfo {
	queueName: string;
	queueType: 'NORMAL_QUEUE' | 'EXCEPTION_QUEUE';
	maxRetries: number;
	retryDelay: number;
	retentionTime: number;
	messageCount: number;
	pendingMessages: number;
	queueTable: string;
	owner: string;
	isStarted: boolean;
}

/**
 * Resultado de operação AQ
 */
export interface AQOperationResult {
	success: boolean;
	messageId?: string;
	correlationId?: string;
	enqueueTime?: Date;
	dequeueTime?: Date;
	attemptCount?: number;
	payload?: any;
	error?: string;
	executionTime?: number;
}

/**
 * Resultado de operação em lote
 */
export interface AQBatchResult {
	totalMessages: number;
	successfulMessages: number;
	failedMessages: number;
	results: AQOperationResult[];
	executionTime: number;
	errors: string[];
}

/**
 * Opções para criação de fila
 */
export interface AQCreateQueueOptions {
	maxRetries?: number;
	retryDelay?: number;
	retentionTime?: number;
	comment?: string;
	multipleConsumers?: boolean;
	messageGrouping?: 'NONE' | 'TRANSACTIONAL';
	sortList?: string;
	compatible?: string;
}

/**
 * Configuração para AQ Operations
 */
export interface AQOperationsConfig {
	logLevel?: 'none' | 'info' | 'debug';
	defaultTimeout?: number;
	defaultPayloadType?: AQPayloadType;
	autoCommit?: boolean;
}

/**
 * Oracle Advanced Queuing Operations
 *
 * Classe robusta para gerenciar operações com Oracle Advanced Queuing,
 * incluindo enfileiramento, desenfileiramento, administração de filas
 * e operações em lote com tratamento avançado de erros.
 */
export class AQOperations {
  private connection: Connection;
  private config: AQOperationsConfig;

  constructor(connection: Connection, config: AQOperationsConfig = {}) {
    this.connection = connection;
    this.config = {
      logLevel: config.logLevel ?? 'info',
      defaultTimeout: config.defaultTimeout ?? 30,
      defaultPayloadType: config.defaultPayloadType ?? 'TEXT',
      autoCommit: config.autoCommit ?? true,
    };
  }

  /**
	 * Enfileira uma mensagem na fila Oracle AQ
	 */
  async enqueueMessage(
    queueName: string,
    message: AQMessage,
    options: AQEnqueueOptions = {},
  ): Promise<AQOperationResult> {
    const startTime = Date.now();
    const opts = this.mergeEnqueueOptions(options);

    try {
      this.validateQueueName(queueName);
      this.validateMessage(message);

      const payloadType = opts.payloadType || this.determinePayloadType(message.payload);
      const plsqlBlock = this.buildEnqueuePLSQL(payloadType, opts);

      const binds = this.buildEnqueueBinds(queueName, message, payloadType);
      const result = await this.connection.execute(plsqlBlock, binds);

      if (opts.autoCommit) {
        await this.connection.commit();
      }

      const executionTime = Date.now() - startTime;
      this.log('info', `✅ Mensagem enfileirada em ${queueName} (${executionTime}ms)`);

      return {
        success: true,
        messageId: (result.outBinds as any)?.message_id,
        enqueueTime: (result.outBinds as any)?.enqueue_time,
        correlationId: message.correlationId,
        executionTime,
      };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      const errorMessage = this.formatError(error, 'enfileirar mensagem');

      this.log('info', `❌ Falha ao enfileirar mensagem: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
	 * Desenfileira uma mensagem da fila Oracle AQ
	 */
  async dequeueMessage(
    queueName: string,
    options: AQDequeueOptions = {},
  ): Promise<AQOperationResult> {
    const startTime = Date.now();
    const opts = this.mergeDequeueOptions(options);

    try {
      this.validateQueueName(queueName);

      const plsqlBlock = this.buildDequeuePLSQL(opts);
      const binds = this.buildDequeueBinds(queueName);

      const result = await this.connection.execute(plsqlBlock, binds);
      const outBinds = result.outBinds as any;

      if (opts.autoCommit && outBinds.success === 1) {
        await this.connection.commit();
      }

      const executionTime = Date.now() - startTime;

      if (outBinds.success === 1) {
        this.log('info', `✅ Mensagem desenfileirada de ${queueName} (${executionTime}ms)`);

        return {
          success: true,
          messageId: outBinds.message_id,
          correlationId: outBinds.correlation_id,
          dequeueTime: outBinds.dequeue_time,
          attemptCount: outBinds.attempt_count,
          payload: this.parsePayload(outBinds.payload_text),
          executionTime,
        };
      } else {
        return {
          success: false,
          error: outBinds.error_msg || 'Nenhuma mensagem disponível',
          executionTime,
        };
      }
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      const errorMessage = this.formatError(error, 'desenfileirar mensagem');

      this.log('info', `❌ Falha ao desenfileirar mensagem: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
	 * Enfileira múltiplas mensagens em lote
	 */
  async enqueueBatch(
    queueName: string,
    messages: AQMessage[],
    options: AQEnqueueOptions = {},
  ): Promise<AQBatchResult> {
    const startTime = Date.now();

    if (!messages.length) {
      throw new Error('❌ Lista de mensagens não pode estar vazia');
    }

    this.log('info', `🔄 Iniciando enqueue batch de ${messages.length} mensagens em ${queueName}`);

    const results: AQOperationResult[] = [];
    const errors: string[] = [];
    let successCount = 0;

    // Processar em transação se autoCommit estiver desabilitado
    const useTransaction = !options.autoCommit;

    try {
      if (useTransaction) {
        // Deixar commit manual para o final
        options.autoCommit = false;
      }

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        try {
          const result = await this.enqueueMessage(queueName, message, options);
          results.push(result);

          if (result.success) {
            successCount++;
          } else {
            errors.push(`Mensagem ${i + 1}: ${result.error}`);
          }
        } catch (error: unknown) {
          const errorMessage = this.formatError(error, `processar mensagem ${i + 1}`);
          errors.push(errorMessage);
          results.push({
            success: false,
            error: errorMessage,
          });
        }
      }

      // Commit final se usando transação
      if (useTransaction && successCount > 0) {
        await this.connection.commit();
      }

      const executionTime = Date.now() - startTime;
      this.log(
        'info',
        `✅ Batch concluído: ${successCount}/${messages.length} sucessos (${executionTime}ms)`,
      );

      return {
        totalMessages: messages.length,
        successfulMessages: successCount,
        failedMessages: messages.length - successCount,
        results,
        executionTime,
        errors,
      };
    } catch (error: unknown) {
      if (useTransaction) {
        await this.connection.rollback();
      }
      throw error;
    }
  }

  /**
	 * Desenfileira múltiplas mensagens
	 */
  async dequeueMultiple(
    queueName: string,
    maxMessages = 10,
    options: AQDequeueOptions = {},
  ): Promise<AQBatchResult> {
    const startTime = Date.now();

    this.log('info', `🔄 Iniciando dequeue de até ${maxMessages} mensagens de ${queueName}`);

    const results: AQOperationResult[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let messagesReceived = 0;

    try {
      while (messagesReceived < maxMessages) {
        const dequeueOptions = {
          ...options,
          waitTime: messagesReceived === 0 ? (options.waitTime ?? 5) : 0,
        };

        const result = await this.dequeueMessage(queueName, dequeueOptions);
        results.push(result);

        if (result.success) {
          successCount++;
          messagesReceived++;
        } else {
          // Parar se não houver mais mensagens
          if (
            result.error?.includes('Nenhuma mensagem disponível') ||
						result.error?.includes('no messages')
          ) {
            break;
          }
          errors.push(result.error || 'Erro desconhecido');
          break;
        }
      }

      const executionTime = Date.now() - startTime;
      this.log(
        'info',
        `✅ Dequeue múltiplo concluído: ${successCount} mensagens (${executionTime}ms)`,
      );

      return {
        totalMessages: messagesReceived,
        successfulMessages: successCount,
        failedMessages: results.length - successCount,
        results,
        executionTime,
        errors,
      };
    } catch (error: unknown) {
      throw new Error(this.formatError(error, 'desenfileirar múltiplas mensagens'));
    }
  }

  /**
	 * Obtém informações detalhadas da fila
	 */
  async getQueueInfo(queueName: string): Promise<AQQueueInfo> {
    try {
      this.validateQueueName(queueName);

      const sql = `
        SELECT 
          q.name as queue_name,
          q.queue_type,
          q.max_retries,
          q.retry_delay,
          q.retention_time,
          q.queue_table,
          q.owner,
          NVL(qt.ready, 0) + NVL(qt.waiting, 0) as message_count,
          NVL(qt.ready, 0) as pending_messages
        FROM all_queues q
        LEFT JOIN all_queue_tables qt ON q.queue_table = qt.queue_table AND q.owner = qt.owner
        WHERE UPPER(q.name) = UPPER(:queue_name)
          AND q.owner = USER
      `;

      const result = await this.connection.execute(
        sql,
        { queue_name: queueName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      if (!result.rows || result.rows.length === 0) {
        throw new Error(`❌ Fila '${queueName}' não encontrada ou sem permissão de acesso`);
      }

      const row = result.rows[0] as any;

      return {
        queueName: row.QUEUE_NAME,
        queueType: row.QUEUE_TYPE,
        maxRetries: row.MAX_RETRIES,
        retryDelay: row.RETRY_DELAY,
        retentionTime: row.RETENTION_TIME,
        messageCount: row.MESSAGE_COUNT || 0,
        pendingMessages: row.PENDING_MESSAGES || 0,
        queueTable: row.QUEUE_TABLE,
        owner: row.OWNER,
        isStarted: true, // Assumir que está ativa se encontrada
      };
    } catch (error: unknown) {
      throw new Error(this.formatError(error, 'obter informações da fila'));
    }
  }

  /**
	 * Lista todas as filas disponíveis para o usuário
	 */
  async listQueues(): Promise<string[]> {
    try {
      const sql = `
        SELECT name
        FROM user_queues
        WHERE queue_type = 'NORMAL_QUEUE'
        ORDER BY name
      `;

      const result = await this.connection.execute(
        sql,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows as any[]).map(row => row.NAME);
    } catch (error: unknown) {
      throw new Error(this.formatError(error, 'listar filas'));
    }
  }

  /**
	 * Purga mensagens da fila
	 */
  async purgeQueue(
    queueName: string,
    purgeCondition?: string,
  ): Promise<{ purgedCount: number; success: boolean }> {
    try {
      this.validateQueueName(queueName);

      const plsqlBlock = `
        DECLARE
          purge_options DBMS_AQADM.AQ$_PURGE_OPTIONS_T;
        BEGIN
          ${purgeCondition ? 'purge_options.condition := :purge_condition;' : ''}
          
          DBMS_AQADM.PURGE_QUEUE_TABLE(
            queue_table => (SELECT queue_table FROM user_queues WHERE name = :queue_name),
            purge_condition => ${purgeCondition ? 'purge_options.condition' : 'NULL'}
          );
          
          :result := 'SUCCESS';
        EXCEPTION
          WHEN OTHERS THEN
            :result := SQLERRM;
        END;
      `;

      const binds: any = {
        queue_name: queueName,
        result: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 1000 },
      };

      if (purgeCondition) {
        binds.purge_condition = purgeCondition;
      }

      const result = await this.connection.execute(plsqlBlock, binds);
      const success = (result.outBinds as any)?.result === 'SUCCESS';

      if (success) {
        this.log('info', `✅ Fila ${queueName} purgada com sucesso`);
        return { purgedCount: -1, success: true }; // Oracle não retorna count específico
      } else {
        throw new Error((result.outBinds as any)?.result);
      }
    } catch (error: unknown) {
      throw new Error(this.formatError(error, 'purgar fila'));
    }
  }

  /**
	 * Cria uma nova fila Oracle AQ
	 */
  async createQueue(
    queueName: string,
    queueTableName: string,
    payloadType = 'SYS.AQ$_JMS_TEXT_MESSAGE',
    options: AQCreateQueueOptions = {},
  ): Promise<boolean> {
    try {
      this.validateQueueName(queueName);
      this.validateQueueName(queueTableName);

      const opts = {
        maxRetries: options.maxRetries ?? 5,
        retryDelay: options.retryDelay ?? 0,
        retentionTime: options.retentionTime ?? 0,
        multipleConsumers: options.multipleConsumers ?? true,
        messageGrouping: options.messageGrouping ?? 'NONE',
        sortList: options.sortList ?? 'PRIORITY,ENQ_TIME',
        compatible: options.compatible ?? '10.0.0',
        comment: options.comment,
      };

      const plsqlBlock = `
        BEGIN
          -- Criar queue table se não existir
          BEGIN
            DBMS_AQADM.CREATE_QUEUE_TABLE(
              queue_table => :queue_table_name,
              queue_payload_type => :payload_type,
              sort_list => :sort_list,
              multiple_consumers => ${opts.multipleConsumers ? 'TRUE' : 'FALSE'},
              message_grouping => DBMS_AQADM.${opts.messageGrouping},
              compatible => :compatible
            );
          EXCEPTION
            WHEN OTHERS THEN
              IF SQLCODE != -24001 THEN -- Table already exists
                RAISE;
              END IF;
          END;

          -- Criar queue
          DBMS_AQADM.CREATE_QUEUE(
            queue_name => :queue_name,
            queue_table => :queue_table_name,
            queue_type => DBMS_AQADM.NORMAL_QUEUE,
            max_retries => :max_retries,
            retry_delay => :retry_delay,
            retention_time => :retention_time
            ${opts.comment ? ', comment => :comment' : ''}
          );

          -- Iniciar queue
          DBMS_AQADM.START_QUEUE(queue_name => :queue_name);
          
          :result := 'SUCCESS';
        EXCEPTION
          WHEN OTHERS THEN
            :result := SQLERRM;
        END;
      `;

      const binds: any = {
        queue_name: queueName,
        queue_table_name: queueTableName,
        payload_type: payloadType,
        sort_list: opts.sortList,
        compatible: opts.compatible,
        max_retries: opts.maxRetries,
        retry_delay: opts.retryDelay,
        retention_time: opts.retentionTime,
        result: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 1000 },
      };

      if (opts.comment) {
        binds.comment = opts.comment;
      }

      const result = await this.connection.execute(plsqlBlock, binds);
      const success = (result.outBinds as any)?.result === 'SUCCESS';

      if (success) {
        this.log('info', `✅ Fila ${queueName} criada com sucesso`);
      } else {
        throw new Error((result.outBinds as any)?.result);
      }

      return success;
    } catch (error: unknown) {
      throw new Error(this.formatError(error, 'criar fila'));
    }
  }

  // ===== MÉTODOS PRIVADOS =====

  private mergeEnqueueOptions(options: AQEnqueueOptions): Required<AQEnqueueOptions> {
    return {
      visibility: options.visibility ?? 'ON_COMMIT',
      deliveryMode: options.deliveryMode ?? 'PERSISTENT',
      transformation: options.transformation ?? '',
      sequence: options.sequence ?? 0,
      payloadType: options.payloadType ?? this.config.defaultPayloadType!,
      autoCommit: options.autoCommit ?? this.config.autoCommit!,
    };
  }

  private mergeDequeueOptions(options: AQDequeueOptions): Required<AQDequeueOptions> {
    return {
      consumerName: options.consumerName ?? '',
      dequeueMode: options.dequeueMode ?? 'REMOVE',
      navigation: options.navigation ?? 'FIRST_MESSAGE',
      visibility: options.visibility ?? 'ON_COMMIT',
      waitTime: options.waitTime ?? this.config.defaultTimeout!,
      correlationId: options.correlationId ?? '',
      condition: options.condition ?? '',
      transformation: options.transformation ?? '',
      msgIdToDequeue: options.msgIdToDequeue ?? '',
      autoCommit: options.autoCommit ?? this.config.autoCommit!,
    };
  }

  private validateQueueName(queueName: string): void {
    if (!queueName || queueName.trim().length === 0) {
      throw new Error('❌ Nome da fila não pode estar vazio');
    }
    if (queueName.length > 30) {
      throw new Error('❌ Nome da fila não pode exceder 30 caracteres');
    }
    if (!/^[A-Za-z][A-Za-z0-9_$#]*$/.test(queueName)) {
      throw new Error('❌ Nome da fila contém caracteres inválidos');
    }
  }

  private validateMessage(message: AQMessage): void {
    if (!message || message.payload === undefined) {
      throw new Error('❌ Mensagem deve conter payload');
    }
  }

  private determinePayloadType(payload: any): AQPayloadType {
    if (typeof payload === 'string') {
      try {
        JSON.parse(payload);
        return 'JSON';
      } catch {
        return 'TEXT';
      }
    }
    if (typeof payload === 'object' && payload !== null) {
      return 'JSON';
    }
    return 'RAW';
  }

  private buildEnqueuePLSQL(
    payloadType: AQPayloadType,
    options: Required<AQEnqueueOptions>,
  ): string {
    return `
      DECLARE
        enqueue_options DBMS_AQ.ENQUEUE_OPTIONS_T;
        message_properties DBMS_AQ.MESSAGE_PROPERTIES_T;
        message_handle RAW(16);
        ${this.getPayloadDeclaration(payloadType)}
      BEGIN
        -- Configurar opções de enqueue
        enqueue_options.visibility := DBMS_AQ.${options.visibility};
        enqueue_options.delivery_mode := DBMS_AQ.${options.deliveryMode};
        ${options.sequence ? `enqueue_options.sequence := ${options.sequence};` : ''}
        ${options.transformation ? `enqueue_options.transformation := '${options.transformation}';` : ''}

        -- Configurar propriedades da mensagem
        message_properties.correlation := :correlation_id;
        message_properties.delay := :delay;
        message_properties.expiration := :expiration;
        message_properties.priority := :priority;

        -- Criar payload da mensagem
        :payload_assignment

        -- Enfileirar mensagem
        DBMS_AQ.ENQUEUE(
          queue_name => :queue_name,
          enqueue_options => enqueue_options,
          message_properties => message_properties,
          payload => message_payload,
          msgid => message_handle
        );

        :message_id := RAWTOHEX(message_handle);
        :enqueue_time := SYSTIMESTAMP;
      END;
    `;
  }

  private buildDequeuePLSQL(options: Required<AQDequeueOptions>): string {
    return `
      DECLARE
        dequeue_options DBMS_AQ.DEQUEUE_OPTIONS_T;
        message_properties DBMS_AQ.MESSAGE_PROPERTIES_T;
        message_handle RAW(16);
        message_payload SYS.AQ$_JMS_TEXT_MESSAGE;
        no_messages EXCEPTION;
        PRAGMA EXCEPTION_INIT(no_messages, -25228);
      BEGIN
        -- Configurar opções de dequeue
        dequeue_options.dequeue_mode := DBMS_AQ.${options.dequeueMode};
        dequeue_options.navigation := DBMS_AQ.${options.navigation};
        dequeue_options.visibility := DBMS_AQ.${options.visibility};
        dequeue_options.wait := ${options.waitTime};
        ${options.consumerName ? `dequeue_options.consumer_name := '${options.consumerName}';` : ''}
        ${options.correlationId ? `dequeue_options.correlation := '${options.correlationId}';` : ''}
        ${options.condition ? `dequeue_options.deq_condition := '${options.condition}';` : ''}
        ${options.transformation ? `dequeue_options.transformation := '${options.transformation}';` : ''}
        ${options.msgIdToDequeue ? `dequeue_options.msgid := HEXTORAW('${options.msgIdToDequeue}');` : ''}

        -- Desenfileirar mensagem
        DBMS_AQ.DEQUEUE(
          queue_name => :queue_name,
          dequeue_options => dequeue_options,
          message_properties => message_properties,
          payload => message_payload,
          msgid => message_handle
        );

        :message_id := RAWTOHEX(message_handle);
        :correlation_id := message_properties.correlation;
        :dequeue_time := SYSTIMESTAMP;
        :attempt_count := message_properties.attempts;
        :payload_text := message_payload.get_text();
        :success := 1;
      EXCEPTION
        WHEN no_messages THEN
          :success := 0;
          :error_msg := 'Nenhuma mensagem disponível na fila';
        WHEN OTHERS THEN
          :success := 0;
          :error_msg := SQLERRM;
      END;
    `;
  }

  private buildEnqueueBinds(
    queueName: string,
    message: AQMessage,
    payloadType: AQPayloadType,
  ): any {
    const binds: any = {
      queue_name: queueName,
      correlation_id: message.correlationId || null,
      delay: message.delay || 0,
      expiration: message.expiration || 0,
      priority: message.priority || 1,
      message_id: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32 },
      enqueue_time: { dir: oracledb.BIND_OUT, type: oracledb.DATE },
    };

    // Adicionar payload baseado no tipo
    switch (payloadType) {
    case 'TEXT':
      binds.payload_text = message.payload.toString();
      break;
    case 'JSON':
      binds.payload_text = JSON.stringify(message.payload);
      break;
    case 'RAW':
      binds.payload_raw = message.payload;
      break;
    }

    return binds;
  }

  private buildDequeueBinds(queueName: string): any {
    return {
      queue_name: queueName,
      message_id: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32 },
      correlation_id: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 128 },
      dequeue_time: { dir: oracledb.BIND_OUT, type: oracledb.DATE },
      attempt_count: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      payload_text: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      success: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      error_msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 1000 },
    };
  }

  private getPayloadDeclaration(payloadType: AQPayloadType): string {
    switch (payloadType) {
    case 'TEXT':
    case 'JSON':
      return 'message_payload SYS.AQ$_JMS_TEXT_MESSAGE;';
    case 'RAW':
      return 'message_payload RAW(2000);';
    default:
      return 'message_payload SYS.AQ$_JMS_TEXT_MESSAGE;';
    }
  }

  private parsePayload(payloadText: string): any {
    if (!payloadText) return null;

    try {
      return JSON.parse(payloadText);
    } catch {
      return payloadText;
    }
  }

  private formatError(error: unknown, operation: string): string {
    const message = error instanceof Error ? error.message : String(error);
    return `Erro ao ${operation}: ${message}`;
  }

  private log(level: 'info' | 'debug', message: string): void {
    if (this.config.logLevel === 'none') return;
    if (level === 'debug' && this.config.logLevel !== 'debug') return;

    console.log(`[AQOperations] ${message}`);
  }
}

/**
 * Factory para criar instâncias de AQOperations
 */
export class AQOperationsFactory {
  /**
	 * Cria operador para mensagens de alta frequência
	 */
  static createHighFrequencyOperator(connection: Connection): AQOperations {
    return new AQOperations(connection, {
      logLevel: 'info',
      defaultTimeout: 5,
      autoCommit: true,
    });
  }

  /**
	 * Cria operador para mensagens críticas (com controle manual de transação)
	 */
  static createReliableOperator(connection: Connection): AQOperations {
    return new AQOperations(connection, {
      logLevel: 'debug',
      defaultTimeout: 60,
      autoCommit: false,
    });
  }

  /**
	 * Cria operador para processamento em lote
	 */
  static createBatchOperator(connection: Connection): AQOperations {
    return new AQOperations(connection, {
      logLevel: 'info',
      defaultTimeout: 30,
      autoCommit: false,
    });
  }
}
