import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { api, type GraphData } from "../api/client";

const FOLDER_COLORS: Record<string, string> = {
  "10-Papers":   "#4FC3F7",
  "20-Concepts": "#34D399",
  "30-Questions":"#F59E0B",
  "40-MOC":      "#A78BFA",
  "50-Syntheses":"#FB923C",
  "60-Meta":     "#6B7280",
  external:      "#374151",
  "00-Inbox":    "#9CA3AF",
};

interface Props {
  onOpenEditor: (citekey: string) => void;
}

export default function GraphView({ onOpenEditor }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.graph().then((d) => { setData(d); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = svgRef.current.getBoundingClientRect();
    const W = width || 800;
    const H = height || 600;

    const g = svg.append("g");

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Clone nodes for simulation (d3 mutates them)
    const nodes = data.nodes.map((n) => ({ ...n })) as (typeof data.nodes[0] & d3.SimulationNodeDatum)[];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links = data.edges
      .map((e) => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target) }))
      .filter((l) => l.source && l.target) as d3.SimulationLinkDatum<typeof nodes[0]>[];

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: d3.SimulationNodeDatum) => (d as typeof nodes[0]).id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(18));

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#2A3447")
      .attr("stroke-width", 1);

    const node = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 7)
      .attr("fill", (d) => FOLDER_COLORS[d.folder] || "#4FC3F7")
      .attr("stroke", "#0D1117")
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelected(d.id);
      })
      .on("dblclick", (_event, d) => {
        if (d.folder === "10-Papers") onOpenEditor(d.id);
      })
      .call(
        d3.drag<SVGCircleElement, typeof nodes[0]>()
          .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    const label = g.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => d.label)
      .attr("font-size", 10)
      .attr("fill", "#CDD9E5")
      .attr("dx", 10)
      .attr("dy", 4)
      .attr("pointer-events", "none");

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as typeof nodes[0]).x ?? 0)
        .attr("y1", (d) => (d.source as typeof nodes[0]).y ?? 0)
        .attr("x2", (d) => (d.target as typeof nodes[0]).x ?? 0)
        .attr("y2", (d) => (d.target as typeof nodes[0]).y ?? 0);
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => { sim.stop(); };
  }, [data, onOpenEditor]);

  const selectedNode = data?.nodes.find((n) => n.id === selected);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1>Graph</h1>
        {data && <span className="muted mono" style={{ fontSize: 12 }}>{data.nodes.length} nodes · {data.edges.length} edges</span>}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {Object.entries(FOLDER_COLORS).filter(([k]) => k !== "external").map(([folder, color]) => (
          <span key={folder} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }} className="mono">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
            {folder}
          </span>
        ))}
      </div>

      {loading && <div className="muted">Loading graph…</div>}

      <div className="graph-container">
        <svg ref={svgRef} width="100%" height="100%" />
      </div>

      {selectedNode && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="mono" style={{ color: FOLDER_COLORS[selectedNode.folder] || "var(--accent)" }}>
                {selectedNode.folder}
              </span>
              <span style={{ margin: "0 8px" }}>·</span>
              <strong>{selectedNode.label}</strong>
            </div>
            {selectedNode.folder === "10-Papers" && (
              <button className="btn btn-primary" onClick={() => onOpenEditor(selectedNode.id)}>
                Open in Editor
              </button>
            )}
          </div>
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Click a node to select · Double-click a paper node to open in editor · Drag to rearrange · Scroll to zoom
      </div>
    </div>
  );
}
