/**
 * Tipos de credenciais Oracle para n8n-nodes-oracle-database
 * Suporte para modo thin (padrão) e thick com Oracle Client
 * 
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.0.0
 */

/**
 * Interface principal para credenciais Oracle
 * Inclui suporte tanto para modo thin quanto thick
 */
export interface OracleCredentials {
  /** Nome do usuário do banco de dados */
  user: string;
  
  /** Senha do usuário do banco de dados */
  password: string;
  
  /** String de conexão Oracle (host:port/service ou TNS alias) */
  connectionString: string;
  
  /** Define se usa modo thin (true) ou thick (false). Padrão: true */
  thinMode?: boolean;
  
  // === Campos específicos para modo thick ===
  
  /** Diretório das bibliotecas Oracle Client (obrigatório para modo thick) */
  libDir?: string;
  
  /** Diretório de configuração (tnsnames.ora, sqlnet.ora, etc.) */
  configDir?: string;
  
  /** URL de erro personalizada para diagnósticos */
  errorUrl?: string;
}

/**
 * Configurações de modo para OracleConnection
 * Usado internamente pelos nodes
 */
export interface OracleConnectionConfig {
  /** Modo de operação */
  mode: 'thin' | 'thick';
  
  /** Configurações específicas do modo thick */
  libDir?: string;
  configDir?: string;
  errorUrl?: string;
}

/**
 * Extensão das credenciais Oracle para casos específicos
 * Usado em contextos que requerem configurações adicionais
 */
export interface ExtendedOracleCredentials extends OracleCredentials {
  /** Timeout de conexão em segundos */
  connectionTimeout?: number;
  
  /** Pool de conexões habilitado */
  enableConnectionPool?: boolean;
  
  /** Configurações SSL/TLS */
  sslConfig?: {
    enabled: boolean;
    certificatePath?: string;
    keyPath?: string;
    caPath?: string;
  };
  
  /** Configurações de retry */
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    exponentialBackoff: boolean;
  };
}

/**
 * Tipo para validação de credenciais
 * Usado pelos nodes para verificar se as credenciais estão válidas
 */
export interface OracleCredentialsValidation {
  isValid: boolean;
  errorMessage?: string;
  mode: 'thin' | 'thick';
  clientVersion?: string;
  serverVersion?: string;
}

/**
 * Configurações específicas por ambiente
 */
export interface OracleEnvironmentConfig {
  /** Desenvolvimento */
  development?: Partial<ExtendedOracleCredentials>;
  
  /** Produção */
  production?: Partial<ExtendedOracleCredentials>;
  
  /** Teste */
  test?: Partial<ExtendedOracleCredentials>;
}

/**
 * Type Guards para validação em runtime
 */
export const isOracleCredentials = (obj: any): obj is OracleCredentials => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.user === 'string' &&
    typeof obj.password === 'string' &&
    typeof obj.connectionString === 'string'
  );
};

export const isThickModeCredentials = (credentials: OracleCredentials): boolean => {
  return credentials.thinMode === false && !!credentials.libDir;
};

export const isThinModeCredentials = (credentials: OracleCredentials): boolean => {
  return credentials.thinMode !== false; // default é thin
};

/**
 * Utilitários para configuração
 */
export class OracleCredentialsUtils {
  /**
   * Cria configuração de conexão baseada nas credenciais
   */
  static createConnectionConfig(credentials: OracleCredentials): OracleConnectionConfig {
    if (credentials.thinMode === false) {
      // Modo thick
      if (!credentials.libDir) {
        throw new Error('libDir é obrigatório para modo thick');
      }
      
      return {
        mode: 'thick',
        libDir: credentials.libDir,
        configDir: credentials.configDir,
        errorUrl: credentials.errorUrl,
      };
    }
    
    // Modo thin (padrão)
    return {
      mode: 'thin',
    };
  }

  /**
   * Valida as credenciais antes do uso
   */
  static validateCredentials(credentials: OracleCredentials): OracleCredentialsValidation {
    // Validação básica
    if (!isOracleCredentials(credentials)) {
      return {
        isValid: false,
        errorMessage: 'Credenciais inválidas: campos obrigatórios ausentes',
        mode: 'thin',
      };
    }

    // Validação específica do modo thick
    if (credentials.thinMode === false) {
      if (!credentials.libDir) {
        return {
          isValid: false,
          errorMessage: 'libDir é obrigatório para modo thick',
          mode: 'thick',
        };
      }

      // Aqui poderia verificar se o diretório existe, etc.
      // Por simplicidade, assumimos válido se libDir está presente
    }

    return {
      isValid: true,
      mode: credentials.thinMode === false ? 'thick' : 'thin',
    };
  }

  /**
   * Converte credenciais legadas para o novo formato
   */
  static migrateLegacyCredentials(legacyCredentials: any): OracleCredentials {
    return {
      user: legacyCredentials.user || '',
      password: legacyCredentials.password || '',
      connectionString: legacyCredentials.connectionString || '',
      thinMode: legacyCredentials.thinMode !== false, // Default true para compatibilidade
      libDir: legacyCredentials.libDir,
      configDir: legacyCredentials.configDir,
      errorUrl: legacyCredentials.errorUrl,
    };
  }

  /**
   * Sanitiza credenciais para logging (remove informações sensíveis)
   */
  static sanitizeForLogging(credentials: OracleCredentials): Partial<OracleCredentials> {
    return {
      user: credentials.user,
      connectionString: credentials.connectionString,
      thinMode: credentials.thinMode,
      libDir: credentials.libDir,
      configDir: credentials.configDir,
      // password e errorUrl omitidos por segurança
    };
  }
}

/**
 * Constantes úteis
 */
export const ORACLE_DEFAULTS = {
  THIN_MODE: true,
  CONNECTION_TIMEOUT: 60,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

/**
 * Tipos derivados para casos específicos
 */
export type OracleCredentialsKeys = keyof OracleCredentials;
export type OracleConnectionMode = OracleConnectionConfig['mode'];
export type RequiredOracleCredentials = Required<Pick<OracleCredentials, 'user' | 'password' | 'connectionString'>>;

// Export default para retrocompatibilidade
export default OracleCredentials;
