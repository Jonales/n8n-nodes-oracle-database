const fs = require('fs');
const path = require('path');

class OracleClientDetector {
	constructor() {
		this.projectRoot = this.findProjectRoot();
		this.configPath = path.join(this.projectRoot, 'oracle-config.json');
		this.libDir = path.join(this.projectRoot, 'lib');
	}

	/**
	 * Encontra a raiz do projeto
	 */
	findProjectRoot() {
		let currentDir = __dirname;

		// Busca por package.json subindo na árvore de diretórios
		while (currentDir !== path.dirname(currentDir)) {
			if (fs.existsSync(path.join(currentDir, 'package.json'))) {
				return currentDir;
			}
			currentDir = path.dirname(currentDir);
		}

		// Fallback para diretório pai do script
		return path.resolve(__dirname, '..');
	}

	/**
	 * Verifica se Oracle Client está disponível
	 */
	async detectOracleClient() {
		try {
			// 1. Verifica configuração local salva
			const localConfig = this.getLocalConfig();
			if (localConfig && this.validateLocalInstallation(localConfig)) {
				return {
					available: true,
					type: 'local',
					libDir: localConfig.libDir,
					version: localConfig.version || '21.8.0',
					config: localConfig,
				};
			}

			// 2. Verifica instalação do sistema
			const systemClient = await this.detectSystemOracleClient();
			if (systemClient.found) {
				return {
					available: true,
					type: 'system',
					libDir: systemClient.libDir,
					version: systemClient.version,
					path: systemClient.path,
				};
			}

			// 3. Oracle Client não encontrado
			return {
				available: false,
				type: null,
				message: 'Oracle Client não encontrado. Execute o instalador automático.',
			};
		} catch (error) {
			return {
				available: false,
				type: 'error',
				message: error.message,
			};
		}
	}

	/**
	 * Carrega configuração local
	 */
	getLocalConfig() {
		try {
			if (fs.existsSync(this.configPath)) {
				const configData = fs.readFileSync(this.configPath, 'utf8');
				return JSON.parse(configData);
			}
		} catch (error) {
			console.warn('⚠️ Erro ao ler configuração local:', error.message);
		}
		return null;
	}

	/**
	 * Valida instalação local
	 */
	validateLocalInstallation(config) {
		if (!config.libDir || !fs.existsSync(config.libDir)) {
			return false;
		}

		// Verifica arquivos essenciais baseado na plataforma
		const platform = process.platform;
		let requiredFiles = [];

		if (platform === 'win32') {
			requiredFiles = ['oci.dll', 'oraclient21.dll'];
		} else if (platform === 'darwin') {
			requiredFiles = ['libclntsh.dylib.21.1', 'libclntsh.dylib'];
		} else {
			requiredFiles = ['libclntsh.so.21.1', 'libclntsh.so'];
		}

		return requiredFiles.some(file => fs.existsSync(path.join(config.libDir, file)));
	}

	/**
	 * Detecta Oracle Client do sistema
	 */
	async detectSystemOracleClient() {
		const { exec } = require('child_process');
		const { promisify } = require('util');
		const execAsync = promisify(exec);

		try {
			let command;
			const platform = process.platform;

			if (platform === 'win32') {
				command = 'where sqlplus 2>nul || where oci.dll 2>nul';
			} else {
				command =
					'which sqlplus 2>/dev/null || find /opt/oracle -name "libclntsh.so*" 2>/dev/null | head -1';
			}

			const { stdout } = await execAsync(command);
			if (stdout.trim()) {
				const clientPath = stdout.trim().split('\n')[0];
				const libDir = platform === 'win32' ? path.dirname(clientPath) : path.dirname(clientPath);

				return {
					found: true,
					path: clientPath,
					libDir: libDir,
					version: await this.getOracleClientVersion(clientPath),
				};
			}
		} catch (error) {
			// Silenciosamente falha se não encontrar
		}

		return { found: false };
	}

	/**
	 * Obtém versão do Oracle Client
	 */
	async getOracleClientVersion(clientPath) {
		try {
			const { exec } = require('child_process');
			const { promisify } = require('util');
			const execAsync = promisify(exec);

			if (clientPath.includes('sqlplus')) {
				const { stdout } = await execAsync('sqlplus -v 2>/dev/null || echo "21.8.0"');
				const match = stdout.match(/(\d+\.\d+\.\d+)/);
				return match ? match[1] : '21.8.0';
			}
		} catch (error) {
			// Ignora erro e retorna versão padrão
		}
		return '21.8.0';
	}

	/**
	 * Configura Oracle Client para uso na aplicação
	 */
	getConnectionConfig(forceThickMode = false) {
		const detection = this.detectOracleClient();

		return detection.then(result => {
			if (!result.available && forceThickMode) {
				throw new Error(
					'Oracle Client obrigatório para modo thick não encontrado. ' +
						'Execute: node script/oracle-installer.js',
				);
			}

			return {
				mode: result.available && forceThickMode ? 'thick' : 'thin',
				libDir: result.available ? result.libDir : undefined,
				available: result.available,
				type: result.type,
				autoDownload: !result.available,
			};
		});
	}

	/**
	 * Auto-instala Oracle Client se necessário
	 */
	async ensureOracleClient() {
		const detection = await this.detectOracleClient();

		if (!detection.available) {
			console.log('📦 Oracle Client não encontrado. Iniciando instalação automática...');

			try {
				const OracleClientInstaller = require('./oracle-installer');
				const installer = new OracleClientInstaller();
				await installer.run();

				console.log('✅ Oracle Client instalado automaticamente');
				return await this.detectOracleClient();
			} catch (error) {
				console.warn('⚠️ Falha na instalação automática:', error.message);
				console.log('💡 Executando em modo thin (sem Oracle Client)');
				return detection;
			}
		}

		return detection;
	}

	/**
	 * Atualiza configuração salva
	 */
	saveConfig(config) {
		try {
			const configData = {
				...config,
				updatedAt: new Date().toISOString(),
			};

			fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
			console.log(`📄 Configuração salva: ${this.configPath}`);
		} catch (error) {
			console.error('❌ Erro ao salvar configuração:', error.message);
		}
	}

	/**
	 * Remove configuração e instalação local
	 */
	cleanup() {
		try {
			// Remove configuração
			if (fs.existsSync(this.configPath)) {
				fs.unlinkSync(this.configPath);
				console.log('🗑️ Configuração removida');
			}

			// Remove instalação local
			const oracleClientDir = path.join(this.libDir, 'oracle_client');
			if (fs.existsSync(oracleClientDir)) {
				fs.rmSync(oracleClientDir, { recursive: true, force: true });
				console.log('🗑️ Instalação local removida');
			}

			console.log('✅ Limpeza concluída');
		} catch (error) {
			console.error('❌ Erro durante limpeza:', error.message);
		}
	}
}

// Função utilitária para ser usada pelos arquivos de conexão
async function getOracleClientConfig(options = {}) {
	const detector = new OracleClientDetector();

	const { forceThickMode = false, autoInstall = true, throwOnMissing = false } = options;

	try {
		let detection;

		if (autoInstall) {
			detection = await detector.ensureOracleClient();
		} else {
			detection = await detector.detectOracleClient();
		}

		if (!detection.available && throwOnMissing) {
			throw new Error('Oracle Client requerido mas não encontrado');
		}

		if (
			detection.available &&
			detection.libDir &&
			(detection.type === 'local' || detection.type === 'system')
		) {
			const platform = process.platform;
			if (platform === 'linux' || platform === 'darwin') {
				// Para o processo atual
				process.env.LD_LIBRARY_PATH =
					detection.libDir + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '');
				// Orientação para persistência
				console.log(`🔧 LD_LIBRARY_PATH ajustado para: ${process.env.LD_LIBRARY_PATH}`);
				console.log(
					'💡 Para tornar isso permanente, adicione ao seu ~/.bashrc, ~/.zshrc ou profile:\n' +
						`    export LD_LIBRARY_PATH="${detection.libDir}:$LD_LIBRARY_PATH"`,
				);
			} else if (platform === 'win32') {
				console.log('ℹ️ No Windows, adicione o diretório do Oracle Client ao PATH:');
				console.log(`    set PATH=${detection.libDir};%PATH%`);
			}
		}

		return {
			mode: detection.available && forceThickMode ? 'thick' : 'thin',
			libDir: detection.available ? detection.libDir : undefined,
			available: detection.available,
			type: detection.type || 'auto',
		};
	} catch (error) {
		console.error('❌ Erro na detecção do Oracle Client:', error.message);

		if (throwOnMissing) {
			throw error;
		}

		// Fallback para thin mode
		return {
			mode: 'thin',
			libDir: undefined,
			available: false,
			type: 'fallback',
		};
	}
}

module.exports = {
	OracleClientDetector,
	getOracleClientConfig,
};
