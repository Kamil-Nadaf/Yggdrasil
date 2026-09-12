import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { api, type GraphData } from "../api/client";
import {
  THEME_EVENT,
  getFolderColors,
  getGraphEdgeColors,
  loadPageTheme,
} from "../lib/theme";

interface Props {
  onOpenEditor: (citekey: string) => void;
}

export default function GraphView({ onOpenEditor }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSuggested, setShowSuggested] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const sync = () => setThemeTick((n) => n + 1);
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const folderColors = useMemo(() => getFolderColors(loadPageTheme("graph")), [themeTick]);
  const edgeColors = useMemo(() => getGraphEdgeColors(loadPageTheme("graph")), [themeTick]);

  useEffect(() => {
    api.graph().then((d) => {
      const withType = { ...d, edges: d.edges.map((e) => ({ ...e, type: e.type || "wikilink" })) };
      setData(withType);
      setLoading(false);

      // Citation edges (Semantic Scholar) and suggested edges (local embedding
      // similarity) are both best-effort and can be slow/absent — layer them
      // in after the wikilink graph renders instead of blocking on them.
      setEnriching(true);
      Promise.allSettled([api.graphCitations(), api.graphSuggested()])
        .then(([citations, suggested]) => {
          const extra: { source: string; target: string; type: string }[] = [];
          if (citations.status === "fulfilled") extra.push(...citations.value.edges);
          if (suggested.status === "fulfilled") extra.push(...suggested.value.edges);
          if (extra.length === 0) return;
          setData((prev) => (prev ? { ...prev, edges: [...prev.edges, ...extra] } : prev));
        })
        .finally(() => setEnriching(false));
    });
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
    const visibleEdges = showSuggested ? data.edges : data.edges.filter((e) => e.type !== "suggested");
    const links = visibleEdges
      .map((e) => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target), type: e.type || "wikilink" }))
      .filter((l) => l.source && l.target) as (d3.SimulationLinkDatum<typeof nodes[0]> & { type: string })[];

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: d3.SimulationNodeDatum) => (d as typeof nodes[0]).id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(18));

    const EDGE_STYLE: Record<string, { stroke: string; width: number; dash: string | null; opacity: number }> = {
      wikilink: { stroke: edgeColors.wikilink, width: 1, dash: null, opacity: 1 },
      citation: { stroke: edgeColors.citation, width: 1.5, dash: "4 2", opacity: 0.9 },
      suggested: { stroke: edgeColors.suggested, width: 1, dash: "1 3", opacity: 0.55 },
    };

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => EDGE_STYLE[d.type]?.stroke || EDGE_STYLE.wikilink.stroke)
      .attr("stroke-width", (d) => EDGE_STYLE[d.type]?.width || 1)
      .attr("stroke-dasharray", (d) => EDGE_STYLE[d.type]?.dash || null)
      .attr("stroke-opacity", (d) => EDGE_STYLE[d.type]?.opacity ?? 1);
    link.append("title").text((d) => d.type);

    const node = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 7)
      .attr("fill", (d) => folderColors[d.folder] || "var(--page-accent)")
      .attr("stroke", "var(--bg)")
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelected(d.id);
      })
      .on("dblclick", (_event, d) => {
        if (d.folder === "10-Papers") onOpenEditor(d.id);
      })
      .call(
        d3.drag<any, any>()
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
      .attr("fill", "var(--text)")
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
  }, [data, onOpenEditor, showSuggested, themeTick, folderColors, edgeColors]);

  const selectedNode = data?.nodes.find((n) => n.id === selected);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1>Graph</h1>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {data && `${data.nodes.length} nodes · ${data.edges.length} edges`}
          {enriching && " · finding citations + suggestions…"}
        </span>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        {Object.entries(folderColors).filter(([k]) => k !== "external").map(([folder, color]) => (
          <span key={folder} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }} className="mono">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
            {folder}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={edgeColors.wikilink} strokeWidth={1} /></svg>
          your [[wikilinks]]
        </span>
        <span className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={edgeColors.citation} strokeWidth={1.5} strokeDasharray="4 2" /></svg>
          real citations (Semantic Scholar)
        </span>
        <label className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={showSuggested} onChange={(e) => setShowSuggested(e.target.checked)} />
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={edgeColors.suggested} strokeWidth={1} strokeDasharray="1 3" /></svg>
          AI-suggested (content similarity) — not written to your notes
        </label>
      </div>

      {loading && <div className="muted">Loading graph…</div>}

      <div className="graph-container">
        <svg ref={svgRef} width="100%" height="100%" />
      </div>

      {selectedNode && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="mono" style={{ color: folderColors[selectedNode.folder] || "var(--page-accent)" }}>
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
