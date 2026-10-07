/** Contract shared by the browser workspace and the server. Plain data only (serializable). */

export type SlideRecord = {
  /** 1-based position in the source deck */
  number: number;
  title: string;
  /** Extracted slide text, one paragraph per line (running header/footer removed) */
  text: string;
  /** Hidden in the source deck (still searchable and exportable) */
  hidden: boolean;
  /** Public path of the rendered thumbnail */
  preview: string;
};

export type Library = {
  deck: { fileName: string; slideCount: number; hiddenCount: number };
  slides: SlideRecord[];
};
