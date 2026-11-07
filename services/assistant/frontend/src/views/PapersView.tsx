import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import PdfViewer, { PdfContext, type PdfDoc } from "../components/PdfViewer";
import ArxivSearch from "./ArxivSearch";
import ArxivBrowser from "./ArxivBrowser";

type Section = "daily" | "search";

/** One "Papers" section: Daily Archive + arXiv Search as subsections, with a drag-resizable PDF reader on the right. */
export default function PapersView({ requestSection }: { requestSection?: Section } = {}) {
  const [section, setSection] = useState<Section>(requestSection ?? "daily");
  useEffect(() => { if (requestSection) setSection(requestSection); }, [requestSection]);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const content = section === "daily" ? <ArxivSearch /> : <ArxivBrowser />;
  return (
    <PdfContext.Provider value={setPdf}>
      <div className="papers-view">
        <div className="papers-body">
          {pdf ? (
            <Group id="papers-pdf-split" orientation="horizontal" className="papers-split">
              <Panel id="papers-main" defaultSize={55} minSize={25} className="papers-main">
                {content}
              </Panel>
              <Separator className="arxiv-resize-handle" />
              <Panel id="papers-pdf" defaultSize={45} minSize={20} className="papers-pdf">
                <PdfViewer doc={pdf} onClose={() => setPdf(null)} />
              </Panel>
            </Group>
          ) : (
            <div className="papers-main papers-main--solo">{content}</div>
          )}
        </div>
      </div>
    </PdfContext.Provider>
  );
}
