import React, { useCallback } from 'react';
import { GraphData } from '../types/graph';
import { getNodeColor } from '../services/graphTransform';
import './ExportPanel.css';

interface ExportPanelProps {
  data: GraphData | null;
  graphId?: string;
  graphTitle?: string;
}

/** Toolbar flottant pour exporter le graphe en PNG, SVG ou JSON. */
const ExportPanel: React.FC<ExportPanelProps> = ({ data, graphId, graphTitle }) => {

  // ── PNG — capture le canvas ou SVG du viewer ──
  const exportPNG = useCallback(() => {
    const container =
      document.querySelector('.graph-viewer-container') ||
      document.querySelector('.graph-viewer');
    if (!container) return;

    // Try canvas first (force-graph, sigma, vis-network, cytoscape, g6, 3D)
    const canvas = container.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = `${graphTitle || graphId || 'graph'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      return;
    }

    // Fallback: SVG element (D3 viewer)
    const svg = container.querySelector('svg');
    if (svg) {
      const svgClone = svg.cloneNode(true) as SVGSVGElement;
      // Ensure it has dimensions
      if (!svgClone.getAttribute('width')) {
        svgClone.setAttribute('width', String(svg.clientWidth || 1200));
        svgClone.setAttribute('height', String(svg.clientHeight || 800));
      }
      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = svg.clientWidth || 1200;
        c.height = svg.clientHeight || 800;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#0f1419';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        const link = document.createElement('a');
        link.download = `${graphTitle || graphId || 'graph'}.png`;
        link.href = c.toDataURL('image/png');
        link.click();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  }, [graphId, graphTitle]);

  // ── SVG — génère un SVG standalone avec layout circulaire ──
  const exportSVG = useCallback(() => {
    if (!data) return;

    // First try to grab existing SVG from D3 viewer
    const container =
      document.querySelector('.graph-viewer-container') ||
      document.querySelector('.graph-viewer');
    const existingSvg = container?.querySelector('svg');
    if (existingSvg) {
      const svgClone = existingSvg.cloneNode(true) as SVGSVGElement;
      if (!svgClone.getAttribute('xmlns')) {
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      if (!svgClone.getAttribute('width')) {
        svgClone.setAttribute('width', String(existingSvg.clientWidth || 1200));
        svgClone.setAttribute('height', String(existingSvg.clientHeight || 800));
      }
      const svgData = new XMLSerializer().serializeToString(svgClone);
      downloadFile(svgData, `${graphTitle || graphId || 'graph'}.svg`, 'image/svg+xml');
      return;
    }

    // Generate SVG with circular layout
    const width = 1400;
    const height = 1000;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    const nodeCount = data.nodes.length;

    const positions = new Map<string, { x: number; y: number }>();
    data.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / nodeCount - Math.PI / 2;
      positions.set(node.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    const nodeRadius = Math.max(4, Math.min(12, 300 / Math.sqrt(nodeCount)));
    const fontSize = Math.max(8, Math.min(12, 200 / Math.sqrt(nodeCount)));
    const showLabels = nodeCount <= 200;

    let svgParts: string[] = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
    svgParts.push(`<rect width="${width}" height="${height}" fill="#0f1419"/>`);

    // Edges
    svgParts.push('<g opacity="0.4">');
    for (const edge of data.edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (from && to) {
        svgParts.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#667eea" stroke-width="0.5"/>`);
      }
    }
    svgParts.push('</g>');

    // Nodes
    for (const node of data.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const color = getNodeColor(node.node_type);
      svgParts.push(`<circle cx="${pos.x}" cy="${pos.y}" r="${nodeRadius}" fill="${color}" stroke="${color}" stroke-opacity="0.5" stroke-width="1"/>`);
      if (showLabels) {
        const escapedLabel = (node.label || node.id).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        svgParts.push(`<text x="${pos.x}" y="${pos.y + nodeRadius + fontSize + 2}" text-anchor="middle" fill="white" font-size="${fontSize}" font-family="sans-serif">${escapedLabel}</text>`);
      }
    }

    // Title
    const title = (graphTitle || graphId || 'Graph').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    svgParts.push(`<text x="20" y="30" fill="white" font-size="18" font-family="sans-serif" font-weight="bold">${title}</text>`);
    svgParts.push(`<text x="20" y="50" fill="#999" font-size="12" font-family="sans-serif">${data.nodes.length} nodes · ${data.edges.length} edges</text>`);

    svgParts.push('</svg>');
    downloadFile(svgParts.join('\n'), `${graphTitle || graphId || 'graph'}.svg`, 'image/svg+xml');
  }, [data, graphId, graphTitle]);

  // ── JSON — export brut des données du graphe ──
  const exportJSON = useCallback(() => {
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${graphTitle || graphId || 'graph'}.json`, 'application/json');
  }, [data, graphId, graphTitle]);

  if (!data) return null;

  return (
    <div className="export-panel">
      <button className="export-btn export-png" onClick={exportPNG} title="Exporter en PNG">
        <span className="export-icon">🖼</span>
        <span>PNG</span>
      </button>
      <button className="export-btn export-svg" onClick={exportSVG} title="Exporter en SVG">
        <span className="export-icon">📐</span>
        <span>SVG</span>
      </button>
      <button className="export-btn export-json" onClick={exportJSON} title="Exporter en JSON">
        <span className="export-icon">{ }</span>
        <span>JSON</span>
      </button>
    </div>
  );
};

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export default ExportPanel;
