import { useState, useEffect, useMemo } from 'react';
import { GraphData } from '../types/graph';
import { getNodeColor } from '../services/graphTransform';
import './ClassificationFilterPanel.css';

type FilterMode = 'color' | 'zone';

interface ClassificationFilterPanelProps {
  data: GraphData | null;
  onFilteredData: (filtered: GraphData | null) => void;
}

interface FilterGroup {
  key: string;
  label: string;
  color: string;
  count: number;
}

export default function ClassificationFilterPanel({ data, onFilteredData }: ClassificationFilterPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('color');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  // Build groups by node_type (color) or family_label (zone)
  const { colorGroups, zoneGroups } = useMemo(() => {
    if (!data) return { colorGroups: [], zoneGroups: [] };

    const colorMap = new Map<string, FilterGroup>();
    const zoneMap = new Map<string, FilterGroup>();

    for (const node of data.nodes) {
      // Color grouping = by node_type
      const nodeType = node.node_type || 'CI';
      if (colorMap.has(nodeType)) {
        colorMap.get(nodeType)!.count++;
      } else {
        colorMap.set(nodeType, {
          key: nodeType,
          label: nodeType,
          color: getNodeColor(nodeType),
          count: 1,
        });
      }

      // Zone grouping = by family_label (parent classification)
      const familyLabel = node.properties?.family_label || null;
      const zoneKey = familyLabel || '__no_zone__';
      const zoneLabel = familyLabel || 'Sans classification';
      if (zoneMap.has(zoneKey)) {
        zoneMap.get(zoneKey)!.count++;
      } else {
        // Pick dominant color for zone (first node type color encountered)
        zoneMap.set(zoneKey, {
          key: zoneKey,
          label: zoneLabel,
          color: getNodeColor(nodeType),
          count: 1,
        });
      }
    }

    return {
      colorGroups: Array.from(colorMap.values()).sort((a, b) => b.count - a.count),
      zoneGroups: Array.from(zoneMap.values()).sort((a, b) => b.count - a.count),
    };
  }, [data]);

  const groups = filterMode === 'color' ? colorGroups : zoneGroups;

  // Apply filter whenever hiddenKeys or data changes
  useEffect(() => {
    if (!data || hiddenKeys.size === 0) {
      onFilteredData(null);
      return;
    }

    const visibleNodes = data.nodes.filter(node => {
      if (filterMode === 'color') {
        return !hiddenKeys.has(node.node_type || 'CI');
      } else {
        const zoneKey = node.properties?.family_label || '__no_zone__';
        return !hiddenKeys.has(zoneKey);
      }
    });

    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = data.edges.filter(
      e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );

    onFilteredData({ nodes: visibleNodes, edges: visibleEdges });
  }, [hiddenKeys, data, filterMode]);

  // Reset when switching mode or data changes
  useEffect(() => { setHiddenKeys(new Set()); }, [filterMode]);
  useEffect(() => { setHiddenKeys(new Set()); }, [data]);

  const toggleKey = (key: string) => {
    setHiddenKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showAll = () => setHiddenKeys(new Set());
  const hideAll = () => setHiddenKeys(new Set(groups.map(g => g.key)));

  if (!data || data.nodes.length === 0) return null;

  const visibleCount = data.nodes.length - data.nodes.filter(n => {
    if (filterMode === 'color') return hiddenKeys.has(n.node_type || 'CI');
    return hiddenKeys.has(n.properties?.family_label || '__no_zone__');
  }).length;

  return (
    <div className={`classification-filter-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="filter-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="filter-title">
          Filtrage
          {hiddenKeys.size > 0 && (
            <span className="filter-badge">{visibleCount}/{data.nodes.length}</span>
          )}
        </span>
        <span className="collapse-arrow">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="filter-body">
          <div className="filter-mode-toggle">
            <button
              className={filterMode === 'color' ? 'active' : ''}
              onClick={() => setFilterMode('color')}
            >
              Couleur ({colorGroups.length})
            </button>
            {zoneGroups.length > 1 && (
              <button
                className={filterMode === 'zone' ? 'active' : ''}
                onClick={() => setFilterMode('zone')}
              >
                Zone ({zoneGroups.length})
              </button>
            )}
          </div>

          <div className="filter-actions">
            <button onClick={showAll} disabled={hiddenKeys.size === 0}>Show all</button>
            <button onClick={hideAll} disabled={hiddenKeys.size === groups.length}>Hide all</button>
          </div>

          <div className="filter-list">
            {groups.map(group => (
              <label key={group.key} className={`filter-item ${hiddenKeys.has(group.key) ? 'hidden' : ''}`}>
                <input
                  type="checkbox"
                  checked={!hiddenKeys.has(group.key)}
                  onChange={() => toggleKey(group.key)}
                />
                <span className="filter-color-dot" style={{ background: group.color }} />
                <span className="filter-label" title={group.key}>
                  {group.label}
                </span>
                <span className="filter-count">{group.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
