// E2EDash — components of the E2E run dashboard. Global: window.E2EDash. Needs React 18.
import type { ReactNode } from 'react';

/** Run state as one pill. Colour + dot shape + word. */
export interface StatusPillProps {
  state: 'starting' | 'running' | 'paused' | 'stuck' | 'finished' | 'failed' | 'offline';
  /** Overrides the default word, e.g. "Running · part 2 of 3". */
  label?: string;
}

/** A scenario's result in this run: glyph + word. A pass with tries > 1 shows ↻ and "try N". */
export interface ResultMarkProps {
  result: 'queued' | 'running' | 'passed' | 'failed' | 'did not run' | 'skipped';
  tries?: number;
  hideLabel?: boolean;
}

/** Why a scenario is in this run. Unknown tags render dashed, with `meaning` or a fallback as title. */
export interface TagChipProps {
  tag: string;
  /** The `tags` legend from progress.json. */
  legend?: Record<string, string>;
  meaning?: string;
  count?: number;
}

/** A dotted scenario id, split into scannable axis values. The prefix before the last ":" is dropped (kept in title). */
export interface ScenarioIdProps {
  id: string;
  /** Axis values to highlight, e.g. ["hide-amount", "max"]. */
  highlight?: string[];
}

/** Elapsed against expected. The track spans 150%; the tick marks 100%; past it the fill turns amber and shows the ratio. */
export interface TimeBarProps {
  elapsed: number;
  expected: number;
  right?: ReactNode;
}

/** A section card with an eyebrow label. */
export interface PanelProps {
  label?: string;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/** One thing the person must do. With no title, the quiet "nothing needs you" strip. */
export interface NeedsYouCardProps {
  title?: string;
  what?: ReactNode;
  command?: string;
  next?: ReactNode;
}

/** A message from the agent. A correction is as prominent as what it corrects. */
export interface MessageCardProps {
  kind: 'why' | 'note' | 'finding' | 'correction' | string;
  text: string;
  at?: string;
  /** A job or scenario id the message points at. */
  target?: string;
  link?: string;
}

/** One job on the plan timeline. Seconds from the run start; `scale` is px per second. */
export interface TimelineRowProps {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  estStart: number;
  estSeconds: number;
  guess?: boolean;
  actStart?: number;
  actSeconds?: number;
  setups?: { start: number; seconds: number }[];
  drift?: string;
  scale?: number;
}
