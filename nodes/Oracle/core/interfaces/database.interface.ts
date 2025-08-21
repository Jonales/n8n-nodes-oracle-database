/**
 * Oracle Vector Store Node para n8n
 * Gerenciamento de vector store usando Oracle Database 23ai
 *
 * @author Jônatas Meireles Sousa Vieira
 * @version 1.1.0
 */

export interface DatabaseConnection<T> {
  getConnection: () => Promise<T>;
}
