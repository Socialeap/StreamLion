import { useState } from "react";
import { CircleHelp } from "lucide-react";

export const GROUP_HELP = {
  Project:
    "Name the job and record its original reference number and size estimates.",
  Location:
    "Where the capture work will take place. Include the unit when provided.",
  Contacts: "People who requested, coordinate, or perform the site visit.",
  Schedule: "Record confirmed appointments separately from proposed times.",
  Scope: "What to capture, what to leave out, and what must be delivered.",
  Money: "Keep quoted, agreed, invoiced, and received amounts separate.",
  Documents:
    "Links to reference material, source files, and the project folder.",
  Review:
    "Keep track of where details came from and what still needs confirmation.",
};

export const FIELD_HELP = {
  title:
    "A short name you will recognize in the project list. Required to save.",
  reference:
    "The customer's or provider's original project number. Preserve it exactly.",
  companyName: "Company that commissioned or requested the capture work.",
  propertySizeSqFt: "Approximate property area in square feet, if stated.",
  approxHours: "Estimated hours for the full job, including off-site work.",
  siteHours: "Estimated hours physically spent at the site.",
  address: "Street address of the capture location.",
  address2: "Suite, floor, unit, or other address detail.",
  city: "City of the capture location.",
  region: "State, province, or region of the capture location.",
  postal: "ZIP or postal code of the capture location.",
  country: "Country of the capture location.",
  requesterName: "Person who asked for the project.",
  requesterEmail: "Email address for the person who requested the work.",
  contact1Name: "First person to contact at the site.",
  contact1Phone: "Phone number for the first on-site contact.",
  contact2Name: "Second person to contact at the site, if any.",
  contact2Phone: "Phone number for the second on-site contact.",
  providerName: "Person or company performing the capture.",
  providerEmail: "Email address for the capture provider.",
  startLocal: "Confirmed start date and local time for the visit.",
  endLocal:
    "Confirmed end date and time only. Leave blank when merely estimated.",
  timeZone: "The location's time zone, such as America/New_York.",
  appointmentStatus: "Whether a visit is proposed or confirmed.",
  proposedTimes: "Possible visit times that have not been confirmed.",
  scope: "The exact work requested by the customer.",
  exclusions: "Areas or tasks specifically outside this job.",
  accessInstructions: "Entry, escort, parking, and site access details.",
  deliverables: "Files, scans, photos, or other items that must be delivered.",
  deliveryDeadline: "Deadline in the source's own words. Do not infer a date.",
  deliveryDestination: "Where and how the finished work must be sent.",
  notes: "Other useful project instructions that do not fit above.",
  offeredFee: "Amount offered or quoted; this is not a payment received.",
  agreedFee: "Amount accepted by both sides, if confirmed.",
  currency: "Three-letter currency code, such as USD.",
  invoiceAmount: "Amount actually invoiced to the customer.",
  paidAmount: "Amount actually received, including partial payments.",
  paidDate: "Date payment was received.",
  dueDate: "Confirmed date payment is due.",
  paymentTerms: "Payment timing and conditions, such as net 30 after delivery.",
  reference1Name: "Name of the first reference image or document.",
  reference1Url: "Link to the first reference image or document.",
  reference2Name: "Name of the second reference image or document.",
  reference2Url: "Link to the second reference image or document.",
  document1Name: "Name of an additional project document.",
  document1Url: "Link to that project document.",
  document2Name: "Name of a second additional document.",
  document2Url: "Link to that second document.",
  driveFolderUrl: "Link to the project's Google Drive folder, if one exists.",
  otherDocuments: "Other file names and links needed for this job.",
  sourceNotes:
    "Which document, email, page, or passage supports important details.",
  unresolved:
    "Questions, missing facts, and conflicting statements to resolve.",
};

export default function HelpTip({ label, text }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="help-tip"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="help-tip-button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        title={text}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {open && (
        <span className="help-tip-content" role="note">
          {text}
        </span>
      )}
    </span>
  );
}
