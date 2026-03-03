import React, { useState } from 'react';
import { GraphSummary } from '../types/graph';
import './GraphList.css';

interface GraphListProps {
  graphs: GraphSummary[];
  selectedGraphId: string | null;
  onSelectGraph: (id: string) => void;
  loading: boolean;
  onCreateGraph?: () => void;
  onDeleteGraph?: (id: string, title: string) => void;
}

export const GraphList: React.FC<GraphListProps> = ({
  graphs,
  selectedGraphId,
  onSelectGraph,
  loading,
  onCreateGraph,
  onDeleteGraph,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (e: React.MouseEvent, graph: GraphSummary) => {
    e.stopPropagation();
    if (deletingId === graph.id) {
      // Second click = confirm
      onDeleteGraph?.(graph.id, graph.title);
      setDeletingId(null);
    } else {
      setDeletingId(graph.id);
      // Auto-cancel after 3s
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="graph-list">
        <div className="graph-list-header">
          <h2>Available Graphs</h2>
        </div>
        <div className="loading">Loading graphs...</div>
      </div>
    );
  }

  if (graphs.length === 0) {
    return (
      <div className="graph-list">
        <div className="graph-list-header">
          <h2>Available Graphs</h2>
          {onCreateGraph && (
            <button className="btn-add-graph" onClick={onCreateGraph} title="Nouveau graphe">+</button>
          )}
        </div>
        <div className="no-graphs">No graphs found</div>
      </div>
    );
  }

  return (
    <div className="graph-list">
      <div className="graph-list-header">
        <h2>Available Graphs</h2>
        {onCreateGraph && (
          <button className="btn-add-graph" onClick={onCreateGraph} title="Nouveau graphe">+</button>
        )}
      </div>
      <div className="graph-items">
        {graphs.map((graph) => (
          <div
            key={graph.id}
            className={`graph-item ${selectedGraphId === graph.id ? 'selected' : ''}`}
            onClick={() => onSelectGraph(graph.id)}
          >
            <h3>{graph.title}</h3>
            <p className="description">{graph.description}</p>
            <div className="stats">
              <span className="stat">
                <strong>Nodes:</strong> {graph.node_count.toLocaleString()}
              </span>
              <span className="stat">
                <strong>Edges:</strong> {graph.edge_count.toLocaleString()}
              </span>
            </div>
            <div className="type">
              <span className="badge">{graph.graph_type}</span>
            </div>
            {onDeleteGraph && (
              <button
                className="btn-delete-graph"
                onClick={(e) => handleDelete(e, graph)}
                title={deletingId === graph.id ? 'Cliquer encore pour confirmer' : 'Supprimer'}
                style={deletingId === graph.id ? { opacity: 1, background: 'rgba(244,67,54,0.2)', color: '#f44336' } : undefined}
              >
                {deletingId === graph.id ? '✓' : '✕'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
