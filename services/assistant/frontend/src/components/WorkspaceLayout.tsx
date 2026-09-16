import type { ReactNode } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SidebarRail } from "./WorkspaceSidebar";

/**
 * The 3-zone shell (menu bar / collapsible sidebar / body) shared by the
 * LaTeX Editor and the Notes workspaces. Mirrors LaTeXEditor.tsx's
 * `latex-shell` → `latex-workspace` → `PanelGroup(sidebar, body)` markup so
 * every section using it gets identical chrome for free.
 */
export function WorkspaceLayout({
  panelGroupId,
  menuBar,
  sidebar,
  sidebarCollapsed,
  onShowSidebar,
  sidebarLabel = "Files",
  sidebarSize = { default: 22, min: 16, max: 40 },
  children,
  height,
}: {
  panelGroupId: string;
  menuBar: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed: boolean;
  onShowSidebar: () => void;
  sidebarLabel?: string;
  sidebarSize?: { default: number; min: number; max: number };
  /** Main-content panels — pass one or more <Panel>/<PanelResizeHandle> elements. */
  children: ReactNode;
  /** Fixed height for the shell when its ancestor isn't already a filling flex column. */
  height?: string;
}) {
  return (
    <div className="latex-shell" style={height ? { height } : undefined}>
      {menuBar}
      <div className="latex-workspace">
        {sidebarCollapsed && <SidebarRail label={sidebarLabel} onShow={onShowSidebar} />}
        <PanelGroup id={panelGroupId} orientation="horizontal" className="latex-panel-group" style={{ height: "100%" }}>
          {!sidebarCollapsed && (
            <>
              <Panel
                id={`${panelGroupId}-sidebar`}
                defaultSize={String(sidebarSize.default)}
                minSize={String(sidebarSize.min)}
                maxSize={String(sidebarSize.max)}
                className="latex-panel"
              >
                {sidebar}
              </Panel>
              <PanelResizeHandle className="latex-resize-handle" />
            </>
          )}
          {children}
        </PanelGroup>
      </div>
    </div>
  );
}

export { Panel as WorkspacePanel, PanelResizeHandle as WorkspaceResizeHandle };
