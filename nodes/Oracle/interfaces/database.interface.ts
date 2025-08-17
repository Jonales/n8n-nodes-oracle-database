/**
 * Tipos de credenciais Oracle para n8n-nodes-oracle-database
 * Suporte para modo thin (padrão) e thick com Oracle Client
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.0.0
 */

import { Connection } from 'oracledb';

/**
 * Interface para conexões de banco de dados Oracle
 *
 * Define o contrato padrão para implementações de conexão,
 * incluindo funcionalidades avançadas para diagnóstico,
 * health checks e informações de configuração.
 */
export interface DatabaseConnection {
	/**
	 * Estabelece conexão com o banco Oracle
	 * @returns Promise<Connection> - Conexão Oracle ativa
	 * @throws Error se não conseguir conectar
	 */
	getConnection(): Promise<Connection>;

	/**
	 * Testa a conectividade com o banco (Health Check)
	 * @returns Promise<boolean> - true se conexão e teste SQL funcionaram
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Obter informações sobre a conexão configurada
	 * @returns Objeto com detalhes da conexão
	 */
	getConnectionInfo(): {
		mode: string;
		clientVersion?: string;
		serverVersion?: string;
	};
}

/**
 * Interface para informações de diagnóstico de ambiente
 * Usado para validar se o ambiente está configurado corretamente
 */
export interface DatabaseEnvironmentCheck {
	isValid: boolean;
	errors: string[];
	recommendations: string[];
}

/**
 * Interface para configurações de conexão extensíveis
 * Permite diferentes implementações (Oracle, MySQL, PostgreSQL, etc.)
 */
export interface DatabaseConnectionConfig {
	mode?: string;
	logLevel?: 'none' | 'info' | 'debug';
	language?: 'pt' | 'en';
	[key: string]: any; // Permite propriedades específicas por implementação
}

/**
 * Interface para factory methods de conexão
 * Padroniza a criação de conexões especializadas
 */
export interface DatabaseConnectionFactory<T extends DatabaseConnection> {
	/**
	 * Criar conexão padrão/automática
	 */
	createConnection(credentials: any, config?: DatabaseConnectionConfig): T;

	/**
	 * Validar requisitos do ambiente
	 */
	validateEnvironment(config?: any): DatabaseEnvironmentCheck;
}

/**
 * Interface para credenciais de banco genéricas
 * Base para credenciais específicas (Oracle, etc.)
 */
export interface DatabaseCredentials {
	user: string;
	password: string;
	connectionString: string;
}

/**
 * Interface para pool de conexões (futuro)
 * Preparação para implementações de connection pooling
 */
export interface DatabaseConnectionPool {
	/**
	 * Obter conexão do pool
	 */
	getConnection(): Promise<Connection>;

	/**
	 * Retornar conexão ao pool
	 */
	releaseConnection(connection: Connection): Promise<void>;

	/**
	 * Fechar todas as conexões do pool
	 */
	close(): Promise<void>;

	/**
	 * Obter estatísticas do pool
	 */
	getPoolStatistics(): {
		totalConnections: number;
		activeConnections: number;
		idleConnections: number;
	};
}

/**
 * Interface para operações de transação (futuro)
 * Padroniza controle transacional entre implementações
 */
export interface DatabaseTransaction {
	/**
	 * Iniciar transação
	 */
	begin(): Promise<void>;

	/**
	 * Confirmar transação
	 */
	commit(): Promise<void>;

	/**
	 * Reverter transação
	 */
	rollback(): Promise<void>;

	/**
	 * Criar savepoint
	 */
	savepoint(name: string): Promise<void>;

	/**
	 * Rollback para savepoint
	 */
	rollbackToSavepoint(name: string): Promise<void>;

	/**
	 * Verificar se transação está ativa
	 */
	isActive(): boolean;
}
