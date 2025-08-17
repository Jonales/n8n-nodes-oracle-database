import oracledb, {
  Connection,
  ConnectionAttributes,
  InitOracleClientOptions
} from 'oracledb';
import { DatabaseConnection } from './interfaces/database.interface';
import { OracleCredentials } from './types/oracle.credentials.type';

export type ConnectionMode = 'auto' | 'thin' | 'thick';

export interface ConnectionConfig {
  mode?: ConnectionMode; // 'auto' tenta detectar o ideal
  oracleClientPath?: string;
  configDir?: string;
  errorUrl?: string;
  libDir?: string;
  fetchAsStringTypes?: any[]; // Para CLOB, BLOB, etc.
  logLevel?: 'none' | 'info' | 'debug';
  language?: 'pt' | 'en'; // Pré-requisito para i18n futuro
}

export class OracleConnection implements DatabaseConnection {
  private databaseConfig: ConnectionAttributes;
  private connectionConfig: ConnectionConfig;
  private static clientInitialized = false;

  constructor(
    credentials: OracleCredentials,
    connectionConfig: ConnectionConfig = { mode: 'auto' }
  ) {
    const { user, password, connectionString } = credentials;

    this.databaseConfig = {
      user,
      password,
      connectionString,
    } as ConnectionAttributes;

    // Preenche valores padrão
    this.connectionConfig = {
      mode: connectionConfig.mode ?? 'auto',
      libDir: connectionConfig.libDir,
      configDir: connectionConfig.configDir,
      errorUrl: connectionConfig.errorUrl,
      fetchAsStringTypes: connectionConfig.fetchAsStringTypes ?? [oracledb.CLOB],
      logLevel: connectionConfig.logLevel ?? 'info',
      language: connectionConfig.language ?? 'pt', // futuro i18n
    };

    // Detecta modo ideal se "auto"
    if (this.connectionConfig.mode === 'auto') {
      this.connectionConfig.mode = this.detectBestMode();
    }

    // Inicializa cliente Oracle se necessário
    this.configureConnectionMode();
  }

  /**
   * Detectar modo ideal: se Oracle Client disponível, usa 'thick'; senão, 'thin'.
   */
  private detectBestMode(): 'thin' | 'thick' {
    if (
      process.env.LD_LIBRARY_PATH ||
      process.env.DYLD_LIBRARY_PATH ||
      process.env.PATH?.toLowerCase().includes('oracle') ||
      this.connectionConfig.libDir
    ) {
      this.log('info', '🔍 Detecção automática: modo THICK selecionado');
      return 'thick';
    }
    this.log('info', '🔍 Detecção automática: modo THIN selecionado');
    return 'thin';
  }

  /**
   * Configura cliente Oracle conforme o modo
   */
  private configureConnectionMode(): void {
    if (this.connectionConfig.mode === 'thick' && !OracleConnection.clientInitialized) {
      this.initializeThickClient();
    } else if (this.connectionConfig.mode === 'thin') {
      this.configureThinMode();
    }
  }

  /**
   * Inicializa o modo thick (Oracle Client libraries)
   */
  private initializeThickClient(): void {
    try {
      const initOptions: InitOracleClientOptions = {};

      if (this.connectionConfig.libDir) {
        initOptions.libDir = this.connectionConfig.libDir;
      }
      if (this.connectionConfig.configDir) {
        initOptions.configDir = this.connectionConfig.configDir;
      }
      if (this.connectionConfig.errorUrl) {
        initOptions.errorUrl = this.connectionConfig.errorUrl;
      }

      oracledb.initOracleClient(initOptions);

      OracleConnection.clientInitialized = true;

      this.log('info', '✅ Oracle Client inicializado em modo THICK');
      this.log('debug', `📁 libDir: ${initOptions.libDir || 'default'}`);
      this.log('debug', `⚙️ configDir: ${initOptions.configDir || 'default'}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('DPI-1047')) {
        throw new Error(
          `❌ Oracle Client libraries não encontradas.\n` +
          `Verifique se:\n` +
          `1. Oracle Instant Client está instalado\n` +
          `2. LD_LIBRARY_PATH está configurado corretamente\n` +
          `3. Caminho das bibliotecas está correto: ${this.connectionConfig.libDir || 'padrão do sistema'}\n` +
          `Erro original: ${errorMessage}`
        );
      }
      if (errorMessage.includes('DPI-1072')) {
        throw new Error(
          `❌ Oracle Client já foi inicializado anteriormente.\n` +
          `Este erro pode ocorrer em reinicializações do Node.js.\n` +
          `Erro original: ${errorMessage}`
        );
      }
      throw new Error(
        `❌ Falha ao inicializar Oracle Client em modo THICK: ${errorMessage}\n` +
        `Verifique:\n` +
        `- Oracle Instant Client instalado\n` +
        `- LD_LIBRARY_PATH configurado\n` +
        `- Permissões de acesso às bibliotecas\n` +
        `- Compatibilidade da versão do Oracle Client`
      );
    }
  }

  /**
   * Configura modo thin (sem Oracle Client)
   */
  private configureThinMode(): void {
    oracledb.fetchAsString = this.connectionConfig.fetchAsStringTypes!;
    this.log('info', '✅ Oracle Client configurado em modo THIN (sem Oracle Client necessário)');
  }

  /**
   * Estabelece conexão com Oracle DB
   */
  async getConnection(): Promise<Connection> {
    try {
      const connection = await oracledb.getConnection(this.databaseConfig);
      this.log(
        'info',
        `🔗 Conexão estabelecida [${this.connectionConfig.mode?.toUpperCase()}] como ${this.databaseConfig.user} em ${this.databaseConfig.connectionString}`
      );
      return connection;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.connectionConfig.mode === 'thick') {
        throw new Error(
          `❌ Falha na conexão em modo THICK: ${errorMessage}\n` +
          `Verifique:\n` +
          `- Oracle Client está funcionando corretamente\n` +
          `- TNS names está configurado (se usando TNS)\n` +
          `- Credenciais e string de conexão\n` +
          `- Conectividade de rede com o banco Oracle`
        );
      } else {
        throw new Error(
          `❌ Falha na conexão em modo THIN: ${errorMessage}\n` +
          `Verifique:\n` +
          `- String de conexão está correta\n` +
          `- Credenciais estão válidas\n` +
          `- Conectividade de rede com o banco Oracle\n` +
          `- Firewall não está bloqueando a porta do Oracle`
        );
      }
    }
  }

  /**
   * Realiza um teste simples de conectividade (Health Check)
   */
  async testConnection(): Promise<boolean> {
    try {
      const conn = await this.getConnection();
      try {
        await conn.execute('SELECT 1 FROM DUAL');
        this.log('info', '✅ Teste de conexão Oracle OK');
        await conn.close();
        return true;
      } catch {
        await conn.close();
        throw new Error('Falha ao executar teste no banco Oracle.');
      }
    } catch (err) {
      this.log('info', `❌ Não foi possível conectar/testar o banco: ${String(err)}`);
      return false;
    }
  }

  /**
   * Exibe informações da conexão e do cliente Oracle
   */
  getConnectionInfo(): {
    mode: string;
    clientVersion?: string;
    serverVersion?: string;
  } {
    const info: any = {
      mode: this.connectionConfig.mode,
      clientVersion: undefined,
      serverVersion: undefined,
    };

    if (this.connectionConfig.mode === 'thick') {
      try {
        info.clientVersion = (oracledb as any).oracleClientVersionString;
      } catch {
        info.clientVersion = 'unknown';
      }
    } else {
      info.clientVersion = 'thin driver (JS only)';
    }

    return info;
  }

  /**
   * Função de logging controlada por logLevel do config
   */
  private log(level: 'info' | 'debug', ...args: any[]) {
    const configuredLevel = this.connectionConfig.logLevel || 'info';
    if (level === 'info' && ['info', 'debug'].includes(configuredLevel)) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
    if (level === 'debug' && configuredLevel === 'debug') {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  }

  /**
   * Diagnóstico do modo thick, para automação/instaladores
   */
  static validateThickModeRequirements(libDir?: string): {
    isValid: boolean;
    errors: string[];
    recommendations: string[];
  } {
    const errors: string[] = [];
    const recommendations: string[] = [];

    const ldLibraryPath = process.env.LD_LIBRARY_PATH;
    const dyldLibraryPath = process.env.DYLD_LIBRARY_PATH;
    const path = process.env.PATH;

    if (process.platform === 'linux' || process.platform === 'darwin') {
      if (!ldLibraryPath && !dyldLibraryPath && !libDir) {
        errors.push('LD_LIBRARY_PATH não está definido');
        recommendations.push('Configure LD_LIBRARY_PATH apontando para o Oracle Instant Client');
      }
    }

    if (process.platform === 'win32' && !path?.toLowerCase().includes('oracle') && !libDir) {
      errors.push('Oracle Client não encontrado no PATH');
      recommendations.push('Adicione o diretório do Oracle Client ao PATH do Windows');
    }

    if (process.platform !== 'linux' && process.platform !== 'darwin' && process.platform !== 'win32') {
      errors.push(`Plataforma ${process.platform} pode não ser suportada para modo thick`);
      recommendations.push('Considere usar modo thin para maior compatibilidade');
    }

    return {
      isValid: errors.length === 0,
      errors,
      recommendations,
    };
  }

  /**
   * Fábrica para criar conexão em modo thin
   */
  static createThinConnection(credentials: OracleCredentials): OracleConnection {
    return new OracleConnection(credentials, { mode: 'thin' });
  }

  /**
   * Fábrica para criar conexão em modo thick
   */
  static createThickConnection(
    credentials: OracleCredentials,
    options: {
      libDir?: string;
      configDir?: string;
      errorUrl?: string;
    } = {}
  ): OracleConnection {
    return new OracleConnection(credentials, {
      mode: 'thick',
      ...options
    });
  }
}
