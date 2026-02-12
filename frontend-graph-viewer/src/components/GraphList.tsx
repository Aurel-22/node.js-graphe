import React from 'react';
import { GraphSummary } from '../types/graph';
import './GraphList.css';

interface GraphListProps {
  graphs: GraphSummary[];
  selectedGraphId: string | null;
  onSelectGraph: (id: string) => void;
  loading: boolean;
}

export const GraphList: React.FC<GraphListProps> = ({
  graphs,
  selectedGraphId,
  onSelectGraph,
  loading,
}) => {
  if (loading) {
    return (
      <div className="graph-list">
        <h2>Available Graphs</h2>
        <div className="loading">Loading graphs...</div>
      </div>
    );
  }

  if (graphs.length === 0) {
    return (
      <div className="graph-list">
        <h2>Available Graphs</h2>
        <div className="no-graphs">No graphs found</div>
      </div>
    );
  }

  return (
    <div className="graph-list">
      <h2>Available Graphs</h2>
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
          </div>
        ))}
      </div>
    </div>
  );
};
