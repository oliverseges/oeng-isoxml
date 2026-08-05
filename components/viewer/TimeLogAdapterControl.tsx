"use client";

import { AlertTriangle, CheckCircle2, Cpu, LoaderCircle } from "lucide-react";
import type { DecodedTimeLog } from "@/lib/isoxml/types";

interface TimeLogAdapterControlProps {
  timeLog: DecodedTimeLog;
  onSelectAdapter: (adapterId?: string) => void;
  busy?: boolean;
  variant?: "inspector" | "workspace";
}

export function TimeLogAdapterControl({
  timeLog,
  onSelectAdapter,
  busy = false,
  variant = "inspector",
}: TimeLogAdapterControlProps) {
  const selection = timeLog.adapterSelection;
  const selectValue =
    selection.mode === "manual" && selection.adapterId
      ? selection.adapterId
      : "automatic";
  const needsChoice = selection.mode === "unresolved";
  const StatusIcon = busy
    ? LoaderCircle
    : needsChoice
      ? AlertTriangle
      : CheckCircle2;
  const status = busy
    ? "Applying adapter"
    : needsChoice
      ? "Choose adapter"
      : selection.mode === "manual"
        ? "Manual"
        : "Automatic";
  const activeCandidate = selection.candidates.find(
    (candidate) => candidate.id === selection.adapterId,
  );
  const selectionMode =
    selection.mode === "unresolved"
      ? "Needs choice"
      : selection.mode === "manual"
        ? "Manual override"
        : "Automatic";

  return (
    <section
      className={`timelog-adapter-control ${variant} ${needsChoice ? "needs-choice" : ""}`}
      aria-label="Time-log decoder adapter"
    >
      <div className="timelog-adapter-heading">
        <span className="timelog-adapter-icon">
          <Cpu size={15} />
        </span>
        <div>
          <small>DECODER ADAPTER</small>
          <strong>{selection.adapterLabel ?? "No adapter selected"}</strong>
        </div>
        <span className={`adapter-status ${selection.mode}`} aria-live="polite">
          <StatusIcon size={11} className={busy ? "spin" : undefined} />
          {status}
        </span>
      </div>
      <label className="timelog-adapter-select">
        <span>Adapter selection</span>
        <select
          value={selectValue}
          disabled={busy}
          onChange={(event) =>
            onSelectAdapter(
              event.target.value === "automatic"
                ? undefined
                : event.target.value,
            )
          }
        >
          <option value="automatic">Automatic selection (recommended)</option>
          {selection.candidates.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
              disabled={!candidate.compatible}
            >
              {candidate.label} · {candidate.score}/100
              {!candidate.compatible ? " · unavailable" : ""}
            </option>
          ))}
        </select>
      </label>
      <p>{selection.reason}</p>
      {variant === "inspector" && (
        <>
          <dl className="adapter-selection-summary">
            <div>
              <dt>Selection mode</dt>
              <dd>{selectionMode}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{selection.confidence}</dd>
            </div>
            <div>
              <dt>Active score</dt>
              <dd>{activeCandidate ? `${activeCandidate.score}/100` : "—"}</dd>
            </div>
            <div>
              <dt>Declared layout</dt>
              <dd>Type {timeLog.timeLogType}</dd>
            </div>
            <div>
              <dt>Decoded records</dt>
              <dd>{timeLog.decodedRecordCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Decoded bytes</dt>
              <dd>
                {timeLog.decodedByteLength.toLocaleString()} /{" "}
                {timeLog.binaryLength.toLocaleString()}
              </dd>
            </div>
            <div className="wide">
              <dt>Companion template</dt>
              <dd title={timeLog.headerFilename}>{timeLog.headerFilename}</dd>
            </div>
            <div className="wide">
              <dt>Binary source</dt>
              <dd title={timeLog.filename}>{timeLog.filename}</dd>
            </div>
          </dl>
          <div className="adapter-candidate-list">
            <div className="adapter-candidate-title">
              <span>REGISTERED ADAPTER EVIDENCE</span>
              <b>{selection.candidates.length}</b>
            </div>
            {selection.candidates.map((candidate) => (
              <article
                className={`adapter-candidate-card ${
                  candidate.id === selection.adapterId ? "selected" : ""
                } ${candidate.compatible ? "compatible" : "unavailable"}`}
                key={candidate.id}
              >
                <header>
                  <div>
                    <strong>{candidate.label}</strong>
                    <small>{candidate.description}</small>
                  </div>
                  <span>{candidate.score}/100</span>
                </header>
                <div className="adapter-candidate-flags">
                  {candidate.id === selection.adapterId && <b>SELECTED</b>}
                  <b>{candidate.compatible ? "COMPATIBLE" : "UNAVAILABLE"}</b>
                  <b>
                    {candidate.autoSelectable ? "AUTO ELIGIBLE" : "MANUAL ONLY"}
                  </b>
                </div>
                <p>{candidate.reason}</p>
              </article>
            ))}
          </div>
        </>
      )}
      {needsChoice &&
        selection.candidates.some((candidate) => candidate.compatible) && (
          <div className="adapter-choice-note">
            The source is unchanged. Selecting an adapter only changes how its
            retained binary records are interpreted.
          </div>
        )}
    </section>
  );
}

interface TimeLogAdapterWorkspaceProps {
  timeLog: DecodedTimeLog;
  onSelectAdapter: (adapterId?: string) => void;
  busy?: boolean;
}

export function TimeLogAdapterWorkspace({
  timeLog,
  onSelectAdapter,
  busy,
}: TimeLogAdapterWorkspaceProps) {
  return (
    <main className="workspace-loading adapter-workspace">
      <Cpu size={30} />
      <strong>No decoded executed channel is available yet</strong>
      <span>
        Review the automatic match or choose a compatible decoder for{" "}
        {timeLog.id}.
      </span>
      <TimeLogAdapterControl
        timeLog={timeLog}
        onSelectAdapter={onSelectAdapter}
        busy={busy}
        variant="workspace"
      />
    </main>
  );
}
