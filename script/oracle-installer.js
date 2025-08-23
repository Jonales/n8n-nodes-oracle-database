#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class OracleClientInstaller {
	constructor() {
		this.scriptDir = __dirname;
		this.projectRoot = path.resolve(this.scriptDir, '..');
		this.libDir = path.join(this.projectRoot, 'lib');
		this.oracleClientDir = path.join(this.libDir, 'oracle_client');

		// URLs de download por plataforma (Oracle Instant Client 21.8)
		this.downloadUrls = {
			linux: {
				x64: {
					basic:
						'https://download.oracle.com/otn_software/linux/instantclient/218000/instantclient-basic-linux.x64-21.8.0.0.0dbru.zip',
					sdk: 'https://download.oracle.com/otn_software/linux/instantclient/218000/instantclient-sdk-linux.x64-21.8.0.0.0dbru.zip',
				},
				arm64: {
					basic:
						'https://download.oracle.com/otn_software/linux/instantclient/218000/instantclient-basic-linux.arm64-21.8.0.0.0dbru.zip',
					sdk: 'https://download.oracle.com/otn_software/linux/instantclient/218000/instantclient-sdk-linux.arm64-21.8.0.0.0dbru.zip',
				},
			},
			darwin: {
				x64: {
					basic:
						'https://download.oracle.com/otn_software/mac/instantclient/218000/instantclient-basic-macos.x64-21.8.0.0.0dbru.zip',
					sdk: 'https://download.oracle.com/otn_software/mac/instantclient/218000/instantclient-sdk-macos.x64-21.8.0.0.0dbru.zip',
				},
				arm64: {
					basic:
						'https://download.oracle.com/otn_software/mac/instantclient/218000/instantclient-basic-macos.arm64-21.8.0.0.0dbru.zip',
					sdk: 'https://download.oracle.com/otn_software/mac/instantclient/218000/instantclient-sdk-macos.arm64-21.8.0.0.0dbru.zip',
				},
			},
			win32: {
				x64: {
					basic:
						'https://download.oracle.com/otn_software/nt/instantclient/218000/instantclient-basic-windows.x64-21.8.0.0.0dbru.zip',
					sdk: 'https://download.oracle.com/otn_software/nt/instantclient/218000/instantclient-sdk-windows.x64-21.8.0.0.0dbru.zip',
				},
			},
		};

		this.platform = process.platform;
		this.arch = process.arch;

		console.log(`🔍 Sistema detectado: ${this.platform}-${this.arch}`);
	}

	/**
	 * Verifica se Oracle Client já está instalado no sistema
	 */
	async checkSystemOracleClient() {
		console.log('🔍 Verificando Oracle Client no sistema...');

		try {
			// Verifica se oracledb.initOracleClient já foi inicializado
			const testCmd =
				this.platform === 'win32'
					? 'where sqlplus'
					: 'which sqlplus || which instantclient || ls /opt/oracle/*/bin/sqlplus 2>/dev/null';

			const { stdout } = await execAsync(testCmd);

			if (stdout.trim()) {
				console.log('✅ Oracle Client encontrado no sistema:', stdout.trim());
				return {
					found: true,
					path: stdout.trim().split('\n')[0],
					type: 'system',
				};
			}
		} catch (error) {
			console.log('ℹ️ Oracle Client não encontrado no sistema');
		}

		// Verifica instalação local na pasta /lib
		const localClientPath = this.getLocalClientPath();
		if (fs.existsSync(localClientPath)) {
			console.log('✅ Oracle Client local encontrado:', localClientPath);
			return {
				found: true,
				path: localClientPath,
				type: 'local',
			};
		}

		console.log('❌ Oracle Client não encontrado');
		return { found: false };
	}

	/**
	 * Retorna o caminho esperado do cliente Oracle local
	 */
	getLocalClientPath() {
		const instantClientDir = path.join(this.oracleClientDir, 'instantclient_21_8');

		if (this.platform === 'win32') {
			return path.join(instantClientDir, 'oci.dll');
		} else {
			return path.join(instantClientDir, 'libclntsh.so.21.1');
		}
	}

	/**
	 * Retorna o diretório lib do cliente Oracle local
	 */
	getLocalClientLibDir() {
		return path.join(this.oracleClientDir, 'instantclient_21_8');
	}

	/**
	 * Verifica se a plataforma é suportada
	 */
	isPlatformSupported() {
		const supportedPlatforms = Object.keys(this.downloadUrls);
		if (!supportedPlatforms.includes(this.platform)) {
			console.error(`❌ Plataforma ${this.platform} não suportada`);
			console.log('Plataformas suportadas:', supportedPlatforms.join(', '));
			return false;
		}

		const supportedArches = Object.keys(this.downloadUrls[this.platform]);
		if (!supportedArches.includes(this.arch)) {
			console.error(`❌ Arquitetura ${this.arch} não suportada para ${this.platform}`);
			console.log('Arquiteturas suportadas:', supportedArches.join(', '));
			return false;
		}

		return true;
	}

	/**
	 * Cria estrutura de diretórios
	 */
	createDirectories() {
		const dirs = [this.libDir, this.oracleClientDir];

		for (const dir of dirs) {
			if (!fs.existsSync(dir)) {
				console.log(`📁 Criando diretório: ${dir}`);
				fs.mkdirSync(dir, { recursive: true });
			}
		}
	}

	/**
	 * Download de arquivo com progress
	 */
	async downloadFile(url, filePath) {
		return new Promise((resolve, reject) => {
			console.log(`⬇️ Baixando: ${path.basename(filePath)}`);

			const file = fs.createWriteStream(filePath);
			let downloadedBytes = 0;
			let totalBytes = 0;

			const request = https.get(url, response => {
				totalBytes = parseInt(response.headers['content-length'], 10);

				response.on('data', chunk => {
					downloadedBytes += chunk.length;
					const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1);
					process.stdout.write(
						`\r   Progresso: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`,
					);
				});

				response.on('end', () => {
					console.log('\n✅ Download concluído');
				});

				response.pipe(file);
			});

			file.on('finish', () => {
				file.close();
				resolve();
			});

			file.on('error', err => {
				fs.unlinkSync(filePath);
				reject(err);
			});

			request.on('error', err => {
				reject(err);
			});
		});
	}

	/**
	 * Extrai arquivo ZIP
	 */
	async extractZip(zipPath, extractPath) {
		console.log(`📦 Extraindo: ${path.basename(zipPath)}`);

		return new Promise((resolve, reject) => {
			const unzip = spawn('unzip', ['-q', '-o', zipPath, '-d', extractPath], {
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			unzip.on('close', code => {
				if (code === 0) {
					console.log('✅ Extração concluída');
					fs.unlinkSync(zipPath); // Remove ZIP após extração
					resolve();
				} else {
					reject(new Error(`Falha na extração. Código: ${code}`));
				}
			});

			unzip.on('error', err => {
				reject(err);
			});
		});
	}

	/**
	 * Instala Oracle Instant Client
	 */
	async installOracleClient() {
		console.log('🚀 Iniciando instalação do Oracle Instant Client...');

		if (!this.isPlatformSupported()) {
			throw new Error('Plataforma não suportada');
		}

		this.createDirectories();

		const urls = this.downloadUrls[this.platform][this.arch];
		const downloads = [
			{ name: 'basic', url: urls.basic },
			{ name: 'sdk', url: urls.sdk },
		];

		// Download dos arquivos
		for (const download of downloads) {
			const fileName = `instantclient-${download.name}.zip`;
			const filePath = path.join(this.oracleClientDir, fileName);

			try {
				await this.downloadFile(download.url, filePath);
				await this.extractZip(filePath, this.oracleClientDir);
			} catch (error) {
				console.error(`❌ Erro no download/extração de ${fileName}:`, error.message);
				throw error;
			}
		}

		// Configurar permissões no Linux/Mac
		if (this.platform !== 'win32') {
			try {
				await execAsync(`chmod +x ${path.join(this.getLocalClientLibDir(), '*')}`);
				console.log('✅ Permissões configuradas');
			} catch (error) {
				console.warn('⚠️ Aviso: Falha ao configurar permissões:', error.message);
			}
		}

		console.log('🎉 Oracle Instant Client instalado com sucesso!');
	}

	/**
	 * Testa a instalação
	 */
	async testInstallation() {
		console.log('🧪 Testando instalação...');

		const clientInfo = await this.checkSystemOracleClient();
		if (!clientInfo.found) {
			throw new Error('Oracle Client não encontrado após instalação');
		}

		// Teste básico de carregamento da biblioteca
		try {
			const oracledb = require('oracledb');

			if (clientInfo.type === 'local') {
				const libDir = this.getLocalClientLibDir();
				console.log(`🔧 Configurando libDir: ${libDir}`);

				// Teste de inicialização (sem conexão real)
				try {
					oracledb.initOracleClient({ libDir });
					console.log('✅ Oracle Client carregado com sucesso (modo thick)');
				} catch (error) {
					if (error.message.includes('DPI-1072')) {
						console.log('✅ Oracle Client já inicializado (modo thick)');
					} else {
						throw error;
					}
				}
			}

			console.log(`✅ Versão do oracledb: ${oracledb.versionString}`);
		} catch (error) {
			console.error('❌ Erro ao testar Oracle Client:', error.message);
			throw error;
		}
	}

	/**
	 * Gera arquivo de configuração para a aplicação
	 */
	generateConfig() {
		const configPath = path.join(this.projectRoot, 'oracle-config.json');
		const clientInfo = {
			installedAt: new Date().toISOString(),
			platform: this.platform,
			arch: this.arch,
			libDir: this.getLocalClientLibDir(),
			type: 'local',
		};

		fs.writeFileSync(configPath, JSON.stringify(clientInfo, null, 2));
		console.log(`📄 Configuração salva em: ${configPath}`);

		return clientInfo;
	}

	/**
	 * Execução principal
	 */
	async run(force = false) {
		console.log('🔥 Oracle Client Auto-Installer');
		console.log('================================\n');

		try {
			// Verifica se já existe instalação
			const existingClient = await this.checkSystemOracleClient();

			if (existingClient.found && !force) {
				console.log('✅ Oracle Client já disponível, nenhuma ação necessária');

				if (existingClient.type === 'local') {
					this.generateConfig();
				}

				return existingClient;
			}

			// Instala Oracle Client
			if (force || !existingClient.found) {
				await this.installOracleClient();
				await this.testInstallation();
				const config = this.generateConfig();

				console.log('\n🎉 Instalação concluída com sucesso!');
				console.log(`📁 Oracle Client instalado em: ${config.libDir}`);

				// Ajuste LD_LIBRARY_PATH ou PATH conforme sistema
				const platform = process.platform;
				if (platform === 'linux' || platform === 'darwin') {
					process.env.LD_LIBRARY_PATH =
						config.libDir + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : '');
					console.log(`🔧 LD_LIBRARY_PATH ajustado para: ${process.env.LD_LIBRARY_PATH}`);
					console.log(
						'💡 Para tornar isso permanente, adicione ao seu ~/.bashrc, ~/.zshrc ou profile:\n' +
							`    export LD_LIBRARY_PATH="${config.libDir}:$LD_LIBRARY_PATH"`,
					);
				} else if (platform === 'win32') {
					console.log('ℹ️ No Windows, adicione o diretório do Oracle Client ao PATH:');
					console.log(`    set PATH=${config.libDir};%PATH%`);
				}

				return config;
			}
		} catch (error) {
			console.error('\n❌ Erro durante instalação:', error.message);
			console.error('💡 Dica: Execute com --force para reinstalar');
			process.exit(1);
		}
	}
}

// Execução via CLI
if (require.main === module) {
	const args = process.argv.slice(2);
	const force = args.includes('--force') || args.includes('-f');
	const help = args.includes('--help') || args.includes('-h');

	if (help) {
		console.log(`
Oracle Client Auto-Installer

Uso:
  node oracle-installer.js [opções]

Opções:
  --force, -f     Força reinstalação mesmo se já existir
  --help, -h      Exibe esta ajuda

Exemplos:
  node oracle-installer.js          # Instala se necessário
  node oracle-installer.js --force  # Força reinstalação
        `);
		process.exit(0);
	}

	const installer = new OracleClientInstaller();
	installer.run(force);
}

module.exports = OracleClientInstaller;
