const { Oracle } = require('./dist/credentials/Oracle.credentials');
const { OracleDatabaseAdvanced } = require('./dist/nodes/Oracle/OracleDatabaseAdvanced.node');
const { OracleChatMemory } = require('./dist/nodes/Oracle/ChatMemory.node');
const { OraclePGVectorStore } = require('./dist/nodes/Oracle/PGVectorStore.node');

module.exports = {
  credentials: {
    Oracle
  },
  nodes: {
    OracleDatabaseAdvanced,
    OracleChatMemory,
    OraclePGVectorStore
  }
};
