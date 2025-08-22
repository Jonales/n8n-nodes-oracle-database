#!/usr/bin/env node

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
        console.log(`   Modo: ${config.mode}`);
        console.log(`   Disponível: ${config.available}`);
        console.log(`   Tipo: ${config.type}`);
        if (config.libDir) {
            console.log(`   LibDir: ${config.libDir}`);
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
