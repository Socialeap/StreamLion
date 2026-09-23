# Project field map

Schema v1. Google headers use the JSON key exactly. Labels reconciled against Jotform 232567126292155 on 2026-09-23; legacy keys are historical references, not PWA dependencies.

| Group     | Field                               | JSON / Sheet column   | Type           | Jotform reference                  |
| --------- | ----------------------------------- | --------------------- | -------------- | ---------------------------------- |
| Project   | Project name                        | `title`               | text           | 3dScanCapture                      |
| Project   | Project ID                          | `reference`           | text           | projectId                          |
| Project   | Commissioning company               | `companyName`         | text           | companyName                        |
| Project   | Property size (sq ft)               | `propertySizeSqFt`    | number         | propertySize                       |
| Project   | Estimated total hours               | `approxHours`         | number         | approxHours                        |
| Project   | Estimated on-site hours             | `siteHours`           | number         | anticipatedWork                    |
| Location  | Street address                      | `address`             | text           | projectAddress[addr_line1]         |
| Location  | Unit / address line 2               | `address2`            | text           | projectAddress[addr_line2]         |
| Location  | City                                | `city`                | text           | projectAddress[city]               |
| Location  | State / region                      | `region`              | text           | projectAddress[state]              |
| Location  | Postal code                         | `postal`              | text           | projectAddress[postal]             |
| Location  | Country                             | `country`             | text           | New / restored field               |
| Contacts  | Requested by                        | `requesterName`       | text           | requestBy[first] + requestBy[last] |
| Contacts  | Requester email                     | `requesterEmail`      | email          | New / restored field               |
| Contacts  | On-site contact 1                   | `contact1Name`        | text           | projectContact                     |
| Contacts  | Contact 1 phone                     | `contact1Phone`       | tel            | projectContact247                  |
| Contacts  | On-site contact 2                   | `contact2Name`        | text           | projectContact254                  |
| Contacts  | Contact 2 phone                     | `contact2Phone`       | tel            | projectContact255                  |
| Contacts  | Capture provider                    | `providerName`        | text           | New / restored field               |
| Contacts  | Provider email                      | `providerEmail`       | email          | New / restored field               |
| Schedule  | Start date and time                 | `startLocal`          | datetime-local | startDate[*]                       |
| Schedule  | Confirmed end date and time         | `endLocal`            | datetime-local | endDatetime[*]                     |
| Schedule  | Time zone (e.g. America/New_York)   | `timeZone`            | text           | New / restored field               |
| Schedule  | Appointment status                  | `appointmentStatus`   | appointment    | New / restored field               |
| Schedule  | Proposed availability               | `proposedTimes`       | textarea       | New / restored field               |
| Scope     | Scope of work                       | `scope`               | textarea       | New / restored field               |
| Scope     | Exclusions                          | `exclusions`          | textarea       | New / restored field               |
| Scope     | Access instructions                 | `accessInstructions`  | textarea       | New / restored field               |
| Scope     | Required deliverables / checklist   | `deliverables`        | textarea       | New / restored field               |
| Scope     | Delivery deadline as stated         | `deliveryDeadline`    | text           | New / restored field               |
| Scope     | Delivery destination / instructions | `deliveryDestination` | textarea       | New / restored field               |
| Scope     | Additional notes                    | `notes`               | textarea       | additionalNotes                    |
| Money     | Offered fee                         | `offeredFee`          | money          | pay364                             |
| Money     | Agreed fee                          | `agreedFee`           | money          | New / restored field               |
| Money     | Currency (ISO code)                 | `currency`            | text           | New / restored field               |
| Money     | Invoiced amount                     | `invoiceAmount`       | money          | New / restored field               |
| Money     | Amount received                     | `paidAmount`          | money          | Amount PAID                        |
| Money     | Payment received date               | `paidDate`            | date           | New / restored field               |
| Money     | Confirmed payment due date          | `dueDate`             | date           | New / restored field               |
| Money     | Payment terms and trigger           | `paymentTerms`        | textarea       | New / restored field               |
| Documents | Reference 1 name                    | `reference1Name`      | text           | reference1nameshort                |
| Documents | Reference 1 link                    | `reference1Url`       | url            | documentimageLink-1                |
| Documents | Reference 2 name                    | `reference2Name`      | text           | reference2nameshort                |
| Documents | Reference 2 link                    | `reference2Url`       | url            | documentimageLink-2                |
| Documents | Document 1 name                     | `document1Name`       | text           | document1Name                      |
| Documents | Document 1 link                     | `document1Url`        | url            | documentLink-1                     |
| Documents | Document 2 name                     | `document2Name`       | text           | document2Name                      |
| Documents | Document 2 link                     | `document2Url`        | url            | document2Link                      |
| Documents | Project Drive folder                | `driveFolderUrl`      | url            | New / restored field               |
| Documents | Additional files and links          | `otherDocuments`      | textarea       | New / restored field               |
| Review    | Sources: document, page, passage    | `sourceNotes`         | textarea       | New / restored field               |
| Review    | Missing / conflicting information   | `unresolved`          | textarea       | New / restored field               |

Jotform logos, separators, buttons, hidden URL capture and duplicate computed payment displays are not business inputs. Five fixed image upload slots become Drive references in otherDocuments; file bytes do not belong in URL parameters or cells. Actual retained recordings belong in Drive. paidAmount is independently sourced; no payment is inferred from offeredFee.
