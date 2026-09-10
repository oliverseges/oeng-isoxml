"use client";

import { createI18n } from "@/lib/client/i18n";
import type { DecodedTimeLog } from "@/lib/isoxml/types";
import { AlertTriangle, CheckCircle2, Cpu, LoaderCircle } from "lucide-react";
import { useViewerStore } from "./store";

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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
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
    ? i18n.t("Applying adapter")
    : needsChoice
      ? i18n.t("Choose adapter")
      : selection.mode === "manual"
        ? i18n.t("Manual")
        : i18n.t("Automatic");
  const activeCandidate = selection.candidates.find(
    (candidate) => candidate.id === selection.adapterId,
  );
  const selectionMode =
    selection.mode === "unresolved"
      ? i18n.t("Needs choice")
      : selection.mode === "manual"
        ? i18n.t("Manual override")
        : i18n.t("Automatic");

  return (
    <section
      className={`timelog-adapter-control ${variant} ${needsChoice ? "needs-choice" : ""}`}
      aria-label={i18n.t("Time-log decoder adapter")}
    >
      <div className="timelog-adapter-heading">
        <span className="timelog-adapter-icon">
          <Cpu size={15} />
        </span>
        <div>
          <small>{i18n.t("Decoder adapter").toUpperCase()}</small>
          <strong>{selection.adapterLabel ?? i18n.t("No adapter selected")}</strong>
        </div>
        <span className={`adapter-status ${selection.mode}`} aria-live="polite">
          <StatusIcon size={11} className={busy ? "spin" : undefined} />
          {status}
        </span>
      </div>
      <label className="timelog-adapter-select">
        <span>{i18n.t("Adapter selection")}</span>
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
          <option value="automatic">{i18n.t("Automatic selection (recommended)")}</option>
          {selection.candidates.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
              disabled={!candidate.compatible}
            >
              {candidate.label} · {candidate.score}/100
              {!candidate.compatible ? ` · ${i18n.t("unavailable")}` : ""}
            </option>
          ))}
        </select>
      </label>
      <p>{selection.reason}</p>
      {variant === "inspector" && (
        <>
          <dl className="adapter-selection-summary">
            <div>
              <dt>{i18n.t("Selection mode")}</dt>
              <dd>{selectionMode}</dd>
            </div>
            <div>
              <dt>{i18n.t("Confidence")}</dt>
              <dd>{i18n.t(selection.confidence)}</dd>
            </div>
            <div>
              <dt>{i18n.t("Active score")}</dt>
              <dd>{activeCandidate ? `${activeCandidate.score}/100` : "—"}</dd>
            </div>
            <div>
              <dt>{i18n.t("Declared layout")}</dt>
              <dd>{i18n.t("Type")} {timeLog.timeLogType}</dd>
            </div>
            <div>
              <dt>{i18n.t("Decoded records")}</dt>
              <dd>{i18n.formatInteger(timeLog.decodedRecordCount)}</dd>
            </div>
            <div>
              <dt>{i18n.t("Decoded bytes")}</dt>
              <dd>
                {i18n.formatInteger(timeLog.decodedByteLength)} /{" "}
                {i18n.formatInteger(timeLog.binaryLength)}
              </dd>
            </div>
            <div className="wide">
              <dt>{i18n.t("Companion template")}</dt>
              <dd title={timeLog.headerFilename}>{timeLog.headerFilename}</dd>
            </div>
            <div className="wide">
              <dt>{i18n.t("Binary source")}</dt>
              <dd title={timeLog.filename}>{timeLog.filename}</dd>
            </div>
          </dl>
          <div className="adapter-candidate-list">
            <div className="adapter-candidate-title">
              <span>{i18n.t("Registered adapter evidence").toUpperCase()}</span>
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
                  {candidate.id === selection.adapterId && <b>{i18n.t("Selected").toUpperCase()}</b>}
                  <b>{i18n.t(candidate.compatible ? "Compatible" : "Unavailable").toUpperCase()}</b>
                  <b>
                    {i18n.t(candidate.autoSelectable ? "Auto eligible" : "Manual only").toUpperCase()}
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
            {i18n.t(
              "The source is unchanged. Selecting an adapter only changes how its retained binary records are interpreted.",
            )}
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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);

  return (
    <main className="workspace-loading adapter-workspace">
      <Cpu size={30} />
      <strong>{i18n.t("No decoded executed channel is available yet")}</strong>
      <span>
        {i18n.t("Review the automatic match or choose a compatible decoder for")} {timeLog.id}.
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
