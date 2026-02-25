/**
 * Service de cache pour les positions des nœuds dans les graphes
 * Permet de conserver les positions des nœuds entre les chargements
 */

interface NodePosition {
  x: number;
  y: number;
}

interface GraphCache {
  [graphId: string]: {
    [nodeId: string]: NodePosition;
  };
}

class NodePositionCache {
  private cache: GraphCache = {};
  private storageKey = 'sigmajs-node-positions';

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Charger le cache depuis le localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.cache = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load node position cache:', error);
      this.cache = {};
    }
  }

  /**
   * Sauvegarder le cache dans le localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.cache));
    } catch (error) {
      console.warn('Failed to save node position cache:', error);
    }
  }

  /**
   * Obtenir la position d'un nœud
   */
  getPosition(graphId: string, nodeId: string): NodePosition | null {
    return this.cache[graphId]?.[nodeId] || null;
  }

  /**
   * Définir la position d'un nœud
   */
  setPosition(graphId: string, nodeId: string, x: number, y: number): void {
    if (!this.cache[graphId]) {
      this.cache[graphId] = {};
    }
    this.cache[graphId][nodeId] = { x, y };
    this.saveToStorage();
  }

  /**
   * Obtenir toutes les positions pour un graphe
   */
  getGraphPositions(graphId: string): Record<string, NodePosition> {
    return this.cache[graphId] || {};
  }

  /**
   * Sauvegarder toutes les positions d'un graphe
   */
  setGraphPositions(graphId: string, positions: Record<string, NodePosition>): void {
    this.cache[graphId] = positions;
    this.saveToStorage();
  }

  /**
   * Effacer le cache pour un graphe
   */
  clearGraph(graphId: string): void {
    delete this.cache[graphId];
    this.saveToStorage();
  }

  /**
   * Effacer tout le cache
   */
  clearAll(): void {
    this.cache = {};
    this.saveToStorage();
  }

  /**
   * Vérifier si une position existe pour un nœud
   */
  hasPosition(graphId: string, nodeId: string): boolean {
    return !!(this.cache[graphId]?.[nodeId]);
  }
}

// Export d'une instance singleton
export const nodePositionCache = new NodePositionCache();
