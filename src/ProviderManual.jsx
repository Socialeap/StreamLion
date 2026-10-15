import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  X,
  ChevronDown,
  ArrowRight,
  Cloud,
  SlidersHorizontal,
  Share2,
  FileText,
  MessagesSquare,
  Handshake,
  CalendarDays,
  ClipboardCheck,
  WifiOff,
  Camera,
  Ruler,
  TriangleAlert,
  Save,
  Send,
  Repeat2,
  Check,
  KeyRound,
  DoorOpen,
  Link,
} from "lucide-react";
import { MANUAL_STAGES } from "./provider-manual.js";
import { AppHeader, SectionNavigation } from "./AppNavigation.jsx";

const icons = {
  cloud: Cloud,
  sliders: SlidersHorizontal,
  share: Share2,
  file: FileText,
  messages: MessagesSquare,
  agreement: Handshake,
  calendar: CalendarDays,
  checklist: ClipboardCheck,
  offline: WifiOff,
  camera: Camera,
  ruler: Ruler,
  warning: TriangleAlert,
  save: Save,
  send: Send,
  repeat: Repeat2,
};

function Example({ kind }) {
  const rows = {
    intake: [
      [Share2, "One public form", "Share the link or QR"],
      [
        FileText,
        "One private request per submission",
        "Each customer's details stay separate",
      ],
    ],
    agreement: [
      [Camera, "Scope", "Capture lobby and meeting room"],
      [CalendarDays, "Visit", "Tuesday, 10:00 · America/New_York"],
      [FileText, "Outputs", "Tour link and two room dimensions"],
    ],
    tasks: [
      [FileText, "Brief", "Capture the lobby; measure the doorway"],
      [
        ClipboardCheck,
        "Reviewed tasks",
        "Lobby capture + doorway tape reading",
      ],
    ],
    measurement: [
      [Ruler, "Ground floor · Lobby", "Doorway width: 36 7/16 in"],
      [Link, "Linked requirement", "Lobby doorway tape reading"],
    ],
    departure: [
      [Check, "Lobby capture · Checked", "Evidence reviewed"],
      [
        DoorOpen,
        "Meeting room · Blocked",
        "Locked on arrival. Next: arrange access with site contact.",
      ],
    ],
    handover: [
      [Send, "Delivery", "Sent to customer"],
      [Handshake, "Acceptance", "Waiting for customer review"],
      [FileText, "Payment", "Check your payment records separately"],
    ],
  }[kind];
  return (
    <figure className="manual-example">
      <figcaption>Example · illustrative only</figcaption>
      <div className="manual-example-rows">
        {rows.map(([Icon, label, text]) => (
          <div key={label}>
            <Icon size={22} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <span>{text}</span>
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function ProviderManual({
  onClose,
  returnFocusElement,
  account = "",
  connected = false,
  onHome,
  onAccount,
  disabled = false,
  bookId,
  verified,
}) {
  const dialog = useRef(null);
  const stages = useRef([]);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = returnFocusElement || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector('[aria-label="Close provider manual"]')?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [returnFocusElement]);

  function openStage(index) {
    const stage = stages.current[index];
    stage.open = true;
    stage.querySelector("summary").focus({ preventScroll: true });
    stage.scrollIntoView({ block: "start" });
  }
  function home() {
    if (disabled) return;
    onClose();
    if (onHome) onHome();
    else window.location.assign("/?page=Projects");
  }
  function accountPage() {
    if (disabled) return;
    onClose();
    if (onAccount) onAccount();
    else window.location.assign("/?page=Account");
  }
  function expandAll(open) {
    for (const detail of dialog.current.querySelectorAll("details"))
      detail.open = open;
  }

  return createPortal(
    <dialog
      className="provider-manual"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <AppHeader
        manual={false}
        account={account}
        connected={connected}
        onHome={home}
        onAccount={accountPage}
        disabled={disabled}
        bookId={bookId}
        verified={verified}
      />
      <div className="manual-close-row">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close provider manual"
          autoFocus
        >
          <X size={20} aria-hidden="true" /> Close manual
        </button>
      </div>
      <div className="manual-content">
        <div className="manual-intro">
          <h1 id={titleId}>One job, from request to handover.</h1>
          <p>
            Know what to do next, where to do it, and how it helps. Open a
            numbered stage, then choose a step for practical guidance.
          </p>
          <p className="manual-context">
            Use StreamLion alongside your scan, photography and tour tools.
            Browse this guide freely; your project stays open behind it.
          </p>
          <button
            type="button"
            className="manual-primary"
            onClick={() => openStage(0)}
          >
            Start walkthrough <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="manual-toolbar">
          <span>
            {MANUAL_STAGES.length} stages · follow in order or jump to what you
            need
          </span>
          <div>
            <button type="button" onClick={() => expandAll(true)}>
              Expand all
            </button>
            <button type="button" onClick={() => expandAll(false)}>
              Collapse all
            </button>
          </div>
        </div>
        <ol className="manual-stages">
          {MANUAL_STAGES.map((stage, index) => (
            <li key={stage.id}>
              <details
                className="manual-stage"
                id={`${titleId}-${stage.id}`}
                ref={(el) => {
                  stages.current[index] = el;
                }}
              >
                <summary tabIndex={0}>
                  <span className="manual-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="manual-stage-title">
                    <h2>
                      <span className="manual-sr-only">
                        Stage {index + 1}:{" "}
                      </span>
                      {stage.title}
                    </h2>
                    <span>{stage.summary}</span>
                  </span>
                  <ChevronDown
                    className="manual-chevron"
                    size={22}
                    aria-hidden="true"
                  />
                </summary>
                <div className="manual-stage-body">
                  <ol className="manual-steps">
                    {stage.steps.map((step, subIndex) => {
                      const Icon = icons[step.icon];
                      return (
                        <li key={step.title}>
                          <details className="manual-step">
                            <summary>
                              <Icon
                                className="manual-step-icon"
                                size={22}
                                aria-hidden="true"
                              />
                              <h3>
                                <span className="manual-sr-only">
                                  {index + 1}.{subIndex + 1}:{" "}
                                </span>
                                {step.title}
                              </h3>
                              <ChevronDown
                                className="manual-chevron"
                                size={18}
                                aria-hidden="true"
                              />
                            </summary>
                            <div className="manual-step-body">
                              <p className="manual-where">
                                <strong>Where to go</strong>
                                {step.where}
                              </p>
                              <p>{step.action}</p>
                              <p className="manual-benefit">
                                <strong>Why it helps</strong>
                                {step.benefit}
                              </p>
                              {step.illustration && (
                                <Example kind={step.illustration} />
                              )}
                              {step.tip && (
                                <p className="manual-tip">
                                  <strong>Keep in mind</strong>
                                  {step.tip}
                                </p>
                              )}
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="manual-stage-end">
                    <p>
                      <Check size={19} aria-hidden="true" />
                      <span>
                        <strong>Ready to move on when</strong>
                        {stage.outcome}
                      </span>
                    </p>
                    {index < MANUAL_STAGES.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => openStage(index + 1)}
                      >
                        Next: {MANUAL_STAGES[index + 1].title}
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    ) : (
                      <button type="button" onClick={onClose}>
                        Return to your work
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ol>
        <footer className="manual-footer">
          <KeyRound size={20} aria-hidden="true" />
          <p>
            This guide does not change your records, send invitations or use
            credits. Use the actual project controls to complete and save each
            step.
          </p>
        </footer>
      </div>
      <SectionNavigation
        disabled={disabled}
        onHome={home}
        sections={MANUAL_STAGES.map((stage, index) => ({
          id: `${titleId}-${stage.id}`,
          label: [
            "Setup",
            "Receive",
            "Agree",
            "Prepare",
            "Capture",
            "Check",
            "Deliver",
          ][index],
          title: stage.title,
          icon: [
            Cloud,
            FileText,
            Handshake,
            ClipboardCheck,
            Camera,
            Send,
            Repeat2,
          ][index],
          onSelect: () => openStage(index),
        }))}
      />
    </dialog>,
    document.body,
  );
}

export default function ProviderManualButton(props = {}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="provider-manual-trigger"
        aria-label="Open provider manual"
        disabled={props.disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        title="Follow a job from request to handover"
      >
        <BookOpen size={20} aria-hidden="true" />
        <span>Provider manual</span>
      </button>
      {open && (
        <ProviderManual
          {...props}
          onClose={() => setOpen(false)}
          returnFocusElement={trigger.current}
        />
      )}
    </>
  );
}
