import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { api, type GraphData, type GraphEdge, type GraphNeighbor } from "../api/client";
import {
  THEME_EVENT,
  getFolderColors,
  getGraphEdgeColors,
  loadPageTheme,
} from "../lib/theme";

interface Props {
  onOpenEditor: (citekey: string) => void;
}

const EDGE_FILTERS = [
  { id: "manual_link", label: "wikilinks" },
  { id: "shared_claim", label: "shared claim" },
  { id: "shared_method", label: "shared method" },
  { id: "shared_citation", label: "shared citation" },
  { id: "shared_entity", label: "shared entity" },
  { id: "citation", label: "Semantic Scholar" },
  { id: "suggested", label: "embedding suggest" },
] as const;

export default function GraphView({ onOpenEditor }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [enabledTypes, setEnabledTypes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EDGE_FILTERS.map((f) => [f.id, f.id !== "suggested"]))
  );
  const [neighbors, setNeighbors] = useState<GraphNeighbor[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const sync = () => setThemeTick((n) => n + 1);
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const folderColors = useMemo(() => getFolderColors(loadPageTheme("graph")), [themeTick]);
  const edgeColors = useMemo(() => getGraphEdgeColors(loadPageTheme("graph")), [themeTick]);

  function loadGraph() {
    setLoading(true);
    api.graph().then((d) => {
      const withType = {
        ...d,
        edges: d.edges.map((e) => ({ ...e, type: e.type || "manual_link" })),
      };
      setData(withType);
      setLoading(false);
      setEnriching(true);
      Promise.allSettled([api.graphCitations(), api.graphSuggested()])
        .then(([citations, suggested]) => {
          const extra: GraphEdge[] = [];
          if (citations.status === "fulfilled") extra.push(...citations.value.edges);
          if (suggested.status === "fulfilled") extra.push(...suggested.value.edges);
          if (extra.length === 0) return;
          setData((prev) => (prev ? { ...prev, edges: [...prev.edges, ...extra] } : prev));
        })
        .finally(() => setEnriching(false));
    });
  }

  useEffect(() => {
    loadGraph();
  }, []);

  useEffect(() => {
    if (!selected) {
      setNeighbors([]);
      return;
    }
    api.graphNeighbors(selected)
      .then((r) => setNeighbors(r.neighbors))
      .catch(() => setNeighbors([]));
  }, [selected, data]);

  const filteredEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter((e) => enabledTypes[e.type || "manual_link"] !== false);
  }, [data, enabledTypes]);

  const degreeMap = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of filteredEdges) {
      deg.set(e.source, (deg.get(e.source) || 0) + 1);
      deg.set(e.target, (deg.get(e.target) || 0) + 1);
    }
    return deg;
  }, [filteredEdges]);

  const viewEdges = useMemo(() => {
    if (!localOnly || !selected) return filteredEdges;
    return filteredEdges.filter((e) => e.source === selected || e.target === selected);
  }, [filteredEdges, localOnly, selected]);

  const viewNodeIds = useMemo(() => {
    if (!localOnly || !selected || !data) return null;
    const ids = new Set<string>([selected]);
    for (const e of viewEdges) {
      ids.add(e.source);
      ids.add(e.target);
    }
    return ids;
  }, [localOnly, selected, data, viewEdges]);

  useEffect(() => {
    if (!data || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = svgRef.current.getBoundingClientRect();
    const W = width || 800;
    const H = height || 600;

    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const nodes = data.nodes
      .filter((n) => !viewNodeIds || viewNodeIds.has(n.id))
      .map((n) => ({ ...n })) as (typeof data.nodes[0] & d3.SimulationNodeDatum)[];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links = viewEdges
      .map((e) => ({
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target),
        type: e.type || "manual_link",
        reason_text: e.reason_text || "",
        confidence_score: e.confidence_score,
      }))
      .filter((l) => l.source && l.target) as (d3.SimulationLinkDatum<typeof nodes[0]> & {
        type: string;
        reason_text: string;
        confidence_score?: number;
      })[];

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: d3.SimulationNodeDatum) => (d as typeof nodes[0]).id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius((d) => 10 + Math.min(14, (degreeMap.get((d as typeof nodes[0]).id) || 0) * 1.5)));

    // E-ink friendly: distinguish by dash + weight, not hue alone
    const EDGE_STYLE: Record<string, { stroke: string; width: number; dash: string | null; opacity: number }> = {
      manual_link: { stroke: edgeColors.wikilink, width: 1.4, dash: null, opacity: 1 },
      wikilink: { stroke: edgeColors.wikilink, width: 1.4, dash: null, opacity: 1 },
      shared_claim: { stroke: edgeColors.wikilink, width: 2.2, dash: "6 3", opacity: 0.95 },
      shared_method: { stroke: edgeColors.wikilink, width: 1.6, dash: "2 2", opacity: 0.9 },
      shared_citation: { stroke: edgeColors.citation, width: 1.8, dash: "8 3 2 3", opacity: 0.9 },
      shared_entity: { stroke: edgeColors.wikilink, width: 1.5, dash: "1 2", opacity: 0.85 },
      citation: { stroke: edgeColors.citation, width: 1.5, dash: "4 2", opacity: 0.9 },
      suggested: { stroke: edgeColors.suggested, width: 1, dash: "1 3", opacity: 0.55 },
    };

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => EDGE_STYLE[d.type]?.stroke || EDGE_STYLE.manual_link.stroke)
      .attr("stroke-width", (d) => EDGE_STYLE[d.type]?.width || 1)
      .attr("stroke-dasharray", (d) => EDGE_STYLE[d.type]?.dash || null)
      .attr("stroke-opacity", (d) => EDGE_STYLE[d.type]?.opacity ?? 1);
    link.append("title").text((d) => `${d.type}${d.reason_text ? `: ${d.reason_text}` : ""}`);

    const node = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => 5 + Math.min(12, (degreeMap.get(d.id) || 0) * 1.2))
      .attr("fill", (d) => folderColors[d.folder] || "var(--page-accent)")
      .attr("stroke", (d) => (d.id === selected ? "var(--text)" : "var(--bg)"))
      .attr("stroke-width", (d) => (d.id === selected ? 2.5 : 1.5))
      .attr("cursor", "pointer")
      .on("click", (_event, d) => setSelected(d.id))
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
  }, [data, onOpenEditor, viewEdges, viewNodeIds, themeTick, folderColors, edgeColors, degreeMap, selected]);

  const selectedNode = data?.nodes.find((n) => n.id === selected);
  const backlinks = neighbors.filter((n) => n.type === "manual_link" || n.reason_text.includes("wikilink"));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Graph</h1>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {data && `${data.nodes.length} nodes · ${viewEdges.length} edges shown`}
          {enriching && " · enriching…"}
        </span>
        <button
          className="btn"
          disabled={rebuilding}
          onClick={async () => {
            setRebuilding(true);
            try {
              await api.graphRebuild();
              loadGraph();
            } finally {
              setRebuilding(false);
            }
          }}
        >
          {rebuilding ? "Rebuilding…" : "Rebuild typed edges"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        {Object.entries(folderColors).filter(([k]) => k !== "external").map(([folder, color]) => (
          <span key={folder} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }} className="mono">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
            {folder}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {EDGE_FILTERS.map((f) => (
          <label key={f.id} className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!enabledTypes[f.id]}
              onChange={(e) => setEnabledTypes((prev) => ({ ...prev, [f.id]: e.target.checked }))}
            />
            {f.label}
          </label>
        ))}
        <label className="mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} disabled={!selected} />
          local graph (1-hop)
        </label>
      </div>

      {loading && <div className="muted">Loading graph…</div>}

      <div className="graph-container">
        <svg ref={svgRef} width="100%" height="100%" />
      </div>

      {selectedNode && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <span className="mono" style={{ color: folderColors[selectedNode.folder] || "var(--page-accent)" }}>
                {selectedNode.folder}
              </span>
              <span style={{ margin: "0 8px" }}>·</span>
              <strong>{selectedNode.label}</strong>
              <span className="muted mono" style={{ marginLeft: 8, fontSize: 11 }}>
                degree {degreeMap.get(selectedNode.id) || 0}
              </span>
            </div>
            {selectedNode.folder === "10-Papers" && (
              <button className="btn btn-primary" onClick={() => onOpenEditor(selectedNode.id)}>
                Open in Editor
              </button>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="slot-label" style={{ marginBottom: 6 }}>Neighbors (with reasons)</div>
            {neighbors.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>No typed neighbors yet — save a note or rebuild edges.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {neighbors.map((n) => (
                  <li key={`${n.note}-${n.type}-${n.reason_text}`} style={{ marginBottom: 4 }}>
                    <button type="button" className="btn" style={{ padding: "0 6px", marginRight: 6 }} onClick={() => setSelected(n.note)}>
                      {n.note}
                    </button>
                    <span className="mono muted" style={{ fontSize: 11 }}>{n.type}</span>
                    {" — "}
                    {n.reason_text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {backlinks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="slot-label" style={{ marginBottom: 6 }}>Backlinks</div>
              <div className="mono" style={{ fontSize: 12 }}>
                {backlinks.map((b) => b.note).join(" · ")}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Click a node for local neighbors + reasons · Double-click a paper to open · Dash patterns encode edge type (e-ink safe)
      </div>
    </div>
  );
}
