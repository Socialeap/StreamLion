import { useEffect, useId, useRef, useState } from "react";
import {
  FileText,
  NotebookPen,
  Ruler,
  MessageCircle,
  Link,
  Home,
  List,
  X,
  LayoutList,
  Archive,
  Download,
  UserRound,
  Image as ImageIcon,
  Calculator,
} from "lucide-react";
import ThemeSwitch from "./ThemeSwitch.jsx";
import ProviderManualButton from "./ProviderManual.jsx";
import AccountStatus from "./AccountStatus.jsx";

export function AppHeader({
  account = "",
  connected = false,
  checking = false,
  error,
  onAccount,
  onHome,
  manual = true,
  disabled = false,
  children,
  accountLabel,
  bookId,
  verified,
}) {
  const home = (event) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (onHome) {
      event.preventDefault();
      onHome();
    }
  };
  return (
    <header className="workspace-header" aria-label="StreamLion header">
      <a
        className="workspace-brand"
        href="/?page=Projects"
        onClick={home}
        aria-label="StreamLion Projects"
        aria-disabled={disabled || undefined}
      >
        <span className="workspace-lion" aria-hidden="true" />
        <span className="workspace-wordmark">StreamLion</span>
      </a>
      <div className="workspace-header-tools">
        {children}
        {manual && (
          <ProviderManualButton
            account={account}
            connected={connected}
            onHome={onHome}
            onAccount={onAccount}
            disabled={disabled}
            bookId={bookId}
            verified={verified}
          />
        )}
        <ThemeSwitch />
        <AccountStatus
          account={account}
          connected={connected}
          checking={checking}
          error={error}
          disabled={disabled}
          accountLabel={accountLabel}
          bookId={bookId}
          verified={verified}
          onOpen={onAccount || (() => window.location.assign("/?page=Account"))}
        />
      </div>
    </header>
  );
}

const destinations = [
  [FileText, "Projects", "Projects"],
  [NotebookPen, "Field notes", "Field notes"],
  [Ruler, "Measurements", "Measure"],
  [MessageCircle, "Ask", "Ask"],
  [Link, "Connections", "Connections"],
  [FileText, "Client requests", "Client requests"],
];
export function BottomNavigation({ page, onNavigate, disabled = false }) {
  return (
    <nav className="workspace-bottom-nav" aria-label="Main">
      {destinations.map(([Icon, target, label]) => {
        const contents = (
          <>
            <Icon size={21} aria-hidden="true" />
            <span
              className={
                target === "Connections" ? "nav-wide-label" : undefined
              }
            >
              {label}
            </span>
            {target === "Connections" && (
              <span className="nav-short-label" aria-hidden="true">
                Connect
              </span>
            )}
          </>
        );
        const props = {
          "aria-label": target,
          "aria-current": page === target ? "page" : undefined,
          className: page === target ? "active" : undefined,
        };
        return onNavigate && target !== "Client requests" ? (
          <button
            key={target}
            {...props}
            disabled={disabled}
            onClick={() => onNavigate(target)}
          >
            {contents}
          </button>
        ) : (
          <a
            key={target}
            {...props}
            aria-disabled={disabled || undefined}
            href={
              target === "Client requests"
                ? "/api/client-requests"
                : `/?page=${encodeURIComponent(target)}`
            }
            onClick={(event) => {
              if (disabled) event.preventDefault();
            }}
          >
            {contents}
          </a>
        );
      })}
    </nav>
  );
}

export function SectionNavigation({ sections = [], onHome, disabled = false }) {
  const [active, setActive] = useState(""),
    [expanded, setExpanded] = useState(false);
  const dialog = useRef(null),
    overflow = useRef(null),
    scheduled = useRef(null);
  const title = useId();
  useEffect(() => () => clearTimeout(scheduled.current), []);
  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current;
    if (element.showModal) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      element.close?.();
      overflow.current?.focus();
    };
  }, [expanded]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries
          .filter((item) => item.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (entry) setActive(entry.target.id);
      },
      { rootMargin: "-70px 0px -60% 0px", threshold: 0 },
    );
    sections.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sections]);
  function select(section) {
    section.onSelect?.();
    setActive(section.id);
    setExpanded(false);
    clearTimeout(scheduled.current);
    scheduled.current = setTimeout(() => {
      const target = document.getElementById(section.id);
      if (!target) return;
      for (
        let parent = target.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.tagName === "DETAILS") parent.open = true;
      target.scrollIntoView?.({ block: "start", behavior: "auto" });
      if (!target.hasAttribute("tabindex"))
        target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }, 0);
  }
  const sectionButton = (section, inList = false) => {
    const Icon = section.icon || LayoutList;
    return (
      <button
        key={section.id}
        type="button"
        disabled={disabled}
        aria-label={`Go to ${section.label}`}
        title={section.title || section.label}
        aria-current={active === section.id ? "location" : undefined}
        onClick={() => select(section)}
      >
        <Icon size={21} aria-hidden="true" />
        <span>{inList ? section.title || section.label : section.label}</span>
        {inList && active === section.id && <small>Current</small>}
      </button>
    );
  };
  return (
    <>
      <nav
        className="workspace-bottom-nav workspace-section-nav"
        aria-label="Page sections"
      >
        {onHome ? (
          <button
            type="button"
            aria-label="Home"
            disabled={disabled}
            onClick={onHome}
          >
            <Home size={21} aria-hidden="true" />
            <span>Home</span>
          </button>
        ) : (
          <a
            href="/?page=Projects"
            aria-label="Home"
            aria-disabled={disabled || undefined}
            onClick={(event) => {
              if (disabled) event.preventDefault();
            }}
          >
            <Home size={21} aria-hidden="true" />
            <span>Home</span>
          </a>
        )}
        {(sections.length > 4 ? sections.slice(0, 3) : sections).map(
          (section) => sectionButton(section),
        )}
        {sections.length > 4 && (
          <button
            type="button"
            ref={overflow}
            disabled={disabled}
            onClick={() => setExpanded(true)}
            aria-haspopup="dialog"
            aria-label={`Sections: all ${sections.length} page sections`}
          >
            <List size={21} aria-hidden="true" />
            <span>
              Sections <small>{sections.length}</small>
            </span>
          </button>
        )}
      </nav>
      {expanded && (
        <dialog
          className="section-directory"
          ref={dialog}
          aria-labelledby={title}
          onCancel={(event) => {
            event.preventDefault();
            setExpanded(false);
          }}
        >
          <header>
            <h2 id={title}>Page sections</h2>
            <button
              type="button"
              autoFocus
              onClick={() => setExpanded(false)}
              aria-label="Close sections"
            >
              <X size={21} />
            </button>
          </header>
          <div className="section-directory-list">
            {sections.map((section) => sectionButton(section, true))}
          </div>
        </dialog>
      )}
    </>
  );
}

export function usePageSections(root, scope, enabled = true) {
  const [sections, setSections] = useState([]);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) {
      setSections([]);
      return;
    }
    function update() {
      const next = [...element.querySelectorAll("h2, h3[data-page-section]")]
        .filter(
          (heading) =>
            !heading.closest("[hidden],dialog,.sr-only,.page-head") &&
            !heading.classList.contains("sr-only"),
        )
        .map((heading, index) => {
          if (!heading.id) heading.id = `${prefix}-section-${index}`;
          const title = heading.textContent.replace(/\s+/g, " ").trim();
          const label =
            {
              "Sign-in and security": "Security",
              "Setup assistant": "Setup",
              "Your business branding": "Branding",
              "Pricing & Estimates": "Pricing",
              "Rates & tiers": "Rates",
              "Named extras": "Extras",
              "Client budgets": "Budget",
              "Try your calculation": "Preview",
              "Keep StreamLion on your home screen": "Install",
              "Google Sheets & Drive": "Google",
              "Site copy on this device": "Offline copy",
              "Keep a device backup": "Backup",
              "Help & privacy": "Help",
            }[title] || title;
          const icon = /pricing|rates|budget|preview/i.test(label)
            ? Calculator
            : /branding/i.test(label)
              ? ImageIcon
              : /backup/i.test(label)
                ? Archive
                : /google|connection/i.test(label)
                  ? Link
                  : /install|download/i.test(label)
                    ? Download
                    : /account|security/i.test(label)
                      ? UserRound
                      : /note/i.test(label)
                        ? NotebookPen
                        : LayoutList;
          return { id: heading.id, label, title, icon };
        })
        .filter((section) => section.label);
      setSections((old) =>
        old.length === next.length &&
        old.every(
          (item, i) => item.id === next[i].id && item.label === next[i].label,
        )
          ? old
          : next,
      );
    }
    update();
    const Observer = element.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(update) : null;
    observer?.observe(element, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, [root, scope, enabled, prefix]);
  return sections;
}
