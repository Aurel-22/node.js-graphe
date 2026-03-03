import React, { useState } from 'react';
import { graphApi, EngineType } from '../services/api';
import './GraphFormModal.css';

interface GraphFormModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  database?: string;
  engine?: string;
}

const SAMPLE_MERMAID = `graph TD
    A[Client] --> B[API Gateway]
    B --> C[Auth Service]
    B --> D[User Service]
    B --> E[Data Service]
    C --> F[Token Store]
    D --> G[User DB]
    E --> H[Cache]
    E --> I[Main DB]
    H --> I`;

const GRAPH_TYPES = [
  'flowchart',
  'dependency',
  'network',
  'infrastructure',
  'hierarchy',
  'workflow',
  'architecture',
];

const GraphFormModal: React.FC<GraphFormModalProps> = ({
  open,
  onClose,
  onCreated,
  database,
  engine,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [graphType, setGraphType] = useState('flowchart');
  const [mermaidCode, setMermaidCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Le titre est requis');
      return;
    }
    if (!mermaidCode.trim()) {
      setError('Le code Mermaid est requis');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await graphApi.createGraph(
        {
          title: title.trim(),
          description: description.trim() || title.trim(),
          graph_type: graphType,
          mermaid_code: mermaidCode.trim(),
        },
        database,
        engine as EngineType,
      );
      // Reset form
      setTitle('');
      setDescription('');
      setGraphType('flowchart');
      setMermaidCode('');
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  const loadTemplate = () => {
    setMermaidCode(SAMPLE_MERMAID);
    if (!title) setTitle('Sample Architecture');
    if (!description) setDescription('Example microservices architecture');
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nouveau graphe</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="graph-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="graph-title">Titre *</label>
              <input
                id="graph-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mon graphe"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="graph-type">Type</label>
              <select
                id="graph-type"
                value={graphType}
                onChange={(e) => setGraphType(e.target.value)}
              >
                {GRAPH_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="graph-desc">Description</label>
            <input
              id="graph-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description du graphe"
            />
          </div>

          <div className="form-group">
            <div className="label-row">
              <label htmlFor="graph-mermaid">Code Mermaid *</label>
              <button type="button" className="template-btn" onClick={loadTemplate}>
                Charger template
              </button>
            </div>
            <textarea
              id="graph-mermaid"
              value={mermaidCode}
              onChange={(e) => setMermaidCode(e.target.value)}
              placeholder="graph TD&#10;    A[Node A] --> B[Node B]&#10;    B --> C[Node C]"
              rows={12}
              required
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={submitting}>
              Annuler
            </button>
            <button type="submit" className="btn-create" disabled={submitting}>
              {submitting ? 'Création...' : 'Créer le graphe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GraphFormModal;
