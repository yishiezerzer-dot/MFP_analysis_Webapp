import type { ReactNode } from "react";

export interface HelpTopic {
  id: string;
  title: string;
  keywords?: string[];
  /** Plain text used for search (titles/keywords are included automatically). */
  searchText?: string;
  body?: ReactNode;
  children?: HelpTopic[];
}

export interface HelpModule {
  title: string;
  topics: HelpTopic[];
}
