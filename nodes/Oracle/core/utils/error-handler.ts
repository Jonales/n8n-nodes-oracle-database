/**
* Utilitários para error handling padronizado
* Oracle Database N8N Nodes
*
* @author Jônatas Meireles Sousa Vieira
* @version 1.0.0
*/

/**
 * Formatar erro de forma consistente
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Formatar erro com contexto adicional
 */
export function formatErrorWithContext(error: unknown, context: string): string {
  const errorMessage = formatError(error);
  return `${context}: ${errorMessage}`;
}

/**
 * Verificar se erro é relacionado à conexão Oracle
 */
export function isOracleConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const connectionErrors = [
    'ORA-12154', // TNS:could not resolve the connect identifier specified
    'ORA-12505', // TNS:listener does not currently know of SID given in connect descriptor
    'ORA-12541', // TNS:no listener
    'ORA-01017', // invalid username/password; logon denied
    'ORA-28040', // No matching authentication protocol
    'DPI-1047',  // Oracle Client libraries not found
    'DPI-1072',  // Oracle Client already initialized
  ];
  
  return connectionErrors.some(code => error.message.includes(code));
}

/**
 * Verificar se erro é passível de retry
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const retryableErrors = [
    'ORA-00060', // Deadlock detected
    'ORA-08177', // Serialization failure
    'ORA-00054', // Resource busy
    'ORA-30006', // Resource busy; acquire with NOWAIT specified
    'ETIMEDOUT',  // Network timeout
    'ECONNRESET', // Connection reset
  ];
  
  return retryableErrors.some(code => error.message.includes(code));
}

/**
 * Criar mensagem de erro detalhada para conexão Oracle
 */
export function createConnectionErrorMessage(error: unknown, mode: 'thin' | 'thick'): string {
  const baseError = formatError(error);
  
  if (mode === 'thick') {
    return `Falha na conexão em modo THICK: ${baseError}\n` +
      'Verifique:\n' +
      '- Oracle Client está funcionando corretamente\n' +
      '- TNS names está configurado (se usando TNS)\n' +
      '- Credenciais e string de conexão\n' +
      '- Conectividade de rede com o banco Oracle\n' +
      '- Execute: node script/test-connection.js';
  } else {
    return `Falha na conexão em modo THIN: ${baseError}\n` +
      'Verifique:\n' +
      '- String de conexão está correta\n' +
      '- Credenciais estão válidas\n' +
      '- Conectividade de rede com o banco Oracle\n' +
      '- Firewall não está bloqueando a porta do Oracle';
  }
}

/**
 * Classe para padronização de error handling
 */
export class OracleErrorHandler {
  /**
   * Log de erro com nível controlado
   */
  static logError(level: 'info' | 'debug' | 'error', message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorDetails = error ? `\nDetalhes: ${formatError(error)}` : '';
    
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${errorDetails}`;
    
    switch (level) {
      case 'error':
        console.error(logMessage);
        break;
      case 'debug':
        console.debug(logMessage);
        break;
      default:
        console.log(logMessage);
    }
  }

  /**
   * Wrap função com error handling padronizado
   */
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    operationName: string,
    retryOptions?: {
      maxRetries?: number;
      retryDelay?: number;
    }
  ): Promise<T> {
    const { maxRetries = 0, retryDelay = 1000 } = retryOptions || {};
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries + 1 || !isRetryableError(error)) {
          this.logError('error', `Operação '${operationName}' falhou após ${attempt} tentativa(s)`, error);
          throw error;
        }

        this.logError('info', `${operationName} falhou (tentativa ${attempt}). Tentando novamente em ${retryDelay}ms...`, error);
        await this.sleep(retryDelay);
      }
    }

    throw lastError;
  }

  /**
   * Utilitário para sleep
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup de conexão com error handling
   */
  static async safeConnectionClose(
    connection: any,
    context: string = 'conexão'
  ): Promise<void> {
    if (connection) {
      try {
        await connection.close();
        this.logError('debug', `${context} fechada com sucesso`);
      } catch (error) {
        this.logError('error', `Erro ao fechar ${context}`, error);
        // Não propagar erro de cleanup
      }
    }
  }

  /**
   * Validar credenciais Oracle
   */
  static validateCredentials(credentials: any): void {
    const required = ['user', 'password', 'connectionString'];
    const missing = required.filter(field => !credentials[field]);
    
    if (missing.length > 0) {
      throw new Error(
        `Credenciais Oracle incompletas. Campos obrigatórios ausentes: ${missing.join(', ')}`
      );
    }
  }

  /**
   * Criar erro padronizado do N8N
   */
  static createNodeError(node: any, error: unknown, context?: string): Error {
    const errorMessage = context 
      ? formatErrorWithContext(error, context)
      : formatError(error);
    
    // Se estiver usando n8n-workflow, criar NodeOperationError
    if (typeof (global as any).NodeOperationError === 'function') {
      return new (global as any).NodeOperationError(node, errorMessage);
    }
    
    // Fallback para Error padrão
    return new Error(errorMessage);
  }
}

/**
 * Decorator para métodos que precisam de error handling
 */
export function withOracleErrorHandling(operationName: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        const errorMessage = formatErrorWithContext(error, operationName);
        OracleErrorHandler.logError('error', `Método ${propertyKey} falhou`, error);
        throw new Error(errorMessage);
      }
    };

    return descriptor;
  };
}

/**
 * Constantes de erro Oracle comuns
 */
export const ORACLE_ERROR_CODES = {
  // Conexão
  TNS_COULD_NOT_RESOLVE: 'ORA-12154',
  TNS_LISTENER_NOT_KNOW_SID: 'ORA-12505', 
  TNS_NO_LISTENER: 'ORA-12541',
  INVALID_USERNAME_PASSWORD: 'ORA-01017',
  NO_MATCHING_AUTH_PROTOCOL: 'ORA-28040',
  CLIENT_LIBRARIES_NOT_FOUND: 'DPI-1047',
  CLIENT_ALREADY_INITIALIZED: 'DPI-1072',
  
  // Transação
  DEADLOCK_DETECTED: 'ORA-00060',
  SERIALIZATION_FAILURE: 'ORA-08177',
  RESOURCE_BUSY: 'ORA-00054',
  RESOURCE_BUSY_NOWAIT: 'ORA-30006',
  
  // SQL
  TABLE_NOT_EXISTS: 'ORA-00942',
  COLUMN_NOT_EXISTS: 'ORA-00904',
  INVALID_SQL: 'ORA-00900',
  
  // PL/SQL
  PLSQL_COMPILATION_ERROR: 'PLS-00103',
  PLSQL_NUMERIC_ERROR: 'ORA-06502',
} as const;

export default OracleErrorHandler;