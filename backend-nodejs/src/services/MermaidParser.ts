import { GraphNode, GraphEdge } from "../models/graph.js";

export class MermaidParser {
  static parse(mermaidCode: string): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    const lines = mermaidCode
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("%%"));

    for (const line of lines) {
      // Ignorer la déclaration du graphe
      if (
        line.startsWith("graph ") ||
        line.startsWith("flowchart ") ||
        line === "graph" ||
        line === "flowchart"
      ) {
        continue;
      }

      // Parser les relations (avec flèches)
      const edgeResult = this.parseEdge(line);
      if (edgeResult) {
        const { source, target, label, edgeType } = edgeResult;

        // Créer les nœuds implicites
        if (!nodes.has(source)) {
          nodes.set(source, {
            id: source,
            label: source,
            node_type: this.inferNodeType(source, "default"),
            properties: {},
          });
        }
        if (!nodes.has(target)) {
          nodes.set(target, {
            id: target,
            label: target,
            node_type: this.inferNodeType(target, "default"),
            properties: {},
          });
        }

        edges.push({
          source,
          target,
          label,
          edge_type: edgeType,
          properties: {},
        });
      } else {
        // Parser les définitions de nœuds (avec labels)
        const nodeResult = this.parseNode(line);
        if (nodeResult) {
          nodes.set(nodeResult.id, nodeResult);
        }
      }
    }

    if (nodes.size === 0) {
      throw new Error("No nodes found in Mermaid code");
    }

    return { nodes: Array.from(nodes.values()), edges };
  }

  private static parseNode(line: string): GraphNode | null {
    // Format: A[Label]
    let match = /^(\w+)\[(.*?)\]/.exec(line);
    if (match) {
      return {
        id: match[1],
        label: match[2],
        node_type: "process",
        properties: {},
      };
    }

    // Format: A((Label)) - Start/End
    match = /^(\w+)\(\((.*?)\)\)/.exec(line);
    if (match) {
      return {
        id: match[1],
        label: match[2],
        node_type: "start",
        properties: {},
      };
    }

    // Format: A{Label} - Decision
    match = /^(\w+)\{(.*?)\}/.exec(line);
    if (match) {
      return {
        id: match[1],
        label: match[2],
        node_type: "decision",
        properties: {},
      };
    }

    // Format: A(Label) - Rounded
    match = /^(\w+)\((.*?)\)/.exec(line);
    if (match) {
      return {
        id: match[1],
        label: match[2],
        node_type: "process",
        properties: {},
      };
    }

    return null;
  }

  private static parseEdge(
    line: string,
  ): {
    source: string;
    target: string;
    label?: string;
    edgeType: string;
  } | null {
    // Format: A --> B
    let match = /(\w+)\s*--+>\s*(\w+)/.exec(line);
    if (match) {
      return { source: match[1], target: match[2], edgeType: "next" };
    }

    // Format: A -->|Label| B
    match = /(\w+)\s*--+>\s*\|([^|]+)\|\s*(\w+)/.exec(line);
    if (match) {
      return {
        source: match[1],
        target: match[3],
        label: match[2].trim(),
        edgeType: "next",
      };
    }

    // Format: A ---|Label| B
    match = /(\w+)\s*---\s*\|([^|]+)\|\s*(\w+)/.exec(line);
    if (match) {
      return {
        source: match[1],
        target: match[3],
        label: match[2].trim(),
        edgeType: "relation",
      };
    }

    // Format: A --- B
    match = /(\w+)\s*---\s*(\w+)/.exec(line);
    if (match) {
      return { source: match[1], target: match[2], edgeType: "relation" };
    }

    // Format: A ==> B (thick arrow)
    match = /(\w+)\s*==+>\s*(\w+)/.exec(line);
    if (match) {
      return { source: match[1], target: match[2], edgeType: "strong" };
    }

    // Format: A -.->|Label| B (dotted)
    match = /(\w+)\s*-\.->+\s*\|([^|]+)\|\s*(\w+)/.exec(line);
    if (match) {
      return {
        source: match[1],
        target: match[3],
        label: match[2].trim(),
        edgeType: "optional",
      };
    }

    // Format: A -.-> B (dotted)
    match = /(\w+)\s*-\.->+\s*(\w+)/.exec(line);
    if (match) {
      return { source: match[1], target: match[2], edgeType: "optional" };
    }

    return null;
  }

  private static inferNodeType(id: string, shape: string): string {
    const idLower = id.toLowerCase();

    if (idLower.includes("start") || idLower.includes("begin")) return "start";
    if (idLower.includes("end") || idLower.includes("finish")) return "end";
    if (idLower.includes("error") || idLower.includes("fail")) return "error";
    if (
      idLower.includes("decision") ||
      idLower.includes("if") ||
      idLower.includes("choice")
    )
      return "decision";

    return shape === "start"
      ? "start"
      : shape === "decision"
        ? "decision"
        : "process";
  }
}
