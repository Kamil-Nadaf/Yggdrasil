import { useState } from "react";
import SubTabs from "../components/SubTabs";
import ArxivSearch from "./ArxivSearch";
import ArxivBrowser from "./ArxivBrowser";

type Section = "daily" | "search";

/** One "Papers" section: Daily Archive + arXiv Search as subsections. */
export default function PapersView() {
  const [section, setSection] = useState<Section>("daily");
  return (
    <div className="papers-view">
      <SubTabs
        label="Papers"
        value={section}
        onChange={setSection}
        tabs={[
          { id: "daily", label: "Daily Archive" },
          { id: "search", label: "Search" },
        ]}
      />
      {section === "daily" ? <ArxivSearch /> : <ArxivBrowser />}
    </div>
  );
}
