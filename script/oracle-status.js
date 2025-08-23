#!/usr/bin/env node
const { getOracleClientConfig } = require('./oracle-detector');

async function checkOracleStatus() {
  try {
    console.log('🔍 Verificando status do Oracle Client...\n');
    
    const config = await getOracleClientConfig({ autoInstall: false });
    
    console.log('📊 Status atual:');
    console.log(`   Disponível: ${config.available ? '✅' : '❌'}`);
    console.log(`   Modo: ${config.mode}`);
    console.log(`   Tipo: ${config.type}`);
    
    if (config.libDir) {
      console.log(`   LibDir: ${config.libDir}`);
    }
    
    if (config.available) {
      console.log('\n✅ Oracle Client está configurado e pronto para uso!');
    } else {
      console.log('\n⚠️ Oracle Client não encontrado.');
      console.log('💡 Execute: npm run install-oracle');
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar status:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  checkOracleStatus();
}

module.exports = checkOracleStatus;
