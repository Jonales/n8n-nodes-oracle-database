#!/usr/bin/env node

/**
 * Setup Script - Oracle Client Auto-Setup
 * Script de configuração automática para n8n-nodes-oracle-database
 * 
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class OracleSetup {
    constructor() {
        this.projectRoot = this.findProjectRoot();
        this.scriptDir = path.join(this.projectRoot, 'script');
        this.libDir = path.join(this.projectRoot, 'lib');
    }

    findProjectRoot() {
        let currentDir = __dirname;
        while (currentDir !== path.dirname(currentDir)) {
            if (fs.existsSync(path.join(currentDir, 'package.json'))) {
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }
        return path.resolve(__dirname, '..');
    }

    /**
     * Cria estrutura de diretórios
     */
    createDirectoryStructure() {
        console.log('📁 Criando estrutura de diretórios...');
        
        const dirs = [
            this.scriptDir,
            this.libDir,
            path.join(this.libDir, 'oracle_client'),
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`   ✅ ${path.relative(this.projectRoot, dir)}/`);
            } else {
                console.log(`   📂 ${path.relative(this.projectRoot, dir)}/ (já existe)`);
            }
        }
    }

    /**
     * Verifica dependências do sistema
     */
    checkSystemDependencies() {
        console.log('🔍 Verificando dependências do sistema...');
        
        const dependencies = {
            node: 'node --version',
            npm: 'npm --version',
            unzip: this.getUnzipCommand()
        };

        const results = {};

        for (const [name, command] of Object.entries(dependencies)) {
            try {
                const version = execSync(command, { 
                    encoding: 'utf8', 
                    stdio: ['pipe', 'pipe', 'pipe'] 
                }).trim();
                results[name] = { available: true, version };
                console.log(`   ✅ ${name}: ${version}`);
            } catch (error) {
                results[name] = { available: false };
                console.log(`   ❌ ${name}: não encontrado`);
            }
        }

        // Verificações especiais
        this.checkNodeVersion(results.node?.version);
        this.checkUnzipAvailability(results.unzip?.available);

        return results;
    }

    /**
     * Retorna comando de unzip baseado na plataforma
     */
    getUnzipCommand() {
        const platform = process.platform;
        
        if (platform === 'win32') {
            return 'powershell -Command "Get-Command Expand-Archive"';
        } else {
            return 'unzip -v';
        }
    }

    /**
     * Verifica versão mínima do Node.js
     */
    checkNodeVersion(version) {
        if (!version) return;

        const majorVersion = parseInt(version.replace(/^v/, '').split('.')[0]);
        const minVersion = 18;

        if (majorVersion < minVersion) {
            console.warn(`⚠️ Node.js ${majorVersion} detectado. Recomendado: ${minVersion}+`);
            console.warn('   Algumas funcionalidades podem não estar disponíveis.');
        }
    }

    /**
     * Verifica disponibilidade do unzip
     */
    checkUnzipAvailability(available) {
        if (!available) {
            const platform = process.platform;
            
            if (platform === 'linux') {
                console.warn('⚠️ unzip não encontrado. Instale com:');
                console.warn('   Ubuntu/Debian: sudo apt-get install unzip');
                console.warn('   CentOS/RHEL: sudo yum install unzip');
            } else if (platform === 'darwin') {
                console.warn('⚠️ unzip não encontrado. Instale com:');
                console.warn('   brew install unzip');
            } else if (platform === 'win32') {
                console.warn('⚠️ PowerShell Expand-Archive não disponível');
                console.warn('   Instale uma versão mais recente do PowerShell');
            }
        }
    }

    /**
     * Instala dependências npm se necessário
     */
    installNpmDependencies() {
        console.log('📦 Verificando dependências npm...');
        
        const packageJsonPath = path.join(this.projectRoot, 'package.json');
        
        if (fs.existsSync(packageJsonPath)) {
            const nodeModulesPath = path.join(this.projectRoot, 'node_modules');
            
            if (!fs.existsSync(nodeModulesPath)) {
                console.log('   Executando npm install...');
                try {
                    execSync('npm install', { 
                        cwd: this.projectRoot, 
                        stdio: 'inherit' 
                    });
                    console.log('   ✅ Dependências instaladas');
                } catch (error) {
                    console.error('   ❌ Erro ao instalar dependências:', error.message);
                    throw error;
                }
            } else {
                console.log('   ✅ node_modules já existe');
            }
        } else {
            console.log('   ⚠️ package.json não encontrado, pulando...');
        }
    }

    /**
     * Configura Oracle Client
     */
    async setupOracleClient(options = {}) {
        console.log('🔧 Configurando Oracle Client...');
        
        const { force = false, mode = 'auto' } = options;

        try {
            // Importa e executa detector
            const OracleClientDetector = require('./oracle-detector').OracleClientDetector;
            const detector = new OracleClientDetector();
            
            const detection = await detector.detectOracleClient();
            
            if (detection.available && !force) {
                console.log(`   ✅ Oracle Client já disponível (${detection.type})`);
                console.log(`   📍 Localização: ${detection.libDir || 'sistema'}`);
                return detection;
            }

            // Auto-instalação se não encontrado ou forçado
            if (!detection.available || force) {
                console.log('   📥 Iniciando instalação automática...');
                
                const OracleClientInstaller = require('./oracle-installer');
                const installer = new OracleClientInstaller();
                
                const result = await installer.run(force);
                console.log('   ✅ Oracle Client configurado');
                
                return result;
            }

        } catch (error) {
            console.error('   ❌ Erro na configuração:', error.message);
            
            if (mode === 'strict') {
                throw error;
            }
            
            console.log('   💡 Continuando com modo thin (sem Oracle Client)');
            return { available: false, mode: 'thin' };
        }
    }

    /**
     * Executa testes de validação
     */
    async runValidationTests() {
        console.log('🧪 Executando testes de validação...');
        
        try {
            // Teste 1: Importação do oracledb
            console.log('   Teste 1: Importando oracledb...');
            const oracledb = require('oracledb');
            console.log(`   ✅ oracledb v${oracledb.versionString}`);

            // Teste 2: Detecção do Oracle Client
            console.log('   Teste 2: Detecção de Oracle Client...');
            const { getOracleClientConfig } = require('./oracle-detector');
            const config = await getOracleClientConfig({ autoInstall: false });
            
            console.log(`   ✅ Modo: ${config.mode}`);
            if (config.libDir) {
                console.log(`   ✅ LibDir: ${config.libDir}`);
            }

            // Teste 3: Conexão básica (sem credenciais reais)
            console.log('   Teste 3: Inicialização do cliente...');
            
            if (config.mode === 'thick' && config.libDir) {
                try {
                    oracledb.initOracleClient({ libDir: config.libDir });
                    console.log('   ✅ Cliente thick inicializado');
                } catch (error) {
                    if (error.message.includes('DPI-1072')) {
                        console.log('   ✅ Cliente thick já inicializado');
                    } else {
                        throw error;
                    }
                }
            } else {
                console.log('   ✅ Modo thin configurado');
            }

            console.log('✅ Todos os testes passaram!');
            return true;

        } catch (error) {
            console.error('❌ Teste falhou:', error.message);
            return false;
        }
    }

    /**
     * Gera script de exemplo
     */
    generateExampleScript() {
        console.log('📝 Gerando script de exemplo...');
        
        const examplePath = path.join(this.scriptDir, 'test-connection.js');
        const exampleContent = `#!/usr/bin/env node

/**
 * Exemplo de teste de conexão Oracle
 * Demonstra uso do Oracle Client auto-configurado
 */

const { getOracleClientConfig } = require('./oracle-detector');

async function testOracleConnection() {
    try {
        console.log('🔍 Detectando Oracle Client...');
        
        // Obtém configuração automática
        const config = await getOracleClientConfig({
            autoInstall: true,
            forceThickMode: false
        });

        console.log('📋 Configuração detectada:');
        console.log(\`   Modo: \${config.mode}\`);
        console.log(\`   Disponível: \${config.available}\`);
        console.log(\`   Tipo: \${config.type}\`);
        if (config.libDir) {
            console.log(\`   LibDir: \${config.libDir}\`);
        }

        // Importa oracledb
        const oracledb = require('oracledb');

        // Configura cliente se necessário
        if (config.mode === 'thick' && config.libDir) {
            console.log('🔧 Configurando modo thick...');
            try {
                oracledb.initOracleClient({ libDir: config.libDir });
                console.log('✅ Cliente thick configurado');
            } catch (error) {
                if (!error.message.includes('DPI-1072')) {
                    throw error;
                }
                console.log('✅ Cliente thick já configurado');
            }
        }

        console.log('✅ Configuração Oracle pronta para uso!');
        console.log('');
        console.log('💡 Para testar conexão real, configure suas credenciais:');
        console.log('   - user: seu_usuario');
        console.log('   - password: sua_senha'); 
        console.log('   - connectionString: host:porta/servico');

    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

// Executa se chamado diretamente
if (require.main === module) {
    testOracleConnection();
}

module.exports = testOracleConnection;
`;

        fs.writeFileSync(examplePath, exampleContent);
        console.log(`   ✅ Exemplo criado: ${path.relative(this.projectRoot, examplePath)}`);
    }

    /**
     * Execução principal
     */
    async run(options = {}) {
        console.log('🚀 Oracle Client Setup');
        console.log('=======================\n');

        const {
            skipDependencies = false,
            skipOracle = false,
            skipTests = false,
            force = false,
            mode = 'auto'
        } = options;

        try {
            // 1. Criar estrutura de diretórios
            this.createDirectoryStructure();
            console.log('');

            // 2. Verificar dependências do sistema
            if (!skipDependencies) {
                this.checkSystemDependencies();
                console.log('');
            }

            // 3. Instalar dependências npm
            if (!skipDependencies) {
                this.installNpmDependencies();
                console.log('');
            }

            // 4. Configurar Oracle Client
            if (!skipOracle) {
                await this.setupOracleClient({ force, mode });
                console.log('');
            }

            // 5. Executar testes
            if (!skipTests) {
                const testsOk = await this.runValidationTests();
                console.log('');
                
                if (!testsOk) {
                    console.log('⚠️ Alguns testes falharam, mas o setup pode funcionar');
                }
            }

            // 6. Gerar exemplo
            this.generateExampleScript();
            console.log('');

            // 7. Resumo final
            console.log('🎉 Setup concluído com sucesso!');
            console.log('');
            console.log('Próximos passos:');
            console.log('1. Execute: node script/test-connection.js');
            console.log('2. Configure suas credenciais Oracle');
            console.log('3. Teste sua conexão no n8n');
            console.log('');
            console.log('Comandos úteis:');
            console.log('- node script/oracle-installer.js          # Reinstalar Oracle Client');
            console.log('- node script/oracle-installer.js --force  # Forçar reinstalação');
            console.log('- node script/test-connection.js           # Testar configuração');

        } catch (error) {
            console.error('\n❌ Setup falhou:', error.message);
            console.error('\n🔧 Tente executar com --force ou verificar logs acima');
            process.exit(1);
        }
    }
}

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    
    const options = {
        skipDependencies: args.includes('--skip-deps'),
        skipOracle: args.includes('--skip-oracle'),
        skipTests: args.includes('--skip-tests'),
        force: args.includes('--force'),
        mode: args.includes('--strict') ? 'strict' : 'auto'
    };

    if (args.includes('--help')) {
            console.log(`
        Oracle Client Setup

        Uso:
        node setup-oracle.js [opções]

        Opções:
        --skip-deps     Pula verificação de dependências
        --skip-oracle   Pula configuração do Oracle Client
        --skip-tests    Pula testes de validação
        --force         Força reinstalação do Oracle Client
        --strict        Falha se Oracle Client não puder ser configurado
        --help          Exibe esta ajuda

        Exemplos:
        node setup-oracle.js                 # Setup completo
        node setup-oracle.js --force         # Força reinstalação
        node setup-oracle.js --skip-deps     # Pula verificação de deps
            `);
            process.exit(0);
        } 
}// Missing closing brace was here

module.exports = OracleSetup;

const setup = new OracleSetup(); // Cria instância
setup.run(options); // Executa o setup 