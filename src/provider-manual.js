// Keep labels and guidance aligned with the provider controls in Core and
// CoordinationPortal. Examples are teaching aids, never live project state.
export const MANUAL_STAGES = [
  {
    id: "workspace",
    title: "Set up your workspace",
    summary: "One-time setup · give your jobs a reliable home.",
    outcome: "You know which account, workbook and device hold your work.",
    steps: [
      {
        icon: "cloud",
        title: "Connect Google and choose a workbook",
        where: "Connections → Google Sheets & Drive",
        action:
          "Connect your Google account, then create or open a StreamLion workbook. Check the selected workbook before adding a job. Sheets holds your project records; Drive holds linked files.",
        benefit:
          "Open the same verified records from another connected device without re-entering the brief.",
        tip: "A device workspace or an unsent draft stays on that device. A remembered workbook name does not mean Google is connected.",
      },
      {
        icon: "sliders",
        title: "Prepare your client request settings",
        where:
          "Client requests → Enable your client workspace / Service intake templates",
        action:
          "Set your business name, logo, logo shape and website in Account → Your business branding. Publish default or named service pricing in Account → Pricing & Estimates; choose a profile in each service template. If client coordination is available to your account, complete the setup shown there. Review the service questions your customers will answer, including required details and conditional questions.",
        benefit:
          "Ask for the information your service needs before you spend time chasing it.",
        tip: "An existing request keeps its template version. Editing a template changes future requests. If coordination is unavailable, you can still create a project in Projects.",
      },
    ],
  },
  {
    id: "intake",
    title: "Receive the request",
    summary: "Bring the customer's needs into one clear brief.",
    outcome: "A request or project exists with enough detail to review.",
    steps: [
      {
        icon: "share",
        title: "Share a form or invite a known client",
        where: "Client requests → Invite a client",
        action:
          "Check “Request goes to” shows your business, then create your own public form link and share its link or QR code. A copied link always belongs to its original provider; a template never changes that recipient. Pricing comes from your published profile. Optional TM sample rates can be loaded, edited and explicitly published from Account. Update an existing form’s pricing explicitly for future requests; submitted estimates stay unchanged. Each submission creates a separate private request. For a known customer, use the private invitation option instead.",
        benefit:
          "Collect enquiries from a website, a message or an in-person conversation in the same workflow.",
        tip: "Public forms do not require an email by default; verification can be enabled. Without email, the customer must keep the private status link shown after submission. Creating a form or request uses no project credits.",
        illustration: "intake",
      },
      {
        icon: "file",
        title: "Already have a brief? Start a project directly",
        where: "Projects → Create project → Start",
        action:
          "Use the brief import options or choose Enter details myself. Work through Project, Location, People, Visit, Work, Payment and Files; review at Finish. Leave genuinely unknown details blank and resolve them with the customer.",
        benefit:
          "Turn an email or existing brief into an organized project without asking the customer to start again.",
        tip: "Review imported facts against the original. A project you enter yourself does not create a client agreement or invitation.",
      },
    ],
  },
  {
    id: "agreement",
    title: "Clarify and agree the work",
    summary: "Set expectations before confirming the job.",
    outcome: "Both sides understand the work, visit, fee and required outputs.",
    steps: [
      {
        icon: "messages",
        title: "Fill the gaps before agreeing",
        where: "Client requests → Select a request → Brief / Updates",
        action:
          "Review the address, site contact, access, scope, exclusions, requested outputs, visit time and time zone, fee and delivery requirements. Ask questions in What needs attention and read the customer's answers and reference files.",
        benefit:
          "Catch a locked room, missing plan or unclear output before it becomes an extra visit.",
        tip: "A preliminary estimate does not confirm availability, authorize work or collect a deposit.",
        illustration: "agreement",
      },
      {
        icon: "agreement",
        title: "Approve the work order deliberately",
        where: "Client requests → Agreement → Approve & authorize job credits",
        action:
          "Check the final terms and the displayed job-credit charge before approving. The customer must also agree. Wait for confirmation before treating the request as an agreed job and opening it in the field workspace.",
        benefit:
          "The accepted brief becomes a shared reference for the visit and delivery.",
        tip: "After agreement, change scope, fees or other material terms through Client requests and have both sides accept the revision. Editing project details in the field workspace does not replace that agreement.",
      },
    ],
  },
  {
    id: "prepare",
    title: "Prepare for the visit",
    summary: "Turn the brief into work you can check on site.",
    outcome:
      "Your visit details, reference files and area-by-area checklist are ready.",
    steps: [
      {
        icon: "calendar",
        title: "Check where, when and how to get in",
        where: "Projects → Open project → Prepare",
        action:
          "Confirm Your next visit and Getting inside. Check the site contact, appointment status, time zone and exclusions. Use Directions or the contact's phone link when needed, and open the project folder to review relevant plans.",
        benefit:
          "Arrive at the right entrance with the right person expecting you.",
      },
      {
        icon: "checklist",
        title: "Build and review the site checklist",
        where: "Project → Prepare → Brief to site tasks",
        action:
          "Paste the brief or open a readable PDF/text file. Review the suggested tasks against their source wording. Give each task a useful area, choose its type, correct omissions and select only the tasks you need. Add them to the checklist and save it.",
        benefit:
          "A broad request becomes specific capture, measurement and delivery tasks you can track.",
        tip: "Brief reading happens on your device. Suggestions need your review; they cannot confirm that a room was scanned.",
        illustration: "tasks",
      },
      {
        icon: "offline",
        title: "Prepare for a weak connection",
        where: "Project → Prepare → Prepare for a weak connection",
        action:
          "While connected, keep a dated site copy on the device you will take. Open the project before leaving. Download any reference files you need separately and keep important originals backed up.",
        benefit:
          "Refer to the saved brief and keep new field records waiting locally until you reconnect.",
        tip: "The site copy is read-only and does not include every Drive attachment. Client request actions need a connection. Browser storage can be cleared, so keep a separate backup of important work.",
      },
    ],
  },
  {
    id: "capture",
    title: "Capture and record on site",
    summary: "Keep evidence attached to the right project and area.",
    outcome:
      "Your field record explains what you captured, measured or could not access.",
    steps: [
      {
        icon: "camera",
        title: "Use your capture tools; record the context here",
        where: "Project → On site → Add a field record / Field notes",
        action:
          "Do the scan or photography in your normal capture platform. In StreamLion, choose the correct project and name the area before saving notes, a photo or a voice memo. Review the wording and evidence before marking the related checklist item Checked.",
        benefit:
          "Keep the explanation behind each room or task beside the brief instead of in scattered messages.",
        tip: "StreamLion organizes the job; it does not operate the scanner or host the finished tour. Field attachments are for evidence, rather than full raw scan storage.",
      },
      {
        icon: "ruler",
        title: "Keep measurements exact and easy to find",
        where: "Measurements → Choose project → Floor / room",
        action:
          "Type or dictate the reading with its unit, floor and room. Check the saved wording against the actual measurement, especially fractions. Attach the measurement evidence to the matching requirement.",
        benefit:
          "Find the right dimension later without guessing which room or unit it belongs to.",
        tip: "A saved reading records what you entered; it does not certify measurement accuracy.",
        illustration: "measurement",
      },
      {
        icon: "messages",
        title: "Ask for a saved detail while you work",
        where: "Ask → Select project",
        action:
          "Ask about the visit, access instructions, scope or other saved details. Check the answer's source and freshness. Use voice input or Read aloud when your browser supports them; typing remains available.",
        benefit:
          "Recover a fact from the brief without searching through the whole project.",
        tip: "Saved-detail lookup is separate from optional AI. Review AI settings and the displayed credit cost before enabling it, and check its answer against the source. This manual itself uses no AI credits.",
      },
      {
        icon: "warning",
        title: "Record an exception as soon as it happens",
        where: "Project → On site → Site exception / Work checklist",
        action:
          "Record the affected area, why work is blocked and the next action. Link a useful field record. Use Blocked for unfinished work and Not needed only when appropriate; record the reason.",
        benefit:
          "Make the limitation visible so an unfinished task does not look complete.",
      },
    ],
  },
  {
    id: "check",
    title: "Check before leaving",
    summary: "Resolve omissions while you can still do something about them.",
    outcome: "Outstanding work is resolved or has a clear, recorded follow-up.",
    steps: [
      {
        icon: "checklist",
        title: "Review every outstanding item",
        where: "Project → Before leaving",
        action:
          "Read Before leaving job-site. Check requested areas, measurements and supporting evidence against what you actually did. Fix missing work while access is available, or record a blocked reason and a concrete next action.",
        benefit:
          "Spot a missed room or missing reading before the journey home.",
        tip: "No outstanding items means this checklist is clear. It does not verify scan coverage, image quality or geometry; inspect those in your capture tools.",
        illustration: "departure",
      },
      {
        icon: "save",
        title: "Save the checklist and verify waiting records",
        where: "Project → Before leaving / Waiting field records",
        action:
          "Record site lessons and agreed exceptions, acknowledge unresolved items if required, and save the checklist. When online, reconnect to the same Google account and workbook, send waiting records and wait for verified saves. Keep originals until you have checked them.",
        benefit:
          "Know which work is confirmed in Google and which still needs recovery on this device.",
        tip: "A local draft or waiting record is not a shared Google save. If a save is uncertain, use the recovery/retry control for that operation rather than creating a duplicate.",
      },
    ],
  },
  {
    id: "deliver",
    title: "Deliver and follow up",
    summary: "Finish with clear outputs and a trustworthy job history.",
    outcome:
      "Delivery, customer acceptance and payment each have their own record.",
    steps: [
      {
        icon: "send",
        title: "Prepare the handover and deliver the outputs",
        where:
          "Project → Delivery → Download delivery summary / Handover report",
        action:
          "Finish processing in your capture tools. Add the final output links and review the delivery tasks, evidence and exceptions. Download the summary or prepare a handover report, then send the actual agreed outputs to the customer through your chosen delivery channel.",
        benefit:
          "Give the customer a clear record of what was completed and what still needs attention.",
        tip: "Downloading a report does not send it. Check that the customer's links and file permissions work.",
      },
      {
        icon: "agreement",
        title: "Record delivery, acceptance and payment separately",
        where: "Project → Delivery; Client requests → Project status / Payment",
        action:
          "Record when outputs were sent and when the customer accepted them. For a coordinated job, update its work-completed and delivered status in Client requests and review the customer's acceptance there. Record payment amounts from your own payment records.",
        benefit:
          "See whether a job still needs delivery, customer approval or payment follow-up.",
        tip: "StreamLion's payment amounts are provider-reported. They do not collect the customer's fee or prove bank settlement. Payment may happen before or after capture.",
        illustration: "handover",
      },
      {
        icon: "repeat",
        title: "Close the job or plan the next visit",
        where:
          "Client requests → Project status; Project → Delivery → Start a repeat visit",
        action:
          "Close the coordinated request when the work and follow-ups are resolved. Keep the archive and its recovery information where needed. For another visit, start a repeat visit and check its new scope, dates, references and payment details before saving.",
        benefit:
          "Reuse useful context without treating the previous visit's terms as the new agreement.",
      },
    ],
  },
];
