// index.js
module.exports = {
  credentials: {
    oracleCredentials: require('./dist/credentials/Oracle.credentials.js').Oracle
  },
  nodes: {
    OracleDatabase: require('./dist/nodes/Oracle/OracleDatabase.node.js').OracleDatabase,
    OracleDatabaseAdvanced: require('./dist/nodes/Oracle/OracleDatabaseAdvanced.node.js').OracleDatabaseAdvanced,
    OracleVectorStore: require('./dist/nodes/Oracle/OracleVectorStore.node.js').OracleVectorStore,
    OracleChatMemory: require('./dist/nodes/Oracle/ChatMemory.node.js').OracleChatMemory
  }
};
