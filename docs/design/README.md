# First workspace visual direction

Concept: `concept.png`, generated with the built-in Image Gen tool for this increment. It is an implementation reference, not a rendered product screenshot.

Brief: StreamLion spatial-capture PWA; desktop job dashboard plus mobile dashboard and field-note form. White canvas, forest green accent, charcoal text, gray separators, restrained building and document icons. Navigation Jobs / Field notes / Connections. Empty initial dataset, real local counters, New job action, area-linked raw notes. Explicit local storage and disconnected integration states. No fabricated customer metrics.

## Tokens and components

- Canvas white; sidebar #f8faf9; accent #194f39; text #171d20; muted #58616a; separators #e2e7e6.
- System sans typography; 36px desktop heading / 29px mobile; 14–15px controls; at least 44px touch targets.
- Desktop sidebar, open content region, three outlined summary counters, list rows. Mobile bottom navigation and stacked counters.
- Components: app shell, jobs list, job editor, field-note editor, revision list, audio recorder, connections/export view.

## Comparison notes

Desktop and mobile were inspected in Chrome. Concept and latest desktop render were opened with view_image. The concept includes device frames, so its full 1536×1024 image is not a browser viewport specification; actual desktop and 390×844 responsive mode were used.

Compared: navigation hierarchy, white/green palette, heading/control typography, metric grouping, primary-action placement, building motif, mobile bottom navigation and note form. Fixed an unintended vertically centered desktop main region and replaced the initial generic building icon with the concept's outlined silhouette.

Intentional functional additions: current-job selector, saved-note/revision panels, recording controls, storage status near the mobile header, scope disclosure, local-data export and explicit integration limitations. Currency shows cents. Notes retain up to 10,000 characters rather than the concept's illustrative 1,000. No decorative mobile menu with no purpose is included. Populated test jobs replace the empty state during interaction checks.

The supported browser screenshot API returned a blank narrow image on a later mobile recapture; an earlier mobile field-notes screenshot rendered normally and was inspected. Physical-device fidelity and recording acceptance remain open. Do not describe this as final visual or device sign-off.
