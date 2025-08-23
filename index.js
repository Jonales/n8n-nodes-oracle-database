module.exports = {
  nodes: [
    require('./dist/nodes/Oracle/OracleDatabase.node.js'),
    require('./dist/nodes/Oracle/OracleDatabaseAdvanced.node.js'),
    require('./dist/nodes/Oracle/OracleVectorStore.node.js'),
    require('./dist/nodes/Oracle/ChatMemory.node.js'),
  ],
  credentials: [
    require('./dist/credentials/Oracle.credentials.js'),
  ],
};

