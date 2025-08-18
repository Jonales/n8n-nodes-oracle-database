/**
 * Tipos de credenciais Oracle para n8n-nodes-oracle-database
 * Suporte para modo thin (padrão) e thick com Oracle Client
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.0.0
 */

import oracledb, { Connection, ConnectionAttributes, InitialiseOptions } from 'oracledb';
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
    autoInstall?: boolean; // Auto-instala Oracle Client se necessário
}

export class OracleConnection implements DatabaseConnection {
  private databaseConfig: ConnectionAttributes;
  private connectionConfig: ConnectionConfig;
  private static clientInitialized = false;
  private detectedConfig?: any;

  constructor(
    credentials: OracleCredentials,
    connectionConfig: ConnectionConfig = { mode: 'auto' },
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
      autoInstall: connectionConfig.autoInstall ?? true, // Auto-instala por padrão
    };

    // Inicialização assíncrona será feita no getConnection()
  }

  /**
     * Detecta e configura Oracle Client automaticamente
     */
  private async autoDetectOracleClient(): Promise<void> {
    if (this.detectedConfig) {
      return; // Já detectado
    }

    try {
      // Importa utilitário de detecção (se disponível)
      const { getOracleClientConfig } = require('../script/oracle-detector');
            
      this.log('info', '🔍 Auto-detectando Oracle Client...');
            
      const config = await getOracleClientConfig({
        autoInstall: this.connectionConfig.autoInstall,
        forceThickMode: this.connectionConfig.mode === 'thick',
        throwOnMissing: false
      });

      this.detectedConfig = config;
            
      // Atualiza configuração baseada na detecção
      if (this.connectionConfig.mode === 'auto') {
        this.connectionConfig.mode = config.mode;
      }
            
      if (config.libDir && !this.connectionConfig.libDir) {
        this.connectionConfig.libDir = config.libDir;
      }

      this.log('info', `✅ Oracle Client detectado: modo ${config.mode}`);
      if (config.libDir) {
        this.log('debug', `📁 LibDir: ${config.libDir}`);
      }

    } catch (error) {
      this.log('info', '⚠️ Auto-detecção falhou, usando detecção manual');
      this.log('debug', `Erro: ${error instanceof Error ? error.message : String(error)}`);
            
      // Fallback para detecção manual
      await this.fallbackDetection();
    }
  }

  /**
     * Detecção manual como fallback
     */
  private async fallbackDetection(): Promise<void> {
    if (this.connectionConfig.mode === 'auto') {
      this.connectionConfig.mode = this.detectBestMode();
    }
        
    this.detectedConfig = {
      mode: this.connectionConfig.mode,
      available: this.connectionConfig.mode === 'thick',
      type: 'fallback'
    };
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
  private async configureConnectionMode(): Promise<void> {
    // Executa auto-detecção primeiro
    await this.autoDetectOracleClient();

    if (this.connectionConfig.mode === 'thick' && !OracleConnection.clientInitialized) {
      await this.initializeThickClient();
    } else if (this.connectionConfig.mode === 'thin') {
      this.configureThinMode();
    }
  }

  /**
     * Inicializa o modo thick (Oracle Client libraries)
     */
  private async initializeThickClient(): Promise<void> {
    try {
      const initOptions: InitialiseOptions = {};

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
        // Oracle Client não encontrado, tenta auto-instalação
        if (this.connectionConfig.autoInstall) {
          this.log('info', '📦 Oracle Client não encontrado, tentando instalação automática...');
          await this.tryAutoInstall();
          return; // Recursão será chamada após instalação
        }

        throw new Error(
          '❌ Oracle Client libraries não encontradas.\n' +
                        'Verifique se:\n' +
                        '1. Oracle Instant Client está instalado\n' +
                        '2. LD_LIBRARY_PATH está configurado corretamente\n' +
                        `3. Caminho das bibliotecas está correto: ${this.connectionConfig.libDir || 'padrão do sistema'}\n` +
                        '4. Execute: node script/setup-oracle.js\n' +
                        `Erro original: ${errorMessage}`,
        );
      }
      if (errorMessage.includes('DPI-1072')) {
        this.log('info', '✅ Oracle Client já inicializado anteriormente');
        OracleConnection.clientInitialized = true;
        return;
      }
      throw new Error(
        `❌ Falha ao inicializar Oracle Client em modo THICK: ${errorMessage}\n` +
                    'Verifique:\n' +
                    '- Oracle Instant Client instalado\n' +
                    '- LD_LIBRARY_PATH configurado\n' +
                    '- Permissões de acesso às bibliotecas\n' +
                    '- Compatibilidade da versão do Oracle Client\n' +
                    '- Execute: node script/setup-oracle.js --force',
      );
    }
  }

  /**
     * Tenta instalação automática do Oracle Client
     */
  private async tryAutoInstall(): Promise<void> {
    try {
      this.log('info', '🚀 Executando instalação automática do Oracle Client...');
            
      const OracleClientInstaller = require('../script/oracle-installer');
      const installer = new OracleClientInstaller();
            
      const result = await installer.run();
            
      if (result?.libDir) {
        this.connectionConfig.libDir = result.libDir;
        this.log('info', '✅ Oracle Client instalado automaticamente');
                
        // Tenta inicializar novamente
        await this.initializeThickClient();
      }
            
    } catch (installError) {
      this.log('info', '⚠️ Instalação automática falhou, mudando para modo thin');
      this.log('debug', `Erro de instalação: ${installError instanceof Error ? installError.message : String(installError)}`);
            
      // Fallback para thin mode
      this.connectionConfig.mode = 'thin';
      this.configureThinMode();
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
      // Configura o modo de conexão se ainda não foi feito
      await this.configureConnectionMode();
            
      const connection = await oracledb.getConnection(this.databaseConfig);
            
      this.log(
        'info',
        `🔗 Conexão estabelecida [${this.connectionConfig.mode?.toUpperCase()}] como ${this.databaseConfig.user} em ${this.databaseConfig.connectionString}`,
      );
            
      return connection;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.connectionConfig.mode === 'thick') {
        throw new Error(
          `❌ Falha na conexão em modo THICK: ${errorMessage}\n` +
                        'Verifique:\n' +
                        '- Oracle Client está funcionando corretamente\n' +
                        '- TNS names está configurado (se usando TNS)\n' +
                        '- Credenciais e string de conexão\n' +
                        '- Conectividade de rede com o banco Oracle\n' +
                        '- Execute: node script/test-connection.js',
        );
      } else {
        throw new Error(
          `❌ Falha na conexão em modo THIN: ${errorMessage}\n` +
                        'Verifique:\n' +
                        '- String de conexão está correta\n' +
                        '- Credenciais estão válidas\n' +
                        '- Conectividade de rede com o banco Oracle\n' +
                        '- Firewall não está bloqueando a porta do Oracle',
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
        detectedConfig?: any;
        } {
    const info: any = {
      mode: this.connectionConfig.mode,
      clientVersion: undefined,
      serverVersion: undefined,
      detectedConfig: this.detectedConfig
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
       
      console.log(...args);
    }
    if (level === 'debug' && configuredLevel === 'debug') {
       
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
        recommendations.push('Ou execute: node script/setup-oracle.js');
      }
    }

    if (process.platform === 'win32' && !path?.toLowerCase().includes('oracle') && !libDir) {
      errors.push('Oracle Client não encontrado no PATH');
      recommendations.push('Adicione o diretório do Oracle Client ao PATH do Windows');
      recommendations.push('Ou execute: node script/setup-oracle.js');
    }

    if (
      process.platform !== 'linux' &&
            process.platform !== 'darwin' &&
            process.platform !== 'win32'
    ) {
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
        } = {},
  ): OracleConnection {
    return new OracleConnection(credentials, {
      mode: 'thick',
      ...options,
    });
  }

  /**
     * Fábrica para criar conexão com auto-detecção (recomendado)
     */
  static createAutoConnection(
    credentials: OracleCredentials,
    options: {
            autoInstall?: boolean;
            logLevel?: 'none' | 'info' | 'debug';
        } = {},
  ): OracleConnection {
    return new OracleConnection(credentials, {
      mode: 'auto',
      autoInstall: options.autoInstall ?? true,
      logLevel: options.logLevel ?? 'info',
    });
  }
}